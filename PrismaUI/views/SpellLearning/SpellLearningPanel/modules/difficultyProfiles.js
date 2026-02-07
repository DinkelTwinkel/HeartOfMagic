/**
 * Difficulty Profiles Module
 * Handles difficulty profile management and custom profiles
 * 
 * Depends on:
 * - modules/constants.js (DIFFICULTY_PROFILES)
 * - modules/state.js (settings, customProfiles)
 * - modules/uiHelpers.js (updateStatus)
 * 
 * Exports (global):
 * - initializeDifficultyProfiles()
 * - onProfileChange()
 * - applyProfile()
 * - updateProfileDropdown()
 * - updateProfileDescription()
 * - updateProfileModifiedBadge()
 * - updateCustomProfilesUI()
 * - saveCustomProfile()
 * - deleteCustomProfile()
 * - exportProfiles()
 * - importProfiles()
 */

// =============================================================================
// DIFFICULTY PROFILE SYSTEM
// =============================================================================

function initializeDifficultyProfiles() {
    var profileSelect = document.getElementById('difficultyProfileSelect');
    var saveCustomBtn = document.getElementById('saveCustomProfileBtn');
    var resetBtn = document.getElementById('resetToProfileBtn');
    
    if (profileSelect) {
        // Add custom profiles to dropdown
        updateProfileDropdown();
        
        // Set initial value
        profileSelect.value = settings.activeProfile;
        updateProfileDescription();
        
        profileSelect.addEventListener('change', function() {
            applyProfile(this.value);
        });
    }
    
    if (saveCustomBtn) {
        saveCustomBtn.addEventListener('click', function() {
            promptSaveCustomProfile();
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            resetToProfile();
        });
    }
    
    // Update modified badge based on current state
    updateProfileModifiedBadge();
    updateCustomProfilesUI();
}

function applyProfile(profileId) {
    var profile = DIFFICULTY_PROFILES[profileId] || customProfiles[profileId];
    if (!profile) {
        console.warn('[SpellLearning] Profile not found:', profileId);
        return;
    }
    
    console.log('[SpellLearning] Applying profile:', profile.name);
    
    // Copy profile settings to our settings object
    var ps = profile.settings;
    
    // =======================================================================
    // PROGRESSION SETTINGS - XP multipliers and tier requirements
    // =======================================================================
    settings.xpGlobalMultiplier = ps.xpGlobalMultiplier !== undefined ? ps.xpGlobalMultiplier : 1;
    settings.xpMultiplierDirect = ps.xpMultiplierDirect !== undefined ? ps.xpMultiplierDirect : 100;
    settings.xpMultiplierSchool = ps.xpMultiplierSchool !== undefined ? ps.xpMultiplierSchool : 50;
    settings.xpMultiplierAny = ps.xpMultiplierAny !== undefined ? ps.xpMultiplierAny : 10;
    settings.xpNovice = ps.xpNovice !== undefined ? ps.xpNovice : 100;
    settings.xpApprentice = ps.xpApprentice !== undefined ? ps.xpApprentice : 200;
    settings.xpAdept = ps.xpAdept !== undefined ? ps.xpAdept : 400;
    settings.xpExpert = ps.xpExpert !== undefined ? ps.xpExpert : 800;
    settings.xpMaster = ps.xpMaster !== undefined ? ps.xpMaster : 1500;
    
    // XP caps (max % from each source)
    settings.xpCapAny = ps.xpCapAny !== undefined ? ps.xpCapAny : 5;
    settings.xpCapSchool = ps.xpCapSchool !== undefined ? ps.xpCapSchool : 15;
    settings.xpCapDirect = ps.xpCapDirect !== undefined ? ps.xpCapDirect : 50;
    
    // Learning mode
    settings.learningMode = ps.learningMode !== undefined ? ps.learningMode : 'perSchool';
    
    // Progressive reveal thresholds
    settings.revealName = ps.revealName !== undefined ? ps.revealName : 10;
    settings.revealEffects = ps.revealEffects !== undefined ? ps.revealEffects : 25;
    settings.revealDescription = ps.revealDescription !== undefined ? ps.revealDescription : 50;
    
    // =======================================================================
    // EARLY SPELL LEARNING SETTINGS
    // =======================================================================
    if (ps.earlySpellLearning) {
        settings.earlySpellLearning = Object.assign({}, settings.earlySpellLearning, ps.earlySpellLearning);
        updateEarlyLearningUI();
    }
    
    // =======================================================================
    // SPELL TOME LEARNING SETTINGS
    // =======================================================================
    if (ps.spellTomeLearning) {
        settings.spellTomeLearning = Object.assign({}, settings.spellTomeLearning, ps.spellTomeLearning);
        updateSpellTomeLearningUI();
    }
    
    // =======================================================================
    // DISCOVERY MODE
    // =======================================================================
    if (ps.discoveryMode !== undefined) {
        settings.discoveryMode = ps.discoveryMode;
        var discoveryModeToggle = document.getElementById('discoveryModeToggle');
        if (discoveryModeToggle) discoveryModeToggle.checked = settings.discoveryMode;
    }
    
    if (ps.showRootSpellNames !== undefined) {
        settings.showRootSpellNames = ps.showRootSpellNames;
        var showRootNamesToggle = document.getElementById('showRootSpellNamesToggle');
        if (showRootNamesToggle) showRootNamesToggle.checked = settings.showRootSpellNames;
    }
    
    settings.activeProfile = profileId;
    settings.profileModified = false;
    
    // Update all UI controls
    updateProgressionSettingsUI();
    updateProfileDescription();
    updateProfileModifiedBadge();
    updateCustomProfilesUI();
    
    // Re-render tree if discovery mode changed
    if (state.treeData) {
        WheelRenderer.render();
    }
    
    // Save settings
    scheduleAutoSave();
}

function resetToProfile() {
    applyProfile(settings.activeProfile);
}

function promptSaveCustomProfile() {
    var name = prompt('Enter a name for your custom profile:');
    if (!name || name.trim() === '') return;
    
    name = name.trim();
    
    // Check for duplicate names
    if (customProfiles[name]) {
        if (!confirm('A profile with this name already exists. Overwrite it?')) {
            return;
        }
    }
    
    saveCustomProfile(name);
}

function saveCustomProfile(name) {
    customProfiles[name] = {
        name: name,
        description: 'Custom profile',
        settings: {
            // Progression settings
            xpGlobalMultiplier: settings.xpGlobalMultiplier,
            xpMultiplierDirect: settings.xpMultiplierDirect,
            xpMultiplierSchool: settings.xpMultiplierSchool,
            xpMultiplierAny: settings.xpMultiplierAny,
            xpNovice: settings.xpNovice,
            xpApprentice: settings.xpApprentice,
            xpAdept: settings.xpAdept,
            xpExpert: settings.xpExpert,
            xpMaster: settings.xpMaster,
            // XP caps
            xpCapAny: settings.xpCapAny,
            xpCapSchool: settings.xpCapSchool,
            xpCapDirect: settings.xpCapDirect,
            // Learning mode
            learningMode: settings.learningMode,
            // Progressive reveal
            revealName: settings.revealName,
            revealEffects: settings.revealEffects,
            revealDescription: settings.revealDescription,
            // Discovery mode
            discoveryMode: settings.discoveryMode,
            showRootSpellNames: settings.showRootSpellNames,
            // Early spell learning (copy entire object)
            earlySpellLearning: Object.assign({}, settings.earlySpellLearning),
            // Spell tome learning (copy entire object)
            spellTomeLearning: Object.assign({}, settings.spellTomeLearning)
        }
    };
    
    settings.activeProfile = name;
    settings.profileModified = false;
    
    updateProfileDropdown();
    updateProfileDescription();
    updateProfileModifiedBadge();
    updateCustomProfilesUI();
    
    // Update select to show new profile
    var profileSelect = document.getElementById('difficultyProfileSelect');
    if (profileSelect) profileSelect.value = name;
    
    scheduleAutoSave();
    console.log('[SpellLearning] Custom profile saved:', name);
}

function deleteCustomProfile(name) {
    if (!customProfiles[name]) return;
    
    if (!confirm('Delete custom profile "' + name + '"?')) return;
    
    delete customProfiles[name];
    
    // If the deleted profile was active, switch to Normal
    if (settings.activeProfile === name) {
        settings.activeProfile = 'normal';
        applyProfile('normal');
    }
    
    updateProfileDropdown();
    updateCustomProfilesUI();
    scheduleAutoSave();
    console.log('[SpellLearning] Custom profile deleted:', name);
}

function updateProfileDropdown() {
    var profileSelect = document.getElementById('difficultyProfileSelect');
    if (!profileSelect) return;
    
    // Remove existing custom profile options
    var options = profileSelect.querySelectorAll('option[data-custom="true"]');
    options.forEach(function(opt) { opt.remove(); });
    
    // Add custom profiles
    var customKeys = Object.keys(customProfiles);
    if (customKeys.length > 0) {
        // Add separator
        var separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = 'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€';
        separator.setAttribute('data-custom', 'true');
        profileSelect.appendChild(separator);
        
        // Add custom profiles
        customKeys.forEach(function(key) {
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = customProfiles[key].name;
            opt.setAttribute('data-custom', 'true');
            profileSelect.appendChild(opt);
        });
    }
}

function updateProfileDescription() {
    var descEl = document.getElementById('profileDescription');
    if (!descEl) return;
    
    var profile = DIFFICULTY_PROFILES[settings.activeProfile] || customProfiles[settings.activeProfile];
    if (profile) {
        descEl.textContent = profile.description;
    } else {
        descEl.textContent = '';
    }
}

function updateProfileModifiedBadge() {
    var badge = document.getElementById('profileModifiedBadge');
    if (!badge) return;
    
    var isModified = checkProfileModified();
    settings.profileModified = isModified;
    badge.classList.toggle('hidden', !isModified);
}

function checkProfileModified() {
    var profile = DIFFICULTY_PROFILES[settings.activeProfile] || customProfiles[settings.activeProfile];
    if (!profile) return false;
    
    var ps = profile.settings;
    
    // Helper to safely compare values (handle undefined in profile)
    function differs(current, profileVal, defaultVal) {
        var expected = profileVal !== undefined ? profileVal : defaultVal;
        return current !== expected;
    }
    
    // Check XP multipliers and tier requirements
    if (differs(settings.xpGlobalMultiplier, ps.xpGlobalMultiplier, 1) ||
        differs(settings.xpMultiplierDirect, ps.xpMultiplierDirect, 100) ||
        differs(settings.xpMultiplierSchool, ps.xpMultiplierSchool, 50) ||
        differs(settings.xpMultiplierAny, ps.xpMultiplierAny, 10) ||
        differs(settings.xpNovice, ps.xpNovice, 100) ||
        differs(settings.xpApprentice, ps.xpApprentice, 200) ||
        differs(settings.xpAdept, ps.xpAdept, 400) ||
        differs(settings.xpExpert, ps.xpExpert, 800) ||
        differs(settings.xpMaster, ps.xpMaster, 1500)) {
        return true;
    }
    
    // Check XP caps
    if (differs(settings.xpCapAny, ps.xpCapAny, 5) ||
        differs(settings.xpCapSchool, ps.xpCapSchool, 15) ||
        differs(settings.xpCapDirect, ps.xpCapDirect, 50)) {
        return true;
    }
    
    // Check learning mode
    if (differs(settings.learningMode, ps.learningMode, 'perSchool')) {
        return true;
    }
    
    // Check reveal thresholds
    if (differs(settings.revealName, ps.revealName, 10) ||
        differs(settings.revealEffects, ps.revealEffects, 25) ||
        differs(settings.revealDescription, ps.revealDescription, 50)) {
        return true;
    }
    
    // Check early spell learning settings
    if (ps.earlySpellLearning && settings.earlySpellLearning) {
        var el = settings.earlySpellLearning;
        var pel = ps.earlySpellLearning;
        if (differs(el.enabled, pel.enabled, true) ||
            differs(el.unlockThreshold, pel.unlockThreshold, 25) ||
            differs(el.minEffectiveness, pel.minEffectiveness, 20) ||
            differs(el.maxEffectiveness, pel.maxEffectiveness, 70) ||
            differs(el.selfCastRequiredAt, pel.selfCastRequiredAt, 75) ||
            differs(el.selfCastXPMultiplier, pel.selfCastXPMultiplier, 150) ||
            differs(el.binaryEffectThreshold, pel.binaryEffectThreshold, 80)) {
            return true;
        }
    }
    
    // Check spell tome learning settings
    if (ps.spellTomeLearning && settings.spellTomeLearning) {
        var stl = settings.spellTomeLearning;
        var pstl = ps.spellTomeLearning;
        if (differs(stl.enabled, pstl.enabled, true) ||
            differs(stl.useProgressionSystem, pstl.useProgressionSystem, true) ||
            differs(stl.grantXPOnRead, pstl.grantXPOnRead, true) ||
            differs(stl.autoSetLearningTarget, pstl.autoSetLearningTarget, true) ||
            differs(stl.xpPercentToGrant, pstl.xpPercentToGrant, 25) ||
            differs(stl.tomeInventoryBoost, pstl.tomeInventoryBoost, true) ||
            differs(stl.tomeInventoryBoostPercent, pstl.tomeInventoryBoostPercent, 25) ||
            differs(stl.requirePrereqs, pstl.requirePrereqs, true) ||
            differs(stl.requireAllPrereqs, pstl.requireAllPrereqs, true) ||
            differs(stl.requireSkillLevel, pstl.requireSkillLevel, false)) {
            return true;
        }
    }
    
    return false;
}

function updateCustomProfilesUI() {
    var section = document.getElementById('customProfilesSection');
    var list = document.getElementById('customProfilesList');
    if (!section || !list) return;
    
    var customKeys = Object.keys(customProfiles);
    if (customKeys.length === 0) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    list.innerHTML = '';
    
    customKeys.forEach(function(key) {
        var chip = document.createElement('div');
        chip.className = 'custom-profile-chip';
        if (settings.activeProfile === key) {
            chip.classList.add('active');
        }
        
        var nameSpan = document.createElement('span');
        nameSpan.textContent = customProfiles[key].name;
        nameSpan.addEventListener('click', function() {
            var profileSelect = document.getElementById('difficultyProfileSelect');
            if (profileSelect) profileSelect.value = key;
            applyProfile(key);
        });
        
        var deleteBtn = document.createElement('span');
        deleteBtn.className = 'custom-profile-delete';
        deleteBtn.textContent = 'Ã—';
        deleteBtn.title = 'Delete this profile';
        deleteBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            deleteCustomProfile(key);
        });
        
        chip.appendChild(nameSpan);
        chip.appendChild(deleteBtn);
        list.appendChild(chip);
    });
}

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
    revealSliders.forEach(function(cfg) {
        var slider = document.getElementById(cfg.sliderId);
        var valueEl = document.getElementById(cfg.valueId);
        if (slider) {
            slider.value = cfg.setting;
            updateSliderFill(slider);
            if (valueEl) valueEl.textContent = cfg.setting + '%';
        }
    });
    
    // XP caps
    var xpCapAnySlider = document.getElementById('xpCapAnySlider');
    var xpCapAnyValue = document.getElementById('xpCapAnyValue');
    if (xpCapAnySlider) {
        xpCapAnySlider.value = settings.xpCapAny;
        updateSliderFill(xpCapAnySlider);
        if (xpCapAnyValue) xpCapAnyValue.textContent = settings.xpCapAny + '%';
    }
    
    var xpCapSchoolSlider = document.getElementById('xpCapSchoolSlider');
    var xpCapSchoolValue = document.getElementById('xpCapSchoolValue');
    if (xpCapSchoolSlider) {
        xpCapSchoolSlider.value = settings.xpCapSchool;
        updateSliderFill(xpCapSchoolSlider);
        if (xpCapSchoolValue) xpCapSchoolValue.textContent = settings.xpCapSchool + '%';
    }
    
    var xpCapDirectSlider = document.getElementById('xpCapDirectSlider');
    var xpCapDirectValue = document.getElementById('xpCapDirectValue');
    if (xpCapDirectSlider) {
        xpCapDirectSlider.value = settings.xpCapDirect;
        updateSliderFill(xpCapDirectSlider);
        if (xpCapDirectValue) xpCapDirectValue.textContent = settings.xpCapDirect + '%';
    }
    
    // Learning mode select
    var learningModeSelect = document.getElementById('learningModeSelect');
    if (learningModeSelect) {
        learningModeSelect.value = settings.learningMode;
    }
    
    // Update spell tome learning UI if function exists
    if (typeof updateSpellTomeLearningUI === 'function') {
        updateSpellTomeLearningUI();
    }
}

// Mark profile as modified when settings change
function onProgressionSettingChanged() {
    updateProfileModifiedBadge();
}

// Clear tree data for a fresh start
function clearTree() {
    console.log('[SpellLearning] Clearing tree data');
    
    // Clear state - prevent memory leaks from large data structures
    state.treeData = null;
    state.selectedNode = null;
    state.spellInfoCache = {};
    state.learningTargets = {};
    // Note: Don't clear spellProgress here - that's player save data
    
    // Clear the renderer (also clears its internal caches)
    if (typeof SmartRenderer !== 'undefined') {
        SmartRenderer.clear();
    } else if (typeof WheelRenderer !== 'undefined') {
        WheelRenderer.clear();
    }
    
    // Show empty state
    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.remove('hidden');
    
    // Hide tree actions
    var treeActions = document.getElementById('tree-actions');
    if (treeActions) treeActions.classList.add('hidden');
    
    // Hide details panel
    var detailsPanel = document.getElementById('details-panel');
    if (detailsPanel) detailsPanel.classList.add('hidden');
    
    // Reset counts
    document.getElementById('total-count').textContent = '0';
    document.getElementById('unlocked-count').textContent = '0';
    
    setTreeStatus('Tree cleared - ready for new generation');
}

// Export clearTree to window for access from other modules
window.clearTree = clearTree;