/**
 * AutoTest Module for SpellLearning
 *
 * Reads a test config file on startup and automatically generates a tree
 * with the specified preset, then saves results for verification.
 *
 * Test Config File: SKSE/Plugins/SpellLearning/test_config.json
 * {
 *   "enabled": true,
 *   "preset": "strict",  // strict, thematic, organic, random
 *   "useSettingsAwareBuilder": true,
 *   "autoGenerate": true,
 *   "saveResults": true
 * }
 */

var AUTO_TEST_CONFIG_PATH = 'test_config.json';
var AUTO_TEST_RESULTS_PATH = 'test_results.json';
var _pendingTestConfig = null;

/**
 * Log to C++ for visibility in SKSE log
 */
function logToCpp(message, level) {
    if (window.callCpp) {
        window.callCpp('LogMessage', JSON.stringify({
            level: level || 'info',
            message: '[AutoTest] ' + message
        }));
    }
    console.log('[AutoTest] ' + message);
}

/**
 * Check for and run auto-test mode
 */
function checkAutoTestMode() {
    console.log('[AutoTest] Checking for test configuration...');

    // Request test config from C++ - response comes via onTestConfigLoaded
    if (window.callCpp) {
        window.callCpp('loadTestConfig', '');
    } else {
        console.log('[AutoTest] C++ bridge not available, skipping auto-test');
    }
}

/**
 * Callback from C++ when test config is loaded
 * This is called via InteropCall from OnLoadTestConfig
 */
function onTestConfigLoaded(configJson) {
    console.log('[AutoTest] Config received from C++');

    try {
        var config;
        if (typeof configJson === 'string') {
            config = JSON.parse(configJson);
        } else {
            config = configJson;
        }

        if (config && config.enabled) {
            console.log('[AutoTest] Test mode ENABLED');
            console.log('[AutoTest] Preset:', config.preset);
            console.log('[AutoTest] Use SettingsAwareBuilder:', config.useSettingsAwareBuilder);
            runAutoTest(config);
        } else {
            console.log('[AutoTest] Test mode disabled or no config found');
        }
    } catch (e) {
        console.error('[AutoTest] Error parsing config:', e);
    }
}

/**
 * Run automatic test with given configuration
 */
function runAutoTest(config) {
    console.log('[AutoTest] Starting automatic test...');
    console.log('[AutoTest] Config:', JSON.stringify(config));

    // Store config for later use
    _pendingTestConfig = config;

    // Apply preset
    var preset = config.preset || 'thematic';
    console.log('[AutoTest] Applying preset:', preset);

    if (typeof applyTreeGenerationPreset === 'function') {
        applyTreeGenerationPreset(preset);
        settings._lastAppliedPreset = preset;
        logToCpp('Applied preset: ' + preset + ', elementIsolation now=' + settings.treeGeneration.elementIsolation);
    } else if (typeof window.applyTreeGenerationPreset === 'function') {
        window.applyTreeGenerationPreset(preset);
        settings._lastAppliedPreset = preset;
        logToCpp('Applied preset: ' + preset + ', elementIsolation now=' + settings.treeGeneration.elementIsolation);
    } else {
        console.error('[AutoTest] applyTreeGenerationPreset not available!');
        return;
    }

    // Apply custom settings overrides (applied AFTER preset)
    if (config.settingsOverrides && settings.treeGeneration) {
        logToCpp('Applying custom settings overrides...');
        for (var key in config.settingsOverrides) {
            if (config.settingsOverrides.hasOwnProperty(key)) {
                var oldVal = settings.treeGeneration[key];
                settings.treeGeneration[key] = config.settingsOverrides[key];
                logToCpp('  Override: ' + key + ' = ' + config.settingsOverrides[key] + ' (was: ' + oldVal + ')');
            }
        }
    }

    // Apply LLM settings from config
    if (settings.treeGeneration && settings.treeGeneration.llm) {
        var llmEnabled = config.llmEnabled === true;
        settings.treeGeneration.llm.enabled = llmEnabled;

        if (llmEnabled) {
            // Enable all LLM features for testing
            settings.treeGeneration.llm.elementDetection = true;
            settings.treeGeneration.llm.themeDiscovery = true;
            settings.treeGeneration.llm.keywordExpansion = true;
            settings.treeGeneration.llm.edgeCases = true;
            settings.treeGeneration.llm.branchAssignment = true;
            logToCpp('LLM features ENABLED for test');
        } else {
            settings.treeGeneration.llm.elementDetection = false;
            settings.treeGeneration.llm.themeDiscovery = false;
            settings.treeGeneration.llm.keywordExpansion = false;
            settings.treeGeneration.llm.edgeCases = false;
            settings.treeGeneration.llm.branchAssignment = false;
            logToCpp('LLM features DISABLED for test');
        }
    }

    // Wait a moment for settings to apply, then check if we have spell data
    setTimeout(function() {
        generateTreeForTest(config);
    }, 500);
}

/**
 * Generate tree using the specified builder
 */
function generateTreeForTest(config) {
    console.log('[AutoTest] Generating tree...');

    // Get spell data
    if (!state || !state.lastSpellData || !state.lastSpellData.spells) {
        console.log('[AutoTest] No spell data loaded, triggering scan...');

        // Request spell scan from C++ - we'll wait for onSpellData callback
        if (window.callCpp) {
            window.callCpp('ScanSpells', '');
            // The scan results will come back via onSpellData
            // We'll resume test generation when that happens
            console.log('[AutoTest] Waiting for spell scan to complete...');
        } else {
            console.error('[AutoTest] No callCpp available!');
            saveTestResults({ error: 'No C++ bridge available' });
        }
    } else {
        continueTestGeneration(config);
    }
}

/**
 * Continue test after spell data is available
 */
function continueTestGeneration(config) {
    logToCpp('continueTestGeneration called');

    if (!state || !state.lastSpellData || !state.lastSpellData.spells) {
        logToCpp('ERROR: Still no spell data!', 'error');
        saveTestResults({ error: 'No spell data available' });
        return;
    }

    var spells = state.lastSpellData.spells;
    logToCpp('Have ' + spells.length + ' spells');

    var treeGenSettings = settings.treeGeneration || {};

    logToCpp('PRESET APPLIED: ' + (settings._lastAppliedPreset || 'unknown'));
    logToCpp('Settings: elementIsolation=' + treeGenSettings.elementIsolation +
             ', strict=' + treeGenSettings.elementIsolationStrict +
             ', tierOrdering=' + treeGenSettings.strictTierOrdering +
             ', linkStrategy=' + treeGenSettings.linkStrategy);

    // Check builder availability
    logToCpp('buildAllTreesSettingsAware available: ' + (typeof buildAllTreesSettingsAware === 'function'));
    logToCpp('buildAllTreesSettingsAwareAsync available: ' + (typeof buildAllTreesSettingsAwareAsync === 'function'));
    logToCpp('generateAllVisualFirstTrees available: ' + (typeof generateAllVisualFirstTrees === 'function'));
    logToCpp('config.useSettingsAwareBuilder: ' + config.useSettingsAwareBuilder);

    // Check if LLM features are enabled
    var llmEnabled = treeGenSettings.llm && treeGenSettings.llm.enabled;
    logToCpp('LLM features enabled: ' + llmEnabled);

    // Use async version if LLM is enabled, otherwise sync
    if (config.useSettingsAwareBuilder && typeof buildAllTreesSettingsAwareAsync === 'function' && llmEnabled) {
        logToCpp('USING SettingsAwareBuilder (async with LLM preprocessing)');
        buildAllTreesSettingsAwareAsync(spells, {}, treeGenSettings, function(treeData) {
            logToCpp('SettingsAwareBuilder returned, generator: ' + (treeData ? treeData.generator : 'null'));
            finishTestGeneration(config, treeData, treeGenSettings);
        });
        return;  // Async path
    } else if (config.useSettingsAwareBuilder && typeof buildAllTreesSettingsAware === 'function') {
        logToCpp('USING SettingsAwareBuilder (sync)');
        var treeData = buildAllTreesSettingsAware(spells, {}, treeGenSettings);
        logToCpp('SettingsAwareBuilder returned, generator: ' + (treeData ? treeData.generator : 'null'));
        finishTestGeneration(config, treeData, treeGenSettings);
        return;
    } else if (typeof generateAllVisualFirstTrees === 'function') {
        logToCpp('USING VisualFirstBuilder (SettingsAware not available or disabled)');
        var schoolConfigs = {};
        if (typeof getSchoolConfigsFromUI === 'function') {
            schoolConfigs = getSchoolConfigsFromUI();
        }
        var treeData = generateAllVisualFirstTrees(spells, schoolConfigs, null, treeGenSettings);
        finishTestGeneration(config, treeData, treeGenSettings);
        return;
    } else {
        logToCpp('ERROR: No tree builder available!', 'error');
        saveTestResults({ error: 'No tree builder available' });
        return;
    }
}

/**
 * Finish test generation after tree is built
 */
function finishTestGeneration(config, treeData, treeGenSettings) {
    // DIAGNOSTIC: Check tree structure immediately after build
    logToCpp('=== TREE STRUCTURE DIAGNOSTIC ===');
    if (treeData && treeData.schools) {
        for (var schoolName in treeData.schools) {
            var school = treeData.schools[schoolName];
            var nodes = school.nodes || [];
            var links = school.links || [];

            var withChildren = nodes.filter(function(n) { return n.children && n.children.length > 0; }).length;
            var withPrereqs = nodes.filter(function(n) { return n.prerequisites && n.prerequisites.length > 0; }).length;
            var withPositions = nodes.filter(function(n) { return n.x !== 0 || n.y !== 0; }).length;
            var withFromVisualFirst = nodes.filter(function(n) { return n._fromVisualFirst; }).length;
            var withFromLayoutEngine = nodes.filter(function(n) { return n._fromLayoutEngine; }).length;

            logToCpp(schoolName + ': ' + nodes.length + ' nodes, ' + links.length + ' links');
            logToCpp('  - Nodes with children: ' + withChildren);
            logToCpp('  - Nodes with prerequisites: ' + withPrereqs);
            logToCpp('  - Nodes with positions (x,y != 0): ' + withPositions);
            logToCpp('  - Nodes with _fromVisualFirst: ' + withFromVisualFirst);
            logToCpp('  - Nodes with _fromLayoutEngine: ' + withFromLayoutEngine);

            // Log root node details
            var rootNode = nodes.find(function(n) { return n.isRoot; });
            if (rootNode) {
                logToCpp('  ROOT: ' + (rootNode.name || rootNode.formId) +
                         ', children=' + (rootNode.children ? rootNode.children.length : 0) +
                         ', x=' + rootNode.x + ', y=' + rootNode.y);
            }
        }
    }
    logToCpp('=== END DIAGNOSTIC ===');

    // Analyze results
    var analysis = analyzeTreeResults(treeData, treeGenSettings);

    console.log('[AutoTest] Generation complete');
    console.log('[AutoTest] Analysis:', JSON.stringify(analysis, null, 2));

    // Save results
    if (config.saveResults !== false) {
        saveTestResults({
            preset: config.preset,
            settings: {
                elementIsolation: treeGenSettings.elementIsolation,
                elementIsolationStrict: treeGenSettings.elementIsolationStrict,
                strictTierOrdering: treeGenSettings.strictTierOrdering,
                linkStrategy: treeGenSettings.linkStrategy
            },
            builder: config.useSettingsAwareBuilder ? 'SettingsAwareBuilder' : 'VisualFirstBuilder',
            analysis: analysis,
            timestamp: new Date().toISOString()
        });

        // Also save the tree itself
        saveTreeData(treeData);
    }

    // Signal completion
    console.log('[AutoTest] TEST COMPLETE - Check test_results.json');

    // Signal to test runner via console marker
    console.log('[AutoTest] ===TEST_GENERATION_COMPLETE===');
}

/**
 * Hook into the spell data callback to resume test if we're waiting for data
 * NOTE: The actual callback is updateSpellData, not onSpellData
 */
var _originalUpdateSpellData = window.updateSpellData;
window.updateSpellData = function(jsonStr) {
    logToCpp('updateSpellData intercepted, has pending config: ' + !!_pendingTestConfig);

    // Call original handler first so state.lastSpellData gets populated
    if (typeof _originalUpdateSpellData === 'function') {
        _originalUpdateSpellData(jsonStr);
    }

    // Check if we have a pending test
    if (_pendingTestConfig && state && state.lastSpellData && state.lastSpellData.spells) {
        logToCpp('Spell data received, continuing test in 100ms...');
        var config = _pendingTestConfig;
        _pendingTestConfig = null;
        setTimeout(function() {
            continueTestGeneration(config);
        }, 100);
    }
};

/**
 * Analyze tree for cross-element links and settings compliance
 */
function analyzeTreeResults(treeData, treeSettings) {
    var analysis = {
        totalLinks: 0,
        crossElementLinks: 0,
        crossElementDetails: [],
        tierViolations: 0,
        rootNodeCount: 0,
        rootsWithPrereqs: 0,
        rootsWithPrereqsDetails: [],
        expectedRootCount: treeSettings ? treeSettings.rootCount : 1,
        verdict: 'UNKNOWN'
    };

    if (!treeData || !treeData.schools) {
        analysis.verdict = 'ERROR_NO_DATA';
        return analysis;
    }

    // Element keywords for detection
    var ELEMENTS = {
        fire: ['fire', 'flame', 'burn', 'inferno', 'blaze', 'fireball'],
        frost: ['frost', 'ice', 'cold', 'freeze', 'frozen', 'blizzard', 'frostbite'],
        shock: ['shock', 'lightning', 'thunder', 'spark', 'electric', 'storm', 'bolt']
    };

    function detectElement(node) {
        if (!node || !node.name) return null;
        var text = node.name.toLowerCase();
        for (var elem in ELEMENTS) {
            for (var i = 0; i < ELEMENTS[elem].length; i++) {
                if (text.indexOf(ELEMENTS[elem][i]) >= 0) return elem;
            }
        }
        return null;
    }

    // Analyze each school
    for (var schoolName in treeData.schools) {
        var school = treeData.schools[schoolName];
        var nodes = school.nodes || [];
        var links = school.links || [];

        // Build node lookup
        var nodeMap = {};
        nodes.forEach(function(n) { nodeMap[n.formId] = n; });

        // Check for root nodes with prerequisites (BUG INDICATOR)
        nodes.forEach(function(n) {
            if (n.isRoot) {
                analysis.rootNodeCount++;
                var prereqs = n.prerequisites || [];
                if (prereqs.length > 0) {
                    analysis.rootsWithPrereqs++;
                    analysis.rootsWithPrereqsDetails.push({
                        school: schoolName,
                        name: n.name || n.formId,
                        element: n.element || 'unknown',
                        prereqCount: prereqs.length
                    });
                }
            }
        });

        // Check each link
        links.forEach(function(link) {
            analysis.totalLinks++;

            var fromNode = nodeMap[link.from];
            var toNode = nodeMap[link.to];

            if (!fromNode || !toNode) return;

            var fromElem = detectElement(fromNode);
            var toElem = detectElement(toNode);

            // Check for cross-element
            if (fromElem && toElem && fromElem !== toElem) {
                analysis.crossElementLinks++;
                if (analysis.crossElementDetails.length < 20) {
                    analysis.crossElementDetails.push({
                        school: schoolName,
                        from: fromNode.name,
                        fromElement: fromElem,
                        to: toNode.name,
                        toElement: toElem
                    });
                }
            }

            // Check tier ordering
            if (treeSettings && treeSettings.strictTierOrdering) {
                var fromTier = fromNode.tier || 0;
                var toTier = toNode.tier || 0;
                if (fromTier > toTier) {
                    analysis.tierViolations++;
                }
            }
        });
    }

    // Determine verdict
    var crossPct = analysis.totalLinks > 0 ? (analysis.crossElementLinks / analysis.totalLinks * 100) : 0;

    // CRITICAL BUG: Root nodes with prerequisites indicates orphan-fix corrupted the tree
    if (analysis.rootsWithPrereqs > 0) {
        analysis.verdict = 'FAIL_ROOT_HAS_PREREQS';
        analysis.verdictMessage = 'Root nodes incorrectly have prerequisites - TreeParser orphan fix bug!';
        logToCpp('BUG DETECTED: ' + analysis.rootsWithPrereqs + ' root node(s) have prerequisites!', 'error');
        analysis.rootsWithPrereqsDetails.forEach(function(r) {
            logToCpp('  - ' + r.name + ' [' + r.element + '] has ' + r.prereqCount + ' prereqs', 'error');
        });
    } else if (treeSettings && treeSettings.elementIsolationStrict) {
        // Strict mode: MUST be 0%
        analysis.verdict = crossPct === 0 ? 'PASS' : 'FAIL_CROSS_ELEMENT';
    } else if (treeSettings && treeSettings.elementIsolation) {
        // Normal isolation: should be <5%
        analysis.verdict = crossPct < 5 ? 'PASS' : (crossPct < 10 ? 'WARN' : 'FAIL_CROSS_ELEMENT');
    } else {
        // No isolation: any amount is OK
        analysis.verdict = 'PASS';
    }

    if (analysis.tierViolations > 0 && treeSettings && treeSettings.strictTierOrdering) {
        analysis.verdict = 'FAIL_TIER_ORDER';
    }

    analysis.crossElementPercent = crossPct.toFixed(1) + '%';

    return analysis;
}

/**
 * Save test results via C++
 */
function saveTestResults(results) {
    console.log('[AutoTest] Saving test results...');

    if (window.callCpp) {
        window.callCpp('saveTestResults', JSON.stringify({ results: JSON.stringify(results, null, 2) }));
    }

    // Also log to console for test runner to capture
    console.log('[AutoTest] Results: ' + JSON.stringify(results));
}

/**
 * Save tree data via C++
 */
function saveTreeData(treeData) {
    console.log('[AutoTest] Saving tree data...');

    if (window.callCpp) {
        window.callCpp('SaveSpellTree', JSON.stringify(treeData));
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

window.checkAutoTestMode = checkAutoTestMode;
window.onTestConfigLoaded = onTestConfigLoaded;
window.runAutoTest = runAutoTest;
window.analyzeTreeResults = analyzeTreeResults;
window.continueTestGeneration = continueTestGeneration;

console.log('[AutoTest] Module loaded');
