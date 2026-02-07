"""
LLM Auto-Configure System for per-school tree settings.

When enabled, the LLM automatically picks procedural settings for each
magic school tree based on the school name and sample spells.

Flow:
1. For each school (Destruction, Restoration, etc.)
2. Sample 10 random spells from that school
3. Send school name + spells to LLM
4. LLM returns recommended shape, density, branching energy, etc.
5. Tree builds with those settings

When disabled (Random Mode):
- Each school gets randomized settings
- Player can fine-tune per-school in control panels
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
import json
import random


# Available shapes for random selection
# Auto-updated when shapes module is available
try:
    from shapes import list_shapes
    AVAILABLE_SHAPES = list_shapes()
except ImportError:
    AVAILABLE_SHAPES = [
        "organic",
        "radial", 
        "grid",
        "cascade",
        "mountain",
        "spiky",
        "cloud",
        "linear",
    ]


@dataclass
class SchoolConfig:
    """Configuration for a single school's tree generation."""
    
    school: str
    shape: str = "organic"
    density: float = 0.6
    symmetry: float = 0.3
    convergence_chance: float = 0.4
    
    branching_energy: Dict[str, Any] = field(default_factory=lambda: {
        "min_straight": 2,
        "max_straight": 5,
        "randomness": 0.3,
    })
    
    # LLM reasoning (if applicable)
    reasoning: Optional[str] = None
    source: str = "default"  # "default", "random", "llm"
    
    @classmethod
    def from_dict(cls, d: Dict[str, Any], school: str) -> 'SchoolConfig':
        """Create from dictionary."""
        return cls(
            school=school,
            shape=d.get('shape', 'organic'),
            density=d.get('density', 0.6),
            symmetry=d.get('symmetry', 0.3),
            convergence_chance=d.get('convergence_chance', 0.4),
            branching_energy=d.get('branching_energy', {
                "min_straight": 2,
                "max_straight": 5,
                "randomness": 0.3,
            }),
            reasoning=d.get('reasoning'),
            source=d.get('source', 'default'),
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'school': self.school,
            'shape': self.shape,
            'density': self.density,
            'symmetry': self.symmetry,
            'convergence_chance': self.convergence_chance,
            'branching_energy': self.branching_energy,
            'reasoning': self.reasoning,
            'source': self.source,
        }
    
    def to_tree_config(self) -> Dict[str, Any]:
        """Convert to tree builder config format."""
        return {
            'shape': self.shape,
            'density': self.density,
            'symmetry': self.symmetry,
            'convergence_chance': self.convergence_chance,
            'branching_energy': {
                'enabled': True,
                **self.branching_energy,
            },
        }


class AutoConfigurator:
    """
    Manages automatic configuration of tree settings per school.
    
    Can use LLM for intelligent config or random for variety.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize configurator.
        
        Args:
            config: Configuration dictionary with:
                - enabled: bool
                - spells_to_sample: int
                - prompt_template: str
        """
        self.config = config or {}
        self.enabled = self.config.get('enabled', False)
        self.spells_to_sample = self.config.get('spells_to_sample', 10)
        self.prompt_template = self.config.get('prompt_template', '')
        
        # Cache of school configs
        self._school_configs: Dict[str, SchoolConfig] = {}
    
    def get_school_config(self, school: str) -> SchoolConfig:
        """Get configuration for a school (cached)."""
        if school not in self._school_configs:
            self._school_configs[school] = SchoolConfig(school=school)
        return self._school_configs[school]
    
    def set_school_config(self, school: str, config: SchoolConfig) -> None:
        """Set configuration for a school."""
        self._school_configs[school] = config
    
    def generate_random_config(self, school: str) -> SchoolConfig:
        """
        Generate random configuration for a school.
        
        Args:
            school: School name
            
        Returns:
            SchoolConfig with random values
        """
        config = SchoolConfig(
            school=school,
            shape=random.choice(AVAILABLE_SHAPES),
            density=round(random.uniform(0.3, 0.9), 2),
            symmetry=round(random.uniform(0.1, 0.8), 2),
            convergence_chance=round(random.uniform(0.2, 0.7), 2),
            branching_energy={
                "min_straight": random.randint(1, 4),
                "max_straight": random.randint(4, 8),
                "randomness": round(random.uniform(0.1, 0.6), 2),
            },
            source="random",
        )
        
        self._school_configs[school] = config
        return config
    
    def generate_all_random(self, schools: List[str]) -> Dict[str, SchoolConfig]:
        """Generate random configs for all schools."""
        configs = {}
        for school in schools:
            configs[school] = self.generate_random_config(school)
        return configs
    
    def build_auto_configure_prompt(
        self,
        school: str,
        sample_spells: List[Dict[str, Any]]
    ) -> str:
        """
        Build the LLM prompt for auto-configure.
        
        Args:
            school: School name
            sample_spells: Sample spells from this school
            
        Returns:
            Formatted prompt string
        """
        spell_list = self._format_spells(sample_spells)
        available_shapes = '|'.join(AVAILABLE_SHAPES)
        
        prompt = self.prompt_template
        prompt = prompt.replace('{{SCHOOL_NAME}}', school)
        prompt = prompt.replace('{{SPELL_LIST}}', spell_list)
        prompt = prompt.replace('{{AVAILABLE_SHAPES}}', available_shapes)
        
        return prompt
    
    def _format_spells(self, spells: List[Dict[str, Any]]) -> str:
        """Format spell list for LLM prompt."""
        lines = []
        for i, spell in enumerate(spells, 1):
            name = spell.get('name', spell.get('formId', 'Unknown'))
            tier = spell.get('skillLevel', 'Unknown')
            desc = spell.get('description', '')
            
            # Truncate description
            if len(desc) > 60:
                desc = desc[:60] + '...'
            
            line = f"{i}. {name} - {tier}"
            if desc:
                line += f", {desc}"
            lines.append(line)
        
        return '\n'.join(lines)
    
    def sample_spells_from_school(
        self,
        school: str,
        all_spells: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Sample spells from a specific school.
        
        Args:
            school: School name
            all_spells: All available spells
            
        Returns:
            List of sampled spells
        """
        # Filter to this school
        school_spells = [s for s in all_spells if s.get('school', '').lower() == school.lower()]
        
        if len(school_spells) <= self.spells_to_sample:
            return school_spells
        
        # Sample with tier diversity
        by_tier: Dict[str, List[Dict[str, Any]]] = {}
        for spell in school_spells:
            tier = spell.get('skillLevel', 'Unknown')
            if tier not in by_tier:
                by_tier[tier] = []
            by_tier[tier].append(spell)
        
        samples = []
        tiers = list(by_tier.keys())
        
        # Round-robin through tiers
        while len(samples) < self.spells_to_sample and any(by_tier.values()):
            for tier in tiers:
                if by_tier.get(tier) and len(samples) < self.spells_to_sample:
                    idx = random.randint(0, len(by_tier[tier]) - 1)
                    samples.append(by_tier[tier].pop(idx))
        
        return samples
    
    def parse_llm_response(self, response: str, school: str) -> SchoolConfig:
        """
        Parse LLM response into a SchoolConfig.
        
        Args:
            response: Raw LLM response (should be JSON)
            school: School name
            
        Returns:
            SchoolConfig instance
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
        
        # Validate shape
        shape = data.get('shape', 'organic')
        if shape not in AVAILABLE_SHAPES:
            shape = 'organic'
        
        # Clamp values with wider ranges for variety
        density = max(0.1, min(0.95, float(data.get('density', 0.6))))
        symmetry = max(0.1, min(0.95, float(data.get('symmetry', 0.3))))
        convergence_chance = max(0.1, min(0.9, float(data.get('convergence_chance', 0.4))))
        # Parse branching energy
        branching = data.get('branching_energy', {})
        if isinstance(branching, dict):
            min_straight = max(1, min(5, int(branching.get('min_straight', 2))))
            max_straight = max(min_straight + 1, min(10, int(branching.get('max_straight', 5))))
            randomness = max(0.0, min(1.0, float(branching.get('randomness', 0.3))))
        else:
            min_straight, max_straight, randomness = 2, 5, 0.3
        
        config = SchoolConfig(
            school=school,
            shape=shape,
            density=density,
            symmetry=symmetry,
            convergence_chance=convergence_chance,
            branching_energy={
                "min_straight": min_straight,
                "max_straight": max_straight,
                "randomness": randomness,
            },
            reasoning=data.get('reasoning'),
            source='llm',
        )
        
        self._school_configs[school] = config
        return config
    
    def get_all_configs(self) -> Dict[str, SchoolConfig]:
        """Get all cached school configs."""
        return self._school_configs.copy()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert all configs to dictionary."""
        return {
            'enabled': self.enabled,
            'spells_to_sample': self.spells_to_sample,
            'school_configs': {k: v.to_dict() for k, v in self._school_configs.items()},
        }
    
    def clear_cache(self) -> None:
        """Clear all cached configs."""
        self._school_configs.clear()


def get_schools_from_spells(spells: List[Dict[str, Any]]) -> List[str]:
    """
    Get unique school names from spell list.
    
    Args:
        spells: List of spell dictionaries
        
    Returns:
        List of unique school names
    """
    schools = set()
    for spell in spells:
        school = spell.get('school')
        if school:
            schools.add(school)
    return sorted(schools)
