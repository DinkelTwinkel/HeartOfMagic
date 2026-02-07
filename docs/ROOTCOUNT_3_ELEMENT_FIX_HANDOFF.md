# Handoff: Fix rootCount=3 to Use Only Primary Elements

## Problem Statement

When `rootCount=3` is set in tree generation settings, the builder should create exactly **3 root nodes** for Destruction school using the three primary elemental keywords: **fire, frost, shock**.

**Current Behavior:** Creates one root per ANY detected element (19 roots for Destruction including water, telekinesis, ward, poison, summon, stealth, wind, etc.)

**Desired Behavior:** Creates exactly 3 roots for the primary elements (fire, frost, shock) and assigns all other spells to branch from these three roots based on element affinity.

## Root Cause

In `settingsAwareTreeBuilder.js`, when `rootCount > 1`, the code creates a root for EVERY unique element detected in tier-0 spells:

```javascript
// Line 447-469 in settingsAwareTreeBuilder.js
} else {
    // === MULTIPLE ROOTS MODE ===
    console.log('[SettingsAwareBuilder] Multiple roots mode: creating independent element roots');
    // Each distinct element at tier-0 becomes its own root  <-- BUG: No limit!
    var tier0Elements = {};
    tier0Nodes.forEach(function(node) {
        var elem = node.element || 'unknown';
        if (!tier0Elements[elem]) {
            tier0Elements[elem] = node;  // First tier-0 spell of this element becomes root
        }
    });

    var elementRoots = Object.values(tier0Elements);  // <-- Creates ALL elements as roots
    // ...marks each as isRoot = true
}
```

## Proposed Solution

### Option A: Hardcoded Primary Elements (Recommended - Simple)

Define the 3 primary elements and only create roots for those:

```javascript
// PRIMARY_ELEMENTS constant - the "strongest 3" element keywords
var PRIMARY_ELEMENTS = ['fire', 'frost', 'shock'];

// In multiple roots mode, only use primary elements
if (rootCount >= 3) {
    // Filter tier0Elements to only primary elements
    var primaryRoots = {};
    PRIMARY_ELEMENTS.forEach(function(elem) {
        if (tier0Elements[elem]) {
            primaryRoots[elem] = tier0Elements[elem];
        }
    });

    // Fall back to finding ANY spell with these elements if tier-0 doesn't have them
    PRIMARY_ELEMENTS.forEach(function(elem) {
        if (!primaryRoots[elem]) {
            var found = nodes.find(function(n) {
                return n.element === elem && n.tier <= 1;
            });
            if (found) primaryRoots[elem] = found;
        }
    });

    elementRoots = Object.values(primaryRoots);
}
```

### Option B: Use rootCount as Literal Limit

Limit to exactly `rootCount` roots, picking the most common elements:

```javascript
if (rootCount > 1 && elementRoots.length > rootCount) {
    // Count spells per element to find the "strongest" elements
    var elementCounts = {};
    nodes.forEach(function(n) {
        var elem = n.element || 'unknown';
        elementCounts[elem] = (elementCounts[elem] || 0) + 1;
    });

    // Sort elements by spell count (descending)
    var sortedElements = Object.keys(elementCounts).sort(function(a, b) {
        return elementCounts[b] - elementCounts[a];
    });

    // Keep only top N elements
    var topElements = sortedElements.slice(0, rootCount);
    elementRoots = elementRoots.filter(function(root) {
        return topElements.includes(root.element);
    });
}
```

## Files to Modify

| File | Purpose |
|------|---------|
| `modules/settingsAwareTreeBuilder.js` | Main fix - limit element roots |
| `modules/state.js` | (Optional) Add PRIMARY_ELEMENTS constant |

## Key Code Location

**File:** `D:\MODDING\Mod Development Zone 2\projects\HeartOfMagic\PrismaUI\views\SpellLearning\SpellLearningPanel\modules\settingsAwareTreeBuilder.js`

**Lines:** 447-490 (Multiple Roots Mode section)

## Current Test Configuration

The test system is already set up in `test_config.json`:

```json
{
  "enabled": true,
  "preset": "strict",
  "settingsOverrides": {
    "rootCount": 3
  },
  "useSettingsAwareBuilder": true,
  "autoGenerate": true,
  "saveResults": true,
  "llmEnabled": false
}
```

## Verification Steps

1. Deploy mod: `.\scripts\deploy.ps1 -ModPath "projects\HeartOfMagic"`
2. Launch Skyrim, open SpellLearning panel (F9)
3. AutoTest runs automatically
4. Check results with:

```bash
node -e "
const fs = require('fs');
const tree = JSON.parse(fs.readFileSync('D:/MODDING/Mod Development Zone 2/MO2/overwrite/SKSE/Plugins/SpellLearning/spell_tree.json', 'utf8'));
for (const [schoolName, school] of Object.entries(tree.schools)) {
    const roots = school.nodes.filter(n => n.isRoot);
    console.log(schoolName + ': ' + roots.length + ' root(s)');
    roots.forEach(r => console.log('  - ' + (r.name || r.formId) + ' [' + (r.element || 'none') + ']'));
}
"
```

**Expected Result for Destruction:**
```
Destruction: 3 root(s)
  - Flames [fire]
  - Frostbite [frost]
  - Sparks [shock]
```

## Element Assignment for Non-Primary Elements

Spells with non-primary elements (water, poison, wind, etc.) should be assigned to the closest primary element root based on:

1. **Keyword affinity** - e.g., "ice" maps to frost, "lightning" maps to shock
2. **Effect similarity** - damage types, delivery methods
3. **Fallback** - assign to fire if no clear affinity

Suggested element mapping:

```javascript
var ELEMENT_AFFINITY = {
    // Maps to fire
    'fire': 'fire', 'flame': 'fire', 'burn': 'fire', 'inferno': 'fire',

    // Maps to frost
    'frost': 'frost', 'ice': 'frost', 'cold': 'frost', 'freeze': 'frost', 'water': 'frost',

    // Maps to shock
    'shock': 'shock', 'lightning': 'shock', 'thunder': 'shock', 'spark': 'shock', 'electric': 'shock',

    // Ambiguous - default to fire (most common)
    'poison': 'fire',      // Damage over time like fire
    'wind': 'shock',       // Storm-related
    'arcane': 'shock',     // Magical energy
    'shadow': 'frost',     // Cold/dark
    // etc.
};
```

## Related Context

- The TreeParser orphan-fix bug is already fixed (roots no longer get erroneous prerequisites)
- The fix should work for all schools, though only Destruction has meaningful fire/frost/shock divisions
- Other schools may end up with fewer than 3 roots if they lack primary element spells

## Test Data Reference

Current broken output (19 roots for Destruction):
```
Destruction: 19 root(s)
  - Meridia's Light [elem=none]
  - Torch Fire [elem=fire]
  - Frostbite [elem=frost]
  - Vampiric Drain [elem=water]
  - Lightning Cloak Drain [elem=shock]
  - Eject Player Push [elem=telekinesis]
  ... (14 more)
```

Expected fixed output (3 roots):
```
Destruction: 3 root(s)
  - Flames [elem=fire]
  - Frostbite [elem=frost]
  - Sparks [elem=shock]
```
