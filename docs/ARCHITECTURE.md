# Spell Learning System - Architecture

**Purpose:** Concise reference for LLMs to understand system structure and implementation status.

**Version:** 1.9 (Updated February 7, 2026 - Per-school shapes, LLM keyword classification, plugin whitelist, module inventory)

---

## System Overview

**What It Does:**
- Scans all spells from loaded plugins
- Generates AI-driven spell learning tree with prerequisites (OpenRouter LLM or Python builder)
- Tracks XP-based progression (casting prerequisites, tome study, spell tome hook)
- Displays interactive tree UI (PrismaUI) with configurable hotkey (default F8)
- Progressive revelation system (names/effects/descriptions unlock with XP)
- Discovery Mode: progressive tree reveal based on XP progress
- Difficulty profile system with 6 presets and custom profiles
- **Early Spell Learning:** Spells granted early but nerfed, scaling with progress
- **Progressive Effectiveness:** Runtime spell magnitude scaling via C++ hooks
- **Spell Tome Hook:** Intercepts tome reading to grant XP instead of instant learning
- **FormID Persistence:** Spell trees survive load order changes via plugin-relative IDs
- **Per-School Shapes:** Each magic school gets a distinct visual shape (explosion, tree, mountain, portals, organic)
- **LLM Keyword Classification:** Batched LLM classification of spells with weak/missing keywords (optional)
- **Plugin Whitelist:** Per-plugin opt-in/out filtering for spell tree generation
- **BUILD TREE (Complex):** Python NLP (fuzzy + LLM config) → JS SettingsAwareTreeBuilder; requires embedded Python
- **BUILD TREE (Simple):** Pure JS procedural builder (no Python); keyword themes, tier-based links
- **Visual-First / Edit Mode:** Manual drag-drop and in-tree editing (add/remove nodes, links)

**Core Flow:**
```
Scan Spells → Generate Tree (LLM/Python) → Validate FormIDs → Display Tree → Track XP → Grant Early (nerfed) → Reveal Details → Master Spells
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
- `GetPersistentFormId(formId)` - Convert runtime FormID to `PluginName.esp|0x00123456` format
- `ResolvePersistentFormId(persistentId)` - Resolve persistent ID back to runtime FormID
- `ValidateAndFixTree(treeData)` - Validate all FormIDs in tree, resolve from persistentId if stale
- `IsFormIdValid(formId)` - Check if a FormID resolves to a valid form

**FormID Persistence:**
```
Runtime FormID (e.g. 0x02001234) → "Skyrim.esm|0x001234"
- Top byte = mod index (or 0xFE for ESL)
- ESL: bits [12:23] = light index, bits [0:11] = local ID
- Regular: bits [0:23] = local ID
- On tree load, stale FormIDs auto-resolved from persistentId field
```

### 2. **UIManager** (`plugin/src/UIManager.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- PrismaUI view registration and communication
- Hotkey handling (configurable, default F8; scancode 66)
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
**CRITICAL:** Deploy path must match exactly (project name = HeartOfMagic):
```
MO2/mods/HeartOfMagic_RELEASE/PrismaUI/views/SpellLearning/SpellLearningPanel/
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
- **Throttled notifications** (configurable interval, default 10 seconds)
- **Weakened spell notifications** (configurable on/off)
- Batch XP updates to UI

**Key Functions:**
- `Register()` - Register for SKSE events
- `ProcessEvent(event)` - Handle spell cast
- `SetNotificationInterval()` / `GetNotificationInterval()` - Notification throttling
- `SetWeakenedNotificationsEnabled()` / `GetWeakenedNotificationsEnabled()`

### 5b. **SpellTomeHook** (`plugin/src/SpellTomeHook.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Hook `TESObjectBOOK::ProcessBook` to intercept spell tome reading
- When spell is in learning system: grant XP, set learning target, keep book
- When spell is NOT in system: let vanilla proceed (teach + consume)
- Configurable XP grant per read (default 25% of required)
- **Tome inventory boost** - bonus XP while tome in inventory (25%)
- Prerequisite checking before allowing tome XP
- Based on "Don't Eat Spell Tomes" pattern by Exit-9B

**Settings:**
```cpp
bool enabled = true;
bool grantXPOnRead = true;
bool autoSetLearningTarget = true;
bool showNotifications = true;
float xpPercentToGrant = 25.0;        // % of required XP per tome read
float tomeInventoryBoostPercent = 25.0; // Bonus while tome in inventory
```

**Key Functions:**
- `Install()` - Install vtable hook
- `OnSpellTomeRead()` - Internal hook handler
- `GetSettings()` / `SetSettings()` - Configuration

### 6. **ISLIntegration / DEST** (`plugin/src/ISLIntegration.cpp/h`)
**Status:** ✅ Implemented (Bundled as DEST)

**Note:** Renamed from ISL to DEST (Don't Eat Spell Tomes). DEST is now bundled with
the mod - always available. SpellTomeHook handles the core tome interception in C++.

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
- HTTP client for OpenRouter API (Claude, GPT, etc.)
- Async prompt sending with background threads
- WinHTTP for HTTPS POST
- UTF-8 sanitization for invalid sequences from LLM output
- Config persistence at `Data/SKSE/Plugins/SpellLearning/openrouter_config.json`
- Default model: `anthropic/claude-sonnet-4`, max tokens: 64000

**Key Functions:**
- `Initialize()` - Load config
- `SendPromptAsync(systemPrompt, userPrompt, callback)` - Background thread
- `SendPrompt(systemPrompt, userPrompt)` - Blocking call
- `GetConfig()` / `SaveConfig()` - Persistence

### 8. **PythonInstaller** (`plugin/src/PythonInstaller.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Download and install embedded Python 3.12.8 for Complex Build mode
- Background thread worker with progress reporting
- WinHTTP for file downloads, PowerShell for ZIP extraction
- Enables site-packages, installs pip and requirements
- Progress reporting to UI via PrismaUI InteropCall

**Stages:** Python download → ZIP extract → pip setup → package install → config

**Key Functions:**
- `StartInstall(prismaUI, view)` - Start background installation
- `Cancel()` - Abort installation
- `IsInstalling()` - Status check

### 9. **PapyrusAPI** (`plugin/src/PapyrusAPI.cpp/h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Expose C++ functions to Papyrus scripts for inter-mod communication

**Papyrus Functions:**
```papyrus
SpellLearning.OpenMenu()      ; Show UI
SpellLearning.CloseMenu()     ; Hide UI
SpellLearning.ToggleMenu()    ; Toggle UI
SpellLearning.IsMenuOpen()    ; Query state
SpellLearning.GetVersion()    ; Version string
```

**ModEvents Sent:**
- `SpellLearning_MenuOpened` / `SpellLearning_MenuClosed`

---

## Performance Optimizations

### C++ Plugin Performance (Feb 2026)
- **`std::shared_mutex`** for read-heavy concurrent access (replaces `std::mutex`)
  - Read operations use `std::shared_lock` (non-blocking concurrent reads)
  - Write operations use `std::unique_lock` (exclusive access)
- **Cached player pointer** in AdjustForPerks hook (avoids `GetSingleton()` per-effect)
- **`std::call_once`** for thread-safe one-time debug logging
- **Static regex** compilation for description parsing
- **Early exit** in hot path for NPC casters (most common case)

---

## PrismaUI Frontend

### SpellLearningPanel (`PrismaUI/views/SpellLearning/SpellLearningPanel/`)

**Architecture:** Modular JavaScript (39 modules). See `index.html` for exact load order.

**Core Files:**
- `index.html` - UI structure, module load order
- `styles.css` + `styles-skyrim.css` - Styling (dark theme + Skyrim theme)
- `script.js` - Main initialization, tabs, button wiring (e.g. proceduralBtn → onProceduralClick), early learning helpers

**JavaScript Modules (`modules/`) – key ones:**

| Module | Purpose |
|--------|---------|
| **Configuration** | |
| `constants.js` | Default prompts, difficulty profiles, color palettes, power steps |
| `state.js` | `settings`, `state`, `customProfiles`, `xpOverrides`, `pluginWhitelist` |
| `config.js` | `TREE_CONFIG` layout and visual configuration |
| **Tree building (user-facing)** | |
| `edgeScoring.js` | Unified edge scoring (element, tier, keyword); used by SettingsAwareBuilder |
| `shapeProfiles.js` | 12 shape profiles + masks (organic, explosion, tree, mountain, portals, spiky, radial, cloud, cascade, swords, grid, linear); per-school defaults |
| `layoutEngine.js` | BFS growth layout, density stretch, shape mask conformity passes |
| `settingsAwareTreeBuilder.js` | **Complex Build:** settings-driven tree (element isolation, convergence); consumes Python fuzzy data |
| `proceduralTreeBuilder.js` | **Simple Build:** `buildProceduralTrees()` (JS only). Also orchestrates **Complex:** `startVisualFirstGenerate()` → Python → `doVisualFirstGenerate()` → `buildAllTreesSettingsAware()`. Plugin whitelist filtering |
| `visualFirstBuilder.js` | Visual-first layout + spell assignment; calls SettingsAwareBuilder when available |
| `layoutGenerator.js` | Node position (angles, radii) |
| `growthBehaviors.js` | Branching energy, themed groups |
| **Parsers & rendering** | |
| `treeParser.js` | Tree JSON → nodes/edges; validation, cycle detection, auto-fix |
| `growthDSL.js` | Growth recipe/DSL for tree visuals |
| `wheelRenderer.js` | Main 2D radial wheel rendering |
| `canvasRenderer.js` | Canvas 2D rendering |
| `editMode.js` | Tree editing (add/remove nodes, modify links) |
| **UI & callbacks** | |
| `settingsPanel.js` | Settings UI, config persistence, retry school UI, plugin whitelist modal |
| `treeViewerUI.js` | Tree viewer, spell details, node selection |
| `progressionUI.js` | How-to-Learn panel, learning status badges |
| `difficultyProfiles.js` | Profile management, presets, custom profiles |
| `generationModeUI.js` | Generation UI (seed, LLM options); dev-only rows |
| `cppCallbacks.js` | C++ ↔ JS (e.g. ProceduralPythonGenerate, GetProgress); enables Complex/Simple buttons when spells loaded |
| `llmIntegration.js` | LLM tree generation (AUTO AI), validation, retry |
| `llmTreeFeatures.js` | LLM preprocessing: auto-config, keyword expansion, **keyword classification**; batched per-school classification |
| `llmApiSettings.js` | LLM API configuration (model, endpoint, API key) |
| `buttonHandlers.js` | Button click routing and UI state management |
| `pythonSetup.js` | Python installation UI |
| **Utilities & effects** | |
| `spellCache.js` | Spell data caching |
| `colorUtils.js` | Color manipulation utilities |
| `colorPicker.js` | Color picker UI component |
| `uiHelpers.js` | Shared UI helper functions |
| `starfield.js` | Starfield background effect |
| `globe3D.js` | 3D globe visualization (experimental) |
| `webglRenderer.js` | WebGL rendering backend |
| `webglShaders.js` | WebGL shader programs |
| `webglShapes.js` | WebGL shape primitives |
| **Testing & entry** | |
| `autoTest.js` | Automated test harness |
| `unificationTest.js` | Module unification tests |
| `main.js` | Entry point, initialization |

**Module load order:** See `index.html`. Order is: constants/state/config → edgeScoring/shapeProfiles/layoutEngine → spellCache/colorUtils/uiHelpers → growthDSL/treeParser → wheel/starfield/globe/canvas/editMode → colorPicker/settingsPanel/treeViewerUI/… → cppCallbacks/pythonSetup/llmIntegration/proceduralTreeBuilder → layoutGenerator/growthBehaviors/visualFirstBuilder/llmTreeFeatures/settingsAwareTreeBuilder → generationModeUI → script.js → autoTest/unificationTest → main.js.

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
- **Per-school default shapes** (Destruction=explosion, Restoration=tree, Alteration=mountain, Conjuration=portals, Illusion=organic)
- **Plugin whitelist/blacklist** for controlling which plugins are included in tree generation

---

## Python Tree Builder (`SKSE/Plugins/SpellLearning/SpellTreeBuilder/`)

**Purpose:** NLP-based spell tree generation using TF-IDF theme discovery, fuzzy matching, optional LLM auto-configuration, and optional LLM keyword classification. Called from C++ via embedded Python 3.12.

### Core Modules

| Module | Purpose |
|--------|---------|
| `build_tree.py` | Main entry point. Orchestrates config, LLM features, theme discovery, tree building. Called by C++ `ProceduralPythonGenerate` |
| `tree_builder.py` | `SpellTreeBuilder` class. Per-school tree construction, theme assignment, node linking. Defines `SCHOOL_DEFAULT_SHAPES` |
| `spell_grouper.py` | `group_spells_best_fit()` — Groups spells into themes using fuzzy score. Honors `llm_keyword` for reclassification |
| `theme_discovery.py` | TF-IDF theme discovery per school. Extracts keyword themes from spell names/descriptions/effects |
| `config.py` | `TreeBuilderConfig` dataclass. All settings including `llm_auto_configure`, `llm_group_naming`, `llm_keyword_classification` |
| `llm_client.py` | OpenRouter LLM client. `call_json()` for structured responses, configurable model/endpoint/temperature |
| `keyword_classifier.py` | **LLM keyword classification.** Batched (100/school) classification of spells with weak/missing keywords. Assigns `llm_keyword`, `llm_keyword_parent`, `llm_keyword_confidence` |
| `validator.py` | Tree validation (reachability checks) |

### Shape Algorithms (`shapes/`)

8 Python shape algorithms that determine tree structure (node linking patterns):

| Shape | Description |
|-------|-------------|
| `shape_organic.py` | Natural flowing growth |
| `shape_radial.py` | Fan-like radial spread |
| `shape_grid.py` | Grid-based layout |
| `shape_linear.py` | Linear beam progression |
| `shape_cascade.py` | Cascading waterfall tiers |
| `shape_mountain.py` | Wide base tapering to peak |
| `shape_spiky.py` | Angular crystal spikes |
| `shape_cloud.py` | Clustered cloud groups |

**Note:** JS-side `shapeProfiles.js` has 12 visual shapes (adds `tree`, `explosion`, `portals`, `swords`). Python shapes affect tree *structure*, JS shapes affect *visual layout*.

### Per-School Default Shapes

```python
SCHOOL_DEFAULT_SHAPES = {
    'Destruction': 'explosion',   # Dense core bursting outward
    'Restoration': 'tree',        # Trunk with branches and canopy
    'Alteration': 'mountain',     # Wide base tapering to peak
    'Conjuration': 'portals',     # Organic fill with doorway arch
    'Illusion': 'organic',        # Natural flowing spread
}
```

Applied when LLM auto-config is disabled (default). Defined in both `tree_builder.py` and `shapeProfiles.js`.

### Growth Behaviors (`growth/`)

| Module | Purpose |
|--------|---------|
| `auto_configure.py` | LLM-driven shape/growth auto-configuration |
| `branching_energy.py` | Branch energy distribution |
| `themed_groups.py` | Theme-aware grouping |

### Core Utilities (`core/`)

| Module | Purpose |
|--------|---------|
| `node.py` | `TreeNode` data class |
| `registry.py` | Shape/growth registry |
| `math_utils.py` | Math utilities |
| `spacing.py` | Spacing calculations |

### LLM Keyword Classification Pipeline

When enabled (`llm_keyword_classification.enabled = true`):

```
Scan spells → Theme discovery (TF-IDF) → Identify weak spells (fuzzy score < 30)
  → Batch 100 per school → LLM classifies → Merge results (llm_keyword, llm_keyword_parent)
  → tree_builder checks llm_keyword BEFORE fuzzy matching → spell_grouper reclassifies from _unassigned
```

Config:
```python
llm_keyword_classification: {
    "enabled": False,      # Off by default
    "batch_size": 100,     # Spells per LLM call
    "min_confidence": 40,  # Minimum confidence to accept
}
```

---

## Data Flow

### Spell Scanning Flow
```
User clicks "Scan" → SpellScanner::ScanAllSpells()
  → Iterate all SpellItem forms
  → Extract properties → Generate JSON + LLM prompt
  → Send to UI → Display in text area
```

### Tree Generation Flow (user-facing modes, outside developer mode)

**BUILD TREE (Complex)** — `visualFirstBtn` → `startVisualFirstGenerate()`:
1. `startVisualFirstPythonConfig()`: build config (fuzzy + optional LLM), call C++ `ProceduralPythonGenerate` (runs Python `build_tree.py` with `run_fuzzy_analysis`, `return_fuzzy_data`).
2. Python returns: school configs + fuzzy data (themes, groups, relationships).
3. `onProceduralPythonComplete` → `doVisualFirstGenerate(schoolConfigs, fuzzyData)`.
4. `doVisualFirstGenerate` calls **`buildAllTreesSettingsAware(spells, finalConfigs, settings.treeGeneration, fuzzy)`** (settingsAwareTreeBuilder.js); applies LayoutEngine for positions; then TreeParser → render.

**BUILD TREE (Simple)** — `proceduralBtn` (click bound in script.js) → `onProceduralClick()` → `startProceduralGenerate()`:
1. **`buildProceduralTrees(state.lastSpellData.spells)`** (proceduralTreeBuilder.js): JS-only; keyword theme discovery, tier-based links, convergence, orphans. No Python.
2. Output → TreeParser → render.

**Developer-only:** AUTO COMPLEX (`proceduralPlusBtn`) = Python full tree build (TF-IDF, shapes). AUTO AI (`fullAutoBtn`) = LLM generates full tree (see Tree Validation System below for reachability/retry).

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
  → If progress >= unlockThreshold (default 25%):
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

### Spell Tome Hook Flow
```
Player reads spell tome → TESObjectBOOK::ProcessBook hooked
  → SpellTomeHook intercepts BEFORE vanilla script
  → Check if spell is in learning tree
  → YES: Grant XP (25% of required), set learning target, keep book, DON'T teach
  → NO: Let vanilla proceed (teaches spell + consumes book)
  → Update UI with progress
```

### FormID Validation Flow (on tree load)
```
Load spell_tree.json → For each node:
  → Try to resolve runtime FormID
  → If invalid (load order changed):
    → Check for persistentId field ("Plugin.esp|0x001234")
    → ResolvePersistentFormId() → Get new runtime FormID
    → Update node with resolved FormID
  → Auto-save corrected tree
  → Report validation results to UI
```

### ISL/DEST Integration Flow (Legacy)
```
Player reads spell tome → DEST fires OnSpellTomeRead
  → SpellLearning_DEST_Handler receives event
  → Call native DEST functions
  → ISLIntegration::OnSpellTomeRead()
  → Calculate XP → Grant via ProgressionManager
```

---

## Configuration

### Unified Config (JSON)

All settings stored in single config file, managed through UI:

```json
{
  "hotkey": "F8",
  "hotkeyCode": 66,
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

  "notifications": {
    "weakenedSpellNotifications": true,
    "weakenedSpellInterval": 10
  },

  "spellBlacklist": [],
  "pluginWhitelist": [],

  "schoolColors": {...},
  "customProfiles": {...},
  "treeGeneration": {
    "llm": {
      "enabled": false,
      "autoConfig": false,
      "keywordExpansion": false,
      "groupNaming": false,
      "keywordClassification": false
    }
  },
  "llm": {...}
}
```

---

## File Structure

```
HeartOfMagic/
├── plugin/src/
│   ├── Main.cpp                     ✅ Entry point, event registration, serialization
│   ├── PCH.h                        ✅ Precompiled header
│   ├── PrismaUI_API.h               ✅ PrismaUI modder interface
│   ├── SpellScanner.cpp/h           ✅ Spell enumeration, FormID persistence
│   ├── UIManager.cpp/h              ✅ PrismaUI bridge, unified config, 41 JS listeners
│   ├── UICallbacks.h                ✅ UI callback declarations (categorized)
│   ├── ProgressionManager.cpp/h     ✅ XP tracking, early grant/mastery, co-save
│   ├── SpellCastHandler.cpp/h       ✅ Spell cast events, notification throttling
│   ├── SpellEffectivenessHook.cpp/h ✅ Runtime magnitude scaling, shared_mutex
│   ├── SpellTomeHook.cpp/h          ✅ Tome interception, XP grant, keep book
│   ├── OpenRouterAPI.cpp/h          ✅ LLM API client (OpenRouter/WinHTTP)
│   ├── PythonInstaller.cpp/h        ✅ Embedded Python auto-installer
│   ├── PapyrusAPI.cpp/h             ✅ Papyrus native function bindings
│   ├── ISLIntegration.cpp/h         ✅ DEST mod integration (bundled)
│   ├── SpellCastXPSource.cpp/h      ✅ XP source implementation
│   └── XPSource.h                   ✅ XP source interface
├── Scripts/Source/
│   ├── SpellLearning_QuestScript.psc  ✅ Quest initialization
│   ├── SpellLearning_Bridge.psc       ⚠️ Legacy SkyrimNet bridge (unused)
│   ├── SpellLearning_DEST.psc         ✅ DEST native function stubs
│   ├── SpellLearning_DEST_Handler.psc ✅ DEST event handler
│   ├── SpellLearning_ISL.psc          ✅ ISL native function stubs
│   ├── SpellLearning_ISL_Handler.psc  ✅ ISL event handler
│   └── DEST_FormExt.psc               ✅ Form extension for DEST
├── PrismaUI/views/SpellLearning/
│   └── SpellLearningPanel/          ✅ Main UI (39 modules)
│       ├── index.html               ✅ UI structure + module loading
│       ├── styles.css               ✅ Default dark styling
│       ├── styles-skyrim.css        ✅ Skyrim-themed styling
│       ├── script.js                ✅ Main app logic
│       ├── themes/                  ✅ Theme definitions (default, skyrim)
│       └── modules/                 ✅ 39 JavaScript modules
├── SKSE/Plugins/SpellLearning/
│   ├── custom_prompts/              ✅ LLM prompt templates
│   └── SpellTreeBuilder/            ✅ Python tree generation tools
│       ├── build_tree.py            ✅ Main build script (orchestrator)
│       ├── tree_builder.py          ✅ SpellTreeBuilder class, SCHOOL_DEFAULT_SHAPES
│       ├── spell_grouper.py         ✅ Theme-based spell grouping
│       ├── theme_discovery.py       ✅ TF-IDF theme extraction
│       ├── keyword_classifier.py    ✅ LLM keyword classification (batched)
│       ├── llm_client.py            ✅ OpenRouter LLM client
│       ├── config.py                ✅ TreeBuilderConfig dataclass
│       ├── validator.py             ✅ Tree validation
│       ├── shapes/                  ✅ 8 tree shape algorithms
│       ├── growth/                  ✅ Growth behaviors (auto_configure, branching, themed)
│       └── core/                    ✅ Core utilities (node, registry, math, spacing)
└── docs/
    ├── ARCHITECTURE.md              ✅ This file
    ├── OVERVIEW.md                  ✅ High-level feature overview
    ├── DESIGN.md                    ✅ Design patterns
    ├── PROGRESSION_DESIGN.md        ✅ XP system design
    ├── QUICK_REFERENCE.md           ✅ Quick developer reference
    ├── TECHNICAL_RESEARCH.md        ✅ Technical deep-dives
    ├── COMMON-ERRORS.md             ✅ Troubleshooting guide
    └── LLM_PROMPT_TEMPLATE.md       ✅ LLM prompt design
```

---

## Deployment Structure

```
MO2/mods/HeartOfMagic_RELEASE/
├── PrismaUI/
│   └── views/
│       └── SpellLearning/              # Must match CreateView path!
│           └── SpellLearningPanel/
│               ├── index.html
│               ├── script.js
│               ├── styles.css
│               ├── styles-skyrim.css
│               ├── themes/
│               └── modules/            # 39 JavaScript modules
├── Scripts/
│   ├── *.pex                           # Compiled Papyrus
│   └── Source/
│       └── *.psc
├── SKSE/
│   └── Plugins/
│       ├── SpellLearning.dll
│       └── SpellLearning/
│           ├── custom_prompts/
│           └── SpellTreeBuilder/       # Python tree builder (optional)
│               ├── build_tree.py
│               ├── shapes/
│               ├── growth/
│               └── core/
└── (ESP if applicable)
```

---

## Implementation Status

### ✅ Completed
- PrismaUI panel with tabbed interface
- Spell scanning (all spells from plugins)
- LLM integration (OpenRouter API)
- Tree visualization (radial layout, canvas, WebGL, 3D globe)
- Progression system (XP tracking, multipliers)
- SKSE co-save persistence
- DEST integration (bundled)
- Difficulty profile system (6 presets + custom)
- Progressive revelation (name/effects/description)
- Discovery Mode (hide locked, show ??? previews)
- Tier-based node sizing
- School color customization
- Configurable hotkey
- Early Spell Learning (grant at threshold)
- Progressive Effectiveness (runtime magnitude scaling)
- Self-cast XP bonus after threshold
- Binary effect threshold handling
- How-to-Learn info panel
- Learning status badges
- Divider color customization
- Multi-prerequisite preservation option
- Growth Style Generator (LLM-driven visuals)
- Tree Generation Validation (reachability check, auto-fix, retry UI)
- Spell Tome Hook (intercepts tomes, grants XP, keeps book)
- Visual-First Builder (drag-drop tree creation)
- Edit Mode (add/remove nodes, modify links)
- Complex Build (Python-based tree generation)
- Embedded Python auto-installer
- FormID persistence (survives load order changes)
- Performance optimizations (shared_mutex, cached player pointer)
- Notification throttling (configurable interval)
- Spell blacklist system
- SkyrimNet → LLM rename (independent AI integration)
- Papyrus API for inter-mod communication
- Theme system (default + Skyrim theme)
- Starfield background effect
- Per-school default shapes (5 schools × distinct visual shapes)
- LLM keyword classification (batched per-school, optional)
- Plugin whitelist/blacklist filtering
- 12 visual shape profiles (organic, explosion, tree, mountain, portals, spiky, radial, cloud, cascade, swords, grid, linear)

### 🔄 Planned Improvements
- Viewport culling for large trees
- Level-of-detail rendering
- Additional XP sources

### ✅ Recently Completed (Feb 7, 2026)

#### Per-School Default Shapes
- **`SCHOOL_DEFAULT_SHAPES`** in both Python (`tree_builder.py`) and JS (`shapeProfiles.js`)
- Destruction=explosion, Restoration=tree, Alteration=mountain, Conjuration=portals, Illusion=organic
- Applied automatically when LLM auto-config is disabled
- Bug fix: `build_tree.py` fallback now uses per-school shapes instead of global `'organic'`

#### LLM Keyword Classification
- **`keyword_classifier.py`** — New Python module for batched LLM classification
- Classifies spells with weak/missing keywords (fuzzy score < 30)
- Batched 100 spells per LLM call, per school
- Results: `llm_keyword`, `llm_keyword_parent`, `llm_keyword_confidence` fields on spell dicts
- `tree_builder.py` checks `llm_keyword` before fuzzy matching
- `spell_grouper.py` reclassifies from `_unassigned` using LLM keywords
- JS UI: toggle in LLM Features, `[K] Classify Keywords` button on Spell Scan tab
- Default off — TF-IDF + fuzzy matching runs unchanged when disabled

#### Plugin Whitelist
- Per-plugin opt-in/out filtering for spell tree generation
- UI modal in Spell Scan tab for managing plugin list
- `pluginWhitelist` array in unified config (persistent)
- Base game plugins auto-detected and always included by default

#### 12 Visual Shape Profiles
- `shapeProfiles.js` expanded to 12 shapes with masks, conformity passes
- `layoutEngine.js` BFS growth with density stretch
- Shape-specific angular control and density multipliers

### ✅ Previous Updates (Feb 5, 2026)

#### Performance Optimizations
- **`std::shared_mutex`** replaces `std::mutex` in SpellEffectivenessHook for read-heavy access
- **Cached player pointer** in AdjustForPerks hook (avoids GetSingleton() per-effect)
- **`std::call_once`** for one-time debug logging
- **Static regex** for description parsing

#### FormID Persistence
- **Persistent FormID format:** `PluginName.esp|0x00123456` survives load order changes
- **Auto-validation on tree load:** Stale FormIDs resolved from persistentId field
- **ESL/light plugin support:** Correct handling of 0xFE prefix with 12-bit local IDs
- **Auto-save after fix:** Corrected tree saved immediately

#### SkyrimNet → LLM Rename
- All callback names updated (C++ RegisterJSListener + InteropCall)
- All JS state variables, functions, callbacks renamed
- CSS classes renamed (`.btn-skyrimnet` → `.btn-llm`)
- `skyrimNetIntegration.js` → `llmIntegration.js`
- `SKSE/Plugins/SkyrimNet/` → `SKSE/Plugins/SpellLearning/`
- Documentation updated throughout

### ✅ Earlier Updates (Jan 2026)
- Tree Generation Validation (reachability check, LLM self-correction, gentle auto-fix)
- Code modularization (8000+ line script.js → 39 focused modules)
- Early-learned vs Mastered distinction
- Direct prerequisite XP tracking
- Power step system (6 discrete levels)
- Display hooks (optional "(Learning - X%)" in game menus)
- Progressive reveal improvements
- Auto-refresh on panel open

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

## Related Docs

| Doc | Purpose |
|-----|---------|
| **BUILD-COMPLEX-TRACE.md** | Full phase-by-phase trace of BUILD TREE (Complex) from click to rendered tree |
| **OVERVIEW.md** | High-level product summary, user-facing features |
| **QUICK_REFERENCE.md** | Quick lookup: components, data formats, modules, XP |
| **DESIGN.md** | Design intent and tier checklist (Tiers 1–5 implemented) |
| **PROGRESSION_DESIGN.md** | XP and learning flow from player perspective |
| **COMMON-ERRORS.md** | Troubleshooting (UTF-8, path mismatch, DLL, etc.) |
| **TREE_LAYOUT_DESIGN.md** | Layout options (zone reservation, round-robin) |
| **SHAPE-AND-GROWTH-ASSESSMENT.md** | Shape/growth assessment; backlog placement; spell-count–scaled shapes |
| **TECHNICAL_RESEARCH.md** | API and integration research |

---

## Notes for LLMs

- **LLM determines tree structure** - Prerequisites, XP requirements based on spell analysis
- **Progressive revelation** - Spell details hidden until XP thresholds reached
- **Discovery Mode** - Enabled by default for Brutal+ difficulties

### Early Learning Flow (CRITICAL DISTINCTION)
1. Player selects spell as learning target
2. At `unlockThreshold` (default 25%), spell granted but **WEAKENED**
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
- **DEST integration bundled** - Always available (replaced ISL)
- **Spell Tome Hook** - Intercepts tome reading in C++, grants XP, keeps book
- **FormID persistence** - Trees survive load order changes via `PluginName.esp|0x123456` format
- **PrismaUI path critical** - CreateView path must exactly match deployment path
- **Panel auto-refresh** - GetPlayerKnownSpells called when panel opens (catches external spell learning)
- **LLM naming** - All AI integration uses "LLM" (not "SkyrimNet") in code and UI
- **Per-school shapes** - Each school has a distinct visual shape; defined in `SCHOOL_DEFAULT_SHAPES` (Python + JS)
- **Plugin whitelist** - Users can filter which plugins contribute spells to tree generation
- **LLM keyword classification** - Optional batched classification for spells with weak keywords; off by default
