# Heart of Magic - Spell Learning & Progression

Heart of Magic transforms spell learning into an active journey of practice and growth. The mod scans every spell in your load order, generates a personalized skill tree with intelligent prerequisites, and tracks your progress as you cast and practice magic.

No manual configuration required. Compatible with every spell mod.

## Features

### Intelligent Spell Tree Generation

The system analyzes spell names, effects, keywords, and descriptions to build prerequisite trees that make sense. Fire spells branch from fire. Healing chains lead to greater restoration. No hardcoded spell lists - it discovers what elements exist in your load order and builds around them.

**Five native C++ builder modes, all fully automatic:**

| Mode | Description |
|---|---|
| **Classic** | Tier-first builder. Novice at roots, Master at edges. NLP similarity guides parent selection. |
| **Tree** | NLP-driven. TF-IDF similarity drives parent-child links with round-robin theme interleaving. |
| **Graph** | Edmonds' minimum arborescence for optimal prerequisite chains. |
| **Thematic** | Groups spells by discovered themes (TF-IDF + fuzzy matching), builds within-theme chains. |
| **Oracle** | LLM-assisted builder (OpenRouter API) with native C++ fallback. |

No external dependencies. All NLP (TF-IDF, cosine similarity, fuzzy matching) runs natively in C++.

### Two Growth Modes

- **Classic** - Concentric rings with natural symmetrical fan layouts. Configurable spell matching (Simple, Layered, or Smart).
- **Tree** - Trunk corridor with configurable branch/trunk/root allocation. More structured visual design.

Both modes show a live ghost-node preview as the tree builds.

### Spells Are Earned, Not Given

XP comes from actually casting prerequisite spells. Hit a target? Bonus XP. Deal damage? Even more. Highly configurable difficulty with built-in presets (Easy, Default, Hard) or create your own.

### Early Access with Progressive Power

At configurable thresholds, gain early access to a weakened spell that grows in discrete steps:

| XP Progress | Spell Power | Stage |
|---|---|---|
| 25% | 20% | Budding |
| 40% | 35% | Developing |
| 55% | 50% | Practicing |
| 70% | 65% | Advancing |
| 85% | 80% | Refining |
| 100% | 100% | Mastered |

Binary effects (Paralysis, Invisibility) are disabled below 80% effectiveness.

### Progressive Discovery

In Discovery Mode, spells ahead of you remain hidden - names obscured, effects unknown. You uncover the tree as you progress.

### Pre-Req Master (Lock Prerequisites)

An advanced optional system that adds hidden "lock" prerequisites on top of your tree. Lock candidates are scored using token overlap and fuzzy similarity, with proximity bias. Higher tiers get more locks. BFS cycle detection prevents deadlocks.

### Scanner UI - Easy & Complex Modes

- **Easy Mode** (Default) - Pick a preset, hit Build, done. Big preset chips, live tree preview, one screen.
- **Complex Mode** - Full control over every parameter: output fields, fuzzy match thresholds, generation seed, plugin filtering, growth mode settings, and more.

### Spell Tome Integration

When you read a spell tome for a spell in your learning tree:
- Grants configurable XP toward that spell
- Sets it as your active learning target
- Keeps the book (doesn't consume it)
- Bonus XP while the tome is in your inventory

For spells not in the tree, vanilla behavior is preserved. Built-in DEST compatibility.

### Presets

- **Settings Presets** - Control progression feel. Three built-in profiles (Default, Easy, Hard) plus unlimited custom presets.
- **Tree Generation Presets** - Save and load entire tree-building configurations. Auto-applied on startup.

### Plugin Whitelist & Blacklist

Control exactly which mods contribute spells. Uses stable `plugin:formId` keys that survive load order changes.

## Requirements

### Required
- **Skyrim SE/AE** (1.5.97+ or AE)
- **[SKSE64](https://skse.silverlock.org/)**
- **[Address Library for SKSE Plugins](https://www.nexusmods.com/skyrimspecialedition/mods/32444)**
- **[PrismaUI](https://www.nexusmods.com/skyrimspecialedition/mods/)** - UI framework (must load before Heart of Magic)

## Installation

### Using a Mod Manager (Recommended)
1. Download the latest release
2. Install through your mod manager (MO2, Vortex, etc.)
3. Ensure PrismaUI loads before Heart of Magic
4. Enable the mod

### Folder Structure
```
Data/
├── Scripts/
│   └── SpellLearning_Bridge.pex
├── SKSE/
│   └── Plugins/
│       ├── SpellLearning.dll
│       └── SpellLearning/
│           ├── config.json
│           └── presets/
│               ├── settings/     (DEFAULT.json, Easy.json, Hard.json)
│               └── scanner/      (DEFAULT.json)
├── SEQ/
│   └── SpellLearning.seq
└── PrismaUI/
    └── views/
        └── SpellLearning/
            └── SpellLearningPanel/
```

## Quick Start

1. Install Heart of Magic and PrismaUI via your mod manager
2. Launch the game and press **F8** (default hotkey) to open the UI
3. You'll land on the **Easy Mode** scanner page
4. Click **Scan** to detect all spells in your load order
5. Choose a preset (or use defaults) and click **Build Tree**
6. Switch to the **Spell Tree** tab to see your generated tree
7. In gameplay: find spell tomes for root spells to begin learning. Cast prerequisite spells to earn XP toward new ones

> The native C++ builders run near-instantly, even with 1500+ spells.

## Settings & Customization

**Progression** - Learning mode (per-school or global), XP multiplier and per-source caps, tier XP requirements, early learning thresholds, self-cast requirements.

**Visual** - Theme selection, per-school color customization, node size scaling by tier, ghost node opacity and preview controls.

**Developer Mode** - Debug grid, tree rules, and output fields for modders.

## Troubleshooting

### Common Issues

| Problem | Fix |
|---------|-----|
| UI not opening | Ensure PrismaUI is installed and loading. Check SKSE logs. |
| DLL not loading | Verify `SpellLearning.dll` exists in `SKSE/Plugins/`. Check SKSE logs for errors. |
| Tree not generating | Make sure you scanned spells first. Check SKSE logs for errors. |
| Quest not starting on existing save | Console: `stopquest SpellLearning` then `startquest SpellLearning` |
| Spells not appearing | Some NPC-only or duplicate spells are filtered. Check plugin whitelist/blacklist. |

## Documentation

- [MODULE_CONTRACTS.md](docs/MODULE_CONTRACTS.md) - How to create modules for Heart of Magic
- [TRANSLATING.md](docs/TRANSLATING.md) - Translation guide
- [PRESETS.md](docs/PRESETS.md) - Preset system documentation
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - Technical architecture overview
- [PLAN-PUBLIC-MODDER-API.md](docs/PLAN-PUBLIC-MODDER-API.md) - Public modder API reference

## Technical Details

- Pure DLL + UI mod. No ESP required. Save-safe to add and remove.
- SKSE plugin with Address Library support (SE 1.5.97+ and AE)
- PrismaUI-powered web interface (CEF/Ultralight)
- FormID persistence survives load order changes (`plugin:localFormId` format)
- Performance-optimized for large load orders (tested with 1500+ spells)

## Building from Source

### Requirements
- Visual Studio 2022 (or 2026)
- CMake 3.21+
- [vcpkg](https://github.com/microsoft/vcpkg) with `VCPKG_ROOT` environment variable set

CommonLibSSE-NG is included as a git submodule - no separate installation needed.

### Build

```powershell
# Using the build script (recommended)
.\BuildRelease.ps1               # Default: Release-2022 preset
.\BuildRelease.ps1 -fresh        # Clean reconfigure + build
.\BuildRelease.ps1 -preset Release-2026  # VS 2026

# Or manually with CMake
cmake --preset Release-2022
cmake --build --preset Release-2022
```

This builds all three targets from a single super-build:
- `SpellLearning.dll` - Main plugin
- `DontEatSpellTomes.dll` - DEST compatibility shim
- `SL_BookXP.dll` - BookXP addon

Output is in `build/`.

### Project Structure

```
HeartOfMagic/
├── CMakeLists.txt              # Top-level super-build
├── CMakePresets.json            # Shared build presets
├── vcpkg.json                  # Shared dependencies
├── BuildRelease.ps1             # Build script
├── plugins/
│   ├── cmake/                  # Shared CMake modules
│   │   ├── CompilerFlags.cmake   # MSVC optimization flags
│   │   └── commonlibsse.cmake    # CommonLibSSE-NG setup
│   ├── external/
│   │   └── commonlibsse-ng/    # Git submodule (built once)
│   ├── spelllearning/          # Main SpellLearning plugin
│   ├── compatibility/
│   │   └── DummyDEST/          # DEST compatibility shim
│   └── addons/
│       └── BookXP/             # BookXP addon plugin
```

## Credits

- [SKSE Team](https://skse.silverlock.org/) for SKSE64
- [PrismaUI](https://www.nexusmods.com/skyrimspecialedition/mods/) developers
- [DEST](https://www.nexusmods.com/skyrimspecialedition/mods/43095) - Spell tome hook reference
- [CommonLibSSE-NG](https://github.com/alandtse/CommonLibVR) by alandtse

## License

[MIT License](LICENSE)
