/**
 * Visual-First Tree Builder Module
 * 
 * Orchestrates the complete visual-first tree generation:
 * 1. Layout generation (grid + shape selection)
 * 2. Spell assignment to positions
 * 3. Edge building (proximity-based)
 * 4. Output formatting
 * 
 * Depends on: layoutGenerator.js, state.js
 */

// =============================================================================
// VANILLA ROOT SPELLS (preferred starting points)
// =============================================================================
var VANILLA_ROOTS = {
    'Destruction': '0x00012FCD',  // Flames
    'Restoration': '0x00012FCC',  // Healing
    'Alteration': '0x0005AD5C',   // Oakflesh
    'Conjuration': '0x000640B6',  // Conjure Familiar
    'Illusion': '0x00012FE4'      // Courage (or Clairvoyance)
};

// =============================================================================
// SPELL ASSIGNMENT
// =============================================================================

/**
 * Assign spells to positions by tier.
 * Simple assignment - spells go to positions matching their tier.
 * 
 * @param {Array} positions - All positions
 * @param {Array} spells - Array of spell objects with tier info
 * @param {number} seed - Random seed
 * @returns {Array} - Positions with spells assigned
 */
function assignSpellsToPositions(positions, spells, seed) {
    var rng = seededRandom(seed);
    
    // Get school from first spell (all spells in this call are same school)
    var school = spells.length > 0 ? spells[0].school : null;
    var vanillaRootId = school ? VANILLA_ROOTS[school] : null;
    
    // Group spells by tier (0-4 for Novice to Master)
    var spellsByTier = {};
    var vanillaRootSpell = null;
    
    spells.forEach(function(spell) {
        // Check if this is the vanilla root spell
        if (vanillaRootId && spell.formId && spell.formId.toLowerCase() === vanillaRootId.toLowerCase()) {
            vanillaRootSpell = spell;
            return; // Don't add to tier pool - will assign directly to root
        }
        
        var tier = getTierIndex(spell.skillLevel || spell.tier);
        if (!spellsByTier[tier]) spellsByTier[tier] = [];
        spellsByTier[tier].push(spell);
    });
    
    // Shuffle each tier's spells for variety
    for (var t in spellsByTier) {
        shuffle(spellsByTier[t], rng);
    }
    
    // Separate positions by type
    var rootPositions = positions.filter(function(p) { return p.isRoot; });
    var regularPositions = positions.filter(function(p) { return !p.isRoot; });
    
    // Sort regular positions by tier (lower tier = closer to center)
    regularPositions.sort(function(a, b) { return a.tier - b.tier; });
    
    var assignedCount = 0;
    
    // Step 1: Assign root positions - PREFER vanilla root spell first
    var noviceSpells = spellsByTier[0] || [];
    for (var i = 0; i < rootPositions.length; i++) {
        if (i === 0 && vanillaRootSpell) {
            // First root position gets vanilla root spell (Flames, Healing, etc.)
            rootPositions[i].spell = vanillaRootSpell;
            console.log('[VisualFirstBuilder] Assigned vanilla root:', vanillaRootSpell.name, 'to', school);
        } else if (noviceSpells.length > 0) {
            rootPositions[i].spell = noviceSpells.shift();
        }
        if (rootPositions[i].spell) assignedCount++;
    }
    
    // Step 2: Collect all remaining spells in tier order
    var allSpellsOrdered = [];
    allSpellsOrdered = allSpellsOrdered.concat(noviceSpells);  // Remaining novice
    for (var t = 1; t < 5; t++) {
        allSpellsOrdered = allSpellsOrdered.concat(spellsByTier[t] || []);
    }
    
    // Step 3: Assign to regular positions (inner to outer)
    for (var i = 0; i < regularPositions.length && allSpellsOrdered.length > 0; i++) {
        regularPositions[i].spell = allSpellsOrdered.shift();
        assignedCount++;
    }
    
    
    console.log('[VisualFirstBuilder] Assigned', assignedCount, 'spells to', 
                positions.length, 'positions');
    
    return positions;
}

/**
 * Convert tier name to index.
 */
function getTierIndex(tier) {
    if (typeof tier === 'number') return tier;
    var tiers = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
    var idx = tiers.indexOf(tier);
    return idx >= 0 ? idx : 0;
}

// =============================================================================
// EDGE BUILDING - Ensures all nodes connect to root, no cycles
// =============================================================================

/**
 * Build edges connecting nodes with guaranteed connectivity to root.
 * Uses fuzzy NLP relationships to prefer semantically related spells as prerequisites.
 * 
 * Rules:
 * 1. All nodes MUST connect to root through some path
 * 2. No circular dependencies (edges only go from lower tier to higher tier)
 * 3. Convergence creates interesting multi-prerequisite nodes
 * 4. Fuzzy relationships influence prerequisite selection (prefer related spells)
 * 
 * @param {Array} positions - All positions with spells assigned
 * @param {Object} config - {convergence_chance, ...}
 * @param {number} seed - Random seed
 * @param {Object} fuzzyData - Optional fuzzy relationship data
 * @returns {Array} - Array of edge objects {from, to}
 */
function buildEdges(positions, config, seed, fuzzyData) {
    var edges = [];
    var convergence = config.convergence_chance || config.convergence || 0.4;
    var rng = seededRandom(seed);

    // Log tree generation settings being used
    var treeGenSettings = config.treeGeneration || {};
    console.log('[buildEdges] Tree generation settings:',
                'elementIsolation=' + (treeGenSettings.elementIsolation || false),
                'strict=' + (treeGenSettings.elementIsolationStrict || false),
                'linkStrategy=' + (treeGenSettings.linkStrategy || 'default'));

    // Setup fuzzy data helpers
    var fuzzy = fuzzyData || { relationships: {}, similarity_scores: {} };
    var relationships = fuzzy.relationships || {};
    var similarities = fuzzy.similarity_scores || {};
    
    // Helper to get similarity score between two spells
    function getSimilarity(formId1, formId2) {
        // Try both orderings
        var key1 = formId1 + ':' + formId2;
        var key2 = formId2 + ':' + formId1;
        return similarities[key1] || similarities[key2] || 0;
    }
    
    // Helper to check if spells are fuzzy-related
    function areRelated(formId1, formId2) {
        var related1 = relationships[formId1] || [];
        var related2 = relationships[formId2] || [];
        return related1.indexOf(formId2) >= 0 || related2.indexOf(formId1) >= 0;
    }
    
    // Get only positions with spells
    var nodesWithSpells = positions.filter(function(p) { return p.spell; });
    
    // Build lookup maps
    var nodeByFormId = {};
    nodesWithSpells.forEach(function(p) {
        nodeByFormId[p.spell.formId] = p;
    });
    
    // Find root node (tier 0 or isRoot flag)
    var rootNode = nodesWithSpells.find(function(p) { return p.isRoot; }) ||
                   nodesWithSpells.find(function(p) { return p.tier === 0; });
    
    if (!rootNode) {
        console.warn('[VisualFirstBuilder] No root node found!');
        return edges;
    }
    
    // Track which nodes are connected to root
    var connectedToRoot = {};
    connectedToRoot[rootNode.spell.formId] = true;
    
    // Group by effective tier
    var byTier = {};
    nodesWithSpells.forEach(function(p) {
        var t = Math.floor(p.tier);
        if (!byTier[t]) byTier[t] = [];
        byTier[t].push(p);
    });
    
    // Get sorted tier numbers
    var tierNums = Object.keys(byTier).map(Number).sort(function(a, b) { return a - b; });
    
    // Track fuzzy matches used
    var fuzzyMatchCount = 0;
    var totalEdges = 0;
    
    // Process each tier in order, connecting to previous tiers
    for (var tIdx = 1; tIdx < tierNums.length; tIdx++) {
        var currentTierNum = tierNums[tIdx];
        var currentTier = byTier[currentTierNum] || [];
        
        // Get all nodes from previous tiers that are connected
        var connectedPrevious = [];
        for (var pIdx = 0; pIdx < tIdx; pIdx++) {
            var prevTierNum = tierNums[pIdx];
            (byTier[prevTierNum] || []).forEach(function(p) {
                if (connectedToRoot[p.spell.formId]) {
                    connectedPrevious.push(p);
                }
            });
        }
        
        if (connectedPrevious.length === 0) {
            console.warn('[VisualFirstBuilder] No connected previous nodes for tier', currentTierNum);
            continue;
        }
        
        // Connect each node in current tier
        currentTier.forEach(function(pos) {
            if (!pos.spell) return;
            var myFormId = pos.spell.formId;
            
            // Get tree generation settings (if available)
            var treeGen = config.treeGeneration || {};
            var scoring = treeGen.scoring || {};

            // Score candidates using tree generation settings
            var scoredCandidates = connectedPrevious.map(function(c) {
                var cFormId = c.spell.formId;
                var dist = distance(pos, c);
                var isRelated = areRelated(myFormId, cFormId);
                var sim = getSimilarity(myFormId, cFormId);

                // Calculate thematic similarity for element isolation
                var thematicSim = calculateThematicSimilarity(pos.spell, c.spell);
                var themes1 = getSpellThemes(pos.spell);
                var themes2 = getSpellThemes(c.spell);

                // Check for element conflict (fire vs frost, etc.)
                var elements = ['fire', 'frost', 'shock'];
                var myElements = themes1.filter(function(t) { return elements.indexOf(t) !== -1; });
                var candidateElements = themes2.filter(function(t) { return elements.indexOf(t) !== -1; });
                var hasElementConflict = myElements.length > 0 && candidateElements.length > 0 &&
                    !myElements.some(function(e) { return candidateElements.indexOf(e) !== -1; });
                var hasElementMatch = myElements.length > 0 && candidateElements.length > 0 &&
                    myElements.some(function(e) { return candidateElements.indexOf(e) !== -1; });

                // Build score based on settings
                var score = 0;

                // Element isolation rules
                if (treeGen.elementIsolationStrict && hasElementConflict) {
                    // STRICT: Cross-element links are forbidden
                    score = -10000;
                } else if (treeGen.elementIsolation && hasElementConflict) {
                    // NORMAL: Heavy penalty for cross-element
                    score -= 500;
                }

                // Scoring factors from settings
                if (scoring.elementMatching !== false && hasElementMatch) {
                    score += 100;  // Same element bonus
                }

                if (scoring.fuzzyRelationship !== false && isRelated) {
                    score += 1000;  // Fuzzy relationship bonus (highest)
                }

                if (scoring.themeCoherence !== false) {
                    // Theme overlap bonus (scaled by similarity)
                    var themeOverlap = 0;
                    themes1.forEach(function(t) { if (themes2.indexOf(t) !== -1) themeOverlap++; });
                    score += themeOverlap * 70;  // +70 per shared theme
                }

                if (scoring.tierProgression !== false) {
                    // Adjacent tier bonus
                    var tierDiff = pos.tier - c.tier;
                    if (tierDiff === 1) score += 50;  // Perfect progression
                    else if (tierDiff > 1) score += 20;  // Skip tier (less ideal)
                }

                // Always apply similarity and distance (but can be scaled)
                score += sim * 100;  // Similarity 0-1 => 0-100 bonus

                if (scoring.distancePenalty !== false) {
                    score -= dist * 0.1;  // Distance penalty
                }

                return { pos: c, score: score, isRelated: isRelated, similarity: sim, distance: dist,
                         hasElementConflict: hasElementConflict, hasElementMatch: hasElementMatch };
            });
            
            // Sort by score (highest first)
            scoredCandidates.sort(function(a, b) { return b.score - a.score; });
            
            // Filter out forbidden connections in strict mode
            var viableCandidates = scoredCandidates;
            if (treeGen.elementIsolationStrict) {
                viableCandidates = scoredCandidates.filter(function(c) { return !c.hasElementConflict; });
                if (viableCandidates.length === 0) {
                    // Strict mode but no valid candidates - fall back to all (orphan prevention)
                    viableCandidates = scoredCandidates;
                }
            }

            // ALWAYS connect to best scored - this guarantees connectivity
            if (viableCandidates.length > 0) {
                var best = viableCandidates[0];
                edges.push({
                    from: best.pos.spell.formId,
                    to: myFormId,
                    type: best.isRelated ? 'fuzzy_primary' : (best.hasElementMatch ? 'element_match' : 'primary')
                });
                connectedToRoot[myFormId] = true;
                totalEdges++;
                if (best.isRelated) fuzzyMatchCount++;
            }

            // Add convergence (multiple prerequisites) based on chance
            if (viableCandidates.length > 1 && rng() < convergence) {
                // Find a second prerequisite - prefer fuzzy-related or high similarity
                // But also consider distance to avoid ugly crossing lines

                var candidates = viableCandidates.slice(1).filter(function(c) {
                    // Must be sufficiently far from first choice (different branch)
                    var farEnough = distance(c.pos, viableCandidates[0].pos) > 40;
                    // Also respect element isolation in convergence
                    var elementOk = !treeGen.elementIsolation || !c.hasElementConflict;
                    return farEnough && elementOk;
                });

                // If fuzzy related candidates exist, prefer them
                var fuzzyRelatedCandidates = candidates.filter(function(c) { return c.isRelated; });
                if (fuzzyRelatedCandidates.length > 0) {
                    candidates = fuzzyRelatedCandidates;
                }

                // Sort by: tier diff (prefer earlier tiers) then score
                candidates.sort(function(a, b) {
                    var tierDiffA = pos.tier - a.pos.tier;
                    var tierDiffB = pos.tier - b.pos.tier;
                    if (tierDiffA !== tierDiffB) return tierDiffB - tierDiffA;
                    return b.score - a.score;
                });

                if (candidates.length > 0) {
                    // Pick from top candidates with some randomness
                    var pickIdx = Math.floor(rng() * Math.min(3, candidates.length));
                    var picked = candidates[pickIdx];
                    edges.push({
                        from: picked.pos.spell.formId,
                        to: myFormId,
                        type: picked.isRelated ? 'fuzzy_convergence' : 'convergence'
                    });
                    totalEdges++;
                    if (picked.isRelated) fuzzyMatchCount++;
                } else if (viableCandidates.length > 1) {
                    // Fallback to second best scored (only if element-compatible or not strict)
                    var fallback = viableCandidates[1];
                    if (!treeGen.elementIsolation || !fallback.hasElementConflict) {
                        edges.push({
                            from: fallback.pos.spell.formId,
                            to: myFormId,
                            type: 'convergence'
                        });
                        totalEdges++;
                    }
                }
            }
        });
    }
    
    // Log fuzzy matching stats
    if (totalEdges > 0) {
        var fuzzyPercent = Math.round(fuzzyMatchCount / totalEdges * 100);
        console.log('[VisualFirstBuilder] Fuzzy matching:', fuzzyMatchCount + '/' + totalEdges, 'edges (' + fuzzyPercent + '%) used fuzzy relationships');
    }
    
    // VALIDATION: Check for any orphaned nodes and connect them
    var orphans = nodesWithSpells.filter(function(p) {
        return !connectedToRoot[p.spell.formId] && !p.isRoot;
    });
    
    if (orphans.length > 0) {
        console.warn('[VisualFirstBuilder] Found', orphans.length, 'orphan nodes, connecting...');
        
        orphans.forEach(function(orphan) {
            // Find nearest connected node with lower tier
            var candidates = nodesWithSpells.filter(function(p) {
                return connectedToRoot[p.spell.formId] && p.tier < orphan.tier;
            });
            
            if (candidates.length === 0) {
                // Last resort: connect to root
                candidates = [rootNode];
            }
            
            candidates.sort(function(a, b) {
                return distance(orphan, a) - distance(orphan, b);
            });
            
            edges.push({
                from: candidates[0].spell.formId,
                to: orphan.spell.formId,
                type: 'orphan_fix'
            });
            connectedToRoot[orphan.spell.formId] = true;
        });
    }
    
    // VALIDATION: Check for circular dependencies (should never happen with tier-based approach)
    var hasCycle = detectCycles(edges, nodeByFormId);
    if (hasCycle) {
        console.error('[VisualFirstBuilder] CYCLE DETECTED! This should not happen.');
    }
    
    console.log('[VisualFirstBuilder] Built', edges.length, 'edges,',
                nodesWithSpells.length, 'nodes connected,',
                orphans.length, 'orphans fixed');
    return edges;
}

// =============================================================================
// FUZZY GROUP BRANCHING (Alternative edge building mode)
// =============================================================================

/**
 * Build edges using fuzzy group logic.
 * 
 * Algorithm:
 * 1. Find 2-4 most distinct fuzzy groups from spell names/effects
 * 2. Connect root to representative spells from each group
 * 3. Branch within each group by theme commonality
 * 4. Final pass: add cross-branch prereqs based on fuzzy similarity
 * 
 * @param {Array} positions - All positions with spells assigned
 * @param {Object} config - Configuration
 * @param {number} seed - Random seed
 * @param {Object} fuzzyData - Fuzzy relationship data
 * @returns {Array} - Array of edge objects {from, to}
 */
function buildEdgesFuzzyGroups(positions, config, seed, fuzzyData) {
    var edges = [];
    var rng = seededRandom(seed);
    
    // Get only positions with spells
    var nodesWithSpells = positions.filter(function(p) { return p.spell; });
    if (nodesWithSpells.length === 0) return edges;
    
    // Build lookup
    var nodeByFormId = {};
    nodesWithSpells.forEach(function(p) {
        nodeByFormId[p.spell.formId] = p;
    });
    
    // Find root
    var rootNode = nodesWithSpells.find(function(p) { return p.isRoot; }) ||
                   nodesWithSpells.find(function(p) { return p.tier === 0; });
    if (!rootNode) return edges;
    
    var connectedToRoot = {};
    connectedToRoot[rootNode.spell.formId] = true;
    
    console.log('[FuzzyGroupBranching] Starting with', nodesWithSpells.length, 'spells');
    
    // =========================================================================
    // STEP 1: Discover fuzzy groups from spell names and effects
    // =========================================================================
    var groups = discoverFuzzyGroups(nodesWithSpells, rng);
    console.log('[FuzzyGroupBranching] Found', groups.length, 'distinct groups');
    
    // =========================================================================
    // STEP 2: Connect root to first spell of each group (most common/representative)
    // =========================================================================
    var groupRoots = [];
    groups.forEach(function(group, idx) {
        if (group.spells.length === 0) return;
        
        // Pick the lowest tier spell as group representative
        var sorted = group.spells.slice().sort(function(a, b) {
            return a.tier - b.tier;
        });
        var representative = sorted[0];
        
        // Connect root to this representative
        if (representative.spell.formId !== rootNode.spell.formId) {
            edges.push({
                from: rootNode.spell.formId,
                to: representative.spell.formId,
                type: 'group_root'
            });
            connectedToRoot[representative.spell.formId] = true;
            groupRoots.push({ node: representative, group: group });
            console.log('[FuzzyGroupBranching] Group "' + group.theme + '" root:', representative.spell.name);
        }
    });
    
    // =========================================================================
    // STEP 3: Branch within each group (most common first, then less common)
    // =========================================================================
    groups.forEach(function(group) {
        // Sort by tier, then by match score (most common first)
        var sorted = group.spells.slice().sort(function(a, b) {
            if (a.tier !== b.tier) return a.tier - b.tier;
            return (b.matchScore || 0) - (a.matchScore || 0);
        });
        
        // Connect each spell to the best connected predecessor in same group
        for (var i = 1; i < sorted.length; i++) {
            var current = sorted[i];
            if (current.spell.formId === rootNode.spell.formId) continue;
            if (connectedToRoot[current.spell.formId]) continue;
            
            // Find best parent: connected, lower tier, same group preferred
            var candidates = sorted.slice(0, i).filter(function(c) {
                return connectedToRoot[c.spell.formId] && c.tier < current.tier;
            });
            
            // Also consider group root if no candidates
            if (candidates.length === 0) {
                candidates = sorted.filter(function(c) {
                    return connectedToRoot[c.spell.formId] && c.tier <= current.tier && c !== current;
                });
            }
            
            if (candidates.length > 0) {
                // Pick closest in tier, with some fuzziness score weight
                candidates.sort(function(a, b) {
                    var tierDiffA = current.tier - a.tier;
                    var tierDiffB = current.tier - b.tier;
                    var scoreA = tierDiffA * 10 - (a.matchScore || 0) * 0.1;
                    var scoreB = tierDiffB * 10 - (b.matchScore || 0) * 0.1;
                    return scoreA - scoreB;
                });
                
                var parent = candidates[0];
                edges.push({
                    from: parent.spell.formId,
                    to: current.spell.formId,
                    type: 'group_branch'
                });
                connectedToRoot[current.spell.formId] = true;
            }
        }
    });
    
    // =========================================================================
    // STEP 4: Connect any orphans (spells not in any group or not connected)
    // =========================================================================
    var orphans = nodesWithSpells.filter(function(p) {
        return !connectedToRoot[p.spell.formId] && !p.isRoot;
    });
    
    orphans.forEach(function(orphan) {
        // Find nearest connected node with lower or equal tier
        var candidates = nodesWithSpells.filter(function(p) {
            return connectedToRoot[p.spell.formId] && p.tier < orphan.tier;
        });
        
        if (candidates.length === 0) {
            candidates = [rootNode];
        }
        
        candidates.sort(function(a, b) {
            return distance(orphan, a) - distance(orphan, b);
        });
        
        edges.push({
            from: candidates[0].spell.formId,
            to: orphan.spell.formId,
            type: 'orphan_fix'
        });
        connectedToRoot[orphan.spell.formId] = true;
    });
    
    // =========================================================================
    // STEP 5: Cross-branch prereqs (fuzzy similarity across whole tree)
    // =========================================================================
    var crossPrereqChance = config.cross_prereq_chance || 0.15;
    var maxCrossPrereqs = Math.min(10, Math.floor(nodesWithSpells.length * 0.1));
    var crossPrereqCount = 0;
    
    // Get fuzzy data helpers
    var fuzzy = fuzzyData || { relationships: {}, similarity_scores: {} };
    var similarities = fuzzy.similarity_scores || {};
    
    function getSimilarity(formId1, formId2) {
        var key1 = formId1 + ':' + formId2;
        var key2 = formId2 + ':' + formId1;
        return similarities[key1] || similarities[key2] || 0;
    }
    
    // Find high-similarity pairs across different groups
    nodesWithSpells.forEach(function(node) {
        if (node.isRoot || crossPrereqCount >= maxCrossPrereqs) return;
        if (rng() > crossPrereqChance) return;
        
        var myFormId = node.spell.formId;
        var myGroup = node.fuzzyGroup;
        
        // Find spells in OTHER groups with high similarity
        var crossCandidates = nodesWithSpells.filter(function(other) {
            if (other.spell.formId === myFormId) return false;
            if (other.tier >= node.tier) return false;  // Must be prerequisite
            if (other.fuzzyGroup === myGroup) return false;  // Different group
            if (!connectedToRoot[other.spell.formId]) return false;
            
            var sim = getSimilarity(myFormId, other.spell.formId);
            return sim > 0.3;  // Only if reasonably similar
        });
        
        if (crossCandidates.length > 0) {
            // Sort by similarity
            crossCandidates.sort(function(a, b) {
                return getSimilarity(myFormId, b.spell.formId) - getSimilarity(myFormId, a.spell.formId);
            });
            
            // Check we don't already have this edge
            var best = crossCandidates[0];
            var existingEdge = edges.find(function(e) {
                return e.from === best.spell.formId && e.to === myFormId;
            });
            
            if (!existingEdge) {
                edges.push({
                    from: best.spell.formId,
                    to: myFormId,
                    type: 'cross_branch'
                });
                crossPrereqCount++;
            }
        }
    });
    
    console.log('[FuzzyGroupBranching] Built', edges.length, 'edges (' + crossPrereqCount + ' cross-branch)');
    
    // Validate no cycles
    var hasCycle = detectCycles(edges, nodeByFormId);
    if (hasCycle) {
        console.error('[FuzzyGroupBranching] CYCLE DETECTED! Removing cross-branch edges...');
        edges = edges.filter(function(e) { return e.type !== 'cross_branch'; });
    }
    
    return edges;
}

/**
 * Discover fuzzy groups from spell names and effects.
 * Uses simple keyword extraction and clustering.
 * 
 * @param {Array} nodesWithSpells - Nodes with spells assigned
 * @param {Function} rng - Random number generator
 * @returns {Array} - Array of {theme, spells: [...]} objects
 */
function discoverFuzzyGroups(nodesWithSpells, rng) {
    // Extract keywords from all spells using UNIFIED extraction (includes description)
    var keywordCounts = {};
    var spellKeywords = {};
    
    var stopWords = ['the', 'of', 'and', 'a', 'to', 'in', 'for', 'is', 'on', 'that', 'by', 'this', 'with', 'i', 'you', 'it', 'not', 'or', 'be', 'are', 'from', 'at', 'as', 'your', 'all', 'have', 'new', 'more', 'an', 'was', 'we', 'will', 'can', 'us', 'about', 'if', 'my', 'has', 'but', 'our', 'one', 'other', 'do', 'no', 'time', 'very', 'when', 'come', 'could', 'now', 'than', 'like', 'only', 'into', 'its', 'also', 'after', 'use', 'two', 'how', 'which', 'way', 'well', 'may', 'then', 'any', 'through', 'during', 'each', 'where', 'spell', 'magic', 'magicka', 'target', 'effect', 'points', 'second', 'seconds', 'level', 'caster', 'concentration'];
    
    nodesWithSpells.forEach(function(node) {
        var spell = node.spell;
        
        // Use UNIFIED text extraction (name + effectNames + effects + description)
        var words = extractSpellKeywords(spell, stopWords);
        
        spellKeywords[spell.formId] = words;
        
        words.forEach(function(word) {
            keywordCounts[word] = (keywordCounts[word] || 0) + 1;
        });
    });
    
    // Find most common keywords (potential themes)
    var sortedKeywords = Object.keys(keywordCounts).sort(function(a, b) {
        return keywordCounts[b] - keywordCounts[a];
    });
    
    // Pick 2-4 distinct themes
    var themes = [];
    var minCount = Math.max(2, Math.floor(nodesWithSpells.length * 0.05));
    
    for (var i = 0; i < sortedKeywords.length && themes.length < 4; i++) {
        var keyword = sortedKeywords[i];
        if (keywordCounts[keyword] < minCount) continue;
        
        // Check it's not too similar to existing themes
        var isSimilar = themes.some(function(t) {
            return keyword.indexOf(t) >= 0 || t.indexOf(keyword) >= 0;
        });
        
        if (!isSimilar) {
            themes.push(keyword);
        }
    }
    
    // If we didn't find enough themes, add some generic ones based on tier
    if (themes.length < 2) {
        themes = ['primary', 'secondary'];
    }
    
    console.log('[FuzzyGroupBranching] Themes:', themes.join(', '));
    
    // Assign spells to groups
    var groups = themes.map(function(theme) {
        return { theme: theme, spells: [] };
    });
    groups.push({ theme: '_other', spells: [] });  // Catch-all
    
    nodesWithSpells.forEach(function(node) {
        var spell = node.spell;
        var words = spellKeywords[spell.formId] || [];
        
        // Find best matching theme
        var bestTheme = null;
        var bestScore = 0;
        
        themes.forEach(function(theme, idx) {
            var score = 0;
            words.forEach(function(word) {
                if (word === theme) score += 10;
                else if (word.indexOf(theme) >= 0) score += 5;
                else if (theme.indexOf(word) >= 0) score += 3;
            });
            
            if (score > bestScore) {
                bestScore = score;
                bestTheme = idx;
            }
        });
        
        // Assign to group
        if (bestTheme !== null && bestScore > 0) {
            node.fuzzyGroup = themes[bestTheme];
            node.matchScore = bestScore;
            groups[bestTheme].spells.push(node);
        } else {
            node.fuzzyGroup = '_other';
            node.matchScore = 0;
            groups[groups.length - 1].spells.push(node);
        }
    });
    
    // Remove empty groups
    groups = groups.filter(function(g) { return g.spells.length > 0; });
    
    // If '_other' is too large, redistribute or treat as its own branch
    var otherGroup = groups.find(function(g) { return g.theme === '_other'; });
    if (otherGroup && otherGroup.spells.length > nodesWithSpells.length * 0.5) {
        // Split _other into sub-groups by tier
        var byTier = {};
        otherGroup.spells.forEach(function(node) {
            var t = Math.floor(node.tier);
            if (!byTier[t]) byTier[t] = [];
            byTier[t].push(node);
        });
        
        // Remove original _other
        groups = groups.filter(function(g) { return g.theme !== '_other'; });
        
        // Add tier-based groups
        Object.keys(byTier).forEach(function(t) {
            if (byTier[t].length > 0) {
                groups.push({ theme: 'tier_' + t, spells: byTier[t] });
            }
        });
    }
    
    return groups;
}

/**
 * Detect cycles in edge graph (should never happen with tier-based edges).
 */
function detectCycles(edges, nodeByFormId) {
    // Build adjacency list
    var children = {};
    edges.forEach(function(e) {
        if (!children[e.from]) children[e.from] = [];
        children[e.from].push(e.to);
    });
    
    // DFS cycle detection
    var visited = {};
    var inStack = {};
    
    function dfs(nodeId) {
        if (inStack[nodeId]) return true;  // Cycle!
        if (visited[nodeId]) return false;
        
        visited[nodeId] = true;
        inStack[nodeId] = true;
        
        var nodeChildren = children[nodeId] || [];
        for (var i = 0; i < nodeChildren.length; i++) {
            if (dfs(nodeChildren[i])) return true;
        }
        
        inStack[nodeId] = false;
        return false;
    }
    
    for (var nodeId in nodeByFormId) {
        if (dfs(nodeId)) return true;
    }
    return false;
}

/**
 * Calculate distance between two positions.
 */
function distance(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// =============================================================================
// ORGANIC GROWTH SYSTEM - Shape-constrained growth with NLP clustering
// =============================================================================

/**
 * Grow a tree organically within shape constraints.
 * 
 * Key principles:
 * 1. Shape mask defines VALID positions (where nodes CAN go)
 * 2. Tree grows from root, branching outward
 * 3. Similar spells cluster together spatially (NLP grouping)
 * 4. Branching distance is configurable per tree
 * 5. No tier limit - grows until all spells placed
 * 
 * @param {Array} spells - Spells to place
 * @param {Object} sliceInfo - Sector bounds
 * @param {Object} config - {shape, branch_distance, schoolName, ...}
 * @param {number} seed - Random seed
 * @returns {Object} - {positions, edges}
 */
/**
 * Grow organic tree using behavior-driven placement.
 * Uses the growth behavior system to determine how the tree expands.
 */
function growOrganicTree(spells, sliceInfo, config, seed) {
    var rng = seededRandom(seed);
    
    // GRID CONFIGURATION - Use unified source from config.js
    var gridCfg = GRID_CONFIG.getComputedConfig();
    var nodeSize = gridCfg.nodeSize;
    var minNodeSpacing = gridCfg.minNodeSpacing;
    var baseRadius = gridCfg.baseRadius;
    var totalSpells = spells.length;
    
    // Get growth behavior for this school (supports both camelCase and snake_case)
    var behaviorName = config.growthBehavior || config.growth_behavior || 
        (typeof SCHOOL_DEFAULT_BEHAVIORS !== 'undefined' ? SCHOOL_DEFAULT_BEHAVIORS[config.schoolName] : null) ||
        'gentle_bloom';
    var baseBehavior = (typeof GROWTH_BEHAVIORS !== 'undefined' ? GROWTH_BEHAVIORS[behaviorName] : null) || getDefaultBehavior();
    
    console.log('[OrganicGrowth] School:', config.schoolName, 'Behavior:', behaviorName);
    
    var shape = config.shape || 'organic';
    var shapeMask = getShapeMask(shape);
    
    // Symmetry: 0 = full randomness, 1 = highly symmetrical/ordered
    var symmetry = config.symmetry !== undefined ? config.symmetry : 0.3;
    
    // Outward Growth: 0 = compact near center, 1 = aggressive outward reach
    // Priority: config value > behavior default > 0.5
    var outwardGrowth = config.outward_growth !== undefined ? config.outward_growth :
                        (baseBehavior.outwardGrowth !== undefined ? baseBehavior.outwardGrowth : 0.5);
    
    console.log('[OrganicGrowth] Symmetry:', symmetry, 'OutwardGrowth:', outwardGrowth, 'Shape:', shape);
    
    var positions = [];
    var edges = [];
    var placedNodes = [];
    var nodesByTier = {};  // Track nodes per tier for fill threshold
    var hubNodes = [];     // Track hub nodes
    var nodesSinceLastHub = 0;
    
    if (spells.length === 0) {
        return { positions: [], edges: [] };
    }
    
    // Step 1: Discover NLP groups
    var groups = discoverFuzzyGroupsFromSpells(spells.slice(), rng);
    console.log('[OrganicGrowth] Groups:', groups.map(function(g) { return g.theme + '(' + g.spells.length + ')'; }).join(', '));
    
    // Assign angular regions to groups
    var usableSector = sliceInfo.sectorAngle * 0.85;
    var sectorStart = sliceInfo.spokeAngle - usableSector / 2;
    var groupCount = Math.max(1, groups.length);
    
    groups.forEach(function(group, idx) {
        var laneWidth = usableSector / groupCount;
        group.preferredAngle = sectorStart + (idx + 0.5) * laneWidth;
        group.angleMin = sectorStart + idx * laneWidth;
        group.angleMax = sectorStart + (idx + 1) * laneWidth;
    });
    
    // Build spell -> group mapping
    var spellToGroup = {};
    groups.forEach(function(group) {
        group.spells.forEach(function(spell) {
            spellToGroup[spell.formId] = group;
        });
    });
    
    // Step 2: Find and place root spell
    var VANILLA_ROOT_FORMIDS = {
        'Destruction': '0x00012FCD',
        'Restoration': '0x00012FCC',
        'Alteration': '0x0005AD5C',
        'Conjuration': '0x000640B6',
        'Illusion': '0x00021143'
    };
    
    var VANILLA_ROOT_NAMES = {
        'Destruction': 'flames',
        'Restoration': 'healing', 
        'Alteration': 'oakflesh',
        'Conjuration': 'conjure familiar',
        'Illusion': 'clairvoyance'
    };
    
    var rootFormId = VANILLA_ROOT_FORMIDS[config.schoolName];
    var rootName = VANILLA_ROOT_NAMES[config.schoolName];
    var rootSpell = null;
    var spellQueue = [];
    
    spells.forEach(function(spell) {
        if (!rootSpell && rootFormId && spell.formId === rootFormId) {
            rootSpell = spell;
        } else if (!rootSpell && rootName && spell.name && 
                   spell.name.toLowerCase() === rootName) {
            rootSpell = spell;
        } else {
            spellQueue.push(spell);
        }
    });
    
    if (!rootSpell) rootSpell = spellQueue.shift();
    
    // Place root
    var rootRad = sliceInfo.spokeAngle * Math.PI / 180;
    var rootNode = {
        tier: 0,
        radius: baseRadius,
        angle: sliceInfo.spokeAngle,
        x: Math.cos(rootRad) * baseRadius,
        y: Math.sin(rootRad) * baseRadius,
        isRoot: true,
        isHub: true,  // Root is always a hub
        spell: rootSpell,
        formId: rootSpell.formId,
        children: [],
        _fromVisualFirst: true
    };
    positions.push(rootNode);
    placedNodes.push(rootNode);
    hubNodes.push(rootNode);
    nodesByTier[0] = [rootNode];
    
    // Step 3: Sort spells by group AND spell level (Novice → Master within each group)
    spellQueue.sort(function(a, b) {
        var groupA = spellToGroup[a.formId];
        var groupB = spellToGroup[b.formId];
        if (!groupA || !groupB) return 0;
        
        // First sort by group (angular position)
        if (groupA.theme !== groupB.theme) {
            return groupA.preferredAngle - groupB.preferredAngle;
        }
        
        // Within same group, sort by spell level (lower levels first)
        var levelA = getSpellRank(a);
        var levelB = getSpellRank(b);
        if (levelA !== levelB) {
            return levelA - levelB;  // Novice (0) before Apprentice (1) before Master (4)
        }
        
        // Same level: use match score
        return (b.matchScore || 0) - (a.matchScore || 0);
    });
    
    // Step 4: Grow tree using behavior-driven placement with DYNAMIC tier-weighted selection
    var currentTier = 1;
    var maxTier = 1;
    
    // Count spells by rank for dynamic tier calculation
    var spellsByRank = [0, 0, 0, 0, 0]; // Novice, Apprentice, Adept, Expert, Master
    spellQueue.forEach(function(s) {
        var rank = getSpellRank(s);
        spellsByRank[Math.min(4, rank)]++;
    });
    
    // Estimate max tiers based on spell count and grid capacity
    // Assume ~8-12 spells per tier on average (varies by sector size)
    var estimatedTiers = Math.max(10, Math.ceil(totalSpells / 8));
    
    // Calculate dynamic tier ranges for each rank
    // Spread ranks across the estimated tree depth proportionally
    var tierRanges = calculateTierRanges(spellsByRank, estimatedTiers);
    
    console.log('[OrganicGrowth] Dynamic tier ranges:', JSON.stringify(tierRanges));
    console.log('[OrganicGrowth] Spells by rank:', spellsByRank, 'Estimated tiers:', estimatedTiers);
    
    /**
     * Calculate dynamic tier ranges based on spell distribution.
     * Each rank gets a range of tiers where it's "allowed" with full probability.
     */
    function calculateTierRanges(rankCounts, maxTiers) {
        var totalSpells = rankCounts.reduce(function(a, b) { return a + b; }, 0);
        if (totalSpells === 0) return { 0: [1, maxTiers], 1: [1, maxTiers], 2: [1, maxTiers], 3: [1, maxTiers], 4: [1, maxTiers] };
        
        var ranges = {};
        var currentStart = 1;
        
        for (var rank = 0; rank <= 4; rank++) {
            var proportion = rankCounts[rank] / totalSpells;
            // Each rank gets tiers proportional to its spell count
            // Minimum 2 tiers per rank that has spells, more for ranks with many spells
            var tiersForRank = Math.max(2, Math.ceil(proportion * maxTiers * 1.2));
            
            // Overlap: ranks can appear slightly before their "main" range
            var overlapStart = Math.max(1, currentStart - 1);
            var rangeEnd = Math.min(maxTiers, currentStart + tiersForRank);
            
            ranges[rank] = {
                start: overlapStart,      // Earliest tier this rank is allowed
                main: currentStart,        // Main range start (full probability)
                end: rangeEnd,            // Latest tier with full probability
                extended: maxTiers        // Can still appear beyond, with lower probability
            };
            
            currentStart = rangeEnd;
        }
        
        return ranges;
    }
    
    /**
     * Select next spell from queue based on current tier (DYNAMIC version).
     * Uses calculated tier ranges to determine allowed spells.
     */
    function selectNextSpell(queue, placementTier, rng) {
        if (queue.length === 0) return null;
        if (queue.length === 1) return queue.shift();
        
        // Build weighted candidates based on dynamic tier ranges
        var candidates = [];
        var totalWeight = 0;
        
        for (var i = 0; i < queue.length; i++) {
            var spell = queue[i];
            var spellRank = getSpellRank(spell);
            var range = tierRanges[spellRank] || tierRanges[0];
            
            var weight = 0.1; // Base weight (always some small chance)
            
            if (placementTier < range.start) {
                // Before this rank's allowed range - very low probability
                // Higher ranks shouldn't appear in early tiers
                weight = 0.05;
            } else if (placementTier >= range.start && placementTier < range.main) {
                // In overlap zone - moderate probability
                weight = 0.4;
            } else if (placementTier >= range.main && placementTier <= range.end) {
                // In main range - full probability
                weight = 1.0;
            } else if (placementTier > range.end && placementTier <= range.extended) {
                // Beyond main range but still allowed - decreasing probability
                var overTiers = placementTier - range.end;
                weight = Math.max(0.2, 1.0 - overTiers * 0.1);
            }
            
            // Fuzzy group bonus: if spell matches an active fuzzy group being built
            var group = spellToGroup[spell.formId];
            if (group && group.matchScore > 0.5) {
                weight *= 1.3;
            }
            
            candidates.push({ index: i, spell: spell, weight: weight });
            totalWeight += weight;
        }
        
        // Weighted random selection
        var roll = rng() * totalWeight;
        var cumulative = 0;
        
        for (var j = 0; j < candidates.length; j++) {
            cumulative += candidates[j].weight;
            if (roll <= cumulative) {
                return queue.splice(candidates[j].index, 1)[0];
            }
        }
        
        // Fallback: return first
        return queue.shift();
    }

    // Initialize params before loop (in case loop doesn't run due to empty queue)
    var params = baseBehavior || {};
    params.symmetry = symmetry;
    params.outwardGrowth = outwardGrowth;
    // Ensure crossConnectionDensity has a default
    if (params.crossConnectionDensity === undefined) {
        params.crossConnectionDensity = 0.1;
    }

    while (spellQueue.length > 0) {

        // Calculate progress and get behavior parameters for this point
        var progress = 1 - (spellQueue.length / totalSpells);
        params = typeof getActiveParameters === 'function'
            ? getActiveParameters(baseBehavior, progress)
            : baseBehavior;
        
        // Add symmetry and outwardGrowth from config to params
        params.symmetry = symmetry;
        params.outwardGrowth = outwardGrowth;
        // Pass tree generation settings for element isolation etc
        params.treeGeneration = config.treeGeneration;

        // Select spell with tier-weighted probability (not just shift)
        var spell = selectNextSpell(spellQueue, currentTier, rng);
        if (!spell) break;
        
        var group = spellToGroup[spell.formId];
        
        // Estimate tier capacity for fill threshold - use unified config
        var tierRadius = baseRadius + currentTier * gridCfg.tierSpacing;
        var tierArc = (sliceInfo.sectorAngle * Math.PI / 180) * tierRadius;
        var tierCapacity = Math.floor(tierArc / gridCfg.arcSpacing);
        var tierNodesPlaced = nodesByTier[currentTier] ? nodesByTier[currentTier].length : 0;
        
        // Find best parent node (pass spell for level-aware selection)
        var parentNode = findBehaviorParent(placedNodes, hubNodes, group, params, rng, spell);
        
        // Calculate preferred direction based on behavior
        var direction = typeof calculatePreferredDirection === 'function'
            ? calculatePreferredDirection(parentNode, params, tierNodesPlaced, tierCapacity, sliceInfo, rng)
            : { angle: parentNode.angle + (rng() - 0.5) * 20, radiusStep: gridCfg.tierSpacing };
        
        // Find best position near parent in preferred direction
        var bestPos = findBehaviorPosition(
            parentNode, direction, group, placedNodes, sliceInfo, shapeMask,
            nodeSize, minNodeSpacing, rng, params
        );
        
        if (!bestPos) {
            bestPos = findFallbackPosition(sliceInfo, tierRadius, currentTier, rng, nodeSize, placedNodes, minNodeSpacing);
        }
        
        // If still no position, skip this spell (shouldn't happen with enough tiers)
        if (!bestPos) {
            console.warn('[OrganicGrowth] Could not find position for spell:', spell.formId);
            continue;
        }
        
        // Determine if this node should be a hub
        var isHub = typeof shouldBeHub === 'function' 
            ? shouldBeHub({ tier: currentTier }, params, nodesSinceLastHub, rng)
            : false;
        
        // Create node - clamp tier to reasonable range (use unified config)
        var rawTier = Math.floor((bestPos.radius - baseRadius) / gridCfg.tierSpacing) + 1;
        var nodeTier = Math.max(1, Math.min(500, rawTier)); // Cap at 500 tiers max
        var node = {
            tier: nodeTier,
            radius: bestPos.radius,
            angle: bestPos.angle,
            x: bestPos.x,
            y: bestPos.y,
            isRoot: false,
            isHub: isHub,
            spell: spell,
            formId: spell.formId,
            fuzzyGroup: group ? group.theme : '_other',
            parent: parentNode.formId,
            children: [],
            _fromVisualFirst: true
        };
        
        positions.push(node);
        placedNodes.push(node);
        parentNode.children.push(node.formId);
        
        // Track by tier
        if (!nodesByTier[nodeTier]) nodesByTier[nodeTier] = [];
        nodesByTier[nodeTier].push(node);
        
        if (isHub) {
            hubNodes.push(node);
            nodesSinceLastHub = 0;
        } else {
            nodesSinceLastHub++;
        }
        
        // Create edge to parent
        edges.push({
            from: parentNode.formId,
            to: spell.formId,
            type: isHub ? 'hub' : 'primary'
        });
        
        // DISABLED: Terminal cluster creation causes bunching outside grid
        // All spells now placed on exact grid positions via the main loop
        
        // Update current tier tracking
        maxTier = Math.max(maxTier, nodeTier);
        
        // Advance tier based on fill threshold
        var fillRatio = tierCapacity > 0 ? tierNodesPlaced / tierCapacity : 1;
        if (fillRatio >= params.layerFillThreshold || params.verticalBias > 0.3) {
            currentTier = Math.min(currentTier + 1, maxTier + 1);
        }
    }
    
    // Step 5: Add cross-group and web connections based on behavior
    var crossConnections = typeof getCrossConnections === 'function'
        ? getCrossConnections(positions, params, rng)
        : [];
    
    crossConnections.forEach(function(conn) {
        edges.push({
            from: conn.from.formId,
            to: conn.to.formId,
            type: conn.type || 'cross'
        });
    });
    
    // Step 6: Add prerequisite links based on spell rank
    // Pass treeGeneration settings for element isolation
    var prereqResult = addPrerequisiteLinks(positions, edges, spellToGroup, rng, config.treeGeneration);
    
    // Step 7: Add alternate paths between nearby same-tier nodes with long paths
    // Pass alternate path config from school config (supports both camelCase and snake_case)
    var altPathConfig = {
        minPathDistance: config.altPathMinDistance || config.alt_path_min_distance,
        maxSpatialDistance: config.altPathMaxDistance || config.alt_path_max_distance,
        baseProbability: config.altPathProbability || config.alt_path_probability,
        maxAlternatesPerNode: config.altPathMaxPerNode || config.alt_path_max_per_node,
        fuzzyBonus: config.altPathFuzzyBonus || config.alt_path_fuzzy_bonus
    };
    var alternateResult = addAlternatePaths(positions, edges, spellToGroup, rng, altPathConfig);
    
    // Step 8: Assign hard/soft prerequisite requirements
    var prereqStats = assignPrerequisiteRequirements(positions, edges, rng);
    
    // Step 9: Fix thematic inconsistencies (post-processing)
    // This ensures spells have at least one thematically related prerequisite
    var thematicStats = fixThematicInconsistencies(positions, edges, rng);
    
    console.log('[OrganicGrowth] Placed', positions.length, 'nodes,', edges.length, 'edges,', 
                hubNodes.length, 'hubs,', prereqResult.count, 'prereqs,', 
                alternateResult.count, 'alternates, max tier:', maxTier,
                ', thematic fixes:', thematicStats.nodesFixed);
    
    return { positions: positions, edges: edges };
}

/**
 * Find best parent for a new node based on behavior and spell level.
 * - Root can ONLY branch to Novice/Apprentice (level 0-1), max 4-6 children
 * - Other nodes limited by available adjacent empty positions
 * - Parents should have spell level <= child's level
 */
function findBehaviorParent(placedNodes, hubNodes, group, params, rng, childSpell) {
    var childLevel = childSpell ? getSpellRank(childSpell) : 0;

    // LOG: Show element isolation settings for this parent search
    var tg = params.treeGeneration || {};
    if (childSpell && childSpell.name) {
        console.log('[findBehaviorParent] Spell:', childSpell.name,
                    '| elementIsolation:', tg.elementIsolation,
                    '| strict:', tg.elementIsolationStrict);
    }

    // Branch limits
    var ROOT_MAX_CHILDREN = 5;       // Root can have max 5 direct children
    var NODE_MAX_CHILDREN = 4;       // Regular nodes max 4 children
    var ROOT_MAX_CHILD_LEVEL = 1;    // Root only accepts Novice(0) or Apprentice(1)
    
    // Filter candidates by multiple criteria
    var candidateFilter = function(n) {
        var childCount = n.children ? n.children.length : 0;
        var parentLevel = n.spell ? getSpellRank(n.spell) : 0;
        
        // ROOT NODE: Special restrictions
        if (n.isRoot) {
            // Root already has max children? Skip
            if (childCount >= ROOT_MAX_CHILDREN) return false;
            
            // Root can only accept Novice (0) or Apprentice (1) children
            if (childLevel > ROOT_MAX_CHILD_LEVEL) return false;
            
            return true;
        }
        
        // REGULAR NODES: Check child limit
        if (childCount >= NODE_MAX_CHILDREN) return false;
        
        // Level check: parent level should be <= child level
        // Allow 1 level higher with small probability for occasional jumps
        if (parentLevel > childLevel && !(parentLevel === childLevel + 1 && rng() < 0.15)) {
            return false;
        }
        
        return true;
    };
    
    // If we have hubs and behavior prefers them, consider hubs first
    if (hubNodes.length > 1 && params.hubProbability > 0.2 && rng() < 0.4) {
        var validHubs = hubNodes.filter(candidateFilter);
        if (validHubs.length > 1) {
            // Pick a random valid hub (not the root if child level is too high)
            var nonRootHubs = validHubs.filter(function(h) { return !h.isRoot; });
            if (nonRootHubs.length > 0) {
                var idx = Math.floor(rng() * nonRootHubs.length);
                return nonRootHubs[idx];
            }
        }
    }
    
    // Find nodes in same group that pass all filters
    var candidates = group ? placedNodes.filter(function(n) {
        if (!candidateFilter(n)) return false;
        return n.fuzzyGroup === group.theme || n.isRoot || n.isHub;
    }) : placedNodes.filter(candidateFilter);
    
    // Fallback: if no group-matching candidates, try any that pass filter
    if (candidates.length === 0) {
        candidates = placedNodes.filter(candidateFilter);
    }
    
    // Last resort: find node with fewest children (ignoring level)
    if (candidates.length === 0) {
        var sorted = placedNodes.slice().sort(function(a, b) {
            return (a.children ? a.children.length : 0) - (b.children ? b.children.length : 0);
        });
        // Return the one with fewest children
        return sorted[0];
    }
    
    // Score candidates: prefer appropriate parents with matching spell levels AND themes
    candidates.sort(function(a, b) {
        var aChildren = a.children ? a.children.length : 0;
        var bChildren = b.children ? b.children.length : 0;
        var aLevel = a.spell ? getSpellRank(a.spell) : 0;
        var bLevel = b.spell ? getSpellRank(b.spell) : 0;
        
        // Heavy penalty for root if child level > 1
        var aRootPenalty = (a.isRoot && childLevel > ROOT_MAX_CHILD_LEVEL) ? 1000 : 0;
        var bRootPenalty = (b.isRoot && childLevel > ROOT_MAX_CHILD_LEVEL) ? 1000 : 0;
        
        // Prefer closer spell levels (same level best, 1 level lower also good)
        var aLevelDiff = Math.abs(aLevel - childLevel);
        var bLevelDiff = Math.abs(bLevel - childLevel);
        
        // Penalize parents with higher level than child (hierarchy should go low → high)
        var aLevelPenalty = (aLevel > childLevel) ? 10 : 0;
        var bLevelPenalty = (bLevel > childLevel) ? 10 : 0;
        
        // Fuzzy group bonus: same group = better thematic connection
        var aGroupBonus = (group && a.fuzzyGroup === group.theme) ? -5 : 0;
        var bGroupBonus = (group && b.fuzzyGroup === group.theme) ? -5 : 0;
        
        // THEMATIC BONUS: Prefer parents with similar element/theme keywords
        // This is critical for avoiding illogical prereqs like fire->frost
        var aThematicBonus = 0;
        var bThematicBonus = 0;
        var aElementPenalty = 0;
        var bElementPenalty = 0;

        if (childSpell && a.spell) {
            var aSim = calculateThematicSimilarity(childSpell, a.spell);
            aThematicBonus = aSim > 0.5 ? -10 : (aSim > 0.3 ? -5 : 0);

            // Element isolation penalty (uses config.treeGeneration if available)
            if (aSim <= 0.1) {  // Element conflict (fire vs frost etc)
                if (params.treeGeneration && params.treeGeneration.elementIsolationStrict) {
                    aElementPenalty = 10000;  // Effectively forbidden
                    console.log('[ELEMENT CONFLICT] STRICT BLOCK:', childSpell.name, '<-', a.spell.name, '(penalty 10000)');
                } else if (params.treeGeneration && params.treeGeneration.elementIsolation) {
                    aElementPenalty = 100;  // Strong penalty
                    console.log('[ELEMENT CONFLICT] penalty:', childSpell.name, '<-', a.spell.name, '(penalty 100)');
                }
            }
        }
        if (childSpell && b.spell) {
            var bSim = calculateThematicSimilarity(childSpell, b.spell);
            bThematicBonus = bSim > 0.5 ? -10 : (bSim > 0.3 ? -5 : 0);

            // Element isolation penalty
            if (bSim <= 0.1) {  // Element conflict
                if (params.treeGeneration && params.treeGeneration.elementIsolationStrict) {
                    bElementPenalty = 10000;
                } else if (params.treeGeneration && params.treeGeneration.elementIsolation) {
                    bElementPenalty = 100;
                }
            }
        }

        // Combined score: lower = better
        // child count * 3 + level diff * 2 + level penalty + root penalty + group bonus + thematic bonus + element penalty
        var aScore = aChildren * 3 + aLevelDiff * 2 + aLevelPenalty + aRootPenalty + aGroupBonus + aThematicBonus + aElementPenalty;
        var bScore = bChildren * 3 + bLevelDiff * 2 + bLevelPenalty + bRootPenalty + bGroupBonus + bThematicBonus + bElementPenalty;
        
        return aScore - bScore;
    });
    
    // Pick from top candidates with some randomness (but not too random)
    var pickIdx = Math.floor(rng() * Math.min(3, candidates.length));
    return candidates[pickIdx];
}

/**
 * Find position based on behavior-driven direction
 * GRID-ALIGNED: Snaps to proper tier radii and angular grid positions
 * PREVENTS OVERLAP: Uses strict distance check against ALL placed nodes
 */
function findBehaviorPosition(parent, direction, group, placedNodes, sliceInfo, shapeMask, nodeSize, minSpacing, rng, params) {
    var candidates = [];
    var baseAngle = direction.angle;
    
    // GRID CONFIGURATION - Use unified source from config.js
    var gridCfg = GRID_CONFIG.getComputedConfig();
    var baseRadius = gridCfg.baseRadius;
    var tierSpacing = gridCfg.tierSpacing;
    var arcSpacing = gridCfg.arcSpacing;
    
    // Use full minSpacing (not 0.9x) to ensure NO overlap
    var strictSpacing = minSpacing;
    
    // Determine target tier (snap to grid)
    var parentTier = Math.max(0, Math.round((parent.radius - baseRadius) / tierSpacing));
    var radiusStep = direction.radiusStep || tierSpacing;
    
    // Tier skip: how many tiers to jump (default 0 = adjacent tier, 1 = skip one tier)
    // Set to 0 for standard tree growth (nodes connect to adjacent tiers)
    var tierSkip = (params && params.tierSkip !== undefined) ? params.tierSkip : 0;
    var baseTierTarget = parentTier + 1 + tierSkip;
    
    // Build list of tiers to try - MORE AGGRESSIVE outward growth
    // Always try multiple tiers outward to ensure trees spread
    var tiersToTry = [baseTierTarget, baseTierTarget + 1, baseTierTarget + 2];
    // Sometimes try even further (40% chance for long branches)
    if (rng() < 0.4) {
        tiersToTry.push(baseTierTarget + 3);
    }
    // Rarely try same tier as parent (5% chance, for tight clusters)
    if (rng() < 0.05 && parentTier > 0) {
        tiersToTry.push(parentTier);
    }
    
    for (var t = 0; t < tiersToTry.length; t++) {
        var tier = tiersToTry[t];
        var radius = baseRadius + tier * tierSpacing;
        
        // Calculate angular grid positions for this tier
        var arcLength = (sliceInfo.sectorAngle / 360) * 2 * Math.PI * radius;
        var candidateCount = Math.max(3, Math.floor(arcLength / arcSpacing));
        var usableAngle = sliceInfo.sectorAngle * 0.85;
        var angleStep = candidateCount > 1 ? usableAngle / (candidateCount - 1) : 0;
        var startAngle = sliceInfo.spokeAngle - usableAngle / 2;
        
        // Try each angular grid position
        for (var i = 0; i < candidateCount; i++) {
            var angle = candidateCount === 1 
                ? sliceInfo.spokeAngle 
                : startAngle + i * angleStep;
            
            // NO JITTER - exact grid positions only
            
            // Clamp to sector
            if (angle < sliceInfo.startAngle + 3 || angle > sliceInfo.endAngle - 3) continue;
            
            // Check shape mask
            var tierProgress = Math.min(1, (radius - baseRadius) / (tierSpacing * 15));
            var angleNorm = (angle - sliceInfo.startAngle) / sliceInfo.sectorAngle;
            angleNorm = Math.max(0, Math.min(1, angleNorm));
            
            if (!shapeMask(tierProgress, angleNorm, rng)) continue;
            
            // Calculate position
            var rad = angle * Math.PI / 180;
            var x = Math.cos(rad) * radius;
            var y = Math.sin(rad) * radius;
            
            // STRICT CHECK: Position must NOT overlap with ANY placed node
            var isOccupied = false;
            for (var j = 0; j < placedNodes.length; j++) {
                var dx = x - placedNodes[j].x;
                var dy = y - placedNodes[j].y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                // Use strict spacing - if distance is less than minSpacing, position is occupied
                if (dist < strictSpacing) {
                    isOccupied = true;
                    break;
                }
            }
            if (isOccupied) continue;
            
            // Score: prefer positions based on outwardGrowth parameter
            var angleDiff = Math.abs(angle - parent.angle);
            var tierDiff = tier - parentTier;  // Positive = outward (good), negative = inward (bad)
            
            // Get outwardGrowth from params (0 = compact, 1 = max outward)
            var outwardGrowth = (params && params.outwardGrowth !== undefined) ? params.outwardGrowth : 0.5;
            
            // Base score: lower is better
            // Small penalty for angular deviation to keep connected appearance
            var score = angleDiff * 1.5;
            
            // OUTWARD GROWTH BONUS: Scaled by outwardGrowth parameter
            // High outwardGrowth (0.8-1.0) = strong preference for distant tiers
            // Low outwardGrowth (0.2-0.4) = preference for adjacent tiers
            var outwardBonus = outwardGrowth * 50;  // 0-50 bonus range
            var compactBonus = (1 - outwardGrowth) * 30;  // 0-30 bonus for staying close
            
            if (tierDiff >= 1 && tierDiff <= 2) {
                // 1-2 tiers out: gets bonus based on outwardGrowth
                score -= outwardBonus * 0.8;  // 80% of outward bonus
            } else if (tierDiff >= 3) {
                // 3+ tiers out: full outward bonus for aggressive growth
                score -= outwardBonus;
            } else if (tierDiff === 0) {
                // Same tier: gets bonus if low outwardGrowth (compact)
                score -= compactBonus;
                // But still penalize somewhat to prevent stagnation
                score += 20;
            } else {
                // Going inward: always penalize
                score += 100;
            }
            
            // SYMMETRY: Higher symmetry = prefer angular positions closer to slice center
            var symmetryValue = (params && params.symmetry !== undefined) ? params.symmetry : 0.3;
            if (symmetryValue > 0) {
                var distFromCenter = Math.abs(angle - sliceInfo.spokeAngle);
                // Symmetry only affects angular spread, NOT radial growth
                score += distFromCenter * symmetryValue * 2;
            }
            
            candidates.push({ x: x, y: y, radius: radius, angle: angle, tier: tier, score: score, slot: tier + ':' + i });
        }
    }
    
    if (candidates.length === 0) return null;
    
    // Sort by score, pick the BEST position (exact grid alignment)
    candidates.sort(function(a, b) { return a.score - b.score; });
    return candidates[0];
}

/**
 * Place terminal cluster (fruit/leaves) around parent
 */
function placeTerminalCluster(cluster, positions, placedNodes, edges, nodesByTier, sliceInfo, nodeSize, minSpacing, rng) {
    // Use unified config
    var gridCfg = GRID_CONFIG.getComputedConfig();
    
    var parent = cluster.parent;
    var spells = cluster.spells;
    var count = spells.length;
    var clusterRadius = gridCfg.minNodeSpacing * 0.6;
    
    for (var i = 0; i < count; i++) {
        var spell = spells[i];
        var angleOffset = (i / count) * 360;
        var clusterAngle = parent.angle + (i - count/2) * 8;
        // Snap to grid tier instead of using jitter
        var targetTier = Math.ceil((parent.radius - gridCfg.baseRadius) / gridCfg.tierSpacing) + 1;
        var clusterR = gridCfg.baseRadius + targetTier * gridCfg.tierSpacing;
        
        // Clamp to sector
        clusterAngle = Math.max(sliceInfo.startAngle + 2, Math.min(sliceInfo.endAngle - 2, clusterAngle));
        
        var rad = clusterAngle * Math.PI / 180;
        var x = Math.cos(rad) * clusterR;
        var y = Math.sin(rad) * clusterR;
        
        // Check spacing and nudge if needed
        for (var attempt = 0; attempt < 5; attempt++) {
            var ok = true;
            for (var j = 0; j < placedNodes.length; j++) {
                var dx = x - placedNodes[j].x;
                var dy = y - placedNodes[j].y;
                if (Math.sqrt(dx * dx + dy * dy) < minSpacing * 0.7) {
                    ok = false;
                    clusterR += gridCfg.tierSpacing * 0.2;
                    x = Math.cos(rad) * clusterR;
                    y = Math.sin(rad) * clusterR;
                    break;
                }
            }
            if (ok) break;
        }
        
        var nodeTier = Math.max(1, Math.floor((clusterR - gridCfg.baseRadius) / gridCfg.tierSpacing) + 1);
        
        var node = {
            tier: nodeTier,
            radius: clusterR,
            angle: clusterAngle,
            x: x,
            y: y,
            isRoot: false,
            isTerminal: true,
            spell: spell,
            formId: spell.formId,
            fuzzyGroup: parent.fuzzyGroup,
            parent: parent.formId,
            children: [],
            _fromVisualFirst: true
        };
        
        positions.push(node);
        placedNodes.push(node);
        
        if (!nodesByTier[nodeTier]) nodesByTier[nodeTier] = [];
        nodesByTier[nodeTier].push(node);
        
        edges.push({
            from: parent.formId,
            to: spell.formId,
            type: 'terminal'
        });
    }
}

// =============================================================================
// PREREQUISITE LINK SYSTEM
// =============================================================================

/**
 * Prerequisite count by spell rank
 * Higher rank spells require more prerequisites
 */
var PREREQ_COUNTS_BY_RANK = {
    0: { min: 0, max: 0 },   // Novice - no prerequisites (entry points)
    1: { min: 1, max: 2 },   // Apprentice - 1-2 prerequisites
    2: { min: 1, max: 3 },   // Adept - 1-3 prerequisites
    3: { min: 2, max: 4 },   // Expert - 2-4 prerequisites
    4: { min: 2, max: 5 }    // Master - 2-5 prerequisites
};

/**
 * Get spell rank index from skill level
 */
function getSpellRank(spell) {
    if (!spell) return 0;
    
    var level = spell.skillLevel || spell.tier || 0;
    
    // Handle string levels
    if (typeof level === 'string') {
        var levelLower = level.toLowerCase();
        if (levelLower.indexOf('novice') >= 0) return 0;
        if (levelLower.indexOf('apprentice') >= 0) return 1;
        if (levelLower.indexOf('adept') >= 0) return 2;
        if (levelLower.indexOf('expert') >= 0) return 3;
        if (levelLower.indexOf('master') >= 0) return 4;
    }
    
    // Handle numeric levels (0-100 skill requirement)
    if (typeof level === 'number') {
        if (level < 25) return 0;      // Novice
        if (level < 50) return 1;      // Apprentice
        if (level < 75) return 2;      // Adept
        if (level < 100) return 3;     // Expert
        return 4;                       // Master
    }
    
    return 0;
}

/**
 * Calculate similarity score between two nodes for prerequisite selection
 * Higher score = better prerequisite candidate
 *
 * @param {Object} candidate - Potential prerequisite node
 * @param {Object} target - Node that needs prerequisites
 * @param {Object} spellToGroup - Spell to fuzzy group mapping
 * @param {Object} treeGeneration - Tree generation settings (optional)
 * @returns {number} - Score (higher = better match)
 */
function calculatePrereqScore(candidate, target, spellToGroup, treeGeneration) {
    var score = 0;
    var treeGen = treeGeneration || {};

    // 0. ELEMENT ISOLATION CHECK (highest priority)
    // Must check this first - element conflicts cause massive penalties
    if (candidate.spell && target.spell) {
        var thematicSim = calculateThematicSimilarity(candidate.spell, target.spell);
        var hasElementConflict = thematicSim <= 0.1;  // 0.1 = element conflict

        if (hasElementConflict) {
            if (treeGen.elementIsolationStrict) {
                return -10000;  // Forbidden - cross-element links not allowed
            } else if (treeGen.elementIsolation) {
                score -= 500;   // Heavy penalty but not forbidden
            }
        } else if (thematicSim >= 0.8) {
            // Same element bonus
            score += 100;
        }
    }

    // 1. TIER FACTOR: Candidate must be lower tier (closer to root)
    // Strong preference for 1-3 tiers below
    var tierDiff = target.tier - candidate.tier;
    if (tierDiff <= 0) {
        return -1000; // Invalid: prerequisite must be lower tier
    }
    if (tierDiff === 1) score += 50;      // Immediate predecessor - best
    else if (tierDiff === 2) score += 40;
    else if (tierDiff <= 4) score += 30;
    else if (tierDiff <= 8) score += 15;
    else score += 5;                       // Very distant - still valid but not preferred

    // 2. FUZZY GROUP FACTOR: Same thematic group is preferred
    var candidateGroup = spellToGroup[candidate.formId];
    var targetGroup = spellToGroup[target.formId];

    if (candidateGroup && targetGroup) {
        if (candidateGroup.theme === targetGroup.theme) {
            score += 40; // Same theme - strong connection
        } else {
            score += 10; // Different theme - cross-school knowledge
        }
    }

    // 3. PROXIMITY FACTOR: Closer nodes preferred (but not too close)
    var dx = target.x - candidate.x;
    var dy = target.y - candidate.y;
    var distance = Math.sqrt(dx * dx + dy * dy);
    var nodeSize = GRID_CONFIG.nodeSize;

    if (distance < nodeSize * 2) {
        score += 30; // Very close - strong spatial connection
    } else if (distance < nodeSize * 5) {
        score += 20; // Moderate distance
    } else if (distance < nodeSize * 10) {
        score += 10; // Far but reasonable
    }
    // Very far gets no bonus

    // 4. RANK FACTOR: Prerequisite should be lower or equal rank
    var candidateRank = getSpellRank(candidate.spell);
    var targetRank = getSpellRank(target.spell);

    if (candidateRank < targetRank) {
        score += 25; // Lower rank - appropriate prerequisite
    } else if (candidateRank === targetRank) {
        score += 10; // Same rank - peer knowledge
    } else {
        score -= 20; // Higher rank prereq is unusual
    }

    // 5. HUB BONUS: Hubs make good prerequisites (knowledge centers)
    if (candidate.isHub) {
        score += 15;
    }

    return score;
}

/**
 * Add prerequisite links to spells based on rank and similarity
 *
 * @param {Array} positions - All node positions
 * @param {Array} edges - Existing edges (will be modified)
 * @param {Object} spellToGroup - Spell to fuzzy group mapping
 * @param {Function} rng - Random number generator
 * @param {Object} treeGeneration - Tree generation settings (for element isolation)
 * @returns {Object} - { count: number of prereqs added }
 */
function addPrerequisiteLinks(positions, edges, spellToGroup, rng, treeGeneration) {
    var prereqsAdded = 0;
    
    // Build existing edge set to avoid duplicates
    var existingEdges = {};
    edges.forEach(function(e) {
        var key = e.from + '->' + e.to;
        existingEdges[key] = true;
        // Also mark reverse (bidirectional check)
        existingEdges[e.to + '->' + e.from] = true;
    });
    
    // Build node lookup by formId
    var nodeByFormId = {};
    positions.forEach(function(node) {
        nodeByFormId[node.formId] = node;
    });
    
    // Process each non-root node
    positions.forEach(function(targetNode) {
        if (targetNode.isRoot) return; // Root has no prerequisites
        
        var spell = targetNode.spell;
        if (!spell) return;
        
        var rank = getSpellRank(spell);
        var prereqConfig = PREREQ_COUNTS_BY_RANK[rank] || { min: 0, max: 1 };
        
        // Determine how many prerequisites this spell needs
        var range = prereqConfig.max - prereqConfig.min;
        var targetPrereqCount = prereqConfig.min + Math.floor(rng() * (range + 1));
        
        if (targetPrereqCount <= 0) return;
        
        // Count existing prerequisites (incoming edges where this node is 'to')
        var existingPrereqCount = 0;
        edges.forEach(function(e) {
            if (e.to === targetNode.formId) {
                existingPrereqCount++;
            }
        });
        
        // How many more do we need?
        var prereqsNeeded = Math.max(0, targetPrereqCount - existingPrereqCount);
        if (prereqsNeeded <= 0) return;
        
        // Find and score all candidate prerequisites
        var candidates = [];
        positions.forEach(function(candidateNode) {
            if (candidateNode.formId === targetNode.formId) return; // Skip self
            if (candidateNode.tier >= targetNode.tier) return; // Must be lower tier
            
            // Skip if edge already exists
            var edgeKey = candidateNode.formId + '->' + targetNode.formId;
            if (existingEdges[edgeKey]) return;
            
            var score = calculatePrereqScore(candidateNode, targetNode, spellToGroup, treeGeneration);
            if (score > 0) {
                candidates.push({ node: candidateNode, score: score });
            }
        });
        
        // Sort by score (best first)
        candidates.sort(function(a, b) { return b.score - a.score; });
        
        // Add some randomness: don't always pick the absolute best
        // Shuffle top candidates slightly
        var topN = Math.min(candidates.length, prereqsNeeded * 3);
        for (var i = 0; i < topN - 1; i++) {
            if (rng() < 0.3) {
                // Swap with a nearby candidate
                var swapIdx = i + 1 + Math.floor(rng() * Math.min(3, topN - i - 1));
                if (swapIdx < topN) {
                    var temp = candidates[i];
                    candidates[i] = candidates[swapIdx];
                    candidates[swapIdx] = temp;
                }
            }
        }
        
        // Select prerequisites
        var selectedCount = 0;
        for (var i = 0; i < candidates.length && selectedCount < prereqsNeeded; i++) {
            var candidate = candidates[i];
            
            // Create prerequisite edge
            var edgeKey = candidate.node.formId + '->' + targetNode.formId;
            if (!existingEdges[edgeKey]) {
                edges.push({
                    from: candidate.node.formId,
                    to: targetNode.formId,
                    type: 'prerequisite'
                });
                existingEdges[edgeKey] = true;
                prereqsAdded++;
                selectedCount++;
                
                // Track prerequisites on the node
                if (!targetNode.prerequisites) targetNode.prerequisites = [];
                targetNode.prerequisites.push(candidate.node.formId);
            }
        }
    });
    
    return { count: prereqsAdded };
}

// =============================================================================
// UNIFIED PREREQUISITE SYSTEM (Hard/Soft Needs)
// =============================================================================

/**
 * Configuration for prerequisite requirements by tier
 * Higher tiers = more prerequisites, more chance of hard requirements
 */
var PREREQ_TIER_CONFIG = {
    // tier: { maxHard, maxSoft, softNeededBase, hardChance }
    0: { maxHard: 0, maxSoft: 0, softNeededBase: 0, hardChance: 0 },      // Root - no prereqs
    1: { maxHard: 1, maxSoft: 0, softNeededBase: 0, hardChance: 0.1 },    // Novice - simple chain
    2: { maxHard: 1, maxSoft: 1, softNeededBase: 1, hardChance: 0.2 },    // Apprentice
    3: { maxHard: 1, maxSoft: 2, softNeededBase: 1, hardChance: 0.3 },    // Adept
    4: { maxHard: 2, maxSoft: 2, softNeededBase: 1, hardChance: 0.5 },    // Expert
    5: { maxHard: 2, maxSoft: 3, softNeededBase: 2, hardChance: 0.6 },    // Master
};

/**
 * Assign hard/soft prerequisite requirements to all nodes.
 * 
 * Rules:
 * - If node has only 1 incoming edge → always HARD
 * - Higher tier = more likely to have hard requirements + higher softNeeded
 * - Total needed never exceeds available prereqs
 * 
 * @param {Array} positions - All node positions with spell data
 * @param {Array} edges - All edges (primary + any added prereqs)
 * @param {Function} rng - Seeded random number generator
 * @returns {Object} - Stats about prereq assignment
 */
function assignPrerequisiteRequirements(positions, edges, rng) {
    var stats = { nodesProcessed: 0, hardAssigned: 0, softAssigned: 0, filteredOut: 0 };
    
    // Build position lookup by formId for tier/rank checking
    var positionByFormId = {};
    positions.forEach(function(p) {
        if (p.spell) positionByFormId[p.spell.formId] = p;
    });
    
    // Build incoming edges map: formId -> [incoming edge objects]
    var incomingEdges = {};
    positions.forEach(function(p) {
        if (p.spell) incomingEdges[p.spell.formId] = [];
    });
    
    edges.forEach(function(e) {
        if (incomingEdges[e.to]) {
            incomingEdges[e.to].push(e);
        }
    });
    
    // Process each node
    positions.forEach(function(node) {
        if (!node.spell || node.isRoot) return;
        
        var formId = node.spell.formId;
        var targetRank = getSpellRank(node.spell);
        var allIncoming = incomingEdges[formId] || [];
        
        // CRITICAL: Filter prerequisites - only allow same tier or weaker spells
        // A Novice spell can only have Novice prereqs, Apprentice can have Novice/Apprentice, etc.
        var incoming = allIncoming.filter(function(edge) {
            if (!edge || !edge.from) return false;
            var sourceNode = positionByFormId[edge.from];
            if (!sourceNode || !sourceNode.spell) return false;
            var sourceRank = getSpellRank(sourceNode.spell);
            // Source must be same rank or weaker (lower number = weaker)
            return sourceRank <= targetRank;
        });
        
        var filtered = allIncoming.length - incoming.length;
        if (filtered > 0) {
            stats.filteredOut += filtered;
        }
        
        if (incoming.length === 0) {
            // No valid prerequisites - root-level spell or all prereqs were stronger
            node.prereqRequirements = { hardPrereqs: [], softPrereqs: [], softNeeded: 0 };
            return;
        }
        
        stats.nodesProcessed++;
        
        // RULE: Single incoming edge = always HARD
        if (incoming.length === 1) {
            node.prereqRequirements = {
                hardPrereqs: [incoming[0].from],
                softPrereqs: [],
                softNeeded: 0
            };
            stats.hardAssigned++;
            return;
        }
        
        // Multiple incoming edges - decide hard vs soft
        var tier = Math.min(node.tier, 5);  // Cap at tier 5 config
        var config = PREREQ_TIER_CONFIG[tier] || PREREQ_TIER_CONFIG[5];
        
        var hardPrereqs = [];
        var softPrereqs = [];
        
        // Shuffle incoming edges for randomness
        var shuffled = incoming.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(rng() * (i + 1));
            var temp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
        }
        
        // Assign hard prereqs first (based on hardChance and maxHard)
        var hardCount = 0;
        shuffled.forEach(function(edge) {
            // Skip undefined/malformed edges
            if (!edge || !edge.from) return;
            
            if (hardCount < config.maxHard && rng() < config.hardChance) {
                hardPrereqs.push(edge.from);
                hardCount++;
                stats.hardAssigned++;
            } else {
                softPrereqs.push(edge.from);
                stats.softAssigned++;
            }
        });
        
        // Calculate softNeeded - never more than available soft prereqs
        var softNeeded = Math.min(config.softNeededBase, softPrereqs.length);
        
        // Add some variance to softNeeded
        if (softPrereqs.length > 1 && rng() < 0.3) {
            softNeeded = Math.min(softNeeded + 1, softPrereqs.length);
        }
        
        // IMPORTANT: Total needed (hard + softNeeded) never exceeds total available
        var totalAvailable = hardPrereqs.length + softPrereqs.length;
        var totalNeeded = hardPrereqs.length + softNeeded;
        if (totalNeeded > totalAvailable) {
            softNeeded = Math.max(0, totalAvailable - hardPrereqs.length);
        }
        
        // CONSOLIDATION: If softNeeded equals softPrereqs.length, they're effectively ALL required
        // Convert them to hard prereqs for clarity
        if (softNeeded > 0 && softNeeded >= softPrereqs.length) {
            // All soft prereqs are effectively hard - merge them
            hardPrereqs = hardPrereqs.concat(softPrereqs);
            softPrereqs = [];
            softNeeded = 0;
            console.log('[PrereqSystem] Consolidated ' + node.spell.name + ': all prereqs now HARD (' + hardPrereqs.length + ')');
        }
        
        node.prereqRequirements = {
            hardPrereqs: hardPrereqs,
            softPrereqs: softPrereqs,
            softNeeded: softNeeded
        };
    });
    
    console.log('[PrereqSystem] Assigned requirements: ' + stats.nodesProcessed + ' nodes, ' +
                stats.hardAssigned + ' hard, ' + stats.softAssigned + ' soft' +
                (stats.filteredOut > 0 ? ', ' + stats.filteredOut + ' stronger prereqs filtered out' : ''));
    
    return stats;
}

// =============================================================================
// THEMATIC KEYWORD MATCHING SYSTEM
// =============================================================================

/**
 * Extract thematic keywords from spell name/effects for matching.
 * This helps ensure prerequisites make thematic sense.
 */
var THEMATIC_KEYWORDS = {
    // Element groups - spells with these keywords should prefer same-element prereqs
    frost: ['frost', 'ice', 'cold', 'freeze', 'frozen', 'blizzard', 'frostbite', 'chill', 'winter', 'glacial', 'snow'],
    fire: ['fire', 'flame', 'burn', 'inferno', 'blaze', 'fireball', 'incinerate', 'scorch', 'heat', 'ember', 'ignite', 'magma', 'lava'],
    shock: ['shock', 'lightning', 'thunder', 'spark', 'electric', 'storm', 'bolt', 'discharge', 'chain lightning', 'electr'],
    stone: ['stone', 'earth', 'rock', 'granite', 'mineral', 'ore', 'boulder', 'grasp', 'petrify', 'crystallize', 'mud', 'sand', 'gravel'],
    wind: ['wind', 'air', 'gust', 'breeze', 'tornado', 'cyclone', 'whirlwind', 'gale'],
    poison: ['poison', 'venom', 'toxic', 'disease', 'plague', 'rot', 'decay', 'corrupt', 'taint', 'blight'],
    nature: ['nature', 'plant', 'vine', 'thorn', 'root', 'tree', 'forest', 'bloom', 'growth', 'seed', 'leaf', 'spriggan'],
    water: ['water', 'wave', 'ocean', 'sea', 'tide', 'aqua', 'drown', 'flood', 'rain', 'mist'],
    // Magic type groups
    conjuration: ['summon', 'conjure', 'bound', 'atronach', 'zombie', 'thrall', 'familiar', 'raise', 'reanimate', 'dremora', 'daedra', 'necro'],
    restoration: ['heal', 'restore', 'ward', 'protection', 'cure', 'repel', 'turn', 'undead', 'sunfire', 'bane', 'blessing', 'divine'],
    illusion: ['invisible', 'calm', 'fear', 'fury', 'courage', 'muffle', 'clairvoyance', 'vision', 'frenzy', 'rally', 'pacify', 'phantom', 'shadow', 'dream'],
    alteration: ['flesh', 'armor', 'transmute', 'detect', 'paralyze', 'levitate', 'feather', 'candlelight', 'light', 'mass', 'telekinesis', 'equilibrium'],
    // Effect types
    trap: ['trap', 'rune', 'mine', 'glyph'],
    cloak: ['cloak'],
    wall: ['wall'],
    projectile: ['bolt', 'ball', 'spray', 'stream'],
    aoe: ['mass', 'circle', 'storm', 'nova', 'explosion', 'burst']
};

/**
 * UNIFIED: Extract all searchable text from a spell.
 * This is the SINGLE source of truth for spell text extraction used by ALL fuzzy/NLP logic.
 * Includes: name, effectNames, effects (objects), and description.
 * 
 * @param {Object} spell - Spell object
 * @returns {string} - Lowercase concatenated text from all spell data
 */
function extractSpellText(spell) {
    if (!spell) return '';
    
    var textParts = [];
    
    // Spell name (most important)
    if (spell.name) {
        textParts.push(spell.name.toLowerCase());
    }
    
    // Effect names (e.g., "Fire Storm 100", "Ice Spike", etc.)
    if (spell.effectNames && Array.isArray(spell.effectNames)) {
        spell.effectNames.forEach(function(eff) {
            if (eff) textParts.push(String(eff).toLowerCase());
        });
    }
    
    // Detailed effects (if provided as objects with name property)
    if (spell.effects && Array.isArray(spell.effects)) {
        spell.effects.forEach(function(eff) {
            if (eff && eff.name) textParts.push(eff.name.toLowerCase());
            if (eff && eff.effectName) textParts.push(eff.effectName.toLowerCase());
            if (eff && eff.description) textParts.push(eff.description.toLowerCase());
        });
    }
    
    // Description (critical for thematic matching)
    if (spell.description) {
        textParts.push(spell.description.toLowerCase());
    }
    
    return textParts.join(' ');
}

/**
 * UNIFIED: Extract keywords from spell text for grouping/branching.
 * Uses extractSpellText() for consistent data extraction.
 * 
 * @param {Object} spell - Spell object
 * @param {Array} stopWords - Words to filter out
 * @returns {Array} - Array of keyword strings
 */
function extractSpellKeywords(spell, stopWords) {
    var text = extractSpellText(spell);
    if (!text) return [];
    
    stopWords = stopWords || [];
    
    return text.split(/[^a-z]+/).filter(function(w) {
        return w.length > 2 && stopWords.indexOf(w) < 0;
    });
}

/**
 * Get thematic keywords for a spell based on its name, effects, and description.
 * Uses extractSpellText() for consistent data extraction.
 * @param {Object} spell - Spell object with name, effectNames, effects, description
 * @returns {Array} - Array of thematic group names this spell belongs to
 */
function getSpellThemes(spell) {
    var fullText = extractSpellText(spell);
    if (fullText.length === 0) return [];
    
    var themes = [];
    
    for (var group in THEMATIC_KEYWORDS) {
        var keywords = THEMATIC_KEYWORDS[group];
        for (var i = 0; i < keywords.length; i++) {
            if (fullText.indexOf(keywords[i]) !== -1) {
                themes.push(group);
                break; // Only add group once
            }
        }
    }
    
    return themes;
}

/**
 * Calculate thematic similarity between two spells
 * Elemental matches (fire-fire, frost-frost, shock-shock) get highest score.
 * @returns {number} 0-1 score (1 = perfect match)
 */
function calculateThematicSimilarity(spell1, spell2) {
    var themes1 = getSpellThemes(spell1);
    var themes2 = getSpellThemes(spell2);
    
    if (themes1.length === 0 || themes2.length === 0) {
        return 0.3; // Lower neutral score - prefer known themes
    }
    
    // Check for ELEMENTAL matches first (highest priority)
    var elements = ['fire', 'frost', 'shock'];
    var hasElementMatch = false;
    var hasElementConflict = false;
    
    var spell1Elements = themes1.filter(function(t) { return elements.indexOf(t) !== -1; });
    var spell2Elements = themes2.filter(function(t) { return elements.indexOf(t) !== -1; });
    
    if (spell1Elements.length > 0 && spell2Elements.length > 0) {
        // Both spells have elements - check if they match
        hasElementMatch = spell1Elements.some(function(e) {
            return spell2Elements.indexOf(e) !== -1;
        });
        
        if (!hasElementMatch) {
            // Different elements = conflict (fire vs frost = bad)
            hasElementConflict = true;
        }
    }
    
    // Elemental conflict = very low score
    if (hasElementConflict) {
        return 0.1;
    }
    
    // Elemental match = high score
    if (hasElementMatch) {
        return 0.9;
    }
    
    // Count all overlapping themes
    var overlap = 0;
    themes1.forEach(function(t) {
        if (themes2.indexOf(t) !== -1) overlap++;
    });
    
    // Score based on overlap ratio
    if (overlap === 0) {
        return 0.2; // No overlap but no element conflict
    }
    
    var maxThemes = Math.max(themes1.length, themes2.length);
    return 0.4 + (overlap / maxThemes) * 0.5; // 0.4-0.9 range for non-elemental matches
}

/**
 * Check if two spells are thematically compatible for prerequisite relationship
 * @returns {boolean} true if they share at least one theme or one has no themes
 */
function areThematicallyCompatible(spell1, spell2) {
    var themes1 = getSpellThemes(spell1);
    var themes2 = getSpellThemes(spell2);
    
    // If either has no detected themes, consider compatible (generic spell)
    if (themes1.length === 0 || themes2.length === 0) return true;
    
    // Check for any overlap
    for (var i = 0; i < themes1.length; i++) {
        if (themes2.indexOf(themes1[i]) !== -1) return true;
    }
    
    return false;
}

/**
 * Post-processing pass to fix thematically inconsistent prerequisites.
 * GENTLE VERSION: Only fixes ONE prereq per node, only when ALL prereqs are incompatible.
 * Uses spell name, effectNames, effects, and description for matching.
 * 
 * @param {Array} positions - All positions with spell data
 * @param {Array} edges - All edges
 * @param {Function} rng - Seeded random
 * @returns {Object} - Stats about fixes made
 */
function fixThematicInconsistencies(positions, edges, rng) {
    var stats = { nodesChecked: 0, nodesFixed: 0, edgesRewired: 0 };
    
    // Build lookups
    var positionByFormId = {};
    positions.forEach(function(p) {
        if (p.spell) positionByFormId[p.spell.formId] = p;
    });
    
    // Build incoming edges map
    var incomingEdges = {};
    positions.forEach(function(p) {
        if (p.spell) incomingEdges[p.spell.formId] = [];
    });
    edges.forEach(function(e) {
        if (incomingEdges[e.to]) {
            incomingEdges[e.to].push(e);
        }
    });
    
    // Helper to get spell details for logging
    function getSpellDetails(spell) {
        var details = spell.name || 'Unknown';
        var themes = getSpellThemes(spell);
        if (themes.length > 0) {
            details += ' [' + themes.join(', ') + ']';
        }
        if (spell.effectNames && spell.effectNames.length > 0) {
            details += ' effects:(' + spell.effectNames.slice(0, 2).join(', ') + ')';
        }
        return details;
    }
    
    // Check each node
    positions.forEach(function(node) {
        if (!node.spell || node.isRoot) return;
        
        var formId = node.spell.formId;
        var nodeThemes = getSpellThemes(node.spell);
        
        // Skip if this spell has no clear themes (generic spells are fine with any prereqs)
        if (nodeThemes.length === 0) return;
        
        stats.nodesChecked++;
        
        var incoming = incomingEdges[formId] || [];
        if (incoming.length === 0) return;
        
        // Check if ANY prerequisite is thematically compatible
        var hasCompatiblePrereq = false;
        var worstIncompatibleEdge = null;
        var worstSimilarity = 1.0;
        
        incoming.forEach(function(edge) {
            if (!edge || !edge.from) return;
            var sourceNode = positionByFormId[edge.from];
            if (!sourceNode || !sourceNode.spell) return;
            
            var sim = calculateThematicSimilarity(node.spell, sourceNode.spell);
            
            if (sim >= 0.4) { // Compatible threshold
                hasCompatiblePrereq = true;
            } else if (sim < worstSimilarity) {
                worstSimilarity = sim;
                worstIncompatibleEdge = edge;
            }
        });
        
        // Only fix if ALL prereqs are incompatible
        if (hasCompatiblePrereq) return;
        if (!worstIncompatibleEdge) return;
        
        console.log('[ThematicFix] ' + getSpellDetails(node.spell) + ' has no compatible prereqs');
        console.log('[ThematicFix]   Current prereqs:');
        incoming.forEach(function(e) {
            var src = positionByFormId[e.from];
            if (src && src.spell) {
                var sim = calculateThematicSimilarity(node.spell, src.spell);
                console.log('[ThematicFix]     - ' + getSpellDetails(src.spell) + ' (sim: ' + sim.toFixed(2) + ')');
            }
        });
        
        // Find ONE better alternative from lower tiers
        var bestCandidate = null;
        var bestSimilarity = 0.3; // Minimum threshold
        var nodeRank = getSpellRank(node.spell);
        
        positions.forEach(function(p) {
            if (!p.spell || p.spell.formId === formId) return;
            if (p.tier >= node.tier) return; // Must be lower tier
            if (getSpellRank(p.spell) > nodeRank) return; // Must be same or weaker rank
            
            // Skip if already a prereq
            var isAlreadyPrereq = incoming.some(function(e) { return e.from === p.spell.formId; });
            if (isAlreadyPrereq) return;
            
            var sim = calculateThematicSimilarity(node.spell, p.spell);
            if (sim > bestSimilarity) {
                bestSimilarity = sim;
                bestCandidate = p;
            }
        });
        
        if (!bestCandidate) {
            console.log('[ThematicFix]   No better candidates found, keeping original prereqs');
            return;
        }
        
        console.log('[ThematicFix]   Best candidate: ' + getSpellDetails(bestCandidate.spell) + 
                    ' (sim: ' + bestSimilarity.toFixed(2) + ')');
        
        // ADD the thematically compatible prereq (don't remove the original)
        // This way the spell has at least one prereq that makes sense
        edges.push({
            from: bestCandidate.spell.formId,
            to: formId,
            type: 'thematic'  // Mark as added for thematic reasons
        });
        
        // Update prereqRequirements if they exist - ADD new prereq as hard requirement
        if (node.prereqRequirements) {
            var newFrom = bestCandidate.spell.formId;
            
            // Add as hard prereq (must have at least one thematically correct prereq)
            if (node.prereqRequirements.hardPrereqs.indexOf(newFrom) === -1) {
                node.prereqRequirements.hardPrereqs.push(newFrom);
            }
        }
        
        stats.nodesFixed++;
        stats.edgesRewired++;
        
        console.log('[ThematicFix]   ADDED thematic prereq: ' + bestCandidate.spell.name + 
                    ' (kept existing: ' + incoming.map(function(e) { 
                        var s = positionByFormId[e.from]; 
                        return s && s.spell ? s.spell.name : e.from; 
                    }).join(', ') + ')');
    });
    
    console.log('[ThematicFix] Checked ' + stats.nodesChecked + ' nodes, fixed ' + 
                stats.nodesFixed + ', rewired ' + stats.edgesRewired + ' edges');
    
    return stats;
}

// Expose for testing
window.getSpellThemes = getSpellThemes;
window.calculateThematicSimilarity = calculateThematicSimilarity;
window.areThematicallyCompatible = areThematicallyCompatible;
window.fixThematicInconsistencies = fixThematicInconsistencies;

// =============================================================================
// ALTERNATE PATHS SYSTEM (DEPRECATED - merged into soft prereqs)
// =============================================================================

/**
 * Default configuration for alternate path generation
 * These can be overridden via school config or LLM
 */
var DEFAULT_ALTERNATE_PATH_CONFIG = {
    // Minimum path distance (in edges) to warrant an alternate path
    minPathDistance: 4,
    
    // Maximum spatial distance for alternate path candidates (in node sizes)
    maxSpatialDistance: 4,
    
    // Base probability of creating an alternate path
    baseProbability: 0.3,
    
    // Fuzzy match bonus - how much same-group increases probability
    fuzzyBonus: 0.2,
    
    // Maximum alternate paths per node
    maxAlternatesPerNode: 2,
    
    // Tier tolerance - only connect nodes within this tier difference
    tierTolerance: 1
};

// Expose for UI access
window.DEFAULT_ALTERNATE_PATH_CONFIG = DEFAULT_ALTERNATE_PATH_CONFIG;

/**
 * Calculate shortest path distance between two nodes using BFS
 * Returns -1 if no path exists
 * 
 * @param {string} fromId - Source node formId
 * @param {string} toId - Target node formId
 * @param {Object} adjacencyList - Node adjacency list
 * @param {number} maxDepth - Maximum search depth
 * @returns {number} - Path length or -1 if not found
 */
function calculatePathDistance(fromId, toId, adjacencyList, maxDepth) {
    if (fromId === toId) return 0;
    
    var visited = {};
    var queue = [{ id: fromId, depth: 0 }];
    visited[fromId] = true;
    
    while (queue.length > 0) {
        var current = queue.shift();
        
        if (current.depth >= maxDepth) continue;
        
        var neighbors = adjacencyList[current.id] || [];
        for (var i = 0; i < neighbors.length; i++) {
            var neighborId = neighbors[i];
            
            if (neighborId === toId) {
                return current.depth + 1;
            }
            
            if (!visited[neighborId]) {
                visited[neighborId] = true;
                queue.push({ id: neighborId, depth: current.depth + 1 });
            }
        }
    }
    
    return -1; // No path found within maxDepth
}

/**
 * Build adjacency list from edges (bidirectional)
 * 
 * @param {Array} edges - Array of edge objects
 * @returns {Object} - Adjacency list { formId: [neighbor formIds] }
 */
function buildAdjacencyList(edges) {
    var adj = {};
    
    edges.forEach(function(e) {
        var from = e.from;
        var to = e.to;
        
        // Handle edge objects that might have node references
        if (typeof from === 'object' && from.formId) from = from.formId;
        if (typeof to === 'object' && to.formId) to = to.formId;
        
        if (!adj[from]) adj[from] = [];
        if (!adj[to]) adj[to] = [];
        
        // Bidirectional for pathfinding
        if (adj[from].indexOf(to) === -1) adj[from].push(to);
        if (adj[to].indexOf(from) === -1) adj[to].push(from);
    });
    
    return adj;
}

/**
 * Calculate alternate path score between two nodes
 * Higher score = better candidate for alternate path
 *
 * @param {Object} nodeA - First node
 * @param {Object} nodeB - Second node
 * @param {number} pathDistance - Current path distance between them
 * @param {Object} spellToGroup - Spell to fuzzy group mapping
 * @param {Object} treeGeneration - Tree generation settings (for element isolation)
 * @returns {number} - Score (higher = better)
 */
function calculateAlternatePathScore(nodeA, nodeB, pathDistance, spellToGroup, treeGeneration) {
    var score = 0;
    var nodeSize = GRID_CONFIG.nodeSize;
    var treeGen = treeGeneration || {};

    // 0. ELEMENT ISOLATION CHECK (highest priority)
    if (nodeA.spell && nodeB.spell) {
        var thematicSim = calculateThematicSimilarity(nodeA.spell, nodeB.spell);
        var hasElementConflict = thematicSim <= 0.1;

        if (hasElementConflict) {
            if (treeGen.elementIsolationStrict) {
                return -10000;  // Forbidden
            } else if (treeGen.elementIsolation) {
                score -= 300;   // Heavy penalty
            }
        } else if (thematicSim >= 0.8) {
            score += 50;  // Same element bonus
        }
    }

    // 1. PATH DISTANCE FACTOR: Longer paths benefit more from alternates
    if (pathDistance >= 6) score += 40;
    else if (pathDistance >= 5) score += 30;
    else if (pathDistance >= 4) score += 20;
    else if (pathDistance >= 3) score += 10;
    else return -100; // Too short, don't create alternate

    // 2. SPATIAL PROXIMITY: Nodes should be spatially close
    var dx = nodeA.x - nodeB.x;
    var dy = nodeA.y - nodeB.y;
    var spatialDist = Math.sqrt(dx * dx + dy * dy);

    if (spatialDist < nodeSize * 2) score += 35;
    else if (spatialDist < nodeSize * 3) score += 25;
    else if (spatialDist < nodeSize * 4) score += 15;
    else return -100; // Too far spatially

    // 3. FUZZY GROUP: Same theme = more logical alternate path
    var groupA = spellToGroup[nodeA.formId];
    var groupB = spellToGroup[nodeB.formId];

    if (groupA && groupB && groupA.theme === groupB.theme) {
        score += 30; // Same theme - thematic connection
    } else if (groupA && groupB) {
        score += 5; // Different themes - cross-knowledge
    }

    // 4. TIER SIMILARITY: Prefer same tier
    var tierDiff = Math.abs(nodeA.tier - nodeB.tier);
    if (tierDiff === 0) score += 20;
    else if (tierDiff === 1) score += 10;
    else return -100; // Too different in tier

    // 5. HUB PENALTY: Hubs already have many connections
    if (nodeA.isHub) score -= 10;
    if (nodeB.isHub) score -= 10;

    return score;
}

/**
 * Add alternate path connections between nearby same-tier nodes
 * Only when existing path is long, provides shortcuts for navigation
 * 
 * @param {Array} positions - All node positions
 * @param {Array} edges - Existing edges (will be modified)
 * @param {Object} spellToGroup - Spell to fuzzy group mapping
 * @param {Function} rng - Random number generator
 * @param {Object} configOverrides - Optional config overrides from school/LLM
 * @returns {Object} - { count: number of alternate paths added }
 */
function addAlternatePaths(positions, edges, spellToGroup, rng, configOverrides) {
    var alternatesAdded = 0;
    var nodeSize = 75;
    
    // Merge default config with overrides
    var config = {};
    Object.keys(DEFAULT_ALTERNATE_PATH_CONFIG).forEach(function(key) {
        config[key] = DEFAULT_ALTERNATE_PATH_CONFIG[key];
    });
    if (configOverrides) {
        Object.keys(configOverrides).forEach(function(key) {
            if (configOverrides[key] !== undefined && configOverrides[key] !== null) {
                config[key] = configOverrides[key];
            }
        });
    }
    
    console.log('[AlternatePaths] Config:', JSON.stringify(config));
    
    // Build adjacency list for pathfinding
    var adjacencyList = buildAdjacencyList(edges);
    
    // Build existing edge set to avoid duplicates
    var existingEdges = {};
    edges.forEach(function(e) {
        var from = typeof e.from === 'object' ? e.from.formId : e.from;
        var to = typeof e.to === 'object' ? e.to.formId : e.to;
        existingEdges[from + '->' + to] = true;
        existingEdges[to + '->' + from] = true;
    });
    
    // Track alternates per node to limit
    var alternatesCount = {};
    
    // Group nodes by tier for efficient same-tier lookup
    var nodesByTier = {};
    positions.forEach(function(node) {
        var tier = node.tier || 0;
        if (!nodesByTier[tier]) nodesByTier[tier] = [];
        nodesByTier[tier].push(node);
    });
    
    // Process each tier
    for (var tier in nodesByTier) {
        var tierNodes = nodesByTier[tier];
        if (tierNodes.length < 2) continue;
        
        // Also include adjacent tiers for tier tolerance
        var nearbyNodes = tierNodes.slice();
        var tierNum = parseInt(tier);
        
        if (config.tierTolerance >= 1 && nodesByTier[tierNum - 1]) {
            nearbyNodes = nearbyNodes.concat(nodesByTier[tierNum - 1]);
        }
        if (config.tierTolerance >= 1 && nodesByTier[tierNum + 1]) {
            nearbyNodes = nearbyNodes.concat(nodesByTier[tierNum + 1]);
        }
        
        // Check each pair of nodes in this tier
        for (var i = 0; i < tierNodes.length; i++) {
            var nodeA = tierNodes[i];
            
            // Skip if already has max alternates
            if ((alternatesCount[nodeA.formId] || 0) >= config.maxAlternatesPerNode) continue;
            
            // Find candidates
            var candidates = [];
            
            for (var j = 0; j < nearbyNodes.length; j++) {
                var nodeB = nearbyNodes[j];
                if (nodeA.formId === nodeB.formId) continue;
                
                // Skip if edge already exists
                var edgeKey = nodeA.formId + '->' + nodeB.formId;
                if (existingEdges[edgeKey]) continue;
                
                // Skip if nodeB has max alternates
                if ((alternatesCount[nodeB.formId] || 0) >= config.maxAlternatesPerNode) continue;
                
                // Check spatial distance first (fast filter)
                var dx = nodeA.x - nodeB.x;
                var dy = nodeA.y - nodeB.y;
                var spatialDist = Math.sqrt(dx * dx + dy * dy);
                
                if (spatialDist > nodeSize * config.maxSpatialDistance) continue;
                
                // Calculate path distance (slower, so filter first)
                var pathDist = calculatePathDistance(
                    nodeA.formId, 
                    nodeB.formId, 
                    adjacencyList, 
                    config.minPathDistance + 3 // Search a bit beyond minimum
                );
                
                // Only consider if path is long enough (or no path exists)
                if (pathDist >= 0 && pathDist < config.minPathDistance) continue;
                
                // If no path found, use a default high value
                if (pathDist < 0) pathDist = 10;
                
                // Calculate score
                var score = calculateAlternatePathScore(nodeA, nodeB, pathDist, spellToGroup);
                
                if (score > 0) {
                    candidates.push({ node: nodeB, score: score, pathDist: pathDist });
                }
            }
            
            // Sort by score and select
            candidates.sort(function(a, b) { return b.score - a.score; });
            
            // Apply probability and randomness
            for (var k = 0; k < candidates.length && (alternatesCount[nodeA.formId] || 0) < config.maxAlternatesPerNode; k++) {
                var candidate = candidates[k];
                
                // Calculate probability based on score and fuzzy bonus
                var groupA = spellToGroup[nodeA.formId];
                var groupB = spellToGroup[candidate.node.formId];
                var isSameGroup = groupA && groupB && groupA.theme === groupB.theme;
                
                var probability = config.baseProbability + (isSameGroup ? config.fuzzyBonus : 0);
                
                // Higher scores get higher probability
                probability += (candidate.score / 200);
                probability = Math.min(0.8, probability); // Cap at 80%
                
                if (rng() < probability) {
                    // Create alternate path edge
                    var edgeKey = nodeA.formId + '->' + candidate.node.formId;
                    
                    edges.push({
                        from: nodeA.formId,
                        to: candidate.node.formId,
                        type: 'alternate',
                        pathDistance: candidate.pathDist
                    });
                    
                    existingEdges[edgeKey] = true;
                    existingEdges[candidate.node.formId + '->' + nodeA.formId] = true;
                    
                    // Update adjacency for future pathfinding
                    if (!adjacencyList[nodeA.formId]) adjacencyList[nodeA.formId] = [];
                    if (!adjacencyList[candidate.node.formId]) adjacencyList[candidate.node.formId] = [];
                    adjacencyList[nodeA.formId].push(candidate.node.formId);
                    adjacencyList[candidate.node.formId].push(nodeA.formId);
                    
                    // Track counts
                    alternatesCount[nodeA.formId] = (alternatesCount[nodeA.formId] || 0) + 1;
                    alternatesCount[candidate.node.formId] = (alternatesCount[candidate.node.formId] || 0) + 1;
                    
                    // Store alternate paths on nodes
                    if (!nodeA.alternatePaths) nodeA.alternatePaths = [];
                    nodeA.alternatePaths.push(candidate.node.formId);
                    
                    if (!candidate.node.alternatePaths) candidate.node.alternatePaths = [];
                    candidate.node.alternatePaths.push(nodeA.formId);
                    
                    alternatesAdded++;
                }
            }
        }
    }
    
    return { count: alternatesAdded };
}

/**
 * Get default behavior when module not loaded
 */
function getDefaultBehavior() {
    return {
        outwardGrowth: 0.5,   // Default balanced outward growth
        verticalBias: 0.0,
        layerFillThreshold: 0.5,
        spreadFactor: 0.6,
        angularWander: 20,
        branchingFactor: 2,
        branchingVariance: 0.3,
        branchStyle: 'binary',
        hubProbability: 0.1,
        hubMinSpacing: 10,
        hubBranchCount: 4,
        createTerminalClusters: true,
        terminalClusterSize: 3,
        terminalClusterChance: 0.3,
        waveAmplitude: 0,
        waveFrequency: 0,
        crossConnectionDensity: 0.1,
        crossConnectionMaxDist: 2.0,
        webPattern: false,
        phases: []
    };
}

/**
 * Find best position for a spell near its thematic neighbors.
 */
function findBestPosition(spell, group, placedNodes, sliceInfo, shapeMask, currentRadius, nodeSize, minSpacing, rng, branchDistance) {
    var candidates = [];
    var searchRadius = nodeSize * branchDistance * 2;
    
    // Find placed nodes in same group (or all nodes if no group matches)
    var sameGroupNodes = group ? placedNodes.filter(function(n) {
        return n.fuzzyGroup === group.theme || n.isRoot;
    }) : placedNodes;
    
    if (sameGroupNodes.length === 0) {
        sameGroupNodes = placedNodes;
    }
    
    // Generate candidate positions around same-group nodes
    sameGroupNodes.forEach(function(node) {
        // Try positions radiating outward from this node
        for (var angleOffset = -30; angleOffset <= 30; angleOffset += 15) {
            for (var radiusMult = 1.0; radiusMult <= 2.0; radiusMult += 0.3) {
                var angle = node.angle + angleOffset + (rng() - 0.5) * 10;
                var radius = node.radius + nodeSize * radiusMult * branchDistance;
                
                // Check sector bounds
                if (angle < sliceInfo.startAngle + 5 || angle > sliceInfo.endAngle - 5) continue;
                
                // Check shape mask
                var tierProgress = (radius - 60) / 500;  // Approximate tier progress
                var angleNorm = (angle - sliceInfo.startAngle) / sliceInfo.sectorAngle;
                if (!shapeMask(Math.min(1, Math.max(0, tierProgress)), Math.min(1, Math.max(0, angleNorm)), rng)) {
                    continue;
                }
                
                var rad = angle * Math.PI / 180;
                var x = Math.cos(rad) * radius;
                var y = Math.sin(rad) * radius;
                
                // Check not too close to existing nodes
                var tooClose = false;
                for (var i = 0; i < placedNodes.length; i++) {
                    var dx = x - placedNodes[i].x;
                    var dy = y - placedNodes[i].y;
                    if (Math.sqrt(dx*dx + dy*dy) < minSpacing) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;
                
                // Score this candidate
                var distToParent = Math.sqrt(
                    Math.pow(x - node.x, 2) + Math.pow(y - node.y, 2)
                );
                
                // Prefer positions in group's preferred angle region
                var anglePref = group ? Math.abs(angle - group.preferredAngle) : 0;
                
                candidates.push({
                    x: x,
                    y: y,
                    radius: radius,
                    angle: angle,
                    score: distToParent + anglePref * 0.5,
                    parentNode: node
                });
            }
        }
    });
    
    if (candidates.length === 0) return null;
    
    // Sort by score (lower is better) and pick best
    candidates.sort(function(a, b) { return a.score - b.score; });
    return candidates[0];
}

/**
 * Fallback position when no valid candidate found.
 * GRID-ALIGNED: Snaps to tier AND angular grid
 * CHECKS OCCUPIED: Won't return position that overlaps existing nodes
 */
function findFallbackPosition(sliceInfo, currentRadius, tier, rng, nodeSize, placedNodes, minSpacing) {
    // GRID CONFIGURATION - Use unified source from config.js
    var gridCfg = GRID_CONFIG.getComputedConfig();
    var baseRadius = gridCfg.baseRadius;
    var tierSpacing = gridCfg.tierSpacing;
    var arcSpacing = gridCfg.arcSpacing;
    
    // Try multiple tiers until we find a free slot
    for (var tierOffset = 1; tierOffset <= 20; tierOffset++) {
        var nextTier = tier + tierOffset;
        var radius = baseRadius + nextTier * tierSpacing;
        
        // Calculate angular grid positions for this tier
        var arcLength = (sliceInfo.sectorAngle / 360) * 2 * Math.PI * radius;
        var candidateCount = Math.max(3, Math.floor(arcLength / arcSpacing));
        var usableAngle = sliceInfo.sectorAngle * 0.85;
        var angleStep = candidateCount > 1 ? usableAngle / (candidateCount - 1) : 0;
        var startAngle = sliceInfo.spokeAngle - usableAngle / 2;
        
        // Try each grid position in this tier
        for (var i = 0; i < candidateCount; i++) {
            var angle = candidateCount === 1 ? sliceInfo.spokeAngle : startAngle + i * angleStep;
            
            // Clamp to sector bounds
            if (angle < sliceInfo.startAngle + 3 || angle > sliceInfo.endAngle - 3) continue;
            
            var rad = angle * Math.PI / 180;
            var x = Math.cos(rad) * radius;
            var y = Math.sin(rad) * radius;
            
            // Check if position is free
            var isOccupied = false;
            if (placedNodes) {
                for (var j = 0; j < placedNodes.length; j++) {
                    var dx = x - placedNodes[j].x;
                    var dy = y - placedNodes[j].y;
                    if (Math.sqrt(dx * dx + dy * dy) < (minSpacing || gridCfg.minNodeSpacing)) {
                        isOccupied = true;
                        break;
                    }
                }
            }
            
            if (!isOccupied) {
                return {
                    x: x,
                    y: y,
                    radius: radius,
                    angle: angle
                };
            }
        }
    }
    
    // No free position found (very unlikely with 20 tiers)
    return null;
}

/**
 * Find best parent node to connect to.
 * - Root can only accept Novice/Apprentice children, max 5 children
 * - Other nodes max 4 children
 * - Parent level should be <= child level
 */
function findBestParent(node, placedNodes, group, maxEdgeLength) {
    var candidates = [];
    var childLevel = node.spell ? getSpellRank(node.spell) : 0;
    
    // Branch limits
    var ROOT_MAX_CHILDREN = 5;
    var NODE_MAX_CHILDREN = 4;
    var ROOT_MAX_CHILD_LEVEL = 1;  // Novice (0) or Apprentice (1)
    
    placedNodes.forEach(function(p) {
        if (p.formId === node.formId) return;
        
        var dx = node.x - p.x;
        var dy = node.y - p.y;
        var dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist > maxEdgeLength && !p.isRoot) return;
        
        var childCount = p.children ? p.children.length : 0;
        var parentLevel = p.spell ? getSpellRank(p.spell) : 0;
        
        // ROOT RESTRICTIONS
        if (p.isRoot) {
            // Root has max children?
            if (childCount >= ROOT_MAX_CHILDREN) return;
            // Root can only accept low-level children
            if (childLevel > ROOT_MAX_CHILD_LEVEL) {
                // Don't add to candidates at all
                return;
            }
        } else {
            // Regular node has max children?
            if (childCount >= NODE_MAX_CHILDREN) return;
        }
        
        // Spell level check: parent should be same level or weaker
        var levelPenalty = 0;
        if (parentLevel > childLevel) {
            levelPenalty = (parentLevel - childLevel) * 150;
        }
        
        // Child count penalty (prefer nodes with fewer children)
        var childCountPenalty = childCount * 20;
        
        // Score: prefer same group, shorter distance, lower tier, appropriate spell level, fewer children
        var sameGroup = (p.fuzzyGroup === node.fuzzyGroup || p.isRoot) ? 0 : 50;
        var tierPenalty = p.tier >= node.tier ? 100 : 0;
        
        candidates.push({
            node: p,
            score: dist + sameGroup + tierPenalty + levelPenalty + childCountPenalty
        });
    });
    
    if (candidates.length === 0) {
        // Fallback: find any node with fewest children
        var sorted = placedNodes.slice().sort(function(a, b) {
            return (a.children ? a.children.length : 0) - (b.children ? b.children.length : 0);
        });
        return sorted[0];
    }
    
    candidates.sort(function(a, b) { return a.score - b.score; });
    return candidates[0].node;
}

/**
 * Add cross-group connections for thematic prerequisites.
 */
function addCrossGroupConnections(positions, edges, groups, rng, maxDist) {
    var count = 0;
    var maxCross = Math.floor(positions.length * 0.08);  // Max 8% cross connections
    
    // Build edge set for quick lookup
    var edgeSet = {};
    edges.forEach(function(e) {
        edgeSet[e.from + '->' + e.to] = true;
        edgeSet[e.to + '->' + e.from] = true;
    });
    
    positions.forEach(function(node) {
        if (node.isRoot || count >= maxCross) return;
        if (rng() > 0.12) return;  // 12% chance per node
        
        // Find nodes in OTHER groups that are nearby and lower tier
        var candidates = positions.filter(function(other) {
            if (other.formId === node.formId) return false;
            if (other.fuzzyGroup === node.fuzzyGroup) return false;
            if (other.tier >= node.tier) return false;
            if (edgeSet[other.formId + '->' + node.formId]) return false;
            
            var dx = node.x - other.x;
            var dy = node.y - other.y;
            return Math.sqrt(dx*dx + dy*dy) < maxDist;
        });
        
        if (candidates.length > 0) {
            // Pick closest
            candidates.sort(function(a, b) {
                var da = Math.sqrt(Math.pow(node.x - a.x, 2) + Math.pow(node.y - a.y, 2));
                var db = Math.sqrt(Math.pow(node.x - b.x, 2) + Math.pow(node.y - b.y, 2));
                return da - db;
            });
            
            edges.push({
                from: candidates[0].formId,
                to: node.formId,
                type: 'cross_branch'
            });
            edgeSet[candidates[0].formId + '->' + node.formId] = true;
            count++;
        }
    });
    
    return count;
}

/**
 * Get shape mask function by name.
 */
function getShapeMask(shapeName) {
    console.log('[ShapeMask] Using shape:', shapeName);
    
    var masks = {
        // All positions valid - full radial spread
        radial: function(t, a, r) { return true; },
        
        // Slight organic randomness (90% pass)
        organic: function(t, a, r) { return r() > 0.1; },
        
        // 5-arm star pattern - MORE AGGRESSIVE
        spiky: function(t, a, r) {
            var rayCount = 5;
            var rayValue = Math.abs(Math.sin(a * rayCount * Math.PI));
            // Higher threshold = more defined spikes
            return rayValue > 0.4 + t * 0.3 || r() < 0.15;
        },
        
        // Mountain/peak shape - narrows as it grows outward
        mountain: function(t, a, r) {
            var peakWidth = 1.0 - t * 0.8;  // Narrower peak
            var distFromCenter = Math.abs(a - 0.5) * 2;
            return distFromCenter < peakWidth + r() * 0.1;
        },
        
        // Cloud - bumpy top edge
        cloud: function(t, a, r) {
            var bumpPhase = a * 3 * Math.PI;
            var bumpValue = Math.sin(bumpPhase) * 0.5 + 0.5;
            return t < 0.65 + bumpValue * 0.3 + r() * 0.1;
        },
        
        // Flame - wavy edges that narrow
        flame: function(t, a, r) {
            var wave = Math.sin(a * Math.PI * 4 + t * 2) * 0.3;
            var edge = 0.8 - t * 0.5 + wave;
            var dist = Math.abs(a - 0.5) * 2;
            return dist < edge + r() * 0.08;
        },
        
        // Tree - narrow trunk then branches
        tree: function(t, a, r) {
            if (t < 0.3) return Math.abs(a - 0.5) < 0.15;  // Narrow trunk
            var branchCount = 2 + Math.floor(t * 4);
            return Math.abs(Math.sin(a * branchCount * Math.PI)) > 0.5 || r() < 0.2;
        },
        
        // Cascade - horizontal bands
        cascade: function(t, a, r) {
            var band = (t * 5) % 1;
            return band > 0.35 || r() < 0.25;
        },
        
        // Galaxy - spiral arms
        galaxy: function(t, a, r) {
            var spiralTwist = t * 2;
            var armValue = Math.sin((a * 2 + spiralTwist) * Math.PI) * 0.5 + 0.5;
            return armValue > 0.45 || r() < 0.2;
        }
    };
    
    return masks[shapeName] || masks.organic;
}

/**
 * Discover fuzzy groups from spell names/effects.
 */
function discoverFuzzyGroupsFromSpells(spells, rng) {
    // Extract keywords from all spells using UNIFIED extraction (includes description)
    var keywordCounts = {};
    var spellKeywords = {};
    
    var stopWords = ['the', 'of', 'and', 'a', 'to', 'in', 'for', 'is', 'on', 'that', 'by', 'this', 'with', 'spell', 'magic', 'magicka', 'target', 'effect', 'damage', 'points', 'second', 'seconds', 'level', 'health', 'restore', 'greater', 'lesser', 'mass', 'caster', 'concentration', 'enemies', 'enemy', 'nearby', 'area'];
    
    spells.forEach(function(spell, idx) {
        // Use UNIFIED text extraction (name + effectNames + effects + description)
        var words = extractSpellKeywords(spell, stopWords);
        
        spellKeywords[idx] = words;
        words.forEach(function(w) {
            keywordCounts[w] = (keywordCounts[w] || 0) + 1;
        });
    });
    
    // Find themes (keywords in 8-45% of spells)
    var minCount = Math.max(2, Math.floor(spells.length * 0.08));
    var maxCount = Math.floor(spells.length * 0.45);
    
    var themes = [];
    for (var kw in keywordCounts) {
        if (keywordCounts[kw] >= minCount && keywordCounts[kw] <= maxCount) {
            themes.push({ keyword: kw, count: keywordCounts[kw] });
        }
    }
    themes.sort(function(a, b) { return b.count - a.count; });
    themes = themes.slice(0, 6);  // Max 6 themes
    
    var groups = themes.map(function(t) {
        return { theme: t.keyword, spells: [], preferredAngle: 0 };
    });
    groups.push({ theme: '_other', spells: [], preferredAngle: 0 });
    
    // Assign spells
    spells.forEach(function(spell, idx) {
        var keywords = spellKeywords[idx] || [];
        var bestGroup = null;
        var bestScore = 0;
        
        for (var g = 0; g < groups.length - 1; g++) {
            if (keywords.indexOf(groups[g].theme) >= 0) {
                var score = keywordCounts[groups[g].theme];
                if (score > bestScore) {
                    bestScore = score;
                    bestGroup = groups[g];
                }
            }
        }
        
        spell.matchScore = bestScore;
        (bestGroup || groups[groups.length - 1]).spells.push(spell);
    });
    
    groups = groups.filter(function(g) { return g.spells.length > 0; });
    
    // Handle large '_other'
    var other = groups.find(function(g) { return g.theme === '_other'; });
    if (other && groups.length > 1 && other.spells.length > spells.length * 0.4) {
        var realGroups = groups.filter(function(g) { return g.theme !== '_other'; });
        other.spells.forEach(function(s, i) {
            realGroups[i % realGroups.length].spells.push(s);
        });
        groups = realGroups;
    }
    
    // Fallback groups
    if (groups.length === 0) {
        groups = [
            { theme: 'branch_a', spells: [], preferredAngle: 0 },
            { theme: 'branch_b', spells: [], preferredAngle: 0 },
            { theme: 'branch_c', spells: [], preferredAngle: 0 }
        ];
        spells.forEach(function(s, i) {
            groups[i % 3].spells.push(s);
        });
    }
    
    return groups;
}

// Legacy alias
var growFuzzyTree = growOrganicTree;

// =============================================================================
// MAIN BUILDER
// =============================================================================

// Store slice angles for reuse when regenerating individual schools
var storedSliceAngles = null;

/**
 * Generate a complete visual-first tree for one school.
 * 
 * @param {string} schoolName - Name of the school
 * @param {Array} spells - Array of spell objects
 * @param {Object} config - LLM config {shape, density, convergence, slice_weight, useExistingSlice}
 * @returns {Object} - Tree data in standard format
 */
function generateVisualFirstTree(schoolName, spells, config) {
    console.log('[VisualFirstBuilder] Generating', schoolName, 'with', spells.length, 'spells');
    console.log('[VisualFirstBuilder] Config:', JSON.stringify(config, null, 2));
    
    var seed = typeof getCurrentSeed === 'function' ? getCurrentSeed() : Date.now();
    var branchingMode = config.branching_mode || 'fuzzy_groups';  // Default to organic growth
    
    var allPositions;
    var edges;
    var sliceInfo;
    
    // Check if we should use existing slice angles (when regenerating individual school)
    if (config.useExistingSlice && storedSliceAngles && storedSliceAngles[schoolName]) {
        sliceInfo = storedSliceAngles[schoolName];
        console.log('[VisualFirstBuilder] Using EXISTING slice for', schoolName, 
            '[' + sliceInfo.startAngle.toFixed(1) + '° - ' + sliceInfo.endAngle.toFixed(1) + '°]');
    } else {
        // Calculate slice info fresh (single school takes full wheel)
        var schoolsData = {};
        schoolsData[schoolName] = { spell_count: spells.length, spells: spells, config: config };
        var sliceAngles = calculateSliceAngles(schoolsData);
        sliceInfo = sliceAngles[schoolName];
        console.log('[VisualFirstBuilder] Calculated NEW slice for', schoolName,
            '[' + sliceInfo.startAngle.toFixed(1) + '° - ' + sliceInfo.endAngle.toFixed(1) + '°]');
    }
    
    // FUZZY MODE: Grow tree organically - positions determined by branching
    if (branchingMode === 'fuzzy_groups') {
        console.log('[VisualFirstBuilder] Using FUZZY GROWTH mode - organic tree generation');
        
        // Add school name to config for root selection
        config.schoolName = schoolName;
        
        // Grow tree organically
        var result = growFuzzyTree(spells, sliceInfo, config, seed);
        allPositions = result.positions;
        edges = result.edges;
        
    } else {
        // PROXIMITY MODE: Grid-based layout, then connect
        console.log('[VisualFirstBuilder] Using PROXIMITY mode - grid-based layout');
        
        // Build school data structure
        var schoolsData = {};
        schoolsData[schoolName] = {
            spell_count: spells.length,
            spells: spells,
            config: config
        };
        
        // Step 1: Generate layout (grid + selection)
        var layout = generateLayout(schoolsData, seed);
        var schoolLayout = layout.schools[schoolName];
        
        // Step 2: Assign spells to positions
        allPositions = schoolLayout.positions;
        assignSpellsToPositions(allPositions, spells, seed + 200);
        
        // Step 3: Build edges by proximity
        edges = buildEdges(allPositions, config, seed + 300, null);
    }
    
    // Step 5: Format output
    var treeData = formatTreeOutput(schoolName, allPositions, edges, config);
    
    // Step 6: Merge into existing tree data (if any)
    if (state.treeData && state.treeData.rawData) {
        state.treeData.rawData.schools[schoolName] = treeData.schools[schoolName];
        
        // Reload the tree
        if (typeof loadTreeData === 'function') {
            loadTreeData(state.treeData.rawData);
        }
    } else {
        // Create new tree data
        if (typeof loadTreeData === 'function') {
            loadTreeData(treeData);
        }
    }
    
    console.log('[VisualFirstBuilder] Complete:', allPositions.length, 'nodes,', edges.length, 'edges');
    return treeData;
}

/**
 * Generate visual-first trees for ALL schools at once.
 * 
 * @param {Array} allSpells - All spells from all schools
 * @param {Object} schoolConfigs - Map of school name to LLM config
 * @param {Object} fuzzyData - Fuzzy NLP relationship data from Python
 *   - relationships: {formId: [related formIds]}
 *   - similarity_scores: {formId1:formId2: score}
 *   - groups: {groupName: [formIds]}
 *   - themes: {formId: [themes]}
 * @returns {Object} - Complete tree data
 */
function generateAllVisualFirstTrees(allSpells, schoolConfigs, fuzzyData, treeGeneration) {
    if (typeof filterBlacklistedSpells === 'function') {
        allSpells = filterBlacklistedSpells(allSpells);
    }
    console.log('[VisualFirstBuilder] Generating all schools with', allSpells.length, 'total spells');

    // Store tree generation settings for use by sub-functions
    var treeGen = treeGeneration || {};
    console.log('[VisualFirstBuilder] Tree generation mode:', treeGen.linkStrategy || 'default');
    console.log('[VisualFirstBuilder] Element isolation:', treeGen.elementIsolation,
                '(strict:', treeGen.elementIsolationStrict + ')');
    console.log('[VisualFirstBuilder] Strict tier ordering:', treeGen.strictTierOrdering);

    console.log('[VisualFirstBuilder] School configs received:');
    for (var scName in schoolConfigs) {
        var cfg = schoolConfigs[scName];
        console.log('  ' + scName + ': shape=' + cfg.shape + ', density=' + cfg.density +
                    ', source=' + cfg.source);
    }
    
    // Log fuzzy data availability
    var fuzzy = fuzzyData || { relationships: {}, similarity_scores: {}, groups: {}, themes: {} };
    var relationshipCount = Object.keys(fuzzy.relationships || {}).length;
    var groupCount = Object.keys(fuzzy.groups || {}).length;
    console.log('[VisualFirstBuilder] Fuzzy data:', relationshipCount, 'spell relationships,', groupCount, 'groups');
    
    var seed = typeof getCurrentSeed === 'function' ? getCurrentSeed() : Date.now();
    
    // Group spells by school
    var spellsBySchool = {};
    allSpells.forEach(function(spell) {
        var school = spell.school || 'Unknown';
        if (!school || school === 'null' || school === 'None' || school === '') {
            school = 'Hedge Wizard';
        }
        if (!spellsBySchool[school]) spellsBySchool[school] = [];
        spellsBySchool[school].push(spell);
    });
    
    // Build schools data with configs
    var totalSpellCount = allSpells.length;
    var schoolsData = {};
    for (var schoolName in spellsBySchool) {
        var config = schoolConfigs[schoolName] || { shape: 'organic', density: 0.6 };
        // Pass totalSpellCount so layout generator can decide on inner rings
        config.totalSpellCount = totalSpellCount;
        schoolsData[schoolName] = {
            spell_count: spellsBySchool[schoolName].length,
            spells: spellsBySchool[schoolName],
            config: config
        };
        console.log('[VisualFirstBuilder] School', schoolName + ':', 
                    spellsBySchool[schoolName].length, 'spells, shape:', config.shape);
    }
    console.log('[VisualFirstBuilder] Total spells:', totalSpellCount, '(inner rings only if > 500)');
    
    // Step 1: Calculate slice angles for ALL schools first
    console.log('[VisualFirstBuilder] === Step 1: Calculating slice angles for all schools ===');
    var sliceAngles = calculateSliceAngles(schoolsData);
    
    // STORE slice angles for reuse when regenerating individual schools
    storedSliceAngles = sliceAngles;
    console.log('[VisualFirstBuilder] Stored slice angles for', Object.keys(sliceAngles).length, 'schools');
    
    // Log slice angles
    for (var sn in sliceAngles) {
        var si = sliceAngles[sn];
        console.log('[VisualFirstBuilder] Slice', sn + ': start=' + si.startAngle.toFixed(1) + 
                    ', end=' + si.endAngle.toFixed(1) + ', sector=' + si.sectorAngle.toFixed(1));
    }
    
    // Process each school - check branching mode per school
    var allNodes = [];
    var allEdges = [];
    var schoolOutputs = {};
    
    for (var schoolName in schoolsData) {
        var config = schoolsData[schoolName].config;
        var spells = schoolsData[schoolName].spells;
        var schoolSeed = seed + hashString(schoolName);
        var sliceInfo = sliceAngles[schoolName];

        // CRITICAL: Attach tree generation settings to config so sub-functions can use them
        config.treeGeneration = treeGen;

        // Check branching mode for this school
        var branchingMode = config.branching_mode || 'fuzzy_groups';  // Default to organic growth
        
        console.log('[VisualFirstBuilder] === Processing', schoolName, '===');
        console.log('[VisualFirstBuilder] Mode:', branchingMode, '| Spells:', spells.length, '| Shape:', config.shape);
        console.log('[VisualFirstBuilder] Slice bounds: [' + sliceInfo.startAngle.toFixed(1) + '°, ' + sliceInfo.endAngle.toFixed(1) + '°]');
        
        var allPositions;
        var edges;
        var schoolLayout = null;
        
        // FUZZY MODE: Use organic growth (positions determined by branching logic)
        if (branchingMode === 'fuzzy_groups') {
            console.log('[VisualFirstBuilder] Using ORGANIC GROWTH for ' + schoolName);
            
            // Add school name to config for root selection
            config.schoolName = schoolName;
            
            // Grow tree organically - positions determined by branching
            var organicResult = growOrganicTree(spells, sliceInfo, config, schoolSeed);
            allPositions = organicResult.positions;
            edges = organicResult.edges;
            
            console.log('[VisualFirstBuilder] Organic growth: ' + allPositions.length + ' nodes, ' + edges.length + ' edges');
            
            // Create school layout info for output
            schoolLayout = { sliceInfo: sliceInfo };
            
        } else {
            // PROXIMITY MODE: Grid-based layout
            console.log('[VisualFirstBuilder] Using GRID LAYOUT for ' + schoolName);
            
            // Generate grid layout for this school using pre-calculated slice
            var positions = generateFullGrid(sliceInfo, spells.length, config.shape || 'organic', config);
            
            // Select best positions to match spell count
            positions = selectPositions(positions, spells.length);
            
            schoolLayout = { positions: positions, sliceInfo: sliceInfo };
            
            console.log('[VisualFirstBuilder] Grid: ' + positions.length + ' positions');
            
            // Assign spells to positions (grid mode)
            allPositions = positions;
            assignSpellsToPositions(allPositions, spells, schoolSeed + 200);
            
            // Build edges by proximity
            edges = buildEdges(allPositions, config, schoolSeed + 300, fuzzy);
            
            var assignedCount = allPositions.filter(function(p) { return p.spell; }).length;
            console.log('[VisualFirstBuilder] Assigned: ' + assignedCount + '/' + spells.length + ', Edges: ' + edges.length);
        }
        
        // Find root (first novice spell or first spell)
        var root = allPositions.find(function(p) { 
            return p.spell && p.tier === 0; 
        }) || allPositions.find(function(p) { return p.spell; });
        
        // Categorize edges by type
        var primaryEdges = edges.filter(function(e) { return !e.type || e.type === 'primary' || e.type === 'cross'; });
        var prereqEdges = edges.filter(function(e) { return e.type === 'prerequisite'; });
        var alternateEdges = edges.filter(function(e) { return e.type === 'alternate'; });
        
        // Build nodes array
        // DIAGNOSTIC: Log fuzzy.themes availability
        var themeKeys = fuzzy.themes ? Object.keys(fuzzy.themes) : [];
        console.log('[VisualFirstBuilder] fuzzy.themes has', themeKeys.length, 'entries');
        if (themeKeys.length > 0) {
            console.log('[VisualFirstBuilder] Sample theme keys:', themeKeys.slice(0, 3));
        }

        var nodes = allPositions
            .filter(function(p) { return p.spell; })
            .map(function(p) {
                var formId = p.spell.formId;
                
                // Primary children
                var children = primaryEdges
                    .filter(function(e) { return e.from === formId; })
                    .map(function(e) { return e.to; });
                
                // Prerequisites - primary incoming + prerequisite type
                var prerequisites = primaryEdges
                    .filter(function(e) { return e.to === formId; })
                    .map(function(e) { return e.from; });
                
                prereqEdges.forEach(function(e) {
                    if (e.to === formId && prerequisites.indexOf(e.from) === -1) {
                        prerequisites.push(e.from);
                    }
                });
                
                // Alternate paths (shortcuts)
                var alternatePaths = alternateEdges
                    .filter(function(e) { return e.to === formId || e.from === formId; })
                    .map(function(e) { return e.to === formId ? e.from : e.to; });
                
                // Get hard/soft prerequisite requirements (if assigned)
                var prereqReqs = p.prereqRequirements || null;
                
                // Get theme from fuzzy data (Python TF-IDF discovery)
                var spellThemes = fuzzy.themes ? fuzzy.themes[formId] : null;
                var theme = spellThemes && spellThemes.length > 0 ? spellThemes[0] : null;

                return {
                    formId: formId,
                    children: children,
                    prerequisites: prerequisites,
                    // New unified prereq system
                    hardPrereqs: prereqReqs ? prereqReqs.hardPrereqs : undefined,
                    softPrereqs: prereqReqs ? prereqReqs.softPrereqs : undefined,
                    softNeeded: prereqReqs ? prereqReqs.softNeeded : undefined,
                    tier: p.tier + 1,
                    theme: theme,  // Theme from Python fuzzy analysis
                    x: p.x,
                    y: p.y,
                    radius: p.radius,
                    angle: p.angle,
                    isRoot: p.isRoot || false,  // CRITICAL: Root flag for origin lines
                    _fromVisualFirst: true  // Flag for wheelRenderer
                };
            });
        
        schoolOutputs[schoolName] = {
            root: root ? root.spell.formId : null,
            layoutStyle: config.shape || 'organic',
            nodes: nodes,
            config_used: config,
            // Pass slice info for wheelRenderer to use exact same sector angles
            sliceInfo: schoolLayout.sliceInfo
        };
        
        // Log sample node positions
        var sampleNode = nodes[0];
        console.log('[VisualFirstBuilder]', schoolName + ':', nodes.length, 'nodes');
        console.log('[VisualFirstBuilder] Sample node:', sampleNode ? 
                    'x=' + sampleNode.x.toFixed(1) + ', y=' + sampleNode.y.toFixed(1) + 
                    ', _fromVisualFirst=' + sampleNode._fromVisualFirst : 'NONE');
    }
    
    var treeData = {
        version: '2.0',
        generator: 'VisualFirst',
        generatedAt: new Date().toISOString(),
        schools: schoolOutputs,
        school_configs: schoolConfigs
    };
    
    return treeData;
}

/**
 * Format single school output.
 */
function formatTreeOutput(schoolName, positions, edges, config) {
    // Find root (first novice spell)
    var root = positions.find(function(p) { 
        return p.spell && p.tier === 0; 
    }) || positions.find(function(p) { return p.spell; });
    
    // Categorize edges by type
    var primaryEdges = edges.filter(function(e) { return !e.type || e.type === 'primary' || e.type === 'cross'; });
    var prereqEdges = edges.filter(function(e) { return e.type === 'prerequisite'; });
    var alternateEdges = edges.filter(function(e) { return e.type === 'alternate'; });
    
    console.log('[FormatOutput] Edges by type: primary=' + primaryEdges.length + 
                ', prereq=' + prereqEdges.length + ', alternate=' + alternateEdges.length);
    
    // Build nodes array
    var nodes = positions
        .filter(function(p) { return p.spell; })
        .map(function(p) {
            var formId = p.spell.formId;
            
            // Primary children (direct progression)
            var children = primaryEdges
                .filter(function(e) { return e.from === formId; })
                .map(function(e) { return e.to; });
            
            // Prerequisites - combine primary incoming edges + prerequisite type edges
            var prerequisites = primaryEdges
                .filter(function(e) { return e.to === formId; })
                .map(function(e) { return e.from; });
            
            // Add prerequisite-type edges (additional requirements)
            prereqEdges.forEach(function(e) {
                if (e.to === formId && prerequisites.indexOf(e.from) === -1) {
                    prerequisites.push(e.from);
                }
            });
            
            // Alternate paths (shortcuts - learning ANY of these also unlocks this spell)
            var alternatePaths = alternateEdges
                .filter(function(e) { return e.to === formId || e.from === formId; })
                .map(function(e) { return e.to === formId ? e.from : e.to; });
            
                // Get hard/soft prerequisite requirements (if assigned)
                var prereqReqs = p.prereqRequirements || null;
                
                return {
                formId: formId,
                children: children,
                prerequisites: prerequisites,
                // New unified prereq system
                hardPrereqs: prereqReqs ? prereqReqs.hardPrereqs : undefined,
                softPrereqs: prereqReqs ? prereqReqs.softPrereqs : undefined,
                softNeeded: prereqReqs ? prereqReqs.softNeeded : undefined,
                tier: p.tier + 1,
                x: p.x,
                y: p.y,
                radius: p.radius,
                angle: p.angle,
                isRoot: p.isRoot || false,  // CRITICAL: Root flag for origin lines
                _fromVisualFirst: true
            };
        });
    
    var schoolOutput = {
        root: root ? root.spell.formId : null,
        layoutStyle: config.shape || 'organic',
        nodes: nodes,
        config_used: config
    };
    
    var output = {
        version: '2.0',
        generator: 'VisualFirst',
        generatedAt: new Date().toISOString(),
        schools: {}
    };
    output.schools[schoolName] = schoolOutput;
    
    return output;
}

// =============================================================================
// UTILITIES
// =============================================================================

function seededRandom(seed) {
    var state = seed || Date.now();
    return function() {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
    return arr;
}

function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

// =============================================================================
// EXPORTS
// =============================================================================

window.VisualFirstBuilder = {
    generateVisualFirstTree: generateVisualFirstTree,
    generateAllVisualFirstTrees: generateAllVisualFirstTrees,
    assignSpellsToPositions: assignSpellsToPositions,
    buildEdges: buildEdges
};

window.generateVisualFirstTree = generateVisualFirstTree;
window.generateAllVisualFirstTrees = generateAllVisualFirstTrees;
