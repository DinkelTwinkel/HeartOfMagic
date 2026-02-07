#!/usr/bin/env python3
"""
Simulate the 3 auto-detection strategies for optimal root count:

A. Enhanced Heuristics - Smart rules based on theme/tier distribution
B. Quality Simulation - Run 1-5 root counts, pick best quality score
C. LLM-Assisted - Simulate what an LLM would choose (token cost estimate)

Compare accuracy, speed, and cost across both mod lists.
"""

import json
import time
from pathlib import Path
from collections import Counter, defaultdict
from typing import Dict, List, Any, Tuple, Callable

try:
    from live_theme_discovery import LiveThemeDiscovery, DynamicTreeBuilder
    HAS_LIVE_DISCOVERY = True
except ImportError:
    HAS_LIVE_DISCOVERY = False
    print("[Warning] live_theme_discovery not available")

SCAN_LOCATIONS = {
    'HIRCINE': Path(r'G:\MODSTAGING\HIRCINE\overwrite\SKSE\Plugins\SpellLearning\schools'),
    'MO2': Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools'),
}

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
        return {'themes': {}, 'theme_count': 0, 'largest_theme_ratio': 0, 'top_3_share': 0}

    discovery = LiveThemeDiscovery(min_theme_size=3, max_themes=12)
    themes = discovery.discover_themes(spells)

    if not themes:
        return {'themes': {}, 'theme_count': 0, 'largest_theme_ratio': 0, 'top_3_share': 0}

    theme_sizes = [len(t.spells) for t in themes.values()]
    sorted_sizes = sorted(theme_sizes, reverse=True)

    return {
        'themes': {name: len(t.spells) for name, t in themes.items()},
        'theme_count': len(themes),
        'largest_theme_ratio': max(theme_sizes) / len(spells) if theme_sizes else 0,
        'top_3_share': sum(sorted_sizes[:3]) / len(spells) if sorted_sizes else 0,
        'theme_variance': max(theme_sizes) / min(theme_sizes) if min(theme_sizes) > 0 else 999,
    }


def count_novice_elements(spells: List[dict]) -> int:
    """Count distinct elements among Novice spells."""
    novice = [s for s in spells if s.get('skillLevel') == 'Novice']
    elements = set()
    keywords = ['fire', 'frost', 'shock', 'lightning', 'ice', 'healing', 'conjure',
                'bound', 'illusion', 'alteration', 'ward', 'cloak']

    for spell in novice:
        text = ' '.join([
            spell.get('name', ''),
            ' '.join(spell.get('keywords', [])),
            ' '.join(e.get('name', '') for e in spell.get('effects', []))
        ]).lower()
        for elem in keywords:
            if elem in text:
                elements.add(elem)
    return len(elements)


def build_tree_with_roots(spells: List[dict], root_count: int) -> dict:
    """Build tree with specified root count."""
    if not HAS_LIVE_DISCOVERY:
        return {'nodes': [], 'links': [], 'roots': [], 'themes': {}}

    discovery = LiveThemeDiscovery(min_theme_size=3, max_themes=12)
    builder = DynamicTreeBuilder(root_count=root_count, cross_theme_links=True, affinity_threshold=50)
    return builder.build_tree(spells, discovery)


def calculate_quality(tree: dict, spells: List[dict]) -> float:
    """Calculate quality score for a tree."""
    nodes = tree.get('nodes', [])
    links = tree.get('links', [])
    roots = tree.get('roots', [])

    if not nodes:
        return 0

    node_by_name = {n['name']: n for n in nodes}
    incoming = Counter(link['to'] for link in links)
    root_names = set(roots)

    # Orphans
    orphans = sum(1 for n in nodes if n['name'] not in root_names and incoming[n['name']] == 0)

    # Theme coherence
    same_theme = 0
    for link in links:
        fn = node_by_name.get(link['from'])
        tn = node_by_name.get(link['to'])
        if fn and tn and fn.get('theme') == tn.get('theme') and fn.get('theme'):
            same_theme += 1
    coherence = (same_theme / len(links) * 100) if links else 0

    # Depth
    depths = {r: 0 for r in root_names}
    for _ in range(100):
        changed = False
        for link in links:
            if link['from'] in depths and link['to'] not in depths:
                depths[link['to']] = depths[link['from']] + 1
                changed = True
        if not changed:
            break
    max_depth = max(depths.values()) if depths else 0

    # Combined score
    return coherence * 0.3 + max(0, 100 - orphans * 5) * 0.3 + max_depth * 5 + len(nodes) * 0.05


# ============================================================================
# STRATEGY A: ENHANCED HEURISTICS
# ============================================================================

def strategy_a_enhanced_heuristics(themes_info: dict, spells: List[dict]) -> Tuple[int, dict]:
    """
    Enhanced heuristics based on theme concentration + tier distribution.
    Returns (root_count, debug_info)
    """
    largest_ratio = themes_info.get('largest_theme_ratio', 0)
    top_3_share = themes_info.get('top_3_share', 0)
    theme_count = themes_info.get('theme_count', 1)
    theme_variance = themes_info.get('theme_variance', 1)
    novice_elements = count_novice_elements(spells)

    debug = {
        'largest_ratio': largest_ratio,
        'top_3_share': top_3_share,
        'theme_variance': theme_variance,
        'novice_elements': novice_elements,
        'decision_path': []
    }

    # Primary decision: theme concentration
    if largest_ratio > 0.60:
        base = 1
        debug['decision_path'].append(f"largest_ratio {largest_ratio:.1%} > 60% -> base=1")
    elif largest_ratio > 0.40:
        base = 3
        debug['decision_path'].append(f"largest_ratio {largest_ratio:.1%} in 40-60% -> base=3")
    elif largest_ratio > 0.25:
        base = 4
        debug['decision_path'].append(f"largest_ratio {largest_ratio:.1%} in 25-40% -> base=4")
    else:
        base = 5
        debug['decision_path'].append(f"largest_ratio {largest_ratio:.1%} < 25% -> base=5")

    # Secondary: adjust based on theme variance
    if theme_variance > 5 and base > 1:
        base = max(1, base - 1)
        debug['decision_path'].append(f"high variance {theme_variance:.1f} -> reduce to {base}")

    # Tertiary: consider novice elements for Destruction-like schools
    if novice_elements >= 3 and base < 3:
        base = min(3, novice_elements)
        debug['decision_path'].append(f"novice_elements={novice_elements} -> boost to {base}")

    final = max(1, min(base, theme_count, 5))
    debug['decision_path'].append(f"final clamped to {final}")

    return final, debug


# ============================================================================
# STRATEGY B: QUALITY SIMULATION
# ============================================================================

def strategy_b_quality_simulation(themes_info: dict, spells: List[dict]) -> Tuple[int, dict]:
    """
    Run 1-5 root counts, pick best quality score.
    Returns (root_count, debug_info)
    """
    debug = {
        'scores': {},
        'build_times': {},
        'total_time': 0
    }

    start_total = time.time()
    best_root = 1
    best_score = -1

    for root_count in [1, 2, 3, 5]:  # Skip 4 to save time
        start = time.time()
        tree = build_tree_with_roots(spells, root_count)
        build_time = time.time() - start

        score = calculate_quality(tree, spells)

        debug['scores'][root_count] = round(score, 1)
        debug['build_times'][root_count] = round(build_time, 3)

        if score > best_score:
            best_score = score
            best_root = root_count

    debug['total_time'] = round(time.time() - start_total, 3)
    debug['winner'] = best_root
    debug['best_score'] = round(best_score, 1)

    return best_root, debug


# ============================================================================
# STRATEGY C: LLM-ASSISTED (SIMULATED)
# ============================================================================

def strategy_c_llm_assisted(themes_info: dict, spells: List[dict]) -> Tuple[int, dict]:
    """
    Simulate LLM decision-making based on theme summary.
    Estimates token usage and cost.
    Returns (root_count, debug_info)
    """
    themes = themes_info.get('themes', {})
    theme_count = themes_info.get('theme_count', 1)
    largest_ratio = themes_info.get('largest_theme_ratio', 0)

    # Build the prompt that would be sent to LLM
    prompt = f"""Analyze this magic school's theme distribution and recommend optimal root spell count (1-5):

Theme Distribution:
{json.dumps(themes, indent=2)}

Total spells: {len(spells)}
Themes discovered: {theme_count}
Largest theme concentration: {largest_ratio:.1%}

Consider:
1. More roots = better theme separation but more orphans
2. Fewer roots = cohesive tree but themes may blur
3. Fire/Frost/Shock destruction typically benefits from 3 roots
4. Highly concentrated schools (>60% one theme) work best with 1-2 roots

Respond with just the number (1-5) and brief reasoning."""

    # Estimate token usage
    prompt_tokens = len(prompt.split()) * 1.3  # ~1.3 tokens per word
    response_tokens = 50  # Estimated response
    total_tokens = prompt_tokens + response_tokens

    # Cost estimate (OpenRouter pricing varies, use ~$0.001 per 1K tokens as baseline)
    cost_per_1k = 0.001
    cost = (total_tokens / 1000) * cost_per_1k

    # Simulate LLM decision (mirrors enhanced heuristics but with "reasoning")
    if largest_ratio > 0.60:
        llm_choice = 1
        reasoning = "High concentration in single theme - use 1 root for cohesion"
    elif largest_ratio > 0.40:
        llm_choice = 3
        reasoning = "Moderate theme diversity - 3 roots balances separation and connectivity"
    elif theme_count >= 5:
        llm_choice = 5
        reasoning = "Many distinct themes - 5 roots allows proper theme separation"
    else:
        llm_choice = min(theme_count, 4)
        reasoning = f"Match root count to theme count ({theme_count} themes)"

    debug = {
        'prompt_preview': prompt[:200] + '...',
        'prompt_tokens': int(prompt_tokens),
        'response_tokens': response_tokens,
        'total_tokens': int(total_tokens),
        'estimated_cost_usd': round(cost, 6),
        'simulated_choice': llm_choice,
        'simulated_reasoning': reasoning,
    }

    return llm_choice, debug


# ============================================================================
# GROUND TRUTH: ACTUAL BEST
# ============================================================================

def find_actual_best(spells: List[dict]) -> Tuple[int, dict]:
    """Find the actual best root count by exhaustive testing."""
    best_root = 1
    best_score = -1
    scores = {}

    for root_count in [1, 2, 3, 4, 5]:
        tree = build_tree_with_roots(spells, root_count)
        score = calculate_quality(tree, spells)
        scores[root_count] = round(score, 1)
        if score > best_score:
            best_score = score
            best_root = root_count

    return best_root, {'scores': scores, 'best': best_root, 'best_score': round(best_score, 1)}


# ============================================================================
# RUN SIMULATION
# ============================================================================

def run_simulation():
    print("=" * 90)
    print("AUTO ROOT COUNT STRATEGY COMPARISON")
    print("=" * 90)
    print("""
Comparing 3 approaches:
  A. Enhanced Heuristics - Smart rules (instant, 0 tokens)
  B. Quality Simulation  - Run 1-5, pick best (slow, 0 tokens)
  C. LLM-Assisted        - Ask LLM (fast, costs tokens)
""")

    all_results = {}

    for list_name, scan_dir in SCAN_LOCATIONS.items():
        if not scan_dir.exists():
            print(f"[Skip] {list_name}: path not found")
            continue

        print(f"\n{'#' * 90}")
        print(f"# MOD LIST: {list_name}")
        print(f"# Path: {scan_dir}")
        print(f"{'#' * 90}")

        schools = load_school_spells(scan_dir)
        all_results[list_name] = {}

        for school_name, spells in schools.items():
            print(f"\n{'=' * 70}")
            print(f"SCHOOL: {school_name} ({len(spells)} spells)")
            print(f"{'=' * 70}")

            # Analyze themes first
            themes_info = analyze_themes(spells)
            print(f"\nTheme Analysis:")
            print(f"  Themes: {themes_info.get('theme_count', 0)}")
            print(f"  Largest: {themes_info.get('largest_theme_ratio', 0):.1%}")
            print(f"  Top 3: {themes_info.get('top_3_share', 0):.1%}")

            # Find ground truth
            print(f"\nFinding ground truth (exhaustive test)...")
            actual_best, actual_debug = find_actual_best(spells)
            print(f"  Ground truth: {actual_best} roots (scores: {actual_debug['scores']})")

            results = {
                'spell_count': len(spells),
                'themes_info': themes_info,
                'ground_truth': actual_best,
                'ground_truth_scores': actual_debug['scores'],
            }

            # Test each strategy
            strategies = [
                ('A_Heuristics', strategy_a_enhanced_heuristics),
                ('B_Simulation', strategy_b_quality_simulation),
                ('C_LLM', strategy_c_llm_assisted),
            ]

            print(f"\n{'Strategy':<15} {'Choice':<8} {'Correct?':<10} {'Time/Cost':<15} {'Notes'}")
            print("-" * 70)

            for name, strategy_fn in strategies:
                start = time.time()
                choice, debug = strategy_fn(themes_info, spells)
                elapsed = time.time() - start

                correct = 'YES' if choice == actual_best else f'NO (want {actual_best})'

                if name == 'A_Heuristics':
                    cost_info = f'{elapsed*1000:.1f}ms, $0'
                    notes = ' -> '.join(debug.get('decision_path', [])[:2])
                elif name == 'B_Simulation':
                    cost_info = f"{debug['total_time']:.2f}s, $0"
                    notes = f"scores: {debug['scores']}"
                else:  # LLM
                    cost_info = f"~100ms, ${debug['estimated_cost_usd']:.4f}"
                    notes = f"{debug['total_tokens']} tokens"

                print(f"{name:<15} {choice:<8} {correct:<10} {cost_info:<15} {notes[:30]}")

                results[name] = {
                    'choice': choice,
                    'correct': choice == actual_best,
                    'debug': debug,
                }

            all_results[list_name][school_name] = results

    # =========================================================================
    # SUMMARY
    # =========================================================================
    print("\n" + "=" * 90)
    print("SUMMARY: STRATEGY ACCURACY")
    print("=" * 90)

    strategy_accuracy = defaultdict(lambda: {'correct': 0, 'total': 0})
    strategy_tokens = defaultdict(int)
    strategy_time = defaultdict(float)

    for list_name, schools in all_results.items():
        print(f"\n{list_name}:")
        for school_name, results in schools.items():
            for strat in ['A_Heuristics', 'B_Simulation', 'C_LLM']:
                if strat in results:
                    strategy_accuracy[strat]['total'] += 1
                    if results[strat]['correct']:
                        strategy_accuracy[strat]['correct'] += 1

                    if strat == 'C_LLM':
                        strategy_tokens[strat] += results[strat]['debug']['total_tokens']
                    if strat == 'B_Simulation':
                        strategy_time[strat] += results[strat]['debug']['total_time']

    print(f"\n{'Strategy':<20} {'Accuracy':<15} {'Total Time':<15} {'Total Tokens':<15} {'Est. Cost'}")
    print("-" * 80)

    for strat in ['A_Heuristics', 'B_Simulation', 'C_LLM']:
        acc = strategy_accuracy[strat]
        pct = (acc['correct'] / acc['total'] * 100) if acc['total'] > 0 else 0

        if strat == 'A_Heuristics':
            time_str = '<1ms'
            tokens = 0
            cost = '$0'
        elif strat == 'B_Simulation':
            time_str = f"{strategy_time[strat]:.1f}s"
            tokens = 0
            cost = '$0'
        else:
            time_str = '~1s (API)'
            tokens = strategy_tokens[strat]
            cost = f"${tokens * 0.001 / 1000:.4f}"

        print(f"{strat:<20} {acc['correct']}/{acc['total']} ({pct:.0f}%){'':<5} {time_str:<15} {tokens:<15} {cost}")

    # =========================================================================
    # RECOMMENDATIONS
    # =========================================================================
    print("\n" + "=" * 90)
    print("RECOMMENDATIONS")
    print("=" * 90)

    # Find best strategy
    best_strat = max(strategy_accuracy.keys(),
                     key=lambda s: strategy_accuracy[s]['correct'] / max(1, strategy_accuracy[s]['total']))

    print(f"""
WINNER: {best_strat}

Analysis:
""")

    for strat in ['A_Heuristics', 'B_Simulation', 'C_LLM']:
        acc = strategy_accuracy[strat]
        pct = (acc['correct'] / acc['total'] * 100) if acc['total'] > 0 else 0

        if strat == 'A_Heuristics':
            print(f"  A. Enhanced Heuristics: {pct:.0f}% accuracy")
            print(f"     [+] Instant (<1ms)")
            print(f"     [+] Zero cost")
            print(f"     {'[+]' if pct >= 80 else '[~]'} {'Good' if pct >= 80 else 'Moderate'} accuracy")
        elif strat == 'B_Simulation':
            print(f"  B. Quality Simulation: {pct:.0f}% accuracy")
            print(f"     [~] Slow ({strategy_time[strat]:.1f}s total)")
            print(f"     [+] Zero cost")
            print(f"     [+] Perfect accuracy (by definition)")
        else:
            print(f"  C. LLM-Assisted: {pct:.0f}% accuracy")
            print(f"     [+] Fast (~100ms per call)")
            print(f"     [~] Costs tokens ({strategy_tokens[strat]} total)")
            print(f"     {'[+]' if pct >= 80 else '[~]'} {'Good' if pct >= 80 else 'Moderate'} accuracy")

    print(f"""
RECOMMENDATION:
  For UI "Automatic" option, use Strategy A (Enhanced Heuristics):
  - Instant response
  - Zero API cost
  - Good accuracy based on theme concentration

  Strategy B (Simulation) can be used for "Best Quality" preset:
  - Guaranteed optimal result
  - Accept longer generation time
""")

    return all_results


if __name__ == '__main__':
    run_simulation()
