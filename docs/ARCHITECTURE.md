# Spell Learning System - Architecture

**Purpose:** Concise reference for LLMs to understand system structure and implementation status.

**Version:** 1.6 (Updated January 28, 2026 - Tree Generation Validation)

---

## System Overview

**What It Does:**
- Scans all spells from loaded plugins
- Generates AI-driven spell learning tree with prerequisites
- Tracks XP-based progression (casting prerequisites, tome study, ISL integration)
- Displays interactive tree UI (PrismaUI) with F9 hotkey
- Progressive revelation system (names/effects/descriptions unlock with XP)
- Discovery Mode: progressive tree reveal based on XP progress
- Difficulty profile system with 6 presets and custom profiles
- **Early Spell Learning:** Spells granted early but nerfed, scaling with progress
- **Progressive Effectiveness:** Runtime spell magnitude scaling via C++ hooks

**Core Flow:**
```
Scan Spells → Generate Tree (LLM) → Display Tree → Track XP → Grant Early (nerfed) → Reveal Details → Master Spells
```

---

## Component Architecture

### 1. **SpellScanner** (`plugin/src/SpellScanner.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Enumerate all `SpellItem` forms from data handler
- Extract spell properties (name, school, tier, cost, effects, etc.)
- Generate JSON output for LLM consumption
- Generate LLM prompt with tree-building instructions
- Filter learnable spells (exclude abilities/powers)

**Key Functions:**
- `ScanAllSpells(config)` - Main scan function
- `ScanSpellTomes(config)` - Alternative scan via tomes
- `GetSpellInfoByFormId(formId)` - Lookup spell details
- `GetSystemInstructions()` - LLM output format spec

### 2. **UIManager** (`plugin/src/UIManager.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- PrismaUI view registration and communication
- Hotkey handling (configurable, default F9)
- C++ ↔ JavaScript bridge
- Panel visibility management
- Unified config load/save (includes early learning settings)
- LLM API integration (OpenRouter)
- ISL detection status notification

**Key Functions:**
- `Initialize()` - Connect to PrismaUI
- `TogglePanel()` - Show/hide SpellLearningPanel
- `InteropCall(view, function, data)` - Send data to UI
- `OnLoadUnifiedConfig()` / `OnSaveUnifiedConfig()` - Settings persistence
- `NotifyISLDetectionStatus()` - Update UI with ISL mod status
- Various `On*` callback functions for UI interop

**PrismaUI View Path:**
```
CreateView("SpellLearning/SpellLearningPanel/index.html", ...)
```
**CRITICAL:** Deploy path must match exactly:
```
MO2/mods/SpellLearning_RELEASE/PrismaUI/views/SpellLearning/SpellLearningPanel/
```

### 3. **ProgressionManager** (`plugin/src/ProgressionManager.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Track per-spell XP progress
- Manage learning targets (one per school in "perSchool" mode, one total in "single" mode)
- Calculate XP gains with multipliers (direct, school, any)
- **Track direct prerequisites per learning target** (from UI)
- XP caps per source type (any: 5%, school: 15%, direct: 50%)
- Progressive revelation thresholds
- Save/load progression via SKSE co-save
- **Early spell granting at unlock threshold**
- **Self-cast XP bonus after threshold**
- **Auto-mastery at 100% progress**

**Key Functions:**
- `SetLearningTarget(school, formId, prereqs)` - Set active target with prerequisites
- `SetTargetPrerequisites(targetId, prereqs)` - Update prerequisites for a target
- `IsDirectPrerequisite(targetId, castId)` - Check if cast spell is direct prereq
- `AddXP(formId, amount)` - Add XP to spell (triggers early grant/mastery)
- `OnSpellCast(school, castSpellId, baseXP)` - Handle cast event
- `GetProgress(formId)` - Get SpellProgress struct
- `IsSpellAvailableToLearn(formId)` - Check if spell can receive XP
- `ClearLearningTargetForSpell(formId)` - Clear target after mastery
- `OnGameSaved/OnGameLoaded/OnRevert` - SKSE serialization

**XP Source Priority:**
1. **Self-cast** (casting the learning target itself) - 100% multiplier, no cap
2. **Direct prerequisite** (casting a direct prereq of target) - 100% multiplier, 50% cap
3. **Same school** (casting same school, not prereq) - 50% multiplier, 15% cap
4. **Any spell** (other schools) - 10% multiplier, 5% cap

**Data Structures:**
```cpp
struct SpellProgress {
    float progressPercent;  // 0.0 to 1.0
    float requiredXP;       // From tree data
    bool unlocked;          // Only TRUE at 100% mastery!
};

struct XPSettings {
    std::string learningMode;     // "perSchool" or "single"
    float globalMultiplier;       // Overall XP multiplier
    float multiplierDirect;       // Cast direct prerequisite (default 100%)
    float multiplierSchool;       // Cast same school (default 50%)
    float multiplierAny;          // Cast any spell (default 10%)
    float capDirect;              // Max XP from direct prereqs (default 50%)
    float capSchool;              // Max XP from school (default 15%)
    float capAny;                 // Max XP from any (default 5%)
    float xpNovice/Apprentice/Adept/Expert/Master;  // Tier XP requirements
};

// Direct prerequisites tracked per learning target
std::unordered_map<RE::FormID, std::vector<RE::FormID>> m_targetPrerequisites;
```

### 4. **SpellEffectivenessHook** (`plugin/src/SpellEffectivenessHook.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Hook `ActiveEffect::AdjustForPerks()` for runtime magnitude scaling
- Hook `SpellItem::GetFullName()` for display name modification (optional)
- Track early-learned spells that need nerfing
- **Stepped power system** - Discrete power levels at XP thresholds
- Handle binary effects (Paralysis, Invisibility) with threshold
- Persist early-learned spell list via SKSE co-save
- Display cache for modified spell names/descriptions

**Key Functions:**
- `Install()` / `InstallDisplayHooks()` - Install REL hooks
- `SetSettings(settings)` - Update from unified config
- `SetPowerSteps(steps)` - Configure discrete power steps
- `AddEarlyLearnedSpell(formId)` / `RemoveEarlyLearnedSpell(formId)`
- `IsEarlyLearnedSpell(formId)` - Check if spell is in nerfed state
- `NeedsNerfing(formId)` - Check if magnitude should be scaled
- `GetSteppedEffectiveness(formId)` - Get current power step effectiveness
- `GetCurrentPowerStep(formId)` - Get current step index
- `GetPowerStepLabel(step)` - Get label ("Budding", "Developing", etc.)
- `GrantEarlySpell(spell)` - Add spell to player, mark as early-learned
- `CheckAndRegrantSpell(formId)` - Regrant spell when setting learning target
- `RemoveEarlySpellFromPlayer(formId)` - Remove when switching targets
- `MarkMastered(formId)` - Remove from early-learned list (full power)
- `ApplyEffectivenessScaling(effect)` - Scale magnitude on ActiveEffect
- `GetModifiedSpellName(spell)` - Return "(Learning - X%)" name
- `UpdateSpellDisplayCache(formId, spell)` - Update cached display data
- `OnGameSaved/OnGameLoaded/OnRevert` - Serialization

**Power Step System:**
```cpp
struct PowerStep {
    float progressThreshold;  // XP % to reach this step
    float effectiveness;      // Power multiplier (0.0-1.0)
    std::string label;        // Display name
};

// Default steps:
// 25% XP -> 20% power (Budding)
// 40% XP -> 35% power (Developing)
// 55% XP -> 50% power (Practicing)
// 70% XP -> 65% power (Advancing)
// 85% XP -> 80% power (Refining)
// 100% XP -> 100% power (Mastered)
```

**Settings:**
```cpp
struct EarlyLearningSettings {
    bool enabled = true;
    float unlockThreshold = 20.0f;      // % to grant spell (early access)
    float minEffectiveness = 20.0f;     // Starting power %
    float maxEffectiveness = 70.0f;     // Max before mastery (legacy, now uses steps)
    float selfCastRequiredAt = 67.0f;   // % after which must cast spell itself
    float selfCastXPMultiplier = 1.5f;  // Bonus for casting the spell being learned
    float binaryEffectThreshold = 80.0f;// Binary effects don't work below this %
    bool modifyGameDisplay = true;      // Modify spell names in game menus
};
```

**Hook Targets:**
```cpp
// ActiveEffect::AdjustForPerks - Magnitude scaling
// SpellItem::GetFullName (vtable) - Display name modification
```

### 5. **SpellCastHandler** (`plugin/src/SpellCastHandler.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Listen to spell cast events (`TESSpellCastEvent`)
- Identify spell school from cast
- Route to ProgressionManager for XP calculation

**Key Functions:**
- `Register()` - Register for SKSE events
- `ProcessEvent(event)` - Handle spell cast

### 6. **ISLIntegration** (`plugin/src/ISLIntegration.cpp/h`)
**Status:** ⚠️ Partially Implemented (UI Hidden)

**Note:** ISL integration UI is currently hidden in Settings. The C++ detection works,
but the Papyrus event hooks need proper quest/alias setup in an ESP.

**Responsibilities:**
- Detect ISL-DESTified mod (multiple plugin name variants)
- Register for OnSpellTomeRead events via Papyrus
- Convert study hours to XP
- Apply tome inventory bonus
- Configurable XP per hour setting

**Supported Plugin Names:**
```cpp
"DontEatSpellTomes.esp/esl"
"Don't Eat Spell Tomes.esp/esl"
"DEST_ISL.esp/esl"
"ISL-DESTified.esp/esl"
```

**Key Functions:**
- `Initialize()` - Detect mod, build book-spell cache
- `IsISLInstalled()` / `IsActive()` - Status checks
- `GetISLPluginName()` - Return detected plugin name
- `OnSpellTomeRead(book, spell, container)` - Main event handler
- `CalculateXPFromHours(hours, spell)` - XP calculation
- `PlayerHasTomeForSpell(spell)` - Inventory bonus check
- `RegisterPapyrusFunctions(vm)` - Papyrus native bindings

**Papyrus Scripts:**
- `SpellLearning_ISL.psc` - Native function stubs
- `SpellLearning_ISL_Handler.psc` - Event handler on player alias

### 7. **OpenRouterAPI** (`plugin/src/OpenRouterAPI.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- HTTP client for OpenRouter API
- Send LLM requests for tree generation
- Handle async responses

---

## PrismaUI Frontend

### SpellLearningPanel (`PrismaUI/views/SpellLearning/SpellLearningPanel/`)

**Architecture:** Modular JavaScript (18 files) for LLM maintainability.

**Core Files:**
- `index.html` - UI structure, module load order (~1145 lines)
- `styles.css` - Styling (dark theme, responsive) (~2484 lines)
- `script.js` - Main initialization and remaining app logic (~802 lines)

**JavaScript Modules (`modules/`):**

| Module | Lines | Purpose |
|--------|-------|---------|
| `constants.js` | 267 | `DEFAULT_TREE_RULES`, `DIFFICULTY_PROFILES`, `KEY_CODES`, palettes |
| `state.js` | 210 | `settings`, `state` (incl. llmStats), `customProfiles`, `xpOverrides` |
| `config.js` | 266 | `TREE_CONFIG` layout and visual configuration |
| `spellCache.js` | 114 | Spell data caching with async batch requests |
| `colorUtils.js` | 258 | School colors, dynamic CSS generation |
| `uiHelpers.js` | 189 | `updateStatus`, `setStatusIcon`, `getXPForTier` utilities |
| `growthDSL.js` | 301 | LLM-driven procedural tree visual DSL |
| `treeParser.js` | 875 | Tree JSON parsing, validation, cycle detection, gentle auto-fix |
| `wheelRenderer.js` | 1296 | SVG radial tree rendering engine |
| `settingsPanel.js` | 1060 | Settings UI initialization, config persistence, retry school UI |
| `treeViewerUI.js` | 618 | Tree viewer, spell details, node selection |
| `progressionUI.js` | 547 | How-to-Learn panel, learning status badges |
| `difficultyProfiles.js` | 429 | Profile management, presets, custom profiles |
| `llmApiSettings.js` | 230 | OpenRouter API configuration UI |
| `buttonHandlers.js` | 264 | Scan, learn, unlock, import/export handlers |
| `cppCallbacks.js` | 438 | `window.onScanComplete`, `onTreeDataReceived`, etc. |
| `llmIntegration.js` | 930 | LLM tree generation, validation, retry, color suggestions |

**Module Load Order (in index.html):**
```html
<!-- 1. Configuration -->
constants.js → state.js → config.js

<!-- 2. Utilities -->
spellCache.js → colorUtils.js → uiHelpers.js

<!-- 3. Core Systems -->
growthDSL.js → treeParser.js → wheelRenderer.js

<!-- 4. UI Panels -->
settingsPanel.js → treeViewerUI.js → progressionUI.js → difficultyProfiles.js
llmApiSettings.js → buttonHandlers.js

<!-- 5. Integrations -->
cppCallbacks.js → llmIntegration.js

<!-- 6. Main Application -->
script.js
```

**Tabs:**
1. **Spell Scan** - Scan spells, LLM API settings, output field toggles, Growth Style Generator
2. **Tree Rules** - Custom rules for tree generation
3. **Spell Tree** - Interactive radial visualization with zoom/pan/rotate, How-to-Learn panel
4. **Settings** - Difficulty profiles, progression settings, display options, early learning, mod integrations

**Key JavaScript Objects:**
- `TREE_CONFIG` - Layout and visual configuration (in `config.js`)
- `DIFFICULTY_PROFILES` - 6 preset difficulty profiles (in `constants.js`)
- `settings` - All user settings, persisted (in `state.js`)
- `state` - Runtime state: scan results, tree data, etc. (in `state.js`)
- `WheelRenderer` - SVG tree rendering engine (in `wheelRenderer.js`)
- `TreeParser` - Parse and validate tree JSON (in `treeParser.js`)
- `GROWTH_DSL` - LLM-driven procedural tree visuals schema (in `growthDSL.js`)

**Key Features:**
- Radial spell tree with school-based sectors
- Progressive node states: locked → available → learning → weakened → practicing → mastered
- Discovery Mode: hides locked nodes, shows "???" preview for upcoming spells
- XP-based name reveal: available node names hidden until XP threshold
- Preview nodes appear when parent has ≥20% XP progress
- Tier-based node sizing (novice → master = small → large)
- Collision resolution for dense trees
- LLM-suggested layout styles per school
- **Growth Style Generator** - LLM-driven visual tree customization
- Difficulty profiles: Easy, Normal, Hard, Brutal, True Master, Legendary
- Custom profile creation and persistence
- School color customization
- **Configurable divider colors** (school-based or custom)
- Configurable hotkey
- **How-to-Learn slide-out panel** with context-aware guidance
- **Learning status badges** (LOCKED, STUDYING, WEAKENED, PRACTICING, MASTERED)
- **Effectiveness percentage display** for early-learned spells
- **Multi-prerequisite preservation toggle**

---

## Data Flow

### Spell Scanning Flow
```
User clicks "Scan" → SpellScanner::ScanAllSpells()
  → Iterate all SpellItem forms
  → Extract properties → Generate JSON + LLM prompt
  → Send to UI → Display in text area
```

### Tree Generation Flow
```
User clicks "Full Auto" → Send scan data to OpenRouter LLM
  → LLM generates tree JSON with prerequisites
  → Parse response → Validate spell references
  → Check reachability (all nodes reachable from root via prerequisites)
  
  If unreachable nodes detected:
    → Request LLM self-correction (up to N attempts)
    → If still unreachable after max attempts:
      → Apply gentle auto-fix (add missing prerequisite links)
      → Re-validate after fix
      → Track schools needing attention if still unreachable
  
  → Render tree in WheelRenderer
  → Save to spell_tree.json
  → Show retry UI for schools needing attention
```

### Tree Validation System

**Purpose:** Ensure all spells in generated trees are reachable (can be learned by the player).

**Validation Steps:**
1. **Reachability Check** - Simulate unlocking from root node, verify all nodes become reachable
2. **LLM Self-Correction** - If unreachable nodes, ask LLM to fix its own output (configurable max loops)
3. **Gentle Auto-Fix** - If max correction loops reached, programmatically add missing prerequisite links
4. **Post-Fix Validation** - Re-check reachability after auto-fix
5. **Needs Attention Tracking** - Track schools with remaining unreachable nodes for manual retry

**Key State:**
```javascript
state.llmStats = {
    totalSpells: 0,
    processedSpells: 0,
    failedSchools: [],           // Schools that failed to generate
    successSchools: [],          // Successfully processed schools
    needsAttentionSchools: []    // Schools with unreachable nodes after auto-fix
};
```

**Retry Functionality:**
- Schools with unreachable nodes tracked in `needsAttentionSchools`
- UI dropdown in Settings > Validation allows selecting problem schools
- `retrySpecificSchool(schoolName)` regenerates just that school
- Avoids duplicate school names in success list

**Key Functions (llmIntegration.js):**
- `processLLMResponse()` - Main response handler with validation flow
- `sendCorrectionRequest()` - Request LLM to fix unreachable nodes
- `retrySpecificSchool(schoolName)` - Regenerate single school
- `getSchoolsNeedingAttention()` - Get list of problem schools
- `finishLLMGeneration()` - Summary with attention tracking

**Key Functions (treeParser.js):**
- `getUnreachableNodesInfo(school, rootId)` - Analyze reachability, return unreachable nodes
- `detectAndFixCycles(school, rootId)` - Apply gentle auto-fix (add missing prereq links)

**Key Functions (settingsPanel.js):**
- `updateRetrySchoolUI()` - Populate retry dropdown with problem schools

### XP Progression Flow (with Early Learning)
```
Player casts spell → SpellCastHandler::ProcessEvent()
  → Identify spell school → ProgressionManager::OnSpellCast()
  → Calculate XP (direct/school/any multipliers, self-cast bonus)
  → Update progress
  → If progress >= unlockThreshold (e.g., 30%):
      → SpellEffectivenessHook::GrantEarlySpell() - Add spell to player (nerfed)
  → If progress == 100%:
      → SpellEffectivenessHook::MarkMastered() - Full power restored
      → ClearLearningTargetForSpell() - Auto-select next spell
  → Notify UI
```

### Spell Effectiveness Flow (Runtime)
```
Spell cast by player → ActiveEffect created
  → ActiveEffect::AdjustForPerks() called
  → SpellEffectivenessHook intercepts
  → Check if spell is early-learned
  → Calculate effectiveness based on XP progress
  → Scale magnitude (e.g., 20% → 70% → 100%)
  → Binary effects: blocked entirely below threshold
```

### ISL Integration Flow
```
Player reads spell tome → ISL fires OnSpellTomeRead
  → SpellLearning_ISL_Handler receives event
  → Call native SpellLearning_ISL.OnTomeRead()
  → ISLIntegration::OnSpellTomeRead()
  → Calculate XP (hours * xpPerHour * tomeBonus)
  → Grant XP via ProgressionManager
```

---

## Configuration

### Unified Config (JSON)

All settings stored in single config file, managed through UI:

```json
{
  "hotkey": "F9",
  "hotkeyCode": 67,
  "cheatMode": false,
  "activeProfile": "normal",
  
  "learningMode": "perSchool",
  "xpGlobalMultiplier": 1,
  "xpMultiplierDirect": 100,
  "xpMultiplierSchool": 50,
  "xpMultiplierAny": 10,
  
  "xpNovice": 100,
  "xpApprentice": 200,
  "xpAdept": 400,
  "xpExpert": 800,
  "xpMaster": 1500,
  
  "revealName": 10,
  "revealEffects": 25,
  "revealDescription": 50,
  
  "discoveryMode": false,
  "nodeSizeScaling": true,
  
  "earlySpellLearning": {
    "enabled": true,
    "unlockThreshold": 30,
    "minEffectiveness": 20,
    "maxEffectiveness": 70,
    "selfCastRequiredAt": 67,
    "selfCastXPMultiplier": 1.5,
    "binaryEffectThreshold": 50
  },
  
  "islEnabled": true,
  "islXpPerHour": 50,
  "islTomeBonus": 25,
  
  "dividerColorMode": "school",
  "dividerCustomColor": "#ffffff",
  "preserveMultiPrereqs": true,
  
  "schoolColors": {...},
  "customProfiles": {...},
  "llm": {...}
}
```

---

## File Structure

```
SpellLearning/
├── plugin/src/
│   ├── Main.cpp                  ✅ Entry point, event registration, serialization
│   ├── PCH.h                     ✅ Precompiled header
│   ├── SpellScanner.cpp/h        ✅ Spell enumeration
│   ├── UIManager.cpp/h           ✅ PrismaUI bridge, unified config
│   ├── ProgressionManager.cpp/h  ✅ XP tracking, early grant/mastery
│   ├── SpellCastHandler.cpp/h    ✅ Spell cast events
│   ├── SpellEffectivenessHook.cpp/h ✅ Runtime magnitude scaling
│   ├── OpenRouterAPI.cpp/h       ✅ LLM API client
│   ├── ISLIntegration.cpp/h      ✅ ISL mod integration
│   ├── SpellCastXPSource.cpp/h   ✅ XP source implementation
│   ├── XPSource.h                ✅ XP source interface
│   └── UICallbacks.h             ✅ UI callback declarations
├── Scripts/Source/
│   ├── SpellLearning_Bridge.psc      ✅ Main bridge script
│   ├── SpellLearning_ISL.psc         ✅ Native function stubs
│   └── SpellLearning_ISL_Handler.psc ✅ Event handler
├── PrismaUI/views/SpellLearning/
│   └── SpellLearningPanel/       ✅ Main UI (modularized)
│       ├── index.html            ✅ UI structure + module loading
│       ├── styles.css            ✅ All styling
│       ├── script.js             ✅ Main app logic (802 lines)
│       └── modules/              ✅ 17 JavaScript modules
│           ├── constants.js      ✅ Constants, profiles, keycodes
│           ├── state.js          ✅ Settings and state objects
│           ├── config.js         ✅ Tree configuration
│           ├── spellCache.js     ✅ Spell data caching
│           ├── colorUtils.js     ✅ Color management
│           ├── uiHelpers.js      ✅ UI utilities
│           ├── growthDSL.js      ✅ Growth style DSL
│           ├── treeParser.js     ✅ Tree parsing/validation
│           ├── wheelRenderer.js  ✅ SVG radial renderer
│           ├── settingsPanel.js  ✅ Settings UI
│           ├── treeViewerUI.js   ✅ Tree viewer UI
│           ├── progressionUI.js  ✅ Progression system UI
│           ├── difficultyProfiles.js ✅ Profile management
│           ├── llmApiSettings.js ✅ LLM API config
│           ├── buttonHandlers.js ✅ Button event handlers
│           ├── cppCallbacks.js   ✅ C++ callback handlers
│           └── llmIntegration.js ✅ LLM integration
├── esp/
│   └── ESP_SETUP_GUIDE.md        ✅ ESP creation instructions
└── docs/
    ├── ARCHITECTURE.md           ✅ This file
    ├── ISL_INTEGRATION.md        ✅ ISL integration details
    └── COMMON-ERRORS.md          ✅ Troubleshooting guide
```

---

## Deployment Structure

```
MO2/mods/SpellLearning_RELEASE/
├── PrismaUI/
│   └── views/
│       └── SpellLearning/           # Must match CreateView path!
│           └── SpellLearningPanel/
│               ├── index.html
│               ├── script.js        # Main app (802 lines)
│               ├── styles.css
│               └── modules/         # 17 JavaScript modules
│                   ├── constants.js
│                   ├── state.js
│                   ├── config.js
│                   ├── spellCache.js
│                   ├── colorUtils.js
│                   ├── uiHelpers.js
│                   ├── growthDSL.js
│                   ├── treeParser.js
│                   ├── wheelRenderer.js
│                   ├── settingsPanel.js
│                   ├── treeViewerUI.js
│                   ├── progressionUI.js
│                   ├── difficultyProfiles.js
│                   ├── llmApiSettings.js
│                   ├── buttonHandlers.js
│                   ├── cppCallbacks.js
│                   └── llmIntegration.js
├── Scripts/
│   ├── SpellLearning_Bridge.pex
│   └── Source/
│       └── *.psc
├── SKSE/
│   └── Plugins/
│       ├── SpellLearning.dll
│       └── SpellLearning/
│           └── custom_prompts/
└── (ESP if applicable)
```

---

## Implementation Status

### ✅ Completed
- PrismaUI panel with tabbed interface
- Spell scanning (all spells from plugins)
- LLM integration (OpenRouter API)
- Tree visualization (radial layout)
- Progression system (XP tracking, multipliers)
- SKSE co-save persistence
- ISL-DESTified integration (multiple plugin names)
- Difficulty profile system (6 presets + custom)
- Progressive revelation (name/effects/description)
- Discovery Mode (hide locked, show ??? previews)
- Tier-based node sizing
- School color customization
- Configurable hotkey
- **Early Spell Learning (grant at threshold)**
- **Progressive Effectiveness (runtime magnitude scaling)**
- **Self-cast XP bonus after threshold**
- **Binary effect threshold handling**
- **How-to-Learn info panel**
- **Learning status badges**
- **Divider color customization**
- **Multi-prerequisite preservation option**
- **Growth Style Generator (LLM-driven visuals)**
- **Tree Generation Validation (reachability check, auto-fix, retry UI)**

### 🔄 Planned Improvements
- Viewport culling for large trees
- Level-of-detail rendering
- ISL Papyrus event hooks (quest/alias setup)
- Additional XP sources

### ✅ Recently Completed (Jan 28, 2026)

#### Tree Generation Validation System
- **Reachability validation:** Check that all generated nodes are reachable from root via prerequisites
- **LLM self-correction:** Request LLM to fix unreachable nodes (configurable max loops, default 5)
- **Gentle auto-fix:** Programmatically add missing prerequisite links when LLM can't fix
- **Post-fix validation:** Re-check after auto-fix to confirm fix worked
- **Needs attention tracking:** Track schools with remaining unreachable nodes
- **Retry school UI:** Dropdown to retry generation for specific problematic schools
- **Fixed duplicate school logging:** Schools no longer appear multiple times in success list during correction loops
- **Stray response handling:** Ignore responses that arrive after generation finishes

#### Previous Updates
- **Code modularization:** Split 8000+ line `script.js` into 17 focused modules
  - 16 of 18 files now under 1000 lines (LLM-friendly)
  - Main `script.js` reduced by 90% (8190 → 802 lines)
  - All functionality preserved, tested working
- **Early-learned vs Mastered distinction:**
  - Early-learned spells (20-99% XP) do NOT unlock children
  - Only mastered spells (100% XP) allow children to become available
  - `recalculateNodeAvailability()` checks actual XP progress, not just spell ownership
- **Direct prerequisite XP tracking:**
  - UI sends prerequisite list when setting learning target
  - C++ uses list to determine XP source (direct prereq gets 50% cap vs 15% school cap)
- **Power step system:**
  - 6 discrete power levels instead of linear scaling
  - Configurable thresholds and power values
  - Labels: Budding → Developing → Practicing → Advancing → Refining → Mastered
- **Display hooks (optional):**
  - `SpellItem::GetFullName` vtable hook for "(Learning - X%)" in game menus
  - Controlled by `modifyGameDisplay` setting
- **Progressive reveal improvements:**
  - Tooltip respects `revealName` threshold (default 10%)
  - Node labels respect reveal threshold (not just in discoveryMode)
  - Details panel refreshes on XP gain (dynamic reveal)
- **Auto-refresh on panel open:**
  - `GetPlayerKnownSpells` called when panel becomes visible
  - Catches spells learned from other sources (console, other mods)
- **ISL integration UI hidden:**
  - Settings panel section commented out until Papyrus hooks implemented
  - C++ detection still runs, just no user-facing settings

---

## Key APIs

### CommonLibSSE-NG
- `RE::TESSpellCastEvent` - Spell cast detection
- `RE::TESDataHandler` - Form enumeration
- `RE::PlayerCharacter` - Player reference
- `RE::SpellItem` - Spell data
- `RE::TESObjectBOOK` - Spell tome data
- `RE::ActiveEffect` - Runtime spell effect (magnitude scaling)
- `RE::EffectArchetype` - Effect type classification
- `RE::ActorHandle` / `RE::NiPointer` - Reference handling

### SKSE
- `SKSE::SerializationInterface` - Co-save persistence
- `SKSE::MessagingInterface` - Game lifecycle events
- `SKSE::PapyrusInterface` - Native function registration

### PrismaUI
- View registration and JS execution
- Hotkey handling
- C++ ↔ JS communication via `InteropCall` / `window.callCpp`

---

## Notes for LLMs

- **LLM determines tree structure** - Prerequisites, XP requirements based on spell analysis
- **Progressive revelation** - Spell details hidden until XP thresholds reached
- **Discovery Mode** - Enabled by default for Brutal+ difficulties

### Early Learning Flow (CRITICAL DISTINCTION)
1. Player selects spell as learning target
2. At `unlockThreshold` (default 20%), spell granted but **WEAKENED**
3. **IMPORTANT:** Early-learned spell does NOT unlock children!
   - Node state stays "available" (not "unlocked")
   - Children remain LOCKED until 100% mastery
4. Effectiveness follows **discrete power steps** (not linear):
   - 25% XP → 20% power (Budding)
   - 40% XP → 35% power (Developing)
   - 55% XP → 50% power (Practicing)
   - 70% XP → 65% power (Advancing)
   - 85% XP → 80% power (Refining)
5. After `selfCastRequiredAt` (67%), player must cast the spell itself
6. At **100% mastery:**
   - Spell gains full power (breakthrough moment)
   - Node state changes to "unlocked"
   - **NOW children become available**

### State Distinction
| XP Progress | Player Has Spell? | Node State | Children |
|-------------|-------------------|------------|----------|
| 0-19% | No | available/learning | Locked |
| 20-99% | Yes (weakened) | available | **Still Locked** |
| 100% | Yes (full power) | **unlocked** | **Available** |

### Other Notes
- **One target per school** - In "perSchool" mode, can learn multiple spells simultaneously
- **All progress saved** - Every spell tracks XP, not just active targets
- **Runtime magnitude scaling** - No save modification, pure runtime hooks
- **Binary effects** - Paralysis, Invisibility blocked entirely below 80% effectiveness
- **Direct prerequisite tracking** - UI sends prereq list to C++ for proper XP source detection
- **ISL integration optional** - UI hidden until Papyrus hooks implemented
- **PrismaUI path critical** - CreateView path must exactly match deployment path
- **Panel auto-refresh** - GetPlayerKnownSpells called when panel opens (catches external spell learning)
