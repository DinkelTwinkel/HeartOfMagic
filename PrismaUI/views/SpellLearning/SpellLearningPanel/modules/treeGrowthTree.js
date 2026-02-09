/**
 * Tree Growth — TREE Mode (Orchestrator)
 *
 * Trunk-first tree building system. Defines a trunk corridor from the root
 * line, uses a 3-section allocation bar (Branches / Trunk / Root), and shows
 * live ghost node preview of trunk filling (layer-by-layer, bottom-up).
 *
 * Delegates to sub-modules:
 *   - TreeSettings:  Settings panel UI + allocation bar
 *   - TreeTrunk:     Corridor computation + grid point filtering
 *   - TreeRenderer:  Canvas drawing (corridors + ghost nodes)
 *
 * Self-registers with TreeGrowth via registerMode().
 * Depends on: tree/treeSettings.js, tree/treeTrunk.js, tree/treeRenderer.js
 */

var TreeGrowthTree = {

    settings: {
        ghostOpacity: 35,
        nodeRadius: 5,
        trunkThickness: 70,
        branchSpread: 2.5,
        rootSpread: 2.5,
        pctBranches: 30,
        pctTrunk: 50,
        pctRoot: 20
    },

    // Placement cache — only recompute when baseData or settings change
    _cache: null,
    _lastCacheKey: '',

    // Built tree data (from Python backend)
    _treeData: null,
    _builtPlacements: null,

    // =========================================================================
    // SETTINGS UI — delegates to TreeSettings
    // =========================================================================

    buildSettingsHTML: function() {
        if (typeof TreeSettings !== 'undefined') {
            return TreeSettings.buildHTML(this.settings);
        }
        return '<div class="tree-preview-empty">TreeSettings module not loaded</div>';
    },

    bindEvents: function() {
        var self = this;

        if (typeof TreeSettings === 'undefined') return;

        TreeSettings.bindEvents({
            onBuild: function() { self.buildTree(); },
            onApply: function() { self.applyTree(); },
            onClear: function() { self.clearTree(); },
            onSetupPython: function() { window.callCpp('SetupPython', ''); },
            onSettingChanged: function(key, value) {
                self.settings[key] = value;
                self._cache = null;
                self._builtPlacements = null;
                self._builtLayoutKey = '';
                self._markDirty();
            },
            onAllocationChanged: function(pctBranches, pctTrunk, pctRoot) {
                self.settings.pctBranches = pctBranches;
                self.settings.pctTrunk = pctTrunk;
                self.settings.pctRoot = pctRoot;
                self._cache = null;
                self._builtPlacements = null;
                self._builtLayoutKey = '';
                self._markDirty();
            }
        });
    },

    // =========================================================================
    // TREE BUILDING FLOW
    // =========================================================================

    buildTree: function() {
        var spellData = (typeof state !== 'undefined' && state.lastSpellData)
            ? state.lastSpellData : null;

        if (!spellData || !spellData.spells || spellData.spells.length === 0) {
            TreeSettings.setStatusText('No spells scanned \u2014 scan first', '#ef4444');
            return;
        }

        // Reset _treeBuilt so setTreeBuilt(true) sees wasBuilt=false and PRM runs
        if (typeof TreeGrowth !== 'undefined') {
            TreeGrowth._treeBuilt = false;
        }

        // Show build progress modal
        var hasPRM = typeof PreReqMaster !== 'undefined' && PreReqMaster.isEnabled && PreReqMaster.isEnabled();
        if (typeof BuildProgress !== 'undefined') {
            BuildProgress.start(hasPRM);
        }

        TreeSettings.setStatusText('Building tree (Python)...', '#f59e0b');
        var buildBtn = document.getElementById('tgTreeBuildBtn');
        if (buildBtn) buildBtn.disabled = true;

        // Set pending flag so onProceduralPythonComplete routes result here
        if (typeof state !== 'undefined') {
            state._treeGrowthBuildPending = true;
        }

        var baseData = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            baseData = TreePreview.getOutput();
        }

        // Apply all scan filters: blacklist, whitelist, tome
        var spellsToProcess = spellData.spells;
        if (typeof filterBlacklistedSpells === 'function') {
            spellsToProcess = filterBlacklistedSpells(spellsToProcess);
        }
        if (typeof filterWhitelistedSpells === 'function') {
            spellsToProcess = filterWhitelistedSpells(spellsToProcess);
        }
        var tomeToggle = document.getElementById('scanModeTomes');
        if (tomeToggle && tomeToggle.checked && typeof state !== 'undefined' && state.tomedSpellIds) {
            var tomedIds = state.tomedSpellIds;
            spellsToProcess = spellsToProcess.filter(function(s) {
                return tomedIds[s.formId || s.id];
            });
        }
        console.log('[TreeGrowthTree] Filtered spells: ' + spellsToProcess.length + '/' + spellData.spells.length);

        var config = {
            mode: 'tree',
            trunkThickness: this.settings.trunkThickness,
            pctBranches: this.settings.pctBranches,
            pctTrunk: this.settings.pctTrunk,
            pctRoot: this.settings.pctRoot,
            baseMode: baseData ? baseData.mode : 'sun',
            max_children_per_node: 4,
            top_themes_per_school: 8,
            convergence_chance: 0.3,
            prefer_vanilla_roots: true
        };

        window.callCpp('ProceduralPythonGenerate', JSON.stringify({
            spells: spellsToProcess,
            config: config
        }));
    },

    loadTreeData: function(data) {
        this._treeData = data;
        console.log('[TreeGrowthTree] loadTreeData, schools:',
            data && data.schools ? Object.keys(data.schools) : 'none');

        // Count total nodes
        var totalNodes = 0;
        if (data && data.schools) {
            for (var name in data.schools) {
                if (data.schools.hasOwnProperty(name)) {
                    var sd = data.schools[name];
                    totalNodes += sd.nodes ? sd.nodes.length : 0;
                }
            }
        }

        TreeSettings.setTreeBuilt(true, totalNodes);
        this._cache = null;
        this._markDirty();
    },

    applyTree: function() {
        if (!this._treeData) return;

        // Compute layout positions so we can bake x/y into saved nodes.
        // EditMode reads node.x / node.y for drag-and-drop repositioning.
        var baseData = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            baseData = TreePreview.getOutput();
        }
        var layout = baseData ? this._computeBuiltLayout(baseData) : null;

        // Build formId → {x, y} lookup from layout results
        var posLookup = {};
        if (layout && layout.posMap) {
            posLookup = layout.posMap;
        }

        // LOG: How many positions did we get?
        var posCount = Object.keys(posLookup).length;
        console.log('[applyTree] layout=' + (layout ? 'yes' : 'null') +
                    ', posMap keys=' + posCount +
                    ', baseData=' + (baseData ? baseData.mode : 'null'));
        if (window.callCpp) {
            window.callCpp('LogMessage', JSON.stringify({
                message: '[applyTree] posMap keys=' + posCount + ', baseData mode=' + (baseData ? baseData.mode : 'null'),
                level: 'info'
            }));
        }

        // Re-center positions around (0,0) for the canvasRenderer.
        // Layout positions are in preview canvas coordinates (origin
        // at top-left, tree center at ~w/2,h/2). The wheel/canvas
        // renderer expects world coords centered at (0,0).
        var posKeys = Object.keys(posLookup);
        if (posKeys.length > 0) {
            var sumX = 0, sumY = 0;
            for (var pk = 0; pk < posKeys.length; pk++) {
                sumX += posLookup[posKeys[pk]].x;
                sumY += posLookup[posKeys[pk]].y;
            }
            var cx = sumX / posKeys.length;
            var cy = sumY / posKeys.length;
            for (var pk2 = 0; pk2 < posKeys.length; pk2++) {
                posLookup[posKeys[pk2]].x -= cx;
                posLookup[posKeys[pk2]].y -= cy;
            }
        }

        // Bake school sector data from TreePreview so the wheel renderer
        // can use exact angles/colors instead of guessing from node positions.
        var sectorLookup = {};
        if (baseData && baseData.schools) {
            for (var si = 0; si < baseData.schools.length; si++) {
                var bs = baseData.schools[si];
                sectorLookup[bs.name] = {
                    color: bs.color,
                    arcStart: bs.arcStart,
                    arcSize: bs.arcSize
                };
            }
        }

        // Bake root node directions (both sun and flat output dir on roots).
        // The wheel renderer uses this for school rotation when no arc data.
        var rootDirLookup = {};
        if (baseData && baseData.rootNodes) {
            for (var rdi = 0; rdi < baseData.rootNodes.length; rdi++) {
                var rdn = baseData.rootNodes[rdi];
                if (rdn.school && rdn.dir !== undefined) {
                    rootDirLookup[rdn.school] = rdn.dir;
                }
            }
        }

        // Convert built tree data into spell_tree.json format
        var output = {
            version: '1.0',
            generator: 'PrismaUI TreeGrowth',
            generatedAt: new Date().toISOString(),
            trustPrereqs: true, // Skip TreeParser prereq mutations — data is authoritative
            config: {
                trunkThickness: this.settings.trunkThickness,
                pctBranches: this.settings.pctBranches,
                pctTrunk: this.settings.pctTrunk,
                pctRoot: this.settings.pctRoot,
                layoutMode: baseData ? baseData.mode : 'sun',
                ringRadius: baseData && baseData.grid ? baseData.grid.ringRadius : 120
            },
            globe: (typeof TreeCore !== 'undefined' && TreeCore.getOutput)
                ? TreeCore.getOutput()
                : { x: 0, y: 0, radius: 45 },
            schools: {}
        };

        var srcSchools = this._treeData.schools || {};
        for (var schoolName in srcSchools) {
            if (!srcSchools.hasOwnProperty(schoolName)) continue;
            var src = srcSchools[schoolName];
            var srcNodes = src.nodes || [];

            var schoolRootId = src.root || (srcNodes.length > 0 ? srcNodes[0].formId : '');
            var outNodes = [];
            for (var i = 0; i < srcNodes.length; i++) {
                var sn = srcNodes[i];
                var nodePrereqs = sn.prerequisites || [];

                // Prereq rework: regular prereqs = soft (need any 1 of N)
                // Lock prereqs = hard (mandatory)
                var lockHardPrereqs = [];
                var lockData = [];
                // Locks are stored directly on the node by PreReqMaster
                if (sn.locks && sn.locks.length > 0) {
                    lockData = sn.locks;
                    lockHardPrereqs = sn.locks.map(function(l) { return l.nodeId; });
                }

                var outNode = {
                    formId: sn.formId,
                    children: sn.children || [],
                    prerequisites: nodePrereqs,
                    hardPrereqs: lockHardPrereqs,
                    softPrereqs: nodePrereqs,
                    softNeeded: nodePrereqs.length > 0 ? 1 : 0,
                    tier: sn.tier || 1
                };
                if (lockData.length > 0) outNode.locks = lockData;
                if (sn.skillLevel) outNode.skillLevel = sn.skillLevel;
                if (sn.theme) outNode.theme = sn.theme;
                if (sn.name) outNode.name = sn.name;
                if (sn.formId === schoolRootId) outNode.isRoot = true;

                // Bake layout position if computed
                var pos = posLookup[sn.formId];
                if (pos) {
                    outNode.x = Math.round(pos.x * 100) / 100;
                    outNode.y = Math.round(pos.y * 100) / 100;
                }
                outNodes.push(outNode);
            }

            // LOG: Per-school position stats
            var schoolWithPos = 0;
            for (var ni = 0; ni < outNodes.length; ni++) {
                if (outNodes[ni].x !== undefined || outNodes[ni].y !== undefined) schoolWithPos++;
            }
            var logMsg = '[applyTree] School "' + schoolName + '": ' + outNodes.length +
                         ' nodes, ' + schoolWithPos + ' with x/y';
            if (outNodes.length > 0) {
                var s0 = outNodes[0];
                logMsg += ', first={x:' + s0.x + ',y:' + s0.y + ',id:' + s0.formId + '}';
            }
            console.log(logMsg);
            if (window.callCpp) {
                window.callCpp('LogMessage', JSON.stringify({ message: logMsg, level: 'info' }));
            }

            // Bake sector angles from TreePreview
            var sector = sectorLookup[schoolName];
            var schoolOut = {
                root: schoolRootId,
                layoutStyle: src.layoutStyle || 'tree',
                nodes: outNodes
            };
            if (sector) {
                schoolOut.color = sector.color;
                schoolOut.arcStart = sector.arcStart;
                schoolOut.arcSize = sector.arcSize;
                // Spoke angle = center of arc (radians → degrees for renderer)
                schoolOut.spokeAngle = (sector.arcStart + sector.arcSize / 2) * 180 / Math.PI;
                schoolOut.startAngle = sector.arcStart * 180 / Math.PI;
                schoolOut.endAngle = (sector.arcStart + sector.arcSize) * 180 / Math.PI;
            }

            // Bake root direction (works for both sun and flat modes).
            // Wheel renderer uses this for school sector rotation when
            // arc data is missing (flat mode has no arcs, only directions).
            if (rootDirLookup[schoolName] !== undefined) {
                schoolOut.rootDirection = rootDirLookup[schoolName];
                // If no sector data (flat mode), derive spokeAngle from direction
                if (!sector) {
                    schoolOut.spokeAngle = rootDirLookup[schoolName] * 180 / Math.PI;
                }
            }

            output.schools[schoolName] = schoolOut;
        }

        // Save to disk via C++
        window.callCpp('SaveSpellTree', JSON.stringify(output));

        // Load into the spell tree viewer so it displays immediately
        if (typeof loadTreeData === 'function') {
            loadTreeData(output);
        }

        var schoolCount = Object.keys(output.schools).length;
        TreeSettings.setStatusText('Tree applied (' + schoolCount + ' schools)', '#22c55e');

        // Switch to the Spell Tree tab after a brief delay
        if (typeof switchTab === 'function') {
            setTimeout(function() {
                switchTab('spellTree');
            }, 300);
        }
    },

    /**
     * Return the current layout position map (formId → {x, y}) for preview rendering.
     * Returns null if no tree has been built yet.
     */
    getPositionMap: function() {
        return this._builtPlacements ? this._builtPlacements.posMap || null : null;
    },

    clearTree: function() {
        this._treeData = null;
        this._builtPlacements = null;
        this._builtLayoutKey = '';
        this._cache = null;
        TreeSettings.setTreeBuilt(false);
        this._markDirty();
    },

    // =========================================================================
    // RENDER
    // =========================================================================

    render: function(ctx, w, h, baseData) {
        if (!baseData) {
            ctx.font = '12px sans-serif';
            ctx.fillStyle = 'rgba(184, 168, 120, 0.4)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Scan spells to see preview', w / 2, h / 2);
            return;
        }

        // 1. Render base grid + root nodes underneath
        baseData.renderGrid(ctx, w, h);

        // 2. Compute or retrieve cached trunk data
        var computed = this._getOrCompute(baseData, w, h);
        if (!computed) return;

        var cx = w / 2;
        var cy = h / 2;
        var opacity = this.settings.ghostOpacity / 100;

        // 3. Render trunk corridors (always visible)
        if (typeof TreeRenderer !== 'undefined' && computed.corridors) {
            TreeRenderer.renderCorridors(ctx, cx, cy, computed.corridors, opacity);
        }

        if (this._treeData) {
            // 4a. Tree is built — show edges + positioned nodes (CACHED)
            var layoutKey = this._buildCacheKey(baseData) + '|built|' + this.settings.branchSpread;
            if (!this._builtPlacements || this._builtLayoutKey !== layoutKey) {
                this._builtPlacements = this._computeBuiltLayout(baseData);
                this._builtLayoutKey = layoutKey;
                // Update status with actual placement counts
                if (this._builtPlacements) {
                    TreeSettings.setTreeBuilt(true,
                        this._builtPlacements.totalPlaced,
                        this._builtPlacements.totalPool);
                }
            }
            var layout = this._builtPlacements;
            if (layout && typeof TreeRenderer !== 'undefined') {
                TreeRenderer.renderEdges(ctx, cx, cy, layout.edges, opacity);
                TreeRenderer.renderNodes(
                    ctx, cx, cy, layout.nodes,
                    opacity, this.settings.nodeRadius
                );
            }
        } else {
            // 4b. No tree yet — show ghost node preview (trunk fill)
            if (typeof TreeRenderer !== 'undefined' && computed.placements) {
                TreeRenderer.renderGhostNodes(
                    ctx, cx, cy, computed.placements,
                    opacity, this.settings.nodeRadius
                );
            }
        }
    },

    // =========================================================================
    // CACHE
    // =========================================================================

    _buildCacheKey: function(baseData) {
        var s = this.settings;
        var parts = [
            baseData.mode,
            JSON.stringify(baseData.grid),
            baseData.rootNodes.length,
            s.trunkThickness,
            s.branchSpread,
            s.rootSpread,
            s.pctBranches,
            s.pctTrunk,
            s.pctRoot
        ];
        var sd = baseData.schoolData;
        if (sd) {
            var keys = [];
            for (var k in sd) {
                if (sd.hasOwnProperty(k)) keys.push(k + ':' + sd[k]);
            }
            keys.sort();
            parts.push(keys.join(','));
        }
        for (var ri = 0; ri < baseData.rootNodes.length; ri++) {
            var rn = baseData.rootNodes[ri];
            parts.push(Math.round(rn.x) + ',' + Math.round(rn.y));
        }
        return parts.join('|');
    },

    _getOrCompute: function(baseData, w, h) {
        var key = this._buildCacheKey(baseData);
        if (this._cache && this._lastCacheKey === key) {
            return this._cache;
        }

        if (typeof TreeTrunk === 'undefined') return null;

        var mode = baseData.mode;
        var schools = baseData.schools;
        var rootNodes = baseData.rootNodes;
        var grid = baseData.grid;
        var gridPoints = baseData.gridPoints || [];
        var schoolData = baseData.schoolData;
        if (!grid || !schools || schools.length === 0) return null;

        // 1. Compute trunk corridors
        var corridors = TreeTrunk.computeCorridors(
            mode, schools, rootNodes, grid, this.settings.trunkThickness
        );

        // 2. For each corridor, filter actual grid points and fill trunk
        var allPlacements = [];
        for (var ci = 0; ci < corridors.length; ci++) {
            var corridor = corridors[ci];
            var schoolName = corridor.school;
            var totalSpells = schoolData[schoolName] || 0;
            var trunkCount = Math.round(totalSpells * this.settings.pctTrunk / 100);

            if (trunkCount === 0) continue;

            // Filter REAL grid points that fall inside the corridor
            var ghGdx = corridor.growDirX || 0;
            var ghGdy = corridor.growDirY || 0;
            if (ghGdx === 0 && ghGdy === 0) {
                var ghbx = (corridor.x1 + corridor.x4) / 2;
                var ghby = (corridor.y1 + corridor.y4) / 2;
                var ghfx = (corridor.x2 + corridor.x3) / 2;
                var ghfy = (corridor.y2 + corridor.y3) / 2;
                var ghfl = Math.sqrt((ghfx - ghbx) * (ghfx - ghbx) + (ghfy - ghby) * (ghfy - ghby));
                if (ghfl > 0) { ghGdx = (ghfx - ghbx) / ghfl; ghGdy = (ghfy - ghby) / ghfl; }
            }
            var ghPerpX = -ghGdy;
            var ghPerpY = ghGdx;
            var ghDx14 = corridor.x4 - corridor.x1;
            var ghDy14 = corridor.y4 - corridor.y1;
            var ghHalfW = Math.sqrt(ghDx14 * ghDx14 + ghDy14 * ghDy14) / 2;
            var ghMidX = (corridor.x1 + corridor.x4) / 2;
            var ghMidY = (corridor.y1 + corridor.y4) / 2;
            var ghTierSp = corridor.tierSpacing || 20;
            var ghMinDist = ghTierSp * 0.5;

            var captured = [];
            for (var ghgi = 0; ghgi < gridPoints.length; ghgi++) {
                var ghgp = gridPoints[ghgi];
                if (ghgp.school !== schoolName) continue;
                var ghRelX = ghgp.x - ghMidX;
                var ghRelY = ghgp.y - ghMidY;
                var ghAlong = ghRelX * ghGdx + ghRelY * ghGdy;
                var ghAcross = ghRelX * ghPerpX + ghRelY * ghPerpY;
                if (ghAlong >= ghMinDist && Math.abs(ghAcross) <= ghHalfW) {
                    captured.push({
                        x: ghgp.x, y: ghgp.y,
                        color: corridor.color,
                        dist: ghAlong
                    });
                }
            }
            captured.sort(function(a, b) { return a.dist - b.dist; });

            // Fill layer by layer (closest to root first)
            var placements = TreeTrunk.fillLayerByLayer(captured, trunkCount);
            for (var pi = 0; pi < placements.length; pi++) {
                allPlacements.push(placements[pi]);
            }
        }

        // 3. Update allocation display with actual spell counts
        if (typeof TreeSettings !== 'undefined' && TreeSettings._updateAllocationDisplay) {
            // Sum total across all schools for display
            var totalAll = 0;
            for (var sk in schoolData) {
                if (schoolData.hasOwnProperty(sk)) totalAll += schoolData[sk];
            }
            TreeSettings._updateAllocationDisplay(
                this.settings.pctBranches,
                this.settings.pctTrunk,
                this.settings.pctRoot,
                totalAll
            );
        }

        var result = {
            corridors: corridors,
            placements: allPlacements
        };

        this._cache = result;
        this._lastCacheKey = key;
        return result;
    },

    // =========================================================================
    // BUILT TREE LAYOUT
    // =========================================================================

    /**
     * Two-phase grid layout: TRUNK then BRANCHES.
     *
     * Phase 1 (Trunk): Generate a rectangular grid inside the trunk corridor.
     *   DFS through the tree placing nodes ONLY on corridor grid points,
     *   growing along the corridor's growth direction.
     *
     * Phase 2 (Branches): Collect school grid points OUTSIDE the corridor.
     *   Bridge the trunk tip to the sector grid. DFS-place remaining nodes
     *   on sector grid points, fanning outward from the trunk tip.
     *
     * @param {Object} baseData - from TreePreview.getOutput()
     * @returns {Object|null} { edges, nodes, posMap }
     */
    _computeBuiltLayout: function(baseData) {
        var treeData = this._treeData;
        if (!treeData || !treeData.schools) return null;
        if (!this._cache || !this._cache.corridors) return null;

        var gridPoints = baseData.gridPoints || [];
        var rootNodes = baseData.rootNodes || [];
        var corridors = this._cache.corridors;
        var grid = baseData.grid || {};
        var tierSp = grid.tierSpacing || 40;

        var allEdges = [];
        var allNodes = [];
        var allPosMap = {};
        var totalPlaced = 0;
        var totalPool = 0;

        for (var ci = 0; ci < corridors.length; ci++) {
            var corridor = corridors[ci];
            var schoolName = corridor.school;
            var schoolTree = treeData.schools[schoolName];
            if (!schoolTree) continue;

            var allTreeNodes = schoolTree.nodes || [];
            if (allTreeNodes.length === 0) continue;

            var schoolColor = corridor.color || '#888888';

            // Root positions on ring (all roots for this school)
            var schoolRootPositions = [];
            for (var r = 0; r < rootNodes.length; r++) {
                if (rootNodes[r].school === schoolName) {
                    schoolRootPositions.push({
                        x: rootNodes[r].x, y: rootNodes[r].y,
                        dir: rootNodes[r].dir || 0
                    });
                }
            }
            if (schoolRootPositions.length === 0) continue;
            var rootPos = schoolRootPositions[0];
            var rootDir = schoolRootPositions[0].dir;
            var numRoots = schoolRootPositions.length;

            // ==========================================================
            // A) CORRIDOR GEOMETRY
            // ==========================================================
            var gdx = corridor.growDirX || 0;
            var gdy = corridor.growDirY || 0;
            if (gdx === 0 && gdy === 0) {
                // Flat mode: derive from corridor shape
                var cbx = (corridor.x1 + corridor.x4) / 2;
                var cby = (corridor.y1 + corridor.y4) / 2;
                var cfx = (corridor.x2 + corridor.x3) / 2;
                var cfy = (corridor.y2 + corridor.y3) / 2;
                var cfl = Math.sqrt((cfx - cbx) * (cfx - cbx) + (cfy - cby) * (cfy - cby));
                if (cfl > 0) { gdx = (cfx - cbx) / cfl; gdy = (cfy - cby) / cfl; }
                else { gdx = Math.cos(rootDir); gdy = Math.sin(rootDir); }
            }
            var perpX = -gdy;
            var perpY = gdx;

            // Corridor dimensions
            var dx14 = corridor.x4 - corridor.x1;
            var dy14 = corridor.y4 - corridor.y1;
            var halfWidth = Math.sqrt(dx14 * dx14 + dy14 * dy14) / 2;
            var baseMidX = (corridor.x1 + corridor.x4) / 2;
            var baseMidY = (corridor.y1 + corridor.y4) / 2;

            // ==========================================================
            // B+C) BUILD UNIFIED GRID from REAL grid points
            //       Corridor points (inCorridor=true) + sector points
            // ==========================================================
            var minDist = tierSp * 0.5;

            var schoolPts = [];   // unified grid: trunk + sector
            var trunkCount = 0;   // how many corridor grid points
            var sectorStart = 0;  // index where sector points begin
            var globalToLocal = {};
            var trunkMaxAlong = 0; // track furthest corridor point for bridge

            // Pass 1: add corridor points (real grid points inside corridor)
            for (var gpi = 0; gpi < gridPoints.length; gpi++) {
                var gp = gridPoints[gpi];
                if (gp.school !== schoolName) continue;

                var relGx = gp.x - baseMidX;
                var relGy = gp.y - baseMidY;
                var projAlong = relGx * gdx + relGy * gdy;
                var projAcross = relGx * perpX + relGy * perpY;

                if (projAlong >= minDist && Math.abs(projAcross) <= halfWidth) {
                    var tLocalIdx = schoolPts.length;
                    if (gp._ptIdx !== undefined) {
                        globalToLocal[gp._ptIdx] = tLocalIdx;
                    }
                    schoolPts.push({
                        x: gp.x, y: gp.y,
                        used: false,
                        neighbors: [],
                        _globalNeighbors: gp._neighbors || [],
                        inCorridor: true,
                        _alongDist: projAlong
                    });
                    trunkCount++;
                    if (projAlong > trunkMaxAlong) trunkMaxAlong = projAlong;
                }
            }

            // Pass 1b: if corridor has fewer grid points than trunkTarget,
            // generate synthetic corridor points so the trunk can grow taller.
            // Points are placed at regular intervals along the growth direction.
            var trunkTargetEst = Math.round(allTreeNodes.length * this.settings.pctTrunk / 100);
            if (trunkCount < trunkTargetEst) {
                var corridorWidth = halfWidth * 2;
                var cols = Math.max(1, Math.round(corridorWidth / tierSp));
                if (cols < 2 && halfWidth > tierSp * 0.3) cols = 2;
                var startAlong = trunkMaxAlong > 0 ? trunkMaxAlong + tierSp : minDist + tierSp;
                var needed = trunkTargetEst - trunkCount;
                var neededRows = Math.ceil(needed / cols);
                var along = startAlong;
                for (var sr = 0; sr < neededRows && trunkCount < trunkTargetEst; sr++) {
                    for (var sc = 0; sc < cols && trunkCount < trunkTargetEst; sc++) {
                        var across;
                        if (cols === 1) { across = 0; }
                        else { across = -halfWidth + corridorWidth * (sc + 0.5) / cols; }
                        var spx = baseMidX + gdx * along + perpX * across;
                        var spy = baseMidY + gdy * along + perpY * across;
                        schoolPts.push({
                            x: spx, y: spy,
                            used: false,
                            neighbors: [],
                            _globalNeighbors: [],
                            inCorridor: true,
                            _alongDist: along,
                            _synthetic: true
                        });
                        trunkCount++;
                    }
                    along += tierSp;
                }
                if (along - tierSp > trunkMaxAlong) trunkMaxAlong = along - tierSp;
            }

            sectorStart = schoolPts.length;

            // Pass 2: add sector points (real grid points OUTSIDE corridor)
            for (var gpi2 = 0; gpi2 < gridPoints.length; gpi2++) {
                var gp2 = gridPoints[gpi2];
                if (gp2.school !== schoolName) continue;

                var relGx2 = gp2.x - baseMidX;
                var relGy2 = gp2.y - baseMidY;
                var projAlong2 = relGx2 * gdx + relGy2 * gdy;
                var projAcross2 = relGx2 * perpX + relGy2 * perpY;

                // Outside corridor
                if (!(projAlong2 >= minDist && Math.abs(projAcross2) <= halfWidth)) {
                    var sLocalIdx = schoolPts.length;
                    if (gp2._ptIdx !== undefined) {
                        globalToLocal[gp2._ptIdx] = sLocalIdx;
                    }
                    schoolPts.push({
                        x: gp2.x, y: gp2.y,
                        used: false,
                        neighbors: [],
                        _globalNeighbors: gp2._neighbors || [],
                        inCorridor: false
                    });
                }
            }

            // Resolve global neighbor indices to local for ALL points
            for (var rni = 0; rni < schoolPts.length; rni++) {
                var gnbs = schoolPts[rni]._globalNeighbors;
                if (!gnbs) continue;
                for (var gnj = 0; gnj < gnbs.length; gnj++) {
                    var localNb = globalToLocal[gnbs[gnj]];
                    if (localNb !== undefined && localNb !== rni) {
                        schoolPts[rni].neighbors.push(localNb);
                    }
                }
                delete schoolPts[rni]._globalNeighbors;
            }

            // Corridor-local neighbor enhancement: in thin corridors,
            // global KNN neighbors are mostly outside the corridor,
            // leaving corridor points disconnected. Add distance-based
            // neighbors within corridor to ensure traversability.
            var corridorNbrRadSq = tierSp * tierSp * 2.25; // 1.5 * tierSp
            for (var cnA = 0; cnA < trunkCount; cnA++) {
                for (var cnB = cnA + 1; cnB < trunkCount; cnB++) {
                    var cndx = schoolPts[cnB].x - schoolPts[cnA].x;
                    var cndy = schoolPts[cnB].y - schoolPts[cnA].y;
                    if (cndx * cndx + cndy * cndy <= corridorNbrRadSq) {
                        if (schoolPts[cnA].neighbors.indexOf(cnB) < 0) {
                            schoolPts[cnA].neighbors.push(cnB);
                        }
                        if (schoolPts[cnB].neighbors.indexOf(cnA) < 0) {
                            schoolPts[cnB].neighbors.push(cnA);
                        }
                    }
                }
            }

            // Bridge isolated points (no neighbors after resolution)
            for (var iso = 0; iso < schoolPts.length; iso++) {
                if (schoolPts[iso].neighbors.length > 0) continue;
                var isoBest = Infinity;
                var isoBestIdx = -1;
                // Search same zone first (corridor or sector)
                var isoInC = schoolPts[iso].inCorridor;
                for (var iso2 = 0; iso2 < schoolPts.length; iso2++) {
                    if (iso2 === iso) continue;
                    if (schoolPts[iso2].inCorridor !== isoInC) continue;
                    var isodx = schoolPts[iso2].x - schoolPts[iso].x;
                    var isody = schoolPts[iso2].y - schoolPts[iso].y;
                    var isod = isodx * isodx + isody * isody;
                    if (isod < isoBest) { isoBest = isod; isoBestIdx = iso2; }
                }
                // Fallback: any point
                if (isoBestIdx < 0) {
                    for (var iso3 = 0; iso3 < schoolPts.length; iso3++) {
                        if (iso3 === iso) continue;
                        var isodx3 = schoolPts[iso3].x - schoolPts[iso].x;
                        var isody3 = schoolPts[iso3].y - schoolPts[iso].y;
                        var isod3 = isodx3 * isodx3 + isody3 * isody3;
                        if (isod3 < isoBest) { isoBest = isod3; isoBestIdx = iso3; }
                    }
                }
                if (isoBestIdx >= 0) {
                    schoolPts[iso].neighbors.push(isoBestIdx);
                    schoolPts[isoBestIdx].neighbors.push(iso);
                }
            }

            // ==========================================================
            // D) BRIDGE: Connect corridor edges to nearby sector points
            // ==========================================================
            // Bridge the EDGE columns of the corridor (sides + tip) to
            // sector points, so branches can exit the corridor at the tip.
            // Tip = top 20% of corridor depth (by _alongDist)
            var bridgeRadiusSq = tierSp * tierSp * 9; // 3x tierSpacing
            var tipThreshold = trunkMaxAlong * 0.80;
            for (var bti = 0; bti < trunkCount; bti++) {
                var btAlong = schoolPts[bti]._alongDist || 0;
                if (btAlong < tipThreshold) continue; // only tip corridor points

                for (var bsi = sectorStart; bsi < schoolPts.length; bsi++) {
                    var bsdx = schoolPts[bsi].x - schoolPts[bti].x;
                    var bsdy = schoolPts[bsi].y - schoolPts[bti].y;
                    if (bsdx * bsdx + bsdy * bsdy <= bridgeRadiusSq) {
                        if (schoolPts[bti].neighbors.indexOf(bsi) < 0) {
                            schoolPts[bti].neighbors.push(bsi);
                        }
                        if (schoolPts[bsi].neighbors.indexOf(bti) < 0) {
                            schoolPts[bsi].neighbors.push(bti);
                        }
                    }
                }
            }

            // (Root growth uses free placement — no corridor grid needed)

            // ==========================================================
            // E) ADD ALL ROOT POSITIONS, connect to first trunk rows
            // ==========================================================
            var rootLocalIdxs = [];
            for (var rpi = 0; rpi < numRoots; rpi++) {
                var rpPos = schoolRootPositions[rpi];
                var rpIdx = schoolPts.length;
                schoolPts.push({
                    x: rpPos.x, y: rpPos.y,
                    used: false,
                    neighbors: [],
                    inCorridor: true
                });
                // Connect to nearby trunk grid points
                for (var rpci = 0; rpci < trunkCount; rpci++) {
                    var rpdx = schoolPts[rpci].x - rpPos.x;
                    var rpdy = schoolPts[rpci].y - rpPos.y;
                    if (rpdx * rpdx + rpdy * rpdy <= tierSp * tierSp * 4) {
                        schoolPts[rpIdx].neighbors.push(rpci);
                        schoolPts[rpci].neighbors.push(rpIdx);
                    }
                }
                // (Root positions are NOT connected to each other —
                //  they connect independently to nearby trunk grid points)
                // Fallback: connect to nearest trunk point
                if (schoolPts[rpIdx].neighbors.length === 0 && trunkCount > 0) {
                    var rpBest = Infinity;
                    var rpBestI = 0;
                    for (var rpbi = 0; rpbi < trunkCount; rpbi++) {
                        var rpbdx = schoolPts[rpbi].x - rpPos.x;
                        var rpbdy = schoolPts[rpbi].y - rpPos.y;
                        var rpbd = rpbdx * rpbdx + rpbdy * rpbdy;
                        if (rpbd < rpBest) { rpBest = rpbd; rpBestI = rpbi; }
                    }
                    schoolPts[rpIdx].neighbors.push(rpBestI);
                    schoolPts[rpBestI].neighbors.push(rpIdx);
                }
                rootLocalIdxs.push(rpIdx);
            }
            var rootLocalIdx = rootLocalIdxs[0];

            var totalPts = schoolPts.length;
            var totalNeighbors = 0;
            for (var tni = 0; tni < totalPts; tni++) {
                totalNeighbors += schoolPts[tni].neighbors.length;
            }
            console.log('[TreeGrowthTree] ' + schoolName + ': ' +
                trunkCount + ' trunk pts + ' +
                (totalPts - trunkCount - 1) + ' sector pts (avg ' +
                Math.round(totalNeighbors / totalPts * 10) / 10 +
                ' nbrs) for ' + allTreeNodes.length + ' nodes');

            // ==========================================================
            // F) BUILD NODE LOOKUP + SUBTREE SIZES
            // ==========================================================
            var nodeLookup = {};
            for (var ni = 0; ni < allTreeNodes.length; ni++) {
                nodeLookup[allTreeNodes[ni].formId] = allTreeNodes[ni];
            }

            var rootSpellId = null;
            for (var rfi = 0; rfi < allTreeNodes.length; rfi++) {
                if (!allTreeNodes[rfi].prerequisites || allTreeNodes[rfi].prerequisites.length === 0) {
                    rootSpellId = allTreeNodes[rfi].formId;
                    break;
                }
            }
            if (!rootSpellId) rootSpellId = allTreeNodes[0].formId;

            var subtreeSize = {};
            var computeSubSize = function(id) {
                if (subtreeSize[id] !== undefined) return subtreeSize[id];
                var nd = nodeLookup[id];
                if (!nd || !nd.children || nd.children.length === 0) {
                    subtreeSize[id] = 1;
                    return 1;
                }
                var sum = 1;
                for (var ssi = 0; ssi < nd.children.length; ssi++) {
                    sum += computeSubSize(nd.children[ssi]);
                }
                subtreeSize[id] = sum;
                return sum;
            };
            computeSubSize(rootSpellId);

            // Split root children among root positions (round-robin)
            var rootChildSplit = null;
            var childToRootIdx = {};
            if (numRoots > 1 && nodeLookup[rootSpellId]) {
                var origRootChildren = nodeLookup[rootSpellId].children || [];
                rootChildSplit = [];
                for (var rcbi = 0; rcbi < numRoots; rcbi++) rootChildSplit.push([]);
                for (var rcri = 0; rcri < origRootChildren.length; rcri++) {
                    var assignedRoot = rcri % numRoots;
                    rootChildSplit[assignedRoot].push(origRootChildren[rcri]);
                    childToRootIdx[origRootChildren[rcri]] = assignedRoot;
                }
                console.log('[TreeGrowthTree] ' + schoolName + ': split ' +
                    origRootChildren.length + ' root children among ' + numRoots + ' roots');
            }

            // ==========================================================
            // G) PLACE ROOT ON ROOT GRID POINT
            // ==========================================================
            var posMap = {};
            var gridIdxMap = {};

            schoolPts[rootLocalIdx].used = true;
            posMap[rootSpellId] = { x: rootPos.x, y: rootPos.y };
            gridIdxMap[rootSpellId] = rootLocalIdx;

            allNodes.push({
                x: rootPos.x, y: rootPos.y,
                color: schoolColor,
                skillLevel: nodeLookup[rootSpellId] ? nodeLookup[rootSpellId].skillLevel || '' : ''
            });

            // ==========================================================
            // H) PHASE 1: TRUNK — DFS on corridor-only grid points
            //    Nodes placed only on inCorridor points.
            //    Growth strongly biased along corridor direction.
            //    When no corridor neighbors available, node is DEFERRED.
            // ==========================================================
            var dfsStack = [rootSpellId];
            var deferredNodes = []; // children that couldn't fit in corridor
            var placedCount = 1;
            var trunkPlaced = 0;
            var trunkTarget = Math.round(allTreeNodes.length * this.settings.pctTrunk / 100);
            var branchTarget = Math.round(allTreeNodes.length * this.settings.pctBranches / 100);
            var rootGrowthTarget = Math.round(allTreeNodes.length * this.settings.pctRoot / 100);
            var maxPlaceable = trunkTarget + branchTarget + rootGrowthTarget + 1; // +1 for root node itself
            var branchSpread = this.settings.branchSpread || 2.5;
            var placeStats = { trunkHop1: 0, trunkMulti: 0, trunkRetry: 0, branchHop1: 0, branchMulti: 0, globalFB: 0 };

            // Per-node growth direction map for branch spreading
            var dirMap = {};
            dirMap[rootSpellId] = { dx: gdx, dy: gdy };

            // Helper: score a candidate grid point for placement
            var scoreCandidate = function(ptIdx, parentPosX, parentPosY, gDx, gDy, sibDirs) {
                var cdx = schoolPts[ptIdx].x - parentPosX;
                var cdy = schoolPts[ptIdx].y - parentPosY;
                var cLen = Math.sqrt(cdx * cdx + cdy * cdy);
                if (cLen > 0) { cdx /= cLen; cdy /= cLen; }
                var outward = cdx * gDx + cdy * gDy;
                var separation = 0;
                if (sibDirs.length > 0) {
                    var minSep = 2;
                    for (var sd = 0; sd < sibDirs.length; sd++) {
                        var dot = cdx * sibDirs[sd].dx + cdy * sibDirs[sd].dy;
                        if (dot < minSep) minSep = dot;
                    }
                    separation = -minSep;
                }
                if (sibDirs.length === 0) {
                    return outward;
                }
                return separation * 2.0 + outward * 0.3;
            };

            // Helper: record sibling direction
            var recordSibDir = function(ptIdx, parentPosX, parentPosY, sibDirs) {
                var sdx = schoolPts[ptIdx].x - parentPosX;
                var sdy = schoolPts[ptIdx].y - parentPosY;
                var sLen = Math.sqrt(sdx * sdx + sdy * sdy);
                if (sLen > 0) {
                    sibDirs.push({ dx: sdx / sLen, dy: sdy / sLen });
                }
            };

            // Phase 1: TRUNK — Level-by-level BFS filling the corridor grid.
            // All roots take turns (random round-robin within each level).
            // Children that can't fit in corridor are deferred to branches.
            var trunkBfsQueue = [rootSpellId];
            while (trunkBfsQueue.length > 0) {
                // Shuffle current level for random round-robin
                for (var shI = trunkBfsQueue.length - 1; shI > 0; shI--) {
                    var shJ = Math.floor(Math.random() * (shI + 1));
                    var shT = trunkBfsQueue[shI];
                    trunkBfsQueue[shI] = trunkBfsQueue[shJ];
                    trunkBfsQueue[shJ] = shT;
                }

                var nextLevel = [];
                for (var tqi = 0; tqi < trunkBfsQueue.length; tqi++) {
                    var tCurId = trunkBfsQueue[tqi];
                    var tCurNode = nodeLookup[tCurId];
                    if (!tCurNode || !tCurNode.children || tCurNode.children.length === 0) continue;

                    var tParentPos = posMap[tCurId];
                    var tParentGIdx = gridIdxMap[tCurId];
                    if (!tParentPos) continue;

                    var tChildren = tCurNode.children.slice();
                    tChildren.sort(function(a, b) {
                        return (subtreeSize[a] || 1) - (subtreeSize[b] || 1);
                    });

                    var tSibDirs = [];

                    for (var tci = 0; tci < tChildren.length; tci++) {
                        var tChildId = tChildren[tci];
                        if (posMap[tChildId] || !nodeLookup[tChildId]) continue;

                        // Trunk target reached — defer remaining children to branches
                        if (trunkPlaced >= trunkTarget) {
                            deferredNodes.push({ childId: tChildId, parentId: tCurId });
                            continue;
                        }

                        // Determine anchor: root's children use their assigned root position
                        var childAnchorPos = tParentPos;
                        var childAnchorGIdx = tParentGIdx;
                        if (tCurId === rootSpellId && childToRootIdx[tChildId] !== undefined) {
                            var aRIdx = childToRootIdx[tChildId];
                            childAnchorPos = schoolRootPositions[aRIdx];
                            childAnchorGIdx = rootLocalIdxs[aRIdx];
                        }

                        var bestIdx = -1;
                        var bestScore = -Infinity;

                        // 1-hop: corridor neighbors only
                        if (childAnchorGIdx !== undefined && childAnchorGIdx >= 0) {
                            var tNbrs = schoolPts[childAnchorGIdx].neighbors;
                            for (var tnbi = 0; tnbi < tNbrs.length; tnbi++) {
                                var tnIdx = tNbrs[tnbi];
                                if (schoolPts[tnIdx].used || !schoolPts[tnIdx].inCorridor) continue;
                                var tsc = scoreCandidate(tnIdx, childAnchorPos.x, childAnchorPos.y, gdx, gdy, tSibDirs);
                                if (tsc > bestScore) { bestScore = tsc; bestIdx = tnIdx; }
                            }
                        }

                        if (bestIdx >= 0) {
                            placeStats.trunkHop1++;
                        }

                        // Multi-hop on corridor (up to 4 hops)
                        if (bestIdx < 0 && childAnchorGIdx !== undefined && childAnchorGIdx >= 0) {
                            var tVisited = {};
                            tVisited[childAnchorGIdx] = true;
                            var tSearchQ = [{ idx: childAnchorGIdx, hops: 0 }];
                            var tCands = [];
                            var tSearched = 0;
                            while (tSearchQ.length > 0 && tSearched < 200) {
                                var tsq = tSearchQ.shift();
                                tSearched++;
                                var tCurN = schoolPts[tsq.idx].neighbors;
                                for (var tsi = 0; tsi < tCurN.length; tsi++) {
                                    var tsIdx = tCurN[tsi];
                                    if (tVisited[tsIdx]) continue;
                                    tVisited[tsIdx] = true;
                                    if (!schoolPts[tsIdx].inCorridor) continue;
                                    if (!schoolPts[tsIdx].used) {
                                        tCands.push({ idx: tsIdx, hops: tsq.hops + 1 });
                                        if (tCands.length >= 8) { tSearchQ = []; break; }
                                    }
                                    if (tsq.hops < 4) {
                                        tSearchQ.push({ idx: tsIdx, hops: tsq.hops + 1 });
                                    }
                                }
                            }
                            if (tCands.length > 0) {
                                var thBest = -Infinity;
                                for (var thci = 0; thci < tCands.length; thci++) {
                                    var thScore = scoreCandidate(tCands[thci].idx, childAnchorPos.x, childAnchorPos.y, gdx, gdy, tSibDirs)
                                        - tCands[thci].hops * 0.5;
                                    if (thScore > thBest) {
                                        thBest = thScore;
                                        bestIdx = tCands[thci].idx;
                                    }
                                }
                                if (bestIdx >= 0) placeStats.trunkMulti++;
                            }
                        }

                        // Direct corridor scan
                        if (bestIdx < 0 && trunkPlaced < trunkTarget) {
                            var dcBestDist = Infinity;
                            for (var dci = 0; dci < trunkCount; dci++) {
                                if (schoolPts[dci].used) continue;
                                var dcdx = schoolPts[dci].x - childAnchorPos.x;
                                var dcdy = schoolPts[dci].y - childAnchorPos.y;
                                var dcAlong = dcdx * gdx + dcdy * gdy;
                                if (dcAlong < 0) continue;
                                var dcDist = dcdx * dcdx + dcdy * dcdy;
                                if (dcDist < dcBestDist) {
                                    dcBestDist = dcDist;
                                    bestIdx = dci;
                                }
                            }
                            if (bestIdx >= 0) placeStats.trunkMulti++;
                        }

                        if (bestIdx < 0) {
                            deferredNodes.push({ childId: tChildId, parentId: tCurId });
                            continue;
                        }

                        recordSibDir(bestIdx, childAnchorPos.x, childAnchorPos.y, tSibDirs);

                        schoolPts[bestIdx].used = true;
                        posMap[tChildId] = { x: schoolPts[bestIdx].x, y: schoolPts[bestIdx].y };
                        gridIdxMap[tChildId] = bestIdx;
                        trunkPlaced++;
                        placedCount++;

                        // Edge: from anchor position (assigned root for root children, parent for others)
                        var edgeFromPos = childAnchorPos;
                        if (tCurId !== rootSpellId) edgeFromPos = tParentPos;

                        allNodes.push({
                            x: schoolPts[bestIdx].x, y: schoolPts[bestIdx].y,
                            color: schoolColor,
                            skillLevel: nodeLookup[tChildId].skillLevel || ''
                        });
                        allEdges.push({
                            x1: edgeFromPos.x, y1: edgeFromPos.y,
                            x2: schoolPts[bestIdx].x, y2: schoolPts[bestIdx].y,
                            color: schoolColor
                        });

                        dirMap[tChildId] = { dx: gdx, dy: gdy };
                        nextLevel.push(tChildId);
                    }
                }
                trunkBfsQueue = nextLevel;
            }
            // Keep dfsStack for retry phase compatibility
            var dfsStack = [];

            // ==========================================================
            // H2) TRUNK RETRY — fill corridor to at least 90% of target
            //     Deferred nodes get a second chance: search from ANY
            //     placed trunk node (nearest to the deferred node's parent),
            //     not just the immediate tree-parent's grid point.
            // ==========================================================
            var corridorFree = 0;
            for (var cfk = 0; cfk < trunkCount; cfk++) {
                if (!schoolPts[cfk].used) corridorFree++;
            }
            var trunkMinTarget = Math.floor(trunkTarget * 0.90);

            console.log('[TreeGrowthTree] ' + schoolName + ' AFTER DFS: trunkPlaced=' +
                trunkPlaced + '/' + trunkTarget + ' (min90%=' + trunkMinTarget +
                '), corridorFree=' + corridorFree + '/' + trunkCount +
                ', deferred=' + deferredNodes.length);

            if (trunkPlaced < trunkMinTarget && corridorFree > 0 && deferredNodes.length > 0) {
                // Collect all placed trunk grid indices for nearest-search
                var placedTrunkIdxs = [];
                for (var ptk in gridIdxMap) {
                    if (!gridIdxMap.hasOwnProperty(ptk)) continue;
                    var ptgi = gridIdxMap[ptk];
                    if (ptgi !== undefined && ptgi < trunkCount && schoolPts[ptgi].inCorridor) {
                        placedTrunkIdxs.push(ptgi);
                    }
                }

                var retryDeferred = [];
                for (var rdi = 0; rdi < deferredNodes.length; rdi++) {
                    if (trunkPlaced >= trunkMinTarget || corridorFree <= 0) {
                        retryDeferred.push(deferredNodes[rdi]);
                        continue;
                    }

                    var rdChild = deferredNodes[rdi];
                    var rdChildId = rdChild.childId;
                    if (posMap[rdChildId]) continue;

                    // Find nearest placed trunk node to the deferred node's parent
                    var rdParentPos = posMap[rdChild.parentId];
                    if (!rdParentPos) {
                        retryDeferred.push(rdChild);
                        continue;
                    }

                    // Search from nearest placed trunk node
                    var rdBestAnchor = -1;
                    var rdBestADist = Infinity;
                    for (var rai = 0; rai < placedTrunkIdxs.length; rai++) {
                        var raIdx = placedTrunkIdxs[rai];
                        var radx = schoolPts[raIdx].x - rdParentPos.x;
                        var rady = schoolPts[raIdx].y - rdParentPos.y;
                        var rad = radx * radx + rady * rady;
                        if (rad < rdBestADist) { rdBestADist = rad; rdBestAnchor = raIdx; }
                    }

                    if (rdBestAnchor < 0) {
                        retryDeferred.push(rdChild);
                        continue;
                    }

                    // BFS from this anchor to find free corridor point (up to 8 hops)
                    var rdVisited = {};
                    rdVisited[rdBestAnchor] = true;
                    var rdQueue = [{ idx: rdBestAnchor, hops: 0 }];
                    var rdBest = -1;
                    var rdBestScore = -Infinity;
                    var rdSearched = 0;

                    while (rdQueue.length > 0 && rdSearched < 400) {
                        var rdq = rdQueue.shift();
                        rdSearched++;
                        var rdNbrs = schoolPts[rdq.idx].neighbors;
                        for (var rdni = 0; rdni < rdNbrs.length; rdni++) {
                            var rdnIdx = rdNbrs[rdni];
                            if (rdVisited[rdnIdx]) continue;
                            rdVisited[rdnIdx] = true;
                            if (!schoolPts[rdnIdx].inCorridor) continue;
                            if (!schoolPts[rdnIdx].used) {
                                var rdsc = scoreCandidate(rdnIdx, rdParentPos.x, rdParentPos.y, gdx, gdy, [])
                                    - rdq.hops * 0.3;
                                if (rdsc > rdBestScore) { rdBestScore = rdsc; rdBest = rdnIdx; }
                            }
                            if (rdq.hops < 8) {
                                rdQueue.push({ idx: rdnIdx, hops: rdq.hops + 1 });
                            }
                        }
                    }

                    if (rdBest >= 0) {
                        schoolPts[rdBest].used = true;
                        posMap[rdChildId] = { x: schoolPts[rdBest].x, y: schoolPts[rdBest].y };
                        gridIdxMap[rdChildId] = rdBest;
                        placedTrunkIdxs.push(rdBest);
                        trunkPlaced++;
                        placedCount++;
                        corridorFree--;
                        placeStats.trunkRetry++;

                        allNodes.push({
                            x: schoolPts[rdBest].x, y: schoolPts[rdBest].y,
                            color: schoolColor,
                            skillLevel: nodeLookup[rdChildId] ? nodeLookup[rdChildId].skillLevel || '' : ''
                        });
                        allEdges.push({
                            x1: rdParentPos.x, y1: rdParentPos.y,
                            x2: schoolPts[rdBest].x, y2: schoolPts[rdBest].y,
                            color: schoolColor
                        });

                        // Push to DFS so this node's children also try corridor
                        dfsStack.push(rdChildId);
                    } else {
                        retryDeferred.push(rdChild);
                    }
                }
                deferredNodes = retryDeferred;

                // Run DFS again for newly placed retry nodes' children
                while (dfsStack.length > 0) {
                    var rCurId = dfsStack.pop();
                    var rCurNode = nodeLookup[rCurId];
                    if (!rCurNode || !rCurNode.children || rCurNode.children.length === 0) continue;
                    if (trunkPlaced >= trunkTarget || corridorFree <= 0) {
                        // Over target — defer remaining children
                        for (var rck = 0; rck < rCurNode.children.length; rck++) {
                            if (!posMap[rCurNode.children[rck]]) {
                                deferredNodes.push({ childId: rCurNode.children[rck], parentId: rCurId });
                            }
                        }
                        continue;
                    }

                    var rParentPos = posMap[rCurId];
                    var rParentGIdx = gridIdxMap[rCurId];
                    if (!rParentPos) continue;

                    var rChildren = rCurNode.children.slice();
                    rChildren.sort(function(a, b) { return (subtreeSize[a] || 1) - (subtreeSize[b] || 1); });

                    for (var rci2 = 0; rci2 < rChildren.length; rci2++) {
                        var rChildId2 = rChildren[rci2];
                        if (posMap[rChildId2] || !nodeLookup[rChildId2]) continue;

                        var rBest = -1;
                        var rBScore = -Infinity;

                        // 1-hop corridor
                        if (rParentGIdx !== undefined && rParentGIdx >= 0) {
                            var rNbrs = schoolPts[rParentGIdx].neighbors;
                            for (var rni2 = 0; rni2 < rNbrs.length; rni2++) {
                                var rnIdx2 = rNbrs[rni2];
                                if (schoolPts[rnIdx2].used || !schoolPts[rnIdx2].inCorridor) continue;
                                var rsc2 = scoreCandidate(rnIdx2, rParentPos.x, rParentPos.y, gdx, gdy, []);
                                if (rsc2 > rBScore) { rBScore = rsc2; rBest = rnIdx2; }
                            }
                        }
                        if (rBest >= 0) { placeStats.trunkRetry++; }

                        // Multi-hop corridor (up to 6)
                        if (rBest < 0 && rParentGIdx !== undefined && rParentGIdx >= 0) {
                            var rVis = {};
                            rVis[rParentGIdx] = true;
                            var rSQ = [{ idx: rParentGIdx, hops: 0 }];
                            var rCands = [];
                            var rSrch = 0;
                            while (rSQ.length > 0 && rSrch < 300) {
                                var rsq = rSQ.shift();
                                rSrch++;
                                var rCurN = schoolPts[rsq.idx].neighbors;
                                for (var rsi = 0; rsi < rCurN.length; rsi++) {
                                    var rsIdx = rCurN[rsi];
                                    if (rVis[rsIdx]) continue;
                                    rVis[rsIdx] = true;
                                    if (!schoolPts[rsIdx].inCorridor) continue;
                                    if (!schoolPts[rsIdx].used) {
                                        rCands.push({ idx: rsIdx, hops: rsq.hops + 1 });
                                        if (rCands.length >= 8) { rSQ = []; break; }
                                    }
                                    if (rsq.hops < 6) rSQ.push({ idx: rsIdx, hops: rsq.hops + 1 });
                                }
                            }
                            if (rCands.length > 0) {
                                var rhBest = -Infinity;
                                for (var rhci = 0; rhci < rCands.length; rhci++) {
                                    var rhSc = scoreCandidate(rCands[rhci].idx, rParentPos.x, rParentPos.y, gdx, gdy, [])
                                        - rCands[rhci].hops * 0.5;
                                    if (rhSc > rhBest) { rhBest = rhSc; rBest = rCands[rhci].idx; }
                                }
                                if (rBest >= 0) placeStats.trunkRetry++;
                            }
                        }

                        if (rBest < 0) {
                            deferredNodes.push({ childId: rChildId2, parentId: rCurId });
                            continue;
                        }

                        schoolPts[rBest].used = true;
                        posMap[rChildId2] = { x: schoolPts[rBest].x, y: schoolPts[rBest].y };
                        gridIdxMap[rChildId2] = rBest;
                        trunkPlaced++;
                        placedCount++;
                        corridorFree--;

                        allNodes.push({
                            x: schoolPts[rBest].x, y: schoolPts[rBest].y,
                            color: schoolColor,
                            skillLevel: nodeLookup[rChildId2].skillLevel || ''
                        });
                        allEdges.push({
                            x1: rParentPos.x, y1: rParentPos.y,
                            x2: schoolPts[rBest].x, y2: schoolPts[rBest].y,
                            color: schoolColor
                        });

                        dfsStack.push(rChildId2);
                    }
                }
            }

            console.log('[TreeGrowthTree] ' + schoolName + ' AFTER RETRY: trunkPlaced=' +
                trunkPlaced + '/' + trunkTarget +
                ', deferred=' + deferredNodes.length +
                ', trunkRetry=' + placeStats.trunkRetry);

            // ==========================================================
            // I) COLLECT TOP 10% TRUNK NODES as branch origins
            // ==========================================================
            // Sort all placed corridor nodes by growth-direction projection
            var trunkPlacedList = [];
            for (var ttk in posMap) {
                if (!posMap.hasOwnProperty(ttk)) continue;
                var ttgi = gridIdxMap[ttk];
                if (ttgi === undefined || !schoolPts[ttgi].inCorridor) continue;
                var ttProj = (posMap[ttk].x - rootPos.x) * gdx + (posMap[ttk].y - rootPos.y) * gdy;
                trunkPlacedList.push({ id: ttk, proj: ttProj, gIdx: ttgi });
            }
            trunkPlacedList.sort(function(a, b) { return b.proj - a.proj; }); // furthest first

            // Take top 10% (at least 3, at most 20) as branch origins
            var topCount = Math.max(3, Math.min(20, Math.ceil(trunkPlacedList.length * 0.10)));
            if (topCount > trunkPlacedList.length) topCount = trunkPlacedList.length;
            var branchOrigins = [];
            for (var toi = 0; toi < topCount; toi++) {
                var toEntry = trunkPlacedList[toi];
                branchOrigins.push({
                    id: toEntry.id,
                    pos: posMap[toEntry.id],
                    gIdx: toEntry.gIdx,
                    proj: toEntry.proj
                });
            }

            // Trunk tip = furthest origin
            var trunkTipPos = branchOrigins.length > 0 ? branchOrigins[0].pos : rootPos;
            var trunkTipGIdx = branchOrigins.length > 0 ? branchOrigins[0].gIdx : rootLocalIdx;
            var trunkTipProj = branchOrigins.length > 0 ? branchOrigins[0].proj : 0;

            console.log('[TreeGrowthTree] ' + schoolName + ': trunk placed ' +
                trunkPlaced + '/' + trunkTarget + ' (target), deferred ' + deferredNodes.length +
                ', retry=' + placeStats.trunkRetry +
                ', branch origins ' + branchOrigins.length +
                ', tip at (' + Math.round(trunkTipPos.x) + ',' + Math.round(trunkTipPos.y) + ')');

            // ==========================================================
            // J) PHASE 2: BRANCHES — DFS from top trunk nodes
            //    Deferred nodes distributed across branch origins.
            //    Each deferred node → nearest origin → 2-hop placement.
            // ==========================================================

            // Build a set of deferred node IDs for quick lookup
            var deferredSet = {};
            for (var di = 0; di < deferredNodes.length; di++) {
                deferredSet[deferredNodes[di].childId] = true;
            }

            // Assign each deferred node to a branch origin with a unique fan angle
            // so branches spread across a wide arc instead of just left/right
            var branchDfsStack = [];
            var originRR = 0; // round-robin counter
            var fanArc = Math.PI * 0.83; // ±75° from growth direction
            for (var bqi = 0; bqi < deferredNodes.length; bqi++) {
                var defId = deferredNodes[bqi].childId;
                // Round-robin across origins for even distribution
                var assignedOrigin = branchOrigins[originRR % branchOrigins.length];
                originRR++;
                // Fan angle: spread evenly across arc centered on growth direction
                var fanT = deferredNodes.length > 1
                    ? (bqi / (deferredNodes.length - 1)) * 2 - 1  // -1 to +1
                    : 0;
                // Store the assigned origin and fan angle for this deferred node
                deferredSet[defId] = {
                    originPos: assignedOrigin.pos,
                    originGIdx: assignedOrigin.gIdx,
                    originId: assignedOrigin.id,
                    fanAngle: fanT * (fanArc / 2)
                };
                branchDfsStack.push(defId);
            }

            // Build placed positions list for empty-space scoring
            var schoolPlaced = [];
            for (var spk in posMap) {
                if (posMap.hasOwnProperty(spk)) {
                    schoolPlaced.push(posMap[spk]);
                }
            }
            var densityRadSq = tierSp * tierSp * 4; // 2x tierSp radius

            // Shuffle deferred batch so no fan-angle side gets priority
            for (var shi = branchDfsStack.length - 1; shi > 0; shi--) {
                var shj = Math.floor(Math.random() * (shi + 1));
                var shTmp = branchDfsStack[shi];
                branchDfsStack[shi] = branchDfsStack[shj];
                branchDfsStack[shj] = shTmp;
            }

            // Process branches: BFS (shift) so all deferred nodes place
            // before any children — ensures balanced fan distribution
            var branchPlaced = 0;
            while (branchDfsStack.length > 0) {
                if (placedCount >= maxPlaceable) break;
                if (branchPlaced >= branchTarget) break; // respect branch allocation cap
                var bNodeId = branchDfsStack.shift();

                if (posMap[bNodeId]) {
                    // Already placed — process children
                    var bNode = nodeLookup[bNodeId];
                    if (bNode && bNode.children) {
                        var bSorted = bNode.children.slice();
                        bSorted.sort(function(a, b) {
                            return (subtreeSize[a] || 1) - (subtreeSize[b] || 1);
                        });
                        for (var bci = 0; bci < bSorted.length; bci++) {
                            if (!posMap[bSorted[bci]]) {
                                branchDfsStack.push(bSorted[bci]);
                            }
                        }
                    }
                    continue;
                }

                if (!nodeLookup[bNodeId]) continue;

                // Determine placement anchor.
                // DEFERRED nodes: anchor to their assigned branch origin
                // Children of already-placed branch nodes: anchor to parent
                var anchorPos, anchorGIdx, edgeParentPos;

                if (deferredSet[bNodeId] && typeof deferredSet[bNodeId] === 'object') {
                    // Deferred trunk child: anchor to assigned origin
                    anchorPos = deferredSet[bNodeId].originPos;
                    anchorGIdx = deferredSet[bNodeId].originGIdx;
                    edgeParentPos = posMap[deferredSet[bNodeId].originId] || anchorPos;
                } else {
                    // Branch subtree node: anchor to placed parent
                    anchorPos = trunkTipPos;
                    anchorGIdx = trunkTipGIdx;
                    edgeParentPos = trunkTipPos;
                    var bPrereqs = nodeLookup[bNodeId].prerequisites || [];
                    for (var bpi = 0; bpi < bPrereqs.length; bpi++) {
                        if (posMap[bPrereqs[bpi]]) {
                            anchorPos = posMap[bPrereqs[bpi]];
                            anchorGIdx = gridIdxMap[bPrereqs[bpi]];
                            edgeParentPos = anchorPos;
                            break;
                        }
                    }
                }

                // Branch growth direction: inherit from parent with perturbation
                var parentId = null;
                var bPrereqs2 = nodeLookup[bNodeId].prerequisites || [];
                for (var bpi2 = 0; bpi2 < bPrereqs2.length; bpi2++) {
                    if (posMap[bPrereqs2[bpi2]]) { parentId = bPrereqs2[bpi2]; break; }
                }
                if (!parentId && deferredSet[bNodeId] && typeof deferredSet[bNodeId] === 'object') {
                    parentId = deferredSet[bNodeId].originId;
                }
                var inheritedDir = (parentId && dirMap[parentId]) ? dirMap[parentId] : { dx: gdx, dy: gdy };

                // Spread multiplier: 1.0x = 1 hop (compact), 2.5x = 3 hops, 4.0x = 4 hops
                var minHops = Math.max(1, Math.round(branchSpread));

                var bGrowDx, bGrowDy;
                if (deferredSet[bNodeId] && typeof deferredSet[bNodeId] === 'object') {
                    // Fan direction: growth direction rotated by assigned fan angle
                    // Each deferred node gets a unique angle across the forward arc
                    var fanAngle = deferredSet[bNodeId].fanAngle || 0;
                    var growAngle = Math.atan2(gdy, gdx);
                    var targetAngle = growAngle + fanAngle;
                    bGrowDx = Math.cos(targetAngle);
                    bGrowDy = Math.sin(targetAngle);
                } else {
                    // Subsequent branch node: inherit parent direction with perturbation
                    bGrowDx = inheritedDir.dx;
                    bGrowDy = inheritedDir.dy;
                    // Random angular perturbation: ±25°
                    var pertAngle = (Math.random() - 0.5) * 0.87;
                    var cosPert = Math.cos(pertAngle);
                    var sinPert = Math.sin(pertAngle);
                    var tmpDx = bGrowDx * cosPert - bGrowDy * sinPert;
                    var tmpDy = bGrowDx * sinPert + bGrowDy * cosPert;
                    bGrowDx = tmpDx;
                    bGrowDy = tmpDy;
                }
                // Normalize
                var bDirLen = Math.sqrt(bGrowDx * bGrowDx + bGrowDy * bGrowDy);
                if (bDirLen > 0) { bGrowDx /= bDirLen; bGrowDy /= bDirLen; }

                // BFS from anchor: search up to minHops*2 hops, prefer candidates
                // at >= minHops distance to create gaps between branch nodes
                var bestIdx = -1;
                var bestScore = -Infinity;
                var maxSearchHops = Math.max(minHops * 2, 6);

                if (anchorGIdx !== undefined && anchorGIdx >= 0) {
                    var bVisited = {};
                    bVisited[anchorGIdx] = true;
                    var bSearchQ = [{ idx: anchorGIdx, hops: 0 }];
                    var bCandidates = [];
                    var bSearched = 0;
                    while (bSearchQ.length > 0 && bSearched < 200) {
                        var bsq = bSearchQ.shift();
                        bSearched++;
                        var bCurN = schoolPts[bsq.idx].neighbors;
                        for (var bsi = 0; bsi < bCurN.length; bsi++) {
                            var bsIdx = bCurN[bsi];
                            if (bVisited[bsIdx]) continue;
                            bVisited[bsIdx] = true;
                            if (!schoolPts[bsIdx].used) {
                                bCandidates.push({ idx: bsIdx, hops: bsq.hops + 1 });
                            }
                            if (bsq.hops < maxSearchHops) {
                                bSearchQ.push({ idx: bsIdx, hops: bsq.hops + 1 });
                            }
                        }
                    }
                    if (bCandidates.length > 0) {
                        // Score candidates: prefer those at minHops distance in growth direction
                        for (var bhci = 0; bhci < bCandidates.length; bhci++) {
                            var bhIdx = bCandidates[bhci].idx;
                            var bhHops = bCandidates[bhci].hops;
                            var bhScore = scoreCandidate(bhIdx, anchorPos.x, anchorPos.y, bGrowDx, bGrowDy, []);
                            // Prefer sector points over corridor leftovers
                            if (!schoolPts[bhIdx].inCorridor) bhScore += 0.3;
                            // Penalize backward growth (behind trunk tip)
                            var bhProj = (schoolPts[bhIdx].x - rootPos.x) * gdx + (schoolPts[bhIdx].y - rootPos.y) * gdy;
                            if (bhProj < trunkTipProj - tierSp) bhScore -= 3.0;
                            // Empty space scoring: penalize candidates near existing nodes
                            var density = 0;
                            for (var dpi = 0; dpi < schoolPlaced.length; dpi++) {
                                var dpdx = schoolPts[bhIdx].x - schoolPlaced[dpi].x;
                                var dpdy = schoolPts[bhIdx].y - schoolPlaced[dpi].y;
                                if (dpdx * dpdx + dpdy * dpdy < densityRadSq) density++;
                            }
                            bhScore -= density * 0.4;
                            // Hop distance scoring: penalize too close, penalize too far
                            if (bhHops < minHops) {
                                bhScore -= (minHops - bhHops) * 0.8; // too close (soft preference)
                            } else if (bhHops > minHops + 2) {
                                bhScore -= (bhHops - minHops - 2) * 0.5; // too far
                            }
                            if (bhScore > bestScore) {
                                bestScore = bhScore;
                                bestIdx = bhIdx;
                            }
                        }
                        if (bestIdx >= 0) {
                            placeStats.branchMulti++;
                        }
                    }
                }

                // Last resort: nearest unused globally
                if (bestIdx < 0) {
                    placeStats.globalFB++;
                    var fbDist = Infinity;
                    for (var fi = 0; fi < totalPts; fi++) {
                        if (schoolPts[fi].used) continue;
                        var fdx = schoolPts[fi].x - anchorPos.x;
                        var fdy = schoolPts[fi].y - anchorPos.y;
                        var fd = fdx * fdx + fdy * fdy;
                        if (fd < fbDist) { fbDist = fd; bestIdx = fi; }
                    }
                }

                if (bestIdx < 0) continue; // grid full

                schoolPts[bestIdx].used = true;
                posMap[bNodeId] = { x: schoolPts[bestIdx].x, y: schoolPts[bestIdx].y };
                gridIdxMap[bNodeId] = bestIdx;
                placedCount++;
                branchPlaced++;
                schoolPlaced.push({ x: schoolPts[bestIdx].x, y: schoolPts[bestIdx].y });

                // Store this branch node's growth direction (inherited + placement vector)
                var placedDx = schoolPts[bestIdx].x - anchorPos.x;
                var placedDy = schoolPts[bestIdx].y - anchorPos.y;
                var placedLen = Math.sqrt(placedDx * placedDx + placedDy * placedDy);
                if (placedLen > 0) { placedDx /= placedLen; placedDy /= placedLen; }
                // Blend inherited direction with actual placement direction
                var newDirDx = bGrowDx * 0.4 + placedDx * 0.6;
                var newDirDy = bGrowDy * 0.4 + placedDy * 0.6;
                var newDirLen = Math.sqrt(newDirDx * newDirDx + newDirDy * newDirDy);
                if (newDirLen > 0) { newDirDx /= newDirLen; newDirDy /= newDirLen; }
                dirMap[bNodeId] = { dx: newDirDx, dy: newDirDy };

                allNodes.push({
                    x: schoolPts[bestIdx].x, y: schoolPts[bestIdx].y,
                    color: schoolColor,
                    skillLevel: nodeLookup[bNodeId].skillLevel || ''
                });
                allEdges.push({
                    x1: edgeParentPos.x, y1: edgeParentPos.y,
                    x2: schoolPts[bestIdx].x, y2: schoolPts[bestIdx].y,
                    color: schoolColor
                });

                // Push this node's children for DFS processing
                var bChildNode = nodeLookup[bNodeId];
                if (bChildNode && bChildNode.children) {
                    var bcSorted = bChildNode.children.slice();
                    bcSorted.sort(function(a, b) {
                        return (subtreeSize[a] || 1) - (subtreeSize[b] || 1);
                    });
                    for (var bcsi = 0; bcsi < bcSorted.length; bcsi++) {
                        if (!posMap[bcSorted[bcsi]]) {
                            branchDfsStack.push(bcSorted[bcsi]);
                        }
                    }
                }
            }

            // ==========================================================
            // K) PHASE 3: ROOT GROWTH — grow from root ring OPPOSITE
            //    to trunk direction, freely placing remaining unplaced
            //    nodes. No grid/corridor constraint — positions are
            //    computed directly from growth tips with random spread.
            //    Round-robin across root positions for balanced growth.
            // ==========================================================
            var rootGrowthPlaced = 0;
            var rootSpread = this.settings.rootSpread || 2.5;
            var rootStepDist = tierSp * Math.max(0.8, rootSpread * 0.5);
            var rootGrowDx = -gdx; // opposite to trunk growth
            var rootGrowDy = -gdy;

            if (rootGrowthTarget > 0) {
                // Collect unplaced nodes for root growth
                var rootUnplaced = [];
                for (var rui = 0; rui < allTreeNodes.length; rui++) {
                    if (!posMap[allTreeNodes[rui].formId]) {
                        rootUnplaced.push(allTreeNodes[rui].formId);
                    }
                }

                // Initialize root growth frontiers — one per root position
                // Each frontier has tips (positions to grow from) and a depth counter.
                var rootFrontiers = [];
                for (var rfi = 0; rfi < numRoots; rfi++) {
                    var rfPos = schoolRootPositions[rfi];
                    rootFrontiers.push({
                        tips: [{ x: rfPos.x, y: rfPos.y, depth: 0 }],
                        dirDx: rootGrowDx,
                        dirDy: rootGrowDy
                    });
                }

                var rootRR = 0; // round-robin index
                var rootIdx = 0; // index into rootUnplaced

                while (rootIdx < rootUnplaced.length && rootGrowthPlaced < rootGrowthTarget) {
                    var rFront = rootFrontiers[rootRR % numRoots];
                    rootRR++;

                    if (rFront.tips.length === 0) continue;

                    // Pick a tip — bias toward shallower (less depth) tips
                    var rTipIdx = 0;
                    var rTipBest = Infinity;
                    for (var rti = 0; rti < rFront.tips.length; rti++) {
                        var rScore = rFront.tips[rti].depth - Math.random() * 1.5;
                        if (rScore < rTipBest) {
                            rTipBest = rScore;
                            rTipIdx = rti;
                        }
                    }
                    var rTip = rFront.tips[rTipIdx];

                    // Compute new position: step in root direction + random spread
                    var rAngle = Math.atan2(rFront.dirDy, rFront.dirDx);
                    // Random angular spread: wider with higher rootSpread
                    var rSpreadAngle = (Math.random() - 0.5) * rootSpread * 0.5;
                    var rFinalAngle = rAngle + rSpreadAngle;
                    // Step distance: base step with some randomness
                    var rDist = rootStepDist * (0.7 + Math.random() * 0.6);

                    var rNewX = rTip.x + Math.cos(rFinalAngle) * rDist;
                    var rNewY = rTip.y + Math.sin(rFinalAngle) * rDist;

                    // Place the node at computed position
                    var rgNodeId = rootUnplaced[rootIdx];
                    rootIdx++;

                    posMap[rgNodeId] = { x: rNewX, y: rNewY };
                    rootGrowthPlaced++;
                    placedCount++;

                    allNodes.push({
                        x: rNewX, y: rNewY,
                        color: schoolColor,
                        skillLevel: nodeLookup[rgNodeId] ? nodeLookup[rgNodeId].skillLevel || '' : ''
                    });

                    // Edge from tip to new position
                    allEdges.push({
                        x1: rTip.x, y1: rTip.y,
                        x2: rNewX, y2: rNewY,
                        color: schoolColor
                    });

                    // New position becomes a growth tip
                    var rNewDepth = rTip.depth + 1;
                    rFront.tips.push({ x: rNewX, y: rNewY, depth: rNewDepth });

                    // Branching: deeper tips may be retired to encourage branching
                    // Keep old tip alive = creates branches; remove = linear growth
                    var rBranchChance = Math.min(0.7, 0.15 + rNewDepth * 0.1);
                    if (Math.random() < rBranchChance) {
                        // Remove old tip — linear growth from new position
                        rFront.tips.splice(rTipIdx, 1);
                    }
                    // else: old tip stays, creating a branch point
                }

                console.log('[TreeGrowthTree] ' + schoolName + ': root growth placed ' +
                    rootGrowthPlaced + '/' + rootGrowthTarget +
                    ' (unplaced available=' + rootUnplaced.length + ')');
            }

            // ==========================================================
            // L) CATCH-ALL: any remaining unplaced nodes (respects allocation cap)
            // ==========================================================
            for (var umi = 0; umi < allTreeNodes.length; umi++) {
                if (placedCount >= maxPlaceable) break;
                var umNode = allTreeNodes[umi];
                if (posMap[umNode.formId]) continue;
                placeStats.globalFB++;

                var nearPos = trunkTipPos;
                var umIdx = -1;
                var umfDist = Infinity;
                for (var umf = 0; umf < totalPts; umf++) {
                    if (schoolPts[umf].used) continue;
                    var umfx = schoolPts[umf].x - nearPos.x;
                    var umfy = schoolPts[umf].y - nearPos.y;
                    var umfd = umfx * umfx + umfy * umfy;
                    if (umfd < umfDist) { umfDist = umfd; umIdx = umf; }
                }
                if (umIdx < 0) break;

                schoolPts[umIdx].used = true;
                posMap[umNode.formId] = { x: schoolPts[umIdx].x, y: schoolPts[umIdx].y };
                gridIdxMap[umNode.formId] = umIdx;
                placedCount++;

                allNodes.push({
                    x: schoolPts[umIdx].x, y: schoolPts[umIdx].y,
                    color: schoolColor,
                    skillLevel: umNode.skillLevel || ''
                });
                allEdges.push({
                    x1: trunkTipPos.x, y1: trunkTipPos.y,
                    x2: schoolPts[umIdx].x, y2: schoolPts[umIdx].y,
                    color: schoolColor
                });
            }

            console.log('[TreeGrowthTree] ' + schoolName + ': placed ' +
                placedCount + '/' + allTreeNodes.length +
                ' (max=' + maxPlaceable + ', trunk=' + trunkTarget + ', branch=' + branchTarget + ', root=' + rootGrowthTarget + ')' +
                ' | trunkH1=' + placeStats.trunkHop1 +
                ' trunkM=' + placeStats.trunkMulti +
                ' trunkRetry=' + placeStats.trunkRetry +
                ' branchH1=' + placeStats.branchHop1 +
                ' branchM=' + placeStats.branchMulti +
                ' globalFB=' + placeStats.globalFB +
                ' rootGrowth=' + rootGrowthPlaced);

            totalPlaced += placedCount;
            totalPool += allTreeNodes.length;

            // Merge into output
            for (var pmk in posMap) {
                if (posMap.hasOwnProperty(pmk)) {
                    allPosMap[pmk] = posMap[pmk];
                }
            }
        }

        return { edges: allEdges, nodes: allNodes, posMap: allPosMap, totalPlaced: totalPlaced, totalPool: totalPool };
    },

    // =========================================================================
    // HELPERS
    // =========================================================================

    _markDirty: function() {
        if (typeof TreeGrowth !== 'undefined') {
            TreeGrowth._markDirty();
        }
    },

    getSettings: function() {
        return {
            ghostOpacity: this.settings.ghostOpacity,
            nodeRadius: this.settings.nodeRadius,
            trunkThickness: this.settings.trunkThickness,
            branchSpread: this.settings.branchSpread,
            rootSpread: this.settings.rootSpread,
            pctBranches: this.settings.pctBranches,
            pctTrunk: this.settings.pctTrunk,
            pctRoot: this.settings.pctRoot
        };
    }
};

// Self-register when TreeGrowth is available
if (typeof TreeGrowth !== 'undefined') {
    TreeGrowth.registerMode('tree', TreeGrowthTree);
}
