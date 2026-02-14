#!/usr/bin/env python3
"""
Thematic Growth — Theme-First BFS Tree Builder

Builds spell trees where themes (element/type clusters) drive the structure:
  1. Discover themes via TF-IDF and vanilla hints
  2. Group spells into theme clusters (each spell -> exactly one theme)
  3. Rank themes by spell count; the largest becomes the "trunk"
  4. Build trunk as a tier-ordered chain from the root
  5. BFS-expand remaining themes as branches, attaching each theme
     at the placed spell most similar to the theme's representative
  6. Sweep orphans into the nearest placed spell by NLP similarity

This is fundamentally different from Classic (tier-first, spell-by-spell
greedy). Thematic produces trees where entire branches correspond to
coherent element/type clusters (fire, frost, flesh, etc.).

Output format matches the standard tree builder so the JS layout, apply,
and PRM systems work unchanged.

Reuses shared modules from SpellTreeBuilder/:
  - core.node (TreeNode, link_nodes)
  - theme_discovery (discover_themes_per_school, extract_spell_text, merge_with_hints)
  - spell_grouper (group_spells_best_fit, get_spell_primary_theme)
  - validator (validate_tree, fix_unreachable_nodes, get_validation_summary)
  - prereq_master_scorer (build_text, compute_tfidf, cosine_similarity, char_ngram_similarity)
"""

import colorsys
import json
import random
import sys
import traceback
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

# Shared modules live in SpellTreeBuilder/ — server.py adds it to sys.path
from core.node import TreeNode, link_nodes
from theme_discovery import discover_themes_per_school, extract_spell_text, merge_with_hints
from spell_grouper import group_spells_best_fit, get_spell_primary_theme
from validator import validate_tree, get_validation_summary, fix_unreachable_nodes
from prereq_master_scorer import tokenize, build_text, compute_tfidf
from prereq_master_scorer import cosine_similarity as _cosine_sim
from prereq_master_scorer import char_ngram_similarity

# Log to SpellTreeBuilder's log directory
LOG_FILE = Path(__file__).resolve().parent.parent.parent.parent.parent.parent.parent / \
    "SKSE" / "Plugins" / "SpellLearning" / "SpellTreeBuilder" / "thematic_build_tree.log"

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
TIER_INDEX = {t: i for i, t in enumerate(TIER_ORDER)}

SCHOOL_COLORS = {
    'Destruction': '#ef4444',
    'Conjuration': '#a855f7',
    'Alteration': '#22c55e',
    'Illusion': '#3b82f6',
    'Restoration': '#eab308',
    'Hedge Wizard': '#94a3b8',
}


def _log(msg: str):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


def thematic_build_tree_from_data(spells: list, config_dict: dict) -> dict:
    """
    Build theme-clustered spell trees for Thematic Growth mode.

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

    _log(f"thematic_build_tree: seed={used_seed}, {len(spells)} spells")

    config.setdefault('max_children_per_node', 3)
    config.setdefault('top_themes_per_school', 8)
    config.setdefault('auto_fix_unreachable', True)
    config.setdefault('prefer_vanilla_roots', True)
    config.setdefault('chaos', 0.0)
    config.setdefault('branch_style', 'chain')

    # Adapt max_children based on grid layout hint from JS
    grid_hint = config.get('grid_hint')
    if grid_hint:
        mode = grid_hint.get('mode', 'sun')
        avg_pts = grid_hint.get('avgPointsPerSchool', 0)
        _log(f"Grid hint: mode={mode}, schools={grid_hint.get('schoolCount')}, avgPts={avg_pts}")

        if mode == 'sun' and config['max_children_per_node'] > 2:
            if avg_pts < 40:
                config['max_children_per_node'] = 2
                _log(f"  SUN + tight grid -> max_children reduced to 2")
        elif mode == 'flat' and config['max_children_per_node'] < 4:
            if avg_pts > 60:
                config['max_children_per_node'] = 4
                _log(f"  FLAT + spacious grid -> max_children increased to 4")

    # Group spells by school (only the 5 vanilla magic schools)
    VALID_SCHOOLS = {'Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration'}
    school_spells: Dict[str, List[dict]] = defaultdict(list)
    for spell in spells:
        school = spell.get('school', '')
        if school not in VALID_SCHOOLS:
            continue
        school_spells[school].append(spell)

    # Discover themes per school
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
        themes_per_school = merge_with_hints(
            themes_per_school,
            max_themes=config.get('top_themes_per_school', 8) + 4
        )
    except Exception as e:
        _log(f"merge_with_hints failed (non-critical): {e}")

    # Build each school's tree (per-school similarity computation)
    tree_data = {'version': '1.0', 'schools': {}}
    max_children = config['max_children_per_node']

    for school_name, school_spell_list in school_spells.items():
        _log(f"Building {school_name}: {len(school_spell_list)} spells")

        # Compute similarity matrix PER SCHOOL (much faster than global)
        school_similarities = _compute_similarity_matrix(school_spell_list)

        school_themes = themes_per_school.get(school_name, [])
        result = _build_school_tree(
            school_spell_list, school_name, school_themes,
            school_similarities, max_children, config
        )
        if result:
            tree_data['schools'][school_name] = result
            _log(f"  {school_name}: {len(result['nodes'])} nodes, root={result['root']}")

    # Metadata
    tree_data['generatedAt'] = datetime.now().isoformat()
    tree_data['generator'] = 'ThematicTreeBuilder (Theme-First BFS)'
    tree_data['config'] = {
        'shape': 'thematic_bfs',
        'density': config.get('density', 0.6),
        'symmetry': config.get('symmetry', 0.3),
        'chaos': config.get('chaos', 0.0),
        'branch_style': config.get('branch_style', 'chain'),
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

    _log(f"thematic_build_tree complete: {summary['total_nodes']} nodes, valid={summary['all_valid']}")
    return tree_data


def _build_school_tree(
    spells: List[dict],
    school_name: str,
    themes: List[str],
    similarities: dict,
    max_children: int,
    config: dict
) -> Optional[dict]:
    """Build one school's theme-clustered tree."""

    if not spells:
        return None

    chaos = config.get('chaos', 0.0)
    branch_style = config.get('branch_style', 'chain')

    # --- Step 1 & 2: Group spells into theme clusters ---
    theme_groups = _group_spells_to_themes(spells, themes)

    # Separate the "other" bucket (spells that matched no theme)
    orphan_spells = theme_groups.pop('_unassigned', [])

    # Remove empty themes
    theme_groups = {t: slist for t, slist in theme_groups.items() if slist}

    if not theme_groups:
        # No themes discovered — fall back to a simple tier chain
        _log(f"  {school_name}: no themes, falling back to tier chain")
        return _build_simple_tier_chain(spells, school_name, max_children, config)

    # --- Step 3: Rank themes by spell count descending ---
    ranked_themes = sorted(theme_groups.keys(), key=lambda t: len(theme_groups[t]), reverse=True)
    trunk_theme = ranked_themes[0]
    remaining_themes = ranked_themes[1:]

    _log(f"  {school_name}: {len(ranked_themes)} themes, trunk='{trunk_theme}' "
         f"({len(theme_groups[trunk_theme])} spells)")

    # Group ALL spells by tier (for root picking)
    by_tier: Dict[str, List[dict]] = {t: [] for t in TIER_ORDER}
    unknown_tier: List[dict] = []
    for spell in spells:
        tier = spell.get('skillLevel', '')
        if tier in TIER_INDEX:
            by_tier[tier].append(spell)
        else:
            unknown_tier.append(spell)
    by_tier['Novice'].extend(unknown_tier)

    # --- Step 4: Select root — prefer vanilla from ALL school spells ---
    # Check all spells first so recognizable vanilla roots (Flames, Healing, etc.)
    # are always preferred over trunk-theme-only roots which may be obscure.
    root_spell = _pick_root(by_tier, config, school_name)
    if not root_spell:
        # Fallback: try trunk theme only (shouldn't happen with good data)
        trunk_by_tier: Dict[str, List[dict]] = {t: [] for t in TIER_ORDER}
        for spell in theme_groups[trunk_theme]:
            tier = spell.get('skillLevel', '')
            if tier in TIER_INDEX:
                trunk_by_tier[tier].append(spell)
            else:
                trunk_by_tier['Novice'].append(spell)
        root_spell = _pick_root(trunk_by_tier, config, school_name)
    if not root_spell:
        return None

    # --- Create all nodes ---
    nodes: Dict[str, TreeNode] = {}
    spell_theme_map: Dict[str, str] = {}  # formId -> theme name

    for theme_name, theme_spells in theme_groups.items():
        for spell in theme_spells:
            fid = spell.get('formId', '')
            if fid:
                node = TreeNode.from_spell(spell)
                nodes[fid] = node
                spell_theme_map[fid] = theme_name

    # Also create nodes for orphan spells
    for spell in orphan_spells:
        fid = spell.get('formId', '')
        if fid and fid not in nodes:
            nodes[fid] = TreeNode.from_spell(spell)
            spell_theme_map[fid] = 'other'

    # Ensure root node exists
    root_fid = root_spell['formId']
    if root_fid not in nodes:
        nodes[root_fid] = TreeNode.from_spell(root_spell)
        spell_theme_map[root_fid] = trunk_theme

    root = nodes[root_fid]
    root.is_root = True
    root.depth = 0
    root.theme = trunk_theme

    # Assign theme to all nodes
    for fid, theme_name in spell_theme_map.items():
        if fid in nodes:
            nodes[fid].theme = theme_name

    connected = {root_fid}
    branches_meta: List[dict] = []

    # --- Step 5: Build trunk chain ---
    trunk_spells = [s for s in theme_groups[trunk_theme] if s['formId'] != root_fid]
    trunk_spells = _sort_by_tier_and_cost(trunk_spells)

    trunk_placed = _build_theme_branch(
        trunk_spells, root, nodes, connected, max_children, branch_style
    )

    _log(f"  Trunk '{trunk_theme}': {len(trunk_placed)} placed (of {len(trunk_spells)})")

    # Record trunk branch metadata
    trunk_spell_ids = [root_fid] + [s['formId'] for s in trunk_placed]
    branches_meta.append({
        'theme': trunk_theme,
        'spellIds': trunk_spell_ids,
        'attachmentPoint': root_fid,
    })

    # --- Step 6: BFS theme expansion ---
    # Sort remaining themes by affinity to trunk theme
    if remaining_themes:
        remaining_themes = _sort_themes_by_affinity(
            remaining_themes, theme_groups, {trunk_theme}, similarities, chaos
        )

    placed_themes = {trunk_theme}

    while remaining_themes:
        next_theme = remaining_themes.pop(0)
        theme_spells_raw = theme_groups.get(next_theme, [])
        if not theme_spells_raw:
            continue

        theme_spells_sorted = _sort_by_tier_and_cost(theme_spells_raw)

        # Find the representative spell for this theme (lowest tier in the theme)
        representative = theme_spells_sorted[0] if theme_spells_sorted else None
        if not representative:
            continue

        # Find attachment point: which placed spell is most similar to the representative?
        attachment = _find_attachment_point(
            representative, nodes, connected, similarities, chaos
        )

        if not attachment:
            # Attach to root as last resort
            attachment = root

        # Build this theme's branch from the attachment point
        theme_placed = _build_theme_branch(
            theme_spells_sorted, attachment, nodes, connected, max_children, branch_style
        )

        _log(f"  Theme '{next_theme}': {len(theme_placed)} placed, attached to {attachment.form_id}")

        # Record branch metadata
        theme_spell_ids = [s['formId'] for s in theme_placed]
        branches_meta.append({
            'theme': next_theme,
            'spellIds': theme_spell_ids,
            'attachmentPoint': attachment.form_id,
        })

        placed_themes.add(next_theme)

        # Re-sort remaining themes by affinity to ALL placed spells
        if remaining_themes:
            remaining_themes = _sort_themes_by_affinity(
                remaining_themes, theme_groups, placed_themes, similarities, chaos
            )

    # --- Step 7: Orphan sweep ---
    orphan_fids = [fid for fid in nodes if fid not in connected]
    if orphan_fids:
        _log(f"  {school_name}: {len(orphan_fids)} orphans, sweeping into tree")
        _sweep_orphans(orphan_fids, nodes, connected, similarities, max_children)

    # --- Step 7b: Add swept orphans to an "Other" branch ---
    # The JS layout only positions nodes listed in a branch's spellIds.
    # Orphans were connected by _sweep_orphans but not added to any branch.
    all_branch_fids: set = set()
    for b in branches_meta:
        all_branch_fids.update(b.get('spellIds', []))
    other_fids = [fid for fid in connected if fid not in all_branch_fids]
    if other_fids:
        branches_meta.append({
            'theme': 'other',
            'spellIds': other_fids,
            'attachmentPoint': root_fid,
        })
        _log(f"  {school_name}: {len(other_fids)} spells added to 'Other' branch")

    _log(f"  {school_name}: {len(connected)}/{len(nodes)} nodes connected, "
         f"{len(branches_meta)} branches")

    # --- Step 8 & 9: Assign theme colors ---
    school_base_color = SCHOOL_COLORS.get(school_name, '#94a3b8')
    active_themes = list({spell_theme_map.get(fid, 'other') for fid in nodes})
    theme_colors = _derive_theme_colors(school_base_color, active_themes)

    # Bake themeColor into node dicts
    node_dicts = []
    for node in nodes.values():
        nd = node.to_dict()
        nd['themeColor'] = theme_colors.get(node.theme or 'other', school_base_color)
        node_dicts.append(nd)

    # Add colors to branch metadata
    for branch in branches_meta:
        branch['color'] = theme_colors.get(branch['theme'], school_base_color)

    return {
        'root': root.form_id,
        'layoutStyle': 'thematic_bfs',
        'color': school_base_color,
        'branches': branches_meta,
        'nodes': node_dicts,
        'config_used': {
            'shape': 'thematic_bfs',
            'density': config.get('density', 0.6),
            'symmetry': config.get('symmetry', 0.3),
            'chaos': config.get('chaos', 0.0),
            'branch_style': config.get('branch_style', 'chain'),
            'source': 'thematic',
        }
    }


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _group_spells_to_themes(
    spells: List[dict],
    themes: List[str]
) -> Dict[str, List[dict]]:
    """Group spells into theme clusters using spell_grouper.

    Each spell goes to exactly one theme. Spells that don't match any
    theme go into '_unassigned'.
    """
    if not themes:
        return {'_unassigned': list(spells)}

    return group_spells_best_fit(spells, themes, min_score=30)


def _pick_root(by_tier: Dict[str, List[dict]], config: dict, school: str = '') -> Optional[dict]:
    """Pick the best root spell. User override takes priority over auto-pick."""
    # Check user-selected root override
    selected_roots = config.get('selected_roots', {})
    if school and school in selected_roots:
        override = selected_roots[school]
        override_id = override.get('formId', '') if isinstance(override, dict) else ''
        if override_id:
            all_spells = [s for tier in by_tier.values() for s in tier]
            for s in all_spells:
                if s.get('formId') == override_id:
                    sys.stderr.write("[ThematicBuilder] Using user-selected root for %s: %s\n" % (school, s.get('name', override_id)))
                    return s
            sys.stderr.write("[ThematicBuilder] User-selected root %s for %s not in spell pool, auto-picking\n" % (override_id, school))

    # Auto-pick: prefer vanilla root from lowest tier
    prefer_vanilla = config.get('prefer_vanilla_roots', True)

    for tier_name in TIER_ORDER:
        tier_spells = by_tier[tier_name]
        if not tier_spells:
            continue

        if prefer_vanilla:
            vanilla = [s for s in tier_spells if _is_vanilla(s.get('formId', ''))]
            if vanilla:
                # Among vanilla, prefer alphabetical for determinism
                vanilla.sort(key=lambda s: s.get('name', '').lower())
                return vanilla[0]

        # Non-vanilla: alphabetical
        sorted_spells = sorted(tier_spells, key=lambda s: s.get('name', '').lower())
        return sorted_spells[0]

    return None


def _is_vanilla(form_id: str) -> bool:
    """Check if a formId is vanilla Skyrim.esm or Update.esm (load order 0x00-0x01).

    Excludes DLC (Dawnguard 0x02, HearthFires 0x03, Dragonborn 0x04) which
    contain unusual NPC-only spells like Giant Stomp, Miraak Teleport, etc.
    that make poor tree roots.
    """
    try:
        val = int(form_id, 16) if isinstance(form_id, str) else int(form_id)
        return (val >> 24) < 0x02  # Only Skyrim.esm (0x00) + Update.esm (0x01)
    except (ValueError, TypeError):
        return False


def _sort_by_tier_and_cost(spells: List[dict]) -> List[dict]:
    """Sort spells by tier (Novice -> Master), then by magicka cost within tier."""
    def sort_key(s):
        tier_idx = TIER_INDEX.get(s.get('skillLevel', ''), 99)
        cost = s.get('magickaCost', 0) or s.get('baseCost', 0) or 0
        name = s.get('name', '').lower()
        return (tier_idx, cost, name)
    return sorted(spells, key=sort_key)


def _build_theme_branch(
    spells: List[dict],
    attachment: TreeNode,
    nodes: Dict[str, TreeNode],
    connected: set,
    max_children: int,
    branch_style: str
) -> List[dict]:
    """Build a branch of spells off an attachment point using BFS expansion.

    Uses a FIFO queue of available parents so ALL placed nodes can serve as
    parents, producing a balanced tree instead of a single-spine chain.
    With max_children=3: depth ~log3(N), every node gets filled before
    advancing to the next level.

    Returns list of spell dicts that were successfully placed.
    """
    placed = []

    # BFS parent queue: nodes that still have capacity for children
    parent_queue = deque()
    if len(attachment.children) < max_children:
        parent_queue.append(attachment)

    for spell in spells:
        fid = spell.get('formId', '')
        if not fid or fid in connected:
            continue

        node = nodes.get(fid)
        if not node:
            continue

        # Pop exhausted parents from the front of the queue
        while parent_queue and len(parent_queue[0].children) >= max_children:
            parent_queue.popleft()

        if not parent_queue:
            # No capacity in the branch — fall back to tree-wide search
            parent_found = _find_parent_with_capacity(
                attachment, nodes, connected, max_children
            )
            if parent_found:
                parent_queue.append(parent_found)
            else:
                _log(f"    Cannot place {fid} ({node.name}) — no capacity in branch")
                continue

        current_parent = parent_queue[0]
        link_nodes(current_parent, node)
        connected.add(fid)
        placed.append(spell)

        # New node is available as a future parent
        parent_queue.append(node)

    return placed


def _find_parent_with_capacity(
    start: TreeNode,
    nodes: Dict[str, TreeNode],
    connected: set,
    max_children: int
) -> Optional[TreeNode]:
    """Walk the tree looking for a connected node with child capacity.

    Starts from the given node and walks prerequisites (upward) to find
    a node that can accept another child.
    """
    visited = set()
    queue = [start]

    while queue:
        current = queue.pop(0)
        if current.form_id in visited:
            continue
        visited.add(current.form_id)

        if len(current.children) < max_children:
            return current

        # Walk upward through prerequisites
        for prereq_id in current.prerequisites:
            if prereq_id not in visited and prereq_id in nodes:
                queue.append(nodes[prereq_id])

        # Also check children (walk downward)
        for child_id in current.children:
            if child_id not in visited and child_id in nodes:
                queue.append(nodes[child_id])

    return None


def _find_attachment_point(
    representative: dict,
    nodes: Dict[str, TreeNode],
    connected: set,
    similarities: dict,
    chaos: float
) -> Optional[TreeNode]:
    """Find the best attachment point among placed spells for a new theme.

    Uses combined NLP similarity (TF-IDF text + effect-name affinity)
    to find the placed spell most similar to the theme's representative.
    """
    rep_fid = representative.get('formId', '')
    if not rep_fid:
        return None

    best_node = None
    best_score = -float('inf')

    for placed_fid in connected:
        placed_node = nodes.get(placed_fid)
        if not placed_node:
            continue

        key = f"{rep_fid}:{placed_fid}"

        # Text TF-IDF similarity
        text_sim = similarities['text_sims'].get(key, 0.0)
        # Effect-name affinity
        effect_sim = similarities['effect_sims'].get(key, 0.0)
        # Name morphology
        name_sim = similarities['name_sims'].get(key, 0.0)

        # Combined score: effect affinity is strongest signal,
        # text similarity secondary, name morphology tertiary
        score = effect_sim * 35.0 + text_sim * 25.0 + name_sim * 20.0

        # Prefer nodes at lower tiers (so themes branch off early)
        node_tier_idx = TIER_INDEX.get(placed_node.tier, 2)
        score -= node_tier_idx * 5.0

        # Prefer nodes with fewer children (balance)
        score -= len(placed_node.children) * 8.0

        # Chaos factor: blend in random noise
        if chaos > 0.0:
            score += random.uniform(-20.0, 20.0) * chaos

        # Small random jitter for variety
        score += random.uniform(-1.0, 1.0)

        if score > best_score:
            best_score = score
            best_node = placed_node

    return best_node


def _sort_themes_by_affinity(
    remaining: List[str],
    theme_groups: Dict[str, List[dict]],
    placed_themes: set,
    similarities: dict,
    chaos: float
) -> List[str]:
    """Sort remaining themes by their affinity to all placed themes.

    Affinity is computed as the average NLP similarity between each
    remaining theme's representative spell and the placed spells.
    """
    # Collect all placed spell formIds
    placed_fids = set()
    for pt in placed_themes:
        for spell in theme_groups.get(pt, []):
            fid = spell.get('formId', '')
            if fid:
                placed_fids.add(fid)

    scored = []
    for theme in remaining:
        theme_spells = theme_groups.get(theme, [])
        if not theme_spells:
            scored.append((theme, -999.0))
            continue

        # Representative = lowest tier spell in this theme
        sorted_theme = _sort_by_tier_and_cost(theme_spells)
        rep_fid = sorted_theme[0].get('formId', '')

        if not rep_fid:
            scored.append((theme, -999.0))
            continue

        # Average similarity to placed spells
        total_sim = 0.0
        count = 0
        for placed_fid in placed_fids:
            key = f"{rep_fid}:{placed_fid}"
            text_sim = similarities['text_sims'].get(key, 0.0)
            effect_sim = similarities['effect_sims'].get(key, 0.0)
            combined = effect_sim * 0.6 + text_sim * 0.4
            total_sim += combined
            count += 1

        avg_sim = total_sim / count if count > 0 else 0.0

        # Bonus for larger themes (more spells = more important)
        size_bonus = len(theme_spells) * 0.5

        affinity = avg_sim * 100.0 + size_bonus

        # Chaos blending
        if chaos > 0.0:
            affinity += random.uniform(-15.0, 15.0) * chaos

        scored.append((theme, affinity))

    # Sort by affinity descending (highest affinity first)
    scored.sort(key=lambda x: x[1], reverse=True)
    return [t for t, _ in scored]


def _sweep_orphans(
    orphan_fids: List[str],
    nodes: Dict[str, TreeNode],
    connected: set,
    similarities: dict,
    max_children: int
):
    """Attach orphan spells to the nearest placed spell by NLP similarity."""
    for fid in orphan_fids:
        node = nodes.get(fid)
        if not node or fid in connected:
            continue

        node_tier_idx = TIER_INDEX.get(node.tier, 0)

        best_parent = None
        best_score = -float('inf')

        for cid in connected:
            cnode = nodes.get(cid)
            if not cnode:
                continue
            cnode_tier_idx = TIER_INDEX.get(cnode.tier, 0)

            score = 0.0

            # Tier ordering: parent should be at lower or equal tier
            if cnode_tier_idx <= node_tier_idx:
                score += 100.0
                tier_diff = node_tier_idx - cnode_tier_idx
                score -= tier_diff * 5.0
            else:
                score -= 200.0

            key = f"{fid}:{cid}"

            # Effect-name affinity
            effect_sim = similarities['effect_sims'].get(key, 0.0)
            score += effect_sim * 30.0

            # Text similarity
            text_sim = similarities['text_sims'].get(key, 0.0)
            score += text_sim * 15.0

            # Name similarity
            name_sim = similarities['name_sims'].get(key, 0.0)
            score += name_sim * 10.0

            # Theme match
            if node.theme and cnode.theme and node.theme == cnode.theme:
                score += 15.0

            # Load balance
            score -= len(cnode.children) * 8.0

            if score > best_score:
                best_score = score
                best_parent = cnode

        if best_parent:
            link_nodes(best_parent, node)
            node.depth = TIER_INDEX.get(node.tier, best_parent.depth + 1)
            connected.add(fid)


def _compute_similarity_matrix(spells: List[dict]) -> dict:
    """Pre-compute pairwise TF-IDF, name, and effect-name similarity for spells.

    Called per-school so n is typically ~200-300, not the full spell pool.

    Effect-name similarity is the key element-grouping signal: spells with
    matching effect names (e.g. both "Fire Damage") score 1.0, while
    mismatched effects ("Fire Damage" vs "Frost Damage") score ~0.36.
    This groups spells by element without any hardcoded element lists --
    the game's own effect names provide the classification.
    """
    import time as _time
    _t0 = _time.monotonic()

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

    _elapsed = _time.monotonic() - _t0
    _log(f"  Similarity matrix ({len(form_ids)} spells): {len(text_sims)//2} text, "
         f"{len(name_sims)//2} name, {len(effect_sims)//2} effect pairs "
         f"in {_elapsed:.1f}s")

    return {'text_sims': text_sims, 'name_sims': name_sims, 'effect_sims': effect_sims}


def _derive_theme_colors(school_color_hex: str, themes: List[str]) -> Dict[str, str]:
    """Derive per-theme colors by shifting the hue of the school's base color.

    Each theme gets a distinct hue rotation while keeping saturation
    and lightness similar to the school's base.

    Args:
        school_color_hex: Base color as '#rrggbb' hex string
        themes: List of theme names to assign colors to

    Returns:
        Dict mapping theme name to '#rrggbb' hex color
    """
    if not themes:
        return {}

    # Parse base color
    base_hex = school_color_hex.lstrip('#')
    try:
        r = int(base_hex[0:2], 16) / 255.0
        g = int(base_hex[2:4], 16) / 255.0
        b = int(base_hex[4:6], 16) / 255.0
    except (ValueError, IndexError):
        r, g, b = 0.6, 0.6, 0.6

    base_h, base_l, base_s = colorsys.rgb_to_hls(r, g, b)

    theme_count = len(themes)
    colors = {}

    for i, theme in enumerate(sorted(themes)):
        if theme_count == 1:
            # Single theme — use base color directly
            hue = base_h
        else:
            # Shift hue evenly across the spectrum
            hue_shift = (i * 1.0 / theme_count)
            hue = (base_h + hue_shift) % 1.0

        # Keep saturation and lightness close to base, with slight variation
        sat = max(0.2, min(1.0, base_s * (0.85 + 0.3 * (i / max(theme_count - 1, 1)))))
        lit = max(0.25, min(0.75, base_l))

        nr, ng, nb = colorsys.hls_to_rgb(hue, lit, sat)

        hex_color = '#{:02x}{:02x}{:02x}'.format(
            int(nr * 255), int(ng * 255), int(nb * 255)
        )
        colors[theme] = hex_color

    # Ensure 'other' has a muted color
    if 'other' not in colors:
        colors['other'] = '#6b7280'

    return colors


def _build_simple_tier_chain(
    spells: List[dict],
    school_name: str,
    max_children: int,
    config: dict
) -> Optional[dict]:
    """Fallback: build a simple tier-ordered chain when no themes are available.

    This is NOT classic's algorithm — it's a minimal chain per tier.
    """
    if not spells:
        return None

    by_tier: Dict[str, List[dict]] = {t: [] for t in TIER_ORDER}
    for spell in spells:
        tier = spell.get('skillLevel', '')
        if tier in TIER_INDEX:
            by_tier[tier].append(spell)
        else:
            by_tier['Novice'].append(spell)

    root_spell = _pick_root(by_tier, config, school_name)
    if not root_spell:
        return None

    nodes: Dict[str, TreeNode] = {}
    for spell in spells:
        fid = spell.get('formId', '')
        if fid:
            nodes[fid] = TreeNode.from_spell(spell)

    root_fid = root_spell['formId']
    if root_fid not in nodes:
        nodes[root_fid] = TreeNode.from_spell(root_spell)

    root = nodes[root_fid]
    root.is_root = True
    root.depth = 0

    connected = {root_fid}
    current_parent = root

    # Chain spells by tier
    all_sorted = _sort_by_tier_and_cost(
        [s for s in spells if s.get('formId', '') != root_fid]
    )

    for spell in all_sorted:
        fid = spell.get('formId', '')
        if not fid or fid in connected:
            continue
        node = nodes.get(fid)
        if not node:
            continue

        if len(current_parent.children) < max_children:
            link_nodes(current_parent, node)
            connected.add(fid)
            current_parent = node
        else:
            # Walk back to find capacity
            parent = _find_parent_with_capacity(current_parent, nodes, connected, max_children)
            if parent:
                link_nodes(parent, node)
                connected.add(fid)
                current_parent = node

    school_base_color = SCHOOL_COLORS.get(school_name, '#94a3b8')
    node_dicts = []
    for node in nodes.values():
        nd = node.to_dict()
        nd['themeColor'] = school_base_color
        node_dicts.append(nd)

    return {
        'root': root.form_id,
        'layoutStyle': 'thematic_bfs',
        'color': school_base_color,
        'branches': [],
        'nodes': node_dicts,
        'config_used': {
            'shape': 'thematic_bfs',
            'density': config.get('density', 0.6),
            'symmetry': config.get('symmetry', 0.3),
            'chaos': config.get('chaos', 0.0),
            'branch_style': config.get('branch_style', 'chain'),
            'source': 'thematic_fallback',
        }
    }


# ---------------------------------------------------------------------------
# Registration — server.py imports this module and calls register_command
# ---------------------------------------------------------------------------

try:
    from server import register_command
    register_command('build_tree_thematic', thematic_build_tree_from_data)
except ImportError:
    pass
