"""
Linear Tree Shape - Simple Y-branching progression.

Creates clean, orderly trees with consistent 1-2 branching.
Good for smaller spell schools or simple progressions.
"""

from typing import Dict, Any, List, Optional
import random

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.node import TreeNode
from core.registry import register_shape
from .base import ShapeProfile


@register_shape("linear")
class LinearShape(ShapeProfile):
    """
    Simple linear progression with occasional branching.
    
    Creates Y-shaped trees with mostly 1-2 children per node.
    Straightforward tier progression.
    """
    
    name = "linear"
    description = "Simple Y-branching, clean progression"
    
    defaults = {
        'max_children': (1, 2),
        'density': 0.5,
        'branching_angle': (45, 90),
        'symmetry_mode': 'partial',
        'symmetry_strength': 0.5,
    }
    
    def select_parent(self, node: TreeNode,
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select parent - prefer single-child nodes for linear growth.
        """
        if not candidates:
            return None
        
        # Filter to nodes with room
        max_children = self.config.max_children[1]
        available = [c for c in candidates if len(c.children) < max_children]
        
        if not available:
            return None
        
        # Prefer nodes with 0 children (extend linearly)
        no_children = [c for c in available if len(c.children) == 0]
        if no_children:
            # Among those, prefer same theme
            same_theme = [c for c in no_children if c.theme == node.theme]
            if same_theme:
                return self.rng.choice(same_theme)
            return self.rng.choice(no_children)
        
        # Otherwise pick node with fewest children
        return min(available, key=lambda c: len(c.children))
    
    def calculate_children_count(self, node: TreeNode,
                                  context: Dict[str, Any]) -> int:
        """
        Calculate children - mostly 1, sometimes 2.
        """
        # Root gets 2-3 to start branches
        if node.depth == 0:
            return self.rng.randint(2, 3)
        
        # Linear: 80% chance of 1 child, 20% chance of 2
        if self.rng.random() < 0.8:
            return 1
        return 2
