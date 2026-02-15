# Heart of Magic — UI & Feature Design

> Last updated: 2026-02-09

## UI Structure

The mod runs inside a single PrismaUI panel (CEF/Ultralight overlay) toggled with **F8**. Three top-level pages, plus modals.

```
┌─────────────────────────────────────────┐
│  [Spell Tree]   [Spell Scan]  [Settings]│  ← header tabs
├─────────────────────────────────────────┤
│                                         │
│           Active Page Content           │
│                                         │
└─────────────────────────────────────────┘
```

Default landing page: **Spell Tree**

---

## Page 1: Spell Tree (`contentSpellTree`)

The main gameplay page. Shows the interactive spell tree after it's been built.

**Modules:** `treeViewerUI.js`, `canvasRendererV2.js`, `wheelRenderer.js`, `treeCore.js`, `progressionUI.js`

### Layout

```
┌──────────────────────────────────────────────┐
│ [Zoom -][100%][Zoom +]  [Heart⚙] [✏ Edit]   │
├──────────────────────────────────────────────┤
│                                              │
│         Canvas 2D Spell Tree                 │
│         (radial/wheel layout)                │
│         Pan + zoom + node click              │
│                                              │
│    ┌─────────┐              ┌────────────┐   │
│    │ Details │              │  How-to    │   │
│    │ Sidebar │              │  Learn     │   │
│    │(on click)│             │  Panel     │   │
│    └─────────┘              └────────────┘   │
├──────────────────────────────────────────────┤
│ [Import] [LLM toolbar] Spells: 247  Legend   │
└──────────────────────────────────────────────┘
```

### Features
- **Canvas 2D renderer** — primary renderer for 200+ node trees
- **Node interaction** — click to see spell details, prerequisites, XP progress
- **Details sidebar** — spell name, school, tier, effects, prerequisites, learning controls
- **How-to-Learn panel** — shows what the player needs to do to unlock a spell
- **Discovery mode** — hides spell names/effects until XP thresholds are met
- **Zoom/pan** — mouse wheel + drag
- **Heart Settings popup** — cosmetic settings (starfield, globe, dividers, connections, node sizes)
- **Edit mode** — move nodes, pen tool, eraser (developer feature)
- **Empty state** — shown when no tree is loaded, prompts user to scan

### Visual Effects
- **Starfield** (`starfield.js`) — animated star background, parallax with pan
- **3D Globe** (`globe3D.js`) — rotating globe at tree center
- **Chain links** — drawn between nodes with hard prerequisites (locked spells)
- **Node states** — locked (gray fill + hole), learning (blue glow), unlocked (full color), weakened (partial opacity)

---

## Page 2: Spell Scan (`contentSpellScan`)

Where players scan spells and build their tree. Has two modes: **Easy** and **Complex**.

**Modules:** `easyMode.js`, `treeGrowth.js`, `buttonHandlers.js`, `scannerPresets.js`, `buildProgress.js`, `prereqMaster.js`

### Shared Components (both modes)

```
┌──────────────────────────────────────────────┐
│       [EASY]  [COMPLEX]  ← mode toggle       │
├──────────────────────────────────────────────┤
│ Status: Ready to scan                        │
│ [Scan Spells] [Export Scan]                  │
├──────────────────────────────────────────────┤
│ Total: 247 │ Mods: 12 │ Primed: 0           │
│ [Blacklist] [Whitelist] [☑ Tomes Only]       │
├──────────────────────────────────────────────┤
│                                              │
│         Mode-specific content below          │
│                                              │
└──────────────────────────────────────────────┘
```

### Easy Mode (`scannerEasyContent`)

Simplified one-click workflow.

```
┌─────────────────────┬────────────────────────┐
│  Preset Chips       │                        │
│  [DEFAULT] [Easy]   │   PRM Preview Canvas   │
│  [Hard] [Custom]    │   (shows tree + locks  │
│                     │    after build)         │
│  [Build Tree]       │                        │
│  [Apply Tree]       │                        │
│  [Clear Tree]       │                        │
│                     │                        │
│  Status: ...        │                        │
└─────────────────────┴────────────────────────┘
```

### Complex Mode (`scannerComplexContent`)

Full control over tree generation.

```
┌──────────────────────────────────────────────┐
│  Tree Building: [Classic] [Tree] [Sun] [Flat]│
│  ─────────────────────────────────────────── │
│  Tree Growth Settings                        │
│  (mode-specific: root count, trunk, branches)│
│  ─────────────────────────────────────────── │
│  Preview: [Sun preview] or [Flat preview]    │
│  ─────────────────────────────────────────── │
│                                              │
│  ▼ EXTRA SETTINGS (collapsible, post-scan)   │
│  ┌──────────────────────────────────────┐    │
│  │[Pre Req Master][Core][Alt Pathways]  │    │
│  ├────────────────────┬─────────────────┤    │
│  │  Tab Settings      │  Shared Preview │    │
│  │  (scrollable)      │  Canvas         │    │
│  └────────────────────┴─────────────────┘    │
│                                              │
│  [Build Tree] [Apply Tree] [Clear]           │
└──────────────────────────────────────────────┘
```

### Extra Settings Tabs

Only visible after a spell scan.

#### Pre Req Master (`prmTabLocks`)
Adds hard prerequisite "locks" to spells using NLP similarity scoring.
- Master enable toggle
- Global lock % slider
- Per-tier lock % (Novice → Master)
- School distribution mode
- Pool source (Same School / Any / Nearby)
- Tier constraints (Same, Previous, Higher tiers allowed)
- Chain locks toggle
- [Apply Locks] [Clear]

#### Core (`prmTabCore`)
Globe position and radius controls. Radius writes to `spell_tree.json` and is used by the canvas renderer for the central globe size.
- H Offset, V Offset, Radius sliders

#### Alternate Pathways (`prmTabAltPaths`)
Bidirectional soft prerequisite mirroring. Currently **disabled** (code commented out).
- Bidirectional toggle
- Stats display

---

## Page 3: Settings (`contentSettings`)

All mod configuration. Split-row layout for space efficiency.

**Modules:** `settingsPanel.js`, `settingsPresets.js`

### Layout

```
┌──────────────────────┬───────────────────────┐
│  Hotkey Settings     │  UI Display           │
│  Panel key: F8       │  Theme, Colors, Font  │
│  Pause game on open  │                       │
├──────────────────────┴───────────────────────┤
│  [DEFAULT] [Easy] [Hard] [Save Preset]       │
├──────────────────────┬───────────────────────┤
│  Progression         │  Early Spell Learning │
│  Learning mode       │  Enable toggle        │
│  XP multipliers      │  Unlock threshold     │
│  XP caps per source  │  Self-cast required at│
│  XP per tier         │  Power steps          │
│  Reveal thresholds   │  Binary effect thresh │
├──────────────────────┬───────────────────────┤
│  Spell Tome Learning │  Developer & Debug    │
│  Progression toggle  │  Dev mode toggle      │
│  XP grant on read    │  Cheat mode toggle    │
│  Inventory boost     │  Debug options        │
│  Require prereqs     │  (hidden by default)  │
├──────────────────────┴───────────────────────┤
│         [Save Settings]  [Reset Defaults]    │
└──────────────────────────────────────────────┘
```

### Key Settings Groups

**Progression:** How XP is earned and what thresholds unlock spells.
**Early Learning:** Grants nerfed spells before full mastery.
**Spell Tomes:** How reading spell tomes interacts with progression.
**Developer:** Tree generation tuning, procedural injection, LLM settings (hidden by default).

---

## Modals

| Modal | Trigger | Module |
|-------|---------|--------|
| Build Progress | Build Tree button | `buildProgress.js` |
| Preset Name | Save Preset button | `uiHelpers.js` |
| Blacklist | Blacklist button | `buttonHandlers.js` |
| Whitelist | Whitelist button | `buttonHandlers.js` |
| Import Tree | Import button (tree page) | `treeViewerUI.js` |
| Spawn Spell | Edit mode | `editMode.js` |
| Color Picker | Color swatches | `colorPicker.js` |

### Build Progress Modal

Shows staged progress during tree building:

```
┌─────────────────────────────────────┐
│  Building Spell Tree                │
│                                     │
│  ● Analyzing & Building Spell Tree  │
│  ○ Generating Prerequisites         │
│  ○ Finalizing Layout                │
│                                     │
│  ████████░░░░░░░░░  45%             │
│  Building tree structure...         │
│                                     │
│              [Done]  (hidden until  │
│                       complete)     │
└─────────────────────────────────────┘
```

Stages: Tree (C++ NLP build) → Prereqs (PRM if enabled) → Finalize

---

## Main User Workflows

### 1. First-Time Setup

```
Open panel (F8)
  → Spell Tree page (empty state)
  → Navigate to Spell Scan
  → Click "Scan Spells"
  → C++ scans game → returns spell JSON
  → UI shows scan stats, enables Build
```

### 2. Build Tree (Easy Mode)

```
Scan complete
  → Select preset chip (DEFAULT/Easy/Hard)
  → Click "Build Tree"
  → Build Progress modal opens
  → Stage 1: C++ builds tree (TF-IDF themes → layout → edges)
  → Stage 2: PRM scores locks (if enabled)
  → Stage 3: Finalize
  → Modal completes → tree visible in preview
  → Click "Apply Tree"
  → C++ receives prerequisites → gameplay begins
```

### 3. Build Tree (Complex Mode)

```
Scan complete
  → Switch to Complex mode
  → Choose growth mode (Classic/Tree/Sun/Flat)
  → Adjust settings (root count, branching, shapes)
  → Preview updates in real-time
  → Expand Extra Settings → tune PRM / Core
  → Click "Build Tree"
  → Same build pipeline as Easy
  → Click "Apply Tree"
```

### 4. Gameplay Loop

```
Tree applied
  → Navigate to Spell Tree page
  → See full tree with locked/available nodes
  → Click a node → Details sidebar shows prerequisites + XP
  → Cast spells in-game:
      Direct prereq cast → high XP (up to 50%)
      Same-school cast → medium XP (up to 15%)
      Any spell cast → low XP (up to 5%)
      Read spell tome → configurable XP%
  → At 25%: Early learning grants nerfed spell
  → At 100%: Mastery — full power spell
  → Discovery mode hides info until XP thresholds met
```

---

## JS Module Map

### Core Infrastructure
| Module | Purpose |
|--------|---------|
| `state.js` | Global state store (300+ properties) |
| `constants.js` | Default prompts, palettes, tier mappings |
| `config.js` | Tree config constants |
| `i18n.js` | Translation engine |
| `main.js` | Entry point, tab switching, module verification |
| `cppCallbacks.js` | All C++→JS callback handlers |
| `uiHelpers.js` | UI utilities, modal helpers, preset UI |

### Tree Rendering
| Module | Purpose |
|--------|---------|
| `canvasRendererV2.js` | **Primary** Canvas 2D renderer (handles 200+ nodes) |
| `wheelRenderer.js` | Legacy SVG renderer (still loaded, not primary) |
| `treeViewerUI.js` | Tree viewer page logic, node selection, detail panels |
| `treeParser.js` | Parses spell_tree.json, cycle detection, orphan fixing |
| `treeCore.js` | Core tree settings (globe position, size) |
| `trustedRenderer.js` | Renderer wrapper with validation |

### Tree Building
| Module | Purpose |
|--------|---------|
| `proceduralTreeBuilder.js` | JS/C++ procedural tree builder |
| `visualFirstBuilder.js` | Visual-first builder (layout → assign → edges) |
| `settingsAwareTreeBuilder.js` | Settings-aware wrapper |
| `layoutGenerator.js` | Grid/shape layout generation |
| `edgeScoring.js` | Edge scoring for spell relationships |
| `shapeProfiles.js` | Shape definitions (explosion, tree, organic) |
| `growthDSL.js` | Growth recipe DSL parser |
| `growthBehaviors.js` | Growth behavior implementations |

### Tree Preview
| Module | Purpose |
|--------|---------|
| `treePreview.js` | Preview orchestrator |
| `treePreviewSun.js` | Sun grid preview mode |
| `treePreviewFlat.js` | Flat grid preview mode |
| `treePreviewUtils.js` | Preview utilities |
| `sunGridLinear.js` | Linear sun grid layout |
| `sunGridEqualArea.js` | Equal-area sun grid |
| `sunGridFibonacci.js` | Fibonacci spiral grid |
| `sunGridSquare.js` | Square grid layout |

### Growth Modes
| Module | Purpose |
|--------|---------|
| `treeGrowth.js` | Growth mode orchestrator |
| `treeGrowthTree.js` | Tree growth mode (trunk/branch) |
| `classic/classicMain.js` | Classic growth mode |
| `classic/classicRenderer.js` | Classic mode renderer |
| `classic/classicLayout.js` | Classic layout engine |
| `classic/classicSettings.js` | Classic mode settings |
| `classic/classicThemeEngine.js` | Classic theme engine |
| `tree/treeRenderer.js` | Tree mode renderer |
| `tree/treeTrunk.js` | Tree trunk generation |
| `tree/treeSettings.js` | Tree mode settings |

### UI Panels & Features
| Module | Purpose |
|--------|---------|
| `settingsPanel.js` | Settings page (all config) |
| `settingsPresets.js` | Settings preset save/load |
| `scannerPresets.js` | Scanner preset save/load |
| `easyMode.js` | Easy mode scan page |
| `generationModeUI.js` | Complex mode per-school controls |
| `buttonHandlers.js` | Scan/build/apply button handlers |
| `buildProgress.js` | Build progress modal |
| `progressionUI.js` | Progression UI (learning targets, XP) |
| `prereqMaster.js` | Pre Req Master system |
| `editMode.js` | Tree edit mode |
| `colorPicker.js` | Color picker component |

### Visual Effects
| Module | Purpose |
|--------|---------|
| `starfield.js` | Animated starfield background |
| `globe3D.js` | 3D globe at tree center |
| `treeAnimation.js` | Build replay animation |

### LLM Integration
| Module | Purpose |
|--------|---------|
| `llmIntegration.js` | LLM API integration |
| `llmTreeFeatures.js` | LLM tree features |
| `llmApiSettings.js` | LLM API settings UI |

### Utilities
| Module | Purpose |
|--------|---------|
| `spellCache.js` | Spell data caching |
| `colorUtils.js` | Color management, school colors |

### Unused / Archive
| Module | Status |
|--------|--------|
| `_archive/canvasRenderer.js` | Replaced by canvasRendererV2 |
| `_archive/spellTreeRenderer.js` | Old renderer |
| `_archive/tierVisuals.js` | Old tier visuals |
| `webglRenderer.js` | Not supported in CEF |
| `webglShaders.js` | Not supported in CEF |
| `webglShapes.js` | Not supported in CEF |
| `unificationTest.js` | Test only |
| `autoTest.js` | Test only |

---

## C++ ↔ JS Communication

### JS → C++ (33 listeners via `callCpp`)

**Scanning:** `ScanSpells`, `SaveOutput`, `SaveOutputBySchool`
**Tree:** `LoadSpellTree`, `SaveSpellTree`, `GetSpellInfo`, `GetSpellInfoBatch`
**Progression:** `SetLearningTarget`, `ClearLearningTarget`, `UnlockSpell`, `GetProgress`, `CheatUnlockSpell`, `RelockSpell`, `GetPlayerKnownSpells`, `SetSpellXP`, `SetTreePrerequisites`
**Config:** `LoadUnifiedConfig`, `SaveUnifiedConfig`, `SetHotkey`, `SetPauseGameOnFocus`
**Presets:** `SavePreset`, `DeletePreset`, `LoadPresets`
**LLM:** `CheckLLM`, `LLMGenerate`, `PollLLMResponse`, `LoadLLMConfig`, `SaveLLMConfig`
**Tree Building:** `ProceduralPythonGenerate`, `PreReqMasterScore`
**Clipboard:** `CopyToClipboard`, `GetClipboard`
**Other:** `HidePanel`, `LogMessage`, `LoadPrompt`, `SavePrompt`

### C++ → JS (30+ calls via `InteropCall`)

**Lifecycle:** `onPrismaReady`, `onPanelShowing`, `onPanelHiding`
**Data:** `updateSpellData`, `updateTreeData`, `updateSpellInfo`, `updateSpellInfoBatch`
**State:** `updateSpellState`, `onResetTreeStates`, `onSaveGameLoaded`
**Progress:** `onProgressUpdate`, `onSpellReady`, `onSpellUnlocked`, `onProgressData`
**Config:** `onUnifiedConfigLoaded`, `onPresetsLoaded`
**Tree Building:** `onProceduralPythonComplete`, `onPreReqMasterComplete`, `onPythonAddonStatus`
**LLM:** `onLLMStatus`, `onLLMQueued`, `onLLMPollResult`, `onLLMConfigLoaded`

---

## Preset System

Two preset types, stored as individual JSON files:

### Settings Presets (`presets/settings/`)
Capture: Progression settings, early learning, tome learning, notifications.
Bundled: `DEFAULT.json`, `Easy.json`, `Hard.json`

### Scanner Presets (`presets/scanner/`)
Capture: Tree generation settings, preview modes, PRM settings, growth configs.
Bundled: `DEFAULT.json`

Presets are loaded from files on panel open via `LoadPresets` → `onPresetsLoaded`.

---

## Input & Focus

The panel uses a `.focus-overlay` div with `background: rgba(0,0,0,0.01)` to capture mouse events (CEF requires non-transparent pixels for hit testing). `tabindex="-1"` captures keyboard input. The C++ side calls `Focus()`/`Unfocus()` on PrismaUI to control game input passthrough.

`pauseGameOnFocus` (default: true) freezes the game while the panel is open.
