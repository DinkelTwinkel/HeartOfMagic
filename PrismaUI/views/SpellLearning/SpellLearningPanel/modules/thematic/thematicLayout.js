/**
 * ThematicLayout -- Grid-aware layout for Thematic Growth mode.
 *
 * Positions NLP tree nodes ON actual grid dot positions from the Root Base
 * preview, with two layout strategies:
 *
 *   Themed BFS: Divides each school's angular sector into sub-arcs
 *               proportional to branch spell count, with branchSpacing degree
 *               gaps between theme wedges. BFS-places each branch's spells
 *               within its allocated sub-arc. Trunk theme centered.
 *
 *   Normal BFS: Standard BFS placement like Classic (no theme sub-arcs).
 *               Uses school colors, no theme awareness in layout.
 *
 * Usage:
 *   var result = ThematicLayout.layoutAllSchools(treeData, baseData, settings);
 *   // result.schools["Destruction"] => { nodes: [...], color: "#C85050", branches: [...] }
 *
 * Depends on: state.js (state.lastSpellData for spell lookups)
 */
var ThematicLayout = {

    _seed: 0,

    // ---- PUBLIC API ---------------------------------------------------------

    /**
     * Layout all schools, dispatching to themed or normal mode.
     *
     * @param {Object} treeData - Tree data from Python backend
     * @param {Object} baseData - Output from TreePreview.getOutput()
     * @param {Object} settings - Layout settings
     * @returns {{ schools: Object }} Result with positioned nodes per school
     */
    layoutAllSchools: function (treeData, baseData, layoutSettings) {
        var result = { schools: {} };
        if (!treeData || !treeData.schools || !baseData) return result;

        var ls = layoutSettings || {};
        var layoutMode = ls.layoutMode || 'themed';

        var mode = baseData.mode || 'sun';
        var grid = baseData.grid;
        var baseSchools = baseData.schools || [];
        var rootNodes = baseData.rootNodes || [];
        var allGridPoints = baseData.gridPoints || [];
        var tierSpacing = grid.tierSpacing || 30;
        var ringRadius = grid.ringRadius || ((grid.ringTier || 3) * tierSpacing);

        console.log('[ThematicLayout] mode=' + mode + ' layoutMode=' + layoutMode +
            ' baseSchools=' + baseSchools.length + ' rootNodes=' + rootNodes.length +
            ' gridPoints=' + allGridPoints.length);

        // ---- Pre-compute per-school data (grid points, info, roots) ----
        var schoolDataList = [];
        for (var schoolName in treeData.schools) {
            if (!treeData.schools.hasOwnProperty(schoolName)) continue;

            var schoolTree = treeData.schools[schoolName];
            var schoolInfo = null;
            for (var si = 0; si < baseSchools.length; si++) {
                if (baseSchools[si].name === schoolName) { schoolInfo = baseSchools[si]; break; }
            }
            if (!schoolInfo) {
                console.warn('[ThematicLayout] No baseSchool match for "' + schoolName + '"');
                continue;
            }

            var schoolRoots = [];
            for (var ri = 0; ri < rootNodes.length; ri++) {
                if (rootNodes[ri].school === schoolName) schoolRoots.push(rootNodes[ri]);
            }
            if (schoolRoots.length === 0) {
                console.warn('[ThematicLayout] No rootNodes for "' + schoolName + '"');
                continue;
            }

            // Filter grid points belonging to this school
            var schoolGridPts = [];
            if (mode === 'flat') {
                for (var gpi = 0; gpi < allGridPoints.length; gpi++) {
                    if (allGridPoints[gpi].school === schoolName) {
                        schoolGridPts.push(allGridPoints[gpi]);
                    }
                }
            } else {
                var growsOutward = this._isOutward(schoolRoots[0]);
                var minLayoutR;
                if (growsOutward) {
                    minLayoutR = ringRadius - tierSpacing;
                } else {
                    minLayoutR = tierSpacing;
                }
                for (var gpi2 = 0; gpi2 < allGridPoints.length; gpi2++) {
                    var gp = allGridPoints[gpi2];
                    if (gp.school !== schoolName) continue;
                    var gpR = Math.sqrt(gp.x * gp.x + gp.y * gp.y);
                    if (gpR >= minLayoutR) {
                        schoolGridPts.push(gp);
                    }
                }
            }

            schoolDataList.push({
                name: schoolName,
                tree: schoolTree,
                info: schoolInfo,
                roots: schoolRoots,
                gridPts: schoolGridPts
            });
        }

        // ---- Layout each school ----
        for (var sdi = 0; sdi < schoolDataList.length; sdi++) {
            var sd = schoolDataList[sdi];
            this._seed = this._hashString(sd.name);
            var schoolColor = sd.info.color || '#888888';

            var positioned;
            var branches;
            if (layoutMode === 'themed') {
                var themedResult = this._layoutThemedBFS(sd.tree, sd.info, sd.roots, grid, sd.gridPts, mode, ls);
                positioned = themedResult.nodes;
                branches = themedResult.branches;
            } else {
                positioned = this._layoutNormalBFS(sd.tree, sd.info, sd.roots, grid, sd.gridPts, mode, ls);
                branches = [];
            }

            result.schools[sd.name] = {
                nodes: positioned,
                color: schoolColor,
                branches: branches
            };

            console.log('[ThematicLayout] ' + sd.name + ': ' + positioned.length +
                ' nodes, ' + branches.length + ' branches (' + layoutMode + ')');
        }

        return result;
    },

    /**
     * Extract branch metadata from a school tree for the renderer.
     *
     * @param {Object} schoolTree - Tree data for one school
     * @param {string} schoolColor - Fallback color
     * @returns {Array} branches - Array of { name, themeColor, nodeFormIds }
     */
    buildBranchMeta: function (schoolTree, schoolColor) {
        var branches = [];
        if (!schoolTree || !schoolTree.branches) return branches;

        for (var bi = 0; bi < schoolTree.branches.length; bi++) {
            var b = schoolTree.branches[bi];
            branches.push({
                name: b.name || b.theme || ('Branch ' + bi),
                themeColor: b.color || schoolColor || '#888888',
                nodeFormIds: b.spellIds || b.spell_ids || [],
                isTrunk: !!b.is_trunk
            });
        }
        return branches;
    },

    // ---- THEMED BFS LAYOUT --------------------------------------------------

    /**
     * Themed BFS: angular sub-arcs per theme branch within the school's sector.
     *
     * @param {Object} schoolTree - Tree data for one school
     * @param {Object} schoolInfo - Base school info (color, etc.)
     * @param {Array} roots - Root nodes for this school
     * @param {Object} grid - Grid config
     * @param {Array} gridPts - Grid points for this school
     * @param {string} mode - 'sun' or 'flat'
     * @param {Object} ls - Layout settings
     * @returns {{ nodes: Array, branches: Array }}
     */
    _layoutThemedBFS: function (schoolTree, schoolInfo, roots, grid, gridPts, mode, ls) {
        var branchSpacing = ls.branchSpacing !== undefined ? ls.branchSpacing : 30;
        var schoolColor = schoolInfo.color || '#888888';
        var nodes = schoolTree.nodes || [];
        var srcBranches = schoolTree.branches || [];

        // Build branch metadata
        var branches = this.buildBranchMeta(schoolTree, schoolColor);

        if (branches.length === 0 || nodes.length === 0) {
            // Fallback: treat all nodes as one branch
            return {
                nodes: this._layoutNormalBFS(schoolTree, schoolInfo, roots, grid, gridPts, mode, ls),
                branches: branches
            };
        }

        // Build formId -> node lookup
        var nodeById = {};
        for (var ni = 0; ni < nodes.length; ni++) {
            if (nodes[ni].formId) nodeById[nodes[ni].formId] = nodes[ni];
        }

        // Compute school's angular sector from root direction
        var rootDir = roots[0].dir || 0;
        var numSchools = 1;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            var preview = TreePreview.getOutput();
            if (preview && preview.schools) numSchools = preview.schools.length || 1;
        }
        var sectorWidth = (2 * Math.PI) / numSchools;
        var sectorStart = rootDir - sectorWidth / 2;

        // Compute total spell count across branches for proportional arcs
        var totalSpells = 0;
        for (var bi = 0; bi < branches.length; bi++) {
            totalSpells += (branches[bi].nodeFormIds || []).length;
        }
        if (totalSpells === 0) totalSpells = 1;

        // Allocate angular sub-arcs, trunk first (center), then sides
        // Adaptive spacing: gaps use at most 15% of sector, rest for branches
        var numGaps = Math.max(0, branches.length - 1);
        var maxGapBudget = sectorWidth * 0.15;
        var spacingRad = numGaps > 0
            ? Math.min((branchSpacing * Math.PI) / 180, maxGapBudget / numGaps)
            : 0;
        var totalGap = spacingRad * numGaps;
        var usableArc = sectorWidth - totalGap;
        if (usableArc < 0.2) usableArc = 0.2;

        // Sort: trunk branch first, then by spell count descending
        var sortedBranches = branches.slice().sort(function (a, b) {
            if (a.isTrunk && !b.isTrunk) return -1;
            if (!a.isTrunk && b.isTrunk) return 1;
            return (b.nodeFormIds || []).length - (a.nodeFormIds || []).length;
        });

        // Assign angular arcs proportionally
        var branchArcs = [];
        var currentAngle = sectorStart;
        for (var ai = 0; ai < sortedBranches.length; ai++) {
            var brSpellCount = (sortedBranches[ai].nodeFormIds || []).length;
            var arcSize = (brSpellCount / totalSpells) * usableArc;
            if (arcSize < 0.05) arcSize = 0.05;

            branchArcs.push({
                branch: sortedBranches[ai],
                startAngle: currentAngle,
                endAngle: currentAngle + arcSize,
                midAngle: currentAngle + arcSize / 2
            });
            currentAngle += arcSize + spacingRad;
        }

        // BFS-place each branch within its angular arc
        var allPositioned = [];
        var occupiedSet = {};
        var tierSpacing = grid.tierSpacing || 30;
        var gridAdj = this._buildGridAdjacency(gridPts, tierSpacing);
        var ringRadius = grid.ringRadius || ((grid.ringTier || 3) * tierSpacing);

        // Build grid point lookup by key for adjacency-based search
        var gridPtMap = {};
        for (var gmi = 0; gmi < gridPts.length; gmi++) {
            gridPtMap[gridPts[gmi].x + ',' + gridPts[gmi].y] = gridPts[gmi];
        }

        // Position map: formId -> {x, y} — tracks where each node was placed
        var positionMap = {};

        for (var bai = 0; bai < branchArcs.length; bai++) {
            var arc = branchArcs[bai];
            var branchFormIds = arc.branch.nodeFormIds || [];
            var themeColor = arc.branch.themeColor;
            var branchName = arc.branch.name;

            // Build fast lookup set for branch membership
            var branchSet = {};
            for (var bsi = 0; bsi < branchFormIds.length; bsi++) {
                branchSet[branchFormIds[bsi]] = true;
            }

            // Get the root node for this branch (first in list or parent attachment)
            var branchRoot = null;
            if (branchFormIds.length > 0) {
                branchRoot = nodeById[branchFormIds[0]];
            }
            if (!branchRoot) continue;

            // BFS through the branch nodes, placing them within the angular arc
            var queue = [branchRoot.formId];
            var visited = {};
            visited[branchRoot.formId] = true;

            while (queue.length > 0) {
                var currentId = queue.shift();
                var currentNode = nodeById[currentId];
                if (!currentNode) continue;

                // Get parent position for grid-local search
                var pId = currentNode.parentFormId || currentNode.parent_form_id || null;
                if (!pId && currentNode.prerequisites && currentNode.prerequisites.length > 0) {
                    pId = currentNode.prerequisites[0];
                }
                var parentPos = pId ? positionMap[pId] : null;

                // Find best grid point: adjacency walk from parent
                var bestPt = this._findBestGridPoint(
                    currentNode, gridPts, occupiedSet, gridAdj, gridPtMap,
                    arc.startAngle, arc.endAngle, ringRadius, mode, roots[0],
                    parentPos, tierSpacing
                );

                if (bestPt) {
                    occupiedSet[bestPt.x + ',' + bestPt.y] = true;
                    positionMap[currentNode.formId] = { x: bestPt.x, y: bestPt.y };
                    allPositioned.push({
                        formId: currentNode.formId,
                        name: currentNode.name || '',
                        x: bestPt.x,
                        y: bestPt.y,
                        schoolColor: schoolColor,
                        themeColor: themeColor,
                        skillLevel: currentNode.skillLevel || currentNode.skill_level || '',
                        tier: currentNode.tier || 1,
                        theme: branchName,
                        children: currentNode.children || [],
                        parentFormId: pId,
                        isRoot: currentNode.isRoot || false,
                        branch: branchName
                    });
                }

                // Enqueue children from this branch
                var children = currentNode.children || [];
                for (var ci = 0; ci < children.length; ci++) {
                    var childId = children[ci];
                    if (!visited[childId] && nodeById[childId] && branchSet[childId]) {
                        visited[childId] = true;
                        queue.push(childId);
                    }
                }
            }
        }

        // Sweep any nodes not yet positioned (orphans, cross-branch children, etc.)
        var positionedSet = {};
        for (var psi = 0; psi < allPositioned.length; psi++) {
            positionedSet[allPositioned[psi].formId] = true;
        }
        for (var nid in nodeById) {
            if (!nodeById.hasOwnProperty(nid) || positionedSet[nid]) continue;
            var orphanNode = nodeById[nid];
            var oPId = orphanNode.parentFormId || orphanNode.parent_form_id || null;
            if (!oPId && orphanNode.prerequisites && orphanNode.prerequisites.length > 0) {
                oPId = orphanNode.prerequisites[0];
            }
            var oParentPos = oPId ? positionMap[oPId] : null;
            var bestPt = this._findBestGridPoint(
                orphanNode, gridPts, occupiedSet, gridAdj, gridPtMap,
                -Math.PI, Math.PI, ringRadius, mode, roots[0],
                oParentPos, tierSpacing
            );
            if (bestPt) {
                occupiedSet[bestPt.x + ',' + bestPt.y] = true;
                positionMap[orphanNode.formId] = { x: bestPt.x, y: bestPt.y };
                allPositioned.push({
                    formId: orphanNode.formId,
                    name: orphanNode.name || '',
                    x: bestPt.x,
                    y: bestPt.y,
                    schoolColor: schoolColor,
                    themeColor: orphanNode.themeColor || schoolColor,
                    skillLevel: orphanNode.skillLevel || orphanNode.skill_level || '',
                    tier: orphanNode.tier || 1,
                    theme: 'other',
                    children: orphanNode.children || [],
                    parentFormId: oPId,
                    isRoot: orphanNode.isRoot || false,
                    branch: 'other'
                });
            }
        }

        return { nodes: allPositioned, branches: branches };
    },

    // ---- NORMAL BFS LAYOUT (fallback) ---------------------------------------

    /**
     * Standard BFS placement with no theme awareness (like Classic).
     *
     * @param {Object} schoolTree - Tree data for one school
     * @param {Object} schoolInfo - Base school info
     * @param {Array} roots - Root nodes for this school
     * @param {Object} grid - Grid config
     * @param {Array} gridPts - Grid points for this school
     * @param {string} mode - 'sun' or 'flat'
     * @param {Object} ls - Layout settings
     * @returns {Array} positioned nodes
     */
    _layoutNormalBFS: function (schoolTree, schoolInfo, roots, grid, gridPts, mode, ls) {
        var schoolColor = schoolInfo.color || '#888888';
        var nodes = schoolTree.nodes || [];
        if (nodes.length === 0) return [];

        // Build formId -> node lookup
        var nodeById = {};
        for (var ni = 0; ni < nodes.length; ni++) {
            if (nodes[ni].formId) nodeById[nodes[ni].formId] = nodes[ni];
        }

        // Find the root
        var rootNode = null;
        for (var ri = 0; ri < nodes.length; ri++) {
            if (nodes[ri].isRoot) { rootNode = nodes[ri]; break; }
        }
        if (!rootNode && nodes.length > 0) rootNode = nodes[0];
        if (!rootNode) return [];

        var tierSpacing = grid.tierSpacing || 30;
        var ringRadius = grid.ringRadius || ((grid.ringTier || 3) * tierSpacing);
        var occupiedSet = {};
        var gridAdj = this._buildGridAdjacency(gridPts, tierSpacing);
        var positioned = [];
        var positionMap = {};

        // Build grid point lookup by key
        var gridPtMap = {};
        for (var gmi = 0; gmi < gridPts.length; gmi++) {
            gridPtMap[gridPts[gmi].x + ',' + gridPts[gmi].y] = gridPts[gmi];
        }

        // BFS placement
        var queue = [rootNode.formId];
        var visited = {};
        visited[rootNode.formId] = true;

        while (queue.length > 0) {
            var currentId = queue.shift();
            var currentNode = nodeById[currentId];
            if (!currentNode) continue;

            // Get parent position
            var parentId = currentNode.parentFormId || currentNode.parent_form_id || null;
            if (!parentId && currentNode.prerequisites && currentNode.prerequisites.length > 0) {
                parentId = currentNode.prerequisites[0];
            }
            var parentPos = parentId ? positionMap[parentId] : null;

            // Find best grid point (full angular range)
            var bestPt = this._findBestGridPoint(
                currentNode, gridPts, occupiedSet, gridAdj, gridPtMap,
                -Math.PI, Math.PI, ringRadius, mode, roots[0],
                parentPos, tierSpacing
            );

            if (bestPt) {
                occupiedSet[bestPt.x + ',' + bestPt.y] = true;
                positionMap[currentNode.formId] = { x: bestPt.x, y: bestPt.y };
                positioned.push({
                    formId: currentNode.formId,
                    name: currentNode.name || '',
                    x: bestPt.x,
                    y: bestPt.y,
                    schoolColor: schoolColor,
                    themeColor: schoolColor,
                    skillLevel: currentNode.skillLevel || currentNode.skill_level || '',
                    tier: currentNode.tier || 1,
                    theme: currentNode.theme || '',
                    children: currentNode.children || [],
                    parentFormId: parentId,
                    isRoot: currentNode.isRoot || false,
                    branch: ''
                });
            }

            // Enqueue children
            var children = currentNode.children || [];
            for (var ci = 0; ci < children.length; ci++) {
                if (!visited[children[ci]] && nodeById[children[ci]]) {
                    visited[children[ci]] = true;
                    queue.push(children[ci]);
                }
            }
        }

        return positioned;
    },

    // ---- GRID POINT SCORING -------------------------------------------------

    /**
     * Find the best grid point for a node using grid-adjacency BFS.
     *
     * For root nodes (no parentPos): finds the grid point nearest the ideal
     * root position (ringRadius, center of arc).
     *
     * For child nodes (parentPos given): walks the grid adjacency graph
     * outward from the parent's grid point. First unoccupied point within
     * the angular arc that's outward from the parent wins. This guarantees
     * short edges and prevents criss-crossing.
     *
     * @param {Object} node - Node to place
     * @param {Array} gridPts - Available grid points
     * @param {Object} occupiedSet - Set of occupied "x,y" keys
     * @param {Object} gridAdj - Grid adjacency data (key -> [neighborKeys])
     * @param {Object} gridPtMap - Grid point lookup (key -> {x,y,...})
     * @param {number} arcStart - Angular arc start (radians)
     * @param {number} arcEnd - Angular arc end (radians)
     * @param {number} ringRadius - Ring radius
     * @param {string} mode - 'sun' or 'flat'
     * @param {Object} rootRef - Root reference node for direction
     * @param {Object|null} parentPos - Parent's {x,y} position, null for root
     * @param {number} tierSpacing - Distance between tiers
     * @returns {Object|null} Best grid point { x, y } or null
     */
    _findBestGridPoint: function (node, gridPts, occupiedSet, gridAdj, gridPtMap, arcStart, arcEnd, ringRadius, mode, rootRef, parentPos, tierSpacing) {
        if (!gridPts || gridPts.length === 0) return null;

        if (!parentPos) {
            // ---- ROOT PLACEMENT ----
            // Find the grid point closest to the ideal root position
            // (at ringRadius, center of angular arc)
            var arcMid = (arcStart + arcEnd) / 2;
            var idealX = ringRadius * Math.cos(arcMid);
            var idealY = ringRadius * Math.sin(arcMid);
            var bestPt = null;
            var bestDist = Infinity;
            for (var ri = 0; ri < gridPts.length; ri++) {
                var rp = gridPts[ri];
                var rKey = rp.x + ',' + rp.y;
                if (occupiedSet[rKey]) continue;
                if (mode !== 'flat') {
                    var rAngle = Math.atan2(rp.y, rp.x);
                    if (!this._isAngleInArc(rAngle, arcStart, arcEnd)) continue;
                }
                var rdx = rp.x - idealX;
                var rdy = rp.y - idealY;
                var rd = rdx * rdx + rdy * rdy;
                if (rd < bestDist) {
                    bestDist = rd;
                    bestPt = rp;
                }
            }
            return bestPt;
        }

        // ---- CHILD PLACEMENT: Proximity scoring ----
        // Iterate all grid points, score by distance from parent.
        // Prefer points ~tierSpacing away (one tier-step), outward from center.
        var parentR = Math.sqrt(parentPos.x * parentPos.x + parentPos.y * parentPos.y);
        var bestPt2 = null;
        var bestScore = -Infinity;

        for (var ci = 0; ci < gridPts.length; ci++) {
            var cp = gridPts[ci];
            var cKey = cp.x + ',' + cp.y;
            if (occupiedSet[cKey]) continue;

            // Arc filter (sun mode only)
            if (mode !== 'flat') {
                var cpAngle = Math.atan2(cp.y, cp.x);
                if (!this._isAngleInArc(cpAngle, arcStart, arcEnd)) continue;
            }

            var cdx = cp.x - parentPos.x;
            var cdy = cp.y - parentPos.y;
            var dist = Math.sqrt(cdx * cdx + cdy * cdy);

            // Score: prefer points close to one tier-step from parent
            var distDev = Math.abs(dist - tierSpacing);
            var score = -distDev * distDev * 0.1;

            // Outward bias: prefer points at same ring or further out
            var cpR = Math.sqrt(cp.x * cp.x + cp.y * cp.y);
            if (cpR >= parentR) {
                score += 10;
            } else {
                score -= 20;
            }

            // Penalize long jumps (> 2.5 tier-steps)
            if (dist > tierSpacing * 2.5) {
                score -= (dist - tierSpacing * 2.5) * 2;
            }

            if (score > bestScore) {
                bestScore = score;
                bestPt2 = cp;
            }
        }

        return bestPt2;
    },

    // ---- HELPERS ------------------------------------------------------------

    /**
     * Check if an angle falls within an arc (handles wrapping).
     * @private
     */
    _isAngleInArc: function (angle, arcStart, arcEnd) {
        // Normalize angle to [-PI, PI]
        while (angle < -Math.PI) angle += 2 * Math.PI;
        while (angle > Math.PI) angle -= 2 * Math.PI;

        // Normalize arc boundaries
        var s = arcStart;
        var e = arcEnd;
        while (s < -Math.PI) s += 2 * Math.PI;
        while (s > Math.PI) s -= 2 * Math.PI;
        while (e < -Math.PI) e += 2 * Math.PI;
        while (e > Math.PI) e -= 2 * Math.PI;

        if (s <= e) {
            return angle >= s && angle <= e;
        } else {
            // Arc wraps around +/-PI
            return angle >= s || angle <= e;
        }
    },

    /**
     * Build grid adjacency map: for each grid point, find its nearest neighbors.
     * @private
     */
    _buildGridAdjacency: function (gridPts, tierSpacing) {
        var adj = {};
        var threshold = tierSpacing * 1.5;
        var threshSq = threshold * threshold;

        for (var i = 0; i < gridPts.length; i++) {
            var p = gridPts[i];
            var key = p.x + ',' + p.y;
            if (!adj[key]) adj[key] = [];

            for (var j = i + 1; j < gridPts.length; j++) {
                var q = gridPts[j];
                var dx = p.x - q.x;
                var dy = p.y - q.y;
                if (dx * dx + dy * dy <= threshSq) {
                    var qKey = q.x + ',' + q.y;
                    if (!adj[qKey]) adj[qKey] = [];
                    adj[key].push(qKey);
                    adj[qKey].push(key);
                }
            }
        }
        return adj;
    },

    /**
     * Check if a root node grows outward (away from center).
     * @private
     */
    _isOutward: function (rootNode) {
        if (!rootNode) return true;
        var dist = Math.sqrt(rootNode.x * rootNode.x + rootNode.y * rootNode.y);
        return dist > 50;
    },

    /**
     * Deterministic hash of a string to seed pseudo-random placement.
     * @private
     */
    _hashString: function (str) {
        var hash = 0;
        if (!str) return hash;
        for (var i = 0; i < str.length; i++) {
            var ch = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & hash; // Convert to 32-bit int
        }
        return Math.abs(hash);
    }
};

console.log('[ThematicLayout] Loaded');
