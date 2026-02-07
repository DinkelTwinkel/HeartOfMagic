"""
Spiky Tree Shape - Long thin branches with sharp angles.

Creates dramatic, aggressive-looking trees with long
single-child chains punctuated by occasional splits.
Good for elemental magic (Destruction).
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


@register_shape("spiky")
class SpikyShape(ShapeProfile):
    """
    Long thin branches with sharp angles.
    
    Mostly single-child chains that occasionally split
    at sharp angles, creating spiky appearance.
    """
    
    name = "spiky"
    description = "Long thin branches, sharp angles"
    
    defaults = {
        'max_children': (1, 2),
        'density': 0.4,  # Sparse - long chains
        'branching_angle': (60, 120),  # Sharp angles
        'symmetry_mode': 'none',
        'spike_length': 4,  # Target length of spikes before split
        'split_chance': 0.15,  # Chance to split per node
    }
    
    def __init__(self, config: Dict[str, Any] = None):
        super().__init__(config)
        # Track chain lengths per branch
        self._chain_lengths: Dict[str, int] = {}
    
    def select_parent(self, node: TreeNode,
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select parent - extend existing spikes.
        """
        if not candidates:
            return None
        
        max_children = self.config.max_children[1]
        available = [c for c in candidates if len(c.children) < max_children]
        
        if not available:
            return None
        
        # Prefer nodes with 0 children (extend spike)
        tips = [c for c in available if len(c.children) == 0]
        
        if tips:
            # Among tips, prefer same theme
            same_theme = [c for c in tips if c.theme == node.theme]
            if same_theme:
                return self.rng.choice(same_theme)
            return self.rng.choice(tips)
        
        # Need to branch from existing spike
        # Prefer deeper nodes (longer spikes)
        return max(available, key=lambda c: c.depth)
    
    def calculate_children_count(self, node: TreeNode,
                                  context: Dict[str, Any]) -> int:
        """
        Calculate children - mostly 1, occasional 2.
        """
        # Root starts multiple spikes
        if node.depth == 0:
            return self.rng.randint(2, 3)
        
        # Track chain length
        chain_len = self._chain_lengths.get(node.form_id, node.depth)
        spike_target = self.defaults.get('spike_length', 4)
        split_chance = self.defaults.get('split_chance', 0.15)
        
        # More likely to split as chain gets longer
        adjusted_chance = split_chance * (chain_len / spike_target)
        
        if self.rng.random() < adjusted_chance:
            return 2  # Split into two spikes
        return 1  # Continue single spike
    
    def get_branch_angle(self, parent: TreeNode, child_index: int,
                         total_children: int, context: Dict[str, Any]) -> float:
        """
        Sharp branching angles for spiky appearance.
        """
        if total_children == 1:
            # Single child: slight variation from parent direction
            base = math.radians(90)  # Default down
            jitter = self.rng.uniform(-0.3, 0.3)
            return base + jitter
        
        # Two children: sharp V split
        if child_index == 0:
            return math.radians(45 + self.rng.uniform(-10, 10))
        else:
            return math.radians(135 + self.rng.uniform(-10, 10))
    
    def should_branch(self, node: TreeNode,
                      context: Dict[str, Any]) -> bool:
        """
        Spiky trees almost always continue growing.
        """
        # Stop at very deep nodes
        if node.depth >= 8:
            return self.rng.random() < 0.3
        return True
