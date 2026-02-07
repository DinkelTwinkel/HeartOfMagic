"""
Configuration schema and defaults for the SpellTreeBuilder.

Provides validation and default values for all configuration options.
"""

from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field, asdict


# Default LLM prompts (editable via UI)
DEFAULT_AUTO_CONFIGURE_PROMPT = """You are designing a UNIQUE visual spell tree for: {{SCHOOL_NAME}}

Sample spells: {{SPELL_LIST}}

## WHAT EACH SETTING DOES VISUALLY:

**density** (0.2-0.9): How tightly packed nodes are
- LOW (0.2-0.4): Sparse, spread out, lots of empty space - good for mysterious/ethereal magic
- HIGH (0.7-0.9): Dense, compact, filled - good for explosive/chaotic magic

**symmetry** (0.1-0.9): How orderly vs chaotic the tree looks
- LOW (0.1-0.3): Chaotic, unpredictable branching - good for wild/destructive magic
- HIGH (0.7-0.9): Orderly, balanced patterns - good for protective/structured magic

**convergence_chance** (0.2-0.7): % of high-tier spells requiring multiple prerequisites
- LOW (0.2-0.3): Linear progression, simple paths
- HIGH (0.5-0.7): Many spells need multiple prereqs, complex web

**min_straight/max_straight** (1-8): Straight chain length before branching
- LOW (1-3): Branch frequently, bushy tree
- HIGH (5-8): Long chains before branches, spiky/elongated

## SHAPE OPTIONS:
- organic: Natural flowing tree (default)
- explosion: Dense core bursting outward with sub-explosions (fire/blast)
- tree: Thick trunk with branches spreading into dome canopy that curves back down
- mountain: Wide base tapering to narrow peak
- portals: Organic fill with huge arched doorway hole in center
- spiky: Long sharp branches radiating as 3 narrow rays
- radial: Spoke pattern from center
- cloud: Clustered groups with gaps
- cascade: Waterfall tiers with staggered columns
- swords: Two broad blade wedges with gap between
- grid: Matrix arrangement
- linear: Simple sequential chains

## MANDATORY SCHOOL-SPECIFIC VALUES:

Return ONLY valid JSON:
{
  "shape": "one_of_above",
  "density": 0.XX,
  "symmetry": 0.XX,
  "min_straight": 1-4,
  "max_straight": 3-8,
  "convergence_chance": 0.XX,
  "reasoning": "brief explanation"
}

## REQUIRED VARIETY (pick values from these ranges):

| School | Shape | Density | Symmetry | Convergence |
|--------|-------|---------|----------|-------------|
| Destruction | explosion | 0.75-0.90 | 0.15-0.30 | 0.25-0.40 |
| Restoration | tree | 0.35-0.50 | 0.65-0.85 | 0.50-0.65 |
| Conjuration | portals | 0.50-0.65 | 0.30-0.45 | 0.35-0.50 |
| Illusion | organic | 0.25-0.40 | 0.20-0.35 | 0.55-0.70 |
| Alteration | mountain | 0.60-0.75 | 0.70-0.90 | 0.40-0.55 |

CRITICAL: NEVER output the same values for multiple schools!"""

DEFAULT_GROUP_ENHANCEMENT_PROMPT = """Analyze this spell group for visual tree styling:

GROUP: {{GROUP_KEYWORDS}}
SPELLS: {{SPELL_LIST}}

Return JSON with visual settings that make this group STAND OUT from the rest of the tree:
{
  "group_name": "Thematic name (e.g., Pyromancy, Frost Arts)",
  "group_color": "#HEX color matching theme (fire=#FF4500, ice=#00BFFF, etc.)",
  "density_mult": 0.5-1.5 (multiply parent tree density - <1 = sparser, >1 = denser),
  "radius_offset": -30 to 30 (push group inward/outward from normal position),
  "angle_spread": 0.5-1.5 (multiply angle spread - <1 = tighter cluster, >1 = wider),
  "glow_intensity": 0.0-1.0 (visual glow strength),
  "special_behavior": "cluster|chain|radiate|spiral|none"
}

Examples:
- Fire spells: color=#FF4500, density_mult=1.3, glow=0.8, behavior=radiate
- Ice spells: color=#00BFFF, density_mult=0.7, angle_spread=0.8, behavior=chain
- Summon spells: color=#9932CC, radius_offset=20, behavior=cluster"""


@dataclass
class TreeBuilderConfig:
    """Complete configuration for tree building."""
    
    # Randomization
    seed: Optional[int] = None
    
    # Shape selection
    shape: str = "organic"
    
    # Global overrides (apply to any shape)
    max_children_per_node: int = 3
    density: float = 0.6
    symmetry: float = 0.3
    
    # Depth/size
    max_depth: Optional[int] = None
    compress: bool = False
    
    # Branching Energy - controls straight-line growth
    branching_energy: Dict[str, Any] = field(default_factory=lambda: {
        "enabled": True,
        "min_straight": 2,
        "max_straight": 5,
        "energy_per_node": 0.3,
        "energy_to_branch": 1.0,
        "randomness": 0.3,
    })
    
    # Convergence (multi-prereqs)
    convergence_chance: float = 0.4
    convergence_at_tier: int = 3
    
    # Theme handling
    theme_coherence: float = 0.7
    top_themes_per_school: int = 8
    
    # LLM Auto-Configure - LLM picks per-school settings
    llm_auto_configure: Dict[str, Any] = field(default_factory=lambda: {
        "enabled": False,
        "spells_to_sample": 10,
        "prompt_template": DEFAULT_AUTO_CONFIGURE_PROMPT,
    })
    
    # LLM Group Enhancement - LLM names groups + custom rules
    llm_groups: Dict[str, Any] = field(default_factory=lambda: {
        "enabled": False,
        "num_groups": 5,
        "spells_per_group": 5,
        "prompt_template": DEFAULT_GROUP_ENHANCEMENT_PROMPT,
        "api_endpoint": None,
    })
    
    # LLM Keyword Classification - LLM classifies unmatched spells
    llm_keyword_classification: Dict[str, Any] = field(default_factory=lambda: {
        "enabled": False,
        "batch_size": 100,
        "min_confidence": 40,
    })

    # Spacing
    min_node_spacing: float = 1.0
    prevent_overlap: bool = True
    
    # Vanilla root preference
    prefer_vanilla_roots: bool = True

    # Tree Generation Settings (from UI - Tier 4)
    tree_generation: Dict[str, Any] = field(default_factory=lambda: {
        # Theme Discovery
        "theme_discovery_mode": "dynamic",  # dynamic (TF-IDF) or fixed
        "enable_smart_routing": True,       # Strong→cluster, weak→branch/mod
        "auto_branch_fallback": True,       # NLP branch decision when no LLM

        # Element Rules
        "element_isolation": True,          # Prefer same-element links
        "element_isolation_strict": False,  # ONLY same-element (0 cross)

        # Tier Rules
        "strict_tier_ordering": True,       # Lower→higher tier only
        "allow_same_tier_links": True,      # Adept→Adept allowed
        "tier_mixing": False,               # Spells bleed into adjacent zones
        "tier_mixing_amount": 20,           # 0-100% if enabled

        # Link Strategy
        "link_strategy": "thematic",        # strict/thematic/organic/random
        "max_children_per_node": 3,         # 1-5

        # Convergence
        "convergence_enabled": True,        # Expert/Master get 2+ prereqs
        "convergence_chance": 40,           # 0-100%
        "convergence_min_tier": 3,          # 0=Novice, 3=Expert, 4=Master

        # Scoring Factors
        "scoring": {
            "element_matching": True,       # +100 same element
            "spell_type_matching": True,    # +40 same spell type
            "tier_progression": True,       # +50 adjacent tier
            "keyword_matching": True,       # +20 per shared keyword
            "theme_coherence": True,        # +70 same theme
            "effect_name_matching": True,   # +30 shared effect names
            "description_similarity": True, # TF-IDF on descriptions
            "magicka_cost_proximity": False, # +15 within 20% cost
            "same_mod_source": False,       # +10 same plugin
        },

        # LLM Edge Cases
        "llm_edge_case_enabled": False,     # Ask LLM on close scores
        "llm_edge_case_threshold": 10,      # Score difference threshold
    })

    # Raw config dictionary (for accessing non-typed fields like school_configs)
    _raw_config: Dict[str, Any] = field(default_factory=dict)
    
    def get_raw(self, key: str, default: Any = None) -> Any:
        """Get a raw config value that may not be in the typed schema."""
        return self._raw_config.get(key, default)
    
    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'TreeBuilderConfig':
        """Create config from dictionary, using defaults for missing keys."""
        # Handle nested branching_energy config
        default_energy = {
            "enabled": True,
            "min_straight": 2,
            "max_straight": 5,
            "energy_per_node": 0.3,
            "energy_to_branch": 1.0,
            "randomness": 0.3,
        }
        branching_energy = d.get('branching_energy', default_energy)
        if branching_energy:
            # Merge with defaults
            merged_energy = default_energy.copy()
            merged_energy.update(branching_energy)
            branching_energy = merged_energy
        
        # Handle nested llm_auto_configure config
        default_auto_config = {
            "enabled": False,
            "spells_to_sample": 10,
            "prompt_template": DEFAULT_AUTO_CONFIGURE_PROMPT,
        }
        llm_auto_configure = d.get('llm_auto_configure', default_auto_config)
        if llm_auto_configure:
            merged_auto = default_auto_config.copy()
            merged_auto.update(llm_auto_configure)
            llm_auto_configure = merged_auto
        
        # Handle nested llm_groups config
        default_groups = {
            "enabled": False,
            "num_groups": 5,
            "spells_per_group": 5,
            "prompt_template": DEFAULT_GROUP_ENHANCEMENT_PROMPT,
            "api_endpoint": None,
        }
        llm_groups = d.get('llm_groups', default_groups)
        if llm_groups:
            merged_groups = default_groups.copy()
            merged_groups.update(llm_groups)
            llm_groups = merged_groups

        # Handle nested llm_keyword_classification config
        default_kw_class = {
            "enabled": False,
            "batch_size": 100,
            "min_confidence": 40,
        }
        llm_keyword_classification = d.get('llm_keyword_classification', default_kw_class)
        if llm_keyword_classification:
            merged_kw = default_kw_class.copy()
            merged_kw.update(llm_keyword_classification)
            llm_keyword_classification = merged_kw

        # Handle nested tree_generation config (Tier 4)
        default_tree_gen = {
            "theme_discovery_mode": "dynamic",
            "enable_smart_routing": True,
            "auto_branch_fallback": True,
            "element_isolation": True,
            "element_isolation_strict": False,
            "strict_tier_ordering": True,
            "allow_same_tier_links": True,
            "tier_mixing": False,
            "tier_mixing_amount": 20,
            "link_strategy": "thematic",
            "max_children_per_node": 3,
            "convergence_enabled": True,
            "convergence_chance": 40,
            "convergence_min_tier": 3,
            "scoring": {
                "element_matching": True,
                "spell_type_matching": True,
                "tier_progression": True,
                "keyword_matching": True,
                "theme_coherence": True,
                "effect_name_matching": True,
                "description_similarity": True,
                "magicka_cost_proximity": False,
                "same_mod_source": False,
            },
            "llm_edge_case_enabled": False,
            "llm_edge_case_threshold": 10,
        }
        tree_generation = d.get('tree_generation', default_tree_gen)
        if tree_generation:
            merged_tree_gen = default_tree_gen.copy()
            # Handle nested scoring
            if 'scoring' in tree_generation:
                merged_scoring = default_tree_gen['scoring'].copy()
                merged_scoring.update(tree_generation['scoring'])
                tree_generation = dict(tree_generation)
                tree_generation['scoring'] = merged_scoring
            merged_tree_gen.update(tree_generation)
            tree_generation = merged_tree_gen

        return cls(
            seed=d.get('seed'),
            shape=d.get('shape', 'organic'),
            max_children_per_node=d.get('max_children_per_node', 3),
            density=d.get('density', 0.6),
            symmetry=d.get('symmetry', 0.3),
            max_depth=d.get('max_depth'),
            compress=d.get('compress', False),
            branching_energy=branching_energy,
            convergence_chance=d.get('convergence_chance', 0.4),
            convergence_at_tier=d.get('convergence_at_tier', 3),
            theme_coherence=d.get('theme_coherence', 0.7),
            top_themes_per_school=d.get('top_themes_per_school', 8),
            llm_auto_configure=llm_auto_configure,
            llm_groups=llm_groups,
            llm_keyword_classification=llm_keyword_classification,
            min_node_spacing=d.get('min_node_spacing', 1.0),
            prevent_overlap=d.get('prevent_overlap', True),
            prefer_vanilla_roots=d.get('prefer_vanilla_roots', True),
            tree_generation=tree_generation,
            _raw_config=d,  # Store raw config for non-typed access
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary (excluding raw config)."""
        d = asdict(self)
        d.pop('_raw_config', None)
        return d
    
    def get_shape_config(self) -> Dict[str, Any]:
        """Get configuration dict for shape profile."""
        return {
            'max_children': (1, self.max_children_per_node),
            'density': self.density,
            'symmetry_strength': self.symmetry,
            'max_depth': self.max_depth,
            'theme_coherence': self.theme_coherence,
            'min_node_spacing': self.min_node_spacing,
        }
    

    def get_branching_energy_config(self) -> Dict[str, Any]:
        """Get configuration dict for branching energy system."""
        return self.branching_energy.copy()
    
    def get_llm_auto_configure_config(self) -> Dict[str, Any]:
        """Get configuration dict for LLM auto-configure."""
        return self.llm_auto_configure.copy()
    
    def get_llm_groups_config(self) -> Dict[str, Any]:
        """Get configuration dict for LLM group enhancement."""
        return self.llm_groups.copy()


# Default configuration
DEFAULT_CONFIG = TreeBuilderConfig()


def load_config(config_dict: Optional[Dict[str, Any]] = None) -> TreeBuilderConfig:
    """
    Load configuration from dictionary or return defaults.
    
    Args:
        config_dict: Optional configuration dictionary
    
    Returns:
        TreeBuilderConfig instance
    """
    if config_dict is None:
        return TreeBuilderConfig()
    return TreeBuilderConfig.from_dict(config_dict)


def merge_configs(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge two configuration dictionaries.
    
    Override values take precedence over base values.
    """
    result = base.copy()
    result.update(override)
    return result
