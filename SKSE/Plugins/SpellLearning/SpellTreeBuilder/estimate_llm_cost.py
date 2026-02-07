#!/usr/bin/env python3
"""Estimate LLM API cost for edge case resolution."""

import json
from pathlib import Path

SCAN_DIR = Path(r'G:\MODSTAGING\HIRCINE\overwrite\SKSE\Plugins\SpellLearning\schools')

# OpenRouter pricing (per 1M tokens) - as of Feb 2024
PRICING = {
    'claude-3-haiku': {'input': 0.25, 'output': 1.25},      # $0.25/$1.25 per 1M
    'claude-3-sonnet': {'input': 3.00, 'output': 15.00},    # $3/$15 per 1M
    'claude-3-opus': {'input': 15.00, 'output': 75.00},     # $15/$75 per 1M
    'gpt-4o-mini': {'input': 0.15, 'output': 0.60},         # $0.15/$0.60 per 1M
    'gpt-4o': {'input': 2.50, 'output': 10.00},             # $2.50/$10 per 1M
}

# Estimated tokens per request
BATCH_SIZE = 10  # Spells per LLM call
TOKENS_PER_PROMPT = 300  # Theme list + instructions
TOKENS_PER_SPELL = 15    # Spell name in prompt
TOKENS_PER_RESPONSE = 5  # "SpellName: theme" per spell

def estimate_costs():
    """Estimate LLM costs for all schools."""

    print("=" * 70)
    print("LLM COST ESTIMATION FOR EDGE CASE RESOLUTION")
    print("=" * 70)

    # Count edge cases per school (from previous runs)
    edge_cases = {
        'Alteration': {'spells': 185, 'edge_pct': 61.6},
        'Conjuration': {'spells': 595, 'edge_pct': 59.5},
        'Destruction': {'spells': 328, 'edge_pct': 52.1},
        'Illusion': {'spells': 171, 'edge_pct': 62.0},
        'Restoration': {'spells': 227, 'edge_pct': 54.6},
    }

    total_spells = sum(s['spells'] for s in edge_cases.values())
    total_edge_cases = sum(int(s['spells'] * s['edge_pct'] / 100) for s in edge_cases.values())

    print(f"\nTotal spells: {total_spells}")
    print(f"Total edge cases: {total_edge_cases} ({total_edge_cases/total_spells*100:.1f}%)")

    # Calculate API calls needed
    api_calls = (total_edge_cases + BATCH_SIZE - 1) // BATCH_SIZE

    print(f"\nBatch size: {BATCH_SIZE} spells per API call")
    print(f"API calls needed: {api_calls}")

    # Token estimation
    input_tokens_per_call = TOKENS_PER_PROMPT + (TOKENS_PER_SPELL * BATCH_SIZE)
    output_tokens_per_call = TOKENS_PER_RESPONSE * BATCH_SIZE

    total_input_tokens = input_tokens_per_call * api_calls
    total_output_tokens = output_tokens_per_call * api_calls

    print(f"\nToken estimation:")
    print(f"  Input tokens per call: ~{input_tokens_per_call}")
    print(f"  Output tokens per call: ~{output_tokens_per_call}")
    print(f"  Total input tokens: ~{total_input_tokens:,}")
    print(f"  Total output tokens: ~{total_output_tokens:,}")

    # Cost per model
    print(f"\n{'Model':<20} {'Input Cost':<12} {'Output Cost':<12} {'Total':<12}")
    print("-" * 60)

    for model, prices in PRICING.items():
        input_cost = (total_input_tokens / 1_000_000) * prices['input']
        output_cost = (total_output_tokens / 1_000_000) * prices['output']
        total_cost = input_cost + output_cost

        print(f"{model:<20} ${input_cost:<11.4f} ${output_cost:<11.4f} ${total_cost:<11.4f}")

    # Recommendation
    haiku_cost = ((total_input_tokens / 1_000_000) * PRICING['claude-3-haiku']['input'] +
                  (total_output_tokens / 1_000_000) * PRICING['claude-3-haiku']['output'])

    print(f"\n{'=' * 70}")
    print("RECOMMENDATION")
    print("=" * 70)
    print(f"""
Using Claude 3 Haiku (best value for classification tasks):

  Edge cases to resolve: {total_edge_cases}
  API calls needed: {api_calls}
  Estimated cost: ${haiku_cost:.4f} (~{haiku_cost*100:.2f} cents)

  Per school breakdown:""")

    for school, data in edge_cases.items():
        school_edge = int(data['spells'] * data['edge_pct'] / 100)
        school_calls = (school_edge + BATCH_SIZE - 1) // BATCH_SIZE
        school_input = input_tokens_per_call * school_calls
        school_output = output_tokens_per_call * school_calls
        school_cost = ((school_input / 1_000_000) * PRICING['claude-3-haiku']['input'] +
                       (school_output / 1_000_000) * PRICING['claude-3-haiku']['output'])
        print(f"    {school:<15} {school_edge:>4} edge cases -> ${school_cost:.4f}")

    print(f"""
Notes:
  - Actual token counts may vary based on spell/theme name lengths
  - Cost includes ~20% buffer for retries
  - One-time cost per spell scan (results can be cached)
  - Running ALL schools: ~${haiku_cost * 1.2:.3f} with buffer
""")


if __name__ == '__main__':
    estimate_costs()
