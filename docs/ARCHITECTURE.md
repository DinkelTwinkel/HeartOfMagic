# Heart of Magic — Architecture

> Last updated: 2026-02-09

## System Overview

Heart of Magic is a Skyrim SKSE plugin that adds a spell learning progression system. Players scan installed spells, generate a procedural spell tree, and unlock spells through XP gained by casting related magic. The entire mod runs through a single in-game UI panel (PrismaUI/CEF) backed by a C++ DLL.

```
┌─────────────────────────────────────────────────────────────┐
│                    Skyrim Game Engine                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ SpellTomeHook│  │SpellCastHndlr│  │EffectivenessHook │  │
│  │ (Xbyak patch)│  │ (event sink) │  │ (41 vtable hooks)│  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────▼─────────────────▼────────────────────▼─────────┐  │
│  │              ProgressionManager                        │  │
│  │  XP tracking · prerequisites · learning targets        │  │
│  │  early learning · mastery · co-save serialization      │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │                    UIManager                           │  │
│  │  35 JS→C++ listeners · 30+ C++→JS calls               │  │
│  │  PrismaUI bridge · focus/hotkey · config I/O           │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ PrismaUI (CEF/Ultralight)        │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │              JavaScript UI Layer                       │  │
│  │  65 modules · state.js · Canvas 2D renderer            │  │
│  │  3 pages: Spell Tree │ Spell Scan │ Settings           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                              │
    ┌────▼────┐                   ┌─────▼─────┐
    │  Python │                   │  Papyrus  │
    │ builder │                   │  bridge   │
    │ + NLP   │                   │ (SkyrimNet│
    └─────────┘                   │  + DEST)  │
                                  └───────────┘
```

---

## Initialization Flow

```
SKSEPluginLoad
  ├─ SKSE::Init()
  ├─ SetupLog()  →  Documents/.../SKSE/SpellLearning.log
  ├─ Register messaging listener
  ├─ Register co-save serialization
  └─ Register Papyrus API

kPostLoad (before game data)
  ├─ SpellEffectivenessHook::Install()     41 ActiveEffect vtable hooks
  ├─ SpellEffectivenessHook::InstallDisplayHooks()
  └─ SpellTomeHook::Install()              Xbyak patch on TESObjectBOOK::Read

kDataLoaded (main menu)
  ├─ UIManager::Initialize()               Connect to PrismaUI
  ├─ InputHandler::Register()              Hotkey (default F8)
  ├─ SpellCastHandler::Register()          TESSpellCastEvent sink
  └─ XPSourceRegistry::Register()          SpellCastXPSource

kPostLoadGame (save loaded)
  ├─ UIManager::EnsureFocusReleased()
  └─ UIManager::NotifySaveGameLoaded()     Refresh progress UI
```

---

## Core Subsystems

### 1. Spell Tome Hook

**Files:** `SpellTomeHook.cpp/.h`
**Mechanism:** Xbyak assembly patch on `TESObjectBOOK::Read`
**Cross-version:** `REL::RelocationID(17439, 17842)` — SE offset `+0xE8`, AE offset `+0x11D`

Intercepts spell tome reading. Two modes:
- **Vanilla mode:** Instant learn, consume book (game default)
- **Progression mode:** Grants XP (configurable %), keeps tome, auto-sets learning target

Checks prerequisites (hard/soft), skill level requirements. Prevents exploitation via per-frame XP tracking.

### 2. Spell Effectiveness Hook

**Files:** `SpellEffectivenessHook.cpp/.h`
**Mechanism:** 41 vtable hooks on `ActiveEffect::AdjustForPerks` subclasses

Nerfs early-learned spells (spells granted before 100% mastery). Power steps: 25% → 40% → 55% → 70% → 85% → 100%. Binary effects (paralysis, invisibility) blocked below configurable threshold.

Modifies spell display names to show `"Spell (Learning - X%)"` and scales magnitude values in descriptions. State persisted via co-save.

### 3. Progression Manager

**Files:** `ProgressionManager.cpp/.h`
**Mechanism:** Central XP tracking engine

- **Learning targets:** One per school (perSchool mode) or single global target
- **XP sources:** Direct prerequisite casts, same-school casts, any-spell casts, tome reads, self-casts
- **XP caps:** Per source type to prevent grinding one method
- **Prerequisites:** Hard (must unlock first) and soft (contribute XP) system
- **Early learning:** Grants spell at threshold (e.g., 25%) in nerfed state
- **Mastery:** At 100%, removes nerf, spell functions at full power
- **Persistence:** Co-save serialization (survives save/load, not tied to JSON files)

### 4. Spell Scanner

**Files:** `SpellScanner.cpp/.h`

Scans all `SpellItem` forms from `TESDataHandler`. Filters non-player spells. Generates persistent FormIDs (`"Plugin.esp|0x123456"`) that survive load order changes. Outputs JSON for tree generation.

### 5. UI Manager

**Files:** `UIManager.cpp/.h`, `UICallbacks.h`

Central hub bridging C++ and JavaScript. Registers 35 JS→C++ listeners and dispatches 30+ C++→JS calls. Manages panel focus, hotkey handling, config save debouncing (500ms), and Python subprocess execution.

### 6. Python Integration

**Files:** `PythonInstaller.cpp/.h` (C++), `SpellTreeBuilder/*.py` (Python)

Two Python entry points called via `std::system()`:
1. **`build_tree.py`** — Procedural tree generation (TF-IDF theme discovery, layout, edge building)
2. **`prereq_master_scorer.py`** — NLP scoring for Pre Req Master (cosine similarity between spell descriptions)

`PythonInstaller` auto-downloads Python 3.12 embedded + pip + packages (scikit-learn, thefuzz).

### 7. OpenRouter LLM

**Files:** `OpenRouterAPI.cpp/.h`

Optional async LLM integration via OpenRouter API. Used for spell tree generation (alternative to Python builder). Background thread with polling.

### 8. Papyrus API

**Files:** `PapyrusAPI.cpp/.h`, `Scripts/Source/*.psc`

Exposes: `OpenMenu()`, `CloseMenu()`, `ToggleMenu()`, `IsMenuOpen()`, `GetVersion()`.
Fires mod events: `SpellLearning_MenuOpened`, `SpellLearning_MenuClosed`.
Bridge scripts for DEST/ISL tome integration and SkyrimNet LLM fallback.

---

## Data Flow

```
                   ┌──────────────┐
                   │  Game Spells  │
                   │ (TESDataHndlr)│
                   └──────┬───────┘
                          │ ScanSpells
                   ┌──────▼───────┐
                   │ SpellScanner │
                   └──────┬───────┘
                          │ JSON (spell data)
              ┌───────────▼──────────┐
              │  Tree Builder        │
              │  Python or JS or LLM │
              └───────────┬──────────┘
                          │ spell_tree.json
              ┌───────────▼──────────┐
              │  PreReq Master (opt) │
              │  Python NLP scorer   │
              └───────────┬──────────┘
                          │ locks added
              ┌───────────▼──────────┐
              │  Apply Tree          │
              │  SetTreePrerequisites│
              └───────────┬──────────┘
                          │ prereqs in ProgressionManager
              ┌───────────▼──────────┐
              │  Gameplay Loop       │
              │  Cast spell → XP     │
              │  Read tome → XP      │
              │  Progress → Unlock   │
              └──────────────────────┘
```

---

## Key Data Files

| File | Location | Purpose |
|------|----------|---------|
| `spell_tree.json` | `Data/SKSE/Plugins/SpellLearning/` | Generated tree (nodes, links, roots, themes) |
| `config.json` | `Data/SKSE/Plugins/SpellLearning/` | Unified config (active preset, settings) |
| `presets/settings/*.json` | `Data/SKSE/Plugins/SpellLearning/presets/settings/` | Learning preset files (DEFAULT, Easy, Hard) |
| `presets/scanner/*.json` | `Data/SKSE/Plugins/SpellLearning/presets/scanner/` | Scanner/tree-gen preset files |
| Co-save (`.skse`) | Alongside save game | Learning targets, XP progress, early-learned spells |

---

## Cross-Version Support

| Component | SE 1.5.97 | AE 1.6.x |
|-----------|-----------|-----------|
| SpellTomeHook | `REL::RelocationID(17439, ...)` offset `+0xE8`, register `rdi` | `REL::RelocationID(..., 17842)` offset `+0x11D`, register `r15` |
| SpellEffectivenessHook | `RE::VTABLE_*` (auto-resolved) | Same |
| Address Library | `version-1.5.97.0.bin` (v1 format) | `versionlib-1.6.x.0.bin` (v2 format) |
| Plugin declaration | `SKSEPlugin_Query` (SE SKSE) | `SKSEPlugin_Version` (AE SKSE) |

---

## Build & Deploy

```
plugin/
  CMakeLists.txt          CMake build (VS 2022/2026, vcpkg)
  CMakePresets.json        vs2022 / vs2026 presets

Build: cmake --preset vs2026 && cmake --build build --config Release
Output: build/Release/SpellLearning.dll → auto-copies to MO2/mods/HeartOfMagic_RELEASE/
```

Dependencies (vcpkg): `spdlog`, `nlohmann-json`, `xbyak`
Shared: `CommonLibSSE-NG v4.2.0` (SE+AE, no VR)
