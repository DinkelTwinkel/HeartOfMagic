#!/usr/bin/env python3
"""
Classic Growth — Tier-First Tree Builder

Builds spell trees where node depth strictly follows spell difficulty tier:
  Novice (depth 0) → Apprentice (depth 1) → Adept (depth 2) → Expert (depth 3) → Master (depth 4)

Within each tier, NLP theme similarity guides which parent a spell connects to,
so fire Apprentice spells link to fire Novice spells. But the tier ordering is
a hard constraint — a Novice spell can never be a child of a Master spell.

Output format matches the standard tree builder (build_tree.py) so the JS
layout, apply, and PRM systems work unchanged.

Reuses shared modules from SpellTreeBuilder/:
  - core.node (TreeNode, link_nodes)
  - theme_discovery (discover_themes_per_school, extract_spell_text)
  - config (TreeBuilderConfig)
  - validator (validate_tree, fix_unreachable_nodes, get_validation_summary)
"""

import json
import random
import sys
import traceback
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

# Shared modules live in SpellTreeBuilder/ — server.py adds it to sys.path
from core.node import TreeNode, link_nodes
from theme_discovery import extract_spell_text, discover_themes_per_school
from validator import validate_tree, get_validation_summary, fix_unreachable_nodes
from prereq_master_scorer import tokenize, build_text, compute_tfidf
from prereq_master_scorer import cosine_similarity as _cosine_sim
from prereq_master_scorer import char_ngram_similarity
from spell_grouper import get_spell_primary_theme

# Log to SpellTreeBuilder's log directory
LOG_FILE = Path(__file__).resolve().parent.parent.parent.parent.parent.parent.parent / \
    "SKSE" / "Plugins" / "SpellLearning" / "SpellTreeBuilder" / "classic_build_tree.log"

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
TIER_INDEX = {t: i for i, t in enumerate(TIER_ORDER)}


def _log(msg: str):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


def classic_build_tree_from_data(spells: list, config_dict: dict) -> dict:
    """
    Build tier-ordered spell trees for Classic Growth mode.

    Args:
        spells: List of spell dicts with formId, name, school, skillLevel, etc.
        config_dict: Configuration dict from JS.

    Returns:
        dict: Tree data in standard format {schools: {name: {root, nodes, ...}}, ...}
    """
    config = dict(config_dict)

    # Seed setup
    if config.get('seed') is not None:
        used_seed = int(config['seed'])
    else:
        import time
        used_seed = int(time.time() * 1000) % 1000000
    random.seed(used_seed)
    config['seed'] = used_seed

    _log(f"classic_build_tree: seed={used_seed}, {len(spells)} spells")

    config.setdefault('max_children_per_node', 3)
    config.setdefault('top_themes_per_school', 8)
    config.setdefault('auto_fix_unreachable', True)
    config.setdefault('prefer_vanilla_roots', True)

    # Adapt max_children based on grid layout hint from JS
    grid_hint = config.get('grid_hint')
    if grid_hint:
        mode = grid_hint.get('mode', 'sun')
        avg_pts = grid_hint.get('avgPointsPerSchool', 0)
        _log(f"Grid hint: mode={mode}, schools={grid_hint.get('schoolCount')}, avgPts={avg_pts}")

        # SUN mode has narrower wedges per school — fewer children keeps tree thin
        # FLAT mode has wider horizontal space — more children fills it out
        if mode == 'sun' and config['max_children_per_node'] > 2:
            if avg_pts < 40:
                config['max_children_per_node'] = 2
                _log(f"  SUN + tight grid → max_children reduced to 2")
        elif mode == 'flat' and config['max_children_per_node'] < 4:
            if avg_pts > 60:
                config['max_children_per_node'] = 4
                _log(f"  FLAT + spacious grid → max_children increased to 4")

    # Group spells by school
    school_spells: Dict[str, List[dict]] = defaultdict(list)
    for spell in spells:
        school = spell.get('school', 'Unknown')
        if not school or school in ('null', 'undefined', 'None', ''):
            school = 'Hedge Wizard'
        school_spells[school].append(spell)

    # Discover themes per school for NLP-guided parent matching
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
        themes_per_school = merge_with_hints(themes_per_school,
                                              max_themes=config.get('top_themes_per_school', 8) + 4)
    except Exception as e:
        _log(f"merge_with_hints failed (non-critical): {e}")

    # Build TF-IDF similarity matrix for parent matching
    similarities = _compute_similarity_matrix(spells)

    # Build each school's tree
    tree_data = {'version': '1.0', 'schools': {}}
    max_children = config['max_children_per_node']

    for school_name, school_spell_list in school_spells.items():
        _log(f"Building {school_name}: {len(school_spell_list)} spells")

        school_themes = themes_per_school.get(school_name, [])
        result = _build_school_tree(
            school_spell_list, school_name, school_themes,
            similarities, max_children, config
        )
        if result:
            tree_data['schools'][school_name] = result
            _log(f"  {school_name}: {len(result['nodes'])} nodes, root={result['root']}")

    # Metadata
    tree_data['generatedAt'] = datetime.now().isoformat()
    tree_data['generator'] = 'ClassicTreeBuilder (Tier-First)'
    tree_data['config'] = {
        'shape': 'tier_first',
        'density': config.get('density', 0.6),
        'symmetry': config.get('symmetry', 0.3),
    }
    tree_data['seed'] = used_seed

    # Validate and auto-fix
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
            validation = validate_tree(tree_data, max_children)
            summary = get_validation_summary(validation)

    tree_data['validation'] = {
        'all_valid': summary['all_valid'],
        'total_nodes': summary['total_nodes'],
        'reachable_nodes': summary['reachable_nodes'],
    }

    _log(f"classic_build_tree complete: {summary['total_nodes']} nodes, valid={summary['all_valid']}")
    return tree_data


def _build_school_tree(
    spells: List[dict],
    school_name: str,
    themes: List[str],
    similarities: dict,
    max_children: int,
    config: dict
) -> Optional[dict]:
    """Build one school's tier-ordered tree."""

    if not spells:
        return None

    # Group spells by tier
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

    # Find root: prefer vanilla root from lowest tier with spells
    root_spell = _pick_root(by_tier, config)
    if not root_spell:
        return None

    # Create all nodes
    nodes: Dict[str, TreeNode] = {}
    for spell in spells:
        node = TreeNode.from_spell(spell)
        nodes[node.form_id] = node

    # Also add any unknown-tier spells that came from the extension above
    for spell in unknown_tier:
        fid = spell.get('formId', '')
        if fid and fid not in nodes:
            nodes[fid] = TreeNode.from_spell(spell)

    root = nodes[root_spell['formId']]
    root.is_root = True
    root.depth = 0

    # Assign themes to nodes using NLP text matching
    _assign_themes(nodes, spells, themes)

    # Build tree tier-by-tier
    connected = {root.form_id}
    # Track which nodes are available as parents (have capacity)
    available: Dict[int, List[TreeNode]] = defaultdict(list)
    available[0].append(root)

    for tier_idx, tier_name in enumerate(TIER_ORDER):
        tier_spells = by_tier[tier_name]

        # Skip root spell (already placed)
        tier_spells = [s for s in tier_spells if s['formId'] != root.form_id]

        if not tier_spells:
            continue

        # Shuffle for variety, but sort by theme affinity to spread evenly
        random.shuffle(tier_spells)

        placed_this_tier = []

        for spell in tier_spells:
            fid = spell['formId']
            if fid in connected:
                continue

            node = nodes.get(fid)
            if not node:
                continue

            # Find best parent from available nodes at LOWER tiers
            parent = _find_best_parent(
                node, available, tier_idx, max_children, similarities, themes
            )

            if parent:
                link_nodes(parent, node)
                # Override depth to match tier index (link_nodes sets parent.depth + 1)
                node.depth = tier_idx
                connected.add(fid)
                placed_this_tier.append(node)

                # Update parent availability
                if len(parent.children) >= max_children:
                    # Remove from available
                    for d in list(available.keys()):
                        available[d] = [p for p in available[d] if p.form_id != parent.form_id]

        # Add this tier's placed nodes as available parents for next tier
        for placed_node in placed_this_tier:
            if len(placed_node.children) < max_children:
                available[tier_idx].append(placed_node)

        _log(f"  {school_name} tier {tier_name}: {len(placed_this_tier)}/{len(tier_spells)} placed")

    # Force-connect any remaining unconnected nodes
    unconnected = [fid for fid in nodes if fid not in connected]
    if unconnected:
        _log(f"  {school_name}: {len(unconnected)} unconnected, force-attaching")
        _force_connect(unconnected, nodes, connected, available, max_children, similarities)

    # Serialize
    node_dicts = [n.to_dict() for n in nodes.values()]

    return {
        'root': root.form_id,
        'layoutStyle': 'tier_first',
        'nodes': node_dicts,
        'config_used': {
            'shape': 'tier_first',
            'density': config.get('density', 0.6),
            'symmetry': config.get('symmetry', 0.3),
            'source': 'classic'
        }
    }


def _pick_root(by_tier: Dict[str, List[dict]], config: dict) -> Optional[dict]:
    """Pick the best root spell from the lowest available tier."""
    prefer_vanilla = config.get('prefer_vanilla_roots', True)

    for tier_name in TIER_ORDER:
        tier_spells = by_tier[tier_name]
        if not tier_spells:
            continue

        if prefer_vanilla:
            # Vanilla formIds are typically < 0x01000000 (no mod prefix)
            vanilla = [s for s in tier_spells if _is_vanilla(s.get('formId', ''))]
            if vanilla:
                return random.choice(vanilla)

        return random.choice(tier_spells)

    return None


def _is_vanilla(form_id: str) -> bool:
    """Check if a formId is likely vanilla (low load order)."""
    try:
        val = int(form_id, 16) if isinstance(form_id, str) else int(form_id)
        return (val >> 24) < 0x05  # First 5 load order slots
    except (ValueError, TypeError):
        return False


def _assign_themes(nodes: Dict[str, TreeNode], spells: List[dict], themes: List[str]):
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


def _compute_similarity_matrix(spells: List[dict]) -> dict:
    """Pre-compute pairwise TF-IDF, name, and effect-name similarity for all spells.

    Effect-name similarity is the key element-grouping signal: spells with
    matching effect names (e.g. both "Fire Damage") score 1.0, while
    mismatched effects ("Fire Damage" vs "Frost Damage") score ~0.36.
    This groups spells by element without any hardcoded element lists —
    the game's own effect names provide the classification.
    """
    # Build documents
    form_ids = []
    documents = []
    spell_names = {}
    spell_effect_names: Dict[str, List[str]] = {}

    for s in spells:
        fid = s.get('formId', '')
        if not fid:
            continue
        form_ids.append(fid)
        spell_names[fid] = s.get('name', '')

        # Extract effect names for element affinity
        raw_effects = s.get('effects', []) or s.get('effectNames', []) or []
        effect_names = []
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
    text_sims = {}
    for i in range(n):
        for j in range(i + 1, n):
            sim = _cosine_sim(tfidf_vectors[i], tfidf_vectors[j])
            if sim > 0.05:
                key_ab = f"{form_ids[i]}:{form_ids[j]}"
                key_ba = f"{form_ids[j]}:{form_ids[i]}"
                text_sims[key_ab] = sim
                text_sims[key_ba] = sim

    # Pre-compute pairwise char n-gram similarity (names)
    name_sims = {}
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
    # Uses char n-gram on effect names: "Fire Damage" ↔ "Fire Damage" = 1.0
    # "Fire Damage" ↔ "Frost Damage" ≈ 0.36. Data-driven, no hardcoded lists.
    effect_sims = {}
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

    _log(f"  Similarity matrix: {len(text_sims)//2} text, {len(name_sims)//2} name, "
         f"{len(effect_sims)//2} effect pairs")

    return {'text_sims': text_sims, 'name_sims': name_sims, 'effect_sims': effect_sims}


def _find_best_parent(
    node: TreeNode,
    available: Dict[int, List[TreeNode]],
    tier_idx: int,
    max_children: int,
    similarities: dict,
    themes: List[str]
) -> Optional[TreeNode]:
    """Find the best parent for a node from available parents at lower tiers."""

    # Gradual candidate search: widen one tier at a time
    candidates = []
    for tier_distance in range(1, tier_idx + 2):
        target_d = tier_idx - tier_distance
        if target_d < 0:
            break
        tier_cands = available.get(target_d, [])
        valid_cands = [c for c in tier_cands if len(c.children) < max_children]
        for c in valid_cands:
            candidates.append((c, tier_distance))
        if candidates:
            break  # Found candidates at this distance

    # For tier_idx == 0 (Novice), check same tier (other Novice nodes that are roots)
    if not candidates and tier_idx == 0:
        tier_cands = available.get(0, [])
        valid_cands = [c for c in tier_cands if len(c.children) < max_children and c.form_id != node.form_id]
        for c in valid_cands:
            candidates.append((c, 0))

    # Last resort: expand capacity
    if not candidates:
        for d in sorted(available.keys()):
            for p in available.get(d, []):
                if len(p.children) < max_children + 2:
                    candidates.append((p, abs(tier_idx - d) + 5))
            if candidates:
                break

    if not candidates:
        return None

    # Score candidates
    scored = []

    for candidate, tier_distance in candidates:
        score = 0.0

        # Tier distance penalty (adjacent = 0 penalty, further = increasing penalty)
        score -= max(0, (tier_distance - 1)) * 5.0

        key = f"{node.form_id}:{candidate.form_id}"

        # Effect-name affinity: strongest element-grouping signal.
        # Data-driven from the game's own effect names (no hardcoded element lists).
        # "Fire Damage" ↔ "Fire Damage" = 1.0, "Fire Damage" ↔ "Frost Damage" ≈ 0.36
        effect_sim = similarities['effect_sims'].get(key, 0.0)
        score += effect_sim * 40.0

        # Theme match: moderate bonus (reduced — effect affinity is more precise)
        if node.theme and candidate.theme:
            if node.theme == candidate.theme:
                # Reduce theme bonus when effect names disagree (cross-element)
                theme_bonus = 25.0 if effect_sim > 0.5 else 15.0
                score += theme_bonus
            else:
                score -= 10.0

        # Combined NLP similarity: text TF-IDF + name morphology
        text_sim = similarities['text_sims'].get(key, 0.0)
        name_sim = similarities['name_sims'].get(key, 0.0)
        combined_sim = text_sim * 0.4 + name_sim * 0.6
        score += combined_sim * 30.0

        # Prefer parents with fewer children (balance the tree)
        child_count = len(candidate.children)
        score -= child_count * 8.0

        # Slight preference for parents at depth = tier_idx - 1 (immediate predecessor)
        if candidate.depth == tier_idx - 1:
            score += 10.0
        elif candidate.depth == tier_idx - 2:
            score += 5.0

        # Small random jitter for variety
        score += random.uniform(-2.0, 2.0)

        scored.append((score, candidate))

    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


def _force_connect(
    unconnected: List[str],
    nodes: Dict[str, TreeNode],
    connected: set,
    available: Dict[int, List[TreeNode]],
    max_children: int,
    similarities: dict = None
):
    """Force-connect remaining unconnected nodes to any available parent.

    Respects tier ordering: prefers parents at lower or equal tier.
    Uses effect-name affinity to group same-element spells together.
    """
    if similarities is None:
        similarities = {'text_sims': {}, 'name_sims': {}, 'effect_sims': {}}

    for fid in unconnected:
        node = nodes.get(fid)
        if not node or fid in connected:
            continue

        node_tier_idx = TIER_INDEX.get(node.tier, 0)

        # Score connected nodes: strongly prefer correct tier ordering
        best_parent = None
        best_score = -float('inf')

        for cid in connected:
            cnode = nodes.get(cid)
            if not cnode:
                continue
            cnode_tier_idx = TIER_INDEX.get(cnode.tier, 0)
            child_count = len(cnode.children)

            score = 0.0

            # Tier ordering: parent should be at lower or equal tier
            if cnode_tier_idx <= node_tier_idx:
                score += 100.0  # Correct direction
                # Prefer immediate predecessor tier
                tier_diff = node_tier_idx - cnode_tier_idx
                score -= tier_diff * 5.0
            else:
                score -= 200.0  # Wrong direction — heavy penalty

            key = f"{fid}:{cid}"

            # Effect-name affinity (data-driven element grouping)
            effect_sim = similarities['effect_sims'].get(key, 0.0)
            score += effect_sim * 30.0

            # Theme match (reduced weight — effect affinity is more precise)
            if node.theme and cnode.theme and node.theme == cnode.theme:
                score += 15.0

            # Load balance
            score -= child_count * 8.0

            if score > best_score:
                best_score = score
                best_parent = cnode

        if best_parent:
            link_nodes(best_parent, node)
            # Set depth based on tier
            node.depth = node_tier_idx
            connected.add(fid)

            if len(node.children) < max_children:
                available.setdefault(node_tier_idx, []).append(node)
