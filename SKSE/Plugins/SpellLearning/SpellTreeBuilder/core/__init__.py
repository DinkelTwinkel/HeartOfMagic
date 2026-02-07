"""
Core utilities for the SpellTreeBuilder modular system.

Provides:
- TreeNode: Node representation for spell trees
- SpacingEngine: Collision prevention and layout spacing
- Vector2D, math utilities: Geometry helpers
- ShapeRegistry: Plugin auto-discovery for shapes and formations
"""

from .node import TreeNode
from .spacing import SpacingEngine
from .math_utils import Vector2D, normalize_angle, lerp, clamp
from .registry import ShapeRegistry, FormationRegistry

__all__ = [
    'TreeNode',
    'SpacingEngine', 
    'Vector2D',
    'normalize_angle',
    'lerp',
    'clamp',
    'ShapeRegistry',
    'FormationRegistry',
]
