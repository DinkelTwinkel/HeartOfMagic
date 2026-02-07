/**
 * LLM Tree Features Module
 *
 * Provides LLM-powered features for tree building:
 * - Element Detection: Classify spells as fire/frost/shock
 * - Theme Discovery: Identify spell themes
 * - Edge Case Resolution: Break ties on close parent scores
 * - Branch Assignment: Decide where mod spells belong
 * - Keyword Expansion: Discover new element keywords
 *
 * Uses the existing OpenRouter API via callCpp('LLMGenerate', ...)
 */

// =============================================================================
// STATE
// =============================================================================

// Cache for LLM classifications (persists during session)
var llmClassificationCache = {
    elements: {},      // formId -> 'fire'|'frost'|'shock'|null
    themes: {},        // formId -> theme string
    keywords: {        // Discovered keywords
        fire: [],
        frost: [],
        shock: []
    },
    lastUpdated: null
};

// Pending LLM requests
var pendingLLMRequest = null;
var llmFeaturePollInterval = null;

// =============================================================================
// ELEMENT DETECTION
// =============================================================================

/**
 * Classify spell elements using LLM
 * @param {Array} spells - Array of spell objects to classify
 * @param {Function} callback - Called with results: { formId: element, ... }
 */
function classifySpellElementsWithLLM(spells, callback) {
    if (!settings.treeGeneration.llm.enabled || !settings.treeGeneration.llm.elementDetection) {
        console.log('[LLMTreeFeatures] Element detection disabled, using fallback');
        callback(null);
        return;
    }

    if (!state.llmConfig || !state.llmConfig.apiKey) {
        console.warn('[LLMTreeFeatures] No API key configured');
        callback(null);
        return;
    }

    // Filter to spells needing classification (not in cache)
    var needsClassification = spells.filter(function(s) {
        return !llmClassificationCache.elements.hasOwnProperty(s.formId);
    });

    if (needsClassification.length === 0) {
        console.log('[LLMTreeFeatures] All spells already classified');
        callback(llmClassificationCache.elements);
        return;
    }

    // Limit batch size to avoid token limits
    var batch = needsClassification.slice(0, 50);
    console.log('[LLMTreeFeatures] Classifying ' + batch.length + ' spells with LLM');

    // Build compact spell list for LLM
    var spellList = batch.map(function(s) {
        return {
            id: s.formId,
            name: s.name,
            effects: (s.effectNames || []).slice(0, 3).join(', ')
        };
    });

    var prompt = 'Classify each spell as fire, frost, shock, or null (if no clear element).\n\n' +
        'Spells:\n' + JSON.stringify(spellList, null, 1) + '\n\n' +
        'Return ONLY a JSON object mapping formId to element, example:\n' +
        '{"0x12345": "fire", "0x12346": "frost", "0x12347": null}\n\n' +
        'Rules:\n' +
        '- fire: flames, burning, heat, magma, incinerate\n' +
        '- frost: ice, cold, freeze, blizzard, chill\n' +
        '- shock: lightning, electricity, sparks, thunder\n' +
        '- null: healing, summoning, illusion, or unclear\n\n' +
        'JSON only, no explanation:';

    sendLLMFeatureRequest('elementDetection', prompt, function(result) {
        if (result && result.success) {
            try {
                var classifications = JSON.parse(result.response);
                // Merge into cache
                Object.keys(classifications).forEach(function(formId) {
                    llmClassificationCache.elements[formId] = classifications[formId];
                });
                llmClassificationCache.lastUpdated = new Date().toISOString();
                console.log('[LLMTreeFeatures] Classified ' + Object.keys(classifications).length + ' spells');
                callback(llmClassificationCache.elements);
            } catch (e) {
                console.error('[LLMTreeFeatures] Failed to parse element response:', e);
                callback(null);
            }
        } else {
            console.error('[LLMTreeFeatures] Element detection failed:', result ? result.error : 'no result');
            callback(null);
        }
    });
}

/**
 * Get cached element for a spell (or null if not cached)
 */
function getCachedElement(formId) {
    return llmClassificationCache.elements[formId] || null;
}

// =============================================================================
// THEME DISCOVERY
// =============================================================================

/**
 * Discover themes for spells using LLM
 * @param {Array} spells - Array of spell objects
 * @param {Function} callback - Called with results: { formId: theme, ... }
 */
function discoverSpellThemesWithLLM(spells, callback) {
    if (!settings.treeGeneration.llm.enabled || !settings.treeGeneration.llm.themeDiscovery) {
        console.log('[LLMTreeFeatures] Theme discovery disabled');
        callback(null);
        return;
    }

    if (!state.llmConfig || !state.llmConfig.apiKey) {
        callback(null);
        return;
    }

    // Filter to spells needing theme assignment
    var needsTheme = spells.filter(function(s) {
        return !llmClassificationCache.themes.hasOwnProperty(s.formId);
    });

    if (needsTheme.length === 0) {
        callback(llmClassificationCache.themes);
        return;
    }

    var batch = needsTheme.slice(0, 30);
    console.log('[LLMTreeFeatures] Discovering themes for ' + batch.length + ' spells');

    var spellList = batch.map(function(s) {
        return {
            id: s.formId,
            name: s.name,
            school: s.school,
            effects: (s.effectNames || []).slice(0, 2).join(', ')
        };
    });

    var prompt = 'Assign a thematic category to each spell. Use short theme names.\n\n' +
        'Spells:\n' + JSON.stringify(spellList, null, 1) + '\n\n' +
        'Common themes: elemental, healing, summoning, protection, control, damage, buff, debuff, utility\n' +
        'You can create specific themes like: fire-damage, ice-utility, lightning-chain, necromancy, conjure-daedra\n\n' +
        'Return ONLY a JSON object: {"formId": "theme", ...}\n' +
        'JSON only:';

    sendLLMFeatureRequest('themeDiscovery', prompt, function(result) {
        if (result && result.success) {
            try {
                var themes = JSON.parse(result.response);
                Object.keys(themes).forEach(function(formId) {
                    llmClassificationCache.themes[formId] = themes[formId];
                });
                callback(llmClassificationCache.themes);
            } catch (e) {
                console.error('[LLMTreeFeatures] Failed to parse theme response:', e);
                callback(null);
            }
        } else {
            callback(null);
        }
    });
}

// =============================================================================
// EDGE CASE RESOLUTION
// =============================================================================

/**
 * Ask LLM to choose between parent candidates
 * @param {Object} spell - The spell needing a parent
 * @param {Array} candidates - Array of {spell, score} candidates
 * @param {Function} callback - Called with chosen parent formId
 */
function resolveParentEdgeCaseWithLLM(spell, candidates, callback) {
    if (!settings.treeGeneration.llm.enabled || !settings.treeGeneration.llm.edgeCases) {
        callback(null);
        return;
    }

    if (!state.llmConfig || !state.llmConfig.apiKey) {
        callback(null);
        return;
    }

    console.log('[LLMTreeFeatures] Resolving edge case for', spell.name);

    var candidateList = candidates.slice(0, 5).map(function(c) {
        return {
            id: c.spell.formId,
            name: c.spell.name,
            school: c.spell.school,
            score: c.score
        };
    });

    var prompt = 'Choose the best prerequisite spell for learning "' + spell.name + '".\n\n' +
        'Spell to learn: ' + spell.name + ' (' + spell.school + ')\n' +
        'Effects: ' + (spell.effectNames || []).join(', ') + '\n\n' +
        'Candidates (scores are similar):\n' + JSON.stringify(candidateList, null, 1) + '\n\n' +
        'Pick the one that makes most thematic sense as a prerequisite.\n' +
        'Return ONLY the formId of your choice, nothing else:';

    sendLLMFeatureRequest('edgeCase', prompt, function(result) {
        if (result && result.success && result.response) {
            var chosenId = result.response.trim().replace(/['"]/g, '');
            console.log('[LLMTreeFeatures] LLM chose parent:', chosenId);
            callback(chosenId);
        } else {
            callback(null);
        }
    });
}

// =============================================================================
// KEYWORD EXPANSION
// =============================================================================

/**
 * Ask LLM to suggest new keywords for element detection
 * @param {Array} spells - Sample spells to analyze
 * @param {Function} callback - Called with new keywords: {fire: [...], frost: [...], shock: [...]}
 */
function expandElementKeywordsWithLLM(spells, callback) {
    if (!settings.treeGeneration.llm.enabled || !settings.treeGeneration.llm.keywordExpansion) {
        callback(null);
        return;
    }

    if (!state.llmConfig || !state.llmConfig.apiKey) {
        callback(null);
        return;
    }

    // Sample spell names for analysis
    var sampleNames = spells.slice(0, 100).map(function(s) { return s.name; });

    var prompt = 'Analyze these spell names and suggest keywords for element detection.\n\n' +
        'Spell names:\n' + sampleNames.join(', ') + '\n\n' +
        'Current keywords:\n' +
        'fire: fire, flame, burn, inferno, blaze, fireball, incinerate, scorch, heat, ember, ignite, magma, lava, immolate, pyre\n' +
        'frost: frost, ice, cold, freeze, frozen, blizzard, frostbite, chill, glacial, snow, icicle, icy, arctic, winter\n' +
        'shock: shock, lightning, thunder, spark, electric, storm, bolt, discharge, electrocute, voltaic\n\n' +
        'Suggest NEW keywords (not in current list) found in these spell names.\n' +
        'Return ONLY JSON: {"fire": ["new1"], "frost": ["new2"], "shock": ["new3"]}\n' +
        'Empty arrays if no new keywords found:';

    sendLLMFeatureRequest('keywordExpansion', prompt, function(result) {
        if (result && result.success) {
            try {
                var newKeywords = JSON.parse(result.response);
                // Merge into cache
                ['fire', 'frost', 'shock'].forEach(function(elem) {
                    if (newKeywords[elem] && Array.isArray(newKeywords[elem])) {
                        newKeywords[elem].forEach(function(kw) {
                            if (llmClassificationCache.keywords[elem].indexOf(kw) === -1) {
                                llmClassificationCache.keywords[elem].push(kw.toLowerCase());
                            }
                        });
                    }
                });
                console.log('[LLMTreeFeatures] Expanded keywords:', llmClassificationCache.keywords);
                callback(llmClassificationCache.keywords);
            } catch (e) {
                console.error('[LLMTreeFeatures] Failed to parse keyword response:', e);
                callback(null);
            }
        } else {
            callback(null);
        }
    });
}

/**
 * Get all known keywords (base + LLM-discovered)
 */
function getAllElementKeywords() {
    var base = {
        fire: ['fire', 'flame', 'burn', 'inferno', 'blaze', 'fireball', 'incinerate', 'scorch', 'heat', 'ember', 'ignite', 'magma', 'lava', 'immolate', 'pyre', 'conflagrat'],
        frost: ['frost', 'ice', 'cold', 'freeze', 'frozen', 'blizzard', 'frostbite', 'chill', 'glacial', 'snow', 'icicle', 'icy', 'arctic', 'winter'],
        shock: ['shock', 'lightning', 'thunder', 'spark', 'electric', 'storm', 'bolt', 'discharge', 'chain lightning', 'electrocute', 'voltaic']
    };

    // Merge LLM-discovered keywords
    ['fire', 'frost', 'shock'].forEach(function(elem) {
        llmClassificationCache.keywords[elem].forEach(function(kw) {
            if (base[elem].indexOf(kw) === -1) {
                base[elem].push(kw);
            }
        });
    });

    return base;
}

// =============================================================================
// CORE LLM REQUEST HANDLER
// =============================================================================

/**
 * Send an LLM request for tree features
 * Uses same infrastructure as llmIntegration.js but with feature-specific handling
 */
function sendLLMFeatureRequest(featureType, prompt, callback) {
    var request = {
        prompt: prompt,
        model: state.llmConfig.model || 'openai/gpt-4o-mini',  // Use fast model for tree features
        maxTokens: 2048,  // Keep responses small
        apiKey: state.llmConfig.apiKey,
        requestId: 'treeFeature_' + featureType + '_' + Date.now(),
        featureType: featureType
    };

    pendingLLMRequest = {
        featureType: featureType,
        callback: callback,
        startTime: Date.now()
    };

    console.log('[LLMTreeFeatures] Sending ' + featureType + ' request');

    if (window.callCpp) {
        window.callCpp('LLMGenerate', JSON.stringify(request));
        startFeaturePolling();
    } else {
        console.error('[LLMTreeFeatures] callCpp not available');
        callback(null);
    }
}

/**
 * Start polling for LLM response
 */
function startFeaturePolling() {
    if (llmFeaturePollInterval) {
        clearInterval(llmFeaturePollInterval);
    }

    llmFeaturePollInterval = setInterval(function() {
        if (window.callCpp) {
            window.callCpp('PollLLMResponse', '');
        }
    }, 1500);

    // Timeout after 30 seconds
    setTimeout(function() {
        if (pendingLLMRequest) {
            console.warn('[LLMTreeFeatures] Request timed out');
            stopFeaturePolling();
            if (pendingLLMRequest.callback) {
                pendingLLMRequest.callback(null);
            }
            pendingLLMRequest = null;
        }
    }, 30000);
}

/**
 * Stop polling
 */
function stopFeaturePolling() {
    if (llmFeaturePollInterval) {
        clearInterval(llmFeaturePollInterval);
        llmFeaturePollInterval = null;
    }
}

/**
 * Handle LLM poll result for tree features
 * This hooks into the existing onLLMPollResult but checks for our requests
 */
var originalOnLLMPollResult = window.onLLMPollResult;
window.onLLMPollResult = function(resultStr) {
    // Check if this is a tree feature request
    if (pendingLLMRequest) {
        var result;
        try {
            result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
        } catch (e) {
            return;
        }

        if (result.hasResponse) {
            stopFeaturePolling();
            var callback = pendingLLMRequest.callback;
            var elapsed = Date.now() - pendingLLMRequest.startTime;
            console.log('[LLMTreeFeatures] Got response in ' + elapsed + 'ms');
            pendingLLMRequest = null;

            if (callback) {
                callback({
                    success: result.success === 1,
                    response: result.response,
                    error: result.error
                });
            }
            return;  // Don't pass to original handler
        }
    }

    // Pass to original handler if not our request
    if (typeof originalOnLLMPollResult === 'function') {
        originalOnLLMPollResult(resultStr);
    }
};

// =============================================================================
// KEYWORD CLASSIFICATION
// =============================================================================

/**
 * Classify spells with weak/missing keywords using LLM.
 * Processes schools separately, batches of 100 spells.
 * Results stored in spell data as llm_keyword/llm_keyword_parent.
 * @param {Array} spells - Array of spell objects (modified in-place)
 * @param {Function} callback - Called with {classified: N, total: N} or null
 */
function classifySpellKeywordsWithLLM(spells, callback) {
    if (!settings.treeGeneration.llm.enabled || !settings.treeGeneration.llm.keywordClassification) {
        console.log('[LLMTreeFeatures] Keyword classification disabled');
        callback(null);
        return;
    }

    if (!state.llmConfig || !state.llmConfig.apiKey) {
        console.warn('[LLMTreeFeatures] No API key for keyword classification');
        callback(null);
        return;
    }

    // Group by school
    var schoolSpells = {};
    spells.forEach(function(s) {
        var school = s.school || 'Unknown';
        if (!schoolSpells[school]) schoolSpells[school] = [];
        schoolSpells[school].push(s);
    });

    // Build basic themes per school from spell keywords/effects (lightweight, no TF-IDF needed)
    var schoolThemes = {};
    Object.keys(schoolSpells).forEach(function(school) {
        var keywordCounts = {};
        schoolSpells[school].forEach(function(s) {
            (s.keywords || []).forEach(function(kw) {
                var k = kw.toLowerCase().replace(/^magic/, '');
                if (k.length > 2) {
                    keywordCounts[k] = (keywordCounts[k] || 0) + 1;
                }
            });
            (s.effectNames || []).forEach(function(eff) {
                eff.toLowerCase().split(/\s+/).forEach(function(w) {
                    if (w.length > 3) {
                        keywordCounts[w] = (keywordCounts[w] || 0) + 1;
                    }
                });
            });
        });
        // Top 12 keywords
        var sorted = Object.keys(keywordCounts).sort(function(a, b) {
            return keywordCounts[b] - keywordCounts[a];
        });
        schoolThemes[school] = sorted.slice(0, 12);
    });

    // Filter to spells needing classification (no existing keywords, or very weak match)
    var toClassify = {};
    var totalToClassify = 0;

    Object.keys(schoolSpells).forEach(function(school) {
        var themes = schoolThemes[school] || [];
        var needsWork = schoolSpells[school].filter(function(spell) {
            if (spell.llm_keyword) return false;
            var kws = spell.keywords || [];
            if (kws.length > 0) return false; // Has game keywords, skip
            return true;
        });
        if (needsWork.length > 0) {
            toClassify[school] = needsWork;
            totalToClassify += needsWork.length;
        }
    });

    if (totalToClassify === 0) {
        console.log('[LLMTreeFeatures] All spells already have keywords');
        callback({classified: 0, total: spells.length});
        return;
    }

    console.log('[LLMTreeFeatures] Classifying ' + totalToClassify +
                ' spells across ' + Object.keys(toClassify).length + ' schools');

    var schools = Object.keys(toClassify);
    var schoolIndex = 0;
    var classified = 0;

    function processNextSchool() {
        if (schoolIndex >= schools.length) {
            callback({classified: classified, total: spells.length});
            return;
        }
        var school = schools[schoolIndex];
        var schoolBatch = toClassify[school];
        var themes = schoolThemes[school] || [];
        processSchoolBatches(school, schoolBatch, themes, 0, function() {
            schoolIndex++;
            processNextSchool();
        });
    }

    function processSchoolBatches(school, schoolSpellList, themes, offset, done) {
        if (offset >= schoolSpellList.length) {
            done();
            return;
        }

        var batch = schoolSpellList.slice(offset, offset + 100);
        var prompt = buildKeywordClassificationPrompt(school, batch, themes);

        if (typeof updateStatus === 'function') {
            updateStatus('Classifying: ' + school + ' (' +
                         Math.min(offset + 100, schoolSpellList.length) + '/' +
                         schoolSpellList.length + ')');
        }

        sendLLMFeatureRequest('keywordClassification', prompt, function(result) {
            if (result && result.success) {
                try {
                    var classifications = typeof result.response === 'string'
                        ? JSON.parse(result.response)
                        : result.response;

                    Object.keys(classifications).forEach(function(formId) {
                        var cls = classifications[formId];
                        if (!cls || !cls.keyword) return;

                        // Find spell in the original array
                        for (var si = 0; si < spells.length; si++) {
                            if (spells[si].formId === formId) {
                                spells[si].llm_keyword = cls.keyword.toLowerCase();
                                spells[si].llm_keyword_parent = cls.parent ? cls.parent.toLowerCase() : null;
                                spells[si].llm_keyword_confidence = cls.confidence || 50;
                                classified++;
                                break;
                            }
                        }
                    });
                } catch (e) {
                    console.error('[LLMTreeFeatures] Parse error in keyword classification:', e);
                }
            } else {
                console.warn('[LLMTreeFeatures] Keyword batch failed for ' + school);
            }

            processSchoolBatches(school, schoolSpellList, themes, offset + 100, done);
        });
    }

    processNextSchool();
}

/**
 * Build LLM prompt for keyword classification
 */
function buildKeywordClassificationPrompt(school, spells, existingKeywords) {
    var spellEntries = spells.map(function(s) {
        return {
            id: s.formId,
            name: s.name || 'Unknown',
            effects: (s.effectNames || []).slice(0, 3),
            description: (s.description || '').substring(0, 80),
            keywords: s.keywords || []
        };
    });

    return 'Classify each ' + school + ' spell into a keyword group.\n\n' +
        'EXISTING KEYWORDS for ' + school + ':\n' +
        JSON.stringify(existingKeywords, null, 2) + '\n\n' +
        'SPELLS TO CLASSIFY:\n' +
        JSON.stringify(spellEntries, null, 2) + '\n\n' +
        'For each spell, assign to ONE existing keyword OR create a new one.\n\n' +
        'Rules:\n' +
        '- Prefer existing keywords when the spell clearly fits\n' +
        '- New keywords need a "parent" from the existing list\n' +
        '- Use lowercase single-word keywords\n' +
        '- Confidence: 0-100\n\n' +
        'Return ONLY JSON:\n' +
        '{"0xFORMID": {"keyword": "fire", "parent": null, "confidence": 95}}\n\n' +
        '- parent is null for existing keywords\n' +
        '- parent is the existing keyword name for new keywords\n' +
        'JSON only:';
}

/**
 * Button handler for Classify Keywords on spell scanner page
 */
function startKeywordClassification() {
    if (!state.lastSpellData || !state.lastSpellData.spells) {
        if (typeof updateStatus === 'function') updateStatus('Scan spells first');
        return;
    }

    var btn = document.getElementById('classifyKeywordsBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '... Classifying';
    }

    classifySpellKeywordsWithLLM(state.lastSpellData.spells, function(result) {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">[K]</span> Classify Keywords';
        }
        if (result) {
            if (typeof updateStatus === 'function') {
                updateStatus('Classified ' + result.classified + '/' + result.total + ' spells');
            }
            // Update the output textarea with enriched data
            var outputArea = document.getElementById('outputArea');
            if (outputArea && state.lastSpellData) {
                outputArea.value = JSON.stringify(state.lastSpellData, null, 2);
            }
        } else {
            if (typeof updateStatus === 'function') {
                updateStatus('Classification failed - check LLM API key');
            }
        }
    });
}

// =============================================================================
// INTEGRATION WITH TREE BUILDER
// =============================================================================

/**
 * Pre-process spells before tree building
 * Runs enabled LLM features and caches results
 * @param {Array} spells - All spells to process
 * @param {Function} callback - Called when preprocessing is complete
 */
function preprocessSpellsWithLLM(spells, callback) {
    var llmSettings = settings.treeGeneration.llm;

    if (!llmSettings.enabled) {
        console.log('[LLMTreeFeatures] LLM disabled, skipping preprocessing');
        callback();
        return;
    }

    console.log('[LLMTreeFeatures] Preprocessing ' + spells.length + ' spells with LLM...');

    var tasks = [];

    // Queue element detection
    if (llmSettings.elementDetection) {
        tasks.push(function(next) {
            classifySpellElementsWithLLM(spells, function(result) {
                console.log('[LLMTreeFeatures] Element detection complete');
                next();
            });
        });
    }

    // Queue keyword expansion (run before element detection uses keywords)
    if (llmSettings.keywordExpansion) {
        tasks.unshift(function(next) {
            expandElementKeywordsWithLLM(spells, function(result) {
                console.log('[LLMTreeFeatures] Keyword expansion complete');
                next();
            });
        });
    }

    // Queue keyword classification (runs before theme discovery)
    if (llmSettings.keywordClassification) {
        tasks.push(function(next) {
            classifySpellKeywordsWithLLM(spells, function(result) {
                console.log('[LLMTreeFeatures] Keyword classification complete');
                next();
            });
        });
    }

    // Queue theme discovery
    if (llmSettings.themeDiscovery) {
        tasks.push(function(next) {
            discoverSpellThemesWithLLM(spells, function(result) {
                console.log('[LLMTreeFeatures] Theme discovery complete');
                next();
            });
        });
    }

    // Run tasks sequentially
    function runNext(index) {
        if (index >= tasks.length) {
            console.log('[LLMTreeFeatures] All preprocessing complete');
            callback();
            return;
        }
        tasks[index](function() {
            runNext(index + 1);
        });
    }

    if (tasks.length > 0) {
        runNext(0);
    } else {
        callback();
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

window.classifySpellElementsWithLLM = classifySpellElementsWithLLM;
window.discoverSpellThemesWithLLM = discoverSpellThemesWithLLM;
window.resolveParentEdgeCaseWithLLM = resolveParentEdgeCaseWithLLM;
window.expandElementKeywordsWithLLM = expandElementKeywordsWithLLM;
window.classifySpellKeywordsWithLLM = classifySpellKeywordsWithLLM;
window.startKeywordClassification = startKeywordClassification;
window.getAllElementKeywords = getAllElementKeywords;
window.getCachedElement = getCachedElement;
window.preprocessSpellsWithLLM = preprocessSpellsWithLLM;
window.llmClassificationCache = llmClassificationCache;

console.log('[LLMTreeFeatures] Module loaded');
