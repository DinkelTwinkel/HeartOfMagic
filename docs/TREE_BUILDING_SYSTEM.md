# Tree Building System — Architecture & Algorithms

**Purpose:** In-depth reference for how spell trees are built, sorted, matched, and laid out across all layers of the system: C++ native builders (TreeBuilder/TreeNLP), JS layout engines, root preview modules, and PreReqMaster NLP scoring.

---

## System Overview

The tree building pipeline has four layers, each with a distinct responsibility:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  JAVASCRIPT (UI Layer)                                                  │
│                                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────────┐    │
│  │ Root Preview │    │ Growth Module │    │ PreReqMaster (PRM)      │    │
│  │ SUN / FLAT   │───>│ CLASSIC/TREE │───>│ NLP prerequisite locks  │    │
│  │ grid + arcs  │    │ layout + BFS │    │ TF-IDF scoring + cycles │    │
│  └─────────────┘    └──────┬───────┘    └──────────┬──────────────┘    │
│                             │ buildTree()            │ applyLocks()     │
├─────────────────────────────┼────────────────────────┼──────────────────┤
│  C++ NATIVE BUILDERS (TreeBuilder + TreeNLP)         │                  │
│  ┌──────────────────────────┴────────────────────────┘                  │
│  │ OnProceduralTreeGenerate() → TreeBuilder::Build()                 │
│  │ Reads "command" field → routes to correct builder mode              │
│  │ Build runs on background thread → result dispatched to game thread  │
│  │ via SKSE AddTask → onProceduralTreeComplete() to JS                 │
│  │                                                                      │
│  │ Builder Modes:                                                       │
│  │   ├─ "build_tree_classic"  → BuildClassic()  (Tier-first)           │
│  │   ├─ "build_tree"          → BuildTree()     (NLP thematic)         │
│  │   ├─ "build_tree_graph"    → BuildGraph()    (Edmonds' MSA)         │
│  │   ├─ "build_tree_thematic" → BuildThematic() (3D similarity BFS)   │
│  │   └─ "build_tree_oracle"   → BuildOracle()   (LLM-guided chains)   │
│  │                                                                      │
│  │ NLP Engine (TreeNLP):                                                │
│  │   TF-IDF, cosine similarity, char n-grams, Levenshtein,            │
│  │   fuzzy matching, theme scoring, PRM scoring                        │
│  └──────────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────────┘
```

**Data flows one direction:** C++ builds the tree structure (nodes + parent/child links) → JS positions nodes on a visual grid and renders them.

---

## Layer 1: Root Preview Modules (JS)

Root modules define **where school root nodes sit** and generate the **grid of candidate positions** that growth modules consume. They do NOT know about spell trees — only geometry.

### SUN Mode (`treePreviewSun.js`)

Radial wheel layout. Schools get angular arcs, spells grow outward from a central ring.

**Algorithm:**
1. Distribute school arcs around 360 degrees (equal or proportional to spell count)
2. Place root node(s) at `ringTier` radius within each school's arc
3. Generate grid points using pluggable algorithm (`naive`, `linear`, `equalArea`, `fibonacci`, `square`)
4. Tag each grid point with its school based on angular position

**Arc Distribution:**
```
proportional=false: each school gets 360° / schoolCount
proportional=true:  arc width = (schoolSpells / totalSpells) × 360°
```

**Growth Direction:**
- Normal: higher tiers radiate outward from root ring
- Inverted: higher tiers grow inward toward center

**Output (`getGridData()`):**
```javascript
{
    mode: 'sun',
    schools: [{ name, color, arcStart, arcSize, ... }],
    rootNodes: [{ x, y, dir, school, color, formId }],
    grid: { tierSpacing, ringTier, ... },
    gridPoints: [{ x, y, school }, ...]
}
```

### FLAT Mode (`treePreviewFlat.js`)

Linear layout. Schools arranged along a horizontal or vertical line with growth extending orthogonally.

**Algorithm:**
1. Distribute schools along a line (equal or proportional spacing)
2. Place root nodes on the line
3. Generate rectangular grid extending from the line
4. Tag each grid point with school based on position along the line

**Output:** Same schema as SUN, different geometry.

---

## Layer 2: C++ Native Tree Builders

C++ builds the **tree structure** — which spell is parent/child of which. Five builder modes exist in `TreeBuilder.cpp`.

### Classic Builder (`TreeBuilder::BuildClassic`)

**Purpose:** Tier-first ordering. Novice spells are always ancestors of higher-tier spells.

**Core constraint:** `node.depth = tier_index` — Novice=0, Apprentice=1, Adept=2, Expert=3, Master=4.

**Algorithm:**

1. **Group spells by school** — unknown schools → "Hedge Wizard"
2. **Discover themes** via `DiscoverThemesPerSchool()` (TF-IDF)
3. **Build NLP data** — extract text per spell for similarity scoring
4. **Per-school tree building:**
   - Group spells by tier (unknown → Novice)
   - Pick root: prefer vanilla Novice spell (`formId >> 24 < 0x05`)
   - Assign themes to nodes via keyword frequency in spell text
   - **Tier-by-tier connection:** For each tier in order (Novice→Master):
     - Shuffle spells for variety
     - For each spell, find best parent from lower tiers
     - Link via `LinkNodes()`, then override `depth = tier_index`
     - Track available parents (those with remaining capacity)
   - Force-connect orphans to least-loaded connected node
5. **Validate & auto-fix** unreachable nodes

**Parent Selection Scoring (`_find_best_parent`):**

| Factor | Weight | Description |
|--------|--------|-------------|
| Theme match | +10.0 | Same theme as parent |
| Theme mismatch | -2.0 | Different theme |
| Text similarity | +0 to +5.0 | Jaccard word overlap × 5 |
| Load balancing | -1.5 per child | Prefer parents with fewer children |
| Tier proximity | +2.0 / +1.0 | Immediate predecessor / two tiers back |
| Random jitter | ±0.5 | Variety |

**Text Similarity (Jaccard):**
```
words_a = tokenize(text_a)  // lowercase, strip punctuation, filter short words
words_b = tokenize(text_b)
similarity = |words_a ∩ words_b| / |words_a ∪ words_b|
```

Uses `TreeNLP::Tokenize()` — no external libraries required.

### Tree Builder (`TreeBuilder::BuildTree`)

**Purpose:** NLP-driven thematic trees. Parent/child links based on spell content similarity. Tree structure emerges from themes, not tier ordering.

**Algorithm:**

1. **Group spells by school**
2. **Discover themes** via TF-IDF keyword extraction (`DiscoverThemesPerSchool()`)
3. **Merge hints** — vanilla Skyrim element names (fire, frost, shock, heal, etc.)
4. **Per-school configuration** — apply shape/density/convergence per school (from LLM or defaults):
   ```
   Destruction → explosion, Restoration → tree, Alteration → mountain,
   Conjuration → portals, Illusion → organic
   ```
5. **Compute similarity matrix** — pairwise TF-IDF cosine similarity between all spells in school
6. **Per-school tree building:**
   - Create TreeNodes, assign themes (fuzzy match → fallback)
   - Select root (prefer vanilla roots like Flames, Healing, etc.)
   - **Group spells by theme** via `GroupSpellsBestFit()`
   - **Round-robin connection:** Cycle through themes, placing one spell per theme per round. This ensures each theme gets fair access to shallow parent positions:
     ```
     Round 1: fire[0] → frost[0] → shock[0] → heal[0]
     Round 2: fire[1] → frost[1] → shock[1] → heal[1]
     ...
     ```
   - Per-theme parent coherence: each theme tracks its "current parent" so fire spells chain together
   - **Convergence insertion** for high-tier spells (Expert/Master get extra prerequisites)
   - Connect orphans, enforce high-tier convergence, validate reachability
   - Assign sections (root/trunk/branch) based on percentile depth

### Graph Builder (`TreeBuilder::BuildGraph`)

**Purpose:** Directed minimum spanning tree using Edmonds' algorithm. Creates arborescences from NLP similarity weights.

**Algorithm:**
1. Build complete weighted digraph from pairwise TF-IDF cosine similarity
2. Apply tier ordering bias (lower→higher tier edges preferred)
3. Run Edmonds' minimum spanning arborescence from root
4. Validate reachability, fix orphans

### Thematic Builder (`TreeBuilder::BuildThematic`)

**Purpose:** 3D similarity BFS. Builds per-theme branches using multi-dimensional similarity scoring.

**Algorithm:**
1. Discover themes, group spells by best-fit theme
2. Per theme: BFS expansion from theme seed spell
3. Similarity scoring: weighted combination of TF-IDF text sim, name n-gram sim, and effect similarity
4. Cross-theme convergence at higher tiers

### Oracle Builder (`TreeBuilder::BuildOracle`)

**Purpose:** LLM-guided semantic chain grouping. Uses OpenRouter API to create thematic spell chains.

**Algorithm (with LLM):**
1. Batch spells per school (configurable batch size)
2. Send to LLM with prompt requesting thematic chain assignments
3. Parse LLM response into chain groups
4. Build tree from chains with inter-chain links

**Fallback (no LLM / LLM failure):**
1. Use NLP-based cluster-lane approach
2. K-means style clustering on TF-IDF vectors
3. Per-cluster linear chain with cross-cluster links

**Parent Selection Scoring (`_score_parent`):**

| Factor | Weight | Description |
|--------|--------|-------------|
| Theme match | +100 | Same element/keyword |
| Theme coherence | +70 | Theme-chain bonus |
| Element isolation | -50 / -9999 | Cross-element penalty (strict = reject) |
| Tier progression | +50 / +30 / -20 | Adjacent tier / skip-one / big skip |
| TF-IDF similarity | +0 to +60 | Cosine similarity × 60 |
| Capacity penalty | -30 × ratio | children_count / max_children |
| Same-tier link | +10 | If allowed by config |

**Convergence Points:**
- Extra prerequisite links (not parent/child) added to high-tier spells
- Probability increases with tier: Novice 0.5×, Master 10× base chance
- **Forced** for Expert with <2 prereqs and Master with <3 prereqs
- Prefer prerequisites from a different theme (cross-branch convergence)

**Reachability Validation (`_ensure_all_reachable`):**
- Simulates progressive unlock starting from root
- A node unlocks when ALL its prerequisites are unlocked
- If nodes remain unreachable after 20 repair passes, logs warning
- Repair strategies: remove blocking prereqs → find new parent → spread across available

### TF-IDF Theme Discovery (`TreeBuilder::DiscoverThemesPerSchool`)

**Shared by all builders.** Discovers keyword themes per school from spell text using `TreeNLP::ComputeTfIdf()`.

**Algorithm:**
```
For each word across all spells in school:
    TF = term_count / total_tokens
    DF = documents_containing_word
    IDF = log((total_docs + 1) / (DF + 1)) + 1   (smoothed)
    score = TF × IDF
Sort descending → take top N
```

**Stop words:** English common words + spell-specific ("spell", "magic", "damage", "target", "health", "magicka", "novice", "master", etc.)

**Hint merging:** Discovered themes are supplemented with vanilla Skyrim elements:
```
Destruction: fire, frost, shock, cold, lightning
Restoration: heal, cure, restore, buff, bless
Alteration:  skin, armor, shield, polymorph, transmute
Conjuration: summon, conjure, bound, portal, familiar
Illusion:    invisibility, charm, fury, calm, fear
```

### TreeNode Data Model (`TreeBuilder::TreeNode`)

```cpp
struct TreeNode {
    std::string formId;          // "0x00012FCD"
    std::string name;            // "Flames"
    std::string tier;            // "Novice"
    std::string school;          // "Destruction"
    std::string theme;           // "fire" (may be empty)
    std::string section;         // "root" / "trunk" / "branch" (may be empty)

    std::vector<std::string> children;       // formIds of child nodes
    std::vector<std::string> prerequisites;  // formIds of prerequisite nodes
    int depth = 0;                           // distance from root (0 = root)
    bool isRoot = false;
};
```

**`LinkNodes(parent, child)`:**
- Adds child.formId to parent.children
- Adds parent.formId to child.prerequisites
- Sets child.depth = parent.depth + 1

**Note:** Classic builder overrides depth after linking to enforce `depth = tier_index`.

---

## Layer 3: C++ ↔ JS Integration

### Command Flow (`UIManager.cpp` → `TreeBuilder`)

```cpp
OnProceduralTreeGenerate(argument):
    1. Parse JSON from JS
    2. Read "command" field (default: "build_tree")
    3. Extract spells array and config
    4. Launch background std::thread for TreeBuilder::Build()
       → TreeBuilder has zero RE:: dependencies, safe to run off game thread
       → OpenMP used for inner-loop parallelism (similarity matrices)
    5. On completion, dispatch result back to game thread via SKSE AddTask
    6. Callback packages {success, treeData, elapsed}
       → InteropCall("onProceduralTreeComplete", response)
```

**Commands:**
| Command | Builder | Mode |
|---------|---------|------|
| `build_tree` | `BuildTree()` | NLP thematic |
| `build_tree_classic` | `BuildClassic()` | Tier-first |
| `build_tree_graph` | `BuildGraph()` | Edmonds' MSA |
| `build_tree_thematic` | `BuildThematic()` | 3D similarity BFS |
| `build_tree_oracle` | `BuildOracle()` | LLM-guided chains |
| `prm_score` | `TreeNLP::ProcessPRMRequest()` | PRM scoring |

---

## Layer 4: JS Growth Layout Modules

Growth modules take the tree structure from C++ and **position nodes on the grid** from the root preview module.

### Classic Growth Layout (`classicLayout.js`)

Positions spell nodes on the 2D grid using wave-based BFS with tier zone and theme scoring.

**Algorithm:**

**Phase 1 — Grid Graph Construction (Spatial Hashing):**
- Hash all grid points into cells (cellSize = tierSpacing × 1.5)
- For each point, find 8 nearest neighbors within maxDist using 3×3 cell neighborhood
- Result: adjacency graph for O(1) neighbor lookup

**Phase 2 — Root Seeding:**
- Snap each school root to nearest unoccupied grid point

**Phase 3 — Wave-Based BFS:**
```
wave 0: root nodes
wave 1: children of roots
wave 2: children of wave-1 nodes
...

Per wave:
  shuffle nodes (fair ordering)
  for each node's children:
    check tier zone constraint → defer if mismatch
    find best adjacent slot via _findSlots()
    place on grid, mark occupied
```

**Phase 4 — Deferred Node Placement (up to 5 passes):**
- Nodes deferred due to tier zone mismatch are retried
- Parents may now be placed, opening new adjacent slots

**Phase 5 — Force-Placement:**
- Any remaining unplaced nodes get nearest unoccupied grid point

**Slot Scoring Formula (`_findSlots`):**

```
totalScore = directionScore + radialBonus - depthPenalty + tierZoneScore + themeSectorScore
```

| Factor | Range | Description |
|--------|-------|-------------|
| Direction score | [-1, +1] | Dot product of slot vector with growth direction |
| Radial bonus | ±radialWeight | Positive if slot is farther from center than parent |
| Depth penalty | -depth × 0.3 | Higher depth nodes penalized (crowding control) |
| Tier zone score | [-15, +3] | Bonus if slot falls within tier's configured zone % |
| Theme sector score | [-3.5, +2.5] | Bonus if slot's angle matches theme's arc sector |

**Tier Zone Scoring Detail:**
```
radiusPct = (slotRadius - ringRadius) / (maxRadius - ringRadius) × 100

if radiusPct < zone.min:
    score -= 5.0 + (zone.min - radiusPct) / 100 × 10.0   (too close)
elif radiusPct > zone.max:
    score -= 5.0 + (radiusPct - zone.max) / 100 × 10.0   (too far)
else:
    centeredness = 1.0 - |radiusPct - zoneCenter| / zoneHalf
    score += 3.0 × centeredness                             (in zone)
```

**Three Spell Matching Modes:**

| Mode | Behavior |
|------|----------|
| `simple` | No theme awareness. Pure direction + density scoring. |
| `layered` | Uses `node.theme` from C++ builder for sector-based bias. Theme match bonus in slot scoring. |
| `smart` | Runs `ClassicThemeEngine.discoverAndAssign()` (JS-side keyword analysis) before layout. More refined theme grouping. |

These modes control **visual clustering** (spatial grouping of similar spells), not tree structure. The C++ builder determines parent/child links; the layout engine determines where each node sits on screen.

### Tree Growth Layout (`treeGrowthTree.js`)

Corridor-based trunk layout with section allocation.

**Settings:**
```
pctBranches: 30%   — outer canopy
pctTrunk: 50%      — central corridor
pctRoot: 20%       — inner root zone
trunkThickness: 70px
```

**Section assignment** (done in C++): Nodes sorted by depth, then allocated by percentile:
- First 20% of nodes → `root` section
- Next 50% → `trunk` section
- Remaining 30% → `branch` section

**Layout:** Trunk module computes a central corridor. Nodes in `trunk` section fill the corridor. `branch` nodes spread outward. `root` nodes cluster near the tree base.

**Ghost preview:** Semi-transparent nodes show where the trunk will fill before building.

---

## Layer 4: PreReqMaster (PRM)

PRM adds **extra prerequisite locks** to the built tree using NLP scoring. It runs after tree building and before final rendering.

### Purpose

Makes the spell tree more interesting by requiring players to master thematically related spells before unlocking others. Example: to unlock "Incinerate" (Expert), you might need to master "Firebolt" (Apprentice) — a thematic link discovered by NLP.

### Pipeline

```
Tree built (C++) → TreeGrowth.setTreeBuilt(true)
  → PreReqMaster.autoApplyLocks() triggered
    → buildLockRequest()       (eligibility filtering)
    → Send to C++ or JS       (NLP scoring)
    → applyLocksWithScorer()   (weighted random + cycle detection)
    → Render lock edges
```

### Phase 1: Lock Request Building

**Budget Calculation:**
```
totalLocks = totalNonRootSpells × globalLockPercent / 100

Distribution across schools:
  'even':          equal per school
  'proportional':  based on school spell count
  'random':        shuffled allocation
```

**Per-Tier Budget:**
```
tierPercents = { novice: 0%, apprentice: 10%, adept: 25%, expert: 40%, master: 50% }

Novice spells get 0 locks (no restrictions on basics).
Master spells get locks on 50% of them (gatekeep the powerful stuff).
```

**Candidate Pool Filtering:**

For each eligible spell, candidates must pass these filters:

| Filter | Purpose |
|--------|---------|
| Same school or nearby (grid distance) | Pool source control |
| Same / previous / higher tier (configurable) | Tier constraint |
| Not a descendant | Prevents deadlock (can't require mastering your own child) |
| Not only-reachable-through self | Prevents soft deadlock |
| Not already a prerequisite | No redundancy |
| Not already locked (optional) | Chain lock prevention |

Pool capped at 50 candidates per spell (performance).

### Phase 2: NLP Scoring

**Sent to C++ (`TreeNLP::ProcessPRMRequest()`) or JS fallback.**

**Algorithm (identical in both):**

1. **Text preparation** per spell:
   ```
   text = name(×2 weight) + description + effect names
   ```
2. **Tokenization:** lowercase, alphanumeric only, length > 2, stop words removed
3. **Per-pair TF-IDF corpus:** spell + its candidates form a mini corpus
4. **TF-IDF computation:**
   ```
   TF = term_count / total_tokens
   IDF = log((n_docs + 1) / (DF + 1)) + 1    (smoothed)
   weight = TF × IDF
   ```
5. **Cosine similarity:** dot product of TF-IDF vectors / (magnitude_A × magnitude_B)
6. **Proximity blending** (if `poolSource == "nearby"`):
   ```
   prox_score = max(0, 1 - distance / max_distance)
   final = (1 - proximityBias) × nlp_score + proximityBias × prox_score
   ```

**Output per spell:** Top 5 candidates with scores (0.0 to 1.0).

### Phase 3: Lock Application

**Weighted random selection** from top 5 candidates:
- Higher NLP score → higher probability of selection
- Not always the #1 match — allows meaningful variety

**Constraints during application:**

| Constraint | Method |
|------------|--------|
| Target usage cap (max 2) | Prevents one popular spell from being everyone's prereq |
| Cycle detection | Kahn's algorithm (topological sort) on combined tree + lock edges |
| Cycle removal | Remove lock edges where both endpoints are in detected cycles |
| Reachability validation | BFS from roots verifies all nodes still reachable |

**Kahn's Algorithm (cycle detection):**
```
1. Build adjacency: prereq → [dependents] (tree edges + lock edges)
2. Compute in-degree for each node
3. Queue all nodes with in-degree = 0
4. Process queue: for each node, decrement neighbors' in-degree
5. Nodes still with in-degree > 0 after processing = in a cycle
6. Remove lock edges connecting cycle nodes
```

### Lock Rendering

- Hidden by default — revealed when user clicks a spell node
- Rendered as distinct chain-link visual (not same as tree edges)
- Shows NLP similarity score
- Locks become **hard prerequisites** — the locked spell cannot receive XP until the lock prerequisite is mastered

### Fallback Strategy

```
Try C++ NLP (via "prm_score" command → TreeNLP::ProcessPRMRequest())
  → Success: use top candidates
  → Failure: fall back to JS TF-IDF scorer (synchronous, identical algorithm)
```

---

## Shared Output Format

All C++ builders output the same JSON schema so all downstream JS systems (layout, apply, PRM) work identically:

```json
{
  "version": "1.0",
  "schools": {
    "Destruction": {
      "root": "0x00012FCD",
      "layoutStyle": "tier_first" | "organic" | "radial",
      "nodes": [
        {
          "formId": "0x00012FCD",
          "name": "Flames",
          "tier": 0,
          "school": "Destruction",
          "children": ["0x0001C789", "0x0001C78A"],
          "prerequisites": [],
          "depth": 0,
          "theme": "fire",
          "section": "root"
        }
      ],
      "config_used": {
        "shape": "tier_first" | "organic",
        "density": 0.6,
        "symmetry": 0.3,
        "source": "classic" | "default" | "llm"
      }
    }
  },
  "generatedAt": "2026-02-10T...",
  "generator": "ClassicTreeBuilder (Tier-First)" | "SpellTreeBuilder",
  "seed": 123456,
  "validation": {
    "all_valid": true,
    "total_nodes": 47,
    "reachable_nodes": 47
  }
}
```

---

## End-to-End Example: Classic Growth Build

```
1. User clicks "Build Tree" in Classic Growth tab
2. classicMain.js sends:
   {
     command: "build_tree_classic",
     spells: [228 spells],
     config: { tier_zones: {Novice: {min:0, max:40}, ...}, ... }
   }

3. UIManager.cpp reads command="build_tree_classic", runs TreeBuilder::BuildClassic()

4. BuildClassic():
   - Groups 228 spells into 5 schools
   - Discovers themes: Destruction → [fire, frost, shock, ...]
   - Per school:
     - Picks "Flames" as Destruction root (vanilla Novice)
     - Places all Novice spells as root's children (depth 0)
     - Places Apprentice spells as children of Novice nodes (depth 1)
       → "Firebolt" links to "Flames" (high text similarity)
     - Places Adept spells under Apprentice (depth 2)
     - Expert under Adept (depth 3), Master under Expert (depth 4)
   - Validates: all 47 Destruction nodes reachable ✓

5. Result returns through background thread → SKSE AddTask → game thread → InteropCall to JS

6. proceduralTreeBuilder.js routes to TreeGrowthClassic.loadTreeData()

7. classicLayout.js runs:
   - Gets SUN grid (400 grid points, 5 school arcs)
   - Builds spatial hash graph
   - BFS wave placement:
     Wave 0: Flames at grid center → slot score includes tier zone bonus
     Wave 1: Fire Novice spells in inner 40% ring
     Wave 2: Apprentice spells in 10-55% ring
     ...
   - Tier zones NOW work because C++ put Novice at depth 0
   - Theme sectors cluster fire spells in one angular region

8. PRM runs (if enabled):
   - Picks 30% of non-root spells for locks
   - Scores candidates: "Incinerate" ↔ "Firebolt" similarity = 0.72
   - Applies lock: must master "Firebolt" to unlock "Incinerate"
   - Kahn's algorithm confirms no cycles

9. Canvas renders positioned, locked tree
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Separate C++ builder modes | Classic needs tier-first ordering; Tree needs NLP thematic ordering; Graph uses directed MST. Different algorithms for different goals. |
| Native C++ NLP engine | Eliminates Python subprocess, pip dependencies, Wine/Proton IPC issues. All algorithms are deterministic math that runs faster in C++. |
| All builders in single TreeBuilder.cpp | Shared NLP engine (TreeNLP), shared theme discovery, shared validation. No duplication. |
| Tier zones in JS layout, not C++ | Layout is visual concern. C++ builds structure; JS decides spatial placement. |
| Three spell matching modes | Users want control over visual clustering without rebuilding the tree. |
| PRM as post-processing | Locks are additive — they don't change the tree structure, only add prerequisite gates. |
| Weighted random for PRM | Always picking #1 NLP match would feel mechanical. Top-5 selection adds variety. |
| Kahn's cycle detection | Lock edges can create circular dependencies. Topological sort catches them efficiently. |
| Round-robin theme interleaving (Tree mode) | Without it, the largest theme monopolizes root's children. Interleaving distributes growth fairly. |
| Convergence enforcement (Tree mode) | Expert/Master spells should feel hard-won. Forced multi-prerequisite gates create meaningful progression. |
