# HeartOfMagic Public Modder API

## Context
HeartOfMagic's progression system (XP, learning targets, mastery) is entirely internal. Other modders have no way to grant XP to spells, query progress, set learning targets, or react to progression events. This locks out integration with training mods, quest reward mods, book-reading mods, and any other content that should interact with spell learning.

**Goal**: Expose a clean public API with **self-registering modded XP sources** that get their own per-source balancing controls in the settings UI, saved by the preset system, and affected by the global XP multiplier.

Three layers:
1. **Papyrus** — native functions under script name `SpellLearning`
2. **C++ SKSE** — public header + SKSE messaging handshake
3. **ModEvents** — fire events at key progression moments
4. **Settings UI** — dynamic "Modded XP Sources" section with per-source multiplier + cap sliders

---

## Files to Modify

| File | Changes |
|------|---------|
| `plugin/src/ProgressionManager.h` | Add `AddSourcedXP()`, `RegisterModdedXPSource()`, `SendModEvent()`, extend `XPSettings` and `SpellProgress` with modded source maps |
| `plugin/src/ProgressionManager.cpp` | Implement `AddSourcedXP()` with cap logic for both built-in and modded sources, add ModEvent fire calls at 5 locations, extend serialization for modded source XP tracking |
| `plugin/src/PapyrusAPI.h` | Add declarations for ~20 new native function wrappers |
| `plugin/src/PapyrusAPI.cpp` | Implement all new Papyrus native functions, register them |
| `plugin/src/Main.cpp` | Add SKSE messaging listener for inter-plugin API |
| `plugin/src/SpellLearningAPI.h` | **NEW** — Public C++ header for SKSE plugin authors |
| `Scripts/Source/SpellLearning.psc` | **UPDATE** — Add all new native function declarations |
| `index.html` | Add "Modded XP Sources" section container in progression settings |
| `modules/state.js` | Add `moddedXPSources: {}` to settings |
| `modules/settingsPanel.js` | Add dynamic UI generation for registered sources, save/load, preset integration |
| `modules/settingsPresets.js` | Add `moddedXPSources` to preset save/load/apply |

---

## 1. Self-Registering Modded XP Sources

### How It Works

When an external mod calls `AddSourcedXP` with a **custom source name** (anything other than the built-in "any"/"school"/"direct"/"self"), it triggers **auto-registration**:

1. **C++ side**: `ProgressionManager::AddSourcedXP("mymod_training", ...)` sees unknown source name -> calls `RegisterModdedXPSource("mymod_training", "Training Mod")` automatically
2. **Registration creates**: a default entry `{ enabled: true, multiplier: 100, cap: 25 }` in `m_xpSettings.moddedSources`
3. **C++ notifies JS**: `UIManager::NotifyModdedSourceRegistered(name, displayName)` -> JS creates the UI controls dynamically
4. **Settings persist**: saved in unified config + presets, loaded on next session

Mods can also **explicitly register** before granting XP (recommended -- lets them set a display name):

```papyrus
; Register with display name (optional, but recommended for clean UI)
SpellLearning.RegisterXPSource("mymod_training", "Combat Training")

; Then grant XP through that source
SpellLearning.AddSourcedXP(someSpell, 50.0, "mymod_training")
```

### Data Flow

```
External Mod -> AddSourcedXP("mymod_training", 50.0)
  |
ProgressionManager::AddSourcedXP()
  | (source not in built-in list?)
  -> RegisterModdedXPSource("mymod_training") [auto-register if new]
  |
  -> Look up moddedSources["mymod_training"] for multiplier + cap
  -> Apply: amount x (multiplier/100) x globalMultiplier
  -> Enforce cap: remaining = (requiredXP x cap/100) - xpFromModded["mymod_training"]
  -> AddXP(targetId, clampedAmount)
  -> UIManager::NotifyProgressUpdate()
  -> SendModEvent("SpellLearning_XPGained", "mymod_training", ...)
```

### C++ Data Structures

```cpp
// In XPSettings (extend existing struct):
struct ModdedSourceConfig {
    std::string displayName;    // "Combat Training"
    bool enabled = true;
    float multiplier = 100.0f;  // 0-100%
    float cap = 25.0f;          // 0-100% of required XP
};
std::unordered_map<std::string, ModdedSourceConfig> moddedSources;

// In SpellProgress (extend existing struct):
std::unordered_map<std::string, float> xpFromModded;  // source name -> tracked XP
```

### Cap Enforcement for Modded Sources

```cpp
float ProgressionManager::AddSourcedXP(RE::FormID targetId, float amount,
                                        const std::string& sourceName)
{
    // ... init progress entry if missing ...
    auto& progress = m_spellProgress[targetId];

    // Apply global multiplier first
    float adjustedAmount = amount * m_xpSettings.globalMultiplier;

    // Built-in sources
    if (sourceName == "any" || sourceName == "school" || sourceName == "direct" || sourceName == "self") {
        // ... existing built-in cap logic (capAny, capSchool, capDirect, no cap for self) ...
    }
    // Modded sources
    else {
        // Auto-register if unknown
        if (m_xpSettings.moddedSources.find(sourceName) == m_xpSettings.moddedSources.end()) {
            RegisterModdedXPSource(sourceName, sourceName);  // Use name as display name
        }

        auto& srcConfig = m_xpSettings.moddedSources[sourceName];
        if (!srcConfig.enabled) return 0.0f;

        // Apply source-specific multiplier
        adjustedAmount *= (srcConfig.multiplier / 100.0f);

        // Apply cap
        float maxFromSource = progress.requiredXP * (srcConfig.cap / 100.0f);
        float currentFromSource = progress.xpFromModded[sourceName];
        float remaining = maxFromSource - currentFromSource;
        adjustedAmount = std::min(adjustedAmount, std::max(0.0f, remaining));

        if (adjustedAmount > 0.0f) {
            progress.xpFromModded[sourceName] += adjustedAmount;
        }
    }

    if (adjustedAmount > 0.0f) {
        AddXP(targetId, adjustedAmount);
        SendModEvent("SpellLearning_XPGained", sourceName, adjustedAmount,
                      RE::TESForm::LookupByID(targetId));
    }
    return adjustedAmount;
}
```

---

## 2. Settings UI -- Dynamic "Modded XP Sources" Section

### HTML (index.html)

Add after the XP Caps grid in the progression settings section. This is a **container** that JS populates dynamically:

```html
<!-- Modded XP Sources (populated dynamically when mods register) -->
<div id="moddedXPSourcesSection" class="settings-subsection" style="display:none;">
    <span class="subsection-title">Modded XP Sources</span>
    <p class="setting-note">External mods that grant XP. Each source has its own multiplier and cap, and is still affected by the Overall XP Multiplier.</p>
    <div id="moddedXPSourcesList"></div>
</div>
```

### JS Dynamic UI Generation (settingsPanel.js)

When C++ notifies JS of a registered source (or on config load), generate per-source controls:

```javascript
// Called when a modded source is registered or loaded from config
function addModdedXPSourceUI(sourceId, displayName, multiplier, cap, enabled) {
    var section = document.getElementById('moddedXPSourcesSection');
    var list = document.getElementById('moddedXPSourcesList');
    if (!section || !list) return;

    section.style.display = '';  // Show section

    // Check if already exists
    if (document.getElementById('moddedSrc_' + sourceId)) return;

    var row = document.createElement('div');
    row.id = 'moddedSrc_' + sourceId;
    row.className = 'modded-xp-source-row';
    row.innerHTML =
        '<div class="modded-source-header">' +
            '<label class="toggle-switch toggle-sm">' +
                '<input type="checkbox" id="moddedEnabled_' + sourceId + '"' + (enabled ? ' checked' : '') + '>' +
                '<span class="toggle-slider"></span>' +
            '</label>' +
            '<span class="modded-source-name">' + displayName + '</span>' +
        '</div>' +
        '<div class="slider-grid slider-grid-2">' +
            '<div class="slider-compact">' +
                '<span class="slider-compact-label">Multiplier</span>' +
                '<div class="slider-compact-control">' +
                    '<input type="range" id="moddedMult_' + sourceId + '" min="0" max="200" value="' + multiplier + '" class="setting-slider">' +
                    '<span id="moddedMultVal_' + sourceId + '" class="slider-value">' + multiplier + '%</span>' +
                '</div>' +
            '</div>' +
            '<div class="slider-compact">' +
                '<span class="slider-compact-label">Cap</span>' +
                '<div class="slider-compact-control">' +
                    '<input type="range" id="moddedCap_' + sourceId + '" min="0" max="100" value="' + cap + '" class="setting-slider">' +
                    '<span id="moddedCapVal_' + sourceId + '" class="slider-value">' + cap + '%</span>' +
                '</div>' +
            '</div>' +
        '</div>';
    list.appendChild(row);

    // Wire events (enable toggle, multiplier slider, cap slider)
    // ... follows setupSlider pattern from existing code ...
}
```

### Settings Object (state.js)

```javascript
// Add to settings:
moddedXPSources: {},
// Populated dynamically, e.g.:
// moddedXPSources: {
//     "mymod_training": { displayName: "Combat Training", enabled: true, multiplier: 100, cap: 25 },
//     "bookmod_study": { displayName: "Book Study", enabled: true, multiplier: 75, cap: 15 }
// }
```

### Save/Load (settingsPanel.js)

**saveUnifiedConfig()** -- add:
```javascript
moddedXPSources: settings.moddedXPSources,
```

**onUnifiedConfigLoaded()** -- add:
```javascript
if (data.moddedXPSources && typeof data.moddedXPSources === 'object') {
    settings.moddedXPSources = data.moddedXPSources;
    // Rebuild UI for each loaded source
    for (var srcId in settings.moddedXPSources) {
        var src = settings.moddedXPSources[srcId];
        addModdedXPSourceUI(srcId, src.displayName || srcId, src.multiplier, src.cap, src.enabled);
    }
}
```

### Preset Integration (settingsPresets.js)

**saveSettingsPreset()** -- add to `preset.settings`:
```javascript
moddedXPSources: JSON.parse(JSON.stringify(settings.moddedXPSources)),
```

**applySettingsPreset()** -- add:
```javascript
if (ps.moddedXPSources) {
    settings.moddedXPSources = JSON.parse(JSON.stringify(ps.moddedXPSources));
    rebuildModdedXPSourcesUI();  // Clear and recreate all source rows
}
```

### C++ -> JS Notification

When a source is registered in C++, notify JS to create the UI:

```cpp
void UIManager::NotifyModdedSourceRegistered(const std::string& sourceId,
                                              const std::string& displayName,
                                              float multiplier, float cap)
{
    nlohmann::json j;
    j["sourceId"] = sourceId;
    j["displayName"] = displayName;
    j["multiplier"] = multiplier;
    j["cap"] = cap;
    j["enabled"] = true;
    m_prismaUI->InteropCall(m_view, "onModdedXPSourceRegistered", j.dump().c_str());
}
```

JS callback:
```javascript
window.onModdedXPSourceRegistered = function(dataStr) {
    var data = JSON.parse(dataStr);
    if (!settings.moddedXPSources[data.sourceId]) {
        settings.moddedXPSources[data.sourceId] = {
            displayName: data.displayName,
            enabled: data.enabled !== false,
            multiplier: data.multiplier || 100,
            cap: data.cap || 25
        };
    }
    addModdedXPSourceUI(data.sourceId, data.displayName, data.multiplier, data.cap, data.enabled);
};
```

---

## 3. Papyrus API (Script: `SpellLearning`)

### XP Functions

```papyrus
; Register a named XP source (recommended before granting XP).
; Creates a UI entry with per-source multiplier + cap controls.
; If not called, AddSourcedXP auto-registers with sourceId as display name.
Function RegisterXPSource(string sourceId, string displayName) global native

; Grant XP through the cap system.
; Built-in sources: "any", "school", "direct", "self"
; Custom sources: any string (auto-registers if not already known)
; Applies: amount x source multiplier x global multiplier, clamped to source cap.
; Returns actual XP granted.
float Function AddSourcedXP(Spell akSpell, float amount, string sourceName = "direct") global native

; Grant raw XP bypassing ALL caps and multipliers.
; For quest rewards where amount is pre-determined.
float Function AddRawXP(Spell akSpell, float amount) global native

; Set exact XP value (debug/cheat).
Function SetSpellXP(Spell akSpell, float xp) global native
```

### Progress Queries

```papyrus
float Function GetSpellProgress(Spell akSpell) global native        ; 0.0-100.0%
float Function GetSpellCurrentXP(Spell akSpell) global native       ; Raw XP number
float Function GetSpellRequiredXP(Spell akSpell) global native      ; XP needed to master
bool Function IsSpellMastered(Spell akSpell) global native           ; 100% + unlocked
bool Function IsSpellUnlocked(Spell akSpell) global native           ; Granted to player
bool Function IsSpellAvailableToLearn(Spell akSpell) global native   ; In tree, prereqs met
bool Function ArePrerequisitesMet(Spell akSpell) global native       ; Tree prereqs check
```

### Learning Target Control

```papyrus
Spell Function GetLearningTarget(string schoolName) global native
Spell[] Function GetAllLearningTargets() global native
string Function GetLearningMode() global native
Function SetLearningTarget(Spell akSpell) global native
Function SetLearningTargetForSchool(string schoolName, Spell akSpell) global native
Function ClearLearningTarget(string schoolName) global native
Function ClearAllLearningTargets() global native
```

### Settings Queries (read-only)

```papyrus
float Function GetGlobalXPMultiplier() global native
float Function GetXPForTier(string tier) global native
float Function GetSourceCap(string sourceName) global native   ; Works for built-in AND modded sources
```

### Existing (unchanged)

```papyrus
Function OpenMenu() global native
Function CloseMenu() global native
Function ToggleMenu() global native
bool Function IsMenuOpen() global native
string Function GetVersion() global native
```

---

## 4. ModEvents

All use SKSE's `ModCallbackEvent(string eventName, string strArg, float numArg, Form sender)`.

| Event | When | strArg | numArg | sender |
|-------|------|--------|--------|--------|
| `SpellLearning_XPGained` | After any XP added | Source name (built-in or modded) | XP amount granted | Spell form |
| `SpellLearning_SpellMastered` | 100% XP + unlocked | School name | 0.0 | Spell form |
| `SpellLearning_SpellEarlyGranted` | Early grant at threshold | School name | Progress % | Spell form |
| `SpellLearning_TargetChanged` | Target set or cleared | School name | 1.0=set, 0.0=cleared | Spell or None |
| `SpellLearning_ProgressMilestone` | Power step crossed | Step label | Effectiveness % | Spell form |
| `SpellLearning_SourceRegistered` | New modded source registered | Source ID | 0.0 | None |

### Fire Locations in ProgressionManager.cpp

| Event | Location | After what code |
|-------|----------|----------------|
| `XPGained` | `AddSourcedXP()` | After `AddXP()` call |
| `SpellMastered` | `AddXP()` ~line 591 | After `progress.unlocked = true` |
| `SpellEarlyGranted` | `AddXP()` ~line 561 | After `GrantEarlySpell()` |
| `TargetChanged` | `SetLearningTarget()` ~line 52 | After target stored |
| `TargetChanged` | `ClearLearningTarget()` ~line 268 | After target removed |
| `ProgressMilestone` | `AddXP()` ~line 569 | After power step threshold crossed |
| `SourceRegistered` | `RegisterModdedXPSource()` | After config created |

---

## 5. C++ Public API (`SpellLearningAPI.h`)

### API Handshake (Broadcast Pattern)

SpellLearning uses SKSE's standard broadcast pattern (same as TrueHUD, PO3, etc.):

1. **SpellLearning** broadcasts `ISpellLearningAPI*` to all listeners at `kPostPostLoad`
2. **Your plugin** registers `RegisterListener("SpellLearning", callback)` in `SKSEPluginLoad`
3. **Your callback** receives the API pointer via `kMessageType_APIReady` message
4. **Use the API** at `kDataLoaded` or later when game data is available

```
SKSE Lifecycle:
  kPostLoad          - Plugins loaded
  kPostPostLoad      - SpellLearning broadcasts API → your callback receives it
  kInputLoaded       - Input system ready
  kDataLoaded        - Game data ready → register sources, grant XP here
  kNewGame/kPostLoadGame - Save loaded
```

### Header

Copy `SpellLearningAPI.h` from the HeartOfMagic source into your plugin.

```cpp
namespace SpellLearning {
    constexpr uint32_t kAPIVersion = 1;

    // Message type broadcasted by SpellLearning at kPostPostLoad.
    // Register with: messaging->RegisterListener("SpellLearning", callback)
    enum MessageType : uint32_t {
        kMessageType_APIReady       = 0x534C0001,  // Broadcasted with ISpellLearningAPI* as data
        kMessageType_AddXP          = 0x534C0002,  // Reserved for future fire-and-forget
        kMessageType_RegisterSource = 0x534C0003,  // Reserved for future fire-and-forget
    };

    class ISpellLearningAPI {
    public:
        virtual ~ISpellLearningAPI() = default;
        virtual uint32_t GetAPIVersion() const = 0;

        // XP - amount is pre-multiplier, sourceName identifies the XP source
        virtual float AddSourcedXP(uint32_t spellFormID, float amount, const std::string& sourceName) = 0;
        virtual float AddRawXP(uint32_t spellFormID, float amount) = 0;
        virtual void SetSpellXP(uint32_t spellFormID, float xp) = 0;

        // Queries
        virtual bool IsSpellMastered(uint32_t spellFormID) const = 0;
        virtual bool IsSpellAvailableToLearn(uint32_t spellFormID) const = 0;
        virtual float GetRequiredXP(uint32_t spellFormID) const = 0;
        virtual float GetProgress(uint32_t spellFormID) const = 0;  // 0.0 - 1.0

        // Learning targets
        virtual uint32_t GetLearningTarget(const std::string& school) const = 0;
        virtual void SetLearningTarget(uint32_t spellFormID) = 0;
        virtual void ClearLearningTarget(const std::string& school) = 0;

        // Settings
        virtual float GetGlobalMultiplier() const = 0;

        // Source registration - creates UI controls in settings panel
        virtual bool RegisterXPSource(const std::string& sourceId, const std::string& displayName) = 0;
    };
}
```

---

## 6. Usage Examples

### Training Mod (Papyrus)

```papyrus
Scriptname MyTrainingMod extends ObjectReference

Spell Property SpellToTrain Auto

Event OnInit()
    ; Register once -- creates UI controls with nice display name
    SpellLearning.RegisterXPSource("combat_training", "Combat Training")
EndEvent

Event OnActivate(ObjectReference akActivator)
    if akActivator == Game.GetPlayer()
        ; Grants XP through "combat_training" source -- respects its multiplier + cap
        ; Also affected by global XP multiplier
        float granted = SpellLearning.AddSourcedXP(SpellToTrain, 50.0, "combat_training")
        Debug.Notification("Trained! +" + granted + " XP")
    endif
EndEvent
```

The player sees in Settings > Early Spell Learning > Modded XP Sources:
```
[x] Combat Training
    Multiplier: [====|----] 100%    Cap: [==|------] 25%
```

They can tune the multiplier down if training feels too fast, or increase the cap if they want more from it.

### Quest Reward (Papyrus)

```papyrus
; Raw XP -- bypasses all caps, not affected by multipliers
; Use when the reward amount is intentional and pre-balanced
float granted = SpellLearning.AddRawXP(rewardSpell, 200.0)
```

### Event Listener (Papyrus)

```papyrus
Event OnInit()
    RegisterForModEvent("SpellLearning_SpellMastered", "OnMastered")
    RegisterForModEvent("SpellLearning_XPGained", "OnXPGained")
EndEvent

Event OnMastered(string school, float unused, Form spellForm)
    Spell s = spellForm as Spell
    Debug.Notification("Mastered " + s.GetName() + " in " + school)
EndEvent

Event OnXPGained(string sourceName, float amount, Form spellForm)
    ; sourceName could be "combat_training", "self", "direct", etc.
EndEvent
```

### SKSE Plugin (C++ -- Full Example: SL_BookXP)

This is a complete working example. See `addons/BookXP/` for the full buildable project.

```cpp
#include <RE/Skyrim.h>
#include <SKSE/SKSE.h>
#include "SpellLearningAPI.h"  // Copy from HeartOfMagic/plugin/src/

// Cached API pointer (received at kPostPostLoad)
static SpellLearning::ISpellLearningAPI* g_api = nullptr;

// Receive API broadcast from SpellLearning
void OnSpellLearningMessage(SKSE::MessagingInterface::Message* msg) {
    if (msg->type == SpellLearning::kMessageType_APIReady && msg->data) {
        g_api = static_cast<SpellLearning::ISpellLearningAPI*>(msg->data);
        // API is ready -- use it at kDataLoaded or later
    }
}

void OnSKSEMessage(SKSE::MessagingInterface::Message* msg) {
    if (msg->type == SKSE::MessagingInterface::kDataLoaded) {
        // Register XP source (creates settings UI controls)
        if (g_api) {
            g_api->RegisterXPSource("book_reading", "Book Reading");
        }

        // Now you can grant XP whenever appropriate:
        //   g_api->AddSourcedXP(spellFormID, 15.0f, "book_reading");
    }
}

SKSEPluginLoad(const SKSE::LoadInterface* skse) {
    SKSE::Init(skse);
    auto messaging = SKSE::GetMessagingInterface();

    // Listen for SKSE lifecycle events
    messaging->RegisterListener(OnSKSEMessage);

    // Listen for SpellLearning API broadcast (arrives at kPostPostLoad)
    messaging->RegisterListener("SpellLearning", OnSpellLearningMessage);

    return true;
}
```

**Key points:**
- `RegisterListener("SpellLearning", ...)` listens for messages FROM SpellLearning
- API arrives automatically at `kPostPostLoad` -- no need to Dispatch anything
- Register your source at `kDataLoaded` when game data is available
- Grant XP via `AddSourcedXP()` with your source ID -- respects user's multiplier/cap settings

---

## 7. Serialization

### Co-Save Extension

Extend the existing `kProgressRecord` ('SLPR') serialization to include per-spell modded source XP tracking:

```cpp
// Write (after existing progress fields):
uint32_t moddedCount = progress.xpFromModded.size();
a_intfc->WriteRecordData(&moddedCount, sizeof(moddedCount));
for (auto& [name, xp] : progress.xpFromModded) {
    // Write source name (length-prefixed string) + float xp
}

// Read (mirror):
uint32_t moddedCount;
a_intfc->ReadRecordData(&moddedCount, sizeof(moddedCount));
for (uint32_t i = 0; i < moddedCount; i++) {
    // Read source name + xp -> progress.xpFromModded[name] = xp
}
```

### Unified Config Extension

Modded source **settings** (multiplier, cap, enabled) persist in unified config alongside other progression settings. The per-spell XP tracking persists in the co-save.

---

## 8. Verification

### API Functions
- [ ] `RegisterXPSource` -- register a source, verify UI row appears dynamically
- [ ] `AddSourcedXP` with built-in source ("direct") -- respects existing cap
- [ ] `AddSourcedXP` with custom source -- auto-registers, respects modded cap
- [ ] `AddRawXP` -- bypasses all caps and multipliers
- [ ] `GetSpellProgress` / `GetSpellCurrentXP` / `GetSpellRequiredXP` -- return correct values
- [ ] `IsSpellMastered` -- true after 100% XP + unlocked
- [ ] `SetLearningTarget` / `ClearLearningTarget` -- target changes reflected in UI + tree
- [ ] `GetLearningTarget` / `GetAllLearningTargets` -- return correct forms

### Modded XP Source Balancing
- [ ] Source multiplier at 50% -> grants half the requested XP
- [ ] Source cap at 10% -> stops granting once 10% of required XP reached from that source
- [ ] Source disabled -> returns 0, no XP granted
- [ ] Global multiplier at 2x -> doubles modded source XP (before cap check)
- [ ] Multiple modded sources -> each has independent cap tracking
- [ ] Settings persist after closing/reopening panel
- [ ] Settings persist after save/load game
- [ ] Preset save includes modded source settings
- [ ] Preset load restores modded source settings and rebuilds UI

### ModEvents
- [ ] `SpellLearning_XPGained` -- fires with correct source name and amount
- [ ] `SpellLearning_SpellMastered` -- fires when spell hits 100%
- [ ] `SpellLearning_TargetChanged` -- fires on set/clear
- [ ] `SpellLearning_SourceRegistered` -- fires when new source registered

### Edge Cases
- [ ] Call API with None/null spell -- returns 0, no crash
- [ ] Query progress for unknown spell -- returns 0
- [ ] Register same source twice -- no-op, keeps existing settings
- [ ] Grant XP to spell not in tree -- initializes progress entry
- [ ] All modded sources disabled -- built-in XP still works
