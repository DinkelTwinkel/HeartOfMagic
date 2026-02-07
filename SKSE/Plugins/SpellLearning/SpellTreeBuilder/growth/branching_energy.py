"""
Branching Energy System for controlling tree growth patterns.

Controls how many straight-line (1-to-1) connections must occur before
branching is allowed. This creates more organic tree structures with
controlled variation.

Key concepts:
- Energy accumulates with each straight (single-child) connection
- When energy threshold is reached, branching becomes possible
- Randomness controls variation in branching decisions
"""

from typing import Dict, Any, Optional
from dataclasses import dataclass, field
import random


@dataclass
class BranchingEnergyConfig:
    """Configuration for the branching energy system."""
    
    # Whether branching energy is enabled
    enabled: bool = True
    
    # Straight-line growth constraints
    min_straight: int = 2       # Minimum 1->1 connections before branch allowed
    max_straight: int = 5       # Maximum before forced branch
    
    # Energy accumulation
    energy_per_node: float = 0.3      # Energy gained per straight connection
    energy_to_branch: float = 1.0     # Energy needed to allow branching
    
    # Randomness control (0 = deterministic, 1 = fully random)
    randomness: float = 0.3
    
    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'BranchingEnergyConfig':
        """Create config from dictionary."""
        return cls(
            enabled=d.get('enabled', True),
            min_straight=d.get('min_straight', 2),
            max_straight=d.get('max_straight', 5),
            energy_per_node=d.get('energy_per_node', 0.3),
            energy_to_branch=d.get('energy_to_branch', 1.0),
            randomness=d.get('randomness', 0.3),
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'enabled': self.enabled,
            'min_straight': self.min_straight,
            'max_straight': self.max_straight,
            'energy_per_node': self.energy_per_node,
            'energy_to_branch': self.energy_to_branch,
            'randomness': self.randomness,
        }


class BranchingEnergy:
    """
    Manages branching energy for tree growth.
    
    Tracks energy accumulation along growth paths and decides
    when branching is allowed or required.
    """
    
    def __init__(self, config: Optional[BranchingEnergyConfig] = None):
        """
        Initialize branching energy system.
        
        Args:
            config: BranchingEnergyConfig or None for defaults
        """
        self.config = config or BranchingEnergyConfig()
        
        # Track straight-line counts per path
        # Key: node_id (the tip of the current path)
        # Value: number of consecutive straight connections
        self._straight_counts: Dict[str, int] = {}
        
        # Track energy per path
        self._energy: Dict[str, float] = {}
    
    @classmethod
    def from_config_dict(cls, d: Dict[str, Any]) -> 'BranchingEnergy':
        """Create from configuration dictionary."""
        return cls(BranchingEnergyConfig.from_dict(d))
    
    def reset(self) -> None:
        """Reset all tracking state."""
        self._straight_counts.clear()
        self._energy.clear()
    
    def start_path(self, root_id: str) -> None:
        """
        Start tracking a new path from root.
        
        Args:
            root_id: The root node ID starting this path
        """
        self._straight_counts[root_id] = 0
        self._energy[root_id] = 0.0
    
    def record_connection(self, parent_id: str, child_id: str, is_branch: bool) -> None:
        """
        Record a connection between nodes.
        
        Args:
            parent_id: The parent node ID
            child_id: The child node ID
            is_branch: Whether this was a branching connection (parent has multiple children)
        """
        if not self.config.enabled:
            return
        
        # Get parent's counts, default to 0
        parent_straight = self._straight_counts.get(parent_id, 0)
        parent_energy = self._energy.get(parent_id, 0.0)
        
        if is_branch:
            # Branching resets the straight count but keeps some energy
            self._straight_counts[child_id] = 0
            # Branching consumes energy
            remaining_energy = max(0, parent_energy - self.config.energy_to_branch)
            self._energy[child_id] = remaining_energy * 0.5  # Partial carry-over
        else:
            # Straight connection accumulates
            self._straight_counts[child_id] = parent_straight + 1
            self._energy[child_id] = parent_energy + self.config.energy_per_node
    
    def get_straight_count(self, node_id: str) -> int:
        """Get the consecutive straight count for a node's path."""
        return self._straight_counts.get(node_id, 0)
    
    def get_energy(self, node_id: str) -> float:
        """Get the accumulated energy for a node's path."""
        return self._energy.get(node_id, 0.0)
    
    def can_branch(self, node_id: str) -> bool:
        """
        Check if branching is allowed at this node.
        
        Args:
            node_id: The node to check
            
        Returns:
            True if branching is allowed
        """
        if not self.config.enabled:
            return True  # Always allow if disabled
        
        straight_count = self.get_straight_count(node_id)
        
        # Must meet minimum straight connections
        if straight_count < self.config.min_straight:
            return False
        
        # Always allow at or beyond maximum
        if straight_count >= self.config.max_straight:
            return True
        
        # Check energy threshold
        energy = self.get_energy(node_id)
        return energy >= self.config.energy_to_branch
    
    def must_branch(self, node_id: str) -> bool:
        """
        Check if branching is required at this node.
        
        Args:
            node_id: The node to check
            
        Returns:
            True if branching must occur
        """
        if not self.config.enabled:
            return False
        
        straight_count = self.get_straight_count(node_id)
        return straight_count >= self.config.max_straight
    
    def should_branch(self, node_id: str, base_probability: float = 0.5) -> bool:
        """
        Probabilistic check if this node should branch.
        
        Combines energy state with randomness to decide.
        
        Args:
            node_id: The node to check
            base_probability: Base branching probability from shape profile
            
        Returns:
            True if branching should occur
        """
        if not self.config.enabled:
            # Use base probability when disabled
            return random.random() < base_probability
        
        # Check constraints first
        if not self.can_branch(node_id):
            return False
        
        if self.must_branch(node_id):
            return True
        
        # Probabilistic decision
        straight_count = self.get_straight_count(node_id)
        energy = self.get_energy(node_id)
        
        # Calculate branch probability
        # Higher energy = higher chance to branch
        energy_factor = min(1.0, energy / self.config.energy_to_branch)
        
        # Straight count also increases probability as we approach max
        progress = (straight_count - self.config.min_straight) / max(1, self.config.max_straight - self.config.min_straight)
        straight_factor = progress
        
        # Combine factors
        deterministic_prob = (energy_factor * 0.6 + straight_factor * 0.4) * base_probability
        
        # Apply randomness
        if self.config.randomness > 0:
            random_offset = (random.random() - 0.5) * 2 * self.config.randomness
            final_prob = deterministic_prob + random_offset * 0.5
            final_prob = max(0.0, min(1.0, final_prob))
        else:
            final_prob = deterministic_prob
        
        return random.random() < final_prob
    
    def calculate_children_count(
        self,
        node_id: str,
        max_children: int,
        base_probability: float = 0.5
    ) -> int:
        """
        Calculate how many children a node should have.
        
        Uses branching energy to influence the decision.
        
        Args:
            node_id: The node to calculate for
            max_children: Maximum children allowed
            base_probability: Base branching probability
            
        Returns:
            Number of children (1 = straight, >1 = branch)
        """
        if max_children <= 1:
            return max_children
        
        # Check if we should branch
        if not self.should_branch(node_id, base_probability):
            return 1  # Straight connection
        
        # Branching! Decide how many children
        if not self.config.enabled or self.config.randomness >= 0.8:
            # High randomness: random count
            return random.randint(2, max_children)
        
        # Lower randomness: energy influences count
        energy = self.get_energy(node_id)
        energy_excess = max(0, energy - self.config.energy_to_branch)
        
        # More excess energy = potentially more children
        # But also apply randomness
        base_count = 2  # Minimum branch is 2
        energy_bonus = int(energy_excess / self.config.energy_per_node)
        
        if self.config.randomness > 0:
            random_bonus = random.randint(0, max(0, max_children - base_count - energy_bonus))
            final_count = base_count + energy_bonus + int(random_bonus * self.config.randomness)
        else:
            final_count = base_count + energy_bonus
        
        return min(max_children, max(2, final_count))
    
    def get_state(self, node_id: str) -> Dict[str, Any]:
        """
        Get full state for a node (for debugging/display).
        
        Args:
            node_id: The node to get state for
            
        Returns:
            Dictionary with straight_count, energy, can_branch, must_branch
        """
        return {
            'straight_count': self.get_straight_count(node_id),
            'energy': self.get_energy(node_id),
            'can_branch': self.can_branch(node_id),
            'must_branch': self.must_branch(node_id),
            'config': self.config.to_dict() if self.config.enabled else None,
        }
    
    def __repr__(self) -> str:
        paths = len(self._straight_counts)
        return f"BranchingEnergy(enabled={self.config.enabled}, tracking={paths} paths)"
