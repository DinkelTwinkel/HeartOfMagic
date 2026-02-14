"""
Base ShapeProfile class for tree shape generation.

All shape plugins inherit from ShapeProfile and override
the key methods to define their growth behavior.
"""

from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
import random
import math

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.node import TreeNode
from core.math_utils import Vector2D
from core.registry import register_shape


@dataclass
class ShapeConfig:
    """Configuration for a shape profile."""
    
    # Core parameters
    max_children: Tuple[int, int] = (1, 3)
    max_depth: Optional[int] = None
    branching_angle: Tuple[float, float] = (30, 120)  # degrees
    
    # Density & spacing
    density: float = 0.6
    min_node_spacing: float = 1.0
    cluster_tendency: float = 0.4
    
    # Symmetry
    symmetry_mode: str = 'none'  # 'none', 'mirror', 'radial', 'partial'
    symmetry_strength: float = 0.3
    
    # Theme coherence
    theme_coherence: float = 0.7
    
    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'ShapeConfig':
        """Create config from dictionary, using defaults for missing keys."""
        return cls(
            max_children=tuple(d.get('max_children', (1, 3))),
            max_depth=d.get('max_depth'),
            branching_angle=tuple(d.get('branching_angle', (30, 120))),
            density=d.get('density', 0.6),
            min_node_spacing=d.get('min_node_spacing', 1.0),
            cluster_tendency=d.get('cluster_tendency', 0.4),
            symmetry_mode=d.get('symmetry_mode', 'none'),
            symmetry_strength=d.get('symmetry_strength', 0.3),
            theme_coherence=d.get('theme_coherence', 0.7),
        )


class ShapeProfile(ABC):
    """
    Base class for tree shape generation.
    
    Override the abstract methods to create custom shapes.
    """
    
    # Shape metadata (override in subclasses)
    name: str = "base"
    description: str = "Base shape profile"
    
    # Default configuration (override in subclasses)
    defaults: Dict[str, Any] = {}
    
    def __init__(self, config: Dict[str, Any] = None):
        """
        Initialize shape with configuration.
        
        Args:
            config: Configuration dictionary (merged with defaults)
        """
        # Merge defaults with provided config
        merged = {**self.defaults, **(config or {})}
        self.config = ShapeConfig.from_dict(merged)
        self.rng = random.Random()
    
    def set_seed(self, seed: int) -> None:
        """Set random seed for reproducibility."""
        self.rng = random.Random(seed)
    
    # =========================================================================
    # Abstract methods - must be implemented by subclasses
    # =========================================================================
    
    @abstractmethod
    def select_parent(self, node: TreeNode, 
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select the best parent for a node.
        
        Args:
            node: The node needing a parent
            candidates: Available parent candidates
            context: Additional context (themes, existing tree, etc.)
        
        Returns:
            Selected parent node, or None if no valid parent
        """
        pass
    
    @abstractmethod
    def calculate_children_count(self, node: TreeNode, 
                                  context: Dict[str, Any]) -> int:
        """
        Calculate how many children a node should have.
        
        Args:
            node: The parent node
            context: Additional context
        
        Returns:
            Number of children (0 to max)
        """
        pass
    
    # =========================================================================
    # Optional overrides - default implementations provided
    # =========================================================================
    
    def should_branch(self, node: TreeNode, 
                      context: Dict[str, Any]) -> bool:
        """
        Determine if a node should have children.
        
        Default: Based on depth and density.
        """
        if self.config.max_depth and node.depth >= self.config.max_depth:
            return False
        
        # Higher density = more likely to branch
        branch_prob = self.config.density * (1 - node.depth * 0.1)
        return self.rng.random() < branch_prob
    
    def get_branch_angle(self, parent: TreeNode, child_index: int,
                         total_children: int, context: Dict[str, Any]) -> float:
        """
        Get branching angle for a child node (in radians).
        
        Default: Distribute evenly within angle range.
        """
        min_angle, max_angle = self.config.branching_angle
        min_rad = math.radians(min_angle)
        max_rad = math.radians(max_angle)
        
        if total_children == 1:
            return (min_rad + max_rad) / 2
        
        # Distribute angles evenly
        spread = max_rad - min_rad
        step = spread / (total_children - 1) if total_children > 1 else 0
        return min_rad + step * child_index
    
    def score_parent_candidate(self, node: TreeNode,
                               candidate: TreeNode,
                               context: Dict[str, Any]) -> float:
        """
        Score a potential parent (higher = better).

        Default: Prefer same theme, fewer children, appropriate depth,
        and NLP description similarity when available.
        """
        score = 1.0

        # Prefer parents with fewer children
        child_penalty = len(candidate.children) * 0.2
        score -= child_penalty

        # Prefer same theme
        if node.theme and candidate.theme:
            if node.theme == candidate.theme:
                score += self.config.theme_coherence

        # Prefer appropriate depth
        depth_diff = abs(node.depth - candidate.depth - 1)
        score -= depth_diff * 0.3

        # NLP description similarity bonus (TF-IDF cosine similarity)
        similarities = context.get('similarities')
        if similarities:
            key = f"{node.form_id}:{candidate.form_id}"
            sim = similarities.get(key, 0.0)
            score += sim * 0.8  # Up to +0.8 for perfect similarity (scale matches base ~1.0)

        return score
    
    def apply_symmetry(self, positions: List[Vector2D],
                       context: Dict[str, Any]) -> List[Vector2D]:
        """
        Apply symmetry transformation to positions.
        
        Default: Based on symmetry_mode config.
        """
        if self.config.symmetry_mode == 'none':
            return positions
        
        # Apply partial symmetry (blend with symmetric version)
        strength = self.config.symmetry_strength
        
        if self.config.symmetry_mode == 'mirror':
            # Mirror across Y axis
            mirrored = [Vector2D(-p.x, p.y) for p in positions]
            return [
                Vector2D(
                    p.x * (1 - strength) + m.x * strength,
                    p.y * (1 - strength) + m.y * strength
                )
                for p, m in zip(positions, mirrored)
            ]
        
        return positions
