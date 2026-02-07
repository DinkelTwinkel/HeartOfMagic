/**
 * Progression UI Module
 * Handles How-To-Learn panel, Learning Status Badge, and Progression System
 * 
 * Depends on:
 * - modules/state.js (state, settings, xpOverrides)
 * - modules/wheelRenderer.js (WheelRenderer)
 * - modules/uiHelpers.js (updateStatus, getXPForTier)
 * 
 * Exports (global):
 * - initializeHowToLearnPanel()
 * - updateHowToLearnTab()
 * - initializeLearningStatusBadge()
 * - updateLearningStatusBadge()
 * - initializeProgressionSystem()
 * - calculateXPProgress()
 * - onProgressionSettingChanged()
 */

// =============================================================================
// HOW-TO-LEARN PANEL
// =============================================================================

function initializeHowToPanel() {
    var panel = document.getElementById('howto-panel');
    var tab = document.getElementById('howto-tab');
    var closeBtn = document.getElementById('close-howto');
    
    if (!panel || !tab) return;
    
    // Panel starts hidden - it's inside contentSpellTree which is already shown/hidden by tab switching
    // Only remove hidden when user is on the tree tab (which they are if this runs from initializeTreeViewer)
    // The panel will be visible via its parent container
    panel.classList.remove('hidden');
    panel.classList.remove('open'); // Make sure it starts collapsed (only tab showing)
    
    // Toggle panel on tab click
    tab.addEventListener('click', function() {
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) {
            updateHowToContent();
        }
    });
    
    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            panel.classList.remove('open');
        });
    }
    
    // Initial content update
    updateHowToContent();
}

function updateHowToContent() {
    var settingsList = document.getElementById('howto-settings-list');
    var xpList = document.getElementById('howto-xp-list');
    var tipsList = document.getElementById('howto-tips-list');
    
    // Settings list - reflects current earlySpellLearning settings
    if (settingsList) {
        var el = settings.earlySpellLearning;
        var settingsItems = [];
        
        if (el.enabled) {
            settingsItems.push('Spells unlock at ' + el.unlockThreshold + '% progress');
            settingsItems.push('Start at ' + el.minEffectiveness + '% power');
            settingsItems.push('Scale up to ' + el.maxEffectiveness + '% before mastery');
            settingsItems.push('At 100% mastery: full power unlocked!');
            settingsItems.push('After ' + el.selfCastRequiredAt + '%, must cast spell itself');
        } else {
            settingsItems.push('Early spell learning is disabled');
            settingsItems.push('Spells unlock at 100% XP');
            settingsItems.push('Click "Unlock Spell" when ready');
        }
        
        settingsList.innerHTML = '';
        settingsItems.forEach(function(text) {
            var li = document.createElement('li');
            li.textContent = text;
            settingsList.appendChild(li);
        });
    }
    
    // XP sources list - reflects multiplier settings
    if (xpList) {
        var xpItems = [];
        
        xpItems.push('Direct prerequisite: ' + settings.xpMultiplierDirect + '% XP');
        xpItems.push('Same school spell: ' + settings.xpMultiplierSchool + '% XP');
        xpItems.push('Any spell: ' + settings.xpMultiplierAny + '% XP');
        
        if (settings.islEnabled && settings.islDetected) {
            xpItems.push({
                text: 'ISL study: ' + settings.islXpPerHour + ' XP/hour',
                className: 'isl-active'
            });
            if (settings.islTomeBonus > 0) {
                xpItems.push({
                    text: 'Own spell tome: +' + settings.islTomeBonus + '% bonus',
                    className: 'isl-active'
                });
            }
        }
        
        xpList.innerHTML = '';
        xpItems.forEach(function(item) {
            var li = document.createElement('li');
            if (typeof item === 'string') {
                li.textContent = item;
            } else {
                li.textContent = item.text;
                if (item.className) li.classList.add(item.className);
            }
            xpList.appendChild(li);
        });
    }
    
    // Tips list - dynamic based on settings
    if (tipsList) {
        // Adjust tip based on learning mode setting
        var targetTip = settings.learningMode === 'perSchool' 
            ? 'Set learning targets (one per school)' 
            : 'Set one learning target at a time';
        
        var tipsItems = [
            targetTip,
            'Combat usage grants more XP than practice',
            'Higher tier spells take longer to master'
        ];
        
        if (settings.earlySpellLearning.enabled) {
            tipsItems.push('Practice with weakened spells to gain XP');
            tipsItems.push('The jump from ' + settings.earlySpellLearning.maxEffectiveness + '% to 100% feels amazing!');
        }
        
        tipsList.innerHTML = '';
        tipsItems.forEach(function(text) {
            var li = document.createElement('li');
            li.textContent = text;
            tipsList.appendChild(li);
        });
    }
}

// =============================================================================
// LEARNING STATUS BADGE
// =============================================================================

function updateLearningStatusBadge(node, progress) {
    var badge = document.getElementById('learning-status-badge');
    var effectiveness = document.getElementById('learning-effectiveness');
    var hint = document.getElementById('learning-status-hint');
    
    if (!badge) return;
    
    var el = settings.earlySpellLearning;
    var progressPercent = (progress.progress || 0) * 100;  // progress.progress is 0.0-1.0
    
    // Determine learning stage
    var stage, hintText, effectivenessPercent, effectivenessClass;
    
    if (node.state === 'unlocked' || progress.unlocked || progressPercent >= 100) {
        // MASTERED - 100% complete
        stage = 'mastered';
        hintText = 'Full mastery achieved! Spell at 100% power.';
        effectivenessPercent = 100;
        effectivenessClass = 'full';
    } else if (node.state === 'locked') {
        // LOCKED - Prerequisites not met
        stage = 'locked';
        hintText = 'Complete prerequisites first to begin learning.';
        effectivenessPercent = null;
        effectivenessClass = '';
    } else if (!el.enabled) {
        // Early learning disabled - simple available/locked display
        if (progressPercent > 0) {
            stage = 'studying';
            hintText = 'Cast prerequisite spells to gain XP.';
            effectivenessPercent = null;
            effectivenessClass = '';
        } else {
            stage = 'locked';
            hintText = 'Set as learning target to begin.';
            effectivenessPercent = null;
            effectivenessClass = '';
        }
    } else if (progressPercent < el.unlockThreshold) {
        // STUDYING - 0% to unlock threshold
        stage = 'studying';
        hintText = 'Cast prerequisite spells to unlock this spell at ' + el.unlockThreshold + '%.';
        effectivenessPercent = null;
        effectivenessClass = '';
    } else if (progressPercent < el.selfCastRequiredAt) {
        // WEAKENED - unlock threshold to selfCastRequiredAt
        stage = 'weakened';
        effectivenessPercent = calculateCurrentEffectiveness(progressPercent, el);
        effectivenessClass = 'weak';
        hintText = 'Spell obtained! ' + Math.round(effectivenessPercent) + '% power. Cast prerequisites to improve.';
    } else if (progressPercent < 100) {
        // PRACTICING - selfCastRequiredAt to 99%
        stage = 'practicing';
        effectivenessPercent = calculateCurrentEffectiveness(progressPercent, el);
        effectivenessClass = 'medium';
        hintText = 'Cast this spell directly to reach mastery! At 100%: full power jump!';
    } else {
        // Should not reach here, but fallback
        stage = 'studying';
        hintText = '';
        effectivenessPercent = null;
        effectivenessClass = '';
    }
    
    // Update badge
    badge.textContent = stage.toUpperCase();
    badge.className = 'learning-status-badge ' + stage;
    
    // Update effectiveness display
    if (effectiveness) {
        if (effectivenessPercent !== null) {
            effectiveness.textContent = Math.round(effectivenessPercent) + '% Power';
            effectiveness.className = 'learning-effectiveness ' + effectivenessClass;
        } else {
            effectiveness.textContent = '';
            effectiveness.className = 'learning-effectiveness';
        }
    }
    
    // Update hint
    if (hint) {
        hint.textContent = hintText;
    }
}

function calculateCurrentEffectiveness(progressPercent, el) {
    // Use power steps to determine effectiveness
    // Each step has { xp: threshold%, power: effectiveness% }
    
    if (progressPercent >= 100) {
        return 100;  // Mastered = full power
    }
    
    var steps = el.powerSteps;
    if (!steps || steps.length === 0) {
        // Fallback if no steps defined - linear interpolation
        var minEff = 20;
        var maxEff = 80;
        var t = Math.max(0, Math.min(1, progressPercent / 100));
        return minEff + t * (maxEff - minEff);
    }
    
    // Find the current step based on progress
    // Steps are sorted by XP threshold ascending
    var currentPower = steps[0].power || 20;  // Default to first step
    
    for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var threshold = step.xp || step.progressThreshold || 0;
        var power = step.power || step.effectiveness || 20;
        
        if (progressPercent >= threshold) {
            currentPower = power;
        } else {
            break;  // Progress below this step, use previous
        }
    }
    
    return currentPower;
}

// Get XP required for a spell tier
function getXPForTier(level) {
    if (!level) return settings.xpNovice;
    var levelLower = level.toLowerCase();
    switch (levelLower) {
        case 'novice': return settings.xpNovice;
        case 'apprentice': return settings.xpApprentice;
        case 'adept': return settings.xpAdept;
        case 'expert': return settings.xpExpert;
        case 'master': return settings.xpMaster;
        default: return settings.xpNovice;
    }
}

function setTreeStatus(msg) {
    var el = document.getElementById('tree-status-text');
    if (el) el.textContent = msg;
}

// =============================================================================
// PROGRESSION SYSTEM
// =============================================================================

function onLearnClick() {
    if (!state.selectedNode) return;
    
    var node = state.selectedNode;
    var isCurrentTarget = state.learningTargets[node.school] === node.formId;
    
    if (isCurrentTarget) {
        // Clear the target - C++ will remove early-learned spell from player
        if (window.callCpp) {
            window.callCpp('ClearLearningTarget', JSON.stringify({ school: node.school }));
        }
        delete state.learningTargets[node.school];
        
        // Reset node state from 'learning' back to 'available'
        if (node.state === 'learning') {
            node.state = 'available';
        }
        
        // Update local state - spell is no longer in player's possession (if early-learned)
        state.playerKnownSpells.delete(node.formId);
        
        // Rebuild learning paths and clear traveling particles
        if (typeof CanvasRenderer !== 'undefined' && CanvasRenderer._nodeMap) {
            CanvasRenderer._buildLearningPaths();
            CanvasRenderer._needsRender = true;
        }
        
        setTreeStatus('Stopped learning ' + (node.name || node.formId) + ' - spell removed');
        console.log('[SpellLearning] Cleared learning target - early spell removed from player');
    } else {
        // In "single" mode, clear ALL other learning targets first
        if (settings.learningMode === 'single') {
            for (var school in state.learningTargets) {
                if (state.learningTargets[school]) {
                    var oldTargetId = state.learningTargets[school];
                    if (window.callCpp) {
                        window.callCpp('ClearLearningTarget', JSON.stringify({ school: school }));
                    }
                    // C++ removes the early spell, update local state
                    state.playerKnownSpells.delete(oldTargetId);
                    
                    // Reset old target node state from 'learning' back to 'available'
                    if (state.treeData && state.treeData.nodes) {
                        var oldNode = state.treeData.nodes.find(function(n) { return n.formId === oldTargetId; });
                        if (oldNode && oldNode.state === 'learning') {
                            oldNode.state = 'available';
                        }
                    }
                    
                    console.log('[SpellLearning] Single mode: cleared learning target in ' + school + ' - spell removed');
                }
            }
            // Clear all local targets
            state.learningTargets = {};
        } else {
            // In "perSchool" mode, check if switching targets in same school
            var existingTarget = state.learningTargets[node.school];
            if (existingTarget && existingTarget !== node.formId) {
                // Switching targets in same school - old spell will be removed by C++
                state.playerKnownSpells.delete(existingTarget);
                
                // Reset old target node state from 'learning' back to 'available'
                if (state.treeData && state.treeData.nodes) {
                    var oldNode = state.treeData.nodes.find(function(n) { return n.formId === existingTarget; });
                    if (oldNode && oldNode.state === 'learning') {
                        oldNode.state = 'available';
                    }
                }
                
                console.log('[SpellLearning] Switching target in ' + node.school + ' - old spell removed');
            }
        }
        
        // Set as learning target with prerequisites for direct XP detection
        var prereqs = node.prerequisites || [];
        var reqXP = node.requiredXP || 100;  // Default to 100 if not specified
        console.log('[SpellLearning] Setting learning target:', node.formId, 'with', prereqs.length, 'prereqs, requiredXP:', reqXP);

        if (window.callCpp) {
            window.callCpp('SetLearningTarget', JSON.stringify({
                school: node.school,
                formId: node.formId,
                prerequisites: prereqs,
                requiredXP: reqXP
            }));
        }
        state.learningTargets[node.school] = node.formId;
        
        // Set node state to 'learning'
        if (node.state !== 'unlocked') {
            node.state = 'learning';
        }
        
        // Rebuild learning paths for CanvasRenderer
        if (typeof CanvasRenderer !== 'undefined' && CanvasRenderer._nodeMap) {
            CanvasRenderer._buildLearningPaths();
            CanvasRenderer.triggerLearningAnimation(node.id);  // Trigger line animation
            CanvasRenderer._needsRender = true;
        }
        
        setTreeStatus('Now learning: ' + (node.name || node.formId));
    }
    
    // Recalculate node availability (in case switching targets changes what's available)
    if (typeof recalculateNodeAvailability === 'function') {
        recalculateNodeAvailability();
    }
    
    updateDetailsProgression(node);
    WheelRenderer.updateNodeStates();
}

function onUnlockClick() {
    if (!state.selectedNode) return;
    
    var node = state.selectedNode;
    var canonId = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(node) : node.formId;
    var progress = state.spellProgress[canonId] || { xp: 0, required: 100, unlocked: false };

    // CHEAT MODE: Allow unlocking/relocking any node
    if (settings.cheatMode) {
        if (node.state === 'unlocked' || progress.unlocked) {
            // Relock the spell (remove from player) - send canonical formId to C++
            if (window.callCpp) {
                window.callCpp('RelockSpell', JSON.stringify({ formId: canonId }));
                setTreeStatus('Relocking ' + (node.name || node.formId) + '...');
            }

            // Update local state immediately for responsiveness (canonical ID)
            if (state.spellProgress[canonId]) {
                state.spellProgress[canonId].unlocked = false;
                state.spellProgress[canonId].xp = 0;
            }
            node.state = 'available';
            if (typeof syncDuplicateState === 'function') syncDuplicateState(node);

            // Update UI
            WheelRenderer.updateNodeStates();
            updateDetailsProgression(node);

            // Update the state badge
            var stateBadge = document.getElementById('spell-state');
            if (stateBadge) {
                stateBadge.textContent = 'Available';
                stateBadge.className = 'state-badge available';
            }
        } else {
            // Unlock the spell (cheat - bypass XP) - send canonical formId to C++
            if (window.callCpp) {
                window.callCpp('CheatUnlockSpell', JSON.stringify({ formId: canonId }));
                setTreeStatus('Cheat unlocking ' + (node.name || node.formId) + '...');
            }

            // Update local state immediately for responsiveness (canonical ID)
            state.spellProgress[canonId] = {
                xp: 100,
                required: 100,
                unlocked: true,
                ready: true
            };
            node.state = 'unlocked';
            if (typeof syncDuplicateState === 'function') syncDuplicateState(node);
            
            // Update UI
            WheelRenderer.updateNodeStates();
            updateDetailsProgression(node);
            
            // Update the state badge
            var stateBadge = document.getElementById('spell-state');
            if (stateBadge) {
                stateBadge.textContent = 'Unlocked';
                stateBadge.className = 'state-badge unlocked';
            }
        }
        
        // Update unlocked count
        if (state.treeData) {
            document.getElementById('unlocked-count').textContent = 
                state.treeData.nodes.filter(function(n) { return n.state === 'unlocked'; }).length;
        }
        return;
    }
    
    // NORMAL MODE: Require XP
    if (!progress || progress.xp < progress.required) {
        setTreeStatus('Not enough XP to unlock');
        return;
    }
    
    if (window.callCpp) {
        window.callCpp('UnlockSpell', JSON.stringify({ formId: canonId }));
        setTreeStatus('Unlocking ' + (node.name || node.formId) + '...');
    }
}

// C++ Callbacks for progression
window.onProgressUpdate = function(dataStr) {
    console.log('[SpellLearning] Progress update received:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        console.log('[SpellLearning] Parsed progress data:', JSON.stringify(data));
        
        // Store progress data under canonical ID so duplicates share state
        var canonId = (typeof resolveCanonicalId === 'function') ? resolveCanonicalId(data.formId) : data.formId;

        // Use current JS tier settings as authoritative required XP (not stale C++ value)
        var _node = state.treeData ? state.treeData.nodes.find(function(n) {
            var nc = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(n) : n.formId;
            return nc === canonId;
        }) : null;
        var _tierReq = _node ? (getXPForTier(_node.level) || data.requiredXP) : data.requiredXP;
        var _req = (typeof xpOverrides !== 'undefined' && xpOverrides[data.formId] !== undefined) ? xpOverrides[data.formId] : _tierReq;

        state.spellProgress[canonId] = {
            xp: data.currentXP,
            required: _req,
            progress: _req > 0 ? data.currentXP / _req : 0,
            unlocked: data.unlocked || false,  // Use unlocked status from C++
            ready: data.ready || (data.currentXP >= _req)
        };
        console.log('[SpellLearning] Stored progress for ' + canonId + ': XP=' + data.currentXP + '/' + _req + ', unlocked=' + (data.unlocked || false));

        // Use UNIFIED mastery check to determine if truly mastered
        var isMastered = typeof isSpellMastered === 'function' && isSpellMastered(canonId);

        // Only set node state to 'unlocked' if TRULY mastered (100% XP)
        // Find ALL nodes matching this canonical formId (including duplicates)
        if (isMastered && state.treeData) {
            state.treeData.nodes.forEach(function(n) {
                var nCanon = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(n) : n.formId;
                if (nCanon === canonId && n.state !== 'unlocked') {
                    n.state = 'unlocked';
                    console.log('[SpellLearning] Node MASTERED (100%), state updated to unlocked: ' + n.formId);
                    if (typeof syncDuplicateState === 'function') syncDuplicateState(n);
                }
            });
            // Recalculate availability for children - NOW they can unlock
            if (typeof recalculateNodeAvailability === 'function') {
                recalculateNodeAvailability();
            }
        } else if (data.unlocked && !isMastered) {
            // C++ says unlocked but unified check says not mastered - log warning
            console.warn('[SpellLearning] C++ says unlocked but not mastered yet: ' + canonId);
        }

        // Update details panel if this is the selected node (match canonical ID)
        var selectedCanon = state.selectedNode ? ((typeof getCanonicalFormId === 'function') ? getCanonicalFormId(state.selectedNode) : state.selectedNode.formId) : null;
        if (state.selectedNode && selectedCanon === canonId) {
            console.log('[SpellLearning] Updating details panel for selected node');
            // Only update state to unlocked if truly mastered
            if (isMastered) {
                state.selectedNode.state = 'unlocked';
            }
            // Refresh FULL details panel (includes name/effects reveal based on progress)
            if (typeof showSpellDetails === 'function') {
                showSpellDetails(state.selectedNode);
            } else {
                updateDetailsProgression(state.selectedNode);
            }
        }
        
        // Update node visuals in all renderers
        if (state.treeData) {
            console.log('[SpellLearning] Updating node states in tree');
            WheelRenderer.updateNodeStates();
            if (typeof CanvasRenderer !== 'undefined') {
                CanvasRenderer._needsRender = true;
            }
            if (typeof SmartRenderer !== 'undefined' && SmartRenderer.refresh) {
                SmartRenderer.refresh();
            }
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse progress update:', e);
    }
};

window.onSpellReady = function(dataStr) {
    console.log('[SpellLearning] Spell ready to unlock:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        var canonId = (typeof resolveCanonicalId === 'function') ? resolveCanonicalId(data.formId) : data.formId;
        if (state.spellProgress[canonId]) {
            state.spellProgress[canonId].ready = true;
        }

        // Get spell name
        var node = state.treeData ? state.treeData.nodes.find(function(n) {
            return n.formId === data.formId || n.originalFormId === data.formId;
        }) : null;
        var name = node ? (node.name || node.formId) : data.formId;

        setTreeStatus(name + ' is ready to unlock!');

        // Update details panel if selected node matches canonical ID
        var selectedCanon = state.selectedNode ? ((typeof getCanonicalFormId === 'function') ? getCanonicalFormId(state.selectedNode) : state.selectedNode.formId) : null;
        if (state.selectedNode && selectedCanon === canonId) {
            updateDetailsProgression(state.selectedNode);
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse spell ready:', e);
    }
};

window.onSpellUnlocked = function(dataStr) {
    console.log('[SpellLearning] Spell unlocked:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        
        if (data.success) {
            var canonId = (typeof resolveCanonicalId === 'function') ? resolveCanonicalId(data.formId) : data.formId;

            // Update progress to mark as mastered (canonical ID)
            if (!state.spellProgress[canonId]) {
                state.spellProgress[canonId] = { xp: 100, required: 100 };
            }
            state.spellProgress[canonId].unlocked = true;
            state.spellProgress[canonId].xp = state.spellProgress[canonId].required || 100;

            // Update ALL nodes matching canonical ID (including duplicates)
            if (state.treeData) {
                state.treeData.nodes.forEach(function(n) {
                    var nCanon = (typeof getCanonicalFormId === 'function') ? getCanonicalFormId(n) : n.formId;
                    if (nCanon === canonId && n.state !== 'unlocked') {
                        n.state = 'unlocked';
                        setTreeStatus('MASTERED: ' + (n.name || n.formId) + '!');
                        if (typeof syncDuplicateState === 'function') syncDuplicateState(n);
                    }
                });

                // Recalculate availability - children of MASTERED nodes become available
                if (typeof recalculateNodeAvailability === 'function') {
                    var changed = recalculateNodeAvailability();
                    console.log('[SpellLearning] Spell mastered - ' + changed + ' children now available');
                }
            }

            // Clear learning target (check canonical ID)
            for (var school in state.learningTargets) {
                var targetCanon = (typeof resolveCanonicalId === 'function') ? resolveCanonicalId(state.learningTargets[school]) : state.learningTargets[school];
                if (targetCanon === canonId) {
                    delete state.learningTargets[school];
                    break;
                }
            }

            // Refresh display - full re-render needed in discovery mode to show new nodes
            if (settings.discoveryMode) {
                WheelRenderer.render();
            } else {
                WheelRenderer.updateNodeStates();
            }

            var selectedCanon = state.selectedNode ? ((typeof getCanonicalFormId === 'function') ? getCanonicalFormId(state.selectedNode) : state.selectedNode.formId) : null;
            if (state.selectedNode && selectedCanon === canonId) {
                state.selectedNode.state = 'unlocked';
                showSpellDetails(state.selectedNode);
            }
            
            // Update unlocked count - only count truly mastered spells
            var unlockedCount = state.treeData.nodes.filter(function(n) { 
                return n.state === 'unlocked' && 
                       (typeof isSpellMastered === 'function' ? isSpellMastered(n.formId) : true); 
            }).length;
            document.getElementById('unlocked-count').textContent = unlockedCount;
        } else {
            setTreeStatus('Failed to unlock spell');
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse unlock result:', e);
    }
};

window.onLearningTargetSet = function(dataStr) {
    console.log('[SpellLearning] Learning target set:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        
        // Update state.learningTargets immediately
        if (data.school && data.formId) {
            state.learningTargets[data.school] = data.formId;
            console.log('[SpellLearning] Updated learning target: ' + data.school + ' -> ' + data.formId + ' (' + data.spellName + ')');
            
            // Initialize progress entry if needed (use canonical ID)
            var lCanonId = (typeof resolveCanonicalId === 'function') ? resolveCanonicalId(data.formId) : data.formId;
            if (!state.spellProgress[lCanonId]) {
                state.spellProgress[lCanonId] = {
                    xp: 0,
                    required: 100,
                    unlocked: false,
                    ready: false
                };
            }

            // Update node state to 'learning' if it exists in tree (match duplicates too)
            if (state.treeData) {
                var node = state.treeData.nodes.find(function(n) { return n.formId === data.formId || n.originalFormId === data.formId; });
                if (node && node.state !== 'unlocked') {
                    // Mark as available (learning) not unlocked
                    if (node.state === 'locked') {
                        node.state = 'available';
                    }
                    console.log('[SpellLearning] Node ' + (node.name || data.formId) + ' set as learning target');
                    WheelRenderer.updateNodeStates();
                }
            }
            
            setTreeStatus('Now learning: ' + (data.spellName || data.formId));
        }
    } catch (e) {
        console.error('[SpellLearning] Failed to parse learning target:', e);
    }
};

window.onProgressData = function(dataStr) {
    console.log('[SpellLearning] Progress data received:', dataStr);
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        
        // Load learning targets
        if (data.learningTargets) {
            state.learningTargets = data.learningTargets;
            console.log('[SpellLearning] Loaded learning targets:', JSON.stringify(state.learningTargets));
            
            // Apply learning states to tree nodes
            if (state.treeData && state.treeData.nodes) {
                // Build a Set of learning target formIds for fast lookup
                var learningFormIds = new Set();
                for (var school in state.learningTargets) {
                    var formId = state.learningTargets[school];
                    if (formId) {
                        learningFormIds.add(formId);
                        // Also try without 0x prefix
                        if (formId.startsWith('0x')) {
                            learningFormIds.add(formId.substring(2));
                        }
                    }
                }
                
                // Update node states to 'learning' for active learning targets
                state.treeData.nodes.forEach(function(node) {
                    if (!node.formId) return;
                    
                    var nodeFormId = node.formId;
                    var isLearningTarget = learningFormIds.has(nodeFormId);
                    
                    // Also check with 0x prefix if node doesn't have it
                    if (!isLearningTarget && !nodeFormId.startsWith('0x')) {
                        isLearningTarget = learningFormIds.has('0x' + nodeFormId);
                    }
                    
                    if (isLearningTarget && node.state !== 'unlocked') {
                        console.log('[SpellLearning] Setting node ' + (node.name || node.formId) + ' to learning state');
                        node.state = 'learning';
                    }
                });
                
                // Rebuild CanvasRenderer learning paths if available
                if (typeof CanvasRenderer !== 'undefined' && CanvasRenderer._nodeMap) {
                    console.log('[SpellLearning] Rebuilding CanvasRenderer learning paths...');
                    CanvasRenderer._buildLearningPaths();
                    CanvasRenderer._needsRender = true;
                }
            }
        }
        
        // Load spell progress
        if (data.spellProgress) {
            state.spellProgress = data.spellProgress;
            var count = Object.keys(state.spellProgress).length;
            console.log('[SpellLearning] Loaded progress for ' + count + ' spells');
            
            // Log a few examples
            var keys = Object.keys(state.spellProgress).slice(0, 3);
            keys.forEach(function(k) {
                var p = state.spellProgress[k];
                console.log('[SpellLearning]   ' + k + ': ' + p.xp + '/' + p.required + ' XP');
            });
        }
        
        // Update display
        if (state.treeData) {
            WheelRenderer.updateNodeStates();
        }
        
        // Update details panel if a node is selected
        if (state.selectedNode) {
            updateDetailsProgression(state.selectedNode);
        }

    } catch (e) {
        console.error('[SpellLearning] Failed to parse progress data:', e);
    }

    // Note: GetPlayerKnownSpells is now called directly from the caller (onPanelShowing, etc.)
    // rather than using a deferred flag mechanism
};

