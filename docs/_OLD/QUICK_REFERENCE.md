# Heart of Magic — Quick Reference

**For LLMs:** Quick lookup for system structure, data formats, and current implementation.

---

## System Components

| Component | File | Status | Purpose |
|-----------|------|--------|---------|
| **SpellScanner** | `SpellScanner.cpp/h` | ✅ Done | Scan spells, generate LLM prompt, FormID persistence |
| **UIManager** | `UIManager.cpp/h` | ✅ Done | PrismaUI bridge (41 JS listeners), hotkey handling |
| **ProgressionManager** | `ProgressionManager.cpp/h` | ✅ Done | Track XP, manage learning targets, SKSE co-save |
| **SpellCastHandler** | `SpellCastHandler.cpp/h` | ✅ Done | Cast/hit/effect events, grant XP |
| **SpellEffectivenessHook** | `SpellEffectivenessHook.cpp/h` | ✅ Done | Runtime magnitude scaling for weakened spells |
| **SpellTomeHook** | `SpellTomeHook.cpp/h` | ✅ Done | Intercept tome reading, grant XP (bundled DEST) |
| **SpellCastXPSource** | `SpellCastXPSource.cpp/h` | ✅ Done | XP source multiplier/cap calculations |
| **OpenRouterAPI** | `OpenRouterAPI.cpp/h` | ✅ Done | LLM API client (WinHTTP, UTF-8 sanitized) |
| **PythonInstaller** | `PythonInstaller.cpp/h` | ✅ Done | Embedded Python 3.12.8 auto-download |
| **PapyrusAPI** | `PapyrusAPI.cpp/h` | ✅ Done | Papyrus native bindings for inter-mod use |
| **ISLIntegration** | `ISLIntegration.cpp/h` | ✅ Done | DEST mod integration (bundled) |

---

## Data Formats

### LLM Tree Output (with FormID Persistence)
```json
{
  "version": "1.0",
  "difficulty": "normal",
  "schools": {
    "Destruction": {
      "root": "Flames",
      "nodes": [{
        "spellId": "Flames",
        "formId": "Skyrim.esm|0x00012FCD",
        "prerequisites": [],
        "children": ["Firebolt"],
        "requiredXP": 100,
        "isOrphaned": false
      }],
      "orphanedSpells": [{
        "spellId": "SpecialSpell",
        "formId": "MyMod.esp|0x000ABCDE",
        "requiredXP": 500,
        "isOrphaned": true
      }]
    }
  }
}
```

**FormID Format:** `"PluginName.esp|0xHHHHHHHH"` — survives load order changes. ESL plugins use 12-bit local IDs (`0xFE000XXX` → `0x00000XXX`).

### Progression Co-Save
```json
{
  "version": 1,
  "learnedSpells": ["Skyrim.esm|0x00012FCD"],
  "spellProgress": {
    "Skyrim.esm|0x00012FCD": { "currentXP": 100, "requiredXP": 100, "isLearned": true }
  },
  "learningTargets": { "Destruction": "Skyrim.esm|0x0001C78A" },
  "weakenedSpells": ["Skyrim.esm|0x0001C78A"]
}
```

---

## XP System

### Sources & Caps
```
Self-Cast (the target spell):  100% multiplier, NO cap
Direct Prerequisites:          100% multiplier, 50% cap of required XP
Same School spells:             50% multiplier, 15% cap of required XP
Any other spell:                10% multiplier,  5% cap of required XP
Spell Tome read:               25% of required XP (one-time grant)
Tome in inventory:             +25% passive XP bonus on all sources
```

### Tier Multipliers
```
Novice: 1.0x | Apprentice: 1.5x | Adept: 2.0x | Expert: 2.5x | Master: 3.0x
```

### Tier Mastery Bonus
```
+5% XP per spell learned from previous tier (max +50%)
Example: 6/10 Apprentice spells learned → +30% XP when learning Adept spells
```

### Early Learning Power Steps
```
25% XP → 20% power (Budding)
40% XP → 35% power (Developing)
55% XP → 50% power (Practicing)
70% XP → 65% power (Advancing)
85% XP → 80% power (Refining)
100% XP → 100% power (Mastered)
```

After 75% progress: must self-cast the target spell for further XP (150% multiplier).

---

## Key Functions (C++)

### SpellScanner
- `ScanAllSpells(config)` → JSON string with all detected spells
- `GetSpellInfoByFormId(formId)` → Spell details JSON
- `GetPersistentFormId(form)` → `"Plugin.esp|0xHHHH"` string
- `ResolvePersistentFormId(str)` → `RE::TESForm*`
- `ValidateAndFixTree(treeJson)` → Validates FormIDs, fixes broken refs
- `IsFormIdValid(formId)` → bool (handles ESL prefix stripping)

### ProgressionManager
- `SetLearningTarget(school, formId)` — One per school or single mode
- `GrantXP(formId, amount)` — With source tracking and caps
- `GetProgress(formId)` → `{currentXP, requiredXP, percentComplete}`
- `CheckAutoLearn()` → Grants spells at 25% (weakened) and 100% (mastered)
- `GetEffectivenessMultiplier(formId)` → 0.0-1.0 for weakened spells
- `Serialize() / Deserialize()` — SKSE co-save persistence

### SpellCastHandler
- `ProcessEvent(TESSpellCastEvent)` → Track cast, grant base XP
- `ProcessEvent(TESHitEvent)` → Grant hit bonus (+50%)
- `ProcessEvent(TESMagicEffectApplyEvent)` → Grant damage/heal/buff bonus
- Recent cast queue: 5-second window, matches hits to casts

### SpellTomeHook
- Intercepts `TESObjectBOOK::ProcessBook` via vtable hook
- Tree spell: grants XP, auto-sets learning target, keeps book
- Non-tree spell: vanilla behavior (teaches + consumes)

### UIManager (C++ ↔ JS Bridge)
- `RegisterJSListener(view, name, callback)` — JS → C++ (41 listeners)
- `InteropCall(view, funcName, args)` — C++ → JS
- Key listeners: `CheckLLM`, `LLMGenerate`, `PollLLMResponse`, `SetLearningTarget`, `GetSpellProgress`

### PapyrusAPI
- `GetSpellXP(formId)` → float
- `SetLearningTarget(school, formId)` → bool
- `IsSpellInTree(formId)` → bool
- `GetLearningTargetForSchool(school)` → string

---

## Event Flow

```
Spell Cast → SpellCastHandler::ProcessEvent(TESSpellCastEvent)
  → Add to recent casts queue (5s window)
  → Check if relevant to any learning target (self/prereq/school/any)
  → Calculate XP: base * tierMult * sourceMult * masteryBonus * tomeBonus
  → Check against source cap
  → ProgressionManager::GrantXP()
    → At 25%: grant spell (weakened, 20% power)
    → Power scales through 6 steps
    → At 75%: require self-casting
    → At 100%: full mastery, unlock children

Spell Hits → SpellCastHandler::ProcessEvent(TESHitEvent)
  → Match to recent cast (5s window)
  → Grant hit bonus (+50% base XP)

Effect Applied → SpellCastHandler::ProcessEvent(TESMagicEffectApplyEvent)
  → Match to recent cast
  → Grant bonus: damage/heal +100%, buff +75%

Tome Read → SpellTomeHook::ProcessBook()
  → If spell in tree: grant 25% of required XP, auto-set target, keep book
  → If spell NOT in tree: vanilla behavior

Weakened Spell Cast → SpellEffectivenessHook
  → AdjustForPerksHook intercepts magnitude calculation
  → Scales magnitude by effectiveness multiplier (0.2 - 1.0)
  → Notification: "X operating at Y% power" (throttled, configurable interval)
```

---

## Spell Filtering

### Blacklist (Individual Spells)
Filter out specific spells from tree generation. Useful for:
- Removing buggy/broken spells
- Excluding spells you never use
- Hiding duplicate/variant spells

Access via **Blacklist** button in the UI. Search by name, toggle individual spells.

### Whitelist (Plugin-Level)
Filter entire plugins (ESPs/ESMs) from tree generation. **All plugins enabled by default** - this is an opt-out system.

| Button | Action |
|--------|--------|
| **Select All** | Enable all plugins |
| **Select None** | Disable all plugins |
| **Base Only** | Enable only Skyrim.esm + DLCs, disable all mods |

**Filter Order:** Whitelist (plugin level) → Blacklist (spell level)

Both settings persist across sessions via UnifiedConfig.

---

## Configuration (state.js defaults)

```yaml
# Spell Filtering
spellBlacklist: []           # Array of { name, persistentId, enabled }
pluginWhitelist: []          # Array of { plugin, enabled, spellCount }
                             # All plugins default to enabled (opt-out)

# XP Sources
xpMultiplierDirect: 100      # % multiplier for direct prerequisite casts
xpMultiplierSchool: 50       # % multiplier for same-school casts
xpMultiplierAny: 10          # % multiplier for any-spell casts
xpCapDirect: 50              # Max % of required XP from direct prereqs
xpCapSchool: 15              # Max % from same-school spells
xpCapAny: 5                  # Max % from any-spell casts
xpGlobalMultiplier: 1        # Global XP multiplier

# Default XP requirements (fallback if LLM doesn't provide)
xpNovice: 100
xpApprentice: 200
xpAdept: 400
xpExpert: 800
xpMaster: 1500

# Progressive Reveal
revealName: 10               # % XP to reveal spell name
revealEffects: 25            # % XP to reveal spell effects
revealDescription: 50        # % XP to reveal description

# Learning Modes
learningMode: 'perSchool'    # 'perSchool' or 'single'

# Settings Presets (chip-based, replaces old difficulty profiles)
# Built-in: Default (undeletable), Easy, Hard
# Users can save/load/rename/delete custom presets

# Notifications
weakenedSpellNotifications: true
weakenedSpellInterval: 10    # seconds between notifications
```

---

## JavaScript Modules (see index.html for load order)

### Core
- `constants.js`, `state.js`, `config.js` — Config and state
- `edgeScoring.js`, `shapeProfiles.js`, `layoutEngine.js` — Used by SettingsAwareBuilder
- `main.js` — Entry point; `script.js` — Init, button wiring (e.g. proceduralBtn → onProceduralClick)

### Tree Building
- **Complex:** `settingsAwareTreeBuilder.js` (`buildAllTreesSettingsAware`); orchestrated by `proceduralTreeBuilder.js` (`startVisualFirstGenerate` → Python → `doVisualFirstGenerate`).
- **Simple:** `proceduralTreeBuilder.js` (`buildProceduralTrees`).
- `llmIntegration.js` — AUTO AI; `treeParser.js` — parse/validate; `layoutGenerator.js`, `growthBehaviors.js`; `visualFirstBuilder.js`.

### Rendering & UI
- `wheelRenderer.js`, `canvasRenderer.js`, `starfield.js`, `globe3D.js`, `editMode.js`
- `settingsPanel.js`, `treeViewerUI.js`, `progressionUI.js`, `difficultyProfiles.js`, `generationModeUI.js`, `llmApiSettings.js`, `colorPicker.js`, `uiHelpers.js`
- `cppCallbacks.js`, `buttonHandlers.js`, `spellCache.js`, `colorUtils.js`, `growthDSL.js`

---

## File Locations

See **ARCHITECTURE.md** for full tree. Key: `plugin/src/` (C++), `PrismaUI/.../SpellLearningPanel/` (index.html, script.js, modules/ 40+), `SKSE/Plugins/SpellLearning/` (custom_prompts, SpellTreeBuilder).

### Runtime Data
- **Tree JSON:** `SKSE/Plugins/SpellLearning/spell_tree.json`
- **Settings:** Saved via PrismaUI `InteropCall` ↔ C++ settings file
- **Progression:** SKSE co-save (tied to save game)
- **LLM Response:** `SKSE/Plugins/SpellLearning/llm_response.json`
- **Logs:** `Documents/My Games/Skyrim Special Edition/SKSE/SpellLearning.log`

---

## Key Concepts

- **LLM determines XP requirements** — Not hardcoded, based on difficulty/complexity
- **FormID persistence** — `"Plugin.esp|0xHHHH"` format survives load order changes
- **Orphaned spells** — Don't fit tree, appear floating, no prerequisites
- **One target per school** — Can learn multiple spells (one per school) or single mode
- **Progress saved per spell** — All spells track XP, not just active targets
- **XP source caps** — Forces varied practice (can't just spam one spell)
- **Early learning** — Spells granted at 25% progress but weakened (20% power)
- **6 power steps** — Budding → Developing → Practicing → Advancing → Refining → Mastered
- **Tier mastery bonus** — +5% per previous tier spell learned (max +50%)
- **Self-cast phase** — After 75%, must cast the target spell itself
- **Bundled DEST** — Tome hook is built-in, no external mod dependency
- **shared_mutex** — Read-heavy concurrency (spell lookups vs XP writes)
- **Cached player** — `std::call_once` for player pointer lookup
