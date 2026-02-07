"""
TreeNode class for spell tree representation.

Each node represents a spell in the tree with:
- Spell data (formId, name, tier, school, theme)
- Tree structure (children, prerequisites, depth)
- Layout hints (position for rendering)
"""

from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field


@dataclass
class TreeNode:
    """Represents a node in the spell tree."""
    
    # Spell identification
    form_id: str
    name: str = ""
    tier: str = "Unknown"
    school: str = "Unknown"
    theme: Optional[str] = None
    
    # Tree structure
    children: List[str] = field(default_factory=list)
    prerequisites: List[str] = field(default_factory=list)
    depth: int = 0
    
    # Layout hints (optional, for rendering)
    position: Optional[Tuple[float, float]] = None
    
    # Special flags
    is_root: bool = False
    
    # Original spell data reference
    spell_data: Optional[Dict[str, Any]] = None
    
    @classmethod
    def from_spell(cls, spell: Dict[str, Any]) -> 'TreeNode':
        """Create a TreeNode from spell dictionary."""
        return cls(
            form_id=spell.get('formId', ''),
            name=spell.get('name', spell.get('formId', '')),
            tier=spell.get('skillLevel', 'Unknown'),
            school=spell.get('school', 'Unknown'),
            spell_data=spell,
        )
    
    def add_child(self, child_id: str) -> None:
        """Add a child node ID."""
        if child_id not in self.children:
            self.children.append(child_id)
    
    def add_prerequisite(self, prereq_id: str) -> None:
        """Add a prerequisite node ID."""
        if prereq_id not in self.prerequisites:
            self.prerequisites.append(prereq_id)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to output format for JSON serialization."""
        result = {
            'formId': self.form_id,
            'children': self.children.copy(),
            'prerequisites': self.prerequisites.copy(),
            'tier': self.depth + 1,  # 1-indexed tiers for output
        }

        # Include theme if set (for element isolation scoring)
        if self.theme:
            result['theme'] = self.theme

        # Include position if set
        if self.position is not None:
            result['position'] = {
                'x': self.position[0],
                'y': self.position[1],
            }
        
        return result
    
    def __repr__(self) -> str:
        return f"TreeNode({self.form_id}, name={self.name!r}, depth={self.depth})"


def link_nodes(parent: TreeNode, child: TreeNode) -> None:
    """Create bidirectional link between parent and child nodes."""
    parent.add_child(child.form_id)
    child.add_prerequisite(parent.form_id)
    child.depth = parent.depth + 1


def unlink_nodes(parent: TreeNode, child: TreeNode) -> None:
    """Remove link between parent and child nodes."""
    if child.form_id in parent.children:
        parent.children.remove(child.form_id)
    if parent.form_id in child.prerequisites:
        child.prerequisites.remove(parent.form_id)
