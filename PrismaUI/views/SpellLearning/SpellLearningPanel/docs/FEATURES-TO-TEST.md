# Features to Test

Testing checklist for SpellLearning panel features. Check off each item once confirmed working in-game or via dev harness.

---

## Auto-Advance Learning Target

When a spell is mastered (100% XP), automatically select the next spell to learn.

### Settings UI
- [ ] Toggle appears in Progression settings section (below Discovery Mode / Show Root Names)
- [ ] Toggle defaults to ON
- [ ] Mode dropdown shows "Next in Branch" and "Random in School"
- [ ] Mode dropdown defaults to "Next in Branch"
- [ ] Turning toggle OFF grays out the mode dropdown
- [ ] Turning toggle back ON re-enables the dropdown
- [ ] Setting persists after closing and reopening the panel (save/load)
- [ ] Reset Settings restores toggle ON + mode to "Next in Branch"

### Branch Mode
- [ ] Master a spell that has one available child — that child becomes the new learning target
- [ ] Master a spell that has multiple available children — one is picked (random)
- [ ] Master a leaf node (no children) — falls back to any available spell in the same school
- [ ] Master a spell whose children are all still locked (prereqs not met) — falls back to school-wide pick

### Random Mode
- [ ] Master a spell — a random available (non-root) spell in the same school is picked
- [ ] Picked spell is not a root node

### Learning Modes
- [ ] **perSchool mode**: Auto-advance only changes the target for the mastered spell's school, other schools unaffected
- [ ] **single mode**: Auto-advance clears all existing targets before setting the new one
- [ ] **single mode**: Only one learning target exists after auto-advance

### Visual Feedback
- [ ] Status bar shows "Now learning: {spell name}" after auto-advance
- [ ] Console log shows `[SpellLearning] Auto-advanced to: {name} ({school})`
- [ ] New target node shows learning state (color/animation) on the tree
- [ ] Learning path lines update to the new target in CanvasRenderer

### Edge Cases
- [ ] All spells in school mastered — no error, no target set, silent no-op
- [ ] Toggle OFF — mastering a spell does NOT auto-advance
- [ ] No tree data loaded — no error
- [ ] Mastering via cheat unlock — does NOT trigger auto-advance (cheat flow is separate)

---

## Sklearn Error Handling + Retry with Fallback

When a user doesn't have sklearn/numpy installed, tree building should fail gracefully with a clear error message and offer a retry using basic word-frequency analysis instead of TF-IDF.

### Error Path (no sklearn, no fallback)
- [ ] Tree build fails with a clear error message mentioning "sklearn is required" and the specific import error
- [ ] Error message tells user to "Install the Python Addon from the mod page"
- [ ] Error message mentions "Retry with Fallback" option
- [ ] BuildProgress modal shows the failed stage with a red ✗ icon
- [ ] Progress bar turns red (error state)
- [ ] "Close" button appears to dismiss the modal

### Retry with Fallback Button
- [ ] "Retry with Fallback" button appears next to "Close" when build fails
- [ ] Clicking "Retry with Fallback" closes the modal and triggers a new build with `fallback: true`
- [ ] New build progress modal opens for the retry attempt
- [ ] Retry build succeeds using word-frequency analysis (no sklearn needed)
- [ ] Tree is generated and rendered after fallback build completes

### Fallback Quality
- [ ] Fallback tree still has themed groupings (based on word frequency, not TF-IDF)
- [ ] Spells are placed in reasonable school-based clusters
- [ ] Tree structure is valid — no orphan nodes, no broken edges

### Classic Growth + Tree Growth
- [ ] Classic Growth error handler shows error + retry button
- [ ] Tree Growth error handler shows error + retry button
- [ ] Both retry callbacks send `fallback: true` in the request

### Server-Side Error Reporting
- [ ] `server.py` logs the full import traceback to `server.log`
- [ ] Error response includes `_build_tree_import_error` detail string
- [ ] Error response ends with "Please report this error on the mod page."
- [ ] When `fallback: true` is in the request, `config["fallback"]` is set to `True`

### C++ Forwarding
- [ ] `UIManager.cpp` forwards `fallback` boolean from JS request to Python payload
- [ ] Non-fallback requests do NOT include a `fallback` key

### Edge Cases
- [ ] User has sklearn — normal TF-IDF path works, no fallback offered
- [ ] Python server fails to start entirely — different error, no retry button (Python startup failure, not sklearn)
- [ ] Retry button is removed if modal is closed and reopened for a new build

---

## Modular Python Tree Builders (Classic vs Tree)

Classic Growth now uses a tier-first Python builder (`build_tree_classic`) while Tree Growth uses the existing NLP builder (`build_tree`). Each builder is bundled in its growth module's `python/` folder.

### Command Routing
- [ ] Classic Growth sends `command: 'build_tree_classic'` in ProceduralPythonGenerate request
- [ ] Tree Growth sends `command: 'build_tree'` in ProceduralPythonGenerate request
- [ ] UIManager.cpp reads `command` field from JS and passes it to PythonBridge (not hardcoded)
- [ ] server.py routes `build_tree_classic` to `classic_build_tree_from_data()`
- [ ] server.py routes `build_tree` to `build_tree_from_data()` (tree module, fallback to local)
- [ ] SKSE log shows correct command name (e.g. "Sending build_tree_classic to PythonBridge")

### Classic Tier-First Builder
- [ ] Classic tree has Novice spells at depth 0 (near roots / inner ring)
- [ ] Apprentice at depth 1, Adept at 2, Expert at 3, Master at 4
- [ ] No Novice spell is ever a child of a higher-tier spell
- [ ] Tier zone sliders in Classic settings visibly affect vertical placement
- [ ] Fire Apprentice spells link to fire Novice spells (NLP guides within-tier parent choice)
- [ ] Tree structure is valid — all nodes reachable from root, no orphans
- [ ] Output JSON matches standard tree format (schools, nodes, root, formId, children, prerequisites)

### Tree Growth NLP Builder (unchanged)
- [ ] Tree Growth still builds trees by thematic NLP similarity (not tier-ordered)
- [ ] Tree corridor layout and section allocation (Branches/Trunk/Root) work as before
- [ ] No regression in Tree mode tree quality or structure

### Module Python Bundling
- [ ] `modules/classic/python/classic_build_tree.py` deployed to MO2 RELEASE
- [ ] `modules/tree/python/tree_build_tree.py` deployed to MO2 RELEASE
- [ ] server.py adds both module python dirs to sys.path at startup
- [ ] server.log shows successful import of both builders on startup

### Shared Error Handler
- [ ] Classic build failure shows error + retry button (uses shared `_handleBuildFailure`)
- [ ] Tree build failure shows error + retry button (uses shared `_handleBuildFailure`)
- [ ] Classic retry sends `command: 'build_tree_classic'` with `fallback: true`
- [ ] Tree retry sends `command: 'build_tree'` with `fallback: true`
- [ ] Build button re-enables after failure for both modes

### Edge Cases
- [ ] Unknown tier spells (missing skillLevel) assigned to Novice tier in classic builder
- [ ] School with only 1 spell — root is that spell, no children, no crash
- [ ] Empty school — skipped gracefully, no error
- [ ] Missing classic builder import — server.py returns clear error, does not crash
- [ ] `build_tree` still works if `tree_build_tree.py` missing (fallback to local `build_tree.py`)
