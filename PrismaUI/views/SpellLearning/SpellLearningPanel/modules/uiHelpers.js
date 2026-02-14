/**
 * SpellLearning UI Helpers Module
 * 
 * Contains utility functions for status updates, presets, dragging, resizing.
 * Depends on: state.js
 */

// =============================================================================
// STATUS UPDATES
// =============================================================================

function updateStatus(message) {
    var statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = message;
    }
    // Also update scan page feedback bar
    updateScanStatus(message);
}

function updateScanStatus(message, type) {
    var bar = document.getElementById('scanStatusBar');
    var text = document.getElementById('scanStatusText');
    if (!bar || !text) return;
    text.textContent = message;
    bar.className = 'scan-status-bar';
    if (type) bar.classList.add(type);
}

function setStatusIcon(icon) {
    var statusIcon = document.getElementById('statusIcon');
    if (statusIcon) {
        statusIcon.textContent = icon;
    }
}

function updateCharCount() {
    var outputArea = document.getElementById('outputArea');
    var charCount = document.getElementById('charCount');
    if (outputArea && charCount) {
        charCount.textContent = outputArea.value.length + ' chars';
    }
}

function setTreeStatus(msg) {
    var el = document.getElementById('tree-status-text');
    if (el) el.textContent = msg;
}

// =============================================================================
// FIELD PRESETS
// =============================================================================

function applyPreset(presetName) {
    var presets = {
        minimal: {
            editorId: false, magickaCost: false, minimumSkill: false,
            castingType: false, delivery: false, chargeTime: false,
            plugin: false, effects: false, effectNames: false, keywords: false
        },
        balanced: {
            editorId: true, magickaCost: true, minimumSkill: false,
            castingType: false, delivery: false, chargeTime: false,
            plugin: false, effects: false, effectNames: false, keywords: false
        },
        full: {
            editorId: true, magickaCost: true, minimumSkill: true,
            castingType: true, delivery: true, chargeTime: true,
            plugin: true, effects: true, effectNames: false, keywords: true
        }
    };
    
    var preset = presets[presetName];
    if (!preset) return;
    
    for (var field in preset) {
        state.fields[field] = preset[field];
        var checkbox = document.getElementById('field_' + field);
        if (checkbox) checkbox.checked = preset[field];
    }
}

// =============================================================================
// DRAGGING
// =============================================================================

function initializeDragging() {
    var header = document.getElementById('panelHeader');
    var panel = document.getElementById('spellPanel');
    
    var offsetX = 0, offsetY = 0;
    
    header.addEventListener('mousedown', function(e) {
        if (e.target.closest('.header-btn')) return;
        
        state.isDragging = true;
        var rect = panel.getBoundingClientRect();
        offsetX = e.clientX - rect.left - rect.width / 2;
        offsetY = e.clientY - rect.top - rect.height / 2;
        panel.style.transition = 'none';
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!state.isDragging) return;
        
        var x = e.clientX - offsetX;
        var y = e.clientY - offsetY;
        
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.transform = 'translate(-50%, -50%)';
    });
    
    document.addEventListener('mouseup', function() {
        if (state.isDragging) {
            state.isDragging = false;
            panel.style.transition = '';
            
            // Save position
            var rect = panel.getBoundingClientRect();
            settings.windowX = rect.left + rect.width / 2;
            settings.windowY = rect.top + rect.height / 2;
            if (typeof autoSaveSettings === 'function') autoSaveSettings();
        }
    });
}

// =============================================================================
// RESIZING
// =============================================================================

function initializeResizing() {
    var handle = document.getElementById('resizeHandle');
    var panel = document.getElementById('spellPanel');
    
    var startWidth, startHeight, startX, startY;
    
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        state.isResizing = true;
        
        var rect = panel.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startX = e.clientX;
        startY = e.clientY;
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!state.isResizing) return;
        
        var newWidth = startWidth + (e.clientX - startX);
        var newHeight = startHeight + (e.clientY - startY);
        
        // Apply constraints
        newWidth = Math.max(500, Math.min(window.innerWidth * 0.95, newWidth));
        newHeight = Math.max(500, Math.min(window.innerHeight * 0.9, newHeight));
        
        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';
    });
    
    document.addEventListener('mouseup', function() {
        if (state.isResizing) {
            state.isResizing = false;
            
            // Save size
            var rect = panel.getBoundingClientRect();
            settings.windowWidth = rect.width;
            settings.windowHeight = rect.height;
            if (typeof autoSaveSettings === 'function') autoSaveSettings();
        }
    });
}

// =============================================================================
// MINIMIZE & CLOSE
// =============================================================================

function toggleMinimize() {
    var panel = document.getElementById('spellPanel');
    state.isMinimized = !state.isMinimized;
    panel.classList.toggle('minimized', state.isMinimized);
    
    var btn = document.getElementById('minimizeBtn');
    btn.textContent = state.isMinimized ? '□' : '─';
}

function onCloseClick() {
    // Auto-save settings when closing
    if (typeof autoSaveSettings === 'function') autoSaveSettings();
    
    // Actually close the panel via C++
    if (window.callCpp) {
        window.callCpp('HidePanel', '');
    } else {
        updateStatus('Press F9 to close');
    }
}

// =============================================================================
// LOCAL FORM ID — strips load-order prefix for stable cross-session matching
// =============================================================================

/**
 * Extract the local (plugin-relative) formId from a full runtime formId.
 * Regular plugins: 0xXXyyyyyy → yyyyyy (strip top byte)
 * ESL/light plugins: 0xFExxxyyyy → yyyy (strip FE + light index, keep low 12 bits)
 * Returns lowercase hex string without 0x prefix.
 */
function getLocalFormId(formIdStr) {
    if (!formIdStr) return '';
    // Remove 0x prefix if present
    var hex = formIdStr.replace(/^0x/i, '').toLowerCase();
    // Pad to 8 chars
    while (hex.length < 8) hex = '0' + hex;
    // ESL: top byte is FE → local ID is the last 3 hex chars (12 bits)
    if (hex.substring(0, 2) === 'fe') {
        return hex.substring(5); // last 3 hex chars
    }
    // Regular: strip top byte → last 6 hex chars (24 bits)
    return hex.substring(2);
}

/**
 * Build a stable blacklist key from plugin + localFormId.
 * This key survives load order changes.
 */
function blacklistKey(plugin, formId) {
    return (plugin || '').toLowerCase() + ':' + getLocalFormId(formId);
}

// =============================================================================
// PRIMED SPELL FILTERING (after blacklist/whitelist/tome filters)
// =============================================================================

/**
 * Get all primed spells (post-blacklist/whitelist/tome filtering).
 * @returns {Array} Filtered spell objects from state.lastSpellData
 */
function getPrimedSpells() {
    var data = state.lastSpellData;
    if (!data || !data.spells || data.spells.length === 0) return [];

    // Build blacklist lookup — use stable plugin:localFormId keys, fall back to raw formId
    var blacklistKeys = {};
    var blacklistFormIds = {};
    if (settings.spellBlacklist) {
        settings.spellBlacklist.forEach(function(entry) {
            if (entry.plugin && entry.localFormId) {
                blacklistKeys[entry.plugin.toLowerCase() + ':' + entry.localFormId] = true;
            } else if (entry.formId) {
                blacklistFormIds[entry.formId] = true;
            }
        });
    }

    // Build whitelist lookup (case-insensitive) - only filter if whitelist has enabled entries
    var whitelistActive = false;
    var whitelistPlugins = {};
    if (settings.pluginWhitelist && settings.pluginWhitelist.length > 0) {
        settings.pluginWhitelist.forEach(function(entry) {
            if (entry.enabled) {
                whitelistActive = true;
                whitelistPlugins[entry.plugin.toLowerCase()] = true;
            }
        });
    }

    // Check tome filter
    var tomeToggle = document.getElementById('scanModeTomes');
    var tomesOn = tomeToggle && tomeToggle.checked;
    var tomedIds = state.tomedSpellIds || null;

    return data.spells.filter(function(spell) {
        var stableKey = spell.plugin ? spell.plugin.toLowerCase() + ':' + getLocalFormId(spell.formId) : '';
        if (stableKey && blacklistKeys[stableKey]) return false;
        if (blacklistFormIds[spell.formId]) return false;
        if (whitelistActive && spell.plugin && !whitelistPlugins[spell.plugin.toLowerCase()]) return false;
        if (tomesOn && tomedIds && !tomedIds[spell.formId]) return false;
        return true;
    });
}

/**
 * Get primed spells filtered to a specific school.
 * @param {string} school - School name (e.g. "Destruction")
 * @returns {Array} Filtered spell objects for that school
 */
function getPrimedSpellsForSchool(school) {
    return getPrimedSpells().filter(function(s) {
        return (s.school || 'Unknown') === school;
    });
}

function updatePrimedCount() {
    var primed = getPrimedSpells();

    var el = document.getElementById('statPrimedSpells');
    if (el) el.textContent = primed.length;

    // Update school breakdown to reflect filtered (primed) counts
    var schoolCounts = {};
    primed.forEach(function(s) {
        var sch = s.school || 'Unknown';
        schoolCounts[sch] = (schoolCounts[sch] || 0) + 1;
    });

    var breakdownEl = document.getElementById('scanSchoolBreakdown');
    if (breakdownEl) {
        var schoolColors = {
            'Destruction': 'var(--destruction)',
            'Restoration': 'var(--restoration)',
            'Alteration': 'var(--alteration)',
            'Conjuration': 'var(--conjuration)',
            'Illusion': 'var(--illusion)'
        };
        var html = '';
        var sortedSchools = Object.keys(schoolCounts).sort(function(a, b) {
            return schoolCounts[b] - schoolCounts[a];
        });
        sortedSchools.forEach(function(school) {
            var color = schoolColors[school] || 'var(--text-muted)';
            html += '<div class="scan-school-row">' +
                '<span class="scan-school-dot" style="background:' + color + '"></span>' +
                '<span class="scan-school-name">' + school + '</span>' +
                '<span class="scan-school-count">' + schoolCounts[school] + '</span>' +
                '</div>';
        });
        breakdownEl.innerHTML = html;
    }
}

// =============================================================================
// PRESET NAME PROMPT (replaces native prompt() which doesn't work in Ultralight)
// =============================================================================

/**
 * Show an in-page modal to ask the user for a preset name.
 * @param {string} title  - Modal title (e.g. "Save Scanner Preset")
 * @param {Function} onConfirm - Called with the trimmed name string
 */
function showPresetNamePrompt(title, onConfirm) {
    var modal = document.getElementById('preset-name-modal');
    var titleEl = document.getElementById('preset-name-title');
    var input = document.getElementById('preset-name-input');
    var confirmBtn = document.getElementById('preset-name-confirm');
    var cancelBtn = document.getElementById('preset-name-cancel');
    var closeBtn = document.getElementById('preset-name-close');
    var backdrop = modal ? modal.querySelector('.modal-backdrop') : null;

    if (!modal || !input) {
        console.warn('[PresetPrompt] Modal elements not found');
        return;
    }

    titleEl.textContent = title || 'Save Preset';
    input.value = '';
    modal.classList.remove('hidden');

    // Focus input after brief delay for animation
    setTimeout(function() { input.focus(); }, 50);

    function cleanup() {
        modal.classList.add('hidden');
        confirmBtn.removeEventListener('click', onSave);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKeydown);
    }

    function onSave() {
        var name = input.value.trim();
        if (!name) return;
        cleanup();
        onConfirm(name);
    }

    function onCancel() {
        cleanup();
    }

    function onKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            onSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    }

    confirmBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    if (backdrop) backdrop.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
}

// =============================================================================
// PRESET FILE I/O — Shared callback from C++ preset handlers
// =============================================================================

/**
 * Case-insensitive lookup for a preset key in a presets object.
 * Returns the actual key if found, or null.
 */
function _findPresetKeyCaseInsensitive(presetsObj, name) {
    if (!name || !presetsObj) return null;
    if (presetsObj[name]) return name;
    var lowerName = name.toLowerCase();
    for (var key in presetsObj) {
        if (presetsObj.hasOwnProperty(key) && key.toLowerCase() === lowerName) return key;
    }
    return null;
}

/**
 * Callback invoked by C++ OnLoadPresets.
 * Receives JSON: { type: "scanner"|"settings", presets: [{ key, data }, ...] }
 * Dispatches to the appropriate preset module to populate its in-memory store.
 */
window.onPresetsLoaded = function(resultStr) {
    try {
        var result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
        var type = result.type;
        var presets = result.presets || [];

        var logMsg = '[Presets] onPresetsLoaded: type=' + type + ', count=' + presets.length;
        console.log(logMsg);
        if (window.callCpp) {
            try { window.callCpp('LogMessage', JSON.stringify({ level: 'info', message: logMsg })); } catch(e) {}
        }

        if (type === 'scanner') {
            // Clear and repopulate
            for (var k in scannerPresets) {
                if (scannerPresets.hasOwnProperty(k)) delete scannerPresets[k];
            }
            for (var i = 0; i < presets.length; i++) {
                var entry = presets[i];
                scannerPresets[entry.key] = entry.data;
                console.log('[Presets] Scanner preset loaded: key=' + entry.key);
            }
            if (typeof updateScannerPresetsUI === 'function') {
                updateScannerPresetsUI();
            }
            // Auto-apply saved scanner preset (or "Default" fallback)
            var scannerTarget = (typeof _activeScannerPreset !== 'undefined') ? _activeScannerPreset : '';
            var scannerKey = _findPresetKeyCaseInsensitive(scannerPresets, scannerTarget)
                          || _findPresetKeyCaseInsensitive(scannerPresets, 'Default');
            var applyLog = '[Presets] Scanner apply: target=' + scannerTarget + ', found=' + scannerKey +
                           ', applyScannerPreset=' + (typeof applyScannerPreset);
            console.log(applyLog);
            if (window.callCpp) {
                try { window.callCpp('LogMessage', JSON.stringify({ level: 'info', message: applyLog })); } catch(e) {}
            }
            if (scannerKey && typeof applyScannerPreset === 'function') {
                console.log('[Presets] Auto-applying scanner preset: ' + scannerKey);
                applyScannerPreset(scannerKey);
            }
            // Sync Easy Mode chip selection
            if (typeof _easySelectedPreset !== 'undefined' && typeof _activeScannerPreset !== 'undefined') {
                _easySelectedPreset = _activeScannerPreset || scannerKey || '';
                if (typeof updateEasyPresetChips === 'function') updateEasyPresetChips();
            }
        } else if (type === 'settings') {
            // Clear and repopulate
            for (var k2 in settingsPresets) {
                if (settingsPresets.hasOwnProperty(k2)) delete settingsPresets[k2];
            }
            for (var j = 0; j < presets.length; j++) {
                var entry2 = presets[j];
                settingsPresets[entry2.key] = entry2.data;
            }
            // Built-in seeding removed — presets come exclusively from files on disk.
            // DEFAULT.json is bundled with the mod in the RELEASE folder.
            if (typeof updateSettingsPresetsUI === 'function') {
                updateSettingsPresetsUI();
            }
            // Track active preset name for UI highlighting, but do NOT auto-apply.
            // config.json is the source of truth — applying a preset here would
            // overwrite the user's saved settings (discoveryMode, requireSkillLevel, etc.)
            var settingsTarget = (typeof _activeSettingsPreset !== 'undefined') ? _activeSettingsPreset : '';
            var settingsKey = _findPresetKeyCaseInsensitive(settingsPresets, settingsTarget)
                           || _findPresetKeyCaseInsensitive(settingsPresets, 'Default');
            if (settingsKey) {
                _activeSettingsPreset = settingsKey;
                if (typeof updateSettingsPresetsUI === 'function') {
                    updateSettingsPresetsUI();
                }
            }
        }
    } catch (e) {
        console.error('[Presets] Failed to parse onPresetsLoaded:', e);
    }
};

// =============================================================================
// XP UTILITIES
// =============================================================================

function getXPForTier(tierName) {
    if (!tierName) return settings.xpNovice;
    
    switch (tierName.toLowerCase()) {
        case 'novice': return settings.xpNovice;
        case 'apprentice': return settings.xpApprentice;
        case 'adept': return settings.xpAdept;
        case 'expert': return settings.xpExpert;
        case 'master': return settings.xpMaster;
        default: return settings.xpNovice;
    }
}
