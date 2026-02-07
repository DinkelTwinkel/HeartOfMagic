/**
 * SpellLearning Configuration Module
 * 
 * Contains all configuration constants for the spell learning tree.
 * This module is loaded first and provides configuration for all other modules.
 * Depends on: state.js (for settings reference)
 */

// =============================================================================
// UNIFIED GRID CONFIGURATION - Single source of truth for all layout modules
// =============================================================================

var GRID_CONFIG = {
    nodeSize: 75,                    // Base node size in pixels
    
    // Multipliers (relative to nodeSize)
    baseRadiusMultiplier: 1.2,       // Starting radius = nodeSize * 1.2 (~90px)
    tierSpacingMultiplier: 0.7,      // Radial spacing = nodeSize * 0.7 (~52px) - 2x denser
    arcSpacingMultiplier: 0.75,      // Angular spacing = nodeSize * 0.75 (~56px) - 2x denser
    minNodeSpacingMultiplier: 0.7,   // Min node-to-node = nodeSize * 0.7 (~52px)
    
    // Computed values (call getComputedConfig() for these)
    maxTiers: 25,
    schoolPadding: 15,
    
    // Get computed pixel values
    getComputedConfig: function() {
        var ns = this.nodeSize;
        return {
            nodeSize: ns,
            baseRadius: Math.round(ns * this.baseRadiusMultiplier),
            tierSpacing: Math.round(ns * this.tierSpacingMultiplier),
            arcSpacing: Math.round(ns * this.arcSpacingMultiplier),
            minNodeSpacing: Math.round(ns * this.minNodeSpacingMultiplier),
            maxTiers: this.maxTiers,
            schoolPadding: this.schoolPadding
        };
    }
};

// =============================================================================
// TREE CONFIGURATION
// =============================================================================

var TREE_CONFIG = {
    wheel: {
        baseRadius: GRID_CONFIG.getComputedConfig().baseRadius,
        tierSpacing: GRID_CONFIG.getComputedConfig().tierSpacing,
        nodeWidth: GRID_CONFIG.nodeSize,
        nodeHeight: 28,
        minArcSpacing: GRID_CONFIG.getComputedConfig().arcSpacing,
        schoolPadding: GRID_CONFIG.schoolPadding
    },
    tierScaling: {
        enabled: true,
        baseWidth: 70,
        baseHeight: 26,
        widthIncrement: 12,
        heightIncrement: 5
    },
    zoom: {
        min: 0.1,
        max: 3,
        step: 0.2,
        wheelFactor: 0.001
    },
    animation: {
        rotateDuration: 400
    },
    schools: ['Destruction', 'Restoration', 'Alteration', 'Conjuration', 'Illusion'],
    
    // Function to get school color (uses settings)
    getSchoolColor: function(school) {
        return settings.schoolColors[school] || getOrAssignSchoolColor(school);
    },
    
    // Layout styles for spell trees
    layoutStyles: {
        radial: {
            name: 'Radial Fan',
            description: 'Nodes spread outward in a fan pattern. Best for balanced trees with many branches at each tier.',
            idealFor: 'Trees with 2-3 children per node, balanced branching'
        },
        focused: {
            name: 'Focused Beam',
            description: 'Nodes stay close to the center spoke line. Best for linear progressions with few branches.',
            idealFor: 'Linear spell chains, single-path progressions'
        },
        clustered: {
            name: 'Clustered Groups',
            description: 'Related spells cluster together in distinct groups. Best for trees with clear thematic divisions.',
            idealFor: 'Elemental branches (Fire/Frost/Shock), distinct spell families'
        },
        cascading: {
            name: 'Cascading Waterfall',
            description: 'Nodes cascade downward in staggered columns. Best for deep trees with consistent width.',
            idealFor: 'Many tiers, steady progression paths'
        },
        organic: {
            name: 'Organic Flow',
            description: 'Slightly randomized positions for a natural feel. Best for varied, unpredictable spell collections.',
            idealFor: 'Mixed spell types, modded spell packs'
        }
    },
    
    // Get style info for LLM context
    getStyleDescriptions: function() {
        var desc = 'AVAILABLE LAYOUT STYLES (choose one that fits your tree structure):\n';
        for (var key in this.layoutStyles) {
            var style = this.layoutStyles[key];
            desc += '- ' + key + ': ' + style.description + ' Ideal for: ' + style.idealFor + '\n';
        }
        return desc;
    }
};

// =============================================================================
// DIFFICULTY PROFILES
// =============================================================================

var DIFFICULTY_PROFILES = {
    easy: {
        name: 'Easy',
        description: 'Relaxed progression for casual play',
        settings: {
            xpGlobalMultiplier: 2,
            xpMultiplierDirect: 150,
            xpMultiplierSchool: 75,
            xpMultiplierAny: 25,
            xpNovice: 50,
            xpApprentice: 100,
            xpAdept: 200,
            xpExpert: 400,
            xpMaster: 800,
            revealName: 5,
            revealEffects: 15,
            revealDescription: 30
        }
    },
    normal: {
        name: 'Normal',
        description: 'Balanced progression (default)',
        settings: {
            xpGlobalMultiplier: 1,
            xpMultiplierDirect: 100,
            xpMultiplierSchool: 50,
            xpMultiplierAny: 10,
            xpNovice: 100,
            xpApprentice: 200,
            xpAdept: 400,
            xpExpert: 800,
            xpMaster: 1500,
            revealName: 10,
            revealEffects: 25,
            revealDescription: 50
        }
    },
    hard: {
        name: 'Hard',
        description: 'Challenging progression for experienced players',
        settings: {
            xpGlobalMultiplier: 0.75,
            xpMultiplierDirect: 75,
            xpMultiplierSchool: 35,
            xpMultiplierAny: 5,
            xpNovice: 150,
            xpApprentice: 350,
            xpAdept: 700,
            xpExpert: 1200,
            xpMaster: 2500,
            revealName: 15,
            revealEffects: 35,
            revealDescription: 60
        }
    },
    brutal: {
        name: 'Brutal',
        description: 'Serious grind for dedicated mages',
        settings: {
            xpGlobalMultiplier: 0.5,
            xpMultiplierDirect: 50,
            xpMultiplierSchool: 25,
            xpMultiplierAny: 3,
            xpNovice: 250,
            xpApprentice: 500,
            xpAdept: 1000,
            xpExpert: 2000,
            xpMaster: 4000,
            revealName: 20,
            revealEffects: 40,
            revealDescription: 70
        }
    },
    trueMaster: {
        name: 'True Master',
        description: 'Only the most dedicated will master magic',
        settings: {
            xpGlobalMultiplier: 0.3,
            xpMultiplierDirect: 40,
            xpMultiplierSchool: 15,
            xpMultiplierAny: 2,
            xpNovice: 400,
            xpApprentice: 800,
            xpAdept: 1600,
            xpExpert: 3200,
            xpMaster: 6000,
            revealName: 25,
            revealEffects: 50,
            revealDescription: 80
        }
    },
    legendary: {
        name: 'Legendary',
        description: 'Nightmare difficulty - not for the faint of heart',
        settings: {
            xpGlobalMultiplier: 0.15,
            xpMultiplierDirect: 25,
            xpMultiplierSchool: 10,
            xpMultiplierAny: 1,
            xpNovice: 600,
            xpApprentice: 1200,
            xpAdept: 2500,
            xpExpert: 5000,
            xpMaster: 10000,
            revealName: 30,
            revealEffects: 60,
            revealDescription: 90
        }
    }
};

// =============================================================================
// DEFAULT SETTINGS
// =============================================================================

var DEFAULT_SETTINGS = {
    hotkey: 'F8',
    hotkeyCode: 66,
    cheatMode: false,
    nodeSizeScaling: true,
    showNodeNames: true,
    showSchoolDividers: true,
    dividerFade: 50,
    dividerSpacing: 3,
    verboseLogging: false,
    // Progression settings
    learningMode: 'perSchool',
    xpGlobalMultiplier: 1,
    xpMultiplierDirect: 100,
    xpMultiplierSchool: 50,
    xpMultiplierAny: 10,
    // Tier XP requirements
    xpNovice: 100,
    xpApprentice: 200,
    xpAdept: 400,
    xpExpert: 800,
    xpMaster: 1500,
    // Progressive reveal thresholds (%)
    revealName: 10,
    revealEffects: 25,
    revealDescription: 50,
    // School colors
    schoolColors: {
        'Destruction': '#ef4444',
        'Restoration': '#facc15',
        'Alteration': '#22c55e',
        'Conjuration': '#a855f7',
        'Illusion': '#38bdf8'
    },
    autoLLMColors: false,
    // ISL integration
    islEnabled: true,
    islXpPerHour: 50,
    islTomeBonus: 25,
    islDetected: false,
    // Difficulty profile
    activeProfile: 'normal',
    profileModified: false
};

// =============================================================================
// KEY CODES FOR HOTKEY MAPPING
// =============================================================================

var KEY_CODES = {
    'F1': 59, 'F2': 60, 'F3': 61, 'F4': 62, 'F5': 63, 'F6': 64,
    'F7': 65, 'F8': 66, 'F9': 67, 'F10': 68, 'F11': 87, 'F12': 88,
    '0': 11, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10,
    'A': 30, 'B': 48, 'C': 46, 'D': 32, 'E': 18, 'F': 33, 'G': 34, 'H': 35,
    'I': 23, 'J': 36, 'K': 37, 'L': 38, 'M': 50, 'N': 49, 'O': 24, 'P': 25,
    'Q': 16, 'R': 19, 'S': 31, 'T': 20, 'U': 22, 'V': 47, 'W': 17, 'X': 45,
    'Y': 21, 'Z': 44,
    'NUMPAD0': 82, 'NUMPAD1': 79, 'NUMPAD2': 80, 'NUMPAD3': 81, 'NUMPAD4': 75,
    'NUMPAD5': 76, 'NUMPAD6': 77, 'NUMPAD7': 71, 'NUMPAD8': 72, 'NUMPAD9': 73,
    'HOME': 199, 'END': 207, 'INSERT': 210, 'DELETE': 211,
    'PAGEUP': 201, 'PAGEDOWN': 209
};

// Export for module pattern (though we're using globals for compatibility)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GRID_CONFIG: GRID_CONFIG,
        TREE_CONFIG: TREE_CONFIG,
        DIFFICULTY_PROFILES: DIFFICULTY_PROFILES,
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        KEY_CODES: KEY_CODES
    };
}
