/**
 * Tree Viewer UI Module
 * Handles spell tree visualization and node selection/interaction
 * 
 * Depends on:
 * - modules/state.js (state, settings)
 * - modules/wheelRenderer.js (WheelRenderer)
 * - modules/treeParser.js (TreeParser)
 * - modules/colorUtils.js (getOrAssignSchoolColor)
 * - modules/uiHelpers.js (updateStatus)
 * 
 * Exports (global):
 * - initializeTreeViewer()
 * - showSpellDetails()
 * - updateSpellDetails()
 * - updateDetailsProgression()
 * - selectSpellNode()
 */

// =============================================================================
// NODE LOOKUP CACHE — O(1) node-by-id lookup instead of O(n) Array.find()
// =============================================================================

/**
 * Cached map of { formId/id: node } built once per tree load.
 * Invalidated when _nodeLookupVersion !== current tree version.
 */
var _nodeLookupMap = {};
var _nodeLookupVersion = -1;
var _nodeLookupTreeRef = null;

/**
 * Returns a node lookup map { id: node } for the current tree data.
 * Rebuilds the cache only when the tree data reference changes.
 */
function _getNodeLookupMap() {
    var treeData = state.treeData;
    if (!treeData || !treeData.nodes) {
        return {};
    }
    // Rebuild if the tree data reference changed (new tree loaded)
    if (treeData !== _nodeLookupTreeRef) {
        _nodeLookupMap = {};
        var nodes = treeData.nodes;
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.id) _nodeLookupMap[n.id] = n;
            // Also index by formId if different from id
            if (n.formId && n.formId !== n.id) _nodeLookupMap[n.formId] = n;
        }
        _nodeLookupTreeRef = treeData;
        console.log('[NodeLookup] Rebuilt cache: ' + Object.keys(_nodeLookupMap).length + ' entries');
    }
    return _nodeLookupMap;
}

/**
 * Look up a node by its id/formId in O(1).
 * Falls back to null if not found.
 */
function _findNodeById(id) {
    var map = _getNodeLookupMap();
    return map[id] || null;
}

// =============================================================================
// TREE VIEWER
// =============================================================================

// Smart renderer - auto-selects best renderer based on node count
// Tiers: SVG (<200), Canvas 2D (200+)
var SmartRenderer = {
    activeRenderer: 'canvas',  // 'svg' or 'canvas' — matches forceRenderer default

    // Thresholds for renderer selection
    svgThreshold: 200,      // Use SVG below this, Canvas 2D above

    // Force a specific renderer (set to null for auto)
    forceRenderer: 'canvas',    // FORCED: Always use Canvas 2D for best performance

    /**
     * Select the best renderer for given node count
     * @param {number} nodeCount
     * @returns {string} 'svg' or 'canvas'
     */
    selectRenderer: function(nodeCount) {
        if (this.forceRenderer) {
            if (this.forceRenderer === 'canvas' && typeof CanvasRenderer !== 'undefined') {
                return 'canvas';
            } else if (this.forceRenderer === 'svg') {
                return 'svg';
            }
        }

        if (nodeCount > this.svgThreshold && typeof CanvasRenderer !== 'undefined') {
            return 'canvas';
        }

        return 'svg';
    },

    setData: function(nodes, edges, schools) {
        var nodeCount = nodes ? nodes.length : 0;
        var targetRenderer = this.selectRenderer(nodeCount);

        console.log('[SmartRenderer] setData: ' + nodeCount + ' nodes -> ' + targetRenderer + ' mode');

        var container = document.getElementById('tree-container');
        if (!container) {
            console.error('[SmartRenderer] tree-container not found!');
            return;
        }

        this.hideAll();

        if (targetRenderer === 'canvas' && typeof CanvasRenderer !== 'undefined') {
            if (!CanvasRenderer.container || CanvasRenderer.container !== container) {
                CanvasRenderer.init(container);
            }

            this.activeRenderer = 'canvas';
            CanvasRenderer.clear();
            CanvasRenderer.setData(nodes, edges, schools);
            CanvasRenderer.show();
            CanvasRenderer.centerView();
            CanvasRenderer.forceRender();
            this.updateRendererBadge();
            console.log('[SmartRenderer] Canvas render triggered with ' + nodeCount + ' nodes');
            return;
        }

        this.activeRenderer = 'svg';
        WheelRenderer.setData(nodes, edges, schools);
        this.updateRendererBadge();
        console.log('[SmartRenderer] SVG render triggered with ' + nodeCount + ' nodes');
    },

    hideAll: function() {
        if (typeof CanvasRenderer !== 'undefined' && CanvasRenderer.canvas) {
            CanvasRenderer.hide();
        }
        WheelRenderer.clear();
    },

    render: function() {
        if (this.activeRenderer === 'canvas') {
            if (typeof CanvasRenderer !== 'undefined') CanvasRenderer.forceRender();
        } else {
            WheelRenderer.render();
        }
    },

    clear: function() {
        this.hideAll();
        this.activeRenderer = 'svg';
    },

    setZoom: function(z) {
        if (this.activeRenderer === 'canvas') {
            if (typeof CanvasRenderer !== 'undefined') CanvasRenderer.setZoom(z);
        } else {
            WheelRenderer.setZoom(z);
        }
    },

    centerView: function() {
        if (this.activeRenderer === 'canvas') {
            if (typeof CanvasRenderer !== 'undefined') CanvasRenderer.centerView();
        } else {
            WheelRenderer.centerView();
        }
    },

    getZoom: function() {
        if (this.activeRenderer === 'canvas') {
            if (typeof CanvasRenderer !== 'undefined') return CanvasRenderer.zoom;
        }
        return WheelRenderer.zoom;
    },

    /**
     * Get current renderer info for debugging
     */
    getInfo: function() {
        return {
            active: this.activeRenderer,
            forced: this.forceRenderer,
            canvasAvailable: typeof CanvasRenderer !== 'undefined',
            rendererName: 'CanvasRenderer'
        };
    },

    /**
     * Refresh the active renderer when node states change
     * Call this after spell unlock/progression changes
     */
    refresh: function() {
        if (this.activeRenderer === 'canvas') {
            if (typeof CanvasRenderer !== 'undefined') CanvasRenderer.refresh();
        } else {
            WheelRenderer.render();
        }
    },

    /**
     * Update the renderer badge UI to show current renderer
     */
    updateRendererBadge: function() {
        var badge = document.getElementById('renderer-badge');
        if (!badge) return;

        badge.classList.remove('svg', 'canvas');
        var renderer = this.activeRenderer.toUpperCase();
        badge.textContent = renderer;
        badge.classList.add(this.activeRenderer);
        badge.title = 'Renderer: ' + renderer +
            (this.activeRenderer === 'canvas' ? ' (Canvas 2D)' : ' (SVG DOM)');
    }
};

// Export SmartRenderer
window.SmartRenderer = SmartRenderer;

function initializeTreeViewer() {
    var svg = document.getElementById('tree-svg');
    if (!svg) return;

    WheelRenderer.init(svg);

    // Initialize canvas renderer
    var container = document.getElementById('tree-container');
    if (container && typeof CanvasRenderer !== 'undefined') {
        CanvasRenderer.init(container);
        console.log('[TreeViewer] CanvasRenderer ready');
    }
    
    state.treeInitialized = true;

    // Update renderer badge to reflect actual renderer (defaults to canvas)
    SmartRenderer.updateRendererBadge();

    // Zoom controls - use SmartRenderer for auto renderer selection
    document.getElementById('zoom-in').addEventListener('click', function() {
        SmartRenderer.setZoom(SmartRenderer.getZoom() + TREE_CONFIG.zoom.step);
    });
    document.getElementById('zoom-out').addEventListener('click', function() {
        SmartRenderer.setZoom(SmartRenderer.getZoom() - TREE_CONFIG.zoom.step);
    });
    
    // Import buttons
    var importTreeBtn = document.getElementById('import-tree-btn');
    var loadSavedBtn = document.getElementById('load-saved-btn');
    var importBtn = document.getElementById('import-btn');
    var llmAutoBtn = document.getElementById('llm-auto-btn');
    var llmToolbarBtn = document.getElementById('llm-toolbar-btn');

    if (importTreeBtn) importTreeBtn.addEventListener('click', showImportModal);
    if (loadSavedBtn) loadSavedBtn.addEventListener('click', loadSavedTree);
    var goToScannerBtn = document.getElementById('go-to-scanner-btn');
    if (goToScannerBtn) goToScannerBtn.addEventListener('click', function() { switchTab('spellScan'); });
    if (importBtn) importBtn.addEventListener('click', showImportModal);
    if (llmAutoBtn) llmAutoBtn.addEventListener('click', startLLMAutoGenerate);
    if (llmToolbarBtn) llmToolbarBtn.addEventListener('click', startLLMAutoGenerate);
    
    // Save/Reload/Clear tree buttons (cheat mode only)
    var clearTreeBtn = document.getElementById('clear-tree-btn');
    var saveTreeBtn = document.getElementById('save-tree-btn');
    var reloadTreeBtn = document.getElementById('reload-tree-btn');
    
    if (clearTreeBtn) {
        clearTreeBtn.addEventListener('click', function() {
            // Double-click protection: require two clicks within 2 seconds
            if (!state.clearTreePending) {
                state.clearTreePending = true;
                clearTreeBtn.innerHTML = '<span class="btn-icon">âš ï¸</span> Click Again to Confirm';
                clearTreeBtn.classList.add('btn-warning');
                setTimeout(function() {
                    state.clearTreePending = false;
                    clearTreeBtn.innerHTML = '<span class="btn-icon">ðŸ—‘ï¸</span> Clear Tree';
                    clearTreeBtn.classList.remove('btn-warning');
                }, 2000);
            } else {
                state.clearTreePending = false;
                clearTreeBtn.innerHTML = '<span class="btn-icon">ðŸ—‘ï¸</span> Clear Tree';
                clearTreeBtn.classList.remove('btn-warning');
                clearTree();
            }
        });
    }
    
    if (saveTreeBtn) {
        saveTreeBtn.addEventListener('click', function() {
            if (saveTreeToFile()) {
                setTreeStatus(t('status.treeSaved'));
            } else {
                setTreeStatus(t('status.noTreeData'));
            }
        });
    }
    
    if (reloadTreeBtn) {
        reloadTreeBtn.addEventListener('click', function() {
            loadSavedTree();
        });
    }
    
    // Check if LLM is available on init
    checkLLMAvailability();
    
    // Modal controls
    var modalCloseBtn = document.getElementById('modal-close-btn');
    var importCancel = document.getElementById('import-cancel');
    var importConfirm = document.getElementById('import-confirm');
    var pasteTreeBtn = document.getElementById('paste-tree-btn');
    var modalBackdrop = document.querySelector('.modal-backdrop');
    
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideImportModal);
    if (importCancel) importCancel.addEventListener('click', hideImportModal);
    if (pasteTreeBtn) pasteTreeBtn.addEventListener('click', onPasteTreeClick);
    if (importConfirm) importConfirm.addEventListener('click', importTreeFromModal);
    if (modalBackdrop) modalBackdrop.addEventListener('click', hideImportModal);
    
    // Details panel
    window.addEventListener('nodeSelected', function(e) { showSpellDetails(e.detail); });
    
    var closeDetails = document.getElementById('close-details');
    if (closeDetails) closeDetails.addEventListener('click', function() {
        document.getElementById('details-panel').classList.add('hidden');
    });
    
    // How-to-Learn panel
    initializeHowToPanel();
    
    // Learn button - set learning target
    var learnBtn = document.getElementById('learn-btn');
    if (learnBtn) learnBtn.addEventListener('click', onLearnClick);
    
    // Unlock button - unlock spell when XP is ready
    var unlockBtn = document.getElementById('unlock-btn');
    if (unlockBtn) unlockBtn.addEventListener('click', onUnlockClick);
    
    // Clickable prereqs/unlocks
    var prereqList = document.getElementById('spell-prereqs');
    var unlocksList = document.getElementById('spell-unlocks');
    var hardPrereqsList = document.getElementById('hard-prereqs-list');
    var softPrereqsList = document.getElementById('soft-prereqs-list');
    
    // Handler that only selects if spell name is revealed (not ???)
    function handlePrereqClick(e) {
        if (e.target.tagName === 'LI') {
            var id = e.target.dataset.id;
            var text = e.target.textContent.replace(/^[✓✗]\s*/, '').trim();
            // Only navigate if the name is revealed (not hidden as ???)
            if (id && text !== '???' && text.indexOf('???') === -1) {
                selectNodeById(id);
            }
        }
    }
    
    if (prereqList) prereqList.addEventListener('click', handlePrereqClick);
    if (unlocksList) unlocksList.addEventListener('click', handlePrereqClick);
    if (hardPrereqsList) hardPrereqsList.addEventListener('click', handlePrereqClick);
    if (softPrereqsList) softPrereqsList.addEventListener('click', handlePrereqClick);
}

function showImportModal() {
    var modal = document.getElementById('import-modal');
    if (modal) modal.classList.remove('hidden');
    var errorBox = document.getElementById('import-error');
    if (errorBox) errorBox.classList.add('hidden');

    // Pre-fill with current tree JSON
    var textarea = document.getElementById('import-textarea');
    if (textarea && state.treeData && state.treeData.rawData) {
        textarea.value = JSON.stringify(state.treeData.rawData, null, 2);
    }
}

function hideImportModal() {
    var modal = document.getElementById('import-modal');
    if (modal) modal.classList.add('hidden');
}

function loadSavedTree() {
    if (window.callCpp) {
        window.callCpp('LoadSpellTree', '');
        setTreeStatus(t('status.loadingSavedTree'));
    } else {
        setTreeStatus(t('status.noSavedTree'));
    }
}

function importTreeFromModal() {
    var textarea = document.getElementById('import-textarea');
    var text = textarea ? textarea.value.trim() : '';
    if (!text) {
        showImportError(t('status.noJsonToSave'));
        return;
    }

    // Step 1: Parse JSON
    var data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        showImportError(t('status.invalidJson', {error: e.message}));
        return;
    }

    // Step 2: Validate through TreeParser
    var parsed = TreeParser.parse(data);
    if (!parsed.success) {
        showImportError(t('status.treeValidationFailed', {error: parsed.error || 'Unknown error'}));
        return;
    }

    // Step 3: Load the validated tree
    loadTreeData(data, true, true);
    hideImportModal();
    setTreeStatus(t('status.treeSavedCount', {count: parsed.nodes.length}));

    // Save to file via C++
    if (window.callCpp) {
        window.callCpp('SaveSpellTree', JSON.stringify(data));
    }
}

/**
 * Simple deep copy for plain data objects (no functions, no circular refs).
 * Avoids the overhead of JSON.parse(JSON.stringify()) serialization round-trip.
 */
function _deepCopyPlain(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        var arrCopy = [];
        for (var i = 0; i < obj.length; i++) {
            arrCopy[i] = _deepCopyPlain(obj[i]);
        }
        return arrCopy;
    }
    var objCopy = {};
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
            objCopy[key] = _deepCopyPlain(obj[key]);
        }
    }
    return objCopy;
}

function mergeTreeData(existing, newData) {
    // Create a deep copy of existing data
    var merged = _deepCopyPlain(existing);

    if (!merged.schools) merged.schools = {};
    
    // Merge each school from new data
    for (var schoolName in newData.schools) {
        var newSchool = newData.schools[schoolName];
        
        if (!merged.schools[schoolName]) {
            // School doesn't exist, add it entirely
            merged.schools[schoolName] = newSchool;
            console.log('[Merge] Added new school: ' + schoolName + ' (layout: ' + (newSchool.layoutStyle || 'radial') + ')');
        } else {
            // School exists, merge nodes
            var existingSchool = merged.schools[schoolName];
            
            // Update layoutStyle if new data provides one
            if (newSchool.layoutStyle && !existingSchool.layoutStyle) {
                existingSchool.layoutStyle = newSchool.layoutStyle;
                console.log('[Merge] Updated ' + schoolName + ' layout style: ' + newSchool.layoutStyle);
            }
            var existingNodeIds = {};
            var existingNodeMap = {};
            for (var ei = 0; ei < existingSchool.nodes.length; ei++) {
                var eNodeId = existingSchool.nodes[ei].formId || existingSchool.nodes[ei].spellId;
                existingNodeIds[eNodeId] = true;
                existingNodeMap[eNodeId] = existingSchool.nodes[ei];
            }

            var addedCount = 0;
            newSchool.nodes.forEach(function(newNode) {
                var nodeId = newNode.formId || newNode.spellId;
                if (!existingNodeIds[nodeId]) {
                    existingSchool.nodes.push(newNode);
                    addedCount++;
                } else {
                    // Node exists - update children/prerequisites if new ones exist
                    var existingNode = existingNodeMap[nodeId];
                    if (existingNode && newNode.children) {
                        if (!existingNode.children) existingNode.children = [];
                        var childrenSeen = {};
                        for (var ci = 0; ci < existingNode.children.length; ci++) {
                            childrenSeen[existingNode.children[ci]] = true;
                        }
                        newNode.children.forEach(function(childId) {
                            if (!childrenSeen[childId]) {
                                childrenSeen[childId] = true;
                                existingNode.children.push(childId);
                            }
                        });
                    }
                    if (existingNode && newNode.prerequisites) {
                        if (!existingNode.prerequisites) existingNode.prerequisites = [];
                        var prereqsSeen = {};
                        for (var pri = 0; pri < existingNode.prerequisites.length; pri++) {
                            prereqsSeen[existingNode.prerequisites[pri]] = true;
                        }
                        newNode.prerequisites.forEach(function(prereqId) {
                            if (!prereqsSeen[prereqId]) {
                                prereqsSeen[prereqId] = true;
                                existingNode.prerequisites.push(prereqId);
                            }
                        });
                    }
                }
            });
            console.log('[Merge] ' + schoolName + ': added ' + addedCount + ' new nodes');
        }
    }
    
    // Update timestamp
    merged.generatedAt = new Date().toISOString();
    merged.version = merged.version || '1.0';
    
    return merged;
}

function showImportError(msg) {
    var errorBox = document.getElementById('import-error');
    if (errorBox) {
        errorBox.textContent = msg;
        errorBox.classList.remove('hidden');
    }
}

/** Log to both console and spelllearning.log via C++. */
function _logToSKSE(msg) {
    console.log(msg);
    if (window.callCpp) {
        try {
            window.callCpp('LogMessage', JSON.stringify({ message: msg, level: 'info' }));
        } catch (e) { /* ignore */ }
    }
}

/**
 * Fast path for trustPrereqs data — builds nodes/edges/schools directly
 * from JSON and sends to TrustedRenderer. No TreeParser, no WheelRenderer,
 * no CanvasRenderer, no layout logic, no prereq mutations.
 */
function _loadTrustedTree(data, switchToTreeTab) {
    _logToSKSE('[_loadTrustedTree] === ENTRY ===');
    _logToSKSE('[_loadTrustedTree] trustPrereqs=' + data.trustPrereqs +
               ', schools=' + Object.keys(data.schools || {}).join(','));

    var nodes = [];
    var edges = [];
    var schools = {};
    var allFormIds = [];
    var rootIds = {};
    var nodesWithXY = 0;
    var nodesWithoutXY = 0;

    for (var schoolName in data.schools) {
        if (!data.schools.hasOwnProperty(schoolName)) continue;
        var sd = data.schools[schoolName];
        var schoolNodes = sd.nodes || [];

        _logToSKSE('[_loadTrustedTree] School "' + schoolName + '": ' +
                   schoolNodes.length + ' nodes, root=' + sd.root +
                   ', color=' + sd.color + ', spokeAngle=' + sd.spokeAngle);

        // Filter out NaN angles — let CanvasRendererV2 compute from node positions instead
        var validSpoke = (sd.spokeAngle !== undefined && !isNaN(sd.spokeAngle));
        var validStart = (sd.startAngle !== undefined && !isNaN(sd.startAngle));
        var validEnd = (sd.endAngle !== undefined && !isNaN(sd.endAngle));

        schools[schoolName] = {
            root: sd.root,
            nodeIds: [],
            spokeAngle: validSpoke ? sd.spokeAngle : undefined,
            startAngle: validStart ? sd.startAngle : undefined,
            endAngle: validEnd ? sd.endAngle : undefined,
            angleSpan: (validEnd && validStart) ? sd.endAngle - sd.startAngle : undefined,
            color: sd.color,
            layoutStyle: sd.layoutStyle || 'tree'
        };

        rootIds[sd.root] = true;

        for (var i = 0; i < schoolNodes.length; i++) {
            var nd = schoolNodes[i];
            var id = nd.formId;
            allFormIds.push(id);
            schools[schoolName].nodeIds.push(id);

            // Use explicit undefined check — nd.x || 0 would lose x=0 values
            var nx = (nd.x !== undefined && nd.x !== null) ? nd.x : 0;
            var ny = (nd.y !== undefined && nd.y !== null) ? nd.y : 0;

            // Track position stats
            if (nd.x !== undefined && nd.x !== null) {
                nodesWithXY++;
            } else {
                nodesWithoutXY++;
            }

            // Log first 3 nodes per school
            if (i < 3) {
                _logToSKSE('[_loadTrustedTree]   node[' + i + ']: formId=' + id +
                           ', raw x=' + nd.x + ', raw y=' + nd.y +
                           ', used x=' + nx + ', used y=' + ny +
                           ', name=' + (nd.name || '?') + ', tier=' + nd.tier);
            }

            // Compute hard/soft prereqs using same fallback as loadTreeData
            var _hardPrereqs = nd.hardPrereqs || [];
            var _softPrereqs = nd.softPrereqs || [];
            var _softNeeded = nd.softNeeded || 0;
            if (_hardPrereqs.length === 0 && _softPrereqs.length === 0) {
                var _prereqs = nd.prerequisites || [];
                if (_prereqs.length === 1) {
                    _hardPrereqs = _prereqs.slice();
                } else if (_prereqs.length > 1) {
                    _hardPrereqs = [_prereqs[0]];
                    _softPrereqs = _prereqs.slice(1);
                    _softNeeded = 1;
                }
            }

            var node = {
                id: id,
                formId: id,
                name: nd.name || null,
                school: schoolName,
                children: nd.children || [],
                prerequisites: nd.prerequisites || [],
                hardPrereqs: _hardPrereqs,
                softPrereqs: _softPrereqs,
                softNeeded: _softNeeded,
                tier: nd.tier || 0,
                depth: nd.tier || 0,
                x: nx,
                y: ny,
                isRoot: nd.isRoot || false,
                _fromLayoutEngine: true,
                state: 'locked'
            };

            // Roots and prereq-less nodes are available
            if (nd.isRoot || !nd.prerequisites || nd.prerequisites.length === 0) {
                node.state = 'available';
            }

            nodes.push(node);

            // Build edges from children
            var ch = nd.children || [];
            for (var c = 0; c < ch.length; c++) {
                edges.push({ from: id, to: ch[c] });
            }
        }
    }

    _logToSKSE('[_loadTrustedTree] TOTALS: ' + nodes.length + ' nodes, ' +
               edges.length + ' edges, ' + Object.keys(schools).length + ' schools');
    _logToSKSE('[_loadTrustedTree] POSITIONS: withXY=' + nodesWithXY +
               ', withoutXY=' + nodesWithoutXY);

    // Store for state tracking
    state.treeData = {
        nodes: nodes,
        edges: edges,
        schools: schools,
        allFormIds: allFormIds,
        rawData: data,
        globe: data.globe
            ? { x: data.globe.x || 0, y: data.globe.y || 0, radius: data.globe.radius || 45 }
            : { x: 0, y: 0, radius: 45 }
    };

    // Use CanvasRendererV2 — nodes already have _fromLayoutEngine flag so spiral fallback won't trigger
    if (typeof CanvasRenderer !== 'undefined') {
        _logToSKSE('[_loadTrustedTree] Using CanvasRendererV2 with baked positions, noRotate=' + !!data.noRotate);
        var container = document.getElementById('tree-container');
        if (container) {
            // Hide TrustedRenderer if it was previously shown
            if (typeof TrustedRenderer !== 'undefined' && TrustedRenderer.canvas) {
                TrustedRenderer.hide();
            }
            if (!CanvasRenderer.container || CanvasRenderer.container !== container) {
                CanvasRenderer.init(container);
            }
            CanvasRenderer.clear();
            var isFlat = !!data.noRotate || (data.config && data.config.layoutMode === 'flat') || data.layoutMode === 'flat';
            CanvasRenderer.noRotate = isFlat;
            CanvasRenderer.setData(nodes, edges, schools);
            CanvasRenderer.show();
            CanvasRenderer.centerView();
            CanvasRenderer.forceRender();
        }
    } else {
        _logToSKSE('[_loadTrustedTree] FALLBACK: No CanvasRenderer, using TrustedRenderer');
        var container2 = document.getElementById('tree-container');
        if (container2 && typeof TrustedRenderer !== 'undefined') {
            TrustedRenderer.init(container2);
            TrustedRenderer.setData(nodes, edges, schools);
            TrustedRenderer.show();
        }
    }

    // Update UI
    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.add('hidden');
    document.getElementById('total-count').textContent = nodes.length;
    document.getElementById('unlocked-count').textContent = '0';

    if (switchToTreeTab !== false) {
        switchTab('spellTree');
    }

    // Mirror bidirectional soft prereqs — DISABLED for now
    // mirrorBidirectionalSoftPrereqs(nodes);

    // Send prereqs to C++ (already baked, no splitting needed)
    if (window.callCpp) {
        var prereqData = [];
        for (var pi = 0; pi < nodes.length; pi++) {
            prereqData.push({
                formId: nodes[pi].formId,
                hardPrereqs: nodes[pi].hardPrereqs,
                softPrereqs: nodes[pi].softPrereqs,
                softNeeded: nodes[pi].softNeeded
            });
        }
        window.callCpp('SetTreePrerequisites', JSON.stringify({ clear: true }));
        window.callCpp('SetTreePrerequisites', JSON.stringify(prereqData));
    }

    // Request spell names for display
    SpellCache.requestBatch(allFormIds, function() {
        for (var si = 0; si < nodes.length; si++) {
            TreeParser.updateNodeFromCache(nodes[si]);
        }
        if (typeof CanvasRenderer !== 'undefined') {
            CanvasRenderer._needsRender = true;
        }
    });

    // Sync progress
    if (window.callCpp) {
        window.callCpp('GetProgress', '');
        window.callCpp('GetPlayerKnownSpells', '');
    }

    _logToSKSE('[_loadTrustedTree] === DONE ===');
    setTreeStatus(t('status.loadedTrustedTree', {count: nodes.length}));
}

/**
 * Mirror bidirectional soft prerequisites.
 * When A is a soft prereq of B, makes B a soft prereq of A too.
 * Skips nodes where softNeeded === softPrereqs.length (all required = effectively hard).
 * Modifies nodes in-place. Returns count of mirrors added.
 */
function mirrorBidirectionalSoftPrereqs(nodes) {
    if (!settings.treeGeneration.bidirectionalSoftPrereqs) return 0;

    // Build nodeMap for O(1) lookup
    var nodeMap = {};
    for (var i = 0; i < nodes.length; i++) {
        var fid = nodes[i].formId || nodes[i].id;
        if (fid) nodeMap[fid] = nodes[i];
    }

    // Collect mirrors to apply (avoid cascading during iteration)
    var mirrors = [];

    for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        var softPrereqs = node.softPrereqs;
        if (!softPrereqs || softPrereqs.length === 0) continue;

        var nodeFormId = node.formId || node.id;

        for (var s = 0; s < softPrereqs.length; s++) {
            var targetNode = nodeMap[softPrereqs[s]];
            if (!targetNode) continue;

            // Don't mirror onto root/prereq-free nodes (would deadlock entry points)
            if (targetNode.isRoot) continue;
            var targetHasPrereqs = (targetNode.hardPrereqs && targetNode.hardPrereqs.length > 0) ||
                                   (targetNode.softPrereqs && targetNode.softPrereqs.length > 0) ||
                                   (targetNode.prerequisites && targetNode.prerequisites.length > 0);
            if (!targetHasPrereqs) continue;

            // Check if target already has this node in hard or soft prereqs
            var alreadyExists = false;

            var targetHard = targetNode.hardPrereqs || [];
            for (var h = 0; h < targetHard.length; h++) {
                if (targetHard[h] === nodeFormId) { alreadyExists = true; break; }
            }

            if (!alreadyExists) {
                var targetSoft = targetNode.softPrereqs || [];
                for (var ts = 0; ts < targetSoft.length; ts++) {
                    if (targetSoft[ts] === nodeFormId) { alreadyExists = true; break; }
                }
            }

            if (!alreadyExists) {
                mirrors.push({ target: targetNode, addFormId: nodeFormId });
            }
        }
    }

    // Build a set of legacy prerequisite ids per target for O(1) duplicate check
    var targetLegacySets = {};
    for (var m = 0; m < mirrors.length; m++) {
        var target = mirrors[m].target;
        var addId = mirrors[m].addFormId;
        var targetId = target.formId || target.id;

        if (!target.hardPrereqs) target.hardPrereqs = [];
        if (!target.softPrereqs) target.softPrereqs = [];
        if (!target.prerequisites) target.prerequisites = [];

        target.softPrereqs.push(addId);

        // Ensure softNeeded is at least 1
        if (!target.softNeeded || target.softNeeded < 1) {
            target.softNeeded = 1;
        }

        // Build legacy set on first encounter of this target
        if (!targetLegacySets[targetId]) {
            targetLegacySets[targetId] = {};
            for (var lp = 0; lp < target.prerequisites.length; lp++) {
                targetLegacySets[targetId][target.prerequisites[lp]] = true;
            }
        }

        // Add to legacy prerequisites array for compatibility (O(1) check)
        if (!targetLegacySets[targetId][addId]) {
            targetLegacySets[targetId][addId] = true;
            target.prerequisites.push(addId);
        }
    }

    if (mirrors.length > 0) {
        console.log('[SpellLearning] Bidirectional soft prereqs: mirrored ' + mirrors.length + ' connections');
        // Log first few for debugging
        for (var d = 0; d < Math.min(5, mirrors.length); d++) {
            var dbgTarget = mirrors[d].target;
            console.log('[SpellLearning]   mirror: ' + mirrors[d].addFormId + ' -> ' +
                        (dbgTarget.formId || dbgTarget.id) +
                        ' (softPrereqs now: ' + (dbgTarget.softPrereqs ? dbgTarget.softPrereqs.length : 0) +
                        ', softNeeded: ' + dbgTarget.softNeeded + ')');
        }
    } else {
        console.log('[SpellLearning] Bidirectional soft prereqs: 0 mirrors (no eligible soft prereqs found)');
    }

    return mirrors.length;
}

function loadTreeData(jsonData, switchToTreeTab, isManualImport) {
    var data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

    _logToSKSE('[loadTreeData] === ENTRY === typeof=' + (typeof jsonData) +
               ', trustPrereqs=' + data.trustPrereqs +
               ', isManualImport=' + isManualImport +
               ', keys=' + Object.keys(data).join(','));

    // =====================================================================
    // FAST PATH: trustPrereqs data bypasses TreeParser entirely.
    // Positions, prereqs, and edges are authoritative — no mutations.
    // Also detect if nodes have x/y even without the flag (old saves).
    // =====================================================================
    var hasTrustFlag = !!data.trustPrereqs;
    var hasNodePositions = false;
    if (!hasTrustFlag && data.schools) {
        // Check first school's first node for x/y
        for (var _sk in data.schools) {
            if (data.schools.hasOwnProperty(_sk)) {
                var _sn = data.schools[_sk].nodes;
                if (_sn && _sn.length > 0 && _sn[0].x !== undefined) {
                    hasNodePositions = true;
                    _logToSKSE('[loadTreeData] No trustPrereqs flag but nodes have x/y — using fast path');
                }
                break;
            }
        }
    }

    if (hasTrustFlag || hasNodePositions) {
        _logToSKSE('[loadTreeData] FAST PATH — bypassing TreeParser (trust=' + hasTrustFlag + ', hasPos=' + hasNodePositions + ')');
        _loadTrustedTree(data, switchToTreeTab);
        return;
    }

    _logToSKSE('[loadTreeData] SLOW PATH — going through TreeParser (no positions in data)');

    var result = TreeParser.parse(jsonData);
    if (!result.success) {
        showImportError(result.error);
        return;
    }

    // DIAGNOSTIC: Check nodes after TreeParser
    console.log('[loadTreeData] === DIAGNOSTIC: After TreeParser.parse ===');
    var nodesArray = Array.from(result.nodes.values());
    var nodesWithVisualFirst = nodesArray.filter(function(n) { return n._fromVisualFirst; });
    var nodesWithXY = nodesArray.filter(function(n) { return n.x !== 0 || n.y !== 0; });
    var nodesWithChildren = nodesArray.filter(function(n) { return n.children && n.children.length > 0; });

    // Check depth distribution
    var depthCounts = {};
    nodesArray.forEach(function(n) {
        var d = n.depth || 0;
        depthCounts[d] = (depthCounts[d] || 0) + 1;
    });

    console.log('[loadTreeData] Total nodes:', nodesArray.length);
    console.log('[loadTreeData] Nodes with _fromVisualFirst:', nodesWithVisualFirst.length);
    console.log('[loadTreeData] Nodes with non-zero x/y:', nodesWithXY.length);
    console.log('[loadTreeData] Nodes with children:', nodesWithChildren.length);
    console.log('[loadTreeData] Depth distribution:', JSON.stringify(depthCounts));

    if (nodesArray.length > 0) {
        var sample = nodesArray[0];
        console.log('[loadTreeData] Sample node: x=' + sample.x + ', y=' + sample.y +
                    ', depth=' + sample.depth + ', tier=' + sample.tier +
                    ', children=' + (sample.children ? sample.children.length : 0) +
                    ', _fromVisualFirst=' + sample._fromVisualFirst);

        // Find root node and log its children
        var rootNode = nodesArray.find(function(n) { return n.isRoot; });
        if (rootNode) {
            console.log('[loadTreeData] ROOT: id=' + rootNode.id +
                        ', depth=' + rootNode.depth +
                        ', children=' + (rootNode.children ? rootNode.children.length : 0));
        }
    }

    // Store raw data for future merges
    result.rawData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    var rawGlobe = result.rawData ? result.rawData.globe : null;
    result.globe = rawGlobe
        ? { x: rawGlobe.x || 0, y: rawGlobe.y || 0, radius: rawGlobe.radius || 45 }
        : { x: 0, y: 0, radius: 45 };
    state.treeData = result;
    
    // AGGRESSIVE PATH VALIDATION for manual imports
    // Runs path check (no AI self-correction, no procedural injection)
    if (isManualImport && settings.aggressivePathValidation) {
        console.log('[SpellLearning] Running path validation on imported tree...');
        var totalProblems = 0;

        for (var schoolName in TreeParser.schools) {
            var schoolData = TreeParser.schools[schoolName];
            if (schoolData && schoolData.root) {
                var problems = TreeParser.detectAndFixCycles(schoolName, schoolData.root);
                if (problems > 0) {
                    totalProblems += problems;
                    console.log('[SpellLearning] ' + schoolName + ': ' + problems + ' unreachable spells');
                }
            }
        }

        if (totalProblems > 0) {
            console.log('[SpellLearning] Validation found ' + totalProblems + ' unreachable spells - regenerate tree');
            setTreeStatus(t('status.warningUnreachable', {count: totalProblems}));
        }
    }
    
    // Clean up self-references in prerequisites (LLM sometimes generates these incorrectly)
    var selfRefCount = 0;
    result.nodes.forEach(function(node) {
        if (node.prerequisites && node.prerequisites.length > 0) {
            var originalLen = node.prerequisites.length;
            node.prerequisites = node.prerequisites.filter(function(prereqId) {
                // Remove if prereq is this node itself
                return prereqId !== node.id && prereqId !== node.formId;
            });
            if (node.prerequisites.length < originalLen) {
                selfRefCount++;
                console.warn('[SpellLearning] Removed self-reference prerequisite from ' + (node.name || node.id));
            }
        }
    });
    if (selfRefCount > 0) {
        console.log('[SpellLearning] Fixed ' + selfRefCount + ' nodes with self-referencing prerequisites');
    }
    
    // IMPORTANT: Reset all node states to locked/available on load
    // Don't use saved states from file - those are stale
    // States will be updated after player loads into a save game
    
    // Get root nodes for each school
    var rootIds = new Set();
    for (var schoolName in result.schools) {
        var schoolData = result.schools[schoolName];
        if (schoolData.root) {
            rootIds.add(schoolData.root);
        }
    }
    
    result.nodes.forEach(function(node) {
        // Root nodes are always AVAILABLE (learnable starting points, not auto-unlocked)
        // They need to be learned like any other spell, but are always accessible
        if (rootIds.has(node.id) || rootIds.has(node.formId)) {
            node.state = 'available';
            console.log('[SpellLearning] Root node marked available: ' + (node.name || node.id));
        }
        // Nodes with no prerequisites are available (shouldn't happen except for roots)
        else if (!node.prerequisites || node.prerequisites.length === 0) {
            node.state = 'available';
        }
        // Everything else starts locked (children of roots remain locked until root is learned)
        else {
            node.state = 'locked';
        }
    });
    
    // NOTE: Children of root nodes stay LOCKED until root is actually learned (unlocked)
    // The onPlayerKnownSpells callback will mark nodes as 'unlocked' when player has them,
    // and recalculateNodeAvailability will then unlock their children
    
    var stateCount = { unlocked: 0, available: 0, locked: 0 };
    result.nodes.forEach(function(n) { stateCount[n.state] = (stateCount[n.state] || 0) + 1; });
    console.log('[SpellLearning] Tree loaded - states: unlocked=' + stateCount.unlocked + 
                ', available=' + stateCount.available + ', locked=' + stateCount.locked);
    
    // Pass school configs and LLM groups to renderer for visual styling
    var rawData = result.rawData || jsonData;
    if (typeof rawData === 'string') rawData = JSON.parse(rawData);
    
    if (rawData.school_configs) {
        WheelRenderer.setSchoolConfigs(rawData.school_configs);
    }
    if (rawData.llm_groups) {
        WheelRenderer.setLLMGroups(rawData.llm_groups);
    }
    
    // Request spell data for all formIds
    SpellCache.requestBatch(result.allFormIds, function() {
        result.nodes.forEach(function(node) {
            TreeParser.updateNodeFromCache(node);
        });
        SmartRenderer.setData(result.nodes, result.edges, result.schools);
        setTreeStatus('Loaded ' + result.nodes.length + ' spells' + 
            (SmartRenderer.activeRenderer === 'canvas' ? ' (Canvas mode)' : ''));
    });

    // Initial render - use SmartRenderer to auto-switch based on node count
    SmartRenderer.setData(result.nodes, result.edges, result.schools);
    
    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.add('hidden');
    
    document.getElementById('total-count').textContent = result.nodes.length;
    document.getElementById('unlocked-count').textContent = '0';  // Always 0 on load - will be updated after save loads
    
    // Switch to Spell Tree tab if requested (e.g., on startup with saved tree)
    if (switchToTreeTab !== false) {
        switchTab('spellTree');
        console.log('[SpellLearning] Tree loaded - switched to Spell Tree tab');
    }
    
    // Compute hard/soft prereqs on each node (source of truth for all systems)
    result.nodes.forEach(function(node) {
        // Use new unified hard/soft prereq system if available
        var hardPrereqs = node.hardPrereqs || [];
        var softPrereqs = node.softPrereqs || [];
        var softNeeded = node.softNeeded || 0;

        // Fallback to old system: treat all prereqs as hard if no hard/soft data
        if (hardPrereqs.length === 0 && softPrereqs.length === 0) {
            if (node.prerequisites && node.prerequisites.length > 0) {
                // Single prereq = hard, multiple = first is hard, rest are soft with softNeeded=1
                if (node.prerequisites.length === 1) {
                    hardPrereqs = node.prerequisites.slice();
                } else {
                    hardPrereqs = [node.prerequisites[0]];
                    softPrereqs = node.prerequisites.slice(1);
                    softNeeded = 1;
                }
            }
        }

        // Store computed hard/soft data back on the node so ALL systems
        // (detail panel, recalculateNodeAvailability, C++ bridge) use the
        // same source of truth. This prevents the "hidden prerequisites" bug
        // where the detail panel says "complete" but availability disagrees.
        node.hardPrereqs = hardPrereqs;
        node.softPrereqs = softPrereqs;
        node.softNeeded = softNeeded;
    });

    // Mirror bidirectional soft prereqs — DISABLED for now
    // mirrorBidirectionalSoftPrereqs(result.nodes);

    // Send tree prerequisites (hard/soft system) to C++ for tome learning validation
    if (window.callCpp) {
        var prereqData = [];
        var hardCount = 0;
        var softCount = 0;

        for (var pi = 0; pi < result.nodes.length; pi++) {
            var pNode = result.nodes[pi];
            hardCount += (pNode.hardPrereqs ? pNode.hardPrereqs.length : 0);
            softCount += (pNode.softPrereqs ? pNode.softPrereqs.length : 0);
            prereqData.push({
                formId: pNode.formId || pNode.id,
                hardPrereqs: pNode.hardPrereqs || [],
                softPrereqs: pNode.softPrereqs || [],
                softNeeded: pNode.softNeeded || 0
            });
        }

        // First clear existing prerequisites, then set new ones
        console.log('[SpellLearning] Sending ' + prereqData.length + ' spell prereqs (' +
                    hardCount + ' hard, ' + softCount + ' soft) to C++');
        window.callCpp('SetTreePrerequisites', JSON.stringify({ clear: true }));
        window.callCpp('SetTreePrerequisites', JSON.stringify(prereqData));
    }
    
    // After tree is loaded, sync with player's known spells and progression data
    if (window.callCpp) {
        console.log('[SpellLearning] Tree loaded - syncing progress and player known spells...');
        window.callCpp('GetProgress', '');  // Reload progress data
        window.callCpp('GetPlayerKnownSpells', '');  // Sync known spells
    }
}

function showSpellDetails(node) {
    var panel = document.getElementById('details-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    // Reveal locks for this node (Pre Req Master)
    if (typeof PreReqMaster !== 'undefined' && PreReqMaster.revealLocksForNode) {
        PreReqMaster.revealLocksForNode(node.id);
    }

    // Get progress data for progressive reveal
    // Debug: show what keys are in spellProgress
    var progressKeys = Object.keys(state.spellProgress);
    console.log('[SpellLearning] showSpellDetails - Looking for:', node.formId);
    console.log('[SpellLearning] Available progress keys:', progressKeys.join(', '));
    
    // Use canonical formId for duplicates, then try multiple formats
    var lookupId = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(node) : node.formId;
    var formIdVariants = [
        lookupId,
        lookupId.toLowerCase(),
        lookupId.toUpperCase(),
        lookupId.replace(/^0x/i, ''),
        '0x' + lookupId.replace(/^0x/i, ''),
        '0x' + lookupId.replace(/^0x/i, '').toUpperCase(),
        '0x' + lookupId.replace(/^0x/i, '').toLowerCase()
    ];
    // Also check the node's own formId if different from canonical
    if (lookupId !== node.formId) {
        formIdVariants.push(node.formId);
    }
    
    var progress = null;
    var matchedKey = null;
    for (var i = 0; i < formIdVariants.length; i++) {
        if (state.spellProgress[formIdVariants[i]]) {
            progress = state.spellProgress[formIdVariants[i]];
            matchedKey = formIdVariants[i];
            console.log('[SpellLearning] Found progress with key:', matchedKey);
            break;
        }
    }
    
    if (!progress) {
        console.log('[SpellLearning] No progress found for any variant of', node.formId);
    }
    progress = progress || { xp: 0, required: 100, progress: 0 };
    
    // Calculate XP required based on tier (always use current settings, not stale C++ value)
    var tierXP = getXPForTier(node.level);
    var requiredXP = xpOverrides[node.formId] !== undefined ? xpOverrides[node.formId] : (tierXP || 100);
    
    // Calculate progress percent - use xp/required directly since progress.progress may not be set
    var progressPercent = requiredXP > 0 ? ((progress.xp || 0) / requiredXP) * 100 : 0;
    console.log('[SpellLearning] Progress:', progress.xp, '/', requiredXP, '=', progressPercent.toFixed(1) + '%',
        '| revealName:', settings.revealName, '| showName should be:', progressPercent >= settings.revealName);
    
    // Check if player has the spell (via early learning or other means)
    // Use canonical formId for duplicates
    var playerHasSpell = progress.unlocked ||
                         state.playerKnownSpells.has(lookupId) ||
                         state.playerKnownSpells.has(node.formId) ||
                         node.state === 'unlocked';
    
    // Determine what to show based on state and progress
    // Cheat mode shows ALL info (includes former debug mode features)
    // Edit mode reveals everything so the user can see what they're editing
    // Player having the spell (early learning) also reveals full info
    // Available (learnable) spells always show their name
    var isEditActive = typeof EditMode !== 'undefined' && EditMode.isActive;
    var showFullInfo = playerHasSpell || settings.cheatMode || isEditActive;
    var isLearning = node.state === 'learning';
    var isLocked = node.state === 'locked';
    // Locked/mystery nodes never reveal info via progress threshold - only via cheat/edit/hasSpell
    var showName = showFullInfo || isLearning || (!isLocked && progressPercent >= settings.revealName);
    var showEffects = showFullInfo || (!isLocked && progressPercent >= settings.revealEffects);
    var showDescription = showFullInfo || (!isLocked && progressPercent >= settings.revealDescription);
    var showLevelAndCost = !isLocked || settings.cheatMode || isEditActive;
    
    // School badge always visible
    document.getElementById('spell-school').textContent = node.school;
    document.getElementById('spell-school').className = 'school-badge ' + node.school.toLowerCase();

    // Name - progressive reveal (cheat mode shows all)
    if (showName) {
        var nameDisplay = node.name || node.formId;
        if (settings.cheatMode && node.state === 'locked') {
            nameDisplay = (node.name || 'Unknown') + ' [LOCKED]';
        }
        document.getElementById('spell-name').textContent = nameDisplay;
    } else {
        document.getElementById('spell-name').textContent = '???';
    }
    
    // Level and cost - show for available (learning) and unlocked
    if (showLevelAndCost) {
        document.getElementById('spell-level').textContent = node.level || '?';
        document.getElementById('spell-cost').textContent = node.cost || '?';
        document.getElementById('spell-type').textContent = node.type || '?';
    } else {
        document.getElementById('spell-level').textContent = '???';
        document.getElementById('spell-cost').textContent = '???';
        document.getElementById('spell-type').textContent = '???';
    }
    
    // Effects - progressive reveal with weakened info
    var effectsList = document.getElementById('spell-effects');
    effectsList.innerHTML = '';
    
    // Check if spell is weakened (effectiveness < 100%)
    var isWeakened = node.isWeakened === true || (node.effectiveness && node.effectiveness < 100);
    var effectiveness = node.effectiveness || 100;
    
    if (showEffects) {
        // Show effectiveness warning if weakened
        if (isWeakened) {
            var weakenedLi = document.createElement('li');
            weakenedLi.className = 'weakened-warning';
            weakenedLi.textContent = '! ' + effectiveness + '% Power (practicing...)';
            weakenedLi.style.color = '#f59e0b';
            weakenedLi.style.fontWeight = 'bold';
            effectsList.appendChild(weakenedLi);
        }
        
        // Use scaledEffects if available (from C++ for weakened spells)
        var effectsToShow = (isWeakened && node.scaledEffects) ? node.scaledEffects : (Array.isArray(node.effects) ? node.effects : []);
        
        if (effectsToShow.length === 0) {
            var noEffLi = document.createElement('li');
            noEffLi.textContent = 'No effects';
            effectsList.appendChild(noEffLi);
        } else {
            effectsToShow.forEach(function(e) {
                var li = document.createElement('li');
                if (typeof e === 'string') {
                    li.textContent = e;
                } else if (e.scaledMagnitude !== undefined) {
                    // Scaled effect from C++
                    var text = e.name || 'Effect';
                    if (e.scaledMagnitude > 0) {
                        text += ' (' + e.scaledMagnitude + ')';
                        if (e.originalMagnitude && e.originalMagnitude !== e.scaledMagnitude) {
                            li.title = 'Full power: ' + e.originalMagnitude;
                        }
                    }
                    if (e.duration > 0) {
                        text += ' for ' + e.duration + 's';
                    }
                    li.textContent = text;
                    if (isWeakened) li.style.color = '#fbbf24';
                } else {
                    li.textContent = e.name || JSON.stringify(e);
                }
                effectsList.appendChild(li);
            });
        }
    } else {
        effectsList.innerHTML = '<li class="hidden-info">??? (' + settings.revealEffects + '% to reveal)</li>';
    }
    
    // Description - progressive reveal
    if (showDescription) {
        document.getElementById('spell-description').textContent = node.desc || 'No description.';
    } else if (node.state === 'locked') {
        document.getElementById('spell-description').textContent = 'Unlock prerequisites to reveal.';
    } else {
        document.getElementById('spell-description').textContent = 'Progress to ' + settings.revealDescription + '% to reveal description...';
    }

    // Populate prerequisites with hard/soft distinction
    var prereqSummary = document.getElementById('prereq-summary');
    var hardPrereqsSection = document.getElementById('hard-prereqs-section');
    var softPrereqsSection = document.getElementById('soft-prereqs-section');
    var hardPrereqsList = document.getElementById('hard-prereqs-list');
    var softPrereqsList = document.getElementById('soft-prereqs-list');
    var softNeededCount = document.getElementById('soft-needed-count');
    var legacyPrereqList = document.getElementById('spell-prereqs');
    
    // Clear all lists
    if (hardPrereqsList) hardPrereqsList.innerHTML = '';
    if (softPrereqsList) softPrereqsList.innerHTML = '';
    if (legacyPrereqList) legacyPrereqList.innerHTML = '';
    
    // Get hard/soft prereqs from node
    var hardPrereqs = node.hardPrereqs || [];
    var softPrereqs = node.softPrereqs || [];
    var softNeeded = node.softNeeded || 0;
    var hasHardSoftData = hardPrereqs.length > 0 || softPrereqs.length > 0;
    
    // Helper to create prereq list item
    function createPrereqItem(id, isHard, isMet) {
        var n = state.treeData ? _findNodeById(id) : null;
        var li = document.createElement('li');
        var showPrereqName = settings.cheatMode || (n && n.state !== 'locked');

        // Check if edit mode is active
        var isEditMode = typeof EditMode !== 'undefined' && EditMode.isActive;

        if (isEditMode) {
            li.classList.add('prereq-edit-item');

            // Name span
            var nameSpan = document.createElement('span');
            nameSpan.className = 'prereq-name';
            nameSpan.textContent = showPrereqName ? (n ? (n.name || n.formId) : id) : '???';
            nameSpan.dataset.id = id;
            li.appendChild(nameSpan);

            // Edit controls container
            var controls = document.createElement('span');
            controls.className = 'prereq-edit-controls';

            // Toggle hard/soft button
            var toggleBtn = document.createElement('button');
            toggleBtn.className = 'prereq-toggle-btn ' + (isHard ? 'hard' : 'soft');
            toggleBtn.textContent = isHard ? 'H' : 'S';
            toggleBtn.title = isHard ? 'Hard (required) - click to make Soft' : 'Soft (optional) - click to make Hard';
            toggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof EditMode !== 'undefined') {
                    EditMode.togglePrereqType(node, id);
                }
            });
            controls.appendChild(toggleBtn);

            // Delete button
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'prereq-delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.title = 'Remove prerequisite';
            deleteBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof EditMode !== 'undefined') {
                    EditMode.deletePrerequisite(node, id);
                }
            });
            controls.appendChild(deleteBtn);

            li.appendChild(controls);
        } else {
            li.textContent = showPrereqName ? (n ? (n.name || n.formId) : id) : '???';
        }

        li.dataset.id = id;
        if (isMet) li.classList.add('prereq-met');
        if (!showPrereqName) li.classList.add('prereq-hidden');  // Not clickable
        return li;
    }
    
    // Check if a prereq is met (node is unlocked/mastered)
    function isPrereqMet(id) {
        var n = state.treeData ? _findNodeById(id) : null;
        return n && n.state === 'unlocked';
    }
    
    if (hasHardSoftData && hardPrereqsSection && softPrereqsSection) {
        // Show hard/soft distinction
        hardPrereqsSection.classList.toggle('hidden', hardPrereqs.length === 0);
        softPrereqsSection.classList.toggle('hidden', softPrereqs.length === 0);
        legacyPrereqList.classList.add('hidden');
        
        // Count met prereqs
        var hardMet = hardPrereqs.filter(isPrereqMet).length;
        var softMet = softPrereqs.filter(isPrereqMet).length;
        
        // Summary text
        if (prereqSummary) {
            var totalHard = hardPrereqs.length;
            var totalSoft = softPrereqs.length;
            if (totalHard === 0 && totalSoft === 0) {
                prereqSummary.textContent = 'No prerequisites';
                prereqSummary.className = 'prereq-summary none';
            } else {
                var parts = [];
                if (totalHard > 0) parts.push(hardMet + '/' + totalHard + ' required');
                if (totalSoft > 0) parts.push(softMet + '/' + softNeeded + ' optional');
                prereqSummary.textContent = parts.join(' • ');
                prereqSummary.className = 'prereq-summary ' + 
                    (hardMet === totalHard && softMet >= softNeeded ? 'complete' : 'incomplete');
            }
        }
        
        // Populate hard prereqs
        hardPrereqs.forEach(function(id) {
            hardPrereqsList.appendChild(createPrereqItem(id, true, isPrereqMet(id)));
        });
        
        // Update soft needed label (editable in edit mode)
        if (softNeededCount) {
            var isEditMode = typeof EditMode !== 'undefined' && EditMode.isActive;

            if (isEditMode && softPrereqs.length > 0) {
                // Create editable input
                softNeededCount.innerHTML = '';
                var needLabel = document.createTextNode('(need ');
                softNeededCount.appendChild(needLabel);

                var input = document.createElement('input');
                input.type = 'number';
                input.className = 'soft-needed-input';
                input.min = '0';
                input.max = String(softPrereqs.length);
                input.value = String(softNeeded);
                input.addEventListener('change', function() {
                    var newVal = parseInt(this.value) || 0;
                    if (typeof EditMode !== 'undefined') {
                        EditMode.updateSoftNeeded(node, newVal);
                    }
                });
                input.addEventListener('click', function(e) {
                    e.stopPropagation();  // Prevent panel close
                });
                softNeededCount.appendChild(input);

                var ofLabel = document.createTextNode(' of ' + softPrereqs.length + ')');
                softNeededCount.appendChild(ofLabel);
            } else {
                softNeededCount.textContent = '(need ' + softNeeded + ' of ' + softPrereqs.length + ')';
            }
        }
        
        // Populate soft prereqs
        softPrereqs.forEach(function(id) {
            softPrereqsList.appendChild(createPrereqItem(id, false, isPrereqMet(id)));
        });
    } else {
        // Fallback to legacy display
        hardPrereqsSection.classList.add('hidden');
        softPrereqsSection.classList.add('hidden');
        legacyPrereqList.classList.remove('hidden');
        
        if (prereqSummary) {
            prereqSummary.textContent = node.prerequisites.length > 0 
                ? node.prerequisites.length + ' prerequisite(s)' 
                : 'No prerequisites';
            prereqSummary.className = 'prereq-summary';
        }
        
        node.prerequisites.forEach(function(id) {
            legacyPrereqList.appendChild(createPrereqItem(id, true, isPrereqMet(id)));
        });
    }

    var unlocksList = document.getElementById('spell-unlocks');
    unlocksList.innerHTML = '';
    node.children.forEach(function(id) {
        var n = state.treeData ? _findNodeById(id) : null;
        var li = document.createElement('li');
        // Cheat mode shows all names
        var showChildName = settings.cheatMode || (n && n.state !== 'locked');
        li.textContent = showChildName ? (n ? (n.name || n.formId) : id) : '???';
        li.dataset.id = id;
        unlocksList.appendChild(li);
    });

    // === LOCKS (Pre Req Master) ===
    var locksSection = document.getElementById('locks-section');
    var locksList = document.getElementById('locks-list');
    if (locksSection && locksList) {
        locksList.innerHTML = '';
        var locks = (typeof PreReqMaster !== 'undefined' && PreReqMaster.getLocksForNode)
            ? PreReqMaster.getLocksForNode(node.id)
            : [];

        if (locks.length > 0) {
            locksSection.style.display = '';
            locks.forEach(function(lock) {
                var li = document.createElement('li');
                li.className = 'lock-prereq-item';
                var showName = lock.revealed && lock.name;
                li.innerHTML = '<span class="lock-icon">\u{1F517}</span> ' +
                    (showName ? lock.name : '???') +
                    ' <span class="lock-label">LOCK</span>';
                li.dataset.id = lock.nodeId;
                if (lock.revealed && lock.name) {
                    li.addEventListener('click', function() { selectNodeById(lock.nodeId); });
                }
                locksList.appendChild(li);
            });
        } else {
            locksSection.style.display = 'none';
        }
    }

    var stateBadge = document.getElementById('spell-state');
    var stateText = node.state.charAt(0).toUpperCase() + node.state.slice(1);
    var stateClass = node.state;
    
    // Show "Weakened" for early-learned spells
    if (isWeakened && node.state === 'unlocked') {
        stateText = 'Weakened (' + effectiveness + '%)';
        stateClass = 'weakened';
    }
    
    stateBadge.textContent = stateText;
    stateBadge.className = 'state-badge ' + stateClass;

    // Store selected node for button handlers
    state.selectedNode = node;
    
    // Update progression UI
    updateDetailsProgression(node);
}

function updateDetailsProgression(node) {
    var progressSection = document.getElementById('progress-section');
    var learnBtn = document.getElementById('learn-btn');
    var unlockBtn = document.getElementById('unlock-btn');
    var progressBar = document.getElementById('progress-bar');
    var progressText = document.getElementById('progress-text');
    var progressEdit = document.getElementById('progress-edit');
    var xpCurrentInput = document.getElementById('xp-current-input');
    var xpRequiredInput = document.getElementById('xp-required-input');
    
    // Get progress data for this spell (use canonical ID for duplicates)
    var canonId = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(node) : node.formId;
    var progress = state.spellProgress[canonId] || { xp: 0, required: 100, unlocked: false, ready: false };
    var isLearningTarget = state.learningTargets[node.school] === canonId || state.learningTargets[node.school] === node.formId;

    // Debug: log learning target check to file via C++
    var debugMsg = '[SELECT] ' + (node.name || node.formId) +
                   ' | school:' + node.school +
                   ' | formId:' + node.formId +
                   ' | targets:' + JSON.stringify(state.learningTargets) +
                   ' | isTarget:' + isLearningTarget +
                   ' | state:' + node.state +
                   ' | isRoot:' + (node.isRoot || false);
    console.log(debugMsg);
    if (window.callCpp) {
        window.callCpp('LogMessage', JSON.stringify({ level: 'info', message: debugMsg }));
    }
    
    // Update learning status badge
    updateLearningStatusBadge(node, progress);
    
    // Calculate required XP - use override if exists, otherwise tier-based
    var tierXP = getXPForTier(node.level);
    var requiredXP = xpOverrides[node.formId] !== undefined ? xpOverrides[node.formId] : tierXP;
    progress.required = requiredXP;
    
    // Hide all buttons by default
    learnBtn.classList.add('hidden');
    unlockBtn.classList.add('hidden');
    progressSection.classList.add('hidden');
    progressText.classList.remove('hidden');
    if (progressEdit) progressEdit.classList.add('hidden');
    
    // CHEAT MODE: Allow unlocking/relocking any node + editable XP
    if (settings.cheatMode) {
        progressSection.classList.remove('hidden');
        unlockBtn.classList.remove('hidden');
        unlockBtn.disabled = false;
        
        // Show editable XP inputs instead of text
        progressText.classList.add('hidden');
        if (progressEdit) {
            progressEdit.classList.remove('hidden');
            if (xpCurrentInput) {
                xpCurrentInput.value = Math.floor(progress.xp || 0);
                // Remove old listeners to avoid duplicates
                xpCurrentInput.onchange = function() {
                    var newXP = Math.max(0, parseInt(this.value) || 0);
                    this.value = newXP;
                    progress.xp = newXP;
                    state.spellProgress[canonId] = progress;
                    // Update progress bar
                    var percent = requiredXP > 0 ? (newXP / requiredXP) * 100 : 0;
                    progressBar.style.width = Math.min(percent, 100) + '%';
                    progressBar.classList.toggle('ready', newXP >= requiredXP);
                    // Tell C++ about the XP change (send canonical ID)
                    if (window.callCpp) {
                        window.callCpp('SetSpellXP', JSON.stringify({ formId: canonId, xp: newXP }));
                    }
                };
            }
            if (xpRequiredInput) {
                xpRequiredInput.value = Math.floor(requiredXP);
                // Show if this is an override
                var hasOverride = xpOverrides[node.formId] !== undefined;
                xpRequiredInput.classList.toggle('has-override', hasOverride);
                xpRequiredInput.title = hasOverride ? 'Custom override (tier default: ' + tierXP + ')' : 'Tier default';
                
                xpRequiredInput.onchange = function() {
                    var newRequired = Math.max(1, parseInt(this.value) || tierXP);
                    this.value = newRequired;
                    // Store as override
                    xpOverrides[node.formId] = newRequired;
                    this.classList.add('has-override');
                    this.title = 'Custom override (tier default: ' + tierXP + ')';
                    progress.required = newRequired;
                    // Update progress bar
                    var percent = newRequired > 0 ? (progress.xp / newRequired) * 100 : 0;
                    progressBar.style.width = Math.min(percent, 100) + '%';
                    progressBar.classList.toggle('ready', progress.xp >= newRequired);
                    // Save overrides
                    autoSaveSettings();
                };
            }
        }
        
        // Update progress bar
        var cheatPercent = requiredXP > 0 ? (progress.xp / requiredXP) * 100 : 0;
        progressBar.style.width = Math.min(cheatPercent, 100) + '%';
        
        if (node.state === 'unlocked') {
            // Actually unlocked (node state is the source of truth) - show relock option
            unlockBtn.textContent = 'Relock Spell';
            unlockBtn.style.background = '#ef4444';  // Red for relock
            progressBar.classList.add('ready');
            learnBtn.classList.add('hidden');
        } else {
            // Not unlocked - show cheat unlock button (even if progress.unlocked is stale)
            unlockBtn.textContent = 'Unlock (Cheat)';
            unlockBtn.style.background = '';  // Default color
            progressBar.classList.toggle('ready', progress.xp >= requiredXP);

            // Also show learn button in cheat mode (for normal learning path)
            if (node.state === 'available' || node.state === 'learning') {
                learnBtn.classList.remove('hidden');
                var isLearningTarget = state.learningTargets && state.learningTargets[node.school] === node.formId;
                if (isLearningTarget) {
                    learnBtn.textContent = 'Learning...';
                    learnBtn.classList.add('active');
                } else {
                    learnBtn.textContent = 'Learn This';
                    learnBtn.classList.remove('active');
                }
            }
        }
        return;
    }
    
    // NORMAL MODE
    if (node.state === 'locked') {
        // Locked - can't do anything
        return;
    }
    
    if (node.state === 'unlocked') {
        // Actually unlocked - nothing to show
        return;
    }
    
    // Node is available - show progression options
    progressSection.classList.remove('hidden');
    
    // Update progress bar
    var percent = progress.required > 0 ? (progress.xp / progress.required) * 100 : 0;
    progressBar.style.width = Math.min(percent, 100) + '%';
    progressText.textContent = Math.floor(progress.xp) + ' / ' + Math.floor(progress.required) + ' XP';
    
    if (progress.ready || progress.xp >= progress.required) {
        // Ready to unlock - show unlock button
        progressBar.classList.add('ready');
        unlockBtn.classList.remove('hidden');
        unlockBtn.disabled = false;
        unlockBtn.textContent = 'Unlock Spell';
        unlockBtn.style.background = '';  // Default color
        learnBtn.classList.add('hidden');
    } else {
        // Not ready - show learn button
        progressBar.classList.remove('ready');
        learnBtn.classList.remove('hidden');
        
        if (isLearningTarget) {
            learnBtn.textContent = 'Learning...';
            learnBtn.classList.add('active');
        } else {
            learnBtn.textContent = 'Learn This';
            learnBtn.classList.remove('active');
        }
    }
}

function selectNodeById(id) {
    if (!state.treeData) return;
    var node = _findNodeById(id);
    if (node) {
        WheelRenderer.selectNode(node);
        WheelRenderer.rotateSchoolToTop(node.school);
    }
}

