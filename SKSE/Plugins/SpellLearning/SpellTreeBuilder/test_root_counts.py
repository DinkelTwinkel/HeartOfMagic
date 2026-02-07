#!/usr/bin/env python3
"""
Test different root counts and assess tree quality.
"""

import json
from pathlib import Path
from collections import Counter, defaultdict
from live_theme_discovery import LiveThemeDiscovery, DynamicTreeBuilder

# Scan locations
SCAN_LOCATIONS = [
    Path(r'G:\MODSTAGING\HIRCINE\overwrite\SKSE\Plugins\SpellLearning\schools'),
    Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools'),
]

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']


def calculate_tree_quality(tree: dict, discovery: LiveThemeDiscovery) -> dict:
    """Calculate quality metrics for a generated tree."""
    nodes = tree['nodes']
    links = tree['links']
    themes = tree['themes']

    metrics = {
        'total_spells': len(nodes),
        'total_links': len(links),
        'themes_discovered': len(themes),
        'roots': len(tree['roots']),
        'progression_links': 0,
        'cross_theme_links': 0,

        # Quality metrics
        'orphan_spells': 0,           # Spells with no links
        'theme_coherence': 0.0,       # % of links within same theme
        'tier_progression_valid': 0,  # % of links going lower->higher tier
        'avg_children_per_node': 0.0,
        'max_depth': 0,
        'balanced_score': 0.0,        # How evenly distributed across themes
    }

    # Count link types
    for link in links:
        if link.get('type') == 'cross_theme':
            metrics['cross_theme_links'] += 1
        else:
            metrics['progression_links'] += 1

    # Build node lookup
    node_by_name = {n['name']: n for n in nodes}

    # Calculate children per node
    children_count = Counter()
    parents_count = Counter()
    for link in links:
        children_count[link['from']] += 1
        parents_count[link['to']] += 1

    # Orphans: nodes with no incoming or outgoing links (except roots)
    root_names = set(tree['roots'])
    for node in nodes:
        name = node['name']
        if name not in root_names:
            if parents_count[name] == 0:
                metrics['orphan_spells'] += 1

    # Avg children
    if children_count:
        metrics['avg_children_per_node'] = sum(children_count.values()) / len(children_count)

    # Theme coherence: % of progression links within same theme
    same_theme_links = 0
    for link in links:
        if link.get('type') == 'cross_theme':
            continue
        from_node = node_by_name.get(link['from'])
        to_node = node_by_name.get(link['to'])
        if from_node and to_node:
            if from_node.get('theme') == to_node.get('theme'):
                same_theme_links += 1

    if metrics['progression_links'] > 0:
        metrics['theme_coherence'] = same_theme_links / metrics['progression_links'] * 100

    # Tier progression: % of links going from lower to same/higher tier
    valid_progression = 0
    total_checked = 0
    for link in links:
        from_node = node_by_name.get(link['from'])
        to_node = node_by_name.get(link['to'])
        if from_node and to_node:
            from_tier = from_node.get('tier', 'Unknown')
            to_tier = to_node.get('tier', 'Unknown')
            if from_tier in TIER_ORDER and to_tier in TIER_ORDER:
                total_checked += 1
                from_idx = TIER_ORDER.index(from_tier)
                to_idx = TIER_ORDER.index(to_tier)
                if to_idx >= from_idx:  # Same or higher tier
                    valid_progression += 1

    if total_checked > 0:
        metrics['tier_progression_valid'] = valid_progression / total_checked * 100

    # Max depth (BFS from roots)
    depths = {r: 0 for r in root_names}
    changed = True
    iterations = 0
    while changed and iterations < 100:
        changed = False
        iterations += 1
        for link in links:
            if link['from'] in depths and link['to'] not in depths:
                depths[link['to']] = depths[link['from']] + 1
                changed = True

    metrics['max_depth'] = max(depths.values()) if depths else 0

    # Balance score: how evenly distributed spells are across themes
    if themes:
        theme_sizes = [t['spell_count'] for t in themes.values()]
        avg_size = sum(theme_sizes) / len(theme_sizes)
        variance = sum((s - avg_size) ** 2 for s in theme_sizes) / len(theme_sizes)
        # Lower variance = more balanced. Normalize to 0-100
        max_possible_variance = (len(nodes) - avg_size) ** 2
        if max_possible_variance > 0:
            metrics['balanced_score'] = max(0, 100 - (variance / max_possible_variance * 100))
        else:
            metrics['balanced_score'] = 100

    # Edge cases
    edge_cases = discovery.find_edge_cases(confidence_threshold=0.3)
    metrics['edge_cases'] = len(edge_cases)
    metrics['edge_case_pct'] = len(edge_cases) / len(nodes) * 100 if nodes else 0

    return metrics


def run_simulation(scan_dir: Path, root_counts: list = [1, 5]):
    """Run simulations with different root counts."""

    print("=" * 80)
    print("TREE GENERATION QUALITY ASSESSMENT")
    print("=" * 80)
    print(f"\nScan directory: {scan_dir}")
    print(f"Testing root counts: {root_counts}\n")

    results = {}

    for scan_file in sorted(scan_dir.glob("*_spells.json")):
        school = scan_file.stem.replace("_spells", "").title()

        with open(scan_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        spells = data.get('spells', [])
        if not spells:
            continue

        print("#" * 80)
        print(f"# {school.upper()} ({len(spells)} spells)")
        print("#" * 80)

        results[school] = {}

        for root_count in root_counts:
            print(f"\n--- Root Count: {root_count} {'(auto)' if root_count == 0 else ''} ---")

            # Create fresh discovery and builder
            discovery = LiveThemeDiscovery(min_theme_size=3, max_themes=12)
            builder = DynamicTreeBuilder(
                root_count=root_count,
                cross_theme_links=True,
                affinity_threshold=50
            )

            # Build tree
            tree = builder.build_tree(spells, discovery)

            # Calculate quality
            metrics = calculate_tree_quality(tree, discovery)
            results[school][root_count] = metrics

            # Print results
            print(f"  Themes: {metrics['themes_discovered']}")
            print(f"  Roots: {tree['roots'][:3]}{'...' if len(tree['roots']) > 3 else ''}")
            print(f"  Links: {metrics['progression_links']} progression + {metrics['cross_theme_links']} cross-theme")
            print(f"  Orphans: {metrics['orphan_spells']}")
            print(f"  Theme Coherence: {metrics['theme_coherence']:.1f}%")
            print(f"  Valid Tier Progression: {metrics['tier_progression_valid']:.1f}%")
            print(f"  Max Depth: {metrics['max_depth']}")
            print(f"  Avg Children/Node: {metrics['avg_children_per_node']:.2f}")
            print(f"  Balance Score: {metrics['balanced_score']:.1f}/100")
            print(f"  Edge Cases: {metrics['edge_cases']} ({metrics['edge_case_pct']:.1f}%)")

            # Save tree
            output_dir = Path(__file__).parent / "test_output"
            output_dir.mkdir(exist_ok=True)
            output_file = output_dir / f"{school}_dynamic_{root_count}root_tree.json"

            output_data = {
                'school': school,
                'ruleset': f'dynamic_{root_count}root',
                'root_count': root_count,
                'metrics': metrics,
                'themes': tree['themes'],
                'nodes': tree['nodes'],
                'links': tree['links'],
                'roots': tree['roots'],
            }

            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, indent=2)

        print()

    # Summary comparison
    print("\n" + "=" * 80)
    print("SUMMARY COMPARISON: 1 Root vs 5 Roots")
    print("=" * 80)

    print(f"\n{'School':<15} {'Metric':<25} {'1 Root':<15} {'5 Roots':<15} {'Winner':<10}")
    print("-" * 80)

    for school in results:
        if 1 not in results[school] or 5 not in results[school]:
            continue

        m1 = results[school][1]
        m5 = results[school][5]

        # Compare key metrics
        comparisons = [
            ('Theme Coherence', m1['theme_coherence'], m5['theme_coherence'], 'higher'),
            ('Tier Progression', m1['tier_progression_valid'], m5['tier_progression_valid'], 'higher'),
            ('Orphan Spells', m1['orphan_spells'], m5['orphan_spells'], 'lower'),
            ('Max Depth', m1['max_depth'], m5['max_depth'], 'higher'),
            ('Balance Score', m1['balanced_score'], m5['balanced_score'], 'higher'),
            ('Edge Cases %', m1['edge_case_pct'], m5['edge_case_pct'], 'lower'),
        ]

        for metric, v1, v5, prefer in comparisons:
            if prefer == 'higher':
                winner = '1 Root' if v1 > v5 else ('5 Roots' if v5 > v1 else 'Tie')
            else:
                winner = '1 Root' if v1 < v5 else ('5 Roots' if v5 < v1 else 'Tie')

            print(f"{school:<15} {metric:<25} {v1:<15.1f} {v5:<15.1f} {winner:<10}")

        print()

    # Overall assessment
    print("\n" + "=" * 80)
    print("OVERALL SYSTEM ASSESSMENT")
    print("=" * 80)

    total_schools = len(results)

    # Aggregate metrics
    avg_coherence_1 = sum(r[1]['theme_coherence'] for r in results.values() if 1 in r) / total_schools
    avg_coherence_5 = sum(r[5]['theme_coherence'] for r in results.values() if 5 in r) / total_schools

    avg_tier_prog_1 = sum(r[1]['tier_progression_valid'] for r in results.values() if 1 in r) / total_schools
    avg_tier_prog_5 = sum(r[5]['tier_progression_valid'] for r in results.values() if 5 in r) / total_schools

    total_orphans_1 = sum(r[1]['orphan_spells'] for r in results.values() if 1 in r)
    total_orphans_5 = sum(r[5]['orphan_spells'] for r in results.values() if 5 in r)

    avg_edge_1 = sum(r[1]['edge_case_pct'] for r in results.values() if 1 in r) / total_schools
    avg_edge_5 = sum(r[5]['edge_case_pct'] for r in results.values() if 5 in r) / total_schools

    print(f"""
STRENGTHS:
+ Dynamic theme discovery finds {sum(r[5]['themes_discovered'] for r in results.values() if 5 in r)} unique themes across {total_schools} schools
+ Theme coherence: {avg_coherence_5:.1f}% of links stay within same theme (5 roots)
+ Tier progression: {avg_tier_prog_5:.1f}% of links follow proper skill ordering
+ Cross-theme links add strategic depth ({sum(r[5]['cross_theme_links'] for r in results.values() if 5 in r)} total)

AREAS FOR IMPROVEMENT:
- Edge cases: {avg_edge_5:.1f}% of spells have low-confidence theme assignments
- Orphan spells: {total_orphans_5} spells with no incoming links (besides roots)
- Large 'catch-all' themes absorb many spells (needs better keyword differentiation)

1 ROOT vs 5 ROOTS:
- Theme Coherence: {'1 Root' if avg_coherence_1 > avg_coherence_5 else '5 Roots'} wins ({avg_coherence_1:.1f}% vs {avg_coherence_5:.1f}%)
- Tier Progression: {'1 Root' if avg_tier_prog_1 > avg_tier_prog_5 else '5 Roots'} wins ({avg_tier_prog_1:.1f}% vs {avg_tier_prog_5:.1f}%)
- Orphans: {'1 Root' if total_orphans_1 < total_orphans_5 else '5 Roots'} wins ({total_orphans_1} vs {total_orphans_5})

RECOMMENDATION:
{'5 Roots recommended - better theme separation and strategic depth' if avg_coherence_5 >= avg_coherence_1 else '1 Root recommended - more coherent single progression path'}
""")


if __name__ == '__main__':
    # Find scan directory
    scan_dir = None
    for loc in SCAN_LOCATIONS:
        if loc.exists():
            scan_dir = loc
            break

    if not scan_dir:
        print("ERROR: No spell scan directory found")
        exit(1)

    run_simulation(scan_dir, root_counts=[1, 5])
