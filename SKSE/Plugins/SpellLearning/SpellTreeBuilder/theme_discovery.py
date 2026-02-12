"""
Theme Discovery Module for Spell Tree Builder

Uses TF-IDF (Term Frequency-Inverse Document Frequency) to discover
significant keywords/themes within each magic school's spell list.

This identifies words that are unique and meaningful to each school,
like "fire", "frost", "flesh", "paralyze" etc.
"""

import re
from typing import List, Dict, Any, Optional

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    import numpy as np
    HAS_SKLEARN = True
except ImportError as _sklearn_err:
    HAS_SKLEARN = False
    _SKLEARN_ERROR = str(_sklearn_err)


# Common words to exclude beyond sklearn's english stop words
SPELL_STOP_WORDS = [
    # Generic spell words
    'spell', 'magic', 'magical', 'target', 'targets', 'effect', 'effects',
    'damage', 'point', 'points', 'second', 'seconds', 'per', 'for', 'the',
    'does', 'causes', 'cast', 'caster', 'casting', 'level', 'levels',
    'health', 'magicka', 'stamina', 'drain', 'drains',
    # Effect description template fragments — these appear identically across
    # all element types and drown out meaningful terms like fire/frost/shock
    'deals', 'deal', 'dur', 'duration', 'mag', 'magnitude',
    'nearby', 'enemies', 'enemy', 'increased', 'increases', 'increase',
    'decreased', 'decreases', 'decrease', 'reduces', 'reduced', 'reduce',
    'restores', 'restore', 'restored', 'absorb', 'absorbs', 'absorbed',
    'extra', 'takes', 'take', 'time', 'over', 'while', 'also',
    'resistance', 'chance', 'once', 'each', 'within', 'range',
    'stronger', 'powerful', 'greater', 'lesser', 'more', 'less',
    # Skill level words (we use skillLevel field, not text)
    'novice', 'apprentice', 'adept', 'expert', 'master',
    # Common prepositions and articles
    'to', 'a', 'an', 'of', 'in', 'on', 'at', 'is', 'are', 'be', 'with',
    'that', 'this', 'their', 'your', 'and', 'or', 'but', 'not', 'all',
]


def extract_spell_text(spell: Dict[str, Any]) -> str:
    """
    Extract searchable text from a spell for theme analysis.
    Combines name, effect names, and descriptions.
    
    Args:
        spell: Spell dictionary with name, effectNames, effects, etc.
        
    Returns:
        Combined text string for analysis
    """
    parts = []

    # Add spell name (3x weight — spell names are the strongest theme signal)
    if 'name' in spell and spell['name']:
        parts.append(spell['name'])
        parts.append(spell['name'])
        parts.append(spell['name'])

    # Add effect names (3x weight — "Fire Damage", "Frost Damage" etc. are
    # highly discriminative, unlike descriptions which are templated)
    if 'effectNames' in spell and spell['effectNames']:
        for en in spell['effectNames']:
            parts.append(en)
            parts.append(en)
            parts.append(en)

    # Add full effect descriptions (1x — these are templated across elements
    # and contain generic fragments like "deals X damage for Y seconds")
    if 'effects' in spell and spell['effects']:
        for effect in spell['effects']:
            if isinstance(effect, dict):
                if 'name' in effect:
                    # Effect name again (already covered by effectNames above,
                    # but structured effects may differ)
                    parts.append(effect['name'])
                if 'description' in effect:
                    parts.append(effect['description'])

    # Add keywords if available
    if 'keywords' in spell and spell['keywords']:
        # Clean keyword names (remove Magic prefix, etc.)
        for kw in spell['keywords']:
            cleaned = re.sub(r'^Magic', '', kw)
            cleaned = re.sub(r'([A-Z])', r' \1', cleaned).strip()
            parts.append(cleaned)

    return ' '.join(parts).lower()


def discover_themes(
    spells: List[Dict[str, Any]],
    top_n: int = 8,
    min_df: int = 1,
    max_df: float = 0.8,
    ngram_range: tuple = (1, 2),
    fallback: bool = False
) -> List[str]:
    """
    Discover the most significant themes/keywords in a set of spells
    using TF-IDF analysis.

    Args:
        spells: List of spell dictionaries
        top_n: Number of top themes to extract
        min_df: Minimum document frequency (spells containing the term)
        max_df: Maximum document frequency ratio (ignore terms in >80% of spells)
        ngram_range: Range of n-grams to consider (1,2) = unigrams and bigrams
        fallback: If True, use word frequency counting instead of TF-IDF

    Returns:
        List of theme keywords, sorted by importance
    """
    if not spells:
        return []

    if not HAS_SKLEARN:
        if fallback:
            return _fallback_keyword_extraction(spells, top_n)
        raise ImportError(
            f"sklearn is required for theme discovery but is not installed: {_SKLEARN_ERROR}. "
            f"Install the Python Addon from the mod page, or click 'Retry with Fallback' to use basic word-frequency analysis."
        )

    # Build corpus from spell texts
    corpus = [extract_spell_text(spell) for spell in spells]

    # Filter out empty texts
    corpus = [text for text in corpus if text.strip()]

    if len(corpus) < 2:
        # Not enough data for TF-IDF
        return _fallback_keyword_extraction(spells, top_n)
    
    # Combine custom stop words with sklearn's english stop words
    all_stop_words = list(SPELL_STOP_WORDS)
    
    try:
        vectorizer = TfidfVectorizer(
            stop_words='english',
            max_features=50,
            min_df=min_df,
            max_df=max_df,
            ngram_range=ngram_range,
            token_pattern=r'\b[a-zA-Z]{3,}\b'  # Words with 3+ chars
        )
        
        tfidf_matrix = vectorizer.fit_transform(corpus)
        feature_names = vectorizer.get_feature_names_out()
        
        # Calculate aggregate importance scores
        # Sum TF-IDF scores across all documents
        scores = np.asarray(tfidf_matrix.sum(axis=0)).flatten()
        
        # Get indices sorted by score (descending)
        top_indices = scores.argsort()[::-1]
        
        # Filter out custom stop words and collect top themes
        themes = []
        for idx in top_indices:
            term = feature_names[idx]
            # Skip if in our custom stop words
            if term.lower() in [sw.lower() for sw in all_stop_words]:
                continue
            # Skip single-character terms
            if len(term) <= 2:
                continue
            themes.append(term)
            if len(themes) >= top_n:
                break
        
        return themes
        
    except ValueError as e:
        # TF-IDF failed (e.g., all terms filtered)
        print(f"[ThemeDiscovery] TF-IDF failed: {e}, using fallback")
        return _fallback_keyword_extraction(spells, top_n)


def _fallback_keyword_extraction(spells: List[Dict[str, Any]], top_n: int) -> List[str]:
    """
    Simple fallback keyword extraction when TF-IDF fails.
    Uses word frequency counting.
    """
    word_counts = {}
    
    for spell in spells:
        text = extract_spell_text(spell)
        words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
        
        for word in words:
            if word not in [sw.lower() for sw in SPELL_STOP_WORDS]:
                word_counts[word] = word_counts.get(word, 0) + 1
    
    # Sort by count and return top N
    sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
    return [word for word, count in sorted_words[:top_n]]


def discover_themes_per_school(
    spells: List[Dict[str, Any]],
    top_n: int = 8,
    fallback: bool = False
) -> Dict[str, List[str]]:
    """
    Discover themes for each magic school separately.
    
    Args:
        spells: List of all spell dictionaries
        top_n: Number of themes per school
        
    Returns:
        Dictionary mapping school name to list of themes
    """
    # Group spells by school
    schools: Dict[str, List[Dict[str, Any]]] = {}
    for spell in spells:
        school = spell.get('school', 'Unknown')
        if not school or school in ('null', 'undefined', 'None', ''):
            school = 'Hedge Wizard'
        if school not in schools:
            schools[school] = []
        schools[school].append(spell)
    
    # Discover themes for each school
    school_themes = {}
    for school_name, school_spells in schools.items():
        themes = discover_themes(school_spells, top_n=top_n, fallback=fallback)
        school_themes[school_name] = themes
        print(f"[ThemeDiscovery] {school_name}: {len(school_spells)} spells -> themes: {themes}")
    
    return school_themes


# Pre-defined theme hints for vanilla Skyrim schools
# These are used to seed the discovery if TF-IDF produces poor results
VANILLA_THEME_HINTS = {
    'Destruction': ['fire', 'frost', 'shock', 'cloak', 'rune', 'wall', 'bolt', 'storm'],
    'Conjuration': ['conjure', 'summon', 'bound', 'atronach', 'zombie', 'raise', 'reanimate', 'dremora'],
    'Alteration': ['flesh', 'armor', 'paralyze', 'detect', 'light', 'transmute', 'waterbreathing', 'telekinesis'],
    'Illusion': ['fury', 'fear', 'calm', 'courage', 'invisibility', 'muffle', 'frenzy', 'pacify'],
    'Restoration': ['heal', 'healing', 'ward', 'turn', 'undead', 'cure', 'bane', 'circle'],
}


def merge_with_hints(discovered: Dict[str, List[str]], max_themes: int = 10) -> Dict[str, List[str]]:
    """
    Merge discovered themes with vanilla hints to ensure good coverage.
    Hints are prioritized FIRST (they are known-good element/type names),
    then high-quality discovered themes fill remaining slots.
    """
    merged = {}

    for school, themes in discovered.items():
        if school in VANILLA_THEME_HINTS:
            # Start with hints as the baseline — these are curated element/type
            # names that produce coherent groupings (fire, frost, shock, etc.)
            hints = list(VANILLA_THEME_HINTS[school])
            hint_lower = {h.lower() for h in hints}
            # Then add discovered themes that aren't already covered by hints
            for t in themes:
                if t.lower() not in hint_lower:
                    hints.append(t)
                    if len(hints) >= max_themes:
                        break
            merged[school] = hints[:max_themes]
        else:
            # Non-vanilla school — use discovered themes as-is
            merged[school] = list(themes[:max_themes])

    return merged


if __name__ == '__main__':
    # Test with sample data
    sample_spells = [
        {'name': 'Flames', 'school': 'Destruction', 'effectNames': ['Fire Damage'], 'skillLevel': 'Novice'},
        {'name': 'Frostbite', 'school': 'Destruction', 'effectNames': ['Frost Damage'], 'skillLevel': 'Novice'},
        {'name': 'Sparks', 'school': 'Destruction', 'effectNames': ['Shock Damage'], 'skillLevel': 'Novice'},
        {'name': 'Fireball', 'school': 'Destruction', 'effectNames': ['Fire Damage'], 'skillLevel': 'Adept'},
        {'name': 'Ice Storm', 'school': 'Destruction', 'effectNames': ['Frost Damage'], 'skillLevel': 'Adept'},
        {'name': 'Oakflesh', 'school': 'Alteration', 'effectNames': ['Armor'], 'skillLevel': 'Novice'},
        {'name': 'Stoneflesh', 'school': 'Alteration', 'effectNames': ['Armor'], 'skillLevel': 'Apprentice'},
        {'name': 'Paralyze', 'school': 'Alteration', 'effectNames': ['Paralyze'], 'skillLevel': 'Expert'},
    ]
    
    themes = discover_themes_per_school(sample_spells)
    print(f"\nDiscovered themes: {themes}")
