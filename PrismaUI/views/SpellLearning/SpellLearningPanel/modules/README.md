# SpellLearning JavaScript Modules

Modular JavaScript architecture for LLM maintainability. Original 8000+ line monolithic `script.js` split into 17 focused modules.

## Architecture Goals

- **LLM Readability:** Each file under ~1000 lines (16/18 achieved)
- **Single Responsibility:** Each module handles one domain
- **Clear Dependencies:** Documented load order and dependencies
- **No Bundler Required:** Plain `<script>` tags, global scope

## Module Summary

| Module | Lines | Purpose |
|--------|------:|---------|
| `constants.js` | 267 | Core constants, difficulty profiles, keycodes |
| `state.js` | 143 | Settings object, app state, XP overrides |
| `config.js` | 266 | Tree layout and visual configuration |
| `spellCache.js` | 114 | Async spell data caching |
| `colorUtils.js` | 258 | School colors, dynamic CSS generation |
| `uiHelpers.js` | 189 | Status updates, tooltips, tier helpers |
| `growthDSL.js` | 301 | LLM-driven procedural tree visual DSL |
| `treeParser.js` | 461 | Tree JSON parsing, validation, cycle detection |
| `wheelRenderer.js` | 1296 | SVG radial tree rendering engine |
| `settingsPanel.js` | 1001 | Settings UI initialization and persistence |
| `treeViewerUI.js` | 618 | Tree viewer, spell details, node selection |
| `progressionUI.js` | 547 | How-to-Learn panel, learning status badges |
| `difficultyProfiles.js` | 429 | Profile management, presets, custom profiles |
| `llmApiSettings.js` | 230 | OpenRouter API configuration UI |
| `buttonHandlers.js` | 264 | Scan, learn, import/export button handlers |
| `cppCallbacks.js` | 438 | C++ SKSE plugin callback handlers |
| `llmIntegration.js` | 621 | LLM tree generation, color suggestions |
| **script.js** | 802 | Main init, tabs, dragging, early learning |
| **TOTAL** | ~8245 | |

## Load Order (index.html)

Modules must load in dependency order before `script.js`:

```html
<!-- 1. Constants and Configuration -->
<script src="modules/constants.js"></script>
<script src="modules/state.js"></script>
<script src="modules/config.js"></script>

<!-- 2. Core Utilities -->
<script src="modules/spellCache.js"></script>
<script src="modules/colorUtils.js"></script>
<script src="modules/uiHelpers.js"></script>

<!-- 3. DSL and Parsers -->
<script src="modules/growthDSL.js"></script>
<script src="modules/treeParser.js"></script>

<!-- 4. Renderer -->
<script src="modules/wheelRenderer.js"></script>

<!-- 5. UI Panels -->
<script src="modules/settingsPanel.js"></script>
<script src="modules/treeViewerUI.js"></script>
<script src="modules/progressionUI.js"></script>
<script src="modules/difficultyProfiles.js"></script>
<script src="modules/llmApiSettings.js"></script>
<script src="modules/buttonHandlers.js"></script>

<!-- 6. Integrations -->
<script src="modules/cppCallbacks.js"></script>
<script src="modules/llmIntegration.js"></script>

<!-- 7. Main Application -->
<script src="script.js"></script>
```

## Module Dependencies

```
constants.js          (no deps)
    ↓
state.js              (uses: constants.js)
    ↓
config.js             (no deps)
    ↓
spellCache.js         (uses: state.js)
colorUtils.js         (uses: state.js, constants.js)
uiHelpers.js          (uses: state.js)
    ↓
growthDSL.js          (no deps)
treeParser.js         (uses: state.js)
    ↓
wheelRenderer.js      (uses: state.js, config.js, colorUtils.js, treeParser.js)
    ↓
settingsPanel.js      (uses: state.js, constants.js, colorUtils.js, uiHelpers.js)
treeViewerUI.js       (uses: state.js, wheelRenderer.js, colorUtils.js)
progressionUI.js      (uses: state.js, wheelRenderer.js, uiHelpers.js)
difficultyProfiles.js (uses: state.js, constants.js, uiHelpers.js)
llmApiSettings.js     (uses: state.js, uiHelpers.js)
buttonHandlers.js     (uses: state.js, treeParser.js, wheelRenderer.js, spellCache.js)
    ↓
cppCallbacks.js       (uses: state.js, treeParser.js, wheelRenderer.js, spellCache.js)
llmIntegration.js (uses: state.js, growthDSL.js, wheelRenderer.js, colorUtils.js)
    ↓
script.js             (uses: all modules)
```

## Key Global Objects

| Object | Module | Description |
|--------|--------|-------------|
| `DEFAULT_TREE_RULES` | constants.js | Default LLM tree generation rules |
| `DIFFICULTY_PROFILES` | constants.js | 6 preset difficulty profiles |
| `KEY_CODES` | constants.js | Keyboard code mapping |
| `settings` | state.js | All user settings (persisted) |
| `state` | state.js | Runtime state (tree, selection, etc.) |
| `customProfiles` | state.js | User-created difficulty profiles |
| `xpOverrides` | state.js | Per-spell XP overrides |
| `TREE_CONFIG` | config.js | Tree layout configuration |
| `SpellCache` | spellCache.js | Spell data cache singleton |
| `TreeParser` | treeParser.js | Tree parsing utilities |
| `WheelRenderer` | wheelRenderer.js | SVG rendering engine |
| `GROWTH_DSL` | growthDSL.js | Procedural tree visual DSL |

## Key Functions by Module

### constants.js
- Exports `DEFAULT_TREE_RULES`, `DIFFICULTY_PROFILES`, `KEY_CODES`, `DEFAULT_COLOR_PALETTE`

### state.js
- Exports `settings`, `state`, `customProfiles`, `xpOverrides`
- `updateSliderFillGlobal(slider)` - Update slider fill visual

### colorUtils.js
- `getOrAssignSchoolColor(school)` - Get/create school color
- `applySchoolColorsToCSS()` - Generate dynamic CSS
- `updateSchoolColorPickerUI()` - Update color picker UI

### treeParser.js
- `TreeParser.parse(data)` - Parse and validate tree JSON
- `TreeParser.detectAndFixCycles(nodes)` - Fix circular dependencies

### wheelRenderer.js
- `WheelRenderer.init(svg)` - Initialize renderer
- `WheelRenderer.setData(treeData)` - Load tree data
- `WheelRenderer.render()` - Render tree to SVG
- `WheelRenderer.updateNodeStates()` - Update visual states

### settingsPanel.js
- `initializeSettings()` - Setup all settings UI
- `loadSettings()` / `saveSettings()` - Config persistence
- `window.onUnifiedConfigLoaded(data)` - C++ callback

### cppCallbacks.js
- `window.onScanComplete(data)` - Spell scan callback
- `window.onTreeDataReceived(data)` - Tree load callback
- `window.onProgressionDataReceived(data)` - XP data callback
- `window.onSpellLearned(data)` - Spell learned notification

## Backup Files

- `script-backup.js` - Pre-modularization backup
- `script-full-backup.js` - Complete original (8190 lines)

## Notes for LLMs

- **Read one module at a time** - Each is self-contained for its domain
- **Check dependencies** - Load order matters for global object availability
- **All modules use globals** - No import/export (browser compatibility)
- **Settings persistence** - Handled by `settingsPanel.js` via C++ bridge
- **C++ callbacks** - All `window.on*` functions in `cppCallbacks.js`
