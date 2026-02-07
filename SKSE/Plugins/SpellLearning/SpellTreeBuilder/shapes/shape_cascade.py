"""
Cascade Tree Shape - Waterfall/tiered progression.

Creates horizontal tiers cascading downward, like a waterfall
or terraced structure. Good for visualizing tier progression.
"""

from typing import Dict, Any, List, Optional
import random

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.node import TreeNode
from core.registry import register_shape
from .base import ShapeProfile


@register_shape("cascade")
class CascadeShape(ShapeProfile):
    """
    Horizontal tier-based cascading structure.
    
    Nodes spread horizontally within each tier level,
    then cascade down to the next tier.
    """
    
    name = "cascade"
    description = "Horizontal tiers cascading downward"
    
    defaults = {
        'max_children': (2, 3),
        'density': 0.7,
        'branching_angle': (60, 120),  # Wide horizontal spread
        'symmetry_mode': 'mirror',
        'symmetry_strength': 0.6,
        'tier_height': 1.5,  # Vertical spacing between tiers
        'horizontal_spread': 2.0,  # Horizontal spread within tier
    }
    
    def select_parent(self, node: TreeNode,
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select parent - prefer nodes at previous tier level.
        """
        if not candidates:
            return None
        
        max_children = self.config.max_children[1]
        available = [c for c in candidates if len(c.children) < max_children]
        
        if not available:
            return None
        
        # Tier from spell data
        node_tier = self._tier_index(node.tier)
        
        # Prefer parents at exactly one tier below
        ideal_depth = node_tier - 1 if node_tier > 0 else 0
        same_tier = [c for c in available if c.depth == ideal_depth]
        
        if same_tier:
            # Balance children across tier level
            return min(same_tier, key=lambda c: len(c.children))
        
        # Fall back to any available parent
        return min(available, key=lambda c: (abs(c.depth - ideal_depth), len(c.children)))
    
    def calculate_children_count(self, node: TreeNode,
                                  context: Dict[str, Any]) -> int:
        """
        Calculate children - more at upper tiers, fewer at lower.
        """
        # Higher tiers cascade more
        tier = self._tier_index(node.tier)
        
        if tier == 0:  # Novice
            return self.rng.randint(2, 3)
        elif tier == 1:  # Apprentice
            return self.rng.randint(2, 3)
        elif tier == 2:  # Adept
            return self.rng.randint(1, 2)
        else:  # Expert, Master
            return 1
    
    def _tier_index(self, tier: str) -> int:
        """Convert tier name to index."""
        tiers = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
        try:
            return tiers.index(tier)
        except ValueError:
            return 0
    
    def should_branch(self, node: TreeNode,
                      context: Dict[str, Any]) -> bool:
        """
        Cascade always branches unless at max depth.
        """
        if node.depth >= 4:  # Max 5 tiers
            return False
        return True
