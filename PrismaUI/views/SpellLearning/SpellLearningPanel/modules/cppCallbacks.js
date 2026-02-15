/**
 * C++ Callbacks Module
 * Handles all callbacks from the C++ SKSE plugin
 * 
 * Depends on:
 * - modules/state.js (state, settings)
 * - modules/treeParser.js (TreeParser)
 * - modules/wheelRenderer.js (WheelRenderer)
 * - modules/spellCache.js (SpellCache)
 * 
 * Exports (global):
 * - window.onScanComplete
 * - window.onScanError
 * - window.onTreeDataReceived
 * - window.onSpellDataReceived
 * - window.onProgressionDataReceived
 * - window.onSpellLearned
 * - window.onXPGained
 * - window.onKnownSpellsReceived
 */

// =============================================================================
// DUPLICATE NODE SHARED STATE HELPERS
// =============================================================================

/**
 * Get the canonical (original) formId for a node.
 * Duplicate nodes spawned in edit mode have originalFormId set,
 * or have _dup_ in their formId. Returns the original spell's formId
 * so all copies share the same progress/state key.
 */
function getCanonicalFormId(node) {
    if (node.originalFormId) return node.originalFormId;
    var id = node.formId || node.id;
    var dupIdx = id.indexOf('_dup_');
    if (dupIdx !== -1) return id.substring(0, dupIdx);
    return id;
}

/**
 * Find all sibling nodes that share the same original spell.
 * Returns an array of nodes (excluding the source node itself).
 */
function findDuplicateSiblings(sourceNode) {
    if (!state.treeData || !state.treeData.nodes) return [];
    var canonicalId = getCanonicalFormId(sourceNode);
    return state.treeData.nodes.filter(function(n) {
        if (n === sourceNode) return false;
        return getCanonicalFormId(n) === canonicalId;
    });
}

/**
 * Sync state from one node to all its duplicate siblings.
 * Call this after any state change on a node.
 */
function syncDuplicateState(sourceNode) {
    var siblings = findDuplicateSiblings(sourceNode);
    if (siblings.length === 0) return;

    siblings.forEach(function(sibling) {
        if (sibling.state !== sourceNode.state) {
            console.log('[SharedState] Syncing ' + (sibling.name || sibling.formId) +
                        ': ' + sibling.state + ' -> ' + sourceNode.state);
            sibling.state = sourceNode.state;
        }
    });

    if (typeof CanvasRenderer !== 'undefined') {
        CanvasRenderer._needsRender = true;
    }
}

// =============================================================================
// C++ CALLBACKS
// =============================================================================

/**
 * Called by C++ when panel opens to report builder availability.
 * Native C++ builder is always available — enables Build button.
 */
window.onPythonAddonStatus = function(statusStr) {
    // Native C++ builder — always ready
    console.log('[SpellLearning] Builder status: native C++');
    if (typeof TreeGrowth !== 'undefined') {
        TreeGrowth.updateBuilderReady();
    }
};

window.updateSpellData = function(jsonStr) {
    console.log('[SpellLearning] Received spell data, length:' + jsonStr.length);

    // Check if this is a tome-only scan response (used for filtering, not main data)
    try {
        var parsed = JSON.parse(jsonStr);
        if (parsed.scanMode === 'spell_tomes') {
            console.log('[SpellLearning] Tome scan received: ' + (parsed.spells ? parsed.spells.length : 0) + ' tomed spells');
            state.tomedSpellIds = {};
            if (parsed.spells) {
                parsed.spells.forEach(function(s) {
                    if (s.formId) state.tomedSpellIds[s.formId] = true;
                });
            }
            if (typeof updatePrimedCount === 'function') updatePrimedCount();
            // Restore scan status after background tome scan (C++ overwrites with "Scanning spell tomes...")
            if (state.lastSpellData && state.lastSpellData.spellCount) {
                var schoolSet = {};
                if (state.lastSpellData.spells) state.lastSpellData.spells.forEach(function(s) { if (s.school) schoolSet[s.school] = true; });
                if (typeof updateScanStatus === 'function') {
                    updateScanStatus(t('status.scannedSpellsSchools', {count: state.lastSpellData.spellCount, schools: Object.keys(schoolSet).length}), 'success');
                }
            }
            return;
        }
    } catch (e) {
        console.error('[SpellLearning] Failed to parse JSON for tome scan check:', e);
        /* continue to normal processing */ }

    var scanSuccess = false;
    try {
        var data = JSON.parse(jsonStr);
        state.lastSpellData = data;
        
        var formatted = JSON.stringify(data, null, 2);
        var outputArea = document.getElementById('outputArea');
        if (outputArea) outputArea.value = formatted;
        
        if (state.fullAutoMode) {
            updateStatus(t('status.step2Generating', {count: data.spellCount}));
            updateScanStatus(t('status.step2Generating', {count: data.spellCount}), 'working');
        } else {
            var schoolSet = {};
            if (data.spells) data.spells.forEach(function(s) { if (s.school) schoolSet[s.school] = true; });
            var schoolCount = Object.keys(schoolSet).length;
            updateStatus(t('status.scannedSpells', {count: data.spellCount}));
            updateScanStatus(t('status.scannedSpellsSchools', {count: data.spellCount, schools: schoolCount}), 'success');
        }
        setStatusIcon('X');
        updateCharCount();
        scanSuccess = true;

        // Populate scan stats panel early — before downstream code that might throw
        if (data.spells && data.spells.length > 0) {
            var totalEl = document.getElementById('statTotalSpells');
            if (totalEl) totalEl.textContent = data.spells.length;

            var modSet = {};
            data.spells.forEach(function(s) { if (s.plugin) modSet[s.plugin] = true; });
            var modsEl = document.getElementById('statTotalMods');
            if (modsEl) modsEl.textContent = Object.keys(modSet).length;
        }

        // Show per-school control panels
        if (data.spells && typeof showSchoolControlPanels === 'function') {
            var schoolData = {};
            data.spells.forEach(function(spell) {
                var school = spell.school || 'Unknown';
                if (!school || school === 'null' || school === 'None') school = 'Hedge Wizard';
                if (!schoolData[school]) schoolData[school] = [];
                schoolData[school].push(spell);
            });
            showSchoolControlPanels(schoolData);
        }
        
        // Build button managed by TreeGrowth.updateScanStatus / updateBuildButton

        // Enable scan-dependent buttons after successful scan
        if (data.spells && data.spells.length > 0) {
            var postScanBtns = ['blacklistBtn', 'whitelistBtn', 'saveBtn'];
            postScanBtns.forEach(function(id) {
                var btn = document.getElementById(id);
                if (btn) btn.disabled = false;
            });
            // Migrate legacy blacklist entries: add plugin + localFormId from scan data
            if (settings.spellBlacklist && data.spells && typeof getLocalFormId === 'function') {
                var spellLookup = {};
                data.spells.forEach(function(s) { if (s.formId) spellLookup[s.formId] = s; });
                var migrated = 0;
                settings.spellBlacklist.forEach(function(entry) {
                    if (!entry.localFormId && entry.formId && spellLookup[entry.formId]) {
                        var spell = spellLookup[entry.formId];
                        entry.plugin = spell.plugin || '';
                        entry.localFormId = getLocalFormId(entry.formId);
                        migrated++;
                    }
                });
                if (migrated > 0) {
                    console.log('[SpellLearning] Migrated ' + migrated + ' legacy blacklist entries to stable format');
                    if (typeof autoSaveSettings === 'function') autoSaveSettings();
                }
            }

            // Update primed count (filtered by blacklist/whitelist)
            if (typeof updatePrimedCount === 'function') updatePrimedCount();
        }

        // If tomes toggle is ON, auto-trigger a tome scan to get tomed IDs for filtering
        if (data.spells && data.spells.length > 0) {
            var scanModeTomesEl = document.getElementById('scanModeTomes');
            if (scanModeTomesEl && scanModeTomesEl.checked && window.callCpp) {
                window.callCpp('ScanSpells', JSON.stringify({ scanMode: 'tomes', fields: { plugin: true } }));
            }
        }

        // Show Classify Keywords button if LLM keyword classification is enabled
        var classifyBtn = document.getElementById('classifyKeywordsBtn');
        if (classifyBtn && data.spells && data.spells.length > 0) {
            var llmEnabled = settings.treeGeneration && settings.treeGeneration.llm &&
                             settings.treeGeneration.llm.enabled &&
                             settings.treeGeneration.llm.keywordClassification;
            classifyBtn.style.display = llmEnabled ? '' : 'none';
        }

    } catch (e) {
        console.error('[SpellLearning] Failed to parse spell data:', e);
        var outputAreaFallback = document.getElementById('outputArea');
        if (outputAreaFallback) outputAreaFallback.value = jsonStr;
        updateStatus(t('status.receivedDataParseError'));
        setStatusIcon('!');
        state.fullAutoMode = false;
    }

    // Show tree preview section (outside try-catch so errors don't kill scan flow)
    if (typeof TreePreview !== 'undefined' && state.lastSpellData) {
        try {
            TreePreview.show(state.lastSpellData);
        } catch (tpErr) {
            console.error('[TreePreview] Failed to show:', tpErr);
        }
    }

    // Initialize core settings (globe position/size) - now lives in Extra Settings tab
    if (typeof TreeCore !== 'undefined') {
        try {
            TreeCore.show();
        } catch (tcErr) {
            console.error('[TreeCore] Failed to init:', tcErr);
        }
    }

    // Show tree growth section (pulls data from TreePreview)
    if (typeof TreeGrowth !== 'undefined' && state.lastSpellData) {
        try {
            TreeGrowth.show();
        } catch (tgErr) {
            console.error('[TreeGrowth] Failed to show:', tgErr);
        }
    }

    // Show Extra Settings section after scan (preview renders empty state until tree is built)
    var prmSection = document.getElementById('prereqMasterSection');
    if (prmSection) prmSection.style.display = '';

    // Notify growth modes that spells are available for building
    if (state.lastSpellData && state.lastSpellData.spells && state.lastSpellData.spells.length > 0) {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth.updateScanStatus(true);
    }

    // Update scan stats + status outside try-catch (guaranteed to run)
    if (state.lastSpellData && state.lastSpellData.spells && state.lastSpellData.spells.length > 0) {
        var spells = state.lastSpellData.spells;
        try {
            var totalEl = document.getElementById('statTotalSpells');
            if (totalEl) totalEl.textContent = spells.length;

            var modSet2 = {};
            spells.forEach(function(s) { if (s.plugin) modSet2[s.plugin] = true; });
            var modsEl2 = document.getElementById('statTotalMods');
            if (modsEl2) modsEl2.textContent = Object.keys(modSet2).length;

            if (typeof updatePrimedCount === 'function') updatePrimedCount();
        } catch (statErr) {
            console.error('[SpellLearning] Stats update error:', statErr);
        }

        // Update status bar if it wasn't set by the try block
        var statusText = document.getElementById('statusText');
        if (statusText && statusText.textContent === 'Ready to scan') {
            var schoolSet2 = {};
            spells.forEach(function(s) { if (s.school) schoolSet2[s.school] = true; });
            if (typeof updateStatus === 'function') {
                updateStatus(t('status.scannedSpells', {count: spells.length}));
            }
            if (typeof updateScanStatus === 'function') {
                updateScanStatus(t('status.scannedSpellsSchools', {count: spells.length, schools: Object.keys(schoolSet2).length}), 'success');
            }
        }
    }

    var scanBtn = document.getElementById('scanBtn');
    if (scanBtn) {
        scanBtn.disabled = false;
        scanBtn.innerHTML = '<span class="btn-icon">[*]</span>' + t('buttons.scanSpells');
    }
    
    // Continue to auto-generation if in full auto mode
    if (state.fullAutoMode && scanSuccess) {
        console.log('[SpellLearning] Full Auto: Starting tree generation...');
        setTimeout(function() {
            startFullAutoGenerate();
        }, 500);
    } else if (state.proceduralPending && scanSuccess) {
        // Trigger JS procedural generation
        console.log('[SpellLearning] Procedural (JS): Starting tree generation...');
        state.proceduralPending = false;
        setTimeout(function() {
            startProceduralGenerate();
        }, 100);
    } else if (state.visualFirstPending && scanSuccess) {
        // Trigger Visual-First generation
        console.log('[SpellLearning] Visual-First: Starting tree generation...');
        state.visualFirstPending = false;
        setTimeout(function() {
            if (typeof doVisualFirstGenerate === 'function') {
                doVisualFirstGenerate();
            }
        }, 100);
    } else if (state.proceduralPlusScanPending && scanSuccess) {
        // Trigger Python procedural generation
        console.log('[SpellLearning] Procedural+ (Python): Starting tree generation...');
        state.proceduralPlusScanPending = false;
        setTimeout(function() {
            startProceduralPythonGenerate();
        }, 100);
    } else {
        // Reset all buttons if not continuing
        var fullAutoBtn = document.getElementById('fullAutoBtn');
        if (fullAutoBtn) {
            fullAutoBtn.disabled = false;
            fullAutoBtn.innerHTML = '<span class="btn-icon">>></span> Full Auto';
        }
        if (typeof resetProceduralButton === 'function') resetProceduralButton();
        if (typeof resetProceduralPlusButton === 'function') resetProceduralPlusButton();
    }
};

window.updateStatus = function(message) {
    var msg = message;
    if (msg.startsWith('"') && msg.endsWith('"')) {
        try { msg = JSON.parse(msg); } catch (e) {}
    }
    var el = document.getElementById('statusText');
    if (el) el.textContent = msg;
    // Forward to scan feedback bar with auto-detected type
    var type = '';
    if (msg.indexOf('Saved') !== -1 || msg.indexOf('saved') !== -1) type = 'success';
    else if (msg.indexOf('Error') !== -1 || msg.indexOf('Failed') !== -1 || msg.indexOf('failed') !== -1) type = 'error';
    if (typeof updateScanStatus === 'function') updateScanStatus(msg, type);
};

window.updatePrompt = function(promptContent) {
    console.log('[SpellLearning] Received prompt, length:', promptContent.length);
    
    if (promptContent && promptContent.length > 0) {
        state.originalPrompt = promptContent;
        state.promptModified = false;
        var promptArea = document.getElementById('promptArea');
        if (promptArea) {
            promptArea.value = promptContent;
            setPromptStatus('Loaded', '');
        }
    }
};

window.onPromptSaved = function(success) {
    if (success === 'true' || success === true) {
        var promptArea = document.getElementById('promptArea');
        if (promptArea) state.originalPrompt = promptArea.value;
        state.promptModified = false;
        setPromptStatus('Saved', '');
    } else {
        setPromptStatus('Save failed', 'error');
    }
};

/**
 * Called by C++ with clipboard content
 */
window.onClipboardContent = function(content) {
    console.log('[SpellLearning] Received clipboard content, length:', content ? content.length : 0);
    
    if (!content || content.length === 0) {
        updateStatus(t('status.clipboardEmpty'));
        setStatusIcon('!');
        state.pasteTarget = null;
        return;
    }
    
    // Paste to the target element
    var targetId = state.pasteTarget || 'outputArea';
    var targetEl = document.getElementById(targetId);
    
    if (targetEl) {
        targetEl.value = content.trim();
        
        if (targetId === 'outputArea') {
            updateStatus(t('status.pastedClipboard', {length: content.length}));
            setStatusIcon('X');
            updateCharCount();
        } else if (targetId === 'import-textarea') {
            // Clear any previous error
            var errorBox = document.getElementById('import-error');
            if (errorBox) errorBox.classList.add('hidden');
        } else if (targetId === 'apiKeyInput') {
            // API key pasted
            targetEl.dataset.hasKey = 'false';
            updateStatus(t('status.apiKeyPasted'));
            setStatusIcon('X');
            
            // Temporarily show the key so user can see it was pasted
            if (targetEl.type === 'password') {
                targetEl.type = 'text';
                setTimeout(function() {
                    targetEl.type = 'password';
                }, 2000);
            }
            targetEl.focus();
        } else if (targetId === 'customModelInput') {
            // Custom model ID pasted
            updateStatus(t('status.customModelPasted', {model: content.trim()}));
            setStatusIcon('X');
            updateModelDisplayState();
            onSaveApiSettings();
            targetEl.focus();
        }
    }
    
    state.pasteTarget = null;
};

/**
 * Called by C++ when copy succeeds
 */
window.onCopyComplete = function(success) {
    if (success === 'true' || success === true) {
        updateStatus(t('status.copiedClipboard'));
        setStatusIcon('X');
    } else {
        updateStatus(t('status.copyFailed'));
        setStatusIcon('X');
    }
};

// Tree viewer callbacks
window.updateTreeData = function(json) {
    console.log('[SpellLearning] Received tree data');
    try {
        var data = typeof json === 'string' ? JSON.parse(json) : json;
        
        // Check if we actually have tree data
        if (!data || !data.schools || Object.keys(data.schools).length === 0) {
            console.log('[SpellLearning] No valid tree data in response');
            return;
        }
        
        console.log('[SpellLearning] Loading tree with ' + Object.keys(data.schools).length + ' schools');
        loadTreeData(data);
        
        // Enable Pre Req Master now that tree is loaded
        if (typeof PreReqMaster !== 'undefined' && PreReqMaster.setButtonsEnabled) {
            PreReqMaster.setButtonsEnabled(true);
            PreReqMaster.updateStatus('Tree loaded - ready');
        }
        
        // Analyze orphans after tree loads and update repair button
        if (typeof analyzeOrphans === 'function') {
            setTimeout(function() {
                analyzeOrphans();
                if (typeof updateOrphanRepairButton === 'function') {
                    updateOrphanRepairButton();
                }
            }, 200);
        }
        
        // Force hide empty state after loading
        var emptyState = document.getElementById('empty-state');
        if (emptyState && state.treeData && state.treeData.nodes && state.treeData.nodes.length > 0) {
            emptyState.classList.add('hidden');
            console.log('[SpellLearning] Force-hid empty state');
        }
    } catch (e) {
        console.error('[SpellLearning] Failed to parse tree data:', e);
    }
};

/**
 * Called by C++ when Classic Growth tree build completes
 * Receives NLP-built tree data for preview layout
 */
window.onClassicGrowthTreeData = function(json) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    console.log('[SpellLearning] Classic Growth tree data received');
    if (typeof TreeGrowthClassic !== 'undefined' && TreeGrowthClassic.loadTreeData) {
        TreeGrowthClassic.loadTreeData(data);
        if (typeof TreeGrowth !== 'undefined') {
            TreeGrowth._markDirty();
        }
    }
};

/**
 * Called by C++ when Tree Growth tree build completes
 * Receives NLP-built tree data with trunk/branch/root structure
 */
window.onTreeGrowthTreeData = function(json) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    console.log('[SpellLearning] Tree Growth tree data received');
    if (typeof TreeGrowthTree !== 'undefined' && TreeGrowthTree.loadTreeData) {
        TreeGrowthTree.loadTreeData(data);
        if (typeof TreeGrowth !== 'undefined') {
            TreeGrowth._markDirty();
        }
    }
};

window.updateSpellInfo = function(json) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    if (data.formId) {
        SpellCache.set(data.formId, data);
        
        if (state.treeData) {
            var node = state.treeData.nodes.find(function(n) { return n.formId === data.formId; });
            if (node) {
                TreeParser.updateNodeFromCache(node);
                WheelRenderer.render();
            }
        }
    }
};

window.updateSpellInfoBatch = function(json) {
    console.log('[SpellLearning] Received spell info batch');
    var dataArray = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(dataArray)) {
        console.warn('[SpellLearning] Batch response is not an array');
        return;
    }
    
    var foundCount = 0;
    var notFoundCount = 0;
    
    dataArray.forEach(function(data) {
        if (data.formId) {
            if (data.notFound) {
                notFoundCount++;
                console.warn('[SpellLearning] Spell not found: ' + data.formId);
            } else {
                foundCount++;
                SpellCache.set(data.formId, data);
            }
        }
    });
    
    console.log('[SpellLearning] Batch: ' + foundCount + ' found, ' + notFoundCount + ' not found');
    
    // Signal batch complete
    SpellCache.onBatchComplete();
    
    if (state.treeData) {
        state.treeData.nodes.forEach(function(node) {
            TreeParser.updateNodeFromCache(node);
        });
        WheelRenderer.render();
        
        var statusMsg = t('status.loadedSpells', {found: foundCount});
        if (notFoundCount > 0) {
            statusMsg = t('status.loadedSpellsNotFound', {found: foundCount, notFound: notFoundCount});
        }
        setTreeStatus(statusMsg);
    }
};

// Helper to log to output textarea (global so other modules can use it)
window.debugOutput = function(msg) {
    var output = document.getElementById('outputArea');
    if (output) {
        var timestamp = new Date().toLocaleTimeString();
        output.value = '[' + timestamp + '] ' + msg + '\n' + output.value;
    }
    console.log(msg);
};

// Debug function to test learning state - call from console: testLearning('Flames')
window.testLearning = function(spellName) {
    if (!state.treeData || !state.treeData.nodes) {
        debugOutput('[TEST] No tree data!');
        return;
    }
    var node = state.treeData.nodes.find(function(n) { 
        return n.name && n.name.toLowerCase().includes(spellName.toLowerCase()); 
    });
    if (node) {
        debugOutput('[TEST] Setting ' + node.name + ' to learning state...');
        window.updateSpellState(node.id, 'learning');
    } else {
        debugOutput('[TEST] Node not found: ' + spellName);
        debugOutput('[TEST] Available: ' + state.treeData.nodes.slice(0, 10).map(function(n) { return n.name; }).join(', '));
    }
};

window.updateSpellState = function(jsonOrFormId, newState) {
    // Handle both JSON string from C++ and direct params from JS
    var formId, stateValue;
    
    if (typeof jsonOrFormId === 'string' && jsonOrFormId.indexOf('{') === 0) {
        // It's a JSON string from C++
        try {
            var data = JSON.parse(jsonOrFormId);
            formId = data.formId;
            stateValue = data.state;
        } catch (e) {
            debugOutput('[LEARN] ERROR: Failed to parse JSON: ' + e);
            return;
        }
    } else {
        // Direct parameters from JS
        formId = jsonOrFormId;
        stateValue = newState;
    }
    
    debugOutput('[LEARN] updateSpellState: formId=' + formId + ', state=' + stateValue);
    
    if (!state.treeData) {
        debugOutput('[LEARN] ERROR: No treeData!');
        return;
    }
    
    if (!state.treeData.nodes) {
        debugOutput('[LEARN] ERROR: No nodes in treeData!');
        return;
    }
    
    debugOutput('[LEARN] Searching ' + state.treeData.nodes.length + ' nodes...');
    
    // Find node by formId, id, or originalFormId (for duplicates)
    var node = state.treeData.nodes.find(function(n) {
        return n.formId === formId || n.id === formId || n.originalFormId === formId;
    });

    if (!node) {
        debugOutput('[LEARN] ERROR: Node NOT FOUND! formId=' + formId);
        var sample = state.treeData.nodes.slice(0, 3).map(function(n) {
            return n.name + '(id:' + n.id + ')';
        }).join(', ');
        debugOutput('[LEARN] Sample nodes: ' + sample);
        return;
    }

    var oldState = node.state;
    node.state = stateValue;
    syncDuplicateState(node);
    debugOutput('[LEARN] ' + node.name + ': ' + oldState + ' -> ' + stateValue);
    
    var wasLearning = oldState === 'learning' || oldState === 'Learning';
    var isNowLearning = stateValue === 'learning' || stateValue === 'Learning';
    
    // Trigger learning animation and rebuild paths if spell enters "learning" state
    if (isNowLearning && !wasLearning) {
        debugOutput('[LEARN] >>> STARTED LEARNING: ' + node.name);
        
        // Rebuild learning paths and trigger animation on Canvas renderer
        if (typeof CanvasRenderer !== 'undefined') {
            debugOutput('[LEARN] CanvasRenderer exists, _nodeMap=' + !!CanvasRenderer._nodeMap);
            if (CanvasRenderer._nodeMap) {
                debugOutput('[LEARN] Calling _buildLearningPaths...');
                CanvasRenderer._buildLearningPaths();
                debugOutput('[LEARN] Calling triggerLearningAnimation(' + node.id + ')...');
                CanvasRenderer.triggerLearningAnimation(node.id);
                CanvasRenderer._needsRender = true;
                debugOutput('[LEARN] Done! _learningNodeIds.size=' + (CanvasRenderer._learningNodeIds ? CanvasRenderer._learningNodeIds.size : 'null'));
            }
        } else {
            debugOutput('[LEARN] ERROR: CanvasRenderer NOT defined!');
        }
        
        // Also refresh SmartRenderer
        if (typeof SmartRenderer !== 'undefined') {
            SmartRenderer.refresh();
        }
    }
    
    // Rebuild paths when spell STOPS being in learning state (cancelled, unlocked, etc.)
    if (wasLearning && !isNowLearning) {
        debugOutput('[LEARN] >>> STOPPED LEARNING: ' + node.name + ' -> ' + stateValue);
        
        if (typeof CanvasRenderer !== 'undefined' && CanvasRenderer._nodeMap) {
            CanvasRenderer._buildLearningPaths();
            CanvasRenderer._needsRender = true;
        }
        
        if (typeof SmartRenderer !== 'undefined') {
            SmartRenderer.refresh();
        }
    }
    
    // Also refresh discovery visibility when spell is unlocked
    if (stateValue === 'unlocked' && oldState !== 'unlocked') {
        debugOutput('[LEARN] Spell unlocked: ' + node.name);
        if (typeof SmartRenderer !== 'undefined') {
            SmartRenderer.refresh();
        }
    }
    
    WheelRenderer.render();
    
    var unlockedEl = document.getElementById('unlocked-count'); if (unlockedEl) unlockedEl.textContent = 
        state.treeData.nodes.filter(function(n) { return n.state === 'unlocked'; }).length;
};

// Reset all tree nodes to their default state (locked/available based on prerequisites)
// Called on game launch to main menu - BEFORE any save is loaded
window.onResetTreeStates = function() {
    console.log('[SpellLearning] Resetting all tree states (main menu load)');
    
    // Clear all progress data
    state.spellProgress = {};
    state.learningTargets = {};
    state.playerKnownSpells = new Set();
    
    if (state.treeData && state.treeData.nodes) {
        // Reset all nodes to locked first
        state.treeData.nodes.forEach(function(node) {
            node.state = 'locked';
        });
        
        // Then mark tier 1 nodes (no prerequisites) as available
        state.treeData.nodes.forEach(function(node) {
            if (!node.prerequisites || node.prerequisites.length === 0) {
                node.state = 'available';
            }
        });
        
        console.log('[SpellLearning] Reset complete - all nodes locked/available');
        
        // Re-render tree
        WheelRenderer.render();
        
        var unlockedEl = document.getElementById('unlocked-count'); if (unlockedEl) unlockedEl.textContent = '0';
    }
};

// Called when player loads into a save game (after kPostLoadGame)
// This refreshes progress and checks which spells the player knows
window.onSaveGameLoaded = function() {
    console.log('[SpellLearning] Save game loaded - refreshing player data');

    // First reset tree to clean state
    window.onResetTreeStates();

    // Then request fresh data from C++
    if (window.callCpp) {
        window.callCpp('GetProgress', '');
        window.callCpp('GetPlayerKnownSpells', '');
    }
};

// =============================================================================
// UNIFIED MASTERY CHECK
// =============================================================================
// This is THE ONLY function that should be used to determine if a spell counts
// as "mastered" (unlocked) for purposes of unlocking children.
//
// A spell is MASTERED if:
//   1. progress.unlocked === true, AND
//   2. XP progress >= 99.9%
//
// A spell is LEARNING (even if player has it) if:
//   - XP progress < 100% (early-learned/weakened)
//   - Player may have the spell but it doesn't count as mastered
//   - Children remain LOCKED
//
// With C++ fix: When player clears/switches learning targets, the early-learned
// spell is REMOVED from their inventory. So we don't have to worry about
// "player has spell but not learning it" edge cases for weakened spells.
// =============================================================================

function isSpellMastered(formId) {
    // Resolve canonical formId (strips _dup_ suffix for duplicate nodes)
    var canonId = resolveCanonicalId(formId);
    var progress = state.spellProgress[canonId] || state.spellProgress[formId];
    if (!progress) return false;

    // Must be marked as unlocked AND have 100% progress (or close enough)
    var progressPercent = progress.required > 0 ? (progress.xp / progress.required) * 100 : 0;
    var mastered = progress.unlocked === true && progressPercent >= 99.9;

    return mastered;
}

// Check if spell is currently being learned (has early access but not mastered)
// This now also checks state.weakenedSpells which comes from C++
function isSpellLearning(formId) {
    // Resolve canonical formId for duplicate nodes
    var canonId = resolveCanonicalId(formId);

    // First check: Is this spell in the weakened spells list from C++?
    // This is the authoritative source - C++ tracks all early-learned spells
    if (state.weakenedSpells && (state.weakenedSpells.has(canonId) || state.weakenedSpells.has(formId))) {
        return true;
    }

    // Fallback: Check if this spell is a current learning target with partial progress
    var isLearningTarget = false;
    for (var school in state.learningTargets) {
        if (state.learningTargets[school] === canonId || state.learningTargets[school] === formId) {
            isLearningTarget = true;
            break;
        }
    }

    if (!isLearningTarget) return false;

    // Check if player has it (from early grant) but not mastered
    var progress = state.spellProgress[canonId] || state.spellProgress[formId];
    if (!progress) return false;

    var progressPercent = progress.required > 0 ? (progress.xp / progress.required) * 100 : 0;

    // Learning = has progress but not at 100%
    return progressPercent >= (settings.earlySpellLearning.unlockThreshold || 20) &&
           progressPercent < 99.9;
}

/**
 * Resolve a formId to its canonical (original) form.
 * Strips _dup_ suffixes so all copies of a spell share the same progress key.
 * Also checks node's originalFormId if available.
 */
function resolveCanonicalId(formId) {
    if (!formId) return formId;
    // Strip _dup_XXXXX suffix
    var dupIdx = formId.indexOf('_dup_');
    if (dupIdx !== -1) {
        return formId.substring(0, dupIdx);
    }
    return formId;
}

// Helper function to recalculate node availability based on prerequisites
// IMPORTANT: Only MASTERED/ALREADY-KNOWN spells count as unlocked for prereq purposes
// Early-learned (weakened) spells do NOT unlock children
function recalculateNodeAvailability() {
    if (!state.treeData || !state.treeData.nodes) return 0;
    
    // Build a map for quick lookup
    var nodeMap = {};
    state.treeData.nodes.forEach(function(node) {
        nodeMap[node.id] = node;
        // Also map by formId for lookups
        if (node.formId && node.formId !== node.id) {
            nodeMap[node.formId] = node;
        }
    });
    
    // Helper: check if a prereq is truly mastered/already-known (not just learning)
    function isPrereqMastered(prereqId) {
        var prereqNode = nodeMap[prereqId];
        if (!prereqNode) return false;

        // If node state is 'unlocked', it's either mastered or already-known
        // (we've already filtered out learning spells in onPlayerKnownSpells)
        if (prereqNode.state === 'unlocked') {
            return true;
        }

        // Double-check with progress data (use canonical formId for duplicates)
        var canonicalId = getCanonicalFormId(prereqNode);
        var progress = state.spellProgress[canonicalId] || state.spellProgress[prereqNode.formId || prereqId];
        if (progress && progress.unlocked) {
            return true;
        }

        // Check if any duplicate sibling is unlocked
        var siblings = findDuplicateSiblings(prereqNode);
        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].state === 'unlocked') return true;
        }

        return false;
    }
    
    // For each node, check if all prerequisites are MASTERED
    var changedCount = 0;
    state.treeData.nodes.forEach(function(node) {
        // Use canonical formId for duplicate-aware lookups
        var canonId = getCanonicalFormId(node);

        // Skip if already mastered (unlocked with 100% XP)
        if (node.state === 'unlocked' && isSpellMastered(canonId)) {
            return;
        }

        // If node is "unlocked" but NOT mastered AND player doesn't have the spell, fix it
        // Don't downgrade if player actually has the spell (progress data may just be stale)
        if (node.state === 'unlocked' && !isSpellMastered(canonId)) {
            var playerHas = state.playerKnownSpells &&
                           (state.playerKnownSpells.has(canonId) || state.playerKnownSpells.has(node.formId));
            if (!playerHas) {
                node.state = 'available';
                changedCount++;
                console.warn('[SpellLearning] Fixed node ' + (node.name || node.id) + ' - was unlocked but not mastered and player does not have spell');
            }
        }
        
        // Check prerequisites (filter out self-references)
        var prereqs = (node.prerequisites || []).filter(function(prereqId) {
            if (prereqId === node.id || prereqId === node.formId) {
                return false;
            }
            return true;
        });
        
        if (prereqs.length === 0) {
            // No prerequisites - should be available (but preserve 'learning' state)
            if (node.state !== 'available' && node.state !== 'unlocked' && node.state !== 'learning') {
                node.state = 'available';
                changedCount++;
            }
        } else {
            // Has prerequisites — use hard/soft system (matches detail panel logic).
            // Hard prereqs: ALL must be mastered.
            // Soft prereqs: at least softNeeded must be mastered.
            // This prevents the "hidden prerequisites" bug where the detail panel
            // shows "complete" but the node stays locked.
            
            var hardPrereqs = node.hardPrereqs || [];
            var softPrereqs = node.softPrereqs || [];
            var softNeeded = node.softNeeded || 0;
            
            // Fallback: derive hard/soft from raw prerequisites if not yet computed
            // (same logic as treeViewerUI.js C++ bridge)
            if (hardPrereqs.length === 0 && softPrereqs.length === 0 && prereqs.length > 0) {
                if (prereqs.length === 1) {
                    hardPrereqs = prereqs.slice();
                } else {
                    hardPrereqs = [prereqs[0]];
                    softPrereqs = prereqs.slice(1);
                    softNeeded = 1;
                }
            }
            
            // Check hard prereqs: ALL must be mastered
            var allHardMet = hardPrereqs.every(isPrereqMastered);
            
            // Check soft prereqs: at least softNeeded must be mastered
            var softMet = 0;
            for (var si = 0; si < softPrereqs.length; si++) {
                if (isPrereqMastered(softPrereqs[si])) softMet++;
            }
            var softSatisfied = softNeeded === 0 || softMet >= softNeeded;
            
            if (allHardMet && softSatisfied) {
                if (node.state === 'locked') {
                    node.state = 'available';
                    changedCount++;
                    console.log('[SpellLearning] Node ' + (node.name || node.id) + ' now available (hard/soft prereqs met)');
                }
            } else {
                // Prerequisites not met - should be locked (but preserve 'learning' and 'unlocked' states)
                if (node.state !== 'locked' && node.state !== 'unlocked' && node.state !== 'learning') {
                    node.state = 'locked';
                    changedCount++;
                    console.log('[SpellLearning] Node ' + (node.name || node.id) + ' locked (prereqs not met: hard=' + 
                        (allHardMet ? 'ok' : 'FAIL') + ', soft=' + softMet + '/' + softNeeded + ')');
                }
            }
        }
    });
    
    return changedCount;
}

// Callback when we receive the list of player's known spells
window.onPlayerKnownSpells = function(dataStr) {
    console.log('[SpellLearning] Received player known spells');
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        var knownSpells = data.knownSpells || [];
        
        // Also get the weakened spells list (early-learned spells that aren't mastered)
        var weakenedSpells = data.weakenedSpells || [];
        
        console.log('[SpellLearning] Player knows ' + knownSpells.length + ' spells (' + 
                    weakenedSpells.length + ' are weakened/early-learned)');
        
        // Store in state for reference
        state.playerKnownSpells = new Set(knownSpells);
        state.weakenedSpells = new Set(weakenedSpells);  // Track which are weakened
        
        // Update tree node states if tree is loaded
        if (state.treeData && state.treeData.nodes) {
            var masteredCount = 0;
            var learningCount = 0;
            var alreadyKnownCount = 0;
            var relockedCount = 0;
            
            // ZERO PASS: Check for spells marked as "unlocked" that player doesn't actually have
            // This can happen if spell was removed via console, mod conflict, or save corruption
            state.treeData.nodes.forEach(function(node) {
                // Only check nodes marked as unlocked
                if (node.state !== 'unlocked') return;

                // Use canonical formId for duplicates
                var canonId = getCanonicalFormId(node);
                // If player doesn't have this spell, relock it
                if (!state.playerKnownSpells.has(canonId) && !state.playerKnownSpells.has(node.formId)) {
                    // Root nodes go to "available" (always learnable), others go to "locked"
                    var newState = node.isRoot ? 'available' : 'locked';
                    
                    console.warn('[SpellLearning] RELOCK: ' + (node.name || node.formId) + 
                                 ' was marked unlocked but player does not have spell -> ' + newState);
                    
                    // Reset state
                    node.state = newState;
                    
                    // Clear progress data (use canonical ID so duplicates share state)
                    if (state.spellProgress[canonId]) {
                        state.spellProgress[canonId].unlocked = false;
                        state.spellProgress[canonId].xp = 0;
                    }

                    // Sync visual state to all duplicate siblings
                    syncDuplicateState(node);

                    relockedCount++;
                }
            });
            
            if (relockedCount > 0) {
                console.log('[SpellLearning] Relocked ' + relockedCount + ' spells that player no longer has');
            }
            
            // First pass: Determine correct state for each known spell
            state.treeData.nodes.forEach(function(node) {
                // Use canonical formId for duplicate nodes
                var canonId = getCanonicalFormId(node);

                // Skip if not in player's known spells (check both canonical and actual formId)
                if (!state.playerKnownSpells.has(canonId) && !state.playerKnownSpells.has(node.formId)) {
                    return;
                }

                // Check if this spell is currently being LEARNED (active target, early-learned)
                if (isSpellLearning(canonId) || isSpellLearning(node.formId)) {
                    // LEARNING (early-learned, not mastered) - keep available, NOT unlocked
                    // Player has the spell (weakened) but children stay locked
                    if (node.state === 'locked') {
                        node.state = 'available';
                    }
                    // Never set to 'unlocked' for learning spells
                    if (node.state === 'unlocked') {
                        node.state = 'available';  // Fix invalid state
                        console.warn('[SpellLearning] Fixed ' + (node.name || node.formId) + ' - was unlocked while still learning');
                    }
                    // Sync visual state to all duplicate siblings
                    syncDuplicateState(node);

                    learningCount++;
                    var progress = state.spellProgress[canonId];
                    var pct = progress ? ((progress.xp / progress.required) * 100).toFixed(0) : '?';
                    console.log('[SpellLearning] ' + (node.name || node.formId) + ' is LEARNING (' + pct + '%) - children stay locked');
                } else {
                    // Player HAS the spell and it's NOT actively being learned
                    // This means they either:
                    // 1. Mastered it through our system (100% XP)
                    // 2. Already had it from vanilla/console/other mods
                    // Either way, it should count as UNLOCKED
                    
                    if (node.state !== 'unlocked') {
                        node.state = 'unlocked';
                        
                        // Also ensure progress data marks it as unlocked (use canonical ID)
                        if (!state.spellProgress[canonId]) {
                            // No progress data - spell from other source, create entry
                            state.spellProgress[canonId] = {
                                xp: 100,
                                required: 100,
                                unlocked: true,
                                ready: true
                            };
                            alreadyKnownCount++;
                            console.log('[SpellLearning] ' + (node.name || node.formId) + ' - ALREADY KNOWN (vanilla/console/other)');
                        } else if (!state.spellProgress[canonId].unlocked) {
                            // Has partial progress but not marked unlocked - player got it another way
                            state.spellProgress[canonId].unlocked = true;
                            state.spellProgress[canonId].xp = state.spellProgress[canonId].required || 100;
                            alreadyKnownCount++;
                            console.log('[SpellLearning] ' + (node.name || node.formId) + ' - marked UNLOCKED (player already has)');
                        } else {
                            masteredCount++;
                            console.log('[SpellLearning] ' + (node.name || node.formId) + ' is MASTERED');
                        }

                        // Sync visual state to all duplicate siblings
                        syncDuplicateState(node);
                    } else {
                        masteredCount++;
                    }
                }
            });
            
            // Second pass: Recalculate availability for all nodes
            // Spells that are unlocked (mastered OR already-known) can unlock children
            var availableCount = recalculateNodeAvailability();
            
            console.log('[SpellLearning] Mastered: ' + masteredCount + ', Already Known: ' + alreadyKnownCount + 
                        ', Learning: ' + learningCount + ', Relocked: ' + relockedCount + 
                        ', Availability updated: ' + availableCount);
            
            // Re-render tree and update counts
            // Use SmartRenderer which delegates to active renderer (SVG, Canvas, or WebGL)
            if (typeof SmartRenderer !== 'undefined' && SmartRenderer.refresh) {
                SmartRenderer.refresh();
            } else {
                WheelRenderer.render();
            }
            WheelRenderer.updateNodeStates();
            
            // Count all unlocked spells (mastered via our system OR already known)
            var unlockedCount = state.treeData.nodes.filter(function(n) { 
                return n.state === 'unlocked'; 
            }).length;
            var unlockedEl = document.getElementById('unlocked-count'); if (unlockedEl) unlockedEl.textContent = unlockedCount;
        }
    } catch (e) {
        console.error('[SpellLearning] Failed to parse player known spells:', e);
    }
};

window.onPrismaReady = function() {
    console.log('[SpellLearning] Prisma connection established');
    updateStatus('Ready to scan spells...');
    setStatusIcon('*');

    if (window.callCpp) {
        // Load unified config (all settings, API key, field settings in one file)
        console.log('[SpellLearning] Loading unified config...');
        window.callCpp('LoadUnifiedConfig', '');

        // Load tree rules prompt
        window.callCpp('LoadPrompt', '');

        // Check API availability (uses settings from unified config)
        checkLLMAvailability();

        // Auto-load saved spell tree (if exists)
        // loadTreeData() in treeViewerUI.js calls GetProgress and GetPlayerKnownSpells after loading
        // Do NOT call those here - let loadTreeData handle it to avoid race conditions
        console.log('[SpellLearning] Auto-loading saved spell tree...');
        window.callCpp('LoadSpellTree', '');
    }
};

// Track panel visibility state
window._panelVisible = true;

// Called when panel becomes visible (from C++)
window.onPanelShowing = function() {
    console.log('[SpellLearning] Panel showing - resuming rendering');
    window._panelVisible = true;

    // Resume render loop and force re-render
    if (typeof CanvasRenderer !== 'undefined') {
        if (CanvasRenderer.startRenderLoop) {
            CanvasRenderer.startRenderLoop();
        }
        CanvasRenderer._needsRender = true;
    }
    // Resume TreeGrowth if it was visible before hiding
    if (typeof TreeGrowth !== 'undefined' && TreeGrowth._visible) {
        TreeGrowth._startRenderLoop();
        TreeGrowth._markDirty();
    }
    // Resume TreePreview if it was visible before hiding
    if (typeof TreePreview !== 'undefined' && TreePreview._visible) {
        TreePreview._startRenderLoop();
        TreePreview._markDirty();
    }

    // Re-fetch progress and known spells from C++ to catch any XP gained while panel was hidden
    if (window.callCpp && state.treeData) {
        console.log('[SpellLearning] Panel showing - syncing progress from C++');
        window.callCpp('GetProgress', '');
        window.callCpp('GetPlayerKnownSpells', '');
    }

    // Refresh renderers
    if (typeof SmartRenderer !== 'undefined' && SmartRenderer.refresh) {
        SmartRenderer.refresh();
    }
    if (typeof WheelRenderer !== 'undefined') {
        WheelRenderer.updateNodeStates();
    }

    // Refresh selected node details panel if a node is selected
    if (state.selectedNode && typeof showSpellDetails === 'function') {
        showSpellDetails(state.selectedNode);
    }
};

// Called before panel hides (from C++)
window.onPanelHiding = function() {
    console.log('[SpellLearning] Panel hiding - stopping rendering');
    window._panelVisible = false;

    // Stop ALL render loops to free CPU
    // CanvasRenderer (main tree view - canvasRendererV2)
    if (typeof CanvasRenderer !== 'undefined' && CanvasRenderer.stopRenderLoop) {
        CanvasRenderer.stopRenderLoop();
    }
    // TreeGrowth preview canvas
    if (typeof TreeGrowth !== 'undefined' && TreeGrowth._stopRenderLoop) {
        TreeGrowth._stopRenderLoop();
    }
    // TreePreview canvas
    if (typeof TreePreview !== 'undefined' && TreePreview._stopRenderLoop) {
        TreePreview._stopRenderLoop();
    }

    // Stop ALL polling intervals
    if (state.llmPollInterval) {
        clearInterval(state.llmPollInterval);
        state.llmPollInterval = null;
    }
    if (typeof stopFeaturePolling === 'function') {
        stopFeaturePolling();
    }

    // Auto-save settings when panel closes
    if (typeof saveSettings === 'function') {
        saveSettings();
    }
};