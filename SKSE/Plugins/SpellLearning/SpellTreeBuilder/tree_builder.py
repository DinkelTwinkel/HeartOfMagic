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
import sys

from theme_discovery import discover_themes_per_school, merge_with_hints
from spell_grouper import group_spells_best_fit, get_spell_primary_theme
from core.node import TreeNode, link_nodes
from config import TreeBuilderConfig, load_config
from prereq_master_scorer import tokenize, build_text, compute_tfidf
from prereq_master_scorer import cosine_similarity as _cosine_sim
from prereq_master_scorer import char_ngram_similarity

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

    def _compute_similarity_matrix(self, spells: List[Dict[str, Any]]) -> Dict[str, float]:
        """
        Compute pairwise TF-IDF cosine similarity between spells.
        Uses pure Python TF-IDF from prereq_master_scorer (no sklearn needed).

        Returns dict mapping 'formIdA:formIdB' -> similarity score.
        Both directions stored for fast lookup.
        """
        if len(spells) < 2:
            return {}

        form_ids = []
        all_docs = []
        for spell in spells:
            fid = spell.get('formId', '')
            form_ids.append(fid)
            # Normalize effects: may be strings or dicts with 'name' key
            raw_effects = spell.get('effectNames', []) or spell.get('effects', [])
            effects = []
            for e in (raw_effects or []):
                if isinstance(e, str):
                    effects.append(e)
                elif isinstance(e, dict):
                    effects.append(e.get('name', ''))
            text = build_text({
                'name': spell.get('name', ''),
                'desc': spell.get('description', '') or spell.get('desc', ''),
                'effects': effects
            })
            all_docs.append(tokenize(text))

        vectors = compute_tfidf(all_docs)

        similarities: Dict[str, float] = {}
        name_weight = getattr(self.cfg, 'name_similarity_weight', 0.3)
        for i in range(len(form_ids)):
            for j in range(i + 1, len(form_ids)):
                score = _cosine_sim(vectors[i], vectors[j])
                # Blend with character n-gram similarity on spell names
                name_sim = char_ngram_similarity(
                    spells[i].get('name', ''),
                    spells[j].get('name', '')
                )
                combined = score * (1.0 - name_weight) + name_sim * name_weight
                if combined > self.cfg.similarity_threshold:
                    similarities[f"{form_ids[i]}:{form_ids[j]}"] = combined
                    similarities[f"{form_ids[j]}:{form_ids[i]}"] = combined

        print(f"[TreeBuilder] NLP similarity: {len(similarities) // 2} pairs above threshold from {len(spells)} spells")
        return similarities

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

        # Description similarity via TF-IDF cosine similarity
        if scoring.get('description_similarity', True) and hasattr(self, '_similarities') and self._similarities:
            key = f"{node.form_id}:{candidate.form_id}"
            sim = self._similarities.get(key, 0.0)
            score += sim * 60  # Up to +60 for perfect similarity

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
        # Group spells by school (only the 5 vanilla magic schools)
        VALID_SCHOOLS = {'Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration'}
        schools: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for spell in spells:
            school = spell.get('school', '')
            if school not in VALID_SCHOOLS:
                continue
            schools[school].append(spell)
        
        # Discover themes for all schools
        _fallback = self.cfg.get_raw('fallback', False)
        all_themes = discover_themes_per_school(spells, top_n=self.cfg.top_themes_per_school, fallback=_fallback)
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

        # Compute NLP similarity matrix for description-based scoring
        tg = getattr(self.cfg, 'tree_generation', {})
        scoring = tg.get('scoring', {})
        if scoring.get('description_similarity', True):
            self._similarities = self._compute_similarity_matrix(spells)
        else:
            self._similarities = {}

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
        
        # Assign sections for Tree Growth mode layout (root/trunk/branch)
        self._assign_sections(nodes, root_id)

        # Return output format
        layout_style = self.cfg.shape if self.cfg.shape != 'organic' else 'radial'
        return {
            'root': root_id,
            'layoutStyle': layout_style,
            'nodes': [node.to_dict() for node in nodes.values()]
        }
    
    def _select_root(self, school: str, spells: List[Dict[str, Any]]) -> Optional[str]:
        """Select the root spell for a school. User override takes priority."""
        spell_ids = {s['formId'] for s in spells}

        # Check user-selected root override
        selected_roots = self.cfg.get_raw('selected_roots', {})
        if school in selected_roots:
            override = selected_roots[school]
            override_id = override.get('formId', '') if isinstance(override, dict) else ''
            if override_id and override_id in spell_ids:
                sys.stderr.write("[TreeBuilder] Using user-selected root for %s: %s\n" % (school, override.get('name', override_id)))
                return override_id
            elif override_id:
                sys.stderr.write("[TreeBuilder] User-selected root %s for %s not in spell pool, auto-picking\n" % (override_id, school))

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

    def _assign_sections(self, nodes: Dict[str, 'TreeNode'], root_id: str) -> None:
        """Assign section labels (root/trunk/branch) based on tree depth.

        Uses config pctRoot/pctTrunk to determine depth-based cutoffs.
        Root section: root node and shallow nodes
        Trunk section: mid-depth nodes (bulk of the tree)
        Branch section: deepest nodes (tips of the tree)
        """
        max_depth = max((n.depth for n in nodes.values()), default=0) if nodes else 0
        if max_depth == 0:
            for n in nodes.values():
                n.section = 'root'
            return

        pct_root = self.cfg.get_raw('pctRoot', 20) / 100.0
        pct_trunk = self.cfg.get_raw('pctTrunk', 50) / 100.0

        root_cutoff = max(0, int(max_depth * pct_root))
        trunk_cutoff = max(root_cutoff + 1, int(max_depth * (pct_root + pct_trunk)))

        for node in nodes.values():
            if node.form_id == root_id or node.depth <= root_cutoff:
                node.section = 'root'
            elif node.depth <= trunk_cutoff:
                node.section = 'trunk'
            else:
                node.section = 'branch'

        # Count for logging
        counts = {'root': 0, 'trunk': 0, 'branch': 0}
        for n in nodes.values():
            counts[n.section] = counts.get(n.section, 0) + 1
        print(f"[TreeBuilder] Sections: root={counts['root']}, trunk={counts['trunk']}, branch={counts['branch']}")
    
    def _connect_nodes(
        self,
        root: TreeNode,
        nodes: Dict[str, TreeNode],
        grouped: Dict[str, List[Dict[str, Any]]],
        themes: List[str]
    ):
        """
        Connect nodes into a tree structure using tier-interleaved theme processing.

        Instead of processing all of theme A then all of theme B (which causes the
        largest theme to dominate shallow positions), we interleave: process one spell
        per theme per tier round-robin. This ensures each theme gets fair access to
        root's branches and shallow positions.
        """
        connected: Set[str] = {root.form_id}
        available: Dict[int, List[TreeNode]] = defaultdict(list)
        available[0].append(root)

        # Sort themes by size (largest first for priority within each tier)
        sorted_themes = [t for t in sorted(grouped.keys(),
                         key=lambda t: len(grouped.get(t, [])), reverse=True)
                         if t != '_unassigned' and grouped.get(t)]

        # Build per-theme spell queues sorted by tier
        theme_queues: Dict[str, List[Dict[str, Any]]] = {}
        for theme in sorted_themes:
            theme_queues[theme] = self._sort_by_tier(grouped[theme])

        # Track per-theme preferred parent (for theme coherence within branches)
        theme_parents: Dict[str, Optional[TreeNode]] = {t: None for t in sorted_themes}

        # Round-robin: process one spell per theme, cycling through tiers
        # This ensures each theme gets a child of root before any theme fills it
        max_rounds = max(len(q) for q in theme_queues.values()) if theme_queues else 0
        theme_indices: Dict[str, int] = {t: 0 for t in sorted_themes}

        for round_num in range(max_rounds):
            for theme in sorted_themes:
                idx = theme_indices[theme]
                queue = theme_queues[theme]
                if idx >= len(queue):
                    continue

                spell = queue[idx]
                form_id = spell['formId']
                theme_indices[theme] = idx + 1

                if form_id in connected:
                    # Already connected (e.g., root) — update theme parent
                    theme_parents[theme] = nodes[form_id]
                    continue

                node = nodes[form_id]
                tier_depth = self._tier_to_depth(node.tier)

                # Check for themed group custom rules
                custom_branching = None
                if self.group_manager:
                    custom_branching = self.group_manager.get_branching_config_for_spell(form_id)

                # Find parent: prefer theme's own parent for coherence
                parent = self._find_parent(node, theme_parents[theme], available, tier_depth, themes)

                if parent:
                    is_branch = self._should_branch(parent, node, custom_branching)
                    link_nodes(parent, node)
                    connected.add(form_id)

                    if self.branching:
                        self.branching.record_connection(parent.form_id, form_id, is_branch)

                    if len(node.children) < self.cfg.max_children_per_node:
                        available[node.depth].append(node)

                    theme_parents[theme] = node

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
            # Fallback: find ANY parent with capacity at lower depth
            for depth in sorted(available.keys()):
                if depth >= target_depth:
                    continue
                candidates = [p for p in available[depth] if len(p.children) < max_children]
                if candidates:
                    all_candidates = candidates
                    break

        if not all_candidates:
            # Last resort: find the least-loaded node at any depth below target
            least_loaded = None
            for depth in sorted(available.keys()):
                if depth >= target_depth:
                    continue
                for p in available[depth]:
                    if least_loaded is None or len(p.children) < len(least_loaded.children):
                        least_loaded = p
            if least_loaded:
                all_candidates = [least_loaded]

        if not all_candidates:
            return None

        # Use shape profile scoring if available
        if self.shape:
            ctx = {'themes': themes}
            if hasattr(self, '_similarities') and self._similarities:
                ctx['similarities'] = self._similarities
            return self.shape.select_parent(node, all_candidates, ctx)

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
        """Process unassigned spells, prioritized by best theme score (descending)."""
        # Score unassigned spells by their closest theme match
        scored_unassigned = []
        for spell in unassigned:
            best_theme, best_score = get_spell_primary_theme(spell, themes) if themes else ('_unassigned', 0)
            scored_unassigned.append((best_score, spell, best_theme))
        scored_unassigned.sort(key=lambda x: x[0], reverse=True)

        for score, spell, near_theme in scored_unassigned:
            form_id = spell['formId']
            if form_id in connected:
                continue

            node = nodes.get(form_id)
            if not node:
                continue

            # Near-misses get temporary theme for scoring benefit
            if score > 20 and near_theme != '_unassigned':
                node.theme = near_theme

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
                # 1. Different theme (for interesting convergence) — unless cross-theme disabled
                # 2. Not already a prerequisite
                # 3. Actually reachable from root (verified!)
                # 4. Don't create a cycle (candidate is not a descendant of node)
                tg = getattr(self.cfg, 'tree_generation', {})
                convergence_cross_theme = tg.get('convergence_cross_theme', True)
                if convergence_cross_theme:
                    # Cross-theme convergence: ignore element_isolation for convergence candidates
                    different = [p for p in candidates
                                if p.theme != node.theme
                                and p.form_id not in node.prerequisites
                                and p.form_id in reachable
                                and not self._is_descendant(p.form_id, node.form_id, nodes)]
                else:
                    # Respect isolation: only same-theme or unassigned candidates
                    if tg.get('element_isolation_strict', False):
                        different = [p for p in candidates
                                    if p.theme == node.theme
                                    and p.form_id not in node.prerequisites
                                    and p.form_id in reachable
                                    and not self._is_descendant(p.form_id, node.form_id, nodes)]
                    else:
                        different = [p for p in candidates
                                    if p.form_id not in node.prerequisites
                                    and p.form_id in reachable
                                    and not self._is_descendant(p.form_id, node.form_id, nodes)]
                    if not different:
                        print(f"[TreeBuilder] WARNING: No convergence candidates for {node.name} (cross-theme disabled, isolation active)")
                if different:
                    # Scored selection: prefer candidates with higher similarity and closer depth
                    scored_cands = []
                    for cand in different:
                        conv_score = 0.0
                        key = f"{node.form_id}:{cand.form_id}"
                        sim = self._similarities.get(key, 0.0) if hasattr(self, '_similarities') else 0.0
                        conv_score += sim * 40.0
                        depth_diff = abs(node.depth - cand.depth)
                        conv_score += max(0, 20 - depth_diff * 10)
                        scored_cands.append((conv_score, cand))
                    scored_cands.sort(key=lambda x: x[0], reverse=True)
                    extra = scored_cands[0][1]
                    # Only add as prerequisite, NOT as child — convergence prereqs
                    # don't define the tree structure (children), just unlock gates
                    node.add_prerequisite(extra.form_id)
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
        # Quick depth check: if potential_ancestor is at same or lower depth than node,
        # it can't be a descendant of node (trees only grow downward)
        pa_node = nodes.get(potential_ancestor)
        nd_node = nodes.get(node_id)
        if pa_node and nd_node and pa_node.depth <= nd_node.depth:
            return False
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
        Convergence links are prerequisite-only (don't add to children to avoid fan-out bloat).
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
            tg = getattr(self.cfg, 'tree_generation', {})
            convergence_cross_theme = tg.get('convergence_cross_theme', True)
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
                # If cross-theme disabled, respect isolation rules
                if not convergence_cross_theme:
                    if tg.get('element_isolation_strict', False) and cand.theme != node.theme:
                        continue
                # Score candidate: similarity + depth proximity + theme difference
                conv_score = 0.0
                key = f"{fid}:{cand_id}"
                sim = self._similarities.get(key, 0.0) if hasattr(self, '_similarities') else 0.0
                conv_score += sim * 40.0
                depth_diff = abs(node.depth - cand.depth)
                conv_score += max(0, 20 - depth_diff * 10)
                if cand.theme != node.theme:
                    conv_score += 10.0  # Prefer different themes
                candidates.append((cand, conv_score))

            if not candidates and not convergence_cross_theme:
                print(f"[TreeBuilder] WARNING: No convergence candidates for {node.name} (cross-theme disabled, isolation active)")

            # Sort by convergence score (highest first)
            candidates.sort(key=lambda x: x[1], reverse=True)

            added = 0
            for cand, _ in candidates:
                if added >= prereqs_needed:
                    break
                # Add convergence prerequisite only — NOT to children list
                # This creates a "must unlock X before Y" constraint without
                # inflating the parent's fan-out (children count).
                node.add_prerequisite(cand.form_id)
                added += 1

            if added > 0:
                if tier_depth >= 4:
                    master_fixed += 1
                else:
                    expert_fixed += 1

        if expert_fixed > 0 or master_fixed > 0:
            print(f"[TreeBuilder] {school_name}: Convergence enforced - {expert_fixed} Expert, {master_fixed} Master spells")
    
    def _connect_orphans(self, root: TreeNode, nodes: Dict[str, TreeNode]):
        """Connect any disconnected nodes, respecting max_children."""
        max_children = self.cfg.max_children_per_node
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

            # Score all connected candidates with capacity
            best = None
            best_score = -9999
            for node in nodes.values():
                if node.form_id not in connected:
                    continue
                if len(node.children) >= max_children:
                    continue
                score = 0
                # Prefer parent at lower depth (tier progression)
                if node.depth < tier_depth:
                    score += 50
                    if node.depth == tier_depth - 1:
                        score += 30  # Adjacent tier bonus
                elif node.depth == tier_depth:
                    score += 10  # Same tier OK
                else:
                    score -= 50  # Higher depth = bad
                # Theme matching
                if node.theme and orphan.theme and node.theme == orphan.theme:
                    score += 40
                # Prefer nodes with fewer children (spread load)
                score -= len(node.children) * 15
                if score > best_score:
                    best_score = score
                    best = node

            if best:
                link_nodes(best, orphan)
                connected.add(orphan.form_id)
            else:
                # All nodes at capacity — increase capacity of least-loaded node
                least_loaded = None
                for node in nodes.values():
                    if node.form_id in connected and node.depth < tier_depth:
                        if least_loaded is None or len(node.children) < len(least_loaded.children):
                            least_loaded = node
                if least_loaded:
                    link_nodes(least_loaded, orphan)
                    connected.add(orphan.form_id)
                    print(f"[TreeBuilder] Orphan {orphan.name}: over-capacity on {least_loaded.name} ({len(least_loaded.children)} children)")
    
    def _ensure_all_reachable(self, nodes: Dict[str, TreeNode], root_id: str, school_name: str):
        """
        Final validation pass to ensure all nodes are reachable from root.
        Fixes unreachable nodes by replacing blocking prereqs with reachable parents.
        Respects max_children to maintain tree quality.
        """
        max_passes = 20
        max_children = self.cfg.max_children_per_node

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
                    # Simply remove blocking prereqs — keep the good ones
                    good_prereqs = [p for p in prereqs if p not in blocking]

                    # Remove from old blocking parents' children
                    for blocking_id in blocking:
                        if blocking_id in nodes:
                            blocking_node = nodes[blocking_id]
                            if fid in blocking_node.children:
                                blocking_node.children.remove(fid)

                    if good_prereqs:
                        # Node still has valid prereqs, just drop the blockers
                        node.prerequisites = good_prereqs
                        fixed_any = True
                    else:
                        # Need a new parent — find one with capacity
                        best_parent = None
                        best_score = -9999
                        tier_depth = self._tier_to_depth(node.tier)

                        for uid in unlockable:
                            if uid == fid:
                                continue
                            cand = nodes[uid]
                            if len(cand.children) >= max_children:
                                continue
                            # Prefer same theme, close depth, fewer children
                            score = 0
                            if cand.depth < tier_depth:
                                score += 50
                            if cand.depth == tier_depth - 1:
                                score += 30
                            if cand.theme and node.theme and cand.theme == node.theme:
                                score += 40
                            score -= len(cand.children) * 10
                            if score > best_score:
                                best_score = score
                                best_parent = uid

                        if best_parent:
                            node.prerequisites = [best_parent]
                            parent_node = nodes[best_parent]
                            if fid not in parent_node.children:
                                parent_node.children.append(fid)
                            node.depth = parent_node.depth + 1
                            fixed_any = True

            if not fixed_any:
                # Spread remaining across available parents (NOT root dump)
                print(f"[TreeBuilder] {school_name}: Spreading {len(unreachable)} nodes across available parents")
                # Sort unreachable by tier so low-tier get placed first
                unreachable_sorted = sorted(unreachable, key=lambda fid: self._tier_to_depth(nodes[fid].tier))

                for fid in unreachable_sorted:
                    if fid == root_id:
                        continue
                    node = nodes[fid]
                    tier_depth = self._tier_to_depth(node.tier)

                    # Clear old broken links
                    for old_prereq in list(node.prerequisites):
                        if old_prereq in nodes and fid in nodes[old_prereq].children:
                            nodes[old_prereq].children.remove(fid)
                    node.prerequisites = []

                    # Find ANY unlockable node with capacity, prefer theme/tier match
                    best = None
                    best_score = -9999
                    current_unlockable = self._simulate_unlocks(nodes, root_id)

                    for uid in current_unlockable:
                        cand = nodes[uid]
                        if len(cand.children) >= max_children:
                            continue
                        score = 0
                        if cand.depth < tier_depth:
                            score += 50
                        elif cand.depth == tier_depth:
                            score += 20
                        if cand.theme and node.theme and cand.theme == node.theme:
                            score += 40
                        score -= len(cand.children) * 10
                        if score > best_score:
                            best_score = score
                            best = uid

                    if best:
                        node.prerequisites = [best]
                        if fid not in nodes[best].children:
                            nodes[best].children.append(fid)
                        node.depth = nodes[best].depth + 1
                        # This node is now unlockable, update for next iterations
                break  # Re-run from top to pick up newly unlockable nodes

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
