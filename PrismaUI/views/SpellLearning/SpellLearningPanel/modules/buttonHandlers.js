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
        updateStatus('Configure API key in Settings first!');
        setStatusIcon('X');
        // Flash the settings button
        var settingsBtn = document.getElementById('settingsBtn');
        settingsBtn.style.animation = 'pulse 0.5s ease-in-out 3';
        setTimeout(function() { settingsBtn.style.animation = ''; }, 1500);
        return;
    }
    
    // Disable both buttons during full auto
    var scanBtn = document.getElementById('scanBtn');
    var fullAutoBtn = document.getElementById('fullAutoBtn');
    scanBtn.disabled = true;
    fullAutoBtn.disabled = true;
    fullAutoBtn.innerHTML = '<span class="btn-icon">â³</span> Working...';
    
    // Start scan with auto-generate flag
    startScan(true);
}

function startScan(autoGenerate) {
    state.fullAutoMode = autoGenerate;
    
    // Check scan mode
    var useTomeMode = document.getElementById('scanModeTomes').checked;
    var statusMsg = useTomeMode ? 'Scanning spell tomes...' : 'Scanning all spells...';
    if (autoGenerate) {
        statusMsg = 'Step 1/3: ' + statusMsg;
    }
    
    updateStatus(statusMsg);
    setStatusIcon('...');
    
    var scanBtn = document.getElementById('scanBtn');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    
    var scanConfig = {
        fields: state.fields,
        treeRulesPrompt: getTreeRulesPrompt(),
        scanMode: useTomeMode ? 'tomes' : 'all'
    };
    
    if (window.callCpp) {
        window.callCpp('ScanSpells', JSON.stringify(scanConfig));
    } else {
        console.warn('[SpellLearning] C++ bridge not ready, using mock data');
        setTimeout(function() {
            var mockData = {
                scanTimestamp: new Date().toISOString(),
                scanMode: useTomeMode ? 'spell_tomes' : 'all_spells',
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
    var content = document.getElementById('outputArea').value;
    
    if (!content || content.trim().length === 0) {
        updateStatus('Nothing to save - scan spells first');
        setStatusIcon('!');
        return;
    }
    
    if (window.callCpp) {
        window.callCpp('SaveOutput', content);
            } else {
        updateStatus('Cannot save - C++ bridge not ready');
        setStatusIcon('X');
    }
}

function onSaveBySchoolClick() {
    var content = document.getElementById('outputArea').value;
    
    if (!content || content.trim().length === 0) {
        updateStatus('Nothing to save - scan spells first');
        setStatusIcon('!');
        return;
    }
    
    try {
        // Parse the JSON to extract spell data
        var data = JSON.parse(content);
        
        if (!data.spells || !Array.isArray(data.spells)) {
            updateStatus('Invalid spell data format');
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
            updateStatus('Saving ' + schools.length + ' school files...');
            setStatusIcon('[S]');
        } else {
            updateStatus('Cannot save - C++ bridge not ready');
            setStatusIcon('X');
        }
        
    } catch (e) {
        console.error('[SpellLearning] Failed to parse spell data:', e);
        updateStatus('Failed to parse spell data');
        setStatusIcon('X');
    }
}

function onCopyClick() {
    var outputArea = document.getElementById('outputArea');
    var content = outputArea.value;
    
    if (!content || content.trim().length === 0) {
        updateStatus('Nothing to copy - scan spells first');
        setStatusIcon('!');
        return;
    }
    
    // Use C++ to copy to Windows clipboard
    if (window.callCpp) {
        window.callCpp('CopyToClipboard', content);
        updateStatus('Copied to Windows clipboard!');
        setStatusIcon('X');
    } else {
        // Fallback for browser testing
        try {
            outputArea.select();
            document.execCommand('copy');
            updateStatus('Copied to clipboard!');
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
        updateStatus('Reading clipboard...');
    } else {
        updateStatus('Paste not available - C++ bridge required');
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
        updateStatus('Press hotkey to close');
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

