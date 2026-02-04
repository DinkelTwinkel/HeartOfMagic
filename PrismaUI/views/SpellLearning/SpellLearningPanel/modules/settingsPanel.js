/**
 * Settings Panel Module
 * Handles all settings UI initialization and config management
 * 
 * Depends on:
 * - modules/constants.js (KEY_CODES, DIFFICULTY_PROFILES)
 * - modules/state.js (settings, customProfiles, xpOverrides)
 * - modules/colorUtils.js (applySchoolColorsToCSS, updateSchoolColorPickerUI)
 * - modules/uiHelpers.js (updateStatus, updateSliderFillGlobal)
 * 
 * Exports (global):
 * - initializeSettings()
 * - loadSettings()
 * - saveSettings()
 * - autoSaveSettings()
 * - saveUnifiedConfig()
 * - resetSettings()
 * - window.onUnifiedConfigLoaded
 */

// =============================================================================
// SETTINGS PANEL
// =============================================================================

/**
 * Update the Retry School UI based on schools that need attention
 * Called periodically to keep the dropdown current
 */
function updateRetrySchoolUI() {
    var retrySchoolRow = document.getElementById('retrySchoolRow');
    var retrySchoolSelect = document.getElementById('retrySchoolSelect');
    
    if (!retrySchoolRow || !retrySchoolSelect) return;
    
    // Get schools needing attention
    var needsAttention = window.getSchoolsNeedingAttention ? window.getSchoolsNeedingAttention() : [];
    
    // Also include failed schools if any
    var failedSchools = state.lastFailedSchools || [];
    
    // Combine both lists
    var allProblemSchools = [];
    needsAttention.forEach(function(info) {
        allProblemSchools.push({
            school: info.school,
            reason: info.unreachableCount + ' unreachable nodes'
        });
    });
    failedSchools.forEach(function(school) {
        // Don't duplicate
        if (!allProblemSchools.some(function(p) { return p.school === school; })) {
            allProblemSchools.push({
                school: school,
                reason: 'generation failed'
            });
        }
    });
    
    // Show/hide the row
    if (allProblemSchools.length > 0) {
        retrySchoolRow.style.display = 'flex';
        
        // Remember current selection
        var currentSelection = retrySchoolSelect.value;
        
        // Rebuild dropdown options
        retrySchoolSelect.innerHTML = '<option value="">Select school...</option>';
        allProblemSchools.forEach(function(info) {
            var option = document.createElement('option');
            option.value = info.school;
            option.textContent = info.school + ' (' + info.reason + ')';
            retrySchoolSelect.appendChild(option);
        });
        
        // Restore selection if still valid
        if (currentSelection && allProblemSchools.some(function(p) { return p.school === currentSelection; })) {
            retrySchoolSelect.value = currentSelection;
        }
    } else {
        retrySchoolRow.style.display = 'none';
    }
}

/**
 * Update visibility of developer-only elements based on developer mode setting.
 * @param {boolean} enabled - Whether developer mode is enabled
 */
function updateDeveloperModeVisibility(enabled) {
    console.log('[SpellLearning] Updating developer mode visibility:', enabled);
    
    // Get all elements with dev-only class
    var devOnlyElements = document.querySelectorAll('.dev-only');
    devOnlyElements.forEach(function(el) {
        if (enabled) {
            el.classList.remove('hidden');
            el.style.display = '';
        } else {
            el.classList.add('hidden');
            el.style.display = 'none';
        }
    });
    
    // Show/hide debug options section in settings
    var debugOptionsSection = document.getElementById('debugOptionsSection');
    if (debugOptionsSection) {
        if (enabled) {
            debugOptionsSection.classList.remove('hidden');
        } else {
            debugOptionsSection.classList.add('hidden');
        }
    }
    
    // Handle Tree Rules tab visibility
    var treeRulesTab = document.getElementById('tabTreeRules');
    if (treeRulesTab) {
        if (enabled) {
            treeRulesTab.style.display = '';
        } else {
            treeRulesTab.style.display = 'none';
            // If currently on Tree Rules tab, switch to Spell Scan
            if (treeRulesTab.classList.contains('active')) {
                var spellScanTab = document.getElementById('tabSpellScan');
                if (spellScanTab) {
                    spellScanTab.click();
                }
            }
        }
    }
}

function initializeSettings() {
    // Load saved settings
    loadSettings();
    
    // Verbose logging toggle
    var verboseToggle = document.getElementById('verboseLogToggle');
    if (verboseToggle) {
        verboseToggle.checked = settings.verboseLogging;
        verboseToggle.addEventListener('change', function() {
            settings.verboseLogging = this.checked;
        });
    }
    
    // Debug grid toggle - shows grid candidate positions
    var debugGridToggle = document.getElementById('debugGridToggle');
    if (debugGridToggle) {
        debugGridToggle.checked = settings.showDebugGrid || false;
        debugGridToggle.addEventListener('change', function() {
            settings.showDebugGrid = this.checked;
            console.log('[SpellLearning] Debug grid:', settings.showDebugGrid);
            
            // Update SVG renderer
            if (typeof WheelRenderer !== 'undefined') {
                WheelRenderer.showDebugGrid = this.checked;
                if (WheelRenderer.debugGridLayer) {
                    WheelRenderer.debugGridLayer.style.display = this.checked ? 'block' : 'none';
                }
                if (this.checked) {
                    WheelRenderer.renderDebugGrid();
                }
            }
            
            // Update Canvas renderer
            if (typeof CanvasRenderer !== 'undefined') {
                CanvasRenderer.showDebugGrid = this.checked;
                CanvasRenderer._needsRender = true;
            }
        });
    }
    
    // Developer mode toggle - shows/hides advanced options
    var devModeToggle = document.getElementById('developerModeToggle');
    var debugOptionsSection = document.getElementById('debugOptionsSection');
    if (devModeToggle) {
        devModeToggle.checked = settings.developerMode || false;
        updateDeveloperModeVisibility(settings.developerMode || false);
        
        devModeToggle.addEventListener('change', function() {
            settings.developerMode = this.checked;
            console.log('[SpellLearning] Developer mode:', settings.developerMode);
            updateDeveloperModeVisibility(settings.developerMode);
        });
    }
    
    // Cheat mode toggle - includes all debug features
    var cheatToggle = document.getElementById('cheatModeToggle');
    var cheatInfo = document.getElementById('cheatModeInfo');
    if (cheatToggle) {
        cheatToggle.checked = settings.cheatMode;
        if (cheatInfo) cheatInfo.classList.toggle('hidden', !settings.cheatMode);
        
        cheatToggle.addEventListener('change', function() {
            settings.cheatMode = this.checked;
            console.log('[SpellLearning] Cheat mode:', settings.cheatMode);
            if (cheatInfo) cheatInfo.classList.toggle('hidden', !settings.cheatMode);
            // Re-render tree to show/hide all spell names
            if (state.treeData) {
                WheelRenderer.render();
                // Also refresh canvas renderer
                if (typeof CanvasRenderer !== 'undefined') {
                    CanvasRenderer.refresh();
                }
                if (typeof SmartRenderer !== 'undefined') {
                    SmartRenderer.refresh();
                }
            }
            // Update button visibility if node is selected
            if (state.selectedNode) {
                showSpellDetails(state.selectedNode);
                updateDetailsProgression(state.selectedNode);
            }
        });
    }
    
    // Node size scaling toggle
    var nodeSizeToggle = document.getElementById('nodeSizeScalingToggle');
    if (nodeSizeToggle) {
        nodeSizeToggle.checked = settings.nodeSizeScaling;
        nodeSizeToggle.addEventListener('change', function() {
            settings.nodeSizeScaling = this.checked;
            console.log('[SpellLearning] Node size scaling:', settings.nodeSizeScaling);
            // Re-render tree with new sizing
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Show node names toggle
    var showNamesToggle = document.getElementById('showNodeNamesToggle');
    if (showNamesToggle) {
        showNamesToggle.checked = settings.showNodeNames;
        showNamesToggle.addEventListener('change', function() {
            settings.showNodeNames = this.checked;
            console.log('[SpellLearning] Show node names:', settings.showNodeNames);
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Show school dividers toggle
    var showDividersToggle = document.getElementById('showSchoolDividersToggle');
    if (showDividersToggle) {
        showDividersToggle.checked = settings.showSchoolDividers;
        showDividersToggle.addEventListener('change', function() {
            settings.showSchoolDividers = this.checked;
            console.log('[SpellLearning] Show school dividers:', settings.showSchoolDividers);
            // Show/hide related settings
            updateDividerSettingsVisibility();
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Strict pie slices toggle
    var strictPieSlicesToggle = document.getElementById('strictPieSlicesToggle');
    if (strictPieSlicesToggle) {
        strictPieSlicesToggle.checked = settings.strictPieSlices;
        strictPieSlicesToggle.addEventListener('change', function() {
            settings.strictPieSlices = this.checked;
            console.log('[SpellLearning] Strict pie slices:', settings.strictPieSlices);
            // Re-layout and render tree
            if (state.treeData) {
                WheelRenderer.layout();
                WheelRenderer.render();
            }
        });
    }
    
    // Discovery mode toggle
    var discoveryModeToggle = document.getElementById('discoveryModeToggle');
    if (discoveryModeToggle) {
        discoveryModeToggle.checked = settings.discoveryMode;
        discoveryModeToggle.addEventListener('change', function() {
            settings.discoveryMode = this.checked;
            console.log('[SpellLearning] Discovery mode:', settings.discoveryMode);
            // Re-render tree to show/hide locked nodes
            if (state.treeData) {
                WheelRenderer.render();
                // Also refresh canvas renderer (rebuilds discovery visibility)
                if (typeof CanvasRenderer !== 'undefined') {
                    CanvasRenderer.refresh();
                }
                if (typeof SmartRenderer !== 'undefined') {
                    SmartRenderer.refresh();
                }
            }
            onProgressionSettingChanged();
        });
    }
    
    // Show root spell names toggle (for discovery mode)
    var showRootNamesToggle = document.getElementById('showRootSpellNamesToggle');
    if (showRootNamesToggle) {
        showRootNamesToggle.checked = settings.showRootSpellNames;
        showRootNamesToggle.addEventListener('change', function() {
            settings.showRootSpellNames = this.checked;
            console.log('[SpellLearning] Show root spell names:', settings.showRootSpellNames);
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
            onProgressionSettingChanged();
        });
    }
    
    // ===========================================================================
    // SPELL TOME LEARNING SETTINGS
    // ===========================================================================
    
    // Use Progression System toggle (Vanilla vs XP system)
    var useProgressionToggle = document.getElementById('useProgressionSystemToggle');
    if (useProgressionToggle) {
        useProgressionToggle.checked = settings.spellTomeLearning.useProgressionSystem;
        useProgressionToggle.addEventListener('change', function() {
            settings.spellTomeLearning.useProgressionSystem = this.checked;
            console.log('[SpellLearning] Use progression system:', this.checked);
            // Update description
            var modeDesc = document.getElementById('tomeLearningModeDesc');
            if (modeDesc) {
                if (this.checked) {
                    modeDesc.textContent = 'Reading tomes grants XP and gives early access to weakened spells. Keep tomes to practice!';
                } else {
                    modeDesc.textContent = 'Vanilla behavior: Reading tomes instantly teaches spells and consumes the book.';
                }
            }
            // Show/hide progression-specific settings
            var xpGrantRow = document.getElementById('tomeXpGrantRow');
            if (xpGrantRow) xpGrantRow.style.display = this.checked ? '' : 'none';
            
            scheduleAutoSave();
        });
        // Initial visibility
        var xpGrantRow = document.getElementById('tomeXpGrantRow');
        if (xpGrantRow) xpGrantRow.style.display = settings.spellTomeLearning.useProgressionSystem ? '' : 'none';
    }
    
    // Tome XP Grant slider
    var tomeXpGrantSlider = document.getElementById('tomeXpGrantSlider');
    var tomeXpGrantValue = document.getElementById('tomeXpGrantValue');
    if (tomeXpGrantSlider) {
        tomeXpGrantSlider.value = settings.spellTomeLearning.xpPercentToGrant;
        if (tomeXpGrantValue) tomeXpGrantValue.textContent = settings.spellTomeLearning.xpPercentToGrant + '%';
        updateSliderFillGlobal(tomeXpGrantSlider);
        
        tomeXpGrantSlider.addEventListener('input', function() {
            var value = parseInt(this.value);
            settings.spellTomeLearning.xpPercentToGrant = value;
            if (tomeXpGrantValue) tomeXpGrantValue.textContent = value + '%';
            updateSliderFillGlobal(this);
            scheduleAutoSave();
        });
    }
    
    // Tome Inventory Boost toggle
    var tomeInventoryBoostToggle = document.getElementById('tomeInventoryBoostToggle');
    if (tomeInventoryBoostToggle) {
        tomeInventoryBoostToggle.checked = settings.spellTomeLearning.tomeInventoryBoost;
        tomeInventoryBoostToggle.addEventListener('change', function() {
            settings.spellTomeLearning.tomeInventoryBoost = this.checked;
            console.log('[SpellLearning] Tome inventory boost:', this.checked);
            // Show/hide boost slider
            var boostRow = document.getElementById('tomeInventoryBoostRow');
            if (boostRow) boostRow.style.display = this.checked ? '' : 'none';
            scheduleAutoSave();
        });
        // Initial visibility
        var boostRow = document.getElementById('tomeInventoryBoostRow');
        if (boostRow) boostRow.style.display = settings.spellTomeLearning.tomeInventoryBoost ? '' : 'none';
    }
    
    // Tome Inventory Boost Percent slider
    var tomeBoostSlider = document.getElementById('tomeInventoryBoostSlider');
    var tomeBoostValue = document.getElementById('tomeInventoryBoostValue');
    if (tomeBoostSlider) {
        tomeBoostSlider.value = settings.spellTomeLearning.tomeInventoryBoostPercent;
        if (tomeBoostValue) tomeBoostValue.textContent = '+' + settings.spellTomeLearning.tomeInventoryBoostPercent + '%';
        updateSliderFillGlobal(tomeBoostSlider);
        
        tomeBoostSlider.addEventListener('input', function() {
            var value = parseInt(this.value);
            settings.spellTomeLearning.tomeInventoryBoostPercent = value;
            if (tomeBoostValue) tomeBoostValue.textContent = '+' + value + '%';
            updateSliderFillGlobal(this);
            scheduleAutoSave();
        });
    }
    
    // Require Prerequisites toggle
    var requirePrereqsToggle = document.getElementById('tomeRequirePrereqsToggle');
    if (requirePrereqsToggle) {
        requirePrereqsToggle.checked = settings.spellTomeLearning.requirePrereqs;
        requirePrereqsToggle.addEventListener('change', function() {
            settings.spellTomeLearning.requirePrereqs = this.checked;
            console.log('[SpellLearning] Tome require prereqs:', this.checked);
            // Show/hide child setting
            var allPrereqsRow = document.getElementById('tomeRequireAllPrereqsRow');
            if (allPrereqsRow) allPrereqsRow.style.display = this.checked ? '' : 'none';
            scheduleAutoSave();
        });
        // Initial visibility
        var allPrereqsRow = document.getElementById('tomeRequireAllPrereqsRow');
        if (allPrereqsRow) allPrereqsRow.style.display = settings.spellTomeLearning.requirePrereqs ? '' : 'none';
    }
    
    // Require ALL Prerequisites toggle (child setting)
    var requireAllPrereqsToggle = document.getElementById('tomeRequireAllPrereqsToggle');
    if (requireAllPrereqsToggle) {
        requireAllPrereqsToggle.checked = settings.spellTomeLearning.requireAllPrereqs;
        requireAllPrereqsToggle.addEventListener('change', function() {
            settings.spellTomeLearning.requireAllPrereqs = this.checked;
            console.log('[SpellLearning] Tome require ALL prereqs:', this.checked);
            scheduleAutoSave();
        });
    }
    
    // Require Skill Level toggle
    var requireSkillLevelToggle = document.getElementById('tomeRequireSkillLevelToggle');
    if (requireSkillLevelToggle) {
        requireSkillLevelToggle.checked = settings.spellTomeLearning.requireSkillLevel;
        requireSkillLevelToggle.addEventListener('change', function() {
            settings.spellTomeLearning.requireSkillLevel = this.checked;
            console.log('[SpellLearning] Tome require skill level:', this.checked);
            scheduleAutoSave();
        });
    }
    
    // =========================================================================
    // NOTIFICATION SETTINGS
    // =========================================================================
    
    // Ensure notifications object exists
    if (!settings.notifications) {
        settings.notifications = {
            weakenedSpellNotifications: true,
            weakenedSpellInterval: 10
        };
    }
    
    // Weakened spell notifications toggle
    var weakenedNotificationsToggle = document.getElementById('weakenedNotificationsToggle');
    var notificationIntervalRow = document.getElementById('notificationIntervalRow');
    if (weakenedNotificationsToggle) {
        weakenedNotificationsToggle.checked = settings.notifications.weakenedSpellNotifications;
        // Show/hide interval row based on toggle state
        if (notificationIntervalRow) {
            notificationIntervalRow.style.display = weakenedNotificationsToggle.checked ? 'flex' : 'none';
        }
        
        weakenedNotificationsToggle.addEventListener('change', function() {
            settings.notifications.weakenedSpellNotifications = this.checked;
            // Show/hide interval row
            if (notificationIntervalRow) {
                notificationIntervalRow.style.display = this.checked ? 'flex' : 'none';
            }
            console.log('[SpellLearning] Weakened spell notifications:', this.checked);
            scheduleAutoSave();
        });
    }
    
    // Notification interval slider
    var notificationIntervalSlider = document.getElementById('notificationIntervalSlider');
    var notificationIntervalValue = document.getElementById('notificationIntervalValue');
    if (notificationIntervalSlider) {
        notificationIntervalSlider.value = settings.notifications.weakenedSpellInterval || 10;
        if (notificationIntervalValue) {
            notificationIntervalValue.textContent = notificationIntervalSlider.value + 's';
        }
        updateSliderFillGlobal(notificationIntervalSlider);
        
        notificationIntervalSlider.addEventListener('input', function() {
            var value = parseInt(this.value);
            settings.notifications.weakenedSpellInterval = value;
            if (notificationIntervalValue) {
                notificationIntervalValue.textContent = value + 's';
            }
            updateSliderFillGlobal(this);
            console.log('[SpellLearning] Notification interval:', value, 'seconds');
            scheduleAutoSave();
        });
    }
    
    // UI Theme selector
    initializeThemeSelector();
    
    // Learning color picker
    var learningColorPicker = document.getElementById('learningColorPicker');
    var learningColorValue = document.getElementById('learningColorValue');
    if (learningColorPicker) {
        learningColorPicker.value = settings.learningColor || '#7890A8';
        if (learningColorValue) learningColorValue.textContent = learningColorPicker.value.toUpperCase();
        applyLearningColor(settings.learningColor || '#7890A8');
        
        learningColorPicker.addEventListener('input', function() {
            settings.learningColor = this.value;
            if (learningColorValue) learningColorValue.textContent = this.value.toUpperCase();
            applyLearningColor(this.value);
            console.log('[SpellLearning] Learning color:', settings.learningColor);
            // Re-render tree with new color
            if (state.treeData) {
                WheelRenderer.render();
            }
            scheduleAutoSave();
        });
    }
    
    // Font size multiplier slider
    var fontSizeSlider = document.getElementById('fontSizeSlider');
    var fontSizeValue = document.getElementById('fontSizeValue');
    if (fontSizeSlider) {
        fontSizeSlider.value = settings.fontSizeMultiplier || 1.0;
        if (fontSizeValue) fontSizeValue.textContent = (settings.fontSizeMultiplier || 1.0).toFixed(1) + 'x';
        updateSliderFillGlobal(fontSizeSlider);
        applyFontSizeMultiplier(settings.fontSizeMultiplier || 1.0);
        
        fontSizeSlider.addEventListener('input', function() {
            var value = parseFloat(this.value);
            settings.fontSizeMultiplier = value;
            if (fontSizeValue) fontSizeValue.textContent = value.toFixed(1) + 'x';
            updateSliderFillGlobal(this);
            applyFontSizeMultiplier(value);
            console.log('[SpellLearning] Font size multiplier:', settings.fontSizeMultiplier);
            scheduleAutoSave();
        });
    }
    
    // Preserve multi-prerequisites toggle
    var preserveMultiPrereqsToggle = document.getElementById('preserveMultiPrereqsToggle');
    if (preserveMultiPrereqsToggle) {
        preserveMultiPrereqsToggle.checked = settings.preserveMultiPrereqs;
        preserveMultiPrereqsToggle.addEventListener('change', function() {
            settings.preserveMultiPrereqs = this.checked;
            console.log('[SpellLearning] Preserve multi-prerequisites:', settings.preserveMultiPrereqs);
            // Note: This affects tree parsing, so user would need to re-scan to see changes
        });
    }
    
    // Tree Generation Settings
    var aggressivePathValidationToggle = document.getElementById('aggressivePathValidationToggle');
    if (aggressivePathValidationToggle) {
        aggressivePathValidationToggle.checked = settings.aggressivePathValidation;
        aggressivePathValidationToggle.addEventListener('change', function() {
            settings.aggressivePathValidation = this.checked;
            console.log('[SpellLearning] Aggressive path validation:', settings.aggressivePathValidation);
            scheduleAutoSave();
        });
    }
    
    var allowLLMMultiplePrereqsToggle = document.getElementById('allowLLMMultiplePrereqsToggle');
    if (allowLLMMultiplePrereqsToggle) {
        allowLLMMultiplePrereqsToggle.checked = settings.allowLLMMultiplePrereqs;
        allowLLMMultiplePrereqsToggle.addEventListener('change', function() {
            settings.allowLLMMultiplePrereqs = this.checked;
            console.log('[SpellLearning] Allow LLM multiple prerequisites:', settings.allowLLMMultiplePrereqs);
            scheduleAutoSave();
        });
    }
    
    var llmSelfCorrectionToggle = document.getElementById('llmSelfCorrectionToggle');
    var llmCorrectionLoopsRow = document.getElementById('llmCorrectionLoopsRow');
    if (llmSelfCorrectionToggle) {
        llmSelfCorrectionToggle.checked = settings.llmSelfCorrection;
        // Show/hide loops slider based on toggle
        if (llmCorrectionLoopsRow) {
            llmCorrectionLoopsRow.style.display = settings.llmSelfCorrection ? '' : 'none';
        }
        llmSelfCorrectionToggle.addEventListener('change', function() {
            settings.llmSelfCorrection = this.checked;
            console.log('[SpellLearning] LLM self-correction:', settings.llmSelfCorrection);
            if (llmCorrectionLoopsRow) {
                llmCorrectionLoopsRow.style.display = this.checked ? '' : 'none';
            }
            scheduleAutoSave();
        });
    }
    
    var llmCorrectionLoopsSlider = document.getElementById('llmCorrectionLoopsSlider');
    var llmCorrectionLoopsValue = document.getElementById('llmCorrectionLoopsValue');
    if (llmCorrectionLoopsSlider) {
        llmCorrectionLoopsSlider.value = settings.llmSelfCorrectionMaxLoops;
        if (llmCorrectionLoopsValue) llmCorrectionLoopsValue.textContent = settings.llmSelfCorrectionMaxLoops;
        updateSliderFillGlobal(llmCorrectionLoopsSlider);
        llmCorrectionLoopsSlider.addEventListener('input', function() {
            settings.llmSelfCorrectionMaxLoops = parseInt(this.value);
            if (llmCorrectionLoopsValue) llmCorrectionLoopsValue.textContent = this.value;
            updateSliderFillGlobal(this);
            scheduleAutoSave();
        });
    }
    
    // Retry School UI
    var retrySchoolBtn = document.getElementById('retrySchoolBtn');
    var retrySchoolSelect = document.getElementById('retrySchoolSelect');
    if (retrySchoolBtn && retrySchoolSelect) {
        retrySchoolBtn.addEventListener('click', function() {
            var selectedSchool = retrySchoolSelect.value;
            if (selectedSchool && window.retrySpecificSchool) {
                window.retrySpecificSchool(selectedSchool);
            } else if (!selectedSchool) {
                console.warn('[SpellLearning] No school selected for retry');
            }
        });
    }
    
    // Check for schools needing attention periodically and update UI
    // Only runs when panel is visible to avoid wasting CPU
    setInterval(function() {
        if (window._panelVisible !== false) {
            updateRetrySchoolUI();
        }
    }, 2000);
    
    var proceduralPrereqInjectionToggle = document.getElementById('proceduralPrereqInjectionToggle');
    var proceduralInjectionSettings = document.getElementById('proceduralInjectionSettings');
    if (proceduralPrereqInjectionToggle) {
        proceduralPrereqInjectionToggle.checked = settings.proceduralPrereqInjection;
        // Show/hide sub-settings
        if (proceduralInjectionSettings) {
            proceduralInjectionSettings.style.display = settings.proceduralPrereqInjection ? 'block' : 'none';
        }
        proceduralPrereqInjectionToggle.addEventListener('change', function() {
            settings.proceduralPrereqInjection = this.checked;
            console.log('[SpellLearning] Procedural prereq injection:', settings.proceduralPrereqInjection);
            // Show/hide sub-settings
            if (proceduralInjectionSettings) {
                proceduralInjectionSettings.style.display = this.checked ? 'block' : 'none';
            }
            scheduleAutoSave();
            // If enabled and tree exists, inject prereqs now
            if (this.checked && state.treeData && state.treeData.nodes) {
                injectProceduralPrerequisites();
            }
        });
    }
    
    // Procedural injection sub-settings
    var injectionChanceSlider = document.getElementById('injectionChanceSlider');
    var injectionChanceValue = document.getElementById('injectionChanceValue');
    if (injectionChanceSlider) {
        injectionChanceSlider.value = settings.proceduralInjection.chance;
        if (injectionChanceValue) injectionChanceValue.textContent = settings.proceduralInjection.chance + '%';
        updateSliderFillGlobal(injectionChanceSlider);
        injectionChanceSlider.addEventListener('input', function() {
            settings.proceduralInjection.chance = parseInt(this.value);
            if (injectionChanceValue) injectionChanceValue.textContent = this.value + '%';
            updateSliderFillGlobal(this);
            scheduleAutoSave();
        });
    }
    
    var maxPrereqsSlider = document.getElementById('maxPrereqsSlider');
    var maxPrereqsValue = document.getElementById('maxPrereqsValue');
    if (maxPrereqsSlider) {
        maxPrereqsSlider.value = settings.proceduralInjection.maxPrereqs;
        if (maxPrereqsValue) maxPrereqsValue.textContent = settings.proceduralInjection.maxPrereqs;
        updateSliderFillGlobal(maxPrereqsSlider);
        maxPrereqsSlider.addEventListener('input', function() {
            settings.proceduralInjection.maxPrereqs = parseInt(this.value);
            if (maxPrereqsValue) maxPrereqsValue.textContent = this.value;
            updateSliderFillGlobal(this);
            scheduleAutoSave();
        });
    }
    
    var minTierSlider = document.getElementById('minTierSlider');
    var minTierValue = document.getElementById('minTierValue');
    if (minTierSlider) {
        minTierSlider.value = settings.proceduralInjection.minTier;
        if (minTierValue) minTierValue.textContent = settings.proceduralInjection.minTier;
        updateSliderFillGlobal(minTierSlider);
        minTierSlider.addEventListener('input', function() {
            settings.proceduralInjection.minTier = parseInt(this.value);
            if (minTierValue) minTierValue.textContent = this.value;
            updateSliderFillGlobal(this);
            scheduleAutoSave();
        });
    }
    
    var sameTierPreferenceToggle = document.getElementById('sameTierPreferenceToggle');
    if (sameTierPreferenceToggle) {
        sameTierPreferenceToggle.checked = settings.proceduralInjection.sameTierPreference;
        sameTierPreferenceToggle.addEventListener('change', function() {
            settings.proceduralInjection.sameTierPreference = this.checked;
            console.log('[SpellLearning] Same-tier preference:', settings.proceduralInjection.sameTierPreference);
            scheduleAutoSave();
        });
    }
    
    var rerollInjectionsBtn = document.getElementById('rerollInjectionsBtn');
    if (rerollInjectionsBtn) {
        rerollInjectionsBtn.addEventListener('click', function() {
            if (typeof rerollProceduralPrerequisites === 'function') {
                rerollProceduralPrerequisites();
            } else {
                console.warn('[SpellLearning] rerollProceduralPrerequisites not defined');
            }
        });
    }
    
    // Divider fade slider
    var dividerFadeSlider = document.getElementById('dividerFadeSlider');
    var dividerFadeValue = document.getElementById('dividerFadeValue');
    if (dividerFadeSlider) {
        dividerFadeSlider.value = settings.dividerFade;
        if (dividerFadeValue) dividerFadeValue.textContent = settings.dividerFade + '%';
        updateSliderFillGlobal(dividerFadeSlider);
        dividerFadeSlider.addEventListener('input', function() {
            settings.dividerFade = parseInt(this.value);
            if (dividerFadeValue) dividerFadeValue.textContent = settings.dividerFade + '%';
            updateSliderFillGlobal(this);
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Divider spacing slider
    var dividerSpacingSlider = document.getElementById('dividerSpacingSlider');
    var dividerSpacingValue = document.getElementById('dividerSpacingValue');
    if (dividerSpacingSlider) {
        dividerSpacingSlider.value = settings.dividerSpacing;
        if (dividerSpacingValue) dividerSpacingValue.textContent = settings.dividerSpacing + 'px';
        updateSliderFillGlobal(dividerSpacingSlider);
        dividerSpacingSlider.addEventListener('input', function() {
            settings.dividerSpacing = parseInt(this.value);
            if (dividerSpacingValue) dividerSpacingValue.textContent = settings.dividerSpacing + 'px';
            updateSliderFillGlobal(this);
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Divider color mode select
    var dividerColorModeSelect = document.getElementById('dividerColorModeSelect');
    if (dividerColorModeSelect) {
        dividerColorModeSelect.value = settings.dividerColorMode;
        dividerColorModeSelect.addEventListener('change', function() {
            settings.dividerColorMode = this.value;
            updateDividerColorRowVisibility();
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Divider custom color picker
    var dividerCustomColorPicker = document.getElementById('dividerCustomColorPicker');
    if (dividerCustomColorPicker) {
        dividerCustomColorPicker.value = settings.dividerCustomColor;
        dividerCustomColorPicker.addEventListener('input', function() {
            settings.dividerCustomColor = this.value;
            // Re-render tree
            if (state.treeData) {
                WheelRenderer.render();
            }
        });
    }
    
    // Initial visibility of divider settings
    updateDividerSettingsVisibility();
    updateDividerColorRowVisibility();
    
    // ISL-DESTified Integration Settings
    initializeISLSettings();
    
    // Early Spell Learning Settings
    initializeEarlyLearningSettings();
    
    // Difficulty Profile System
    initializeDifficultyProfiles();
    
    // Hotkey configuration
    var hotkeyInput = document.getElementById('hotkeyInput');
    var changeHotkeyBtn = document.getElementById('changeHotkeyBtn');
    var resetHotkeyBtn = document.getElementById('resetHotkeyBtn');
    
    if (hotkeyInput && changeHotkeyBtn) {
        hotkeyInput.value = settings.hotkey;
        
        changeHotkeyBtn.addEventListener('click', function() {
            hotkeyInput.classList.add('listening');
            hotkeyInput.value = 'Press a key...';
            
            function onKeyDown(e) {
                e.preventDefault();
                var keyName = e.key.toUpperCase();
                
                // Check if it's a valid key we support
                if (KEY_CODES[keyName] || KEY_CODES[e.key]) {
                    settings.hotkey = keyName;
                    settings.hotkeyCode = KEY_CODES[keyName] || KEY_CODES[e.key];
                    hotkeyInput.value = keyName;
                    console.log('[SpellLearning] Hotkey changed to:', keyName, '(code:', settings.hotkeyCode, ')');
                } else {
                    hotkeyInput.value = settings.hotkey;
                    console.log('[SpellLearning] Unsupported key:', e.key);
                }
                
                hotkeyInput.classList.remove('listening');
                document.removeEventListener('keydown', onKeyDown);
            }
            
            document.addEventListener('keydown', onKeyDown);
        });
        
        resetHotkeyBtn.addEventListener('click', function() {
            settings.hotkey = 'F9';
            settings.hotkeyCode = 67;
            hotkeyInput.value = 'F9';
            hotkeyInput.classList.remove('listening');
        });
    }
    
    // Pause Game on Focus toggle
    var pauseGameToggle = document.getElementById('pauseGameOnFocusToggle');
    if (pauseGameToggle) {
        // Default to true (checked) if not set
        pauseGameToggle.checked = settings.pauseGameOnFocus !== false;
        
        pauseGameToggle.addEventListener('change', function() {
            settings.pauseGameOnFocus = this.checked;
            console.log('[SpellLearning] Pause game on focus:', settings.pauseGameOnFocus);
            
            // Notify C++ immediately
            if (window.callCpp) {
                window.callCpp('SetPauseGameOnFocus', settings.pauseGameOnFocus ? 'true' : 'false');
            }
        });
    }
    
    // Heart Animation Settings Popup
    initializeHeartSettings();
    
    // Progression settings - Learning Mode
    var learningModeSelect = document.getElementById('learningModeSelect');
    if (learningModeSelect) {
        learningModeSelect.value = settings.learningMode;
        learningModeSelect.addEventListener('change', function() {
            settings.learningMode = this.value;
            console.log('[SpellLearning] Learning mode:', settings.learningMode);
            autoSaveSettings();
        });
    }
    
    // Progression settings - XP Multiplier Sliders
    function updateSliderFill(slider) {
        var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
        slider.style.setProperty('--slider-fill', percent + '%');
    }
    
    function setupSlider(sliderId, valueId, settingKey) {
        var slider = document.getElementById(sliderId);
        var valueDisplay = document.getElementById(valueId);
        
        if (slider && valueDisplay) {
            slider.value = settings[settingKey];
            valueDisplay.textContent = settings[settingKey] + '%';
            updateSliderFill(slider);
            
            slider.addEventListener('input', function() {
                settings[settingKey] = parseInt(this.value);
                valueDisplay.textContent = this.value + '%';
                updateSliderFill(this);
            });
            
            // Save on change (when user releases slider)
            slider.addEventListener('change', function() {
                console.log('[SpellLearning] ' + settingKey + ':', settings[settingKey]);
                onProgressionSettingChanged();
                autoSaveSettings();
            });
        }
    }
    
    // Global XP multiplier slider (shows "x1" format instead of "%")
    var globalMultSlider = document.getElementById('xpGlobalMultiplierSlider');
    var globalMultValue = document.getElementById('xpGlobalMultiplierValue');
    if (globalMultSlider && globalMultValue) {
        globalMultSlider.value = settings.xpGlobalMultiplier;
        globalMultValue.textContent = 'x' + settings.xpGlobalMultiplier;
        updateSliderFill(globalMultSlider);
        
        globalMultSlider.addEventListener('input', function() {
            settings.xpGlobalMultiplier = parseInt(this.value);
            globalMultValue.textContent = 'x' + this.value;
            updateSliderFill(this);
        });
        
        globalMultSlider.addEventListener('change', function() {
            console.log('[SpellLearning] Global XP multiplier:', settings.xpGlobalMultiplier);
            onProgressionSettingChanged();
            autoSaveSettings();
        });
    }
    
    setupSlider('xpDirectSlider', 'xpDirectValue', 'xpMultiplierDirect');
    setupSlider('xpSchoolSlider', 'xpSchoolValue', 'xpMultiplierSchool');
    setupSlider('xpAnySlider', 'xpAnyValue', 'xpMultiplierAny');
    
    // XP Cap sliders
    setupSlider('xpCapAnySlider', 'xpCapAnyValue', 'xpCapAny');
    setupSlider('xpCapSchoolSlider', 'xpCapSchoolValue', 'xpCapSchool');
    setupSlider('xpCapDirectSlider', 'xpCapDirectValue', 'xpCapDirect');
    
    // Tier XP requirement inputs
    function setupXPInput(inputId, settingKey) {
        var input = document.getElementById(inputId);
        
        if (input) {
            input.value = settings[settingKey];
            
            input.addEventListener('change', function() {
                var val = parseInt(this.value) || 1;
                val = Math.max(1, Math.min(99999, val));  // Clamp to valid range
                this.value = val;
                settings[settingKey] = val;
                console.log('[SpellLearning] ' + settingKey + ':', settings[settingKey]);
                onProgressionSettingChanged();
                autoSaveSettings();
            });
            
            // Also save on blur
            input.addEventListener('blur', function() {
                var val = parseInt(this.value) || 1;
                val = Math.max(1, Math.min(99999, val));
                this.value = val;
                settings[settingKey] = val;
                onProgressionSettingChanged();
            });
        }
    }
    
    setupXPInput('xpNoviceInput', 'xpNovice');
    setupXPInput('xpApprenticeInput', 'xpApprentice');
    setupXPInput('xpAdeptInput', 'xpAdept');
    setupXPInput('xpExpertInput', 'xpExpert');
    setupXPInput('xpMasterInput', 'xpMaster');
    
    // Progressive reveal threshold sliders
    setupSlider('revealNameSlider', 'revealNameValue', 'revealName');
    setupSlider('revealEffectsSlider', 'revealEffectsValue', 'revealEffects');
    setupSlider('revealDescSlider', 'revealDescValue', 'revealDescription');
    
    // Save settings button
    var saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', function() {
            saveSettings();
            console.log('[SpellLearning] Settings saved');
        });
    }
    
    // Reset settings button
    var resetSettingsBtn = document.getElementById('resetSettingsBtn');
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', function() {
            resetSettings();
        });
    }
    
    // Auto LLM Colors toggle
    var autoLLMToggle = document.getElementById('autoLLMColorsToggle');
    if (autoLLMToggle) {
        autoLLMToggle.checked = settings.autoLLMColors;
        autoLLMToggle.addEventListener('change', function() {
            settings.autoLLMColors = this.checked;
            console.log('[SpellLearning] Auto LLM Colors:', settings.autoLLMColors);
        });
    }
    
    // School color buttons
    var suggestColorsBtn = document.getElementById('suggestColorsBtn');
    if (suggestColorsBtn) {
        suggestColorsBtn.addEventListener('click', function() {
            suggestSchoolColorsWithLLM();
        });
    }
    
    var resetColorsBtn = document.getElementById('resetColorsBtn');
    if (resetColorsBtn) {
        resetColorsBtn.addEventListener('click', function() {
            // Reset to default colors
            settings.schoolColors = {
                'Destruction': '#ef4444',
                'Restoration': '#facc15',
                'Alteration': '#22c55e',
                'Conjuration': '#a855f7',
                'Illusion': '#38bdf8'
            };
            applySchoolColorsToCSS();
            updateSchoolColorPickerUI();
            autoSaveSettings();
            
            // Re-render tree if visible
            if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                WheelRenderer.render();
            }
            
            updateStatus('School colors reset to defaults');
        });
    }
    
    // Show All Schools button
    var showAllSchoolsBtn = document.getElementById('showAllSchoolsBtn');
    if (showAllSchoolsBtn) {
        showAllSchoolsBtn.addEventListener('click', function() {
            console.log('[SpellLearning] Show All Schools clicked');
            var schools = Object.keys(settings.schoolColors);
            schools.forEach(function(school) {
                settings.schoolVisibility[school] = true;
            });
            updateSchoolColorPickerUI();
            
            // Re-layout and render tree BEFORE saving
            if (typeof WheelRenderer !== 'undefined' && WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                console.log('[SpellLearning] Re-laying out tree - showing all ' + schools.length + ' schools');
                WheelRenderer.layout();
                WheelRenderer.render();
            }
            
            autoSaveSettings();
            updateStatus('All schools visible');
        });
    }
    
    // Hide All Schools button
    var hideAllSchoolsBtn = document.getElementById('hideAllSchoolsBtn');
    if (hideAllSchoolsBtn) {
        hideAllSchoolsBtn.addEventListener('click', function() {
            console.log('[SpellLearning] Hide All Schools clicked');
            var schools = Object.keys(settings.schoolColors);
            schools.forEach(function(school) {
                settings.schoolVisibility[school] = false;
            });
            updateSchoolColorPickerUI();
            
            // Re-layout and render tree BEFORE saving
            if (typeof WheelRenderer !== 'undefined' && WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                console.log('[SpellLearning] Re-laying out tree - hiding all schools');
                WheelRenderer.layout();
                WheelRenderer.render();
            }
            
            autoSaveSettings();
            updateStatus('All schools hidden');
        });
    }
    
    // Initialize school color picker UI
    updateSchoolColorPickerUI();
    
    // Apply saved school colors to CSS
    applySchoolColorsToCSS();
}

function loadSettings() {
    // Load unified config from C++ (all settings in one file)
    if (window.callCpp) {
        window.callCpp('LoadUnifiedConfig', '');
    }
}

function saveSettings() {
    // Save unified config to C++ (all settings in one file)
    saveUnifiedConfig();
}

// Auto-save settings (debounced to avoid excessive saves)
var autoSaveTimer = null;
function autoSaveSettings() {
    // Clear any pending save
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }
    // Save after a brief delay
    autoSaveTimer = setTimeout(function() {
        saveUnifiedConfig();
        console.log('[SpellLearning] Settings auto-saved');
        autoSaveTimer = null;
    }, 500);
}

function saveUnifiedConfig() {
    if (!window.callCpp) return;
    
    var unifiedConfig = {
        // Panel settings
        hotkey: settings.hotkey,
        hotkeyCode: settings.hotkeyCode,
        developerMode: settings.developerMode,
        cheatMode: settings.cheatMode,
        nodeSizeScaling: settings.nodeSizeScaling,
        showNodeNames: settings.showNodeNames,
        showSchoolDividers: settings.showSchoolDividers,
        dividerFade: settings.dividerFade,
        dividerSpacing: settings.dividerSpacing,
        dividerLength: settings.dividerLength,
        dividerColorMode: settings.dividerColorMode,
        dividerCustomColor: settings.dividerCustomColor,
        preserveMultiPrereqs: settings.preserveMultiPrereqs,
        verboseLogging: settings.verboseLogging,
        // UI Display settings
        uiTheme: settings.uiTheme,
        learningColor: settings.learningColor,
        fontSizeMultiplier: settings.fontSizeMultiplier,
        aggressivePathValidation: settings.aggressivePathValidation,
        allowLLMMultiplePrereqs: settings.allowLLMMultiplePrereqs,
        llmSelfCorrection: settings.llmSelfCorrection,
        llmSelfCorrectionMaxLoops: settings.llmSelfCorrectionMaxLoops,
        proceduralPrereqInjection: settings.proceduralPrereqInjection,
        proceduralInjection: settings.proceduralInjection,
        
        // Progression settings
        learningMode: settings.learningMode,
        xpGlobalMultiplier: settings.xpGlobalMultiplier,
        xpMultiplierDirect: settings.xpMultiplierDirect,
        xpMultiplierSchool: settings.xpMultiplierSchool,
        xpMultiplierAny: settings.xpMultiplierAny,
        // XP caps (max contribution from each source)
        xpCapAny: settings.xpCapAny,
        xpCapSchool: settings.xpCapSchool,
        xpCapDirect: settings.xpCapDirect,
        // Tier XP requirements
        xpNovice: settings.xpNovice,
        xpApprentice: settings.xpApprentice,
        xpAdept: settings.xpAdept,
        xpExpert: settings.xpExpert,
        xpMaster: settings.xpMaster,
        // Progressive reveal thresholds
        revealName: settings.revealName,
        revealEffects: settings.revealEffects,
        revealDescription: settings.revealDescription,
        
        // LLM API settings
        llm: {
            apiKey: state.llmConfig.apiKey,
            model: state.llmConfig.model,
            customModel: state.llmConfig.customModel || '',
            maxTokens: state.llmConfig.maxTokens
        },
        
        // LLM auto-config checkbox state (for Build Tree)
        llmAutoConfigEnabled: document.getElementById('visualFirstLLMCheck')?.checked || false,
        
        // Field output settings for spell scan
        fields: state.fields,
        
        // Scan mode
        scanModeTomes: document.getElementById('scanModeTomes') ? 
            document.getElementById('scanModeTomes').checked : true,
        
        // Per-node XP overrides
        xpOverrides: xpOverrides,
        
        // Window position and size
        windowX: settings.windowX,
        windowY: settings.windowY,
        windowWidth: settings.windowWidth,
        windowHeight: settings.windowHeight,
        isFullscreen: state.isFullscreen,
        
        // School colors
        schoolColors: settings.schoolColors,
        schoolVisibility: settings.schoolVisibility,
        autoLLMColors: settings.autoLLMColors,
        
        // ISL-DESTified integration
        islEnabled: settings.islEnabled,
        islXpPerHour: settings.islXpPerHour,
        islTomeBonus: settings.islTomeBonus,
        
        // Difficulty profiles
        activeProfile: settings.activeProfile,
        customProfiles: customProfiles,
        
        // Discovery mode
        discoveryMode: settings.discoveryMode,
        showRootSpellNames: settings.showRootSpellNames,
        
        // Early spell learning
        earlySpellLearning: settings.earlySpellLearning,
        
        // Spell tome learning
        spellTomeLearning: settings.spellTomeLearning,
        
        // Heart animation settings
        heartAnimationEnabled: settings.heartAnimationEnabled,
        heartPulseSpeed: settings.heartPulseSpeed,
        heartPulseDelay: settings.heartPulseDelay,
        heartBgOpacity: settings.heartBgOpacity,
        heartBgColor: settings.heartBgColor,
        heartRingColor: settings.heartRingColor,
        
        // Starfield settings
        starfieldEnabled: settings.starfieldEnabled,
        starfieldFixed: settings.starfieldFixed,
        starfieldColor: settings.starfieldColor,
        starfieldDensity: settings.starfieldDensity,
        starfieldMaxSize: settings.starfieldMaxSize,
        // Globe settings
        globeSize: settings.globeSize,
        globeDensity: settings.globeDensity,
        globeDotMin: settings.globeDotMin,
        globeDotMax: settings.globeDotMax,
        globeColor: settings.globeColor,
        magicTextColor: settings.magicTextColor,
        globeText: settings.globeText,
        globeTextSize: settings.globeTextSize,
        particleTrailEnabled: settings.particleTrailEnabled
    };
    
    console.log('[SpellLearning] Saving unified config');
    window.callCpp('SaveUnifiedConfig', JSON.stringify(unifiedConfig));
}

function resetSettings() {
    settings.hotkey = 'F9';
    settings.hotkeyCode = 67;
    settings.developerMode = false;
    settings.cheatMode = false;
    settings.nodeSizeScaling = true;
    settings.showNodeNames = true;
    settings.showSchoolDividers = true;
    settings.verboseLogging = false;
    // UI Display defaults
    settings.uiTheme = 'skyrim';
    settings.learningColor = '#7890A8';
    settings.fontSizeMultiplier = 1.0;
    settings.learningMode = 'perSchool';
    settings.xpGlobalMultiplier = 1;
    settings.xpMultiplierDirect = 100;
    settings.xpMultiplierSchool = 50;
    settings.xpMultiplierAny = 10;
    settings.xpNovice = 100;
    settings.xpApprentice = 200;
    settings.xpAdept = 400;
    settings.xpExpert = 800;
    settings.xpMaster = 1500;
    settings.revealName = 10;
    settings.revealEffects = 25;
    settings.revealDescription = 50;
    
    // Clear XP overrides
    xpOverrides = {};
    
    // Update UI
    var cheatToggle = document.getElementById('cheatModeToggle');
    var nodeSizeToggle = document.getElementById('nodeSizeScalingToggle');
    var showNamesToggle = document.getElementById('showNodeNamesToggle');
    var verboseToggle = document.getElementById('verboseLogToggle');
    var hotkeyInput = document.getElementById('hotkeyInput');
    var cheatInfo = document.getElementById('cheatModeInfo');
    
    var devModeToggle = document.getElementById('developerModeToggle');
    if (devModeToggle) devModeToggle.checked = false;
    if (cheatToggle) cheatToggle.checked = false;
    if (nodeSizeToggle) nodeSizeToggle.checked = true;
    if (showNamesToggle) showNamesToggle.checked = true;
    var showDividersToggle = document.getElementById('showSchoolDividersToggle');
    if (showDividersToggle) showDividersToggle.checked = true;
    if (verboseToggle) verboseToggle.checked = false;
    updateDeveloperModeVisibility(false);
    if (hotkeyInput) hotkeyInput.value = 'F9';
    if (cheatInfo) cheatInfo.classList.add('hidden');
    
    // Update progression settings UI
    var learningModeSelect = document.getElementById('learningModeSelect');
    var xpDirectSlider = document.getElementById('xpDirectSlider');
    var xpSchoolSlider = document.getElementById('xpSchoolSlider');
    var xpAnySlider = document.getElementById('xpAnySlider');
    var globalMultSlider = document.getElementById('xpGlobalMultiplierSlider');
    
    // Helper to update slider fill visual
    function updateSliderFillReset(slider) {
        if (!slider) return;
        var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
        slider.style.setProperty('--slider-fill', percent + '%');
    }
    
    if (learningModeSelect) learningModeSelect.value = 'perSchool';
    
    // Global multiplier
    if (globalMultSlider) {
        globalMultSlider.value = 1;
        updateSliderFillReset(globalMultSlider);
        var globalMultValue = document.getElementById('xpGlobalMultiplierValue');
        if (globalMultValue) globalMultValue.textContent = 'x1';
    }
    
    if (xpDirectSlider) {
        xpDirectSlider.value = 100;
        updateSliderFillReset(xpDirectSlider);
        var xpDirectValue = document.getElementById('xpDirectValue');
        if (xpDirectValue) xpDirectValue.textContent = '100%';
    }
    if (xpSchoolSlider) {
        xpSchoolSlider.value = 50;
        updateSliderFillReset(xpSchoolSlider);
        var xpSchoolValue = document.getElementById('xpSchoolValue');
        if (xpSchoolValue) xpSchoolValue.textContent = '50%';
    }
    if (xpAnySlider) {
        xpAnySlider.value = 10;
        updateSliderFillReset(xpAnySlider);
        var xpAnyValue = document.getElementById('xpAnyValue');
        if (xpAnyValue) xpAnyValue.textContent = '10%';
    }
    
    // Reset tier XP inputs
    var tierInputDefaults = {
        'xpNoviceInput': 100,
        'xpApprenticeInput': 200,
        'xpAdeptInput': 400,
        'xpExpertInput': 800,
        'xpMasterInput': 1500
    };
    for (var inputId in tierInputDefaults) {
        var input = document.getElementById(inputId);
        if (input) input.value = tierInputDefaults[inputId];
    }
    
    // Reset reveal sliders
    var revealSliderDefaults = [
        { id: 'revealNameSlider', valueId: 'revealNameValue', val: 10 },
        { id: 'revealEffectsSlider', valueId: 'revealEffectsValue', val: 25 },
        { id: 'revealDescSlider', valueId: 'revealDescValue', val: 50 }
    ];
    revealSliderDefaults.forEach(function(cfg) {
        var slider = document.getElementById(cfg.id);
        var valueEl = document.getElementById(cfg.valueId);
        if (slider) {
            slider.value = cfg.val;
            updateSliderFillReset(slider);
            if (valueEl) valueEl.textContent = cfg.val + '%';
        }
    });
    
    // Re-render tree
    if (state.treeData) {
        WheelRenderer.render();
    }
    
    console.log('[SpellLearning] Settings reset to defaults');
}

// C++ callback for loading unified config
window.onUnifiedConfigLoaded = function(dataStr) {
    console.log('[SpellLearning] Unified config received');
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        if (!data) return;
        
        // === Panel Settings ===
        settings.hotkey = data.hotkey || 'F9';
        settings.hotkeyCode = data.hotkeyCode || 67;
        settings.developerMode = data.developerMode || false;
        settings.cheatMode = data.cheatMode || false;
        settings.nodeSizeScaling = data.nodeSizeScaling !== false;  // default true
        settings.showNodeNames = data.showNodeNames !== false;  // default true
        settings.showSchoolDividers = data.showSchoolDividers !== false;  // default true
        settings.dividerFade = data.dividerFade !== undefined ? data.dividerFade : 50;
        settings.dividerSpacing = data.dividerSpacing !== undefined ? data.dividerSpacing : 3;
        settings.dividerLength = data.dividerLength !== undefined ? data.dividerLength : 800;
        settings.dividerColorMode = data.dividerColorMode || 'school';
        settings.dividerCustomColor = data.dividerCustomColor || '#ffffff';
        settings.preserveMultiPrereqs = data.preserveMultiPrereqs !== false;  // default true
        settings.verboseLogging = data.verboseLogging || false;
        // UI Display settings
        settings.uiTheme = data.uiTheme || 'skyrim';
        settings.learningColor = data.learningColor || '#7890A8';
        settings.fontSizeMultiplier = data.fontSizeMultiplier !== undefined ? data.fontSizeMultiplier : 1.0;
        settings.aggressivePathValidation = data.aggressivePathValidation !== false;  // default true
        settings.allowLLMMultiplePrereqs = data.allowLLMMultiplePrereqs !== false;  // default true
        settings.llmSelfCorrection = data.llmSelfCorrection !== false;  // default true
        settings.llmSelfCorrectionMaxLoops = data.llmSelfCorrectionMaxLoops !== undefined ? data.llmSelfCorrectionMaxLoops : 5;
        settings.proceduralPrereqInjection = data.proceduralPrereqInjection || false;  // default false
        // Procedural injection settings
        if (data.proceduralInjection) {
            settings.proceduralInjection.chance = data.proceduralInjection.chance !== undefined ? data.proceduralInjection.chance : 50;
            settings.proceduralInjection.maxPrereqs = data.proceduralInjection.maxPrereqs !== undefined ? data.proceduralInjection.maxPrereqs : 3;
            settings.proceduralInjection.minTier = data.proceduralInjection.minTier !== undefined ? data.proceduralInjection.minTier : 3;
            settings.proceduralInjection.sameTierPreference = data.proceduralInjection.sameTierPreference !== false;
        }
        
        // === Progression Settings ===
        settings.learningMode = data.learningMode || 'perSchool';
        settings.xpGlobalMultiplier = data.xpGlobalMultiplier !== undefined ? data.xpGlobalMultiplier : 1;
        settings.xpMultiplierDirect = data.xpMultiplierDirect !== undefined ? data.xpMultiplierDirect : 100;
        settings.xpMultiplierSchool = data.xpMultiplierSchool !== undefined ? data.xpMultiplierSchool : 50;
        settings.xpMultiplierAny = data.xpMultiplierAny !== undefined ? data.xpMultiplierAny : 10;
        // Tier XP requirements
        settings.xpNovice = data.xpNovice !== undefined ? data.xpNovice : 100;
        settings.xpApprentice = data.xpApprentice !== undefined ? data.xpApprentice : 200;
        settings.xpAdept = data.xpAdept !== undefined ? data.xpAdept : 400;
        settings.xpExpert = data.xpExpert !== undefined ? data.xpExpert : 800;
        settings.xpMaster = data.xpMaster !== undefined ? data.xpMaster : 1500;
        // Progressive reveal thresholds
        settings.revealName = data.revealName !== undefined ? data.revealName : 10;
        settings.revealEffects = data.revealEffects !== undefined ? data.revealEffects : 25;
        settings.revealDescription = data.revealDescription !== undefined ? data.revealDescription : 50;
        
        // Per-node XP overrides
        if (data.xpOverrides && typeof data.xpOverrides === 'object') {
            xpOverrides = data.xpOverrides;
            console.log('[SpellLearning] Loaded XP overrides for', Object.keys(xpOverrides).length, 'spells');
        } else {
            xpOverrides = {};
        }
        
        // Window position and size
        settings.windowX = data.windowX !== undefined ? data.windowX : null;
        settings.windowY = data.windowY !== undefined ? data.windowY : null;
        settings.windowWidth = data.windowWidth !== undefined ? data.windowWidth : null;
        settings.windowHeight = data.windowHeight !== undefined ? data.windowHeight : null;
        
        // Fullscreen state
        state.isFullscreen = data.isFullscreen || false;
        settings.isFullscreen = state.isFullscreen;
        
        // Apply window position and size if saved
        applyWindowPositionAndSize();
        
        // Apply fullscreen state
        applyFullscreenState();
        
        // School colors
        if (data.schoolColors && typeof data.schoolColors === 'object') {
            // Merge with defaults (keep any new schools that might have been added)
            for (var school in data.schoolColors) {
                settings.schoolColors[school] = data.schoolColors[school];
            }
            console.log('[SpellLearning] Loaded colors for', Object.keys(settings.schoolColors).length, 'schools');
        }
        
        // School visibility
        if (data.schoolVisibility && typeof data.schoolVisibility === 'object') {
            for (var school in data.schoolVisibility) {
                settings.schoolVisibility[school] = data.schoolVisibility[school];
            }
            console.log('[SpellLearning] Loaded visibility for', Object.keys(settings.schoolVisibility).length, 'schools');
        }
        
        // Auto LLM colors setting
        settings.autoLLMColors = data.autoLLMColors !== undefined ? data.autoLLMColors : false;
        
        // ISL-DESTified integration settings
        settings.islEnabled = data.islEnabled !== undefined ? data.islEnabled : true;
        settings.islXpPerHour = data.islXpPerHour !== undefined ? data.islXpPerHour : 50;
        settings.islTomeBonus = data.islTomeBonus !== undefined ? data.islTomeBonus : 25;
        
        // Difficulty profiles
        settings.activeProfile = data.activeProfile || 'normal';
        if (data.customProfiles && typeof data.customProfiles === 'object') {
            customProfiles = data.customProfiles;
            console.log('[SpellLearning] Loaded', Object.keys(customProfiles).length, 'custom profiles');
        } else {
            customProfiles = {};
        }
        
        // Discovery mode
        settings.discoveryMode = data.discoveryMode !== undefined ? data.discoveryMode : false;
        var discoveryModeToggle = document.getElementById('discoveryModeToggle');
        if (discoveryModeToggle) discoveryModeToggle.checked = settings.discoveryMode;
        
        // Show root spell names in discovery mode
        settings.showRootSpellNames = data.showRootSpellNames !== undefined ? data.showRootSpellNames : true;
        var showRootNamesToggle = document.getElementById('showRootSpellNamesToggle');
        if (showRootNamesToggle) showRootNamesToggle.checked = settings.showRootSpellNames;
        
        // Preserve multi-prerequisites
        var preserveMultiPrereqsToggle = document.getElementById('preserveMultiPrereqsToggle');
        if (preserveMultiPrereqsToggle) preserveMultiPrereqsToggle.checked = settings.preserveMultiPrereqs;
        
        // Tree generation settings
        var aggressivePathValidationToggle = document.getElementById('aggressivePathValidationToggle');
        if (aggressivePathValidationToggle) aggressivePathValidationToggle.checked = settings.aggressivePathValidation;
        
        var allowLLMMultiplePrereqsToggle = document.getElementById('allowLLMMultiplePrereqsToggle');
        if (allowLLMMultiplePrereqsToggle) allowLLMMultiplePrereqsToggle.checked = settings.allowLLMMultiplePrereqs;
        
        var llmSelfCorrectionToggle = document.getElementById('llmSelfCorrectionToggle');
        if (llmSelfCorrectionToggle) llmSelfCorrectionToggle.checked = settings.llmSelfCorrection;
        
        var llmCorrectionLoopsRow = document.getElementById('llmCorrectionLoopsRow');
        if (llmCorrectionLoopsRow) {
            llmCorrectionLoopsRow.style.display = settings.llmSelfCorrection ? '' : 'none';
        }
        
        var llmCorrectionLoopsSlider = document.getElementById('llmCorrectionLoopsSlider');
        var llmCorrectionLoopsValue = document.getElementById('llmCorrectionLoopsValue');
        if (llmCorrectionLoopsSlider) {
            llmCorrectionLoopsSlider.value = settings.llmSelfCorrectionMaxLoops;
            if (llmCorrectionLoopsValue) llmCorrectionLoopsValue.textContent = settings.llmSelfCorrectionMaxLoops;
            updateSliderFillGlobal(llmCorrectionLoopsSlider);
        }
        
        var proceduralPrereqInjectionToggle = document.getElementById('proceduralPrereqInjectionToggle');
        if (proceduralPrereqInjectionToggle) proceduralPrereqInjectionToggle.checked = settings.proceduralPrereqInjection;
        
        // Procedural injection sub-settings
        var proceduralInjectionSettings = document.getElementById('proceduralInjectionSettings');
        if (proceduralInjectionSettings) {
            proceduralInjectionSettings.style.display = settings.proceduralPrereqInjection ? 'block' : 'none';
        }
        
        var injectionChanceSlider = document.getElementById('injectionChanceSlider');
        var injectionChanceValue = document.getElementById('injectionChanceValue');
        if (injectionChanceSlider) {
            injectionChanceSlider.value = settings.proceduralInjection.chance;
            if (injectionChanceValue) injectionChanceValue.textContent = settings.proceduralInjection.chance + '%';
            updateSliderFillGlobal(injectionChanceSlider);
        }
        
        var maxPrereqsSlider = document.getElementById('maxPrereqsSlider');
        var maxPrereqsValue = document.getElementById('maxPrereqsValue');
        if (maxPrereqsSlider) {
            maxPrereqsSlider.value = settings.proceduralInjection.maxPrereqs;
            if (maxPrereqsValue) maxPrereqsValue.textContent = settings.proceduralInjection.maxPrereqs;
            updateSliderFillGlobal(maxPrereqsSlider);
        }
        
        var minTierSlider = document.getElementById('minTierSlider');
        var minTierValue = document.getElementById('minTierValue');
        if (minTierSlider) {
            minTierSlider.value = settings.proceduralInjection.minTier;
            if (minTierValue) minTierValue.textContent = settings.proceduralInjection.minTier;
            updateSliderFillGlobal(minTierSlider);
        }
        
        var sameTierPreferenceToggle = document.getElementById('sameTierPreferenceToggle');
        if (sameTierPreferenceToggle) sameTierPreferenceToggle.checked = settings.proceduralInjection.sameTierPreference;
        
        // Apply school colors to CSS
        applySchoolColorsToCSS();
        updateSchoolColorPickerUI();
        
        // Update Auto LLM toggle
        var autoLLMToggle = document.getElementById('autoLLMColorsToggle');
        if (autoLLMToggle) autoLLMToggle.checked = settings.autoLLMColors;
        
        // Update UI toggles
        var cheatToggle = document.getElementById('cheatModeToggle');
        var nodeSizeToggle = document.getElementById('nodeSizeScalingToggle');
        var showNamesToggle = document.getElementById('showNodeNamesToggle');
        var verboseToggle = document.getElementById('verboseLogToggle');
        var hotkeyInput = document.getElementById('hotkeyInput');
        var cheatInfo = document.getElementById('cheatModeInfo');
        
        var devModeToggle = document.getElementById('developerModeToggle');
        if (devModeToggle) devModeToggle.checked = settings.developerMode;
        updateDeveloperModeVisibility(settings.developerMode);
        
        if (cheatToggle) cheatToggle.checked = settings.cheatMode;
        if (nodeSizeToggle) nodeSizeToggle.checked = settings.nodeSizeScaling;
        if (showNamesToggle) showNamesToggle.checked = settings.showNodeNames;
        var showDividersToggle = document.getElementById('showSchoolDividersToggle');
        if (showDividersToggle) showDividersToggle.checked = settings.showSchoolDividers;
        
        // Update divider settings
        var dividerFadeSlider = document.getElementById('dividerFadeSlider');
        var dividerFadeValue = document.getElementById('dividerFadeValue');
        if (dividerFadeSlider) {
            dividerFadeSlider.value = settings.dividerFade;
            if (dividerFadeValue) dividerFadeValue.textContent = settings.dividerFade + '%';
            updateSliderFillGlobal(dividerFadeSlider);
        }
        var dividerSpacingSlider = document.getElementById('dividerSpacingSlider');
        var dividerSpacingValue = document.getElementById('dividerSpacingValue');
        if (dividerSpacingSlider) {
            dividerSpacingSlider.value = settings.dividerSpacing;
            if (dividerSpacingValue) dividerSpacingValue.textContent = settings.dividerSpacing + 'px';
            updateSliderFillGlobal(dividerSpacingSlider);
        }
        
        // Update divider color settings
        var dividerColorModeSelect = document.getElementById('dividerColorModeSelect');
        if (dividerColorModeSelect) {
            dividerColorModeSelect.value = settings.dividerColorMode;
        }
        var dividerCustomColorPicker = document.getElementById('dividerCustomColorPicker');
        if (dividerCustomColorPicker) {
            dividerCustomColorPicker.value = settings.dividerCustomColor;
        }
        
        updateDividerSettingsVisibility();
        
        // Update popup divider settings (gear icon popup)
        var popupShowDividers = document.getElementById('popup-show-dividers');
        if (popupShowDividers) popupShowDividers.checked = settings.showSchoolDividers;
        
        var popupDividerLength = document.getElementById('popup-divider-length');
        var popupDividerLengthVal = document.getElementById('popup-divider-length-val');
        if (popupDividerLength) {
            popupDividerLength.value = settings.dividerLength || 800;
            if (popupDividerLengthVal) popupDividerLengthVal.textContent = settings.dividerLength || 800;
        }
        
        var popupDividerWidth = document.getElementById('popup-divider-width');
        var popupDividerWidthVal = document.getElementById('popup-divider-width-val');
        if (popupDividerWidth) {
            popupDividerWidth.value = settings.dividerSpacing || 3;
            if (popupDividerWidthVal) popupDividerWidthVal.textContent = (settings.dividerSpacing || 3) + 'px';
        }
        
        var popupDividerFade = document.getElementById('popup-divider-fade');
        var popupDividerFadeVal = document.getElementById('popup-divider-fade-val');
        if (popupDividerFade) {
            popupDividerFade.value = settings.dividerFade !== undefined ? settings.dividerFade : 50;
            if (popupDividerFadeVal) popupDividerFadeVal.textContent = (settings.dividerFade !== undefined ? settings.dividerFade : 50) + '%';
        }
        
        var popupDividerColorMode = document.getElementById('popup-divider-color-mode');
        var popupDividerCustomRow = document.getElementById('popup-divider-custom-row');
        if (popupDividerColorMode) {
            popupDividerColorMode.value = settings.dividerColorMode || 'school';
            if (popupDividerCustomRow) {
                popupDividerCustomRow.style.display = (settings.dividerColorMode === 'custom') ? '' : 'none';
            }
        }
        
        var dividerCustomSwatch = document.getElementById('divider-custom-color-swatch');
        var popupDividerCustomColor = document.getElementById('popup-divider-custom-color');
        if (dividerCustomSwatch && popupDividerCustomColor) {
            var customColor = settings.dividerCustomColor || '#ffffff';
            dividerCustomSwatch.style.background = customColor;
            popupDividerCustomColor.value = customColor;
        }
        
        // Update theme UI
        var themeSelect = document.getElementById('uiThemeSelect');
        var themeDesc = document.getElementById('themeDescription');
        if (themeSelect && settings.uiTheme) {
            themeSelect.value = settings.uiTheme;
            if (themeDesc && UI_THEMES[settings.uiTheme]) {
                themeDesc.textContent = UI_THEMES[settings.uiTheme].description;
            }
            // Apply saved theme if different from current
            var currentStylesheet = document.querySelector('link[rel="stylesheet"][href*="styles"]');
            if (currentStylesheet && UI_THEMES[settings.uiTheme]) {
                var currentFile = currentStylesheet.getAttribute('href');
                if (currentFile !== UI_THEMES[settings.uiTheme].file) {
                    applyTheme(settings.uiTheme);
                }
            }
        }
        
        // Update learning color UI
        var learningColorPicker = document.getElementById('learningColorPicker');
        var learningColorValue = document.getElementById('learningColorValue');
        if (learningColorPicker) {
            learningColorPicker.value = settings.learningColor;
            if (learningColorValue) learningColorValue.textContent = settings.learningColor.toUpperCase();
            applyLearningColor(settings.learningColor);
        }
        
        // Update font size UI
        var fontSizeSlider = document.getElementById('fontSizeSlider');
        var fontSizeValue = document.getElementById('fontSizeValue');
        if (fontSizeSlider) {
            fontSizeSlider.value = settings.fontSizeMultiplier;
            if (fontSizeValue) fontSizeValue.textContent = settings.fontSizeMultiplier.toFixed(1) + 'x';
            updateSliderFillGlobal(fontSizeSlider);
            applyFontSizeMultiplier(settings.fontSizeMultiplier);
        }
        
        // Update ISL settings UI
        var islEnabledToggle = document.getElementById('islEnabledToggle');
        var islXpPerHourInput = document.getElementById('islXpPerHourInput');
        var islTomeBonusSlider = document.getElementById('islTomeBonusSlider');
        var islTomeBonusValue = document.getElementById('islTomeBonusValue');
        
        if (islEnabledToggle) islEnabledToggle.checked = settings.islEnabled;
        if (islXpPerHourInput) islXpPerHourInput.value = settings.islXpPerHour;
        if (islTomeBonusSlider) {
            islTomeBonusSlider.value = settings.islTomeBonus;
            if (islTomeBonusValue) islTomeBonusValue.textContent = settings.islTomeBonus + '%';
            // Update slider fill AFTER setting value
            updateSliderFillGlobal(islTomeBonusSlider);
        }
        
        // Early spell learning settings
        if (data.earlySpellLearning && typeof data.earlySpellLearning === 'object') {
            var el = data.earlySpellLearning;
            settings.earlySpellLearning.enabled = el.enabled !== undefined ? el.enabled : true;
            settings.earlySpellLearning.unlockThreshold = el.unlockThreshold !== undefined ? el.unlockThreshold : 25;
            settings.earlySpellLearning.selfCastRequiredAt = el.selfCastRequiredAt !== undefined ? el.selfCastRequiredAt : 75;
            settings.earlySpellLearning.selfCastXPMultiplier = el.selfCastXPMultiplier !== undefined ? el.selfCastXPMultiplier : 150;
            settings.earlySpellLearning.binaryEffectThreshold = el.binaryEffectThreshold !== undefined ? el.binaryEffectThreshold : 80;
            settings.earlySpellLearning.modifyGameDisplay = el.modifyGameDisplay !== undefined ? el.modifyGameDisplay : true;
            // Load power steps if present
            if (el.powerSteps && Array.isArray(el.powerSteps)) {
                settings.earlySpellLearning.powerSteps = el.powerSteps;
            }
        }
        updateEarlyLearningUI();
        // Update power steps UI if function exists
        if (typeof renderPowerSteps === 'function') renderPowerSteps();
        
        // Spell tome learning settings
        if (data.spellTomeLearning && typeof data.spellTomeLearning === 'object') {
            var stl = data.spellTomeLearning;
            settings.spellTomeLearning.enabled = stl.enabled !== undefined ? stl.enabled : true;
            settings.spellTomeLearning.useProgressionSystem = stl.useProgressionSystem !== undefined ? stl.useProgressionSystem : true;
            settings.spellTomeLearning.grantXPOnRead = stl.grantXPOnRead !== undefined ? stl.grantXPOnRead : true;
            settings.spellTomeLearning.autoSetLearningTarget = stl.autoSetLearningTarget !== undefined ? stl.autoSetLearningTarget : true;
            settings.spellTomeLearning.showNotifications = stl.showNotifications !== undefined ? stl.showNotifications : true;
            settings.spellTomeLearning.xpPercentToGrant = stl.xpPercentToGrant !== undefined ? stl.xpPercentToGrant : 25;
            settings.spellTomeLearning.tomeInventoryBoost = stl.tomeInventoryBoost !== undefined ? stl.tomeInventoryBoost : true;
            settings.spellTomeLearning.tomeInventoryBoostPercent = stl.tomeInventoryBoostPercent !== undefined ? stl.tomeInventoryBoostPercent : 25;
            // Learning requirements
            settings.spellTomeLearning.requirePrereqs = stl.requirePrereqs !== undefined ? stl.requirePrereqs : true;
            settings.spellTomeLearning.requireAllPrereqs = stl.requireAllPrereqs !== undefined ? stl.requireAllPrereqs : true;
            settings.spellTomeLearning.requireSkillLevel = stl.requireSkillLevel !== undefined ? stl.requireSkillLevel : false;
        }
        updateSpellTomeLearningUI();
        
        // Load notification settings
        if (data.notifications) {
            var notif = data.notifications;
            if (!settings.notifications) {
                settings.notifications = { weakenedSpellNotifications: true, weakenedSpellInterval: 10 };
            }
            settings.notifications.weakenedSpellNotifications = notif.weakenedSpellNotifications !== undefined ? notif.weakenedSpellNotifications : true;
            settings.notifications.weakenedSpellInterval = notif.weakenedSpellInterval !== undefined ? notif.weakenedSpellInterval : 10;
        }
        updateNotificationsUI();
        
        // Update difficulty profile UI
        var profileSelect = document.getElementById('difficultyProfileSelect');
        if (profileSelect) {
            updateProfileDropdown();
            profileSelect.value = settings.activeProfile;
        }
        updateProfileDescription();
        updateProfileModifiedBadge();
        updateCustomProfilesUI();
        
        if (verboseToggle) verboseToggle.checked = settings.verboseLogging;
        if (hotkeyInput) hotkeyInput.value = settings.hotkey;
        if (cheatInfo) cheatInfo.classList.toggle('hidden', !settings.cheatMode);
        
        // Update progression settings UI
        var learningModeSelect = document.getElementById('learningModeSelect');
        var xpDirectSlider = document.getElementById('xpDirectSlider');
        var xpSchoolSlider = document.getElementById('xpSchoolSlider');
        var xpAnySlider = document.getElementById('xpAnySlider');
        
        // Helper to update slider fill visual
        function updateSliderFillVisual(slider) {
            if (!slider) return;
            var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
            slider.style.setProperty('--slider-fill', percent + '%');
        }
        
        if (learningModeSelect) learningModeSelect.value = settings.learningMode;
        
        // Global multiplier slider
        var globalMultSlider = document.getElementById('xpGlobalMultiplierSlider');
        var globalMultValue = document.getElementById('xpGlobalMultiplierValue');
        if (globalMultSlider) {
            globalMultSlider.value = settings.xpGlobalMultiplier;
            updateSliderFillVisual(globalMultSlider);
            if (globalMultValue) globalMultValue.textContent = 'x' + settings.xpGlobalMultiplier;
        }
        
        if (xpDirectSlider) {
            xpDirectSlider.value = settings.xpMultiplierDirect;
            updateSliderFillVisual(xpDirectSlider);
            var xpDirectValue = document.getElementById('xpDirectValue');
            if (xpDirectValue) xpDirectValue.textContent = settings.xpMultiplierDirect + '%';
        }
        if (xpSchoolSlider) {
            xpSchoolSlider.value = settings.xpMultiplierSchool;
            updateSliderFillVisual(xpSchoolSlider);
            var xpSchoolValue = document.getElementById('xpSchoolValue');
            if (xpSchoolValue) xpSchoolValue.textContent = settings.xpMultiplierSchool + '%';
        }
        if (xpAnySlider) {
            xpAnySlider.value = settings.xpMultiplierAny;
            updateSliderFillVisual(xpAnySlider);
            var xpAnyValue = document.getElementById('xpAnyValue');
            if (xpAnyValue) xpAnyValue.textContent = settings.xpMultiplierAny + '%';
        }
        
        // XP Cap sliders
        var xpCapAnySlider = document.getElementById('xpCapAnySlider');
        var xpCapSchoolSlider = document.getElementById('xpCapSchoolSlider');
        var xpCapDirectSlider = document.getElementById('xpCapDirectSlider');
        
        if (xpCapAnySlider) {
            xpCapAnySlider.value = settings.xpCapAny;
            updateSliderFillVisual(xpCapAnySlider);
            var xpCapAnyValue = document.getElementById('xpCapAnyValue');
            if (xpCapAnyValue) xpCapAnyValue.textContent = settings.xpCapAny + '%';
        }
        if (xpCapSchoolSlider) {
            xpCapSchoolSlider.value = settings.xpCapSchool;
            updateSliderFillVisual(xpCapSchoolSlider);
            var xpCapSchoolValue = document.getElementById('xpCapSchoolValue');
            if (xpCapSchoolValue) xpCapSchoolValue.textContent = settings.xpCapSchool + '%';
        }
        if (xpCapDirectSlider) {
            xpCapDirectSlider.value = settings.xpCapDirect;
            updateSliderFillVisual(xpCapDirectSlider);
            var xpCapDirectValue = document.getElementById('xpCapDirectValue');
            if (xpCapDirectValue) xpCapDirectValue.textContent = settings.xpCapDirect + '%';
        }
        
        // Update tier XP inputs
        var tierInputs = [
            { id: 'xpNoviceInput', key: 'xpNovice' },
            { id: 'xpApprenticeInput', key: 'xpApprentice' },
            { id: 'xpAdeptInput', key: 'xpAdept' },
            { id: 'xpExpertInput', key: 'xpExpert' },
            { id: 'xpMasterInput', key: 'xpMaster' }
        ];
        
        tierInputs.forEach(function(cfg) {
            var input = document.getElementById(cfg.id);
            if (input) {
                input.value = settings[cfg.key];
            }
        });
        
        // Update reveal threshold sliders
        var revealSliders = [
            { id: 'revealNameSlider', valueId: 'revealNameValue', key: 'revealName', suffix: '%' },
            { id: 'revealEffectsSlider', valueId: 'revealEffectsValue', key: 'revealEffects', suffix: '%' },
            { id: 'revealDescSlider', valueId: 'revealDescValue', key: 'revealDescription', suffix: '%' }
        ];
        
        revealSliders.forEach(function(cfg) {
            var slider = document.getElementById(cfg.id);
            var valueEl = document.getElementById(cfg.valueId);
            if (slider) {
                slider.value = settings[cfg.key];
                updateSliderFillVisual(slider);
                if (valueEl) valueEl.textContent = settings[cfg.key] + cfg.suffix;
            }
        });
        
        // === LLM Settings ===
        if (data.llm) {
            state.llmConfig.apiKey = data.llm.apiKey || '';
            state.llmConfig.model = data.llm.model || 'anthropic/claude-sonnet-4';
            state.llmConfig.customModel = data.llm.customModel || '';
            state.llmConfig.maxTokens = data.llm.maxTokens || 4096;
            
            // Update LLM UI
            var apiKeyInput = document.getElementById('apiKeyInput');
            var modelSelect = document.getElementById('modelSelect');
            var customModelInput = document.getElementById('customModelInput');
            
            if (apiKeyInput && state.llmConfig.apiKey) {
                // Mask the key for display
                var key = state.llmConfig.apiKey;
                apiKeyInput.value = key.length > 10 ? 
                    key.substring(0, 6) + '...' + key.substring(key.length - 4) : 
                    key;
            }
            
            // Set model dropdown - try to match, but if custom model is set, it takes priority
            if (modelSelect) {
                // If custom model looks like a known dropdown value, select it
                var knownModels = ['anthropic/claude-sonnet-4', 'anthropic/claude-opus-4', 
                    'anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'openai/gpt-4o-mini', 
                    'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'];
                if (knownModels.indexOf(state.llmConfig.model) !== -1) {
                    modelSelect.value = state.llmConfig.model;
                }
            }
            
            // Set custom model input
            if (customModelInput) {
                customModelInput.value = state.llmConfig.customModel || '';
                updateModelDisplayState();
            }
            
            // Set max tokens input
            var maxTokensInput = document.getElementById('maxTokensInput');
            if (maxTokensInput) {
                maxTokensInput.value = state.llmConfig.maxTokens || 4096;
            }
            
            // Update API status
            var apiStatus = document.getElementById('apiStatus');
            if (apiStatus && state.llmConfig.apiKey) {
                apiStatus.textContent = 'API key loaded (' + state.llmConfig.apiKey.length + ' chars)';
                apiStatus.style.color = '#4ade80';
            }
        }
        
        // === LLM Auto-Config Checkbox (Build Tree) ===
        if (data.llmAutoConfigEnabled !== undefined) {
            var llmAutoConfigCheckbox = document.getElementById('visualFirstLLMCheck');
            if (llmAutoConfigCheckbox) {
                llmAutoConfigCheckbox.checked = data.llmAutoConfigEnabled;
                console.log('[SpellLearning] LLM auto-config checkbox loaded:', data.llmAutoConfigEnabled);
            }
        }
        
        // === Field Settings ===
        if (data.fields) {
            state.fields = data.fields;
            
            // Update field checkboxes
            for (var fieldName in data.fields) {
                var checkbox = document.getElementById('field_' + fieldName);
                if (checkbox) {
                    checkbox.checked = data.fields[fieldName];
                }
            }
        }
        
        // === Scan Mode ===
        if (data.scanModeTomes !== undefined) {
            var scanModeCheckbox = document.getElementById('scanModeTomes');
            if (scanModeCheckbox) {
                scanModeCheckbox.checked = data.scanModeTomes;
            }
        }
        
        // === Heart Animation Settings ===
        settings.heartAnimationEnabled = data.heartAnimationEnabled !== false;
        settings.heartPulseSpeed = data.heartPulseSpeed !== undefined ? data.heartPulseSpeed : 0.2;
        settings.heartPulseDelay = data.heartPulseDelay !== undefined ? data.heartPulseDelay : 5.0;
        settings.heartBgOpacity = data.heartBgOpacity !== undefined ? data.heartBgOpacity : 1.0;
        settings.heartBgColor = data.heartBgColor || '#0a0a14';
        settings.heartRingColor = data.heartRingColor || '#b8a878';
        
        // === Starfield Settings ===
        settings.starfieldEnabled = data.starfieldEnabled !== false;
        settings.starfieldFixed = data.starfieldFixed !== false;
        settings.starfieldColor = data.starfieldColor || '#ffffff';
        settings.starfieldDensity = data.starfieldDensity !== undefined ? data.starfieldDensity : 100;
        settings.starfieldMaxSize = data.starfieldMaxSize !== undefined ? data.starfieldMaxSize : 2;
        
        // === Globe Settings ===
        settings.globeSize = data.globeSize !== undefined ? data.globeSize : 30;
        settings.globeDensity = data.globeDensity !== undefined ? data.globeDensity : 200;
        settings.globeDotMin = data.globeDotMin !== undefined ? data.globeDotMin : 1;
        settings.globeDotMax = data.globeDotMax !== undefined ? data.globeDotMax : 3;
        settings.globeColor = data.globeColor || '#b8a878';
        settings.magicTextColor = data.magicTextColor || '#b8a878';
        settings.globeText = data.globeText || 'HoM';
        settings.globeTextSize = data.globeTextSize !== undefined ? data.globeTextSize : 16;
        settings.particleTrailEnabled = data.particleTrailEnabled !== false;
        
        // Apply heart settings to renderer
        applyHeartSettingsToRenderer();
        applyGlobeSettings();
        
        console.log('[SpellLearning] Unified config loaded:', {
            settings: settings,
            llmModel: state.llmConfig.model,
            hasApiKey: !!state.llmConfig.apiKey,
            fields: state.fields
        });
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse unified config:', e);
    }
};

// Legacy callback for backwards compatibility
window.onSettingsLoaded = window.onUnifiedConfigLoaded;

// Export updateDeveloperModeVisibility for use by other modules (e.g., when school controls are created)
window.updateDeveloperModeVisibility = updateDeveloperModeVisibility;
window.onLLMConfigLoaded = function(dataStr) {
    // This is now handled by onUnifiedConfigLoaded
    // But keep for backwards compatibility with any existing code
    try {
        var data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
        if (data && data.apiKey) {
            state.llmConfig.apiKey = data.apiKey;
            state.llmConfig.model = data.model || state.llmConfig.model;
            state.llmConfig.maxTokens = data.maxTokens || state.llmConfig.maxTokens;
        }
    } catch (e) { }
};

// =============================================================================
// UI THEME SYSTEM - Auto-discovery from themes/ folder
// =============================================================================

/**
 * Load all available themes from the themes/ folder
 * Reads manifest.json to get theme list, then loads each theme definition
 */
function loadThemesFromFolder() {
    return new Promise(function(resolve, reject) {
        console.log('[SpellLearning] Loading themes from themes/ folder...');
        
        // Fetch the manifest
        fetch('themes/manifest.json')
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to load themes manifest: ' + response.status);
                }
                return response.json();
            })
            .then(function(manifest) {
                if (!manifest.themes || !Array.isArray(manifest.themes)) {
                    throw new Error('Invalid manifest: missing themes array');
                }
                
                console.log('[SpellLearning] Found', manifest.themes.length, 'themes in manifest');
                
                // Load each theme definition
                var themePromises = manifest.themes.map(function(themeId) {
                    return fetch('themes/' + themeId + '.json')
                        .then(function(response) {
                            if (!response.ok) {
                                console.warn('[SpellLearning] Failed to load theme:', themeId);
                                return null;
                            }
                            return response.json();
                        })
                        .then(function(themeData) {
                            if (themeData && themeData.id) {
                                return themeData;
                            }
                            return null;
                        })
                        .catch(function(err) {
                            console.warn('[SpellLearning] Error loading theme', themeId + ':', err);
                            return null;
                        });
                });
                
                return Promise.all(themePromises);
            })
            .then(function(themes) {
                // Filter out failed loads and populate UI_THEMES
                UI_THEMES = {};
                themes.forEach(function(theme) {
                    if (theme && theme.id) {
                        UI_THEMES[theme.id] = {
                            name: theme.name || theme.id,
                            file: theme.cssFile || ('themes/' + theme.id + '.css'),
                            description: theme.description || '',
                            author: theme.author || '',
                            version: theme.version || '1.0'
                        };
                    }
                });
                
                themesLoaded = true;
                console.log('[SpellLearning] Loaded', Object.keys(UI_THEMES).length, 'themes:', Object.keys(UI_THEMES).join(', '));
                resolve(UI_THEMES);
            })
            .catch(function(err) {
                console.error('[SpellLearning] Failed to load themes:', err);
                // Fall back to built-in themes
                UI_THEMES = {
                    'default': {
                        name: 'Default (Modern Dark)',
                        file: 'styles.css',
                        description: 'Modern dark UI with gradients and glow effects'
                    },
                    'skyrim': {
                        name: 'Skyrim Edge',
                        file: 'styles-skyrim.css',
                        description: 'Native Skyrim-style flat UI with muted tones'
                    }
                };
                themesLoaded = true;
                console.log('[SpellLearning] Using fallback themes');
                resolve(UI_THEMES);
            });
    });
}

/**
 * Initialize the theme selector dropdown
 * Call after loadThemesFromFolder() completes
 */
function initializeThemeSelector() {
    var themeSelect = document.getElementById('uiThemeSelect');
    var themeDesc = document.getElementById('themeDescription');
    
    if (!themeSelect) {
        console.warn('[SpellLearning] Theme selector not found');
        return;
    }
    
    // If themes not loaded yet, load them first
    if (!themesLoaded || Object.keys(UI_THEMES).length === 0) {
        loadThemesFromFolder().then(function() {
            populateThemeSelector(themeSelect, themeDesc);
        });
    } else {
        populateThemeSelector(themeSelect, themeDesc);
    }
}

/**
 * Populate the theme selector dropdown with loaded themes
 */
function populateThemeSelector(themeSelect, themeDesc) {
    // Populate dropdown from UI_THEMES
    themeSelect.innerHTML = '';
    
    var themeKeys = Object.keys(UI_THEMES);
    if (themeKeys.length === 0) {
        var option = document.createElement('option');
        option.value = '';
        option.textContent = 'No themes found';
        option.disabled = true;
        themeSelect.appendChild(option);
        return;
    }
    
    themeKeys.forEach(function(themeKey) {
        var theme = UI_THEMES[themeKey];
        var option = document.createElement('option');
        option.value = themeKey;
        option.textContent = theme.name + (theme.author ? ' by ' + theme.author : '');
        themeSelect.appendChild(option);
    });
    
    // Set current value
    var currentTheme = settings.uiTheme || 'skyrim';
    if (!UI_THEMES[currentTheme]) {
        currentTheme = themeKeys[0];
        settings.uiTheme = currentTheme;
    }
    themeSelect.value = currentTheme;
    
    // Update description
    if (themeDesc && UI_THEMES[currentTheme]) {
        themeDesc.textContent = UI_THEMES[currentTheme].description;
    }
    
    // Handle theme change
    themeSelect.addEventListener('change', function() {
        var newTheme = this.value;
        if (!UI_THEMES[newTheme]) {
            console.error('[SpellLearning] Unknown theme:', newTheme);
            return;
        }
        
        settings.uiTheme = newTheme;
        
        // Update description
        if (themeDesc) {
            themeDesc.textContent = UI_THEMES[newTheme].description;
        }
        
        // Hot-swap the stylesheet
        applyTheme(newTheme);
        
        console.log('[SpellLearning] Theme changed to:', newTheme);
        scheduleAutoSave();
    });
    
    console.log('[SpellLearning] Theme selector initialized with', themeKeys.length, 'themes');
    
    // Setup refresh button
    var refreshBtn = document.getElementById('refreshThemesBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            refreshBtn.disabled = true;
            refreshBtn.textContent = '⏳';
            
            refreshThemes().then(function() {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '[R]';
                console.log('[SpellLearning] Themes refreshed');
            }).catch(function() {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '[R]';
            });
        });
    }
}

/**
 * Refresh the theme list by re-scanning the themes folder
 */
function refreshThemes() {
    themesLoaded = false;
    return loadThemesFromFolder().then(function() {
        var themeSelect = document.getElementById('uiThemeSelect');
        var themeDesc = document.getElementById('themeDescription');
        if (themeSelect) {
            populateThemeSelector(themeSelect, themeDesc);
        }
        return UI_THEMES;
    });
}

/**
 * Apply a UI theme by swapping the stylesheet
 * @param {string} themeKey - Key from UI_THEMES
 */
function applyTheme(themeKey) {
    var theme = UI_THEMES[themeKey];
    if (!theme) {
        console.error('[SpellLearning] Unknown theme:', themeKey);
        return;
    }
    
    // Find the current stylesheet link
    var styleLink = document.querySelector('link[rel="stylesheet"][href*="styles"]');
    if (!styleLink) {
        console.error('[SpellLearning] Could not find stylesheet link');
        return;
    }
    
    // Get current href to check if already applied
    var currentHref = styleLink.getAttribute('href');
    var newHref = theme.file;
    
    // Normalize paths for comparison
    if (currentHref === newHref || currentHref.endsWith(newHref.replace('../', ''))) {
        console.log('[SpellLearning] Theme already applied:', themeKey);
        return;
    }
    
    console.log('[SpellLearning] Switching theme from', currentHref, 'to', newHref);
    
    // Create a new link element for the new stylesheet
    var newLink = document.createElement('link');
    newLink.rel = 'stylesheet';
    newLink.href = newHref;
    
    // When the new stylesheet loads, remove the old one
    newLink.onload = function() {
        styleLink.remove();
        console.log('[SpellLearning] Theme applied:', themeKey);
        
        // Re-apply dynamic styles that might be overwritten
        if (settings.learningColor) {
            applyLearningColor(settings.learningColor);
        }
        if (settings.fontSizeMultiplier) {
            applyFontSizeMultiplier(settings.fontSizeMultiplier);
        }
    };
    
    newLink.onerror = function() {
        console.error('[SpellLearning] Failed to load theme stylesheet:', newHref);
    };
    
    // Insert the new link after the old one
    styleLink.parentNode.insertBefore(newLink, styleLink.nextSibling);
}

/**
 * Get the current theme key
 */
function getCurrentTheme() {
    return settings.uiTheme || 'skyrim';
}

// =============================================================================
// UI DISPLAY HELPERS
// =============================================================================

/**
 * Apply learning color to CSS variables
 * @param {string} color - Hex color value
 */
function applyLearningColor(color) {
    if (!color) return;
    
    var root = document.documentElement;
    root.style.setProperty('--learning-color', color);
    root.style.setProperty('--node-learning-border', color);
    
    // Parse hex to RGB for transparent versions
    var r = parseInt(color.slice(1, 3), 16);
    var g = parseInt(color.slice(3, 5), 16);
    var b = parseInt(color.slice(5, 7), 16);
    
    root.style.setProperty('--node-learning-bg', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.2)');
    root.style.setProperty('--node-learning-glow', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.5)');
    
    console.log('[SpellLearning] Applied learning color:', color);
}

/**
 * Apply font size multiplier to the entire UI
 * @param {number} multiplier - Font size multiplier (0.7 - 1.5)
 */
function applyFontSizeMultiplier(multiplier) {
    if (!multiplier || multiplier < 0.5 || multiplier > 2) {
        multiplier = 1.0;
    }
    
    var root = document.documentElement;
    root.style.setProperty('--font-size-multiplier', multiplier);
    
    // Apply to body font size (base is 14px in Skyrim theme)
    var baseFontSize = 14;
    document.body.style.fontSize = (baseFontSize * multiplier) + 'px';
    
    console.log('[SpellLearning] Applied font size multiplier:', multiplier);
}

// =============================================================================
// EARLY LEARNING UI UPDATE
// =============================================================================

/**
 * Update early learning UI elements from settings
 */
function updateEarlyLearningUI() {
    var el = settings.earlySpellLearning;
    
    var enabledToggle = document.getElementById('earlyLearningEnabled');
    if (enabledToggle) enabledToggle.checked = el.enabled;
    
    var displayToggle = document.getElementById('modifyGameDisplayToggle');
    if (displayToggle) displayToggle.checked = el.modifyGameDisplay;
    
    // Sliders
    var unlockSlider = document.getElementById('earlyUnlockThreshold');
    if (unlockSlider) {
        unlockSlider.value = el.unlockThreshold;
        var unlockValue = document.getElementById('earlyUnlockValue');
        if (unlockValue) unlockValue.textContent = el.unlockThreshold + '%';
        updateSliderFillGlobal(unlockSlider);
    }
    
    var selfCastSlider = document.getElementById('selfCastRequired');
    if (selfCastSlider) {
        selfCastSlider.value = el.selfCastRequiredAt;
        var selfCastValue = document.getElementById('selfCastRequiredValue');
        if (selfCastValue) selfCastValue.textContent = el.selfCastRequiredAt + '%';
        updateSliderFillGlobal(selfCastSlider);
    }
    
    var selfCastBonusSlider = document.getElementById('selfCastBonus');
    if (selfCastBonusSlider) {
        selfCastBonusSlider.value = el.selfCastXPMultiplier;
        var selfCastBonusValue = document.getElementById('selfCastBonusValue');
        if (selfCastBonusValue) selfCastBonusValue.textContent = el.selfCastXPMultiplier + '%';
        updateSliderFillGlobal(selfCastBonusSlider);
    }
    
    var binarySlider = document.getElementById('binaryEffectThreshold');
    if (binarySlider) {
        binarySlider.value = el.binaryEffectThreshold;
        var binaryValue = document.getElementById('binaryEffectValue');
        if (binaryValue) binaryValue.textContent = el.binaryEffectThreshold + '%';
        updateSliderFillGlobal(binarySlider);
    }
}

// =============================================================================
// SPELL TOME LEARNING UI UPDATE
// =============================================================================

/**
 * Update spell tome learning UI elements from settings
 */
function updateSpellTomeLearningUI() {
    var stl = settings.spellTomeLearning;
    
    // Main toggle - Vanilla vs Progression system
    var progressionToggle = document.getElementById('useProgressionSystemToggle');
    if (progressionToggle) progressionToggle.checked = stl.useProgressionSystem;
    
    // Tome inventory boost toggle
    var inventoryBoostToggle = document.getElementById('tomeInventoryBoostToggle');
    if (inventoryBoostToggle) inventoryBoostToggle.checked = stl.tomeInventoryBoost;
    
    // XP percent to grant slider
    var xpGrantSlider = document.getElementById('tomeXpGrantSlider');
    if (xpGrantSlider) {
        xpGrantSlider.value = stl.xpPercentToGrant;
        var xpGrantValue = document.getElementById('tomeXpGrantValue');
        if (xpGrantValue) xpGrantValue.textContent = stl.xpPercentToGrant + '%';
        updateSliderFillGlobal(xpGrantSlider);
    }
    
    // Inventory boost percent slider
    var boostSlider = document.getElementById('tomeInventoryBoostSlider');
    if (boostSlider) {
        boostSlider.value = stl.tomeInventoryBoostPercent;
        var boostValue = document.getElementById('tomeInventoryBoostValue');
        if (boostValue) boostValue.textContent = '+' + stl.tomeInventoryBoostPercent + '%';
        updateSliderFillGlobal(boostSlider);
    }
    
    // Learning requirements toggles
    var requirePrereqsToggle = document.getElementById('tomeRequirePrereqsToggle');
    if (requirePrereqsToggle) requirePrereqsToggle.checked = stl.requirePrereqs;
    
    var requireAllPrereqsToggle = document.getElementById('tomeRequireAllPrereqsToggle');
    if (requireAllPrereqsToggle) requireAllPrereqsToggle.checked = stl.requireAllPrereqs;
    
    var requireSkillLevelToggle = document.getElementById('tomeRequireSkillLevelToggle');
    if (requireSkillLevelToggle) requireSkillLevelToggle.checked = stl.requireSkillLevel;
    
    // Show/hide child setting based on parent
    var allPrereqsRow = document.getElementById('tomeRequireAllPrereqsRow');
    if (allPrereqsRow) allPrereqsRow.style.display = stl.requirePrereqs ? '' : 'none';
    
    // Update description based on mode
    var modeDesc = document.getElementById('tomeLearningModeDesc');
    if (modeDesc) {
        if (stl.useProgressionSystem) {
            modeDesc.textContent = 'Reading tomes grants XP and gives early access to weakened spells. Keep tomes to practice!';
        } else {
            modeDesc.textContent = 'Vanilla behavior: Reading tomes instantly teaches spells and consumes the book.';
        }
    }
}

// =============================================================================
// NOTIFICATIONS UI UPDATE
// =============================================================================

/**
 * Update notification settings UI elements from settings
 */
function updateNotificationsUI() {
    // Ensure settings exist
    if (!settings.notifications) {
        settings.notifications = { weakenedSpellNotifications: true, weakenedSpellInterval: 10 };
    }
    var notif = settings.notifications;
    
    // Weakened spell notifications toggle
    var weakenedToggle = document.getElementById('weakenedNotificationsToggle');
    if (weakenedToggle) weakenedToggle.checked = notif.weakenedSpellNotifications;
    
    // Notification interval slider
    var intervalSlider = document.getElementById('notificationIntervalSlider');
    if (intervalSlider) {
        intervalSlider.value = notif.weakenedSpellInterval;
        var intervalValue = document.getElementById('notificationIntervalValue');
        if (intervalValue) intervalValue.textContent = notif.weakenedSpellInterval + 's';
        updateSliderFillGlobal(intervalSlider);
    }
    
    // Show/hide interval row based on toggle
    var intervalRow = document.getElementById('notificationIntervalRow');
    if (intervalRow) {
        intervalRow.style.display = notif.weakenedSpellNotifications ? 'flex' : 'none';
    }
}

// =============================================================================
// HEART ANIMATION SETTINGS
// =============================================================================

/**
 * Initialize heart animation settings popup
 */
function initializeHeartSettings() {
    var settingsBtn = document.getElementById('heart-settings-btn');
    var popup = document.getElementById('heart-settings-popup');
    var closeBtn = document.getElementById('heart-settings-close');
    
    if (!settingsBtn || !popup) {
        console.log('[HeartSettings] Missing elements - btn:', !!settingsBtn, 'popup:', !!popup);
        return;
    }
    
    console.log('[HeartSettings] Initializing...');
    
    // Toggle popup visibility
    settingsBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });
    
    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            popup.style.display = 'none';
        });
    }
    
    // Close when clicking outside (but not on color picker)
    document.addEventListener('click', function(e) {
        if (popup.style.display !== 'none' && !popup.contains(e.target) && e.target !== settingsBtn) {
            // Don't close if clicking on color picker popup
            var colorPickerPopup = document.querySelector('.color-picker-popup');
            if (colorPickerPopup && colorPickerPopup.contains(e.target)) return;
            popup.style.display = 'none';
        }
    });
    
    // Animation enabled toggle
    var animToggle = document.getElementById('heart-animation-enabled');
    if (animToggle) {
        animToggle.checked = settings.heartAnimationEnabled !== false;
        animToggle.addEventListener('change', function() {
            settings.heartAnimationEnabled = this.checked;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Pulse speed slider
    var pulseSpeed = document.getElementById('heart-pulse-speed');
    var pulseSpeedVal = document.getElementById('heart-pulse-speed-val');
    if (pulseSpeed) {
        pulseSpeed.value = settings.heartPulseSpeed !== undefined ? settings.heartPulseSpeed : 0.2;
        if (pulseSpeedVal) pulseSpeedVal.textContent = parseFloat(pulseSpeed.value).toFixed(2);
        pulseSpeed.addEventListener('input', function() {
            settings.heartPulseSpeed = parseFloat(this.value);
            if (pulseSpeedVal) pulseSpeedVal.textContent = parseFloat(this.value).toFixed(2);
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Pulse delay slider (time between pulse groups)
    var pulseDelay = document.getElementById('heart-pulse-delay');
    var pulseDelayVal = document.getElementById('heart-pulse-delay-val');
    if (pulseDelay) {
        var delayValue = settings.heartPulseDelay !== undefined ? settings.heartPulseDelay : 5.0;
        pulseDelay.value = delayValue;
        if (pulseDelayVal) pulseDelayVal.textContent = parseFloat(delayValue).toFixed(1) + 's';
        pulseDelay.addEventListener('input', function() {
            settings.heartPulseDelay = parseFloat(this.value);
            if (pulseDelayVal) pulseDelayVal.textContent = parseFloat(this.value).toFixed(1) + 's';
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Background opacity slider
    var bgOpacity = document.getElementById('heart-bg-opacity');
    var bgOpacityVal = document.getElementById('heart-bg-opacity-val');
    if (bgOpacity) {
        var opacityValue = settings.heartBgOpacity !== undefined ? settings.heartBgOpacity : 1.0;
        bgOpacity.value = opacityValue;
        if (bgOpacityVal) bgOpacityVal.textContent = parseFloat(opacityValue).toFixed(1);
        bgOpacity.addEventListener('input', function() {
            settings.heartBgOpacity = parseFloat(this.value);
            if (bgOpacityVal) bgOpacityVal.textContent = parseFloat(this.value).toFixed(1);
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Helper to setup color swatch with ColorPicker
    function setupColorSwatch(swatchId, hiddenInputId, settingKey, defaultColor) {
        var swatch = document.getElementById(swatchId);
        var hiddenInput = document.getElementById(hiddenInputId);
        
        if (!swatch) {
            console.log('[HeartSettings] Missing swatch:', swatchId);
            return;
        }
        
        // Initialize from settings
        var color = settings[settingKey] || defaultColor;
        swatch.style.background = color;
        if (hiddenInput) hiddenInput.value = color;
        
        // Click handler - open color picker
        swatch.addEventListener('click', function(e) {
            e.stopPropagation();
            
            if (typeof ColorPicker !== 'undefined') {
                ColorPicker.show(swatch, color, function(newColor) {
                    color = newColor;
                    settings[settingKey] = newColor;
                    swatch.style.background = newColor;
                    if (hiddenInput) hiddenInput.value = newColor;
                    applyHeartSettingsToRenderer();
                    autoSaveSettings();
                    console.log('[HeartSettings]', settingKey, '=', newColor);
                });
            } else {
                console.warn('[HeartSettings] ColorPicker not available');
            }
        });
    }
    
    // Setup color swatches
    setupColorSwatch('heart-bg-color-swatch', 'heart-bg-color', 'heartBgColor', '#0a0a14');
    setupColorSwatch('heart-ring-color-swatch', 'heart-ring-color', 'heartRingColor', '#b8a878');
    setupColorSwatch('learning-path-color-swatch', 'learning-path-color', 'learningPathColor', '#00ffff');
    setupColorSwatch('starfield-color-swatch', 'starfield-color', 'starfieldColor', '#ffffff');
    setupColorSwatch('divider-custom-color-swatch', 'popup-divider-custom-color', 'dividerCustomColor', '#ffffff');
    setupColorSwatch('globe-color-swatch', 'popup-globe-color', 'globeColor', '#b8a878');
    setupColorSwatch('magic-text-color-swatch', 'popup-magic-text-color', 'magicTextColor', '#b8a878');
    
    // =========================================================================
    // STARFIELD SETTINGS
    // =========================================================================
    
    // Starfield enabled toggle
    var starfieldEnabled = document.getElementById('starfield-enabled');
    if (starfieldEnabled) {
        starfieldEnabled.checked = settings.starfieldEnabled !== false;
        starfieldEnabled.addEventListener('change', function() {
            settings.starfieldEnabled = this.checked;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Starfield fixed to screen toggle
    var starfieldFixed = document.getElementById('starfield-fixed');
    if (starfieldFixed) {
        starfieldFixed.checked = settings.starfieldFixed !== false;
        starfieldFixed.addEventListener('change', function() {
            settings.starfieldFixed = this.checked;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Starfield density slider
    var starfieldDensity = document.getElementById('starfield-density');
    var starfieldDensityVal = document.getElementById('starfield-density-val');
    if (starfieldDensity) {
        var densityValue = settings.starfieldDensity || 200;
        starfieldDensity.value = densityValue;
        if (starfieldDensityVal) starfieldDensityVal.textContent = densityValue;
        starfieldDensity.addEventListener('input', function() {
            settings.starfieldDensity = parseInt(this.value);
            if (starfieldDensityVal) starfieldDensityVal.textContent = this.value;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Starfield size slider
    var starfieldSize = document.getElementById('starfield-size');
    var starfieldSizeVal = document.getElementById('starfield-size-val');
    if (starfieldSize) {
        var sizeValue = settings.starfieldMaxSize || 2.5;
        starfieldSize.value = sizeValue;
        if (starfieldSizeVal) starfieldSizeVal.textContent = sizeValue;
        starfieldSize.addEventListener('input', function() {
            settings.starfieldMaxSize = parseFloat(this.value);
            if (starfieldSizeVal) starfieldSizeVal.textContent = this.value;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // === Divider Settings (in popup) ===
    
    // Show dividers toggle
    var popupShowDividers = document.getElementById('popup-show-dividers');
    if (popupShowDividers) {
        popupShowDividers.checked = settings.showSchoolDividers !== false;
        popupShowDividers.addEventListener('change', function() {
            settings.showSchoolDividers = this.checked;
            // Sync with main settings toggle
            var mainToggle = document.getElementById('showSchoolDividersToggle');
            if (mainToggle) mainToggle.checked = this.checked;
            if (state.treeData && typeof CanvasRenderer !== 'undefined') {
                CanvasRenderer._needsRender = true;
            }
            autoSaveSettings();
        });
    }
    
    // Divider length slider
    var dividerLength = document.getElementById('popup-divider-length');
    var dividerLengthVal = document.getElementById('popup-divider-length-val');
    if (dividerLength) {
        var lengthValue = settings.dividerLength || 800;
        dividerLength.value = lengthValue;
        if (dividerLengthVal) dividerLengthVal.textContent = lengthValue;
        dividerLength.addEventListener('input', function() {
            settings.dividerLength = parseInt(this.value);
            if (dividerLengthVal) dividerLengthVal.textContent = this.value;
            if (state.treeData && typeof CanvasRenderer !== 'undefined') {
                CanvasRenderer._needsRender = true;
            }
            autoSaveSettings();
        });
    }
    
    // Divider width slider
    var dividerWidth = document.getElementById('popup-divider-width');
    var dividerWidthVal = document.getElementById('popup-divider-width-val');
    if (dividerWidth) {
        var widthValue = settings.dividerSpacing || 3;
        dividerWidth.value = widthValue;
        if (dividerWidthVal) dividerWidthVal.textContent = widthValue + 'px';
        dividerWidth.addEventListener('input', function() {
            settings.dividerSpacing = parseInt(this.value);
            if (dividerWidthVal) dividerWidthVal.textContent = this.value + 'px';
            // Sync with main settings slider
            var mainSlider = document.getElementById('dividerSpacingSlider');
            var mainVal = document.getElementById('dividerSpacingValue');
            if (mainSlider) mainSlider.value = this.value;
            if (mainVal) mainVal.textContent = this.value + 'px';
            if (state.treeData && typeof CanvasRenderer !== 'undefined') {
                CanvasRenderer._needsRender = true;
            }
            autoSaveSettings();
        });
    }
    
    // Divider fade slider
    var popupDividerFade = document.getElementById('popup-divider-fade');
    var popupDividerFadeVal = document.getElementById('popup-divider-fade-val');
    if (popupDividerFade) {
        var fadeValue = settings.dividerFade !== undefined ? settings.dividerFade : 50;
        popupDividerFade.value = fadeValue;
        if (popupDividerFadeVal) popupDividerFadeVal.textContent = fadeValue + '%';
        popupDividerFade.addEventListener('input', function() {
            settings.dividerFade = parseInt(this.value);
            if (popupDividerFadeVal) popupDividerFadeVal.textContent = this.value + '%';
            // Sync with main settings slider
            var mainSlider = document.getElementById('dividerFadeSlider');
            var mainVal = document.getElementById('dividerFadeValue');
            if (mainSlider) mainSlider.value = this.value;
            if (mainVal) mainVal.textContent = this.value + '%';
            if (state.treeData && typeof CanvasRenderer !== 'undefined') {
                CanvasRenderer._needsRender = true;
            }
            autoSaveSettings();
        });
    }
    
    // Divider color mode select
    var popupDividerColorMode = document.getElementById('popup-divider-color-mode');
    var popupDividerCustomRow = document.getElementById('popup-divider-custom-row');
    if (popupDividerColorMode) {
        popupDividerColorMode.value = settings.dividerColorMode || 'school';
        // Show/hide custom color row
        if (popupDividerCustomRow) {
            popupDividerCustomRow.style.display = popupDividerColorMode.value === 'custom' ? '' : 'none';
        }
        popupDividerColorMode.addEventListener('change', function() {
            settings.dividerColorMode = this.value;
            // Sync with main settings select
            var mainSelect = document.getElementById('dividerColorModeSelect');
            if (mainSelect) mainSelect.value = this.value;
            // Show/hide custom color row
            if (popupDividerCustomRow) {
                popupDividerCustomRow.style.display = this.value === 'custom' ? '' : 'none';
            }
            updateDividerColorRowVisibility();
            if (state.treeData && typeof CanvasRenderer !== 'undefined') {
                CanvasRenderer._needsRender = true;
            }
            autoSaveSettings();
        });
    }
    
    // Divider custom color swatch (uses color picker)
    var dividerCustomSwatch = document.getElementById('divider-custom-color-swatch');
    var dividerCustomInput = document.getElementById('popup-divider-custom-color');
    if (dividerCustomSwatch && dividerCustomInput) {
        var customColor = settings.dividerCustomColor || '#ffffff';
        dividerCustomSwatch.style.background = customColor;
        dividerCustomInput.value = customColor;
        
        // Color picker callback is handled by setupColorSwatch in colorPicker.js
        // Just need to add the change listener on the hidden input
        dividerCustomInput.addEventListener('change', function() {
            settings.dividerCustomColor = this.value;
            dividerCustomSwatch.style.background = this.value;
            // Sync with main settings picker
            var mainPicker = document.getElementById('dividerCustomColorPicker');
            if (mainPicker) mainPicker.value = this.value;
            if (state.treeData && typeof CanvasRenderer !== 'undefined') {
                CanvasRenderer._needsRender = true;
            }
            autoSaveSettings();
        });
    }
    
    // === Globe Settings ===
    
    // Globe size slider
    var globeSize = document.getElementById('popup-globe-size');
    var globeSizeVal = document.getElementById('popup-globe-size-val');
    if (globeSize) {
        globeSize.value = settings.globeSize || 30;
        if (globeSizeVal) globeSizeVal.textContent = settings.globeSize || 30;
        globeSize.addEventListener('input', function() {
            settings.globeSize = parseInt(this.value);
            if (globeSizeVal) globeSizeVal.textContent = this.value;
            applyGlobeSettings();
            autoSaveSettings();
        });
    }
    
    // Globe density (particle count) slider
    var globeDensity = document.getElementById('popup-globe-density');
    var globeDensityVal = document.getElementById('popup-globe-density-val');
    if (globeDensity) {
        globeDensity.value = settings.globeDensity || 200;
        if (globeDensityVal) globeDensityVal.textContent = settings.globeDensity || 200;
        globeDensity.addEventListener('input', function() {
            settings.globeDensity = parseInt(this.value);
            if (globeDensityVal) globeDensityVal.textContent = this.value;
            applyGlobeSettings();
            autoSaveSettings();
        });
    }
    
    // Globe dot size min slider
    var globeDotMin = document.getElementById('popup-globe-dot-min');
    var globeDotMinVal = document.getElementById('popup-globe-dot-min-val');
    if (globeDotMin) {
        globeDotMin.value = settings.globeDotMin || 1;
        if (globeDotMinVal) globeDotMinVal.textContent = settings.globeDotMin || 1;
        globeDotMin.addEventListener('input', function() {
            settings.globeDotMin = parseFloat(this.value);
            if (globeDotMinVal) globeDotMinVal.textContent = this.value;
            applyGlobeSettings();
            autoSaveSettings();
        });
    }
    
    // Globe dot size max slider
    var globeDotMax = document.getElementById('popup-globe-dot-max');
    var globeDotMaxVal = document.getElementById('popup-globe-dot-max-val');
    if (globeDotMax) {
        globeDotMax.value = settings.globeDotMax || 3;
        if (globeDotMaxVal) globeDotMaxVal.textContent = settings.globeDotMax || 3;
        globeDotMax.addEventListener('input', function() {
            settings.globeDotMax = parseFloat(this.value);
            if (globeDotMaxVal) globeDotMaxVal.textContent = this.value;
            applyGlobeSettings();
            autoSaveSettings();
        });
    }
    
    // Globe color change listener
    var globeColorInput = document.getElementById('popup-globe-color');
    if (globeColorInput) {
        globeColorInput.addEventListener('change', function() {
            settings.globeColor = this.value;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Magic text color change listener
    var magicTextColorInput = document.getElementById('popup-magic-text-color');
    if (magicTextColorInput) {
        magicTextColorInput.addEventListener('change', function() {
            settings.magicTextColor = this.value;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Globe text input
    var globeTextInput = document.getElementById('popup-globe-text');
    if (globeTextInput) {
        globeTextInput.value = settings.globeText || 'HoM';
        globeTextInput.addEventListener('input', function() {
            settings.globeText = this.value;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Globe text size slider
    var globeTextSize = document.getElementById('popup-globe-text-size');
    var globeTextSizeVal = document.getElementById('popup-globe-text-size-val');
    if (globeTextSize) {
        globeTextSize.value = settings.globeTextSize || 16;
        if (globeTextSizeVal) globeTextSizeVal.textContent = settings.globeTextSize || 16;
        globeTextSize.addEventListener('input', function() {
            settings.globeTextSize = parseInt(this.value);
            if (globeTextSizeVal) globeTextSizeVal.textContent = this.value;
            applyHeartSettingsToRenderer();
            autoSaveSettings();
        });
    }
    
    // Particle trail toggle
    var particleTrailToggle = document.getElementById('popup-particle-trail');
    if (particleTrailToggle) {
        particleTrailToggle.checked = settings.particleTrailEnabled !== false;
        particleTrailToggle.addEventListener('change', function() {
            settings.particleTrailEnabled = this.checked;
            applyGlobeSettings();
            autoSaveSettings();
        });
    }
    
    // Apply initial settings to renderer
    applyHeartSettingsToRenderer();
    applyGlobeSettings();
    console.log('[HeartSettings] Initialized successfully');

}

/**
 * Apply globe settings to the Globe3D module
 */
function applyGlobeSettings() {
    if (typeof Globe3D !== 'undefined') {
        var sizeChanged = Globe3D.radius !== (settings.globeSize || 30);
        var countChanged = Globe3D.particleCount !== (settings.globeDensity || 200);
        
        Globe3D.radius = settings.globeSize || 30;
        Globe3D.globeCenterZ = -(settings.globeSize || 30);
        Globe3D.particleCount = settings.globeDensity || 200;
        
        // Store size range for particle initialization
        Globe3D.dotSizeMin = settings.globeDotMin || 1;
        Globe3D.dotSizeMax = settings.globeDotMax || 3;
        
        // Particle trail enabled
        Globe3D.trailEnabled = settings.particleTrailEnabled !== false;
        
        // Reinitialize if particle count changed
        if (countChanged || sizeChanged) {
            Globe3D.init();
        }
        
        if (typeof CanvasRenderer !== 'undefined') {
            CanvasRenderer._needsRender = true;
        }
    }
}

/**
 * Apply heart settings to the canvas renderer
 */
function applyHeartSettingsToRenderer() {
    if (typeof CanvasRenderer !== 'undefined') {
        // Heart settings
        CanvasRenderer._heartbeatSpeed = settings.heartPulseSpeed !== undefined ? settings.heartPulseSpeed : 0.2;
        CanvasRenderer._heartPulseDelay = settings.heartPulseDelay !== undefined ? settings.heartPulseDelay : 5.0;
        CanvasRenderer._heartAnimationEnabled = settings.heartAnimationEnabled !== false;
        CanvasRenderer._heartBgOpacity = settings.heartBgOpacity !== undefined ? settings.heartBgOpacity : 1.0;
        CanvasRenderer._heartBgColor = settings.heartBgColor || '#0a0a14';
        CanvasRenderer._heartRingColor = settings.heartRingColor || '#b8a878';
        CanvasRenderer._learningPathColor = settings.learningPathColor || '#00ffff';
        
        // Globe colors and text
        CanvasRenderer._globeColor = settings.globeColor || settings.heartRingColor || '#b8a878';
        CanvasRenderer._magicTextColor = settings.magicTextColor || settings.heartRingColor || '#b8a878';
        CanvasRenderer._globeText = settings.globeText || 'HoM';
        CanvasRenderer._globeTextSize = settings.globeTextSize || 16;
        
        // Starfield settings
        CanvasRenderer._starfieldEnabled = settings.starfieldEnabled !== false;
        CanvasRenderer._starfieldFixed = settings.starfieldFixed !== false;
        CanvasRenderer._starfieldColor = settings.starfieldColor || '#ffffff';
        CanvasRenderer._starfieldDensity = settings.starfieldDensity || 200;
        CanvasRenderer._starfieldMaxSize = settings.starfieldMaxSize || 2.5;
        
        CanvasRenderer._needsRender = true;
    }
}
