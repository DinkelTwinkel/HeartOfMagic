"""
Growth control systems for the SpellTreeBuilder.

This module provides:
- BranchingEnergy: Controls straight-line vs branching decisions
- ThemedGroups: LLM-powered group naming and custom growth rules
- AutoConfigure: LLM-based per-school settings selection
"""

from .branching_energy import BranchingEnergy, BranchingEnergyConfig
from .themed_groups import (
    ThemedGroup,
    ThemedGroupManager,
    find_fuzzy_groups,
    sample_spells_from_group,
    build_group_enhancement_prompt,
    parse_llm_group_response,
)
from .auto_configure import (
    AutoConfigurator,
    SchoolConfig,
    AVAILABLE_SHAPES,
    get_schools_from_spells,
)

__all__ = [
    # Branching energy
    'BranchingEnergy',
    'BranchingEnergyConfig',
    # Themed groups
    'ThemedGroup',
    'ThemedGroupManager',
    'find_fuzzy_groups',
    'sample_spells_from_group',
    'build_group_enhancement_prompt',
    'parse_llm_group_response',
    # Auto configure
    'AutoConfigurator',
    'SchoolConfig',
    'AVAILABLE_SHAPES',
    'get_schools_from_spells',
]
