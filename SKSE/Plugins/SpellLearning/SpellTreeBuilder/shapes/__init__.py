"""
Shape plugins for the SpellTreeBuilder.

Each shape defines how the spell tree grows:
- Parent selection strategy
- Children count and positioning
- Branching angles and symmetry

Shapes are auto-discovered via the @register_shape decorator.
"""

import importlib
import pkgutil
import sys
from pathlib import Path

# Handle both package and direct imports
try:
    from ..core.registry import ShapeRegistry
except ImportError:
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from core.registry import ShapeRegistry

# Auto-import all shape_*.py modules to trigger registration
_package_dir = Path(__file__).parent
for _, module_name, _ in pkgutil.iter_modules([str(_package_dir)]):
    if module_name.startswith('shape_'):
        importlib.import_module(f'.{module_name}', package=__name__)

# Re-export for convenience
from .base import ShapeProfile, ShapeConfig

__all__ = [
    'ShapeProfile',
    'ShapeConfig',
    'ShapeRegistry',
]


def get_shape(name: str, config: dict = None) -> ShapeProfile:
    """
    Get a shape instance by name.
    
    Args:
        name: Shape name (e.g., 'organic', 'radial', 'grid')
        config: Optional configuration dict
    
    Returns:
        ShapeProfile instance
    """
    return ShapeRegistry.create(name, config or {})


def list_shapes() -> list:
    """Get list of all available shape names."""
    return ShapeRegistry.list_names()
