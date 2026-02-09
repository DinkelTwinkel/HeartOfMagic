# Creating Custom Modules

Heart of Magic's spell tree UI is built on a modular system. You can add your own root base layouts and tree growth algorithms without modifying any existing files.

## Architecture

The UI has two layers, each managed by an orchestrator:

```
Root Base Preview                   Tree Growth Preview
(how school roots are arranged)     (how spells are placed on the tree)

TreePreview orchestrator            TreeGrowth orchestrator
  |- SUN   (radial wheel)             |- CLASSIC (grid-based layout)
  |- FLAT  (linear line)              |- TREE    (trunk corridor)
  '- YOUR MODULE                      '- YOUR MODULE
```

**Root modules** control where school root nodes sit and what grid of points is available for spell placement.

**Growth modules** control how spells are placed, connected, and built into a tree structure on top of the root base.

Data flows one way: the root base provides grid data that growth modules consume.

## ES5 Only

Heart of Magic runs on PrismaUI (Ultralight), which only supports ES5 JavaScript. This is the most important constraint:

| Use This | NOT This |
|----------|----------|
| `var x = 5;` | `let x = 5;` or `const x = 5;` |
| `function(x) { return x; }` | `(x) => x` |
| `'Hello ' + name` | `` `Hello ${name}` `` |
| `for (var i = 0; i < arr.length; i++)` | `for (let item of arr)` |
| Object literal `{ key: fn }` | `class MyClass {}` |

If you use modern JS features, the UI will throw syntax errors and your module won't load.

## Creating a Root Module

### 1. Create the file

Create a JS file in `PrismaUI/views/SpellLearning/SpellLearningPanel/modules/`. Name it `treePreview[YourMode].js`.

### 2. Minimal working example

```javascript
/**
 * Tree Preview - HEX Mode
 * Self-registers with TreePreview via registerMode().
 */
var TreePreviewHex = {

    // Optional: custom tab label (defaults to mode name uppercased)
    tabLabel: 'HEX',

    // Your settings - structure is up to you
    settings: {
        hexSize: 30,
        nodeSize: 8
    },

    // Stores last render output for auto-fit scaling
    _lastRenderData: null,

    /**
     * Return HTML for the settings panel (left side).
     * Called when user switches to your tab.
     */
    buildSettingsHTML: function() {
        var s = this.settings;
        return '' +
            '<div class="tree-preview-settings-title">Hex Grid Settings</div>' +
            '<div class="tree-preview-settings-grid">' +
                TreePreviewUtils.settingHTML('Hex Size', 'tpHexSize', 10, 100, 5, s.hexSize) +
                TreePreviewUtils.settingHTML('Node Size', 'tpHexNodeSize', 1, 20, 1, s.nodeSize) +
            '</div>';
    },

    /**
     * Bind DOM events for settings controls.
     * Called immediately after buildSettingsHTML() injects into the DOM.
     */
    bindEvents: function() {
        var self = this;
        TreePreviewUtils.bindInput('tpHexSize', function(v) {
            self.settings.hexSize = v;
            if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
        });
        TreePreviewUtils.bindInput('tpHexNodeSize', function(v) {
            self.settings.nodeSize = v;
            if (typeof TreePreview !== 'undefined') TreePreview._markDirty();
        });
    },

    /**
     * Draw root visualization on the shared canvas.
     *
     * ctx      - CanvasRenderingContext2D (pan/zoom already applied)
     * w, h     - Canvas dimensions in CSS pixels
     * schoolData - { "Destruction": 228, "Conjuration": 156, ... }
     */
    render: function(ctx, w, h, schoolData) {
        if (!schoolData) return;

        var cx = w / 2;
        var cy = h / 2;
        var rootNodes = [];

        // ... your layout logic here ...
        // Place school roots, draw grid, etc.

        // IMPORTANT: store render data for auto-fit
        this._lastRenderData = {
            rootNodes: rootNodes  // array of { x, y, dir, school, color }
        };
    },

    /**
     * Optional: return structured data for growth modules.
     * Growth modules receive this via TreePreview.getOutput().
     */
    getGridData: function() {
        return {
            mode: 'hex',
            schools: [],       // array of school arc/segment data
            grid: {},          // grid parameters for growth algorithms
            gridPoints: []     // array of { x, y } candidate positions
        };
    }
};

// Self-register
if (typeof TreePreview !== 'undefined') {
    TreePreview.registerMode('hex', TreePreviewHex);
}
```

### 3. Add the script tag

In `index.html`, add your script **before** `treePreview.js`:

```html
<script src="modules/treePreviewHex.js"></script>
<script src="modules/treePreview.js"></script>
```

### 4. Add the fallback check

In `treePreview.js`, add a check at the bottom (after the existing checks):

```javascript
if (typeof TreePreviewHex !== 'undefined') {
    TreePreview.registerMode('hex', TreePreviewHex);
}
```

This handles the case where treePreview.js loads before your module.

Your module will automatically get a tab button in the UI.

## Creating a Growth Module

Growth modules are more complex — they manage the full tree lifecycle.

### 1. Create the file

Create `modules/treeGrowthHex.js` (or a subfolder `modules/hex/hexMain.js` for complex modules).

### 2. Minimal working example

```javascript
/**
 * Tree Growth - HEX Mode
 * Self-registers with TreeGrowth via registerMode().
 */
var TreeGrowthHex = {

    tabLabel: 'HEX',

    settings: {
        ghostOpacity: 35,
        nodeRadius: 5
    },

    _treeData: null,
    _layoutData: null,

    // ----- Settings UI -----

    buildSettingsHTML: function() {
        var s = this.settings;
        return '' +
            '<div class="tree-preview-settings-title">Hex Growth Settings</div>' +
            '<div class="tree-preview-settings-grid">' +
                TreePreviewUtils.settingHTML('Ghost Opacity', 'tgHexOpacity', 0, 100, 5, s.ghostOpacity, '%') +
                TreePreviewUtils.settingHTML('Node Size', 'tgHexNodeSize', 1, 20, 1, s.nodeRadius) +
            '</div>';
    },

    bindEvents: function() {
        var self = this;
        TreePreviewUtils.bindInput('tgHexOpacity', function(v) {
            self.settings.ghostOpacity = v;
            if (typeof TreeGrowth !== 'undefined') TreeGrowth._markDirty();
        });
        TreePreviewUtils.bindInput('tgHexNodeSize', function(v) {
            self.settings.nodeRadius = v;
            if (typeof TreeGrowth !== 'undefined') TreeGrowth._markDirty();
        });
    },

    // ----- Rendering -----

    /**
     * Draw growth visualization on the shared canvas.
     *
     * ctx      - CanvasRenderingContext2D (pan/zoom already applied)
     * w, h     - Canvas dimensions
     * baseData - output from TreePreview.getOutput(), or null
     */
    render: function(ctx, w, h, baseData) {
        if (!baseData) {
            ctx.font = '12px sans-serif';
            ctx.fillStyle = 'rgba(184, 168, 120, 0.4)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Scan spells to see preview', w / 2, h / 2);
            return;
        }

        // Draw root base underneath
        baseData.renderGrid(ctx, w, h);

        // Draw your growth nodes on top
        // ...
    },

    // ----- Tree Lifecycle -----

    /** Called when user clicks Build. Send data to Python backend. */
    buildTree: function() {
        var spellData = TreeGrowth.getSpellData();
        if (!spellData || !spellData.spells) return;

        TreeGrowth.setStatusText('Building tree...', '#f59e0b');

        var config = {
            mode: 'hex'
            // your config params
        };

        window.callCpp('RunProceduralPython', JSON.stringify({
            spells: spellData.spells,
            config: config
        }));
    },

    /** Called when Python returns tree data. */
    loadTreeData: function(data) {
        this._treeData = data;
        // Run your layout algorithm
        // ...
        if (typeof TreeGrowth !== 'undefined') {
            TreeGrowth.setTreeBuilt(true, data.totalPlaced || 0, data.totalPool || 0);
            TreeGrowth._markDirty();
        }
    },

    /** Called when user clicks Apply. Save tree to disk. */
    applyTree: function() {
        if (!this._layoutData) return;
        window.callCpp('SaveSpellTree', JSON.stringify(this._layoutData));
        TreeGrowth.setStatusText('Tree saved', '#22c55e');
    },

    /** Called when user clicks Clear. Reset all state. */
    clearTree: function() {
        this._treeData = null;
        this._layoutData = null;
        if (typeof TreeGrowth !== 'undefined') {
            TreeGrowth.setTreeBuilt(false);
            TreeGrowth._markDirty();
        }
    }
};

// Self-register
if (typeof TreeGrowth !== 'undefined') {
    TreeGrowth.registerMode('hex', TreeGrowthHex);
}
```

### 3. Add script tag and fallback check

Same pattern as root modules — script before `treeGrowth.js`, plus a fallback check at the bottom of `treeGrowth.js`.

## Sub-Module Pattern

For complex modes, split into multiple files:

```
modules/hex/
  hexMain.js       <- implements growth module contract, delegates to sub-modules
  hexSettings.js   <- settings panel UI
  hexLayout.js     <- layout algorithm
  hexRenderer.js   <- canvas rendering
```

Sub-modules are plain globals. Load them before your main module in `index.html`:

```html
<script src="modules/hex/hexRenderer.js"></script>
<script src="modules/hex/hexSettings.js"></script>
<script src="modules/hex/hexLayout.js"></script>
<script src="modules/hex/hexMain.js"></script>
```

See `modules/classic/` for a working example (classicRenderer, classicSettings, classicLayout, classicMain).

## Helpers Available

**TreePreviewUtils** provides consistent UI controls:

```javascript
// Create a drag-input slider
TreePreviewUtils.settingHTML(label, id, min, max, step, value, suffix)

// Bind a drag-input to a callback
TreePreviewUtils.bindInput(id, function(newValue) { ... })
```

**TreeGrowth** orchestrator methods:

```javascript
TreeGrowth.getSpellData()                          // current spell scan data
TreeGrowth.setTreeBuilt(built, nodeCount, total)   // update shared UI state
TreeGrowth.setStatusText(text, color)              // update status label
TreeGrowth._markDirty()                            // request re-render
```

**TreePreview** orchestrator methods:

```javascript
TreePreview.getOutput()    // root base data for growth modules
TreePreview._markDirty()   // request re-render
```

## Checklist

- [ ] ES5 only (`var`, `function()`, string concatenation)
- [ ] Global object with unique name
- [ ] Self-registers at end of file
- [ ] Fallback check added to orchestrator EOF
- [ ] Script tag in `index.html` before orchestrator
- [ ] `buildSettingsHTML()` returns valid HTML string
- [ ] `bindEvents()` wires up all controls
- [ ] `render()` draws relative to canvas center `(w/2, h/2)`
- [ ] Calls `_markDirty()` when settings change
- [ ] For growth modules: `buildTree()`, `loadTreeData()`, `applyTree()`, `clearTree()` all implemented
