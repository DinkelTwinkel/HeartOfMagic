"""
Validator Module for Spell Tree Builder

Validates that generated spell trees have correct structure:
- All nodes are reachable from root
- No cycles exist
- Prerequisites are valid
- Max children constraint is respected

Mirrors the validation logic from treeParser.js.
"""

from typing import List, Dict, Any, Set, Optional, Tuple
from collections import defaultdict


class TreeValidationResult:
    """Result of tree validation."""
    
    def __init__(self):
        self.valid = True
        self.total_nodes = 0
        self.reachable_nodes = 0
        self.unreachable: List[Dict[str, Any]] = []
        self.cycles: List[List[str]] = []
        self.orphans: List[str] = []
        self.max_children_violations: List[str] = []
        self.missing_prereqs: List[Tuple[str, str]] = []  # (node, missing_prereq)
        self.warnings: List[str] = []
        self.errors: List[str] = []
    
    def add_error(self, msg: str):
        self.errors.append(msg)
        self.valid = False
    
    def add_warning(self, msg: str):
        self.warnings.append(msg)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'valid': self.valid,
            'total_nodes': self.total_nodes,
            'reachable_nodes': self.reachable_nodes,
            'unreachable_count': len(self.unreachable),
            'unreachable': self.unreachable,
            'cycles': self.cycles,
            'orphans': self.orphans,
            'max_children_violations': self.max_children_violations,
            'missing_prereqs': self.missing_prereqs,
            'warnings': self.warnings,
            'errors': self.errors,
        }


def simulate_unlocks(
    nodes: Dict[str, Dict[str, Any]],
    root_id: str,
    max_iterations: Optional[int] = None
) -> Set[str]:
    """
    Simulate the unlock process starting from root.
    
    A node becomes unlocked when ALL its prerequisites are unlocked.
    This mirrors the simulateUnlocks function in treeParser.js.
    
    Args:
        nodes: Dictionary mapping formId to node data
        root_id: FormID of the root node
        max_iterations: Maximum iterations (default: len(nodes) + 10)
        
    Returns:
        Set of unlockable formIds
    """
    if max_iterations is None:
        max_iterations = len(nodes) + 10
    
    unlocked: Set[str] = set()
    unlocked.add(root_id)
    
    changed = True
    iterations = 0
    
    while changed and iterations < max_iterations:
        changed = False
        iterations += 1
        
        for form_id, node in nodes.items():
            if form_id in unlocked:
                continue
            
            prereqs = node.get('prerequisites', [])
            if not prereqs:
                # No prerequisites but not root - this is an orphan or secondary root
                continue
            
            # Check if all prerequisites are unlocked
            all_prereqs_unlocked = all(prereq in unlocked for prereq in prereqs)
            
            if all_prereqs_unlocked:
                unlocked.add(form_id)
                changed = True
    
    return unlocked


def find_unreachable_nodes(
    nodes: Dict[str, Dict[str, Any]],
    root_id: str
) -> List[Dict[str, Any]]:
    """
    Find all nodes that cannot be unlocked from the root.
    
    Args:
        nodes: Dictionary mapping formId to node data
        root_id: FormID of the root node
        
    Returns:
        List of unreachable node info dictionaries
    """
    unlockable = simulate_unlocks(nodes, root_id)
    unreachable = []
    
    for form_id, node in nodes.items():
        if form_id not in unlockable:
            # Find which prerequisites are blocking
            prereqs = node.get('prerequisites', [])
            blocking = [p for p in prereqs if p not in unlockable]
            
            unreachable.append({
                'formId': form_id,
                'tier': node.get('tier', 0),
                'prerequisites': prereqs,
                'blocking_prereqs': blocking,
            })
    
    return unreachable


def detect_cycles(nodes: Dict[str, Dict[str, Any]]) -> List[List[str]]:
    """
    Detect cycles in the prerequisite graph using DFS.
    
    A cycle exists if following prerequisites leads back to a visited node.
    
    Args:
        nodes: Dictionary mapping formId to node data
        
    Returns:
        List of cycles (each cycle is a list of formIds)
    """
    cycles = []
    visited: Set[str] = set()
    rec_stack: Set[str] = set()
    
    def dfs(node_id: str, path: List[str]) -> bool:
        """DFS to detect cycle, returns True if cycle found."""
        if node_id in rec_stack:
            # Found cycle - extract it from path
            cycle_start = path.index(node_id)
            cycles.append(path[cycle_start:] + [node_id])
            return True
        
        if node_id in visited:
            return False
        
        visited.add(node_id)
        rec_stack.add(node_id)
        path.append(node_id)
        
        node = nodes.get(node_id, {})
        for prereq in node.get('prerequisites', []):
            if prereq in nodes:  # Only follow valid prereqs
                dfs(prereq, path)
        
        path.pop()
        rec_stack.remove(node_id)
        return False
    
    for node_id in nodes:
        if node_id not in visited:
            dfs(node_id, [])
    
    return cycles


def validate_school_tree(
    school_data: Dict[str, Any],
    school_name: str,
    max_children: int = 3
) -> TreeValidationResult:
    """
    Validate a single school's tree structure.
    
    Args:
        school_data: School tree data (root, nodes, etc.)
        school_name: Name of the school (for error messages)
        max_children: Maximum allowed children per node
        
    Returns:
        TreeValidationResult with validation details
    """
    result = TreeValidationResult()
    
    root_id = school_data.get('root')
    nodes_list = school_data.get('nodes', [])
    
    if not root_id:
        result.add_error(f"{school_name}: Missing root node")
        return result
    
    if not nodes_list:
        result.add_error(f"{school_name}: No nodes in tree")
        return result
    
    # Convert nodes list to dictionary for easier lookup
    nodes: Dict[str, Dict[str, Any]] = {}
    duplicate_ids = []
    for node in nodes_list:
        form_id = node.get('formId')
        if form_id:
            if form_id in nodes:
                duplicate_ids.append(form_id)
            nodes[form_id] = node

    result.total_nodes = len(nodes)

    # Check for duplicate formIds
    if duplicate_ids:
        result.add_warning(f"{school_name}: {len(duplicate_ids)} duplicate formId(s): {duplicate_ids[:5]}")
    
    # Check root exists
    if root_id not in nodes:
        result.add_error(f"{school_name}: Root node {root_id} not in nodes list")
        return result
    
    # Check root has no prerequisites
    root_node = nodes[root_id]
    if root_node.get('prerequisites'):
        result.add_warning(f"{school_name}: Root node has prerequisites (should be empty)")
    
    # Check for cycles
    cycles = detect_cycles(nodes)
    if cycles:
        result.cycles = cycles
        result.add_error(f"{school_name}: Found {len(cycles)} cycle(s) in prerequisites")
    
    # Simulate unlocks and find unreachable nodes
    unlockable = simulate_unlocks(nodes, root_id)
    result.reachable_nodes = len(unlockable)
    
    unreachable = find_unreachable_nodes(nodes, root_id)
    if unreachable:
        result.unreachable = unreachable
        result.add_error(f"{school_name}: {len(unreachable)} node(s) are unreachable")
    
    # Check max children constraint
    for form_id, node in nodes.items():
        children = node.get('children', [])
        if len(children) > max_children:
            result.max_children_violations.append(form_id)
            result.add_warning(f"{school_name}: Node {form_id} has {len(children)} children (max {max_children})")
    
    # Check prerequisite references are valid
    for form_id, node in nodes.items():
        for prereq in node.get('prerequisites', []):
            if prereq not in nodes:
                result.missing_prereqs.append((form_id, prereq))
                result.add_error(f"{school_name}: Node {form_id} references missing prerequisite {prereq}")
    
    # Check children references are valid
    for form_id, node in nodes.items():
        for child in node.get('children', []):
            if child not in nodes:
                result.add_warning(f"{school_name}: Node {form_id} references missing child {child}")
    
    return result


def validate_tree(tree_data: Dict[str, Any], max_children: int = 3) -> Dict[str, TreeValidationResult]:
    """
    Validate complete tree data for all schools.
    
    Args:
        tree_data: Complete tree JSON with 'schools' key
        max_children: Maximum allowed children per node
        
    Returns:
        Dictionary mapping school name to validation result
    """
    results = {}
    
    schools = tree_data.get('schools', {})
    
    for school_name, school_data in schools.items():
        result = validate_school_tree(school_data, school_name, max_children)
        results[school_name] = result
    
    return results


def fix_unreachable_nodes(
    nodes: Dict[str, Dict[str, Any]],
    root_id: str,
    max_children: int = 3
) -> int:
    """
    Fix unreachable nodes by replacing blocking prerequisites with reachable ones.
    
    The key insight: a node is unreachable if ANY of its prerequisites are unreachable.
    We must REPLACE blocking prereqs, not just add new ones.
    
    Args:
        nodes: Dictionary mapping formId to node data (modified in place)
        root_id: FormID of the root node
        max_children: Maximum children per node
        
    Returns:
        Number of fixes applied
    """
    fixes = 0
    max_passes = 20  # More passes for complex trees
    
    for pass_num in range(max_passes):
        unlockable = simulate_unlocks(nodes, root_id)
        unreachable = [fid for fid in nodes if fid not in unlockable]
        
        if not unreachable:
            break
        
        made_progress = False
        
        for form_id in unreachable:
            node = nodes[form_id]
            node_tier = node.get('tier', 0)
            prereqs = node.get('prerequisites', [])
            
            # Find which prerequisites are blocking (unreachable themselves)
            blocking = [p for p in prereqs if p not in unlockable and p != root_id]
            reachable_prereqs = [p for p in prereqs if p in unlockable]
            
            if not blocking:
                # No blocking prereqs but still unreachable - might be orphan
                if not prereqs:
                    # True orphan - needs a parent
                    pass
                else:
                    # Has prereqs but they're all reachable - shouldn't happen
                    continue
            
            # Strategy: Replace ALL blocking prereqs with ONE reachable parent
            # This guarantees the node becomes unlockable
            
            # Find best reachable parent (prefer one that's already a prereq)
            best_parent = None
            best_score = -float('inf')
            
            # First try to keep an existing reachable prereq
            for prereq_id in reachable_prereqs:
                if prereq_id in nodes:
                    best_parent = prereq_id
                    best_score = 100  # Prefer keeping existing
                    break
            
            # If no reachable prereq, find a new parent
            if best_parent is None:
                for parent_id in unlockable:
                    if parent_id == form_id:
                        continue
                    
                    parent = nodes[parent_id]
                    parent_tier = parent.get('tier', 0)
                    
                    # Skip if parent is full
                    if len(parent.get('children', [])) >= max_children:
                        continue
                    
                    # Score based on tier difference (prefer closer tiers)
                    tier_diff = node_tier - parent_tier
                    if tier_diff < 0:
                        continue  # Parent should be lower or equal tier
                    
                    score = 20 - tier_diff * 5 - len(parent.get('children', []))
                    
                    if score > best_score:
                        best_score = score
                        best_parent = parent_id
            
            if best_parent:
                # Remove blocking prerequisites from their parents' children lists
                for blocking_id in blocking:
                    if blocking_id in nodes:
                        blocking_node = nodes[blocking_id]
                        children = blocking_node.get('children', [])
                        if form_id in children:
                            children.remove(form_id)
                
                # Replace prerequisites: keep only reachable ones + new parent
                new_prereqs = [p for p in prereqs if p in unlockable]
                if best_parent not in new_prereqs:
                    new_prereqs.append(best_parent)
                node['prerequisites'] = new_prereqs
                
                # Add to new parent's children if not already there
                parent = nodes[best_parent]
                if 'children' not in parent:
                    parent['children'] = []
                if form_id not in parent['children']:
                    parent['children'].append(form_id)
                
                fixes += 1
                made_progress = True
        
        if not made_progress:
            # No progress made - try more aggressive fix
            # Connect remaining unreachable directly to root
            for form_id in unreachable:
                if form_id == root_id:
                    continue
                node = nodes[form_id]
                
                # Clear all prerequisites and connect to root
                old_prereqs = node.get('prerequisites', [])
                for old_prereq in old_prereqs:
                    if old_prereq in nodes:
                        old_children = nodes[old_prereq].get('children', [])
                        if form_id in old_children:
                            old_children.remove(form_id)
                
                node['prerequisites'] = [root_id]
                root_node = nodes[root_id]
                if 'children' not in root_node:
                    root_node['children'] = []
                if form_id not in root_node['children']:
                    root_node['children'].append(form_id)
                
                fixes += 1
                made_progress = True
            
            if not made_progress:
                break
    
    return fixes


def get_validation_summary(results: Dict[str, TreeValidationResult]) -> Dict[str, Any]:
    """Get a summary of validation results across all schools."""
    total_schools = len(results)
    valid_schools = sum(1 for r in results.values() if r.valid)
    total_nodes = sum(r.total_nodes for r in results.values())
    reachable_nodes = sum(r.reachable_nodes for r in results.values())
    total_errors = sum(len(r.errors) for r in results.values())
    total_warnings = sum(len(r.warnings) for r in results.values())
    
    return {
        'all_valid': all(r.valid for r in results.values()),
        'total_schools': total_schools,
        'valid_schools': valid_schools,
        'total_nodes': total_nodes,
        'reachable_nodes': reachable_nodes,
        'unreachable_nodes': total_nodes - reachable_nodes,
        'total_errors': total_errors,
        'total_warnings': total_warnings,
        'schools': {name: r.to_dict() for name, r in results.items()},
    }


if __name__ == '__main__':
    # Test with sample tree
    sample_tree = {
        'version': '1.0',
        'schools': {
            'Destruction': {
                'root': '0x00012FCD',
                'nodes': [
                    {'formId': '0x00012FCD', 'children': ['0x0001C789', '0x0001C78A'], 'prerequisites': [], 'tier': 1},
                    {'formId': '0x0001C789', 'children': ['0x0001C78C'], 'prerequisites': ['0x00012FCD'], 'tier': 2},
                    {'formId': '0x0001C78A', 'children': ['0x0001C78D'], 'prerequisites': ['0x00012FCD'], 'tier': 2},
                    {'formId': '0x0001C78C', 'children': [], 'prerequisites': ['0x0001C789'], 'tier': 3},
                    {'formId': '0x0001C78D', 'children': [], 'prerequisites': ['0x0001C78A'], 'tier': 3},
                ]
            }
        }
    }
    
    import json
    results = validate_tree(sample_tree)
    summary = get_validation_summary(results)
    print(json.dumps(summary, indent=2))
