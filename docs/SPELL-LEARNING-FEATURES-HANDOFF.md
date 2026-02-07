# Heart of Magic / Spell Learning – Features & Fixes Handoff

Handoff for **Claude Code** (or follow-up sessions) to implement or design several fixes and features for the Spell Learning / Heart of Magic Prisma UI and backend. Each section is a discrete work item with context, relevant paths, and success criteria.

**Project roots:** `projects/HeartOfMagic/`, `projects/SpellLearning/` (shared codebase; Prisma UI under HeartOfMagic, C++ plugin may be SpellLearning).  
**Workspace rules:** `CLAUDE.md` at repo root.

---

## 1. Spells locked on menu open (rescan / sync timing)

### Problem

Sometimes when opening the Spell Learning menu (e.g. F9), **all spells appear locked**. Closing and reopening the menu fixes it. User suspects the issue is related to **rescanning or syncing when the menu opens**.

### Likely cause

- **`onPanelShowing`** (in `modules/cppCallbacks.js`) calls `callCpp('GetProgress', '')` and `callCpp('GetPlayerKnownSpells', '')` to refresh progression and known spells when the panel is shown.
- The C++ side responds with progress JSON; the UI applies it to tree nodes. If this runs **before** tree data or node state is fully ready, or if the **response handler** overwrites node states (e.g. treats missing progress as “locked”), spells can briefly or persistently show as locked until the user closes and reopens (second open has stable state).

### Relevant paths

| Area | Path |
|------|------|
| Panel show callback | `PrismaUI/views/SpellLearning/SpellLearningPanel/modules/cppCallbacks.js` — `window.onPanelShowing` |
| C++ progress/known spells | `plugin/src/UIManager.cpp` — `OnGetProgress`, `OnGetPlayerKnownSpells`; `ProgressionManager::GetProgressJSON()` |
| Where progress is applied to nodes | `modules/cppCallbacks.js` (listeners for progress/known spells); `modules/progressionUI.js` (node state / mastery); `modules/treeViewerUI.js` (e.g. `loadTreeData` and progress sync) |
| Tab/panel init | `modules/main.js`, `modules/treeViewerUI.js` — any logic that runs on tab switch or first paint |

### Tasks

1. **Trace flow:** When the panel opens, document the order: `onPanelShowing` → GetProgress / GetPlayerKnownSpells → response handlers → where node `state` (locked/available/unlocked) is set.
2. **Identify race:** Determine if progress/known-spells response can run before `state.treeData` or node list exists, or before a first layout/paint, and if the handler sets “locked” by default when progress is missing.
3. **Fix strategy (pick one or combine):**
   - **Debounce / defer:** Run GetProgress and GetPlayerKnownSpells after a short delay (e.g. next tick or after tree view is ready) so tree data and node elements exist before applying progress.
   - **Don’t overwrite with “locked”:** In the handler that applies progress, only set a node to “locked” when C++ explicitly says so (or when progress is missing **and** tree already had a non-locked state); avoid resetting all nodes to locked on first response.
   - **Single source of truth:** Ensure node state is derived once from tree + progress when both are ready, and that “panel showing” only triggers a refresh that merges into existing state instead of replacing it blindly.
4. **Test:** Open menu multiple times (with tree already loaded); confirm spells do not all show locked on first open.

### Success criteria

- Opening the Spell Learning menu does not show all spells as locked when the tree is already loaded.
- Close/reopen is not required to see correct locked/available/unlocked state.

---

## 2. Font controls: 3× range + spell-tree node text

### Problem

1. **Global font control** should go **3× bigger** (current range is too small).
2. **Spell Tree tab:** Add a **font control in the gear/settings gizmo** that controls the **font size of node text** under each spell node (labels under nodes on the tree).

### Relevant paths

| Area | Path |
|------|------|
| Global font slider (settings) | `PrismaUI/views/SpellLearning/SpellLearningPanel/index.html` — `#fontSizeSlider` (min/max/step); `modules/settingsPanel.js` — `fontSizeSlider`, `applyFontSizeMultiplier()`; `state.js` / `settings` — `fontSizeMultiplier` |
| CSS font multiplier | `styles-skyrim.css` (and base styles) — `--font-size-multiplier`; `.node-text` font-size |
| Tree node text (wheel/canvas) | `modules/wheelRenderer.js` — node label text, `font-size` / `setAttribute('font-size', ...)`; `modules/canvasRenderer.js` if node text is drawn there |
| Gear/settings gizmo (Spell Tree tab) | `modules/treeViewerUI.js` or equivalent — UI for zoom/settings near the tree; likely a collapsible or popover with settings for the tree view |

### Tasks

1. **Global font 3× bigger**
   - Change the **max** value of the global font size slider from current (e.g. 1.5) to **3×** the current max (e.g. 4.5 if current max is 1.5). Ensure step and min remain usable.
   - In `applyFontSizeMultiplier()`, allow the multiplier to go up to that new max (and clamp/store in settings).
   - Persist and load the new range in unified config (C++/JS) so the value is saved.

2. **Spell Tree tab – node text font control**
   - Add a **node text font size** control (slider or dropdown) in the **gear gizmo** for the Spell Tree tab (next to zoom/settings). This control affects only the **node labels** under each spell node on the tree.
   - Store the value (e.g. `treeNodeFontSize` or `nodeLabelFontSize`) in settings and in unified config so it persists.
   - In the renderer that draws node text (`wheelRenderer.js` and any other renderer that shows node labels), use this setting for the node label `font-size` (replace or scale the current hardcoded values like `10px` / `1em`).

### Success criteria

- Global font size can be set up to 3× the previous maximum and persists.
- Spell Tree tab has a gear control for “node text size” that only changes the font size of labels under spell nodes and persists across sessions.

---

## 3. Prerequisite distance: keep prereqs near children

### Problem

Spells are sometimes placed **too far** from the spells they are **prerequisites for**. The layout should keep prerequisites **reasonably close** to their children so the tree reads naturally.

### Relevant paths

| Area | Path |
|------|------|
| Layout / positioning | `modules/layoutGenerator.js` — `getScaledConfig`, tier/radius, slice allocation; `LAYOUT_CONFIG`, `minNodeSpacing`, `tierSpacing`, `baseRadius` |
| Visual-first / procedural builder | `modules/visualFirstBuilder.js` — placement logic; `modules/proceduralTreeBuilder.js` — tree build and coordinates |
| Tree builder (Python) | `tools/SpellTreeBuilder/build_tree.py`, `tree_builder`, `shapes`, `growth` — if coordinates are generated there |
| Prerequisite links | Tree JSON: `prereqs` / `prerequisites` per node; layout uses tier/angle; distance = f(tier difference, angle difference) |

### Tasks

1. **Define “too far”:** Add a **reliable check** for “prerequisite too far from child” (e.g. max tier gap, max Euclidean or angular distance, or max pixel distance at default zoom). Make thresholds configurable if useful.
2. **Layout constraints:** In the layout algorithm (JS and/or Python):
   - When assigning (tier, angle) or (x, y), **prefer placements** that keep a parent (prereq) within the chosen max distance from its children.
   - Options: (a) constrain child placement to be within N tiers or M angle of parent; (b) post-pass that nudges parent or child to reduce distance when over threshold; (c) re-order or re-tier nodes so prereq chains stay local.
3. **Generation:** Ensure both **Simple** (JS-only) and **Complex** (Python LLM/fuzzy) tree generation respect or are updated to respect the new constraint.
4. **Test:** Generate trees with many prereqs; confirm no parent–child pair is “extremely far” by the chosen metric.

### Success criteria

- A defined metric and threshold for “prereq too far from child” exists and is used in layout.
- Generated trees do not place prerequisites extremely far from their children; layout looks natural.

---

## 4. LLM provider selection (not only OpenRouter)

### Problem

The UI and backend assume **OpenRouter** as the only LLM provider. User wants to use **nano gpt** (and possibly other local/remote providers) and had to **edit the Python file path** manually. A proper **provider selection** (OpenRouter, nano gpt, etc.) should be supported.

### Relevant paths

| Area | Path |
|------|------|
| LLM API settings (UI) | `PrismaUI/views/SpellLearning/SpellLearningPanel/modules/llmApiSettings.js` — API key, model select; `index.html` — API Settings section (OpenRouter API Key, Model) |
| C++ LLM / OpenRouter | `plugin/src/OpenRouterAPI.cpp` (or equivalent) — HTTP client, base URL, headers; config for API key and model |
| Python tree builder (Complex) | `tools/SpellTreeBuilder/build_tree.py` — any LLM calls; user said they had to update “filepath” in the py file (likely script path or API endpoint) |
| Config persistence | Unified config in `UIManager.cpp` (load/save); `state.llmConfig` in JS |

### Tasks

1. **Provider abstraction:** Introduce a **provider** concept: e.g. `OpenRouter`, `NanoGPT` (local), `Ollama`, or generic “Custom URL”. Store in config: `llmProvider`, optional `llmBaseUrl`, `apiKey`, `model`.
2. **UI:** In Spell Learning settings (or API tab), add a **provider dropdown** (and if needed a “Custom” option with URL field). Show/hide API key field based on provider (e.g. optional for local).
3. **C++:** When calling an LLM (if C++ does the call), choose base URL and headers from provider; for NanoGPT/local, use local URL and no OpenRouter key.
4. **Python:** In `tools/SpellTreeBuilder/`, read provider and endpoint from config (passed from C++ or from a small config file the plugin writes). Use the correct base URL and payload format for NanoGPT vs OpenRouter. **Do not require users to edit the Python file path** for the endpoint; make it configurable (e.g. env, config.json, or args from the plugin).
5. **Docs:** Note in README or in-UI help how to set NanoGPT (and other providers) and where the endpoint is configured.

### Success criteria

- User can select an LLM provider (at least OpenRouter and NanoGPT/local).
- NanoGPT (or local) works without editing Python source; endpoint/URL is configurable.
- API key is only required when the provider needs it (e.g. OpenRouter).

---

## 5. Cheat mode: spell tree editing (design & proposal)

Design and implement a **spell tree editing system** that is active only in **cheat mode**, with the following behavior.

### 5.1 Drag nodes (grid snap)

- User can **click and drag** a spell node.
- Movement is **grid-based**: nodes snap from **grid point to grid point** as they are dragged (no free-floating position).
- Grid should match or be consistent with the existing layout grid (e.g. `layoutGenerator.js` / `GRID_CONFIG`).

### 5.2 Edit prerequisites (eyedropper)

- User can **change which node is a prerequisite** of another.
- **Flow:** Click the **prerequisite** (the “parent” link) to select it, then click the **new node** that should become the prerequisite. The connection updates: old prereq link is removed, new one is set.
- **Cursor:** Switch to an **eyedropper** cursor while in “select new prerequisite” mode (after first click).

### 5.3 Insert node (empty grid point + search)

- **Click on an empty grid point** → opens a **search** UI.
- Search lists **all viable spells** (from current spell scan / tree data source). User can **search by name or FormID**.
- **Choosing a spell** from the search **places that spell as a new node** at the clicked grid point. It is added to the tree with no prerequisites (or optionally “connect to nearest” logic later).

### 5.4 Delete node

- In **cheat mode**, on the **Spell Details** tab (or panel that shows the selected spell’s details), show a **“Delete node”** button.
- Clicking it **removes that spell node** from the tree (and updates any prereq links that pointed to or from it).

### 5.5 Cheat-mode floating buttons

- When cheat mode is on, show **floating buttons** next to the **zoom and settings gizmo**: **Save tree**, **Load tree**, **Clear tree**.
  - **Save tree:** Export current tree (with positions and prereqs) to a file (JSON or existing format).
  - **Load tree:** Load a previously saved tree from file, replacing or merging (define behavior).
  - **Clear tree:** Clear the current tree (with confirmation).

### Relevant paths

| Area | Path |
|------|------|
| Cheat mode flag | `settings.cheatMode`; `modules/settingsPanel.js` — cheat toggle; persisted in unified config |
| Tree view / nodes | `modules/treeViewerUI.js`, `modules/wheelRenderer.js` (or canvas) — node hit-test, selection, draw |
| Tree data structure | `state.treeData`; nodes have `formId`, `name`, `x`, `y`, `prereqs`, etc. |
| Grid / layout | `modules/layoutGenerator.js`, `config.js` — `GRID_CONFIG`, cell size, origin |
| Spell list (viable spells) | From scan JSON or C++ `GetSpellInfo`; cache in `state` or from last scan |
| Save/load tree | Existing import/export in `treeViewerUI.js` or `buttonHandlers.js`; extend for “Save/Load tree” files |

### Tasks (implementation)

1. **Grid and drag:** Implement grid snapping (world → grid cell, cell → position). On node mousedown/move/mouseup, move node to adjacent or target grid cell and update `state.treeData` node positions.
2. **Prereq edit mode:** Add “edit prereq” mode: click prereq (or “parent” end of link), then show eyedropper cursor and wait for click on another node; then set that node as the new prereq and redraw.
3. **Empty cell click → search:** Hit-test for “empty grid cell”; on click, open a modal or panel with search (name + FormID filter) over viable spells; on select, add node at that cell and refresh tree.
4. **Delete node:** In spell details view, when cheat mode is on, add “Delete node” button; on click, remove node from `state.treeData` and update links; notify C++ if needed for progression.
5. **Floating buttons:** When `settings.cheatMode`, render Save tree / Load tree / Clear tree next to zoom/settings; wire to save/load/clear logic (reuse or extend existing export/import).
6. **Persistence:** Ensure edited tree can be saved and loaded in the same format the game/plugin expects (or document the format).

### Success criteria

- In cheat mode: nodes can be dragged with grid snap; prerequisites can be reassigned (eyedropper flow); new nodes can be added at empty grid points via search; nodes can be deleted from the details panel; Save/Load/Clear tree buttons are visible and functional.

---

## 6. Auto next spell learning selection (setting)

### Problem

Add a **toggle in settings**: “Auto next spell learning selection”. When enabled, after a spell is **mastered**, the system **randomly selects the next spell to learn** within the **same tree** (same school or same subtree, depending on data model). This should work for both **one-at-a-time** and **one-per-tree** (per school) learning modes.

### Relevant paths

| Area | Path |
|------|------|
| Learning mode | `settings.learningMode` — `"perSchool"` (one per tree/school) or `"single"` (one at a time); `plugin/src/ProgressionManager.cpp` — `SetLearningTarget`, `ClearLearningTargetForSpell`; UI in `modules/progressionUI.js`, `modules/settingsPanel.js` |
| Mastered notification | `ProgressionManager` when progress hits 100% → `MarkMastered`, clear target, notify UI; `modules/cppCallbacks.js` / progression UI when mastery is received |
| Tree / school structure | `state.treeData` — nodes with `school`, `formId`, `prereqs`; “same tree” = same school or same connected component |

### Tasks

1. **Setting:** Add a checkbox (or toggle) in settings: **“Auto next spell learning selection”**. Store in unified config (e.g. `autoNextSpellSelection`). Expose in `settingsPanel.js` and C++ config.
2. **Logic when spell is mastered:** When the plugin or UI is notified that the current learning target is mastered:
   - If **auto next** is **off**, keep current behavior (no auto-select).
   - If **auto next** is **on**, determine “same tree” (e.g. same school as the spell that was just mastered; or same tree ID if multiple trees exist). From the nodes in that tree that are **available to learn** (prereqs met, not yet mastered), **randomly choose one** and set it as the new learning target (C++ `SetLearningTarget` and UI update).
3. **Modes:** Implement so it works for:
   - **perSchool:** “Same tree” = same school; pick next spell in that school.
   - **single:** “Same tree” = e.g. same school as the mastered spell, or the only tree if single-school; pick next in that tree.
4. **UI:** Show the new target in the progression UI and tree (e.g. “Learning” state) after auto-select.

### Success criteria

- When “Auto next spell learning selection” is on and a spell is mastered, the next spell to learn is automatically chosen at random from the same tree and set as the new target, in both one-at-a-time and one-per-tree modes.

---

## 7. Python venv setup (for mod users)

### Goal

- **Use a Python virtual environment** for the Spell Tree Builder (Complex Build) so dependencies are isolated and reproducible.
- **Provide clear, copy-paste setup instructions** so users can set up the venv in the **right folder** without needing a `.bat` file (batch files can be flagged as viruses on Nexus).

### Right folder

The venv must be created **inside the SpellTreeBuilder folder** that the mod uses at runtime:

- **MO2 / installed mod:**  
  `(Mod Organizer 2 folder)\mods\(Heart of Magic mod name)\Data\SKSE\Plugins\SpellLearning\SpellTreeBuilder`  
  Example: `C:\Modding\MO2\mods\HeartOfMagic_RELEASE\Data\SKSE\Plugins\SpellLearning\SpellTreeBuilder`
- **Game Data (non-MO2):**  
  `(Skyrim install)\Data\SKSE\Plugins\SpellLearning\SpellTreeBuilder`

That folder contains `build_tree.py` and `requirements.txt`. The venv (e.g. `.venv`) should be created **there** so the plugin can find `Scripts\python.exe` next to `build_tree.py`.

### Plugin behavior (implementation task)

The C++ plugin currently runs `python "path\to\build_tree.py"` using whatever `python` is on the system PATH. To support the venv:

- Before building the command, check for a venv in the **same folder as build_tree.py**:
  - Windows: `(SpellTreeBuilder folder)\.venv\Scripts\python.exe`
  - If that path exists, use it instead of `python` in the command.
- If no venv is found, keep using `python` from PATH (current behavior).

**Relevant path:** `plugin/src/UIManager.cpp` — where the Python command is built (e.g. around the `std::string cmd = "python \"" + pythonScript + "\""` block). Compute the directory of `pythonScript`, then check for `(dir)/.venv/Scripts/python.exe` (Windows) and use that as the executable when present.

### User instructions (no .bat — for Nexus / docs)

Provide these instructions in the mod’s README or a SETUP/Python doc so users can copy-paste. **Do not rely on a .bat file** (can be flagged on Nexus).

---

#### Step 1: Install Python

- Install **Python 3.9 or newer** from https://www.python.org/downloads/
- During install, **check "Add Python to PATH"**.

---

#### Step 2: Open a terminal in the SpellTreeBuilder folder

- **Option A – File Explorer + address bar**  
  - Open File Explorer and go to the SpellTreeBuilder folder (see “Right folder” above).  
  - Click the address bar, type `powershell`, press Enter.  
  - A PowerShell window opens with that folder as the current directory.

- **Option B – Manual cd**  
  - Open **PowerShell** or **Command Prompt** (Win+R → `powershell` or `cmd` → Enter).  
  - Run (replace the path with your actual path):

**PowerShell:**
```powershell
Set-Location "C:\Modding\MO2\mods\HeartOfMagic_RELEASE\Data\SKSE\Plugins\SpellLearning\SpellTreeBuilder"
```

**Command Prompt:**
```cmd
cd /d "C:\Modding\MO2\mods\HeartOfMagic_RELEASE\Data\SKSE\Plugins\SpellLearning\SpellTreeBuilder"
```

---

#### Step 3: Create the virtual environment

Run **one** of these (same in PowerShell and Command Prompt):

```powershell
python -m venv .venv
```

If your system uses `py` instead of `python`:

```powershell
py -3.11 -m venv .venv
```
(Use `3.10`, `3.11`, or `3.12` if you have it.)

---

#### Step 4: Activate the venv and install dependencies

**PowerShell:**
```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

**Command Prompt:**
```cmd
.venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

*(Note: We are not providing a .bat file for download; users run the single `activate.bat` that is created inside `.venv` by `venv` itself. That is standard Python and not a mod-supplied script.)*

---

#### Step 5: Deactivate and close (optional)

When you’re done testing from the command line:

**PowerShell or Command Prompt:**
```text
deactivate
```

Then close the window. The mod will use `.venv\Scripts\python.exe` automatically when you use “BUILD TREE (Complex)” in-game, **if** the plugin is updated to prefer the venv (see “Plugin behavior” above).

---

#### Troubleshooting

| Problem | What to do |
|--------|------------|
| “python not found” | Reinstall Python with “Add Python to PATH” checked, or use `py -3.11` instead of `python`. |
| “Execution of scripts is disabled” (PowerShell) | Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` once, then run the activate command again. |
| “pip not recognized” | Use `python -m pip` (e.g. `python -m pip install -r requirements.txt`). |
| Wrong folder | Make sure you are in the folder that contains `build_tree.py` and `requirements.txt` (the SpellTreeBuilder folder inside the mod). |

---

### Summary for handoff

1. **Document:** Add the “Right folder” and “User instructions (no .bat)” to the mod’s user-facing README or SETUP doc (e.g. `tools/SpellTreeBuilder/SETUP_README.txt` or project README).
2. **Plugin:** In `UIManager.cpp`, when building the Python command, if `(script_dir)/.venv/Scripts/python.exe` exists (Windows), use it instead of `python`.
3. **Do not add** a mod-supplied `.bat` (or `.cmd`) for setup—use copy-paste instructions only to avoid Nexus false positives.

### Success criteria

- Users can set up a venv in the SpellTreeBuilder folder using only copy-paste commands (PowerShell or Command Prompt).
- No mod-provided .bat file is required; instructions are in the doc only.
- Plugin uses `.venv\Scripts\python.exe` when present, so “BUILD TREE (Complex)” runs with the venv’s dependencies.

---

## Optional reference summary

| # | Topic | Key files |
|---|--------|-----------|
| 1 | Spells locked on open | `cppCallbacks.js` (onPanelShowing), progress/known-spells handlers, `treeViewerUI.js`, `progressionUI.js` |
| 2 | Font 3× + node text | `index.html` (fontSizeSlider), `settingsPanel.js`, `wheelRenderer.js`, tree gear gizmo |
| 3 | Prereq distance | `layoutGenerator.js`, `visualFirstBuilder.js`, `proceduralTreeBuilder.js`, `tools/SpellTreeBuilder/` |
| 4 | LLM providers | `llmApiSettings.js`, `OpenRouterAPI.cpp`, `tools/SpellTreeBuilder/build_tree.py` |
| 5 | Cheat tree editing | `treeViewerUI.js`, `wheelRenderer.js`, `state.js`, `layoutGenerator.js`, `config.js` |
| 6 | Auto next spell | `ProgressionManager.cpp`, `progressionUI.js`, `settingsPanel.js`, `state.treeData` |
| 7 | Python venv setup | `UIManager.cpp` (Python command), `tools/SpellTreeBuilder/SETUP_README.txt` |

---

**References**

- Architecture: `projects/HeartOfMagic/docs/ARCHITECTURE.md`
- Workspace: `CLAUDE.md` (paths, `/build`, `/deploy`, `/release`)
