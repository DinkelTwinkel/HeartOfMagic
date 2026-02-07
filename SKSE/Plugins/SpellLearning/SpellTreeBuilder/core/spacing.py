"""
Spacing Engine for collision prevention and layout.

Ensures nodes don't overlap and maintains minimum spacing.
Uses spatial indexing for efficient collision detection.
"""

from typing import Dict, Set, Tuple, List, Optional
from dataclasses import dataclass, field
import math

from .math_utils import Vector2D, clamp
from .node import TreeNode


@dataclass
class SpacingConfig:
    """Configuration for spacing engine."""
    min_spacing: float = 1.0
    grid_cell_size: float = 2.0
    repulsion_strength: float = 0.5
    repulsion_iterations: int = 3


class SpacingEngine:
    """
    Prevents node overlap and ensures readability.
    
    Uses a grid-based spatial index for efficient lookups.
    """
    
    def __init__(self, config: Optional[SpacingConfig] = None):
        self.config = config or SpacingConfig()
        self.min_spacing = self.config.min_spacing
        self.cell_size = self.config.grid_cell_size
        
        # Spatial index: grid cell -> set of node IDs
        self.spatial_index: Dict[Tuple[int, int], Set[str]] = {}
        
        # Node positions
        self.positions: Dict[str, Vector2D] = {}
    
    def _get_cell(self, pos: Vector2D) -> Tuple[int, int]:
        """Get grid cell for a position."""
        return (
            int(pos.x // self.cell_size),
            int(pos.y // self.cell_size)
        )
    
    def _get_nearby_cells(self, pos: Vector2D, radius: float = 1) -> List[Tuple[int, int]]:
        """Get all cells within radius of position."""
        center_cell = self._get_cell(pos)
        cells_radius = int(radius / self.cell_size) + 1
        
        cells = []
        for dx in range(-cells_radius, cells_radius + 1):
            for dy in range(-cells_radius, cells_radius + 1):
                cells.append((center_cell[0] + dx, center_cell[1] + dy))
        return cells
    
    def register_node(self, node_id: str, position: Vector2D) -> None:
        """Register a node's position in the spatial index."""
        # Remove from old cell if exists
        if node_id in self.positions:
            old_cell = self._get_cell(self.positions[node_id])
            if old_cell in self.spatial_index:
                self.spatial_index[old_cell].discard(node_id)
        
        # Add to new cell
        self.positions[node_id] = position
        cell = self._get_cell(position)
        if cell not in self.spatial_index:
            self.spatial_index[cell] = set()
        self.spatial_index[cell].add(node_id)
    
    def unregister_node(self, node_id: str) -> None:
        """Remove a node from the spatial index."""
        if node_id in self.positions:
            cell = self._get_cell(self.positions[node_id])
            if cell in self.spatial_index:
                self.spatial_index[cell].discard(node_id)
            del self.positions[node_id]
    
    def get_nearby_nodes(self, position: Vector2D, 
                         radius: Optional[float] = None) -> List[str]:
        """Get all node IDs near a position."""
        radius = radius or self.min_spacing * 2
        nearby = []
        
        for cell in self._get_nearby_cells(position, radius):
            if cell in self.spatial_index:
                for node_id in self.spatial_index[cell]:
                    if self.positions[node_id].distance_to(position) <= radius:
                        nearby.append(node_id)
        
        return nearby
    
    def check_overlap(self, position: Vector2D, 
                      exclude_id: Optional[str] = None) -> bool:
        """Check if position conflicts with existing nodes."""
        for node_id in self.get_nearby_nodes(position, self.min_spacing):
            if node_id != exclude_id:
                dist = self.positions[node_id].distance_to(position)
                if dist < self.min_spacing:
                    return True
        return False
    
    def find_valid_position(self, preferred: Vector2D, 
                            parent_pos: Optional[Vector2D] = None,
                            direction: Optional[Vector2D] = None) -> Vector2D:
        """
        Find nearest unoccupied position.
        
        Args:
            preferred: Desired position
            parent_pos: Parent node position (for direction preference)
            direction: Preferred direction to search
        
        Returns:
            Valid position that doesn't overlap existing nodes
        """
        # Check if preferred position is valid
        if not self.check_overlap(preferred):
            return preferred
        
        # Search in expanding circles
        if direction is None and parent_pos is not None:
            direction = (preferred - parent_pos).normalized
        if direction is None:
            direction = Vector2D(1, 0)
        
        for radius_mult in [1, 2, 3, 4, 5]:
            search_radius = self.min_spacing * radius_mult
            
            # Try points around the preferred position
            for angle_offset in range(0, 360, 30):
                angle_rad = math.radians(angle_offset)
                test_dir = direction.rotate(angle_rad)
                test_pos = preferred + test_dir * search_radius
                
                if not self.check_overlap(test_pos):
                    return test_pos
        
        # Fallback: return preferred with offset
        return preferred + direction * self.min_spacing * 2
    
    def repel_nearby_nodes(self, nodes: Dict[str, TreeNode], 
                           iterations: Optional[int] = None) -> None:
        """
        Push overlapping nodes apart using force-directed repulsion.
        
        Args:
            nodes: Dictionary of node_id -> TreeNode
            iterations: Number of repulsion iterations
        """
        iterations = iterations or self.config.repulsion_iterations
        strength = self.config.repulsion_strength
        
        for _ in range(iterations):
            forces: Dict[str, Vector2D] = {nid: Vector2D() for nid in self.positions}
            
            # Calculate repulsion forces
            for node_id, pos in self.positions.items():
                for other_id in self.get_nearby_nodes(pos):
                    if other_id == node_id:
                        continue
                    
                    other_pos = self.positions[other_id]
                    diff = pos - other_pos
                    dist = diff.magnitude
                    
                    if dist < self.min_spacing and dist > 0:
                        # Repulsion force inversely proportional to distance
                        force_mag = (self.min_spacing - dist) * strength
                        force = diff.normalized * force_mag
                        forces[node_id] = forces[node_id] + force
            
            # Apply forces
            for node_id, force in forces.items():
                if force.magnitude > 0:
                    new_pos = self.positions[node_id] + force
                    self.register_node(node_id, new_pos)
                    
                    # Update node position if it has position attribute
                    if node_id in nodes:
                        nodes[node_id].position = new_pos.to_tuple()
    
    def clear(self) -> None:
        """Clear all registered nodes."""
        self.spatial_index.clear()
        self.positions.clear()
