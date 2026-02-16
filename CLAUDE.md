# CLAUDE.md

Project instructions for Claude Code when working with Heart of Magic.

## What Is This Project?

Heart of Magic is an SKSE plugin (DLL) that transforms spell learning into an XP-based progression system for Skyrim SE/AE. It scans all spells in the player's load order, generates prerequisite trees using native C++ NLP algorithms (TF-IDF, cosine similarity, fuzzy matching, Edmonds' arborescence), and tracks learning progress through casting, tome study, and other XP sources.

**Key design**: All NLP runs natively in C++—no external Python or server dependencies. The build produces three DLLs: `SpellLearning.dll` (main plugin), `DontEatSpellTomes.dll` (inert DEST compatibility shim), and `SL_BookXP.dll` (BookXP addon). The UI is rendered through PrismaUI (CEF/Ultralight-based web views).

## Documentation Decision Tree

**Find the right doc based on your task:**

```
What are you doing?
│
├─► Understanding the system?
│   ├─► Overall architecture → docs/ARCHITECTURE.md
│   ├─► Tree building algorithms → docs/TREE_BUILDING_SYSTEM.md
│   └─► Design patterns & UI → docs/DESIGN.md
│
├─► Writing/modifying code?
│   ├─► Using RE/SKSE types? → Reference headers in plugins/external/commonlibsse-ng/
│   ├─► Module system? → docs/MODULE_CONTRACTS.md
│   └─► Public modder API? → docs/PLAN-PUBLIC-MODDER-API.md
│
├─► Working with PrismaUI frontend?
│   ├─► JS module structure → PrismaUI/views/SpellLearning/SpellLearningPanel/modules/README.md
│   └─► Translations → docs/TRANSLATING.md
│
├─► Working with presets?
│   └─► docs/PRESETS.md
│
├─► Working with DEST/ISL compatibility?
│   └─► docs/DEST-IMPROVEMENTS.md
│
└─► Working with BookXP addon?
    └─► plugins/BookXP/README.md
```

## Critical Rules (MUST Follow)

1. **600 LOC limit**: Split files when approaching this limit
2. **RE/SKSE types**: ALWAYS read headers from `plugins/external/commonlibsse-ng/` before using
3. **No AI footers**: NEVER add "Generated with Claude" or similar attribution
4. **Explore before coding**: ALWAYS search for existing utilities before writing new helpers
5. **Build validation**: ALWAYS run `.\BuildRelease.ps1` before completing a task
6. **Documentation maintenance**: ALWAYS update relevant docs/ after code changes that affect documented systems
7. **PrismaUI theme compatibility**: UI changes must work with all themes (default.json, skyrim.json)
8. **JavaScript compatibility**: Use `var` declarations in PrismaUI code (Ultralight compatibility—no `let`/`const`)

## Do NOT (Anti-Patterns)

### Code Safety
- **NEVER** guess at RE/SKSE methods—always verify in header files first
- **NEVER** use raw `new`/`delete`—use smart pointers
- **NEVER** use manual `mutex_.lock()`/`unlock()`—use `lock_guard` or `unique_lock`
- **NEVER** hardcode magic numbers—use named constants

### Architecture
- **NEVER** exceed 600 lines in a single file
- **NEVER** create new singleton managers without understanding existing patterns
- **NEVER** bypass the existing hook patterns (SpellCastHandler, SpellTomeHook, SpellEffectivenessHook)

### Code Duplication
- **NEVER** copy-paste large blocks of code to create variants—extract shared logic into a common implementation
- **NEVER** create function overloads that duplicate logic—use a single implementation with parameters to control behavior
- When adding a new variant of an existing function:
  1. Extract the core logic into an `*Impl` function with parameters for the varying behavior, or have one override call the other with appropriate defaults
  2. Have both the original and new function call the shared implementation

### Documentation
- **NEVER** complete a task without checking if documentation needs updating
- **NEVER** add new public APIs, config options, or systems without documenting them
- **NEVER** change behavior documented in docs/ without updating those docs
- **NEVER** assume documentation updates can be done "later"—do them in the same session

### PrismaUI / JavaScript
- **NEVER** use `let` or `const` in PrismaUI JavaScript—Ultralight requires `var`
- **NEVER** use ES6 module syntax (`import`/`export`)—use the existing global/module pattern
- **NEVER** hardcode colors that don't respect the theme system—use theme variables

### Git Safety
- **NEVER** use `git reset --hard` when there are uncommitted changes—this destroys work permanently
- **NEVER** use destructive git commands without first running `git status` to check for uncommitted changes
- When moving commits to a new branch, use this safe pattern:
  1. `git status` — verify no uncommitted changes (or stash them first with `git stash`)
  2. `git branch new-branch-name` — create branch at current commit
  3. `git reset --soft HEAD~N` — move HEAD back, keeping changes staged (NOT `--hard`)
- If uncommitted changes exist and you need to reset, ALWAYS `git stash` first

## Sub-Agent Guidelines (Task Tool)

When launching sub-agents via the Task tool, choose the correct `subagent_type` based on the work needed:

| Need | Agent Type | Tools Available |
|------|-----------|----------------|
| Code exploration, search, reading | `Explore` | Read-only (Glob, Grep, Read, WebFetch) |
| Designing implementation plans | `Plan` | Read-only (same as Explore) |
| Running shell commands only | `Bash` | Bash only |
| **Implementation** (editing files, running commands) | `general-purpose` | **All tools** (Edit, Write, Bash, Read, etc.) |

### Rules
- **NEVER** use `Explore` or `Plan` agents for implementation—they cannot Edit, Write, or run Bash and will fail with permission errors
- **Prefer direct edits** over sub-agents when only a few files need changing. Sub-agents are best for multi-file, multi-step operations
- **Windows environment**: This project runs on Windows with Git Bash as the shell. Use Unix-style paths and syntax (forward slashes, `/dev/null`) in Bash tool calls. PowerShell scripts like `BuildRelease.ps1` must be run via `powershell.exe` or `pwsh`

## Build Commands

```powershell
# Default build (Visual Studio 2022, Release, x64)
.\BuildRelease.ps1

# Clean reconfigure + build
.\BuildRelease.ps1 -fresh

# Visual Studio 2026 preset
.\BuildRelease.ps1 -preset Release-2026

# Control parallelism (default: 32 threads)
.\BuildRelease.ps1 -threads 16
```

**ALWAYS use `BuildRelease.ps1`**—never run cmake directly. The script handles VS dev shell setup, configuration, and output paths.

### Local Build Configuration

Copy `Build_Config_Template.ps1` to `Build_Config_Local.ps1` and edit to set:
- `$defaultOutputPath` — where DLLs are copied after build (e.g., your MO2 mod folder)
- `$vsDevShellPath` — path to your VS dev shell script

`Build_Config_Local.ps1` is gitignored.

### Skyrim Process Check

**CRITICAL**: Before ANY build, check if Skyrim is running. If Skyrim has the DLL loaded, the build will fail because the file is locked.

```powershell
if (Get-Process -Name "SkyrimSE" -ErrorAction SilentlyContinue) {
    Write-Host "ERROR: Skyrim is running - cannot build (DLL is locked). Close Skyrim first."
    # DO NOT BUILD - inform user and skip
}
```

**If Skyrim is running:**
- Inform the user: "Skyrim is currently running. Cannot build because the DLL is locked. Please close Skyrim to proceed."
- Do NOT attempt the build—it will fail
- Continue with non-build work if possible

### Build Validation Workflow

```
1. Make changes
2. Check if Skyrim is running → if yes, inform user and skip build
3. Run .\BuildRelease.ps1
4. Fix any compilation errors
5. Only then is the task complete
```

## Testing

### JavaScript Tests

```powershell
# Run from the SpellLearningPanel directory
cd PrismaUI/views/SpellLearning/SpellLearningPanel
node run-tests.js
```

**Test files:**
| File | Purpose |
|------|---------|
| `run-tests.js` | Node.js test runner with browser-global mocks |
| `modules/unificationTest.js` | Module unification/integration tests |
| `modules/autoTest.js` | In-game automated test harness (reads `test_config.json`) |
| `test-runner.html` | Browser-based test runner |

**Test config:** `SKSE/Plugins/SpellLearning/test_config.json`

### No C++ Test Framework

This project does not have a C++ test framework. Validation is done through:
- Compilation (build succeeds)
- JavaScript unit tests (above)
- In-game testing via autoTest.js and manual play

## Code Style

### C++ (C++23)

| Element | Convention | Example |
|---------|-----------|---------|
| Classes/Structs | PascalCase | `SpellLearningAPIImpl`, `InputHandler` |
| Member functions | PascalCase | `GetSingleton()`, `ProcessEvent()` |
| Free functions | PascalCase | `SetupLog()`, `OnDataLoaded()` |
| Member variables | `m_` prefix + camelCase | `m_hotkeyCode`, `m_targetPrerequisites` |
| Global variables | `g_` prefix | `g_api`, `g_sourceRegistered` |
| Constants | `k` prefix + PascalCase | `kSerializationUniqueID` |
| Local variables | camelCase | `buttonEvent`, `serialization` |
| Namespaces | PascalCase | `TreeNLP`, `SpellLearning` |
| Indentation | 4 spaces | (no tabs) |

- Smart pointers only—no raw `new`/`delete`
- `override` on all virtual function overrides
- `= delete` on copy constructors/assignment for singletons
- `static constexpr` for compile-time constants
- Section dividers: `// ==========...` box-style headers

### JavaScript (PrismaUI)

| Element | Convention | Example |
|---------|-----------|---------|
| Variables | `var` (NOT `let`/`const`) | `var spellData = {};` |
| Functions | camelCase | `updateTreeView()`, `handleSpellClick()` |
| Module pattern | Globals, no ES6 modules | Attach to window or use IIFE |
| Comments | JSDoc-style | `/** @param {string} name */` |

## Key Locations

| System | Location |
|--------|----------|
| Main plugin source | `plugins/spelllearning/src/` |
| Plugin headers | `plugins/spelllearning/include/` |
| Public C++ API | `plugins/spelllearning/src/SpellLearningAPI.h` |
| DEST compatibility shim | `plugins/DummyDEST/` |
| BookXP addon | `plugins/BookXP/` |
| Shared CMake modules | `plugins/cmake/` |
| CommonLibSSE-NG | `plugins/external/commonlibsse-ng/` |
| PrismaUI frontend | `PrismaUI/views/SpellLearning/SpellLearningPanel/` |
| PrismaUI JS modules | `PrismaUI/views/SpellLearning/SpellLearningPanel/modules/` |
| PrismaUI themes | `PrismaUI/views/SpellLearning/SpellLearningPanel/themes/` |
| PrismaUI languages | `PrismaUI/views/SpellLearning/SpellLearningPanel/lang/` |
| Spell tree viewer | `PrismaUI/views/SpellTreeViewer/` |
| Papyrus scripts | `Scripts/Source/` |
| Runtime SKSE data | `SKSE/Plugins/SpellLearning/` |
| Documentation | `docs/` |
| FOMOD installer | `fomod/` |
| Optional ISL patch | `optional/ISLPatch/` |
| Build output | `build/` (gitignored) |
| Lab/experiments | `lab/` |

## Environment Setup

### Prerequisites

- Visual Studio 2022 (or 2026) with C++ desktop workload
- CMake 3.25+
- vcpkg (set `$env:VCPKG_ROOT` or configure in vcpkg-configuration.json)
- Git (for submodules)

### First-Time Setup

```powershell
# 1. Initialize submodules
git submodule update --init --recursive

# 2. (Optional) Run dependency downloader for submodule repair
.\DownloadExternalDeps.ps1

# 3. Copy and edit local build config
Copy-Item Build_Config_Template.ps1 Build_Config_Local.ps1
# Edit Build_Config_Local.ps1 to set your output path and VS dev shell path

# 4. Build
.\BuildRelease.ps1
```

### vcpkg Dependencies

Managed via `vcpkg.json` manifest. Key packages: `fmt`, `spdlog`, `nlohmann-json`, `rapidcsv`, `xbyak`, `directxmath`, `directxtk`, `rapidfuzz-cpp`, `highway`, `curl`.

Triplet: `x64-windows-static` (statically linked MSVC runtime).

## Common Workflows

### Before Modifying Any Code
```
1. Read the file you're modifying
2. Check docs/ for relevant architecture/design docs
3. If using RE/SKSE types, reference actual headers in plugins/external/commonlibsse-ng/
4. Verify the 600 LOC limit won't be exceeded
5. Identify which docs/ files will need updating after the change
```

### Adding a New Feature
```
1. Read docs/ARCHITECTURE.md to understand where it fits
2. Check existing patterns in the codebase
3. Implement following existing conventions
4. Run .\BuildRelease.ps1 to verify
5. Update relevant docs/ (MANDATORY)
6. If adding new system, create new doc AND update this decision tree
```

### Fixing a Bug
```
1. Reproduce the issue (check logs, understand state)
2. Read surrounding code context
3. Check if similar patterns exist elsewhere
4. Fix with minimal changes
5. Run .\BuildRelease.ps1 to verify
6. If fix changes documented behavior, update relevant docs/
```

### After Any Code Change
```
1. Run .\BuildRelease.ps1 to verify compilation
2. Fix any compilation errors
3. Run JS tests if UI code was changed (node run-tests.js)
4. Review the Post-Change Documentation Checklist
5. Update affected docs before considering the task complete
```

## Keeping Documentation Current (MANDATORY)

**Documentation is part of the task, not a follow-up.** A code change is NOT complete until the relevant documentation is updated.

### The Rule

> **Every code change that affects documented behavior MUST include documentation updates IN THE SAME SESSION.**

### Post-Change Documentation Checklist

**STOP before marking any task complete.** Verify each item:
```
Did I add/modify a public API?          → Update docs/PLAN-PUBLIC-MODDER-API.md
Did I change system architecture?       → Update docs/ARCHITECTURE.md
Did I change tree building algorithms?  → Update docs/TREE_BUILDING_SYSTEM.md
Did I change design patterns or UI?     → Update docs/DESIGN.md
Did I change the module system?         → Update docs/MODULE_CONTRACTS.md
Did I change the preset system?         → Update docs/PRESETS.md
Did I change DEST/ISL compatibility?    → Update docs/DEST-IMPROVEMENTS.md
Did I change translation/i18n?          → Update docs/TRANSLATING.md
Did I add a new system?                 → Create new doc AND update decision tree in CLAUDE.md
```

### Do NOT
- Let documentation drift from implementation
- Complete a task saying "documentation can be updated later"
- Skip doc updates because the change seems "minor"
- Duplicate information across docs (cross-reference instead)

## All Documentation

| Document | Purpose |
|----------|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, component responsibilities |
| [docs/TREE_BUILDING_SYSTEM.md](docs/TREE_BUILDING_SYSTEM.md) | Tree builder algorithms (Classic, Tree, Graph, Thematic, Oracle) |
| [docs/DESIGN.md](docs/DESIGN.md) | Design patterns and UI documentation |
| [docs/MODULE_CONTRACTS.md](docs/MODULE_CONTRACTS.md) | How to create modules for Heart of Magic |
| [docs/PRESETS.md](docs/PRESETS.md) | Preset system documentation |
| [docs/TRANSLATING.md](docs/TRANSLATING.md) | Translation guide for localizing the mod |
| [docs/PLAN-PUBLIC-MODDER-API.md](docs/PLAN-PUBLIC-MODDER-API.md) | Public modder API reference and design |
| [docs/DEST-IMPROVEMENTS.md](docs/DEST-IMPROVEMENTS.md) | DEST compatibility comparison |
| [plugins/BookXP/README.md](plugins/addons/BookXP/README.md) | BookXP addon documentation |
