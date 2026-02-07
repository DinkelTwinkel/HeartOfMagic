"""
Radial Shape - Star/spoke pattern from center.

Creates trees that radiate outward from a central root:
- Spokes emanating from center
- Even angular distribution
- Good for symmetrical displays
"""

from typing import Dict, Any, List, Optional
import math

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.node import TreeNode
from core.registry import register_shape
from .base import ShapeProfile


@register_shape("radial")
class RadialShape(ShapeProfile):
    """Star/spoke pattern radiating from center."""
    
    name = "radial"
    description = "Star pattern with spokes radiating from center"
    
    defaults = {
        "max_children": (3, 8),  # More children for star effect
        "branching_angle": (0, 360),  # Full circle
        "density": 0.5,
        "symmetry_mode": "radial",
        "symmetry_strength": 0.9,
        "cluster_tendency": 0.1,  # Low clustering for even spread
        "theme_coherence": 0.5,
        "spoke_count": 5,  # Target number of main spokes
    }
    
    def __init__(self, config: Dict[str, Any] = None):
        super().__init__(config)
        self.spoke_count = config.get('spoke_count', 5) if config else 5
        self.spoke_assignments: Dict[str, int] = {}  # node_id -> spoke index
    
    def select_parent(self, node: TreeNode,
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select parent for radial pattern:
        - Root children become spoke heads
        - Other nodes attach to their spoke
        """
        if not candidates:
            return None
        
        max_children = self.config.max_children[1]
        available = [c for c in candidates if len(c.children) < max_children]
        
        if not available:
            return None
        
        # If we have a theme, prefer nodes in the same "spoke"
        node_theme = node.theme
        
        # Score candidates
        scored = []
        for candidate in available:
            score = 1.0
            
            # Strongly prefer same theme (same spoke)
            if node_theme and candidate.theme == node_theme:
                score += 1.5
            
            # Prefer nodes at depth - 1 (proper tree structure)
            if candidate.depth == node.depth - 1:
                score += 0.5
            
            # Prefer candidates with fewer children (balance)
            score -= len(candidate.children) * 0.1
            
            # Root gets bonus for first few nodes (creates spokes)
            if candidate.is_root and len(candidate.children) < self.spoke_count:
                score += 1.0
            
            scored.append((score, candidate))
        
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]
    
    def calculate_children_count(self, node: TreeNode,
                                  context: Dict[str, Any]) -> int:
        """
        Calculate children for radial pattern:
        - Root has many children (spokes)
        - Spoke nodes have 1-2 children (extend the spoke)
        """
        min_c, max_c = self.config.max_children
        
        if node.is_root or node.depth == 0:
            # Root creates the spokes
            return min(max_c, self.spoke_count)
        
        # Non-root: fewer children to extend spoke
        if node.depth < 3:
            return self.rng.randint(1, min(2, max_c))
        
        # Deeper nodes: 1 child to continue spoke
        return 1 if self.rng.random() < self.config.density else 0
    
    def should_branch(self, node: TreeNode,
                      context: Dict[str, Any]) -> bool:
        """Radial branching - root always branches, others based on depth."""
        if node.is_root or node.depth == 0:
            return True
        
        if self.config.max_depth and node.depth >= self.config.max_depth:
            return False
        
        # Spokes continue outward with decreasing probability
        branch_prob = self.config.density * (1 - node.depth * 0.1)
        return self.rng.random() < branch_prob
    
    def get_branch_angle(self, parent: TreeNode, child_index: int,
                         total_children: int, context: Dict[str, Any]) -> float:
        """Radial angles - evenly distributed around the circle."""
        if parent.is_root or parent.depth == 0:
            # Root children: evenly distribute around circle
            angle_step = 2 * math.pi / total_children
            return angle_step * child_index
        
        # Non-root: continue in same direction with slight variation
        # Get parent's angle from root (approximate)
        parent_angle = context.get('parent_angle', 0)
        variation = self.rng.uniform(-0.1, 0.1)
        return parent_angle + variation
