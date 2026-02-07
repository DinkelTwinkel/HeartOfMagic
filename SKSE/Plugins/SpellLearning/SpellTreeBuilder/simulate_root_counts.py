#!/usr/bin/env python3
"""
Simulate different root count strategies and compare quality metrics.

Tests:
1. Fixed counts: 1, 2, 3, 4, 5 roots
2. Current auto: min(themes, 5)
3. Smart heuristics: based on theme concentration + novice elements
"""

import json
from pathlib import Path
from collections import Counter, defaultdict
from typing import Dict, List, Any, Tuple

# Try to import the discovery system
try:
    from live_theme_discovery import LiveThemeDiscovery, DynamicTreeBuilder
    HAS_LIVE_DISCOVERY = True
except ImportError:
    HAS_LIVE_DISCOVERY = False
    print("[Warning] live_theme_discovery not available, using simplified analysis")

SCAN_LOCATIONS = [
    Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools'),
    Path(r'G:\MODSTAGING\HIRCINE\overwrite\SKSE\Plugins\SpellLearning\schools'),
]

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']


def load_school_spells(scan_dir: Path) -> Dict[str, List[dict]]:
    """Load all school spell files."""
    schools = {}
    for scan_file in sorted(scan_dir.glob("*_spells.json")):
        school = scan_file.stem.replace("_spells", "")
        with open(scan_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        schools[school] = data.get('spells', [])
    return schools


def analyze_themes(spells: List[dict]) -> Dict[str, Any]:
    """Analyze spell themes using TF-IDF discovery."""
    if not HAS_LIVE_DISCOVERY or len(spells) < 5:
        return {'themes': {}, 'theme_count': 0}

    discovery = LiveThemeDiscovery(min_theme_size=3, max_themes=12)
    themes = discovery.discover_themes(spells)

    return {
        'themes': {name: len(t.spells) for name, t in themes.items()},
        'theme_count': len(themes),
        'largest_theme_ratio': max(len(t.spells) for t in themes.values()) / len(spells) if themes else 0,
        'top_3_share': sum(sorted([len(t.spells) for t in themes.values()], reverse=True)[:3]) / len(spells) if themes else 0,
    }


def count_novice_elements(spells: List[dict]) -> int:
    """Count distinct 'elements' among Novice spells."""
    novice_spells = [s for s in spells if s.get('skillLevel') == 'Novice']

    # Extract potential elements from keywords and effect names
    elements = set()
    element_keywords = ['fire', 'frost', 'shock', 'lightning', 'ice', 'cold', 'flame',
                       'healing', 'restore', 'conjure', 'summon', 'bound', 'illusion',
                       'alteration', 'armor', 'flesh', 'ward', 'cloak']

    for spell in novice_spells:
        spell_text = ' '.join([
            spell.get('name', ''),
            ' '.join(spell.get('keywords', [])),
            ' '.join(e.get('name', '') for e in spell.get('effects', []))
        ]).lower()

        for elem in element_keywords:
            if elem in spell_text:
                elements.add(elem)

    return len(elements)


def calculate_quality_metrics(tree: dict, spells: List[dict]) -> Dict[str, float]:
    """Calculate quality metrics for a generated tree."""
    nodes = tree.get('nodes', [])
    links = tree.get('links', [])
    roots = tree.get('roots', [])
    themes = tree.get('themes', {})

    if not nodes:
        return {'score': 0, 'orphans': len(spells), 'coherence': 0}

    # Build lookups
    node_by_name = {n['name']: n for n in nodes}

    # Count links per node
    incoming = Counter()
    outgoing = Counter()
    for link in links:
        outgoing[link['from']] += 1
        incoming[link['to']] += 1

    # Orphans: non-roots with no incoming links
    root_names = set(roots)
    orphans = sum(1 for n in nodes if n['name'] not in root_names and incoming[n['name']] == 0)

    # Theme coherence: % of links within same theme
    same_theme = 0
    total_links = 0
    for link in links:
        from_node = node_by_name.get(link['from'])
        to_node = node_by_name.get(link['to'])
        if from_node and to_node:
            total_links += 1
            if from_node.get('theme') == to_node.get('theme') and from_node.get('theme'):
                same_theme += 1

    coherence = (same_theme / total_links * 100) if total_links > 0 else 0

    # Tier progression: % of links going lower→higher
    valid_tier = 0
    tier_checked = 0
    for link in links:
        from_node = node_by_name.get(link['from'])
        to_node = node_by_name.get(link['to'])
        if from_node and to_node:
            from_tier = from_node.get('tier', 'Unknown')
            to_tier = to_node.get('tier', 'Unknown')
            if from_tier in TIER_ORDER and to_tier in TIER_ORDER:
                tier_checked += 1
                if TIER_ORDER.index(to_tier) >= TIER_ORDER.index(from_tier):
                    valid_tier += 1

    tier_progression = (valid_tier / tier_checked * 100) if tier_checked > 0 else 0

    # Max depth (BFS from roots)
    depths = {r: 0 for r in root_names}
    for _ in range(100):  # Max iterations
        changed = False
        for link in links:
            if link['from'] in depths and link['to'] not in depths:
                depths[link['to']] = depths[link['from']] + 1
                changed = True
        if not changed:
            break
    max_depth = max(depths.values()) if depths else 0

    # Balance: variance in children per root
    root_subtree_sizes = []
    for root in roots:
        # Count nodes reachable from this root
        reachable = {root}
        for _ in range(100):
            changed = False
            for link in links:
                if link['from'] in reachable and link['to'] not in reachable:
                    reachable.add(link['to'])
                    changed = True
            if not changed:
                break
        root_subtree_sizes.append(len(reachable))

    if root_subtree_sizes:
        avg_size = sum(root_subtree_sizes) / len(root_subtree_sizes)
        variance = sum((s - avg_size) ** 2 for s in root_subtree_sizes) / len(root_subtree_sizes)
        balance = max(0, 100 - variance / max(1, avg_size))
    else:
        balance = 0

    # Combined score (weighted)
    score = (
        coherence * 0.3 +
        tier_progression * 0.25 +
        balance * 0.2 +
        max_depth * 2 +  # Reward depth
        max(0, 100 - orphans * 5) * 0.25  # Penalize orphans
    )

    return {
        'score': round(score, 1),
        'orphans': orphans,
        'coherence': round(coherence, 1),
        'tier_progression': round(tier_progression, 1),
        'balance': round(balance, 1),
        'max_depth': max_depth,
        'roots': len(roots),
        'nodes': len(nodes),
        'links': len(links),
    }


# ============================================================================
# ROOT COUNT STRATEGIES
# ============================================================================

def strategy_fixed(n: int):
    """Fixed root count."""
    def strategy(themes_info, spells):
        return n
    return strategy


def strategy_current_auto(themes_info, spells):
    """Current auto: min(themes, 5)."""
    return min(themes_info.get('theme_count', 1), 5)


def strategy_smart_heuristic(themes_info, spells):
    """Smart heuristic based on theme concentration + novice elements."""
    theme_count = themes_info.get('theme_count', 1)
    top_3_share = themes_info.get('top_3_share', 1.0)
    largest_ratio = themes_info.get('largest_theme_ratio', 1.0)
    novice_elements = count_novice_elements(spells)

    # Decision logic based on quality simulation insights
    if largest_ratio > 0.5:
        # One theme dominates - use fewer roots
        base = 1
    elif top_3_share > 0.8:
        # Top 3 themes cover most spells
        base = min(3, theme_count)
    elif top_3_share > 0.6:
        # Moderate concentration
        base = min(4, theme_count)
    else:
        # Evenly distributed - use more roots
        base = min(5, theme_count)

    # Adjust based on distinct novice elements
    if novice_elements >= 3:
        base = max(base, min(novice_elements, 3))

    return max(1, base)


def strategy_theme_weighted(themes_info, spells):
    """Weighted by theme size variance."""
    themes = themes_info.get('themes', {})
    if not themes:
        return 1

    sizes = sorted(themes.values(), reverse=True)

    # If sizes are very uneven, use fewer roots
    if len(sizes) >= 2:
        ratio = sizes[0] / sizes[-1]
        if ratio > 5:
            return 1
        elif ratio > 3:
            return 2
        elif ratio > 2:
            return min(3, len(themes))

    return min(len(themes), 5)


# ============================================================================
# SIMULATION
# ============================================================================

def run_simulation(scan_dir: Path):
    """Run simulations comparing different root count strategies."""

    print("=" * 80)
    print("ROOT COUNT STRATEGY SIMULATION")
    print("=" * 80)
    print(f"\nScan directory: {scan_dir}")

    schools = load_school_spells(scan_dir)

    if not schools:
        print("[Error] No school files found")
        return

    print(f"Loaded {len(schools)} schools: {', '.join(schools.keys())}")

    # Define strategies to test
    strategies = {
        '1_root': strategy_fixed(1),
        '2_roots': strategy_fixed(2),
        '3_roots': strategy_fixed(3),
        '5_roots': strategy_fixed(5),
        'current_auto': strategy_current_auto,
        'smart_heuristic': strategy_smart_heuristic,
        'theme_weighted': strategy_theme_weighted,
    }

    results = {}

    for school_name, spells in schools.items():
        print(f"\n{'#' * 80}")
        print(f"# {school_name.upper()} ({len(spells)} spells)")
        print(f"{'#' * 80}")

        # Analyze themes first
        themes_info = analyze_themes(spells)
        print(f"\nTheme Analysis:")
        print(f"  Themes discovered: {themes_info.get('theme_count', 0)}")
        print(f"  Largest theme ratio: {themes_info.get('largest_theme_ratio', 0):.1%}")
        print(f"  Top 3 share: {themes_info.get('top_3_share', 0):.1%}")
        print(f"  Theme sizes: {themes_info.get('themes', {})}")

        novice_elems = count_novice_elements(spells)
        print(f"  Novice elements: {novice_elems}")

        results[school_name] = {
            'spell_count': len(spells),
            'themes_info': themes_info,
            'strategies': {}
        }

        print(f"\n{'Strategy':<20} {'Roots':<6} {'Score':<8} {'Orphans':<8} {'Coherence':<10} {'Tier%':<8} {'Depth':<6}")
        print("-" * 70)

        for strategy_name, strategy_fn in strategies.items():
            # Determine root count
            root_count = strategy_fn(themes_info, spells)

            # Build tree with this root count
            if HAS_LIVE_DISCOVERY:
                discovery = LiveThemeDiscovery(min_theme_size=3, max_themes=12)
                builder = DynamicTreeBuilder(
                    root_count=root_count,
                    cross_theme_links=True,
                    affinity_threshold=50
                )
                tree = builder.build_tree(spells, discovery)
            else:
                # Simplified tree for testing
                tree = {'nodes': [], 'links': [], 'roots': [], 'themes': {}}

            # Calculate metrics
            metrics = calculate_quality_metrics(tree, spells)
            metrics['root_count_used'] = root_count

            results[school_name]['strategies'][strategy_name] = metrics

            print(f"{strategy_name:<20} {root_count:<6} {metrics['score']:<8.1f} "
                  f"{metrics['orphans']:<8} {metrics['coherence']:<10.1f} "
                  f"{metrics['tier_progression']:<8.1f} {metrics['max_depth']:<6}")

    # =========================================================================
    # SUMMARY
    # =========================================================================
    print("\n" + "=" * 80)
    print("SUMMARY: BEST STRATEGY PER SCHOOL")
    print("=" * 80)

    strategy_wins = Counter()
    strategy_scores = defaultdict(list)

    for school_name, school_data in results.items():
        best_strategy = None
        best_score = -1

        for strategy_name, metrics in school_data['strategies'].items():
            score = metrics['score']
            strategy_scores[strategy_name].append(score)

            if score > best_score:
                best_score = score
                best_strategy = strategy_name

        strategy_wins[best_strategy] += 1
        print(f"  {school_name}: {best_strategy} (score: {best_score:.1f})")

    print("\n" + "-" * 40)
    print("STRATEGY RANKINGS (by wins)")
    print("-" * 40)

    for strategy, wins in strategy_wins.most_common():
        avg_score = sum(strategy_scores[strategy]) / len(strategy_scores[strategy])
        print(f"  {strategy:<20}: {wins} wins, avg score: {avg_score:.1f}")

    # =========================================================================
    # RECOMMENDATION
    # =========================================================================
    print("\n" + "=" * 80)
    print("RECOMMENDATION")
    print("=" * 80)

    # Find overall best
    best_overall = max(strategy_scores.keys(),
                       key=lambda s: sum(strategy_scores[s]) / len(strategy_scores[s]))

    print(f"\nBest overall strategy: {best_overall}")
    print(f"  Average score: {sum(strategy_scores[best_overall]) / len(strategy_scores[best_overall]):.1f}")

    # Compare auto strategies specifically
    auto_strategies = ['current_auto', 'smart_heuristic', 'theme_weighted']
    print("\nAuto-detection comparison:")
    for s in auto_strategies:
        if s in strategy_scores:
            avg = sum(strategy_scores[s]) / len(strategy_scores[s])
            print(f"  {s}: {avg:.1f} avg score")

    # Show what each auto strategy chose
    print("\nRoot counts chosen by auto strategies:")
    for school_name, school_data in results.items():
        counts = []
        for s in auto_strategies:
            if s in school_data['strategies']:
                counts.append(f"{s}={school_data['strategies'][s]['root_count_used']}")
        print(f"  {school_name}: {', '.join(counts)}")

    return results


if __name__ == '__main__':
    # Find scan directory
    scan_dir = None
    for loc in SCAN_LOCATIONS:
        if loc.exists():
            scan_dir = loc
            break

    if not scan_dir:
        print("ERROR: No spell scan directory found")
        print(f"Checked: {SCAN_LOCATIONS}")
        exit(1)

    results = run_simulation(scan_dir)
