/**
 * Spell Learning Panel - PrismaUI Interface
 * Application Logic - Main entry point
 * 
 * This file contains application-specific initialization and UI setup.
 * All major functionality is split into 17 modules for LLM maintainability.
 * 
 * Required modules (load order in index.html):
 *  1. constants.js           -  267 lines (constants, profiles, keycodes)
 *  2. state.js               -  143 lines (settings, state objects)
 *  3. config.js              -  266 lines (tree configuration)
 *  4. spellCache.js          -  114 lines (spell data caching)
 *  5. colorUtils.js          -  258 lines (color management)
 *  6. uiHelpers.js           -  189 lines (UI utilities)
 *  7. growthDSL.js           -  301 lines (growth style DSL)
 *  8. treeParser.js          -  461 lines (tree parsing)
 *  9. wheelRenderer.js       - 1296 lines (SVG radial renderer)
 * 10. settingsPanel.js       - 1001 lines (settings UI)
 * 11. treeViewerUI.js        -  618 lines (tree viewer UI)
 * 12. progressionUI.js       -  547 lines (progression system)
 * 13. settingsPresets.js     -  settings presets (chip-based)
 * 14. cppCallbacks.js        -  438 lines (C++ SKSE callbacks)
 * 15. llmIntegration.js      -  621 lines (LLM integration)
 * 16. llmApiSettings.js      -  245 lines (API configuration)
 * 17. buttonHandlers.js      -  277 lines (button events)
 */
// =============================================================================
// GROWTH STYLE GENERATOR UI
// =============================================================================

// Store generated recipes (only if not defined by modules)
if (typeof generatedGrowthRecipes === 'undefined') {
    var generatedGrowthRecipes = {};
}

function initializeGrowthStyleGenerator() {
    var header = document.getElementById('growthStyleHeader');
    var content = document.getElementById('growthStyleContent');
    var generateBtn = document.getElementById('generateStylesBtn');
    var applyBtn = document.getElementById('applyStylesBtn');
    
    if (!header || !content) {
        console.log('[GrowthDSL] UI elements not found');
        return;
    }
    
    // Collapsible header
    header.addEventListener('click', function() {
        header.classList.toggle('collapsed');
    });
    
    // Generate styles button
    if (generateBtn) {
        generateBtn.addEventListener('click', function() {
            onGenerateGrowthStyles();
        });
    }
    
    // Apply to tree button
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            onApplyGrowthStyles();
        });
    }
    
    console.log('[GrowthDSL] UI initialized');
}

function onGenerateGrowthStyles() {
    var statusEl = document.getElementById('growthStatus');
    var applyBtn = document.getElementById('applyStylesBtn');
    var container = document.getElementById('schoolStylesContainer');
    
    // Check if we have scanned spells
    if (!state.treeData || !state.treeData.rawData || !state.treeData.rawData.schools) {
        if (statusEl) {
            statusEl.textContent = 'Scan spells first, then generate styles.';
            statusEl.className = 'growth-status error';
        }
        return;
    }
    
    // Get schools from tree data
    var schools = Object.keys(state.treeData.rawData.schools);
    if (schools.length === 0) {
        if (statusEl) {
            statusEl.textContent = 'No schools found in tree data.';
            statusEl.className = 'growth-status error';
        }
        return;
    }
    
    // Update status
    if (statusEl) {
        statusEl.textContent = 'Generating styles for ' + schools.length + ' schools...';
        statusEl.className = 'growth-status processing';
    }
    
    // Clear container
    if (container) {
        container.innerHTML = '<div class="growth-loading">Generating...</div>';
    }
    
    // Prepare school data
    var schoolData = schools.map(function(name) {
        var school = state.treeData.rawData.schools[name];
        return {
            name: name,
            spells: school ? (school.spells || []) : []
        };
    });
    
    // Generate via LLM
    generateGrowthRecipesViaLLM(schoolData, function(result) {
        generatedGrowthRecipes = result.recipes || {};
        
        if (statusEl) {
            if (result.success) {
                statusEl.textContent = 'Generated styles for all schools!';
                statusEl.className = 'growth-status success';
            } else if (result.failed && result.failed.length > 0) {
                statusEl.textContent = 'Generated styles (' + result.failed.length + ' used defaults)';
                statusEl.className = 'growth-status';
            } else {
                statusEl.textContent = 'Using default styles (no API key)';
                statusEl.className = 'growth-status';
            }
        }
        
        // Enable apply button
        if (applyBtn) {
            applyBtn.disabled = false;
        }
        
        // Display school style cards
        displaySchoolStyleCards(generatedGrowthRecipes);
    });
}

function displaySchoolStyleCards(recipes) {
    var container = document.getElementById('schoolStylesContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    var schoolNames = Object.keys(recipes);
    schoolNames.forEach(function(schoolName) {
        var recipe = recipes[schoolName];
        
        var card = document.createElement('div');
        card.className = 'school-style-card';
        card.dataset.school = schoolName;
        
        var header = document.createElement('div');
        header.className = 'school-style-header';
        
        var name = document.createElement('span');
        name.className = 'school-style-name ' + schoolName;
        name.textContent = schoolName;
        
        var actions = document.createElement('div');
        actions.className = 'school-style-actions';
        
        var detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn-icon';
        detailsBtn.title = 'Show/hide details';
        detailsBtn.textContent = '[C]';
        detailsBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            card.classList.toggle('expanded');
        });
        
        var regenerateBtn = document.createElement('button');
        regenerateBtn.className = 'btn-icon';
        regenerateBtn.title = 'Regenerate this school';
        regenerateBtn.textContent = '[R]';
        regenerateBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            regenerateSchoolStyle(schoolName);
        });
        
        actions.appendChild(detailsBtn);
        actions.appendChild(regenerateBtn);
        
        header.appendChild(name);
        header.appendChild(actions);
        
        var rationale = document.createElement('div');
        rationale.className = 'school-style-rationale';
        rationale.textContent = recipe.rationale || 'Default style';
        
        var details = document.createElement('div');
        details.className = 'school-style-details';
        details.textContent = JSON.stringify({
            volume: recipe.volume,
            growth: recipe.growth,
            modifiers: recipe.modifiers
        }, null, 1);
        
        card.appendChild(header);
        card.appendChild(rationale);
        card.appendChild(details);
        
        container.appendChild(card);
    });
}

function regenerateSchoolStyle(schoolName) {
    var statusEl = document.getElementById('growthStatus');
    if (statusEl) {
        statusEl.textContent = 'Regenerating style for ' + schoolName + '...';
        statusEl.className = 'growth-status processing';
    }
    
    // Get school data
    var spells = [];
    if (state.treeData && state.treeData.rawData && state.treeData.rawData.schools[schoolName]) {
        spells = state.treeData.rawData.schools[schoolName].spells || [];
    }
    
    generateGrowthRecipesViaLLM([{ name: schoolName, spells: spells }], function(result) {
        if (result.recipes && result.recipes[schoolName]) {
            generatedGrowthRecipes[schoolName] = result.recipes[schoolName];
            
            if (statusEl) {
                statusEl.textContent = 'Regenerated style for ' + schoolName;
                statusEl.className = 'growth-status success';
            }
            
            // Refresh display
            displaySchoolStyleCards(generatedGrowthRecipes);
        } else {
            if (statusEl) {
                statusEl.textContent = 'Failed to regenerate - using default';
                statusEl.className = 'growth-status error';
            }
        }
    });
}

function onApplyGrowthStyles() {
    if (!generatedGrowthRecipes || Object.keys(generatedGrowthRecipes).length === 0) {
        console.warn('[GrowthDSL] No recipes to apply');
        return;
    }
    
    // Apply recipes to WheelRenderer
    var applied = 0;
    for (var schoolName in generatedGrowthRecipes) {
        if (WheelRenderer.applyGrowthRecipe(schoolName, generatedGrowthRecipes[schoolName])) {
            console.log('[GrowthDSL] Stored recipe for ' + schoolName + ':', JSON.stringify(generatedGrowthRecipes[schoolName]).substring(0, 200));
            applied++;
        }
    }
    
    console.log('[GrowthDSL] Stored ' + applied + ' growth recipes, now re-laying out tree...');
    
    // RE-LAYOUT tree (not just render) - modifiers are applied during layout!
    if (state.treeData && WheelRenderer.nodes.length > 0) {
        WheelRenderer.layout();  // This applies the modifiers
        WheelRenderer.render();  // This draws the result
        setTreeStatus('Applied visual styles to tree');
        console.log('[GrowthDSL] Tree re-laid out with new recipes');
    }
    
    // Update status
    var statusEl = document.getElementById('growthStatus');
    if (statusEl) {
        statusEl.textContent = 'Applied ' + applied + ' styles to tree!';
        statusEl.className = 'growth-status success';
    }
    
    // Switch to tree tab
    switchTab('spellTree');
}

// Generate growth recipes for all schools via LLM
function generateGrowthRecipesViaLLM(schools, callback) {
    if (!schools || schools.length === 0) {
        console.warn('[GrowthDSL] No schools provided');
        if (callback) callback({ success: false, error: 'No schools' });
        return;
    }
    
    var results = {};
    var pending = schools.length;
    var failed = [];
    
    schools.forEach(function(school) {
        var schoolName = typeof school === 'string' ? school : school.name;
        var spellList = typeof school === 'object' && school.spells ? school.spells : [];
        
        var prompt = GROWTH_DSL.generateLLMPrompt(schoolName, spellList);
        
        // Call OpenRouter API
        if (state.llmConfig.apiKey) {
            callOpenRouterAPI(prompt, function(response) {
                if (response && response.success) {
                    // Try to parse the response as JSON
                    try {
                        var jsonMatch = response.content.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            var recipe = JSON.parse(jsonMatch[0]);
                            results[schoolName] = recipe;
                            console.log('[GrowthDSL] Generated recipe for ' + schoolName);
                        } else {
                            throw new Error('No JSON found in response');
                        }
                    } catch (e) {
                        console.warn('[GrowthDSL] Failed to parse recipe for ' + schoolName + ': ' + e.message);
                        failed.push(schoolName);
                        results[schoolName] = GROWTH_DSL.getDefaultRecipe(schoolName);
                    }
                } else {
                    console.warn('[GrowthDSL] LLM call failed for ' + schoolName);
                    failed.push(schoolName);
                    results[schoolName] = GROWTH_DSL.getDefaultRecipe(schoolName);
                }
                
                pending--;
                if (pending === 0) {
                    if (callback) callback({
                        success: failed.length === 0,
                        recipes: results,
                        failed: failed
                    });
                }
            });
        } else {
            // No API key - use defaults
            console.log('[GrowthDSL] No API key - using default recipe for ' + schoolName);
            results[schoolName] = GROWTH_DSL.getDefaultRecipe(schoolName);
            pending--;
            if (pending === 0) {
                if (callback) callback({
                    success: true,
                    recipes: results,
                    failed: []
                });
            }
        }
    });
}

// =============================================================================
// OPENROUTER API - Generic LLM calls
// =============================================================================

/**
 * Call OpenRouter API directly from JavaScript
 * @param {string} prompt - The prompt to send
 * @param {function} callback - Callback with {success: bool, content: string, error: string}
 */
function callOpenRouterAPI(prompt, callback) {
    var apiKey = state.llmConfig.apiKey;
    var model = state.llmConfig.model || 'anthropic/claude-3-haiku';
    var maxTokens = state.llmConfig.maxTokens || 2000;
    
    if (!apiKey || apiKey.length < 10) {
        console.warn('[OpenRouter] No API key configured');
        if (callback) callback({ success: false, error: 'No API key configured' });
        return;
    }
    
    var endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    
    var requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7
    };
    
    console.log('[OpenRouter] Calling API with model:', model);
    
    fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'https://spelllearning.skyrim.mod',
            'X-Title': 'SpellLearning Mod'
        },
        body: JSON.stringify(requestBody)
    })
    .then(function(response) {
        if (!response.ok) {
            return response.text().then(function(text) {
                throw new Error('API error ' + response.status + ': ' + text);
            });
        }
        return response.json();
    })
    .then(function(data) {
        if (data.choices && data.choices[0] && data.choices[0].message) {
            var content = data.choices[0].message.content;
            console.log('[OpenRouter] Response received, length:', content.length);
            if (callback) callback({ success: true, content: content });
        } else {
            throw new Error('Unexpected response format');
        }
    })
    .catch(function(error) {
        console.error('[OpenRouter] API call failed:', error);
        if (callback) callback({ success: false, error: error.message });
    });
}

// =============================================================================
// LLM COLOR SUGGESTION
// =============================================================================

/**
 * Suggest school colors using LLM via C++ bridge
 * @param {function} onComplete - Optional callback when done
 */
function suggestSchoolColorsWithLLM(onComplete) {
    var schools = Object.keys(settings.schoolColors);
    
    if (schools.length === 0) {
        console.log('[SpellLearning] No schools to suggest colors for');
        if (onComplete) onComplete();
        return;
    }
    
    if (!state.llmConfig.apiKey || state.llmConfig.apiKey.length < 10) {
        updateStatus('Configure API key to use LLM color suggestions');
        if (onComplete) onComplete();
        return;
    }
    
    if (!state.fullAutoMode) {
        updateStatus('Asking LLM for color suggestions...');
    }
    
    // Output to textarea for visibility
    appendToOutput('>>> REQUESTING: Color suggestions for ' + schools.length + ' schools: ' + schools.join(', '));
    
    // Simple, fast prompt - just school names, no spell data
    var prompt = 'Suggest distinct hex colors for these Skyrim magic schools on a dark UI (#0a0a0f). ' +
        'Schools: ' + schools.join(', ') + '. ' +
        'Return ONLY JSON: {"SchoolName": "#hexcolor", ...}. ' +
        'Use thematic colors (fire=red, restoration=gold, etc). All ' + schools.length + ' schools.';

    // Store callback for when response arrives
    window._colorSuggestionCallback = onComplete;
    
    // Use C++ bridge to call OpenRouter (Ultralight doesn't support fetch well)
    var request = {
        school: '_ColorSuggestion',  // Special marker
        spellData: '',
        promptRules: prompt,  // Put the full prompt in promptRules
        model: state.llmConfig.model || 'anthropic/claude-sonnet-4',
        maxTokens: state.llmConfig.maxTokens || 2000,
        apiKey: state.llmConfig.apiKey,
        isColorSuggestion: true  // Flag for C++ to handle differently
    };
    
    console.log('[SpellLearning] Sending color suggestion request via C++ bridge');
    
    // Set current school so poll handler knows this is a color suggestion
    state.llmCurrentSchool = '_ColorSuggestion';

    if (window.callCpp) {
        window.callCpp('LLMGenerate', JSON.stringify(request));
    } else {
        console.error('[SpellLearning] C++ bridge not available');
        updateStatus('Error: C++ bridge not available');
        state.llmCurrentSchool = null;
        if (onComplete) onComplete();
    }
}

/**
 * Handle color suggestion response from C++
 */
function handleColorSuggestionResponse(result) {
    var onComplete = window._colorSuggestionCallback;
    window._colorSuggestionCallback = null;
    
    if (result.success === 1 && result.response) {
        try {
            // Parse JSON from response
            var jsonMatch = result.response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found in response');
            
            var colors = JSON.parse(jsonMatch[0]);
            
            // Validate and apply
            var applied = 0;
            for (var school in colors) {
                if (settings.schoolColors.hasOwnProperty(school)) {
                    var color = colors[school];
                    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                        settings.schoolColors[school] = color;
                        applied++;
                    }
                }
            }
            
            if (applied > 0) {
                applySchoolColorsToCSS();
                updateSchoolColorPickerUI();
                autoSaveSettings();
                
                if (WheelRenderer.nodes && WheelRenderer.nodes.length > 0) {
                    WheelRenderer.render();
                }
                
                appendToOutput('<<< RECEIVED: Color suggestions - ' + applied + ' schools colored');
                
                if (!state.fullAutoMode) {
                    updateStatus('Applied LLM color suggestions for ' + applied + ' schools');
                }
                console.log('[SpellLearning] LLM suggested colors:', colors);
            } else {
                appendToOutput('<<< RECEIVED: Color suggestions - no valid colors');
                if (!state.fullAutoMode) {
                    updateStatus('LLM response did not contain valid colors');
                }
            }
        } catch (e) {
            console.error('[SpellLearning] Failed to parse LLM color suggestion:', e);
            appendToOutput('<<< ERROR: Failed to parse color response - ' + e.message);
            if (!state.fullAutoMode) {
                updateStatus('Failed to parse LLM color suggestion');
            }
        }
    } else {
        appendToOutput('<<< ERROR: Color suggestion failed - ' + (result.response || 'unknown error'));
        if (!state.fullAutoMode) {
            updateStatus('Color suggestion failed: ' + (result.response || 'unknown error'));
        }
    }
    
    // Call completion callback if provided
    if (onComplete) onComplete();
}

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('[SpellLearning] Panel initializing...');
    
    initializePanel();
    initializeTabs();
    initializePromptEditor();
    initializeDragging();
    initializeResizing();
    initializeTreeViewer();
    initializeSettings();
    initializeTextareaEnterKey();
    
    console.log('[SpellLearning] Panel initialized');
});

// Fix Enter key in textareas - allow new lines
function initializeTextareaEnterKey() {
    var textareas = document.querySelectorAll('textarea');
    textareas.forEach(function(textarea) {
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                // Allow default behavior (insert newline)
                e.stopPropagation();
                // Don't prevent default - we want the newline
            }
        });
        
        // Also handle keypress for better compatibility
        textarea.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.stopPropagation();
            }
        });
    });
    console.log('[SpellLearning] Textarea Enter key handling initialized for', textareas.length, 'textareas');
}

function initializePanel() {
    // Helper to safely add event listener (null-safe for removed elements)
    function safeAddListener(id, event, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }
    
    // Button event listeners (some may be removed during UI revamp)
    safeAddListener('scanBtn', 'click', onScanClick);
    safeAddListener('blacklistBtn', 'click', showBlacklistModal);
    safeAddListener('whitelistBtn', 'click', showWhitelistModal);
    safeAddListener('fullAutoBtn', 'click', onFullAutoClick);
    safeAddListener('proceduralPlusBtn', 'click', onProceduralPlusClick);
    safeAddListener('saveBtn', 'click', onSaveClick);

    // Tome toggle - client-side filter, triggers tome scan for IDs
    var tomeToggle = document.getElementById('scanModeTomes');
    if (tomeToggle) {
        tomeToggle.addEventListener('change', function() {
            if (this.checked) {
                // Tomes ON: request tome scan to get tomed spell IDs
                if (window.callCpp && state.lastSpellData) {
                    window.callCpp('ScanSpells', JSON.stringify({ scanMode: 'tomes', fields: { plugin: true } }));
                }
            } else {
                // Tomes OFF: clear tome filter, update primed with all spells
                state.tomedSpellIds = null;
                if (typeof updatePrimedCount === 'function') updatePrimedCount();
            }
        });
    }
    safeAddListener('saveBySchoolBtn', 'click', onSaveBySchoolClick);
    safeAddListener('copyBtn', 'click', onCopyClick);
    safeAddListener('pasteBtn', 'click', onPasteClick);
    safeAddListener('fullscreenBtn', 'click', toggleFullscreen);
    safeAddListener('minimizeBtn', 'click', toggleMinimize);
    safeAddListener('closeBtn', 'click', onCloseClick);
    safeAddListener('settingsBtn', 'click', toggleSettings);
    
    // Keyboard shortcuts - Escape and Tab close the panel
    initializeKeyboardShortcuts();
    
    // Growth Style Generator
    initializeGrowthStyleGenerator();
    
    // Tree import buttons in Spell Scan tab
    var importTreeScanBtn = document.getElementById('import-tree-scan-btn');
    var loadSavedScanBtn = document.getElementById('load-saved-scan-btn');
    if (importTreeScanBtn) {
        importTreeScanBtn.addEventListener('click', function() {
            showImportModal();
        });
    }
    if (loadSavedScanBtn) {
        loadSavedScanBtn.addEventListener('click', function() {
            loadSavedTree();
            // Switch to tree tab after loading
            switchTab('spellTree');
        });
    }
    
    // API Settings handlers
    safeAddListener('saveApiKeyBtn', 'click', onSaveApiSettings);
    safeAddListener('toggleApiKeyBtn', 'click', toggleApiKeyVisibility);
    safeAddListener('pasteApiKeyBtn', 'click', onPasteApiKey);
    safeAddListener('modelSelect', 'change', onModelChange);
    
    // Custom model handlers
    safeAddListener('pasteModelBtn', 'click', onPasteCustomModel);
    safeAddListener('clearModelBtn', 'click', onClearCustomModel);
    safeAddListener('customModelInput', 'input', onCustomModelInput);
    
    // Max tokens handler
    var maxTokensInput = document.getElementById('maxTokensInput');
    if (maxTokensInput) {
        maxTokensInput.value = state.llmConfig.maxTokens || 4096;
        maxTokensInput.addEventListener('change', function() {
            var val = parseInt(this.value) || 4096;
            val = Math.max(1000, Math.min(32000, val));
            this.value = val;
            state.llmConfig.maxTokens = val;
            console.log('[SpellLearning] Max tokens set to:', val);
            onSaveApiSettings();
        });
    }
    
    // Load API settings on init
    loadApiSettings();
    
    // Preset buttons
    safeAddListener('presetMinimal', 'click', function() { applyPreset('minimal'); });
    safeAddListener('presetBalanced', 'click', function() { applyPreset('balanced'); });
    safeAddListener('presetFull', 'click', function() { applyPreset('full'); });
    
    // Field checkbox listeners
    var fieldIds = ['editorId', 'magickaCost', 'minimumSkill', 'castingType', 'delivery', 
                    'chargeTime', 'plugin', 'effects', 'effectNames', 'keywords'];
    fieldIds.forEach(function(fieldId) {
        var checkbox = document.getElementById('field_' + fieldId);
        if (checkbox) {
            checkbox.checked = state.fields[fieldId];
            checkbox.addEventListener('change', function(e) {
                state.fields[fieldId] = e.target.checked;
                if (fieldId === 'effects' && e.target.checked) {
                    state.fields.effectNames = false;
                    var effectNamesEl = document.getElementById('field_effectNames');
                    if (effectNamesEl) effectNamesEl.checked = false;
                }
                if (fieldId === 'effectNames' && e.target.checked) {
                    state.fields.effects = false;
                    var effectsEl = document.getElementById('field_effects');
                    if (effectsEl) effectsEl.checked = false;
                }
            });
        }
    });
    
    var outputArea = document.getElementById('outputArea');
    if (outputArea) {
        outputArea.addEventListener('input', updateCharCount);
    }
    updateCharCount();
}

// =============================================================================
// FULLSCREEN TOGGLE
// =============================================================================

function toggleFullscreen() {
    var panel = document.getElementById('spellPanel');
    if (!panel) return;
    
    state.isFullscreen = !state.isFullscreen;
    panel.classList.toggle('fullscreen', state.isFullscreen);
    
    // Update fullscreen button icon
    var btn = document.getElementById('fullscreenBtn');
    if (btn) {
        btn.textContent = state.isFullscreen ? '[ ]' : '[ ]';
        btn.title = state.isFullscreen ? 'Exit Fullscreen' : 'Toggle Fullscreen';
    }
    
    // Save state
    settings.isFullscreen = state.isFullscreen;
    autoSaveSettings();
    
    // Re-render tree if on tree tab
    if (state.currentTab === 'spellTree' && WheelRenderer.svg) {
        setTimeout(function() {
            WheelRenderer.updateTransform();
        }, 100);
    }
    
    console.log('[SpellLearning] Fullscreen:', state.isFullscreen);
}

// =============================================================================
// KEYBOARD SHORTCUTS
// =============================================================================

function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Don't close if user is typing in an input/textarea
        var activeElement = document.activeElement;
        var isTyping = activeElement && (
            activeElement.tagName === 'INPUT' || 
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable
        );
        
        // Escape always closes (even when typing)
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCloseClick();
            return;
        }
        
        // Tab closes only when not typing in a field
        if (e.key === 'Tab' && !isTyping) {
            e.preventDefault();
            e.stopPropagation();
            onCloseClick();
            return;
        }
    });
    
    console.log('[SpellLearning] Keyboard shortcuts initialized (Escape/Tab to close)');
}

// =============================================================================
// TAB NAVIGATION
// =============================================================================

function initializeTabs() {
    if (state._tabsInitialized) return;
    state._tabsInitialized = true;

    // Header buttons toggle panels (Scan, Settings) over the default Spell Tree view
    var headerTabBtns = document.querySelectorAll('.header-btn[data-tab]');
    headerTabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabId = this.getAttribute('data-tab');
            // Toggle: clicking active panel button returns to tree
            if (state.currentTab === tabId) {
                switchTab('spellTree');
            } else {
                switchTab(tabId);
            }
        });
    });

    // Return button — navigates back to spell tree view
    var returnBtn = document.getElementById('returnToTreeBtn');
    if (returnBtn) {
        returnBtn.addEventListener('click', function() {
            switchTab('spellTree');
        });
    }

    // Orphan repair button
    var orphanBtn = document.getElementById('orphanRepairBtn');
    if (orphanBtn) {
        orphanBtn.addEventListener('click', function() {
            if (typeof repairOrphans !== 'function') return;
            var result = repairOrphans();
            var msg = 'Repaired: removed ' + result.removedPrereqs + ' bad prereqs, reconnected ' +
                result.reconnectedSubtrees + ' subtrees (' + result.nodesRecovered + ' nodes recovered)';
            console.log('[OrphanRepair] ' + msg);
            if (typeof updateOrphanRepairButton === 'function') {
                updateOrphanRepairButton();
            }
        });
    }
}

function switchTab(tabId) {
    // Auto-save settings when leaving settings tab
    if (state.currentTab === 'settings' && tabId !== 'settings') {
        autoSaveSettings();
    }

    state.currentTab = tabId;

    // Update header button active states
    document.querySelectorAll('.header-btn[data-tab]').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(function(content) {
        content.classList.remove('active');
    });

    // Show/hide Return button based on current tab
    var returnBtn = document.getElementById('returnToTreeBtn');
    if (returnBtn) {
        returnBtn.style.display = (tabId !== 'spellTree') ? '' : 'none';
    }

    if (tabId === 'spellScan') {
        document.getElementById('contentSpellScan').classList.add('active');
    } else if (tabId === 'spellTree') {
        document.getElementById('contentSpellTree').classList.add('active');
        // Initialize tree viewer if not done yet
        if (!state.treeInitialized) {
            initializeTreeViewer();
        }
        // Update transform on tab switch
        if (WheelRenderer.svg) {
            setTimeout(function() { WheelRenderer.updateTransform(); }, 50);
        }
    } else if (tabId === 'settings') {
        document.getElementById('contentSettings').classList.add('active');
    }
}

// =============================================================================
// PROMPT EDITOR
// =============================================================================

function initializePromptEditor() {
    var promptArea = document.getElementById('promptArea');
    if (!promptArea) {
        // Tree Rules tab removed - prompt editor not available
        // Still load prompt from C++ for internal use
        if (window.callCpp) {
            window.callCpp('LoadPrompt', '');
        }
        return;
    }
    
    var resetBtn = document.getElementById('resetPromptBtn');
    var saveBtn = document.getElementById('savePromptBtn');
    
    promptArea.value = DEFAULT_TREE_RULES;
    
    if (window.callCpp) {
        window.callCpp('LoadPrompt', '');
    }
    
    promptArea.addEventListener('input', function() {
        state.promptModified = (promptArea.value !== state.originalPrompt);
        updatePromptStatus();
    });
    
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            if (confirm('Reset tree rules to default? Your changes will be lost.')) {
                promptArea.value = DEFAULT_TREE_RULES;
                state.promptModified = true;
                updatePromptStatus();
            }
        });
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', onSavePromptClick);
    }
}

function onSavePromptClick() {
    var promptArea = document.getElementById('promptArea');
    if (!promptArea) return;
    var content = promptArea.value;
    
    if (window.callCpp) {
        window.callCpp('SavePrompt', content);
    } else {
        console.warn('[SpellLearning] C++ bridge not ready');
        setPromptStatus('Cannot save', 'error');
    }
}

function updatePromptStatus() {
    if (state.promptModified) {
        setPromptStatus('Modified', 'modified');
    } else {
        setPromptStatus('Saved', '');
    }
}

function setPromptStatus(text, className) {
    var statusEl = document.getElementById('promptStatus');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'prompt-status';
    if (className) {
        statusEl.classList.add(className);
    }
}

function getTreeRulesPrompt() {
    var promptArea = document.getElementById('promptArea');
    if (promptArea) return promptArea.value;
    // Fallback: use stored prompt or default
    return state.originalPrompt || (typeof DEFAULT_TREE_RULES !== 'undefined' ? DEFAULT_TREE_RULES : '');
}

// =============================================================================
// SETTINGS
// =============================================================================

function toggleSettings() {
    state.isSettingsOpen = !state.isSettingsOpen;
    var panel = document.getElementById('settingsPanel');
    if (panel) panel.classList.toggle('hidden', !state.isSettingsOpen);
    
    var btn = document.getElementById('settingsBtn');
    if (btn) btn.classList.toggle('active', state.isSettingsOpen);
}

// =============================================================================
// DRAGGING & RESIZING
// =============================================================================

function applyWindowPositionAndSize() {
    var panel = document.getElementById('spellPanel');
    if (!panel) return;
    
    // Apply saved size
    if (settings.windowWidth && settings.windowHeight) {
        panel.style.width = settings.windowWidth + 'px';
        panel.style.height = settings.windowHeight + 'px';
        console.log('[SpellLearning] Applied window size:', settings.windowWidth, 'x', settings.windowHeight);
    }
    
    // Apply saved position
    if (settings.windowX !== null && settings.windowY !== null) {
        panel.style.transform = 'none';
        panel.style.left = settings.windowX + 'px';
        panel.style.top = settings.windowY + 'px';
        console.log('[SpellLearning] Applied window position:', settings.windowX, settings.windowY);
    }
}

function applyFullscreenState() {
    var panel = document.getElementById('spellPanel');
    if (!panel) return;
    
    if (state.isFullscreen) {
        panel.classList.add('fullscreen');
        console.log('[SpellLearning] Applied fullscreen state: ON');
    } else {
        panel.classList.remove('fullscreen');
    }
    
    // Update fullscreen button icon
    var btn = document.getElementById('fullscreenBtn');
    if (btn) {
        btn.title = state.isFullscreen ? 'Exit Fullscreen' : 'Toggle Fullscreen';
    }
}

function initializeDragging() {
    var panel = document.getElementById('spellPanel');
    var header = document.getElementById('panelHeader');
    
    var startX, startY, initialX, initialY;
    
    header.addEventListener('mousedown', function(e) {
        if (e.target.closest('.header-btn')) return;
        
        state.isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        var rect = panel.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        
        panel.style.transform = 'none';
        panel.style.left = initialX + 'px';
        panel.style.top = initialY + 'px';
        
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onDragEnd);
    });
    
    function onDrag(e) {
        if (!state.isDragging) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        panel.style.left = (initialX + dx) + 'px';
        panel.style.top = (initialY + dy) + 'px';
    }
    
    function onDragEnd() {
        state.isDragging = false;
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', onDragEnd);
        
        // Save window position
        var rect = panel.getBoundingClientRect();
        settings.windowX = Math.round(rect.left);
        settings.windowY = Math.round(rect.top);
        console.log('[SpellLearning] Window position saved:', settings.windowX, settings.windowY);
        autoSaveSettings();
    }
}

function initializeResizing() {
    var panel = document.getElementById('spellPanel');
    var handle = document.getElementById('resizeHandle');
    
    var startX, startY, startWidth, startHeight;
    
    handle.addEventListener('mousedown', function(e) {
        state.isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = panel.offsetWidth;
        startHeight = panel.offsetHeight;
        
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', onResizeEnd);
        e.preventDefault();
    });
    
    function onResize(e) {
        if (!state.isResizing) return;
        var newWidth = Math.max(500, startWidth + (e.clientX - startX));
        var newHeight = Math.max(400, startHeight + (e.clientY - startY));
        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';
    }
    
    function onResizeEnd() {
        state.isResizing = false;
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', onResizeEnd);
        
        // Save window size
        settings.windowWidth = panel.offsetWidth;
        settings.windowHeight = panel.offsetHeight;
        console.log('[SpellLearning] Window size saved:', settings.windowWidth, 'x', settings.windowHeight);
        autoSaveSettings();
    }
}

// =============================================================================
// PASSIVE LEARNING SETTINGS
// =============================================================================

function initializePassiveLearningSettings() {
    // Enable toggle
    var enableToggle = document.getElementById('passiveLearningToggle');
    if (enableToggle) {
        enableToggle.checked = settings.passiveLearning.enabled;
        enableToggle.addEventListener('change', function() {
            settings.passiveLearning.enabled = this.checked;
            updatePassiveLearningVisibility();
            console.log('[SpellLearning] Passive learning enabled:', this.checked);
            autoSaveSettings();
        });
    }

    // Scope toggle (segmented)
    initSegmentedToggle('passiveScopeToggle', settings.passiveLearning.scope, function(value) {
        settings.passiveLearning.scope = value;
        console.log('[SpellLearning] Passive learning scope:', value);
        autoSaveSettings();
    });

    // XP per game hour slider
    var xpSlider = document.getElementById('passiveXpPerHourSlider');
    var xpValue = document.getElementById('passiveXpPerHourValue');
    if (xpSlider) {
        xpSlider.value = settings.passiveLearning.xpPerGameHour;
        if (xpValue) xpValue.textContent = settings.passiveLearning.xpPerGameHour;
        updateSliderFillGlobal(xpSlider);
        xpSlider.addEventListener('input', function() {
            var val = parseInt(this.value);
            settings.passiveLearning.xpPerGameHour = val;
            if (xpValue) xpValue.textContent = val;
            updateSliderFillGlobal(this);
            autoSaveSettings();
        });
    }

    // Max tier inputs
    var tierMap = {
        'passiveMaxNovice': 'novice',
        'passiveMaxApprentice': 'apprentice',
        'passiveMaxAdept': 'adept',
        'passiveMaxExpert': 'expert',
        'passiveMaxMaster': 'master'
    };
    for (var elId in tierMap) {
        (function(elementId, tierKey) {
            var input = document.getElementById(elementId);
            if (input) {
                input.value = settings.passiveLearning.maxByTier[tierKey];
                input.addEventListener('change', function() {
                    var val = Math.max(0, Math.min(100, parseInt(this.value) || 0));
                    this.value = val;
                    settings.passiveLearning.maxByTier[tierKey] = val;
                    console.log('[SpellLearning] Passive max ' + tierKey + ':', val);
                    autoSaveSettings();
                });
            }
        })(elId, tierMap[elId]);
    }

    // Initial visibility
    updatePassiveLearningVisibility();
    console.log('[SpellLearning] Passive learning settings initialized');
}

function updatePassiveLearningVisibility() {
    var controls = document.querySelector('.passive-learning-controls');
    if (!controls) return;
    var rows = controls.querySelectorAll('.setting-row-inline, .setting-row, .slider-row, .settings-subsection, .tier-xp-grid');
    var isEnabled = settings.passiveLearning.enabled;
    // Skip the first row (the enable toggle itself)
    for (var i = 1; i < rows.length; i++) {
        rows[i].style.opacity = isEnabled ? '1' : '0.5';
        rows[i].style.pointerEvents = isEnabled ? '' : 'none';
    }
}

function updatePassiveLearningUI() {
    var enableToggle = document.getElementById('passiveLearningToggle');
    if (enableToggle) enableToggle.checked = settings.passiveLearning.enabled;

    setSegmentedToggleValue('passiveScopeToggle', settings.passiveLearning.scope);

    var xpSlider = document.getElementById('passiveXpPerHourSlider');
    var xpValue = document.getElementById('passiveXpPerHourValue');
    if (xpSlider) {
        xpSlider.value = settings.passiveLearning.xpPerGameHour;
        if (xpValue) xpValue.textContent = settings.passiveLearning.xpPerGameHour;
        updateSliderFillGlobal(xpSlider);
    }

    var tierMap = {
        'passiveMaxNovice': 'novice',
        'passiveMaxApprentice': 'apprentice',
        'passiveMaxAdept': 'adept',
        'passiveMaxExpert': 'expert',
        'passiveMaxMaster': 'master'
    };
    for (var elId in tierMap) {
        var input = document.getElementById(elId);
        if (input) input.value = settings.passiveLearning.maxByTier[tierMap[elId]];
    }

    updatePassiveLearningVisibility();
}

// =============================================================================
// EARLY SPELL LEARNING SETTINGS
// =============================================================================

function initializeEarlyLearningSettings() {
    // Enable toggle
    var enabledToggle = document.getElementById('earlyLearningEnabledToggle');
    if (enabledToggle) {
        enabledToggle.checked = settings.earlySpellLearning.enabled;
        enabledToggle.addEventListener('change', function() {
            settings.earlySpellLearning.enabled = this.checked;
            updateEarlyLearningSettingsVisibility();
            console.log('[SpellLearning] Early learning enabled:', settings.earlySpellLearning.enabled);

        });
    }
    
    // Unlock threshold slider
    setupEarlyLearningSlider('unlockThreshold', 'unlockThreshold', '%');
    
    // Min effectiveness slider
    setupEarlyLearningSlider('minEffectiveness', 'minEffectiveness', '%');
    
    // Max effectiveness slider
    setupEarlyLearningSlider('maxEffectiveness', 'maxEffectiveness', '%');
    
    // Self-cast required slider
    setupEarlyLearningSlider('selfCastRequired', 'selfCastRequiredAt', '%');
    
    // Self-cast multiplier slider
    setupEarlyLearningSlider('selfCastMultiplier', 'selfCastXPMultiplier', '%');
    
    // Binary threshold slider
    setupEarlyLearningSlider('binaryThreshold', 'binaryEffectThreshold', '%');
    
    // Modify game display toggle
    var gameDisplayToggle = document.getElementById('modifyGameDisplayToggle');
    if (gameDisplayToggle) {
        gameDisplayToggle.checked = settings.earlySpellLearning.modifyGameDisplay !== false;
        gameDisplayToggle.addEventListener('change', function() {
            settings.earlySpellLearning.modifyGameDisplay = this.checked;
            console.log('[SpellLearning] Modify game display:', this.checked);

        });
    }
    
    // Power steps configuration
    initializePowerStepsUI();
    
    // Reset power steps button
    var resetPowerStepsBtn = document.getElementById('resetPowerStepsBtn');
    if (resetPowerStepsBtn) {
        resetPowerStepsBtn.addEventListener('click', function() {
            resetPowerStepsToDefaults();
        });
    }
    
    // Initial visibility
    updateEarlyLearningSettingsVisibility();
}

// Default power steps configuration
var DEFAULT_POWER_STEPS = [
    { xp: 25, power: 20, label: "Budding" },
    { xp: 40, power: 35, label: "Developing" },
    { xp: 55, power: 50, label: "Practicing" },
    { xp: 70, power: 65, label: "Advancing" },
    { xp: 85, power: 80, label: "Refining" }
];

function initializePowerStepsUI() {
    var container = document.getElementById('powerStepsContainer');
    if (!container) return;
    
    // Ensure powerSteps exists
    if (!settings.earlySpellLearning.powerSteps) {
        settings.earlySpellLearning.powerSteps = JSON.parse(JSON.stringify(DEFAULT_POWER_STEPS));
    }
    
    renderPowerSteps();
}

function renderPowerSteps() {
    var container = document.getElementById('powerStepsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    var steps = settings.earlySpellLearning.powerSteps;
    
    steps.forEach(function(step, index) {
        var row = document.createElement('div');
        row.className = 'power-step-row';
        row.dataset.index = index;
        
        // Stage label
        var labelSpan = document.createElement('span');
        labelSpan.className = 'power-step-label';
        labelSpan.textContent = t('progression.stageN', {n: index + 1});
        
        // XP threshold input
        var xpInput = document.createElement('input');
        xpInput.type = 'number';
        xpInput.className = 'power-step-input';
        xpInput.value = step.xp;
        xpInput.min = 1;
        xpInput.max = 99;
        xpInput.dataset.index = index;
        xpInput.dataset.field = 'xp';
        xpInput.addEventListener('change', onPowerStepInputChange);
        
        var xpUnit = document.createElement('span');
        xpUnit.className = 'power-step-unit';
        xpUnit.textContent = t('progression.xpUnit');
        
        // Power level input
        var powerInput = document.createElement('input');
        powerInput.type = 'number';
        powerInput.className = 'power-step-input';
        powerInput.value = step.power;
        powerInput.min = 1;
        powerInput.max = 99;
        powerInput.dataset.index = index;
        powerInput.dataset.field = 'power';
        powerInput.addEventListener('change', onPowerStepInputChange);
        
        var powerUnit = document.createElement('span');
        powerUnit.className = 'power-step-unit';
        powerUnit.textContent = t('progression.powerUnit');
        
        // Name input
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'power-step-name';
        nameInput.value = step.label;
        nameInput.placeholder = t('progression.stageNamePlaceholder');
        nameInput.dataset.index = index;
        nameInput.dataset.field = 'label';
        nameInput.addEventListener('change', onPowerStepInputChange);
        
        row.appendChild(labelSpan);
        row.appendChild(xpInput);
        row.appendChild(xpUnit);
        row.appendChild(powerInput);
        row.appendChild(powerUnit);
        row.appendChild(nameInput);
        
        container.appendChild(row);
    });
    
    // Add "Mastered" row (readonly)
    var masteredRow = document.createElement('div');
    masteredRow.className = 'power-step-row';
    masteredRow.style.opacity = '0.7';
    
    var masteredLabel = document.createElement('span');
    masteredLabel.className = 'power-step-label';
    masteredLabel.textContent = t('progression.stageFinal');
    masteredLabel.style.color = 'var(--accent-gold, #ffd700)';
    
    var masteredXp = document.createElement('span');
    masteredXp.className = 'power-step-unit';
    masteredXp.textContent = t('progression.fullXp');
    masteredXp.style.marginLeft = '10px';
    
    var masteredPower = document.createElement('span');
    masteredPower.className = 'power-step-unit';
    masteredPower.textContent = t('progression.fullPower');
    masteredPower.style.marginLeft = '20px';
    
    var masteredName = document.createElement('span');
    masteredName.className = 'power-step-unit';
    masteredName.textContent = t('progression.masteredFixed');
    masteredName.style.marginLeft = '20px';
    
    masteredRow.appendChild(masteredLabel);
    masteredRow.appendChild(masteredXp);
    masteredRow.appendChild(document.createElement('span')); // spacer
    masteredRow.appendChild(masteredPower);
    masteredRow.appendChild(document.createElement('span')); // spacer  
    masteredRow.appendChild(masteredName);
    
    container.appendChild(masteredRow);
}

function onPowerStepInputChange(e) {
    var index = parseInt(e.target.dataset.index);
    var field = e.target.dataset.field;
    var value = field === 'label' ? e.target.value : parseInt(e.target.value);
    
    if (field !== 'label') {
        value = Math.max(1, Math.min(99, value || 1));
        e.target.value = value;
    }
    
    settings.earlySpellLearning.powerSteps[index][field] = value;
    
    // Sort steps by XP threshold to maintain order
    settings.earlySpellLearning.powerSteps.sort(function(a, b) {
        return a.xp - b.xp;
    });
    
    // Re-render if order changed
    renderPowerSteps();
    
    console.log('[SpellLearning] Power step updated:', settings.earlySpellLearning.powerSteps);

}

function resetPowerStepsToDefaults() {
    settings.earlySpellLearning.powerSteps = JSON.parse(JSON.stringify(DEFAULT_POWER_STEPS));
    renderPowerSteps();
    console.log('[SpellLearning] Power steps reset to defaults');

}

function setupEarlyLearningSlider(elementBaseName, settingName, suffix) {
    var slider = document.getElementById(elementBaseName + 'Slider');
    var valueEl = document.getElementById(elementBaseName + 'Value');
    
    if (slider) {
        slider.value = settings.earlySpellLearning[settingName];
        if (valueEl) valueEl.textContent = settings.earlySpellLearning[settingName] + suffix;
        // Update slider fill visual
        updateSliderFillGlobal(slider);
        
        slider.addEventListener('input', function() {
            var value = parseInt(this.value);
            settings.earlySpellLearning[settingName] = value;
            if (valueEl) valueEl.textContent = value + suffix;
            // Update slider fill visual
            updateSliderFillGlobal(this);

        });
    }
}

function updateEarlyLearningSettingsVisibility() {
    var rows = [
        'unlockThresholdRow',
        'minEffectivenessRow', 
        'maxEffectivenessRow',
        'selfCastRequiredRow',
        'selfCastMultiplierRow',
        'binaryThresholdRow'
    ];
    
    var isEnabled = settings.earlySpellLearning.enabled;
    
    rows.forEach(function(rowId) {
        var row = document.getElementById(rowId);
        if (row) {
            row.style.opacity = isEnabled ? '1' : '0.5';
            row.style.pointerEvents = isEnabled ? '' : 'none';
        }
    });
}

function updateEarlyLearningUI() {
    // Update toggle
    var enabledToggle = document.getElementById('earlyLearningEnabledToggle');
    if (enabledToggle) enabledToggle.checked = settings.earlySpellLearning.enabled;
    
    // Update modifyGameDisplay toggle
    var gameDisplayToggle = document.getElementById('modifyGameDisplayToggle');
    if (gameDisplayToggle) {
        gameDisplayToggle.checked = settings.earlySpellLearning.modifyGameDisplay !== false;
    }
    
    // Update sliders
    var sliderMappings = [
        { element: 'unlockThreshold', setting: 'unlockThreshold' },
        { element: 'minEffectiveness', setting: 'minEffectiveness' },
        { element: 'maxEffectiveness', setting: 'maxEffectiveness' },
        { element: 'selfCastRequired', setting: 'selfCastRequiredAt' },
        { element: 'selfCastMultiplier', setting: 'selfCastXPMultiplier' },
        { element: 'binaryThreshold', setting: 'binaryEffectThreshold' }
    ];
    
    sliderMappings.forEach(function(mapping) {
        var slider = document.getElementById(mapping.element + 'Slider');
        var valueEl = document.getElementById(mapping.element + 'Value');
        if (slider && settings.earlySpellLearning[mapping.setting] !== undefined) {
            slider.value = settings.earlySpellLearning[mapping.setting];
            if (valueEl) valueEl.textContent = settings.earlySpellLearning[mapping.setting] + '%';
            // Update slider fill visual
            updateSliderFillGlobal(slider);
        }
    });
    
    // Update visibility
    updateEarlyLearningSettingsVisibility();
}

// =============================================================================
// UI HELPERS
// =============================================================================

function setStatusIcon(icon) {
    var el = document.getElementById('statusIcon');
    if (el) el.textContent = icon;
}

function updateCharCount() {
    var outputArea = document.getElementById('outputArea');
    var charCountEl = document.getElementById('charCount');
    if (!outputArea || !charCountEl) return;
    
    var count = outputArea.value.length;
    
    var countText;
    if (count >= 1000000) {
        countText = (count / 1000000).toFixed(1) + 'M chars';
    } else if (count >= 1000) {
        countText = (count / 1000).toFixed(1) + 'K chars';
    } else {
        countText = count + ' chars';
    }
    
    charCountEl.textContent = countText;
}

console.log('[SpellLearning] Script loaded');
