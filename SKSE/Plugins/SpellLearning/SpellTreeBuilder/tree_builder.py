"""
Tree Builder Module for Spell Tree Builder

Constructs spell trees using the modular shape/energy systems.
Implements tree building rules:
- One root per school (prefer vanilla Novice spells)
- Max 3 children per node (configurable)
- Tier progression (Novice -> Master)
- Theme coherence within branches
- Convergence points for interesting prerequisites
- Shape profiles for visual variety
- Branching energy for growth control
"""

from typing import List, Dict, Any, Optional, Set, Tuple
from collections import defaultdict
import random

from theme_discovery import discover_themes_per_school, merge_with_hints
from spell_grouper import group_spells_best_fit, get_spell_primary_theme
from core.node import TreeNode, link_nodes
from config import TreeBuilderConfig, load_config

# Import modular systems
try:
    from shapes import get_shape, list_shapes, ShapeProfile
    HAS_SHAPES = True
except ImportError:
    HAS_SHAPES = False

# Default shape per school — matches JS SCHOOL_DEFAULT_SHAPES in shapeProfiles.js
SCHOOL_DEFAULT_SHAPES = {
    'Destruction': 'explosion',   # Dense core bursting outward with sub-explosions
    'Restoration': 'tree',        # Thick trunk with branches and dome canopy
    'Alteration': 'mountain',     # Wide base tapering to narrow peak
    'Conjuration': 'portals',     # Organic fill with doorway arch hole
    'Illusion': 'organic',        # Natural flowing spread
}



try:
    from growth import BranchingEnergy, BranchingEnergyConfig
    from growth import ThemedGroupManager, ThemedGroup
    HAS_GROWTH = True
except ImportError:
    HAS_GROWTH = False


# Tier ordering for progression
TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']

# Vanilla root spell FormIDs (preferred starting points)
VANILLA_ROOTS = {
    'Destruction': '0x00012FCD',
    'Restoration': '0x00012FCC',
    'Alteration': '0x0005AD5C',
    'Conjuration': '0x000640B6',
    'Illusion': '0x00021143',
}

VANILLA_ROOT_ALTERNATIVES = {
    'Alteration': ['0x00043324'],
    'Illusion': ['0x0004DEE8'],
}


class SpellTreeBuilder:
    """Builds spell trees using modular shape/energy systems."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize tree builder with configuration.
        
        Args:
            config: Configuration dictionary or None for defaults
        """
        self.cfg = load_config(config) if config else TreeBuilderConfig()
        
        # Set random seed if provided
        if self.cfg.seed is not None:
            random.seed(self.cfg.seed)
        
        # Initialize shape profile
        self.shape: Optional[ShapeProfile] = None
        if HAS_SHAPES:
            try:
                # get_shape returns an instance, not a class
                self.shape = get_shape(self.cfg.shape, self.cfg.get_shape_config())
            except Exception as e:
                print(f"[TreeBuilder] Shape init failed: {e}, using default logic")
        
        # Initialize branching energy
        self.branching: Optional[BranchingEnergy] = None
        if HAS_GROWTH:
            try:
                energy_cfg = BranchingEnergyConfig.from_dict(self.cfg.get_branching_energy_config())
                self.branching = BranchingEnergy(energy_cfg)
            except Exception as e:
                print(f"[TreeBuilder] Branching energy init failed: {e}")
        
        # Themed groups (set externally if using LLM)
        self.group_manager: Optional[ThemedGroupManager] = None
    
    def set_themed_groups(self, manager: 'ThemedGroupManager') -> None:
        """Set themed group manager for LLM-powered growth rules."""
        self.group_manager = manager

    def _get_tree_gen_setting(self, key: str, default: Any = None) -> Any:
        """Get a tree_generation setting from config."""
        tg = getattr(self.cfg, 'tree_generation', {})
        return tg.get(key, default)

    def _score_parent(self, node: TreeNode, candidate: TreeNode) -> float:
        """
        Score a potential parent using tree_generation settings.
        Higher score = better parent match.
        Uses dynamically discovered themes from TF-IDF (not hardcoded elements).
        """
        tg = getattr(self.cfg, 'tree_generation', {})
        scoring = tg.get('scoring', {})
        score = 0.0

        # Theme matching using dynamically discovered themes
        node_theme = node.theme
        cand_theme = candidate.theme

        if node_theme and cand_theme and node_theme != '_unassigned' and cand_theme != '_unassigned':
            if node_theme == cand_theme:
                if scoring.get('element_matching', True):
                    score += 100
            else:
                # Penalize cross-theme if isolation is enabled
                if tg.get('element_isolation', True):
                    score -= 50
                    if tg.get('element_isolation_strict', False):
                        return -9999  # Reject entirely

        # Theme coherence (+70 same theme)
        if scoring.get('theme_coherence', True):
            if node.theme and candidate.theme and node.theme == candidate.theme:
                score += 70

        # Tier progression (+50 adjacent tier, -30 skip)
        if scoring.get('tier_progression', True):
            tier_diff = node.depth - candidate.depth
            if tier_diff == 1:
                score += 50  # Adjacent tier
            elif tier_diff == 2:
                score += 30  # Skip one
            elif tier_diff > 2:
                score -= 20  # Big skip penalty

        # Same-tier links
        if node.depth == candidate.depth:
            if not tg.get('allow_same_tier_links', True):
                return -9999  # Reject
            # Small bonus for same-tier if allowed
            score += 10

        # Prefer fewer children (capacity)
        max_children = tg.get('max_children_per_node', 3)
        children_ratio = len(candidate.children) / max_children
        score -= children_ratio * 30  # Penalize fuller parents

        return score
    
    def _reinit_for_school(self, school_config: Dict[str, Any]) -> None:
        """
        Reinitialize shape/branching for a specific school's config.
        This is called before building each school tree when per-school configs are used.
        """
        # Update config values
        if 'shape' in school_config:
            self.cfg.shape = school_config['shape']
        if 'density' in school_config:
            self.cfg.density = float(school_config['density'])
        if 'symmetry' in school_config:
            self.cfg.symmetry = float(school_config['symmetry'])
        if 'convergence_chance' in school_config:
            self.cfg.convergence_chance = float(school_config['convergence_chance'])
        
        # Update branching energy
        if 'min_straight' in school_config or 'max_straight' in school_config:
            self.cfg.branching_energy['min_straight'] = int(school_config.get('min_straight', 2))
            self.cfg.branching_energy['max_straight'] = int(school_config.get('max_straight', 5))
            if 'energy_randomness' in school_config:
                self.cfg.branching_energy['randomness'] = float(school_config['energy_randomness'])
        
        # Reinitialize shape profile with new config
        if HAS_SHAPES:
            try:
                # get_shape returns an instance, not a class
                self.shape = get_shape(self.cfg.shape, self.cfg.get_shape_config())
                print(f"[TreeBuilder] Shape profile reinitialized: {self.cfg.shape}")
            except Exception as e:
                print(f"[TreeBuilder] Shape reinit failed: {e}")
        
        # Reinitialize branching energy with new config
        if HAS_GROWTH:
            try:
                energy_cfg = BranchingEnergyConfig.from_dict(self.cfg.get_branching_energy_config())
                self.branching = BranchingEnergy(energy_cfg)
                print(f"[TreeBuilder] Branching energy reinitialized: {self.cfg.branching_energy.get('min_straight')}-{self.cfg.branching_energy.get('max_straight')}")
            except Exception as e:
                print(f"[TreeBuilder] Branching reinit failed: {e}")
    
    def build_trees(self, spells: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Build complete spell trees for all schools.
        
        Args:
            spells: List of all spell dictionaries
            
        Returns:
            Tree structure in expected JSON format
        """
        # Group spells by school
        schools: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for spell in spells:
            school = spell.get('school', 'Unknown')
            if not school or school in ('null', 'undefined', 'None', ''):
                school = 'Hedge Wizard'
            schools[school].append(spell)
        
        # Discover themes for all schools
        all_themes = discover_themes_per_school(spells, top_n=self.cfg.top_themes_per_school)
        all_themes = merge_with_hints(all_themes, max_themes=self.cfg.top_themes_per_school + 4)
        
        # Get per-school configs (from JS LLM calls)
        school_configs = self.cfg.get_raw('school_configs', {})
        if school_configs:
            print(f"[TreeBuilder] Using per-school configs from JS: {list(school_configs.keys())}")
        
        # Build tree for each school
        output = {'version': '1.0', 'schools': {}}
        
        for school_name, school_spells in schools.items():
            if not school_spells:
                continue
            
            # Apply per-school config if available
            if school_name in school_configs:
                sc = school_configs[school_name]
                source = sc.get('source', 'config')
                
                print(f"\n[TreeBuilder] === {school_name} ({len(school_spells)} spells) ===")
                print(f"[TreeBuilder] Config source: {source}")
                print(f"[TreeBuilder] Shape: {sc.get('shape', 'organic')}, Density: {sc.get('density', 0.6)}, Symmetry: {sc.get('symmetry', 0.3)}")
                print(f"[TreeBuilder] Branching: {sc.get('min_straight', 2)}-{sc.get('max_straight', 5)}")
                print(f"[TreeBuilder] Convergence: {sc.get('convergence_chance', 0.4)}")
                
                # Reinitialize all components with school-specific config
                self._reinit_for_school(sc)
                
                themes = all_themes.get(school_name, [])
                school_tree = self._build_school_tree(school_name, school_spells, themes)
                
                # Store the config used in the output
                if school_tree:
                    school_tree['config_used'] = {
                        'shape': self.cfg.shape,
                        'density': self.cfg.density,
                        'symmetry': self.cfg.symmetry,
                        'source': source
                    }
            else:
                # Apply per-school default shape (no LLM config)
                default_shape = SCHOOL_DEFAULT_SHAPES.get(school_name, 'organic')
                self._reinit_for_school({'shape': default_shape})
                print(f"\n[TreeBuilder] === {school_name} ({len(school_spells)} spells) - DEFAULT CONFIG (shape={default_shape}) ===")
                themes = all_themes.get(school_name, [])
                school_tree = self._build_school_tree(school_name, school_spells, themes)
            
            if school_tree:
                output['schools'][school_name] = school_tree
        
        return output
    
    def _build_school_tree(
        self,
        school_name: str,
        spells: List[Dict[str, Any]],
        themes: List[str]
    ) -> Optional[Dict[str, Any]]:
        """Build tree for a single school."""
        if not spells:
            return None
        
        print(f"[TreeBuilder] Building {school_name}: {len(spells)} spells, shape={self.cfg.shape}")
        
        # Reset branching energy tracking
        if self.branching:
            self.branching.reset()
        
        # Create nodes for all spells
        nodes: Dict[str, TreeNode] = {}
        for spell in spells:
            node = TreeNode.from_spell(spell)
            if themes:
                # Check LLM keyword classification first
                llm_kw = spell.get('llm_keyword')
                if llm_kw and llm_kw in themes:
                    node.theme = llm_kw
                elif llm_kw and spell.get('llm_keyword_parent') in themes:
                    node.theme = spell.get('llm_keyword_parent')
                else:
                    # Fallback to fuzzy matching
                    theme, score = get_spell_primary_theme(spell, themes)
                    node.theme = theme if score > 30 else '_unassigned'
            nodes[node.form_id] = node
        
        # Find root spell
        root_id = self._select_root(school_name, spells)
        if not root_id or root_id not in nodes:
            root_id = self._find_lowest_tier_spell(spells)
        
        if not root_id or root_id not in nodes:
            print(f"[TreeBuilder] WARNING: No valid root for {school_name}")
            return None
        
        root = nodes[root_id]
        root.depth = 0
        root.is_root = True
        
        # Initialize branching energy for root
        if self.branching:
            self.branching.start_path(root_id)
        
        # Group spells by theme
        grouped = group_spells_best_fit(spells, themes) if themes else {'_all': spells}
        
        # Build tree structure
        self._connect_nodes(root, nodes, grouped, themes)
        
        # Handle orphans
        self._connect_orphans(root, nodes)
        
        # POST-PROCESS: Ensure high-tier spells have proper convergence
        self._enforce_high_tier_convergence(nodes, root_id, school_name)
        
        # Final validation pass - ensure all nodes are reachable
        self._ensure_all_reachable(nodes, root_id, school_name)
        
        # Return output format
        layout_style = self.cfg.shape if self.cfg.shape != 'organic' else 'radial'
        return {
            'root': root_id,
            'layoutStyle': layout_style,
            'nodes': [node.to_dict() for node in nodes.values()]
        }
    
    def _select_root(self, school: str, spells: List[Dict[str, Any]]) -> Optional[str]:
        """Select the root spell for a school."""
        spell_ids = {s['formId'] for s in spells}
        
        if self.cfg.prefer_vanilla_roots:
            if school in VANILLA_ROOTS and VANILLA_ROOTS[school] in spell_ids:
                return VANILLA_ROOTS[school]
            if school in VANILLA_ROOT_ALTERNATIVES:
                for alt in VANILLA_ROOT_ALTERNATIVES[school]:
                    if alt in spell_ids:
                        return alt
        
        # Find vanilla Novice spell
        for spell in spells:
            if spell['formId'].startswith('0x00') and spell.get('skillLevel') == 'Novice':
                return spell['formId']
        
        return self._find_lowest_tier_spell(spells)
    
    def _find_lowest_tier_spell(self, spells: List[Dict[str, Any]]) -> Optional[str]:
        """Find the lowest tier spell."""
        for tier in TIER_ORDER:
            for spell in spells:
                if spell.get('skillLevel') == tier:
                    return spell['formId']
        return spells[0]['formId'] if spells else None
    
    def _connect_nodes(
        self,
        root: TreeNode,
        nodes: Dict[str, TreeNode],
        grouped: Dict[str, List[Dict[str, Any]]],
        themes: List[str]
    ):
        """Connect nodes into a tree structure using modular systems."""
        connected: Set[str] = {root.form_id}
        available: Dict[int, List[TreeNode]] = defaultdict(list)
        available[0].append(root)
        
        # Sort themes by size
        sorted_themes = sorted(grouped.keys(), key=lambda t: len(grouped.get(t, [])), reverse=True)
        
        for theme in sorted_themes:
            if theme == '_unassigned':
                continue
            
            theme_spells = grouped.get(theme, [])
            if not theme_spells:
                continue
            
            tier_sorted = self._sort_by_tier(theme_spells)
            theme_parent: Optional[TreeNode] = None
            
            for spell in tier_sorted:
                form_id = spell['formId']
                if form_id in connected:
                    theme_parent = nodes[form_id]
                    continue
                
                node = nodes[form_id]
                tier_depth = self._tier_to_depth(node.tier)
                
                # Check for themed group custom rules
                custom_branching = None
                if self.group_manager:
                    custom_branching = self.group_manager.get_branching_config_for_spell(form_id)
                
                # Find parent using shape profile or default logic
                parent = self._find_parent(node, theme_parent, available, tier_depth, themes)
                
                if parent:
                    # Determine if this should be a branch or straight
                    is_branch = self._should_branch(parent, node, custom_branching)
                    
                    # Link nodes
                    link_nodes(parent, node)
                    connected.add(form_id)
                    
                    # Record connection for branching energy
                    if self.branching:
                        self.branching.record_connection(parent.form_id, form_id, is_branch)
                    
                    # Update available parents
                    if len(node.children) < self.cfg.max_children_per_node:
                        available[node.depth].append(node)
                    
                    theme_parent = node
                    
                    # Maybe add convergence (with reachability check)
                    if tier_depth >= self.cfg.convergence_at_tier:
                        self._maybe_add_convergence(node, available, connected, nodes, root.form_id)
        
        # Process unassigned spells
        self._process_unassigned(grouped.get('_unassigned', []), nodes, connected, available, themes)
    
    def _should_branch(
        self,
        parent: TreeNode,
        child: TreeNode,
        custom_branching: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Determine if this connection should be a branch."""
        has_existing_children = len(parent.children) > 0
        
        if not self.branching:
            return has_existing_children
        
        # Use custom branching config if provided
        if custom_branching:
            temp_branching = BranchingEnergy(BranchingEnergyConfig.from_dict(custom_branching))
            temp_branching._straight_counts = self.branching._straight_counts.copy()
            temp_branching._energy = self.branching._energy.copy()
            return temp_branching.should_branch(parent.form_id, 0.5)
        
        return self.branching.should_branch(parent.form_id, 0.5) or has_existing_children
    
    def _find_parent(
        self,
        node: TreeNode,
        preferred: Optional[TreeNode],
        available: Dict[int, List[TreeNode]],
        target_depth: int,
        themes: List[str]
    ) -> Optional[TreeNode]:
        """Find the best parent for a node using tree_generation scoring."""
        tg = getattr(self.cfg, 'tree_generation', {})
        max_children = tg.get('max_children_per_node', self.cfg.max_children_per_node)
        strict_tier = tg.get('strict_tier_ordering', True)
        allow_same_tier = tg.get('allow_same_tier_links', True)

        # Collect all valid candidates
        all_candidates = []

        # Determine valid depth range based on tier ordering settings
        if strict_tier:
            # Only parents at lower depths (earlier tiers)
            depth_range = range(0, target_depth)
            if allow_same_tier:
                depth_range = range(0, target_depth + 1)
        else:
            # Allow any depth within 2 levels
            depth_range = range(max(0, target_depth - 2), target_depth + 2)

        for d in depth_range:
            for p in available.get(d, []):
                if len(p.children) < max_children:
                    all_candidates.append(p)

        if not all_candidates:
            # Fallback: find ANY parent with capacity
            for depth in sorted(available.keys()):
                if depth >= target_depth:
                    continue
                candidates = [p for p in available[depth] if len(p.children) < max_children]
                if candidates:
                    all_candidates = candidates
                    break

        if not all_candidates:
            return None

        # Use shape profile scoring if available
        if self.shape:
            return self.shape.select_parent(node, all_candidates, {'themes': themes})

        # Score all candidates using tree_generation settings
        scored = []
        for candidate in all_candidates:
            score = self._score_parent(node, candidate)
            if score > -1000:  # Filter out rejected candidates
                scored.append((score, candidate))

        if not scored:
            # All candidates rejected by strict rules, fall back to best available
            scored = [(0, c) for c in all_candidates]

        # Return highest scoring parent
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1] if scored else None
    
    def _process_unassigned(
        self,
        unassigned: List[Dict[str, Any]],
        nodes: Dict[str, TreeNode],
        connected: Set[str],
        available: Dict[int, List[TreeNode]],
        themes: List[str]
    ):
        """Process unassigned spells."""
        for spell in self._sort_by_tier(unassigned):
            form_id = spell['formId']
            if form_id in connected:
                continue
            
            node = nodes[form_id]
            tier_depth = self._tier_to_depth(node.tier)
            parent = self._find_parent(node, None, available, tier_depth, themes)
            
            if parent:
                link_nodes(parent, node)
                connected.add(form_id)
                if len(node.children) < self.cfg.max_children_per_node:
                    available[node.depth].append(node)
    
    def _maybe_add_convergence(
        self,
        node: TreeNode,
        available: Dict[int, List[TreeNode]],
        connected: Set[str],
        nodes: Dict[str, TreeNode],
        root_id: str
    ):
        """
        Maybe add additional prerequisite for convergence.
        Higher tier spells have HIGHER convergence chance and can have MORE prerequisites.
        
        Tier-based convergence:
        - Novice (0): base chance, max 1 prereq
        - Apprentice (1): base chance, max 2 prereqs
        - Adept (2): 1.5x chance, max 2 prereqs
        - Expert (3): 2x chance, max 3 prereqs (FORCED if <2 prereqs)
        - Master (4): ALWAYS converge, max 4 prereqs (FORCED multiple prereqs)
        """
        tier_depth = self._tier_to_depth(node.tier)
        
        # Tier-based scaling
        tier_multipliers = {
            0: 0.5,   # Novice: half chance
            1: 1.0,   # Apprentice: base chance
            2: 1.5,   # Adept: 1.5x chance
            3: 2.0,   # Expert: 2x chance
            4: 10.0,  # Master: essentially guaranteed
        }
        tier_max_prereqs = {
            0: 1,     # Novice: max 1 prereq
            1: 2,     # Apprentice: max 2
            2: 2,     # Adept: max 2
            3: 3,     # Expert: max 3
            4: 4,     # Master: max 4 prereqs
        }
        
        multiplier = tier_multipliers.get(tier_depth, 1.0)
        max_prereqs = tier_max_prereqs.get(tier_depth, 2)
        effective_chance = min(1.0, self.cfg.convergence_chance * multiplier)
        
        # FORCE convergence for Expert/Master with insufficient prereqs
        force_convergence = (tier_depth >= 3 and len(node.prerequisites) < 2) or \
                           (tier_depth >= 4 and len(node.prerequisites) < 3)
        
        if not force_convergence and random.random() > effective_chance:
            return
        if len(node.prerequisites) >= max_prereqs:
            return
        
        # Build reachability set from root (forward traversal via children)
        reachable = self._get_reachable_from_root(nodes, root_id)
        
        # How many prereqs to add
        prereqs_to_add = 1
        if tier_depth >= 4:  # Master
            prereqs_to_add = max(1, 3 - len(node.prerequisites))
        elif tier_depth >= 3:  # Expert
            prereqs_to_add = max(1, 2 - len(node.prerequisites))
        
        added = 0
        for _ in range(prereqs_to_add):
            if len(node.prerequisites) >= max_prereqs:
                break
                
            for depth in range(node.depth - 1, -1, -1):
                candidates = available.get(depth, [])
                # Only consider candidates that are:
                # 1. Different theme (for interesting convergence)
                # 2. Not already a prerequisite
                # 3. Actually reachable from root (verified!)
                # 4. Don't create a cycle (candidate is not a descendant of node)
                different = [p for p in candidates
                            if p.theme != node.theme
                            and p.form_id not in node.prerequisites
                            and p.form_id in reachable
                            and not self._is_descendant(p.form_id, node.form_id, nodes)]
                if different:
                    extra = random.choice(different)
                    node.add_prerequisite(extra.form_id)
                    extra.add_child(node.form_id)
                    added += 1
                    break
        
        if added > 0 and tier_depth >= 3:
            print(f"[TreeBuilder] Convergence: {node.name} ({node.tier}) now has {len(node.prerequisites)} prereqs")
    
    def _get_reachable_from_root(self, nodes: Dict[str, TreeNode], root_id: str) -> Set[str]:
        """Get all nodes reachable from root via children links (forward traversal)."""
        reachable = set()
        queue = [root_id]
        while queue:
            fid = queue.pop(0)
            if fid in reachable:
                continue
            reachable.add(fid)
            if fid in nodes:
                queue.extend(nodes[fid].children)
        return reachable
    
    def _is_descendant(self, potential_ancestor: str, node_id: str, nodes: Dict[str, TreeNode]) -> bool:
        """Check if node_id is a descendant of potential_ancestor (would create cycle)."""
        visited = set()
        queue = [node_id]
        while queue:
            fid = queue.pop(0)
            if fid in visited:
                continue
            visited.add(fid)
            if fid == potential_ancestor:
                return True
            if fid in nodes:
                queue.extend(nodes[fid].children)
        return False
    
    def _enforce_high_tier_convergence(
        self,
        nodes: Dict[str, TreeNode],
        root_id: str,
        school_name: str
    ):
        """
        Post-processing pass to ensure Expert/Master spells have proper convergence.
        Expert spells should have 2+ prerequisites.
        Master spells should have 3+ prerequisites (they're the "final bosses").
        """
        reachable = self._get_reachable_from_root(nodes, root_id)
        
        expert_fixed = 0
        master_fixed = 0
        
        for fid, node in nodes.items():
            if fid == root_id:
                continue
            
            tier_depth = self._tier_to_depth(node.tier)
            current_prereqs = len(node.prerequisites)
            
            # Determine minimum prerequisites based on tier
            if tier_depth >= 4:  # Master
                min_prereqs = 3
            elif tier_depth >= 3:  # Expert  
                min_prereqs = 2
            else:
                continue  # Lower tiers don't need enforcement
            
            if current_prereqs >= min_prereqs:
                continue
            
            # Need to add more prerequisites
            prereqs_needed = min_prereqs - current_prereqs
            
            # Find candidates: reachable nodes at lower depth, different from existing prereqs
            candidates = []
            for cand_id, cand in nodes.items():
                if cand_id == fid:
                    continue
                if cand_id in node.prerequisites:
                    continue
                if cand_id not in reachable:
                    continue
                if cand.depth >= node.depth:
                    continue
                if self._is_descendant(cand_id, fid, nodes):
                    continue
                # Prefer different themes
                candidates.append((cand, cand.theme != node.theme))
            
            # Sort: different themes first, then by depth (prefer closer)
            candidates.sort(key=lambda x: (-x[1], -x[0].depth))
            
            added = 0
            for cand, _ in candidates:
                if added >= prereqs_needed:
                    break
                # Add convergence link
                node.add_prerequisite(cand.form_id)
                cand.add_child(fid)
                added += 1
            
            if added > 0:
                if tier_depth >= 4:
                    master_fixed += 1
                else:
                    expert_fixed += 1
        
        if expert_fixed > 0 or master_fixed > 0:
            print(f"[TreeBuilder] {school_name}: Convergence enforced - {expert_fixed} Expert, {master_fixed} Master spells")
    
    def _connect_orphans(self, root: TreeNode, nodes: Dict[str, TreeNode]):
        """Connect any disconnected nodes."""
        connected = set()
        queue = [root.form_id]
        while queue:
            fid = queue.pop(0)
            if fid in connected:
                continue
            connected.add(fid)
            if fid in nodes:
                queue.extend(nodes[fid].children)
        
        orphans = [nodes[fid] for fid in nodes if fid not in connected]
        if orphans:
            print(f"[TreeBuilder] Connecting {len(orphans)} orphans")
        
        for orphan_spell in self._sort_by_tier([o.spell_data for o in orphans if o.spell_data]):
            orphan = nodes[orphan_spell['formId']]
            tier_depth = self._tier_to_depth(orphan.tier)
            
            best = None
            for node in nodes.values():
                if node.form_id in connected and len(node.children) < self.cfg.max_children_per_node:
                    # ENFORCE tier progression: parent must be at LOWER depth
                    if node.depth < tier_depth:
                        if best is None or len(node.children) < len(best.children):
                            best = node
            
            # If no proper parent found, find ANY connected node at lower depth
            if not best:
                for d in range(tier_depth - 1, -1, -1):
                    for node in nodes.values():
                        if node.form_id in connected and node.depth == d:
                            if len(node.children) < self.cfg.max_children_per_node:
                                best = node
                                break
                    if best:
                        break
            
            # Last resort: only connect to root if this is a Novice/Apprentice spell
            if not best:
                if tier_depth <= 1:  # Only Novice (0) or Apprentice (1) can connect to root
                    best = root
                else:
                    # For high-tier orphans, pick any lower-tier connected node
                    print(f"[TreeBuilder] WARNING: High-tier orphan {orphan.name} ({orphan.tier}) - finding any parent")
                    for node in nodes.values():
                        if node.form_id in connected and node.depth < tier_depth:
                            best = node
                            break
                    if not best:
                        best = root  # Absolute last resort
                        print(f"[TreeBuilder] ERROR: {orphan.name} ({orphan.tier}) forced to root!")
            
            link_nodes(best, orphan)
            connected.add(orphan.form_id)
    
    def _ensure_all_reachable(self, nodes: Dict[str, TreeNode], root_id: str, school_name: str):
        """
        Final validation pass to ensure all nodes are reachable from root.
        Fixes any remaining unreachable nodes by replacing their blocking prereqs.
        """
        max_passes = 10
        
        for pass_num in range(max_passes):
            # Simulate unlocks to find unreachable nodes
            unlockable = self._simulate_unlocks(nodes, root_id)
            unreachable = [fid for fid in nodes if fid not in unlockable]
            
            if not unreachable:
                return  # All nodes reachable!
            
            print(f"[TreeBuilder] {school_name}: Pass {pass_num + 1} - {len(unreachable)} unreachable nodes")
            
            fixed_any = False
            for fid in unreachable:
                node = nodes[fid]
                prereqs = node.prerequisites
                
                # Find blocking prereqs (ones that are not unlockable)
                blocking = [p for p in prereqs if p not in unlockable]
                
                if blocking:
                    # Find a reachable parent to replace blocking prereqs
                    best_parent = None
                    for unlockable_id in unlockable:
                        if unlockable_id == fid:
                            continue
                        candidate = nodes[unlockable_id]
                        if len(candidate.children) < self.cfg.max_children_per_node:
                            # Prefer nodes at lower depth
                            if best_parent is None or candidate.depth < nodes[best_parent].depth:
                                best_parent = unlockable_id
                    
                    if best_parent:
                        # Remove from old blocking parents' children
                        for blocking_id in blocking:
                            if blocking_id in nodes:
                                blocking_node = nodes[blocking_id]
                                if fid in blocking_node.children:
                                    blocking_node.children.remove(fid)
                        
                        # Replace blocking prereqs with the reachable parent
                        node.prerequisites = [p for p in prereqs if p not in blocking]
                        if best_parent not in node.prerequisites:
                            node.prerequisites.append(best_parent)
                        
                        # Add to new parent's children
                        parent_node = nodes[best_parent]
                        if fid not in parent_node.children:
                            parent_node.children.append(fid)
                        
                        # Update depth
                        node.depth = parent_node.depth + 1
                        fixed_any = True
            
            if not fixed_any:
                # Aggressive fix: connect remaining to root
                print(f"[TreeBuilder] {school_name}: Aggressive fix for {len(unreachable)} remaining nodes")
                root_node = nodes[root_id]
                for fid in unreachable:
                    if fid == root_id:
                        continue
                    node = nodes[fid]
                    # Clear old prereqs from their children lists
                    for old_prereq in node.prerequisites:
                        if old_prereq in nodes:
                            old_node = nodes[old_prereq]
                            if fid in old_node.children:
                                old_node.children.remove(fid)
                    # Connect directly to root
                    node.prerequisites = [root_id]
                    if fid not in root_node.children:
                        root_node.children.append(fid)
                    node.depth = 1
                break
        
        # Final check
        final_unlockable = self._simulate_unlocks(nodes, root_id)
        final_unreachable = len(nodes) - len(final_unlockable)
        if final_unreachable > 0:
            print(f"[TreeBuilder] WARNING: {school_name} still has {final_unreachable} unreachable nodes!")
    
    def _simulate_unlocks(self, nodes: Dict[str, TreeNode], root_id: str) -> Set[str]:
        """Simulate unlock process to find all unlockable nodes."""
        unlocked = {root_id}
        changed = True
        iterations = 0
        max_iterations = len(nodes) + 10
        
        while changed and iterations < max_iterations:
            changed = False
            iterations += 1
            
            for fid, node in nodes.items():
                if fid in unlocked:
                    continue
                
                prereqs = node.prerequisites
                if not prereqs:
                    continue  # Orphan
                
                # All prereqs must be unlocked
                if all(p in unlocked for p in prereqs):
                    unlocked.add(fid)
                    changed = True
        
        return unlocked
    
    def _sort_by_tier(self, spells: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sort spells by tier (Novice first)."""
        def key(s):
            try:
                return TIER_ORDER.index(s.get('skillLevel', 'Unknown'))
            except ValueError:
                return len(TIER_ORDER)
        return sorted(spells, key=key)
    
    def _tier_to_depth(self, tier: str) -> int:
        """Convert skill tier to expected tree depth."""
        try:
            return TIER_ORDER.index(tier)
        except ValueError:
            return 0


def build_spell_trees(
    spells: List[Dict[str, Any]],
    config: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Convenience function to build spell trees.
    
    Args:
        spells: List of spell dictionaries
        config: Optional configuration dictionary
        
    Returns:
        Tree structure in JSON format
    """
    builder = SpellTreeBuilder(config)
    return builder.build_trees(spells)


if __name__ == '__main__':
    import json
    sample = [
        {'formId': '0x00012FCD', 'name': 'Flames', 'school': 'Destruction', 'skillLevel': 'Novice'},
        {'formId': '0x00012FCE', 'name': 'Frostbite', 'school': 'Destruction', 'skillLevel': 'Novice'},
        {'formId': '0x00012FCF', 'name': 'Sparks', 'school': 'Destruction', 'skillLevel': 'Novice'},
        {'formId': '0x0001C789', 'name': 'Firebolt', 'school': 'Destruction', 'skillLevel': 'Apprentice'},
        {'formId': '0x0001C78A', 'name': 'Ice Spike', 'school': 'Destruction', 'skillLevel': 'Apprentice'},
        {'formId': '0x0001C78B', 'name': 'Lightning Bolt', 'school': 'Destruction', 'skillLevel': 'Apprentice'},
    ]
    print(json.dumps(build_spell_trees(sample), indent=2))
