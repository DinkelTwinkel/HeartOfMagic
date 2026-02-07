#!/usr/bin/env python3
"""Test LLM routing for ambiguous mod spells."""

import json
from pathlib import Path
from improved_discovery import ImprovedThemeDiscovery, ImprovedTreeBuilder

# API key for testing
OPENROUTER_API_KEY = "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"

SCAN_DIR = Path(r'G:\MODSTAGING\HIRCINE\overwrite\SKSE\Plugins\SpellLearning\schools')


def test_llm_routing():
    """Test LLM routing on Destruction school (best mix of fire/frost/shock from mods)."""

    print("=" * 80)
    print("LLM ROUTING TEST - Destruction School")
    print("=" * 80)

    scan_file = SCAN_DIR / "Destruction_spells.json"
    if not scan_file.exists():
        print(f"ERROR: {scan_file} not found")
        return

    with open(scan_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    spells = data.get('spells', [])
    print(f"\nLoaded {len(spells)} spells")

    # Test WITHOUT LLM first
    print("\n--- WITHOUT LLM ---")
    discovery_no_llm = ImprovedThemeDiscovery(
        min_theme_size=3,
        max_themes=15,
        max_theme_size=80,
        llm_api_key=None  # No LLM
    )
    builder = ImprovedTreeBuilder(root_count=5)
    tree_no_llm = builder.build_tree(spells, discovery_no_llm)

    print(f"Themes: {len(tree_no_llm['themes'])}")
    print(f"LLM routing decisions: {len(discovery_no_llm.llm_routing_log)}")

    # Test WITH LLM
    print("\n--- WITH LLM ---")
    discovery_llm = ImprovedThemeDiscovery(
        min_theme_size=3,
        max_themes=15,
        max_theme_size=80,
        llm_api_key=OPENROUTER_API_KEY
    )
    tree_llm = builder.build_tree(spells, discovery_llm)

    print(f"Themes: {len(tree_llm['themes'])}")
    print(f"LLM routing decisions: {len(discovery_llm.llm_routing_log)}")

    if discovery_llm.llm_routing_log:
        print("\nLLM Routing Decisions:")
        for decision in discovery_llm.llm_routing_log[:20]:  # Show first 20
            if decision['decision'] == 'branch':
                arrow = f"-> branch ({decision.get('parent_theme', '?')})"
            else:
                arrow = "-> mod"
            print(f"  {decision['spell']}: [{', '.join(decision['keywords'])}] {arrow}")
        if len(discovery_llm.llm_routing_log) > 20:
            print(f"  ... and {len(discovery_llm.llm_routing_log) - 20} more")

    # Show branch assignments
    if discovery_llm.branch_assignments:
        print(f"\nBranch Assignments ({len(discovery_llm.branch_assignments)}):")
        by_theme = {}
        for spell, theme in discovery_llm.branch_assignments.items():
            by_theme.setdefault(theme, []).append(spell)
        for theme, spells in by_theme.items():
            print(f"  {theme}: {len(spells)} branch spells")
            for s in spells[:3]:
                print(f"    - {s}")
            if len(spells) > 3:
                print(f"    ... and {len(spells) - 3} more")

    # Compare results
    print("\n--- COMPARISON ---")
    print(f"Without LLM: {len(tree_no_llm['themes'])} themes, {len(tree_no_llm['links'])} links")
    print(f"With LLM: {len(tree_llm['themes'])} themes, {len(tree_llm['links'])} links")
    print(f"Branch links: {tree_llm.get('branch_count', 0)}")


if __name__ == '__main__':
    test_llm_routing()
