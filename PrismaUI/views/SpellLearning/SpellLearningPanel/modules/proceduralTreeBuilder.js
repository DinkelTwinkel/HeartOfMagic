/**
 * Procedural Tree Builder Module
 * 
 * Builds spell trees programmatically without LLM using:
 * - Keyword extraction for theme discovery
 * - String matching for spell grouping
 * - Tier-based tree construction
 * 
 * Two modes:
 * - JavaScript (instant, in-browser) - "Procedural" button
 * - Python (better TF-IDF/fuzzy matching) - "Procedural+" button
 * 
 * Depends on:
 * - modules/state.js (state, settings)
 * - modules/treeParser.js (TreeParser)
 * - modules/uiHelpers.js (updateStatus)
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

var PROCEDURAL_CONFIG = {
    maxChildrenPerNode: 3,
    topThemesPerSchool: 8,
    minThemeScore: 30,
    preferVanillaRoots: true,
    convergenceAtTier: 3,
    convergenceChance: 0.4,
    tierOrder: ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
};

// Vanilla root spell FormIDs (preferred starting points)
var VANILLA_ROOTS = {
    'Destruction': '0x00012FCD',   // Flames
    'Restoration': '0x00012FCC',   // Healing
    'Alteration': '0x0005AD5C',    // Oakflesh
    'Conjuration': '0x000640B6',   // Conjure Familiar
    'Illusion': '0x00021143'       // Clairvoyance
};

// Stop words to ignore in theme discovery
var STOP_WORDS = [
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
    'spell', 'magic', 'magical', 'target', 'targets', 'effect', 'effects',
    'damage', 'point', 'points', 'second', 'seconds', 'per', 'does', 'causes',
    'cast', 'caster', 'casting', 'level', 'levels', 'health', 'magicka', 'stamina',
    'novice', 'apprentice', 'adept', 'expert', 'master', 'restore', 'restores'
];

// =============================================================================
// BLACKLIST FILTER
// =============================================================================

/**
 * Filter blacklisted spells from a spell array.
 * Uses settings.spellBlacklist (saved persistently via UnifiedConfig).
 */
function filterBlacklistedSpells(spells) {
    if (!settings.spellBlacklist || settings.spellBlacklist.length === 0) {
        return spells;
    }

    var blacklistedIds = {};
    settings.spellBlacklist.forEach(function(entry) {
        blacklistedIds[entry.formId] = true;
    });

    var filtered = spells.filter(function(spell) {
        var formId = spell.formId || spell.id;
        return !blacklistedIds[formId];
    });

    var removedCount = spells.length - filtered.length;
    if (removedCount > 0) {
        console.log('[Procedural] Filtered ' + removedCount + ' blacklisted spells (' + filtered.length + ' remaining)');
    }

    return filtered;
}

window.filterBlacklistedSpells = filterBlacklistedSpells;

// =============================================================================
// WHITELIST FILTER
// =============================================================================

/**
 * Filter spells to exclude those from disabled plugins.
 * Uses settings.pluginWhitelist (saved persistently via UnifiedConfig).
 * All plugins are ENABLED by default - this filters OUT explicitly disabled ones.
 * Blacklist is applied separately (filters individual spells).
 */
function filterWhitelistedSpells(spells) {
    if (!settings.pluginWhitelist || settings.pluginWhitelist.length === 0) {
        return spells;  // No whitelist configured = include all
    }

    // Get DISABLED plugins (whitelist is opt-out, not opt-in)
    var disabledPlugins = settings.pluginWhitelist.filter(function(entry) {
        return entry.enabled === false;
    });

    if (disabledPlugins.length === 0) {
        return spells;  // Nothing disabled = include all
    }

    // Build lookup of disabled plugin names (lowercase for case-insensitive comparison)
    var disabledMap = {};
    disabledPlugins.forEach(function(entry) {
        disabledMap[entry.plugin.toLowerCase()] = true;
    });

    var filtered = spells.filter(function(spell) {
        var plugin = null;

        // Extract plugin from persistentId: "PluginName.esp|0x00123456"
        if (spell.persistentId && spell.persistentId.includes('|')) {
            plugin = spell.persistentId.split('|')[0];
        }
        // Fallback: try source field
        else if (spell.source) {
            plugin = spell.source;
        }

        if (!plugin) {
            // Can't determine plugin - include it to be safe
            return true;
        }

        // Include if NOT in disabled list
        return disabledMap[plugin.toLowerCase()] !== true;
    });

    var removedCount = spells.length - filtered.length;
    if (removedCount > 0) {
        console.log('[Procedural] Whitelist filtered ' + removedCount + ' spells from disabled plugins (' + filtered.length + ' remaining)');
    }

    return filtered;
}

window.filterWhitelistedSpells = filterWhitelistedSpells;

// =============================================================================
// THEME DISCOVERY (Simplified TF-IDF using word frequency)
// =============================================================================

function extractSpellText(spell) {
    var parts = [];
    if (spell.name) parts.push(spell.name);
    if (spell.effectNames && Array.isArray(spell.effectNames)) {
        parts = parts.concat(spell.effectNames);
    }
    if (spell.effects && Array.isArray(spell.effects)) {
        spell.effects.forEach(function(effect) {
            if (effect.name) parts.push(effect.name);
            if (effect.description) parts.push(effect.description);
        });
    }
    if (spell.keywords && Array.isArray(spell.keywords)) {
        spell.keywords.forEach(function(kw) {
            var cleaned = kw.replace(/^Magic/, '').replace(/([A-Z])/g, ' $1').trim();
            parts.push(cleaned);
        });
    }
    return parts.join(' ').toLowerCase();
}

function discoverThemes(spells, topN) {
    topN = topN || PROCEDURAL_CONFIG.topThemesPerSchool;
    if (!spells || spells.length === 0) return [];
    
    var wordCounts = {};
    var docCounts = {};
    
    spells.forEach(function(spell) {
        var text = extractSpellText(spell);
        var words = text.match(/[a-z]{3,}/g) || [];
        var seenInDoc = {};
        
        words.forEach(function(word) {
            if (STOP_WORDS.indexOf(word) !== -1) return;
            wordCounts[word] = (wordCounts[word] || 0) + 1;
            if (!seenInDoc[word]) {
                seenInDoc[word] = true;
                docCounts[word] = (docCounts[word] || 0) + 1;
            }
        });
    });
    
    var scores = [];
    var totalDocs = spells.length;
    
    for (var word in wordCounts) {
        var tf = wordCounts[word];
        var df = docCounts[word];
        var idf = Math.log((totalDocs + 1) / (df + 1));
        var score = tf * idf;
        if (df >= 2 && df < totalDocs * 0.8) score *= 1.5;
        scores.push({ word: word, score: score, count: tf });
    }
    
    scores.sort(function(a, b) { return b.score - a.score; });
    return scores.slice(0, topN).map(function(s) { return s.word; });
}

function discoverThemesPerSchool(spells) {
    var schoolSpells = {};
    spells.forEach(function(spell) {
        var school = spell.school || 'Unknown';
        if (!school || school === 'null' || school === 'undefined' || school === 'None') {
            school = 'Hedge Wizard';
        }
        if (!schoolSpells[school]) schoolSpells[school] = [];
        schoolSpells[school].push(spell);
    });
    
    var schoolThemes = {};
    for (var school in schoolSpells) {
        schoolThemes[school] = discoverThemes(schoolSpells[school]);
        console.log('[Procedural] ' + school + ': themes = ' + schoolThemes[school].slice(0, 5).join(', '));
    }
    return schoolThemes;
}

// =============================================================================
// SPELL GROUPING
// =============================================================================

function calculateThemeScore(spell, theme) {
    var text = extractSpellText(spell);
    var name = (spell.name || '').toLowerCase();
    var score = 0;
    
    if (text.indexOf(theme) !== -1) score += 40;
    if (name.indexOf(theme) !== -1) score += 50;
    
    var words = text.match(/[a-z]+/g) || [];
    words.forEach(function(word) {
        if (word.indexOf(theme) !== -1 || theme.indexOf(word) !== -1) score += 15;
    });
    
    if (name.indexOf(theme) === 0) score += 20;
    return Math.min(100, score);
}

function groupSpellsByThemes(spells, themes) {
    var groups = {};
    themes.forEach(function(theme) { groups[theme] = []; });
    groups['_unassigned'] = [];
    
    spells.forEach(function(spell) {
        var bestTheme = '_unassigned';
        var bestScore = 0;
        
        themes.forEach(function(theme) {
            var score = calculateThemeScore(spell, theme);
            if (score > bestScore) {
                bestScore = score;
                bestTheme = theme;
            }
        });
        
        if (bestScore >= PROCEDURAL_CONFIG.minThemeScore) {
            groups[bestTheme].push(spell);
        } else {
            groups['_unassigned'].push(spell);
        }
    });
    return groups;
}

// =============================================================================
// TREE BUILDING
// =============================================================================

function TreeNode(spell) {
    this.spell = spell;
    this.formId = spell.formId;
    this.name = spell.name || spell.formId;
    this.tier = spell.skillLevel || 'Unknown';
    this.children = [];
    this.prerequisites = [];
    this.depth = 0;
    this.theme = null;
}

TreeNode.prototype.toDict = function() {
    return {
        formId: this.formId,
        children: this.children.slice(),
        prerequisites: this.prerequisites.slice(),
        tier: this.depth + 1
    };
};

function getTierIndex(tier) {
    var idx = PROCEDURAL_CONFIG.tierOrder.indexOf(tier);
    return idx >= 0 ? idx : PROCEDURAL_CONFIG.tierOrder.length;
}

function sortByTier(spells) {
    return spells.slice().sort(function(a, b) {
        return getTierIndex(a.skillLevel) - getTierIndex(b.skillLevel);
    });
}

function selectRoot(schoolName, spells) {
    var spellIds = {};
    spells.forEach(function(s) { spellIds[s.formId] = s; });
    
    if (PROCEDURAL_CONFIG.preferVanillaRoots && VANILLA_ROOTS[schoolName]) {
        if (spellIds[VANILLA_ROOTS[schoolName]]) return VANILLA_ROOTS[schoolName];
    }
    
    for (var i = 0; i < spells.length; i++) {
        var spell = spells[i];
        if (spell.formId.indexOf('0x00') === 0 && spell.skillLevel === 'Novice') {
            return spell.formId;
        }
    }
    
    for (var i = 0; i < spells.length; i++) {
        if (spells[i].skillLevel === 'Novice') return spells[i].formId;
    }
    
    return spells[0].formId;
}

function buildProceduralSchoolTree(schoolName, spells, themes) {
    if (!spells || spells.length === 0) return null;
    console.log('[Procedural] Building ' + schoolName + ' with ' + spells.length + ' spells');
    
    var nodes = {};
    spells.forEach(function(spell) {
        var node = new TreeNode(spell);
        var bestTheme = '_unassigned';
        var bestScore = 0;
        themes.forEach(function(theme) {
            var score = calculateThemeScore(spell, theme);
            if (score > bestScore) { bestScore = score; bestTheme = theme; }
        });
        node.theme = bestScore >= PROCEDURAL_CONFIG.minThemeScore ? bestTheme : '_unassigned';
        nodes[node.formId] = node;
    });
    
    var rootId = selectRoot(schoolName, spells);
    if (!nodes[rootId]) return null;
    
    var rootNode = nodes[rootId];
    rootNode.depth = 0;
    
    var grouped = groupSpellsByThemes(spells, themes);
    var connected = {};
    connected[rootId] = true;
    
    var availableParents = {};
    availableParents[0] = [rootNode];
    
    var sortedThemes = Object.keys(grouped).sort(function(a, b) {
        return (grouped[b] || []).length - (grouped[a] || []).length;
    });
    
    sortedThemes.forEach(function(theme) {
        if (theme === '_unassigned') return;
        var themeSpells = sortByTier(grouped[theme] || []);
        var themeParent = null;
        
        themeSpells.forEach(function(spell) {
            if (connected[spell.formId]) { themeParent = nodes[spell.formId]; return; }
            
            var node = nodes[spell.formId];
            var tierDepth = getTierIndex(node.tier);
            var parent = findParent(node, themeParent, availableParents, tierDepth, theme);
            
            if (parent) {
                linkNodes(parent, node);
                connected[node.formId] = true;
                if (node.children.length < PROCEDURAL_CONFIG.maxChildrenPerNode) {
                    if (!availableParents[node.depth]) availableParents[node.depth] = [];
                    availableParents[node.depth].push(node);
                }
                themeParent = node;
                if (tierDepth >= PROCEDURAL_CONFIG.convergenceAtTier) {
                    maybeAddConvergence(node, availableParents, connected, nodes);
                }
            }
        });
    });
    
    var unassigned = sortByTier(grouped['_unassigned'] || []);
    unassigned.forEach(function(spell) {
        if (connected[spell.formId]) return;
        var node = nodes[spell.formId];
        var tierDepth = getTierIndex(node.tier);
        var parent = findParent(node, null, availableParents, tierDepth, '_unassigned');
        if (parent) {
            linkNodes(parent, node);
            connected[node.formId] = true;
            if (node.children.length < PROCEDURAL_CONFIG.maxChildrenPerNode) {
                if (!availableParents[node.depth]) availableParents[node.depth] = [];
                availableParents[node.depth].push(node);
            }
        }
    });
    
    connectOrphans(rootNode, nodes, connected);
    
    var nodeList = [];
    for (var formId in nodes) nodeList.push(nodes[formId].toDict());
    
    return { root: rootId, layoutStyle: 'radial', nodes: nodeList };
}

function findParent(node, preferredParent, availableParents, targetDepth, theme) {
    if (preferredParent && preferredParent.children.length < PROCEDURAL_CONFIG.maxChildrenPerNode) {
        return preferredParent;
    }
    
    var searchDepths = [targetDepth - 1, targetDepth - 2, targetDepth];
    for (var i = 0; i < searchDepths.length; i++) {
        var depth = searchDepths[i];
        if (depth < 0) continue;
        var candidates = (availableParents[depth] || []).filter(function(p) {
            return p.children.length < PROCEDURAL_CONFIG.maxChildrenPerNode;
        });
        if (candidates.length === 0) continue;
        
        var sameTheme = candidates.filter(function(p) { return p.theme === theme; });
        if (sameTheme.length > 0) {
            sameTheme.sort(function(a, b) { return a.children.length - b.children.length; });
            return sameTheme[0];
        }
        candidates.sort(function(a, b) { return a.children.length - b.children.length; });
        return candidates[0];
    }
    
    for (var depth in availableParents) {
        var candidates = (availableParents[depth] || []).filter(function(p) {
            return p.children.length < PROCEDURAL_CONFIG.maxChildrenPerNode;
        });
        if (candidates.length > 0) {
            candidates.sort(function(a, b) { return a.children.length - b.children.length; });
            return candidates[0];
        }
    }
    return null;
}

function linkNodes(parent, child) {
    parent.children.push(child.formId);
    child.prerequisites.push(parent.formId);
    child.depth = parent.depth + 1;
}

function maybeAddConvergence(node, availableParents, connected, nodes) {
    if (Math.random() > PROCEDURAL_CONFIG.convergenceChance) return;
    if (node.prerequisites.length >= 2) return;
    
    for (var depth = node.depth - 1; depth >= 0; depth--) {
        var candidates = (availableParents[depth] || []).filter(function(p) {
            return p.theme !== node.theme && node.prerequisites.indexOf(p.formId) === -1 && connected[p.formId];
        });
        if (candidates.length > 0) {
            var extraPrereq = candidates[Math.floor(Math.random() * candidates.length)];
            node.prerequisites.push(extraPrereq.formId);
            extraPrereq.children.push(node.formId);
            console.log('[Procedural] Convergence: ' + node.name + ' now requires ' + extraPrereq.name);
            return;
        }
    }
}

function connectOrphans(rootNode, nodes, connected) {
    var orphans = [];
    for (var formId in nodes) {
        if (!connected[formId]) orphans.push(nodes[formId]);
    }
    if (orphans.length > 0) console.log('[Procedural] Connecting ' + orphans.length + ' orphan nodes');
    
    orphans = sortByTier(orphans.map(function(n) { return n.spell; }));
    orphans.forEach(function(spell) {
        var orphanNode = nodes[spell.formId];
        var tierDepth = getTierIndex(orphanNode.tier);
        var bestParent = null;
        
        for (var formId in nodes) {
            if (!connected[formId]) continue;
            var node = nodes[formId];
            if (node.children.length >= PROCEDURAL_CONFIG.maxChildrenPerNode) continue;
            if (node.depth > tierDepth) continue;
            if (!bestParent || node.children.length < bestParent.children.length) bestParent = node;
        }
        if (!bestParent) bestParent = rootNode;
        
        linkNodes(bestParent, orphanNode);
        connected[orphanNode.formId] = true;
    });
}

// =============================================================================
// MAIN API - JAVASCRIPT VERSION
// =============================================================================

function buildProceduralTrees(spells) {
    spells = filterBlacklistedSpells(spells);
    spells = filterWhitelistedSpells(spells);
    console.log('[Procedural] Building trees for ' + spells.length + ' spells');
    var startTime = Date.now();
    
    var schoolSpells = {};
    spells.forEach(function(spell) {
        var school = spell.school || 'Unknown';
        if (!school || school === 'null' || school === 'undefined' || school === 'None' || school === '') {
            school = 'Hedge Wizard';
        }
        if (!schoolSpells[school]) schoolSpells[school] = [];
        schoolSpells[school].push(spell);
    });
    
    var allThemes = discoverThemesPerSchool(spells);
    
    var output = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        generator: 'Procedural (JavaScript)',
        schools: {}
    };
    
    var totalNodes = 0;
    for (var schoolName in schoolSpells) {
        var themes = allThemes[schoolName] || [];
        var schoolTree = buildProceduralSchoolTree(schoolName, schoolSpells[schoolName], themes);
        if (schoolTree) {
            output.schools[schoolName] = schoolTree;
            totalNodes += schoolTree.nodes.length;
        }
    }
    
    var elapsed = Date.now() - startTime;
    console.log('[Procedural] Built ' + Object.keys(output.schools).length + ' schools, ' + 
                totalNodes + ' nodes in ' + elapsed + 'ms');
    
    return output;
}

// =============================================================================
// GRID-BASED POSITION ASSIGNMENT (Similar to Fuzzy Builder)
// =============================================================================

/**
 * Assigns grid-based positions to all nodes in the tree data.
 * Uses the same grid system as the fuzzy builder for consistent spacing.
 * 
 * @param {Object} treeData - Tree data from buildProceduralTrees
 * @returns {Object} - Tree data with positions assigned
 */
function assignGridPositions(treeData) {
    console.log('[SimpleGrid] Assigning grid positions to tree...');
    
    // Get grid configuration (same as fuzzy builder)
    var gridCfg = typeof GRID_CONFIG !== 'undefined' ? GRID_CONFIG.getComputedConfig() : {
        baseRadius: 80,
        tierSpacing: 60,
        nodeSize: 18,
        minNodeSpacing: 25
    };
    
    var schoolNames = Object.keys(treeData.schools);
    var schoolCount = schoolNames.length;
    if (schoolCount === 0) return treeData;
    
    // Calculate equal pie slices for each school
    var anglePerSchool = 360 / schoolCount;
    
    schoolNames.forEach(function(schoolName, schoolIndex) {
        var school = treeData.schools[schoolName];
        if (!school || !school.nodes || school.nodes.length === 0) return;
        
        // Calculate this school's angular sector
        var startAngle = schoolIndex * anglePerSchool;
        var centerAngle = startAngle + anglePerSchool / 2;
        var halfSector = anglePerSchool / 2 * 0.9; // Use 90% of sector to avoid edge overlap
        
        var sliceInfo = {
            startAngle: startAngle,
            endAngle: startAngle + anglePerSchool,
            centerAngle: centerAngle,
            halfSector: halfSector
        };
        
        // Store slice info for renderer
        school.sliceInfo = sliceInfo;
        
        // Build node lookup and organize by tier
        var nodeById = {};
        var nodesByTier = {};
        var maxTier = 0;
        
        school.nodes.forEach(function(node) {
            nodeById[node.formId] = node;
            var tier = node.tier || 0;
            if (!nodesByTier[tier]) nodesByTier[tier] = [];
            nodesByTier[tier].push(node);
            if (tier > maxTier) maxTier = tier;
        });
        
        // Seeded random for consistent positioning
        var seed = 0;
        for (var i = 0; i < schoolName.length; i++) {
            seed = ((seed << 5) - seed) + schoolName.charCodeAt(i);
            seed |= 0;
        }
        var rng = function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
        
        // Track placed positions to avoid overlap
        var placedPositions = [];
        
        // Place nodes tier by tier
        for (var tier = 0; tier <= maxTier; tier++) {
            var tierNodes = nodesByTier[tier] || [];
            if (tierNodes.length === 0) continue;
            
            var radius = gridCfg.baseRadius + tier * gridCfg.tierSpacing;
            
            // Calculate angular positions for this tier
            var nodesInTier = tierNodes.length;
            var availableAngle = halfSector * 2;
            var angleStep = nodesInTier > 1 ? availableAngle / (nodesInTier - 1) : 0;
            var baseAngle = centerAngle - (nodesInTier > 1 ? halfSector : 0);
            
            // Sort nodes to spread them nicely (by theme or formId for consistency)
            tierNodes.sort(function(a, b) {
                var themeA = a.theme || '';
                var themeB = b.theme || '';
                if (themeA !== themeB) return themeA.localeCompare(themeB);
                return (a.formId || '').localeCompare(b.formId || '');
            });
            
            tierNodes.forEach(function(node, idx) {
                var angle = baseAngle + idx * angleStep;
                
                // Add small jitter for visual variety (but less than fuzzy builder)
                var angleJitter = (rng() - 0.5) * 3; // ±1.5 degrees
                var radiusJitter = (rng() - 0.5) * gridCfg.tierSpacing * 0.15;
                
                angle += angleJitter;
                var nodeRadius = radius + radiusJitter;
                
                // Clamp to sector boundaries
                angle = Math.max(centerAngle - halfSector * 0.95, 
                         Math.min(centerAngle + halfSector * 0.95, angle));
                
                // Convert to cartesian
                var rad = angle * Math.PI / 180;
                var x = Math.cos(rad) * nodeRadius;
                var y = Math.sin(rad) * nodeRadius;
                
                // Check for overlap and nudge if needed
                var minSpacing = gridCfg.minNodeSpacing;
                var attempts = 0;
                while (attempts < 10 && hasOverlap(x, y, placedPositions, minSpacing)) {
                    // Nudge outward slightly
                    nodeRadius += minSpacing * 0.5;
                    x = Math.cos(rad) * nodeRadius;
                    y = Math.sin(rad) * nodeRadius;
                    attempts++;
                }
                
                // Assign position
                node.x = x;
                node.y = y;
                node.angle = angle;
                node.radius = nodeRadius;
                node._fromVisualFirst = true; // Mark as pre-positioned
                
                // Mark root node
                if (tier === 0) {
                    node.isRoot = true;
                }
                
                placedPositions.push({ x: x, y: y });
            });
        }
        
        console.log('[SimpleGrid] ' + schoolName + ': ' + school.nodes.length + ' nodes positioned');
        
        // Build edges array for prerequisite/alternate path processing
        var edges = [];
        school.nodes.forEach(function(node) {
            (node.prerequisites || []).forEach(function(prereqId) {
                // Skip undefined/null prerequisites
                if (prereqId && node.formId) {
                    edges.push({ from: prereqId, to: node.formId });
                }
            });
        });
        
        // Assign hard/soft prerequisites
        assignSimplePrerequisites(school.nodes, nodeById, edges, rng);
        
        // Add alternate paths between nearby same-tier nodes
        addSimpleAlternatePaths(school.nodes, nodeById, nodesByTier, edges, rng, gridCfg);
        
        // Update node children/prerequisites arrays from edges
        updateNodeConnections(school.nodes, nodeById, edges);
    });
    
    return treeData;
}

/**
 * Assign hard/soft prerequisites to nodes (simplified version)
 */
function assignSimplePrerequisites(nodes, nodeById, edges, rng) {
    // Tier configs: higher tier = more likely to have complex prereqs
    var TIER_CONFIG = {
        0: { hardChance: 1.0, maxHard: 1, softNeededBase: 0 },  // Novice: simple
        1: { hardChance: 0.8, maxHard: 1, softNeededBase: 1 },  // Apprentice
        2: { hardChance: 0.6, maxHard: 2, softNeededBase: 1 },  // Adept
        3: { hardChance: 0.5, maxHard: 2, softNeededBase: 2 },  // Expert
        4: { hardChance: 0.4, maxHard: 3, softNeededBase: 2 }   // Master
    };
    
    // Build incoming edges map
    var incomingEdges = {};
    nodes.forEach(function(n) { incomingEdges[n.formId] = []; });
    edges.forEach(function(e) {
        // Skip malformed edges
        if (e && e.from && e.to && incomingEdges[e.to]) {
            incomingEdges[e.to].push(e);
        }
    });
    
    nodes.forEach(function(node) {
        if (node.isRoot) {
            node.hardPrereqs = [];
            node.softPrereqs = [];
            node.softNeeded = 0;
            return;
        }
        
        var incoming = incomingEdges[node.formId] || [];
        if (incoming.length === 0) {
            node.hardPrereqs = [];
            node.softPrereqs = [];
            node.softNeeded = 0;
            return;
        }
        
        // Single incoming = always hard
        if (incoming.length === 1) {
            node.hardPrereqs = [incoming[0].from];
            node.softPrereqs = [];
            node.softNeeded = 0;
            return;
        }
        
        var tier = Math.min(node.tier || 0, 4);
        var config = TIER_CONFIG[tier];
        
        var hardPrereqs = [];
        var softPrereqs = [];
        
        // Shuffle and assign
        var shuffled = incoming.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(rng() * (i + 1));
            var temp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
        }
        
        var hardCount = 0;
        shuffled.forEach(function(edge) {
            // Skip undefined/malformed edges
            if (!edge || !edge.from) return;
            
            if (hardCount < config.maxHard && rng() < config.hardChance) {
                hardPrereqs.push(edge.from);
                hardCount++;
            } else {
                softPrereqs.push(edge.from);
            }
        });
        
        var softNeeded = Math.min(config.softNeededBase, softPrereqs.length);
        
        // If all soft needed equals all available, consolidate to hard
        if (softNeeded > 0 && softNeeded >= softPrereqs.length) {
            hardPrereqs = hardPrereqs.concat(softPrereqs);
            softPrereqs = [];
            softNeeded = 0;
        }
        
        node.hardPrereqs = hardPrereqs;
        node.softPrereqs = softPrereqs;
        node.softNeeded = softNeeded;
    });
}

/**
 * Add alternate paths between nearby same-tier nodes (simplified version)
 */
function addSimpleAlternatePaths(nodes, nodeById, nodesByTier, edges, rng, gridCfg) {
    var altPathConfig = {
        minPathDistance: 3,
        maxSpatialDistance: gridCfg.tierSpacing * 2,
        baseProbability: 0.25,
        maxAlternatesPerNode: 2
    };
    
    var addedCount = 0;
    var edgeSet = {};
    edges.forEach(function(e) {
        if (e && e.from && e.to) {
            edgeSet[e.from + '->' + e.to] = true;
        }
    });
    
    // For each tier, look for potential alternate connections
    for (var tier in nodesByTier) {
        var tierNodes = nodesByTier[tier];
        if (tierNodes.length < 2) continue;
        
        tierNodes.forEach(function(nodeA) {
            var altCount = 0;
            
            tierNodes.forEach(function(nodeB) {
                if (nodeA.formId === nodeB.formId) return;
                if (altCount >= altPathConfig.maxAlternatesPerNode) return;
                
                // Check if already connected
                var keyAB = nodeA.formId + '->' + nodeB.formId;
                var keyBA = nodeB.formId + '->' + nodeA.formId;
                if (edgeSet[keyAB] || edgeSet[keyBA]) return;
                
                // Check spatial distance
                var dx = nodeA.x - nodeB.x;
                var dy = nodeA.y - nodeB.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > altPathConfig.maxSpatialDistance) return;
                
                // Random chance
                if (rng() > altPathConfig.baseProbability) return;
                
                // Add alternate path (from lower tier parent to higher, or random direction for same tier)
                var fromNode = (nodeA.tier || 0) < (nodeB.tier || 0) ? nodeA : 
                              ((nodeA.tier || 0) > (nodeB.tier || 0) ? nodeB : 
                              (rng() > 0.5 ? nodeA : nodeB));
                var toNode = fromNode === nodeA ? nodeB : nodeA;
                
                edges.push({ from: fromNode.formId, to: toNode.formId, isAlternate: true });
                edgeSet[fromNode.formId + '->' + toNode.formId] = true;
                addedCount++;
                altCount++;
            });
        });
    }
    
    console.log('[SimpleGrid] Added ' + addedCount + ' alternate paths');
}

/**
 * Update node children/prerequisites arrays from edges
 */
function updateNodeConnections(nodes, nodeById, edges) {
    // Clear and rebuild
    nodes.forEach(function(n) {
        n.children = [];
        n.prerequisites = [];
    });
    
    edges.forEach(function(e) {
        var fromNode = nodeById[e.from];
        var toNode = nodeById[e.to];
        
        if (fromNode && toNode) {
            if (fromNode.children.indexOf(e.to) === -1) {
                fromNode.children.push(e.to);
            }
            if (toNode.prerequisites.indexOf(e.from) === -1) {
                toNode.prerequisites.push(e.from);
            }
        }
    });
}

/**
 * Check if a position overlaps with any placed positions
 */
function hasOverlap(x, y, placedPositions, minSpacing) {
    for (var i = 0; i < placedPositions.length; i++) {
        var p = placedPositions[i];
        var dx = x - p.x;
        var dy = y - p.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minSpacing) return true;
    }
    return false;
}

// =============================================================================
// SINGLE SCHOOL GENERATION (Simple mode for individual regeneration)
// =============================================================================

/**
 * Generate a simple tree for a single school and merge it into the existing tree.
 * Uses JavaScript-only logic with grid positioning.
 */
function generateSimpleSchoolTree(schoolName, spells, config) {
    console.log('[SimpleSchool] Generating ' + schoolName + ' with ' + spells.length + ' spells');
    
    if (!spells || spells.length === 0) {
        console.warn('[SimpleSchool] No spells for ' + schoolName);
        return null;
    }
    
    // Build tree structure using basic theme grouping
    var themes = discoverThemes(spells);
    var schoolTree = buildProceduralSchoolTree(schoolName, spells, themes);
    
    if (!schoolTree) {
        console.error('[SimpleSchool] Failed to build tree for ' + schoolName);
        return null;
    }
    
    // Get grid configuration
    var gridCfg = typeof GRID_CONFIG !== 'undefined' ? GRID_CONFIG.getComputedConfig() : {
        baseRadius: 80,
        tierSpacing: 60,
        nodeSize: 18,
        minNodeSpacing: 25
    };
    
    // Get existing slice info if available, otherwise calculate new
    var sliceInfo;
    if (config.useExistingSlice && typeof storedSliceAngles !== 'undefined' && storedSliceAngles[schoolName]) {
        sliceInfo = storedSliceAngles[schoolName];
        console.log('[SimpleSchool] Using existing slice for ' + schoolName);
    } else {
        // Calculate slice based on all schools in current tree
        var allSchools = state.treeData && state.treeData.schools ? Object.keys(state.treeData.schools) : [schoolName];
        if (allSchools.indexOf(schoolName) === -1) allSchools.push(schoolName);
        var schoolIndex = allSchools.indexOf(schoolName);
        var anglePerSchool = 360 / allSchools.length;
        var startAngle = schoolIndex * anglePerSchool;
        
        sliceInfo = {
            startAngle: startAngle,
            endAngle: startAngle + anglePerSchool,
            centerAngle: startAngle + anglePerSchool / 2,
            halfSector: anglePerSchool / 2 * 0.9
        };
    }
    
    // Position nodes on grid
    var seed = 0;
    for (var i = 0; i < schoolName.length; i++) {
        seed = ((seed << 5) - seed) + schoolName.charCodeAt(i);
        seed |= 0;
    }
    var rng = function() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };
    
    // Build lookups
    var nodeById = {};
    var nodesByTier = {};
    var maxTier = 0;
    
    schoolTree.nodes.forEach(function(node) {
        nodeById[node.formId] = node;
        var tier = node.tier || 0;
        if (!nodesByTier[tier]) nodesByTier[tier] = [];
        nodesByTier[tier].push(node);
        if (tier > maxTier) maxTier = tier;
    });
    
    var placedPositions = [];
    var centerAngle = sliceInfo.centerAngle;
    var halfSector = sliceInfo.halfSector;
    
    // Position nodes tier by tier
    for (var tier = 0; tier <= maxTier; tier++) {
        var tierNodes = nodesByTier[tier] || [];
        if (tierNodes.length === 0) continue;
        
        var radius = gridCfg.baseRadius + tier * gridCfg.tierSpacing;
        var nodesInTier = tierNodes.length;
        var availableAngle = halfSector * 2;
        var angleStep = nodesInTier > 1 ? availableAngle / (nodesInTier - 1) : 0;
        var baseAngle = centerAngle - (nodesInTier > 1 ? halfSector : 0);
        
        tierNodes.forEach(function(node, idx) {
            var angle = baseAngle + idx * angleStep;
            var angleJitter = (rng() - 0.5) * 3;
            var radiusJitter = (rng() - 0.5) * gridCfg.tierSpacing * 0.15;
            
            angle += angleJitter;
            var nodeRadius = radius + radiusJitter;
            
            angle = Math.max(centerAngle - halfSector * 0.95, 
                     Math.min(centerAngle + halfSector * 0.95, angle));
            
            var rad = angle * Math.PI / 180;
            var x = Math.cos(rad) * nodeRadius;
            var y = Math.sin(rad) * nodeRadius;
            
            var minSpacing = gridCfg.minNodeSpacing;
            var attempts = 0;
            while (attempts < 10 && hasOverlap(x, y, placedPositions, minSpacing)) {
                nodeRadius += minSpacing * 0.5;
                x = Math.cos(rad) * nodeRadius;
                y = Math.sin(rad) * nodeRadius;
                attempts++;
            }
            
            node.x = x;
            node.y = y;
            node.angle = angle;
            node.radius = nodeRadius;
            node._fromVisualFirst = true;
            
            if (tier === 0) node.isRoot = true;
            
            placedPositions.push({ x: x, y: y });
        });
    }
    
    // Build edges and add prereqs/alternate paths
    var edges = [];
    schoolTree.nodes.forEach(function(node) {
        (node.prerequisites || []).forEach(function(prereqId) {
            // Skip undefined/null prerequisites
            if (prereqId && node.formId) {
                edges.push({ from: prereqId, to: node.formId });
            }
        });
    });
    
    assignSimplePrerequisites(schoolTree.nodes, nodeById, edges, rng);
    addSimpleAlternatePaths(schoolTree.nodes, nodeById, nodesByTier, edges, rng, gridCfg);
    updateNodeConnections(schoolTree.nodes, nodeById, edges);
    
    // Store slice info
    schoolTree.sliceInfo = sliceInfo;
    
    // Merge into existing tree data
    if (typeof mergeSchoolTree === 'function') {
        mergeSchoolTree(schoolName, schoolTree);
    } else if (state.treeData && state.treeData.rawData) {
        state.treeData.rawData.schools[schoolName] = schoolTree;
        if (typeof loadTreeData === 'function') {
            loadTreeData(state.treeData.rawData);
        }
    }
    
    // Save to C++ if available
    if (window.callCpp && state.treeData && state.treeData.rawData) {
        window.callCpp('SaveSpellTree', JSON.stringify(state.treeData.rawData));
    }
    
    console.log('[SimpleSchool] Generated ' + schoolName + ' with ' + schoolTree.nodes.length + ' nodes');
    return schoolTree;
}

// Export for use by generationModeUI
window.generateSimpleSchoolTree = generateSimpleSchoolTree;

// =============================================================================
// UI HANDLERS - JAVASCRIPT VERSION
// =============================================================================

function startProceduralGenerate() {
    if (!state.lastSpellData || !state.lastSpellData.spells) {
        updateStatus('No spell data - scan spells first');
        setStatusIcon('X');
        resetProceduralButton();
        return;
    }
    
    updateStatus('Generating trees (JS)...');
    setStatusIcon('...');
    
    setTimeout(function() {
        try {
            var treeData = buildProceduralTrees(state.lastSpellData.spells);
            
            // Assign grid-based positions (same system as fuzzy builder)
            treeData = assignGridPositions(treeData);
            
            if (typeof loadTreeData === 'function') {
                loadTreeData(treeData);
            } else {
                var result = TreeParser.parse(treeData);
                if (result.success) {
                    state.treeData = result;
                    state.treeData.rawData = treeData;
                }
            }
            
            var schoolCount = Object.keys(treeData.schools).length;
            var nodeCount = 0;
            for (var school in treeData.schools) {
                nodeCount += treeData.schools[school].nodes.length;
            }
            
            updateStatus('Simple Build: ' + schoolCount + ' schools, ' + nodeCount + ' spells');
            setStatusIcon('OK');
            
            if (window.callCpp) window.callCpp('SaveSpellTree', JSON.stringify(treeData));
            
            setTimeout(function() {
                switchTab('spellTree');
            }, 300);

        } catch (e) {
            console.error('[Procedural] Error:', e);
            updateStatus('JS Procedural failed: ' + e.message);
            setStatusIcon('X');
        }
        resetProceduralButton();
    }, 50);
}

function resetProceduralButton() {
    state.proceduralMode = false;
    var btn = document.getElementById('proceduralBtn');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">[T]</span> Build Tree';
    }
}

function onProceduralClick() {
    console.log('[Procedural] JS button clicked');
    var btn = document.getElementById('proceduralBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">...</span> Building...';
    }
    state.proceduralMode = true;
    
    if (state.lastSpellData && state.lastSpellData.spells) {
        startProceduralGenerate();
    } else {
        updateStatus('Scanning spells...');
        state.proceduralPending = true;
        startScan(false);
    }
}

// =============================================================================
// UI HANDLERS - PYTHON VERSION (calls C++)
// All LLM calls happen in Python - JS just passes API credentials
// =============================================================================

function startProceduralPythonGenerate(schoolFilter, schoolConfig) {
    if (!state.lastSpellData || !state.lastSpellData.spells) {
        updateStatus('No spell data - scan spells first');
        setStatusIcon('X');
        resetProceduralPlusButton();
        return;
    }
    
    var spellsToProcess = filterBlacklistedSpells(state.lastSpellData.spells);
    spellsToProcess = filterWhitelistedSpells(spellsToProcess);

    // If filtering to a specific school
    if (schoolFilter) {
        spellsToProcess = spellsToProcess.filter(function(s) {
            return s.school === schoolFilter;
        });
    }
    
    // Get LLM options from UI checkboxes
    var llmAutoConfigCheck = document.getElementById('llmAutoConfigCheck');
    var llmGroupsCheck = document.getElementById('llmGroupsCheck');
    
    // Build config - use school-specific if provided, otherwise global
    var config = schoolConfig || {
        shape: 'organic',
        density: 0.6,
        symmetry: 0.3,
        max_children_per_node: PROCEDURAL_CONFIG.maxChildrenPerNode,
        top_themes_per_school: PROCEDURAL_CONFIG.topThemesPerSchool,
        convergence_chance: PROCEDURAL_CONFIG.convergenceChance,
        prefer_vanilla_roots: PROCEDURAL_CONFIG.preferVanillaRoots,
        branching_energy: {
            enabled: true,
            min_straight: 2,
            max_straight: 5,
            randomness: 0.3
        }
    };
    
    // Add seed from UI - applies on top of LLM results for reproducible randomness
    var seed = typeof getCurrentSeed === 'function' ? getCurrentSeed() : null;
    if (seed) {
        config.seed = seed;
        console.log('[Procedural] Using seed:', seed);
    }
    
    // LLM options - ALL LLM calls happen in Python
    config.llm_auto_configure = {
        enabled: llmAutoConfigCheck ? llmAutoConfigCheck.checked : false,
        prompt_template: typeof getAutoConfigPrompt === 'function' ? getAutoConfigPrompt() : ''
    };
    
    config.llm_groups = {
        enabled: llmGroupsCheck ? llmGroupsCheck.checked : false,
        prompt_template: typeof getGroupPrompt === 'function' ? getGroupPrompt() : ''
    };

    // LLM Keyword Classification
    var llmKwClass = settings.treeGeneration && settings.treeGeneration.llm &&
                     settings.treeGeneration.llm.enabled &&
                     settings.treeGeneration.llm.keywordClassification;
    config.llm_keyword_classification = {
        enabled: llmKwClass || false,
        batch_size: 100,
        min_confidence: 40
    };

    // Pass API credentials to Python for LLM calls
    var llmEnabled = config.llm_auto_configure.enabled || config.llm_groups.enabled || config.llm_keyword_classification.enabled;
    if (llmEnabled && state.llmConfig && state.llmConfig.apiKey) {
        config.llm_api = {
            api_key: state.llmConfig.apiKey,
            model: state.llmConfig.model || 'openai/gpt-4o-mini',
            endpoint: 'https://openrouter.ai/api/v1/chat/completions'
        };
        console.log('[Procedural] LLM enabled - API key provided: YES');
    }

    // Add tree generation settings from UI (Tier 4 wiring)
    if (settings.treeGeneration) {
        var tg = settings.treeGeneration;
        config.tree_generation = {
            // Theme Discovery
            theme_discovery_mode: tg.themeDiscoveryMode || 'dynamic',
            enable_smart_routing: tg.enableSmartRouting !== false,
            auto_branch_fallback: tg.autoBranchFallback !== false,

            // Element Rules
            element_isolation: tg.elementIsolation !== false,
            element_isolation_strict: tg.elementIsolationStrict || false,

            // Tier Rules
            strict_tier_ordering: tg.strictTierOrdering !== false,
            allow_same_tier_links: tg.allowSameTierLinks !== false,
            tier_mixing: tg.tierMixing || false,
            tier_mixing_amount: tg.tierMixingAmount || 20,

            // Link Strategy
            link_strategy: tg.linkStrategy || 'thematic',
            max_children_per_node: tg.maxChildrenPerNode || 3,

            // Convergence
            convergence_enabled: tg.convergenceEnabled !== false,
            convergence_chance: tg.convergenceChance || 40,
            convergence_min_tier: tg.convergenceMinTier || 3,

            // Scoring Factors
            scoring: tg.scoring || {
                elementMatching: true,
                spellTypeMatching: true,
                tierProgression: true,
                keywordMatching: true,
                themeCoherence: true,
                effectNameMatching: true,
                descriptionSimilarity: true,
                magickaCostProximity: false,
                sameModSource: false
            },

            // LLM Edge Cases
            llm_edge_case_enabled: tg.llmEdgeCaseEnabled || false,
            llm_edge_case_threshold: tg.llmEdgeCaseThreshold || 10
        };
        console.log('[Procedural] Tree generation settings applied:', config.tree_generation.link_strategy);
    }

    // Update status based on LLM options
    var statusMsg = schoolFilter ? 'Regenerating ' + schoolFilter : 'Generating trees';
    statusMsg += ' (Python';
    if (config.llm_auto_configure.enabled) statusMsg += ' + LLM Config';
    if (config.llm_groups.enabled) statusMsg += ' + LLM Groups';
    statusMsg += ')...';
    
    updateStatus(statusMsg);
    setStatusIcon('...');
    
    // Send to Python via C++
    if (window.callCpp) {
        var request = {
            spells: spellsToProcess,
            config: config,
            schoolFilter: schoolFilter || null
        };
        console.log('[Procedural] Python request:', {
            spells: spellsToProcess.length,
            llmConfig: config.llm_auto_configure.enabled,
            llmGroups: config.llm_groups.enabled
        });
        window.callCpp('ProceduralPythonGenerate', JSON.stringify(request));
    } else {
        updateStatus('C++ bridge not available');
        setStatusIcon('X');
        resetProceduralPlusButton();
    }
}

function resetProceduralPlusButton() {
    state.proceduralPlusPending = false;
    var btn = document.getElementById('proceduralPlusBtn');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">[P]</span> Procedural+';
    }
}

function onProceduralPlusClick() {
    console.log('[Procedural] Python button clicked');
    var btn = document.getElementById('proceduralPlusBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">...</span> Python...';
    }
    state.proceduralPlusPending = true;
    
    if (state.lastSpellData && state.lastSpellData.spells) {
        startProceduralPythonGenerate();
    } else {
        updateStatus('Scanning spells...');
        state.proceduralPlusScanPending = true;
        startScan(false);
    }
}

/**
 * Shared error handler for Python tree build failures.
 * Used by both Classic and Tree growth mode routing.
 *
 * @param {string} error - Error string from Python/C++
 * @param {string} pendingKey - State key to set for retry (e.g. '_classicGrowthBuildPending')
 * @param {Object|null} settingsModule - ClassicSettings or TreeSettings (has .setStatusText)
 * @param {Object} retryConfig - Config to pass on retry {command, config}
 * @param {string} buildBtnId - DOM id of the build button to re-enable
 * @param {string} logPrefix - Console log prefix e.g. '[ClassicGrowth]'
 */
function _handleBuildFailure(error, pendingKey, settingsModule, retryConfig, buildBtnId, logPrefix) {
    console.error(logPrefix + ' Python build failed:', error);
    var errorMsg = 'Tree build failed: ' + error + '\nPlease report this error on the mod page.';
    var retryFn = function() {
        if (state.lastSpellData && state.lastSpellData.spells && window.callCpp) {
            state[pendingKey] = true;
            var hasPRM = typeof PreReqMaster !== 'undefined' && PreReqMaster.isEnabled && PreReqMaster.isEnabled();
            if (typeof BuildProgress !== 'undefined') BuildProgress.start(hasPRM);
            if (settingsModule) settingsModule.setStatusText('Retrying with fallback...', '#f59e0b');
            window.callCpp('ProceduralPythonGenerate', JSON.stringify({
                command: retryConfig.command || 'build_tree',
                spells: state.lastSpellData.spells,
                config: retryConfig.config || {},
                fallback: true
            }));
        }
    };
    if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
        BuildProgress.fail(errorMsg, retryFn);
    }
    if (settingsModule) {
        settingsModule.setStatusText('Build failed: ' + error, '#ef4444');
    }
    if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeBuildFailed', {error: error}), 'error');
    var btn = document.getElementById(buildBtnId);
    if (btn) btn.disabled = false;
}

/**
 * Callback from C++ when Python procedural generation completes
 */
window.onProceduralPythonComplete = function(resultStr) {
    console.log('[Procedural] Python result received');

    try {
        var result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;

        // If python stage is still active (first spawn), advance past it now that Python responded
        if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive() && BuildProgress.getCurrentStage() === 'python') {
            BuildProgress.setStage('tree');
        }

        // Route to Classic Growth mode if it triggered this build
        if (state._classicGrowthBuildPending) {
            state._classicGrowthBuildPending = false;
            if (result.success && result.treeData) {
                // Advance build progress: tree done → prereqs or finalize
                if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                    BuildProgress.setStage('prereqs');
                }
                var cgTreeData = typeof result.treeData === 'string' ? JSON.parse(result.treeData) : result.treeData;
                if (typeof TreeGrowthClassic !== 'undefined' && TreeGrowthClassic.loadTreeData) {
                    TreeGrowthClassic.loadTreeData(cgTreeData);
                    if (typeof TreeGrowth !== 'undefined') TreeGrowth._markDirty();
                }
                // Update notification bar with build result
                var cgSchools = cgTreeData && cgTreeData.schools ? Object.keys(cgTreeData.schools).length : 0;
                var cgSpells = 0;
                if (cgTreeData && cgTreeData.schools) { for (var s in cgTreeData.schools) { cgSpells += (cgTreeData.schools[s].nodes || []).length; } }
                if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeBuildComplete', {schools: cgSchools, spells: cgSpells}), 'success');
            } else {
                _handleBuildFailure(
                    result.error || 'unknown',
                    '_classicGrowthBuildPending',
                    typeof ClassicSettings !== 'undefined' ? ClassicSettings : null,
                    { command: 'build_tree_classic', config: { shape: 'organic', density: 0.6, symmetry: 0.3, max_children_per_node: 3, top_themes_per_school: 8, convergence_chance: 0.4, prefer_vanilla_roots: true } },
                    'tgClassicBuildBtn',
                    '[ClassicGrowth]'
                );
            }
            resetProceduralPlusButton();
            return;
        }

        // Route to Tree Growth mode if it triggered this build
        if (state._treeGrowthBuildPending) {
            state._treeGrowthBuildPending = false;
            if (result.success && result.treeData) {
                // Advance build progress: tree done → prereqs or finalize
                if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                    BuildProgress.setStage('prereqs');
                }
                var tgTreeData = typeof result.treeData === 'string' ? JSON.parse(result.treeData) : result.treeData;
                if (typeof TreeGrowthTree !== 'undefined' && TreeGrowthTree.loadTreeData) {
                    TreeGrowthTree.loadTreeData(tgTreeData);
                    if (typeof TreeGrowth !== 'undefined') TreeGrowth._markDirty();
                }
                // Update notification bar with build result
                var tgSchools = tgTreeData && tgTreeData.schools ? Object.keys(tgTreeData.schools).length : 0;
                var tgSpells = 0;
                if (tgTreeData && tgTreeData.schools) { for (var s in tgTreeData.schools) { tgSpells += (tgTreeData.schools[s].nodes || []).length; } }
                if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeBuildComplete', {schools: tgSchools, spells: tgSpells}), 'success');
            } else {
                _handleBuildFailure(
                    result.error || 'unknown',
                    '_treeGrowthBuildPending',
                    typeof TreeSettings !== 'undefined' ? TreeSettings : null,
                    { command: 'build_tree', config: state._lastTreeGrowthConfig || {} },
                    'tgTreeBuildBtn',
                    '[TreeGrowthTree]'
                );
            }
            resetProceduralPlusButton();
            return;
        }

        // Route to Graph Growth mode if it triggered this build
        if (state._graphGrowthBuildPending) {
            state._graphGrowthBuildPending = false;
            if (result.success && result.treeData) {
                if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                    BuildProgress.setStage('prereqs');
                }
                var graphTreeData = typeof result.treeData === 'string' ? JSON.parse(result.treeData) : result.treeData;
                if (typeof TreeGrowthGraph !== 'undefined' && TreeGrowthGraph.loadTreeData) {
                    TreeGrowthGraph.loadTreeData(graphTreeData);
                    if (typeof TreeGrowth !== 'undefined') TreeGrowth._markDirty();
                }
                var graphSchools = graphTreeData && graphTreeData.schools ? Object.keys(graphTreeData.schools).length : 0;
                var graphSpells = 0;
                if (graphTreeData && graphTreeData.schools) { for (var gs in graphTreeData.schools) { graphSpells += (graphTreeData.schools[gs].nodes || []).length; } }
                if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeBuildComplete', {schools: graphSchools, spells: graphSpells}), 'success');
            } else {
                _handleBuildFailure(
                    result.error || 'unknown',
                    '_graphGrowthBuildPending',
                    typeof GraphSettings !== 'undefined' ? GraphSettings : null,
                    { command: 'build_tree_graph', config: {} },
                    'tgGraphBuildBtn',
                    '[GraphGrowth]'
                );
            }
            resetProceduralPlusButton();
            return;
        }

        // Route to Oracle Growth mode if it triggered this build
        if (state._oracleGrowthBuildPending) {
            state._oracleGrowthBuildPending = false;
            if (result.success && result.treeData) {
                if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                    BuildProgress.setStage('prereqs');
                }
                var oracleTreeData = typeof result.treeData === 'string' ? JSON.parse(result.treeData) : result.treeData;
                if (typeof TreeGrowthOracle !== 'undefined' && TreeGrowthOracle.loadTreeData) {
                    TreeGrowthOracle.loadTreeData(oracleTreeData);
                    if (typeof TreeGrowth !== 'undefined') TreeGrowth._markDirty();
                }
                var oracleSchools = oracleTreeData && oracleTreeData.schools ? Object.keys(oracleTreeData.schools).length : 0;
                var oracleSpells = 0;
                if (oracleTreeData && oracleTreeData.schools) { for (var os in oracleTreeData.schools) { oracleSpells += (oracleTreeData.schools[os].nodes || []).length; } }
                if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeBuildComplete', {schools: oracleSchools, spells: oracleSpells}), 'success');
            } else {
                _handleBuildFailure(
                    result.error || 'unknown',
                    '_oracleGrowthBuildPending',
                    typeof OracleSettings !== 'undefined' ? OracleSettings : null,
                    { command: 'build_tree_oracle', config: {} },
                    'tgOracleBuildBtn',
                    '[OracleGrowth]'
                );
            }
            resetProceduralPlusButton();
            return;
        }

        // Route to Thematic Growth mode if it triggered this build
        if (state._thematicGrowthBuildPending) {
            state._thematicGrowthBuildPending = false;
            if (result.success && result.treeData) {
                if (typeof BuildProgress !== 'undefined' && BuildProgress.isActive()) {
                    BuildProgress.setStage('prereqs');
                }
                var thematicTreeData = typeof result.treeData === 'string' ? JSON.parse(result.treeData) : result.treeData;
                if (typeof TreeGrowthThematic !== 'undefined' && TreeGrowthThematic.loadTreeData) {
                    TreeGrowthThematic.loadTreeData(thematicTreeData);
                    if (typeof TreeGrowth !== 'undefined') TreeGrowth._markDirty();
                }
                var thematicSchools = thematicTreeData && thematicTreeData.schools ? Object.keys(thematicTreeData.schools).length : 0;
                var thematicSpells = 0;
                if (thematicTreeData && thematicTreeData.schools) { for (var ts in thematicTreeData.schools) { thematicSpells += (thematicTreeData.schools[ts].nodes || []).length; } }
                if (typeof updateScanStatus === 'function') updateScanStatus(t('status.treeBuildComplete', {schools: thematicSchools, spells: thematicSpells}), 'success');
            } else {
                _handleBuildFailure(
                    result.error || 'unknown',
                    '_thematicGrowthBuildPending',
                    typeof ThematicSettings !== 'undefined' ? ThematicSettings : null,
                    { command: 'build_tree_thematic', config: {} },
                    'tgThematicBuildBtn',
                    '[ThematicGrowth]'
                );
            }
            resetProceduralPlusButton();
            return;
        }

        // Check if visual-first mode was waiting for LLM configs + fuzzy data
        if (state.visualFirstConfigPending && result.success) {
            state.visualFirstConfigPending = false;
            console.log('[VisualFirst] Received Python response, extracting configs + fuzzy data...');
            
            var treeData = typeof result.treeData === 'string' ? JSON.parse(result.treeData) : result.treeData;
            var schoolConfigs = treeData.school_configs || {};
            
            // Extract fuzzy relationship data from Python response
            var fuzzyData = {
                relationships: treeData.fuzzy_relationships || {},  // spell -> [related spells]
                similarity_scores: treeData.similarity_scores || {},  // spell pairs -> similarity
                groups: treeData.fuzzy_groups || {},  // group_name -> [spells]
                themes: treeData.spell_themes || {}  // spell -> detected themes
            };
            
            console.log('[VisualFirst] School configs:', Object.keys(schoolConfigs));
            console.log('[VisualFirst] Fuzzy data keys:', Object.keys(fuzzyData.relationships).length, 'spells with relationships');
            console.log('[VisualFirst] Fuzzy themes:', Object.keys(fuzzyData.themes).length, 'spells with themes');
            if (Object.keys(fuzzyData.themes).length > 0) {
                var sampleKeys = Object.keys(fuzzyData.themes).slice(0, 3);
                console.log('[VisualFirst] Sample themes:', sampleKeys.map(function(k) { return k + ': ' + fuzzyData.themes[k]; }));
            }

            // Use configs + fuzzy data with visual-first builder (ignore Python's tree structure)
            doVisualFirstGenerate(schoolConfigs, fuzzyData);
            resetProceduralPlusButton();
            return;
        }
        
        if (result.success && result.treeData) {
            var treeData = typeof result.treeData === 'string' ? JSON.parse(result.treeData) : result.treeData;
            
            if (typeof loadTreeData === 'function') {
                loadTreeData(treeData);
            } else {
                var parseResult = TreeParser.parse(treeData);
                if (parseResult.success) {
                    state.treeData = parseResult;
                    state.treeData.rawData = treeData;
                }
            }
            
            var schoolCount = Object.keys(treeData.schools || {}).length;
            var nodeCount = 0;
            for (var school in treeData.schools) {
                nodeCount += treeData.schools[school].nodes.length;
            }
            
            // Extract and apply per-school configs to UI controls
            if (treeData.school_configs) {
                console.log('[Procedural] Applying school configs to UI:', Object.keys(treeData.school_configs));
                applySchoolConfigsToUI(treeData.school_configs);
            }
            
            var llmConfigCount = 0;
            for (var sc in treeData.school_configs || {}) {
                if (treeData.school_configs[sc].source === 'llm') llmConfigCount++;
            }
            
            var statusMsg = 'Python: ' + schoolCount + ' schools, ' + nodeCount + ' spells';
            if (llmConfigCount > 0) {
                statusMsg += ' (LLM configured ' + llmConfigCount + ' schools)';
            }
            statusMsg += ' (' + (result.elapsed || '?') + 's)';
            
            updateStatus(statusMsg);
            setStatusIcon('OK');
            
            if (window.callCpp) window.callCpp('SaveSpellTree', JSON.stringify(treeData));
            
            setTimeout(function() {
                switchTab('spellTree');
            }, 300);

        } else {
            // Check if visual-first was pending - fall back to defaults
            if (state.visualFirstConfigPending) {
                state.visualFirstConfigPending = false;
                console.warn('[VisualFirst] Python failed, using default configs (no fuzzy data)');
                doVisualFirstGenerate({}, null);
                return;
            }
            updateStatus('Python failed: ' + (result.error || 'Unknown error'));
            setStatusIcon('X');
        }
    } catch (e) {
        console.error('[Procedural] Error parsing Python result:', e);
        // Check if visual-first was pending - fall back to defaults
        if (state.visualFirstConfigPending) {
            state.visualFirstConfigPending = false;
            console.warn('[VisualFirst] Python error, using default configs (no fuzzy data)');
            doVisualFirstGenerate({}, null);
            return;
        }
        updateStatus('Python result parse error');
        setStatusIcon('X');
    }
    
    resetProceduralPlusButton();
};

/**
 * Apply school configs from Python to the per-school UI controls
 */
function applySchoolConfigsToUI(schoolConfigs) {
    for (var schoolName in schoolConfigs) {
        var cfg = schoolConfigs[schoolName];
        var safeId = schoolName.replace(/\s+/g, '-');
        
        // Update shape dropdown
        var shapeSelect = document.getElementById('school-shape-' + safeId);
        if (shapeSelect && cfg.shape) {
            shapeSelect.value = cfg.shape;
        }
        
        // Update density slider
        var densitySlider = document.getElementById('school-density-' + safeId);
        var densityVal = document.getElementById('school-density-val-' + safeId);
        if (densitySlider && cfg.density !== undefined) {
            densitySlider.value = Math.round(cfg.density * 100);
            if (densityVal) densityVal.textContent = cfg.density.toFixed(1);
        }
        
        // Update symmetry slider
        var symmetrySlider = document.getElementById('school-symmetry-' + safeId);
        var symmetryVal = document.getElementById('school-symmetry-val-' + safeId);
        if (symmetrySlider && cfg.symmetry !== undefined) {
            symmetrySlider.value = Math.round(cfg.symmetry * 100);
            if (symmetryVal) symmetryVal.textContent = cfg.symmetry.toFixed(1);
        }
        
        
        // Update convergence slider
        var convergenceSlider = document.getElementById('school-convergence-' + safeId);
        var convergenceVal = document.getElementById('school-convergence-val-' + safeId);
        if (convergenceSlider && cfg.convergence_chance !== undefined) {
            convergenceSlider.value = Math.round(cfg.convergence_chance * 100);
            if (convergenceVal) convergenceVal.textContent = Math.round(cfg.convergence_chance * 100) + '%';
        }
        
        // Update min straight slider
        var minStraightSlider = document.getElementById('school-min-straight-' + safeId);
        var minStraightVal = document.getElementById('school-min-straight-val-' + safeId);
        if (minStraightSlider && cfg.min_straight !== undefined) {
            minStraightSlider.value = cfg.min_straight;
            if (minStraightVal) minStraightVal.textContent = cfg.min_straight;
        }
        
        // Update max straight slider
        var maxStraightSlider = document.getElementById('school-max-straight-' + safeId);
        var maxStraightVal = document.getElementById('school-max-straight-val-' + safeId);
        if (maxStraightSlider && cfg.max_straight !== undefined) {
            maxStraightSlider.value = cfg.max_straight;
            if (maxStraightVal) maxStraightVal.textContent = cfg.max_straight;
        }
        
        // Log if LLM configured this school
        if (cfg.source === 'llm') {
            console.log('[Procedural] LLM config applied to ' + schoolName + ':', cfg);
        }
    }
}

// =============================================================================
// VISUAL-FIRST GENERATION
// =============================================================================

/**
 * Generate all trees using the visual-first layout system.
 * This calls Python for LLM school configs, then uses visual-first layout in JS.
 */
function startVisualFirstGenerate() {
    console.log('[VisualFirst] Button clicked');
    
    // Disable button while generating
    var btn = document.getElementById('tgBuildBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">...</span> Generating...';
    }
    
    if (!state.lastSpellData || !state.lastSpellData.spells) {
        updateStatus('Scanning spells first...');
        setStatusIcon('...');
        // Set flag to run visual-first after scan completes
        state.visualFirstPending = true;
        if (typeof startScan === 'function') {
            startScan(false);
        }
        return;
    }
    
    // Call Python for LLM school configs
    startVisualFirstPythonConfig();
}

// Default prompt in case the UI element doesn't exist
var FALLBACK_AUTO_CONFIG_PROMPT = 
    'Configure visual spell trees for ALL schools at once.\n\n' +
    '## SCHOOLS:\n{{ALL_SCHOOLS_DATA}}\n\n' +
    '## OPTIONS:\n' +
    '- shape: organic|radial|spiky|mountain|cloud|flame|tree|cascade|galaxy\n' +
    '- growth_behavior: fire_explosion|gentle_bloom|mountain_builder|portal_network|spider_web|ocean_wave|ancient_tree|crystal_growth|vine_crawl|nebula_burst\n' +
    '- branching_mode: fuzzy_groups|proximity\n' +
    '- slice_weight: 0.5-2.0\n' +
    '- density: 0.3-0.9\n' +
    '- branch_chance: 0.1-0.5 (base fork probability)\n' +
    '- branch_energy_gain: 0.05-0.25 (pressure buildup per non-branch)\n' +
    '- branch_energy_threshold: 1.0-3.0 (force branch at this energy)\n' +
    '- branch_subdivide_pool: true|false (fuzzy check each sub-branch)\n' +
    '- alt_path_min_distance: 2-8 (min edges for shortcut)\n' +
    '- alt_path_max_distance: 2-8 (max spatial distance in nodes)\n' +
    '- alt_path_probability: 0.1-0.7 (shortcut chance)\n' +
    '- alt_path_max_per_node: 1-4 (max shortcuts per node)\n\n' +
    'Return JSON with ALL schools:\n' +
    '{"SchoolName": {"shape": "...", "growth_behavior": "...", "branching_mode": "fuzzy_groups", "slice_weight": 1.0, "density": 0.6, "branch_chance": 0.25, "branch_energy_gain": 0.12, "branch_energy_threshold": 1.8, "branch_subdivide_pool": true, "alt_path_min_distance": 4, "alt_path_max_distance": 4, "alt_path_probability": 0.3, "alt_path_max_per_node": 2, "reasoning": "..."}, ...}';

/**
 * Build a summary of all schools with spell counts and sample spells.
 * Used to populate the {{ALL_SCHOOLS_DATA}} placeholder in the LLM prompt.
 */
function buildAllSchoolsSummary(spells) {
    var schoolData = {};
    
    // Group spells by school
    spells.forEach(function(spell) {
        var school = spell.school || 'Unknown';
        if (!school || school === 'null' || school === 'None') school = 'Hedge Wizard';
        
        if (!schoolData[school]) {
            schoolData[school] = {
                count: 0,
                spells: [],
                themes: {}
            };
        }
        
        schoolData[school].count++;
        schoolData[school].spells.push(spell);
        
        // Extract simple themes from spell name for fuzzy context
        var name = (spell.name || '').toLowerCase();
        var themeWords = ['fire', 'frost', 'ice', 'shock', 'lightning', 'flame', 'burn', 
                         'heal', 'restore', 'ward', 'cure', 'protect', 'bless',
                         'summon', 'conjure', 'bound', 'soul', 'reanimate', 'call',
                         'calm', 'fear', 'frenzy', 'invisible', 'muffle', 'illusion',
                         'flesh', 'armor', 'detect', 'transmute', 'paralyze', 'light',
                         'undead', 'daedra', 'atronach', 'familiar', 'zombie'];
        
        themeWords.forEach(function(theme) {
            if (name.indexOf(theme) >= 0) {
                schoolData[school].themes[theme] = (schoolData[school].themes[theme] || 0) + 1;
            }
        });
    });
    
    // Build summary text
    var summaryLines = [];
    var schools = Object.keys(schoolData).sort();
    
    schools.forEach(function(school) {
        var data = schoolData[school];
        
        // Get top themes
        var themeList = Object.keys(data.themes)
            .map(function(t) { return { theme: t, count: data.themes[t] }; })
            .sort(function(a, b) { return b.count - a.count; })
            .slice(0, 5)
            .map(function(t) { return t.theme + '(' + t.count + ')'; });
        
        // Get sample spell names
        var sampleSpells = data.spells.slice(0, 8).map(function(s) { return s.name || 'Unknown'; });
        
        summaryLines.push('### ' + school + ' (' + data.count + ' spells)');
        if (themeList.length > 0) {
            summaryLines.push('Common themes: ' + themeList.join(', '));
        }
        summaryLines.push('Sample spells: ' + sampleSpells.join(', '));
        summaryLines.push('');
    });
    
    return {
        text: summaryLines.join('\n'),
        schools: schools,
        data: schoolData
    };
}

/**
 * Call Python to get LLM school configurations AND run fuzzy NLP analysis.
 * Python will:
 * 1. Call LLM for ALL schools at once (full context)
 * 2. Run TF-IDF/fuzzy matching to find spell relationships
 * 3. Return both configs and relationship data for visual-first layout
 */
function startVisualFirstPythonConfig() {
    updateStatus('Running Python fuzzy analysis + LLM configs...');
    setStatusIcon('...');
    
    // Get LLM options from Visual-First specific checkbox (or fallback to shared one)
    var visualFirstLLMCheck = document.getElementById('visualFirstLLMCheck');
    var llmAutoConfigCheck = visualFirstLLMCheck || document.getElementById('llmAutoConfigCheck');
    var llmGroupsCheck = document.getElementById('llmGroupsCheck');
    
    // Build all-schools summary for LLM context
    var schoolsSummary = buildAllSchoolsSummary(state.lastSpellData.spells);
    console.log('[VisualFirst] Schools found:', schoolsSummary.schools.join(', '));
    
    // Get prompt template - use fallback if UI not available
    var autoConfigPrompt = '';
    if (typeof getAutoConfigPrompt === 'function') {
        autoConfigPrompt = getAutoConfigPrompt();
    }
    if (!autoConfigPrompt || autoConfigPrompt.length < 50) {
        console.warn('[VisualFirst] Auto-config prompt empty or too short, using fallback');
        autoConfigPrompt = FALLBACK_AUTO_CONFIG_PROMPT;
    }
    
    // Replace {{ALL_SCHOOLS_DATA}} placeholder with actual data
    autoConfigPrompt = autoConfigPrompt.replace('{{ALL_SCHOOLS_DATA}}', schoolsSummary.text);
    
    console.log('[VisualFirst] Auto-config prompt length:', autoConfigPrompt.length);
    console.log('[VisualFirst] Prompt includes', schoolsSummary.schools.length, 'schools context');
    
    // Build config for Python - enable fuzzy analysis AND LLM config
    var config = {
        shape: 'organic',
        density: 0.6,
        seed: typeof getCurrentSeed === 'function' ? getCurrentSeed() : Date.now(),
        
        // ALWAYS run fuzzy NLP for visual-first (this determines spell relationships)
        run_fuzzy_analysis: true,
        
        // LLM auto-configuration for school shapes (uses checkbox setting)
        llm_auto_configure: {
            enabled: llmAutoConfigCheck ? llmAutoConfigCheck.checked : true,  // Default ON for visual-first
            prompt_template: autoConfigPrompt,
            // Process ALL schools in ONE LLM call for full context
            all_schools_at_once: true,
            schools_list: schoolsSummary.schools
        },
        
        // LLM groups for themed clustering (uses checkbox setting)
        llm_groups: {
            enabled: llmGroupsCheck ? llmGroupsCheck.checked : false,
            prompt_template: typeof getGroupPrompt === 'function' ? getGroupPrompt() : ''
        },

        // LLM keyword classification
        llm_keyword_classification: {
            enabled: (settings.treeGeneration && settings.treeGeneration.llm &&
                      settings.treeGeneration.llm.enabled &&
                      settings.treeGeneration.llm.keywordClassification) || false,
            batch_size: 100,
            min_confidence: 40
        },

        // Flag to tell Python we want visual-first output format
        visual_first_mode: true,
        
        // Include fuzzy relationship data in response
        return_fuzzy_data: true,
        
        // Pass school summary for LLM context
        schools_summary: schoolsSummary.text
    };
    
    // Pass API credentials to Python for LLM calls
    console.log('[VisualFirst] === LLM Configuration ===');
    console.log('[VisualFirst] Visual-First LLM checkbox:', visualFirstLLMCheck ? visualFirstLLMCheck.checked : 'N/A (using fallback)');
    console.log('[VisualFirst] Effective LLM enabled:', llmAutoConfigCheck ? llmAutoConfigCheck.checked : false);
    console.log('[VisualFirst] state.llmConfig exists:', !!state.llmConfig);
    console.log('[VisualFirst] API key length:', state.llmConfig && state.llmConfig.apiKey ? state.llmConfig.apiKey.length : 0);
    
    var llmWasRequested = llmAutoConfigCheck ? llmAutoConfigCheck.checked : false;
    var hasValidApiKey = state.llmConfig && state.llmConfig.apiKey && state.llmConfig.apiKey.length > 10;
    
    if (hasValidApiKey) {
        config.llm_api = {
            api_key: state.llmConfig.apiKey,
            model: state.llmConfig.model || 'openai/gpt-4o-mini',
            endpoint: 'https://openrouter.ai/api/v1/chat/completions'
        };
        console.log('[VisualFirst] LLM API configured, model:', config.llm_api.model);
    } else {
        // No API key - disable LLM in config regardless of checkbox
        if (llmWasRequested) {
            console.warn('[VisualFirst] LLM auto-config requested but no API key! Using defaults instead.');
            updateStatus('No API key - using default settings');
            // Override the config to disable LLM
            config.llm_auto_configure.enabled = false;
        }
        console.log('[VisualFirst] Running without LLM (default settings)');
    }

    // Add tree generation settings from UI (Tier 4 wiring)
    if (settings.treeGeneration) {
        var tg = settings.treeGeneration;
        config.tree_generation = {
            // Theme Discovery
            theme_discovery_mode: tg.themeDiscoveryMode || 'dynamic',
            enable_smart_routing: tg.enableSmartRouting !== false,
            auto_branch_fallback: tg.autoBranchFallback !== false,

            // Element Rules
            element_isolation: tg.elementIsolation !== false,
            element_isolation_strict: tg.elementIsolationStrict || false,

            // Tier Rules
            strict_tier_ordering: tg.strictTierOrdering !== false,
            allow_same_tier_links: tg.allowSameTierLinks !== false,
            tier_mixing: tg.tierMixing || false,
            tier_mixing_amount: tg.tierMixingAmount || 20,

            // Link Strategy
            link_strategy: tg.linkStrategy || 'thematic',
            max_children_per_node: tg.maxChildrenPerNode || 3,

            // Convergence
            convergence_enabled: tg.convergenceEnabled !== false,
            convergence_chance: tg.convergenceChance || 40,
            convergence_min_tier: tg.convergenceMinTier || 3,

            // Scoring Factors
            scoring: tg.scoring || {
                elementMatching: true,
                spellTypeMatching: true,
                tierProgression: true,
                keywordMatching: true,
                themeCoherence: true,
                effectNameMatching: true,
                descriptionSimilarity: true,
                magickaCostProximity: false,
                sameModSource: false
            },

            // LLM Edge Cases
            llm_edge_case_enabled: tg.llmEdgeCaseEnabled || false,
            llm_edge_case_threshold: tg.llmEdgeCaseThreshold || 10
        };
        console.log('[VisualFirst] Tree generation settings applied:', config.tree_generation.link_strategy);
    }

    var request = {
        spells: filterWhitelistedSpells(filterBlacklistedSpells(state.lastSpellData.spells)),
        config: config
    };
    
    // Set flag so callback knows to use visual-first
    state.visualFirstConfigPending = true;
    
    if (window.callCpp) {
        console.log('[VisualFirst] Calling Python for fuzzy analysis + LLM configs...');
        console.log('[VisualFirst] Spells:', state.lastSpellData.spells.length);
        console.log('[VisualFirst] LLM Auto-Config:', config.llm_auto_configure.enabled);
        console.log('[VisualFirst] LLM Groups:', config.llm_groups.enabled);
        window.callCpp('ProceduralPythonGenerate', JSON.stringify(request));
    } else {
        console.warn('[VisualFirst] C++ bridge not available, using JS fallback');
        doVisualFirstGenerate({}, null);
    }
}

function resetVisualFirstButton() {
    var btn = document.getElementById('tgBuildBtn');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">[B]</span> Build Tree';
    }
}

/**
 * Called after Python returns LLM configs (or directly with defaults).
 * Uses visual-first layout system with the provided school configs.
 * 
 * Priority for config: LLM > UI Controls > Defaults
 */
function doVisualFirstGenerate(schoolConfigs, fuzzyData) {
    updateStatus('Generating visual-first layout...');
    setStatusIcon('...');
    
    console.log('');
    console.log('='.repeat(60));
    console.log('[VisualFirst] === STARTING VISUAL-FIRST GENERATION ===');
    console.log('='.repeat(60));
    
    // Log received configs
    console.log('[VisualFirst] Received school configs from Python:');
    if (schoolConfigs && Object.keys(schoolConfigs).length > 0) {
        for (var sc in schoolConfigs) {
            var cfg = schoolConfigs[sc];
            console.log('  ' + sc + ': shape=' + cfg.shape + ', density=' + cfg.density + 
                        ', source=' + (cfg.source || '?'));
        }
    } else {
        console.log('  [EMPTY or NULL - will use UI/defaults]');
    }
    
    // Store fuzzy data for edge building
    var fuzzy = fuzzyData || {
        relationships: {},
        similarity_scores: {},
        groups: {},
        themes: {}
    };
    
    console.log('[VisualFirst] Fuzzy data:', Object.keys(fuzzy.relationships || {}).length, 'spell relationships');
    
    setTimeout(function() {
        try {
            var spellsBySchool = {};
            
            // Group spells by school (filter blacklisted and whitelisted)
            filterWhitelistedSpells(filterBlacklistedSpells(state.lastSpellData.spells)).forEach(function(spell) {
                var school = spell.school || 'Unknown';
                if (!school || school === 'null' || school === 'None' || school === '') {
                    school = 'Hedge Wizard';
                }
                if (!spellsBySchool[school]) spellsBySchool[school] = [];
                spellsBySchool[school].push(spell);
            });
            
            // Build configs: LLM > UI Controls > Defaults
            console.log('[VisualFirst] Building final configs for', Object.keys(spellsBySchool).length, 'schools');
            
            var finalConfigs = {};
            for (var schoolName in spellsBySchool) {
                var config = null;
                var source = 'default';
                
                console.log('[VisualFirst] --- Processing', schoolName, '(' + spellsBySchool[schoolName].length + ' spells) ---');
                
                // 1. Try LLM config first
                if (schoolConfigs && schoolConfigs[schoolName]) {
                    config = schoolConfigs[schoolName];
                    source = config.source || 'llm';
                    console.log('[VisualFirst]   LLM config found: shape=' + config.shape);
                } else {
                    console.log('[VisualFirst]   No LLM config for', schoolName);
                }
                
                // 2. Try UI controls (always read to get latest values)
                if (typeof getSchoolConfig === 'function') {
                    var uiConfig = getSchoolConfig(schoolName);
                    if (uiConfig) {
                        console.log('[VisualFirst]   UI config: shape=' + uiConfig.shape + ', density=' + uiConfig.density);
                        // If no LLM config, use UI config entirely
                        if (!config) {
                            config = uiConfig;
                            source = 'ui';
                        }
                        // If LLM config exists but UI has specific shape selected, prefer UI shape
                        else if (uiConfig.shape && uiConfig.shape !== 'organic') {
                            config.shape = uiConfig.shape;
                            console.log('[VisualFirst]   UI shape override:', uiConfig.shape);
                        }
                    } else {
                        console.log('[VisualFirst]   No UI config for', schoolName);
                    }
                } else {
                    console.log('[VisualFirst]   getSchoolConfig function not available');
                }
                
                // 3. Fall back to defaults
                if (!config) {
                    config = {
                        shape: 'organic',
                        density: 0.6,
                        convergence_chance: 0.4,
                        slice_weight: 1.0,
                        jitter: 30
                    };
                    console.log('[VisualFirst] Using defaults for', schoolName);
                }
                
                // Read global branching mode from Visual-First dropdown
                var globalBranchingMode = document.getElementById('visualFirstBranchingMode');
                var branchingMode = globalBranchingMode ? globalBranchingMode.value : 'fuzzy_groups';
                
                // Ensure all required fields exist
                config.shape = config.shape || 'organic';
                config.density = config.density || 0.6;
                config.convergence_chance = config.convergence_chance || config.convergence || 0.4;
                config.slice_weight = config.slice_weight || 1.0;
                config.jitter = config.jitter || 30;
                config.source = source;
                
                // Apply branching mode (global from UI > LLM > per-school UI)
                config.branching_mode = config.branching_mode || branchingMode;
                
                console.log('[VisualFirst]   Branching mode:', config.branching_mode);
                
                finalConfigs[schoolName] = config;
            }
            
            console.log('[VisualFirst] Final configs:', finalConfigs);
            console.log('[VisualFirst] Spell counts:', Object.keys(spellsBySchool).map(function(s) { return s + ': ' + spellsBySchool[s].length; }));
            
            // Apply configs to UI for display
            if (typeof applySchoolConfigsToUI === 'function') {
                applySchoolConfigsToUI(finalConfigs);
            }
            
            // USE NEW SETTINGS-AWARE BUILDER (unified scoring, guaranteed element isolation)
            if (typeof buildAllTreesSettingsAware === 'function') {
                console.log('[ComplexBuild] ====== USING NEW SettingsAwareBuilder ======');
                console.log('[ComplexBuild] settings.treeGeneration exists:', !!settings.treeGeneration);
                if (settings.treeGeneration) {
                    console.log('[ComplexBuild] SETTINGS BEING PASSED:');
                    console.log('[ComplexBuild]   rootCount:', settings.treeGeneration.rootCount);
                    console.log('[ComplexBuild]   elementIsolation:', settings.treeGeneration.elementIsolation);
                    console.log('[ComplexBuild]   elementIsolationStrict:', settings.treeGeneration.elementIsolationStrict);
                    console.log('[ComplexBuild]   strictTierOrdering:', settings.treeGeneration.strictTierOrdering);
                    console.log('[ComplexBuild]   linkStrategy:', settings.treeGeneration.linkStrategy);
                    console.log('[ComplexBuild]   maxChildrenPerNode:', settings.treeGeneration.maxChildrenPerNode);
                }

                // Filter spells
                var filteredSpells = filterWhitelistedSpells(filterBlacklistedSpells(state.lastSpellData.spells));

                // Build tree using new unified builder - PASS PYTHON FUZZY DATA!
                // fuzzy contains: themes, groups, relationships, similarity_scores from Python TF-IDF
                console.log('[ComplexBuild] Passing fuzzy data to builder:', Object.keys(fuzzy));
                if (fuzzy.themes) {
                    console.log('[ComplexBuild]   Python discovered themes:', Object.keys(fuzzy.themes));
                }
                if (fuzzy.groups) {
                    console.log('[ComplexBuild]   Python spell groups:', Object.keys(fuzzy.groups).length);
                }
                var treeData = buildAllTreesSettingsAware(filteredSpells, finalConfigs, settings.treeGeneration, fuzzy);

                // Log build results
                console.log('[ComplexBuild] Build complete - generator:', treeData.generator);
                console.log('[ComplexBuild] Settings used:', JSON.stringify(treeData.settings));

                // DIAGNOSTIC: Check tree data before loadTreeData
                console.log('[ComplexBuild] === Tree structure ===');
                for (var scName in treeData.schools) {
                    var school = treeData.schools[scName];
                    var nodeCount = school.nodes ? school.nodes.length : 0;
                    var linkCount = school.links ? school.links.length : 0;
                    console.log('[ComplexBuild] ' + scName + ': ' + nodeCount + ' nodes, ' + linkCount + ' links');
                }

                // Load into UI (WheelRenderer will calculate positions via layoutRadial)
                if (typeof loadTreeData === 'function') {
                    loadTreeData(treeData);
                } else {
                    var result = TreeParser.parse(treeData);
                    if (result.success) {
                        state.treeData = result;
                        state.treeData.rawData = treeData;
                    }
                }

                var schoolCount = Object.keys(treeData.schools).length;
                var totalNodes = 0;
                for (var school in treeData.schools) {
                    totalNodes += treeData.schools[school].nodes.length;
                }

                var llmCount = 0;
                for (var sc in finalConfigs) {
                    if (finalConfigs[sc].source === 'llm') llmCount++;
                }

                var statusMsg = 'Settings-Aware Build: ' + schoolCount + ' schools, ' + totalNodes + ' spells';
                if (llmCount > 0) {
                    statusMsg += ' (LLM configs: ' + llmCount + ')';
                }
                updateStatus(statusMsg);
                setStatusIcon('OK');

                if (window.callCpp) window.callCpp('SaveSpellTree', JSON.stringify(treeData));

                setTimeout(function() {
                    switchTab('spellTree');
                }, 300);
            } else {
                console.error('[ComplexBuild] buildAllTreesSettingsAware not available! Check if settingsAwareTreeBuilder.js is loaded.');
                updateStatus('Settings-aware builder not loaded');
                setStatusIcon('X');
            }
            
        } catch (e) {
            console.error('[VisualFirst] Error:', e);
            updateStatus('Visual-first failed: ' + e.message);
            setStatusIcon('X');
        }
        resetVisualFirstButton();
    }, 50);
}

// Export functions
window.buildProceduralTrees = buildProceduralTrees;
window.startProceduralGenerate = startProceduralGenerate;
window.startVisualFirstGenerate = startVisualFirstGenerate;
window.startVisualFirstPythonConfig = startVisualFirstPythonConfig;
window.doVisualFirstGenerate = doVisualFirstGenerate;
window.resetVisualFirstButton = resetVisualFirstButton;
window.onProceduralClick = onProceduralClick;
window.resetProceduralButton = resetProceduralButton;
window.startProceduralPythonGenerate = startProceduralPythonGenerate;
window.onProceduralPlusClick = onProceduralPlusClick;
window.resetProceduralPlusButton = resetProceduralPlusButton;
window.applySchoolConfigsToUI = applySchoolConfigsToUI;

// Export helper functions for per-school generation
window.discoverThemes = discoverThemes;
window.buildProceduralSchoolTree = buildProceduralSchoolTree;
