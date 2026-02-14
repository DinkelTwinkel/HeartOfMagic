/**
 * Settings Presets Module
 * Save/load/delete/rename user configurations for progression, early spell,
 * and spell tome settings. Replaces the old difficulty profile system.
 *
 * Ships with 3 built-in presets: Default (Normal), Easy, Hard.
 *
 * Depends on:
 * - modules/state.js (settings, settingsPresets)
 * - modules/settingsPanel.js (autoSaveSettings/scheduleAutoSave, updateEarlyLearningUI, updateSpellTomeLearningUI)
 * - modules/constants.js (no longer needs DIFFICULTY_PROFILES)
 *
 * Exports (global):
 * - initializeSettingsPresets()
 * - updateSettingsPresetsUI()
 * - saveSettingsPreset(name)
 * - applySettingsPreset(name)
 * - deleteSettingsPreset(name, deleteBtn)
 * - renameSettingsPreset(oldName, newName)
 * - promptSaveSettingsPreset()
 * - updateProgressionSettingsUI()
 */

// Track which preset was last applied (for active highlighting)
var _activeSettingsPreset = '';
var _settingsPresetsInitialized = false;

var SETTINGS_PRESET_DEFAULT_NAME = 'Default';

// =============================================================================
// BUILT-IN PRESETS
// =============================================================================

var BUILT_IN_SETTINGS_PRESETS = {
    'Default': {
        name: 'Default',
        builtIn: true,
        settings: {
            xpGlobalMultiplier: 1,
            xpMultiplierDirect: 100,
            xpMultiplierSchool: 50,
            xpMultiplierAny: 10,
            xpCapAny: 5,
            xpCapSchool: 15,
            xpCapDirect: 50,
            xpNovice: 100,
            xpApprentice: 200,
            xpAdept: 400,
            xpExpert: 800,
            xpMaster: 1500,
            learningMode: 'perSchool',
            revealName: 10,
            revealEffects: 25,
            revealDescription: 50,
            discoveryMode: false,
            showRootSpellNames: true,
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 25,
                minEffectiveness: 20,
                maxEffectiveness: 70,
                selfCastRequiredAt: 75,
                selfCastXPMultiplier: 150,
                binaryEffectThreshold: 80,
                modifyGameDisplay: true,
                powerSteps: [
                    { xp: 25, power: 20, label: 'Budding' },
                    { xp: 40, power: 35, label: 'Developing' },
                    { xp: 55, power: 50, label: 'Practicing' },
                    { xp: 70, power: 65, label: 'Advancing' },
                    { xp: 85, power: 80, label: 'Refining' }
                ]
            },
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 25,
                tomeInventoryBoost: true,
                tomeInventoryBoostPercent: 25,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: false
            },
            notifications: {
                weakenedSpellNotifications: true,
                weakenedSpellInterval: 10
            }
        }
    },
    'Easy': {
        name: 'Easy',
        builtIn: false,
        settings: {
            xpGlobalMultiplier: 2,
            xpMultiplierDirect: 150,
            xpMultiplierSchool: 75,
            xpMultiplierAny: 25,
            xpCapAny: 10,
            xpCapSchool: 25,
            xpCapDirect: 65,
            xpNovice: 50,
            xpApprentice: 100,
            xpAdept: 200,
            xpExpert: 400,
            xpMaster: 800,
            learningMode: 'perSchool',
            revealName: 5,
            revealEffects: 15,
            revealDescription: 30,
            discoveryMode: false,
            showRootSpellNames: true,
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 20,
                minEffectiveness: 30,
                maxEffectiveness: 80,
                selfCastRequiredAt: 60,
                selfCastXPMultiplier: 200,
                binaryEffectThreshold: 70,
                modifyGameDisplay: true,
                powerSteps: [
                    { xp: 25, power: 20, label: 'Budding' },
                    { xp: 40, power: 35, label: 'Developing' },
                    { xp: 55, power: 50, label: 'Practicing' },
                    { xp: 70, power: 65, label: 'Advancing' },
                    { xp: 85, power: 80, label: 'Refining' }
                ]
            },
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 30,
                tomeInventoryBoost: true,
                tomeInventoryBoostPercent: 30,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: false
            },
            notifications: {
                weakenedSpellNotifications: true,
                weakenedSpellInterval: 10
            }
        }
    },
    'Hard': {
        name: 'Hard',
        builtIn: false,
        settings: {
            xpGlobalMultiplier: 0.75,
            xpMultiplierDirect: 75,
            xpMultiplierSchool: 35,
            xpMultiplierAny: 5,
            xpCapAny: 3,
            xpCapSchool: 10,
            xpCapDirect: 40,
            xpNovice: 150,
            xpApprentice: 350,
            xpAdept: 700,
            xpExpert: 1200,
            xpMaster: 2500,
            learningMode: 'perSchool',
            revealName: 15,
            revealEffects: 35,
            revealDescription: 60,
            discoveryMode: false,
            showRootSpellNames: true,
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 30,
                minEffectiveness: 15,
                maxEffectiveness: 60,
                selfCastRequiredAt: 70,
                selfCastXPMultiplier: 125,
                binaryEffectThreshold: 85,
                modifyGameDisplay: true,
                powerSteps: [
                    { xp: 25, power: 20, label: 'Budding' },
                    { xp: 40, power: 35, label: 'Developing' },
                    { xp: 55, power: 50, label: 'Practicing' },
                    { xp: 70, power: 65, label: 'Advancing' },
                    { xp: 85, power: 80, label: 'Refining' }
                ]
            },
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 20,
                tomeInventoryBoost: true,
                tomeInventoryBoostPercent: 20,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: false
            },
            notifications: {
                weakenedSpellNotifications: true,
                weakenedSpellInterval: 10
            }
        }
    }
};

// =============================================================================
// INITIALIZATION
// =============================================================================

function initializeSettingsPresets() {
    if (_settingsPresetsInitialized) return;

    // Set Default as active if nothing is active
    if (!_activeSettingsPreset) {
        _activeSettingsPreset = SETTINGS_PRESET_DEFAULT_NAME;
    }

    var saveBtn = document.getElementById('saveSettingsPresetBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            promptSaveSettingsPreset();
        });
    }

    _settingsPresetsInitialized = true;

    // NOTE: LoadPresets is NOT called here anymore.
    // It's triggered from onUnifiedConfigLoaded (in settingsPanel.js) AFTER the active
    // preset name is loaded from config and any legacy migration is complete.
    // This ensures the correct ordering: config → migrate → load files → apply.
    if (!window.callCpp) {
        // Dev harness / no C++ — seed built-ins directly
        for (var key in BUILT_IN_SETTINGS_PRESETS) {
            if (!BUILT_IN_SETTINGS_PRESETS.hasOwnProperty(key)) continue;
            if (!settingsPresets[key]) {
                settingsPresets[key] = JSON.parse(JSON.stringify(BUILT_IN_SETTINGS_PRESETS[key]));
            }
        }
        updateSettingsPresetsUI();
    }

    console.log('[SettingsPresets] Initialized');
}

// =============================================================================
// SAVE PRESET
// =============================================================================

function promptSaveSettingsPreset() {
    showPresetNamePrompt('Save Settings Preset', function(name) {
        // Cannot use reserved name
        if (name.toLowerCase() === SETTINGS_PRESET_DEFAULT_NAME.toLowerCase() && !settingsPresets[name]) {
            return;
        }
        saveSettingsPreset(name);
    });
}

function saveSettingsPreset(name) {
    var preset = settingsPresets[name] || {};
    preset.name = name;
    preset.created = preset.created || Date.now();

    preset.settings = {
        // Flat progression settings
        xpGlobalMultiplier: settings.xpGlobalMultiplier,
        xpMultiplierDirect: settings.xpMultiplierDirect,
        xpMultiplierSchool: settings.xpMultiplierSchool,
        xpMultiplierAny: settings.xpMultiplierAny,
        xpCapAny: settings.xpCapAny,
        xpCapSchool: settings.xpCapSchool,
        xpCapDirect: settings.xpCapDirect,
        xpNovice: settings.xpNovice,
        xpApprentice: settings.xpApprentice,
        xpAdept: settings.xpAdept,
        xpExpert: settings.xpExpert,
        xpMaster: settings.xpMaster,
        learningMode: settings.learningMode,
        revealName: settings.revealName,
        revealEffects: settings.revealEffects,
        revealDescription: settings.revealDescription,
        discoveryMode: settings.discoveryMode,
        showRootSpellNames: settings.showRootSpellNames,
        // Nested objects (deep copy)
        earlySpellLearning: JSON.parse(JSON.stringify(settings.earlySpellLearning)),
        spellTomeLearning: JSON.parse(JSON.stringify(settings.spellTomeLearning)),
        notifications: JSON.parse(JSON.stringify(settings.notifications || {})),
        moddedXPSources: JSON.parse(JSON.stringify(settings.moddedXPSources || {}))
    };

    settingsPresets[name] = preset;
    _activeSettingsPreset = name;

    // Save as individual file via C++
    if (window.callCpp) {
        window.callCpp('SavePreset', JSON.stringify({
            type: 'settings',
            name: name,
            data: preset
        }));
    }

    updateSettingsPresetsUI();

    // Save active preset name to unified config
    if (typeof scheduleAutoSave === 'function') {
        scheduleAutoSave();
    } else if (typeof autoSaveSettings === 'function') {
        autoSaveSettings();
    }

    console.log('[SettingsPresets] Saved preset file:', name);
}

// =============================================================================
// APPLY PRESET
// =============================================================================

function applySettingsPreset(name) {
    var preset = settingsPresets[name];
    if (!preset || !preset.settings) {
        console.warn('[SettingsPresets] Preset not found:', name);
        return;
    }

    var ps = preset.settings;
    console.log('[SettingsPresets] Applying preset:', name);

    // --- Flat progression settings ---
    var flatKeys = [
        'xpGlobalMultiplier', 'xpMultiplierDirect', 'xpMultiplierSchool', 'xpMultiplierAny',
        'xpCapAny', 'xpCapSchool', 'xpCapDirect',
        'xpNovice', 'xpApprentice', 'xpAdept', 'xpExpert', 'xpMaster',
        'learningMode', 'revealName', 'revealEffects', 'revealDescription',
        'discoveryMode', 'showRootSpellNames'
    ];
    for (var i = 0; i < flatKeys.length; i++) {
        var key = flatKeys[i];
        if (ps[key] !== undefined) {
            settings[key] = ps[key];
        }
    }

    // --- Early Spell Learning (deep copy) ---
    if (ps.earlySpellLearning) {
        var src = ps.earlySpellLearning;
        for (var k in src) {
            if (!src.hasOwnProperty(k)) continue;
            if (k === 'powerSteps') {
                settings.earlySpellLearning.powerSteps = JSON.parse(JSON.stringify(src.powerSteps));
            } else {
                settings.earlySpellLearning[k] = src[k];
            }
        }
    }

    // --- Spell Tome Learning (deep copy) ---
    if (ps.spellTomeLearning) {
        for (var k in ps.spellTomeLearning) {
            if (ps.spellTomeLearning.hasOwnProperty(k)) {
                settings.spellTomeLearning[k] = ps.spellTomeLearning[k];
            }
        }
    }

    // --- Notifications ---
    if (ps.notifications && settings.notifications) {
        for (var k in ps.notifications) {
            if (ps.notifications.hasOwnProperty(k)) {
                settings.notifications[k] = ps.notifications[k];
            }
        }
    }

    // --- Modded XP Sources ---
    if (ps.moddedXPSources) {
        settings.moddedXPSources = JSON.parse(JSON.stringify(ps.moddedXPSources));
        if (typeof rebuildModdedXPSourcesUI === 'function') {
            rebuildModdedXPSourcesUI();
        }
    }

    // --- Update all UI controls ---
    updateProgressionSettingsUI();

    if (typeof updateEarlyLearningUI === 'function') {
        updateEarlyLearningUI();
    }

    if (typeof updateSpellTomeLearningUI === 'function') {
        updateSpellTomeLearningUI();
    }

    // Discovery mode toggle
    var discoveryModeToggle = document.getElementById('discoveryModeToggle');
    if (discoveryModeToggle) discoveryModeToggle.checked = settings.discoveryMode;
    var showRootNamesToggle = document.getElementById('showRootSpellNamesToggle');
    if (showRootNamesToggle) showRootNamesToggle.checked = settings.showRootSpellNames;

    // Re-render tree if discovery mode changed
    if (typeof state !== 'undefined' && state.treeData) {
        if (typeof WheelRenderer !== 'undefined' && WheelRenderer.render) {
            WheelRenderer.render();
        }
    }

    _activeSettingsPreset = name;
    updateSettingsPresetsUI();

    if (typeof scheduleAutoSave === 'function') {
        scheduleAutoSave();
    } else if (typeof autoSaveSettings === 'function') {
        autoSaveSettings();
    }

    console.log('[SettingsPresets] Applied preset:', name);
}

// =============================================================================
// DELETE PRESET
// =============================================================================

function deleteSettingsPreset(name, deleteBtn) {
    if (!settingsPresets[name]) return;

    // Cannot delete the default preset
    if (name === _getDefaultSettingsPresetKey()) return;

    // Second-click confirmation
    if (!deleteBtn || deleteBtn.getAttribute('data-armed') !== 'true') {
        if (deleteBtn) {
            deleteBtn.setAttribute('data-armed', 'true');
            deleteBtn.classList.add('armed');
            deleteBtn.title = 'Click again to confirm delete';
            setTimeout(function() {
                deleteBtn.removeAttribute('data-armed');
                deleteBtn.classList.remove('armed');
                deleteBtn.title = 'Delete preset';
            }, 2000);
        }
        return;
    }

    delete settingsPresets[name];

    // Delete the preset file via C++
    if (window.callCpp) {
        window.callCpp('DeletePreset', JSON.stringify({ type: 'settings', name: name }));
    }

    if (_activeSettingsPreset === name) {
        _activeSettingsPreset = SETTINGS_PRESET_DEFAULT_NAME;
    }

    updateSettingsPresetsUI();

    if (typeof scheduleAutoSave === 'function') {
        scheduleAutoSave();
    } else if (typeof autoSaveSettings === 'function') {
        autoSaveSettings();
    }

    console.log('[SettingsPresets] Deleted preset file:', name);
}

// =============================================================================
// RENAME PRESET
// =============================================================================

function renameSettingsPreset(oldName, newName) {
    if (!newName || newName.trim() === '' || !settingsPresets[oldName]) return;
    newName = newName.trim();

    if (newName === oldName) return;

    // Cannot rename Default
    if (oldName === _getDefaultSettingsPresetKey()) {
        updateSettingsPresetsUI();
        return;
    }

    // Cannot rename to "Default" (reserved)
    if (newName.toLowerCase() === SETTINGS_PRESET_DEFAULT_NAME.toLowerCase()) {
        updateSettingsPresetsUI();
        return;
    }

    // Check duplicate
    if (settingsPresets[newName]) {
        if (!confirm(t('settingsPresets.overwriteConfirm', {name: newName}))) {
            updateSettingsPresetsUI();
            return;
        }
        delete settingsPresets[newName];
    }

    var preset = settingsPresets[oldName];
    preset.name = newName;
    settingsPresets[newName] = preset;
    delete settingsPresets[oldName];

    // Delete old file, save new file
    if (window.callCpp) {
        window.callCpp('DeletePreset', JSON.stringify({ type: 'settings', name: oldName }));
        window.callCpp('SavePreset', JSON.stringify({ type: 'settings', name: newName, data: preset }));
    }

    if (_activeSettingsPreset === oldName) {
        _activeSettingsPreset = newName;
    }

    updateSettingsPresetsUI();

    if (typeof scheduleAutoSave === 'function') {
        scheduleAutoSave();
    } else if (typeof autoSaveSettings === 'function') {
        autoSaveSettings();
    }

    console.log('[SettingsPresets] Renamed preset:', oldName, '->', newName);
}

// =============================================================================
// UI RENDERING
// =============================================================================

function updateSettingsPresetsUI() {
    var row = document.getElementById('settingsPresetsRow');
    var chipsContainer = document.getElementById('settingsPresetChips');
    if (!row || !chipsContainer) return;

    var keys = Object.keys(settingsPresets);
    var divider = row.querySelector('.scanner-presets-divider');

    // Show/hide divider + chips when empty
    if (divider) divider.style.display = keys.length > 0 ? '' : 'none';
    chipsContainer.style.display = keys.length > 0 ? '' : 'none';

    // Rebuild chips
    chipsContainer.innerHTML = '';

    var defaultKey = _getDefaultSettingsPresetKey();

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var preset = settingsPresets[key];
        var chipName = preset.name || key;
        var isDefault = (key === defaultKey);

        var chip = document.createElement('div');
        chip.className = 'scanner-preset-chip';
        if (key === _activeSettingsPreset) {
            chip.className += ' active';
        }
        if (isDefault) {
            chip.className += ' default';
        }

        var nameSpan = document.createElement('span');
        nameSpan.className = 'scanner-preset-name';
        nameSpan.textContent = chipName;
        nameSpan.setAttribute('data-preset', key);

        // Single click to apply
        nameSpan.addEventListener('click', (function(k) {
            return function() {
                applySettingsPreset(k);
            };
        })(key));

        // Double click to rename (not on Default)
        if (!isDefault) {
            nameSpan.addEventListener('dblclick', (function(k, span) {
                return function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    _startSettingsInlineRename(k, span);
                };
            })(key, nameSpan));
        }

        chip.appendChild(nameSpan);

        // Update button on active preset
        if (key === _activeSettingsPreset) {
            var updateBtn = document.createElement('span');
            updateBtn.className = 'scanner-preset-update';
            updateBtn.innerHTML = '&#8635;';
            updateBtn.title = 'Update preset with current settings';
            updateBtn.addEventListener('click', (function(k) {
                return function(e) {
                    e.stopPropagation();
                    saveSettingsPreset(k);
                };
            })(key));
            chip.appendChild(updateBtn);
        }

        // Delete button (not on Default)
        if (!isDefault) {
            var deleteBtn = document.createElement('span');
            deleteBtn.className = 'scanner-preset-delete';
            deleteBtn.textContent = '\u00d7';
            deleteBtn.title = 'Delete preset';
            deleteBtn.addEventListener('click', (function(k, btn) {
                return function(e) {
                    e.stopPropagation();
                    deleteSettingsPreset(k, btn);
                };
            })(key, deleteBtn));
            chip.appendChild(deleteBtn);
        }

        chipsContainer.appendChild(chip);
    }
}

// =============================================================================
// INLINE RENAME
// =============================================================================

function _startSettingsInlineRename(presetKey, nameSpan) {
    var currentName = settingsPresets[presetKey] ? settingsPresets[presetKey].name : presetKey;
    var chip = nameSpan.parentElement;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'scanner-preset-rename';
    input.value = currentName;
    input.style.width = Math.max(60, currentName.length * 7) + 'px';

    nameSpan.style.display = 'none';
    chip.insertBefore(input, nameSpan);
    input.focus();
    input.select();

    var committed = false;

    function commit() {
        if (committed) return;
        committed = true;

        var newName = input.value.trim();
        if (input.parentElement) {
            input.parentElement.removeChild(input);
        }
        nameSpan.style.display = '';

        if (newName && newName !== currentName) {
            renameSettingsPreset(presetKey, newName);
        }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            committed = true;
            if (input.parentElement) {
                input.parentElement.removeChild(input);
            }
            nameSpan.style.display = '';
        }
    });
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Returns the key of the default preset (named "Default", case-insensitive).
 */
function _getDefaultSettingsPresetKey() {
    var keys = Object.keys(settingsPresets);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === SETTINGS_PRESET_DEFAULT_NAME.toLowerCase()) {
            return keys[i];
        }
    }
    return null;
}

// =============================================================================
// UI UPDATE — PROGRESSION SETTINGS
// (Moved from difficultyProfiles.js)
// =============================================================================

function updateProgressionSettingsUI() {
    // Helper to update slider fill visual
    function updateSliderFill(slider) {
        if (!slider) return;
        var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
        slider.style.setProperty('--slider-fill', percent + '%');
    }

    // Global multiplier
    var globalMultSlider = document.getElementById('xpGlobalMultiplierSlider');
    var globalMultValue = document.getElementById('xpGlobalMultiplierValue');
    if (globalMultSlider) {
        globalMultSlider.value = settings.xpGlobalMultiplier;
        updateSliderFill(globalMultSlider);
        if (globalMultValue) globalMultValue.textContent = 'x' + settings.xpGlobalMultiplier;
    }

    // XP multipliers
    var xpDirectSlider = document.getElementById('xpDirectSlider');
    var xpDirectValue = document.getElementById('xpDirectValue');
    if (xpDirectSlider) {
        xpDirectSlider.value = settings.xpMultiplierDirect;
        updateSliderFill(xpDirectSlider);
        if (xpDirectValue) xpDirectValue.textContent = settings.xpMultiplierDirect + '%';
    }

    var xpSchoolSlider = document.getElementById('xpSchoolSlider');
    var xpSchoolValue = document.getElementById('xpSchoolValue');
    if (xpSchoolSlider) {
        xpSchoolSlider.value = settings.xpMultiplierSchool;
        updateSliderFill(xpSchoolSlider);
        if (xpSchoolValue) xpSchoolValue.textContent = settings.xpMultiplierSchool + '%';
    }

    var xpAnySlider = document.getElementById('xpAnySlider');
    var xpAnyValue = document.getElementById('xpAnyValue');
    if (xpAnySlider) {
        xpAnySlider.value = settings.xpMultiplierAny;
        updateSliderFill(xpAnySlider);
        if (xpAnyValue) xpAnyValue.textContent = settings.xpMultiplierAny + '%';
    }

    // Tier XP inputs
    var tierInputs = {
        'xpNoviceInput': settings.xpNovice,
        'xpApprenticeInput': settings.xpApprentice,
        'xpAdeptInput': settings.xpAdept,
        'xpExpertInput': settings.xpExpert,
        'xpMasterInput': settings.xpMaster
    };
    for (var inputId in tierInputs) {
        var input = document.getElementById(inputId);
        if (input) input.value = tierInputs[inputId];
    }

    // Reveal sliders
    var revealSliders = [
        { sliderId: 'revealNameSlider', valueId: 'revealNameValue', setting: settings.revealName },
        { sliderId: 'revealEffectsSlider', valueId: 'revealEffectsValue', setting: settings.revealEffects },
        { sliderId: 'revealDescSlider', valueId: 'revealDescValue', setting: settings.revealDescription }
    ];
    for (var r = 0; r < revealSliders.length; r++) {
        var cfg = revealSliders[r];
        var slider = document.getElementById(cfg.sliderId);
        var valueEl = document.getElementById(cfg.valueId);
        if (slider) {
            slider.value = cfg.setting;
            updateSliderFill(slider);
            if (valueEl) valueEl.textContent = cfg.setting + '%';
        }
    }

    // XP caps
    var capSliders = [
        { sliderId: 'xpCapAnySlider', valueId: 'xpCapAnyValue', setting: settings.xpCapAny },
        { sliderId: 'xpCapSchoolSlider', valueId: 'xpCapSchoolValue', setting: settings.xpCapSchool },
        { sliderId: 'xpCapDirectSlider', valueId: 'xpCapDirectValue', setting: settings.xpCapDirect }
    ];
    for (var c = 0; c < capSliders.length; c++) {
        var cap = capSliders[c];
        var capSlider = document.getElementById(cap.sliderId);
        var capValue = document.getElementById(cap.valueId);
        if (capSlider) {
            capSlider.value = cap.setting;
            updateSliderFill(capSlider);
            if (capValue) capValue.textContent = cap.setting + '%';
        }
    }

    // Learning mode toggle
    setSegmentedToggleValue('learningModeToggle', settings.learningMode);

    // Update spell tome learning UI if function exists
    if (typeof updateSpellTomeLearningUI === 'function') {
        updateSpellTomeLearningUI();
    }
}

// =============================================================================
// CLEAR TREE (moved from difficultyProfiles.js)
// =============================================================================

function clearTree() {
    console.log('[SpellLearning] Clearing tree data');

    state.treeData = null;
    state.selectedNode = null;
    state.spellInfoCache = {};
    state.learningTargets = {};

    if (typeof SmartRenderer !== 'undefined') {
        SmartRenderer.clear();
    } else if (typeof WheelRenderer !== 'undefined') {
        WheelRenderer.clear();
    }

    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.remove('hidden');

    var treeActions = document.getElementById('tree-actions');
    if (treeActions) treeActions.classList.add('hidden');

    var detailsPanel = document.getElementById('details-panel');
    if (detailsPanel) detailsPanel.classList.add('hidden');

    var totalCount = document.getElementById('total-count');
    if (totalCount) totalCount.textContent = '0';
    var unlockedCount = document.getElementById('unlocked-count');
    if (unlockedCount) unlockedCount.textContent = '0';

    if (typeof setTreeStatus === 'function') {
        setTreeStatus('Tree cleared - ready for new generation');
    }
    if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeCleared'));
}

window.clearTree = clearTree;

console.log('[SettingsPresets] Loaded');
