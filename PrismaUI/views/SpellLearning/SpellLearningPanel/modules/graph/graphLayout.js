/**
 * GraphLayout - Grid-based layout for Graph Growth mode.
 *
 * Positions arborescence tree nodes onto the grid from TreePreview.
 * Unlike ClassicLayout which uses tier zones, GraphLayout uses tree depth
 * from the arborescence root as the radial placement guide. Deeper nodes
 * in the tree go further from center.
 *
 * Algorithm:
 *   SUN mode:
 *     1. For each school, find root nodes from baseData
 *     2. BFS through the tree from root outward
 *     3. For each node, score candidate grid points by:
 *        - Distance to parent (closer = better)
 *        - Radial outward bias (configurable)
 *        - Depth matching (grid ring ~ tree depth)
 *        - Neighbor density (respect spread setting)
 *     4. Place at best-scoring unoccupied grid point
 *
 *   FLAT mode:
 *     Same algorithm but growth direction follows the flat layout axis.
 *
 * Usage:
 *   var result = GraphLayout.layoutAllSchools(treeData, baseData, settings);
 *   // result.schools["Destruction"] => { nodes: [...], color: "#C85050" }
 *
 * Depends on: state.js (state.lastSpellData for spell lookups)
 */

var GraphLayout = {

    _seed: 0,

    // ---- PUBLIC API ---------------------------------------------------------

    /**
     * Layout all schools using depth-based grid placement.
     *
     * @param {Object} treeData - { schools: { name: { root, nodes[] } } }
     * @param {Object} baseData - Output from TreePreview.getOutput()
     * @param {Object} settings - Graph settings (chaos, forceBalance, etc.)
     * @returns {{ schools: Object, zoneInfo: Object }}
     */
    layoutAllSchools: function (treeData, baseData, settings) {
        var result = { schools: {}, zoneInfo: null };
        if (!treeData || !treeData.schools || !baseData) return result;

        var ls = settings || {};
        var mode = baseData.mode || 'sun';
        var grid = baseData.grid;
        var baseSchools = baseData.schools || [];
        var rootNodes = baseData.rootNodes || [];
        var allGridPoints = baseData.gridPoints || [];
        var tierSpacing = grid ? (grid.tierSpacing || grid.spacing || 30) : 30;
        var ringRadius = grid ? (grid.ringRadius || ((grid.ringTier || 3) * tierSpacing)) : 90;

        // Store zone info for tier arc rendering
        result.zoneInfo = { ringRadius: ringRadius, tierSpacing: tierSpacing };

        // Spread → max occupied neighbor limit (same as ClassicLayout)
        var spread = ls.spread !== undefined ? ls.spread : 50;
        var maxOccNbrs = Math.max(1, Math.round(8 - spread * 0.07));

        // Radial bias
        var radialBias = ls.radialBias !== undefined ? ls.radialBias : 50;
        var radialWeight = radialBias * 0.03;

        console.log('[GraphLayout] mode=' + mode + ' schools=' + Object.keys(treeData.schools).length +
            ' tierSpacing=' + tierSpacing + ' ringRadius=' + ringRadius);

        // Build grid adjacency
        var gridGraph = this._buildGridGraph(allGridPoints, tierSpacing);
        var occupied = {}; // global grid point index → true

        for (var schoolName in treeData.schools) {
            if (!treeData.schools.hasOwnProperty(schoolName)) continue;
            var schoolTree = treeData.schools[schoolName];
            if (!schoolTree || !schoolTree.nodes || schoolTree.nodes.length === 0) continue;

            // Find school info
            var schoolInfo = null;
            for (var bi = 0; bi < baseSchools.length; bi++) {
                if (baseSchools[bi].name === schoolName) { schoolInfo = baseSchools[bi]; break; }
            }
            if (!schoolInfo) {
                console.warn('[GraphLayout] No baseSchool match for "' + schoolName + '"');
                continue;
            }

            // Get grid points for this school
            var schoolGridPts = [];
            for (var gi = 0; gi < allGridPoints.length; gi++) {
                if (allGridPoints[gi].school === schoolName) {
                    schoolGridPts.push({ idx: gi, x: allGridPoints[gi].x, y: allGridPoints[gi].y });
                }
            }

            // Get school root nodes from baseData
            var schoolRoots = [];
            for (var ri = 0; ri < rootNodes.length; ri++) {
                if (rootNodes[ri].school === schoolName) {
                    schoolRoots.push(rootNodes[ri]);
                }
            }

            var positioned = this._layoutSchoolOnGrid(
                schoolTree, schoolGridPts, schoolRoots, occupied,
                maxOccNbrs, radialWeight, tierSpacing, ringRadius, gridGraph, allGridPoints
            );

            var schoolColor = (schoolTree.color || schoolInfo.color || '#888888');

            result.schools[schoolName] = {
                nodes: positioned,
                color: schoolColor,
                treeMaxRadius: this._computeMaxRadius(positioned)
            };

            console.log('[GraphLayout] School "' + schoolName + '": ' + positioned.length +
                '/' + schoolTree.nodes.length + ' nodes placed');
        }

        return result;
    },

    // ---- PRIVATE: SCHOOL LAYOUT ---------------------------------------------

    _layoutSchoolOnGrid: function (schoolTree, schoolGridPts, schoolRoots, occupied,
                                    maxOccNbrs, radialWeight, tierSpacing, ringRadius,
                                    gridGraph, allGridPoints) {
        var positioned = [];
        var placed = {};      // formId → true
        var gridOccupied = {}; // gridPt index → formId

        // Build node lookup
        var nodeLookup = {};
        var nodes = schoolTree.nodes;
        for (var i = 0; i < nodes.length; i++) {
            nodeLookup[nodes[i].formId] = nodes[i];
        }

        // Compute tree depth via BFS from root
        var rootFormId = schoolTree.root;
        var depthMap = {};
        depthMap[rootFormId] = 0;
        var maxDepth = 0;
        var bfsQ = [rootFormId];
        var bfsHead = 0;
        while (bfsHead < bfsQ.length) {
            var cur = bfsQ[bfsHead++];
            var curNode = nodeLookup[cur];
            if (!curNode) continue;
            var children = curNode.children || [];
            for (var ci = 0; ci < children.length; ci++) {
                if (depthMap[children[ci]] === undefined) {
                    depthMap[children[ci]] = depthMap[cur] + 1;
                    if (depthMap[children[ci]] > maxDepth) maxDepth = depthMap[children[ci]];
                    bfsQ.push(children[ci]);
                }
            }
        }

        // Place root at nearest school root grid point
        if (schoolRoots.length > 0 && rootFormId) {
            var rootNode = nodeLookup[rootFormId];
            var bestRootPt = this._findNearestGridPt(
                schoolRoots[0].x, schoolRoots[0].y, schoolGridPts, occupied
            );
            if (bestRootPt !== null) {
                var rp = schoolGridPts[bestRootPt];
                positioned.push({
                    formId: rootFormId,
                    name: rootNode ? rootNode.name : '',
                    x: rp.x,
                    y: rp.y,
                    skillLevel: rootNode ? rootNode.skillLevel : 'Novice',
                    tier: rootNode ? rootNode.tier : 1,
                    theme: rootNode ? rootNode.theme : '',
                    parentFormId: null,
                    isRoot: true
                });
                placed[rootFormId] = true;
                occupied[rp.idx] = true;
                gridOccupied[rp.idx] = rootFormId;
            }
        }

        // BFS placement: place children outward from placed parents
        var queue = [rootFormId];
        var qHead = 0;
        while (qHead < queue.length) {
            var parentId = queue[qHead++];
            var parentNode = nodeLookup[parentId];
            if (!parentNode) continue;

            // Find parent's position
            var parentPos = null;
            for (var pi = 0; pi < positioned.length; pi++) {
                if (positioned[pi].formId === parentId) { parentPos = positioned[pi]; break; }
            }
            if (!parentPos) continue;

            var children = parentNode.children || [];
            for (var ci = 0; ci < children.length; ci++) {
                var childId = children[ci];
                if (placed[childId]) continue;
                var childNode = nodeLookup[childId];
                if (!childNode) continue;

                var childDepth = depthMap[childId] || 1;

                // Score all unoccupied school grid points
                var bestScore = -Infinity;
                var bestPtIdx = -1;

                for (var gi = 0; gi < schoolGridPts.length; gi++) {
                    var gp = schoolGridPts[gi];
                    if (occupied[gp.idx]) continue;

                    // Check neighbor density
                    var nbrs = gridGraph[gp.idx] || [];
                    var occCount = 0;
                    for (var ni = 0; ni < nbrs.length; ni++) {
                        if (occupied[nbrs[ni]]) occCount++;
                    }
                    if (occCount > maxOccNbrs) continue;

                    var score = 0;

                    // F1: Distance to parent (closer = better, within limits)
                    var dx = gp.x - parentPos.x;
                    var dy = gp.y - parentPos.y;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    var idealDist = tierSpacing * 1.2;
                    score += Math.max(0, 50 - Math.abs(dist - idealDist) * 1.5);

                    // F2: Radial outward bias
                    var gpR = Math.sqrt(gp.x * gp.x + gp.y * gp.y);
                    var parentR = Math.sqrt(parentPos.x * parentPos.x + parentPos.y * parentPos.y);
                    if (gpR > parentR) {
                        score += radialWeight * 15;
                    } else {
                        score -= radialWeight * 10;
                    }

                    // F3: Depth matching — grid ring should match tree depth
                    var expectedR = ringRadius + childDepth * tierSpacing;
                    var depthError = Math.abs(gpR - expectedR);
                    score += Math.max(0, 30 - depthError * 0.5);

                    // F4: Direction alignment (child should be in same general direction as parent from center)
                    if (dist > 1) {
                        var moveX = dx / dist;
                        var moveY = dy / dist;
                        var radX = parentPos.x;
                        var radY = parentPos.y;
                        var radLen = Math.sqrt(radX * radX + radY * radY) || 1;
                        var dot = moveX * (radX / radLen) + moveY * (radY / radLen);
                        score += dot * 10;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        bestPtIdx = gi;
                    }
                }

                if (bestPtIdx >= 0) {
                    var bp = schoolGridPts[bestPtIdx];
                    positioned.push({
                        formId: childId,
                        name: childNode.name || '',
                        x: bp.x,
                        y: bp.y,
                        skillLevel: childNode.skillLevel || 'Apprentice',
                        tier: childNode.tier || 1,
                        theme: childNode.theme || '',
                        parentFormId: parentId,
                        isRoot: false
                    });
                    placed[childId] = true;
                    occupied[bp.idx] = true;
                    gridOccupied[bp.idx] = childId;
                }

                queue.push(childId);
            }
        }

        return positioned;
    },

    // ---- GRID GRAPH BUILDING ------------------------------------------------

    _buildGridGraph: function (allGridPoints, tierSpacing) {
        var graph = {};
        var threshold = tierSpacing * 1.5;
        var threshSq = threshold * threshold;

        for (var i = 0; i < allGridPoints.length; i++) {
            graph[i] = [];
            for (var j = 0; j < allGridPoints.length; j++) {
                if (i === j) continue;
                var dx = allGridPoints[i].x - allGridPoints[j].x;
                var dy = allGridPoints[i].y - allGridPoints[j].y;
                if (dx * dx + dy * dy <= threshSq) {
                    graph[i].push(j);
                }
            }
        }
        return graph;
    },

    _findNearestGridPt: function (x, y, schoolGridPts, occupied) {
        var bestDist = Infinity;
        var bestIdx = null;
        for (var i = 0; i < schoolGridPts.length; i++) {
            if (occupied[schoolGridPts[i].idx]) continue;
            var dx = schoolGridPts[i].x - x;
            var dy = schoolGridPts[i].y - y;
            var d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return bestIdx;
    },

    _computeMaxRadius: function (positioned) {
        var maxR = 0;
        for (var i = 0; i < positioned.length; i++) {
            var r = Math.sqrt(positioned[i].x * positioned[i].x + positioned[i].y * positioned[i].y);
            if (r > maxR) maxR = r;
        }
        return maxR;
    }
};
