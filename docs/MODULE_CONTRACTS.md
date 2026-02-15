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

    // Built tree data (from C++ native builder)
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

Trigger tree construction. Sends spell data to the C++ native builder via `window.callCpp()`, receives the tree structure, and stores it for layout + rendering.

```javascript
    buildTree: function() {
        var spellData = TreeGrowth.getSpellData();
        if (!spellData) return;

        var baseData = TreePreview.getOutput();
        var config = {
            mode: 'mymode',
            // ...your config
        };

        // Call C++ native builder
        window.callCpp('RunProceduralPython', JSON.stringify({
            command: 'build_tree_mymode',
            spells: spellData.spells,
            config: config
        }));
    },
```

#### `loadTreeData(data)`

Called when the C++ builder returns tree data. Store it, run layout, update preview.

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

## C++ Builder Contract

Tree building is handled natively by `TreeBuilder.cpp` in the SKSE plugin. All 5 builder modes run as C++ code — no external processes or IPC required.

### Adding a New Builder Mode

1. **Add builder function** in `TreeBuilder.cpp`:
```cpp
BuildResult BuildMyMode(const std::vector<json>& spells, const BuildConfig& config);
```

2. **Register command** in `TreeBuilder::Build()`:
```cpp
if (command == "build_tree_mymode") {
    return BuildMyMode(spells, config);
}
```

3. **JS sends command** from growth module:
```javascript
window.callCpp('RunProceduralPython', JSON.stringify({
    command: 'build_tree_mymode',
    spells: spellData.spells,
    config: config
}));
```

### Builder Function Signature

```cpp
BuildResult BuildMyMode(const std::vector<json>& spells, const BuildConfig& config)
```

**Input: `spells`** — array of spell JSON objects:
```json
{
  "formId": "0x00012FCD",
  "name": "Flames",
  "school": "Destruction",
  "skillLevel": "Novice",
  "effectNames": ["Fire Damage"],
  "effects": [{"name": "Fire Damage", "description": "..."}],
  "keywords": ["MagicDamageFire"]
}
```

**Input: `config`** — `BuildConfig` struct parsed from JS JSON:
- `maxChildrenPerNode` (int): Soft cap on children per node (default 3)
- `topThemesPerSchool` (int): Max themes to discover (default 8)
- `preferVanillaRoots` (bool): Prefer low-load-order spells as roots
- `seed` (int): Random seed for reproducibility (0 = time-based)
- `selectedRoots` (map): Per-school root overrides

**Output: `BuildResult`:**
```cpp
struct BuildResult {
    json treeData;       // Full tree JSON (see output schema below)
    bool success;
    std::string error;
    float elapsedMs;
};
```

### Output Schema

```json
{
  "version": "1.0",
  "schools": {
    "SchoolName": {
      "root": "formId",
      "nodes": [
        {
          "formId": "0x...",
          "name": "Spell Name",
          "children": ["0x...", "0x..."],
          "prerequisites": ["0x..."],
          "tier": 1,
          "skillLevel": "Novice",
          "theme": "fire",
          "section": "root|trunk|branch"
        }
      ],
      "layoutStyle": "tier_first|organic"
    }
  },
  "seed": 123456,
  "generatedAt": "ISO8601",
  "generator": "BuilderName",
  "validation": {
    "all_valid": true,
    "total_nodes": 50,
    "reachable_nodes": 50
  }
}
```

### Shared NLP Functions (TreeNLP)

Builders use shared NLP infrastructure from `TreeNLP.h`:

| Function | Purpose |
|----------|---------|
| `TreeNLP::Tokenize()` | Text tokenization |
| `TreeNLP::BuildSpellText()` | Extract weighted text from spell JSON |
| `TreeNLP::ComputeTfIdf()` | TF-IDF vectorization with L2 norms |
| `TreeNLP::CosineSimilarity()` | Cosine similarity between sparse vectors |
| `TreeNLP::CharNgramSimilarity()` | Character n-gram Jaccard similarity |
| `TreeNLP::FuzzyRatio()` / `FuzzyPartialRatio()` / `FuzzyTokenSetRatio()` | Fuzzy string matching |
| `TreeNLP::CalculateThemeScore()` | Multi-strategy theme scoring (0-100) |

### Shared Tree Functions (TreeBuilder)

| Function | Purpose |
|----------|---------|
| `TreeBuilder::DiscoverThemesPerSchool()` | TF-IDF keyword extraction per school |
| `TreeBuilder::MergeWithHints()` | Merge discovered themes with vanilla hints |
| `TreeBuilder::GroupSpellsBestFit()` | Assign spells to best-matching theme |
| `TreeBuilder::ComputeSimilarityMatrix()` | Pairwise spell similarity |
| `TreeBuilder::LinkNodes()` / `UnlinkNodes()` | Parent-child linking |
| `TreeBuilder::ValidateSchoolTree()` | Reachability + cycle detection |
| `TreeBuilder::FixUnreachableNodes()` | Multi-pass orphan repair |

### Error Handling

Use `_handleBuildFailure()` in `proceduralTreeBuilder.js` for shared error + retry UI:

```javascript
_handleBuildFailure(
    error,                    // Error string
    '_myModeBuildPending',    // State key for retry routing
    MyModeSettings,           // Settings module (has .setStatusText)
    { command: 'build_tree_mymode', config: retryConfig },
    'myModeBuildBtn',         // Button ID to re-enable
    '[MyMode]'                // Log prefix
);
```

### Existing Builders

| Builder | Command | Algorithm |
|---------|---------|-----------|
| Classic | `build_tree_classic` | Tier-first: depth = tier index. NLP within-tier parent selection. |
| Tree | `build_tree` | NLP thematic: TF-IDF similarity drives parent→child links. Round-robin theme interleaving. |
| Graph | `build_tree_graph` | Edmonds' minimum spanning arborescence (directed MST). |
| Thematic | `build_tree_thematic` | 3D similarity BFS with per-theme branch construction. |
| Oracle | `build_tree_oracle` | LLM-guided semantic chain grouping (fallback: cluster lanes). |

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
| `modules/proceduralTreeBuilder.js` | Shared callback routing + error handler |
| `modules/sunGrid*.js` | SUN grid sub-modules |

## Config Conventions

### Range Validation

`BuildConfig::FromJson()` clamps values to safe ranges:
- density: 0.0–1.0
- maxChildrenPerNode: 1–8
- convergenceChance: 0.0–1.0

Invalid values are silently clamped, not rejected.

## Selected Roots Contract

Optional config field that lets users override automatic root selection per school.

### Config Field

```json
{
  "selected_roots": {
    "Destruction": { "formId": "0x00012FCD", "name": "Flames", "plugin": "Skyrim.esm", "localFormId": "012FCD" },
    "Restoration": { "formId": "0x00012FD0", "name": "Healing", "plugin": "Skyrim.esm", "localFormId": "012FD0" }
  }
}
```

### JS Side

- Stored in `settings.selectedRoots` (persistent, auto-saved)
- Set via TreePreview root node click → spawn-style spell search modal
- Filtered to primed spells (post-blacklist/whitelist/tome) for the selected school
- Passed in config dict to C++: `config.selected_roots = settings.selectedRoots || {}`

### C++ Side

Builders check `selectedRoots` in `BuildConfig` before their normal root selection logic:

```cpp
auto it = config.selectedRoots.find(school);
if (it != config.selectedRoots.end()) {
    auto& overrideId = it->second;
    if (spellPool.contains(overrideId)) {
        return overrideId;  // Use user selection
    }
    // else: fall through to auto-pick
}
```

**Behavior:**
- If `selected_roots[school]` exists AND its `formId` is in the filtered spell pool → use it
- If `formId` not found (e.g. spell was blacklisted after selection) → fall through to auto-pick silently
- If `selected_roots` is empty or missing the school → existing auto-pick behavior (unchanged)

### Integrated Modules

| Builder | Function | Status |
|---------|----------|--------|
| Classic (`BuildClassic`) | Root selection | Integrated |
| Tree (`BuildTree`) | Root selection | Integrated |
| Graph (`BuildGraph`) | Root selection | Integrated |
| Thematic (`BuildThematic`) | Root selection | Integrated |
| Oracle (`BuildOracle`) | Root selection | Integrated |
