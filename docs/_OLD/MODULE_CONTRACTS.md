# Module Contracts: Root Preview & Tree Growth

## Architecture

The spell tree UI has two module layers, each managed by an orchestrator:

```
TreePreview (orchestrator)          TreeGrowth (orchestrator)
├── SUN    (root module)            ├── CLASSIC (growth module)
├── FLAT   (root module)            ├── TREE    (growth module)
└── ...add yours here               └── ...add yours here
```

**Root modules** define how school root nodes are positioned (radial wheel, flat line, etc.) and what grid of candidate points the growth layer uses.

**Growth modules** define how spells are placed, connected, and built into a tree structure on top of the root base.

Data flows one-way: `TreePreview.getOutput()` provides base data (root positions, grid points, school arcs) that growth modules consume.

## Adding a New Module

### Step 1: Create Your Module File

Root modules go in `modules/` (e.g., `modules/treePreviewHex.js`).
Growth modules can go in `modules/` or a subfolder (e.g., `modules/hex/hexMain.js`).

### Step 2: Add Script Tag

Add a `<script>` tag in `index.html` **before** the orchestrator script:

```html
<!-- Root modules load BEFORE treePreview.js -->
<script src="modules/treePreviewHex.js"></script>
<script src="modules/treePreview.js"></script>

<!-- Growth modules load BEFORE treeGrowth.js -->
<script src="modules/hex/hexMain.js"></script>
<script src="modules/treeGrowth.js"></script>
```

If the orchestrator loads first, it checks for pre-registered modules at its EOF. If your module loads first, it self-registers. Either order works.

### Step 3: Self-Register

At the bottom of your module file:

```javascript
// Root module
if (typeof TreePreview !== 'undefined') {
    TreePreview.registerMode('hex', TreePreviewHex);
}

// Growth module
if (typeof TreeGrowth !== 'undefined') {
    TreeGrowth.registerMode('hex', TreeGrowthHex);
}
```

The orchestrator will also check for your global at its EOF. Add a check there too for load-order safety:

```javascript
// In treePreview.js EOF section:
if (typeof TreePreviewHex !== 'undefined') {
    TreePreview.registerMode('hex', TreePreviewHex);
}
```

Tab buttons are generated dynamically from `this.modes` — your module automatically gets a tab when registered. No need to edit `_buildHTML()`.

## Environment Constraints

PrismaUI runs on Ultralight (embedded Chromium subset). Key constraints:

| Feature | Supported | Notes |
|---------|-----------|-------|
| `var` | Yes | Use `var` everywhere |
| `let` / `const` | No | Will throw syntax errors |
| Arrow functions `=>` | No | Use `function()` |
| Template literals | No | Use string concatenation |
| `class` | No | Use object literals |
| `for...of` | No | Use indexed `for` loops |
| `Array.from()` | No | Use manual iteration |
| `forEach` | Yes | Works on arrays |
| `JSON.parse/stringify` | Yes | |
| `requestAnimationFrame` | Yes | |
| `ResizeObserver` | Yes | |
| Canvas 2D | Yes | Full API |
| Dynamic `import()` | No | Script tags only |

## Root Module Contract

A root module is a global object that implements these methods:

### Required Properties

```javascript
var TreePreviewMyMode = {

    /** Custom tab label. If omitted, mode name is uppercased. */
    tabLabel: 'MY MODE',

    /** Settings state object. Structure is yours to define. */
    settings: {
        nodeSize: 8,
        // ...your settings
    },
```

### Required Methods

#### `buildSettingsHTML() → string`

Returns an HTML string for the settings panel (left side of the split view). Called when the user switches to your tab.

```javascript
    buildSettingsHTML: function() {
        var s = this.settings;
        return '' +
            '<div class="tree-preview-settings-title">My Mode Settings</div>' +
            '<div class="tree-preview-settings-grid">' +
                // Use TreePreviewUtils.settingHTML() for drag inputs
                TreePreviewUtils.settingHTML('Node Size', 'tpMyNodeSize', 1, 20, 1, s.nodeSize) +
            '</div>';
    },
```

Use `TreePreviewUtils.settingHTML(label, id, min, max, step, value, suffix)` for consistent drag-input sliders.

#### `bindEvents()`

Bind DOM event listeners for your settings controls. Called immediately after `buildSettingsHTML()` injects into the DOM.

```javascript
    bindEvents: function() {
        var self = this;
        TreePreviewUtils.bindInput('tpMyNodeSize', function(v) {
            self.settings.nodeSize = v;
            self._markDirty();
        });
    },
```

#### `render(ctx, w, h, schoolData)`

Draw your root visualization on the shared canvas.

| Param | Type | Description |
|-------|------|-------------|
| `ctx` | CanvasRenderingContext2D | Already transformed (pan/zoom applied by orchestrator) |
| `w` | number | Canvas width in CSS pixels |
| `h` | number | Canvas height in CSS pixels |
| `schoolData` | object | `{ "Destruction": 228, "Conjuration": 156, ... }` — spell counts per school |

Center of canvas is `(w/2, h/2)`. The orchestrator handles pan/zoom transforms — just draw relative to canvas center.

**Important**: Store render output in `this._lastRenderData` so the orchestrator's auto-fit can read content extents:

```javascript
    render: function(ctx, w, h, schoolData) {
        var rootNodes = [];
        // ...compute and draw root nodes...
        // Each root node: { x, y, dir, school, color }

        this._lastRenderData = {
            rootNodes: rootNodes,
            ringRadius: 150  // optional: max content radius for auto-fit
        };
    },
```

### Optional Methods

#### `getGridData() → object`

Returns structured data that growth modules consume via `TreePreview.getOutput()`. This is the bridge between layers.

```javascript
    getGridData: function() {
        return {
            mode: 'mymode',              // Growth modules use this to pick algorithm
            schools: this._schools,       // Array of { name, color, arcStart, arcSize, ... }
            grid: {                       // Grid parameters
                tierSpacing: 30,
                ringTier: this.settings.ringTier
                // ...your grid config
            },
            gridPoints: this._gridPoints  // Array of { x, y } candidate positions
        };
    },
```

### Dirty Marking

When settings change, tell the orchestrator to re-render:

```javascript
    _markDirty: function() {
        if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
    },
```

## Growth Module Contract

Growth modules are more complex because they manage the full tree lifecycle: preview, build, apply, clear.

### Required Properties

```javascript
var TreeGrowthMyMode = {

    /** Custom tab label. If omitted, mode name is uppercased. */
    tabLabel: 'MY MODE',

    settings: {
        ghostOpacity: 35,
        nodeRadius: 5,
        // ...your settings
    },

    // Built tree data (from Python backend)
    _treeData: null,
```

### Required Methods

#### `buildSettingsHTML() → string`

Same as root modules. Returns HTML for the settings panel.

#### `bindEvents()`

Same as root modules. Can accept a callbacks object if using a separate settings module:

```javascript
    bindEvents: function() {
        var self = this;
        MySettings.bindEvents({
            onBuild: function() { self.buildTree(); },
            onApply: function() { self.applyTree(); },
            onClear: function() { self.clearTree(); },
            onSettingChanged: function(key, value) {
                self.settings[key] = value;
                self._markDirty();
            }
        });
    },
```

#### `render(ctx, w, h, baseData)`

Draw the growth visualization on the shared canvas.

| Param | Type | Description |
|-------|------|-------------|
| `ctx` | CanvasRenderingContext2D | Already transformed (pan/zoom) |
| `w` | number | Canvas width in CSS pixels |
| `h` | number | Canvas height in CSS pixels |
| `baseData` | object / null | Output from `TreePreview.getOutput()` — null if no root base configured |

The `baseData` object contains:

```javascript
{
    mode: 'sun',                    // Root mode name
    schools: [...],                 // School arc/segment data
    rootNodes: [{ x, y, dir, school, color }, ...],
    grid: { tierSpacing, ringTier, ... },
    gridPoints: [{ x, y }, ...],
    schoolData: { Destruction: 228, ... },
    renderGrid: function(ctx, w, h) { ... }  // Call to draw the root base underneath
}
```

Typical render pattern:

```javascript
    render: function(ctx, w, h, baseData) {
        if (!baseData) {
            // Show "scan spells first" placeholder
            return;
        }

        // 1. Draw root base underneath
        baseData.renderGrid(ctx, w, h);

        // 2. Draw your growth nodes on top
        this._renderNodes(ctx, w, h);
    },
```

### Tree Lifecycle Methods

These are called by the shared Build / Apply / Clear buttons in the UI.

#### `buildTree()`

Trigger tree construction. Typically sends spell data to the Python backend via `window.callCpp()`, receives the tree structure, and stores it for layout + rendering.

```javascript
    buildTree: function() {
        var spellData = TreeGrowth.getSpellData();
        if (!spellData) return;

        var baseData = TreePreview.getOutput();
        var config = {
            mode: 'mymode',
            // ...your config
        };

        // Call Python backend
        window.callCpp('RunProceduralPython', JSON.stringify({
            spells: spellData.spells,
            config: config
        }));
    },
```

#### `loadTreeData(data)`

Called when the Python backend returns tree data. Store it, run layout, update preview.

```javascript
    loadTreeData: function(data) {
        this._treeData = data;
        this._runLayout();
        this._markDirty();

        TreeGrowth.setTreeBuilt(true, data.totalPlaced, data.totalPool);
    },
```

#### `applyTree()`

Save the positioned tree to `spell_tree.json` via the C++ backend. This is what the game reads at runtime.

```javascript
    applyTree: function() {
        if (!this._layoutData) return;

        window.callCpp('SaveSpellTree', JSON.stringify(this._layoutData));
        TreeGrowth.setStatusText('Tree saved', '#22c55e');
    },
```

#### `clearTree()`

Reset all tree state.

```javascript
    clearTree: function() {
        this._treeData = null;
        this._layoutData = null;
        this._markDirty();

        TreeGrowth.setTreeBuilt(false);
    },
```

### Dirty Marking

```javascript
    _markDirty: function() {
        if (typeof TreeGrowth !== 'undefined') TreeGrowth._markDirty();
    },
```

## Sub-Module Pattern

For complex modes, split into sub-modules (like Classic does):

```
modules/mymode/
├── mymodeMain.js       ← Orchestrator, implements growth contract
├── mymodeSettings.js   ← Settings panel UI
├── mymodeLayout.js     ← Layout algorithm
└── mymodeRenderer.js   ← Canvas rendering
```

Sub-modules are plain globals. The main module calls into them:

```javascript
// mymodeMain.js
var TreeGrowthMyMode = {
    buildSettingsHTML: function() {
        return MyModeSettings.buildHTML(this.settings);
    },
    render: function(ctx, w, h, baseData) {
        MyModeRenderer.draw(ctx, w, h, this._layoutData, baseData);
    }
};
```

Load sub-modules BEFORE the main module in `index.html`:

```html
<script src="modules/mymode/mymodeRenderer.js"></script>
<script src="modules/mymode/mymodeSettings.js"></script>
<script src="modules/mymode/mymodeLayout.js"></script>
<script src="modules/mymode/mymodeMain.js"></script>
```

## Sun Grid Sub-Modules

The SUN root module has its own sub-module system for grid algorithms. Grid modules register via:

```javascript
var SunGridMyAlgo = {
    generate: function(params) {
        // params: { cx, cy, innerR, outerR, arcStart, arcEnd, tierSpacing, ... }
        // Return: [{ x, y }, ...]
        return points;
    }
};

if (typeof TreePreviewSun !== 'undefined') {
    TreePreviewSun.registerGrid('myalgo', SunGridMyAlgo);
}
```

## Orchestrator API Reference

### TreePreview (Root Orchestrator)

| Method | Description |
|--------|-------------|
| `registerMode(name, module)` | Register a root module |
| `registerPlaceholder(name)` | Register a disabled "coming soon" tab |
| `switchMode(name)` | Switch to a mode (updates tabs, settings, render) |
| `getOutput()` | Returns base data for growth modules |
| `_markDirty()` | Request a re-render |

### TreeGrowth (Growth Orchestrator)

| Method | Description |
|--------|-------------|
| `registerMode(name, module)` | Register a growth module |
| `registerPlaceholder(name)` | Register a disabled "coming soon" tab |
| `switchMode(name)` | Switch to a mode |
| `getSpellData()` | Returns current spell scan data |
| `setTreeBuilt(built, nodeCount, totalPool)` | Update shared UI state |
| `setStatusText(text, color)` | Update status label |
| `updateBuildButton()` | Refresh build button enabled state |
| `_markDirty()` | Request a re-render |

## Checklist for New Modules

- [ ] ES5 only — `var`, `function()`, no arrow functions, no template literals
- [ ] Global object with unique name (e.g., `var TreePreviewHex = { ... }`)
- [ ] Self-registers at EOF with `if (typeof Orchestrator !== 'undefined')`
- [ ] Implements all required methods for its type (root or growth)
- [ ] Settings use `TreePreviewUtils.settingHTML()` and `TreePreviewUtils.bindInput()` for consistent UI
- [ ] `render()` draws relative to canvas center `(w/2, h/2)`
- [ ] Calls `_markDirty()` when settings change
- [ ] Script tag added to `index.html` before the orchestrator
- [ ] Orchestrator EOF section has a check for your global

## File Reference

| File | Role |
|------|------|
| `modules/treePreview.js` | Root base orchestrator |
| `modules/treePreviewSun.js` | SUN root module (radial wheel) |
| `modules/treePreviewFlat.js` | FLAT root module (linear) |
| `modules/treePreviewUtils.js` | Shared UI helpers (drag inputs) |
| `modules/treeGrowth.js` | Tree growth orchestrator |
| `modules/classic/classicMain.js` | CLASSIC growth module |
| `modules/treeGrowthTree.js` | TREE growth module |
| `modules/sunGrid*.js` | SUN grid sub-modules |
