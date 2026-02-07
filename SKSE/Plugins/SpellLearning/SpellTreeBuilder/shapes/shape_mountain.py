"""
Mountain Tree Shape - Wide base tapering to narrow peak.

Creates pyramid-like structures with many low-tier spells
converging to few high-tier spells at the top.
"""

from typing import Dict, Any, List, Optional
import random
import math

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.node import TreeNode
from core.registry import register_shape
from .base import ShapeProfile


@register_shape("mountain")
class MountainShape(ShapeProfile):
    """
    Pyramid/mountain shape - wide base, narrow peak.
    
    Lower tiers have many branches spreading wide.
    Higher tiers converge to fewer paths.
    """
    
    name = "mountain"
    description = "Wide base tapering to narrow peak"
    
    defaults = {
        'max_children': (1, 3),
        'density': 0.7,
        'branching_angle': (30, 150),  # Very wide at base
        'symmetry_mode': 'partial',
        'symmetry_strength': 0.4,
        'taper_rate': 0.3,  # How quickly to narrow
    }
    
    def select_parent(self, node: TreeNode,
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select parent - spreading at base, converging at top.
        """
        if not candidates:
            return None
        
        max_children = self.config.max_children[1]
        available = [c for c in candidates if len(c.children) < max_children]
        
        if not available:
            return None
        
        tier = self._tier_index(node.tier)
        
        if tier <= 1:
            # Lower tiers: spread out, prefer parents with few children
            return min(available, key=lambda c: len(c.children))
        else:
            # Higher tiers: converge, prefer busier parents
            # This creates convergence naturally
            same_theme = [c for c in available if c.theme == node.theme]
            pool = same_theme if same_theme else available
            
            # Score: prefer deeper parents with some children already
            def score(p):
                depth_score = p.depth * 0.5
                child_score = len(p.children) * 0.3
                return depth_score + child_score
            
            return max(pool, key=score)
    
    def calculate_children_count(self, node: TreeNode,
                                  context: Dict[str, Any]) -> int:
        """
        Calculate children - many at base, few at peak.
        """
        tier = self._tier_index(node.tier)
        taper = self.defaults.get('taper_rate', 0.3)
        
        # Base case: root gets many children
        if node.depth == 0:
            return 3
        
        # Calculate children based on depth
        # More children at shallow depth, fewer deeper
        base_children = 3 - int(tier * taper * 2)
        base_children = max(1, min(3, base_children))
        
        # Add some randomness
        if self.rng.random() < 0.3:
            return max(1, base_children - 1)
        return base_children
    
    def _tier_index(self, tier: str) -> int:
        """Convert tier name to index."""
        tiers = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']
        try:
            return tiers.index(tier)
        except ValueError:
            return 0
    
    def get_branch_angle(self, parent: TreeNode, child_index: int,
                         total_children: int, context: Dict[str, Any]) -> float:
        """
        Branch angle narrows as we go higher.
        """
        tier = self._tier_index(parent.tier)
        
        # Wide spread at base, narrow at peak
        base_spread = 150 - tier * 20  # 150 -> 70 degrees
        min_angle = max(20, 90 - base_spread / 2)
        max_angle = min(160, 90 + base_spread / 2)
        
        if total_children == 1:
            return math.radians(90)  # Straight up at peak
        
        spread = max_angle - min_angle
        step = spread / (total_children - 1) if total_children > 1 else 0
        return math.radians(min_angle + step * child_index)
