/**
 * SpellLearning State Module
 * 
 * Contains all global state: settings, UI state, progression tracking.
 * Depends on: constants.js (for DEFAULT_TREE_RULES)
 */

// =============================================================================
// SETTINGS
// =============================================================================

// Available UI themes - populated dynamically from themes/ folder
// To add a theme: 
//   1. Create themes/mytheme.json with {id, name, description, cssFile}
//   2. Add "mytheme" to themes/manifest.json
var UI_THEMES = {};
var themesLoaded = false;

var settings = {
    hotkey: 'F8',
    hotkeyCode: 66,  // DirectInput scancode for F8
    pauseGameOnFocus: true,  // If false, game continues running when UI is open
    cheatMode: false,
    
    // Heart animation settings
    heartAnimationEnabled: true,
    heartPulseSpeed: 0.2,
    heartPulseDelay: 5.0,
    heartBgOpacity: 1.0,
    
    // Starfield settings
    starfieldEnabled: true,
    starfieldFixed: true,
    starfieldColor: '#ffffff',
    starfieldDensity: 200,
    starfieldMaxSize: 2.5,
    
    // Globe settings
    globeSize: 30,
    globeDensity: 200,
    globeDotMin: 1,
    globeDotMax: 3,
    globeColor: '#b8a878',
    magicTextColor: '#b8a878',
    globeText: 'HoM',
    globeTextSize: 16,
    particleTrailEnabled: true,
    
    heartBgColor: '#000000',
    heartRingColor: '#b8a878',
    learningPathColor: '#00ffff',

    // Connection visibility settings
    showSelectionPath: true,      // Show white highlight path when node selected
    showBaseConnections: true,    // Show dim connection lines between all nodes
    nodeSizeScaling: true,
    showNodeNames: true,
    showSchoolDividers: true,
    strictPieSlices: true,  // Keep schools strictly in their pie slices (vs. allowing overlap)
    dividerFade: 50,      // 0-100, percentage of line length to fade out
    dividerSpacing: 3,    // pixels between parallel divider lines
    dividerLength: 800,   // length of divider lines in pixels
    dividerColorMode: 'school',  // 'school' or 'custom'
    dividerCustomColor: '#ffffff',
    preserveMultiPrereqs: true,  // DEPRECATED - gentle fix disabled, setting has no effect
    verboseLogging: false,
    // UI Display settings
    uiTheme: 'skyrim',          // Current UI theme key
    learningColor: '#7890A8',   // Color for learning state nodes/lines
    fontSizeMultiplier: 1.0,    // Global font size multiplier (0.5 - 2.0)
    // Tree generation settings
    aggressivePathValidation: true,   // Strict reachability check (safe but simple trees)
    allowLLMMultiplePrereqs: true,    // Let LLM design multiple prerequisites per spell
    llmSelfCorrection: true,          // Let LLM fix its own unreachable nodes
    llmSelfCorrectionMaxLoops: 5,     // Max correction attempts before fallback
    proceduralPrereqInjection: false, // Add extra prereqs programmatically after generation
    // Procedural injection settings
    proceduralInjection: {
        chance: 50,              // % chance per eligible node (0-100)
        maxPrereqs: 3,           // Maximum total prerequisites per node
        minTier: 3,              // Minimum tier where injection applies (1-5)
        sameTierPreference: true // Prefer same-tier prereqs for convergence feel
    },
    // Progression settings
    learningMode: 'perSchool',  // 'perSchool' or 'single'
    xpGlobalMultiplier: 1,
    // XP multipliers (how much XP per cast)
    xpMultiplierDirect: 100,
    xpMultiplierSchool: 50,
    xpMultiplierAny: 10,
    // XP caps (max % of total XP from each source)
    xpCapAny: 5,        // Max 5% from casting any spell
    xpCapSchool: 15,    // Max 15% from same-school spells
    xpCapDirect: 50,    // Max 50% from direct prerequisite casts
    // Remaining 50% must come from self-casting the learning target
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
    // Window position and size
    windowX: null,
    windowY: null,
    windowWidth: null,
    windowHeight: null,
    // School colors (dynamically grows with detected schools)
    schoolColors: {
        'Destruction': '#ef4444',
        'Restoration': '#facc15',
        'Alteration': '#22c55e',
        'Conjuration': '#a855f7',
        'Illusion': '#38bdf8'
    },
    // School visibility (which schools to show on tree)
    schoolVisibility: {
        // All schools visible by default, dynamically grows
    },
    // Auto-request LLM color suggestions for new schools
    autoLLMColors: false,
    // ISL-DESTified mod integration
    islEnabled: true,
    islXpPerHour: 50,
    islTomeBonus: 25,
    islDetected: false,
    // Discovery mode
    discoveryMode: false,
    showRootSpellNames: true,  // Show root spell names even in discovery mode (helps players know what to look for)
    // Early spell learning
    earlySpellLearning: {
        enabled: true,
        unlockThreshold: 25,
        minEffectiveness: 20,      // Derived from powerSteps[0].power
        maxEffectiveness: 80,      // Derived from last powerStep.power
        selfCastRequiredAt: 75,
        selfCastXPMultiplier: 150,
        binaryEffectThreshold: 80,
        modifyGameDisplay: true,   // Show "(Learning - X%)" in game menus
        // Configurable power steps (XP threshold -> power %)
        // Names avoid vanilla tier confusion
        powerSteps: [
            { xp: 25, power: 20, label: "Budding" },       // Stage 1
            { xp: 40, power: 35, label: "Developing" },    // Stage 2
            { xp: 55, power: 50, label: "Practicing" },    // Stage 3
            { xp: 70, power: 65, label: "Advancing" },     // Stage 4
            { xp: 85, power: 80, label: "Refining" }       // Stage 5
            // 100% XP = 100% power = "Mastered" (implicit)
        ]
    },
    // Spell Tome Learning settings
    spellTomeLearning: {
        enabled: true,                    // Master toggle for tome hook
        useProgressionSystem: true,       // true = XP/weakened spell, false = vanilla instant learn
        grantXPOnRead: true,              // Grant XP when reading tome
        autoSetLearningTarget: true,      // Auto-set spell as learning target
        showNotifications: true,          // Show in-game notifications
        xpPercentToGrant: 25,             // % of required XP to grant on tome read
        tomeInventoryBoost: true,         // Enable inventory boost feature
        tomeInventoryBoostPercent: 25,    // % bonus XP when tome is in inventory
        // Prerequisite requirements for tome learning
        requirePrereqs: true,             // Require tree prerequisites to be mastered
        requireAllPrereqs: true,          // Require ALL prereqs (vs just one)
        requireSkillLevel: false          // Require minimum skill level for spell tier
    },
    // In-game notification settings
    notifications: {
        weakenedSpellNotifications: true, // Show "X operating at Y% power" when casting weakened spells
        weakenedSpellInterval: 10         // Seconds between notifications (default 10)
    },
    // Spell blacklist (excluded from tree building)
    // Each entry: { formId: '0x...', name: 'Spell Name', school: 'School' }
    spellBlacklist: [],
    // Plugin whitelist (only scan spells from these plugins when enabled)
    // Each entry: { plugin: 'PluginName.esp', enabled: true, spellCount: 42 }
    // If empty or all disabled, all plugins are scanned (default behavior)
    pluginWhitelist: [],

    // ==========================================================================
    // DYNAMIC TREE GENERATION SETTINGS (Tier 3)
    // ==========================================================================
    // These control the dynamic theme discovery and tree building system
    treeGeneration: {
        // === THEME DISCOVERY ===
        themeDiscoveryMode: 'dynamic',  // 'dynamic' (TF-IDF clustering) or 'fixed' (predefined)
        minThemeSize: 3,                // Minimum spells to form a theme
        maxThemes: 15,                  // Maximum themes to discover
        maxThemeSize: 80,               // Split themes larger than this

        // === SMART ROUTING ===
        // Priority: strong thematic > LLM branch > mod theme > clustering
        enableSmartRouting: true,       // Use smart keyword-based routing
        llmBranchRouting: false,        // Use LLM to decide branch vs mod (requires API key)
        autoBranchFallback: true,       // Use NLP auto-branch when LLM disabled

        // === ROOT CONFIGURATION ===
        rootCount: 1,                   // 1 = single root with element branches, 3 = separate element roots
        // rootCount=1: Root (Sparks) -> Flames -> fire spells, Frostbite -> frost spells
        // rootCount=3: Three independent roots (Flames, Frostbite, Sparks) each start own tree

        // === ELEMENT/THEME ISOLATION ===
        elementIsolation: true,         // Prefer same-element links
        elementIsolationStrict: false,  // ONLY allow same-element links
        elementWeight: 100,             // Score bonus for same element

        // === TIER RULES ===
        strictTierOrdering: true,       // Enforce Novice -> Apprentice -> ... progression
        allowSameTierLinks: true,       // Can Adept link to Adept?
        maxTierSkip: 2,                 // Max tiers a link can skip (Novice->Adept = 2)
        tierMixing: false,              // Allow spells to bleed into adjacent tier zones
        tierMixingAmount: 20,           // How much mixing when enabled (0-100%)

        // === LINK STRATEGY ===
        linkStrategy: 'thematic',       // 'strict', 'thematic', 'organic', 'random'

        // === SCORING FACTORS (toggleable) ===
        scoring: {
            elementMatching: true,      // +100 same element
            spellTypeMatching: true,    // +40 same spell type (bolt, rune, etc.)
            tierProgression: true,      // +50 adjacent tier
            keywordMatching: true,      // +20 per shared keyword
            themeCoherence: true,       // +70 same theme
            effectNameMatching: true,   // +30 matching effect names
            descriptionSimilarity: true,// +20 TF-IDF on descriptions
            magickaCostProximity: false,// +15 if within 20% magicka cost
            sameModSource: false        // +10 if from same plugin/mod
        },

        // === CONVERGENCE (multi-prerequisites) ===
        convergenceEnabled: true,       // Expert/Master can have multiple prereqs
        convergenceChance: 40,          // % of eligible spells
        convergenceMinTier: 3,          // 0=Novice, 3=Expert, 4=Master

        // === PARENT LIMITS ===
        maxChildrenPerNode: 3,          // Max spells that can have same prereq

        // === SHAPE SETTINGS ===
        // Per-school shapes (from SCHOOL_DEFAULT_SHAPES in shapeProfiles.js):
        //   Destruction=explosion, Restoration=tree, Alteration=mountain,
        //   Conjuration=portals, Illusion=organic
        // This is only used as fallback when no per-school shape is defined:
        shapeStyle: 'organic',          // Fallback: 'organic','explosion','tree','mountain','portals','spiky','cascade','cloud'

        // === ADVANCED OPTIONS ===
        allowSpellRepetition: false,    // Same spell at multiple positions
        maxRepetitions: 2,              // Max if repetition enabled
        repetitionMinTierGap: 2,        // Min tier gap between repetitions

        // === MOD HANDLING ===
        prioritizeVanilla: true,        // Vanilla spells preferred for early tree
        modBranchMode: 'mixed',         // 'mixed', 'separate', 'own-tree'

        // === VALIDATION ===
        linkValidationPasses: 3,        // How many fix passes
        warnOnDistanceViolation: true,  // Warn if links too long
        warnOnElementMismatch: true,    // Warn on cross-element links

        // === BIDIRECTIONAL SOFT PREREQS ===
        bidirectionalSoftPrereqs: true,  // When A is soft prereq of B, B also soft prereq of A

        // === LLM EDGE CASE RESOLUTION (Legacy - use llm.edgeCases instead) ===
        llmEdgeCaseEnabled: false,      // Use LLM for low-confidence assignments
        llmEdgeCaseThreshold: 10,       // Score difference to trigger LLM

        // === LLM INTEGRATION SETTINGS ===
        llm: {
            // Master toggle - enables/disables all LLM features
            enabled: false,

            // 1. Theme Discovery - Use LLM instead of TF-IDF clustering
            themeDiscovery: false,
            themeDiscoveryModel: 'auto',    // 'auto', 'fast', 'quality'

            // 2. Element Detection - Ask LLM to classify fire/frost/shock
            elementDetection: false,

            // 3. Edge Case Resolution - Break ties on close scores
            edgeCases: false,
            edgeCaseThreshold: 10,          // Score difference to trigger

            // 4. Branch Assignment - LLM decides where mod spells belong
            branchAssignment: false,

            // 5. Parent Suggestion - LLM suggests best parent spell
            parentSuggestion: false,

            // 6. Tree Validation - LLM reviews tree for logical issues
            treeValidation: false,

            // 7. Keyword Expansion - LLM discovers new element keywords
            keywordExpansion: false,

            // 8. Keyword Classification - LLM classifies spells with weak/missing keywords
            keywordClassification: false
        }
    }
};

// Settings presets (user-saved progression/early spell/tome configurations)
var settingsPresets = {};

// Scanner presets (user-saved tree building configurations)
var scannerPresets = {};

// Per-node XP requirement overrides (formId -> requiredXP)
var xpOverrides = {};

// =============================================================================
// UI STATE
// =============================================================================

var state = {
    isMinimized: false,
    isFullscreen: false,
    isDragging: false,
    isResizing: false,
    isSettingsOpen: false,
    currentTab: 'spellTree',
    lastSpellData: null,
    promptModified: false,
    originalPrompt: DEFAULT_TREE_RULES,
    // Field output settings
    fields: {
        editorId: true,
        magickaCost: true,
        minimumSkill: true,
        castingType: true,
        delivery: true,
        chargeTime: false,
        plugin: true,
        effects: true,
        effectNames: false,
        keywords: true
    },
    // Tree viewer state
    treeData: null,
    treeInitialized: false,
    clearTreePending: false,
    // LLM API config
    llmConfig: {
        apiKey: '',
        model: 'anthropic/claude-sonnet-4',
        maxTokens: 4096
    },
    // Clipboard paste target
    pasteTarget: null,
    // Full Auto mode flag
    fullAutoMode: false,
    // LLM integration
    llmAvailable: false,
    llmGenerating: false,
    llmQueue: [],
    llmCurrentSchool: null,
    llmPollInterval: null,
    llmStats: {
        totalSpells: 0,
        processedSpells: 0,
        failedSchools: [],
        needsAttentionSchools: []  // Schools that had unreachable nodes after auto-fix
    },
    // Python addon status (for Complex Build)
    pythonAddonInstalled: false,  // Set by C++ on panel open
    pythonScriptFound: false,     // build_tree.py exists
    pythonSetupInProgress: false, // Auto-setup running
    // Progression tracking
    learningTargets: {},  // school -> formId
    spellProgress: {},    // formId -> {xp, required, unlocked, ready}
    selectedNode: null,
    playerKnownSpells: new Set(),
    weakenedSpells: new Set()  // Spells the player has in weakened/early-learned state (not fully mastered)
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Global helper to update slider fill
function updateSliderFillGlobal(slider) {
    if (!slider) return;
    var percent = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.setProperty('--slider-fill', percent + '%');
}
