/**
 * Generation Mode UI Module
 * 
 * Handles the 3-row generation panel (AUTO SIMPLE, AUTO COMPLEX, AUTO AI)
 * and per-school control panels with shape/density settings.
 * 
 * Depends on:
 * - modules/state.js (state, settings)
 * - modules/proceduralTreeBuilder.js (generation functions)
 * - modules/uiHelpers.js (updateStatus)
 */

// =============================================================================
// DEFAULT LLM PROMPTS
// =============================================================================

var DEFAULT_AUTO_CONFIG_PROMPT = 
    'You are configuring visual spell trees for ALL magic schools at once.\n' +
    'Consider how schools should relate to each other visually - contrasts, similarities.\n\n' +
    '## SCHOOLS DATA:\n' +
    '{{ALL_SCHOOLS_DATA}}\n\n' +
    '## SHAPE OPTIONS - Visual silhouette of each tree:\n' +
    '- "organic": Natural flowing, irregular (nature/life magic)\n' +
    '- "radial": Even spread like a sun (holy/light magic)\n' +
    '- "spiky": Aggressive jutting branches (destruction/chaos)\n' +
    '- "mountain": Wide base narrowing to peak (earth/alteration)\n' +
    '- "cloud": Clustered groupings (illusion/mystery)\n' +
    '- "flame": Flickering upward (fire magic)\n' +
    '- "tree": Trunk with spreading canopy (nature/growth)\n' +
    '- "cascade": Flowing tiers (water/flow)\n' +
    '- "galaxy": Spiral arms (cosmic/summoning)\n\n' +
    '## GROWTH BEHAVIORS - How the tree grows from root:\n' +
    '- "fire_explosion": Bursts outward aggressively, reaches for sky. Many hubs, radial branching.\n' +
    '- "gentle_bloom": Fills each layer before growing up. Compact, nurturing, terminal clusters.\n' +
    '- "mountain_builder": Builds solid foundation, very compact. High fill threshold, few hubs.\n' +
    '- "portal_network": Creates hub portals spawning distant clusters. Chaotic, many hubs.\n' +
    '- "spider_web": Weaves intricate interconnected web. Many cross-connections, balanced growth.\n' +
    '- "ocean_wave": Flows like waves, building then crashing. Undulating, periodic growth.\n' +
    '- "ancient_tree": Thick trunk, spreading branches, leaf clusters at ends.\n' +
    '- "crystal_growth": Geometric, angular formation. Low variance, structured hubs.\n' +
    '- "vine_crawl": Spreads horizontally, occasionally shoots up. High spread, linear chains.\n' +
    '- "nebula_burst": Starts tight, explodes outward. Phase-dependent massive spread.\n\n' +
    '## BRANCHING MODE:\n' +
    '- "fuzzy_groups": Organic growth based on spell theme similarity (recommended)\n' +
    '- "proximity": Grid-based layout with proximity connections\n\n' +
    '## OTHER PARAMETERS:\n' +
    '- slice_weight (0.5-2.0): Visual presence. 1.0=proportional, 1.5=prominent, 0.7=subtle\n' +
    '- symmetry (0.0-1.0): How symmetrical/centered the tree grows. LOW=organic spread, HIGH=centered/ordered\n' +
    '- outward_growth (0.0-1.0): How aggressively tree spreads outward. LOW=compact near center, HIGH=reaches far out\n' +
    '- density (0.3-0.9): Node packing. LOW=scattered, HIGH=tight\n\n' +
    '## BRANCHING ENERGY (how trees fork into sub-branches):\n' +
    '- branch_chance (0.1-0.5): Base probability of creating a new branch at each node\n' +
    '- branch_energy_gain (0.05-0.25): Energy gained per node that doesn\'t branch (builds up pressure)\n' +
    '- branch_energy_threshold (1.0-3.0): Force branch when energy reaches this (prevents long linear runs)\n' +
    '- branch_subdivide_pool (true/false): When branching, do fresh fuzzy check on spell pool for each sub-branch\n\n' +
    '## ALTERNATE PATH PARAMETERS (create shortcuts between nodes):\n' +
    '- alt_path_min_distance (2-8): Only create shortcut if existing path is this many edges. Higher=fewer shortcuts\n' +
    '- alt_path_max_distance (2-8): Max spatial distance (in node sizes) for shortcuts. Lower=tighter clusters\n' +
    '- alt_path_probability (0.1-0.7): Base chance to create shortcut. Higher=more interconnected\n' +
    '- alt_path_max_per_node (1-4): Max shortcuts per node. Higher=more web-like\n\n' +
    '## THEMATIC GUIDANCE:\n' +
    '- Make schools VISUALLY DISTINCT - avoid giving similar configs\n' +
    '- Consider the school\'s fuzzy themes when choosing behavior\n' +
    '- Destruction should feel aggressive; Restoration nurturing; Illusion mysterious\n' +
    '- Large schools (500+ spells) need behaviors that spread well (portal_network, fire_explosion)\n' +
    '- Small schools (100-200) work well with compact behaviors (mountain_builder, gentle_bloom)\n\n' +
    'Return ONLY valid JSON with ALL schools:\n' +
    '{\n' +
    '  "SchoolName1": {\n' +
    '    "shape": "spiky|organic|radial|mountain|cloud|flame|tree|cascade|galaxy",\n' +
    '    "growth_behavior": "fire_explosion|gentle_bloom|mountain_builder|portal_network|spider_web|ocean_wave|ancient_tree|crystal_growth|vine_crawl|nebula_burst",\n' +
    '    "branching_mode": "fuzzy_groups|proximity",\n' +
    '    "slice_weight": 0.5-2.0,\n' +
    '    "symmetry": 0.0-1.0,\n' +
    '    "outward_growth": 0.0-1.0,\n' +
    '    "density": 0.3-0.9,\n' +
    '    "branch_chance": 0.1-0.5,\n' +
    '    "branch_energy_gain": 0.05-0.25,\n' +
    '    "branch_energy_threshold": 1.0-3.0,\n' +
    '    "branch_subdivide_pool": true|false,\n' +
    '    "alt_path_min_distance": 2-8,\n' +
    '    "alt_path_max_distance": 2-8,\n' +
    '    "alt_path_probability": 0.1-0.7,\n' +
    '    "alt_path_max_per_node": 1-4,\n' +
    '    "reasoning": "brief explanation"\n' +
    '  },\n' +
    '  "SchoolName2": { ... }\n' +
    '}';

var DEFAULT_GROUP_PROMPT =
    'You are analyzing spell groups for a magic skill tree.\n\n' +
    'GROUP: Common keywords: {{GROUP_KEYWORDS}}\n' +
    'SAMPLE SPELLS:\n' +
    '{{SPELL_LIST}}\n\n' +
    'Decide:\n' +
    '1. GROUP_NAME: A thematic name (e.g., "Pyromancy", "Inferno Arts")\n' +
    '2. GROUP_COLOR: Hex color that fits the theme (e.g., "#FF4500")\n' +
    '3. GROWTH_STYLE: One of [dense, sparse, linear, branchy, clustered]\n' +
    '4. BRANCHING_ENERGY: {"min_straight": 1-5, "max_straight": 3-8}\n' +
    '5. SPECIAL_RULE: Optional unique behavior (e.g., "chain_to_same_element")\n\n' +
    'Return JSON only.';

// Available shapes
var AVAILABLE_SHAPES = [
    'organic', 'radial', 'grid', 'cascade', 
    'mountain', 'spiky', 'cloud', 'linear',
    'tree', 'swords', 'portals', 'explosion'
];

// =============================================================================
// INITIALIZATION
// =============================================================================

function initGenerationModeUI() {
    // Load saved LLM prompts from localStorage
    loadLLMPrompts();
    
    // Initialize seed controls
    initSeedControls();
    
    // Setup collapsible LLM settings
    var llmHeader = document.getElementById('llmSettingsHeader');
    var llmContent = document.getElementById('llmSettingsContent');
    if (llmHeader && llmContent) {
        llmHeader.addEventListener('click', function() {
            llmContent.classList.toggle('hidden');
            var toggle = llmHeader.querySelector('.section-toggle');
            if (toggle) toggle.textContent = llmContent.classList.contains('hidden') ? '▼' : '▲';
        });
    }
    
    // LLM API Settings button (toggles settings panel visibility)
    var llmApiSettingsBtn = document.getElementById('llmApiSettingsBtn');
    if (llmApiSettingsBtn) {
        llmApiSettingsBtn.addEventListener('click', function() {
            var settingsPanel = document.getElementById('settingsPanel');
            if (settingsPanel) {
                // Toggle visibility
                if (settingsPanel.classList.contains('hidden')) {
                    settingsPanel.classList.remove('hidden');
                    // Scroll to make it visible
                    settingsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } else {
                    settingsPanel.classList.add('hidden');
                }
            }
        });
    }
    
    // LLM auto-config checkbox - save state when changed
    var llmAutoConfigCheckbox = document.getElementById('visualFirstLLMCheck');
    if (llmAutoConfigCheckbox) {
        llmAutoConfigCheckbox.addEventListener('change', function() {
            console.log('[GenerationModeUI] LLM auto-config changed:', this.checked);
            // Auto-save settings
            if (typeof autoSaveSettings === 'function') {
                autoSaveSettings();
            }
        });
    }
    
    // Reset prompt buttons
    var resetAutoBtn = document.getElementById('resetAutoConfigPromptBtn');
    if (resetAutoBtn) {
        resetAutoBtn.addEventListener('click', function() {
            var area = document.getElementById('autoConfigPromptArea');
            if (area) {
                area.value = DEFAULT_AUTO_CONFIG_PROMPT;
                saveLLMPrompts();
            }
        });
    }
    
    var resetGroupBtn = document.getElementById('resetGroupPromptBtn');
    if (resetGroupBtn) {
        resetGroupBtn.addEventListener('click', function() {
            var area = document.getElementById('groupPromptArea');
            if (area) {
                area.value = DEFAULT_GROUP_PROMPT;
                saveLLMPrompts();
            }
        });
    }
    
    // Save prompts on change
    var autoArea = document.getElementById('autoConfigPromptArea');
    if (autoArea) autoArea.addEventListener('change', saveLLMPrompts);
    
    var groupArea = document.getElementById('groupPromptArea');
    if (groupArea) groupArea.addEventListener('change', saveLLMPrompts);
    
    // NEW: Generate Final Prompt button
    var generateFinalPromptBtn = document.getElementById('generateFinalPromptBtn');
    if (generateFinalPromptBtn) {
        generateFinalPromptBtn.addEventListener('click', generateFinalPrompt);
    }
    
    // NEW: Copy final prompt button
    var copyFinalPromptBtn = document.getElementById('copyFinalPromptBtn');
    if (copyFinalPromptBtn) {
        copyFinalPromptBtn.addEventListener('click', function() {
            var finalPromptArea = document.getElementById('finalPromptArea');
            if (finalPromptArea && finalPromptArea.value) {
                navigator.clipboard.writeText(finalPromptArea.value).then(function() {
                    copyFinalPromptBtn.textContent = t('generationMode.copied');
                    setTimeout(function() { copyFinalPromptBtn.textContent = t('generationMode.copy'); }, 1500);
                });
            }
        });
    }
    
    // NEW: Paste LLM response button
    var pasteLLMResponseBtn = document.getElementById('pasteLLMResponseBtn');
    if (pasteLLMResponseBtn) {
        pasteLLMResponseBtn.addEventListener('click', function() {
            navigator.clipboard.readText().then(function(text) {
                var llmResponseArea = document.getElementById('llmResponseArea');
                if (llmResponseArea) {
                    llmResponseArea.value = text;
                }
            });
        });
    }
    
    // NEW: Clear LLM response button
    var clearLLMResponseBtn = document.getElementById('clearLLMResponseBtn');
    if (clearLLMResponseBtn) {
        clearLLMResponseBtn.addEventListener('click', function() {
            var llmResponseArea = document.getElementById('llmResponseArea');
            if (llmResponseArea) {
                llmResponseArea.value = '';
            }
        });
    }
    
    // NEW: Apply LLM response button
    var applyLLMResponseBtn = document.getElementById('applyLLMResponseBtn');
    if (applyLLMResponseBtn) {
        applyLLMResponseBtn.addEventListener('click', applyLLMResponse);
    }
    
    // NEW: Reset to default config button
    var resetToDefaultConfigBtn = document.getElementById('resetToDefaultConfigBtn');
    if (resetToDefaultConfigBtn) {
        resetToDefaultConfigBtn.addEventListener('click', function() {
            var currentConfigArea = document.getElementById('currentConfigArea');
            if (currentConfigArea) {
                currentConfigArea.value = JSON.stringify(getDefaultVisualFirstConfig(), null, 2);
                saveCurrentConfig();
            }
        });
    }
    
    // NEW: Clear tree button on spell scan page
    var clearTreeScanBtn = document.getElementById('clear-tree-scan-btn');
    if (clearTreeScanBtn) {
        clearTreeScanBtn.addEventListener('click', function() {
            if (confirm(t('generationMode.clearTreeConfirm'))) {
                if (typeof clearTree === 'function') {
                    clearTree();
                } else {
                    state.treeData = null;
                    if (typeof WheelRenderer !== 'undefined') {
                        WheelRenderer.clear();
                    }
                    console.log('[SpellLearning] Tree cleared');
                }
            }
        });
    }
    
    // Load current config
    loadCurrentConfig();
    
    // Collapse all schools button
    var collapseBtn = document.getElementById('collapseAllSchoolsBtn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', collapseAllSchoolPanels);
    }
    
    console.log('[GenerationModeUI] Initialized');
}

// =============================================================================
// SEED MANAGEMENT
// =============================================================================

function initSeedControls() {
    var seedInput = document.getElementById('seedInput');
    var newSeedBtn = document.getElementById('newSeedBtn');
    
    if (seedInput) {
        // Load saved seed or generate new one
        var savedSeed = localStorage.getItem('spellTreeSeed');
        if (savedSeed) {
            seedInput.value = savedSeed;
        } else {
            generateNewSeed();
        }
        
        // Save seed when changed
        seedInput.addEventListener('change', function() {
            localStorage.setItem('spellTreeSeed', seedInput.value);
            console.log('[Seed] Updated to:', seedInput.value);
        });
    }
    
    if (newSeedBtn) {
        newSeedBtn.addEventListener('click', generateNewSeed);
    }
}

function generateNewSeed() {
    var seedInput = document.getElementById('seedInput');
    if (seedInput) {
        // Generate random seed between 1 and 999999999
        var newSeed = Math.floor(Math.random() * 999999999) + 1;
        seedInput.value = newSeed;
        localStorage.setItem('spellTreeSeed', newSeed);
        console.log('[Seed] Generated new seed:', newSeed);
    }
}

function getCurrentSeed() {
    var seedInput = document.getElementById('seedInput');
    if (seedInput && seedInput.value) {
        return parseInt(seedInput.value, 10);
    }
    // Return random seed if none set
    return Math.floor(Math.random() * 999999999) + 1;
}

// Export for use by proceduralTreeBuilder
window.getCurrentSeed = getCurrentSeed;
window.generateNewSeed = generateNewSeed;

// =============================================================================
// LLM PROMPT MANAGEMENT
// =============================================================================

function loadLLMPrompts() {
    var autoArea = document.getElementById('autoConfigPromptArea');
    var groupArea = document.getElementById('groupPromptArea');
    
    var savedAuto = localStorage.getItem('spellLearning_autoConfigPrompt');
    var savedGroup = localStorage.getItem('spellLearning_groupPrompt');
    
    if (autoArea) autoArea.value = savedAuto || DEFAULT_AUTO_CONFIG_PROMPT;
    if (groupArea) groupArea.value = savedGroup || DEFAULT_GROUP_PROMPT;
}

function saveLLMPrompts() {
    var autoArea = document.getElementById('autoConfigPromptArea');
    var groupArea = document.getElementById('groupPromptArea');
    
    if (autoArea) localStorage.setItem('spellLearning_autoConfigPrompt', autoArea.value);
    if (groupArea) localStorage.setItem('spellLearning_groupPrompt', groupArea.value);
}

function getAutoConfigPrompt() {
    var area = document.getElementById('autoConfigPromptArea');
    return area ? area.value : DEFAULT_AUTO_CONFIG_PROMPT;
}

function getGroupPrompt() {
    var area = document.getElementById('groupPromptArea');
    return area ? area.value : DEFAULT_GROUP_PROMPT;
}

// =============================================================================
// MANUAL LLM WORKFLOW (for users without API key)
// =============================================================================

/**
 * Get default configuration for Visual First generation.
 * This is used when LLM auto-config is disabled.
 */
function getDefaultVisualFirstConfig() {
    return {
        Alteration: { shape: 'organic', density: 'medium', node_spacing: 1.0, branching: 'balanced' },
        Conjuration: { shape: 'organic', density: 'medium', node_spacing: 1.0, branching: 'balanced' },
        Destruction: { shape: 'organic', density: 'high', node_spacing: 0.9, branching: 'expansive' },
        Illusion: { shape: 'organic', density: 'low', node_spacing: 1.1, branching: 'sparse' },
        Restoration: { shape: 'organic', density: 'medium', node_spacing: 1.0, branching: 'balanced' }
    };
}

/**
 * Generate the final prompt by substituting variables in the template.
 * User can copy this and paste into an online LLM.
 */
function generateFinalPrompt() {
    var finalPromptArea = document.getElementById('finalPromptArea');
    if (!finalPromptArea) return;
    
    // Get the template
    var template = getAutoConfigPrompt();
    
    // Get current spell data
    var spellData = state.outputData || state.lastScanData || null;
    
    if (!spellData || !spellData.schools) {
        finalPromptArea.value = t('generationMode.noSpellDataError');
        return;
    }
    
    // Build spell list summary for each school
    var schoolSummaries = [];
    Object.keys(spellData.schools).forEach(function(schoolName) {
        var school = spellData.schools[schoolName];
        var spellCount = school.spells ? school.spells.length : 0;
        var spellNames = school.spells ? school.spells.slice(0, 20).map(function(s) { return s.name; }).join(', ') : '';
        if (spellCount > 20) spellNames += '... (' + (spellCount - 20) + ' more)';
        schoolSummaries.push(schoolName + ': ' + spellCount + ' spells - ' + spellNames);
    });
    
    // Available shapes
    var availableShapes = ['organic', 'radial', 'linear', 'cascade', 'mountain', 'cloud', 'spiky', 'grid'];
    
    // Replace variables
    var finalPrompt = template
        .replace(/\{\{SCHOOL_NAMES\}\}/g, Object.keys(spellData.schools).join(', '))
        .replace(/\{\{SPELL_LIST\}\}/g, schoolSummaries.join('\\n'))
        .replace(/\{\{AVAILABLE_SHAPES\}\}/g, availableShapes.join(', '))
        .replace(/\{\{TOTAL_SPELLS\}\}/g, Object.keys(spellData.schools).reduce(function(sum, k) {
            return sum + (spellData.schools[k].spells ? spellData.schools[k].spells.length : 0);
        }, 0));
    
    finalPromptArea.value = finalPrompt;
    console.log('[LLMWorkflow] Generated final prompt');
}

/**
 * Apply the pasted LLM response as the current config.
 */
function applyLLMResponse() {
    var llmResponseArea = document.getElementById('llmResponseArea');
    var currentConfigArea = document.getElementById('currentConfigArea');
    
    if (!llmResponseArea || !currentConfigArea) return;
    
    var responseText = llmResponseArea.value.trim();
    if (!responseText) {
        alert(t('generationMode.noLlmResponse'));
        return;
    }
    
    try {
        // Try to parse as JSON
        var parsed = JSON.parse(responseText);
        currentConfigArea.value = JSON.stringify(parsed, null, 2);
        saveCurrentConfig();
        console.log('[LLMWorkflow] Applied LLM response as config');
        alert(t('generationMode.configApplied'));
    } catch (e) {
        // Try to extract JSON from response
        var jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                var extracted = JSON.parse(jsonMatch[0]);
                currentConfigArea.value = JSON.stringify(extracted, null, 2);
                saveCurrentConfig();
                console.log('[LLMWorkflow] Extracted and applied JSON from response');
                alert(t('generationMode.configExtracted'));
            } catch (e2) {
                alert(t('generationMode.cannotParseJson'));
            }
        } else {
            alert(t('generationMode.noValidJson'));
        }
    }
}

/**
 * Load current config from storage or defaults.
 */
function loadCurrentConfig() {
    var currentConfigArea = document.getElementById('currentConfigArea');
    if (!currentConfigArea) return;
    
    var savedConfig = localStorage.getItem('spellLearning_visualFirstConfig');
    if (savedConfig) {
        currentConfigArea.value = savedConfig;
    } else {
        currentConfigArea.value = JSON.stringify(getDefaultVisualFirstConfig(), null, 2);
    }
}

/**
 * Save current config to storage.
 */
function saveCurrentConfig() {
    var currentConfigArea = document.getElementById('currentConfigArea');
    if (!currentConfigArea) return;
    
    localStorage.setItem('spellLearning_visualFirstConfig', currentConfigArea.value);
}

/**
 * Get the current visual first config (from manual config or defaults).
 */
function getVisualFirstConfig() {
    var currentConfigArea = document.getElementById('currentConfigArea');
    if (currentConfigArea && currentConfigArea.value.trim()) {
        try {
            return JSON.parse(currentConfigArea.value);
        } catch (e) {
            console.warn('[LLMWorkflow] Invalid config in text area, using defaults');
        }
    }
    return getDefaultVisualFirstConfig();
}

// Export for use by other modules
window.getDefaultVisualFirstConfig = getDefaultVisualFirstConfig;
window.getVisualFirstConfig = getVisualFirstConfig;
window.generateFinalPrompt = generateFinalPrompt;

// =============================================================================
// GENERATION OPTIONS
// =============================================================================

function getGenerationOptions() {
    return {
        jsRandomSettings: document.getElementById('jsRandomSettingsCheck')?.checked || false,
        llmAutoConfig: document.getElementById('llmAutoConfigCheck')?.checked || false,
        llmGroups: document.getElementById('llmGroupsCheck')?.checked || false,
        autoConfigPrompt: getAutoConfigPrompt(),
        groupPrompt: getGroupPrompt()
    };
}

// =============================================================================
// PER-SCHOOL CONTROL PANELS
// =============================================================================

function showSchoolControlPanels(schoolData) {
    var section = document.getElementById('schoolControlsSection');
    var container = document.getElementById('schoolControlsContainer');
    
    if (!section || !container || !schoolData) return;
    
    section.classList.remove('hidden');
    container.innerHTML = '';
    
    var schools = Object.keys(schoolData).sort();
    
    schools.forEach(function(schoolName) {
        var spellCount = schoolData[schoolName].length || 0;
        var panel = createSchoolControlPanel(schoolName, spellCount);
        container.appendChild(panel);
    });
    
    // IMPORTANT: Update developer mode visibility for newly created elements
    // School control panels are created dynamically, so we need to reapply visibility
    if (typeof updateDeveloperModeVisibility === 'function') {
        var devModeEnabled = settings && settings.developerMode;
        updateDeveloperModeVisibility(devModeEnabled);
    }
    
    // Add "Regenerate Selected" button at the bottom if not already present
    var existingBtn = document.getElementById('regenerateSelectedBtn');
    if (!existingBtn) {
        var btnContainer = document.createElement('div');
        btnContainer.className = 'regenerate-selected-container';
        btnContainer.innerHTML = 
            '<button class="btn btn-primary" id="regenerateSelectedBtn" onclick="regenerateSelectedSchools()">' +
                '<span class="btn-icon">[R]</span> Regenerate Selected' +
            '</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="selectAllSchools(true)">Select All</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="selectAllSchools(false)">Deselect All</button>';
        section.appendChild(btnContainer);
    }
}

function selectAllSchools(select) {
    var checkboxes = document.querySelectorAll('.school-select-input');
    checkboxes.forEach(function(cb) { cb.checked = select; });
}

function regenerateSelectedSchools() {
    var checkboxes = document.querySelectorAll('.school-select-input:checked');
    var selectedSchools = [];
    
    checkboxes.forEach(function(cb) {
        var schoolName = cb.id.replace('school-select-', '').replace(/-/g, ' ');
        // Capitalize words
        schoolName = schoolName.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        selectedSchools.push(schoolName);
    });
    
    if (selectedSchools.length === 0) {
        updateStatus('Select at least one school to regenerate');
        setStatusIcon('!');
        return;
    }
    
    console.log('[GenerationModeUI] Regenerating selected schools:', selectedSchools);
    updateStatus('Regenerating ' + selectedSchools.length + ' school(s)...');
    setStatusIcon('...');
    
    // Regenerate each selected school, preserving existing pie slices
    var delay = 0;
    selectedSchools.forEach(function(schoolName) {
        setTimeout(function() {
            rerunSchool(schoolName, 'visualfirst', true); // true = use existing slice
        }, delay);
        delay += 100;
    });
    
    setTimeout(function() {
        updateStatus('Regenerated ' + selectedSchools.length + ' school(s)');
        setStatusIcon('OK');
    }, delay + 500);
}

function createSchoolControlPanel(schoolName, spellCount) {
    var panel = document.createElement('div');
    panel.className = 'school-control-panel';
    panel.id = 'school-control-' + schoolName.replace(/\s+/g, '-');
    var safeId = schoolName.replace(/\s+/g, '-');
    
    panel.innerHTML = 
        '<div class="school-control-header">' +
            '<label class="school-select-checkbox" onclick="event.stopPropagation()">' +
                '<input type="checkbox" id="school-select-' + safeId + '" class="school-select-input">' +
            '</label>' +
            '<span class="school-header-clickable" onclick="toggleSchoolPanel(\'' + schoolName + '\')">' +
                '<span class="school-control-name">' + schoolName + '</span>' +
                '<span class="school-control-spell-count">(' + spellCount + ' spells)</span>' +
            '</span>' +
            '<span class="school-control-toggle" onclick="toggleSchoolPanel(\'' + schoolName + '\')">▼</span>' +
        '</div>' +
        '<div class="school-control-content">' +
            createSchoolControlsHTML(schoolName) +
        '</div>';
    
    return panel;
}

function createSchoolControlsHTML(schoolName) {
    var safeId = schoolName.replace(/\s+/g, '-');
    
    // Main settings (always visible)
    var html = '' +
        '<div class="school-control-row">' +
            '<span class="school-control-label">Slice Weight:</span>' +
            '<input type="range" class="school-control-slider" id="school-slice-weight-' + safeId + '" ' +
                'min="50" max="200" value="100" oninput="updateSchoolSliderValue(this, 100)">' +
            '<span class="school-control-value" id="school-slice-weight-val-' + safeId + '">1.0</span>' +
        '</div>' +
        '<div class="school-control-row">' +
            '<span class="school-control-label">Growth Style:</span>' +
            '<select class="school-control-select" id="school-growth-behavior-' + safeId + '">' +
                '<option value="auto" selected>Auto (school default)</option>' +
                '<option value="fire_explosion">Fire Explosion</option>' +
                '<option value="gentle_bloom">Gentle Bloom</option>' +
                '<option value="mountain_builder">Mountain Builder</option>' +
                '<option value="portal_network">Portal Network</option>' +
                '<option value="spider_web">Spider Web</option>' +
                '<option value="ocean_wave">Ocean Wave</option>' +
                '<option value="ancient_tree">Ancient Tree</option>' +
                '<option value="crystal_growth">Crystal Growth</option>' +
                '<option value="vine_crawl">Vine Crawl</option>' +
                '<option value="nebula_burst">Nebula Burst</option>' +
            '</select>' +
        '</div>';
    
    // Shape control - visible to all users (affects tree visual pattern)
    html += '' +
        '<div class="school-control-row">' +
            '<span class="school-control-label">Shape:</span>' +
            '<select class="school-control-select" id="school-shape-' + safeId + '">' +
                AVAILABLE_SHAPES.map(function(s) {
                    return '<option value="' + s + '"' + (s === 'organic' ? ' selected' : '') + '>' + s + '</option>';
                }).join('') +
            '</select>' +
        '</div>' +
        '<div class="school-control-row">' +
            '<span class="school-control-label">Symmetry:</span>' +
            '<input type="range" class="school-control-slider" id="school-symmetry-' + safeId + '" ' +
                'min="0" max="100" value="30" oninput="updateSchoolSliderValue(this, 100)">' +
            '<span class="school-control-value" id="school-symmetry-val-' + safeId + '">30%</span>' +
        '</div>' +
        '<div class="school-control-row">' +
            '<span class="school-control-label">Outward Growth:</span>' +
            '<input type="range" class="school-control-slider" id="school-outward-' + safeId + '" ' +
                'min="0" max="100" value="50" oninput="updateSchoolSliderValue(this, 100)">' +
            '<span class="school-control-value" id="school-outward-val-' + safeId + '">50%</span>' +
        '</div>';
    
    // Developer-only settings (hidden unless developer mode is on)
    html += '' +
        '<div class="school-control-row dev-only">' +
            '<span class="school-control-label">Density:</span>' +
            '<input type="range" class="school-control-slider" id="school-density-' + safeId + '" ' +
                'min="30" max="90" value="60" oninput="updateSchoolSliderValue(this)">' +
            '<span class="school-control-value" id="school-density-val-' + safeId + '">0.6</span>' +
        '</div>' +
        '<div class="school-control-row dev-only">' +
            '<span class="school-control-label">Convergence:</span>' +
            '<input type="range" class="school-control-slider" id="school-convergence-' + safeId + '" ' +
                'min="20" max="70" value="40" oninput="updateSchoolSliderValue(this, 100)">' +
            '<span class="school-control-value" id="school-convergence-val-' + safeId + '">40%</span>' +
        '</div>' +
        '<div class="school-control-row dev-only">' +
            '<span class="school-control-label">Branching:</span>' +
            '<select class="school-control-select" id="school-branching-mode-' + safeId + '">' +
                '<option value="fuzzy_groups" selected>Fuzzy Groups (organic)</option>' +
                '<option value="proximity">Proximity (grid)</option>' +
            '</select>' +
        '</div>' +
        '<details class="school-control-advanced dev-only">' +
            '<summary>Branching Energy</summary>' +
            '<div class="school-control-row">' +
                '<span class="school-control-label">Branch Chance:</span>' +
                '<input type="range" class="school-control-slider" id="school-branch-chance-' + safeId + '" ' +
                    'min="10" max="50" value="25" oninput="updateSchoolSliderValue(this, 100)">' +
                '<span class="school-control-value" id="school-branch-chance-val-' + safeId + '">25%</span>' +
            '</div>' +
            '<div class="school-control-row">' +
                '<span class="school-control-label">Energy Gain:</span>' +
                '<input type="range" class="school-control-slider" id="school-branch-energy-' + safeId + '" ' +
                    'min="5" max="25" value="12" oninput="updateSchoolSliderValue(this, 100)">' +
                '<span class="school-control-value" id="school-branch-energy-val-' + safeId + '">0.12</span>' +
            '</div>' +
            '<div class="school-control-row">' +
                '<span class="school-control-label">Energy Threshold:</span>' +
                '<input type="range" class="school-control-slider" id="school-branch-threshold-' + safeId + '" ' +
                    'min="10" max="30" value="18" oninput="updateSchoolSliderValue(this, 10)">' +
                '<span class="school-control-value" id="school-branch-threshold-val-' + safeId + '">1.8</span>' +
            '</div>' +
            '<div class="school-control-row">' +
                '<span class="school-control-label">Fuzzy Subdivide:</span>' +
                '<input type="checkbox" id="school-branch-subdivide-' + safeId + '" checked>' +
            '</div>' +
        '</details>' +
        '<details class="school-control-advanced dev-only">' +
            '<summary>Alternate Paths</summary>' +
            '<div class="school-control-row">' +
                '<span class="school-control-label">Min Path Dist:</span>' +
                '<input type="range" class="school-control-slider" id="school-alt-min-path-' + safeId + '" ' +
                    'min="2" max="8" value="4" oninput="updateSchoolSliderValue(this, 1, \'\', true)">' +
                '<span class="school-control-value" id="school-alt-min-path-val-' + safeId + '">4</span>' +
            '</div>' +
            '<div class="school-control-row">' +
                '<span class="school-control-label">Max Spatial:</span>' +
                '<input type="range" class="school-control-slider" id="school-alt-max-spatial-' + safeId + '" ' +
                    'min="2" max="8" value="4" oninput="updateSchoolSliderValue(this, 1, \'\', true)">' +
                '<span class="school-control-value" id="school-alt-max-spatial-val-' + safeId + '">4</span>' +
            '</div>' +
            '<div class="school-control-row">' +
                '<span class="school-control-label">Probability:</span>' +
                '<input type="range" class="school-control-slider" id="school-alt-probability-' + safeId + '" ' +
                    'min="10" max="70" value="30" oninput="updateSchoolSliderValue(this, 100)">' +
                '<span class="school-control-value" id="school-alt-probability-val-' + safeId + '">30%</span>' +
            '</div>' +
            '<div class="school-control-row">' +
                '<span class="school-control-label">Max Per Node:</span>' +
                '<input type="range" class="school-control-slider" id="school-alt-max-per-node-' + safeId + '" ' +
                    'min="1" max="4" value="2" oninput="updateSchoolSliderValue(this, 1, \'\', true)">' +
                '<span class="school-control-value" id="school-alt-max-per-node-val-' + safeId + '">2</span>' +
            '</div>' +
        '</details>';
    
    // Generate buttons - Complex and Simple (JS only)
    html += '' +
        '<div class="school-control-actions">' +
            '<button class="btn btn-accent btn-sm" onclick="rerunSchool(\'' + schoolName + '\', \'complex\', true)" title="Regenerate with settings-aware builder (uses scoring, element isolation, tier ordering)">Complex</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="rerunSchool(\'' + schoolName + '\', \'simple\', true)" title="Regenerate with simple JS builder (basic theme grouping)">Simple</button>' +
        '</div>';
    
    return html;
}

function toggleSchoolPanel(schoolName) {
    var safeId = schoolName.replace(/\s+/g, '-');
    var panel = document.getElementById('school-control-' + safeId);
    if (panel) {
        panel.classList.toggle('expanded');
        var toggle = panel.querySelector('.school-control-toggle');
        if (toggle) toggle.textContent = panel.classList.contains('expanded') ? '▲' : '▼';
    }
}

function collapseAllSchoolPanels() {
    var panels = document.querySelectorAll('.school-control-panel');
    panels.forEach(function(panel) {
        panel.classList.remove('expanded');
        var toggle = panel.querySelector('.school-control-toggle');
        if (toggle) toggle.textContent = '▼';
    });
}

function updateSchoolSliderValue(slider, divisor, isInt) {
    divisor = divisor || 100;
    var safeId = slider.id.replace('school-', '').replace(/-[^-]+$/, '');
    var valSpan = document.getElementById(slider.id.replace(/-([^-]+)$/, '-val-$1'));
    
    if (valSpan) {
        var val = slider.value / divisor;
        if (isInt) {
            valSpan.textContent = slider.value;
        } else {
            valSpan.textContent = val.toFixed(1);
        }
    }
}

function getSchoolConfig(schoolName) {
    var safeId = schoolName.replace(/\s+/g, '-');
    
    var branchingMode = document.getElementById('school-branching-mode-' + safeId)?.value || 'fuzzy_groups';
    var growthBehavior = document.getElementById('school-growth-behavior-' + safeId)?.value || 'auto';
    
    return {
        slice_weight: (document.getElementById('school-slice-weight-' + safeId)?.value || 100) / 100,
        shape: document.getElementById('school-shape-' + safeId)?.value || 'organic',
        symmetry: (document.getElementById('school-symmetry-' + safeId)?.value || 30) / 100,
        outward_growth: (document.getElementById('school-outward-' + safeId)?.value || 50) / 100,
        density: (document.getElementById('school-density-' + safeId)?.value || 60) / 100,
        convergence: (document.getElementById('school-convergence-' + safeId)?.value || 40) / 100,
        branching_mode: branchingMode,
        growth_behavior: growthBehavior === 'auto' ? null : growthBehavior,
        // Branching energy parameters
        branch_chance: (document.getElementById('school-branch-chance-' + safeId)?.value || 25) / 100,
        branch_energy_gain: (document.getElementById('school-branch-energy-' + safeId)?.value || 12) / 100,
        branch_energy_threshold: (document.getElementById('school-branch-threshold-' + safeId)?.value || 18) / 10,
        branch_subdivide_pool: document.getElementById('school-branch-subdivide-' + safeId)?.checked !== false,
        // Alternate path parameters
        alt_path_min_distance: parseInt(document.getElementById('school-alt-min-path-' + safeId)?.value) || 4,
        alt_path_max_distance: parseInt(document.getElementById('school-alt-max-spatial-' + safeId)?.value) || 4,
        alt_path_probability: (document.getElementById('school-alt-probability-' + safeId)?.value || 30) / 100,
        alt_path_max_per_node: parseInt(document.getElementById('school-alt-max-per-node-' + safeId)?.value) || 2
    };
}

function rerunSchool(schoolName, mode, useExistingSlice) {
    console.log('[RerunSchool] ' + schoolName + ' mode=' + mode);
    
    if (!state.lastSpellData || !state.lastSpellData.spells) {
        updateStatus('No spell data - scan spells first');
        setStatusIcon('X');
        return;
    }
    
    // Filter spells to this school (same filtering as main pipelines)
    var allSpells = state.lastSpellData.spells;
    if (typeof filterBlacklistedSpells === 'function') allSpells = filterBlacklistedSpells(allSpells);
    if (typeof filterWhitelistedSpells === 'function') allSpells = filterWhitelistedSpells(allSpells);
    
    var schoolSpells = allSpells.filter(function(s) {
        var school = s.school || 'Unknown';
        if (!school || school === 'null' || school === 'None' || school === '') school = 'Hedge Wizard';
        return school === schoolName;
    });
    
    if (schoolSpells.length === 0) {
        updateStatus('No spells found for ' + schoolName);
        setStatusIcon('X');
        return;
    }
    
    if (!state.treeData || !state.treeData.rawData) {
        updateStatus('Build full tree first, then regenerate individual schools');
        setStatusIcon('X');
        return;
    }
    
    updateStatus('Regenerating ' + schoolName + '...');
    setStatusIcon('...');
    
    if (mode === 'complex') {
        // =====================================================================
        // COMPLEX: Same pipeline as doVisualFirstGenerate() / main Build Complex
        // Uses buildAllTreesSettingsAware → SettingsAwareBuilder
        // =====================================================================
        setTimeout(function() {
            try {
                if (typeof buildAllTreesSettingsAware !== 'function') {
                    updateStatus('Settings-aware builder not loaded');
                    setStatusIcon('X');
                    return;
                }
                
                // Read per-school UI config (same as doVisualFirstGenerate line 1901)
                var schoolConfig = getSchoolConfig(schoolName);
                
                // Build finalConfigs map with just this school
                // (same merge logic as doVisualFirstGenerate: LLM > UI > defaults)
                var config = schoolConfig || {};
                config.shape = config.shape || 'organic';
                config.density = config.density || 0.6;
                config.convergence_chance = config.convergence_chance || config.convergence || 0.4;
                config.slice_weight = config.slice_weight || 1.0;
                config.branching_mode = config.branching_mode || 'fuzzy_groups';
                config.source = 'ui';
                
                var finalConfigs = {};
                finalConfigs[schoolName] = config;
                
                // Get global tree generation settings (same as doVisualFirstGenerate line 1988)
                var treeGeneration = settings.treeGeneration || {};
                
                // Get stored NLP fuzzy data (same as doVisualFirstGenerate line 1858)
                var fuzzy = window._nlpFuzzyData || {
                    relationships: {},
                    similarity_scores: {},
                    groups: {},
                    themes: {}
                };
                
                console.log('[RerunSchool] Complex: calling buildAllTreesSettingsAware for', schoolName,
                    '(' + schoolSpells.length + ' spells)');
                console.log('[RerunSchool]   shape:', config.shape, 'growth:', config.growth_behavior);
                console.log('[RerunSchool]   treeGeneration:', JSON.stringify({
                    rootCount: treeGeneration.rootCount,
                    elementIsolation: treeGeneration.elementIsolation,
                    strictTierOrdering: treeGeneration.strictTierOrdering
                }));
                
                // Call the SAME function as the main Build Complex button
                // Pass only this school's spells — buildAllTreesSettingsAware groups by school internally
                var treeData = buildAllTreesSettingsAware(schoolSpells, finalConfigs, treeGeneration, fuzzy);
                
                // Merge the regenerated school into existing tree
                if (treeData.schools && treeData.schools[schoolName]) {
                    // Replace just this school's nodes/links in the full rawData
                    state.treeData.rawData.schools[schoolName] = treeData.schools[schoolName];
                    
                    // Re-apply LayoutEngine to the FULL tree (all schools) so
                    // slice boundaries are correct — the new school stays in its
                    // pie slice and doesn't bleed into neighbours
                    if (typeof LayoutEngine !== 'undefined' && typeof LayoutEngine.applyPositionsToTree === 'function') {
                        // Build schoolConfigs for ALL schools from UI controls
                        var allSchoolConfigs = {};
                        for (var sn in state.treeData.rawData.schools) {
                            allSchoolConfigs[sn] = typeof getSchoolConfig === 'function' ? getSchoolConfig(sn) : {};
                        }
                        // Override the regenerated school's config with what we just used
                        allSchoolConfigs[schoolName] = config;
                        
                        // Clear position flags on ALL nodes so LayoutEngine recalculates everything
                        for (var sn2 in state.treeData.rawData.schools) {
                            var sch = state.treeData.rawData.schools[sn2];
                            if (sch && sch.nodes) {
                                sch.nodes.forEach(function(n) {
                                    delete n.x; delete n.y;
                                    delete n._fromVisualFirst; delete n._fromLayoutEngine;
                                    delete n._visualFirstX; delete n._visualFirstY;
                                });
                            }
                        }
                        
                        LayoutEngine.applyPositionsToTree(state.treeData.rawData, {
                            shape: config.shape || 'organic',
                            seed: Date.now(),
                            schoolConfigs: allSchoolConfigs
                        });
                        console.log('[RerunSchool] Re-applied LayoutEngine to full tree (all schools)');
                    }
                    
                    // Reload full tree (re-parse + re-render)
                    if (typeof loadTreeData === 'function') {
                        loadTreeData(state.treeData.rawData);
                    }
                    
                    // Save updated tree
                    if (window.callCpp) {
                        window.callCpp('SaveSpellTree', JSON.stringify(state.treeData.rawData));
                    }
                    
                    var nodeCount = treeData.schools[schoolName].nodes ? treeData.schools[schoolName].nodes.length : 0;
                    updateStatus('Complex: ' + schoolName + ' (' + nodeCount + ' nodes)');
                    setStatusIcon('OK');
                } else {
                    updateStatus('Complex build produced no data for ' + schoolName);
                    setStatusIcon('X');
                }
                
            } catch (e) {
                console.error('[RerunSchool] Complex error:', e);
                updateStatus('Complex error: ' + e.message);
                setStatusIcon('X');
            }
        }, 50);
        
    } else if (mode === 'simple') {
        // =====================================================================
        // SIMPLE: Same pipeline as startProceduralGenerate() / main Build Simple
        // Uses buildProceduralTrees → assignGridPositions
        // =====================================================================
        setTimeout(function() {
            try {
                if (typeof buildProceduralTrees !== 'function') {
                    updateStatus('Procedural builder not loaded');
                    setStatusIcon('X');
                    return;
                }
                
                console.log('[RerunSchool] Simple: calling buildProceduralTrees for', schoolName,
                    '(' + schoolSpells.length + ' spells)');
                
                // Call the SAME function as the main Build Simple button
                // buildProceduralTrees groups by school internally, so pass this school's spells
                var treeData = buildProceduralTrees(schoolSpells);
                
                // Apply grid positions (same as startProceduralGenerate line 1096)
                if (typeof assignGridPositions === 'function') {
                    treeData = assignGridPositions(treeData);
                }
                
                // Merge the regenerated school into existing tree
                if (treeData.schools && treeData.schools[schoolName]) {
                    state.treeData.rawData.schools[schoolName] = treeData.schools[schoolName];
                    
                    // Re-apply LayoutEngine to the FULL tree (all schools) so
                    // slice boundaries are correct — same fix as complex mode
                    if (typeof LayoutEngine !== 'undefined' && typeof LayoutEngine.applyPositionsToTree === 'function') {
                        var allSchoolConfigs = {};
                        for (var sn in state.treeData.rawData.schools) {
                            allSchoolConfigs[sn] = typeof getSchoolConfig === 'function' ? getSchoolConfig(sn) : {};
                        }
                        
                        // Clear position flags on ALL nodes so LayoutEngine recalculates
                        for (var sn2 in state.treeData.rawData.schools) {
                            var sch = state.treeData.rawData.schools[sn2];
                            if (sch && sch.nodes) {
                                sch.nodes.forEach(function(n) {
                                    delete n.x; delete n.y;
                                    delete n._fromVisualFirst; delete n._fromLayoutEngine;
                                    delete n._visualFirstX; delete n._visualFirstY;
                                });
                            }
                        }
                        
                        LayoutEngine.applyPositionsToTree(state.treeData.rawData, {
                            shape: 'organic',
                            seed: Date.now(),
                            schoolConfigs: allSchoolConfigs
                        });
                        console.log('[RerunSchool] Re-applied LayoutEngine to full tree (all schools)');
                    }
                    
                    // Reload full tree (re-parse + re-render)
                    if (typeof loadTreeData === 'function') {
                        loadTreeData(state.treeData.rawData);
                    }
                    
                    // Save updated tree
                    if (window.callCpp) {
                        window.callCpp('SaveSpellTree', JSON.stringify(state.treeData.rawData));
                    }
                    
                    var nodeCount = treeData.schools[schoolName].nodes ? treeData.schools[schoolName].nodes.length : 0;
                    updateStatus('Simple: ' + schoolName + ' (' + nodeCount + ' nodes)');
                    setStatusIcon('OK');
                } else {
                    updateStatus('Simple build produced no data for ' + schoolName);
                    setStatusIcon('X');
                }
                
            } catch (e) {
                console.error('[RerunSchool] Simple error:', e);
                updateStatus('Simple error: ' + e.message);
                setStatusIcon('X');
            }
        }, 50);
        
    } else if (mode === 'native') {
        // C++ native generation for single school
        if (typeof startProceduralTreeGenerate === 'function') {
            startProceduralTreeGenerate(schoolName, getSchoolConfig(schoolName));
        } else {
            updateStatus('Native C++ generation not available');
            setStatusIcon('X');
        }
    }
}

// Build tree for a single school (JS mode)
function buildSchoolTreeOnly(schoolName, spells, config) {
    console.log('[GenerationModeUI] Building ' + schoolName + ' with ' + spells.length + ' spells');
    
    // Use the existing procedural builder functions (exported to window)
    if (typeof window.discoverThemes !== 'function' || typeof window.buildProceduralSchoolTree !== 'function') {
        console.error('[GenerationModeUI] Procedural functions not available');
        console.log('[GenerationModeUI] discoverThemes:', typeof window.discoverThemes);
        console.log('[GenerationModeUI] buildProceduralSchoolTree:', typeof window.buildProceduralSchoolTree);
        return null;
    }
    
    try {
        var themes = window.discoverThemes(spells);
        console.log('[GenerationModeUI] Discovered ' + themes.length + ' themes for ' + schoolName);
        
        var schoolTree = window.buildProceduralSchoolTree(schoolName, spells, themes);
        console.log('[GenerationModeUI] Built tree with ' + (schoolTree && schoolTree.nodes ? schoolTree.nodes.length : 0) + ' nodes');
        
        return schoolTree;
    } catch (e) {
        console.error('[GenerationModeUI] buildSchoolTreeOnly error:', e);
        return null;
    }
}

// Merge a single school's tree into the existing tree data
function mergeSchoolTree(schoolName, schoolTree) {
    if (!state.treeData || !state.treeData.rawData) {
        console.warn('[GenerationModeUI] No existing tree data to merge into');
        return;
    }
    
    // Update the school in the raw data
    state.treeData.rawData.schools[schoolName] = schoolTree;
    
    // Re-parse the full tree
    if (typeof loadTreeData === 'function') {
        loadTreeData(state.treeData.rawData);
    } else if (typeof TreeParser !== 'undefined') {
        var result = TreeParser.parse(state.treeData.rawData);
        if (result.success) {
            state.treeData = result;
            state.treeData.rawData = state.treeData.rawData;
        }
    }
    
    // Save updated tree
    if (window.callCpp) {
        window.callCpp('SaveSpellTree', JSON.stringify(state.treeData.rawData));
    }
    
    console.log('[GenerationModeUI] Merged ' + schoolName + ' into tree');
}

function hideSchoolControlPanels() {
    var section = document.getElementById('schoolControlsSection');
    if (section) section.classList.add('hidden');
}

// =============================================================================
// EXPORTS
// =============================================================================

window.initGenerationModeUI = initGenerationModeUI;
window.getGenerationOptions = getGenerationOptions;
window.showSchoolControlPanels = showSchoolControlPanels;
window.hideSchoolControlPanels = hideSchoolControlPanels;
window.toggleSchoolPanel = toggleSchoolPanel;
window.collapseAllSchoolPanels = collapseAllSchoolPanels;
window.updateSchoolSliderValue = updateSchoolSliderValue;
window.rerunSchool = rerunSchool;
window.getSchoolConfig = getSchoolConfig;
window.getAutoConfigPrompt = getAutoConfigPrompt;
window.getGroupPrompt = getGroupPrompt;
window.selectAllSchools = selectAllSchools;
window.regenerateSelectedSchools = regenerateSelectedSchools;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGenerationModeUI);
} else {
    initGenerationModeUI();
}
