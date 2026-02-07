#!/usr/bin/env python3
"""Test LLM edge case resolution."""

import json
import requests
from pathlib import Path
from improved_discovery import ImprovedThemeDiscovery, ImprovedTreeBuilder

# API Configuration
OPENROUTER_API_KEY = "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"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SCAN_DIR = Path(r'G:\MODSTAGING\HIRCINE\overwrite\SKSE\Plugins\SpellLearning\schools')


def resolve_edge_cases_llm(edge_cases: list, themes: dict, school: str) -> dict:
    """Resolve edge cases using LLM."""
    if not edge_cases:
        return {}

    # Build prompt
    themes_desc = "\n".join(
        f"- {name}" for name in sorted(themes.keys())
    )

    # Take first 10 edge cases
    batch = edge_cases[:10]
    spells_desc = "\n".join(
        f"- {ec['spell']}" for ec in batch
    )

    prompt = f"""You are classifying {school} spells for a Skyrim spell tree.

Available themes for {school}:
{themes_desc}

These spells need classification - pick the BEST theme for each:
{spells_desc}

For each spell, respond with ONLY:
SpellName: theme_name

Pick the most thematically appropriate theme. Be concise."""

    print(f"\n  Sending {len(batch)} spells to LLM...")

    try:
        response = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/skyrim-modding",
                "X-Title": "SpellTreeBuilder"
            },
            json={
                "model": "anthropic/claude-3-haiku",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 500,
                "temperature": 0.3
            },
            timeout=30
        )

        if response.status_code == 200:
            result = response.json()
            text = result['choices'][0]['message']['content']
            print(f"  LLM Response:\n{text}\n")

            # Parse responses
            resolutions = {}
            for line in text.strip().split('\n'):
                if ':' in line:
                    parts = line.split(':', 1)
                    spell = parts[0].strip().lstrip('- ')
                    theme = parts[1].strip().lower()
                    # Find matching theme (case-insensitive)
                    for t in themes.keys():
                        if t.lower() == theme or theme in t.lower():
                            resolutions[spell] = t
                            break

            return resolutions
        else:
            print(f"  API Error: {response.status_code}")
            print(f"  Response: {response.text[:500]}")
            return {}

    except Exception as e:
        print(f"  Exception: {e}")
        return {}


def test_llm_resolution():
    """Test LLM resolution on one school."""

    print("=" * 80)
    print("LLM EDGE CASE RESOLUTION TEST")
    print("=" * 80)

    # Test with Conjuration (most diverse edge cases)
    school = "Conjuration"
    scan_file = SCAN_DIR / f"{school}_spells.json"

    if not scan_file.exists():
        print(f"ERROR: {scan_file} not found")
        return

    with open(scan_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    spells = data.get('spells', [])
    print(f"\n{school}: {len(spells)} spells")

    # Build tree
    discovery = ImprovedThemeDiscovery(min_theme_size=3, max_themes=15, max_theme_size=80)
    builder = ImprovedTreeBuilder(root_count=5)
    tree = builder.build_tree(spells, discovery)

    print(f"Discovered {len(tree['themes'])} themes:")
    for name in sorted(tree['themes'].keys()):
        print(f"  - {name}")

    # Get edge cases
    edge_cases = discovery.find_edge_cases(0.3)
    print(f"\nEdge cases: {len(edge_cases)} ({len(edge_cases)/len(spells)*100:.1f}%)")

    # Filter to find likely misclassifications (very low confidence or in "other" themes)
    likely_wrong = [ec for ec in edge_cases
                    if ec['confidence'] < 0.15 or 'other' in ec['assigned_theme'].lower()
                    or 'dwarven' in ec['assigned_theme'].lower()]

    print(f"Likely misclassified: {len(likely_wrong)}")

    if likely_wrong:
        print("\nSample likely misclassified:")
        for ec in likely_wrong[:5]:
            print(f"  {ec['spell']}: currently '{ec['assigned_theme']}' (conf: {ec['confidence']:.2f})")

        # Resolve with LLM - use likely_wrong instead
        resolutions = resolve_edge_cases_llm(likely_wrong, tree['themes'], school)

        if resolutions:
            print(f"\nLLM Resolutions ({len(resolutions)}):")
            for spell, theme in resolutions.items():
                # Find original assignment
                orig = next((ec['assigned_theme'] for ec in edge_cases if ec['spell'] == spell), '?')
                changed = "CHANGED" if orig != theme else "same"
                print(f"  {spell}: {orig} -> {theme} [{changed}]")

            # Count changes
            changes = sum(1 for spell, theme in resolutions.items()
                         if any(ec['spell'] == spell and ec['assigned_theme'] != theme
                               for ec in edge_cases))
            print(f"\nLLM changed {changes}/{len(resolutions)} assignments")


if __name__ == '__main__':
    test_llm_resolution()
