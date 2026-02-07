"""
Organic Shape - Natural tree with varied branching.

Creates trees that look like natural plant growth with:
- Varied branching angles
- Asymmetric structure
- Theme-based clustering
"""

from typing import Dict, Any, List, Optional
import math

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.node import TreeNode
from core.registry import register_shape
from .base import ShapeProfile


@register_shape("organic")
class OrganicShape(ShapeProfile):
    """Natural tree shape with varied, organic branching."""
    
    name = "organic"
    description = "Natural tree with varied branching like real plants"
    
    defaults = {
        "max_children": (1, 3),
        "branching_angle": (25, 90),
        "density": 0.65,
        "symmetry_mode": "none",
        "symmetry_strength": 0.2,
        "cluster_tendency": 0.4,
        "theme_coherence": 0.7,
    }
    
    def select_parent(self, node: TreeNode,
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select parent with organic preference:
        - Strongly prefer same-theme parents
        - Prefer parents with fewer children (natural balance)
        - Some randomness for organic feel
        """
        if not candidates:
            return None
        
        # Filter to candidates with available slots
        max_children = self.config.max_children[1]
        available = [c for c in candidates if len(c.children) < max_children]
        
        if not available:
            return None
        
        # Score each candidate
        scored = []
        for candidate in available:
            score = self.score_parent_candidate(node, candidate, context)
            
            # Organic bonus: slight randomness
            score += self.rng.uniform(-0.2, 0.2)
            
            # Cluster bonus: prefer nearby depth
            depth_diff = abs(candidate.depth - (node.depth - 1 if node.depth > 0 else 0))
            if depth_diff == 0:
                score += 0.3
            
            scored.append((score, candidate))
        
        # Sort by score and pick best
        scored.sort(key=lambda x: x[0], reverse=True)
        
        # Sometimes pick second-best for variety (organic feel)
        if len(scored) > 1 and self.rng.random() < 0.2:
            return scored[1][1]
        
        return scored[0][1]
    
    def calculate_children_count(self, node: TreeNode,
                                  context: Dict[str, Any]) -> int:
        """
        Calculate children with organic variation:
        - Root tends to have more children
        - Deeper nodes tend to have fewer
        - Some randomness for natural look
        """
        min_c, max_c = self.config.max_children
        
        # Base probability decreases with depth
        depth_factor = max(0.2, 1.0 - node.depth * 0.15)
        
        # Density affects average
        avg_children = min_c + (max_c - min_c) * self.config.density * depth_factor
        
        # Add some variation
        variation = self.rng.gauss(0, 0.5)
        count = int(avg_children + variation)
        
        return max(min_c, min(max_c, count))
    
    def should_branch(self, node: TreeNode,
                      context: Dict[str, Any]) -> bool:
        """Organic branching - decreases with depth but never zero."""
        if self.config.max_depth and node.depth >= self.config.max_depth:
            return False
        
        # Branching probability based on depth and density
        base_prob = self.config.density
        depth_penalty = node.depth * 0.12
        branch_prob = base_prob * (1 - depth_penalty)
        
        # Minimum 10% chance to branch
        branch_prob = max(0.1, branch_prob)
        
        return self.rng.random() < branch_prob
    
    def get_branch_angle(self, parent: TreeNode, child_index: int,
                         total_children: int, context: Dict[str, Any]) -> float:
        """Organic angles - varied with some natural clustering."""
        min_angle, max_angle = self.config.branching_angle
        min_rad = math.radians(min_angle)
        max_rad = math.radians(max_angle)
        
        if total_children == 1:
            # Single child: slight random offset from center
            center = (min_rad + max_rad) / 2
            return center + self.rng.uniform(-0.2, 0.2)
        
        # Distribute with some organic variation
        spread = max_rad - min_rad
        base_step = spread / total_children
        base_angle = min_rad + base_step * child_index + base_step / 2
        
        # Add organic jitter
        jitter = self.rng.uniform(-base_step * 0.3, base_step * 0.3)
        
        return base_angle + jitter
