"""
LLM Keyword Classifier for SpellTreeBuilder.

Classifies spells that have no keywords (or weak keyword matches) by
sending batches to an LLM. The LLM assigns each spell to an existing
keyword group OR creates a new keyword parented under an existing one.

Results are stored as `llm_keyword` and `llm_keyword_parent` fields
in the spell dictionary, which the tree builder consumes for grouping.
"""

import json
from typing import Dict, Any, Optional, List, Callable

from spell_grouper import calculate_theme_score
from theme_discovery import discover_themes_per_school, merge_with_hints

BATCH_SIZE = 100

SYSTEM_PROMPT = (
    "You are a spell classification assistant for Skyrim magic schools. "
    "You classify spells into keyword groups based on their name, effects, "
    "and description. Be consistent and precise. Always return valid JSON."
)


def _needs_classification(spell: Dict[str, Any], themes: List[str]) -> bool:
    """
    Check if a spell needs LLM classification.

    A spell needs classification when its best fuzzy match score
    against all themes is below the grouping threshold (30).
    """
    if not themes:
        return True

    # Already classified by LLM in a previous run
    if spell.get('llm_keyword'):
        return False

    best_score = 0
    for theme in themes:
        score = calculate_theme_score(spell, theme)
        if score > best_score:
            best_score = score

    return best_score < 30


def _build_prompt(school: str, spells: List[Dict[str, Any]],
                  existing_keywords: List[str]) -> str:
    """Build the LLM prompt for keyword classification."""
    spell_entries = []
    for s in spells:
        entry = {
            "id": s.get("formId", ""),
            "name": s.get("name", "Unknown"),
            "effects": (s.get("effectNames") or [])[:3],
            "description": (s.get("description") or "")[:80],
            "keywords": s.get("keywords", [])
        }
        spell_entries.append(entry)

    prompt = f"""Classify each {school} spell into a keyword group.

EXISTING KEYWORDS for {school}:
{json.dumps(existing_keywords, indent=2)}

SPELLS TO CLASSIFY:
{json.dumps(spell_entries, indent=2)}

For each spell, assign it to ONE existing keyword OR create a new keyword.

Rules:
- Prefer assigning to an existing keyword when the spell clearly fits
- If creating a new keyword, it MUST have a "parent" from the existing list (the most related existing keyword)
- New keywords should be specific (e.g., "drain" under "frost", "rune" under "fire")
- Use lowercase single-word keywords
- Confidence: 0-100 (how confident you are in this assignment)

Return ONLY a JSON object:
{{
  "0xFORMID": {{
    "keyword": "fire",
    "parent": null,
    "confidence": 95
  }},
  "0xFORMID2": {{
    "keyword": "drain",
    "parent": "frost",
    "confidence": 70
  }}
}}

- "parent" is null when assigning to an existing keyword
- "parent" is the existing keyword name when creating a new keyword
JSON only, no explanation."""

    return prompt


def _classify_batch(client, school: str, batch: List[Dict[str, Any]],
                    existing_keywords: List[str]) -> Optional[Dict[str, Dict[str, Any]]]:
    """
    Send one batch to LLM, return {formId: {keyword, parent, confidence}}.

    Returns None on error.
    """
    prompt = _build_prompt(school, batch, existing_keywords)

    # Use larger max_tokens for batches of 100 spells
    result = client.call_json(prompt, system_prompt=SYSTEM_PROMPT,
                              max_tokens=4096, temperature=0.3)

    if not result:
        return None

    # Validate result structure
    validated = {}
    for form_id, classification in result.items():
        if not isinstance(classification, dict):
            continue
        keyword = classification.get('keyword')
        if not keyword or not isinstance(keyword, str):
            continue
        validated[form_id] = {
            'keyword': keyword.lower().strip(),
            'parent': (classification.get('parent') or '').lower().strip() or None,
            'confidence': int(classification.get('confidence', 50))
        }

    return validated


def classify_school_spells(
    client,
    school: str,
    spells: List[Dict[str, Any]],
    existing_keywords: List[str],
    batch_size: int = BATCH_SIZE,
    min_confidence: int = 40,
    progress_callback: Optional[Callable] = None
) -> int:
    """
    Classify spells for one school using LLM keyword assignment.

    Modifies spell dicts in-place, adding llm_keyword/llm_keyword_parent fields.

    Args:
        client: LLMClient with call_json() method
        school: School name
        spells: Spells to potentially classify (modified in-place)
        existing_keywords: Discovered themes for this school
        batch_size: Max spells per LLM batch
        min_confidence: Minimum confidence to accept classification
        progress_callback: Optional fn(processed, total, school)

    Returns:
        Number of spells classified
    """
    # Filter to spells needing classification
    needs_work = [s for s in spells if _needs_classification(s, existing_keywords)]

    if not needs_work:
        print(f"[KeywordClassifier] {school}: All spells have good keyword matches")
        return 0

    print(f"[KeywordClassifier] {school}: {len(needs_work)}/{len(spells)} spells need classification")

    # Build formId lookup for merging results back
    spell_lookup = {s.get('formId'): s for s in spells if s.get('formId')}

    classified = 0

    for offset in range(0, len(needs_work), batch_size):
        batch = needs_work[offset:offset + batch_size]
        batch_num = offset // batch_size + 1
        total_batches = (len(needs_work) + batch_size - 1) // batch_size

        print(f"[KeywordClassifier] {school}: Batch {batch_num}/{total_batches} ({len(batch)} spells)")

        results = _classify_batch(client, school, batch, existing_keywords)

        if results:
            for form_id, classification in results.items():
                if form_id in spell_lookup and classification['confidence'] >= min_confidence:
                    spell = spell_lookup[form_id]
                    spell['llm_keyword'] = classification['keyword']
                    spell['llm_keyword_parent'] = classification['parent']
                    spell['llm_keyword_confidence'] = classification['confidence']
                    classified += 1
        else:
            print(f"[KeywordClassifier] {school}: Batch {batch_num} failed, skipping")

        if progress_callback:
            progress_callback(min(offset + batch_size, len(needs_work)), len(needs_work), school)

    print(f"[KeywordClassifier] {school}: Classified {classified}/{len(needs_work)} spells")
    return classified


def classify_all_schools(
    client,
    spells: List[Dict[str, Any]],
    themes: Optional[Dict[str, List[str]]] = None,
    batch_size: int = BATCH_SIZE,
    min_confidence: int = 40,
    top_themes: int = 8,
    progress_callback: Optional[Callable] = None
) -> int:
    """
    Classify spells across all schools.

    Discovers themes if not provided, then classifies per school.
    Modifies spell dicts in-place.

    Args:
        client: LLMClient instance
        spells: All spells (modified in-place)
        themes: Pre-discovered themes per school (optional)
        batch_size: Max spells per LLM batch
        min_confidence: Minimum confidence to accept
        top_themes: Number of themes per school if discovering
        progress_callback: Optional fn(processed, total, school)

    Returns:
        Total number of spells classified
    """
    # Discover themes if not provided
    if themes is None:
        themes = discover_themes_per_school(spells, top_n=top_themes)
        themes = merge_with_hints(themes, max_themes=top_themes + 4)

    # Group spells by school (only the 5 vanilla magic schools)
    VALID_SCHOOLS = {'Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration'}
    school_spells: Dict[str, List[Dict[str, Any]]] = {}
    for spell in spells:
        school = spell.get('school', '')
        if school not in VALID_SCHOOLS:
            continue
        if school not in school_spells:
            school_spells[school] = []
        school_spells[school].append(spell)

    total_classified = 0

    for school_name, school_spell_list in school_spells.items():
        school_themes = themes.get(school_name, [])
        count = classify_school_spells(
            client=client,
            school=school_name,
            spells=school_spell_list,
            existing_keywords=school_themes,
            batch_size=batch_size,
            min_confidence=min_confidence,
            progress_callback=progress_callback
        )
        total_classified += count

    return total_classified
