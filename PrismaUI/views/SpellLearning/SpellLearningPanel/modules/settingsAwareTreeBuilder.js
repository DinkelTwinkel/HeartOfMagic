/**
 * SettingsAwareTreeBuilder - A clean, simple tree builder that GUARANTEES
 * settings like elementIsolation are respected.
 *
 * Design principles:
 * 1. ONE scoring function used for ALL edge decisions (via EdgeScoring module)
 * 2. ONE place where edges are added (single gate)
 * 3. Settings checked at the gate, not scattered across functions
 * 4. Simple, auditable code path
 *
 * Depends on:
 * - edgeScoring.js (unified scoring functions)
 * - shapeProfiles.js (shape configurations)
 * - layoutEngine.js (position calculations)
 * - growthBehaviors.js (optional - for behavior-driven tree structure)
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

var SETTINGS_AWARE_BUILDER_VERSION = '2.1.0';  // Updated with growthBehaviors integration

// =============================================================================
// USE UNIFIED EDGE SCORING MODULE
// =============================================================================

// These functions are now provided by edgeScoring.js
// The globals detectSpellElement, hasElementConflict, hasSameElement,
// getSpellTier, and scoreEdge are available from that module.

// Verify EdgeScoring module is loaded
if (typeof EdgeScoring === 'undefined') {
    console.warn('[SettingsAwareBuilder] EdgeScoring module not loaded, using fallbacks');
}

// Local aliases with fallbacks for backwards compatibility
var _detectSpellElement = typeof detectSpellElement === 'function'
    ? detectSpellElement
    : function(spell) {
        if (!spell) return null;
        var text = (spell.name || '').toLowerCase();
        if (text.indexOf('fire') >= 0 || text.indexOf('flame') >= 0) return 'fire';
        if (text.indexOf('frost') >= 0 || text.indexOf('ice') >= 0) return 'frost';
        if (text.indexOf('shock') >= 0 || text.indexOf('lightning') >= 0) return 'shock';
        return null;
    };

var _hasElementConflict = typeof hasElementConflict === 'function'
    ? hasElementConflict
    : function(spell1, spell2) {
        var e1 = _detectSpellElement(spell1);
        var e2 = _detectSpellElement(spell2);
        return e1 && e2 && e1 !== e2;
    };

var _hasSameElement = typeof hasSameElement === 'function'
    ? hasSameElement
    : function(spell1, spell2) {
        var e1 = _detectSpellElement(spell1);
        var e2 = _detectSpellElement(spell2);
        return e1 && e2 && e1 === e2;
    };

var _getSpellTier = typeof getSpellTier === 'function'
    ? getSpellTier
    : function(spell) {
        if (!spell) return 0;
        var level = spell.skillLevel || spell.tier || 0;
        // Handle string tier names (e.g. "Expert", "Novice")
        if (typeof level === 'string') {
            var lower = level.toLowerCase();
            var tierNames = { 'novice': 0, 'apprentice': 1, 'adept': 2, 'expert': 3, 'master': 4 };
            for (var name in tierNames) {
                if (lower.indexOf(name) >= 0) return tierNames[name];
            }
        }
        // Handle numeric skill levels
        if (typeof level === 'number') {
            if (level < 25) return 0;
            if (level < 50) return 1;
            if (level < 75) return 2;
            if (level < 100) return 3;
            return 4;
        }
        return 0;
    };

// =============================================================================
// CORE SCORING FUNCTION - Uses EdgeScoring module when available
// =============================================================================

/**
 * Score a potential edge between two spells.
 * Delegates to EdgeScoring module if available, otherwise uses local logic.
 *
 * @param {Object} fromSpell - Source spell (prerequisite)
 * @param {Object} toSpell - Target spell (depends on source)
 * @param {Object} settings - Tree generation settings
 * @returns {number} - Score (negative = forbidden, 0 = neutral, positive = good)
 */
function _scoreEdge(fromSpell, toSpell, settings) {
    // Use EdgeScoring module if available
    if (typeof EdgeScoring !== 'undefined' && typeof EdgeScoring.scoreEdge === 'function') {
        return EdgeScoring.scoreEdge(fromSpell, toSpell, settings);
    }

    // Fallback: local implementation
    var score = 0;
    settings = settings || {};

    // =================================================================
    // ELEMENT ISOLATION - HIGHEST PRIORITY
    // =================================================================
    var elementConflict = _hasElementConflict(fromSpell, toSpell);
    var sameElement = _hasSameElement(fromSpell, toSpell);

    if (elementConflict) {
        if (settings.elementIsolationStrict) {
            // STRICT MODE: Cross-element is FORBIDDEN
            return -10000;
        } else if (settings.elementIsolation) {
            // NORMAL MODE: Heavy penalty
            score -= 500;
        }
    }

    // Same element bonus (only if elementMatching scoring is enabled)
    var useElementScoring = !settings.scoring || settings.scoring.elementMatching !== false;
    if (sameElement && useElementScoring) {
        score += 100;
    }

    // =================================================================
    // TIER ORDERING
    // =================================================================
    var fromTier = _getSpellTier(fromSpell);
    var toTier = _getSpellTier(toSpell);
    var tierDiff = toTier - fromTier;

    if (settings.strictTierOrdering) {
        // Must go from lower to higher tier
        if (tierDiff < 0) {
            return -5000;  // Forbidden: can't go backwards
        }
        if (tierDiff === 0 && !settings.allowSameTierLinks) {
            return -5000;  // Forbidden: same tier not allowed
        }
    }

    // Prefer adjacent tiers
    if (tierDiff === 1) {
        score += 50;  // Perfect progression
    } else if (tierDiff === 0) {
        score += 20;  // Same tier (if allowed)
    } else if (tierDiff > 0) {
        score += Math.max(0, 30 - tierDiff * 10);  // Skip penalty
    }

    // =================================================================
    // THEMATIC MATCHING (if enabled)
    // =================================================================
    if (settings.scoring && settings.scoring.themeCoherence !== false) {
        // Check for shared keywords beyond elements
        var fromText = (fromSpell.name || '').toLowerCase();
        var toText = (toSpell.name || '').toLowerCase();

        // Shared word fragments
        var fromWords = fromText.split(/[^a-z]+/).filter(function(w) { return w.length > 3; });
        var toWords = toText.split(/[^a-z]+/).filter(function(w) { return w.length > 3; });

        var sharedWords = 0;
        fromWords.forEach(function(w) {
            if (toWords.indexOf(w) >= 0) sharedWords++;
        });

        score += sharedWords * 30;
    }

    return score;
}

// =============================================================================
// EDGE CREATION GATE - THE SINGLE ENTRY POINT
// =============================================================================

/**
 * Attempt to create an edge. Returns true if edge was created.
 * This is THE ONLY function that adds edges to the tree.
 *
 * @param {Object} fromNode - Source node
 * @param {Object} toNode - Target node
 * @param {Array} edges - Edge array to add to
 * @param {Object} settings - Tree generation settings
 * @param {Object} existingEdges - Set of existing edge keys
 * @param {string} edgeType - Type of edge ('primary', 'prerequisite', 'alternate')
 * @returns {boolean} - True if edge was created
 */
function tryCreateEdge(fromNode, toNode, edges, settings, existingEdges, edgeType) {
    // Check for duplicate
    var key = fromNode.formId + '->' + toNode.formId;
    if (existingEdges[key]) return false;

    // Score the edge
    var edgeScore = _scoreEdge(fromNode.spell, toNode.spell, settings);

    // Reject if score is negative (forbidden by settings)
    if (edgeScore < 0) {
        return false;
    }

    // Create the edge
    edges.push({
        from: fromNode.formId,
        to: toNode.formId,
        type: edgeType || 'primary',
        score: edgeScore
    });

    existingEdges[key] = true;
    return true;
}

// =============================================================================
// GROWTH BEHAVIOR INTEGRATION
// =============================================================================

/**
 * Get the growth behavior for a school
 * @param {string} schoolName - School name
 * @param {Object} schoolConfig - Optional school config with custom behavior
 * @returns {Object|null} - Growth behavior profile or null
 */
function _getSchoolBehavior(schoolName, schoolConfig) {
    // Check if growthBehaviors module is loaded
    if (typeof GROWTH_BEHAVIORS === 'undefined') {
        return null;
    }

    // Try to get custom behavior from school config
    if (schoolConfig && schoolConfig.growthBehavior && GROWTH_BEHAVIORS[schoolConfig.growthBehavior]) {
        return GROWTH_BEHAVIORS[schoolConfig.growthBehavior];
    }

    // Try to get default behavior for this school
    if (typeof SCHOOL_DEFAULT_BEHAVIORS !== 'undefined' && SCHOOL_DEFAULT_BEHAVIORS[schoolName]) {
        return GROWTH_BEHAVIORS[SCHOOL_DEFAULT_BEHAVIORS[schoolName]];
    }

    // Return first behavior as fallback (organic-like)
    return GROWTH_BEHAVIORS.gentle_bloom || null;
}

/**
 * Get behavior parameters at a given progress point
 * @param {Object} behavior - Growth behavior profile
 * @param {number} progress - Progress through tree (0-1)
 * @returns {Object} - Merged parameters with phase overrides
 */
function _getBehaviorParams(behavior, progress) {
    if (!behavior) return null;

    // Use growthBehaviors.js getActiveParameters if available
    if (typeof getActiveParameters === 'function') {
        return getActiveParameters(behavior, progress);
    }

    // Fallback: return base behavior without phase changes
    return behavior;
}

// =============================================================================
// TREE BUILDER
// =============================================================================

/**
 * Build a spell tree for a single school with guaranteed settings respect.
 *
 * @param {Array} spells - Array of spell objects
 * @param {Object} settings - Tree generation settings (from presets)
 * @param {number} seed - Random seed for reproducibility
 * @param {string} schoolName - Name of the school (for growth behavior)
 * @param {Object} schoolConfig - Optional per-school configuration
 * @returns {Object} - { nodes: [], links: [], root: formId, stats: {} }
 */
function buildSchoolTree(spells, settings, seed, schoolName, schoolConfig, pythonData) {
    console.log('[SettingsAwareBuilder] Building tree with', spells.length, 'spells for', schoolName || 'Unknown');
    console.log('[SettingsAwareBuilder] Settings:',
                'elementIsolation=' + settings.elementIsolation,
                'strict=' + settings.elementIsolationStrict,
                'tierOrdering=' + settings.strictTierOrdering);

    // Python data for smart routing
    pythonData = pythonData || {};
    var pythonThemes = pythonData.themes || {};
    var pythonSimilarity = pythonData.similarity_scores || {};
    var pythonGroups = pythonData.groups || {};

    // Build spell-to-theme lookup from Python data
    var spellThemeMap = {};
    for (var themeName in pythonThemes) {
        var themeSpells = pythonThemes[themeName];
        if (Array.isArray(themeSpells)) {
            themeSpells.forEach(function(spellId) {
                spellThemeMap[spellId] = themeName;
            });
        }
    }
    if (Object.keys(spellThemeMap).length > 0) {
        console.log('[SettingsAwareBuilder] Using Python themes for', Object.keys(spellThemeMap).length, 'spells');
    }

    var rng = createSeededRandom(seed);
    var nodes = [];
    var edges = [];
    var existingEdges = {};
    var stats = {
        totalEdges: 0,
        rejectedCrossElement: 0,
        rejectedTierOrder: 0,
        hubsCreated: 0
    };

    if (spells.length === 0) {
        return { nodes: [], links: [], root: null, stats: stats };
    }

    // Get growth behavior for this school (if available)
    var behavior = _getSchoolBehavior(schoolName, schoolConfig);
    if (behavior) {
        console.log('[SettingsAwareBuilder] Using growth behavior:', behavior.name || 'default');
    }

    // Check for GROWTH_DSL recipe (overrides some settings)
    if (typeof getSchoolRecipe === 'function') {
        var dslRecipe = getSchoolRecipe(schoolName);
        if (dslRecipe) {
            console.log('[SettingsAwareBuilder] Found DSL recipe for', schoolName);
            // Merge recipe settings with provided settings (recipe fills gaps)
            if (typeof mergeRecipeSettings === 'function') {
                settings = mergeRecipeSettings(settings, dslRecipe, false);
            }
        }
    }

    // Sort spells by tier
    var sortedSpells = spells.slice().sort(function(a, b) {
        return _getSpellTier(a) - _getSpellTier(b);
    });

    // Find root (first novice spell)
    var rootSpell = sortedSpells.find(function(s) { return _getSpellTier(s) === 0; }) || sortedSpells[0];

    // Create nodes
    spells.forEach(function(spell, idx) {
        nodes.push({
            formId: spell.formId,
            name: spell.name,
            spell: spell,
            tier: _getSpellTier(spell),
            element: _detectSpellElement(spell),
            isRoot: spell.formId === rootSpell.formId,
            isHub: false,
            prerequisites: [],
            children: [],
            x: 0,  // Placeholder - will be set by LayoutEngine
            y: 0   // Placeholder - will be set by LayoutEngine
        });
    });

    // Build node lookup
    var nodeByFormId = {};
    nodes.forEach(function(n) { nodeByFormId[n.formId] = n; });

    // Group nodes by tier
    var nodesByTier = {};
    nodes.forEach(function(n) {
        if (!nodesByTier[n.tier]) nodesByTier[n.tier] = [];
        nodesByTier[n.tier].push(n);
    });

    var tierNums = Object.keys(nodesByTier).map(Number).sort(function(a, b) { return a - b; });

    // Get maxChildrenPerNode EARLY - needed by root config phase
    var maxChildrenPerNode = settings.maxChildrenPerNode || 5;
    if (behavior && behavior.branchingFactor && (settings.rootCount || 1) <= 1) {
        // Only apply branchingFactor boost for single-root mode
        maxChildrenPerNode = Math.max(maxChildrenPerNode, Math.ceil(behavior.branchingFactor * 1.5));
    }
    var baseMaxChildren = maxChildrenPerNode; // Save non-boosted value
    // Only apply strict mode boost for single-root mode
    // Multi-root mode keeps tighter branching since roots handle their own elements
    if (settings.elementIsolationStrict && (settings.rootCount || 1) <= 1) {
        var _elemCounts = {};
        nodes.forEach(function(n) {
            var e = n.element || 'unknown';
            _elemCounts[e] = (_elemCounts[e] || 0) + 1;
        });
        var _maxElemCount = Math.max.apply(null, Object.values(_elemCounts));
        var strictMaxChildren = Math.min(Math.max(maxChildrenPerNode, Math.ceil(_maxElemCount / 5)), 15);
        console.log('[SettingsAwareBuilder] Strict mode (single root): boosting maxChildren from', maxChildrenPerNode, 'to', strictMaxChildren);
        maxChildrenPerNode = strictMaxChildren;
    }
    console.log('[SettingsAwareBuilder] maxChildrenPerNode:', maxChildrenPerNode, '(base:', baseMaxChildren + ')');

    // === ROOT CONFIGURATION ===
    var rootCount = settings.rootCount || 1;
    var tier0Nodes = nodesByTier[0] || [];

    console.log('[SettingsAwareBuilder] Root count setting:', rootCount, '(tier-0 nodes:', tier0Nodes.length + ')');

    // Discover unique elements in tier-0
    var tier0Elements = {};
    tier0Nodes.forEach(function(node) {
        var elem = node.element || 'unknown';
        if (!tier0Elements[elem]) {
            tier0Elements[elem] = node;
        }
    });

    if (rootCount <= 1) {
        // === SINGLE ROOT MODE ===
        if (settings.elementIsolationStrict) {
            var elementRoots = Object.values(tier0Elements);
            var mainRoot = nodes.find(function(n) { return n.isRoot; });
            console.log('[SettingsAwareBuilder] Single root + strict: main root is', mainRoot.name, '(' + (mainRoot.element || 'unknown') + ')');

            elementRoots.forEach(function(elementRoot) {
                if (elementRoot === mainRoot) {
                    elementRoot.isElementRoot = true;
                    return;
                }
                edges.push({ from: mainRoot.formId, to: elementRoot.formId, type: 'element-root' });
                existingEdges[mainRoot.formId + '->' + elementRoot.formId] = true;
                elementRoot.prerequisites.push(mainRoot.formId);
                mainRoot.children.push(elementRoot.formId);
                elementRoot.isElementRoot = true;
                stats.totalEdges++;
            });

            tier0Nodes.forEach(function(node) {
                if (node.isRoot || node.isElementRoot) return;
                var elem = node.element || 'unknown';
                var elementRoot = tier0Elements[elem];
                if (elementRoot && elementRoot !== node) {
                    edges.push({ from: elementRoot.formId, to: node.formId, type: 'element-sibling' });
                    existingEdges[elementRoot.formId + '->' + node.formId] = true;
                    node.prerequisites.push(elementRoot.formId);
                    elementRoot.children.push(node.formId);
                    stats.totalEdges++;
                }
            });
        }
    } else {
        // === MULTIPLE ROOTS MODE (rootCount > 1) ===

        // Count spells per element across ALL tiers
        var elementCounts = {};
        nodes.forEach(function(n) {
            var elem = n.element || 'unknown';
            elementCounts[elem] = (elementCounts[elem] || 0) + 1;
        });

        // Only consider real detected elements (exclude null/unknown)
        var availableElements = Object.keys(tier0Elements).filter(function(elem) {
            return elem !== 'unknown';
        });
        availableElements.sort(function(a, b) {
            return (elementCounts[b] || 0) - (elementCounts[a] || 0);
        });

        // Fallback if no real elements
        if (availableElements.length === 0) {
            availableElements = Object.keys(tier0Elements);
            console.log('[SettingsAwareBuilder] No real elements, using all:', availableElements.join(', '));
        }

        var selectedElements = availableElements.slice(0, rootCount);
        var selectedSet = {};
        selectedElements.forEach(function(elem) { selectedSet[elem] = true; });

        console.log('[SettingsAwareBuilder] Multiple roots: top', selectedElements.length, 'elements:', selectedElements.map(function(e) { return e + '(' + (elementCounts[e] || 0) + ')'; }).join(', '));

        // --- STEP 1: Pick best tier-0 spell for each selected element ---
        // Prefer vanilla spells (lower plugin index in formId = earlier in load order)
        function _getPluginIndexFromFormId(formId) {
            if (!formId || typeof formId !== 'string') return 999;
            var hex = formId.replace('0x', '').replace('0X', '');
            while (hex.length < 8) hex = '0' + hex;
            return parseInt(hex.substring(0, 2), 16);
        }

        var rootNodes = [];
        selectedElements.forEach(function(elem) {
            var candidates = tier0Nodes.filter(function(n) {
                return (n.element || 'unknown') === elem;
            });

            // Sort: prefer lower plugin index (vanilla/DLC first), then shorter name (more canonical)
            candidates.sort(function(a, b) {
                var aPlugin = _getPluginIndexFromFormId(a.formId);
                var bPlugin = _getPluginIndexFromFormId(b.formId);
                if (aPlugin !== bPlugin) return aPlugin - bPlugin;
                // Shorter name = more likely canonical (e.g., "Sparks" vs "Lightning Cloak Drain")
                var aLen = (a.name || '').length;
                var bLen = (b.name || '').length;
                if (aLen !== bLen) return aLen - bLen;
                return (a.name || '').localeCompare(b.name || '');
            });

            var picked = candidates[0] || tier0Elements[elem];
            rootNodes.push(picked);
            console.log('[SettingsAwareBuilder] Root for ' + elem + ': ' + picked.name + ' (formId=' + picked.formId + ', plugin=' + _getPluginIndexFromFormId(picked.formId) + ', of ' + candidates.length + ' candidates)');
        });

        // --- STEP 2: Unmark all existing roots, mark new roots ---
        nodes.forEach(function(n) { n.isRoot = false; });
        rootNodes.forEach(function(rootNode) {
            rootNode.isRoot = true;
            rootNode.isElementRoot = true;
            // Ensure roots have clean state
            rootNode.prerequisites = [];
            rootNode.children = [];
        });

        // --- STEP 3: Distribute tier-0 non-root nodes across roots (balanced) ---
        // Collect non-root tier-0 nodes
        var tier0Remaining = tier0Nodes.filter(function(n) { return !n.isRoot; });

        // Sort: same-element nodes first (they get priority to their element root)
        tier0Remaining.sort(function(a, b) {
            var aMatch = selectedSet[a.element || 'unknown'] ? 0 : 1;
            var bMatch = selectedSet[b.element || 'unknown'] ? 0 : 1;
            return aMatch - bMatch;
        });

        // Build parent pool: starts with roots, grows as nodes get connected
        // Use baseMaxChildren (non-boosted) to keep tree spread out
        var tier0MaxChildren = baseMaxChildren;
        var parentPool = rootNodes.slice(); // Copy

        console.log('[SettingsAwareBuilder] Distributing', tier0Remaining.length, 'tier-0 nodes (maxChildren=' + tier0MaxChildren + ')');

        tier0Remaining.forEach(function(node) {
            var nodeElem = node.element || 'unknown';

            // Find best parent from pool that has capacity
            var bestParent = null;
            var bestScore = -Infinity;

            parentPool.forEach(function(parent) {
                if (parent.children.length >= tier0MaxChildren) return;

                // Scoring: prefer same-element root, then any root, then non-root with element match
                var score = 0;
                if (parent.isRoot && (parent.element || 'unknown') === nodeElem) {
                    score += 200; // Same element root - best match
                } else if ((parent.element || 'unknown') === nodeElem) {
                    score += 100; // Same element non-root
                } else if (parent.isRoot) {
                    score += 50;  // Different element root
                }
                // Add edge scoring for thematic match
                score += _scoreEdge(parent.spell, node.spell, settings);
                // Prefer parents with fewer children (load balance)
                score -= parent.children.length * 10;

                if (score > bestScore) {
                    bestScore = score;
                    bestParent = parent;
                }
            });

            if (!bestParent) {
                // All parents full - pick any parent from pool with fewest children
                var sorted = parentPool.slice().sort(function(a, b) {
                    return a.children.length - b.children.length;
                });
                bestParent = sorted[0];
            }

            // Connect node to parent
            edges.push({ from: bestParent.formId, to: node.formId, type: 'tier0-assign' });
            existingEdges[bestParent.formId + '->' + node.formId] = true;
            node.prerequisites.push(bestParent.formId);
            bestParent.children.push(node.formId);
            stats.totalEdges++;

            // Add this node to parent pool so future nodes can cascade through it
            parentPool.push(node);
        });

        // Log distribution
        rootNodes.forEach(function(r) {
            console.log('[SettingsAwareBuilder] Root "' + r.name + '" [' + r.element + ']: ' + r.children.length + ' direct children');
        });
    }

    // Hub tracking for behavior-driven hub creation
    var nodesSinceLastHub = 0;

    // =================================================================
    // PHASE 1: Primary tree structure (each node gets one parent)
    // =================================================================
    console.log('[SettingsAwareBuilder] Phase 1: Building primary tree');

    // Build root subtree tracking for multi-root balance
    var nodeRootMap = {}; // formId -> root formId
    var rootSubtreeSize = {}; // root formId -> count
    var multiRootBalance = (rootCount > 1);
    var idealSizePerRoot = Math.ceil(nodes.length / rootCount);

    if (multiRootBalance) {
        // Initialize from tier-0 distribution
        nodes.forEach(function(n) {
            if (n.isRoot) {
                nodeRootMap[n.formId] = n.formId;
                rootSubtreeSize[n.formId] = 1;
            }
        });
        // Map tier-0 children to their root
        nodes.forEach(function(n) {
            if (!n.isRoot && n.prerequisites.length > 0) {
                var parentId = n.prerequisites[0];
                var rootId = nodeRootMap[parentId];
                if (rootId) {
                    nodeRootMap[n.formId] = rootId;
                    rootSubtreeSize[rootId] = (rootSubtreeSize[rootId] || 0) + 1;
                }
            }
        });
        // Walk deeper for cascaded tier-0 nodes
        var changed = true;
        while (changed) {
            changed = false;
            nodes.forEach(function(n) {
                if (!nodeRootMap[n.formId] && n.prerequisites.length > 0) {
                    var parentRoot = nodeRootMap[n.prerequisites[0]];
                    if (parentRoot) {
                        nodeRootMap[n.formId] = parentRoot;
                        rootSubtreeSize[parentRoot] = (rootSubtreeSize[parentRoot] || 0) + 1;
                        changed = true;
                    }
                }
            });
        }
        console.log('[SettingsAwareBuilder] Initial subtree sizes:', Object.keys(rootSubtreeSize).map(function(rid) {
            var rn = nodeByFormId[rid];
            return (rn ? rn.name : rid) + '=' + rootSubtreeSize[rid];
        }).join(', '));
    }

    for (var tIdx = 1; tIdx < tierNums.length; tIdx++) {
        var currentTier = tierNums[tIdx];
        var currentNodes = nodesByTier[currentTier] || [];

        // Get all potential parents (lower tiers)
        var parentCandidates = [];
        for (var pIdx = 0; pIdx < tIdx; pIdx++) {
            var parentTier = tierNums[pIdx];
            (nodesByTier[parentTier] || []).forEach(function(n) {
                parentCandidates.push(n);
            });
        }

        // Connect each node to best parent
        currentNodes.forEach(function(node) {
            if (node.isRoot) return;

            // Score all candidates, respecting maxChildrenPerNode
            // NO EXEMPTIONS - all nodes respect child limits to enable cascading/branching
            var scored = parentCandidates.map(function(parent) {
                var baseScore = _scoreEdge(parent.spell, node.spell, settings);

                // Apply subtree balance penalty in multi-root mode
                if (multiRootBalance && nodeRootMap[parent.formId]) {
                    var parentRootId = nodeRootMap[parent.formId];
                    var subtreeSize = rootSubtreeSize[parentRootId] || 0;
                    // Start penalizing at 80% of ideal, escalate non-linearly
                    var threshold = idealSizePerRoot * 0.8;
                    if (subtreeSize > threshold) {
                        var overload = (subtreeSize - threshold) / idealSizePerRoot;
                        baseScore -= Math.floor(overload * 80 + overload * overload * 120);
                    }
                }

                return {
                    node: parent,
                    score: baseScore,
                    childCount: parent.children.length
                };
            }).filter(function(s) {
                // Only valid edges AND hasn't reached max children
                return s.score >= 0 && s.childCount < maxChildrenPerNode;
            }).sort(function(a, b) {
                // Primary sort: score (higher is better)
                if (b.score !== a.score) {
                    return b.score - a.score;
                }
                // Tie-breaker: prefer parent with fewer children (load balance)
                return a.childCount - b.childCount;
            });

            // Track rejections for stats
            var rejected = parentCandidates.length - scored.length;
            if (settings.elementIsolationStrict || settings.elementIsolation) {
                stats.rejectedCrossElement += rejected;
            }

            // Connect to best parent
            if (scored.length > 0) {
                var best = scored[0];
                if (tryCreateEdge(best.node, node, edges, settings, existingEdges, 'primary')) {
                    node.prerequisites.push(best.node.formId);
                    best.node.children.push(node.formId);
                    stats.totalEdges++;
                    nodesSinceLastHub++;


                    // Check if this node should become a hub (behavior-driven)
                    if (behavior && behavior.hubProbability > 0) {
                        var hubMinSpacing = behavior.hubMinSpacing || 5;
                        if (node.tier >= 2 && nodesSinceLastHub >= hubMinSpacing) {
                            if (rng() < behavior.hubProbability) {
                                node.isHub = true;
                                nodesSinceLastHub = 0;
                                stats.hubsCreated++;
                                console.log('[SettingsAwareBuilder] Created hub:', node.name);
                            }
                        }
                    }
                }
            } else if (parentCandidates.length > 0 && !settings.elementIsolationStrict) {
                // Fallback: connect to any parent (orphan prevention)
                // NO exemptions - all nodes respect maxChildrenPerNode
                var availableFallbacks = parentCandidates.filter(function(p) {
                    return p.children.length < maxChildrenPerNode;
                });

                if (availableFallbacks.length === 0) {
                    // All parents are full - create hub from deepest node
                    var sortedByDepth = parentCandidates.slice().sort(function(a, b) {
                        return b.tier - a.tier;  // Deepest first
                    });
                    var hubCandidate = sortedByDepth.find(function(n) { return !n.isHub; });
                    if (hubCandidate) {
                        hubCandidate.isHub = true;
                        stats.hubsCreated++;
                        console.log('[SettingsAwareBuilder] Promoted to hub (cascade):', hubCandidate.name);
                        availableFallbacks = [hubCandidate];
                    } else {
                        // All are already hubs - use the one with fewest children
                        availableFallbacks = parentCandidates.slice().sort(function(a, b) {
                            return a.children.length - b.children.length;
                        }).slice(0, 1);
                    }
                }

                var fallback = availableFallbacks[Math.floor(rng() * Math.min(3, availableFallbacks.length))];
                edges.push({
                    from: fallback.formId,
                    to: node.formId,
                    type: 'cascaded',
                    score: 0
                });
                existingEdges[fallback.formId + '->' + node.formId] = true;
                node.prerequisites.push(fallback.formId);
                fallback.children.push(node.formId);
                stats.totalEdges++;
                console.log('[SettingsAwareBuilder] Cascaded (non-strict):', node.name, '-> ' + fallback.name);
            } else if (parentCandidates.length > 0 && settings.elementIsolationStrict) {
                // In strict mode: NO exemptions - cascade through same-element chain
                // Find any same-element node that has room for children
                var sameElementNodes = nodes.filter(function(n) {
                    return n.element === node.element &&
                           n.formId !== node.formId &&
                           n.tier < node.tier;
                });

                // Sort by tier (prefer higher tier = deeper in chain) then by child count
                sameElementNodes.sort(function(a, b) {
                    // Prefer nodes with fewer children first
                    var aRoom = maxChildrenPerNode - a.children.length;
                    var bRoom = maxChildrenPerNode - b.children.length;
                    if (aRoom !== bRoom) return bRoom - aRoom;  // More room = better
                    // Then prefer higher tier (deeper in chain)
                    return b.tier - a.tier;
                });

                // Find one with room for children - NO EXEMPTIONS in strict mode
                var availableParent = sameElementNodes.find(function(p) {
                    return p.children.length < maxChildrenPerNode;
                });

                if (availableParent) {
                    // Connect to this same-element parent that has room
                    if (tryCreateEdge(availableParent, node, edges, settings, existingEdges, 'element-cascade')) {
                        node.prerequisites.push(availableParent.formId);
                        availableParent.children.push(node.formId);
                        stats.totalEdges++;
                        console.log('[SettingsAwareBuilder] Cascaded:', node.name, '-> ' + availableParent.name + ' (children: ' + availableParent.children.length + ')');
                    }
                } else if (sameElementNodes.length > 0) {
                    // All same-element parents are FULL - need to promote one to hub
                    // Hubs can exceed maxChildrenPerNode (only option when ALL nodes full)
                    var existingHub = sameElementNodes.find(function(n) { return n.isHub; });
                    if (existingHub) {
                        // Connect to existing hub (hubs have no child limit as last resort)
                        if (tryCreateEdge(existingHub, node, edges, settings, existingEdges, 'hub-connect')) {
                            node.prerequisites.push(existingHub.formId);
                            existingHub.children.push(node.formId);
                            stats.totalEdges++;
                        }
                    } else {
                        // Create new hub from the deepest same-element node (never root nodes)
                        var hubCandidate = sameElementNodes.find(function(n) {
                            return !n.isRoot && n.tier >= 1 && n.tier < node.tier;
                        });
                        if (hubCandidate) {
                            hubCandidate.isHub = true;
                            stats.hubsCreated++;
                            console.log('[SettingsAwareBuilder] Promoted to hub (overflow):', hubCandidate.name, '(' + node.element + ')');

                            // Now connect to the new hub
                            if (tryCreateEdge(hubCandidate, node, edges, settings, existingEdges, 'hub-connect')) {
                                node.prerequisites.push(hubCandidate.formId);
                                hubCandidate.children.push(node.formId);
                                stats.totalEdges++;
                            }
                        } else {
                            // No hub candidate - find ANY non-root node that can become hub
                            var anyCandidate = sameElementNodes.find(function(n) { return !n.isRoot; }) || sameElementNodes[0];
                            if (anyCandidate) {
                                anyCandidate.isHub = true;
                                stats.hubsCreated++;
                                console.log('[SettingsAwareBuilder] Promoted to hub (last resort):', anyCandidate.name);
                                if (tryCreateEdge(anyCandidate, node, edges, settings, existingEdges, 'hub-connect')) {
                                    node.prerequisites.push(anyCandidate.formId);
                                    anyCandidate.children.push(node.formId);
                                    stats.totalEdges++;
                                }
                            }
                        }
                    }
                } else {
                    // No same-element nodes at all - connect to a node with room
                    console.log('[SettingsAwareBuilder] No same-element nodes for', node.name, '(' + node.element + ') - finding available parent');

                    // Find any node with room (prefer same-element root, then any root, then any node)
                    var rescueParent = nodes.find(function(n) { return n.isRoot && n.element === node.element && n.children.length < maxChildrenPerNode; }) ||
                                       nodes.find(function(n) { return n.isRoot && n.children.length < maxChildrenPerNode; }) ||
                                       nodes.find(function(n) { return n.tier < node.tier && n.children.length < maxChildrenPerNode; });

                    if (rescueParent) {
                        var key = rescueParent.formId + '->' + node.formId;
                        if (!existingEdges[key]) {
                            edges.push({
                                from: rescueParent.formId,
                                to: node.formId,
                                type: 'orphan-rescue',
                                score: 0
                            });
                            existingEdges[key] = true;
                            node.prerequisites.push(rescueParent.formId);
                            rescueParent.children.push(node.formId);
                            stats.totalEdges++;
                            console.log('[SettingsAwareBuilder] Orphan rescue:', node.name, '(' + node.element + ') -> ' + rescueParent.name);
                        }
                    }
                }
            }

            // Catch-all root subtree tracking: if node got connected, map it to parent's root
            if (multiRootBalance && node.prerequisites.length > 0 && !nodeRootMap[node.formId]) {
                var parentRoot = nodeRootMap[node.prerequisites[0]];
                if (parentRoot) {
                    nodeRootMap[node.formId] = parentRoot;
                    rootSubtreeSize[parentRoot] = (rootSubtreeSize[parentRoot] || 0) + 1;
                }
            }
        });
    }

    if (multiRootBalance) {
        console.log('[SettingsAwareBuilder] Final subtree sizes:', Object.keys(rootSubtreeSize).map(function(rid) {
            var rn = nodeByFormId[rid];
            return (rn ? rn.name : rid) + '=' + rootSubtreeSize[rid];
        }).join(', '));
    }

    // =================================================================
    // PHASE 2: Add convergence (multiple prerequisites for higher tiers)
    // =================================================================
    if (settings.convergenceEnabled !== false) {
        console.log('[SettingsAwareBuilder] Phase 2: Adding convergence links');

        // Use behavior's crossConnectionDensity to influence convergence
        var convergenceChance = (settings.convergenceChance || 40) / 100;
        if (behavior && behavior.crossConnectionDensity !== undefined) {
            // Blend settings with behavior's density
            convergenceChance = Math.max(convergenceChance, behavior.crossConnectionDensity);
        }
        var minTier = settings.convergenceMinTier || 3;

        nodes.forEach(function(node) {
            if (node.isRoot) return;
            if (node.tier < minTier) return;
            if (rng() > convergenceChance) return;
            if (node.prerequisites.length >= 2) return;  // Already has multiple

            // Find additional parent candidates (respecting maxChildrenPerNode)
            var candidates = [];
            nodes.forEach(function(other) {
                if (other.tier >= node.tier) return;
                if (node.prerequisites.indexOf(other.formId) >= 0) return;
                // Skip parents that have reached max children
                if (other.children.length >= maxChildrenPerNode) return;

                var edgeScore = _scoreEdge(other.spell, node.spell, settings);
                if (edgeScore >= 0) {
                    candidates.push({ node: other, score: edgeScore });
                }
            });

            candidates.sort(function(a, b) { return b.score - a.score; });

            if (candidates.length > 0) {
                var pick = candidates[Math.floor(rng() * Math.min(3, candidates.length))];
                if (tryCreateEdge(pick.node, node, edges, settings, existingEdges, 'convergence')) {
                    node.prerequisites.push(pick.node.formId);
                    pick.node.children.push(node.formId);
                    stats.totalEdges++;
                }
            }
        });
    }

    // =================================================================
    // OUTPUT
    // =================================================================

    // Convert to output format
    // Safety: ensure root nodes never have prerequisites (they are entry points)
    var outputNodes = nodes.map(function(n) {
        return {
            formId: n.formId,
            name: n.name,
            tier: n.tier,
            element: n.element,
            isRoot: n.isRoot,
            prerequisites: n.isRoot ? [] : n.prerequisites,
            children: n.isRoot ? n.children.filter(function(cid) {
                // Remove other root formIds from children (roots are independent)
                var childNode = nodeByFormId[cid];
                return !childNode || !childNode.isRoot;
            }) : n.children
        };
    });

    var outputLinks = edges.map(function(e) {
        return {
            from: e.from,
            to: e.to,
            type: e.type
        };
    });

    console.log('[SettingsAwareBuilder] Complete:',
                stats.totalEdges, 'edges,',
                stats.rejectedCrossElement, 'rejected for cross-element');

    // DIAGNOSTIC: Verify children arrays are populated
    var nodesWithChildren = outputNodes.filter(function(n) { return n.children && n.children.length > 0; });
    var nodesWithPrereqs = outputNodes.filter(function(n) { return n.prerequisites && n.prerequisites.length > 0; });
    console.log('[SettingsAwareBuilder] DIAGNOSTIC: Nodes with children:', nodesWithChildren.length + '/' + outputNodes.length);
    console.log('[SettingsAwareBuilder] DIAGNOSTIC: Nodes with prerequisites:', nodesWithPrereqs.length + '/' + outputNodes.length);
    if (outputNodes.length > 0) {
        var rootNode = outputNodes.find(function(n) { return n.isRoot; });
        if (rootNode) {
            console.log('[SettingsAwareBuilder] DIAGNOSTIC: Root node children count:', rootNode.children ? rootNode.children.length : 0);
        }
    }

    // Use the first actual root node (may differ from initial rootSpell in multi-root mode)
    var actualRoot = outputNodes.find(function(n) { return n.isRoot; });
    var rootFormId = actualRoot ? actualRoot.formId : rootSpell.formId;

    return {
        nodes: outputNodes,
        links: outputLinks,
        root: rootFormId,
        stats: stats
    };
}

/**
 * Simple seeded random number generator
 */
function createSeededRandom(seed) {
    var m = 0x80000000;
    var a = 1103515245;
    var c = 12345;
    var state = seed || Date.now();

    return function() {
        state = (a * state + c) % m;
        return state / m;
    };
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Build trees for all schools using settings-aware builder.
 *
 * @param {Array} allSpells - All spells
 * @param {Object} schoolConfigs - Per-school configurations
 * @param {Object} treeGeneration - Tree generation settings (from presets)
 * @param {Object} fuzzyData - Python TF-IDF themes, groups, similarity scores (optional)
 * @returns {Object} - Complete tree data
 */
function buildAllTreesSettingsAware(allSpells, schoolConfigs, treeGeneration, fuzzyData) {
    console.log('='.repeat(60));
    console.log('[SettingsAwareBuilder] v' + SETTINGS_AWARE_BUILDER_VERSION);
    console.log('[SettingsAwareBuilder] Building trees for', allSpells.length, 'spells');
    console.log('[SettingsAwareBuilder] Settings:');
    console.log('  rootCount:', treeGeneration.rootCount, '(type:', typeof treeGeneration.rootCount + ')');
    console.log('  elementIsolation:', treeGeneration.elementIsolation);
    console.log('  elementIsolationStrict:', treeGeneration.elementIsolationStrict);
    console.log('  strictTierOrdering:', treeGeneration.strictTierOrdering);
    console.log('  linkStrategy:', treeGeneration.linkStrategy);

    // Store Python fuzzy data for EdgeScoring to use
    var pythonData = fuzzyData || {};
    window._pythonFuzzyData = pythonData;  // Global for EdgeScoring access

    if (pythonData.themes && Object.keys(pythonData.themes).length > 0) {
        console.log('[SettingsAwareBuilder] PYTHON THEMES AVAILABLE:');
        for (var themeName in pythonData.themes) {
            var themeSpells = pythonData.themes[themeName];
            console.log('  ' + themeName + ': ' + (Array.isArray(themeSpells) ? themeSpells.length : 'N/A') + ' spells');
        }
    } else {
        console.log('[SettingsAwareBuilder] No Python themes - using keyword detection fallback');
    }

    if (pythonData.groups && Object.keys(pythonData.groups).length > 0) {
        console.log('[SettingsAwareBuilder] PYTHON GROUPS:', Object.keys(pythonData.groups).length, 'groups');
    }

    if (pythonData.similarity_scores) {
        console.log('[SettingsAwareBuilder] PYTHON SIMILARITY: scores available for parent selection');
    }

    console.log('='.repeat(60));

    var seed = Date.now();

    // Group spells by school
    var spellsBySchool = {};
    allSpells.forEach(function(spell) {
        var school = spell.school || 'Unknown';
        if (!school || school === 'null' || school === 'None') school = 'Unknown';
        if (!spellsBySchool[school]) spellsBySchool[school] = [];
        spellsBySchool[school].push(spell);
    });

    // Build each school
    var schools = {};
    var totalStats = { totalEdges: 0, rejectedCrossElement: 0, hubsCreated: 0 };

    for (var schoolName in spellsBySchool) {
        var spells = spellsBySchool[schoolName];
        var schoolSeed = seed + hashString(schoolName);
        var schoolConfig = schoolConfigs ? schoolConfigs[schoolName] : null;

        console.log('[SettingsAwareBuilder] Processing', schoolName, '(' + spells.length + ' spells)');

        var result = buildSchoolTree(spells, treeGeneration, schoolSeed, schoolName, schoolConfig, pythonData);

        schools[schoolName] = {
            root: result.root,
            nodes: result.nodes,
            links: result.links
        };

        totalStats.totalEdges += result.stats.totalEdges;
        totalStats.rejectedCrossElement += result.stats.rejectedCrossElement;
        totalStats.hubsCreated += result.stats.hubsCreated || 0;
    }

    console.log('[SettingsAwareBuilder] COMPLETE');
    console.log('  Total edges:', totalStats.totalEdges);
    console.log('  Rejected cross-element:', totalStats.rejectedCrossElement);
    console.log('  Hubs created:', totalStats.hubsCreated);

    // Build the result object
    var result = {
        version: '2.0',
        generator: 'SettingsAwareBuilder',
        generatedAt: new Date().toISOString(),
        settings: {
            rootCount: treeGeneration.rootCount || 1,
            elementIsolation: treeGeneration.elementIsolation,
            elementIsolationStrict: treeGeneration.elementIsolationStrict,
            strictTierOrdering: treeGeneration.strictTierOrdering,
            linkStrategy: treeGeneration.linkStrategy,
            maxChildrenPerNode: treeGeneration.maxChildrenPerNode || 5,
            shapeStyle: treeGeneration.shapeStyle || 'organic'
        },
        schools: schools
    };

    // Apply positions using LayoutEngine
    if (typeof LayoutEngine !== 'undefined' && typeof LayoutEngine.applyPositionsToTree === 'function') {
        var layoutOptions = {
            shape: treeGeneration.shape || 'organic',
            seed: seed,
            schoolConfigs: schoolConfigs
        };
        LayoutEngine.applyPositionsToTree(result, layoutOptions);
        console.log('[SettingsAwareBuilder] Applied positions via LayoutEngine');
    } else {
        console.warn('[SettingsAwareBuilder] LayoutEngine not available, nodes will have no positions!');
    }

    return result;
}

/**
 * Simple string hash for seeding
 */
function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash);
}

// =============================================================================
// ASYNC WRAPPER WITH LLM PREPROCESSING
// =============================================================================

/**
 * Async version that runs LLM preprocessing before building trees
 * @param {Array} allSpells - All spells to build trees for
 * @param {Object} schoolConfigs - Per-school configurations
 * @param {Object} treeGeneration - Tree generation settings
 * @param {Function} callback - Called with tree data when complete
 */
function buildAllTreesSettingsAwareAsync(allSpells, schoolConfigs, treeGeneration, callback) {
    var llmSettings = treeGeneration.llm || (settings.treeGeneration && settings.treeGeneration.llm);

    // Check if LLM preprocessing is needed
    var needsLLMPreprocessing = llmSettings && llmSettings.enabled && (
        llmSettings.elementDetection ||
        llmSettings.themeDiscovery ||
        llmSettings.keywordExpansion
    );

    if (needsLLMPreprocessing && typeof preprocessSpellsWithLLM === 'function') {
        console.log('[SettingsAwareBuilder] Running LLM preprocessing...');

        preprocessSpellsWithLLM(allSpells, function() {
            console.log('[SettingsAwareBuilder] LLM preprocessing complete, building trees...');
            var result = buildAllTreesSettingsAware(allSpells, schoolConfigs, treeGeneration);
            if (callback) callback(result);
        });
    } else {
        // No LLM preprocessing needed, build synchronously
        var result = buildAllTreesSettingsAware(allSpells, schoolConfigs, treeGeneration);
        if (callback) callback(result);
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

window.SettingsAwareTreeBuilder = {
    version: SETTINGS_AWARE_BUILDER_VERSION,
    buildSchoolTree: buildSchoolTree,
    buildAllTrees: buildAllTreesSettingsAware,
    buildAllTreesAsync: buildAllTreesSettingsAwareAsync,
    scoreEdge: _scoreEdge,
    detectSpellElement: _detectSpellElement,
    hasElementConflict: _hasElementConflict
};

// Also export for direct use
window.buildAllTreesSettingsAware = buildAllTreesSettingsAware;
window.buildAllTreesSettingsAwareAsync = buildAllTreesSettingsAwareAsync;

console.log('[SettingsAwareBuilder] Module loaded v' + SETTINGS_AWARE_BUILDER_VERSION);
