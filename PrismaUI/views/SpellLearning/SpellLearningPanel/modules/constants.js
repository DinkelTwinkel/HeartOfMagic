/**
 * SpellLearning Constants Module
 * 
 * Contains all constant values: default prompts, difficulty profiles, color palettes, key codes.
 * This module has no dependencies and should be loaded early.
 */

// =============================================================================
// DEFAULT TREE RULES PROMPT
// =============================================================================

var DEFAULT_TREE_RULES = `You are a Skyrim spell tree architect. Create a logical learning progression tree for each school of magic.

## CRITICAL RULES (MUST FOLLOW)

### 1. SCHOOL SEPARATION (MOST IMPORTANT!)
- **NEVER mix spells between schools!**
- Each spell has a "school" field - ONLY place spells in their OWN school's tree
- Example: Clairvoyance has "school": "Illusion" → it goes in Illusion tree, NOT Alteration
- VALIDATE every spell belongs to the correct school before adding

### 2. INCLUDE ALL SPELLS
- Every spell from the input MUST appear in the output
- Count spells per school and verify your output matches

### 3. MAXIMUM 3 BRANCHES PER NODE
- Each spell can have AT MOST 3 children
- If more connections needed, create intermediate nodes or chains
- This keeps the tree visually clean and navigable

### 4. SAME-TIER BRANCHING ALLOWED
- Novice spells CAN branch to other Novice spells
- Progression does NOT require increasing skill level
- Group by THEME/EFFECT, not just skill tier
- Example: Flames (Novice) → Frostbite (Novice) → Sparks (Novice) is VALID if thematically grouped

### 5. PREFER VANILLA FORMIDS FOR ROOTS
- FormIDs starting with 0x00 are vanilla (preferred for roots)
- 0x02 = Dawnguard, 0x04 = Dragonborn, 0xFE+ = mods
- Recommended vanilla roots:
  - Destruction: Flames (0x00012FCD)
  - Restoration: Healing (0x00012FCC)
  - Alteration: Oakflesh (0x0005AD5C) or Candlelight (0x00043324)
  - Conjuration: Conjure Familiar (0x000640B6)
  - Illusion: Clairvoyance (0x00021143) or Courage (0x0004DEE8)

## Tree Structure Rules

1. **One Root Per School**: Each school has exactly ONE root spell - a Novice-level spell FROM THAT SCHOOL.

2. **Branching Logic** (max 3 children per node):
   - Destruction: Branch by element (Fire, Frost, Shock)
   - Conjuration: Branch by summon type (Atronachs, Undead, Daedra) and bound weapons
   - Illusion: Branch by effect type (Fear, Calm, Frenzy, Invisibility, Muffle)
   - Alteration: Branch by effect (Armor, Paralysis, Light, Transmute, Detect)
   - Restoration: Branch by effect (Healing, Turn Undead, Wards)

3. **Tier Progression**: 
   - Branching within same tier is encouraged (Novice→Novice for variety)
   - Higher tier spells should generally require SOME lower tier prereqs
   - Master spells need Expert prereqs, Expert needs Adept, etc.

4. **Prerequisites**: Only from same school, thematically sensible.

## BEFORE OUTPUT - VALIDATE:
- [ ] Every node's school matches the tree it's in
- [ ] All input spells appear in output
- [ ] Each school has exactly one root
- [ ] No node has more than 3 children
- [ ] No duplicate formIds across trees

## Custom Rules (add your own below)

- 
`;

// =============================================================================
// DIFFICULTY PROFILES
// =============================================================================

var DIFFICULTY_PROFILES = {
    easy: {
        name: 'Easy',
        description: 'Relaxed progression for casual play',
        settings: {
            // XP multipliers
            xpGlobalMultiplier: 2,
            xpMultiplierDirect: 150,
            xpMultiplierSchool: 75,
            xpMultiplierAny: 25,
            // XP caps (generous)
            xpCapAny: 10,
            xpCapSchool: 25,
            xpCapDirect: 65,
            // Tier requirements (low)
            xpNovice: 50,
            xpApprentice: 100,
            xpAdept: 200,
            xpExpert: 400,
            xpMaster: 800,
            // Learning mode
            learningMode: 'perSchool',
            // Progressive reveal (early)
            revealName: 5,
            revealEffects: 15,
            revealDescription: 30,
            // Discovery mode off, show root names
            discoveryMode: false,
            showRootSpellNames: true,
            // Early spell learning (forgiving)
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 20,
                minEffectiveness: 30,
                maxEffectiveness: 80,
                selfCastRequiredAt: 60,
                selfCastXPMultiplier: 200,
                binaryEffectThreshold: 70
            },
            // Spell tome learning
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 30,
                tomeInventoryBoost: true,
                tomeInventoryBoostPercent: 30,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: false
            }
        }
    },
    normal: {
        name: 'Normal',
        description: 'Balanced progression (default)',
        settings: {
            // XP multipliers
            xpGlobalMultiplier: 1,
            xpMultiplierDirect: 100,
            xpMultiplierSchool: 50,
            xpMultiplierAny: 10,
            // XP caps (balanced)
            xpCapAny: 5,
            xpCapSchool: 15,
            xpCapDirect: 50,
            // Tier requirements (standard)
            xpNovice: 100,
            xpApprentice: 200,
            xpAdept: 400,
            xpExpert: 800,
            xpMaster: 1500,
            // Learning mode
            learningMode: 'perSchool',
            // Progressive reveal (standard)
            revealName: 10,
            revealEffects: 25,
            revealDescription: 50,
            // Discovery mode off, show root names
            discoveryMode: false,
            showRootSpellNames: true,
            // Early spell learning (balanced)
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 25,
                minEffectiveness: 20,
                maxEffectiveness: 70,
                selfCastRequiredAt: 75,
                selfCastXPMultiplier: 150,
                binaryEffectThreshold: 80
            },
            // Spell tome learning
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 25,
                tomeInventoryBoost: true,
                tomeInventoryBoostPercent: 25,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: false
            }
        }
    },
    hard: {
        name: 'Hard',
        description: 'Challenging progression for experienced players',
        settings: {
            // XP multipliers (reduced)
            xpGlobalMultiplier: 0.75,
            xpMultiplierDirect: 75,
            xpMultiplierSchool: 35,
            xpMultiplierAny: 5,
            // XP caps (tighter)
            xpCapAny: 3,
            xpCapSchool: 10,
            xpCapDirect: 40,
            // Tier requirements (higher)
            xpNovice: 150,
            xpApprentice: 350,
            xpAdept: 700,
            xpExpert: 1200,
            xpMaster: 2500,
            // Learning mode
            learningMode: 'perSchool',
            // Progressive reveal (delayed)
            revealName: 15,
            revealEffects: 35,
            revealDescription: 60,
            // Discovery mode off, show root names
            discoveryMode: false,
            showRootSpellNames: true,
            // Early spell learning (challenging)
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 30,
                minEffectiveness: 15,
                maxEffectiveness: 60,
                selfCastRequiredAt: 70,
                selfCastXPMultiplier: 125,
                binaryEffectThreshold: 85
            },
            // Spell tome learning (reduced bonus)
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 20,
                tomeInventoryBoost: true,
                tomeInventoryBoostPercent: 20,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: false
            }
        }
    },
    brutal: {
        name: 'Brutal',
        description: 'Serious grind for dedicated mages. Discovery mode enabled.',
        settings: {
            // XP multipliers (low)
            xpGlobalMultiplier: 0.5,
            xpMultiplierDirect: 50,
            xpMultiplierSchool: 25,
            xpMultiplierAny: 3,
            // XP caps (strict)
            xpCapAny: 2,
            xpCapSchool: 8,
            xpCapDirect: 35,
            // Tier requirements (high)
            xpNovice: 250,
            xpApprentice: 500,
            xpAdept: 1000,
            xpExpert: 2000,
            xpMaster: 4000,
            // Learning mode
            learningMode: 'perSchool',
            // Progressive reveal (late)
            revealName: 20,
            revealEffects: 40,
            revealDescription: 70,
            // Discovery mode ON, show root names (helps find starting point)
            discoveryMode: true,
            showRootSpellNames: true,
            // Early spell learning (punishing)
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 35,
                minEffectiveness: 10,
                maxEffectiveness: 50,
                selfCastRequiredAt: 65,
                selfCastXPMultiplier: 100,
                binaryEffectThreshold: 90
            },
            // Spell tome learning (minimal bonus)
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 15,
                tomeInventoryBoost: true,
                tomeInventoryBoostPercent: 15,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: false
            }
        }
    },
    trueMaster: {
        name: 'True Master',
        description: 'Only the most dedicated will master magic. Discovery mode enabled.',
        settings: {
            // XP multipliers (very low)
            xpGlobalMultiplier: 0.3,
            xpMultiplierDirect: 40,
            xpMultiplierSchool: 15,
            xpMultiplierAny: 2,
            // XP caps (very strict)
            xpCapAny: 1,
            xpCapSchool: 5,
            xpCapDirect: 30,
            // Tier requirements (very high)
            xpNovice: 400,
            xpApprentice: 800,
            xpAdept: 1600,
            xpExpert: 3200,
            xpMaster: 6000,
            // Learning mode (single target only)
            learningMode: 'single',
            // Progressive reveal (very late)
            revealName: 25,
            revealEffects: 50,
            revealDescription: 80,
            // Discovery mode ON, hide root names (true mystery)
            discoveryMode: true,
            showRootSpellNames: false,
            // Early spell learning (harsh)
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 40,
                minEffectiveness: 10,
                maxEffectiveness: 45,
                selfCastRequiredAt: 60,
                selfCastXPMultiplier: 100,
                binaryEffectThreshold: 90
            },
            // Spell tome learning (reduced)
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 10,
                tomeInventoryBoost: true,
                tomeInventoryBoostPercent: 10,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: true  // Harder difficulty requires skill level
            }
        }
    },
    legendary: {
        name: 'Legendary',
        description: 'Nightmare difficulty - not for the faint of heart. Discovery mode enabled.',
        settings: {
            // XP multipliers (minimal)
            xpGlobalMultiplier: 0.15,
            xpMultiplierDirect: 25,
            xpMultiplierSchool: 10,
            xpMultiplierAny: 1,
            // XP caps (extremely strict)
            xpCapAny: 1,
            xpCapSchool: 3,
            xpCapDirect: 25,
            // Tier requirements (extreme)
            xpNovice: 600,
            xpApprentice: 1200,
            xpAdept: 2500,
            xpExpert: 5000,
            xpMaster: 10000,
            // Learning mode (single target only)
            learningMode: 'single',
            // Progressive reveal (extremely late)
            revealName: 30,
            revealEffects: 60,
            revealDescription: 90,
            // Discovery mode ON, hide root names
            discoveryMode: true,
            showRootSpellNames: false,
            // Early spell learning (brutal)
            earlySpellLearning: {
                enabled: true,
                unlockThreshold: 50,
                minEffectiveness: 5,
                maxEffectiveness: 40,
                selfCastRequiredAt: 55,
                selfCastXPMultiplier: 75,
                binaryEffectThreshold: 95
            },
            // Spell tome learning (minimal)
            spellTomeLearning: {
                enabled: true,
                useProgressionSystem: true,
                grantXPOnRead: true,
                autoSetLearningTarget: true,
                showNotifications: true,
                xpPercentToGrant: 5,
                tomeInventoryBoost: false,
                tomeInventoryBoostPercent: 0,
                requirePrereqs: true,
                requireAllPrereqs: true,
                requireSkillLevel: true  // Hardest difficulty requires skill level
            }
        }
    }
};

// =============================================================================
// DEFAULT COLOR PALETTE
// =============================================================================

var DEFAULT_COLOR_PALETTE = [
    '#ef4444', // Red
    '#facc15', // Gold
    '#22c55e', // Green
    '#a855f7', // Purple
    '#38bdf8', // Cyan
    '#f97316', // Orange
    '#ec4899', // Pink
    '#14b8a6', // Teal
    '#8b5cf6', // Violet
    '#84cc16', // Lime
    '#06b6d4', // Sky
    '#f43f5e', // Rose
    '#6366f1', // Indigo
    '#eab308', // Yellow
    '#10b981', // Emerald
    '#d946ef', // Fuchsia
    '#0ea5e9', // Light Blue
    '#22d3ee', // Cyan Light
    '#fbbf24', // Amber
    '#a3e635'  // Lime Light
];

// =============================================================================
// KEY CODES (DirectInput Scancodes)
// =============================================================================

var KEY_CODES = {
    'F1': 59, 'F2': 60, 'F3': 61, 'F4': 62, 'F5': 63, 'F6': 64,
    'F7': 65, 'F8': 66, 'F9': 67, 'F10': 68, 'F11': 87, 'F12': 88,
    'Escape': 1, 'Tab': 15, 'CapsLock': 58, 'Backspace': 14,
    'Enter': 28, 'Space': 57,
    '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
    'Q': 16, 'W': 17, 'E': 18, 'R': 19, 'T': 20, 'Y': 21, 'U': 22, 'I': 23, 'O': 24, 'P': 25,
    'A': 30, 'S': 31, 'D': 32, 'F': 33, 'G': 34, 'H': 35, 'J': 36, 'K': 37, 'L': 38,
    'Z': 44, 'X': 45, 'C': 46, 'V': 47, 'B': 48, 'N': 49, 'M': 50
};
