"""
Cloud Tree Shape - Clustered groups with gaps.

Creates fluffy, clustered formations with visible
spacing between groups. Good for varied magic schools.
"""

from typing import Dict, Any, List, Optional, Set
import random
import math

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.node import TreeNode
from core.registry import register_shape
from .base import ShapeProfile


@register_shape("cloud")
class CloudShape(ShapeProfile):
    """
    Clustered groups forming cloud-like shapes.
    
    Creates distinct clusters of related spells with
    visible gaps between clusters.
    """
    
    name = "cloud"
    description = "Clustered groups with gaps between"
    
    defaults = {
        'max_children': (2, 3),
        'density': 0.8,  # Dense within clusters
        'branching_angle': (20, 160),  # Full spread
        'symmetry_mode': 'none',
        'cluster_size': 5,  # Target spells per cluster
        'cluster_gap': 2.0,  # Gap between clusters
    }
    
    def __init__(self, config: Dict[str, Any] = None):
        super().__init__(config)
        # Track current clusters
        self._clusters: Dict[str, Set[str]] = {}  # cluster_id -> node_ids
        self._node_cluster: Dict[str, str] = {}  # node_id -> cluster_id
        self._cluster_count = 0
    
    def select_parent(self, node: TreeNode,
                      candidates: List[TreeNode],
                      context: Dict[str, Any]) -> Optional[TreeNode]:
        """
        Select parent - strongly prefer same cluster/theme.
        """
        if not candidates:
            return None
        
        max_children = self.config.max_children[1]
        available = [c for c in candidates if len(c.children) < max_children]
        
        if not available:
            return None
        
        # Try to join existing cluster of same theme
        theme = node.theme or '_default'
        same_theme = [c for c in available if c.theme == theme]
        
        if same_theme:
            # Within theme, prefer nodes already in a cluster
            in_cluster = [c for c in same_theme if c.form_id in self._node_cluster]
            
            if in_cluster:
                # Check cluster isn't too big
                cluster_size = self.defaults.get('cluster_size', 5)
                for c in in_cluster:
                    cid = self._node_cluster.get(c.form_id)
                    if cid and len(self._clusters.get(cid, set())) < cluster_size:
                        return c
            
            # Start new cluster with this theme
            return self.rng.choice(same_theme)
        
        # No same-theme: pick any available
        return self.rng.choice(available)
    
    def calculate_children_count(self, node: TreeNode,
                                  context: Dict[str, Any]) -> int:
        """
        Calculate children - dense within clusters.
        """
        # Root starts multiple clusters
        if node.depth == 0:
            return 3
        
        # Within cluster: likely 2-3 children
        if node.form_id in self._node_cluster:
            cid = self._node_cluster[node.form_id]
            cluster = self._clusters.get(cid, set())
            
            # Near cluster capacity: fewer children
            max_size = self.defaults.get('cluster_size', 5)
            if len(cluster) >= max_size - 1:
                return 1
            
            return self.rng.randint(2, 3)
        
        # Starting new cluster
        return self.rng.randint(2, 3)
    
    def _assign_to_cluster(self, node_id: str, parent_id: Optional[str]) -> None:
        """Assign a node to a cluster."""
        if parent_id and parent_id in self._node_cluster:
            # Join parent's cluster
            cid = self._node_cluster[parent_id]
            cluster = self._clusters.get(cid, set())
            
            max_size = self.defaults.get('cluster_size', 5)
            if len(cluster) < max_size:
                cluster.add(node_id)
                self._node_cluster[node_id] = cid
                return
        
        # Start new cluster
        self._cluster_count += 1
        cid = f"cluster_{self._cluster_count}"
        self._clusters[cid] = {node_id}
        self._node_cluster[node_id] = cid
    
    def get_branch_angle(self, parent: TreeNode, child_index: int,
                         total_children: int, context: Dict[str, Any]) -> float:
        """
        Angles for cloud formation - spread within cluster.
        """
        # Wide, random-ish spread for fluffy appearance
        base = math.radians(90)  # Center
        
        if total_children == 1:
            return base + self.rng.uniform(-0.5, 0.5)
        
        # Spread children evenly with some jitter
        spread = math.radians(120)
        step = spread / (total_children - 1)
        offset = -spread / 2 + step * child_index
        jitter = self.rng.uniform(-0.2, 0.2)
        
        return base + offset + jitter
    
    def should_branch(self, node: TreeNode,
                      context: Dict[str, Any]) -> bool:
        """
        Cloud nodes branch based on cluster state.
        """
        # Always branch from shallow nodes
        if node.depth < 2:
            return True
        
        # Check if cluster needs more nodes
        if node.form_id in self._node_cluster:
            cid = self._node_cluster[node.form_id]
            cluster = self._clusters.get(cid, set())
            max_size = self.defaults.get('cluster_size', 5)
            
            if len(cluster) < max_size:
                return self.rng.random() < 0.8
        
        return self.rng.random() < self.config.density
