# Spell Tree Quality: Assessment Methodology & Solutions

## Overview

The spell tree builder (Python) generates tree structures that the JS layout (PrismaUI) positions on a visual grid. The raw Python output can have structural issues — orphan nodes, mega-hub nodes with 10-16 children, extreme tier jumps, and poor theme grouping. This document covers how we measure tree quality and the JS-side solutions that fix these issues at layout time.

## Assessment Methodology

### Metrics

We evaluate spell trees on 7 structural metrics:

| Metric | Definition | Target |
|--------|-----------|--------|
| **Max fan-out** | Most children any single node has | ≤ 5 |
| **Orphans** | Nodes with 0 children AND 0 prerequisites (isolated) | 0 |
| **Theme coherence** | % of parent→child connections where both share the same theme | > 70% |
| **Same-tier connections** | % of connections where parent.tier === child.tier (lateral) | < 35% |
| **Backward connections** | Connections where parent.tier > child.tier (regression) | 0 |
| **Tier jumps > 2** | Connections spanning more than 2 tier levels | < 5 per school |
| **Placement rate** | % of nodes that receive x,y positions | 100% |

### How to Run an Assessment

The `spell_tree.json` file (in `MO2/overwrite/SKSE/Plugins/SpellLearning/`) is the final output after layout. Each school has a `nodes` array where each node has `formId`, `children`, `prerequisites`, `tier`, `theme`, `x`, `y`.

For each school, iterate all nodes and:

1. **Fan-out**: Count `node.children.length` for each node, track max
2. **Orphans**: Count nodes where `children.length === 0 && prerequisites.length === 0`
3. **Theme coherence**: For each parent→child edge, check if `parent.theme === child.theme`
4. **Same-tier**: For each edge, check if `parent.tier === child.tier`
5. **Backward**: For each edge, check if `parent.tier > child.tier`
6. **Tier jumps**: For each edge, check if `|parent.tier - child.tier| > 2`
7. **Placement**: Count nodes with valid `x` and `y` coordinates

### Baseline Results

#### Classic Mode (with all JS fixes applied)

| School | Nodes | Max Fan-Out | Coherence | Same-Tier | Backward | Jumps>2 |
|--------|------:|:-----------:|:---------:|:---------:|:--------:|:-------:|
| Conjuration | 156 | 5 | 75.5% | 31.0% | 2 | 2 |
| Destruction | 228 | 5 | 74.4% | 35.7% | 0 | 19 |
| Alteration | 107 | 5 | 72.6% | 32.1% | 0 | 2 |
| Illusion | 98 | 4 | 74.2% | 36.1% | 2 | 0 |
| Restoration | 132 | 5 | 70.2% | 30.5% | 0 | 4 |
| **Overall** | **721** | **5** | **73.6%** | **33.2%** | **6** | **27** |

Destruction has the most tier jumps (19) due to its large size and Python builder connecting spells across wide tier gaps.

#### Tree Mode

| School | Nodes | Max Fan-Out | Coherence | Same-Tier | Backward | Jumps>2 |
|--------|------:|:-----------:|:---------:|:---------:|:--------:|:-------:|
| Conjuration | 156 | 4 | 78.7% | 0% | 0 | 0 |
| Destruction | 228 | 4 | 78.0% | 0% | 0 | 0 |
| Alteration | 107 | 4 | 74.5% | 0% | 0 | 0 |
| Illusion | 98 | 4 | 75.3% | 0% | 0 | 0 |
| Restoration | 132 | 4 | 80.2% | 0% | 0 | 0 |
| **Overall** | **721** | **4** | **77.7%** | **0%** | **0** | **0** |

Tree mode produces structurally perfect trees: every edge is +1 tier, no same-tier or backward connections, max 4 children. Soft prerequisites add cross-branch DAG connectivity (pick 1 of N) without breaking tree structure.

## Solutions

### 1. Tree Sanitization (`classicLayout.js :: _sanitizeTree`)

Runs at the start of `_layoutOnGrid()`, after smart theme override and before BFS placement. Modifies `nodeLookup` children arrays in place.

**Phase A — Rescue Orphans**

Orphans are nodes in the tree data that have 0 children and 0 prerequisites — completely unreachable from the school root via BFS. They'd never get placed without intervention.

```
BFS from root → build reachable set
For each unreachable node (sorted by tier ascending):
    Score all reachable nodes as candidate parents:
        +50  same theme match
        -5   per tier gap
        -20  if candidate tier > orphan tier (wrong direction)
        -3   per existing child (load balance)
        -100 if already at fan-out cap
    Attach to best-scoring parent
    Mark as reachable (available for subsequent orphans)
```

Sorting orphans by tier ascending ensures lower-tier orphans are placed first and become available as parents for higher-tier orphans.

**Phase B — Cap Fan-Out (iterative)**

The Python builder can create nodes with 10-16 children due to its `_ensure_all_reachable()` bypassing the max_children cap. The JS sanitization caps every node to 5 children.

```
MAX_CHILDREN = 5
Repeat (up to 10 iterations):
    Find all nodes with > MAX_CHILDREN children
    For each over-capacity node:
        Group children by theme
        Elect a "leader" per theme group (lowest tier, fewest children)
        Leader stays as direct child; siblings reparent under leader
        If still > 5 group leaders:
            Merge smallest groups under most compatible remaining leader
        Apply: set parentNode.children = leaders only
               push reparented children to leader.children
```

Convergence: each iteration reduces fan-out by at least 1 per over-capacity node. Worst case (16→5) resolves in ~3 iterations.

### 2. Fan-Out Cap Enforcement Across Layout Phases

The sanitization caps children arrays in the pre-layout tree walk, but the BFS layout has 4 phases where nodes can be assigned new parents:

| Phase | Purpose | How parent is chosen |
|-------|---------|---------------------|
| Phase 1 | Seed roots | `parentFormId = null` (roots) |
| Phase 2 | BFS from seeds | `parentFormId = cur.formId` (BFS parent) |
| Phase 3 | Deferred nodes | Scored: +200 original parent, +150 same theme, +50 tier zone |
| Phase 4 | Force-place remaining | Scored: +200 prereq parent, +100 same theme |

Phases 3 and 4 can bypass the sanitization because deferred/unplaced nodes get re-scored against ALL placed nodes. A node reparented from Wind Current to a leader during sanitization might still get placed back under Wind Current in Phase 3 if the leader has no open grid slots.

**Fix**: `parentChildCount` tracking across all phases.

```
After Phase 2: count children per parent from positioned nodes
Phase 3 scoring: -500 penalty for parents at fan-out cap
Phase 3 placement: increment parentChildCount[parentFormId]
Phase 4 scoring: -500 penalty for parents at fan-out cap
Phase 4 placement: increment parentChildCount[parentFormId]
```

The `-500` penalty overwhelms the `+200 original parent + +150 theme` bonuses, forcing nodes to find alternative parents when their preferred parent is full.

### 3. Theme-Aware Layout (Spell Matching Modes)

Three spell matching modes control how themes influence node placement:

**Simple** — No theme awareness. Nodes placed purely by grid adjacency, tier zones, and growth direction. Original behavior.

**Layered** — Uses Python builder's theme assignments. Angular sectors are computed per theme, and placement scoring favors nodes landing in their theme's sector. Theme affinity scoring in Phases 3-4 adds +150/-30 for same/different theme.

**Smart** — Dynamic JS-side theme discovery via `classicThemeEngine.js`. Ignores Python themes entirely. Tokenizes spell names, effect names, and keywords to discover natural theme groups. Merges duplicates (cold/frost → frost), splits overly dominant themes (>40% of school). Then feeds cleaned themes into the Layered layout algorithm.

#### ClassicThemeEngine Algorithm

```
1. Tokenize: spell name + effectNames + keywords (strip "Magic" prefix)
   Lowercase, split on non-alpha, filter length ≥ 3, remove stop words
2. Extract keywords: document frequency scoring
   Filter: >60% too common, <2 too rare
   Score = count × (1 - count/total) — peaks at moderate frequency
   Take top 12 keywords
3. Assign: each spell → best-matching keyword (by score rank)
   Fallback: substring matching
   Default: '_misc' if no match
4. Merge: near-duplicate themes
   Substring: "heal" in "healing" → merge to "heal"
   Overlap: >70% of smaller theme's spells contain larger's keyword → merge
5. Split: themes with >40% of total spells
   Find secondary keyword among those spells
   Spells containing secondary keyword → new theme
6. Fix roots: set root theme to dominant child theme
```

### 4. Theme Sector Partitioning (`_computeThemeSectors`)

Each theme gets a proportional angular sub-sector within the school's growth direction. During `_findSlots()`, candidates are scored by angular proximity to their theme's sector center:

```
score += 2.5 - angleDiff × (3.5 / PI)
```

This ranges from +2.5 (perfectly aligned) to -1.0 (opposite direction), creating soft spatial clustering by theme.

## Known Limitations

### In the Python Builder (upstream)
- **Tier jumps**: Destruction has 19 connections spanning >2 tiers. The JS sanitization doesn't fix these — they're structural to the Python builder's connection logic.
- **Backward connections**: 6 total across 3 schools (all single-tier regressions). Minor but worth monitoring.
- **Same-tier connections**: ~33% of classic mode edges are lateral. This is inherent to the Python builder allowing same-tier links.

### In the JS Layout
- **Grid congestion**: When a school has more nodes than grid points, the layout densifies the grid by adding midpoints. Extreme densification can reduce visual clarity.
- **Theme coherence ceiling**: Smart mode achieves ~74-78% coherence. The remaining 22-26% are cross-theme connections that exist in the Python tree structure. The layout can cluster same-theme nodes spatially but cannot change the tree's edge structure.

## File Reference

| File | Role |
|------|------|
| `modules/classic/classicLayout.js` | Grid layout algorithm, sanitization, fan-out enforcement |
| `modules/classic/classicThemeEngine.js` | JS-side dynamic theme discovery (Smart mode) |
| `modules/classic/classicSettings.js` | UI: Simple / Layered / Smart toggle |
| `modules/classic/classicMain.js` | Orchestrator: settings, layout invocation, tree save |
| `MO2/overwrite/.../spell_tree.json` | Final output: positioned tree with layout-derived edges |
