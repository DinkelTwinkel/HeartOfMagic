# Tree Layout Design: Zone Reservation vs Round-Robin Growth

## Problem Statement

Current issues with tree layout:
1. **Line crossings** - Branches overlap visually when connections cross each other
2. **Uneven spacing** - First root/branch takes all nearby positions, later ones get pushed far away
3. **Orphans** - Strict maxChildrenPerNode causes nodes to become disconnected when no valid parent has room
4. **Star patterns** - Without child limits, roots become hubs with 20+ direct children

## Current System Analysis

**How it works now:**
```
1. Generate grid of positions (tier rings × arc slots)
2. BFS from root, assigning children to nearest available position
3. Score positions by: angle proximity + tier preference + sibling distance
4. Mark used positions + adjacent slots (skip factor)
```

**Problems:**
- First-come-first-served: whoever is processed first gets best positions
- No awareness of branch structure - positions chosen locally, not globally
- Branches can interleave, causing line crossings

---

## Option A: Zone Reservation System

### Concept
Before placing any nodes, **pre-allocate angular zones** to each branch based on its expected size (keyword spell count).

### Algorithm
```
1. Count spells per element/keyword
2. Divide school's angular range proportionally:
   - fire: 50 spells → 30% of sector
   - frost: 30 spells → 18% of sector
   - shock: 40 spells → 24% of sector
   - etc.
3. Each element root "owns" its zone
4. Children of that root can ONLY use positions within the zone
5. When branching, subdivide the zone among sub-branches
```

### Visual Result
```
        SCHOOL SECTOR (72°)
    ┌─────────────────────────┐
    │  FIRE    FROST   SHOCK  │
    │  (22°)   (13°)   (17°)  │
    │   ╱╲      ╱╲      ╱╲    │
    │  ╱  ╲    ╱  ╲    ╱  ╲   │
    │ ╱    ╲  ╱    ╲  ╱    ╲  │
    └─────────────────────────┘
    No crossing between elements
```

### Pros
- **Zero inter-element crossings** - Branches stay in their zone
- **Predictable layout** - Same spell list = same visual structure
- **Scales with content** - More spells = bigger zone
- **Works with strict element isolation** - Natural fit

### Cons
- **Wasted space** - Small elements get zones they can't fill
- **Uneven density** - Fire zone cramped, frost zone sparse
- **Rigid** - Can't adapt to actual tree shape (deep vs wide)
- **Complex subdivision** - How to handle sub-branches within element?
- **Keyword overlap** - What if spell has multiple keywords?

### Implementation Complexity: **HIGH**
- Need keyword counting before layout
- Zone subdivision algorithm
- Handle zone exhaustion (when zone runs out of positions)

---

## Option B: Round-Robin Head Growth

### Concept
Grow the tree naturally, but **each active "head" takes turns** placing ONE child before the next head goes. This ensures fair spatial distribution.

### Algorithm
```
1. Start with root as only head in queue
2. Each iteration:
   a. Pop head from queue
   b. Place ONE of its children in nearest valid position
   c. If child has children, add it to queue as new head
   d. Put current head back in queue (if it has more children)
3. If no valid adjacent position exists:
   → Interpolate between grid points (create new position)
```

### Visual Result
```
Round 1: Root places child A (fire)
Round 2: Root places child B (frost)
Round 3: Root places child C (shock)
Round 4: A places child A1
Round 5: B places child B1
Round 6: C places child C1
Round 7: A places child A2
...
```

Each branch gets equal "opportunity" to claim nearby space.

### Pros
- **Natural growth** - Looks organic, not geometric
- **Self-balancing** - Deep branches don't starve wide branches
- **Simple concept** - No pre-counting, just grow
- **Handles any structure** - Works with varied branching patterns
- **No wasted space** - Positions used as needed
- **Interpolation fallback** - Never orphans due to position exhaustion

### Cons
- **Some line crossings** - Branches can still interleave slightly
- **Non-deterministic feel** - Different processing order = different layout
- **Interpolated positions** - Off-grid nodes might look inconsistent

### Implementation Complexity: **MEDIUM**
- Modify BFS to round-robin heads
- Add position interpolation when grid exhausted
- Track "heads" queue with remaining children count

---

## Hybrid Approach (Recommended)

Combine benefits of both:

### Phase 1: Zone Guidance (soft)
```
1. Count spells per element
2. Assign each element a "preferred angular range" (not hard boundary)
3. When scoring positions, add bonus for being in preferred range
```

### Phase 2: Round-Robin Growth
```
1. Process heads in round-robin order
2. Score positions with zone preference bonus
3. If no valid position in range, allow overflow to adjacent zones
4. If no grid position at all, interpolate
```

### Visual Result
Elements tend to cluster together but can overflow if needed. Natural growth with soft boundaries.

---

## Implementation Plan

### Step 1: Round-Robin BFS (core change)
```javascript
// Current: process all children of one parent, then next parent
queue = [root]
while (queue.length) {
    parent = queue.shift()
    parent.children.forEach(child => {
        placeChild(child)
        queue.push(child)
    })
}

// New: each parent places ONE child per turn
heads = [{ node: root, childIndex: 0 }]
while (heads.length) {
    head = heads.shift()
    if (head.childIndex < head.node.children.length) {
        child = head.node.children[head.childIndex]
        placeChild(child)
        heads.push({ node: child, childIndex: 0 })  // New head
        head.childIndex++
        if (head.childIndex < head.node.children.length) {
            heads.push(head)  // Re-queue if more children
        }
    }
}
```

### Step 2: Position Interpolation
```javascript
function findOrCreatePosition(targetAngle, targetTier, usedPositions) {
    // Try grid positions first
    var gridPos = findNearestGridPosition(targetAngle, targetTier, usedPositions)
    if (gridPos) return gridPos

    // Interpolate between grid points
    return {
        x: Math.cos(targetAngle * DEG2RAD) * (baseRadius + targetTier * tierSpacing),
        y: Math.sin(targetAngle * DEG2RAD) * (baseRadius + targetTier * tierSpacing),
        tier: targetTier,
        angle: targetAngle,
        isInterpolated: true
    }
}
```

### Step 3: Soft Zone Preference (optional enhancement)
```javascript
function scorePosition(pos, targetAngle, elementZone) {
    var angleDiff = Math.abs(pos.angle - targetAngle)
    var tierDiff = Math.abs(pos.tier - targetTier)

    // Bonus for staying in element's preferred zone
    var inZone = pos.angle >= elementZone.start && pos.angle <= elementZone.end
    var zoneBonus = inZone ? 20 : 0

    return angleDiff * 2 + tierDiff * 40 - zoneBonus
}
```

---

## Recommendation

**Start with Option B (Round-Robin)** because:
1. Simpler to implement
2. Solves the core "first branch takes all space" problem
3. Interpolation prevents orphans
4. Can add zone preference later as enhancement

**Add soft zone preference** after round-robin is working, if element clustering isn't strong enough.

---

## Testing Criteria

After implementation, verify:
1. [ ] Each element root gets fair angular spread
2. [ ] No orphans (all nodes placed)
3. [ ] Reduced line crossings vs current system
4. [ ] Deep branches don't starve siblings
5. [ ] Works with strict element isolation + maxChildrenPerNode=3
