/**
 * TreeGrowthClassic — Classic Growth Mode Orchestrator
 *
 * Wires together ClassicSettings, ClassicLayout, and ClassicRenderer to
 * provide the "CLASSIC" tab in the Tree Growth section. Manages tree build
 * state, delegates rendering to ClassicRenderer, and communicates with the
 * C++ backend via window.callCpp for tree building and saving.
 *
 * Self-registers with TreeGrowth via registerMode().
 *
 * Depends on:
 *   classicSettings.js  (ClassicSettings)
 *   classicLayout.js    (ClassicLayout)
 *   classicRenderer.js  (ClassicRenderer)
 *   treePreviewUtils.js (TreePreviewUtils)
 *   treePreview.js      (TreePreview.getOutput)
 *   treeGrowth.js       (TreeGrowth — registers into it)
 */

var TreeGrowthClassic = {

    // =========================================================================
    // STATE
    // =========================================================================

    settings: {
        ghostOpacity: 35,
        nodeRadius: 5,
        spread: 50,
        radialBias: 50,
        centerMask: 3,
        spellMatching: 'layered',
        dynamicGridExpansion: true,  // Expand grid when schools run out of space
        tierZones: {
            Novice:     { min: 0,  max: 40 },
            Apprentice: { min: 10, max: 55 },
            Adept:      { min: 30, max: 75 },
            Expert:     { min: 50, max: 90 },
            Master:     { min: 65, max: 100 }
        }
    },

    _treeData: null,
    _layoutData: null,
    _pythonInstalled: false,
    _hasSpells: false,

    // =========================================================================
    // TREE GROWTH MODE INTERFACE (required by TreeGrowth orchestrator)
    // =========================================================================

    /**
     * Build the settings panel HTML for Classic mode.
     * @returns {string} HTML string
     */
    buildSettingsHTML: function () {
        return ClassicSettings.buildHTML(this.settings);
    },

    /**
     * Bind DOM events for the settings panel.
     * Connects ClassicSettings callbacks to internal methods.
     */
    bindEvents: function () {
        var self = this;

        ClassicSettings.bindEvents({
            onBuild: function () {
                self.buildTree();
            },
            onApply: function () {
                self.applyTree();
            },
            onClear: function () {
                self.clearTree();
            },
            onSetupPython: function () {
                window.callCpp('SetupPython', '');
            },
            onSettingChanged: function (key, value) {
                self.settings[key] = value;
                // Layout-affecting settings: invalidate cached layout so it recomputes
                if (key === 'spread' || key === 'radialBias' || key === 'centerMask' || key === 'spellMatching') {
                    if (self._treeData) {
                        self._layoutData = null; // triggers lazy re-layout on next render
                    }
                }
                TreeGrowth._markDirty();
            },
            onTierZoneChanged: function (tier, min, max) {
                if (!self.settings.tierZones) self.settings.tierZones = {};
                self.settings.tierZones[tier] = { min: min, max: max };
                if (self._treeData) {
                    self._layoutData = null; // triggers re-layout
                }
                TreeGrowth._markDirty();
            }
        });
    },

    /**
     * Render the Classic Growth overlay onto the shared canvas.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w  - Canvas logical width
     * @param {number} h  - Canvas logical height
     * @param {Object|null} baseData - Output from TreePreview.getOutput()
     */
    render: function (ctx, w, h, baseData) {
        if (!baseData) {
            // No base data — show placeholder message
            ctx.save();
            ctx.font = '13px sans-serif';
            ctx.fillStyle = 'rgba(184, 168, 120, 0.5)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Scan spells to see preview', w / 2, h / 2);
            ctx.restore();
            return;
        }

        // 1. Render the base grid underneath
        baseData.renderGrid(ctx, w, h);

        // 1b. Draw globe mask ring (non-root exclusion zone around globe)
        if (this.settings.centerMask > 0 && baseData.grid) {
            var maskR = this.settings.centerMask * (baseData.grid.tierSpacing || 30);
            var globeOff = (typeof TreeCore !== 'undefined' && TreeCore.getOutput)
                ? TreeCore.getOutput() : { x: 0, y: 0 };
            var mcx = w / 2 + globeOff.x;
            var mcy = h / 2 + globeOff.y;
            ctx.save();
            ctx.beginPath();
            ctx.arc(mcx, mcy, maskR, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 60, 60, 0.25)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 60, 60, 0.04)';
            ctx.fill();
            ctx.restore();
        }

        // 2. Lazy layout: if we have tree data but no layout yet, try now
        if (this._treeData && (!this._layoutData || !this._layoutData.schools)) {
            this._layoutData = ClassicLayout.layoutAllSchools(this._treeData, baseData, this.settings);
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
                console.log('[ClassicGrowth] Lazy layout: ' + totalNodes + '/' + lazyPool + ' nodes positioned');
                ClassicSettings.setTreeBuilt(true, totalNodes, lazyPool);
                this._zoomToFit();
            }
        }

        // 3. If still no layout data, just show the grid
        if (!this._layoutData || !this._layoutData.schools) return;

        var cx = w / 2;
        var cy = h / 2;
        var opacity = this.settings.ghostOpacity / 100;
        var nodeR = this.settings.nodeRadius;

        // 3. For each school, render edges then nodes
        var schools = this._layoutData.schools;
        for (var schoolName in schools) {
            if (!schools.hasOwnProperty(schoolName)) continue;
            var school = schools[schoolName];

            // Edges first (underneath)
            ClassicRenderer.renderEdges(ctx, cx, cy, school.nodes, school.color, opacity);

            // Nodes on top
            ClassicRenderer.renderNodes(ctx, cx, cy, school.nodes, school.color, opacity, nodeR);

            // Root markers
            for (var i = 0; i < school.nodes.length; i++) {
                if (school.nodes[i].isRoot) {
                    ClassicRenderer.renderRootMarker(
                        ctx,
                        cx + school.nodes[i].x,
                        cy + school.nodes[i].y,
                        school.color,
                        nodeR
                    );
                }
            }
        }

        // 4. Draw per-school tier zone arcs (visual debug overlay)
        // Each school has its own tree height, so zone rings differ per school.
        var zi = this._layoutData.zoneInfo;
        if (zi && this.settings.tierZones) {
            var tierVis = [
                { key: 'Novice',     color: 'rgba(100,180,100,' },
                { key: 'Apprentice', color: 'rgba(80,150,200,' },
                { key: 'Adept',      color: 'rgba(180,160,80,' },
                { key: 'Expert',     color: 'rgba(200,120,60,' },
                { key: 'Master',     color: 'rgba(180,60,60,' }
            ];

            ctx.save();
            for (var zSchoolName in schools) {
                if (!schools.hasOwnProperty(zSchoolName)) continue;
                var zSchool = schools[zSchoolName];
                var treeMaxR = zSchool.treeMaxRadius || 0;
                var growRange = treeMaxR - zi.ringRadius;
                if (growRange < 1) continue;

                // Determine angular span for this school from its root nodes
                var zNodes = zSchool.nodes || [];
                var avgAngle = 0;
                var rootCount = 0;
                for (var zni = 0; zni < zNodes.length; zni++) {
                    if (zNodes[zni].isRoot) {
                        avgAngle += Math.atan2(zNodes[zni].y, zNodes[zni].x);
                        rootCount++;
                    }
                }
                if (rootCount === 0) continue;
                avgAngle /= rootCount;

                // Draw zone arcs as 60-degree wedge centered on school direction
                var arcSpan = Math.PI / 3; // 60 degrees
                var arcStart = avgAngle - arcSpan / 2;
                var arcEnd = avgAngle + arcSpan / 2;

                for (var tvi = 0; tvi < tierVis.length; tvi++) {
                    var tv = tierVis[tvi];
                    var zone = this.settings.tierZones[tv.key];
                    if (!zone) continue;

                    var innerR = zi.ringRadius + (zone.min / 100) * growRange;
                    var outerR = zi.ringRadius + (zone.max / 100) * growRange;

                    // Outer boundary arc
                    ctx.beginPath();
                    ctx.arc(cx, cy, outerR, arcStart, arcEnd);
                    ctx.strokeStyle = tv.color + '0.3)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 4]);
                    ctx.stroke();

                    // Inner boundary arc
                    ctx.beginPath();
                    ctx.arc(cx, cy, innerR, arcStart, arcEnd);
                    ctx.strokeStyle = tv.color + '0.2)';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // Label at the midpoint of the outer arc
                    if (tvi === 0 || tvi === 4) { // Only label Novice and Master to avoid clutter
                        ctx.setLineDash([]);
                        var labelAngle = avgAngle;
                        var labelR = outerR + 6;
                        ctx.font = '8px sans-serif';
                        ctx.fillStyle = tv.color + '0.5)';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(tv.key, cx + Math.cos(labelAngle) * labelR, cy + Math.sin(labelAngle) * labelR);
                    }
                }
            }
            ctx.setLineDash([]);
            ctx.restore();
        }
    },

    // =========================================================================
    // TREE BUILDING FLOW
    // =========================================================================

    /**
     * Build tree from scanned spells via Python (C++ ProceduralPythonGenerate)
     * with JS fallback if Python is unavailable.
     */
    buildTree: function () {
        var spellData = (typeof state !== 'undefined' && state.lastSpellData)
            ? state.lastSpellData
            : null;

        if (!spellData || !spellData.spells || spellData.spells.length === 0) {
            ClassicSettings.setStatusText('No spells scanned \u2014 scan first', '#ef4444');
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

        ClassicSettings.setStatusText('Building tree (Python)...', '#f59e0b');
        var buildBtn = document.getElementById('tgClassicBuildBtn');
        if (buildBtn) buildBtn.disabled = true;

        // Set pending flag so onProceduralPythonComplete routes result here
        if (typeof state !== 'undefined') {
            state._classicGrowthBuildPending = true;
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
        console.log('[ClassicGrowth] Filtered spells: ' + spellsToProcess.length + '/' + spellData.spells.length);

        var config = {
            shape: 'organic',
            density: 0.6,
            symmetry: 0.3,
            max_children_per_node: 3,
            top_themes_per_school: 8,
            convergence_chance: 0.4,
            prefer_vanilla_roots: true
        };

        window.callCpp('ProceduralPythonGenerate', JSON.stringify({
            spells: spellsToProcess,
            config: config
        }));
    },

    /**
     * Receive tree data from the C++ / Python backend callback.
     * Runs layout and triggers a re-render.
     *
     * @param {Object} data - Raw tree structure from the backend
     */
    loadTreeData: function (data) {
        this._treeData = data;
        console.log('[ClassicGrowth] loadTreeData called, schools:', data && data.schools ? Object.keys(data.schools) : 'none');

        // Attempt layout against the current base grid
        var baseData = null;
        if (typeof TreePreview !== 'undefined' && TreePreview.getOutput) {
            baseData = TreePreview.getOutput();
        }
        console.log('[ClassicGrowth] baseData:', baseData ? 'present' : 'null',
            baseData ? ('mode=' + baseData.mode + ' schools=' + (baseData.schools ? baseData.schools.length : 0) +
            ' rootNodes=' + (baseData.rootNodes ? baseData.rootNodes.length : 0)) : '');

        if (baseData) {
            this._layoutData = ClassicLayout.layoutAllSchools(data, baseData, this.settings);
            console.log('[ClassicGrowth] layoutData:', this._layoutData ? Object.keys(this._layoutData.schools || {}) : 'null');
        } else {
            console.warn('[ClassicGrowth] No baseData from TreePreview — layout skipped');
        }

        // Count positioned nodes vs total pool for status display
        var totalNodes = 0;
        var totalPool = 0;
        if (this._layoutData && this._layoutData.schools) {
            var schools = this._layoutData.schools;
            for (var name in schools) {
                if (schools.hasOwnProperty(name)) {
                    totalNodes += schools[name].nodes ? schools[name].nodes.length : 0;
                    console.log('[ClassicGrowth] School ' + name + ': ' + (schools[name].nodes ? schools[name].nodes.length : 0) + ' nodes');
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
        console.log('[ClassicGrowth] Total positioned nodes: ' + totalNodes + '/' + totalPool);

        ClassicSettings.setTreeBuilt(true, totalNodes, totalPool);
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

        // Build lookups from layout data:
        //   posLookup:      formId → {x, y}
        //   childrenLookup: formId → [childFormId, ...]  (from layout's parentFormId)
        //   prereqLookup:   formId → [parentFormId]      (inverse of children)
        //   placedSet:      formId → true                 (nodes actually placed by layout)
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

                    // Build parent→children from layout's parentFormId
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
        console.log('[ClassicGrowth] applyTree: posLookup=' + posCount +
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
            generator: 'PrismaUI ClassicGrowth',
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
                    rootDirBySchool[rn.school] = rn.dir; // radians
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

                // Use layout-derived children and prereqs instead of Python builder's
                var layoutChildren = childrenLookup[sn.formId] || [];
                var layoutPrereqs = prereqLookup[sn.formId] || [];

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
                if (sn.name) outNode.name = sn.name;
                if (sn.section) outNode.section = sn.section;
                if (sn.formId === schoolRootId) outNode.isRoot = true;

                // Bake layout position
                var pos = posLookup[sn.formId];
                if (pos) {
                    outNode.x = Math.round(pos.x * 100) / 100;
                    outNode.y = Math.round(pos.y * 100) / 100;
                    nodesWithPos++;
                }
                outNodes.push(outNode);
            }

            console.log('[ClassicGrowth] School "' + schoolName + '": ' +
                        outNodes.length + ' nodes, ' + nodesWithPos + ' with positions');

            output.schools[schoolName] = {
                root: schoolRootId,
                layoutStyle: src.layoutStyle || 'classic',
                nodes: outNodes
            };

            // Copy color if present
            if (src.color) output.schools[schoolName].color = src.color;

            // Bake spoke angle from root direction so CanvasRendererV2 rotates correctly
            var dirRad = rootDirBySchool[schoolName];
            if (dirRad !== undefined && !isNaN(dirRad)) {
                var spokeDeg = dirRad * 180 / Math.PI; // convert radians to degrees
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

        ClassicSettings.setStatusText('Tree applied (' + posCount + ' positioned)', '#22c55e');

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

        ClassicSettings.setTreeBuilt(false);

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

        console.log('[ClassicGrowth] Zoom to fit: zoom=' + zoom.toFixed(2) +
            ' bounds=' + Math.round(treeW) + 'x' + Math.round(treeH) +
            ' center=' + Math.round(centerX) + ',' + Math.round(centerY));
    },

    // =========================================================================
    // PYTHON STATUS INTEGRATION
    // =========================================================================

    /**
     * Called when Python environment status changes.
     *
     * @param {boolean} installed - Whether Python is installed and usable
     * @param {boolean} hasScript - Whether the growth script exists
     * @param {boolean} hasPython - Whether the Python binary is available
     */
    onPythonStatusChanged: function (installed, hasScript, hasPython) {
        this._pythonInstalled = installed;
        ClassicSettings.updatePythonStatus(installed, hasScript, hasPython);
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
    TreeGrowth.registerMode('classic', TreeGrowthClassic);
}
