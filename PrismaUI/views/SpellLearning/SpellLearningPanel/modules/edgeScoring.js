/**
 * Edge Scoring Module - Unified scoring for spell connections
 *
 * This is THE SINGLE SOURCE OF TRUTH for all edge/connection scoring.
 * Both settingsAwareTreeBuilder and visualFirstBuilder should use these functions.
 *
 * Depends on: config.js (GRID_CONFIG)
 *
 * Exports (global):
 * - EdgeScoring.scoreEdge(fromSpell, toSpell, settings)
 * - EdgeScoring.detectSpellElement(spell)
 * - EdgeScoring.hasElementConflict(spell1, spell2)
 * - EdgeScoring.hasSameElement(spell1, spell2)
 * - EdgeScoring.getSpellTier(spell)
 */

// =============================================================================
// ELEMENT KEYWORDS (Unified source)
// =============================================================================

var ELEMENT_KEYWORDS = {
    // === DESTRUCTION ELEMENTS ===
    fire: [
        'fire', 'flame', 'burn', 'inferno', 'blaze', 'fireball', 'incinerate',
        'scorch', 'heat', 'ember', 'ignite', 'magma', 'lava', 'immolate',
        'pyre', 'conflagrat', 'searing', 'blazing', 'fiery', 'combustion'
    ],
    frost: [
        'frost', 'ice', 'cold', 'freeze', 'frozen', 'blizzard', 'frostbite',
        'chill', 'glacial', 'snow', 'icicle', 'icy', 'arctic', 'winter',
        'frigid', 'freezing', 'permafrost', 'hypotherm'
    ],
    shock: [
        'shock', 'lightning', 'thunder', 'spark', 'electric', 'storm', 'bolt',
        'discharge', 'chain lightning', 'electrocute', 'voltaic', 'static',
        'thunderbolt', 'arc', 'current', 'voltage'
    ],
    // Earth/Stone element
    earth: [
        'earth', 'stone', 'rock', 'boulder', 'gravel', 'terra', 'ground',
        'mineral', 'crystal', 'gem', 'ore', 'mud', 'sand', 'dust', 'pebble',
        'granite', 'marble', 'slate', 'bedrock', 'seismic', 'quake'
    ],
    // Water element
    water: [
        'water', 'aqua', 'wave', 'tide', 'ocean', 'sea', 'river', 'stream',
        'rain', 'flood', 'drown', 'splash', 'torrent', 'hydro'
    ],
    // Wind/Air element
    wind: [
        'wind', 'air', 'gust', 'breeze', 'gale', 'cyclone', 'tornado',
        'whirlwind', 'tempest', 'zephyr', 'draft', 'aero', 'vacuum', 'vortex'
    ],
    // Shadow/Darkness
    shadow: [
        'shadow', 'dark', 'darkness', 'void', 'abyss', 'umbra', 'shade',
        'night', 'midnight', 'eclipse', 'gloom', 'murk', 'tenebrous'
    ],
    // Blood magic
    blood: [
        'blood', 'crimson', 'sanguine', 'hemorrhage', 'bleed', 'vein',
        'hemomancy', 'vital', 'gore', 'scarlet'
    ],
    // Arcane/Magic
    arcane: [
        'arcane', 'mana', 'aether', 'ether', 'mystic', 'mystical',
        'eldritch', 'ethereal', 'astral', 'cosmic', 'ley'
    ],
    // === RESTORATION ELEMENTS ===
    holy: [
        'sun', 'solar', 'holy', 'divine', 'sacred', 'blessed', 'radiant',
        'luminous', 'celestial', 'angelic', 'purify', 'smite', 'sanctify'
    ],
    poison: [
        'poison', 'venom', 'toxic', 'toxin', 'noxious', 'blight', 'pestilence',
        'plague', 'disease', 'corrupt', 'rot', 'decay', 'miasma', 'acid'
    ],
    healing: [
        'heal', 'healing', 'restoration', 'restore', 'cure', 'mend', 'remedy',
        'recovery', 'rejuvenate', 'regenerate', 'revitalize', 'salve', 'balm'
    ],
    ward: [
        'ward', 'shield', 'protect', 'barrier', 'aegis', 'bulwark', 'guard',
        'defense', 'deflect', 'repel', 'resist', 'fortify'
    ],
    // === CONJURATION ELEMENTS ===
    undead: [
        'undead', 'zombie', 'skeleton', 'corpse', 'reanimate', 'necro', 'dead',
        'thrall', 'revenant', 'ghoul', 'wraith', 'lich', 'bone', 'skull', 'grave'
    ],
    daedra: [
        'daedra', 'dremora', 'demon', 'fiend', 'infernal', 'hellfire', 'oblivion',
        'mehrunes', 'dagon', 'molag', 'sheogorath', 'azura'
    ],
    atronach: [
        'atronach', 'elemental', 'golem', 'construct', 'automaton'
    ],
    summon: [
        'summon', 'conjure', 'call', 'invoke', 'familiar', 'spirit', 'phantom',
        'spectral', 'ghost', 'apparition', 'minion', 'servant', 'bound'
    ],
    // === ILLUSION ELEMENTS ===
    fear: [
        'fear', 'terror', 'rout', 'scare', 'frighten', 'horrify', 'nightmare',
        'dread', 'panic', 'hysteria'
    ],
    calm: [
        'calm', 'pacify', 'harmony', 'peace', 'soothe', 'tranquil', 'serenity'
    ],
    frenzy: [
        'frenzy', 'fury', 'rage', 'madness', 'berserk', 'enrage', 'mayhem'
    ],
    stealth: [
        'invisible', 'invisibility', 'muffle', 'stealth', 'sneak', 'cloak',
        'vanish', 'conceal', 'hide', 'unseen', 'silent', 'quiet'
    ],
    // === ALTERATION ELEMENTS ===
    armor: [
        'flesh', 'oakflesh', 'stoneflesh', 'ironflesh', 'ebonyflesh', 'dragonhide',
        'armour', 'harden', 'temper'
    ],
    telekinesis: [
        'telekinesis', 'levitate', 'float', 'lift', 'push', 'pull', 'throw',
        'kinetic', 'force', 'gravity'
    ],
    transmute: [
        'transmute', 'transform', 'convert', 'alter', 'change', 'morph',
        'polymorph', 'shapeshift', 'metamorph'
    ],
    detect: [
        'detect', 'sense', 'perceive', 'reveal', 'insight', 'vision',
        'clairvoyance', 'foresight', 'awareness'
    ]
};

// Tier name to index mapping
var TIER_MAP = {
    'novice': 0,
    'apprentice': 1,
    'adept': 2,
    'expert': 3,
    'master': 4
};

// =============================================================================
// ELEMENT DETECTION
// =============================================================================

/**
 * Detect the element/theme of a spell.
 * Priority:
 *   1. TF-IDF discovered themes (via window._nlpFuzzyData)
 *   2. LLM cache
 *   3. Keyword-based detection
 *
 * @param {Object} spell - Spell object with name, effectNames, description
 * @returns {string|null} - Element/theme name or null
 */
function detectSpellElement(spell) {
    if (!spell) return null;

    // === PRIORITY 1: TF-IDF Theme Discovery ===
    // Dynamic discovery is more accurate than hardcoded keywords
    if (window._nlpFuzzyData && window._nlpFuzzyData.themes) {
        var nlpThemes = window._nlpFuzzyData.themes;
        var spellId = spell.formId || spell.editorId || spell.name;

        for (var themeName in nlpThemes) {
            var themeSpells = nlpThemes[themeName];
            if (Array.isArray(themeSpells)) {
                // Check if spell is in this theme (by formId, editorId, or name)
                for (var i = 0; i < themeSpells.length; i++) {
                    var entry = themeSpells[i];
                    if (entry === spell.formId ||
                        entry === spell.editorId ||
                        entry === spell.name ||
                        (typeof entry === 'object' && entry.formId === spell.formId)) {
                        return themeName;  // Return discovered theme
                    }
                }
            }
        }
    }

    // === PRIORITY 2: LLM Cache ===
    if (typeof getCachedElement === 'function' && spell.formId) {
        var cached = getCachedElement(spell.formId);
        if (cached !== null && cached !== undefined) {
            return cached;
        }
    }

    // === PRIORITY 3: Keyword-based detection (fallback) ===
    var keywords = ELEMENT_KEYWORDS;
    if (typeof getAllElementKeywords === 'function') {
        var llmSettings = typeof settings !== 'undefined' &&
                          settings.treeGeneration &&
                          settings.treeGeneration.llm;
        if (llmSettings && llmSettings.enabled && llmSettings.keywordExpansion) {
            keywords = getAllElementKeywords();
        }
    }

    // Build text from all spell info
    var text = [
        spell.name || '',
        (spell.effectNames || []).join(' '),
        spell.description || ''
    ].join(' ').toLowerCase();

    // Check each element's keywords
    for (var element in keywords) {
        var kwList = keywords[element];
        for (var i = 0; i < kwList.length; i++) {
            if (text.indexOf(kwList[i]) >= 0) {
                return element;
            }
        }
    }
    return null;
}

/**
 * Check if two spells have an element conflict (fire vs frost, etc.)
 * @param {Object} spell1
 * @param {Object} spell2
 * @returns {boolean}
 */
function hasElementConflict(spell1, spell2) {
    var elem1 = detectSpellElement(spell1);
    var elem2 = detectSpellElement(spell2);

    // No conflict if either has no element
    if (!elem1 || !elem2) return false;

    // Conflict if different elements
    return elem1 !== elem2;
}

/**
 * Check if two spells have the same element
 * @param {Object} spell1
 * @param {Object} spell2
 * @returns {boolean}
 */
function hasSameElement(spell1, spell2) {
    var elem1 = detectSpellElement(spell1);
    var elem2 = detectSpellElement(spell2);

    if (!elem1 || !elem2) return false;
    return elem1 === elem2;
}

// =============================================================================
// TIER UTILITIES
// =============================================================================

/**
 * Get the tier index (0-4) for a spell
 * @param {Object} spell
 * @returns {number}
 */
function getSpellTier(spell) {
    if (!spell) return 0;

    var level = spell.skillLevel || spell.tier || 0;

    // Handle string tier names
    if (typeof level === 'string') {
        var lower = level.toLowerCase();
        for (var name in TIER_MAP) {
            if (lower.indexOf(name) >= 0) return TIER_MAP[name];
        }
    }

    // Handle numeric skill levels (convert to tier)
    if (typeof level === 'number') {
        if (level < 25) return 0;   // Novice
        if (level < 50) return 1;   // Apprentice
        if (level < 75) return 2;   // Adept
        if (level < 100) return 3;  // Expert
        return 4;                    // Master
    }

    return 0;
}

/**
 * Get tier name from index
 * @param {number} tierIndex
 * @returns {string}
 */
function getTierName(tierIndex) {
    var names = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
    return names[tierIndex] || 'Unknown';
}

// =============================================================================
// CORE SCORING FUNCTION
// =============================================================================

/**
 * Score a potential edge between two spells.
 * This is THE ONLY function that decides if an edge is valid/desirable.
 *
 * @param {Object} fromSpell - Source spell (prerequisite)
 * @param {Object} toSpell - Target spell (depends on source)
 * @param {Object} settings - Tree generation settings
 * @returns {number} - Score (negative = forbidden, 0 = neutral, positive = good)
 */
function scoreEdge(fromSpell, toSpell, settings) {
    var score = 0;
    settings = settings || {};

    // =================================================================
    // ELEMENT ISOLATION - HIGHEST PRIORITY
    // =================================================================
    var elementConflict = hasElementConflict(fromSpell, toSpell);
    var sameElement = hasSameElement(fromSpell, toSpell);

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
    var fromTier = getSpellTier(fromSpell);
    var toTier = getSpellTier(toSpell);
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
        var fromText = (fromSpell.name || '').toLowerCase();
        var toText = (toSpell.name || '').toLowerCase();

        // Shared word fragments (length > 3)
        var fromWords = fromText.split(/[^a-z]+/).filter(function(w) { return w.length > 3; });
        var toWords = toText.split(/[^a-z]+/).filter(function(w) { return w.length > 3; });

        var sharedWords = 0;
        fromWords.forEach(function(w) {
            if (toWords.indexOf(w) >= 0) sharedWords++;
        });

        score += sharedWords * 30;
    }

    // =================================================================
    // SPELL TYPE MATCHING (if enabled)
    // =================================================================
    if (settings.scoring && settings.scoring.spellTypeMatching !== false) {
        // Same spell type bonus
        if (fromSpell.type && toSpell.type && fromSpell.type === toSpell.type) {
            score += 25;
        }
    }

    // =================================================================
    // EFFECT NAME MATCHING (if enabled)
    // =================================================================
    if (settings.scoring && settings.scoring.effectNameMatching !== false) {
        var fromEffects = fromSpell.effectNames || [];
        var toEffects = toSpell.effectNames || [];

        // Count shared effects
        var sharedEffects = 0;
        fromEffects.forEach(function(e) {
            if (toEffects.indexOf(e) >= 0) sharedEffects++;
        });

        score += sharedEffects * 20;
    }

    return score;
}

/**
 * Check if an edge is valid (score >= 0)
 * @param {Object} fromSpell
 * @param {Object} toSpell
 * @param {Object} settings
 * @returns {boolean}
 */
function isEdgeValid(fromSpell, toSpell, settings) {
    return scoreEdge(fromSpell, toSpell, settings) >= 0;
}

/**
 * Get best parent from candidates
 * @param {Object} childSpell - The spell needing a parent
 * @param {Array} candidates - Array of potential parent spells
 * @param {Object} settings - Tree generation settings
 * @returns {Object|null} - Best parent spell or null
 */
function getBestParent(childSpell, candidates, settings) {
    if (!candidates || candidates.length === 0) return null;

    var best = null;
    var bestScore = -Infinity;

    candidates.forEach(function(parent) {
        var score = scoreEdge(parent, childSpell, settings);
        if (score > bestScore) {
            bestScore = score;
            best = parent;
        }
    });

    // Only return if valid (score >= 0)
    return bestScore >= 0 ? best : null;
}

// =============================================================================
// EXPORTS
// =============================================================================

var EdgeScoring = {
    // Element detection
    ELEMENT_KEYWORDS: ELEMENT_KEYWORDS,
    detectSpellElement: detectSpellElement,
    hasElementConflict: hasElementConflict,
    hasSameElement: hasSameElement,

    // Tier utilities
    TIER_MAP: TIER_MAP,
    getSpellTier: getSpellTier,
    getTierName: getTierName,

    // Scoring
    scoreEdge: scoreEdge,
    isEdgeValid: isEdgeValid,
    getBestParent: getBestParent
};

// Global exports for direct access
window.EdgeScoring = EdgeScoring;
window.detectSpellElement = detectSpellElement;
window.hasElementConflict = hasElementConflict;
window.hasSameElement = hasSameElement;
window.getSpellTier = getSpellTier;
window.scoreEdge = scoreEdge;
window.isEdgeValid = isEdgeValid;
window.getBestParent = getBestParent;

console.log('[EdgeScoring] Module loaded');
