# BookXP - SpellLearning C++ API Test Plugin

Pure SKSE DLL plugin (no ESP) that grants spell learning XP when the player reads normal books. Tests the full `SpellLearningAPI.h` C++ integration.

## What It Does

1. On `kPostLoad`: Requests `ISpellLearningAPI*` from SpellLearning via SKSE messaging
2. On `kDataLoaded`: Registers "Book Reading" as a custom XP source (creates UI controls)
3. On `BookMenu` open: Queries all active learning targets via API, grants XP to each

## C++ API Demonstrated

| API Call | Stage | Purpose |
|----------|-------|---------|
| `Dispatch(kMessageType_RequestAPI, ...)` | kPostLoad | Request API interface pointer |
| `OnSpellLearningMessage` → `ISpellLearningAPI*` | Response | Receive full API access |
| `Dispatch(kMessageType_RegisterSource, ...)` | kDataLoaded | Register source → creates UI controls |
| `api->GetLearningTarget(school)` | BookMenu | Query active learning targets |
| `api->AddSourcedXP(formId, 15.0, "book_reading")` | BookMenu | Grant XP through cap system |

## Architecture

```
SL_BookXP.dll                              SpellLearning.dll
    │                                           │
    ├─kPostLoad──►Dispatch(RequestAPI)────────►│ OnExternalPluginMessage
    │◄─────────────ISpellLearningAPI*───────────┤ Returns API pointer
    │                                           │
    ├─kDataLoaded─►Dispatch(RegisterSource)───►│ RegisterModdedXPSource()
    │              "book_reading"                │ → UI creates slider controls
    │                                           │
    ├─BookMenu opens────────────────────────────│
    │  api->GetLearningTarget("Destruction")    │ Returns target FormID
    │  api->AddSourcedXP(formId, 15, "book..")  │ → cap/multiplier → XP added
    │                                           │
```

## Files

```
plugins/addons/BookXP/
├── CMakeLists.txt         # Build config (uses add_commonlibsse_plugin)
├── src/
│   ├── PCH.h              # Precompiled header
│   ├── Main.cpp           # SKSE plugin (BookMenu watcher + API integration)
│   └── SpellLearningAPI.h # Public API header (copy from HeartOfMagic)
├── Scripts/Source/
│   └── SL_BookXP_QuestScript.psc  # Alternative Papyrus implementation
├── Scripts/
│   └── SL_BookXP_QuestScript.pex  # Compiled (for ESP-based approach)
└── README.md
```

## Building the DLL

Built automatically as part of the HeartOfMagic super-build. From the repository root:

```powershell
.\BuildRelease.ps1                       # Builds all targets
cmake --build build --target SL_BookXP   # Build only BookXP
```

Shares CommonLibSSE-NG, vcpkg dependencies, and compiler flags with the main SpellLearning plugin via the top-level `CMakeLists.txt`.

## Deploy (DLL approach - no ESP needed)

```
SL_BookXP_RELEASE/
└── SKSE/
    └── Plugins/
        └── SL_BookXP.dll
```

## Balance

Default: 15 XP per book read, applied to each active learning target.

With default SpellLearning settings (cap 25%):

| Tier | Required XP | Max from Books | Books to Cap |
|------|------------|----------------|--------------|
| Novice | 100 | 25 | ~2 |
| Apprentice | 200 | 50 | ~3 |
| Adept | 400 | 100 | ~7 |
| Expert | 800 | 200 | ~13 |
| Master | 1500 | 375 | ~25 |

Users adjust via the "Book Reading" multiplier (0-200%) and cap (0-100%) sliders in SpellLearning settings.

## XP Flow

```
Player opens book → BookMenu event fires
  → api->GetLearningTarget() for each school
  → api->AddSourcedXP(targetId, 15.0, "book_reading")
    → × source multiplier (user-configurable, default 100%)
    → × global multiplier
    → clamped to: requiredXP × source cap (default 25%)
    → minus already-tracked XP from "book_reading"
    → actual XP added to spell progress
    → SpellLearning_XPGained ModEvent fired
```
