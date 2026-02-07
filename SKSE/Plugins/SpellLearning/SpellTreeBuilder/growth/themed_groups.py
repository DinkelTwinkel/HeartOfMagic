"""
LLM-Powered Themed Groups for spell tree enhancement.

This module provides:
- ThemedGroup: A spell group with LLM-defined name, color, and growth rules
- ThemedGroupManager: Manages groups and provides growth rules for spells
- Functions to discover fuzzy groups and enhance them via LLM

The flow:
1. Find top N fuzzy theme groups from spell data
2. Sample representative spells from each group
3. Send group info + spells to LLM
4. LLM returns: group name, color, custom growth rules
5. During tree building, spells in a group use that group's rules
"""

from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
import json
import random

# Try to import thefuzz for fuzzy matching
try:
    from thefuzz import fuzz, process
    HAS_FUZZY = True
except ImportError:
    HAS_FUZZY = False


@dataclass
class ThemedGroup:
    """A themed group of spells with LLM-defined attributes."""
    
    # Group identification
    id: str
    name: str  # LLM-generated name (e.g., "Pyromancy")
    
    # Common keywords that define this group
    keywords: List[str] = field(default_factory=list)
    
    # Visual styling
    color: str = "#888888"  # Hex color for UI display
    
    # Growth style
    growth_style: str = "organic"  # dense, sparse, linear, branchy, clustered
    
    # Custom branching energy for this group
    branching_energy: Dict[str, Any] = field(default_factory=lambda: {
        "min_straight": 2,
        "max_straight": 5,
    })
    
    # Special rule (optional, for unique behavior)
    special_rule: Optional[str] = None
    
    # Member spell form IDs
    member_form_ids: List[str] = field(default_factory=list)
    
    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'ThemedGroup':
        """Create from dictionary (e.g., LLM response)."""
        return cls(
            id=d.get('id', ''),
            name=d.get('name', d.get('group_name', 'Unknown')),
            keywords=d.get('keywords', []),
            color=d.get('color', d.get('group_color', '#888888')),
            growth_style=d.get('growth_style', 'organic'),
            branching_energy=d.get('branching_energy', {"min_straight": 2, "max_straight": 5}),
            special_rule=d.get('special_rule'),
            member_form_ids=d.get('member_form_ids', d.get('member_formIds', [])),
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'id': self.id,
            'name': self.name,
            'keywords': self.keywords,
            'color': self.color,
            'growth_style': self.growth_style,
            'branching_energy': self.branching_energy,
            'special_rule': self.special_rule,
            'member_form_ids': self.member_form_ids,
        }
    
    def get_branching_config(self) -> Dict[str, Any]:
        """Get branching energy config for this group."""
        base = {
            "enabled": True,
            "min_straight": 2,
            "max_straight": 5,
            "energy_per_node": 0.3,
            "energy_to_branch": 1.0,
            "randomness": 0.3,
        }
        base.update(self.branching_energy)
        return base


class ThemedGroupManager:
    """
    Manages LLM-defined themed groups.
    
    Provides growth rule lookups during tree building.
    """
    
    def __init__(self, groups: Optional[List[ThemedGroup]] = None):
        """
        Initialize with optional groups.
        
        Args:
            groups: List of ThemedGroup instances
        """
        self.groups: Dict[str, ThemedGroup] = {}
        self.spell_to_group: Dict[str, str] = {}  # formId -> group_id
        
        if groups:
            for group in groups:
                self.add_group(group)
    
    def add_group(self, group: ThemedGroup) -> None:
        """Add a group to the manager."""
        self.groups[group.id] = group
        
        # Index member spells
        for form_id in group.member_form_ids:
            self.spell_to_group[form_id] = group.id
    
    def get_group(self, group_id: str) -> Optional[ThemedGroup]:
        """Get a group by ID."""
        return self.groups.get(group_id)
    
    def get_group_for_spell(self, form_id: str) -> Optional[ThemedGroup]:
        """Get the group a spell belongs to."""
        group_id = self.spell_to_group.get(form_id)
        if group_id:
            return self.groups.get(group_id)
        return None
    
    def get_growth_style_for_spell(self, form_id: str) -> Optional[str]:
        """Get growth style if spell belongs to a group."""
        group = self.get_group_for_spell(form_id)
        return group.growth_style if group else None
    
    def get_branching_config_for_spell(self, form_id: str) -> Optional[Dict[str, Any]]:
        """Get custom branching config if spell belongs to a group."""
        group = self.get_group_for_spell(form_id)
        return group.get_branching_config() if group else None
    
    def get_color_for_spell(self, form_id: str) -> Optional[str]:
        """Get group color for a spell (for UI)."""
        group = self.get_group_for_spell(form_id)
        return group.color if group else None
    
    def list_groups(self) -> List[ThemedGroup]:
        """Get all groups."""
        return list(self.groups.values())
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert all groups to dictionary."""
        return {
            'groups': [g.to_dict() for g in self.groups.values()],
        }
    
    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'ThemedGroupManager':
        """Create from dictionary."""
        groups = [ThemedGroup.from_dict(g) for g in d.get('groups', [])]
        return cls(groups)


def find_fuzzy_groups(
    spells: List[Dict[str, Any]],
    num_groups: int = 5,
    min_group_size: int = 3
) -> List[Dict[str, Any]]:
    """
    Find fuzzy theme groups from spell data using name similarity.
    
    Args:
        spells: List of spell dictionaries
        num_groups: Number of groups to find
        min_group_size: Minimum spells per group
    
    Returns:
        List of group dictionaries with keywords and member form IDs
    """
    if not HAS_FUZZY:
        # Fallback: simple keyword grouping
        return _fallback_grouping(spells, num_groups)
    
    # Extract spell names and form IDs
    spell_map = {s['formId']: s['name'] for s in spells if 'name' in s}
    names = list(spell_map.values())
    form_ids = list(spell_map.keys())
    
    if len(names) < num_groups * min_group_size:
        num_groups = max(1, len(names) // min_group_size)
    
    # Find clusters via fuzzy matching
    groups = []
    used_indices = set()
    
    for _ in range(num_groups):
        if len(used_indices) >= len(names):
            break
        
        # Find a seed name (not yet used)
        seed_idx = None
        for i, name in enumerate(names):
            if i not in used_indices:
                seed_idx = i
                break
        
        if seed_idx is None:
            break
        
        seed_name = names[seed_idx]
        used_indices.add(seed_idx)
        
        # Find similar names
        similar = []
        for i, name in enumerate(names):
            if i in used_indices:
                continue
            
            score = fuzz.token_sort_ratio(seed_name, name)
            if score > 50:  # Similarity threshold
                similar.append((i, name, score))
        
        # Sort by similarity, take top matches
        similar.sort(key=lambda x: x[2], reverse=True)
        
        group_indices = [seed_idx]
        for idx, _, _ in similar[:min_group_size * 2]:
            if idx not in used_indices:
                group_indices.append(idx)
                used_indices.add(idx)
        
        if len(group_indices) >= min_group_size:
            # Extract common keywords
            group_names = [names[i] for i in group_indices]
            keywords = _extract_common_words(group_names)
            
            groups.append({
                'id': f"group_{len(groups)+1}",
                'keywords': keywords[:5],  # Top 5 keywords
                'member_form_ids': [form_ids[i] for i in group_indices],
                'sample_names': group_names[:5],
            })
    
    return groups


def _fallback_grouping(spells: List[Dict[str, Any]], num_groups: int) -> List[Dict[str, Any]]:
    """Simple grouping without fuzzy matching (fallback)."""
    # Group by first significant word in name
    word_groups: Dict[str, List[Dict[str, Any]]] = {}
    
    for spell in spells:
        name = spell.get('name', '')
        words = name.lower().split()
        
        # Find first significant word (skip common prefixes)
        skip_words = {'the', 'a', 'an', 'lesser', 'greater', 'improved', 'mass'}
        key_word = None
        for word in words:
            if word not in skip_words and len(word) > 2:
                key_word = word
                break
        
        if key_word:
            if key_word not in word_groups:
                word_groups[key_word] = []
            word_groups[key_word].append(spell)
    
    # Sort by group size and take top N
    sorted_groups = sorted(word_groups.items(), key=lambda x: len(x[1]), reverse=True)
    
    groups = []
    for keyword, members in sorted_groups[:num_groups]:
        if len(members) >= 3:
            groups.append({
                'id': f"group_{len(groups)+1}",
                'keywords': [keyword],
                'member_form_ids': [s['formId'] for s in members],
                'sample_names': [s['name'] for s in members[:5]],
            })
    
    return groups


def _extract_common_words(names: List[str]) -> List[str]:
    """Extract common words from a list of names."""
    word_counts: Dict[str, int] = {}
    stop_words = {'the', 'a', 'an', 'of', 'to', 'in', 'for', 'and', 'or', 'i', 'ii', 'iii'}
    
    for name in names:
        words = set(name.lower().split())
        for word in words:
            if word not in stop_words and len(word) > 2:
                word_counts[word] = word_counts.get(word, 0) + 1
    
    # Sort by frequency
    sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
    return [word for word, _ in sorted_words]


def sample_spells_from_group(
    group: Dict[str, Any],
    spells: List[Dict[str, Any]],
    num_samples: int = 5
) -> List[Dict[str, Any]]:
    """
    Sample representative spells from a group.
    
    Args:
        group: Group dictionary with member_form_ids
        spells: All spells
        num_samples: Number to sample
    
    Returns:
        List of sampled spell dictionaries
    """
    # Build lookup
    spell_map = {s['formId']: s for s in spells}
    
    # Get group members
    member_ids = group.get('member_form_ids', [])
    members = [spell_map[fid] for fid in member_ids if fid in spell_map]
    
    if len(members) <= num_samples:
        return members
    
    # Sample with tier diversity
    by_tier: Dict[str, List[Dict[str, Any]]] = {}
    for spell in members:
        tier = spell.get('skillLevel', 'Unknown')
        if tier not in by_tier:
            by_tier[tier] = []
        by_tier[tier].append(spell)
    
    samples = []
    tiers = list(by_tier.keys())
    
    while len(samples) < num_samples and any(by_tier.values()):
        for tier in tiers:
            if by_tier.get(tier) and len(samples) < num_samples:
                samples.append(by_tier[tier].pop(random.randint(0, len(by_tier[tier])-1)))
    
    return samples


def format_spells_for_llm(spells: List[Dict[str, Any]]) -> str:
    """Format spell list for LLM prompt."""
    lines = []
    for i, spell in enumerate(spells, 1):
        name = spell.get('name', spell.get('formId', 'Unknown'))
        tier = spell.get('skillLevel', 'Unknown')
        school = spell.get('school', '')
        
        desc = spell.get('description', '')[:50] + '...' if len(spell.get('description', '')) > 50 else spell.get('description', '')
        
        line = f"{i}. {name} - {tier}"
        if desc:
            line += f" ({desc})"
        lines.append(line)
    
    return '\n'.join(lines)


def build_group_enhancement_prompt(
    group: Dict[str, Any],
    sample_spells: List[Dict[str, Any]],
    template: str
) -> str:
    """
    Build the LLM prompt for group enhancement.
    
    Args:
        group: Group dictionary with keywords
        sample_spells: Sample spells from the group
        template: Prompt template with {{PLACEHOLDERS}}
    
    Returns:
        Formatted prompt string
    """
    keywords = ', '.join(group.get('keywords', ['unknown']))
    spell_list = format_spells_for_llm(sample_spells)
    group_index = group.get('id', 'unknown')
    
    prompt = template
    prompt = prompt.replace('{{GROUP_KEYWORDS}}', keywords)
    prompt = prompt.replace('{{SPELL_LIST}}', spell_list)
    prompt = prompt.replace('{{GROUP_INDEX}}', str(group_index))
    
    return prompt


def parse_llm_group_response(response: str, group: Dict[str, Any]) -> ThemedGroup:
    """
    Parse LLM response into a ThemedGroup.
    
    Args:
        response: Raw LLM response (should be JSON)
        group: Original group dictionary
    
    Returns:
        ThemedGroup instance
    """
    try:
        # Try to extract JSON from response
        json_start = response.find('{')
        json_end = response.rfind('}') + 1
        
        if json_start >= 0 and json_end > json_start:
            json_str = response[json_start:json_end]
            data = json.loads(json_str)
        else:
            data = {}
    except json.JSONDecodeError:
        data = {}
    
    # Build ThemedGroup from LLM response + original group data
    return ThemedGroup(
        id=group.get('id', 'unknown'),
        name=data.get('GROUP_NAME', data.get('group_name', data.get('name', 'Unknown Group'))),
        keywords=group.get('keywords', []),
        color=data.get('GROUP_COLOR', data.get('group_color', data.get('color', '#888888'))),
        growth_style=data.get('GROWTH_STYLE', data.get('growth_style', 'organic')),
        branching_energy=data.get('BRANCHING_ENERGY', data.get('branching_energy', {})),
        special_rule=data.get('SPECIAL_RULE', data.get('special_rule')),
        member_form_ids=group.get('member_form_ids', []),
    )
