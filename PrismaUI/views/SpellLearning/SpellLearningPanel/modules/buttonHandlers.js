/**
 * Button Handlers Module
 * Handles click events for major UI buttons
 * 
 * Depends on:
 * - modules/state.js (state, settings)
 * - modules/treeParser.js (TreeParser)
 * - modules/wheelRenderer.js (WheelRenderer)
 * - modules/uiHelpers.js (updateStatus, setStatusIcon)
 * - modules/spellCache.js (SpellCache)
 * 
 * Exports (global):
 * - initializeButtonHandlers()
 * - onScanSpells()
 * - onLearnSpell()
 * - onUnlockSpell()
 * - onResetProgress()
 * - onExportTree()
 * - onImportTree()
 */

// =============================================================================
// BUTTON HANDLERS
// =============================================================================

function onScanClick() {
    console.log('[SpellLearning] Scan button clicked');
    startScan(false);
}

function onFullAutoClick() {
    console.log('[SpellLearning] Full Auto button clicked');
    
    // Check if API key is configured
    if (!state.llmConfig.apiKey || state.llmConfig.apiKey.length < 10) {
        updateStatus(t('status.configureApiKey'));
        setStatusIcon('X');
        // Flash the settings button
        var settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
            settingsBtn.style.animation = 'pulse 0.5s ease-in-out 3';
            setTimeout(function() { settingsBtn.style.animation = ''; }, 1500);
        }
        return;
    }
    
    // Disable both buttons during full auto
    var scanBtn = document.getElementById('scanBtn');
    var fullAutoBtn = document.getElementById('fullAutoBtn');
    if (scanBtn) scanBtn.disabled = true;
    if (fullAutoBtn) fullAutoBtn.disabled = true;
    if (fullAutoBtn) fullAutoBtn.innerHTML = '<span class="btn-icon">â³</span> Working...';
    
    // Start scan with auto-generate flag
    startScan(true);
}

function startScan(autoGenerate) {
    state.fullAutoMode = autoGenerate;

    // Always scan ALL spells - tome toggle is a client-side filter for primed count
    var statusMsg = 'Scanning all spells...';
    if (autoGenerate) {
        statusMsg = 'Step 1/3: ' + statusMsg;
    }

    updateStatus(statusMsg);
    setStatusIcon('...');
    if (typeof updateScanStatus === 'function') updateScanStatus(statusMsg, 'working');

    var scanBtn = document.getElementById('scanBtn');
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.textContent = t('status.scanning');
    }

    // Always include plugin field — needed for whitelist filtering even if user preset doesn't show it
    var scanFields = {};
    for (var key in state.fields) { scanFields[key] = state.fields[key]; }
    scanFields.plugin = true;

    var scanConfig = {
        fields: scanFields,
        treeRulesPrompt: getTreeRulesPrompt(),
        scanMode: 'all'
    };

    if (window.callCpp) {
        window.callCpp('ScanSpells', JSON.stringify(scanConfig));
    } else {
        console.warn('[SpellLearning] C++ bridge not ready, using mock data');
        setTimeout(function() {
            var mockData = {
                scanTimestamp: new Date().toISOString(),
                scanMode: 'all_spells',
                spellCount: 3,
                treeRulesPrompt: getTreeRulesPrompt(),
                spells: [
                    { formId: '0x00012FCD', name: 'Flames', school: 'Destruction', skillLevel: 'Novice' },
                    { formId: '0x00012FCE', name: 'Healing', school: 'Restoration', skillLevel: 'Novice' },
                    { formId: '0x00012FCF', name: 'Oakflesh', school: 'Alteration', skillLevel: 'Novice' }
                ]
            };
            updateSpellData(JSON.stringify(mockData));
        }, 500);
    }
}

function onSaveClick() {
    var outputAreaEl = document.getElementById('outputArea');
    var content = outputAreaEl ? outputAreaEl.value : '';
    
    if (!content || content.trim().length === 0) {
        updateStatus(t('status.nothingToExport'));
        setStatusIcon('!');
        if (typeof updateScanStatus === 'function') updateScanStatus(t('status.nothingToExport'), 'error');
        return;
    }

    if (window.callCpp) {
        if (typeof updateScanStatus === 'function') updateScanStatus(t('status.exportingScanData'), 'working');
        window.callCpp('SaveOutput', content);
            } else {
        updateStatus(t('status.cannotSaveNoBridge'));
        setStatusIcon('X');
    }
}

function onSaveBySchoolClick() {
    var outputAreaEl = document.getElementById('outputArea');
    var content = outputAreaEl ? outputAreaEl.value : '';
    
    if (!content || content.trim().length === 0) {
        updateStatus(t('status.nothingToSave'));
        setStatusIcon('!');
        return;
    }
    
    try {
        // Parse the JSON to extract spell data
        var data = JSON.parse(content);
        
        if (!data.spells || !Array.isArray(data.spells)) {
            updateStatus(t('status.invalidSpellDataFormat'));
            setStatusIcon('X');
            return;
        }
        
        // Get the prompt/rules from the data
        var basePrompt = data.llmPrompt || '';
        
        // Group spells by school
        var schoolSpells = {
            'Alteration': [],
            'Conjuration': [],
            'Destruction': [],
            'Illusion': [],
            'Restoration': []
        };
        
        data.spells.forEach(function(spell) {
            if (spell.school && schoolSpells[spell.school]) {
                schoolSpells[spell.school].push(spell);
            }
        });
        
        // Create output for each school
        var schools = Object.keys(schoolSpells);
        var schoolOutputs = {};
        
        schools.forEach(function(school) {
            var spells = schoolSpells[school];
            if (spells.length === 0) return;
            
            // Create school-specific prompt
            var schoolPrompt = basePrompt + '\n\n';
            schoolPrompt += '## SCHOOL: ' + school.toUpperCase() + ' ONLY\n';
            schoolPrompt += 'You are creating the tree for ' + school + ' school ONLY.\n';
            schoolPrompt += 'Total ' + school + ' spells: ' + spells.length + '\n\n';
            schoolPrompt += 'Return JSON with ONLY the ' + school + ' school:\n';
            schoolPrompt += '{\n  "version": "1.0",\n  "schools": {\n    "' + school + '": {\n      "root": "0xFORMID",\n      "nodes": [...]\n    }\n  }\n}\n\n';
            
            var schoolOutput = {
                llmPrompt: schoolPrompt,
                scanTimestamp: data.scanTimestamp,
                school: school,
                spellCount: spells.length,
                spells: spells
            };
            
            schoolOutputs[school] = JSON.stringify(schoolOutput, null, 2);
        });
        
        // Send to C++ to save all school files
        if (window.callCpp) {
            window.callCpp('SaveOutputBySchool', JSON.stringify(schoolOutputs));
            updateStatus(t('status.savingSchoolFiles', {count: schools.length}));
            setStatusIcon('[S]');
        } else {
            updateStatus('Cannot save - C++ bridge not ready');
            setStatusIcon('X');
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse spell data:', e);
        updateStatus(t('status.failedParseSpellData'));
        setStatusIcon('X');
    }
}

function onCopyClick() {
    var outputArea = document.getElementById('outputArea');
    var content = outputArea ? outputArea.value : '';
    
    if (!content || content.trim().length === 0) {
        updateStatus(t('status.nothingToCopy'));
        setStatusIcon('!');
        return;
    }
    
    // Use C++ to copy to Windows clipboard
    if (window.callCpp) {
        window.callCpp('CopyToClipboard', content);
        updateStatus(t('status.copiedClipboard'));
        setStatusIcon('X');
    } else {
        // Fallback for browser testing
        try {
            outputArea.select();
            document.execCommand('copy');
            updateStatus(t('status.copiedToClipboard'));
            setStatusIcon('X');
            setTimeout(function() { outputArea.setSelectionRange(0, 0); }, 100);
        } catch (e) {
            console.error('[SpellLearning] Copy failed:', e);
            updateStatus('Copy failed');
            setStatusIcon('X');
        }
    }
}

function onPasteClick() {
    // Request clipboard content from C++
    if (window.callCpp) {
        state.pasteTarget = 'outputArea';
        window.callCpp('GetClipboard', '');
        updateStatus(t('status.readingClipboard'));
    } else {
        updateStatus(t('status.pasteNotAvailable'));
        setStatusIcon('!');
    }
}

function onPasteTreeClick() {
    // Request clipboard content from C++ for tree import
    if (window.callCpp) {
        state.pasteTarget = 'import-textarea';
        window.callCpp('GetClipboard', '');
    } else {
        showImportError('Paste not available - C++ bridge required');
    }
}

function onCloseClick() {
    // Auto-save settings when close is requested
    autoSaveSettings();
    
    // Actually close the panel via C++
    if (window.callCpp) {
        window.callCpp('HidePanel', '');
    } else {
        updateStatus(t('status.pressHotkeyToClose'));
    }
}

// Called when panel is about to be hidden (from C++)
window.onPanelHiding = function() {
    // Auto-save settings when panel is closed
    autoSaveSettings();
};

function toggleMinimize() {
    var panel = document.getElementById('spellPanel');
    state.isMinimized = !state.isMinimized;
    panel.classList.toggle('minimized', state.isMinimized);
    
    var btn = document.getElementById('minimizeBtn');
    btn.textContent = state.isMinimized ? 'â–¡' : 'â”€';
}

