# Spell Learning System - Architecture

**Purpose:** Concise reference for LLMs to understand system structure and implementation status.

**Version:** 3.0 (Updated February 14, 2026 - Native C++ tree builders, Python eliminated)

---

## System Overview

**What It Does:**
- Scans all spells from loaded plugins
- Generates spell learning trees with prerequisites using native C++ NLP builders (TF-IDF, fuzzy matching)
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
- **BUILD TREE (Complex):** Native C++ NLP builders (5 modes: Classic, Tree, Graph, Thematic, Oracle) → JS SettingsAwareTreeBuilder
- **BUILD TREE (Simple):** Pure JS procedural builder; keyword themes, tier-based links
- **Visual-First / Edit Mode:** Manual drag-drop and in-tree editing (add/remove nodes, links)

**Core Flow:**
```
Scan Spells → Generate Tree (C++ NLP builders) → Validate FormIDs → Display Tree → Track XP → Grant Early (nerfed) → Reveal Details → Master Spells
```

---

## Component Architecture

### 1. **SpellScanner** (`plugins/spelllearning/src/spellscanner/`, `plugins/spelllearning/include/SpellScanner.h`)
Split across: SpellScannerScan.cpp, SpellScannerFormId.cpp, SpellScannerHelpers.cpp, SpellScannerEncoding.cpp
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

### 2. **UIManager** (`plugins/spelllearning/src/uimanager/`, `plugins/spelllearning/include/uimanager/UIManager.h`)
Split across: UIManagerCore.cpp, UIManagerNotify.cpp, UIManagerScanner.cpp, UIManagerTree.cpp, UIManagerLLM.cpp, UIManagerIO.cpp, UIManagerProgression.cpp, UIManagerConfig.cpp
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
- `NotifyDESTDetectionStatus()` - Update UI with DEST mod status
- Various `On*` callback functions for UI interop

**PrismaUI View Path:**
```
CreateView("SpellLearning/SpellLearningPanel/index.html", ...)
```
**CRITICAL:** Deploy path must match exactly (project name = HeartOfMagic):
```
MO2/mods/HeartOfMagic_RELEASE/PrismaUI/views/SpellLearning/SpellLearningPanel/
```

### 3. **ProgressionManager** (`plugins/spelllearning/src/progressionmanager/`, `plugins/spelllearning/include/ProgressionManager.h`)
Split across: ProgressionManagerCore.cpp, ProgressionManagerSerialization.cpp, ProgressionManagerAPI.cpp, ProgressionManagerTargets.cpp, ProgressionManagerXP.cpp
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

### 4. **SpellEffectivenessHook** (`plugins/spelllearning/src/spelleffectiveness/`, `plugins/spelllearning/include/SpellEffectivenessHook.h`)
Split across: SpellEffectivenessHookCore.cpp, SpellEffectivenessHookDisplay.cpp, SpellEffectivenessHookLegacy.cpp, SpellEffectivenessHookGrant.cpp
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

### 5. **SpellCastHandler** (`plugins/spelllearning/src/SpellCastHandler.cpp`, `plugins/spelllearning/include/SpellCastHandler.h`)
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

### 6. **SpellTomeHook** (`plugins/spelllearning/src/SpellTomeHook.cpp`, `plugins/spelllearning/include/SpellTomeHook.h`)
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

### 7. **ISLIntegration / DEST** (`plugins/spelllearning/src/ISLIntegration.cpp`, `plugins/spelllearning/include/ISLIntegration.h`)
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

### 8. **OpenRouterAPI** (`plugins/spelllearning/src/OpenRouterAPI.cpp`, `plugins/spelllearning/include/OpenRouterAPI.h`)
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

### 9. **TreeNLP** (`plugins/spelllearning/src/treebuilder/TreeNLP.cpp`, `plugins/spelllearning/include/treebuilder/TreeNLP.h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Core NLP algorithms for spell tree generation and PRM scoring
- TF-IDF vectorization with smoothed IDF and pre-computed L2 norms
- Cosine similarity between sparse TF-IDF vectors
- Character n-gram Jaccard similarity (morphological family detection)
- Fuzzy string matching (Levenshtein distance, partial ratio, token set ratio)
- Theme scoring for spell-to-theme assignment
- PRM candidate scoring with proximity blending

**Key Functions:**
- `Tokenize(text)` - Lowercase, strip non-alphanumeric, filter short words
- `BuildSpellText(spell)` / `BuildThemeText(spell)` - Extract weighted text from spell JSON
- `ComputeTfIdf(documents)` - TF-IDF vectorization with L2 norms
- `CosineSimilarity(a, b)` - Dot product of sparse vectors
- `CharNgramSimilarity(a, b)` - 3-char sliding window Jaccard
- `LevenshteinDistance(a, b)` / `FuzzyRatio()` / `FuzzyPartialRatio()` / `FuzzyTokenSetRatio()` - Fuzzy matching
- `CalculateThemeScore(spell, theme)` - Multi-strategy theme scoring (0-100)
- `ScorePRMCandidates(spell, candidates, settings)` - PRM lock candidate scoring
- `ProcessPRMRequest(request)` - Full PRM scoring request handler

**Data Types:**
```cpp
struct SparseVector {
    std::unordered_map<std::string, float> weights;
    float norm = 0.0f;
};
```

### 10. **TreeBuilder** (`plugins/spelllearning/src/treebuilder/`, `plugins/spelllearning/include/treebuilder/TreeBuilder.h`)
Split across: TreeBuilderCore.cpp, TreeBuilderClassic.cpp, TreeBuilderGraph.cpp, TreeBuilderOracle.cpp, TreeBuilderThematic.cpp, TreeBuilderThemes.cpp, TreeBuilderTree.cpp, SimdKernels.cpp
**Status:** ✅ Implemented

**Responsibilities:**
- Spell tree construction engine with 5 builder modes
- Theme discovery via TF-IDF keyword extraction
- Spell grouping by best-matching theme (fuzzy scoring)
- Tree validation (reachability simulation, cycle detection)
- Unreachable node repair (multi-pass)
- Pre-computed pairwise similarity matrices

**Builder Modes:**
| Mode | Function | Algorithm |
|------|----------|-----------|
| Classic | `BuildClassic()` | Tier-first: depth = tier index. NLP within-tier parent selection. |
| Tree | `BuildTree()` | NLP thematic: TF-IDF similarity, round-robin theme interleaving, convergence gates. |
| Graph | `BuildGraph()` | Edmonds' minimum spanning arborescence (directed MST). |
| Thematic | `BuildThematic()` | 3D similarity BFS with per-theme branch construction. |
| Oracle | `BuildOracle()` | LLM-guided semantic chain grouping (fallback: cluster lanes). |

**High-Level API:**
```cpp
// Called from UIManager::OnProceduralTreeGenerate
BuildResult Build(command, spells, configJson);
// Commands: "build_tree_classic", "build_tree", "build_tree_graph",
//           "build_tree_thematic", "build_tree_oracle"
```

**Architecture:**
```
C++ (UIManager)                    TreeBuilder
    │                                   │
    ├─OnProceduralTreeGenerate()─────►│
    │  (SKSE TaskInterface async)       │
    │                                   ├─Build(command, spells, config)
    │                                   │  ├─DiscoverThemesPerSchool()
    │                                   │  ├─GroupSpellsBestFit()
    │                                   │  ├─ComputeSimilarityMatrix()
    │                                   │  ├─Per-school tree construction
    │                                   │  ├─ValidateSchoolTree()
    │                                   │  └─FixUnreachableNodes()
    │                                   │
    │◄─callback(BuildResult)────────────┤
    │  → InteropCall("onProceduralTreeComplete")
```

**Key Data Types:**
```cpp
struct TreeNode {
    std::string formId, name, tier, school, theme, section;
    std::vector<std::string> children, prerequisites;
    int depth = 0;
    bool isRoot = false;
};

struct BuildConfig {
    int seed, maxChildrenPerNode, topThemesPerSchool;
    float density, symmetry, chaos, convergenceChance;
    bool autoFixUnreachable, preferVanillaRoots;
    std::unordered_map<std::string, std::string> selectedRoots;
    std::optional<LLMApiConfig> llmApi;  // Oracle mode
};

struct BuildResult {
    json treeData;       // Full tree JSON
    bool success;
    std::string error;
    float elapsedMs;
};
```

### 11. **PapyrusAPI** (`plugins/spelllearning/src/PapyrusAPI.cpp`, `plugins/spelllearning/include/PapyrusAPI.h`)
**Status:** ✅ Implemented

**Responsibilities:**
- Expose 26 C++ functions to Papyrus scripts for inter-mod communication
- Menu control, XP granting, progress queries, learning target management, settings queries

**Papyrus Functions (26):**
```papyrus
; Menu
SpellLearning.OpenMenu()                              ; Show UI
SpellLearning.CloseMenu()                             ; Hide UI
SpellLearning.ToggleMenu()                            ; Toggle UI
SpellLearning.IsMenuOpen()                            ; Query state
SpellLearning.GetVersion()                            ; Version string

; XP (Modder API)
SpellLearning.RegisterXPSource(sourceId, displayName) ; Register source → creates UI controls
SpellLearning.AddSourcedXP(spell, amount, source)     ; Grant XP through cap system
SpellLearning.AddRawXP(spell, amount)                 ; Bypass all caps/multipliers
SpellLearning.SetSpellXP(spell, xp)                   ; Debug: set exact XP

; Progress Queries
SpellLearning.GetSpellProgress(spell)                 ; 0.0-100.0%
SpellLearning.GetSpellCurrentXP(spell)                ; Raw XP
SpellLearning.GetSpellRequiredXP(spell)               ; Required XP
SpellLearning.IsSpellMastered(spell)                  ; 100% + unlocked
SpellLearning.IsSpellUnlocked(spell)                  ; Granted to player
SpellLearning.IsSpellAvailableToLearn(spell)           ; In tree, prereqs met
SpellLearning.ArePrerequisitesMet(spell)               ; Tree prereqs check

; Learning Target Control
SpellLearning.GetLearningTarget(school)                ; Get target for school
SpellLearning.GetAllLearningTargets()                  ; All active targets
SpellLearning.GetLearningMode()                        ; "perSchool" or "single"
SpellLearning.SetLearningTarget(spell)                 ; Auto-determines school
SpellLearning.SetLearningTargetForSchool(school, spell)
SpellLearning.ClearLearningTarget(school)
SpellLearning.ClearAllLearningTargets()

; Settings Queries
SpellLearning.GetGlobalXPMultiplier()
SpellLearning.GetXPForTier(tier)                       ; "novice", "expert", etc.
SpellLearning.GetSourceCap(source)                     ; Cap % for any source
```

**ModEvents Sent (7):**
- `SpellLearning_MenuOpened` / `SpellLearning_MenuClosed`
- `SpellLearning_XPGained` — (strArg=source, numArg=amount, sender=Spell)
- `SpellLearning_SpellMastered` — (strArg=school, sender=Spell)
- `SpellLearning_SpellEarlyGranted` — (strArg=school, numArg=progress%, sender=Spell)
- `SpellLearning_TargetChanged` — (strArg=school, numArg=1.0/0.0, sender=Spell)
- `SpellLearning_SourceRegistered` — (strArg=sourceId)

**C++ API (for SKSE plugins):** See `SpellLearningAPI.h` — SKSE Messaging (fire-and-forget) or full `ISpellLearningAPI` interface.

<a id="modder-api-reference"></a>
### Modder API Reference

**For Papyrus modders** who want to add custom XP sources to SpellLearning:

```papyrus
; 1. Register your source on init (creates UI controls for users)
SpellLearning.RegisterXPSource("book_reading", "Book Reading")

; 2. Grant XP when your event fires
Spell[] targets = SpellLearning.GetAllLearningTargets()
int i = 0
while i < targets.Length
    SpellLearning.AddSourcedXP(targets[i], 15.0, "book_reading")
    i += 1
endwhile

; 3. Listen for SpellLearning events (optional)
RegisterForModEvent("SpellLearning_SpellMastered", "OnMastered")
```

**What happens when you register a source:**
1. C++ `ProgressionManager::RegisterModdedXPSource()` creates a `ModdedSourceConfig` (enabled=true, multiplier=100%, cap=25%)
2. `UIManager::NotifyModdedSourceRegistered()` sends JSON to PrismaUI
3. JS `onModdedXPSourceRegistered()` creates UI row with enable toggle + multiplier/cap sliders
4. User can adjust multiplier (0-200%) and cap (0-100%) per source
5. Settings persist via `saveUnifiedConfig()` → `config.json`

**XP flow through `AddSourcedXP()`:**
```
amount → × source multiplier (0-200%) → × global multiplier
       → clamped to: requiredXP × source cap %
       → minus already-tracked XP from this source
       → result added to spell progress
```

**For C++ plugins:** Use `SpellLearningAPI.h` — either SKSE messaging (fire-and-forget) or request the `ISpellLearningAPI` interface pointer.

---

## Performance Optimizations

### Threading Model

The plugin uses a game-thread-primary model with targeted background offloading. All game-thread dispatch goes through `AddTaskToGameThread()` (defined in `ThreadUtils.h`), which provides null-safety, exception handling, and named-task logging.

**Game thread (SKSE main thread):**
- All `RE::` engine calls (form lookups, spell add/remove, HUD messages)
- Event sinks (SpellCastHandler, InputHandler, BookMenuWatcher)
- Hooks (SpellTomeHook, SpellEffectivenessHook)
- Papyrus native functions (PapyrusAPI, ISLIntegration)
- SKSE serialization callbacks (co-save read/write)
- UIManager callbacks dispatch to game thread via `AddTaskToGameThread()`

**Background threads:**
- `PassiveLearningSource` — dedicated `std::thread` polling every 3s, dispatches XP grants back to game thread via `AddTaskToGameThread()`
- `OpenRouterAPI` — detached `std::thread` for HTTP requests, dispatches callback to game thread via `AddTaskToGameThread()`
- `TreeBuilder::Build()` — detached `std::thread` for NLP tree construction (TF-IDF, similarity matrices, Edmonds' arborescence). Uses OpenMP for inner-loop parallelism. No `RE::` dependencies. Result dispatched to game thread via `AddTaskToGameThread()`
- `TreeNLP::ProcessPRMRequest()` — detached `std::thread` for prerequisite-master scoring. No `RE::` dependencies. Result dispatched to game thread via `AddTaskToGameThread()`

**Synchronization primitives:**
- `SpellEffectivenessHook` — `std::shared_mutex` (reader-writer) for hot-path spell data
- `SpellTomeHook` — `std::mutex` for tome XP tracking set
- `PassiveLearningSource` — `std::mutex` for settings, `std::atomic<bool>` for lifecycle
- `UIManager` — `std::atomic<bool>` guards for concurrent build/score prevention
- `ProgressionManager` — no mutex (game-thread-only invariant, documented in header)

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
| `settingsAwareTreeBuilder.js` | **Complex Build:** settings-driven tree (element isolation, convergence); consumes C++ builder fuzzy data |
| `proceduralTreeBuilder.js` | **Simple Build:** `buildProceduralTrees()` (JS only). Also orchestrates **Complex:** `startVisualFirstGenerate()` → C++ → `doVisualFirstGenerate()` → `buildAllTreesSettingsAware()`. Plugin whitelist filtering |
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
| `cppCallbacks.js` | C++ ↔ JS (e.g. ProceduralTreeGenerate, GetProgress); enables Complex/Simple buttons when spells loaded |
| `llmIntegration.js` | LLM tree generation (AUTO AI), validation, retry |
| `llmTreeFeatures.js` | LLM preprocessing: auto-config, keyword expansion, **keyword classification**; batched per-school classification |
| `llmApiSettings.js` | LLM API configuration (model, endpoint, API key) |
| `buttonHandlers.js` | Button click routing and UI state management |
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

**Module load order:** See `index.html`. Order is: constants/state/config → edgeScoring/shapeProfiles/layoutEngine → spellCache/colorUtils/uiHelpers → growthDSL/treeParser → wheel/starfield/globe/canvas/editMode → colorPicker/settingsPanel/treeViewerUI/… → cppCallbacks/llmIntegration/proceduralTreeBuilder → layoutGenerator/growthBehaviors/visualFirstBuilder/llmTreeFeatures/settingsAwareTreeBuilder → generationModeUI → script.js → autoTest/unificationTest → main.js.

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

## Native C++ Tree Builder System

**Purpose:** Native C++ tree generation with 5 builder modes. All algorithms run directly in the SKSE plugin via `plugins/spelllearning/src/treebuilder/TreeBuilder*.cpp` and `TreeNLP.cpp`. No external subprocess, no IPC, no Python dependency.

### Architecture

```
UIManagerTree.cpp
  └─ OnProceduralTreeGenerate()
       └─ SKSE TaskInterface (async)
            └─ TreeBuilder::Build(command, spells, config)
                 ├─ TreeNLP (TF-IDF, cosine sim, fuzzy matching)
                 ├─ Theme discovery + spell grouping
                 ├─ Per-school tree construction
                 └─ Validation + repair
                      └─ BuildResult → callback → InteropCall("onProceduralTreeComplete")
```

### Builder Modes

| Mode | Command | Algorithm |
|------|---------|-----------|
| Classic | `build_tree_classic` | Tier-first: depth = tier index. NLP within-tier parent selection. |
| Tree | `build_tree` | NLP thematic: TF-IDF similarity drives parent→child links. Round-robin theme interleaving. |
| Graph | `build_tree_graph` | Edmonds' minimum spanning arborescence (directed MST). |
| Thematic | `build_tree_thematic` | 3D similarity BFS with per-theme branch construction. |
| Oracle | `build_tree_oracle` | LLM-guided semantic chain grouping (fallback: cluster lanes). |

### Core Algorithms (TreeNLP)

| Algorithm | C++ Function | Description |
|-----------|-------------|-------------|
| Tokenization | `Tokenize()` | Lowercase, strip punctuation, filter words ≤ 2 chars |
| TF-IDF vectorization | `ComputeTfIdf()` | Sparse dict vectors, smoothed IDF, L2 norms |
| Cosine similarity | `CosineSimilarity()` | Dot product of sparse vectors / pre-computed norms |
| Char n-gram similarity | `CharNgramSimilarity()` | 3-char sliding window Jaccard (e.g. "Firebolt"/"Fireball" ≈ 0.45) |
| Levenshtein distance | `LevenshteinDistance()` | Single-row DP edit distance |
| Fuzzy matching | `FuzzyRatio()`, `FuzzyPartialRatio()`, `FuzzyTokenSetRatio()` | Replaces Python `thefuzz` library |
| Theme scoring | `CalculateThemeScore()` | Multi-strategy fuzzy scoring (0-100) |
| PRM scoring | `ScorePRMCandidates()`, `ProcessPRMRequest()` | TF-IDF + proximity blending for lock candidates |

### Theme Discovery

TF-IDF keyword extraction per school from spell text (names, descriptions, effects, keywords):
```
For each word across all spells in school:
    TF = term_count / total_tokens
    DF = documents_containing_word
    IDF = log((total_docs + 1) / (DF + 1)) + 1
    score = TF × IDF
Sort descending → take top N → merge with vanilla hints
```

Vanilla hints: Destruction → fire/frost/shock, Restoration → heal/cure/restore, etc.

### Per-School Default Shapes

```cpp
// Applied when LLM auto-config is disabled (default)
Destruction → explosion   // Dense core bursting outward
Restoration → tree        // Trunk with branches and canopy
Alteration  → mountain    // Wide base tapering to peak
Conjuration → portals     // Organic fill with doorway arch
Illusion    → organic     // Natural flowing spread
```

Defined in both the C++ tree builder files (`plugins/spelllearning/src/treebuilder/`) and JS `shapeProfiles.js`.

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
1. `startVisualFirstTreeConfig()`: build config (fuzzy + optional LLM), call C++ `ProceduralTreeGenerate`.
2. C++ runs `TreeBuilder::Build(command, spells, config)` on SKSE TaskInterface thread. Executes native NLP algorithms (TF-IDF, fuzzy matching, tree construction).
3. `TreeBuilder` returns `BuildResult` with full tree JSON.
4. Callback fires on SKSE main thread → `onProceduralTreeComplete`.
5. `doVisualFirstGenerate(schoolConfigs, fuzzyData)` → **`buildAllTreesSettingsAware()`** → LayoutEngine → TreeParser → render.

**BUILD TREE (Simple)** — `proceduralBtn` (click bound in script.js) → `onProceduralClick()` → `startProceduralGenerate()`:
1. **`buildProceduralTrees(state.lastSpellData.spells)`** (proceduralTreeBuilder.js): JS-only; keyword theme discovery, tier-based links, convergence, orphans. No Python.
2. Output → TreeParser → render.

**Developer-only:** AUTO COMPLEX (`proceduralPlusBtn`) = C++ full tree build (TF-IDF, shapes). AUTO AI (`fullAutoBtn`) = LLM generates full tree (see Tree Validation System below for reachability/retry).

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
├── CMakeLists.txt                 # Top-level super-build (shared config)
├── CMakePresets.json              # Build presets (VS2022, VS2026)
├── vcpkg.json                     # Shared vcpkg dependencies
├── BuildRelease.ps1               # Build script
├── plugins/
│   ├── cmake/
│   │   ├── CompilerFlags.cmake    # MSVC optimization flags (/GL, /LTCG, /AVX, etc.)
│   │   ├── commonlibsse.cmake     # CommonLibSSE-NG configuration
│   │   ├── Papyrus.cmake          # Papyrus script compilation
│   │   └── Spriggit.cmake         # Spriggit ESP serialization
│   ├── external/
│   │   └── commonlibsse-ng/       # Git submodule (built once, shared by all targets)
│   ├── SpellLearningAPI.h         ✅ Public C++ API header (shared across plugins)
│   ├── PrismaUI_API.h             ✅ PrismaUI modder interface (shared across plugins)
│   ├── spelllearning/             # Main SpellLearning plugin
│   │   ├── CMakeLists.txt
│   │   ├── include/
│   │   │   ├── ISLIntegration.h             ✅ DEST mod integration header
│   │   │   ├── OpenRouterAPI.h              ✅ LLM API client header
│   │   │   ├── PapyrusAPI.h                 ✅ Papyrus native function header
│   │   │   ├── PassiveLearningSource.h      ✅ Passive learning source header
│   │   │   ├── ProgressionManager.h         ✅ XP tracking header
│   │   │   ├── SimdKernels.h                ✅ SIMD kernel header
│   │   │   ├── SpellCastHandler.h           ✅ Spell cast events header
│   │   │   ├── SpellCastXPSource.h          ✅ XP source implementation header
│   │   │   ├── SpellEffectivenessHook.h     ✅ Runtime magnitude scaling header
│   │   │   ├── SpellScanner.h               ✅ Spell enumeration header
│   │   │   ├── SpellTomeHook.h              ✅ Tome interception header
│   │   │   ├── ThreadUtils.h                ✅ Game-thread dispatch utilities
│   │   │   ├── XPSource.h                   ✅ XP source interface
│   │   │   ├── treebuilder/
│   │   │   │   ├── TreeBuilder.h            ✅ Tree construction engine header
│   │   │   │   ├── TreeBuilderInternal.h    ✅ Internal tree builder helpers
│   │   │   │   └── TreeNLP.h                ✅ Core NLP header
│   │   │   └── uimanager/
│   │   │       ├── UIManager.h              ✅ UI manager header
│   │   │       └── UIManagerInternal.h      ✅ Internal UI manager helpers
│   │   └── src/
│   │       ├── Main.cpp                     ✅ Entry point, event registration, serialization
│   │       ├── SpellCastHandler.cpp         ✅ Spell cast events, notification throttling
│   │       ├── SpellCastXPSource.cpp        ✅ XP source implementation
│   │       ├── SpellTomeHook.cpp            ✅ Tome interception, XP grant, keep book
│   │       ├── OpenRouterAPI.cpp            ✅ LLM API client (OpenRouter/WinHTTP)
│   │       ├── PapyrusAPI.cpp               ✅ Papyrus native function bindings
│   │       ├── ISLIntegration.cpp           ✅ DEST mod integration (bundled)
│   │       ├── PassiveLearningSource.cpp    ✅ Passive learning source
│   │       ├── spellscanner/                ✅ Spell enumeration, FormID persistence
│   │       │   ├── SpellScannerScan.cpp         (main scan logic)
│   │       │   ├── SpellScannerFormId.cpp       (FormID persistence)
│   │       │   ├── SpellScannerHelpers.cpp      (utility helpers)
│   │       │   └── SpellScannerEncoding.cpp     (encoding/UTF-8)
│   │       ├── uimanager/                   ✅ PrismaUI bridge (8 files)
│   │       │   ├── UIManagerCore.cpp            (singleton, init, panel visibility, DOM bridge)
│   │       │   ├── UIManagerNotify.cpp          (C++→JS data push)
│   │       │   ├── UIManagerScanner.cpp         (scanner tab callbacks)
│   │       │   ├── UIManagerTree.cpp            (tree tab callbacks, procedural gen, PRM scoring)
│   │       │   ├── UIManagerProgression.cpp     (progression system callbacks)
│   │       │   ├── UIManagerConfig.cpp          (unified config load/save/apply)
│   │       │   ├── UIManagerLLM.cpp             (LLM/OpenRouter integration)
│   │       │   └── UIManagerIO.cpp              (clipboard, presets, auto-test I/O)
│   │       ├── progressionmanager/          ✅ XP tracking, early grant/mastery, co-save (5 files)
│   │       │   ├── ProgressionManagerCore.cpp       (singleton, core logic)
│   │       │   ├── ProgressionManagerSerialization.cpp (co-save read/write)
│   │       │   ├── ProgressionManagerAPI.cpp        (public API methods)
│   │       │   ├── ProgressionManagerTargets.cpp    (learning target management)
│   │       │   └── ProgressionManagerXP.cpp         (XP calculation, grants)
│   │       ├── spelleffectiveness/          ✅ Runtime magnitude scaling (4 files)
│   │       │   ├── SpellEffectivenessHookCore.cpp   (hook install, settings, main scaling)
│   │       │   ├── SpellEffectivenessHookDisplay.cpp (display name/description modification)
│   │       │   ├── SpellEffectivenessHookLegacy.cpp (legacy compatibility)
│   │       │   └── SpellEffectivenessHookGrant.cpp  (early spell granting/removal)
│   │       └── treebuilder/                 ✅ Native NLP tree construction (9 files)
│   │           ├── TreeBuilderCore.cpp          (build dispatch, validation, repair)
│   │           ├── TreeBuilderClassic.cpp       (Classic mode: tier-first)
│   │           ├── TreeBuilderTree.cpp          (Tree mode: NLP thematic)
│   │           ├── TreeBuilderGraph.cpp         (Graph mode: Edmonds' arborescence)
│   │           ├── TreeBuilderThematic.cpp      (Thematic mode: 3D similarity BFS)
│   │           ├── TreeBuilderOracle.cpp        (Oracle mode: LLM-guided)
│   │           ├── TreeBuilderThemes.cpp        (theme discovery + spell grouping)
│   │           ├── TreeNLP.cpp                  (TF-IDF, cosine sim, fuzzy matching, PRM scoring)
│   │           └── SimdKernels.cpp              (SIMD-optimized compute kernels)
│   ├── DummyDEST/                 # DEST compatibility shim
│   │   ├── CMakeLists.txt
│   │   └── src/
│   │       └── Main.cpp           ✅ Inert DontEatSpellTomes.dll replacement
│   └── BookXP/                    # BookXP addon plugin
│       ├── CMakeLists.txt
│       └── src/
│           └── Main.cpp           ✅ BookMenu watcher + API integration
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
│   └── custom_prompts/              ✅ LLM prompt templates
└── docs/
    ├── ARCHITECTURE.md              ✅ This file
    ├── DESIGN.md                    ✅ Design patterns and UI documentation
    ├── MODULE_CONTRACTS.md          ✅ Module creation contracts
    ├── TREE_BUILDING_SYSTEM.md      ✅ Tree building algorithms
    ├── DEST-IMPROVEMENTS.md         ✅ DEST comparison
    ├── PRESETS.md                    ✅ Preset system documentation
    ├── TRANSLATING.md               ✅ Translation guide
    ├── PLAN-PUBLIC-MODDER-API.md    ✅ Public modder API spec
    └── research/
        └── TREE_GENERATION_RESEARCH.md ✅ NLP/ML research
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
│               └── modules/            # JavaScript modules
├── Scripts/
│   ├── *.pex                           # Compiled Papyrus
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
- Complex Build (native C++ tree generation — 5 builder modes)
- Native NLP engine (TF-IDF, cosine similarity, fuzzy matching)
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

### ✅ Recently Completed (Feb 14, 2026)

#### Native C++ Tree Builders (Python Eliminated)
- **`TreeNLP`** (`src/treebuilder/TreeNLP.cpp`, `include/treebuilder/TreeNLP.h`) — Core NLP engine: TF-IDF vectorization, cosine similarity, char n-gram similarity, Levenshtein distance, fuzzy matching (ratio, partial ratio, token set ratio), theme scoring, PRM candidate scoring
- **`TreeBuilder`** (`src/treebuilder/TreeBuilder*.cpp`, `include/treebuilder/TreeBuilder.h`) — Tree construction engine with 5 builder modes (Classic, Tree, Graph, Thematic, Oracle), theme discovery, spell grouping, tree validation, unreachable node repair
- **Python completely eliminated** — No PythonBridge, no PythonInstaller, no embedded Python, no server.py, no subprocess IPC
- **All builder modes native** — TF-IDF, fuzzy matching, Edmonds' arborescence, LLM integration all in C++
- **PRM scoring native** — `TreeNLP::ProcessPRMRequest()` replaces Python prereq_master_scorer.py
- **Wine/Proton compatibility** — No subprocess = no pipe/TCP IPC issues on Linux

### ✅ Recently Completed (Feb 11, 2026)

#### Passive Learning Feature
- **UI:** Toggle, scope dropdown (All/Root/Novice), XP-per-game-hour slider (1-50), per-tier max % caps
- **Settings:** `passiveLearning` object in `state.js` with `enabled`, `scope`, `xpPerGameHour`, `maxByTier`
- **Persistence:** Saved/loaded via `saveUnifiedConfig`/`onUnifiedConfigLoaded`
- **C++ side:** Not yet implemented (UI settings ready for timer-based XP granting)

#### Curved Edge Rendering
- **`_drawEdgePath()`** helper in `canvasRendererV2.js` — quadratic Bezier curves with 15% perpendicular offset
- **Settings toggle:** `edgeStyle: 'straight'|'curved'` in state.js + checkbox in settings panel
- Applied to all 3 edge passes (base connections, selected path, learning path)

#### themeColor Pipeline Fix
- **treeViewerUI.js** fast path (`_loadTrustedTree`): Added `theme`, `themeColor`, `skillLevel` to node construction
- **treeParser.js** slow path: Same fields added to node construction
- Fixes per-node theme colors being ignored (falling back to school color)

#### Import Modal Buttons
- Added `paste-tree-btn` and `import-cancel` buttons to import modal (HTML elements JS already referenced)

#### Modder API (Papyrus + C++)
- **`SpellLearningAPI.h`** — Public C++ header for SKSE plugins (messaging + full interface)
- **`SpellLearning.psc`** — Papyrus API with 26 native functions
- **`RegisterXPSource()`** — Creates UI controls (enable toggle, multiplier slider, cap slider)
- **`AddSourcedXP()`** — Grants XP through cap system with named source
- **`AddRawXP()`** — Bypasses all caps/multipliers
- **ModEvents** — 7 events for inter-mod communication
- See [Modder API Reference](#modder-api-reference) section below

### 🔄 Planned Improvements
- Passive learning C++ timer (game-hour XP granting)
- Viewport culling for large trees
- Level-of-detail rendering

### ✅ Previously Completed (Feb 9, 2026)

#### Modular Tree Builders (now native C++)
- **Classic builder** — Tier-first builder. Novice=depth 0, Master=depth 4. NLP similarity guides within-tier parent selection.
- **Tree builder** — NLP-based builder. TF-IDF similarity drives parent→child links. Round-robin theme interleaving.
- **Shared error handler** — `_handleBuildFailure()` in `proceduralTreeBuilder.js` replaces duplicate error handlers for Classic/Tree modes
- **Classic `buildTree()` sends** `command: 'build_tree_classic'` + `tier_zones` config
- **Tree `buildTree()` sends** `command: 'build_tree'` explicitly
- **Fixes Classic tier zone controls** — Tier zone sliders now work because tree structure matches tier ordering (Novice near roots, Master at edges)

### ✅ Previously Completed (Feb 7, 2026)

#### Per-School Default Shapes
- **`SCHOOL_DEFAULT_SHAPES`** in both C++ (`plugins/spelllearning/src/treebuilder/`) and JS (`shapeProfiles.js`)
- Destruction=explosion, Restoration=tree, Alteration=mountain, Conjuration=portals, Illusion=organic
- Applied automatically when LLM auto-config is disabled

#### LLM Keyword Classification
- **LLM Keyword Classification** — Optional batched LLM classification for spells with weak/missing keywords
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
- **Per-school shapes** - Each school has a distinct visual shape; defined in `SCHOOL_DEFAULT_SHAPES` (C++ + JS)
- **Plugin whitelist** - Users can filter which plugins contribute spells to tree generation
- **LLM keyword classification** - Optional batched classification for spells with weak keywords; off by default