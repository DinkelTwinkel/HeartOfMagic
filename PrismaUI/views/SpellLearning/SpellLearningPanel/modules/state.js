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
    hotkey: 'F9',
    hotkeyCode: 67,  // DirectInput scancode for F9
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
    
    heartBgColor: '#0a0a14',
    heartRingColor: '#b8a878',
    learningPathColor: '#00ffff',
    nodeSizeScaling: true,
    showNodeNames: true,
    showSchoolDividers: true,
    strictPieSlices: true,  // Keep schools strictly in their pie slices (vs. allowing overlap)
    dividerFade: 50,      // 0-100, percentage of line length to fade out
    dividerSpacing: 3,    // pixels between parallel divider lines
    dividerLength: 800,   // length of divider lines in pixels
    dividerColorMode: 'school',  // 'school' or 'custom'
    dividerCustomColor: '#ffffff',
    preserveMultiPrereqs: true,
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
    // Difficulty profile system
    activeProfile: 'normal',
    profileModified: false,
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
    }
};

// Custom difficulty profiles (user-created)
var customProfiles = {};

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
    currentTab: 'spellScan',
    lastSpellData: null,
    promptModified: false,
    originalPrompt: DEFAULT_TREE_RULES,
    // Field output settings
    fields: {
        editorId: true,
        magickaCost: true,
        minimumSkill: false,
        castingType: false,
        delivery: false,
        chargeTime: false,
        plugin: false,
        effects: false,
        effectNames: false,
        keywords: false
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
