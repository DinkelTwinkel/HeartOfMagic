# Shape and Growth System — Assessment and Improvement Plan (v2)

**Context:** Improve placement (backlog + branch-adjacent deferred placement) and add more aggressive, spell-count–scaled shapes (tree = thin pillar + mass at top; mountain = jagged top, overflow as "stars").

**Revision note (v2):** Comprehensive audit against codebase uncovered a broken behavior map in `layoutEngine.js`, significant dead code in `growthBehaviors.js`, and math/threshold issues that would defeat aggressive masks for large schools. This revision corrects those findings and revises the plan accordingly.

---

## 1. Current System Summary

### 1.1 Where Shapes and Growth Live

| Layer | Location | Role |
|-------|----------|------|
| **JS structure** | `settingsAwareTreeBuilder.js` | Builds parent-child links for "Build Complex"; calls `LayoutEngine.applyPositionsToTree()` at end |
| **JS layout** | `layoutEngine.js` | Fixed grid generation, shape mask filtering, BFS placement, spacing skip, overlap resolution, orphan handling |
| **JS shapes** | `shapeProfiles.js` | `SHAPE_PROFILES` (organic, spiky, radial, mountain, cloud, cascade, linear, grid), `SHAPE_MASKS` (per-shape probability), jitter, taper |
| **JS growth** | `growthBehaviors.js` | `GROWTH_BEHAVIORS` (10 behaviors), `SCHOOL_DEFAULT_BEHAVIORS` mapping, utility functions (branching, hubs, pools, cross-connections) |
| **JS alt-path** | `visualFirstBuilder.js` | Alternative BFS builder with its own placement loop; exercises more behavior functions than primary path |
| **Python** | `SpellTreeBuilder/shapes/*.py` | Parent selection and tree *structure* (mountain, organic, radial, etc.); **not** used for positions — positions are JS-only |
| **Python growth** | `SpellTreeBuilder/growth/*.py` | `branching_energy.py`, `themed_groups.py`, `auto_configure.py`; affect Python-side structure only |

**Pipeline summary for "Build Complex":**
1. `settingsAwareTreeBuilder.js` builds the tree structure (nodes with `children`/`prerequisites`, x=0/y=0)
2. `LayoutEngine.applyPositionsToTree()` assigns x,y coordinates using fixed grid + shape mask + BFS
3. Python participates only in the NLP/config phase (fuzzy data, theme discovery); it does **not** set positions

### 1.2 Grid and Placement Flow (layoutEngine.js)

1. **Fixed grid:** `getFixedGridPositions(schoolIndex, totalSchools)` builds a deterministic grid:
   - `maxTiers` = 25, `baseRadius` = 90, `tierSpacing` = 52, `arcSpacing` = 56.
   - For each tier 0..24: `radius = 90 + tier × 52`, `arcLength = (sliceAngle/360) × 2π × radius`, `slots = max(3, floor(arcLength / 56))`.
   - For a 5-school setup: ~360 positions per school (~1,800 total). Tier 0 has 3 slots, tier 24 has ~30 slots.
   - **Grid does not scale with spell count**; same grid for 10 or 229 spells.

2. **Shape mask:** `validPositions = allGridPositions.filter(shapeMask(depthNorm, angleNorm, rng))`.
   - **Fallback threshold:** If `validPositions.length < totalSpells * 0.5`, the mask is **abandoned entirely** and `validPositions = allGridPositions`. This is critical — aggressive masks that reject >50% of positions for large schools get silently ignored.

3. **Spacing skip:** Based on `gridCapacity / totalSpells`, up to 2 adjacent slots are reserved around each placed node. Denser schools have less skip.

4. **Placement — Level-based round-robin BFS:**
   - Root placed at tier 0 center.
   - For each child: target tier from behavior (`verticalBias`, `layerFillThreshold`); available = positions in tier band `[childTier, childTier+2]` not used.
   - Score by angle distance to parent + tier distance + random bonus; pick among top 3.
   - **Fallback 1:** If no position in band, score **all remaining `validPositions`** (still mask-filtered if mask wasn't abandoned) and pick best.
   - **Fallback 2:** If zero `validPositions` remain, **interpolate** a new position at `(childTier, targetAngle)` — creates a position between grid points.
   - **No backlog:** Every node is placed immediately (preferred → all-available → interpolated).

5. **Orphans:** After BFS, unplaced nodes get assigned to remaining valid positions; if exhausted, to any grid position; if that's exhausted, `x=0, y=0, _overflow=true`.

6. **Overlap resolution:** 5 iterations of pairwise push-apart (`resolveOverlaps`) using `minNodeSpacing`.

### 1.3 Shape Masks (shapeProfiles.js)

| Shape | Behavior | Pass rate (est.) |
|-------|----------|-----------------|
| organic | Center bias + depth fade | ~25-35% |
| spiky | 3 narrow rays | ~10-15% |
| radial | Ring bands | ~30% |
| mountain | Triangle (wide base → narrow peak) | ~25-30% |
| cloud | 4 clusters with gaps | ~15-20% |
| cascade | Staggered columns | ~20-25% |
| linear | Narrow center beam | ~40-45% |
| grid | Always accept | 100% |

No mask takes `spellCount` as input. No "tree" shape exists. Mountain is smooth triangle — no jaggedness, no "stars" overflow band.

### 1.4 Growth Behaviors (growthBehaviors.js)

**10 behaviors defined:** `fire_explosion`, `gentle_bloom`, `mountain_builder`, `portal_network`, `spider_web`, `ocean_wave`, `ancient_tree`, `crystal_growth`, `vine_crawl`, `nebula_burst`.

**Correct school defaults** (in `SCHOOL_DEFAULT_BEHAVIORS`):

| School | Behavior |
|--------|----------|
| Destruction | `fire_explosion` |
| Restoration | `gentle_bloom` |
| Alteration | `mountain_builder` |
| Conjuration | `portal_network` |
| Illusion | `spider_web` |

**8 exported utility functions:**
`getActiveParameters`, `calculatePreferredDirection`, `calculateBranchCount`, `shouldBeHub`, `shouldBranch`, `subdivideSpellPool`, `shouldCreateTerminalCluster`, `getCrossConnections`

---

## 2. Known Bugs and Gaps

### 2.1 BUG: Behavior Map Mismatch in layoutEngine.js (Critical)

`layoutEngine.js` lines 638-644 hardcode a **stale** behavior map instead of using `SCHOOL_DEFAULT_BEHAVIORS`:

```
layoutEngine behaviorMap:          growthBehaviors SCHOOL_DEFAULT_BEHAVIORS:
  Destruction → fire_explosion       Destruction → fire_explosion         ✓ match
  Restoration → gentle_bloom         Restoration → gentle_bloom           ✓ match
  Conjuration → shadow_tendrils      Conjuration → portal_network         ✗ WRONG
  Alteration  → crystal_lattice      Alteration  → mountain_builder       ✗ WRONG
  Illusion    → ethereal_drift       Illusion    → spider_web             ✗ WRONG
```

`shadow_tendrils`, `crystal_lattice`, `ethereal_drift` **do not exist**. The fallback `organic_growth` **also does not exist**. Result: `behavior = undefined` for 3/5 schools, falling through to flat defaults (`verticalBias=0, layerFillThreshold=0.3, spreadFactor=0.6, angularWander=15`).

**Impact:** 60% of schools get generic BFS placement. The `portal_network` (Conjuration: high outward growth, wide spread, hub-heavy), `mountain_builder` (Alteration: compact, fills layers first), and `spider_web` (Illusion: web pattern, balanced spread) behaviors are completely wasted during position assignment.

**Fix:** Replace the hardcoded map with `SCHOOL_DEFAULT_BEHAVIORS`:
```javascript
var behaviorName = (typeof SCHOOL_DEFAULT_BEHAVIORS !== 'undefined')
    ? SCHOOL_DEFAULT_BEHAVIORS[schoolName]
    : null;
var behavior = behaviorName && GROWTH_BEHAVIORS[behaviorName]
    ? GROWTH_BEHAVIORS[behaviorName]
    : GROWTH_BEHAVIORS['gentle_bloom'];  // safe fallback that exists
```

### 2.2 BUG: Dead Code — Growth Behavior Functions Never Called

| Function | Status |
|----------|--------|
| `shouldBranch()` | **Dead** — never called by any builder |
| `subdivideSpellPool()` | **Dead** — never called by any builder |
| `calculateBranchCount()` | **Dead** — never called by any builder |
| `shouldCreateTerminalCluster()` | **Dead** — disabled in visualFirstBuilder ("causes bunching outside grid") |
| `getActiveParameters()` | Called by **visualFirstBuilder** only; NOT called by settingsAwareTreeBuilder (phases don't run in primary path) |
| `calculatePreferredDirection()` | Called by **visualFirstBuilder** only |
| `shouldBeHub()` | Called by **visualFirstBuilder** only; settingsAwareTreeBuilder has inline hub logic |
| `getCrossConnections()` | Called by **visualFirstBuilder** only; settingsAwareTreeBuilder uses convergence instead |

**Impact:** The primary "Build Complex" path (`settingsAwareTreeBuilder` → `LayoutEngine`) only uses raw behavior properties (`verticalBias`, `layerFillThreshold`, `spreadFactor`, `angularWander`, `branchingFactor`, `hubProbability`, `hubMinSpacing`, `crossConnectionDensity`). The rich function library — branching energy, pool subdivision, terminal clusters, cross-connections — is unused. Phase-based parameter changes (e.g. "at 40% progress, switch to wider spread") do not run.

**Decision needed:** Wire these up, or remove them as dead code?

### 2.3 BUG: Phases Not Exercised in Primary Path

`settingsAwareTreeBuilder.js` defines `_getBehaviorParams(behavior, progress)` which calls `getActiveParameters()`, but this function is **never called**. All behavior reads use raw `behavior.X` properties, meaning phase transitions (e.g. Destruction's "start wide then go vertical at 40%") don't apply during the primary build.

The `visualFirstBuilder.js` path does exercise phases correctly.

### 2.4 GAP: No Backlog / Branch-Adjacent Deferred Placement

**Requested:** When no ideal spot can be found, don't place at "nearest valid spot" immediately. Instead:
- Put the spell in a **backlog**.
- Let the rest of the branch heads keep growing.
- Later, place the backlog spell at the **next available slot adjacent to one of its root-branch members**, choosing the **most related** member.

**Current:** No backlog. We always place immediately (preferred band → all available → interpolate). We never "wait and place next to a related node that gets a free slot later."

**Nuance the old plan missed:** The backlog shouldn't trigger only when the grid is fully exhausted (that's rare because interpolation creates infinite positions). It should trigger when the best available position is **too far from the parent** — i.e., the node would visually jump to a distant part of the tree, breaking locality.

### 2.5 GAP: Aggressive Shapes Defeated by Mask Fallback Threshold

**Requested:** Spell-count-aware shapes (tree pillar, jagged mountain, stars overflow).

**Problem:** The mask fallback threshold at line 697-699:
```javascript
if (validPositions.length < totalSpells * 0.5) {
    validPositions = allGridPositions;  // mask abandoned
}
```

For large schools, aggressive masks get silently abandoned:

| School | Spells | Grid positions | Mountain mask (~25%) | Tree mask (~15%) | Threshold (50%) |
|--------|--------|---------------|---------------------|-----------------|----------------|
| Destruction | 229 | ~360 | ~90 positions → **abandoned** | ~54 → **abandoned** | 114.5 |
| Conjuration | 169 | ~360 | ~90 positions → keep | ~54 → **abandoned** | 84.5 |
| Alteration | 115 | ~360 | ~90 positions → keep | ~54 → keep | 57.5 |
| Restoration | 137 | ~360 | ~90 positions → keep | ~54 → **abandoned** | 68.5 |
| Illusion | 103 | ~360 | ~90 positions → keep | ~54 → keep | 51.5 |

The tree shape would be abandoned for 3/5 schools. The plan **must** address this threshold or increase grid capacity.

### 2.6 GAP: No "Tree" Shape

No `tree` entry in `SHAPE_PROFILES` or `SHAPE_MASKS`. The requested behavior (thin pillar of valid points, big mass at top) has no implementation.

### 2.7 GAP: Mountain Has No Jaggedness or Overflow

Current mountain mask is a smooth triangle (`width = 1 - depth * 0.9`). No angle-dependent noise at the top edge. No sparse "stars" band above the peak for overflow spells.

---

## 3. Recommended Improvements

### 3.0 PREREQUISITE: Fix Broken Foundations

**Before any shape/backlog work, fix these:**

**3.0.1 Fix behavior map** — Replace the hardcoded `behaviorMap` in `layoutEngine.js` with `SCHOOL_DEFAULT_BEHAVIORS` from `growthBehaviors.js`. This alone will transform placement quality for Conjuration, Alteration, and Illusion.

**3.0.2 Enable phases in settingsAwareTreeBuilder** — Wire up `_getBehaviorParams()` so that phase transitions apply during tree construction. Currently the function exists but is never called.

**3.0.3 Decide on dead code** — Either:
- **Wire up** `shouldBranch`, `subdivideSpellPool`, etc. into the primary path (significant work, but the functions are well-designed), or
- **Remove** them to reduce maintenance burden and confusion.
- Recommended: **defer** — keep them for future use, add `@unused` JSDoc tags, and focus on the shape/backlog features first.

### 3.1 Backlog-Based Placement (layoutEngine.js)

**Key change from v1:** Trigger the backlog based on **distance** rather than only on grid exhaustion.

**During BFS:** After scoring all available positions for a child:
- If the best available position is within `maxPlacementDistance` (e.g. 3 tiers from parent), place normally.
- If the best position is **farther than `maxPlacementDistance`** (the child would jump to a distant sector), push `{ node, parent, preferredTier, targetAngle, branchAncestors }` to a **placementBacklog** and skip this child. Continue BFS for other heads.

**After BFS — Process backlog:**
1. For each backlog entry, collect "branch members" (parent + ancestors + siblings already placed in the same branch).
2. For each branch member, find **adjacent-available** positions (same tier ±1, angle within `adjacencyAngle` = `sliceAngle / numBranchMembers`, scaled by tier — smaller angle at higher tiers).
3. Rank branch members by relatedness:
   - Same element → +30 score
   - Same Python theme group (if fuzzyData available) → +20 score
   - Tier proximity → +10 per tier closer
4. Place backlog node at the best adjacent slot to the highest-ranked member.
5. If no adjacent slot exists for any member, fall back to current "all available" scoring.
6. If still no positions, interpolate (existing behavior).

**Never** leave nodes at `(0,0)` if any position exists anywhere.

### 3.2 Fix Mask Fallback Threshold for Aggressive Shapes

The `< totalSpells * 0.5` threshold silently defeats aggressive masks. Two-part fix:

**3.2.1 Per-shape fallback override:**
Add an optional `minPassRatio` to shape profiles:
```javascript
mountain: { ..., minPassRatio: 0.35 },   // abandon mask if < 35% of spells covered
tree:     { ..., minPassRatio: 0.25 },   // tree is aggressive by design
grid:     { ..., minPassRatio: 0.0 }     // never abandon
```
Change the fallback check:
```javascript
var minRatio = shapeProfile.minPassRatio !== undefined ? shapeProfile.minPassRatio : 0.5;
if (validPositions.length < totalSpells * minRatio) { ... }
```

**3.2.2 Grid capacity boost for aggressive shapes:**
For shapes that intentionally reject most positions, increase `maxTiers` or add extra slots. In `applyPositionsToTree`, before calling `getFixedGridPositions`:
```javascript
var effectiveMaxTiers = cfg.maxTiers;
if (shapeProfile.extraTiers) {
    effectiveMaxTiers += shapeProfile.extraTiers;  // e.g. tree adds 5 tiers
}
```
This increases total grid capacity from ~360 to ~450+, giving aggressive masks more room.

### 3.3 New "Tree" Shape (shapeProfiles.js)

**Profile:**
```javascript
tree: {
    name: 'Ancient Tree',
    description: 'Thin trunk rising to a spreading canopy',
    radiusJitter: 0.15,
    angleJitter: 8,
    tierSpacingMult: 1.1,
    spreadMult: 0.3,         // Very narrow in trunk
    fillPieSlice: false,
    curveEdges: true,
    clusterNodes: false,
    densityMult: 0.9,
    innerDensityBoost: 0.8,
    outerDensityFade: 1.4,   // Denser at top
    minPassRatio: 0.25,      // Aggressive mask - low threshold
    extraTiers: 5            // Need more grid capacity
}
```

**Mask (spell-count-aware):**
```javascript
tree: function(depth, angleNorm, rng, profile, spellCount) {
    // Root zone (depth < 0.15): moderate pass
    if (depth < 0.15) return rng() < 0.45;

    // Trunk zone: thin pillar, very few pass
    // Scale trunk end depth with spell count: more spells → taller trunk
    var trunkEnd = 0.5 + 0.15 * Math.min(1, (spellCount || 50) / 150);
    if (depth < trunkEnd) {
        var centerDist = Math.abs(angleNorm - 0.5) * 2;
        return centerDist < 0.25 && rng() < 0.25;  // Narrow center only
    }

    // Canopy zone: wide, dense
    var canopyDensity = 0.6 + 0.15 * Math.min(1, (spellCount || 50) / 100);
    return rng() < canopyDensity;
}
```

Expected positions for 5-school/25-tier grid:
- Root (tiers 0-3): ~12 positions × 0.45 ≈ 5
- Trunk (tiers 4-15): ~150 positions × 0.06 (center-only + 25%) ≈ 9-15
- Canopy (tiers 16-24): ~200 positions × 0.65 ≈ 130
- **Total: ~145-150 valid positions** — sufficient for schools up to ~120 spells without fallback. With `extraTiers: 5`, canopy gains ~60 more positions → ~210 total.

For Destruction (229 spells): still triggers fallback unless `minPassRatio` is set to 0.25 (threshold = 57), and 210 > 57 → mask preserved.

### 3.4 Updated Mountain Shape (shapeProfiles.js)

**Profile changes:**
```javascript
mountain: {
    // ... existing properties ...
    minPassRatio: 0.3,       // Allow more aggressive filtering
    jaggedTop: true,         // Flag for jagged peak
    starsAbove: true         // Flag for overflow "stars" band
}
```

**Updated mask (spell-count-aware):**
```javascript
mountain: function(depth, angleNorm, rng, profile, spellCount) {
    var taperAmount = 0.1;
    var width = 1 - depth * (1 - taperAmount);
    var distFromCenter = Math.abs(angleNorm - 0.5) * 2;
    var inWidth = distFromCenter < width;

    // Stars band: sparse positions above the peak
    var peakDepth = 0.82 + 0.08 * Math.min(1, (spellCount || 50) / 120);
    if (depth > peakDepth) {
        return rng() < 0.08;  // Sparse "stars" - 8% pass
    }

    if (!inWidth) return false;

    // Jagged top edge: sinusoidal noise on the width at high depth
    if (depth > 0.6) {
        var jaggedness = 0.15 + 0.15 * Math.min(1, (spellCount || 50) / 80);
        var noise = Math.sin(angleNorm * 18 + depth * 7) * 0.5 + 0.5;
        var jaggedWidth = width * (1 - jaggedness + jaggedness * noise);
        if (distFromCenter > jaggedWidth) return false;
    }

    var densityBoost = Math.max(0.15, 1 - depth * 0.85);
    return rng() < densityBoost * 0.6;
}
```

### 3.5 LayoutEngine API Changes

**`applyPositionsToTree(treeData, options)` changes:**
1. Pass `totalSpells` into shape mask if mask signature accepts it (`shapeMask(depthNorm, angleNorm, rng, shapeProfile, totalSpells)`).
2. Use `shapeProfile.minPassRatio` for fallback threshold instead of hardcoded 0.5.
3. Support `shapeProfile.extraTiers` for grid capacity boost.
4. Implement backlog collection during BFS and backlog resolution after BFS (Section 3.1).

**`getFixedGridPositions` changes:**
- Accept optional `maxTiersOverride` parameter for shape-driven grid expansion.

---

## 4. Implementation Order

### Phase 0 — Fix Foundations (prerequisite, ~30 min)
1. Fix `layoutEngine.js` behaviorMap → use `SCHOOL_DEFAULT_BEHAVIORS`
2. Wire up `_getBehaviorParams()` in `settingsAwareTreeBuilder.js` so phases run
3. Verify all 5 schools now get their correct behavior during placement
4. Add `@unused` tags to dead growth behavior functions

### Phase 1 — Backlog Placement (~2-3 hours)
1. Add `maxPlacementDistance` parameter (configurable, default 3 tiers)
2. Implement backlog collection during BFS when best position is too far
3. Implement post-BFS backlog resolution with branch-member adjacency
4. Add "branchAncestors" tracking to BFS heads
5. Test with current shapes (no new shapes yet) — verify no regressions

### Phase 2 — Mask Threshold + Grid Capacity (~1 hour)
1. Add `minPassRatio` to shape profiles (default 0.5 for backward compat)
2. Change fallback check to use `minPassRatio`
3. Add `extraTiers` support to `getFixedGridPositions`
4. Wire `totalSpells` through to mask function calls

### Phase 3 — Mountain Update (~1 hour)
1. Update mountain mask with jagged top and stars band
2. Add `spellCount` parameter passthrough
3. Set `minPassRatio: 0.3` for mountain
4. Test with real spell counts (Alteration: 115 spells)

### Phase 4 — Tree Shape (~1-2 hours)
1. Add `tree` to `SHAPE_PROFILES` and `SHAPE_MASKS`
2. Implement spell-count-aware trunk/canopy mask
3. Set `minPassRatio: 0.25`, `extraTiers: 5`
4. Test with various school sizes
5. Optionally add `tree` to `SCHOOL_DEFAULT_SHAPES` or make it user-selectable

### Phase 5 — Polish and Integration (~1 hour)
1. Add tree/mountain to settings UI shape dropdown (if not already)
2. Verify interaction between backlog and new shapes
3. Stress test: Destruction (229 spells) with tree shape
4. Update this document with results

---

## 5. File Reference

| Component | File | Notes |
|-----------|------|-------|
| Grid generation | `layoutEngine.js` — `getFixedGridPositions` | Fixed 25 tiers; ~360 positions/school for 5-school setup |
| Placement BFS | `layoutEngine.js` — `applyPositionsToTree` | Fallback chain: tier band → all valid → interpolate; orphans at end |
| Spacing skip | `layoutEngine.js` — `markPositionUsed` | Reserves up to 2 adjacent slots based on density |
| Overlap resolution | `layoutEngine.js` — `resolveOverlaps` | 5 iterations of pairwise push-apart |
| Orphan handling | `layoutEngine.js` — "HANDLE ORPHANS" block | Remaining positions → all grid → 0,0 with `_overflow` flag |
| Shape profiles | `shapeProfiles.js` — `SHAPE_PROFILES`, `SHAPE_MASKS` | 8 shapes: organic, spiky, radial, mountain, cloud, cascade, linear, grid |
| Shape defaults | `shapeProfiles.js` — `SCHOOL_DEFAULT_SHAPES` | Destruction=spiky, Restoration=organic, Alteration=mountain, Conjuration=cloud, Illusion=organic |
| Growth behaviors | `growthBehaviors.js` — `GROWTH_BEHAVIORS` | 10 behaviors defined; 4/8 utility functions are dead code |
| Behavior defaults | `growthBehaviors.js` — `SCHOOL_DEFAULT_BEHAVIORS` | Correct mapping (not used by layoutEngine — **bug**) |
| Structure builder | `settingsAwareTreeBuilder.js` | Primary "Build Complex" path; builds links then calls LayoutEngine |
| Alt builder | `visualFirstBuilder.js` | Alternative path; uses more growth behavior functions |
| Edge scoring | `edgeScoring.js` | Centralized link quality scoring |
| Python shapes | `SpellTreeBuilder/shapes/*.py` | 9 shapes; affect parent selection only, not positions |
| Python growth | `SpellTreeBuilder/growth/*.py` | branching_energy, themed_groups, auto_configure; structure only |

---

## Appendix A: Growth Behavior Function Inventory

| Function | Defined in | settingsAwareTreeBuilder | visualFirstBuilder | layoutEngine |
|----------|-----------|-------------------------|-------------------|-------------|
| `getActiveParameters` | growthBehaviors.js | Defined but never called | **Called** (phases work) | Not called |
| `calculatePreferredDirection` | growthBehaviors.js | Not called | **Called** | Not called |
| `calculateBranchCount` | growthBehaviors.js | Not called | Not called | Not called |
| `shouldBeHub` | growthBehaviors.js | Not called (inline logic) | **Called** | Not called |
| `shouldBranch` | growthBehaviors.js | Not called | Not called | Not called |
| `subdivideSpellPool` | growthBehaviors.js | Not called | Not called | Not called |
| `shouldCreateTerminalCluster` | growthBehaviors.js | Not called | Disabled ("causes bunching") | Not called |
| `getCrossConnections` | growthBehaviors.js | Not called (uses convergence) | **Called** | Not called |

## Appendix B: Spell Counts vs Grid Capacity

Based on actual spell scan data:

| School | Spell count | Grid positions (~) | Mountain valid (~25%) | Tree valid (~15%) | Mask fallback at 50% | Mask fallback at 25% |
|--------|------------|--------------------|-----------------------|-------------------|---------------------|---------------------|
| Destruction | 229 | 360 | 90 → **abandoned** | 54 → **abandoned** | 114.5 | 57.3 |
| Conjuration | 169 | 360 | 90 → keep | 54 → **abandoned** | 84.5 | 42.3 |
| Restoration | 137 | 360 | 90 → keep | 54 → **abandoned** | 68.5 | 34.3 |
| Alteration | 115 | 360 | 90 → keep | 54 → keep | 57.5 | 28.8 |
| Illusion | 103 | 360 | 90 → keep | 54 → keep | 51.5 | 25.8 |

With `extraTiers: 5` for tree shape (~450 positions, ~68 tree-valid):
- Destruction (229): 68 > 57.3 (at 25% threshold) → **mask preserved**
- Conjuration (169): 68 > 42.3 → **mask preserved**
- Restoration (137): 68 > 34.3 → **mask preserved**

## Appendix C: Behavior Map Comparison

| School | `layoutEngine.js` hardcoded map | `SCHOOL_DEFAULT_BEHAVIORS` (correct) | Match? |
|--------|-------------------------------|-------------------------------------|--------|
| Destruction | `fire_explosion` | `fire_explosion` | Yes |
| Restoration | `gentle_bloom` | `gentle_bloom` | Yes |
| Conjuration | `shadow_tendrils` (DNE) | `portal_network` | **No** |
| Alteration | `crystal_lattice` (DNE) | `mountain_builder` | **No** |
| Illusion | `ethereal_drift` (DNE) | `spider_web` | **No** |

DNE = Does Not Exist in `GROWTH_BEHAVIORS`. Falls through to `organic_growth` (also DNE) → `undefined` → flat defaults.
