#!/usr/bin/env python3
"""
Graph Growth -- Edmonds' Arborescence Tree Builder

Builds spell trees using minimum spanning arborescences (NetworkX) to find
globally optimal directed trees per school. A weighted digraph is constructed
for every ordered (parent, child) pair, with edge costs blending metadata
signals (tier ordering, effect-name affinity) and NLP signals (TF-IDF cosine
similarity on combined spell text). The chaos parameter controls the blend:
    cost = (1 - chaos) * w_metadata + chaos * w_nlp

Lower cost = better parent-child relationship.

After the arborescence is extracted, a branching-factor cap is enforced
(weakest children rerouted to best sibling) and tier-ordering violations are
flagged and repaired.

Output format matches the standard tree builder (classic_build_tree.py) so the
JS layout, apply, and PRM systems work unchanged.

Reuses shared modules from SpellTreeBuilder/:
  - core.node (TreeNode, link_nodes, unlink_nodes)
  - theme_discovery (discover_themes_per_school, extract_spell_text)
  - config (TreeBuilderConfig)
  - validator (validate_tree, fix_unreachable_nodes, get_validation_summary)
  - prereq_master_scorer (tokenize, build_text, compute_tfidf,
                          cosine_similarity, char_ngram_similarity)
  - spell_grouper (get_spell_primary_theme)
"""

import json
import random
import sys
import time
import traceback
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Set

# Shared modules live in SpellTreeBuilder/ -- server.py adds it to sys.path
from core.node import TreeNode, link_nodes, unlink_nodes
from theme_discovery import extract_spell_text, discover_themes_per_school
from validator import validate_tree, get_validation_summary, fix_unreachable_nodes
from prereq_master_scorer import tokenize, build_text, compute_tfidf
from prereq_master_scorer import cosine_similarity as _cosine_sim
from prereq_master_scorer import char_ngram_similarity
from spell_grouper import get_spell_primary_theme

# NetworkX -- optional, with greedy fallback
try:
    import networkx as nx
    HAS_NETWORKX = True
except ImportError:
    HAS_NETWORKX = False
    nx = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
TIER_INDEX = {t: i for i, t in enumerate(TIER_ORDER)}

# School colors (matching JS renderer DendrogramRenderer.SCHOOL_COLORS)
SCHOOL_COLORS = {
    'Alteration':  '#22c55e',
    'Conjuration': '#a855f7',
    'Destruction': '#ef4444',
    'Illusion':    '#38bdf8',
    'Restoration': '#facc15',
}

# Log to SpellTreeBuilder's log directory
LOG_FILE = (
    Path(__file__).resolve().parent.parent.parent.parent.parent.parent.parent
    / "SKSE" / "Plugins" / "SpellLearning" / "SpellTreeBuilder"
    / "graph_build_tree.log"
)


def _log(msg: str):
    """Append a timestamped line to the log file."""
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def graph_build_tree_from_data(spells: list, config_dict: dict) -> dict:
    """
    Build globally-optimal spell trees using Edmonds' arborescence algorithm.

    Args:
        spells: List of spell dicts with formId, name, school, skillLevel, etc.
        config_dict: Configuration dict from JS.

    Returns:
        dict: Tree data in standard format {schools: {name: {root, nodes, ...}}, ...}
    """
    config = dict(config_dict)

    # ----- Seed setup -----
    if config.get('seed') is not None:
        used_seed = int(config['seed'])
    else:
        used_seed = int(time.time() * 1000) % 1000000
    random.seed(used_seed)
    config['seed'] = used_seed

    _log(f"graph_build_tree: seed={used_seed}, {len(spells)} spells, "
         f"networkx={'yes' if HAS_NETWORKX else 'NO (greedy fallback)'}")

    # ----- Config defaults -----
    chaos = max(0.0, min(1.0, float(config.get('chaos', 0.3))))
    force_balance = max(0.0, min(1.0, float(config.get('force_balance', 0.5))))
    max_children = max(1, min(8, int(config.get('max_children_per_node', 4))))
    config.setdefault('top_themes_per_school', 8)
    config.setdefault('auto_fix_unreachable', True)
    config.setdefault('prefer_vanilla_roots', True)

    # Adapt max_children based on grid layout hint from JS
    grid_hint = config.get('grid_hint')
    if grid_hint:
        mode = grid_hint.get('mode', 'sun')
        avg_pts = grid_hint.get('avgPointsPerSchool', 0)
        _log(f"Grid hint: mode={mode}, schools={grid_hint.get('schoolCount')}, avgPts={avg_pts}")

        if mode == 'sun' and max_children > 3:
            if avg_pts < 40:
                max_children = 3
                _log(f"  SUN + tight grid -> max_children reduced to 3")
        elif mode == 'flat' and max_children < 5:
            if avg_pts > 60:
                max_children = 5
                _log(f"  FLAT + spacious grid -> max_children increased to 5")

    config['max_children_per_node'] = max_children

    # ----- Group spells by school -----
    school_spells: Dict[str, List[dict]] = defaultdict(list)
    for spell in spells:
        school = spell.get('school', 'Unknown')
        if not school or school in ('null', 'undefined', 'None', ''):
            school = 'Hedge Wizard'
        school_spells[school].append(spell)

    # ----- Discover themes per school for NLP-guided parent matching -----
    try:
        themes_per_school = discover_themes_per_school(
            spells,
            top_n=config.get('top_themes_per_school', 8),
            fallback=True
        )
    except Exception as e:
        _log(f"Theme discovery failed: {e}")
        themes_per_school = {}

    # Merge with vanilla hints to ensure coverage for known schools
    try:
        from theme_discovery import merge_with_hints
        themes_per_school = merge_with_hints(
            themes_per_school,
            max_themes=config.get('top_themes_per_school', 8) + 4
        )
    except Exception as e:
        _log(f"merge_with_hints failed (non-critical): {e}")

    # ----- Build each school's tree (per-school similarity computation) -----
    tree_data: Dict[str, Any] = {'version': '1.0', 'schools': {}}

    for school_name, school_spell_list in school_spells.items():
        t_school = time.monotonic()
        _log(f"Building {school_name}: {len(school_spell_list)} spells")

        # Compute similarity matrix PER SCHOOL (much faster than global)
        school_similarities = _compute_similarity_matrix(school_spell_list)

        school_themes = themes_per_school.get(school_name, [])
        result = _build_school_tree(
            school_spell_list, school_name, school_themes,
            school_similarities, max_children, chaos, force_balance, config
        )
        if result:
            tree_data['schools'][school_name] = result
            elapsed = time.monotonic() - t_school
            _log(f"  {school_name}: {len(result['nodes'])} nodes, root={result['root']} "
                 f"({elapsed:.1f}s total)")

    # ----- Cross-school chaos edges -----
    if chaos > 0.3 and len(tree_data['schools']) > 1:
        t_cross = time.monotonic()
        _log("Computing cross-school similarities (text-only, lightweight)...")
        cross_similarities = _compute_cross_school_similarities(spells, school_spells)
        _apply_cross_school_edges(tree_data, cross_similarities, chaos, max_children)
        _log(f"  Cross-school edges: {time.monotonic() - t_cross:.1f}s")

    # ----- Metadata -----
    tree_data['generatedAt'] = datetime.now().isoformat()
    tree_data['generator'] = 'GraphTreeBuilder (Edmonds Arborescence)'
    tree_data['config'] = {
        'shape': 'graph_arborescence',
        'chaos': chaos,
        'force_balance': force_balance,
        'density': config.get('density', 0.6),
        'symmetry': config.get('symmetry', 0.3),
    }
    tree_data['seed'] = used_seed

    # ----- Validate and auto-fix -----
    validation = validate_tree(tree_data, max_children)
    summary = get_validation_summary(validation)

    if summary['total_errors'] > 0 and config.get('auto_fix_unreachable', True):
        total_fixes = 0
        for sn, sd in tree_data.get('schools', {}).items():
            nodes_list = sd.get('nodes', [])
            nodes_dict = {n['formId']: n for n in nodes_list}
            root_id = sd.get('root')
            if root_id:
                fixes = fix_unreachable_nodes(nodes_dict, root_id, max_children)
                if fixes > 0:
                    total_fixes += fixes
                    sd['nodes'] = list(nodes_dict.values())
        if total_fixes > 0:
            _log(f"Auto-fixed {total_fixes} unreachable nodes")
            validation = validate_tree(tree_data, max_children)
            summary = get_validation_summary(validation)

    tree_data['validation'] = {
        'all_valid': summary['all_valid'],
        'total_nodes': summary['total_nodes'],
        'reachable_nodes': summary['reachable_nodes'],
    }

    _log(f"graph_build_tree complete: {summary['total_nodes']} nodes, "
         f"valid={summary['all_valid']}")
    return tree_data


# ---------------------------------------------------------------------------
# Per-school tree construction
# ---------------------------------------------------------------------------

def _build_school_tree(
    spells: List[dict],
    school_name: str,
    themes: List[str],
    similarities: dict,
    max_children: int,
    chaos: float,
    force_balance: float,
    config: dict
) -> Optional[dict]:
    """Build one school's tree via Edmonds' arborescence (or greedy fallback)."""

    if not spells:
        return None

    # ---- Group spells by tier ----
    by_tier: Dict[str, List[dict]] = {t: [] for t in TIER_ORDER}
    unknown_tier: List[dict] = []

    for spell in spells:
        tier = spell.get('skillLevel', '')
        if tier in TIER_INDEX:
            by_tier[tier].append(spell)
        else:
            unknown_tier.append(spell)

    # Assign unknown-tier spells to Novice (safest default)
    by_tier['Novice'].extend(unknown_tier)

    # ---- Pick root ----
    root_spell = _pick_root(by_tier, config)
    if not root_spell:
        return None
    root_id = root_spell['formId']

    # ---- Create TreeNode objects ----
    nodes: Dict[str, TreeNode] = {}
    for spell in spells:
        node = TreeNode.from_spell(spell)
        nodes[node.form_id] = node
    for spell in unknown_tier:
        fid = spell.get('formId', '')
        if fid and fid not in nodes:
            nodes[fid] = TreeNode.from_spell(spell)

    root_node = nodes[root_id]
    root_node.is_root = True
    root_node.depth = 0

    # ---- Assign themes to nodes ----
    _assign_themes(nodes, spells, themes)

    # ---- Build directed graph and extract arborescence ----
    all_fids = list(nodes.keys())

    if HAS_NETWORKX and len(all_fids) >= 2:
        try:
            arb_edges = _edmonds_arborescence(
                all_fids, root_id, nodes, similarities, chaos, force_balance
            )
            _log(f"  {school_name}: Edmonds arborescence returned {len(arb_edges)} edges")
        except Exception as e:
            _log(f"  {school_name}: Edmonds failed ({e}), using greedy fallback")
            arb_edges = None
    else:
        arb_edges = None

    if arb_edges is not None:
        # Apply arborescence edges to TreeNode structure
        _apply_arborescence(nodes, root_id, arb_edges)
    else:
        # Greedy fallback (tier-ordered, similarity-guided)
        _log(f"  {school_name}: Using greedy fallback builder")
        _greedy_build(nodes, root_id, by_tier, similarities, max_children, chaos)

    # ---- Constrain branching factor ----
    _constrain_branching(nodes, root_id, max_children, similarities, force_balance)

    # ---- Enforce tier ordering ----
    _enforce_tier_ordering(nodes, root_id, max_children, similarities)

    # ---- Assign depths via BFS ----
    _assign_depths_bfs(nodes, root_id)

    # ---- Serialize ----
    node_dicts = [n.to_dict() for n in nodes.values()]

    return {
        'root': root_id,
        'layoutStyle': 'graph_arborescence',
        'color': SCHOOL_COLORS.get(school_name, '#888888'),
        'nodes': node_dicts,
        'config_used': {
            'shape': 'graph_arborescence',
            'chaos': chaos,
            'force_balance': force_balance,
            'density': config.get('density', 0.6),
            'symmetry': config.get('symmetry', 0.3),
            'source': 'graph'
        }
    }


# ---------------------------------------------------------------------------
# Edmonds' minimum spanning arborescence
# ---------------------------------------------------------------------------

def _edmonds_arborescence(
    all_fids: List[str],
    root_id: str,
    nodes: Dict[str, TreeNode],
    similarities: dict,
    chaos: float,
    force_balance: float
) -> List[Tuple[str, str]]:
    """
    Build a sparse weighted digraph and extract the minimum spanning
    arborescence rooted at root_id using NetworkX.

    Uses K-nearest-neighbors per node to keep the graph sparse (O(N*K) edges
    instead of O(N^2)), which makes Edmonds' algorithm run in seconds rather
    than minutes for large schools (e.g. Destruction with 498 spells).

    Returns:
        List of (parent_fid, child_fid) edges forming the arborescence.

    Raises:
        nx.NetworkXException if no arborescence exists.
    """
    t0 = time.monotonic()

    K = 20  # Keep top K parent candidates per child
    n = len(all_fids)

    # Pre-compute tier indices
    tier_idx_map: Dict[str, int] = {}
    for fid in all_fids:
        tier_idx_map[fid] = TIER_INDEX.get(nodes[fid].tier, 0)

    G = nx.DiGraph()
    for fid in all_fids:
        G.add_node(fid)

    # For each potential child, find the top K cheapest parent candidates
    total_cost_evals = 0
    for child_fid in all_fids:
        if child_fid == root_id:
            continue

        child_node = nodes[child_fid]
        child_tier_idx = tier_idx_map[child_fid]

        # Compute cost for valid parent candidates (tier-filtered)
        candidates: List[Tuple[str, float]] = []
        for parent_fid in all_fids:
            if parent_fid == child_fid:
                continue

            parent_tier_idx = tier_idx_map[parent_fid]

            # Skip parents 2+ tiers above child (would be tier-order violation)
            if parent_tier_idx > child_tier_idx + 1:
                continue

            cost = _compute_edge_cost(
                parent_fid, child_fid,
                nodes[parent_fid], child_node,
                parent_tier_idx, child_tier_idx,
                similarities, chaos, force_balance
            )
            candidates.append((parent_fid, cost))
            total_cost_evals += 1

        # Keep top K cheapest parents
        candidates.sort(key=lambda x: x[1])
        added_root = False
        for parent_fid, cost in candidates[:K]:
            G.add_edge(parent_fid, child_fid, weight=cost)
            if parent_fid == root_id:
                added_root = True

        # Ensure root always has a path to this child (arborescence reachability)
        if not added_root:
            root_tier_idx = tier_idx_map[root_id]
            cost = _compute_edge_cost(
                root_id, child_fid,
                nodes[root_id], child_node,
                root_tier_idx, child_tier_idx,
                similarities, chaos, force_balance
            )
            G.add_edge(root_id, child_fid, weight=cost)

    t_graph = time.monotonic()
    _log(f"    Graph built: {n} nodes, {G.number_of_edges()} edges "
         f"({total_cost_evals} cost evals) in {t_graph - t0:.1f}s")

    # Find minimum spanning arborescence rooted at root_id
    arb = nx.minimum_spanning_arborescence(G, attr='weight')

    t_arb = time.monotonic()
    _log(f"    Edmonds arborescence: {arb.number_of_edges()} edges "
         f"in {t_arb - t_graph:.1f}s")

    # Extract edges as (parent, child) pairs
    return list(arb.edges())


def _compute_edge_cost(
    parent_fid: str,
    child_fid: str,
    parent_node: TreeNode,
    child_node: TreeNode,
    parent_tier_idx: int,
    child_tier_idx: int,
    similarities: dict,
    chaos: float,
    force_balance: float
) -> float:
    """
    Compute directed edge cost for parent -> child.

    Lower cost = more desirable parent-child relationship.
    Blends metadata-based cost and NLP-based cost via chaos parameter.
    """
    # ---- Metadata cost (w_metadata) ----
    w_metadata = 0.0

    # Tier ordering: parent tier should be < child tier (progression)
    tier_diff = child_tier_idx - parent_tier_idx
    if tier_diff <= 0:
        # Parent at same or higher tier than child: heavy penalty
        # tier_diff=0 means same tier (mild penalty), negative = wrong direction
        w_metadata += 50.0 + abs(tier_diff) * 30.0
    elif tier_diff == 1:
        # Ideal: parent is exactly one tier below child
        w_metadata += 0.0
    elif tier_diff == 2:
        # Acceptable: skips one tier
        w_metadata += 10.0
    else:
        # Large tier gap: increasing penalty
        w_metadata += 5.0 * (tier_diff - 1)

    # School match bonus (same school = lower cost)
    if parent_node.school == child_node.school:
        w_metadata -= 5.0
    else:
        w_metadata += 15.0

    # Effect-name affinity via char_ngram_similarity
    key = f"{parent_fid}:{child_fid}"
    effect_sim = similarities['effect_sims'].get(key, 0.0)
    # Higher similarity -> lower cost (invert)
    w_metadata -= effect_sim * 30.0

    # Name similarity bonus
    name_sim = similarities['name_sims'].get(key, 0.0)
    w_metadata -= name_sim * 10.0

    # ---- NLP cost (w_nlp) ----
    # TF-IDF cosine similarity on combined spell text
    text_sim = similarities['text_sims'].get(key, 0.0)
    # Invert: high similarity = low cost. Scale to comparable range as metadata.
    w_nlp = (1.0 - text_sim) * 60.0

    # ---- Blend ----
    cost = (1.0 - chaos) * w_metadata + chaos * w_nlp

    # ---- Force-balance penalty ----
    # Add a small random jitter modulated by force_balance to discourage
    # star-shaped trees (all nodes connecting to root).
    # Higher force_balance = more jitter = more spread-out trees.
    jitter = random.uniform(0.0, force_balance * 5.0)
    cost += jitter

    # Ensure cost is non-negative (NetworkX requirement for some algorithms)
    return max(0.001, cost)


# ---------------------------------------------------------------------------
# Apply arborescence edges to TreeNode graph
# ---------------------------------------------------------------------------

def _apply_arborescence(
    nodes: Dict[str, TreeNode],
    root_id: str,
    edges: List[Tuple[str, str]]
):
    """Wire up TreeNode children/prerequisites from arborescence edges."""
    # Clear existing links
    for node in nodes.values():
        node.children = []
        node.prerequisites = []

    # Apply edges
    for parent_fid, child_fid in edges:
        parent = nodes.get(parent_fid)
        child = nodes.get(child_fid)
        if parent and child:
            link_nodes(parent, child)

    # Mark root
    root = nodes.get(root_id)
    if root:
        root.is_root = True
        root.prerequisites = []


# ---------------------------------------------------------------------------
# Greedy fallback builder (used when NetworkX is unavailable)
# ---------------------------------------------------------------------------

def _greedy_build(
    nodes: Dict[str, TreeNode],
    root_id: str,
    by_tier: Dict[str, List[dict]],
    similarities: dict,
    max_children: int,
    chaos: float
):
    """
    Greedy tier-ordered tree builder as fallback when NetworkX is unavailable
    or the arborescence algorithm fails.

    Similar to classic_build_tree's approach: iterate tiers, attach each spell
    to its best available parent from a lower tier.
    """
    # Clear existing links
    for node in nodes.values():
        node.children = []
        node.prerequisites = []

    root = nodes[root_id]
    root.is_root = True
    root.depth = 0

    connected: Set[str] = {root_id}
    # Track available parents by tier index
    available: Dict[int, List[TreeNode]] = defaultdict(list)
    available[0].append(root)

    for tier_idx, tier_name in enumerate(TIER_ORDER):
        tier_spells = by_tier.get(tier_name, [])
        tier_spells = [s for s in tier_spells if s['formId'] != root_id]

        if not tier_spells:
            continue

        random.shuffle(tier_spells)
        placed_this_tier: List[TreeNode] = []

        for spell in tier_spells:
            fid = spell['formId']
            if fid in connected:
                continue
            node = nodes.get(fid)
            if not node:
                continue

            # Find best parent from lower tiers
            best_parent = None
            best_score = -float('inf')

            for search_tier in range(tier_idx, -1, -1):
                for candidate in available.get(search_tier, []):
                    if len(candidate.children) >= max_children:
                        continue

                    score = 0.0
                    key = f"{fid}:{candidate.form_id}"

                    # Effect-name affinity
                    effect_sim = similarities['effect_sims'].get(key, 0.0)
                    score += effect_sim * 40.0

                    # Text similarity (weighted by chaos)
                    text_sim = similarities['text_sims'].get(key, 0.0)
                    score += text_sim * 30.0 * chaos

                    # Name similarity
                    name_sim = similarities['name_sims'].get(key, 0.0)
                    score += name_sim * 20.0

                    # Theme match
                    if node.theme and candidate.theme and node.theme == candidate.theme:
                        score += 15.0

                    # Prefer immediate predecessor tier
                    td = tier_idx - search_tier
                    if td == 1:
                        score += 10.0
                    elif td == 0:
                        score += 5.0
                    elif td > 2:
                        score -= (td - 2) * 5.0

                    # Load balance
                    score -= len(candidate.children) * 6.0

                    # Jitter
                    score += random.uniform(-2.0, 2.0)

                    if score > best_score:
                        best_score = score
                        best_parent = candidate

                if best_parent is not None:
                    break  # Found a parent at this tier distance

            if best_parent:
                link_nodes(best_parent, node)
                node.depth = tier_idx
                connected.add(fid)
                placed_this_tier.append(node)

                if len(best_parent.children) >= max_children:
                    for d in list(available.keys()):
                        available[d] = [
                            p for p in available[d]
                            if p.form_id != best_parent.form_id
                        ]

        # Add placed nodes as available parents for next tier
        for placed_node in placed_this_tier:
            if len(placed_node.children) < max_children:
                available[tier_idx].append(placed_node)

        _log(f"  Greedy tier {tier_name}: {len(placed_this_tier)}/{len(tier_spells)} placed")

    # Force-connect remaining unconnected nodes
    unconnected = [fid for fid in nodes if fid not in connected]
    if unconnected:
        _log(f"  Greedy: {len(unconnected)} unconnected, force-attaching to root")
        root = nodes[root_id]
        for fid in unconnected:
            node = nodes.get(fid)
            if node:
                link_nodes(root, node)
                connected.add(fid)


# ---------------------------------------------------------------------------
# Branching factor constraint
# ---------------------------------------------------------------------------

def _constrain_branching(
    nodes: Dict[str, TreeNode],
    root_id: str,
    max_children: int,
    similarities: dict,
    force_balance: float
):
    """
    Enforce max_children per node. Nodes exceeding the limit get their
    weakest children rerouted to the best available sibling.
    """
    changed = True
    passes = 0
    max_passes = 10

    while changed and passes < max_passes:
        changed = False
        passes += 1

        for fid, node in list(nodes.items()):
            if len(node.children) <= max_children:
                continue

            # Score each child by affinity to this parent
            child_scores: List[Tuple[float, str]] = []
            for child_fid in node.children:
                key = f"{fid}:{child_fid}"
                score = 0.0
                score += similarities['effect_sims'].get(key, 0.0) * 30.0
                score += similarities['text_sims'].get(key, 0.0) * 20.0
                score += similarities['name_sims'].get(key, 0.0) * 10.0
                child_scores.append((score, child_fid))

            # Sort: highest score = best fit, keep those
            child_scores.sort(key=lambda x: x[0], reverse=True)
            keep = {cs[1] for cs in child_scores[:max_children]}
            reroute = [cs[1] for cs in child_scores[max_children:]]

            for reroute_fid in reroute:
                reroute_node = nodes.get(reroute_fid)
                if not reroute_node:
                    continue

                # Find best sibling (a kept child of same parent) to adopt
                best_sibling = None
                best_sib_score = -float('inf')

                for sibling_fid in keep:
                    sibling = nodes.get(sibling_fid)
                    if not sibling or len(sibling.children) >= max_children:
                        continue
                    key = f"{sibling_fid}:{reroute_fid}"
                    sib_score = 0.0
                    sib_score += similarities['effect_sims'].get(key, 0.0) * 30.0
                    sib_score += similarities['text_sims'].get(key, 0.0) * 20.0
                    sib_score -= len(sibling.children) * 5.0
                    if sib_score > best_sib_score:
                        best_sib_score = sib_score
                        best_sibling = sibling

                # If no sibling available, try any connected node with capacity
                if best_sibling is None:
                    for other_fid, other_node in nodes.items():
                        if other_fid == reroute_fid or other_fid == fid:
                            continue
                        if len(other_node.children) >= max_children:
                            continue
                        # Prefer nodes at lower or equal tier
                        other_tier = TIER_INDEX.get(other_node.tier, 0)
                        reroute_tier = TIER_INDEX.get(reroute_node.tier, 0)
                        if other_tier <= reroute_tier:
                            best_sibling = other_node
                            break

                if best_sibling:
                    # Unlink from overloaded parent
                    unlink_nodes(node, reroute_node)
                    # Link to new parent
                    link_nodes(best_sibling, reroute_node)
                    changed = True

    if passes > 1:
        _log(f"  Branching constraint: {passes} passes")


# ---------------------------------------------------------------------------
# Tier ordering enforcement
# ---------------------------------------------------------------------------

def _enforce_tier_ordering(
    nodes: Dict[str, TreeNode],
    root_id: str,
    max_children: int,
    similarities: dict
):
    """
    BFS walk to find tier-ordering violations (child tier <= parent tier)
    and attempt to re-parent the child to a node at a lower tier.
    """
    violations_fixed = 0
    max_passes = 5

    for pass_num in range(max_passes):
        found_violation = False

        for fid, node in list(nodes.items()):
            node_tier = TIER_INDEX.get(node.tier, 0)

            for child_fid in list(node.children):
                child = nodes.get(child_fid)
                if not child:
                    continue
                child_tier = TIER_INDEX.get(child.tier, 0)

                # Violation: child tier is not higher than parent tier
                if child_tier <= node_tier and fid != root_id:
                    # Try to find a better parent at a lower tier
                    best_new_parent = None
                    best_score = -float('inf')

                    for candidate_fid, candidate in nodes.items():
                        if candidate_fid == child_fid or candidate_fid == fid:
                            continue
                        cand_tier = TIER_INDEX.get(candidate.tier, 0)
                        if cand_tier >= child_tier:
                            continue  # Must be at a lower tier
                        if len(candidate.children) >= max_children:
                            continue

                        key = f"{candidate_fid}:{child_fid}"
                        score = 0.0
                        score += similarities['effect_sims'].get(key, 0.0) * 20.0
                        score += similarities['text_sims'].get(key, 0.0) * 15.0
                        score -= len(candidate.children) * 5.0
                        # Prefer closer tier distance
                        score -= abs(child_tier - cand_tier - 1) * 3.0

                        if score > best_score:
                            best_score = score
                            best_new_parent = candidate

                    if best_new_parent:
                        unlink_nodes(node, child)
                        link_nodes(best_new_parent, child)
                        violations_fixed += 1
                        found_violation = True

        if not found_violation:
            break

    if violations_fixed > 0:
        _log(f"  Tier ordering: fixed {violations_fixed} violations")


# ---------------------------------------------------------------------------
# Depth assignment via BFS
# ---------------------------------------------------------------------------

def _assign_depths_bfs(nodes: Dict[str, TreeNode], root_id: str):
    """Assign depths to all nodes via BFS from the root."""
    root = nodes.get(root_id)
    if not root:
        return

    root.depth = 0
    visited: Set[str] = {root_id}
    queue: deque = deque([root_id])

    while queue:
        current_fid = queue.popleft()
        current = nodes[current_fid]

        for child_fid in current.children:
            if child_fid in visited:
                continue
            child = nodes.get(child_fid)
            if child:
                child.depth = current.depth + 1
                visited.add(child_fid)
                queue.append(child_fid)

    # Any unvisited nodes get depth based on tier index
    for fid, node in nodes.items():
        if fid not in visited:
            node.depth = TIER_INDEX.get(node.tier, 0)


# ---------------------------------------------------------------------------
# Cross-school chaos edges
# ---------------------------------------------------------------------------

def _apply_cross_school_edges(
    tree_data: dict,
    similarities: dict,
    chaos: float,
    max_children: int
):
    """
    When chaos > 0.3, consider cross-school edges. At chaos=1.0 the cross-school
    penalty is 0; at chaos=0.3 it is (1-0.3)*50 = 35.

    This adds a few high-affinity cross-school links without destroying the
    per-school tree structure.
    """
    cross_penalty = (1.0 - chaos) * 50.0
    _log(f"Cross-school chaos: penalty={cross_penalty:.1f}")

    # Collect all nodes across schools
    all_nodes: Dict[str, dict] = {}  # fid -> node dict
    school_of: Dict[str, str] = {}  # fid -> school name

    for school_name, school_data in tree_data.get('schools', {}).items():
        for node_dict in school_data.get('nodes', []):
            fid = node_dict['formId']
            all_nodes[fid] = node_dict
            school_of[fid] = school_name

    # Find cross-school pairs with high NLP similarity
    cross_candidates: List[Tuple[float, str, str]] = []

    all_fids = list(all_nodes.keys())
    for i, fid_a in enumerate(all_fids):
        for fid_b in all_fids[i + 1:]:
            if school_of[fid_a] == school_of[fid_b]:
                continue

            key = f"{fid_a}:{fid_b}"
            text_sim = similarities['text_sims'].get(key, 0.0)
            effect_sim = similarities['effect_sims'].get(key, 0.0)

            # Combined affinity must overcome the cross-school penalty
            affinity = text_sim * 40.0 + effect_sim * 30.0
            if affinity > cross_penalty:
                cross_candidates.append((affinity - cross_penalty, fid_a, fid_b))

    cross_candidates.sort(key=lambda x: x[0], reverse=True)

    # Apply top cross-school links (limited to avoid chaos)
    max_cross_links = max(1, int(len(all_nodes) * 0.05 * chaos))
    applied = 0

    for score, fid_a, fid_b in cross_candidates[:max_cross_links * 3]:
        if applied >= max_cross_links:
            break

        node_a = all_nodes[fid_a]
        node_b = all_nodes[fid_b]

        # Determine direction: lower tier -> higher tier
        tier_a = TIER_INDEX.get(node_a.get('skillLevel', ''), 0)
        tier_b = TIER_INDEX.get(node_b.get('skillLevel', ''), 0)

        if tier_a <= tier_b:
            parent_fid, child_fid = fid_a, fid_b
        else:
            parent_fid, child_fid = fid_b, fid_a

        parent_node = all_nodes[parent_fid]
        child_node = all_nodes[child_fid]

        # Respect branching limit
        if len(parent_node.get('children', [])) >= max_children:
            continue

        # Add cross-school prerequisite (additive, not replacing existing)
        if parent_fid not in child_node.get('prerequisites', []):
            child_node.setdefault('prerequisites', []).append(parent_fid)
            parent_node.setdefault('children', []).append(child_fid)
            applied += 1

    if applied > 0:
        _log(f"  Cross-school: added {applied} cross-school links")


# ---------------------------------------------------------------------------
# Similarity matrix (shared with classic pattern)
# ---------------------------------------------------------------------------

def _compute_similarity_matrix(spells: List[dict]) -> dict:
    """
    Pre-compute pairwise TF-IDF, name, and effect-name similarity for spells.
    Called per-school so n is typically ~200-300, not the full spell pool.
    """
    import time as _time
    _t0 = _time.monotonic()

    form_ids: List[str] = []
    documents: List[str] = []
    spell_names: Dict[str, str] = {}
    spell_effect_names: Dict[str, List[str]] = {}

    for s in spells:
        fid = s.get('formId', '')
        if not fid:
            continue
        form_ids.append(fid)
        spell_names[fid] = s.get('name', '')

        # Extract effect names for element affinity
        raw_effects = s.get('effects', []) or s.get('effectNames', []) or []
        effect_names: List[str] = []
        for e in raw_effects:
            if isinstance(e, dict):
                ename = e.get('name', '')
            elif isinstance(e, str):
                ename = e
            else:
                continue
            if ename:
                effect_names.append(ename)
        spell_effect_names[fid] = effect_names

        effects_flat = [e if isinstance(e, str) else e.get('name', '') for e in raw_effects]
        doc_text = build_text({
            'name': s.get('name', ''),
            'desc': s.get('description', '') or s.get('desc', ''),
            'effects': effects_flat
        })
        documents.append(doc_text)

    # Tokenize and compute TF-IDF
    tokenized = [tokenize(doc) for doc in documents]
    tfidf_vectors = compute_tfidf(tokenized)

    n = len(form_ids)

    # Pre-compute pairwise cosine similarity (text)
    text_sims: Dict[str, float] = {}
    for i in range(n):
        for j in range(i + 1, n):
            sim = _cosine_sim(tfidf_vectors[i], tfidf_vectors[j])
            if sim > 0.05:
                key_ab = f"{form_ids[i]}:{form_ids[j]}"
                key_ba = f"{form_ids[j]}:{form_ids[i]}"
                text_sims[key_ab] = sim
                text_sims[key_ba] = sim

    # Pre-compute pairwise char n-gram similarity (names)
    name_sims: Dict[str, float] = {}
    for i in range(n):
        for j in range(i + 1, n):
            name_a = spell_names.get(form_ids[i], '')
            name_b = spell_names.get(form_ids[j], '')
            if name_a and name_b:
                nsim = char_ngram_similarity(name_a, name_b)
                if nsim > 0.1:
                    key_ab = f"{form_ids[i]}:{form_ids[j]}"
                    key_ba = f"{form_ids[j]}:{form_ids[i]}"
                    name_sims[key_ab] = nsim
                    name_sims[key_ba] = nsim

    # Pre-compute effect-name affinity (element grouping signal)
    effect_sims: Dict[str, float] = {}
    for i in range(n):
        for j in range(i + 1, n):
            fid_a = form_ids[i]
            fid_b = form_ids[j]
            effs_a = spell_effect_names.get(fid_a, [])
            effs_b = spell_effect_names.get(fid_b, [])

            if not effs_a or not effs_b:
                continue

            # Best-match: max similarity across all effect-name pairs
            best_sim = 0.0
            for ea in effs_a:
                for eb in effs_b:
                    sim = char_ngram_similarity(ea, eb)
                    if sim > best_sim:
                        best_sim = sim

            if best_sim > 0.3:
                key_ab = f"{fid_a}:{fid_b}"
                key_ba = f"{fid_b}:{fid_a}"
                effect_sims[key_ab] = best_sim
                effect_sims[key_ba] = best_sim

    _elapsed = _time.monotonic() - _t0
    _log(f"  Similarity matrix ({len(form_ids)} spells): {len(text_sims) // 2} text, "
         f"{len(name_sims) // 2} name, {len(effect_sims) // 2} effect pairs "
         f"in {_elapsed:.1f}s")

    return {
        'text_sims': text_sims,
        'name_sims': name_sims,
        'effect_sims': effect_sims,
    }


def _compute_cross_school_similarities(
    all_spells: List[dict],
    school_spells: Dict[str, List[dict]]
) -> dict:
    """
    Compute LIGHTWEIGHT cross-school similarities for chaos edges.

    Only computes TF-IDF text similarity between spells of DIFFERENT schools.
    Skips expensive effect-name and name n-gram comparisons since cross-school
    edges only need a rough affinity signal.
    """
    form_ids: List[str] = []
    documents: List[str] = []
    spell_school: Dict[str, str] = {}

    for school_name, slist in school_spells.items():
        for s in slist:
            fid = s.get('formId', '')
            if not fid:
                continue
            form_ids.append(fid)
            spell_school[fid] = school_name

            raw_effects = s.get('effects', []) or s.get('effectNames', []) or []
            effects_flat = [e if isinstance(e, str) else e.get('name', '') for e in raw_effects]
            doc_text = build_text({
                'name': s.get('name', ''),
                'desc': s.get('description', '') or s.get('desc', ''),
                'effects': effects_flat
            })
            documents.append(doc_text)

    tokenized = [tokenize(doc) for doc in documents]
    tfidf_vectors = compute_tfidf(tokenized)
    n = len(form_ids)

    # Only compute cross-school pairs (skip same-school — already handled)
    text_sims: Dict[str, float] = {}
    for i in range(n):
        for j in range(i + 1, n):
            if spell_school[form_ids[i]] == spell_school[form_ids[j]]:
                continue  # Same school — skip
            sim = _cosine_sim(tfidf_vectors[i], tfidf_vectors[j])
            if sim > 0.1:
                key_ab = f"{form_ids[i]}:{form_ids[j]}"
                key_ba = f"{form_ids[j]}:{form_ids[i]}"
                text_sims[key_ab] = sim
                text_sims[key_ba] = sim

    _log(f"  Cross-school similarities: {len(text_sims) // 2} text pairs")

    return {
        'text_sims': text_sims,
        'name_sims': {},
        'effect_sims': {},
    }


# ---------------------------------------------------------------------------
# Root selection (same pattern as classic)
# ---------------------------------------------------------------------------

def _pick_root(by_tier: Dict[str, List[dict]], config: dict) -> Optional[dict]:
    """Pick the best root spell from the lowest available tier."""
    prefer_vanilla = config.get('prefer_vanilla_roots', True)

    for tier_name in TIER_ORDER:
        tier_spells = by_tier[tier_name]
        if not tier_spells:
            continue

        if prefer_vanilla:
            vanilla = [s for s in tier_spells if _is_vanilla(s.get('formId', ''))]
            if vanilla:
                return random.choice(vanilla)

        return random.choice(tier_spells)

    return None


def _is_vanilla(form_id: str) -> bool:
    """Check if a formId is likely vanilla (low load order)."""
    try:
        val = int(form_id, 16) if isinstance(form_id, str) else int(form_id)
        return (val >> 24) < 0x05
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# Theme assignment (same pattern as classic)
# ---------------------------------------------------------------------------

def _assign_themes(
    nodes: Dict[str, TreeNode],
    spells: List[dict],
    themes: List[str]
):
    """Assign theme tags to nodes based on fuzzy spell-theme matching."""
    if not themes:
        return

    for spell in spells:
        fid = spell.get('formId', '')
        node = nodes.get(fid)
        if not node:
            continue
        theme, score = get_spell_primary_theme(spell, themes)
        node.theme = theme if score > 30 else None


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

try:
    from server import register_command
    register_command('build_tree_graph', graph_build_tree_from_data)
except ImportError:
    pass
