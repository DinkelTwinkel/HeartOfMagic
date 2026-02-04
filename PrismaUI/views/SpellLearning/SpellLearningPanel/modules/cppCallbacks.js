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
 * Called by C++ when panel opens to report Python addon status
 * Controls whether Complex Build button is available
 */
window.onPythonAddonStatus = function(statusStr) {
    var installed = (statusStr === 'true');
    state.pythonAddonInstalled = installed;
    console.log('[SpellLearning] Python addon (SpellTreeBuilder) installed:', installed);
    
    var buildTreeBtn = document.getElementById('visualFirstBtn');
    if (buildTreeBtn) {
        if (!installed) {
            // Gray out Complex Build button if Python addon not installed
            buildTreeBtn.disabled = true;
            buildTreeBtn.title = 'Requires Python Addon - Install HeartOfMagic_PythonAddon to enable Complex Build';
        }
        // Note: Button stays disabled until spells are scanned even if addon is installed
        // The scan callback handles enabling it when both conditions are met
    }
    
    // Update the description text to show addon status
    var genModeRow = buildTreeBtn ? buildTreeBtn.closest('.gen-mode-row') : null;
    if (genModeRow) {
        var consSpan = genModeRow.querySelector('.gen-mode-cons');
        if (consSpan) {
            if (installed) {
                consSpan.textContent = 'Requires Python (addon installed)';
                consSpan.style.color = '#22c55e';  // Green
            } else {
                consSpan.textContent = 'Requires Python Addon (not installed)';
                consSpan.style.color = '#ef4444';  // Red
            }
        }
    }
};

window.updateSpellData = function(jsonStr) {
    console.log('[SpellLearning] Received spell data, length:', jsonStr.length);
    
    var scanSuccess = false;
    try {
        var data = JSON.parse(jsonStr);
        state.lastSpellData = data;
        
        var formatted = JSON.stringify(data, null, 2);
        document.getElementById('outputArea').value = formatted;
        
        if (state.fullAutoMode) {
            updateStatus('Step 2/3: Generating trees for ' + data.spellCount + ' spells...');
        } else {
            updateStatus('Scanned ' + data.spellCount + ' spells');
        }
        setStatusIcon('X');
        updateCharCount();
        scanSuccess = true;
        
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
        
        // Enable BUILD TREE buttons after successful scan
        // Complex Build (visualFirstBtn) only enabled if Python addon is installed
        var buildTreeBtn = document.getElementById('visualFirstBtn');
        if (buildTreeBtn && data.spells && data.spells.length > 0) {
            if (state.pythonAddonInstalled) {
                buildTreeBtn.disabled = false;
            } else {
                // Keep disabled and update tooltip
                buildTreeBtn.disabled = true;
                buildTreeBtn.title = 'Requires Python Addon - Install HeartOfMagic_PythonAddon to enable Complex Build';
            }
        }
        
        // Simple Build (proceduralBtn) always enabled when spells are available
        var simpleBuildBtn = document.getElementById('proceduralBtn');
        if (simpleBuildBtn && data.spells && data.spells.length > 0) {
            simpleBuildBtn.disabled = false;
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse spell data:', e);
        document.getElementById('outputArea').value = jsonStr;
        updateStatus('Received data (parse error)');
        setStatusIcon('!');
        state.fullAutoMode = false;
    }
    
    var scanBtn = document.getElementById('scanBtn');
    scanBtn.disabled = false;
    scanBtn.innerHTML = '<span class="btn-icon">ðŸ”</span>Scan All Spells';
    
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
    document.getElementById('statusText').textContent = msg;
};

window.updatePrompt = function(promptContent) {
    console.log('[SpellLearning] Received prompt, length:', promptContent.length);
    
    if (promptContent && promptContent.length > 0) {
        document.getElementById('promptArea').value = promptContent;
        state.originalPrompt = promptContent;
        state.promptModified = false;
        setPromptStatus('Loaded', '');
    }
};

window.onPromptSaved = function(success) {
    if (success === 'true' || success === true) {
        state.originalPrompt = document.getElementById('promptArea').value;
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
        updateStatus('Clipboard is empty');
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
            updateStatus('Pasted from clipboard (' + content.length + ' chars)');
            setStatusIcon('X');
            updateCharCount();
        } else if (targetId === 'import-textarea') {
            // Clear any previous error
            var errorBox = document.getElementById('import-error');
            if (errorBox) errorBox.classList.add('hidden');
        } else if (targetId === 'apiKeyInput') {
            // API key pasted
            targetEl.dataset.hasKey = 'false';
            updateStatus('API key pasted from clipboard');
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
            updateStatus('Custom model ID pasted: ' + content.trim());
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
        updateStatus('Copied to Windows clipboard!');
        setStatusIcon('X');
    } else {
        updateStatus('Copy failed');
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
        
        // Apply procedural prereq injection if enabled
        if (settings.proceduralPrereqInjection && typeof injectProceduralPrerequisites === 'function') {
            console.log('[SpellLearning] Running procedural prerequisite injection...');
            setTimeout(function() {
                injectProceduralPrerequisites();
            }, 100);  // Small delay to let tree render first
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
        
        var statusMsg = 'Loaded ' + foundCount + ' spells';
        if (notFoundCount > 0) {
            statusMsg += ' (' + notFoundCount + ' not found)';
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
    
    document.getElementById('unlocked-count').textContent = 
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
        
        document.getElementById('unlocked-count').textContent = '0';
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
            // Has prerequisites - check if ALL are MASTERED (100% XP)
            var allPrereqsMastered = prereqs.every(isPrereqMastered);

            if (allPrereqsMastered) {
                if (node.state === 'locked') {
                    node.state = 'available';
                    changedCount++;
                    console.log('[SpellLearning] Node ' + (node.name || node.id) + ' now available (all prereqs MASTERED)');
                }
            } else {
                // Prerequisites not mastered - should be locked (but preserve 'learning' and 'unlocked' states)
                if (node.state !== 'locked' && node.state !== 'unlocked' && node.state !== 'learning') {
                    node.state = 'locked';
                    changedCount++;
                    console.log('[SpellLearning] Node ' + (node.name || node.id) + ' locked (prereqs not mastered)');
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
            document.getElementById('unlocked-count').textContent = unlockedCount;
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
        // Force a render to refresh the display
        CanvasRenderer._needsRender = true;
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
    
    // Stop render loop to free CPU
    if (typeof CanvasRenderer !== 'undefined' && CanvasRenderer.stopRenderLoop) {
        CanvasRenderer.stopRenderLoop();
    }
    
    // Stop LLM polling if active
    if (state.llmPollInterval) {
        clearInterval(state.llmPollInterval);
        state.llmPollInterval = null;
    }
    
    // Auto-save settings when panel closes
    if (typeof saveSettings === 'function') {
        saveSettings();
    }
};