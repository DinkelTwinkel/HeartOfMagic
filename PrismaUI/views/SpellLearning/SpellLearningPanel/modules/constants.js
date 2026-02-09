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
// (Difficulty profiles removed — now in settingsPresets.js as chip-based presets)
// =============================================================================

// Legacy placeholder to prevent reference errors in backup/config modules
var DIFFICULTY_PROFILES = {};


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
