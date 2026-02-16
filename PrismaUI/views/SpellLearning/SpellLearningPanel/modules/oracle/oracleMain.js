/**
 * TreeGrowthOracle - Oracle Growth Mode Orchestrator
 *
 * Wires together OracleSettings, OracleLayout, and OracleRenderer to
 * provide the "ORACLE" tab in the Tree Growth section. Produces parallel
 * lane trees where each thematic chain runs as a separate lane, side by
 * side - like parallel railroad tracks, each chain being a track with
 * spells as stations.
 *
 * The C++ builder returns extra metadata: chains with names and
 * narratives, and each node has a `chain` property identifying which
 * chain it belongs to.
 *
 * Self-registers with TreeGrowth via registerMode().
 *
 * Depends on:
 *   oracleSettings.js  (OracleSettings)
 *   oracleLayout.js    (OracleLayout)
 *   oracleRenderer.js  (OracleRenderer)
 *   treePreviewUtils.js (TreePreviewUtils)
 *   treePreview.js      (TreePreview.getOutput)
 *   treeGrowth.js       (TreeGrowth - registers into it)
 */

var TreeGrowthOracle = {

    // =========================================================================
    // STATE
    // =========================================================================

    tabLabel: 'ORACLE',

    settings: {
        ghostOpacity: 35,
        nodeRadius: 5,
        chaos: 0,
        batchSize: 20,
        chainStyle: 'linear',
        showNarrative: false
    },

    _treeData: null,
    _layoutData: null,
    _positionMap: null,
    _hasSpells: false,

    // =========================================================================
    // TREE GROWTH MODE INTERFACE (required by TreeGrowth orchestrator)
    // =========================================================================

    /**
     * Build the settings panel HTML for Oracle mode.
     * @returns {string} HTML string
     */
    buildSettingsHTML: function () {
        return OracleSettings.buildHTML(this.settings);
    },

    /**
     * Bind DOM events for the settings panel.
     * Connects OracleSettings callbacks to internal methods.
     */
    bindEvents: function () {
        var self = this;

        OracleSettings.bindEvents({
            onSettingChanged: function (key, value) {
                self.settings[key] = value;
                // Layout-affecting settings: invalidate cached layout so it recomputes
                if (key === 'chaos' || key === 'chainStyle' || key === 'batchSize') {
                    if (self._treeData) {
                        self._layoutData = null; // triggers lazy re-layout on next render
                    }
                }
                TreeGrowth._markDirty();
            }
        });
    },

    /**
     * Render the Oracle Growth overlay onto the shared canvas.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w  - Canvas logical width
     * @param {number} h  - Canvas logical height
     * @param {Object|null} baseData - Output from TreePreview.getOutput()
     */
    render: function (ctx, w, h, baseData) {
        if (!baseData) {
            // No base data - show placeholder message
            ctx.save();
            ctx.font = '13px sans-serif';
            ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(t('preview.scanToPreview'), w / 2, h / 2);
            ctx.restore();
            return;
        }

        // 1. Render the base grid underneath
        baseData.renderGrid(ctx, w, h);

        // 2. Lazy layout: if we have tree data but no layout yet, try now
        if (this._treeData && (!this._layoutData || !this._layoutData.schools)) {
            this._layoutData = OracleLayout.layoutAllSchools(this._treeData, baseData, this.settings);
            if (this._layoutData && this._layoutData.schools) {
                var totalNodes = 0;
                var s = this._layoutData.schools;
                for (var sn in s) {
                    if (s.hasOwnProperty(sn)) totalNodes += s[sn].nodes ? s[sn].nodes.length : 0;
                }
                var lazyPool = 0;
                if (this._treeData && this._treeData.schools) {
                    for (var lpn in this._treeData.schools) {
                        if (this._treeData.schools.hasOwnProperty(lpn)) {
                            lazyPool += this._treeData.schools[lpn].nodes ? this._treeData.schools[lpn].nodes.length : 0;
                        }
                    }
                }
                console.log('[OracleGrowth] Lazy layout: ' + totalNodes + '/' + lazyPool + ' nodes positioned');
                OracleSettings.setTreeBuilt(true, totalNodes, lazyPool);
                this._zoomToFit();
            }
        }

        // 3. If still no layout data, just show the grid
        if (!this._layoutData || !this._layoutData.schools) return;

        var cx = w / 2;
        var cy = h / 2;
        var opacity = this.settings.ghostOpacity / 100;
        var nodeR = this.settings.nodeRadius;
        var showNarrative = this.settings.showNarrative;

        // 4. For each school, render chain lanes, edges, then nodes
        var schools = this._layoutData.schools;
        for (var schoolName in schools) {
            if (!schools.hasOwnProperty(schoolName)) continue;
            var school = schools[schoolName];
            var schoolNodes = school.nodes;

            // Build chain metadata and lane positions for this school
            var schoolTree = this._treeData.schools ? this._treeData.schools[schoolName] : null;
            var chainMeta = OracleLayout.buildChainMeta(schoolTree, school.color);
            var lanePositions = OracleLayout.buildLanePositions(schoolNodes);

            // Chain lane ribbons (underneath everything)
            OracleRenderer.renderChainLanes(ctx, cx, cy, chainMeta, lanePositions, opacity);

            // Edges
            OracleRenderer.renderEdges(ctx, cx, cy, schoolNodes, school.color, opacity);

            // Nodes on top
            OracleRenderer.renderNodes(ctx, cx, cy, schoolNodes, school.color, opacity, nodeR);

            // Root markers
            for (var i = 0; i < schoolNodes.length; i++) {
                if (schoolNodes[i].isRoot) {
                    OracleRenderer.renderRootMarker(
                        ctx,
                        cx + schoolNodes[i].x,
                        cy + schoolNodes[i].y,
                        school.color,
                        nodeR
                    );
                }
            }

            // Narrative labels (if enabled and chain data available)
            if (showNarrative && chainMeta.length > 0 && lanePositions.length > 0) {
                OracleRenderer.renderNarrativeLabels(ctx, cx, cy, chainMeta, lanePositions, opacity);
            }
        }
    },

    // =========================================================================
    // TREE BUILDING FLOW
    // =========================================================================

    /**
     * Build tree from scanned spells via C++ (ProceduralTreeGenerate)
     * with the oracle builder command.
     */
    buildTree: function () {
        var spellData = (typeof state !== 'undefined' && state.lastSpellData)
            ? state.lastSpellData
            : null;

        if (!spellData || !spellData.spells || spellData.spells.length === 0) {
            OracleSettings.setStatusText('No spells scanned \u2014 scan first', '#ef4444');
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

        OracleSettings.setStatusText('Building tree (C++/Oracle)...', '#f59e0b');
        var buildBtn = document.getElementById('tgBuildBtn');
        if (buildBtn) buildBtn.disabled = true;

        // Set pending flag so onProceduralTreeComplete routes result here
        if (typeof state !== 'undefined') {
            state._oracleGrowthBuildPending = true;
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
        console.log('[OracleGrowth] Filtered spells: ' + spellsToProcess.length + '/' + spellData.spells.length);

        // Gather grid layout info so C++ can adapt
        var gridHint = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            var previewOut = TreePreview.getOutput();
            if (previewOut) {
                var avgPts = 0;
                var schoolCount = previewOut.schools ? previewOut.schools.length : 0;
                if (previewOut.gridPoints && schoolCount > 0) {
                    avgPts = Math.round(previewOut.gridPoints.length / schoolCount);
                }
                gridHint = {
                    mode: previewOut.mode || 'sun',
                    schoolCount: schoolCount,
                    avgPointsPerSchool: avgPts
                };
            }
        }

        // Read LLM config from settings (written by OracleSettings UI)
        var llmApi = (typeof settings !== 'undefined' && settings.treeGeneration && settings.treeGeneration.llm_api)
            ? settings.treeGeneration.llm_api
            : {};

        var config = {
            chaos: this.settings.chaos / 100,
            batch_size: this.settings.batchSize,
            chain_style: this.settings.chainStyle,
            max_children_per_node: 4,
            seed: Math.floor(Math.random() * 100000),
            llm_api: llmApi,
            grid_hint: gridHint
        };

        // Defer to let UI render progress modal before blocking on JSON.stringify
        setTimeout(function() {
            window.callCpp('ProceduralTreeGenerate', JSON.stringify({
                command: 'build_tree_oracle',
                spells: spellsToProcess,
                config: config
            }));
        }, 0);
    },

    /**
     * Receive tree data from the C++ backend callback.
     * Parses chain metadata, runs layout, and triggers a re-render.
     *
     * @param {Object} data - Raw tree structure from the backend, includes
     *                        schools[].chains[] with name/narrative metadata
     *                        and nodes[].chain identifying chain membership
     */
    loadTreeData: function (data) {
        this._treeData = data;
        this._layoutData = null; // invalidate to force re-layout
        this._positionMap = null;
        console.log('[OracleGrowth] loadTreeData called, schools:', data && data.schools ? Object.keys(data.schools) : 'none');

        // Log chain metadata if present
        if (data && data.schools) {
            for (var sn in data.schools) {
                if (!data.schools.hasOwnProperty(sn)) continue;
                var school = data.schools[sn];
                var chainCount = school.chains ? school.chains.length : 0;
                var nodeCount = school.nodes ? school.nodes.length : 0;
                console.log('[OracleGrowth] School "' + sn + '": ' + nodeCount + ' nodes, ' + chainCount + ' chains');
                if (school.chains) {
                    for (var ci = 0; ci < school.chains.length; ci++) {
                        var c = school.chains[ci];
                        console.log('[OracleGrowth]   Chain "' + (c.name || ci) + '": ' +
                            (c.nodes ? c.nodes.length : 0) + ' nodes' +
                            (c.narrative ? ' [narrative]' : ''));
                    }
                }
            }
        }

        // Attempt layout against the current base grid
        var baseData = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            baseData = TreePreview.getOutput();
        }
        console.log('[OracleGrowth] baseData:', baseData ? 'present' : 'null',
            baseData ? ('mode=' + baseData.mode + ' schools=' + (baseData.schools ? baseData.schools.length : 0) +
            ' rootNodes=' + (baseData.rootNodes ? baseData.rootNodes.length : 0)) : '');

        if (baseData) {
            this._layoutData = OracleLayout.layoutAllSchools(data, baseData, this.settings);
            console.log('[OracleGrowth] layoutData:', this._layoutData ? Object.keys(this._layoutData.schools || {}) : 'null');
        } else {
            console.warn('[OracleGrowth] No baseData from TreePreview - layout skipped');
        }

        // Count positioned nodes vs total pool for status display
        var totalNodes = 0;
        var totalPool = 0;
        if (this._layoutData && this._layoutData.schools) {
            var layoutSchools = this._layoutData.schools;
            for (var name in layoutSchools) {
                if (layoutSchools.hasOwnProperty(name)) {
                    totalNodes += layoutSchools[name].nodes ? layoutSchools[name].nodes.length : 0;
                    console.log('[OracleGrowth] School ' + name + ': ' + (layoutSchools[name].nodes ? layoutSchools[name].nodes.length : 0) + ' nodes');
                }
            }
        }
        if (data && data.schools) {
            for (var pn in data.schools) {
                if (data.schools.hasOwnProperty(pn)) {
                    totalPool += data.schools[pn].nodes ? data.schools[pn].nodes.length : 0;
                }
            }
        }
        console.log('[OracleGrowth] Total positioned nodes: ' + totalNodes + '/' + totalPool);

        OracleSettings.setTreeBuilt(true, totalNodes, totalPool);
        this._zoomToFit();

        TreeGrowth._markDirty();
    },

    /**
     * Save the current tree data to the game via C++ backend.
     * Bakes layout positions from _layoutData into the output JSON
     * so the spell tree viewer can render at exact positions.
     */
    applyTree: function () {
        if (!this._treeData) return;

        // Build lookups from layout data
        var posLookup = {};
        var childrenLookup = {};
        var prereqLookup = {};
        var placedSet = {};

        if (this._layoutData && this._layoutData.schools) {
            var layoutSchools = this._layoutData.schools;
            for (var lsName in layoutSchools) {
                if (!layoutSchools.hasOwnProperty(lsName)) continue;
                var lsNodes = layoutSchools[lsName].nodes || [];
                for (var li = 0; li < lsNodes.length; li++) {
                    var ln = lsNodes[li];
                    posLookup[ln.formId] = { x: ln.x, y: ln.y };
                    placedSet[ln.formId] = true;

                    // Build parent->children from layout's parentFormId
                    if (ln.parentFormId) {
                        if (!childrenLookup[ln.parentFormId]) childrenLookup[ln.parentFormId] = [];
                        childrenLookup[ln.parentFormId].push(ln.formId);

                        if (!prereqLookup[ln.formId]) prereqLookup[ln.formId] = [];
                        prereqLookup[ln.formId].push(ln.parentFormId);
                    }
                }
            }
        }

        var posCount = Object.keys(posLookup).length;
        var placedCount = Object.keys(placedSet).length;
        console.log('[OracleGrowth] applyTree: posLookup=' + posCount +
                    ', placed=' + placedCount + ', childrenEdges=' + Object.keys(childrenLookup).length);

        // Get base data for mode and root directions
        var baseData = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            baseData = TreePreview.getOutput();
        }
        var layoutMode = baseData ? baseData.mode : 'sun';

        // Build output JSON with layout-derived edges and positions
        var output = {
            version: this._treeData.version || '1.0',
            generator: 'PrismaUI OracleGrowth',
            generatedAt: new Date().toISOString(),
            trustPrereqs: true,
            noRotate: (layoutMode === 'flat'),
            layoutMode: layoutMode,
            config: this._treeData.config || {},
            globe: (typeof TreeCore !== 'undefined' && TreeCore.getOutput)
                ? TreeCore.getOutput()
                : { x: 0, y: 0, radius: 45 },
            schools: {}
        };

        // Copy school_configs and seed if present
        if (this._treeData.seed) output.seed = this._treeData.seed;
        if (this._treeData.school_configs) output.school_configs = this._treeData.school_configs;

        // Get root directions from TreePreview baseData for spoke angles
        var rootDirBySchool = {};
        if (baseData && baseData.rootNodes) {
            for (var rni = 0; rni < baseData.rootNodes.length; rni++) {
                var rn = baseData.rootNodes[rni];
                if (rn.school && rn.dir !== undefined) {
                    rootDirBySchool[rn.school] = rn.dir;
                }
            }
        }
        var numSchools = Object.keys(this._treeData.schools || {}).length;
        var sliceAngle = numSchools > 0 ? 360 / numSchools : 60;

        var srcSchools = this._treeData.schools || {};
        for (var schoolName in srcSchools) {
            if (!srcSchools.hasOwnProperty(schoolName)) continue;
            var src = srcSchools[schoolName];
            var srcNodes = src.nodes || [];

            var schoolRootId = src.root || (srcNodes.length > 0 ? srcNodes[0].formId : '');
            var outNodes = [];
            var nodesWithPos = 0;

            for (var i = 0; i < srcNodes.length; i++) {
                var sn = srcNodes[i];

                // Only include nodes that were actually placed by the layout
                if (!placedSet[sn.formId]) continue;

                // Use layout-derived children and prereqs instead of C++ builder's
                var layoutChildren = childrenLookup[sn.formId] || [];
                var layoutPrereqs = prereqLookup[sn.formId] || [];

                // Prereq rework: regular prereqs = soft (need any 1 of N)
                // Lock prereqs = hard (mandatory)
                var lockHardPrereqs = [];
                var lockData = [];
                if (sn.locks && sn.locks.length > 0) {
                    lockData = sn.locks;
                    lockHardPrereqs = sn.locks.map(function(l) { return l.nodeId; });
                }

                var outNode = {
                    formId: sn.formId,
                    children: layoutChildren,
                    prerequisites: layoutPrereqs,
                    hardPrereqs: lockHardPrereqs,
                    softPrereqs: layoutPrereqs,
                    softNeeded: layoutPrereqs.length > 0 ? 1 : 0,
                    tier: sn.tier || 1
                };
                if (lockData.length > 0) outNode.locks = lockData;
                if (sn.skillLevel) outNode.skillLevel = sn.skillLevel;
                if (sn.theme) outNode.theme = sn.theme;
                if (sn.chain) outNode.chain = sn.chain;
                if (sn.name) outNode.name = sn.name;
                if (sn.section) outNode.section = sn.section;
                if (sn.formId === schoolRootId) {
                    outNode.isRoot = true;
                    outNode.prerequisites = [];
                    outNode.softPrereqs = [];
                    outNode.softNeeded = 0;
                }

                // Bake layout position
                var pos = posLookup[sn.formId];
                if (pos) {
                    outNode.x = Math.round(pos.x * 100) / 100;
                    outNode.y = Math.round(pos.y * 100) / 100;
                    nodesWithPos++;
                }
                outNodes.push(outNode);
            }

            console.log('[OracleGrowth] School "' + schoolName + '": ' +
                        outNodes.length + ' nodes, ' + nodesWithPos + ' with positions');

            output.schools[schoolName] = {
                root: schoolRootId,
                layoutStyle: src.layoutStyle || 'oracle',
                nodes: outNodes
            };

            // Copy color if present
            if (src.color) output.schools[schoolName].color = src.color;

            // Copy chain metadata if present
            if (src.chains) output.schools[schoolName].chains = src.chains;

            // Bake spoke angle from root direction so CanvasRendererV2 rotates correctly
            var dirRad = rootDirBySchool[schoolName];
            if (dirRad !== undefined && !isNaN(dirRad)) {
                var spokeDeg = dirRad * 180 / Math.PI;
                output.schools[schoolName].spokeAngle = Math.round(spokeDeg * 100) / 100;
                output.schools[schoolName].startAngle = Math.round((spokeDeg - sliceAngle / 2) * 100) / 100;
                output.schools[schoolName].endAngle = Math.round((spokeDeg + sliceAngle / 2) * 100) / 100;
                output.schools[schoolName].rootDirection = dirRad;
            }
        }

        // Save to disk via C++
        window.callCpp('SaveSpellTree', JSON.stringify(output));

        // Load into the spell tree viewer so it displays immediately
        if (typeof loadTreeData === 'function') {
            loadTreeData(output);
        }

        var appliedSchoolCount = Object.keys(output.schools).length;
        OracleSettings.setStatusText('Tree applied (' + posCount + ' positioned)', '#22c55e');
        if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeApplied', {schools: appliedSchoolCount}), 'success');

        // Build position map for external use
        this._positionMap = posLookup;

        // Switch to the Spell Tree tab after a brief delay
        if (typeof switchTab === 'function') {
            setTimeout(function() {
                switchTab('spellTree');
            }, 300);
        }
    },

    /**
     * Return the current layout position map (formId -> {x, y}) for preview rendering.
     * Returns null if no tree has been built yet.
     */
    getPositionMap: function () {
        if (!this._layoutData || !this._layoutData.schools) return null;
        var posMap = {};
        var schools = this._layoutData.schools;
        for (var name in schools) {
            if (!schools.hasOwnProperty(name)) continue;
            var nodes = schools[name].nodes || [];
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                if (n.formId) posMap[n.formId] = { x: n.x, y: n.y };
            }
        }
        return Object.keys(posMap).length > 0 ? posMap : null;
    },

    /**
     * Discard the current tree data and clear the preview.
     */
    clearTree: function () {
        this._treeData = null;
        this._layoutData = null;
        this._positionMap = null;

        OracleSettings.setTreeBuilt(false);
        if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeCleared'));

        TreeGrowth._markDirty();
    },

    // =========================================================================
    // ZOOM TO FIT
    // =========================================================================

    /**
     * Auto-zoom the Growth canvas so the full tree is visible with padding.
     * Reads all positioned node coordinates and computes the bounding box.
     */
    _zoomToFit: function () {
        if (!this._layoutData || !this._layoutData.schools) return;
        if (typeof TreeGrowth === 'undefined') return;

        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        var schools = this._layoutData.schools;
        var nodeCount = 0;
        for (var name in schools) {
            if (!schools.hasOwnProperty(name)) continue;
            var nodes = schools[name].nodes || [];
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i].x < minX) minX = nodes[i].x;
                if (nodes[i].x > maxX) maxX = nodes[i].x;
                if (nodes[i].y < minY) minY = nodes[i].y;
                if (nodes[i].y > maxY) maxY = nodes[i].y;
                nodeCount++;
            }
        }
        if (nodeCount === 0) return;

        var treeW = maxX - minX;
        var treeH = maxY - minY;
        if (treeW < 1) treeW = 100;
        if (treeH < 1) treeH = 100;

        // Add 15% padding
        var padding = 1.15;
        var canvasW = TreeGrowth._width || 400;
        var canvasH = TreeGrowth._height || 400;
        var zoomX = canvasW / (treeW * padding);
        var zoomY = canvasH / (treeH * padding);
        var zoom = Math.min(zoomX, zoomY, 2.0); // cap at 2x
        zoom = Math.max(zoom, 0.1);

        // Center pan on the tree's center
        var centerX = (minX + maxX) / 2;
        var centerY = (minY + maxY) / 2;

        TreeGrowth.zoom = zoom;
        TreeGrowth.panX = -centerX * zoom;
        TreeGrowth.panY = -centerY * zoom;

        console.log('[OracleGrowth] Zoom to fit: zoom=' + zoom.toFixed(2) +
            ' bounds=' + Math.round(treeW) + 'x' + Math.round(treeH) +
            ' center=' + Math.round(centerX) + ',' + Math.round(centerY));
    },

    // =========================================================================
    // EXTERNAL API
    // =========================================================================

    /**
     * Return a shallow copy of the current settings.
     * @returns {Object}
     */
    getSettings: function () {
        var copy = {};
        for (var key in this.settings) {
            if (this.settings.hasOwnProperty(key)) {
                copy[key] = this.settings[key];
            }
        }
        return copy;
    }
};

// =============================================================================
// SELF-REGISTRATION
// =============================================================================

if (typeof TreeGrowth !== 'undefined') {
    TreeGrowth.registerMode('oracle', TreeGrowthOracle);
}
