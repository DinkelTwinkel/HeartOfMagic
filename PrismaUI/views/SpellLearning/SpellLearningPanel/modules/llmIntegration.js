/**
 * LLM Integration Module
 * Handles LLM-driven tree generation and AI features
 * 
 * Depends on:
 * - modules/state.js (state, settings)
 * - modules/growthDSL.js (GROWTH_DSL)
 * - modules/wheelRenderer.js (WheelRenderer)
 * - modules/treeParser.js (TreeParser)
 * - modules/colorUtils.js (detectAllSchools, getOrAssignSchoolColor)
 * - modules/uiHelpers.js (updateStatus, setStatusIcon)
 * 
 * Exports (global):
 * - initializeLLMAPI()
 * - onGenerateTrees()
 * - onGenerateGrowthStyles()
 * - suggestSchoolColorsWithLLM()
 */

// =============================================================================
// LLM INTEGRATION
// =============================================================================

// Helper to append progress messages to output textarea
function appendToOutput(message) {
    var outputArea = document.getElementById('outputArea');
    if (!outputArea) return;
    
    var timestamp = new Date().toLocaleTimeString();
    var line = '[' + timestamp + '] ' + message + '\n';
    
    // Append to output
    outputArea.value += line;
    
    // Auto-scroll to bottom
    outputArea.scrollTop = outputArea.scrollHeight;
    
    // Update char count
    if (typeof updateCharCount === 'function') {
        updateCharCount();
    }
}

// Clear output and set initial message
function clearOutputWithMessage(message) {
    var outputArea = document.getElementById('outputArea');
    if (!outputArea) return;
    
    outputArea.value = message ? message + '\n' : '';
    
    // Update char count
    if (typeof updateCharCount === 'function') {
        updateCharCount();
    }
}

function checkLLMAvailability() {
    console.log('[SpellLearning] Checking LLM availability...');
    if (window.callCpp) {
        window.callCpp('CheckLLM', '');
    } else {
        console.log('[SpellLearning] window.callCpp not available yet');
        // Retry after a short delay
        setTimeout(checkLLMAvailability, 500);
    }
}

/**
 * Send a correction request to the LLM with info about unreachable nodes
 * The LLM will attempt to fix the tree structure while preserving intent
 */
function sendCorrectionRequest(schoolName, originalResponse, reachabilityInfo) {
    console.log('[SpellLearning] Sending correction request for ' + schoolName);
    
    // Build a detailed description of the issues
    var issuesList = reachabilityInfo.unreachable.map(function(node) {
        var blocking = node.blockingPrereqs.length > 0 
            ? ' (blocked by unreachable prereqs: ' + node.blockingPrereqs.join(', ') + ')'
            : ' (has no path to root)';
        return '- ' + node.formId + ' "' + node.name + '" tier ' + node.tier + blocking;
    }).join('\n');
    
    var correctionPrompt = 'Your previous response had ' + reachabilityInfo.unreachable.length + ' unreachable spells out of ' + reachabilityInfo.total + ' total.\n\n' +
        '## UNREACHABLE NODES\n' + issuesList + '\n\n' +
        '## WHAT WENT WRONG\n' +
        'These spells cannot be unlocked because their prerequisites form cycles or reference other unreachable spells.\n' +
        'Remember: Every spell must have a valid path from root. If spell A requires spell B, then B must be reachable from root.\n\n' +
        '## YOUR TASK\n' +
        'Fix ONLY the prerequisites of the unreachable spells. Keep all other spells unchanged.\n' +
        'Options for each unreachable spell:\n' +
        '1. Change its prerequisites to point to REACHABLE spells of lower tier\n' +
        '2. Remove one or more blocking prerequisites\n' +
        '3. Add an additional prerequisite to a reachable spell (for convergence)\n\n' +
        '## YOUR PREVIOUS RESPONSE\n' + originalResponse + '\n\n' +
        '## CORRECTED OUTPUT\n' +
        'Return the COMPLETE corrected JSON (same format as before). Only modify the unreachable nodes\' prerequisites.';
    
    // Get prompt rules
    var promptRules = '';
    if (typeof getTreeRulesPrompt === 'function') {
        promptRules = getTreeRulesPrompt();
    }
    
    // Prepare request with correction flag
    var request = {
        school: schoolName,
        spellData: '', // Not needed for correction
        promptRules: promptRules,
        model: state.llmConfig.model || 'anthropic/claude-sonnet-4',
        maxTokens: state.llmConfig.maxTokens || 4096,
        apiKey: state.llmConfig.apiKey,
        // Mark as correction request
        isCorrection: true,
        correctionPrompt: correctionPrompt,
        // Settings
        allowMultiplePrereqs: settings.allowLLMMultiplePrereqs,
        aggressiveValidation: settings.aggressivePathValidation
    };
    
    appendToOutput('>>> CORRECTION: ' + schoolName + ' (fixing ' + reachabilityInfo.unreachable.length + ' nodes)');
    
    if (window.callCpp) {
        window.callCpp('LLMGenerate', JSON.stringify(request));
    }
}

/**
 * Send a correction request to add missing spells to the tree
 * @param {string} schoolName - Name of the school
 * @param {string} originalResponse - The LLM's previous response
 * @param {Array} missingSpells - Array of spell objects that were not included
 * @param {number} totalExpected - Total number of spells expected
 */
function sendMissingSpellsCorrectionRequest(schoolName, originalResponse, missingSpells, totalExpected) {
    console.log('[SpellLearning] Sending missing spells correction for ' + schoolName + ' (' + missingSpells.length + ' missing)');
    
    // Build list of missing spells with their details
    var missingList = missingSpells.map(function(spell) {
        return '- ' + spell.formId + ' "' + spell.name + '" (' + spell.skillLevel + ')';
    }).join('\n');
    
    var correctionPrompt = 'Your previous response for ' + schoolName + ' included only ' + 
        (totalExpected - missingSpells.length) + ' out of ' + totalExpected + ' spells.\n\n' +
        '## CRITICAL: ' + missingSpells.length + ' SPELLS ARE MISSING\n\n' +
        'These spells from the input were NOT included in your output:\n' + missingList + '\n\n' +
        '## YOUR TASK\n' +
        'You MUST include ALL spells. Return the COMPLETE corrected JSON with ALL ' + totalExpected + ' spells.\n' +
        'Add the missing spells to appropriate locations in the tree based on their skill level:\n' +
        '- Novice spells: tier 1-2, can branch from root or other Novice\n' +
        '- Apprentice spells: tier 2-3, require Novice prereqs\n' +
        '- Adept spells: tier 3-4, require Apprentice prereqs\n' +
        '- Expert spells: tier 4-5, require Adept prereqs\n' +
        '- Master spells: tier 5-6, require Expert prereqs\n\n' +
        '## MISSING SPELL DATA (for reference)\n' +
        JSON.stringify(missingSpells, null, 2) + '\n\n' +
        '## YOUR PREVIOUS (INCOMPLETE) RESPONSE\n' + originalResponse + '\n\n' +
        '## CORRECTED OUTPUT\n' +
        'Return the COMPLETE JSON with ALL ' + totalExpected + ' spells included.';
    
    // Prepare request
    var request = {
        school: schoolName,
        spellData: '', // Not needed for correction
        promptRules: typeof getTreeRulesPrompt === 'function' ? getTreeRulesPrompt() : '',
        model: state.llmConfig.model || 'anthropic/claude-sonnet-4',
        maxTokens: state.llmConfig.maxTokens || 64000,
        apiKey: state.llmConfig.apiKey,
        isCorrection: true,
        correctionPrompt: correctionPrompt,
        allowMultiplePrereqs: settings.allowLLMMultiplePrereqs,
        aggressiveValidation: settings.aggressivePathValidation
    };
    
    appendToOutput('>>> CORRECTION: ' + schoolName + ' (adding ' + missingSpells.length + ' missing spells)');
    
    if (window.callCpp) {
        window.callCpp('LLMGenerate', JSON.stringify(request));
    }
}

/**
 * Find spells from expected list that are missing from the response
 * @param {Object} treeData - Parsed tree data from LLM
 * @param {string} schoolName - School being validated
 * @param {Array} expectedFormIds - Array of expected formIds
 * @param {Array} fullSpellData - Full spell objects for missing spell lookup
 * @returns {Object} { valid: boolean, missing: Array, received: number, expected: number }
 */
function findMissingSpells(treeData, schoolName, expectedFormIds, fullSpellData) {
    var receivedFormIds = [];
    
    // Collect all formIds from the response
    if (treeData.schools && treeData.schools[schoolName] && treeData.schools[schoolName].nodes) {
        receivedFormIds = treeData.schools[schoolName].nodes.map(function(node) {
            return node.formId;
        });
    }
    
    // Find missing formIds
    var missingFormIds = expectedFormIds.filter(function(id) {
        return receivedFormIds.indexOf(id) === -1;
    });
    
    // Get full spell objects for missing spells
    var missingSpells = [];
    if (missingFormIds.length > 0 && fullSpellData) {
        missingSpells = fullSpellData.filter(function(spell) {
            return missingFormIds.indexOf(spell.formId) !== -1;
        });
    }
    
    return {
        valid: missingFormIds.length === 0,
        missing: missingSpells,
        missingFormIds: missingFormIds,
        received: receivedFormIds.length,
        expected: expectedFormIds.length
    };
}

window.onLLMStatus = function(statusStr) {
    console.log('[SpellLearning] LLM status raw:', statusStr);
    
    var status;
    try {
        status = typeof statusStr === 'string' ? JSON.parse(statusStr) : statusStr;
    } catch (e) {
        console.error('[SpellLearning] Failed to parse LLM status:', e);
        return;
    }
    
    console.log('[SpellLearning] LLM status parsed:', status);
    state.llmAvailable = status.available;
    
    console.log('[SpellLearning] API status updated, available:', status.available);
};

// Full Auto: Called after scan completes to start tree generation
function startFullAutoGenerate() {
    if (!state.lastSpellData) {
        updateStatus('No spell data - scan failed');
        setStatusIcon('*');
        resetFullAutoButton();
        return;
    }
    
    var spellData = state.lastSpellData;
    
    if (!spellData || !spellData.spells || !Array.isArray(spellData.spells)) {
        updateStatus('No spells found in scan data');
        setStatusIcon('*');
        resetFullAutoButton();
        return;
    }
    
    console.log('[SpellLearning] Full Auto: Processing ' + spellData.spells.length + ' spells');
    
    // Group spells by school - dynamically handle ALL schools found in data
    var schoolSpells = {};
    var HEDGE_WIZARD = 'Hedge Wizard';  // Catch-all for spells without a school
    
    spellData.spells.forEach(function(spell) {
        var school = spell.school;
        
        // Handle null/undefined/empty schools -> Hedge Wizard
        if (!school || school === '' || school === 'null' || school === 'undefined' || school === 'None') {
            school = HEDGE_WIZARD;
            spell.school = HEDGE_WIZARD;  // Update the spell's school for tree generation
        }
        
        // Dynamically create school group if it doesn't exist
        if (!schoolSpells[school]) {
            schoolSpells[school] = [];
        }
        schoolSpells[school].push(spell);
    });
    
    // Log Hedge Wizard spells
    if (schoolSpells[HEDGE_WIZARD] && schoolSpells[HEDGE_WIZARD].length > 0) {
        console.log('[SpellLearning] ' + schoolSpells[HEDGE_WIZARD].length + ' miscellaneous spells assigned to Hedge Wizard:', 
            schoolSpells[HEDGE_WIZARD].slice(0, 5).map(function(s) { return s.name || s.formId; }).join(', ') + 
            (schoolSpells[HEDGE_WIZARD].length > 5 ? '...' : ''));
        
        // Ensure Hedge Wizard has a color
        if (!settings.schoolColors[HEDGE_WIZARD]) {
            settings.schoolColors[HEDGE_WIZARD] = '#9ca3af';  // Gray - for miscellaneous
            applySchoolColorsToCSS();
        }
    }
    
    // Build queue
    state.llmQueue = [];
    state.llmStats = {
        totalSpells: 0,
        processedSpells: 0,
        failedSchools: [],
        successSchools: [],
        needsAttentionSchools: []  // Schools with unreachable nodes after auto-fix
    };
    
    var schoolCount = 0;
    for (var school in schoolSpells) {
        if (schoolSpells[school].length > 0) {
            state.llmQueue.push({
                school: school,
                spells: schoolSpells[school]
            });
            state.llmStats.totalSpells += schoolSpells[school].length;
            schoolCount++;
        }
    }
    
    console.log('[SpellLearning] Found ' + schoolCount + ' schools:', Object.keys(schoolSpells).join(', '));
    
    if (state.llmQueue.length === 0) {
        updateStatus('No spells to process');
        setStatusIcon('*');
        resetFullAutoButton();
        return;
    }
    
    console.log('[SpellLearning] Full Auto: Queued ' + schoolCount + ' schools');
    state.llmGenerating = true;
    
    // Clear output and show generation header
    clearOutputWithMessage('=== TREE GENERATION STARTED ===');
    appendToOutput('Schools to generate: ' + schoolCount);
    appendToOutput('Total spells: ' + state.llmStats.totalSpells);
    appendToOutput('Model: ' + getEffectiveModel());
    appendToOutput('');
    
    // Process first school
    processNextLLMSchool();
}

function resetFullAutoButton() {
    state.fullAutoMode = false;
    var fullAutoBtn = document.getElementById('fullAutoBtn');
    if (fullAutoBtn) {
        // Show retry option if there were failures
        if (state.lastFailedSchools && state.lastFailedSchools.length > 0) {
            fullAutoBtn.disabled = false;
            fullAutoBtn.innerHTML = '<span class="btn-icon">ðŸ”„</span> Retry Failed (' + state.lastFailedSchools.length + ')';
            fullAutoBtn.onclick = retryFailedSchools;
        } else {
            fullAutoBtn.disabled = false;
            fullAutoBtn.innerHTML = '<span class="btn-icon">ðŸš€</span> Full Auto';
            fullAutoBtn.onclick = onFullAutoClick;
        }
    }
}

function retryFailedSchools() {
    if (!state.lastFailedSchools || state.lastFailedSchools.length === 0) {
        updateStatus('No failed schools to retry');
        return;
    }
    
    if (!state.lastSpellData || !state.lastSpellData.spells) {
        updateStatus('No spell data - run Full Auto first');
        return;
    }
    
    console.log('[SpellLearning] Retrying failed schools:', state.lastFailedSchools.join(', '));
    
    // Disable button during retry
    var fullAutoBtn = document.getElementById('fullAutoBtn');
    if (fullAutoBtn) {
        fullAutoBtn.disabled = true;
        fullAutoBtn.innerHTML = '<span class="btn-icon">â³</span> Retrying...';
    }
    
    // Build queue from failed schools
    state.llmQueue = [];
    state.llmStats = {
        totalSpells: 0,
        processedSpells: 0,
        failedSchools: [],
        successSchools: state.llmStats.successSchools || [],  // Keep previous successes
        needsAttentionSchools: []  // Schools with unreachable nodes after auto-fix
    };
    
    state.lastFailedSchools.forEach(function(school) {
        var spells = state.lastSpellData.spells.filter(function(s) { return s.school === school; });
        if (spells.length > 0) {
            state.llmQueue.push({ school: school, spells: spells });
            state.llmStats.totalSpells += spells.length;
        }
    });
    
    if (state.llmQueue.length === 0) {
        updateStatus('No spells found for failed schools');
        resetFullAutoButton();
        return;
    }
    
    state.lastFailedSchools = [];  // Clear the retry list
    state.llmGenerating = true;
    state.fullAutoMode = true;
    
    updateStatus('Retrying ' + state.llmQueue.length + ' failed school(s)...');
    
    // Start processing
    processNextLLMSchool();
}

/**
 * Retry generation for a specific school (used for "needs attention" schools)
 * @param {string} schoolName - Name of the school to retry
 */
function retrySpecificSchool(schoolName) {
    if (!schoolName) {
        console.warn('[SpellLearning] retrySpecificSchool: No school name provided');
        return;
    }
    
    if (state.llmGenerating) {
        console.warn('[SpellLearning] Generation already in progress');
        return;
    }
    
    if (!state.lastSpellData || !state.lastSpellData.spells) {
        setTreeStatus('No spell data - run Full Auto first');
        return;
    }
    
    // Find spells for this school
    var spells = state.lastSpellData.spells.filter(function(s) { 
        return s.school === schoolName; 
    });
    
    if (spells.length === 0) {
        setTreeStatus('No spells found for school: ' + schoolName);
        return;
    }
    
    console.log('[SpellLearning] Retrying specific school: ' + schoolName + ' (' + spells.length + ' spells)');
    
    // Clear the output and show retry message
    clearOutputWithMessage('=== RETRY: ' + schoolName + ' ===');
    appendToOutput('Regenerating tree for ' + schoolName + ' with ' + spells.length + ' spells...');
    appendToOutput('');
    
    // Initialize stats for single school retry
    state.llmQueue = [{ school: schoolName, spells: spells }];
    state.llmStats = {
        totalSpells: spells.length,
        processedSpells: 0,
        failedSchools: [],
        successSchools: state.llmStats.successSchools.filter(function(s) { return s !== schoolName; }), // Remove this school from success
        needsAttentionSchools: state.llmStats.needsAttentionSchools.filter(function(s) { return s.school !== schoolName; }) // Remove from needs attention
    };
    
    state.llmGenerating = true;
    state.llmCorrectionCount = 0;
    state.llmRetryCount = 0;
    
    // Disable buttons during retry
    var btn = document.getElementById('llm-auto-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">⏳</span> Retrying ' + schoolName + '...';
    }
    
    // Start processing
    processNextLLMSchool();
}

// Make retrySpecificSchool available globally for UI buttons
window.retrySpecificSchool = retrySpecificSchool;

/**
 * Get list of schools that need attention (have unreachable nodes)
 * @returns {Array} Array of school info objects
 */
function getSchoolsNeedingAttention() {
    return state.lastNeedsAttentionSchools || [];
}

// Make available globally
window.getSchoolsNeedingAttention = getSchoolsNeedingAttention;

function startLLMAutoGenerate() {
    // First, check if we have spell data
    if (!state.lastSpellData) {
        setTreeStatus('Scan spells first (Spell Scan tab)');
        return;
    }
    
    console.log('[SpellLearning] Starting LLM auto-generation');
    
    // state.lastSpellData is already a parsed object (set in updateSpellData)
    var spellData = state.lastSpellData;
    
    if (!spellData || !spellData.spells || !Array.isArray(spellData.spells)) {
        setTreeStatus('No spells found - rescan spells');
        return;
    }
    
    console.log('[SpellLearning] Found ' + spellData.spells.length + ' spells to process');
    
    // Group spells by school - dynamically handle ALL schools
    var schoolSpells = {};
    var HEDGE_WIZARD = 'Hedge Wizard';
    
    spellData.spells.forEach(function(spell) {
        var school = spell.school;
        
        // Handle null/undefined/empty schools -> Hedge Wizard
        if (!school || school === '' || school === 'null' || school === 'undefined' || school === 'None') {
            school = HEDGE_WIZARD;
            spell.school = HEDGE_WIZARD;
        }
        
        if (!schoolSpells[school]) {
            schoolSpells[school] = [];
        }
        schoolSpells[school].push(spell);
    });
    
    // Ensure Hedge Wizard has a color
    if (schoolSpells[HEDGE_WIZARD] && schoolSpells[HEDGE_WIZARD].length > 0) {
        if (!settings.schoolColors[HEDGE_WIZARD]) {
            settings.schoolColors[HEDGE_WIZARD] = '#9ca3af';
            applySchoolColorsToCSS();
        }
    }
    
    // Build queue of schools with spells
    state.llmQueue = [];
    state.llmStats = {
        totalSpells: 0,
        processedSpells: 0,
        failedSchools: [],
        successSchools: [],
        needsAttentionSchools: []  // Schools with unreachable nodes after auto-fix
    };
    
    for (var school in schoolSpells) {
        if (schoolSpells[school].length > 0) {
            state.llmQueue.push({
                school: school,
                spells: schoolSpells[school]
            });
            state.llmStats.totalSpells += schoolSpells[school].length;
        }
    }
    
    if (state.llmQueue.length === 0) {
        setTreeStatus('No spells to process');
        return;
    }
    
    console.log('[SpellLearning] Queued ' + state.llmQueue.length + ' schools: ' + 
                Object.keys(schoolSpells).join(', ') + ' (' + state.llmStats.totalSpells + ' total spells)');
    
    state.llmGenerating = true;
    
    // Disable the button during generation
    var btn = document.getElementById('llm-auto-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">â³</span> Generating...';
    }
    
    // Start processing first school
    processNextLLMSchool();
}

function processNextLLMSchool() {
    if (state.llmQueue.length === 0) {
        // All done
        finishLLMGeneration();
        return;
    }
    
    var schoolData = state.llmQueue.shift();
    state.llmCurrentSchool = schoolData.school;
    
    // Track expected spell IDs for validation after response
    state.llmExpectedSpellIds = schoolData.spells.map(function(s) { return s.formId; });
    state.llmExpectedSpellCount = schoolData.spells.length;
    state.llmCurrentSpells = schoolData.spells; // Keep full spell data for correction requests
    
    var step = state.llmStats.successSchools.length + state.llmStats.failedSchools.length + 1;
    var remaining = state.llmQueue.length;
    var total = step + remaining;
    
    var progressMsg = 'Generating ' + schoolData.school + ' (' + schoolData.spells.length + ' spells)...';
    
    // Update both status areas
    setTreeStatus(progressMsg);
    if (state.fullAutoMode) {
        updateStatus('Step 2/3: ' + schoolData.school + ' (' + step + '/' + total + ' schools)');
    }
    
    // Output to textarea for visibility
    appendToOutput('>>> SENDING: ' + schoolData.school + ' (' + schoolData.spells.length + ' spells) [' + step + '/' + total + ']');
    
    console.log('[SpellLearning] Processing ' + schoolData.school + ' with ' + schoolData.spells.length + ' spells');
    
    // Get prompt rules
    var promptRules = getTreeRulesPrompt();
    
    // Prepare request with all LLM settings
    var request = {
        school: schoolData.school,
        spellData: JSON.stringify(schoolData.spells),
        promptRules: promptRules,
        model: getEffectiveModel(),
        maxTokens: state.llmConfig.maxTokens || 4096,
        apiKey: state.llmConfig.apiKey,
        // Tree generation settings
        allowMultiplePrereqs: settings.allowLLMMultiplePrereqs,
        aggressiveValidation: settings.aggressivePathValidation,
        // LLM self-correction settings
        selfCorrection: settings.llmSelfCorrection,
        selfCorrectionMaxLoops: settings.llmSelfCorrectionMaxLoops
    };
    
    console.log('[SpellLearning] Generating ' + schoolData.school + ' with model:', request.model, 'maxTokens:', request.maxTokens);
    appendToOutput('    Model: ' + request.model + ', Max Tokens: ' + request.maxTokens);
    
    if (window.callCpp) {
        window.callCpp('LLMGenerate', JSON.stringify(request));
    }
}

window.onLLMQueued = function(responseStr) {
    console.log('[SpellLearning] LLM request queued raw:', responseStr);
    
    var response;
    try {
        response = typeof responseStr === 'string' ? JSON.parse(responseStr) : responseStr;
    } catch (e) {
        console.error('[SpellLearning] Failed to parse queued response:', e);
        setTreeStatus('Error parsing response');
        return;
    }
    
    console.log('[SpellLearning] LLM request queued parsed:', response);
    setTreeStatus(response.school + ': ' + response.message);
    
    // Start polling for response
    if (state.llmPollInterval) {
        clearInterval(state.llmPollInterval);
    }
    
    state.llmPollInterval = setInterval(function() {
        if (window.callCpp) {
            window.callCpp('PollLLMResponse', '');
        }
    }, 2000); // Poll every 2 seconds
};

window.onLLMPollResult = function(resultStr) {
    var result;
    try {
        result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
    } catch (e) {
        console.error('[SpellLearning] Failed to parse poll result:', e);
        return;
    }
    
    if (!result.hasResponse) {
        return; // Keep waiting
    }
    
    // Stop polling
    if (state.llmPollInterval) {
        clearInterval(state.llmPollInterval);
        state.llmPollInterval = null;
    }
    
    console.log('[SpellLearning] Got LLM response, success=' + result.success + ', currentSchool=' + state.llmCurrentSchool);
    
    // Ignore stray responses when not expecting any
    if (!state.llmCurrentSchool) {
        console.warn('[SpellLearning] Received response but no current school - ignoring stray response');
        return;
    }
    
    // Check if this is a color suggestion response
    if (state.llmCurrentSchool === '_ColorSuggestion') {
        console.log('[SpellLearning] Routing to color suggestion handler');
        if (typeof handleColorSuggestionResponse === 'function') {
            handleColorSuggestionResponse(result);
        }
        state.llmCurrentSchool = null;
        // Continue with next school in queue if any
        setTimeout(processNextLLMSchool, 500);
        return;
    }
    
    if (result.success === 1 && result.response) {
        // Try to parse and import the tree
        try {
            var treeData = JSON.parse(result.response);
            
            // Count spells in response and log layout style
            var spellCount = 0;
            var layoutStyle = 'radial';
            if (treeData.schools) {
                for (var school in treeData.schools) {
                    if (treeData.schools[school].nodes) {
                        spellCount += treeData.schools[school].nodes.length;
                    }
                    if (treeData.schools[school].layoutStyle) {
                        layoutStyle = treeData.schools[school].layoutStyle;
                    }
                }
            }
            
            state.llmStats.processedSpells += spellCount;
            // Note: successSchools is pushed AFTER validation (see below) to avoid duplicates during correction
            
            console.log('[SpellLearning] ' + state.llmCurrentSchool + ': ' + spellCount + ' spells, layout: ' + layoutStyle);
            
            // Output to textarea
            appendToOutput('<<< RECEIVED: ' + state.llmCurrentSchool + ' - SUCCESS');
            appendToOutput('    Spells: ' + spellCount + ', Layout: ' + layoutStyle);
            appendToOutput('    Response size: ' + (result.response.length / 1024).toFixed(1) + ' KB');
            
            // Merge with existing tree
            if (state.treeData && state.treeData.success && state.treeData.rawData) {
                treeData = mergeTreeData(state.treeData.rawData, treeData);
            }
            
            // Parse temporarily to check for unreachable nodes (before full loadTreeData)
            var tempParseResult = TreeParser.parse(treeData);
            
            // Check for unreachable nodes and attempt self-correction if enabled
            if (tempParseResult.success && settings.llmSelfCorrection) {
                var schoolData = TreeParser.schools[state.llmCurrentSchool];
                if (schoolData && schoolData.root) {
                    var reachabilityInfo = TreeParser.getUnreachableNodesInfo(state.llmCurrentSchool, schoolData.root);
                    
                    if (!reachabilityInfo.valid && reachabilityInfo.unreachable.length > 0) {
                        // Initialize correction count if needed
                        state.llmCorrectionCount = state.llmCorrectionCount || 0;
                        
                        if (state.llmCorrectionCount < settings.llmSelfCorrectionMaxLoops) {
                            state.llmCorrectionCount++;
                            
                            appendToOutput('    VALIDATION: ' + reachabilityInfo.unreachable.length + ' unreachable nodes detected');
                            appendToOutput('    Requesting LLM self-correction (attempt ' + state.llmCorrectionCount + '/' + settings.llmSelfCorrectionMaxLoops + ')...');
                            
                            console.log('[SpellLearning] Self-correction attempt ' + state.llmCorrectionCount + ' for ' + state.llmCurrentSchool);
                            
                            // Send correction request
                            sendCorrectionRequest(state.llmCurrentSchool, result.response, reachabilityInfo);
                            return; // Don't proceed to next school yet
                        } else {
                            appendToOutput('    VALIDATION: Max correction loops reached (' + settings.llmSelfCorrectionMaxLoops + ')');
                            appendToOutput('    ERROR: ' + reachabilityInfo.unreachable.length + ' spells are unreachable - tree needs regeneration');
                            console.log('[SpellLearning] Max self-correction loops reached, tree has unreachable nodes');

                            // Log the issue (no auto-fix)
                            TreeParser.detectAndFixCycles(state.llmCurrentSchool, schoolData.root);

                            // Track for retry
                            if (reachabilityInfo.unreachable.length > 0) {
                                appendToOutput('    Unreachable: ' + reachabilityInfo.unreachable.map(function(n) { return n.name || n.id; }).slice(0, 5).join(', '));
                                if (reachabilityInfo.unreachable.length > 5) {
                                    appendToOutput('    ... and ' + (reachabilityInfo.unreachable.length - 5) + ' more');
                                }
                                state.llmStats.needsAttentionSchools.push({
                                    school: state.llmCurrentSchool,
                                    unreachableCount: reachabilityInfo.unreachable.length,
                                    unreachableNodes: reachabilityInfo.unreachable.map(function(n) { return n.name || n.id; })
                                });
                                console.log('[SpellLearning] ' + state.llmCurrentSchool + ' needs attention: ' + postFixInfo.unreachable.length + ' unreachable');
                            } else {
                                appendToOutput('    AUTO-FIX: SUCCESS - all nodes now reachable!');
                            }
                        }
                    } else {
                        appendToOutput('    VALIDATION: Tree is valid - all nodes reachable!');
                    }
                }
            }
            
            // =====================================================================
            // MISSING SPELL VALIDATION
            // Check if all expected spells are present in the response
            // =====================================================================
            if (state.llmExpectedSpellIds && state.llmExpectedSpellIds.length > 0) {
                var missingInfo = findMissingSpells(
                    treeData, 
                    state.llmCurrentSchool, 
                    state.llmExpectedSpellIds,
                    state.llmCurrentSpells
                );
                
                if (!missingInfo.valid && missingInfo.missing.length > 0) {
                    appendToOutput('    SPELL COUNT: ' + missingInfo.received + '/' + missingInfo.expected + ' spells');
                    
                    // Initialize missing spell correction count if needed
                    state.llmMissingCorrectionCount = state.llmMissingCorrectionCount || 0;
                    
                    // Try to correct missing spells (up to 3 attempts)
                    var maxMissingCorrections = 3;
                    if (state.llmMissingCorrectionCount < maxMissingCorrections) {
                        state.llmMissingCorrectionCount++;
                        
                        appendToOutput('    WARNING: ' + missingInfo.missing.length + ' spells missing from response!');
                        appendToOutput('    Requesting LLM to add missing spells (attempt ' + 
                            state.llmMissingCorrectionCount + '/' + maxMissingCorrections + ')...');
                        
                        console.log('[SpellLearning] Missing spell correction attempt ' + 
                            state.llmMissingCorrectionCount + ' for ' + state.llmCurrentSchool);
                        
                        // Send correction request with missing spells
                        sendMissingSpellsCorrectionRequest(
                            state.llmCurrentSchool, 
                            result.response, 
                            missingInfo.missing,
                            missingInfo.expected
                        );
                        return; // Don't proceed to next school yet
                    } else {
                        // Max corrections reached - log warning and continue
                        appendToOutput('    WARNING: Max missing spell corrections reached (' + maxMissingCorrections + ')');
                        appendToOutput('    ' + missingInfo.missing.length + ' spells still missing - continuing with partial tree');
                        console.warn('[SpellLearning] ' + state.llmCurrentSchool + ' has ' + 
                            missingInfo.missing.length + ' missing spells after ' + maxMissingCorrections + ' correction attempts');
                        
                        // Track as needs attention
                        state.llmStats.needsAttentionSchools.push({
                            school: state.llmCurrentSchool,
                            missingCount: missingInfo.missing.length,
                            missingSpells: missingInfo.missing.slice(0, 10).map(function(s) { return s.name; }) // First 10 names
                        });
                    }
                } else {
                    appendToOutput('    SPELL COUNT: ' + missingInfo.received + '/' + missingInfo.expected + ' - All spells included!');
                }
            }
            
            // Reset correction counts on successful validation
            state.llmCorrectionCount = 0;
            state.llmMissingCorrectionCount = 0;
            
            // Add to successSchools AFTER validation (avoid duplicates from correction loops)
            if (state.llmStats.successSchools.indexOf(state.llmCurrentSchool) === -1) {
                state.llmStats.successSchools.push(state.llmCurrentSchool);
            }
            
            loadTreeData(treeData);
            var statusSuffix = '';
            if (state.llmStats.needsAttentionSchools.some(function(s) { return s.school === state.llmCurrentSchool; })) {
                statusSuffix = ' (needs attention)';
            }
            setTreeStatus(state.llmCurrentSchool + ' imported (' + spellCount + ' spells)' + statusSuffix);
            state.llmRetryCount = 0;  // Reset retry counter on success
            
        } catch (e) {
            console.error('[SpellLearning] Failed to parse tree response for ' + state.llmCurrentSchool + ':', e);
            console.error('[SpellLearning] Raw response (first 500 chars):', result.response ? result.response.substring(0, 500) : 'empty');
            
            // Output failure to textarea
            appendToOutput('<<< RECEIVED: ' + state.llmCurrentSchool + ' - PARSE ERROR');
            appendToOutput('    Error: ' + e.message);
            
            // Retry logic
            state.llmRetryCount = (state.llmRetryCount || 0) + 1;
            if (state.llmRetryCount < 2) {
                console.log('[SpellLearning] Retrying ' + state.llmCurrentSchool + ' (attempt ' + (state.llmRetryCount + 1) + ')...');
                setTreeStatus(state.llmCurrentSchool + ' failed to parse, retrying...');
                appendToOutput('    Retrying... (attempt ' + (state.llmRetryCount + 1) + ')');
                
                // Re-queue this school at the front
                var retrySchool = state.llmCurrentSchool;
                var retrySpells = state.lastSpellData.spells.filter(function(s) { return s.school === retrySchool; });
                state.llmQueue.unshift({ school: retrySchool, spells: retrySpells });
                
                // Longer delay before retry
                setTimeout(processNextLLMSchool, 3000);
                return;
            }
            
            state.llmStats.failedSchools.push(state.llmCurrentSchool);
            setTreeStatus(state.llmCurrentSchool + ' failed: invalid JSON after ' + state.llmRetryCount + ' attempts');
            appendToOutput('    FAILED after ' + state.llmRetryCount + ' attempts');
            state.llmRetryCount = 0;
        }
    } else {
        console.error('[SpellLearning] ' + state.llmCurrentSchool + ' request failed:', result.response || 'unknown error');
        
        // Output failure to textarea
        appendToOutput('<<< RECEIVED: ' + state.llmCurrentSchool + ' - REQUEST FAILED');
        appendToOutput('    Error: ' + (result.response || 'unknown error'));
        
        // Retry logic for failed requests
        state.llmRetryCount = (state.llmRetryCount || 0) + 1;
        if (state.llmRetryCount < 2) {
            console.log('[SpellLearning] Retrying ' + state.llmCurrentSchool + ' (attempt ' + (state.llmRetryCount + 1) + ')...');
            setTreeStatus(state.llmCurrentSchool + ' failed, retrying...');
            appendToOutput('    Retrying... (attempt ' + (state.llmRetryCount + 1) + ')');
            
            // Re-queue this school at the front
            var retrySchool = state.llmCurrentSchool;
            var retrySpells = state.lastSpellData.spells.filter(function(s) { return s.school === retrySchool; });
            state.llmQueue.unshift({ school: retrySchool, spells: retrySpells });
            
            // Longer delay before retry
            setTimeout(processNextLLMSchool, 3000);
            return;
        }
        
        state.llmStats.failedSchools.push(state.llmCurrentSchool);
        setTreeStatus(state.llmCurrentSchool + ' failed: ' + (result.response || 'unknown error'));
        appendToOutput('    FAILED after ' + state.llmRetryCount + ' attempts');
        state.llmRetryCount = 0;
    }
    
    // Process next school after a short delay
    setTimeout(processNextLLMSchool, 1000);
}

function finishLLMGeneration() {
    state.llmGenerating = false;
    state.llmCurrentSchool = null;
    state.llmRetryCount = 0;
    
    // Show summary
    var stats = state.llmStats;
    var statusMsg = 'Complete! ' + stats.successSchools.length + ' schools, ' + stats.processedSpells + ' spells';
    
    // Output final summary to textarea
    appendToOutput('');
    appendToOutput('=== GENERATION COMPLETE ===');
    appendToOutput('Successful schools: ' + stats.successSchools.length);
    appendToOutput('  - ' + (stats.successSchools.join(', ') || 'none'));
    appendToOutput('Total spells processed: ' + stats.processedSpells);
    
    if (stats.failedSchools.length > 0) {
        statusMsg += ' | Failed: ' + stats.failedSchools.join(', ');
        // Store failed schools for potential retry
        state.lastFailedSchools = stats.failedSchools.slice();
        appendToOutput('Failed schools: ' + stats.failedSchools.length);
        appendToOutput('  - ' + stats.failedSchools.join(', '));
    } else {
        state.lastFailedSchools = [];
        appendToOutput('Failed schools: 0');
    }
    
    // Report schools that need attention (unreachable nodes after auto-fix)
    if (stats.needsAttentionSchools.length > 0) {
        statusMsg += ' | Needs attention: ' + stats.needsAttentionSchools.length;
        state.lastNeedsAttentionSchools = stats.needsAttentionSchools.slice();
        appendToOutput('');
        appendToOutput('*** NEEDS ATTENTION: ' + stats.needsAttentionSchools.length + ' school(s) have unreachable nodes ***');
        stats.needsAttentionSchools.forEach(function(info) {
            appendToOutput('  - ' + info.school + ': ' + info.unreachableCount + ' unreachable (' + info.unreachableNodes.slice(0, 5).join(', ') + (info.unreachableNodes.length > 5 ? '...' : '') + ')');
        });
        appendToOutput('Use "Retry School" button in Settings > LLM to regenerate specific schools');
    } else {
        state.lastNeedsAttentionSchools = [];
    }
    
    appendToOutput('===========================');
    appendToOutput('');
    
    // Update appropriate UI based on mode
    if (state.fullAutoMode) {
        // Full Auto always runs LLM color suggestion for all detected schools
        var detectedSchools = Object.keys(settings.schoolColors);
        
        updateStatus('Step 3/4: Suggesting colors for ' + detectedSchools.length + ' schools...');
        console.log('[SpellLearning] Full Auto: Running LLM color suggestion for schools:', detectedSchools.join(', '));
        
        suggestSchoolColorsWithLLM(function() {
            // After colors are done, finish up
            updateStatus('Complete! ' + statusMsg);
            // Show warning icon if any failures or needs attention
            var hasProblems = stats.failedSchools.length > 0 || stats.needsAttentionSchools.length > 0;
            setStatusIcon(hasProblems ? '!' : '*');
            resetFullAutoButton();
            
            // Save tree again to ensure it's persisted
            console.log('[SpellLearning] Full Auto complete - final save');
            saveTreeToFile();
            
            // Switch to tree tab to show results
            setTimeout(function() {
                var treeTab = document.getElementById('tabSpellTree');
                if (treeTab) treeTab.click();
            }, 500);
        });
    } else {
        setTreeStatus(statusMsg);
        // Re-enable the generate button (for single school retry)
        var btn = document.getElementById('llm-auto-btn');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">🪄</span> Auto Generate';
        }
    }
    
    console.log('[SpellLearning] Generation complete:', stats);
    
    // Save the combined tree immediately after generation
    saveTreeToFile();
    
    // Update retry school UI to show current status
    if (typeof updateRetrySchoolUI === 'function') {
        updateRetrySchoolUI();
    }
}

// Helper function to save tree - can be called anytime
function saveTreeToFile() {
    if (!state.treeData || !state.treeData.rawData) {
        console.warn('[SpellLearning] No tree data to save');
        return false;
    }
    
    if (!window.callCpp) {
        console.warn('[SpellLearning] Cannot save - callCpp not available');
        return false;
    }
    
    var treeJson = JSON.stringify(state.treeData.rawData);
    console.log('[SpellLearning] Saving tree to file, size:', treeJson.length, 'chars,', 
                Object.keys(state.treeData.rawData.schools || {}).length, 'schools');
    
    window.callCpp('SaveSpellTree', treeJson);
    return true;
}

// Helper function to show/hide divider settings based on toggle state
function updateDividerSettingsVisibility() {
    var fadeRow = document.getElementById('dividerFadeRow');
    var spacingRow = document.getElementById('dividerSpacingRow');
    var colorModeRow = document.getElementById('dividerColorModeRow');
    var isVisible = settings.showSchoolDividers;
    
    if (fadeRow) fadeRow.style.display = isVisible ? '' : 'none';
    if (spacingRow) spacingRow.style.display = isVisible ? '' : 'none';
    if (colorModeRow) colorModeRow.style.display = isVisible ? '' : 'none';
    
    // Also update custom color row visibility
    updateDividerColorRowVisibility();
}

// Helper function to show/hide custom color picker based on color mode
function updateDividerColorRowVisibility() {
    var customColorRow = document.getElementById('dividerCustomColorRow');
    var isVisible = settings.showSchoolDividers && settings.dividerColorMode === 'custom';
    
    if (customColorRow) customColorRow.style.display = isVisible ? '' : 'none';
}

// Initialize Spell Tome Integration settings (DEST bundled)
function initializeISLSettings() {
    // Simple enable toggle - DEST is bundled, always available
    var destEnabledToggle = document.getElementById('islEnabledToggle') || document.getElementById('destEnabledToggle');
    if (destEnabledToggle) {
        destEnabledToggle.checked = settings.islEnabled;
        destEnabledToggle.addEventListener('change', function() {
            settings.islEnabled = this.checked;
            console.log('[SpellLearning] Spell Tome Integration enabled:', settings.islEnabled);
            scheduleAutoSave();
        });
    }
    
    // Update status badge to show "Bundled" since DEST is included
    updateDESTStatus();
}

// Update DEST status badge - always shows "Bundled" since it's included
function updateDESTStatus() {
    var badge = document.getElementById('islDetectionStatus') || document.getElementById('destStatus');
    if (!badge) return;
    
    // DEST is always bundled with this mod
    badge.textContent = 'Bundled';
    badge.classList.remove('not-detected');
    badge.classList.add('detected');
}

// Called from C++ when DEST detection status changes (legacy support)
window.onISLDetectionUpdate = function(detected) {
    // Ignore - DEST is always bundled
    console.log('[SpellLearning] DEST status check (bundled, always available)');
    updateDESTStatus();
};

// New callback name for DEST
window.onDESTDetectionUpdate = function(detected) {
    // Ignore - DEST is always bundled
    console.log('[SpellLearning] DEST status check (bundled, always available)');
    updateDESTStatus();
};

