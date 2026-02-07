#!/usr/bin/env python3
"""
Link Quality Analyzer for Spell Trees

Evaluates whether spell connections make logical/thematic sense.
Outputs a detailed report of link quality.
"""

import json
import re
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Tuple, Set

# Load spell data and tree data
SCHOOLS_DIR = Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools')
TREES_DIR = Path(r'D:\MODDING\Mod Development Zone 2\tools\SpellTreeBuilder\test_output')

# Element clusters for semantic analysis
ELEMENT_CLUSTERS = {
    'fire': ['fire', 'flame', 'burn', 'incinerate', 'inferno', 'blaze', 'scorch', 'heat', 'magma', 'ember', 'dragon', 'pyre'],
    'frost': ['frost', 'ice', 'cold', 'freeze', 'blizzard', 'chill', 'glacial', 'hail', 'snow', 'frozen', 'cryo', 'icy', 'creeping'],
    'shock': ['shock', 'spark', 'lightning', 'thunder', 'electric', 'volt', 'arc', 'static', 'jolt', 'crackle', 'bolt', 'storm', 'chain'],
    'earth': ['stone', 'rock', 'earth', 'boulder', 'crystal', 'quake', 'tremor', 'geo', 'terra', 'mineral', 'sand'],
    'water': ['water', 'wave', 'tide', 'aqua', 'spray', 'torrent', 'flood', 'rain', 'stream'],
    'wind': ['wind', 'gust', 'breeze', 'cyclone', 'tornado', 'tempest', 'gale', 'air', 'whirlwind', 'push', 'swirl'],
    'dark': ['dark', 'shadow', 'death', 'drain', 'soul', 'necrotic', 'void', 'curse', 'strangle', 'choking'],
    'holy': ['holy', 'divine', 'sacred', 'radiant', 'blessed', 'purify', 'bane', 'undead', 'sun'],
    'arcane': ['arcane', 'magic', 'elemental', 'chaos', 'energy', 'force', 'unbounded'],
}

# Spell type patterns
SPELL_TYPES = {
    'projectile': ['bolt', 'spike', 'spear', 'shard', 'ball', 'throw'],
    'stream': ['stream', 'spray', 'breath', 'gout', 'flow'],
    'rune': ['rune', 'trap', 'mine', 'glyph'],
    'cloak': ['cloak', 'shroud', 'aura', 'mantle'],
    'wall': ['wall', 'barrier'],
    'storm': ['storm', 'vortex', 'maelstrom', 'blizzard'],
    'explosion': ['burst', 'blast', 'nova', 'explosion'],
    'touch': ['touch', 'hand', 'grasp'],
}

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
TIER_TO_IDX = {t: i for i, t in enumerate(TIER_ORDER)}


def detect_element(name: str) -> str:
    """Detect element from spell name."""
    name_lower = name.lower()
    scores = {}
    for element, keywords in ELEMENT_CLUSTERS.items():
        score = sum(3 if re.search(rf'\b{re.escape(kw)}\b', name_lower) else (1 if kw in name_lower else 0)
                   for kw in keywords)
        scores[element] = score
    if not any(scores.values()):
        return 'arcane'
    return max(scores, key=scores.get)


def detect_spell_type(name: str) -> str:
    """Detect spell type from name."""
    name_lower = name.lower()
    for stype, keywords in SPELL_TYPES.items():
        if any(kw in name_lower for kw in keywords):
            return stype
    return 'other'


def extract_keywords(name: str) -> Set[str]:
    """Extract significant words from spell name."""
    return set(re.findall(r'\b\w{4,}\b', name.lower()))


def load_spell_data(school: str) -> Dict[str, Dict]:
    """Load spell data and create formId -> spell mapping."""
    spell_file = SCHOOLS_DIR / f"{school}_spells.json"
    if not spell_file.exists():
        return {}

    with open(spell_file) as f:
        data = json.load(f)

    spells = {}
    for s in data.get('spells', []):
        spells[s['formId']] = {
            'name': s['name'],
            'tier': s.get('skillLevel', 'Unknown'),
            'tier_idx': TIER_TO_IDX.get(s.get('skillLevel', 'Unknown'), 5),
            'element': detect_element(s['name']),
            'spell_type': detect_spell_type(s['name']),
            'keywords': extract_keywords(s['name']),
            'magicka': s.get('magickaCost', 0),
        }
    return spells


def load_tree(school: str, ruleset: str) -> Dict:
    """Load tree data."""
    tree_file = TREES_DIR / f"{school}_{ruleset}_tree.json"
    if not tree_file.exists():
        return {}

    with open(tree_file) as f:
        return json.load(f)


def evaluate_link_quality(parent: Dict, child: Dict) -> Tuple[int, List[str]]:
    """
    Evaluate link quality between parent and child spell.
    Returns (score 0-100, list of reasons).
    Higher score = better link.
    """
    score = 50  # Start at neutral
    reasons = []

    # Element matching (major factor)
    if parent['element'] == child['element']:
        score += 25
        reasons.append(f"+25: Same element ({parent['element']})")
    elif parent['element'] == 'arcane' or child['element'] == 'arcane':
        score += 10
        reasons.append(f"+10: Arcane is flexible")
    else:
        score -= 30
        reasons.append(f"-30: ELEMENT MISMATCH ({parent['element']} -> {child['element']})")

    # Spell type matching
    if parent['spell_type'] == child['spell_type']:
        score += 15
        reasons.append(f"+15: Same type ({parent['spell_type']})")
    elif parent['spell_type'] == 'other' or child['spell_type'] == 'other':
        pass  # No bonus or penalty
    else:
        score -= 5
        reasons.append(f"-5: Type change ({parent['spell_type']} -> {child['spell_type']})")

    # Tier progression
    tier_diff = child['tier_idx'] - parent['tier_idx']
    if tier_diff == 1:
        score += 15
        reasons.append(f"+15: Natural tier progression ({parent['tier']} -> {child['tier']})")
    elif tier_diff == 0:
        score += 5
        reasons.append(f"+5: Same tier branching")
    elif tier_diff == 2:
        score -= 5
        reasons.append(f"-5: Skipping tier ({parent['tier']} -> {child['tier']})")
    elif tier_diff > 2:
        score -= 20
        reasons.append(f"-20: Large tier skip ({parent['tier']} -> {child['tier']})")
    elif tier_diff < 0:
        score -= 25
        reasons.append(f"-25: REVERSE tier ({parent['tier']} -> {child['tier']})")

    # Keyword overlap
    shared_keywords = parent['keywords'] & child['keywords']
    if shared_keywords:
        bonus = min(len(shared_keywords) * 10, 20)
        score += bonus
        reasons.append(f"+{bonus}: Shared keywords: {shared_keywords}")

    return min(max(score, 0), 100), reasons


def analyze_tree(school: str, ruleset: str, spells: Dict[str, Dict]) -> Dict:
    """Analyze all links in a tree."""
    tree = load_tree(school, ruleset)
    if not tree:
        return {'error': f"No tree found for {school}_{ruleset}"}

    nodes = {n['formId']: n for n in tree.get('nodes', [])}
    root_id = tree.get('root')

    results = {
        'school': school,
        'ruleset': ruleset,
        'total_nodes': len(nodes),
        'total_links': 0,
        'excellent_links': [],  # 80+
        'good_links': [],       # 60-79
        'acceptable_links': [], # 40-59
        'poor_links': [],       # 20-39
        'bad_links': [],        # 0-19
        'avg_score': 0,
        'element_chains': defaultdict(list),
        'problematic_patterns': [],
    }

    all_scores = []

    for node in tree.get('nodes', []):
        form_id = node['formId']
        if form_id not in spells:
            continue

        child_spell = spells[form_id]

        for prereq_id in node.get('prerequisites', []):
            if prereq_id not in spells:
                continue

            parent_spell = spells[prereq_id]
            results['total_links'] += 1

            score, reasons = evaluate_link_quality(parent_spell, child_spell)
            all_scores.append(score)

            link_info = {
                'parent': parent_spell['name'],
                'parent_tier': parent_spell['tier'],
                'parent_element': parent_spell['element'],
                'child': child_spell['name'],
                'child_tier': child_spell['tier'],
                'child_element': child_spell['element'],
                'score': score,
                'reasons': reasons,
            }

            # Categorize
            if score >= 80:
                results['excellent_links'].append(link_info)
            elif score >= 60:
                results['good_links'].append(link_info)
            elif score >= 40:
                results['acceptable_links'].append(link_info)
            elif score >= 20:
                results['poor_links'].append(link_info)
            else:
                results['bad_links'].append(link_info)

            # Track element chains
            chain_key = f"{parent_spell['element']} -> {child_spell['element']}"
            results['element_chains'][chain_key].append(f"{parent_spell['name']} -> {child_spell['name']}")

    if all_scores:
        results['avg_score'] = sum(all_scores) / len(all_scores)

    # Identify problematic patterns
    for chain, links in results['element_chains'].items():
        if '->' in chain:
            elems = chain.split(' -> ')
            if elems[0] != elems[1] and elems[0] != 'arcane' and elems[1] != 'arcane':
                if len(links) > 2:
                    results['problematic_patterns'].append({
                        'pattern': chain,
                        'count': len(links),
                        'examples': links[:3],
                    })

    return results


def print_analysis(results: Dict):
    """Print analysis results."""
    print(f"\n{'='*80}")
    print(f"LINK QUALITY ANALYSIS: {results['school']} - {results['ruleset'].upper()}")
    print(f"{'='*80}")

    if 'error' in results:
        print(f"ERROR: {results['error']}")
        return

    # Summary
    print(f"\nTotal Nodes: {results['total_nodes']}")
    print(f"Total Links: {results['total_links']}")
    print(f"Average Link Score: {results['avg_score']:.1f}/100")

    # Distribution
    print(f"\nLink Quality Distribution:")
    print(f"  Excellent (80+): {len(results['excellent_links'])} ({100*len(results['excellent_links'])/max(1,results['total_links']):.1f}%)")
    print(f"  Good (60-79):    {len(results['good_links'])} ({100*len(results['good_links'])/max(1,results['total_links']):.1f}%)")
    print(f"  Acceptable (40-59): {len(results['acceptable_links'])} ({100*len(results['acceptable_links'])/max(1,results['total_links']):.1f}%)")
    print(f"  Poor (20-39):    {len(results['poor_links'])} ({100*len(results['poor_links'])/max(1,results['total_links']):.1f}%)")
    print(f"  Bad (0-19):      {len(results['bad_links'])} ({100*len(results['bad_links'])/max(1,results['total_links']):.1f}%)")

    # Show excellent examples
    if results['excellent_links']:
        print(f"\n--- EXCELLENT LINKS (Samples) ---")
        for link in results['excellent_links'][:5]:
            print(f"  {link['parent']} ({link['parent_tier']}/{link['parent_element']}) -> {link['child']} ({link['child_tier']}/{link['child_element']})")
            print(f"    Score: {link['score']}")

    # Show problematic links
    if results['bad_links']:
        print(f"\n--- BAD LINKS (All) ---")
        for link in results['bad_links']:
            print(f"  {link['parent']} ({link['parent_tier']}/{link['parent_element']}) -> {link['child']} ({link['child_tier']}/{link['child_element']})")
            print(f"    Score: {link['score']}")
            for reason in link['reasons']:
                if reason.startswith('-'):
                    print(f"      {reason}")

    if results['poor_links']:
        print(f"\n--- POOR LINKS (Samples) ---")
        for link in results['poor_links'][:10]:
            print(f"  {link['parent']} ({link['parent_tier']}/{link['parent_element']}) -> {link['child']} ({link['child_tier']}/{link['child_element']})")
            print(f"    Score: {link['score']}")
            for reason in link['reasons']:
                if reason.startswith('-'):
                    print(f"      {reason}")

    # Problematic patterns
    if results['problematic_patterns']:
        print(f"\n--- PROBLEMATIC PATTERNS (Cross-Element Chains) ---")
        for pattern in results['problematic_patterns']:
            print(f"  {pattern['pattern']}: {pattern['count']} occurrences")
            for ex in pattern['examples']:
                print(f"    - {ex}")

    # Element chain summary
    print(f"\n--- ELEMENT CHAIN SUMMARY ---")
    for chain, links in sorted(results['element_chains'].items(), key=lambda x: -len(x[1])):
        elems = chain.split(' -> ')
        status = "OK" if elems[0] == elems[1] or 'arcane' in chain else "CROSS"
        print(f"  {chain}: {len(links)} links [{status}]")


def main():
    print("=" * 80)
    print("SPELL TREE LINK QUALITY ANALYZER")
    print("=" * 80)

    schools = ['Destruction', 'Conjuration', 'Restoration', 'Alteration', 'Illusion']
    rulesets = ['strict', 'thematic', 'organic']

    all_results = {}

    for school in schools:
        spells = load_spell_data(school)
        if not spells:
            print(f"WARNING: No spell data for {school}")
            continue

        print(f"\n{'#'*80}")
        print(f"# SCHOOL: {school.upper()}")
        print(f"{'#'*80}")

        school_results = {}
        for ruleset in rulesets:
            results = analyze_tree(school, ruleset, spells)
            school_results[ruleset] = results
            print_analysis(results)

        all_results[school] = school_results

    # Final comparison
    print("\n" + "=" * 80)
    print("OVERALL COMPARISON")
    print("=" * 80)

    print(f"\n{'School':<15} {'Ruleset':<12} {'Avg Score':>12} {'Excellent':>12} {'Bad':>8}")
    print("-" * 60)

    for school, rulesets_data in all_results.items():
        for ruleset, data in rulesets_data.items():
            if 'error' not in data:
                print(f"{school:<15} {ruleset:<12} {data['avg_score']:>11.1f} {len(data['excellent_links']):>11} {len(data['bad_links']):>7}")

    # Recommendations
    print("\n" + "=" * 80)
    print("RECOMMENDATIONS")
    print("=" * 80)

    # Find best ruleset per school
    for school, rulesets_data in all_results.items():
        best = max(
            [(r, d) for r, d in rulesets_data.items() if 'error' not in d],
            key=lambda x: x[1]['avg_score'],
            default=(None, None)
        )
        if best[0]:
            print(f"\n{school}:")
            print(f"  Best ruleset: {best[0]} (avg score: {best[1]['avg_score']:.1f})")

            # Common issues
            bad_count = len(best[1]['bad_links']) + len(best[1]['poor_links'])
            if bad_count > 0:
                print(f"  Issues: {bad_count} poor/bad links remaining")

                # Check for element issues
                cross_element = sum(1 for chain in best[1]['element_chains']
                                   if '->' in chain and chain.split(' -> ')[0] != chain.split(' -> ')[1]
                                   and 'arcane' not in chain)
                if cross_element > 0:
                    print(f"  Cross-element chains: {cross_element} patterns")


if __name__ == '__main__':
    main()
