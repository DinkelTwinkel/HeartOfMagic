# Build Complex — Full System Trace

**Purpose:** Step-by-step trace of BUILD TREE (Complex) from button click to a fully built and rendered spell tree.

**Trigger:** User clicks **BUILD TREE (Complex)** (`visualFirstBtn`). Requires spell scan data and (for full flow) embedded Python.

---

## High-Level Phases

| Phase | Where | What |
|-------|--------|-----|
| **1. JS: Prepare & request** | proceduralTreeBuilder.js | Build config, set `visualFirstConfigPending`, call C++ |
| **2. C++: Invoke Python** | UIManager.cpp | Write temp files, spawn Python `build_tree.py`, read output |
| **3. Python: Fuzzy + LLM + tree** | SpellTreeBuilder/build_tree.py | Load config, optional LLM auto-config, fuzzy NLP, build tree, write JSON |
| **4. C++: Return to JS** | UIManager.cpp | `InteropCall(onProceduralPythonComplete, response)` |
| **5. JS: Extract & run builder** | proceduralTreeBuilder.js | Extract school_configs + fuzzy data, call `doVisualFirstGenerate()` |
| **6. JS: Resolve configs** | proceduralTreeBuilder.js | Per-school: LLM → UI → defaults; build `finalConfigs` |
| **7. JS: Settings-aware build** | settingsAwareTreeBuilder.js | Per school: nodes, root, Phase 1 edges, Phase 2 convergence; output tree |
| **8. JS: Layout** | layoutEngine.js | Apply x,y to nodes (shape/behavior-aware) |
| **9. JS: Load & parse** | treeViewerUI.js, treeParser.js | `loadTreeData(treeData)` → parse, state, node states |
| **10. JS: Render & persist** | treeViewerUI.js, wheelRenderer/canvas | SmartRenderer.setData → render; SaveSpellTree to C++; switch tab |

---

## Phase 1 — JS: Prepare and Request (proceduralTreeBuilder.js)

**Entry:** `startVisualFirstGenerate()` (onclick of `visualFirstBtn`).

1. **Guard:** If no `state.lastSpellData.spells`, set `state.visualFirstPending`, call `startScan(false)`, return. Otherwise continue.
2. **Button state:** Disable button, set text to "Generating...".
3. **Call:** `startVisualFirstPythonConfig()`.

**Inside `startVisualFirstPythonConfig()`:**

4. **School summary:** `buildAllSchoolsSummary(state.lastSpellData.spells)` → per-school counts, sample spell names, theme keywords (fire, frost, heal, …) for LLM context.
5. **Config object:**
   - `run_fuzzy_analysis: true` — Python will run TF-IDF/fuzzy analysis.
   - `return_fuzzy_data: true` — Python output must include `fuzzy_relationships`, `similarity_scores`, `fuzzy_groups`, `spell_themes`.
   - `visual_first_mode: true` — Tells C++/Python this is Complex Build; JS will ignore Python’s tree and use only configs + fuzzy data.
   - `llm_auto_configure`: from checkbox (`visualFirstLLMCheck` / `llmAutoConfigCheck`), prompt template (e.g. `getAutoConfigPrompt()`), `all_schools_at_once: true`, `schools_list`.
   - `llm_groups`: from `llmGroupsCheck`, group prompt.
   - `tree_generation`: from `settings.treeGeneration` (element isolation, tier rules, convergence, scoring, etc.).
   - If API key present: `llm_api` (api_key, model, endpoint) for Python LLM client.
6. **Request payload:** `{ spells: filteredSpells, config: config }`. Spells are filtered by blacklist/whitelist.
7. **State:** `state.visualFirstConfigPending = true`.
8. **Bridge:** `window.callCpp('ProceduralPythonGenerate', JSON.stringify(request))`.

---

## Phase 2 — C++: Invoke Python (UIManager.cpp)

**Handler:** `OnProceduralPythonGenerate(const char* argument)`.

1. **Parse:** `request = JSON(argument)`; read `spells`, `config`.
2. **Temp dir:** e.g. `%TEMP%/SpellLearning`; create if needed.
3. **Write input:** `procedural_input.json` = `{ "spells": spells }`.
4. **Write config:** `procedural_config.json` = full `config` (so Python sees `run_fuzzy_analysis`, `return_fuzzy_data`, `llm_auto_configure`, `tree_generation`, etc.).
5. **Locate Python and script:**
   - Prefer MO2 overwrite: `overwrite/SKSE/Plugins/SpellLearning/SpellTreeBuilder/python/python.exe` and `build_tree.py`.
   - Else search `mods/*/SKSE/Plugins/SpellLearning/SpellTreeBuilder` for `python.exe` / `.venv/Scripts/python.exe` and `build_tree.py`.
   - Else `Data/SKSE/Plugins/SpellLearning/SpellTreeBuilder` (Vortex/manual).
   - Fallback: system `python` and USVFS-relative script path.
6. **Command:**  
   `cmd /c "<pythonExe>" "<scriptPath>" -i "<inputPath>" -o "<outputPath>" --config "<configPath>"`
7. **Run:** `std::system(cmd)` (blocking).
8. **Read output:** `procedural_output.json` (full contents as string).
9. **Cleanup:** Delete temp input, output, config files.
10. **Response:**  
    `response = { success: true, treeData: treeJson, elapsed: seconds }`  
    or on failure `{ success: false, error: message }`.
11. **Callback:** `m_prismaUI->InteropCall(m_view, "onProceduralPythonComplete", response.dump())`.

---

## Phase 3 — Python: Fuzzy, LLM, and Tree (build_tree.py)

**Entry:** `build_tree.py` with `-i procedural_input.json -o procedural_output.json -c procedural_config.json`.

1. **Config:** `load_config(config_path)` merges `procedural_config.json` into defaults. So `run_fuzzy_analysis`, `return_fuzzy_data`, `llm_auto_configure`, `llm_api`, `tree_generation`, etc. are available.
2. **Load spells:** From input JSON `spells` array.
3. **Optional LLM auto-config (all schools):**  
   If `llm_auto_configure.enabled` and LLM client can be created:
   - Build prompt from template, fill `{{ALL_SCHOOLS_DATA}}` with school summary.
   - Call `auto_configure_all_schools()` → one LLM call returning per-school settings (shape, density, flower_chance, convergence, branching, etc.).
   - Normalize to `school_configs[school_name]` with `source: 'llm'`.
   - If no LLM or failure, fill `school_configs` from config defaults with `source: 'config'`.
4. **Config for tree builder:** `config['school_configs'] = school_configs` so `SpellTreeBuilder` can use per-school config.
5. **Optional fuzzy analysis:**  
   If `config.get('run_fuzzy_analysis')` or `config.get('return_fuzzy_data')`:
   - `compute_fuzzy_relationships(spells, top_n=5)`:
     - TF-IDF on spell text (name + effects + descriptions).
     - Cosine similarity between spells; for each spell, top-N related spells and pairwise `similarity_scores`.
     - Theme discovery per school; build `groups` (theme → formIds) and `themes` (formId → themes).
   - Store in `fuzzy_data`.
6. **Build trees:** `build_spell_trees(spells, config)` (tree_builder.py):
   - Group spells by school; theme discovery (TF-IDF); per-school `_build_school_tree`.
   - For each school: create `TreeNode` per spell, pick root (vanilla preferred), connect nodes by theme/tier (scoring, max_children, convergence, flowers, etc.), fix orphans and reachability.
   - Returns `{ version, schools: { schoolName: { root, layoutStyle, nodes } } }`.
7. **Optional LLM groups:** If `llm_groups.enabled`, discover themes, group spells, call `enhance_themed_group` for top groups; store in `llm_groups_data`.
8. **Output payload:**
   - Base: `tree_data` (from step 6), `generatedAt`, `generator`, `config`, `seed`, `school_configs`.
   - If `return_fuzzy_data`: add `fuzzy_relationships`, `similarity_scores`, `fuzzy_groups`, `spell_themes` to `tree_data`.
   - If LLM groups: add `llm_groups` to `tree_data`.
9. **Validate/fix:** Validate tree; optionally auto-fix unreachable nodes.
10. **Write:** `procedural_output.json` = full output (tree + school_configs + fuzzy data when requested).

---

## Phase 4 — C++: Return to JS

Already described: C++ reads `procedural_output.json`, builds `response` (success + `treeData` string + elapsed), and calls `InteropCall(..., "onProceduralPythonComplete", response.dump())`. No extra processing.

---

## Phase 5 — JS: Extract and Run Builder (proceduralTreeBuilder.js)

**Handler:** `window.onProceduralPythonComplete(resultStr)`.

1. **Parse:** `result = JSON.parse(resultStr)`.
2. **Complex Build branch:** If `state.visualFirstConfigPending && result.success`:
   - Set `state.visualFirstConfigPending = false`.
   - `treeData = result.treeData` (parsed if string).
   - **School configs:** `schoolConfigs = treeData.school_configs || {}`.
   - **Fuzzy data:**  
     `fuzzyData = { relationships, similarity_scores, groups, themes }` from `treeData.fuzzy_relationships`, `similarity_scores`, `fuzzy_groups`, `spell_themes`.
   - **Ignore Python tree:** The actual tree structure from Python is not used; only `schoolConfigs` and `fuzzyData` are used.
   - Call **`doVisualFirstGenerate(schoolConfigs, fuzzyData)`**.
   - Reset procedural-plus button if needed, return.
3. **On failure:** If visual-first was pending, call `doVisualFirstGenerate({}, null)` (default configs, no fuzzy data) and return.

---

## Phase 6 — JS: Resolve Per-School Configs (proceduralTreeBuilder.js)

**Inside `doVisualFirstGenerate(schoolConfigs, fuzzyData)` (async part in setTimeout):**

1. **Spells by school:** Filter (blacklist/whitelist) `state.lastSpellData.spells`, group by `school`.
2. **Final config per school:** For each school:
   - Prefer **LLM:** `schoolConfigs[schoolName]` (from Python).
   - Else **UI:** `getSchoolConfig(schoolName)` (shape, density, …).
   - If LLM exists but UI has a specific shape, override `config.shape` with UI shape.
   - **Default** if still missing: `{ shape: 'organic', density: 0.6, convergence_chance: 0.4, flower_chance: 0.1, flower_type: 'burst', slice_weight: 1.0, jitter: 30 }`.
   - Set `branching_mode` from dropdown `visualFirstBranchingMode` (e.g. `fuzzy_groups`).
   - Normalize fields (shape, density, convergence_chance, flower_*, slice_weight, jitter, source).
3. **Apply to UI:** `applySchoolConfigsToUI(finalConfigs)` so controls reflect what’s used.
4. **Fuzzy:** `fuzzy = fuzzyData || { relationships, similarity_scores, groups, themes }` (default empty).

---

## Phase 7 — JS: Settings-Aware Tree Build (settingsAwareTreeBuilder.js)

**Call:** `buildAllTreesSettingsAware(filteredSpells, finalConfigs, settings.treeGeneration, fuzzy)`.

**At top level:**

1. **Expose fuzzy for scoring:** `window._pythonFuzzyData = fuzzyData` (used by EdgeScoring when scoring edges).
2. **Group spells by school:** `spellsBySchool[school] = [spells]`.
3. **Per school:** `buildSchoolTree(spells, treeGeneration, schoolSeed, schoolName, schoolConfig, pythonData)` → `{ root, nodes, links, stats }`.
4. **Aggregate:** `schools[schoolName] = { root, nodes, links }`.
5. **Result object:** `{ version: '2.0', generator: 'SettingsAwareBuilder', generatedAt, settings, schools }`.
6. **Layout:** If `LayoutEngine.applyPositionsToTree` exists, call it with `result` and options (shape, seed, schoolConfigs) so each node gets `x`, `y`. Otherwise nodes keep 0,0.
7. **Return** `result`.

**Inside `buildSchoolTree(spells, settings, seed, schoolName, schoolConfig, pythonData)`:**

- **Setup:**  
  Build `spellThemeMap` from `pythonData.themes` (formId → theme). Create seeded RNG. Get growth behavior for school (e.g. from `growthBehaviors.js`). Optional DSL recipe merge. Sort spells by tier.
- **Root:** First Novice (tier 0) spell as root; create one node per spell with `formId`, `name`, `spell`, `tier`, `element` (from EdgeScoring/element detection), `isRoot`, `prerequisites`, `children`, `x: 0`, `y: 0`.
- **Root wiring (if elementIsolationStrict):**  
  - Single root: connect all other tier-0 nodes to root (start of element chains).  
  - Multiple roots: one root per element at tier 0; connect same-element tier-0 to that root.
- **maxChildrenPerNode:** From settings; may be increased in strict element mode or from behavior.
- **Phase 1 — Primary tree:**  
  For each tier from 1 to max:
  - Collect all nodes from lower tiers as parent candidates.
  - For each node at current tier: score each candidate with `_scoreEdge(parent.spell, node.spell, settings)` (uses EdgeScoring + Python similarity if available); filter by `score >= 0` and `parent.children.length < maxChildrenPerNode`; sort by score then by fewer children; connect to best parent via `tryCreateEdge`, add to `prerequisites`/`children`, update stats. Optionally mark hub nodes from behavior.
  - Rejected candidates (e.g. cross-element when isolation on) counted in stats.
- **Phase 2 — Convergence:**  
  If `settings.convergenceEnabled !== false`: for each node at tier ≥ `convergenceMinTier` (e.g. 3), with probability `convergenceChance`, add one extra parent from lower-tier candidates (scored, valid edge, under max children); add second prerequisite and link.
- **Output:** Map nodes to `{ formId, name, tier, element, isRoot, prerequisites, children }`; edges to `{ from, to, type }`. Return `{ nodes, links, root: rootSpell.formId, stats }`.

**Edge scoring (concept):** `EdgeScoring.scoreEdge(fromSpell, toSpell, settings)` uses element match, tier progression, keyword/theme, and optionally Python `_pythonFuzzyData.similarity_scores` / themes to prefer same-element and thematic parents.

---

## Phase 8 — JS: Layout (layoutEngine.js)

**Called from:** `buildAllTreesSettingsAware` after building `result.schools`.

**`LayoutEngine.applyPositionsToTree(treeData, options)`:**

1. For each school in `treeData.schools`:
   - Read `schoolConfig` from `options.schoolConfigs[schoolName]`; shape from config or `options.shape` or school default (e.g. organic).
   - Resolve growth behavior (e.g. from `GROWTH_BEHAVIORS`).
   - Compute positions for each node (angles, radii, or grid depending on shape/behavior) and set `node.x`, `node.y`.
2. Mutates `treeData.schools[schoolName].nodes` in place; no new structure. Tree is still `{ version, generator, settings, schools }` with nodes now having coordinates.

---

## Phase 9 — JS: Load and Parse (treeViewerUI.js, treeParser.js)

**Call:** `loadTreeData(treeData)` (from `doVisualFirstGenerate`).

1. **Parse:** `TreeParser.parse(jsonData)`:
   - Expects `data.schools`. For each school: `root`, `nodes` (array with `formId`, `children`, `prerequisites`, tier, etc.), optional `layoutStyle`, `sliceInfo`, `config_used`.
   - Builds internal `TreeParser.nodes` (Map formId → node), `TreeParser.edges` (list), `TreeParser.schools` (root, nodeIds, maxDepth, layoutStyle, sliceInfo, config).
   - Each node: `id`, `formId`, `name`, `school`, `level`, `tier`, `depth`, `prerequisites`, `children`, `x`, `y` (from node or 0), `isRoot`, etc. Fills `allFormIds` for cache.
   - Derives `edges` from `children`/`prerequisites`.
   - Cycle/orphan detection and optional auto-fix; reachability checks.
   - Returns `{ success, nodes: Map, edges, schools, allFormIds }` (and possibly `error`).
2. **Store:** `state.treeData = result`; `result.rawData = jsonData`.
3. **Optional aggressive validation:** If manual import and `settings.aggressivePathValidation`, run `TreeParser.detectAndFixCycles` per school.
4. **Self-ref cleanup:** Remove any `prerequisites` entry that equals the node’s own id/formId.
5. **Node states:** Root nodes → `available`; nodes with no prerequisites → `available`; all others → `locked`. (Progression will later set `unlocked` from save/known spells.)

---

## Phase 10 — JS: Render and Persist (treeViewerUI.js)

**Still inside `loadTreeData`:**

1. **School config / LLM groups:** If `rawData.school_configs` / `rawData.llm_groups` exist, call `WheelRenderer.setSchoolConfigs` / `WheelRenderer.setLLMGroups` for styling.
2. **Spell cache:** `SpellCache.requestBatch(result.allFormIds, callback)`. In callback: `TreeParser.updateNodeFromCache(node)` per node, then `SmartRenderer.setData(result.nodes, result.edges, result.schools)`.
3. **Initial render:** `SmartRenderer.setData(result.nodes, result.edges, result.schools)`:
   - Chooses renderer by node count (e.g. Canvas for large, SVG wheel for smaller).
   - Sets data on `WheelRenderer` or `CanvasRenderer`; triggers render (e.g. `WheelRenderer.render()` or `CanvasRenderer.refresh()`).
4. **UI:** Hide empty state, set total count, unlock count (0 on load). If `switchToTreeTab !== false`, `switchTab('spellTree')`.
5. **C++:** Build prerequisite payload (hard/soft per node) and call `callCpp('SetLearningTargetPrerequisites', ...)` (or equivalent) so C++ knows prereqs for progression/tome checks.
6. **Save tree:** `window.callCpp('SaveSpellTree', JSON.stringify(treeData))` so the generated tree is persisted (e.g. to spell_tree.json or via unified config).

**Back in `doVisualFirstGenerate`:**

7. Status text: e.g. "Settings-Aware Build: N schools, M spells" (optionally "+ LLM configs: K").
8. Status icon: OK.
9. After short delay, switch to Spell Tree tab if not already.
10. **`resetVisualFirstButton()`:** Re-enable BUILD TREE (Complex), restore button label.

---

## Data Flow Summary

```
User click
  → startVisualFirstGenerate()
  → startVisualFirstPythonConfig()  [build config, set visualFirstConfigPending]
  → callCpp('ProceduralPythonGenerate', { spells, config })

C++ OnProceduralPythonGenerate
  → write procedural_input.json, procedural_config.json
  → spawn: python build_tree.py -i ... -o ... -c ...
  → read procedural_output.json
  → InteropCall('onProceduralPythonComplete', { success, treeData, elapsed })

Python build_tree.py
  → load config (run_fuzzy_analysis, return_fuzzy_data, llm_auto_configure, …)
  → optional LLM auto_configure_all_schools → school_configs
  → optional compute_fuzzy_relationships → fuzzy_relationships, similarity_scores, groups, spell_themes
  → build_spell_trees(spells, config) → tree JSON (discarded by JS in Complex mode)
  → write output (tree + school_configs + fuzzy_* when return_fuzzy_data)

JS onProceduralPythonComplete
  → if visualFirstConfigPending && success: extract school_configs, fuzzyData
  → doVisualFirstGenerate(schoolConfigs, fuzzyData)

doVisualFirstGenerate
  → resolve finalConfigs per school (LLM > UI > defaults)
  → buildAllTreesSettingsAware(spells, finalConfigs, settings.treeGeneration, fuzzy)

buildAllTreesSettingsAware
  → per school: buildSchoolTree(...)  [nodes, root, Phase 1 edges, Phase 2 convergence]
  → LayoutEngine.applyPositionsToTree(result, options)
  → return result

doVisualFirstGenerate (cont.)
  → loadTreeData(treeData)

loadTreeData
  → TreeParser.parse(treeData) → state.treeData
  → node states (root/available, rest locked)
  → WheelRenderer.setSchoolConfigs / setLLMGroups
  → SpellCache.requestBatch → SmartRenderer.setData → render
  → callCpp('SaveSpellTree', treeData)
  → switchTab('spellTree'), resetVisualFirstButton()
```

---

## Key Files

| Phase | File(s) |
|-------|--------|
| 1 | `PrismaUI/.../modules/proceduralTreeBuilder.js` — startVisualFirstGenerate, startVisualFirstPythonConfig |
| 2 | `plugin/src/UIManager.cpp` — OnProceduralPythonGenerate |
| 3 | `SKSE/Plugins/SpellLearning/SpellTreeBuilder/build_tree.py`, `tree_builder.py`, `theme_discovery`, `spell_grouper`, etc. |
| 4 | (same as 2) |
| 5 | `proceduralTreeBuilder.js` — onProceduralPythonComplete |
| 6 | `proceduralTreeBuilder.js` — doVisualFirstGenerate (config resolution) |
| 7 | `modules/settingsAwareTreeBuilder.js` — buildAllTreesSettingsAware, buildSchoolTree; `edgeScoring.js` for scoring |
| 8 | `modules/layoutEngine.js` — applyPositionsToTree |
| 9 | `modules/treeViewerUI.js` — loadTreeData; `modules/treeParser.js` — parse |
| 10 | `treeViewerUI.js` — loadTreeData (render, save); `wheelRenderer.js` / `canvasRenderer.js`; `UIManager.cpp` — SaveSpellTree |

This is the full path for BUILD TREE (Complex) from click to a fully built and displayed tree.
