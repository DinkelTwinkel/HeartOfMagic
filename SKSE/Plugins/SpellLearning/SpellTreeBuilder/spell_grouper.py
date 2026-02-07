"""
Spell Grouper Module for Spell Tree Builder

Uses fuzzy string matching to group spells into thematic clusters
based on discovered themes from TF-IDF analysis.

Each spell is assigned to its best-matching theme, creating
logical groupings like "fire spells", "flesh spells", etc.
"""

from thefuzz import fuzz, process
from typing import List, Dict, Any, Tuple, Optional
from collections import defaultdict

from theme_discovery import extract_spell_text


def calculate_theme_score(spell: Dict[str, Any], theme: str) -> int:
    """
    Calculate how well a spell matches a theme using fuzzy matching.
    
    Uses multiple fuzzy matching strategies and combines scores.
    
    Args:
        spell: Spell dictionary
        theme: Theme keyword to match against
        
    Returns:
        Fuzzy match score (0-100)
    """
    text = extract_spell_text(spell)
    spell_name = spell.get('name', '').lower()
    
    # Strategy 1: Check if theme is substring (exact match bonus)
    if theme.lower() in text:
        substring_bonus = 30
    elif theme.lower() in spell_name:
        substring_bonus = 40  # Higher bonus for name match
    else:
        substring_bonus = 0
    
    # Strategy 2: Partial ratio (best substring match)
    partial_score = fuzz.partial_ratio(theme.lower(), text)
    
    # Strategy 3: Token set ratio (handles word reordering)
    token_score = fuzz.token_set_ratio(theme.lower(), text)
    
    # Strategy 4: Direct name comparison (weighted higher)
    name_score = fuzz.partial_ratio(theme.lower(), spell_name) * 1.2
    
    # Combine scores (weighted average)
    combined = (
        partial_score * 0.25 +
        token_score * 0.25 +
        name_score * 0.3 +
        substring_bonus
    )
    
    return min(100, int(combined))


def group_spells_by_themes(
    spells: List[Dict[str, Any]],
    themes: List[str],
    min_score: int = 40,
    allow_multiple: bool = False
) -> Dict[str, List[Tuple[Dict[str, Any], int]]]:
    """
    Group spells into theme-based clusters using fuzzy matching.
    
    Args:
        spells: List of spell dictionaries
        themes: List of theme keywords
        min_score: Minimum fuzzy match score to assign to a theme
        allow_multiple: If True, a spell can appear in multiple groups
        
    Returns:
        Dictionary mapping theme to list of (spell, score) tuples
    """
    groups: Dict[str, List[Tuple[Dict[str, Any], int]]] = {theme: [] for theme in themes}
    groups['_unassigned'] = []  # For spells that don't match any theme
    
    for spell in spells:
        # Calculate scores for all themes
        theme_scores = [(theme, calculate_theme_score(spell, theme)) for theme in themes]
        theme_scores.sort(key=lambda x: x[1], reverse=True)
        
        best_theme, best_score = theme_scores[0] if theme_scores else (None, 0)
        
        if best_score >= min_score and best_theme:
            groups[best_theme].append((spell, best_score))
            
            # Optionally add to secondary themes
            if allow_multiple:
                for theme, score in theme_scores[1:3]:  # Top 3 themes
                    if score >= min_score * 0.9:  # 90% of threshold
                        groups[theme].append((spell, score))
        else:
            groups['_unassigned'].append((spell, best_score))
    
    # Sort each group by score (highest first)
    for theme in groups:
        groups[theme].sort(key=lambda x: x[1], reverse=True)
    
    return groups


def group_spells_best_fit(
    spells: List[Dict[str, Any]],
    themes: List[str],
    min_score: int = 30
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Group spells using best-fit assignment (each spell goes to exactly one theme).

    This is the primary grouping method for tree building.
    Honors llm_keyword fields from LLM keyword classification when present.

    Args:
        spells: List of spell dictionaries
        themes: List of theme keywords
        min_score: Minimum score threshold

    Returns:
        Dictionary mapping theme to list of spells (without scores)
    """
    groups = group_spells_by_themes(spells, themes, min_score, allow_multiple=False)

    # Convert to simple spell lists (drop scores)
    result = {}
    for theme, spell_score_list in groups.items():
        result[theme] = [spell for spell, score in spell_score_list]

    # Move LLM-classified spells from _unassigned to their proper group
    unassigned = result.get('_unassigned', [])
    if unassigned:
        reclassified = []
        for spell in unassigned:
            llm_kw = spell.get('llm_keyword')
            if not llm_kw:
                continue
            # Direct match to existing theme
            if llm_kw in result:
                result[llm_kw].append(spell)
                reclassified.append(spell)
            # Use parent theme
            elif spell.get('llm_keyword_parent') and spell['llm_keyword_parent'] in result:
                result[spell['llm_keyword_parent']].append(spell)
                reclassified.append(spell)

        for spell in reclassified:
            unassigned.remove(spell)

    return result


def balance_groups(
    groups: Dict[str, List[Dict[str, Any]]],
    max_group_size: int = 50,
    min_group_size: int = 2
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Balance groups by splitting large ones and merging small ones.
    
    Args:
        groups: Dictionary of theme -> spell list
        max_group_size: Split groups larger than this
        min_group_size: Merge groups smaller than this
        
    Returns:
        Balanced groups dictionary
    """
    balanced = {}
    small_groups = []
    
    for theme, spells in groups.items():
        if theme == '_unassigned':
            balanced[theme] = spells
            continue
            
        if len(spells) > max_group_size:
            # Split by tier
            tier_groups = split_by_tier(spells)
            for tier, tier_spells in tier_groups.items():
                sub_theme = f"{theme}_{tier}"
                balanced[sub_theme] = tier_spells
        elif len(spells) < min_group_size:
            small_groups.extend(spells)
        else:
            balanced[theme] = spells
    
    # Add small group spells to _unassigned
    if small_groups:
        if '_unassigned' not in balanced:
            balanced['_unassigned'] = []
        balanced['_unassigned'].extend(small_groups)
    
    return balanced


def split_by_tier(spells: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Split spells into tier groups."""
    tiers = defaultdict(list)
    for spell in spells:
        tier = spell.get('skillLevel', 'Unknown')
        tiers[tier].append(spell)
    return dict(tiers)


def assign_spells_to_themes_greedy(
    spells: List[Dict[str, Any]],
    themes: List[str],
    max_per_theme: Optional[int] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Greedy assignment: assign each spell to its best available theme.
    
    If max_per_theme is set, themes that are "full" are skipped,
    and the spell goes to the next best theme.
    
    Args:
        spells: List of spell dictionaries
        themes: List of theme keywords
        max_per_theme: Maximum spells per theme (None = unlimited)
        
    Returns:
        Dictionary mapping theme to list of spells
    """
    groups: Dict[str, List[Dict[str, Any]]] = {theme: [] for theme in themes}
    groups['_unassigned'] = []
    
    # Calculate all scores first
    spell_theme_scores = []
    for spell in spells:
        scores = [(theme, calculate_theme_score(spell, theme)) for theme in themes]
        scores.sort(key=lambda x: x[1], reverse=True)
        spell_theme_scores.append((spell, scores))
    
    # Sort spells by their best score (highest first gets priority)
    spell_theme_scores.sort(key=lambda x: x[1][0][1] if x[1] else 0, reverse=True)
    
    # Assign greedily
    for spell, scores in spell_theme_scores:
        assigned = False
        for theme, score in scores:
            if score < 30:  # Minimum threshold
                break
            if max_per_theme and len(groups[theme]) >= max_per_theme:
                continue
            groups[theme].append(spell)
            assigned = True
            break
        
        if not assigned:
            groups['_unassigned'].append(spell)
    
    return groups


def get_spell_primary_theme(
    spell: Dict[str, Any],
    themes: List[str]
) -> Tuple[str, int]:
    """
    Get the best matching theme for a single spell.
    
    Args:
        spell: Spell dictionary
        themes: List of available themes
        
    Returns:
        Tuple of (best_theme, score)
    """
    if not themes:
        return ('_unassigned', 0)
    
    scores = [(theme, calculate_theme_score(spell, theme)) for theme in themes]
    scores.sort(key=lambda x: x[1], reverse=True)
    
    return scores[0]


def analyze_group_distribution(groups: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    """
    Analyze the distribution of spells across groups.
    
    Returns statistics about group sizes and balance.
    """
    sizes = {theme: len(spells) for theme, spells in groups.items()}
    non_empty = {k: v for k, v in sizes.items() if v > 0 and k != '_unassigned'}
    
    if not non_empty:
        return {
            'total_groups': 0,
            'total_spells': 0,
            'unassigned': len(groups.get('_unassigned', [])),
        }
    
    values = list(non_empty.values())
    return {
        'total_groups': len(non_empty),
        'total_spells': sum(values),
        'unassigned': len(groups.get('_unassigned', [])),
        'min_size': min(values),
        'max_size': max(values),
        'avg_size': sum(values) / len(values),
        'sizes': sizes,
    }


if __name__ == '__main__':
    # Test with sample data
    sample_spells = [
        {'name': 'Flames', 'school': 'Destruction', 'effectNames': ['Fire Damage'], 'skillLevel': 'Novice'},
        {'name': 'Frostbite', 'school': 'Destruction', 'effectNames': ['Frost Damage'], 'skillLevel': 'Novice'},
        {'name': 'Sparks', 'school': 'Destruction', 'effectNames': ['Shock Damage'], 'skillLevel': 'Novice'},
        {'name': 'Fireball', 'school': 'Destruction', 'effectNames': ['Fire Damage'], 'skillLevel': 'Adept'},
        {'name': 'Ice Storm', 'school': 'Destruction', 'effectNames': ['Frost Damage'], 'skillLevel': 'Adept'},
        {'name': 'Lightning Bolt', 'school': 'Destruction', 'effectNames': ['Shock Damage'], 'skillLevel': 'Apprentice'},
        {'name': 'Fire Rune', 'school': 'Destruction', 'effectNames': ['Fire Damage'], 'skillLevel': 'Apprentice'},
        {'name': 'Frost Cloak', 'school': 'Destruction', 'effectNames': ['Frost Damage'], 'skillLevel': 'Adept'},
    ]
    
    themes = ['fire', 'frost', 'shock', 'cloak', 'rune']
    
    groups = group_spells_best_fit(sample_spells, themes)
    
    print("Grouped spells:")
    for theme, spells in groups.items():
        if spells:
            print(f"  {theme}: {[s['name'] for s in spells]}")
    
    stats = analyze_group_distribution(groups)
    print(f"\nDistribution: {stats}")
