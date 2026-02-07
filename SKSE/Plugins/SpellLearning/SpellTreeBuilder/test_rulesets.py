#!/usr/bin/env python3
"""
Rule Set Testing Harness for Spell Tree Builder

Tests different generation rule sets against actual school spell scans
and compares quality metrics.

Usage:
    python test_rulesets.py
    python test_rulesets.py --school Destruction
    python test_rulesets.py --ruleset strict
"""

import json
import os
import re
import sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional, Any
from collections import defaultdict

# =============================================================================
# RULE SET CONFIGURATIONS
# =============================================================================

RULESETS = {
    'strict': {
        'name': 'Strict Element Isolation',
        'description': 'Clean element chains, no cross-element links, strict tier ordering',
        'scoring': {
            'element_weight': 150,      # Very strong element preference
            'spell_type_weight': 40,
            'tier_adjacent_bonus': 50,
            'tier_skip_penalty': -100,  # Heavy penalty for skipping tiers
            'keyword_weight': 20,
            'effect_name_weight': 30,
            'description_weight': 20,
            'magicka_cost_weight': 0,   # Disabled
            'same_mod_weight': 0,       # Disabled
        },
        'rules': {
            'element_isolation': True,
            'element_isolation_strict': True,  # ONLY same-element
            'strict_tier_ordering': True,
            'allow_same_tier_links': False,
            'max_tier_skip': 1,
            'max_children_per_node': 3,
            'convergence_enabled': True,
            'convergence_chance': 0.3,
            'convergence_min_tier': 3,  # Expert+
            # Spell repetition (same spell at multiple positions)
            'spell_repetition_enabled': False,
            'spell_repetition_max': 0,
            # Tier mixing (spells can bleed into adjacent zones)
            'tier_mixing_enabled': False,
            'tier_mixing_range': 0,
        },
        # LLM edge case resolution
        'llm_edge_case': {
            'enabled': False,           # Strict = no LLM needed
            'threshold': 5,             # Score difference threshold
        },
    },

    'thematic': {
        'name': 'Thematic Coherence',
        'description': 'Keyword and effect matching, moderate element preference, some flexibility',
        'scoring': {
            'element_weight': 80,       # Moderate element preference
            'spell_type_weight': 50,    # Higher spell type importance
            'tier_adjacent_bonus': 40,
            'tier_skip_penalty': -30,
            'keyword_weight': 40,       # Higher keyword importance
            'effect_name_weight': 50,   # Higher effect matching
            'description_weight': 30,
            'magicka_cost_weight': 0,
            'same_mod_weight': 0,
        },
        'rules': {
            'element_isolation': True,
            'element_isolation_strict': False,  # Prefer but allow cross
            'strict_tier_ordering': True,
            'allow_same_tier_links': True,
            'max_tier_skip': 2,
            'max_children_per_node': 3,
            'convergence_enabled': True,
            'convergence_chance': 0.4,
            'convergence_min_tier': 3,
            # Spell repetition
            'spell_repetition_enabled': False,
            'spell_repetition_max': 0,
            # Tier mixing
            'tier_mixing_enabled': False,
            'tier_mixing_range': 0,
        },
        # LLM edge case resolution
        'llm_edge_case': {
            'enabled': True,            # Thematic benefits from LLM disambiguation
            'threshold': 10,            # Closer scores = more ambiguity
        },
    },

    'organic': {
        'name': 'Organic Growth',
        'description': 'Natural proximity-based growth, weak element preference, chaotic but connected',
        'scoring': {
            'element_weight': 30,       # Weak element preference
            'spell_type_weight': 20,
            'tier_adjacent_bonus': 30,
            'tier_skip_penalty': -10,   # Light penalty
            'keyword_weight': 15,
            'effect_name_weight': 20,
            'description_weight': 15,
            'magicka_cost_weight': 15,  # Enabled
            'same_mod_weight': 10,      # Enabled
        },
        'rules': {
            'element_isolation': False,
            'element_isolation_strict': False,
            'strict_tier_ordering': False,
            'allow_same_tier_links': True,
            'max_tier_skip': 3,
            'max_children_per_node': 4,  # More children allowed
            'convergence_enabled': True,
            'convergence_chance': 0.5,
            'convergence_min_tier': 2,  # Adept+
            # Spell repetition - organic allows it
            'spell_repetition_enabled': True,
            'spell_repetition_max': 2,  # Same spell can appear up to 2 times
            # Tier mixing - organic allows flexibility
            'tier_mixing_enabled': True,
            'tier_mixing_range': 1,     # Can bleed 1 tier zone
        },
        # LLM edge case resolution
        'llm_edge_case': {
            'enabled': True,            # Organic uses LLM for creative connections
            'threshold': 15,            # Higher threshold = more LLM usage
        },
    },
}

# =============================================================================
# ELEMENT DETECTION (from our V5 algorithm)
# =============================================================================

ELEMENT_CLUSTERS = {
    'fire': ['fire', 'flame', 'burn', 'incinerate', 'inferno', 'blaze', 'scorch', 'heat', 'magma', 'lava', 'ember', 'ash', 'pyre'],
    'frost': ['frost', 'ice', 'cold', 'freeze', 'blizzard', 'chill', 'glacial', 'hail', 'snow', 'frozen', 'cryo', 'sleet'],
    'shock': ['shock', 'spark', 'lightning', 'thunder', 'electric', 'volt', 'arc', 'static', 'jolt', 'crackle'],
    'earth': ['stone', 'rock', 'earth', 'boulder', 'crystal', 'quake', 'tremor', 'geo', 'terra', 'mineral', 'sand', 'mud'],
    'water': ['water', 'wave', 'tide', 'aqua', 'spray', 'torrent', 'flood', 'rain', 'stream', 'river', 'ocean', 'sea'],
    'wind': ['wind', 'gust', 'breeze', 'cyclone', 'tornado', 'tempest', 'gale', 'air', 'zephyr', 'current', 'howl'],
    'dark': ['dark', 'shadow', 'death', 'drain', 'soul', 'necrotic', 'void', 'curse', 'hex', 'blight', 'wither', 'choking', 'strangle'],
    'holy': ['holy', 'divine', 'sacred', 'radiant', 'blessed', 'purify', 'bane', 'undead', 'sun', 'light', 'celestial', 'mara'],
    'arcane': ['arcane', 'magic', 'elemental', 'chaos', 'energy', 'force', 'unbounded', 'mana', 'ether'],
}

SPELL_TYPES = {
    'projectile': ['bolt', 'spike', 'spear', 'shard', 'ball', 'lance', 'arrow', 'dart', 'throw'],
    'stream': ['stream', 'spray', 'breath', 'gout', 'flow', 'current'],
    'rune': ['rune', 'trap', 'mine', 'glyph', 'seal'],
    'cloak': ['cloak', 'shroud', 'aura', 'mantle', 'veil'],
    'wall': ['wall', 'barrier', 'fence'],
    'storm': ['storm', 'vortex', 'maelstrom', 'tempest', 'cyclone', 'blizzard'],
    'explosion': ['burst', 'blast', 'nova', 'explosion'],
    'touch': ['touch', 'hand', 'grasp', 'palm', 'fist', 'fingers'],
}

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
TIER_TO_IDX = {t: i for i, t in enumerate(TIER_ORDER)}


def detect_element(name: str, editor_id: str = '') -> str:
    """Detect element from spell name."""
    text = f"{name} {editor_id}".lower()

    scores = {}
    for element, keywords in ELEMENT_CLUSTERS.items():
        score = sum(3 if re.search(rf'\b{re.escape(kw)}\b', text) else (1 if kw in text else 0)
                   for kw in keywords)
        scores[element] = score

    if not any(scores.values()):
        return 'arcane'
    return max(scores, key=scores.get)


def detect_spell_type(name: str) -> str:
    """Detect spell type from name."""
    text = name.lower()
    for stype, keywords in SPELL_TYPES.items():
        if any(kw in text for kw in keywords):
            return stype
    return 'other'


def extract_keywords(name: str) -> Set[str]:
    """Extract keywords from spell name (4+ chars)."""
    return set(re.findall(r'\b\w{4,}\b', name.lower()))


# =============================================================================
# TREE BUILDER WITH CONFIGURABLE RULES
# =============================================================================

@dataclass
class SpellNode:
    form_id: str
    name: str
    tier: str
    tier_idx: int
    element: str
    spell_type: str
    keywords: Set[str]
    effect_names: List[str]
    magicka_cost: int
    mod_source: str
    children: List[str] = field(default_factory=list)
    prerequisites: List[str] = field(default_factory=list)
    depth: int = -1
    repetition_count: int = 1  # Track if spell appears multiple times


@dataclass
class LLMEdgeCaseEvent:
    """Tracks when LLM would be called for edge case resolution."""
    node_name: str
    node_form_id: str
    top_candidates: List[Tuple[str, str, float]]  # (form_id, name, score)
    score_difference: float
    threshold: float
    would_trigger: bool


def build_tree_with_ruleset(spells: List[Dict], ruleset: Dict, verbose: bool = False) -> Dict:
    """Build tree using specified ruleset configuration."""

    scoring = ruleset['scoring']
    rules = ruleset['rules']
    llm_config = ruleset.get('llm_edge_case', {'enabled': False, 'threshold': 10})

    # Track LLM edge case events
    llm_events: List[LLMEdgeCaseEvent] = []
    spell_usage_count: Dict[str, int] = defaultdict(int)  # Track spell repetitions

    # Create nodes
    nodes: Dict[str, SpellNode] = {}
    for s in spells:
        mod_source = s.get('persistentId', '').split('|')[0] if s.get('persistentId') else 'unknown'
        nodes[s['formId']] = SpellNode(
            form_id=s['formId'],
            name=s['name'],
            tier=s.get('skillLevel', 'Unknown'),
            tier_idx=TIER_TO_IDX.get(s.get('skillLevel', 'Unknown'), 5),
            element=detect_element(s['name'], s.get('editorId', '')),
            spell_type=detect_spell_type(s['name']),
            keywords=extract_keywords(s['name']),
            effect_names=s.get('effectNames', []),
            magicka_cost=s.get('magickaCost', 0),
            mod_source=mod_source,
        )

    # Group by element
    elem_groups: Dict[str, List[SpellNode]] = defaultdict(list)
    for node in nodes.values():
        elem_groups[node.element].append(node)

    # Find root (prefer vanilla Flames)
    root_id = None
    for s in spells:
        if s['name'] == 'Flames' and 'Skyrim.esm' in s.get('persistentId', ''):
            root_id = s['formId']
            break

    if not root_id:
        for n in nodes.values():
            if n.tier == 'Novice' and n.element == 'fire':
                root_id = n.form_id
                break

    if not root_id:
        root_id = next((n.form_id for n in nodes.values() if n.tier == 'Novice'), list(nodes.keys())[0])

    root = nodes[root_id]
    root.depth = 0
    connected: Set[str] = {root_id}

    # Track available parents per element
    elem_available: Dict[str, List[SpellNode]] = defaultdict(list)
    elem_available[root.element].append(root)

    # Connect element sub-roots to main root
    for elem, group in elem_groups.items():
        if elem == root.element:
            continue

        group.sort(key=lambda n: (n.tier_idx, n.name))
        novice_spells = [n for n in group if n.tier == 'Novice']
        if not novice_spells:
            novice_spells = [group[0]] if group else []

        for elem_root in novice_spells:
            if elem_root.form_id not in connected:
                root.children.append(elem_root.form_id)
                elem_root.prerequisites.append(root_id)
                elem_root.depth = 1
                connected.add(elem_root.form_id)
                elem_available[elem].append(elem_root)

    # Also connect other Novice spells of root's element
    for n in elem_groups.get(root.element, []):
        if n.form_id not in connected and n.tier == 'Novice':
            root.children.append(n.form_id)
            n.prerequisites.append(root_id)
            n.depth = 1
            connected.add(n.form_id)
            elem_available[root.element].append(n)

    # Connect remaining nodes using scoring
    all_nodes_sorted = sorted(
        [n for n in nodes.values() if n.form_id not in connected],
        key=lambda n: (n.tier_idx, n.element, n.name)
    )

    for node in all_nodes_sorted:
        if node.form_id in connected:
            continue

        # Find best parent using scoring (returns candidates for LLM edge case tracking)
        parent, candidates = find_best_parent_with_candidates(
            node, elem_available, connected, nodes, scoring, rules
        )

        # Track LLM edge case
        if llm_config['enabled'] and len(candidates) >= 2:
            score_diff = candidates[0][1] - candidates[1][1]
            would_trigger = score_diff <= llm_config['threshold']
            llm_events.append(LLMEdgeCaseEvent(
                node_name=node.name,
                node_form_id=node.form_id,
                top_candidates=[(c[0].form_id, c[0].name, c[1]) for c in candidates[:3]],
                score_difference=score_diff,
                threshold=llm_config['threshold'],
                would_trigger=would_trigger,
            ))
            if verbose and would_trigger:
                print(f"  LLM EDGE CASE: {node.name} - top 2 within {score_diff:.1f} pts")
                for c in candidates[:3]:
                    print(f"    -> {c[0].name}: {c[1]:.1f}")

        if parent:
            parent.children.append(node.form_id)
            node.prerequisites.append(parent.form_id)
            node.depth = parent.depth + 1
            connected.add(node.form_id)
            elem_available[node.element].append(node)
            spell_usage_count[node.form_id] += 1

    # Handle orphans
    orphans = [n for n in nodes.values() if n.form_id not in connected]
    for orphan in orphans:
        # Connect to any available parent
        for elem_nodes in elem_available.values():
            for p in elem_nodes:
                if len(p.children) < rules['max_children_per_node']:
                    p.children.append(orphan.form_id)
                    orphan.prerequisites.append(p.form_id)
                    orphan.depth = p.depth + 1
                    connected.add(orphan.form_id)
                    elem_available[orphan.element].append(orphan)
                    break
            if orphan.form_id in connected:
                break

        if orphan.form_id not in connected:
            # Force to root
            root.children.append(orphan.form_id)
            orphan.prerequisites.append(root_id)
            orphan.depth = 1
            connected.add(orphan.form_id)

    # Add convergence
    if rules['convergence_enabled']:
        add_convergence(nodes, elem_available, root_id, rules, scoring)

    # Count spell repetitions
    spell_repetitions = [name for name, count in spell_usage_count.items() if count > 1]

    # LLM edge case summary
    llm_triggers = [e for e in llm_events if e.would_trigger]

    # Output
    return {
        'root': root_id,
        'nodes': [{
            'formId': n.form_id,
            'children': list(set(n.children)),
            'prerequisites': list(set(n.prerequisites)),
            'element': n.element,
            'spellType': n.spell_type,
        } for n in nodes.values()],
        # Extended tracking data
        'llm_edge_cases': {
            'total_evaluations': len(llm_events),
            'would_trigger_count': len(llm_triggers),
            'events': [{
                'node': e.node_name,
                'score_diff': round(e.score_difference, 1),
                'threshold': e.threshold,
                'would_trigger': e.would_trigger,
                'candidates': [(name, round(score, 1)) for fid, name, score in e.top_candidates]
            } for e in llm_events[:20]]  # Limit to 20 for output size
        },
        'spell_repetition': {
            'enabled': rules.get('spell_repetition_enabled', False),
            'count': len(spell_repetitions),
            'spells': spell_repetitions[:10]  # Limit output
        }
    }


def find_best_parent_with_candidates(
    node: SpellNode,
    elem_available: Dict[str, List[SpellNode]],
    connected: Set[str],
    all_nodes: Dict[str, SpellNode],
    scoring: Dict,
    rules: Dict
) -> Tuple[Optional[SpellNode], List[Tuple[SpellNode, float]]]:
    """Find best parent using scoring rules. Returns (best_parent, sorted_candidates)."""

    candidates = []

    # Get candidates from appropriate elements
    if rules.get('element_isolation_strict'):
        search_elements = [node.element]
    elif rules.get('element_isolation'):
        search_elements = [node.element, 'arcane']  # Allow arcane as fallback
    else:
        search_elements = list(elem_available.keys())

    for elem in search_elements:
        for parent in elem_available.get(elem, []):
            if parent.form_id == node.form_id:
                continue
            if len(parent.children) >= rules['max_children_per_node']:
                continue

            # Tier checks
            tier_diff = node.tier_idx - parent.tier_idx
            if rules.get('strict_tier_ordering') and tier_diff < 0:
                continue
            if not rules.get('allow_same_tier_links') and tier_diff == 0:
                continue
            if tier_diff > rules.get('max_tier_skip', 3):
                continue

            # Calculate score
            score = calculate_link_score(node, parent, scoring)
            candidates.append((parent, score))

    if not candidates:
        # Fallback: search all elements
        for elem, parents in elem_available.items():
            for parent in parents:
                if parent.form_id == node.form_id:
                    continue
                if len(parent.children) >= rules['max_children_per_node']:
                    continue
                if parent.tier_idx > node.tier_idx:
                    continue

                score = calculate_link_score(node, parent, scoring) - 50  # Penalty for fallback
                candidates.append((parent, score))

    if candidates:
        candidates.sort(key=lambda x: -x[1])
        return candidates[0][0], candidates

    return None, []


def find_best_parent(
    node: SpellNode,
    elem_available: Dict[str, List[SpellNode]],
    connected: Set[str],
    all_nodes: Dict[str, SpellNode],
    scoring: Dict,
    rules: Dict
) -> Optional[SpellNode]:
    """Find best parent using scoring rules (legacy wrapper)."""
    parent, _ = find_best_parent_with_candidates(
        node, elem_available, connected, all_nodes, scoring, rules
    )
    return parent


def calculate_link_score(node: SpellNode, parent: SpellNode, scoring: Dict) -> float:
    """Calculate link score between two nodes."""
    score = 0.0

    # Element matching
    if node.element == parent.element:
        score += scoring['element_weight']

    # Spell type matching
    if node.spell_type == parent.spell_type:
        score += scoring['spell_type_weight']

    # Tier progression
    tier_diff = node.tier_idx - parent.tier_idx
    if tier_diff == 1:
        score += scoring['tier_adjacent_bonus']
    elif tier_diff == 2:
        score += scoring['tier_adjacent_bonus'] * 0.5
    elif tier_diff > 2:
        score += scoring['tier_skip_penalty']

    # Keyword matching
    shared_keywords = node.keywords & parent.keywords
    score += len(shared_keywords) * scoring['keyword_weight']

    # Effect name matching
    shared_effects = set(node.effect_names) & set(parent.effect_names)
    score += len(shared_effects) * scoring['effect_name_weight']

    # Magicka cost proximity
    if scoring['magicka_cost_weight'] > 0 and node.magicka_cost > 0 and parent.magicka_cost > 0:
        cost_ratio = min(node.magicka_cost, parent.magicka_cost) / max(node.magicka_cost, parent.magicka_cost)
        if cost_ratio > 0.8:  # Within 20%
            score += scoring['magicka_cost_weight']

    # Same mod source
    if scoring['same_mod_weight'] > 0 and node.mod_source == parent.mod_source:
        score += scoring['same_mod_weight']

    # Prefer parents with fewer children
    score -= len(parent.children) * 10

    return score


def add_convergence(
    nodes: Dict[str, SpellNode],
    elem_available: Dict[str, List[SpellNode]],
    root_id: str,
    rules: Dict,
    scoring: Dict
):
    """Add convergence (multi-prereqs) to high-tier spells."""

    import random

    for node in nodes.values():
        if node.tier_idx < rules['convergence_min_tier']:
            continue
        if len(node.prerequisites) >= 2:
            continue
        if random.random() > rules['convergence_chance']:
            continue

        # Find second parent in same element
        candidates = []
        for parent in elem_available.get(node.element, []):
            if parent.form_id == node.form_id:
                continue
            if parent.form_id in node.prerequisites:
                continue
            if parent.tier_idx >= node.tier_idx:
                continue
            if len(parent.children) >= rules['max_children_per_node']:
                continue

            score = calculate_link_score(node, parent, scoring)
            candidates.append((parent, score))

        if candidates:
            candidates.sort(key=lambda x: -x[1])
            second_parent = candidates[0][0]
            second_parent.children.append(node.form_id)
            node.prerequisites.append(second_parent.form_id)


# =============================================================================
# QUALITY METRICS
# =============================================================================

def analyze_quality(tree: Dict, spells: List[Dict]) -> Dict:
    """Analyze tree quality metrics."""

    nodes = {n['formId']: n for n in tree['nodes']}
    spell_data = {s['formId']: s for s in spells}

    # Build element/tier maps
    elements = {}
    tiers = {}
    for s in spells:
        elements[s['formId']] = detect_element(s['name'], s.get('editorId', ''))
        tiers[s['formId']] = TIER_TO_IDX.get(s.get('skillLevel', 'Unknown'), -1)

    metrics = {
        'total_nodes': len(nodes),
        'element_mismatches': 0,
        'tier_violations': 0,
        'max_children_violations': 0,
        'convergence_count': 0,
        'unreachable': 0,
        'max_depth': 0,
        'child_distribution': defaultdict(int),
        'element_distribution': defaultdict(int),
        # LLM edge case tracking
        'llm_evaluations': tree.get('llm_edge_cases', {}).get('total_evaluations', 0),
        'llm_triggers': tree.get('llm_edge_cases', {}).get('would_trigger_count', 0),
        # Spell repetition tracking
        'spell_repetition_enabled': tree.get('spell_repetition', {}).get('enabled', False),
        'spell_repetitions': tree.get('spell_repetition', {}).get('count', 0),
    }

    for fid, node in nodes.items():
        child_count = len(node.get('children', []))
        metrics['child_distribution'][child_count] += 1

        if fid != tree['root'] and child_count > 3:
            metrics['max_children_violations'] += 1

        prereqs = node.get('prerequisites', [])
        if len(prereqs) >= 2:
            metrics['convergence_count'] += 1

        node_elem = elements.get(fid, 'other')
        metrics['element_distribution'][node_elem] += 1

        # Element mismatch (excluding root connections)
        for prereq_id in prereqs:
            if prereq_id == tree['root']:
                continue  # Skip root connections
            prereq_elem = elements.get(prereq_id, 'other')
            if node_elem not in ('arcane', 'other') and prereq_elem not in ('arcane', 'other'):
                if prereq_elem != node_elem:
                    metrics['element_mismatches'] += 1

        # Tier violation
        node_tier = tiers.get(fid, -1)
        if node_tier >= 3:  # Expert+
            for prereq_id in prereqs:
                prereq_tier = tiers.get(prereq_id, -1)
                if prereq_tier >= 0 and prereq_tier < node_tier - 2:
                    metrics['tier_violations'] += 1
                    break

    # Reachability
    root_id = tree['root']
    unlocked = {root_id}
    changed = True
    while changed:
        changed = False
        for fid, node in nodes.items():
            if fid in unlocked:
                continue
            prereqs = node.get('prerequisites', [])
            if not prereqs or all(p in unlocked for p in prereqs):
                unlocked.add(fid)
                changed = True

    metrics['unreachable'] = len(nodes) - len(unlocked)

    # Max depth
    depths = {}
    depths[root_id] = 0
    changed = True
    while changed:
        changed = False
        for fid, node in nodes.items():
            if fid in depths:
                continue
            prereqs = node.get('prerequisites', [])
            if prereqs and all(p in depths for p in prereqs):
                depths[fid] = max(depths[p] for p in prereqs) + 1
                changed = True

    metrics['max_depth'] = max(depths.values()) if depths else 0

    return metrics


def print_comparison(results: Dict[str, Dict]):
    """Print comparison table of rulesets."""

    print("\n" + "=" * 80)
    print("RULESET COMPARISON")
    print("=" * 80)

    # Header
    print(f"\n{'Metric':<30}", end="")
    for name in results.keys():
        print(f"{name:>15}", end="")
    print()
    print("-" * (30 + 15 * len(results)))

    # Metrics
    metric_names = [
        ('total_nodes', 'Total Nodes'),
        ('element_mismatches', 'Element Mismatches'),
        ('tier_violations', 'Tier Violations'),
        ('max_children_violations', 'Max Children Violations'),
        ('convergence_count', 'Convergence (multi-prereq)'),
        ('unreachable', 'Unreachable Nodes'),
        ('max_depth', 'Max Tree Depth'),
        ('llm_evaluations', 'LLM Evaluations'),
        ('llm_triggers', 'LLM Would Trigger'),
        ('spell_repetitions', 'Spell Repetitions'),
    ]

    for key, label in metric_names:
        print(f"{label:<30}", end="")
        for name, data in results.items():
            value = data['metrics'].get(key, 0)
            print(f"{value:>15}", end="")
        print()

    # Best ruleset summary
    print("\n" + "-" * 80)
    print("QUALITY SCORE (lower is better):")
    for name, data in results.items():
        m = data['metrics']
        # Weight: element mismatches heavily, tier violations moderately
        score = (m['element_mismatches'] * 10 +
                 m['tier_violations'] * 5 +
                 m['max_children_violations'] * 3 +
                 m['unreachable'] * 100)
        print(f"  {name}: {score}")


# =============================================================================
# MAIN
# =============================================================================

def main():
    import argparse

    parser = argparse.ArgumentParser(description='Test tree generation rulesets')
    parser.add_argument('--school', type=str, default='Destruction', help='School to test')
    parser.add_argument('--ruleset', type=str, help='Specific ruleset to test (or all)')
    parser.add_argument('--verbose', action='store_true', help='Verbose output')
    args = parser.parse_args()

    # Find school spell files
    schools_dir = Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools')

    if not schools_dir.exists():
        print(f"ERROR: Schools directory not found: {schools_dir}")
        return

    # Load spell data
    school_file = schools_dir / f"{args.school}_spells.json"
    if not school_file.exists():
        print(f"ERROR: School file not found: {school_file}")
        print(f"Available: {[f.stem for f in schools_dir.glob('*_spells.json')]}")
        return

    with open(school_file) as f:
        data = json.load(f)
    spells = data.get('spells', [])

    print("=" * 80)
    print(f"TESTING RULESETS ON {args.school.upper()}")
    print("=" * 80)
    print(f"\nSpells: {len(spells)}")

    # Determine which rulesets to test
    rulesets_to_test = RULESETS
    if args.ruleset:
        if args.ruleset in RULESETS:
            rulesets_to_test = {args.ruleset: RULESETS[args.ruleset]}
        else:
            print(f"ERROR: Unknown ruleset '{args.ruleset}'")
            print(f"Available: {list(RULESETS.keys())}")
            return

    # Test each ruleset
    results = {}

    for ruleset_name, ruleset_config in rulesets_to_test.items():
        print(f"\n{'='*40}")
        print(f"RULESET: {ruleset_name}")
        print(f"  {ruleset_config['description']}")
        print(f"{'='*40}")

        # Build tree
        tree = build_tree_with_ruleset(spells, ruleset_config, verbose=args.verbose)

        # Analyze
        metrics = analyze_quality(tree, spells)

        results[ruleset_name] = {
            'tree': tree,
            'metrics': metrics,
        }

        # Print individual results
        print(f"\nResults:")
        print(f"  Element mismatches: {metrics['element_mismatches']}")
        print(f"  Tier violations: {metrics['tier_violations']}")
        print(f"  Max children violations: {metrics['max_children_violations']}")
        print(f"  Convergence count: {metrics['convergence_count']}")
        print(f"  Unreachable nodes: {metrics['unreachable']}")
        print(f"  Max depth: {metrics['max_depth']}")
        print(f"  Elements: {dict(metrics['element_distribution'])}")

        # LLM edge case info
        llm_info = tree.get('llm_edge_cases', {})
        if llm_info.get('total_evaluations', 0) > 0:
            trigger_pct = (llm_info['would_trigger_count'] / llm_info['total_evaluations']) * 100
            print(f"\n  LLM Edge Cases:")
            print(f"    Total evaluations: {llm_info['total_evaluations']}")
            print(f"    Would trigger LLM: {llm_info['would_trigger_count']} ({trigger_pct:.1f}%)")

            # Show some example triggers
            triggers = [e for e in llm_info.get('events', []) if e['would_trigger']]
            if triggers and args.verbose:
                print(f"    Example triggers:")
                for t in triggers[:5]:
                    print(f"      - {t['node']}: diff={t['score_diff']}, candidates={t['candidates'][:2]}")

        # Spell repetition info
        rep_info = tree.get('spell_repetition', {})
        if rep_info.get('enabled'):
            print(f"\n  Spell Repetition:")
            print(f"    Enabled: {rep_info.get('enabled')}")
            print(f"    Repeated spells: {rep_info.get('count', 0)}")

    # Print comparison
    if len(results) > 1:
        print_comparison(results)

    # Save results
    output_dir = Path(__file__).parent / 'test_output'
    output_dir.mkdir(exist_ok=True)

    for name, data in results.items():
        output_file = output_dir / f"{args.school}_{name}_tree.json"
        with open(output_file, 'w') as f:
            json.dump(data['tree'], f, indent=2)
        print(f"\nSaved: {output_file}")


if __name__ == '__main__':
    main()
