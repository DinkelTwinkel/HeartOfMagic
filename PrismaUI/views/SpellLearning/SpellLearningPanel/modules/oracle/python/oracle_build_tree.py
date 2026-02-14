#!/usr/bin/env python3
"""
Oracle Growth -- LLM-Guided Semantic Tree Builder

Builds spell trees using LLM intelligence for semantic grouping and narrative
chain discovery. When an LLM provider (OpenRouter or Ollama) is configured,
spells are sent to the model which groups them into thematic learning chains
ordered from fundamental to advanced. Each chain becomes a directed path in
the tree.

When LLM is unavailable, falls back to "Cluster Lane" mode: a visually
distinct layout that creates parallel lanes -- one sequential chain per
NLP-discovered theme, running side by side off the school root.

Output format matches the standard tree builder (classic_build_tree.py) so
the JS layout, apply, and PRM systems work unchanged, with optional extra
fields for chain metadata that the UI can use for rendering chain names
and narratives.

Reuses shared modules from SpellTreeBuilder/:
  - core.node (TreeNode, link_nodes)
  - theme_discovery (discover_themes_per_school, extract_spell_text)
  - spell_grouper (group_spells_best_fit, get_spell_primary_theme)
  - config (TreeBuilderConfig)
  - validator (validate_tree, fix_unreachable_nodes, get_validation_summary)
  - llm_client (LLMClient, create_client_from_config)
"""

import json
import random
import re
import sys
import time
import traceback
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

# Shared modules live in SpellTreeBuilder/ -- server.py adds it to sys.path
from core.node import TreeNode, link_nodes
from theme_discovery import extract_spell_text, discover_themes_per_school
from validator import validate_tree, get_validation_summary, fix_unreachable_nodes
from spell_grouper import group_spells_best_fit, get_spell_primary_theme

# LLM client -- optional, graceful degradation if unavailable
try:
    from llm_client import LLMClient, create_client_from_config
    HAS_LLM_CLIENT = True
except ImportError:
    HAS_LLM_CLIENT = False

# Log to SpellTreeBuilder's log directory
LOG_FILE = Path(__file__).resolve().parent.parent.parent.parent.parent.parent.parent / \
    "SKSE" / "Plugins" / "SpellLearning" / "SpellTreeBuilder" / "oracle_build_tree.log"

TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
TIER_INDEX = {t: i for i, t in enumerate(TIER_ORDER)}

# School color palette (matches JS rendering)
SCHOOL_COLORS = {
    'Destruction': '#C85050',
    'Restoration': '#E8C850',
    'Alteration': '#50A878',
    'Conjuration': '#8050C8',
    'Illusion': '#C850A8',
    'Hedge Wizard': '#888888',
}


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def _log(msg: str):
    """Append a timestamped line to the oracle log file."""
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

def _create_llm_client(config: dict) -> Optional['LLMClient']:
    """
    Try to create an LLM client from config.  Returns None if LLM is not
    available or not configured.
    """
    if not HAS_LLM_CLIENT:
        _log("LLM client module not importable -- fallback mode")
        return None

    # Check for llm_api settings
    llm_api = config.get('llm_api', {})
    if not llm_api or not llm_api.get('enabled', False):
        _log("LLM not enabled in config -- fallback mode")
        return None

    api_key = llm_api.get('api_key', '')
    provider = llm_api.get('provider', 'openrouter')
    model = llm_api.get('model', 'openai/gpt-4o-mini')

    # Determine endpoint based on provider
    if provider == 'ollama':
        url = llm_api.get('url', 'http://localhost:11434/v1/chat/completions')
        # Ollama doesn't need an API key but LLMClient checks length
        if not api_key:
            api_key = 'ollama-local'
    else:
        url = llm_api.get('url', 'https://openrouter.ai/api/v1/chat/completions')

    if not api_key:
        _log("No API key in llm_api config -- fallback mode")
        return None

    try:
        client = LLMClient(api_key=api_key, model=model, endpoint=url)
        if client.is_available():
            _log(f"LLM client created: provider={provider}, model={model}")
            return client
        _log("LLM client created but reports not available -- fallback mode")
        return None
    except Exception as e:
        _log(f"Failed to create LLM client: {e}")
        return None


def _build_llm_grouping_prompt(spells: List[dict], school_name: str,
                                cross_school: bool = False) -> str:
    """
    Build the prompt that asks the LLM to group spells into thematic
    learning chains.
    """
    spell_lines = []
    for s in spells:
        fid = s.get('formId', '?')
        name = s.get('name', fid)
        tier = s.get('skillLevel', '?')
        desc = (s.get('description', '') or '')[:60]
        effects = s.get('effectNames', []) or []
        eff_str = ', '.join(effects[:3]) if effects else ''
        line = f'  - id="{fid}" name="{name}" tier={tier}'
        if eff_str:
            line += f' effects=[{eff_str}]'
        if desc:
            line += f' desc="{desc}"'
        spell_lines.append(line)
    spell_block = '\n'.join(spell_lines)

    if cross_school:
        context = (
            "Group these spells regardless of school. Focus on thematic and "
            "mechanical connections across all schools."
        )
    else:
        context = (
            f"These are {school_name} spells. Group them into thematic "
            f"learning chains within the {school_name} school."
        )

    prompt = f"""You are a Skyrim spell taxonomy expert. {context}

Group these spells into 3-8 thematic learning chains. Order each chain from
simplest/most fundamental to most advanced. Every spell must belong to
exactly one chain. Each chain should represent a coherent progression
(e.g., "Fire Mastery": Flames -> Fire Rune -> Fireball -> Incinerate).

SPELLS:
{spell_block}

Return ONLY valid JSON in this exact format (no explanation):
{{
  "chains": [
    {{
      "name": "Chain Theme Name",
      "narrative": "Brief 1-sentence learning progression description",
      "spellIds": ["{spells[0].get('formId', '0x000')}", ...]
    }}
  ]
}}

RULES:
- Every spell ID from the list above MUST appear in exactly one chain
- Order spells within each chain from easiest (Novice) to hardest (Master)
- 3-8 chains total
- Chain names should be evocative (e.g., "Pyromancer's Path", "Frost Mastery")
- Return ONLY the JSON object"""

    return prompt


def _parse_llm_chains(response_data: Optional[dict],
                       valid_ids: set) -> Optional[List[dict]]:
    """
    Parse and validate LLM chain response.  Returns list of chain dicts or
    None if parsing fails.
    """
    if not response_data:
        return None

    chains = response_data.get('chains', [])
    if not chains or not isinstance(chains, list):
        _log("LLM response missing 'chains' array")
        return None

    # Validate: every chain must have name and spellIds
    cleaned_chains = []
    seen_ids = set()
    for chain in chains:
        if not isinstance(chain, dict):
            continue
        name = chain.get('name', '')
        spell_ids = chain.get('spellIds', [])
        narrative = chain.get('narrative', '')

        if not name or not spell_ids:
            continue

        # Filter to valid IDs and deduplicate
        filtered_ids = []
        for sid in spell_ids:
            if isinstance(sid, str) and sid in valid_ids and sid not in seen_ids:
                filtered_ids.append(sid)
                seen_ids.add(sid)

        if filtered_ids:
            cleaned_chains.append({
                'name': str(name),
                'narrative': str(narrative) if narrative else '',
                'spellIds': filtered_ids,
            })

    if not cleaned_chains:
        _log("LLM chains contained no valid spell IDs")
        return None

    # Check coverage: any spells not assigned?
    missing = valid_ids - seen_ids
    if missing:
        _log(f"LLM missed {len(missing)} spells -- appending to closest chain")
        # Append missing spells to the last chain (better than losing them)
        cleaned_chains[-1]['spellIds'].extend(sorted(missing))

    _log(f"Parsed {len(cleaned_chains)} chains covering {len(seen_ids)}/{len(valid_ids)} spells")
    return cleaned_chains


def _llm_group_spells(client: 'LLMClient', spells: List[dict],
                       school_name: str, batch_size: int,
                       cross_school: bool = False) -> Optional[List[dict]]:
    """
    Send spells to LLM for semantic grouping, with batching for large
    spell lists.  Returns list of chain dicts or None on failure.
    """
    valid_ids = {s.get('formId', '') for s in spells if s.get('formId')}

    # If small enough, send in one batch
    if len(spells) <= batch_size:
        prompt = _build_llm_grouping_prompt(spells, school_name, cross_school)
        try:
            result = client.call_json(
                prompt,
                system_prompt="You are a game design AI that outputs only valid JSON.",
                max_tokens=3000,
                temperature=0.5
            )
            return _parse_llm_chains(result, valid_ids)
        except Exception as e:
            _log(f"LLM call failed for {school_name}: {e}")
            return None

    # Batch mode: split spells into chunks, merge chains afterward
    all_chains = []
    for batch_start in range(0, len(spells), batch_size):
        batch = spells[batch_start:batch_start + batch_size]
        batch_ids = {s.get('formId', '') for s in batch if s.get('formId')}

        _log(f"  LLM batch {batch_start // batch_size + 1}: "
             f"{len(batch)} spells for {school_name}")

        prompt = _build_llm_grouping_prompt(batch, school_name, cross_school)
        try:
            result = client.call_json(
                prompt,
                system_prompt="You are a game design AI that outputs only valid JSON.",
                max_tokens=3000,
                temperature=0.5
            )
            batch_chains = _parse_llm_chains(result, batch_ids)
            if batch_chains:
                all_chains.extend(batch_chains)
        except Exception as e:
            _log(f"LLM batch call failed: {e}")
            continue

    if not all_chains:
        return None

    # Merge chains with similar names across batches
    merged = _merge_similar_chains(all_chains)

    # Verify full coverage
    covered = set()
    for chain in merged:
        covered.update(chain['spellIds'])
    missing = valid_ids - covered
    if missing:
        merged[-1]['spellIds'].extend(sorted(missing))

    return merged


def _merge_similar_chains(chains: List[dict]) -> List[dict]:
    """
    Merge chains from different batches that have similar names.
    Uses simple word overlap to detect similarity.
    """
    if len(chains) <= 1:
        return chains

    merged: List[dict] = []
    used = [False] * len(chains)

    for i, chain_a in enumerate(chains):
        if used[i]:
            continue
        used[i] = True
        combined_ids = list(chain_a['spellIds'])
        combined_name = chain_a['name']
        combined_narrative = chain_a.get('narrative', '')

        words_a = set(chain_a['name'].lower().split())

        for j in range(i + 1, len(chains)):
            if used[j]:
                continue
            words_b = set(chains[j]['name'].lower().split())
            # Merge if >50% word overlap
            if words_a and words_b:
                overlap = len(words_a & words_b) / min(len(words_a), len(words_b))
                if overlap >= 0.5:
                    combined_ids.extend(chains[j]['spellIds'])
                    used[j] = True
                    if not combined_narrative and chains[j].get('narrative'):
                        combined_narrative = chains[j]['narrative']

        merged.append({
            'name': combined_name,
            'narrative': combined_narrative,
            'spellIds': combined_ids,
        })

    return merged


# ---------------------------------------------------------------------------
# Root selection (shared between LLM and fallback)
# ---------------------------------------------------------------------------

def _pick_root(spells: List[dict], config: dict) -> Optional[dict]:
    """Pick the best root spell from the lowest available tier."""
    prefer_vanilla = config.get('prefer_vanilla_roots', True)

    by_tier: Dict[str, List[dict]] = {t: [] for t in TIER_ORDER}
    for spell in spells:
        tier = spell.get('skillLevel', '')
        if tier in TIER_INDEX:
            by_tier[tier].append(spell)
        else:
            by_tier['Novice'].append(spell)

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
# LLM Mode: Chain-First Tree Assembly
# ---------------------------------------------------------------------------

def _build_school_tree_llm(
    spells: List[dict],
    school_name: str,
    chains: List[dict],
    max_children: int,
    config: dict
) -> Optional[dict]:
    """
    Build one school's tree from LLM-provided chains.

    Each chain becomes a directed path.  All chain roots connect as children
    of the school root (lowest-tier spell).
    """
    if not spells or not chains:
        return None

    chain_style = config.get('chain_style', 'linear')

    # Pick the school root
    root_spell = _pick_root(spells, config)
    if not root_spell:
        return None
    root_id = root_spell['formId']

    # Create all nodes
    nodes: Dict[str, TreeNode] = {}
    spell_lookup: Dict[str, dict] = {}
    for spell in spells:
        fid = spell.get('formId', '')
        if fid:
            node = TreeNode.from_spell(spell)
            nodes[fid] = node
            spell_lookup[fid] = spell

    root_node = nodes.get(root_id)
    if not root_node:
        return None
    root_node.is_root = True
    root_node.depth = 0

    connected = {root_id}

    # Build each chain as a directed path
    for chain in chains:
        chain_name = chain.get('name', 'Unnamed')
        chain_ids = chain.get('spellIds', [])

        # Filter to IDs that exist in our node set and aren't already connected
        # (except root, which may appear in a chain)
        valid_chain_ids = [fid for fid in chain_ids if fid in nodes]
        if not valid_chain_ids:
            continue

        # Sort chain by tier order then magicka cost for consistent progression
        valid_chain_ids.sort(key=lambda fid: (
            TIER_INDEX.get(nodes[fid].tier, 0) * 10000 +
            (spell_lookup.get(fid, {}).get('magickaCost', 0) or 0)
        ))

        # Tag all nodes in this chain with the chain name
        for fid in valid_chain_ids:
            nodes[fid].theme = chain_name

        # Determine chain root (first spell in the chain)
        chain_root_id = valid_chain_ids[0]

        # If chain root IS the school root, skip connecting it to itself
        if chain_root_id != root_id and chain_root_id not in connected:
            chain_root_node = nodes[chain_root_id]
            link_nodes(root_node, chain_root_node)
            connected.add(chain_root_id)

        # Link the rest of the chain sequentially
        if chain_style == 'branching' and len(valid_chain_ids) > 4:
            # Branching: split long chains into sub-branches at mid-tier
            _build_branching_chain(
                valid_chain_ids, nodes, connected,
                root_id, max_children, spell_lookup
            )
        else:
            # Linear: simple sequential chain
            prev_id = chain_root_id if chain_root_id != root_id else root_id
            for fid in valid_chain_ids:
                if fid == chain_root_id or fid == root_id:
                    continue
                if fid in connected:
                    continue
                prev_node = nodes.get(prev_id)
                current_node = nodes.get(fid)
                if prev_node and current_node:
                    link_nodes(prev_node, current_node)
                    connected.add(fid)
                    prev_id = fid

    # Force-connect any remaining unconnected nodes
    unconnected = [fid for fid in nodes if fid not in connected]
    if unconnected:
        _log(f"  {school_name} LLM: {len(unconnected)} unconnected, force-attaching")
        _force_connect_to_nearest(unconnected, nodes, connected, root_id, max_children)

    # Serialize nodes
    node_dicts = []
    for n in nodes.values():
        d = n.to_dict()
        # Add chain name as extra field for JS rendering
        if n.theme:
            d['chain'] = n.theme
        node_dicts.append(d)

    # Build chain metadata for output
    chain_meta = []
    for chain in chains:
        chain_meta.append({
            'name': chain.get('name', ''),
            'spellIds': chain.get('spellIds', []),
            'narrative': chain.get('narrative', ''),
        })

    color = SCHOOL_COLORS.get(school_name, '#888888')

    return {
        'root': root_id,
        'layoutStyle': 'oracle_llm',
        'nodes': node_dicts,
        'color': color,
        'chains': chain_meta,
        'config_used': {
            'shape': 'oracle_chains',
            'density': config.get('density', 0.6),
            'symmetry': config.get('symmetry', 0.3),
            'source': 'oracle_llm',
            'chain_style': chain_style,
        }
    }


def _build_branching_chain(
    chain_ids: List[str],
    nodes: Dict[str, TreeNode],
    connected: set,
    root_id: str,
    max_children: int,
    spell_lookup: Dict[str, dict]
):
    """
    Build a branching chain: the first half is linear, then it splits
    into sub-branches at mid-tier for visual variety.
    """
    if len(chain_ids) < 2:
        return

    # Split point: roughly halfway
    split = len(chain_ids) // 2
    linear_part = chain_ids[:split]
    branch_part = chain_ids[split:]

    # Build linear part
    prev_id = linear_part[0] if linear_part[0] != root_id else root_id
    for fid in linear_part:
        if fid == prev_id or fid in connected:
            continue
        prev_node = nodes.get(prev_id)
        current_node = nodes.get(fid)
        if prev_node and current_node:
            link_nodes(prev_node, current_node)
            connected.add(fid)
            prev_id = fid

    # The branch point is the last node of the linear part
    branch_point_id = prev_id

    # Split remaining spells into 2 sub-branches
    mid = len(branch_part) // 2
    sub_a = branch_part[:mid]
    sub_b = branch_part[mid:]

    for sub_branch in [sub_a, sub_b]:
        prev_id = branch_point_id
        for fid in sub_branch:
            if fid in connected:
                continue
            prev_node = nodes.get(prev_id)
            current_node = nodes.get(fid)
            if prev_node and current_node:
                if len(prev_node.children) < max_children:
                    link_nodes(prev_node, current_node)
                    connected.add(fid)
                    prev_id = fid


# ---------------------------------------------------------------------------
# Fallback Mode: Cluster Lane
# ---------------------------------------------------------------------------

def _build_school_tree_fallback(
    spells: List[dict],
    school_name: str,
    themes: List[str],
    max_children: int,
    config: dict
) -> Optional[dict]:
    """
    Build one school's tree in Cluster Lane mode (no LLM).

    Creates parallel lanes -- one chain per theme cluster, running side by
    side.  Produces a visually distinct tree from classic/tree/graph modes.
    """
    if not spells:
        return None

    # Pick root
    root_spell = _pick_root(spells, config)
    if not root_spell:
        return None
    root_id = root_spell['formId']

    # Create all nodes
    nodes: Dict[str, TreeNode] = {}
    for spell in spells:
        fid = spell.get('formId', '')
        if fid:
            nodes[fid] = TreeNode.from_spell(spell)

    root_node = nodes.get(root_id)
    if not root_node:
        return None
    root_node.is_root = True
    root_node.depth = 0

    # Group spells by theme using shared NLP module
    if themes:
        groups = group_spells_best_fit(spells, themes, min_score=30)
    else:
        # No themes discovered -- single "General" group
        groups = {'General': spells}

    connected = {root_id}
    chain_meta = []

    for theme_name, theme_spells in groups.items():
        if theme_name == '_unassigned' or not theme_spells:
            continue

        # Sort spells within theme by tier then magicka cost
        theme_spells_sorted = sorted(theme_spells, key=lambda s: (
            TIER_INDEX.get(s.get('skillLevel', ''), 5) * 10000 +
            (s.get('magickaCost', 0) or 0)
        ))

        # Filter to only spells that have nodes
        chain_ids = [s['formId'] for s in theme_spells_sorted
                     if s.get('formId') and s['formId'] in nodes]
        if not chain_ids:
            continue

        # Tag nodes with theme
        for fid in chain_ids:
            if fid in nodes:
                nodes[fid].theme = theme_name

        # Connect first spell in chain to root (if not root itself)
        chain_root_id = chain_ids[0]
        if chain_root_id != root_id and chain_root_id not in connected:
            chain_root_node = nodes[chain_root_id]
            if len(root_node.children) < max_children:
                link_nodes(root_node, chain_root_node)
                connected.add(chain_root_id)
            else:
                # Root is full -- find another connected node as parent
                parent = _find_available_parent(nodes, connected, max_children)
                if parent:
                    link_nodes(parent, chain_root_node)
                    connected.add(chain_root_id)

        # Chain remaining spells sequentially
        prev_id = chain_root_id if chain_root_id != root_id else root_id
        for fid in chain_ids:
            if fid == chain_root_id or fid == root_id or fid in connected:
                continue
            prev_node = nodes.get(prev_id)
            current_node = nodes.get(fid)
            if prev_node and current_node:
                if len(prev_node.children) < max_children:
                    link_nodes(prev_node, current_node)
                    connected.add(fid)
                    prev_id = fid
                else:
                    # Parent full -- try any connected node with capacity
                    alt_parent = _find_available_parent(nodes, connected, max_children)
                    if alt_parent:
                        link_nodes(alt_parent, current_node)
                        connected.add(fid)
                        prev_id = fid

        # Record chain metadata
        chain_meta.append({
            'name': theme_name.replace('_', ' ').title(),
            'spellIds': chain_ids,
            'narrative': f'{theme_name} progression lane',
        })

    # Handle _unassigned spells
    unassigned = groups.get('_unassigned', [])
    for spell in unassigned:
        fid = spell.get('formId', '')
        if fid and fid in nodes and fid not in connected:
            nodes[fid].theme = '_unassigned'
            parent = _find_available_parent(nodes, connected, max_children)
            if parent:
                link_nodes(parent, nodes[fid])
                connected.add(fid)

    # Force-connect remaining
    still_unconnected = [fid for fid in nodes if fid not in connected]
    if still_unconnected:
        _log(f"  {school_name} fallback: {len(still_unconnected)} unconnected, force-attaching")
        _force_connect_to_nearest(still_unconnected, nodes, connected, root_id, max_children)

    # Serialize
    node_dicts = []
    for n in nodes.values():
        d = n.to_dict()
        if n.theme:
            d['chain'] = n.theme
        node_dicts.append(d)

    color = SCHOOL_COLORS.get(school_name, '#888888')

    return {
        'root': root_id,
        'layoutStyle': 'oracle_cluster_lane',
        'nodes': node_dicts,
        'color': color,
        'chains': chain_meta,
        'config_used': {
            'shape': 'cluster_lanes',
            'density': config.get('density', 0.6),
            'symmetry': config.get('symmetry', 0.3),
            'source': 'oracle_fallback',
        }
    }


# ---------------------------------------------------------------------------
# Shared utility
# ---------------------------------------------------------------------------

def _find_available_parent(
    nodes: Dict[str, TreeNode],
    connected: set,
    max_children: int
) -> Optional[TreeNode]:
    """Find a connected node that has room for more children."""
    # Prefer nodes with fewest children for balance
    candidates = []
    for fid in connected:
        node = nodes.get(fid)
        if node and len(node.children) < max_children:
            candidates.append(node)

    if not candidates:
        # Relax constraint: allow max_children + 2
        for fid in connected:
            node = nodes.get(fid)
            if node and len(node.children) < max_children + 2:
                candidates.append(node)

    if candidates:
        candidates.sort(key=lambda n: len(n.children))
        return candidates[0]
    return None


def _force_connect_to_nearest(
    unconnected: List[str],
    nodes: Dict[str, TreeNode],
    connected: set,
    root_id: str,
    max_children: int
):
    """
    Force-connect unconnected nodes to the best available parent.
    Respects tier ordering when possible.
    """
    for fid in unconnected:
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
            child_count = len(cnode.children)

            score = 0.0

            # Tier ordering: parent should be at lower or equal tier
            if cnode_tier_idx <= node_tier_idx:
                score += 100.0
                tier_diff = node_tier_idx - cnode_tier_idx
                score -= tier_diff * 5.0
            else:
                score -= 200.0

            # Theme match
            if node.theme and cnode.theme and node.theme == cnode.theme:
                score += 25.0

            # Load balance
            score -= child_count * 10.0

            if score > best_score:
                best_score = score
                best_parent = cnode

        if best_parent:
            link_nodes(best_parent, node)
            node.depth = TIER_INDEX.get(node.tier, 0)
            connected.add(fid)
        else:
            # Last resort: connect to root
            root_node = nodes.get(root_id)
            if root_node:
                link_nodes(root_node, node)
                connected.add(fid)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def oracle_build_tree_from_data(spells: list, config_dict: dict) -> dict:
    """
    Build LLM-guided (Oracle) or cluster-lane (Fallback) spell trees.

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
        used_seed = int(time.time() * 1000) % 1000000
    random.seed(used_seed)
    config['seed'] = used_seed

    _log(f"oracle_build_tree: seed={used_seed}, {len(spells)} spells")

    # Oracle-specific config defaults
    config.setdefault('max_children_per_node', 4)
    config.setdefault('chaos', 0.0)
    config.setdefault('batch_size', 20)
    config.setdefault('chain_style', 'linear')
    config.setdefault('top_themes_per_school', 8)
    config.setdefault('auto_fix_unreachable', True)
    config.setdefault('prefer_vanilla_roots', True)

    chaos = max(0.0, min(1.0, float(config.get('chaos', 0.0))))
    batch_size = max(5, int(config.get('batch_size', 20)))
    max_children = max(1, min(8, int(config.get('max_children_per_node', 4))))

    # Try to create LLM client
    llm_client = _create_llm_client(config)
    llm_mode = 'llm' if llm_client else 'fallback'
    _log(f"oracle mode: {llm_mode}, chaos={chaos}, batch_size={batch_size}")

    # Group spells by school (only the 5 vanilla magic schools)
    VALID_SCHOOLS = {'Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration'}
    school_spells: Dict[str, List[dict]] = defaultdict(list)
    for spell in spells:
        school = spell.get('school', '')
        if school not in VALID_SCHOOLS:
            continue
        school_spells[school].append(spell)

    # Discover themes per school (used by fallback mode and as quality signal)
    themes_per_school: Dict[str, List[str]] = {}
    try:
        themes_per_school = discover_themes_per_school(
            spells,
            top_n=config.get('top_themes_per_school', 8),
            fallback=True
        )
    except Exception as e:
        _log(f"Theme discovery failed: {e}")

    # Merge with vanilla hints for coverage
    try:
        from theme_discovery import merge_with_hints
        themes_per_school = merge_with_hints(
            themes_per_school,
            max_themes=config.get('top_themes_per_school', 8) + 4
        )
    except Exception as e:
        _log(f"merge_with_hints failed (non-critical): {e}")

    # Cross-school chaos mode: LLM groups ALL spells regardless of school
    cross_school_chains = None
    if llm_client and chaos > 0.3:
        _log(f"Cross-school chaos mode (chaos={chaos}): sending all {len(spells)} spells to LLM")
        try:
            cross_school_chains = _llm_group_spells(
                llm_client, spells, 'All Schools',
                batch_size, cross_school=True
            )
            if cross_school_chains:
                _log(f"Cross-school LLM returned {len(cross_school_chains)} chains")
        except Exception as e:
            _log(f"Cross-school LLM failed: {e}")
            cross_school_chains = None

    # Build each school's tree
    tree_data: Dict[str, Any] = {'version': '1.0', 'schools': {}}
    actual_mode = llm_mode  # Track if we actually used LLM or fell back

    for school_name, school_spell_list in school_spells.items():
        _log(f"Building {school_name}: {len(school_spell_list)} spells (mode={llm_mode})")

        school_result = None

        if llm_client and llm_mode == 'llm':
            # LLM Mode
            try:
                if cross_school_chains and chaos > 0.3:
                    # Use cross-school chains filtered to this school's spells
                    school_fids = {s['formId'] for s in school_spell_list if s.get('formId')}
                    school_chains = _filter_chains_for_school(
                        cross_school_chains, school_fids
                    )
                else:
                    # Per-school LLM grouping
                    school_chains = _llm_group_spells(
                        llm_client, school_spell_list,
                        school_name, batch_size
                    )

                if school_chains:
                    school_result = _build_school_tree_llm(
                        school_spell_list, school_name, school_chains,
                        max_children, config
                    )
                    if school_result:
                        _log(f"  {school_name} LLM: {len(school_result['nodes'])} nodes, "
                             f"{len(school_chains)} chains")
                else:
                    _log(f"  {school_name}: LLM returned no chains, falling back")
            except Exception as e:
                _log(f"  {school_name} LLM error: {e}\n{traceback.format_exc()}")

        # Fallback: Cluster Lane mode
        if not school_result:
            if llm_mode == 'llm':
                actual_mode = 'mixed'  # Some schools LLM, some fallback
            school_themes = themes_per_school.get(school_name, [])
            school_result = _build_school_tree_fallback(
                school_spell_list, school_name, school_themes,
                max_children, config
            )
            if school_result:
                _log(f"  {school_name} fallback: {len(school_result['nodes'])} nodes")

        if school_result:
            tree_data['schools'][school_name] = school_result

    # If no LLM was used at all, mark as fallback
    if actual_mode == 'llm' and not llm_client:
        actual_mode = 'fallback'

    # Metadata
    tree_data['generatedAt'] = datetime.now().isoformat()
    tree_data['generator'] = 'OracleTreeBuilder (LLM-Guided)'
    tree_data['config'] = {
        'shape': 'oracle_chains' if actual_mode == 'llm' else 'cluster_lanes',
        'density': config.get('density', 0.6),
        'symmetry': config.get('symmetry', 0.3),
        'chaos': chaos,
        'chain_style': config.get('chain_style', 'linear'),
    }
    tree_data['seed'] = used_seed
    tree_data['llm_mode'] = actual_mode

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
            _log(f"Auto-fixed {total_fixes} unreachable nodes")
            validation = validate_tree(tree_data, max_children)
            summary = get_validation_summary(validation)

    tree_data['validation'] = {
        'all_valid': summary['all_valid'],
        'total_nodes': summary['total_nodes'],
        'reachable_nodes': summary['reachable_nodes'],
    }

    _log(f"oracle_build_tree complete: {summary['total_nodes']} nodes, "
         f"valid={summary['all_valid']}, mode={actual_mode}")
    return tree_data


def _filter_chains_for_school(
    all_chains: List[dict],
    school_fids: set
) -> List[dict]:
    """
    Filter cross-school chains to only include spells from one school.
    Chains that have no spells from this school are dropped.
    """
    filtered = []
    for chain in all_chains:
        school_ids = [fid for fid in chain.get('spellIds', []) if fid in school_fids]
        if school_ids:
            filtered.append({
                'name': chain.get('name', ''),
                'narrative': chain.get('narrative', ''),
                'spellIds': school_ids,
            })
    return filtered


# ---------------------------------------------------------------------------
# Server registration
# ---------------------------------------------------------------------------

try:
    from server import register_command
    register_command('build_tree_oracle', oracle_build_tree_from_data)
except ImportError:
    pass
