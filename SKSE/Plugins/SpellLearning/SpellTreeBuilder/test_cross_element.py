#!/usr/bin/env python3
"""
Cross-Element Prerequisite Link Testing

Tests cross-element linking based on element affinities and spell combinations.
"""

import json
import re
import random
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional
from collections import defaultdict

# Paths
SCHOOLS_DIR = Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools')
OUTPUT_DIR = Path(__file__).parent / 'test_output'

# =============================================================================
# ELEMENT SYSTEM
# =============================================================================

ELEMENT_KEYWORDS = {
    'fire': ['fire', 'flame', 'burn', 'incinerate', 'inferno', 'blaze', 'scorch', 'heat', 'magma', 'lava', 'ember', 'dragon', 'pyre', 'bolide'],
    'frost': ['frost', 'ice', 'cold', 'freeze', 'blizzard', 'chill', 'glacial', 'hail', 'snow', 'frozen', 'cryo', 'icy', 'creeping'],
    'shock': ['shock', 'spark', 'lightning', 'thunder', 'electric', 'volt', 'arc', 'static', 'jolt', 'crackle', 'thunderbolt'],
    'earth': ['stone', 'rock', 'earth', 'boulder', 'crystal', 'quake', 'tremor', 'geo', 'terra', 'mineral', 'sand'],
    'water': ['water', 'wave', 'tide', 'aqua', 'spray', 'torrent', 'flood', 'rain', 'stream'],
    'wind': ['wind', 'gust', 'breeze', 'cyclone', 'tornado', 'tempest', 'gale', 'air', 'whirlwind', 'push', 'swirl', 'zephyr'],
    'dark': ['dark', 'shadow', 'death', 'drain', 'soul', 'necrotic', 'void', 'curse', 'strangle', 'choking', 'wither'],
    'holy': ['holy', 'divine', 'sacred', 'radiant', 'blessed', 'purify', 'bane', 'undead', 'sun', 'turn'],
    'arcane': ['arcane', 'magic', 'elemental', 'chaos', 'energy', 'force', 'unbounded'],
}

# Element affinities (0-100)
ELEMENT_AFFINITIES = {
    ('fire', 'earth'): 80,      # Magma, volcanic
    ('frost', 'water'): 85,     # Ice, cold water
    ('shock', 'wind'): 90,      # Storms, lightning
    ('dark', 'arcane'): 75,     # Void, shadow magic
    ('holy', 'arcane'): 75,     # Divine, pure magic
    ('fire', 'wind'): 60,       # Firestorm, spreading flames
    ('frost', 'wind'): 70,      # Blizzard
    ('water', 'wind'): 65,      # Hurricanes, rain
    ('earth', 'water'): 50,     # Mud, erosion
    ('shock', 'water'): 45,     # Electrified water
    ('fire', 'frost'): 35,      # Temperature mastery (opposites)
    ('dark', 'holy'): 30,       # Balance of light/dark (opposites)
    ('fire', 'water'): 25,      # Steam (rare)
    ('shock', 'earth'): 25,     # Geomagnetic (rare)
    ('earth', 'frost'): 40,     # Permafrost, avalanche
    ('fire', 'shock'): 55,      # Plasma, energy
}

# Spell name hints for cross-element combinations
COMBINATION_HINTS = {
    'storm': ['shock', 'wind', 'water'],
    'blizzard': ['frost', 'wind'],
    'tempest': ['shock', 'wind', 'water'],
    'volcanic': ['fire', 'earth'],
    'magma': ['fire', 'earth'],
    'lava': ['fire', 'earth'],
    'steam': ['fire', 'water'],
    'thunder': ['shock', 'wind'],
    'hurricane': ['wind', 'water'],
    'avalanche': ['frost', 'earth'],
    'cyclone': ['wind', 'water'],
    'maelstrom': ['water', 'wind'],
    'inferno': ['fire', 'wind'],
    'plasma': ['fire', 'shock'],
    'permafrost': ['frost', 'earth'],
}

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
TIER_TO_IDX = {t: i for i, t in enumerate(TIER_ORDER)}


def detect_element(name: str, editor_id: str = '') -> str:
    """Detect element from spell name."""
    text = f"{name} {editor_id}".lower()
    scores = {}
    for element, keywords in ELEMENT_KEYWORDS.items():
        score = sum(3 if re.search(rf'\b{re.escape(kw)}\b', text) else (1 if kw in text else 0)
                   for kw in keywords)
        scores[element] = score
    if not any(scores.values()):
        return 'arcane'
    return max(scores, key=scores.get)


def get_affinity(elem_a: str, elem_b: str) -> int:
    """Get affinity score between two elements."""
    if elem_a == elem_b:
        return 100
    if elem_a == 'arcane' or elem_b == 'arcane':
        return 60  # Arcane connects to everything moderately
    key = tuple(sorted([elem_a, elem_b]))
    return ELEMENT_AFFINITIES.get(key, 15)


def spell_suggests_combination(name: str, elements: List[str]) -> bool:
    """Check if spell name suggests it needs specific elements."""
    name_lower = name.lower()
    for keyword, required_elements in COMBINATION_HINTS.items():
        if keyword in name_lower:
            if any(elem in required_elements for elem in elements):
                return True
    return False


def get_suggested_elements(name: str) -> List[str]:
    """Get elements suggested by spell name."""
    name_lower = name.lower()
    suggested = set()
    for keyword, elements in COMBINATION_HINTS.items():
        if keyword in name_lower:
            suggested.update(elements)
    return list(suggested)


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class SpellNode:
    form_id: str
    name: str
    tier: str
    tier_idx: int
    element: str
    keywords: Set[str]
    children: List[str] = field(default_factory=list)
    prerequisites: List[str] = field(default_factory=list)
    cross_element_prereqs: List[str] = field(default_factory=list)
    depth: int = -1


@dataclass
class CrossElementLink:
    parent_id: str
    parent_name: str
    parent_element: str
    child_id: str
    child_name: str
    child_element: str
    affinity: int
    reason: str


# =============================================================================
# CROSS-ELEMENT LINK GENERATION
# =============================================================================

def generate_cross_element_links(
    nodes: Dict[str, SpellNode],
    settings: Dict
) -> List[CrossElementLink]:
    """Generate cross-element links based on settings."""

    links = []
    min_affinity = settings.get('min_affinity', 50)
    min_tier_idx = TIER_TO_IDX.get(settings.get('min_tier', 'Adept'), 2)
    chance = settings.get('chance', 0.3)
    mode = settings.get('mode', 'affinity')

    # Group nodes by element
    by_element: Dict[str, List[SpellNode]] = defaultdict(list)
    for node in nodes.values():
        by_element[node.element].append(node)

    # Sort each element group by tier
    for elem in by_element:
        by_element[elem].sort(key=lambda n: (n.tier_idx, n.name))

    for node in nodes.values():
        # Skip early tiers
        if node.tier_idx < min_tier_idx:
            continue

        # Check if spell name suggests cross-element
        suggested = get_suggested_elements(node.name)

        # Find potential cross-element parents
        for other_elem, other_nodes in by_element.items():
            if other_elem == node.element:
                continue

            affinity = get_affinity(node.element, other_elem)

            # Check if this element is suggested by spell name
            name_suggests = other_elem in suggested

            # Decide if we should create a link
            should_link = False
            reason = ""

            if mode == 'affinity' or mode == 'both':
                if affinity >= min_affinity:
                    # Higher tier = higher chance
                    tier_factor = node.tier_idx / 4
                    adjusted_chance = chance * tier_factor * (affinity / 100)

                    if name_suggests:
                        adjusted_chance += 0.4
                        reason = f"Spell name suggests {other_elem}"

                    if random.random() < adjusted_chance:
                        should_link = True
                        if not reason:
                            reason = f"High affinity ({affinity}%)"

            if mode == 'combination' or mode == 'both':
                if name_suggests and not should_link:
                    should_link = True
                    reason = f"Combination spell ({node.name} suggests {other_elem})"

            if should_link:
                # Find best parent from other element (lower tier, highest tier available)
                candidates = [n for n in other_nodes if n.tier_idx < node.tier_idx]
                if candidates:
                    # Pick highest tier candidate from the other element
                    parent = max(candidates, key=lambda n: n.tier_idx)

                    links.append(CrossElementLink(
                        parent_id=parent.form_id,
                        parent_name=parent.name,
                        parent_element=parent.element,
                        child_id=node.form_id,
                        child_name=node.name,
                        child_element=node.element,
                        affinity=affinity,
                        reason=reason,
                    ))

    return links


# =============================================================================
# TREE BUILDING WITH CROSS-ELEMENT
# =============================================================================

def build_tree_with_cross_element(
    spells: List[Dict],
    settings: Dict
) -> Tuple[Dict, List[CrossElementLink]]:
    """Build tree with cross-element linking."""

    # Create nodes
    nodes: Dict[str, SpellNode] = {}
    for s in spells:
        nodes[s['formId']] = SpellNode(
            form_id=s['formId'],
            name=s['name'],
            tier=s.get('skillLevel', 'Unknown'),
            tier_idx=TIER_TO_IDX.get(s.get('skillLevel', 'Unknown'), 5),
            element=detect_element(s['name'], s.get('editorId', '')),
            keywords=set(re.findall(r'\b\w{4,}\b', s['name'].lower())),
        )

    # Group by element
    by_element: Dict[str, List[SpellNode]] = defaultdict(list)
    for node in nodes.values():
        by_element[node.element].append(node)

    # Sort within elements by tier
    for elem in by_element:
        by_element[elem].sort(key=lambda n: (n.tier_idx, n.name))

    # Find roots (one per element with Novice spells, or lowest available)
    roots: Dict[str, SpellNode] = {}
    for elem, elem_nodes in by_element.items():
        if elem_nodes:
            roots[elem] = elem_nodes[0]  # Lowest tier becomes root
            elem_nodes[0].depth = 0

    # Build intra-element chains first
    connected: Set[str] = set(r.form_id for r in roots.values())

    for elem, elem_nodes in by_element.items():
        available_parents = [roots[elem]] if elem in roots else []

        for node in elem_nodes:
            if node.form_id in connected:
                continue

            # Find best parent within same element
            best_parent = None
            best_score = -999

            for parent in available_parents:
                if parent.tier_idx >= node.tier_idx:
                    continue
                if len(parent.children) >= 3:
                    continue

                score = 100  # Same element
                tier_diff = node.tier_idx - parent.tier_idx
                if tier_diff == 1:
                    score += 50
                elif tier_diff == 2:
                    score += 20

                # Keyword matching
                shared = node.keywords & parent.keywords
                score += len(shared) * 20

                if score > best_score:
                    best_score = score
                    best_parent = parent

            if best_parent:
                best_parent.children.append(node.form_id)
                node.prerequisites.append(best_parent.form_id)
                node.depth = best_parent.depth + 1
                connected.add(node.form_id)
                available_parents.append(node)

    # Generate cross-element links
    cross_links = generate_cross_element_links(nodes, settings.get('cross_element', {}))

    # Apply cross-element links
    for link in cross_links:
        child = nodes.get(link.child_id)
        parent = nodes.get(link.parent_id)
        if child and parent:
            if link.parent_id not in child.prerequisites:
                child.cross_element_prereqs.append(link.parent_id)
                if link.child_id not in parent.children:
                    parent.children.append(link.child_id)

    # Build output
    tree = {
        'roots': {elem: root.form_id for elem, root in roots.items()},
        'nodes': [{
            'formId': n.form_id,
            'name': n.name,
            'element': n.element,
            'tier': n.tier,
            'children': list(set(n.children)),
            'prerequisites': list(set(n.prerequisites)),
            'crossElementPrereqs': n.cross_element_prereqs,
        } for n in nodes.values()],
    }

    return tree, cross_links


# =============================================================================
# ANALYSIS
# =============================================================================

def analyze_cross_links(cross_links: List[CrossElementLink], school: str) -> Dict:
    """Analyze cross-element links."""

    analysis = {
        'total_cross_links': len(cross_links),
        'by_element_pair': defaultdict(list),
        'by_reason': defaultdict(list),
        'by_child_tier': defaultdict(int),
        'affinity_distribution': defaultdict(int),
    }

    for link in cross_links:
        pair = f"{link.parent_element} -> {link.child_element}"
        analysis['by_element_pair'][pair].append(f"{link.parent_name} -> {link.child_name}")

        # Categorize reason
        if 'name suggests' in link.reason.lower() or 'combination' in link.reason.lower():
            analysis['by_reason']['name_suggests'].append(link)
        else:
            analysis['by_reason']['affinity'].append(link)

        # Tier distribution
        child_tier = nodes_cache.get(link.child_id, {}).get('tier', 'Unknown')
        analysis['by_child_tier'][child_tier] += 1

        # Affinity ranges
        if link.affinity >= 80:
            analysis['affinity_distribution']['high (80+)'] += 1
        elif link.affinity >= 50:
            analysis['affinity_distribution']['medium (50-79)'] += 1
        else:
            analysis['affinity_distribution']['low (<50)'] += 1

    return analysis


nodes_cache = {}


def print_analysis(school: str, tree: Dict, cross_links: List[CrossElementLink], settings: Dict):
    """Print analysis of cross-element links."""

    print(f"\n{'='*70}")
    print(f"CROSS-ELEMENT ANALYSIS: {school.upper()}")
    print(f"Settings: min_affinity={settings.get('cross_element', {}).get('min_affinity', 50)}, "
          f"min_tier={settings.get('cross_element', {}).get('min_tier', 'Adept')}, "
          f"chance={settings.get('cross_element', {}).get('chance', 0.3)}")
    print(f"{'='*70}")

    # Basic stats
    print(f"\nTotal Spells: {len(tree['nodes'])}")
    print(f"Element Roots: {len(tree['roots'])}")
    print(f"Cross-Element Links: {len(cross_links)}")

    # Roots
    print(f"\n--- ROOTS (one per element) ---")
    for elem, root_id in sorted(tree['roots'].items()):
        root_node = next((n for n in tree['nodes'] if n['formId'] == root_id), None)
        if root_node:
            print(f"  {elem}: {root_node['name']} ({root_node['tier']})")

    # Cross-element links
    if cross_links:
        print(f"\n--- CROSS-ELEMENT LINKS ---")

        # Group by element pair
        by_pair = defaultdict(list)
        for link in cross_links:
            pair = f"{link.parent_element} -> {link.child_element}"
            by_pair[pair].append(link)

        for pair, links in sorted(by_pair.items(), key=lambda x: -len(x[1])):
            affinity = links[0].affinity
            print(f"\n  {pair} (affinity: {affinity}%): {len(links)} links")
            for link in links[:5]:  # Show first 5
                print(f"    - {link.parent_name} ({link.parent_element}) -> {link.child_name} ({link.child_element})")
                print(f"      Reason: {link.reason}")
            if len(links) > 5:
                print(f"    ... and {len(links) - 5} more")

    # Combination spells detected
    print(f"\n--- COMBINATION SPELLS DETECTED ---")
    combo_spells = []
    for node in tree['nodes']:
        suggested = get_suggested_elements(node['name'])
        if suggested:
            combo_spells.append((node['name'], node['element'], suggested))

    if combo_spells:
        for name, elem, suggested in combo_spells[:15]:
            print(f"  {name} ({elem}) - suggests: {', '.join(suggested)}")
        if len(combo_spells) > 15:
            print(f"  ... and {len(combo_spells) - 15} more")
    else:
        print("  None detected")


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 70)
    print("CROSS-ELEMENT PREREQUISITE LINK TESTING")
    print("=" * 70)

    # Test settings configurations
    SETTINGS_CONFIGS = {
        'conservative': {
            'cross_element': {
                'mode': 'combination',  # Only name-based
                'min_affinity': 70,
                'min_tier': 'Expert',
                'chance': 0.2,
            }
        },
        'balanced': {
            'cross_element': {
                'mode': 'both',
                'min_affinity': 50,
                'min_tier': 'Adept',
                'chance': 0.3,
            }
        },
        'aggressive': {
            'cross_element': {
                'mode': 'affinity',
                'min_affinity': 35,
                'min_tier': 'Apprentice',
                'chance': 0.5,
            }
        },
    }

    schools = ['Destruction', 'Conjuration', 'Restoration', 'Alteration', 'Illusion']

    all_results = {}

    for school in schools:
        # Load spell data
        spell_file = SCHOOLS_DIR / f"{school}_spells.json"
        if not spell_file.exists():
            print(f"WARNING: No spell data for {school}")
            continue

        with open(spell_file) as f:
            data = json.load(f)
        spells = data.get('spells', [])

        print(f"\n{'#'*70}")
        print(f"# SCHOOL: {school.upper()} ({len(spells)} spells)")
        print(f"{'#'*70}")

        school_results = {}

        for config_name, settings in SETTINGS_CONFIGS.items():
            # Set random seed for reproducibility
            random.seed(42)

            # Build tree
            tree, cross_links = build_tree_with_cross_element(spells, settings)

            # Cache nodes for analysis
            global nodes_cache
            nodes_cache = {n['formId']: n for n in tree['nodes']}

            print_analysis(school, tree, cross_links, settings)

            school_results[config_name] = {
                'tree': tree,
                'cross_links': len(cross_links),
                'roots': len(tree['roots']),
            }

            # Save tree
            OUTPUT_DIR.mkdir(exist_ok=True)
            output_file = OUTPUT_DIR / f"{school}_crosselement_{config_name}.json"
            with open(output_file, 'w') as f:
                json.dump({
                    'tree': tree,
                    'cross_links': [{
                        'parent': l.parent_name,
                        'parent_element': l.parent_element,
                        'child': l.child_name,
                        'child_element': l.child_element,
                        'affinity': l.affinity,
                        'reason': l.reason,
                    } for l in cross_links]
                }, f, indent=2)

        all_results[school] = school_results

    # Summary comparison
    print("\n" + "=" * 70)
    print("SUMMARY COMPARISON")
    print("=" * 70)

    print(f"\n{'School':<15} {'Config':<15} {'Roots':<8} {'Cross-Links':<12}")
    print("-" * 50)

    for school, configs in all_results.items():
        for config, data in configs.items():
            print(f"{school:<15} {config:<15} {data['roots']:<8} {data['cross_links']:<12}")

    print("\n" + "=" * 70)
    print("RECOMMENDATIONS")
    print("=" * 70)
    print("""
1. CONSERVATIVE mode: Best for purists who want clean element isolation
   - Only links spells whose NAMES suggest combinations (Storm, Blizzard, etc.)
   - Minimal cross-element links, very intentional

2. BALANCED mode: Recommended default
   - Combines name hints with affinity-based linking
   - Creates meaningful cross-element progression

3. AGGRESSIVE mode: For players who want interconnected trees
   - More cross-element links, creates web-like structure
   - May feel less "clean" but more realistic magic system
""")


if __name__ == '__main__':
    main()
