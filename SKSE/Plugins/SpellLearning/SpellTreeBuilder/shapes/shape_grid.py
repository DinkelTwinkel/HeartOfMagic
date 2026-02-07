"""
Grid Shape - Matrix/lattice arrangement.

Creates trees in a structured grid pattern:
- Orthogonal connections (up/down/left/right)
- Regular spacing
- Good for orderly, organized displays
"""

from typing import Dict, Any, List, Optional
import math

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.node import TreeNode
from core.registry import register_shape
from .base import ShapeProfile


@register_shape("grid")
class GridShape(ShapeProfile):
    """Matrix/lattice arrangement with orthogonal connections."""
    
    name = "grid"
    description = "Structured grid pattern with orthogonal connections"
    
    defaults = {
        "max_children": (1, 4),  # Up to 4 for grid directions
        "branching_angle": (0, 360),
        "density": 0.7,
        "symmetry_mode": "mirror",
        "symmetry_strength": 0.8,
        "cluster_tendency": 0.0,  # No clustering for grid
        "theme_coherence": 0.6,
        "grid_columns": 5,  # Target columns in grid
        "prefer_horizontal": True,  # Prefer horizontal expansion
    }
    
    def __init__(self, config: Dict[str, Any] = None):
        super().__init__(config)
        self.grid_columns = config.get('grid_columns', 5) if config else 5
        self.prefer_horizontal = config.get('prefer_horizontal', True) if config else True
        self.grid_positions: Dict[str, tuple] = {}  # node_id -> (row, col)
        self.next_col = 0
        self.current_row = 0
    
    def select_parent(self, node: TreeNode,
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select parent for grid pattern:
        - Prefer left neighbor (horizontal flow)
        - Or prefer above neighbor (vertical flow)
        """
        if not candidates:
            return None
        
        max_children = self.config.max_children[1]
        available = [c for c in candidates if len(c.children) < max_children]
        
        if not available:
            return None
        
        # Score candidates for grid placement
        scored = []
        for candidate in available:
            score = 1.0
            
            # Prefer nodes at same or previous depth
            depth_diff = node.depth - candidate.depth
            if depth_diff == 1:
                score += 1.0  # Ideal: parent is one level up
            elif depth_diff == 0:
                score += 0.5  # Same level OK for horizontal
            
            # Prefer candidates with fewer children
            children_count = len(candidate.children)
            score -= children_count * 0.2
            
            # Theme coherence
            if node.theme and candidate.theme == node.theme:
                score += self.config.theme_coherence * 0.5
            
            # Prefer horizontal expansion if configured
            if self.prefer_horizontal and candidate.depth == node.depth - 1:
                score += 0.3
            
            scored.append((score, candidate))
        
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]
    
    def calculate_children_count(self, node: TreeNode,
                                  context: Dict[str, Any]) -> int:
        """
        Calculate children for grid pattern:
        - Aim for consistent branching to fill grid
        """
        min_c, max_c = self.config.max_children
        
        # Grid prefers consistent children count
        if node.depth == 0:
            # Root: create first row
            return min(max_c, self.grid_columns)
        
        # Other nodes: 1-2 children for grid flow
        target = 2 if self.prefer_horizontal else 1
        
        # Adjust based on density
        if self.rng.random() < self.config.density:
            return min(target, max_c)
        return min(1, max_c)
    
    def should_branch(self, node: TreeNode,
                      context: Dict[str, Any]) -> bool:
        """Grid branching - consistent for regular structure."""
        if self.config.max_depth and node.depth >= self.config.max_depth:
            return False
        
        # High branching probability for consistent grid
        return self.rng.random() < self.config.density
    
    def get_branch_angle(self, parent: TreeNode, child_index: int,
                         total_children: int, context: Dict[str, Any]) -> float:
        """Grid angles - orthogonal directions only."""
        # Four main directions: right, down, left, up
        # 0 = right, pi/2 = down, pi = left, 3pi/2 = up
        
        if parent.depth == 0:
            # Root: spread children horizontally
            if total_children <= 1:
                return 0  # Right
            
            # Distribute across bottom half
            angle_step = math.pi / (total_children + 1)
            return angle_step * (child_index + 1)
        
        # Non-root: primarily downward with some horizontal
        base_angles = [
            math.pi / 2,      # Down
            math.pi / 4,      # Down-right
            3 * math.pi / 4,  # Down-left
            0,                # Right
        ]
        
        if child_index < len(base_angles):
            return base_angles[child_index]
        
        # Fallback: distribute evenly
        return (math.pi / 2) + (child_index * 0.3)
