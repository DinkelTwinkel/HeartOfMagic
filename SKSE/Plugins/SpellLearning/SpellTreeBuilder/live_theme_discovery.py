#!/usr/bin/env python3
"""
Live Theme Discovery System
============================
Discovers spell themes dynamically at runtime with NO predefined categories.
Handles unknown spell mods like "Forbidden Blood Spells" automatically.

Key Features:
1. Unsupervised clustering to find natural spell groupings
2. Automatic theme name extraction from cluster keywords
3. Works with any spell mod without predefined data
4. Generates sensible branching for 1 or multiple roots
5. LLM fallback for ambiguous spells
"""

import json
import re
from pathlib import Path
from collections import defaultdict, Counter
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional
import math

# Try sklearn for better clustering
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.cluster import KMeans, DBSCAN
    from sklearn.metrics.pairwise import cosine_similarity
    import numpy as np
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    print("Warning: sklearn not available, using basic clustering")


@dataclass
class SpellInfo:
    """Complete info about a spell."""
    name: str
    tier: str
    editor_id: str = ""
    theme: str = ""


@dataclass
class DiscoveredTheme:
    """A theme discovered from spell data."""
    name: str                           # Auto-generated theme name
    keywords: Set[str] = field(default_factory=set)  # Keywords defining this theme
    spells: List[SpellInfo] = field(default_factory=list)  # Full spell info
    tier_distribution: Dict[str, int] = field(default_factory=dict)  # Tier -> count
    confidence: float = 1.0             # How confident we are in this theme

    def spell_names(self) -> List[str]:
        return [s.name for s in self.spells]

    def __repr__(self):
        return f"Theme({self.name}: {len(self.spells)} spells, keywords={list(self.keywords)[:5]})"


@dataclass
class ThemeTreeNode:
    """A node in the spell tree."""
    spell_name: str
    theme: str
    tier: str
    position: Tuple[int, int] = (0, 0)  # (tier_index, lane)
    prereqs: List[str] = field(default_factory=list)
    is_root: bool = False


class LiveThemeDiscovery:
    """
    Discovers themes dynamically from spell data.
    No predefined categories - learns everything at runtime.
    """

    # Common words to exclude from theme name extraction
    STOP_WORDS = {
        'spell', 'the', 'of', 'and', 'a', 'to', 'in', 'for', 'is', 'on',
        'that', 'by', 'this', 'with', 'cc', 'dlc', 'wb', 'nat', 'npc',
        'lesser', 'greater', 'master', 'expert', 'apprentice', 'novice',
        'i', 'ii', 'iii', 'iv', 'v', 'conjure', 'summon', 'cast'
    }

    # Tier order for sorting
    TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']

    def __init__(self, min_theme_size: int = 3, max_themes: int = 12):
        """
        Args:
            min_theme_size: Minimum spells needed to form a theme
            max_themes: Maximum themes to discover (for clustering)
        """
        self.min_theme_size = min_theme_size
        self.max_themes = max_themes
        self.discovered_themes: Dict[str, DiscoveredTheme] = {}
        self.spell_to_theme: Dict[str, str] = {}
        self.spell_info_map: Dict[str, SpellInfo] = {}  # name -> SpellInfo
        self.vectorizer = None
        self.spell_vectors = None

    def extract_keywords(self, spell_name: str, editor_id: str = "") -> List[str]:
        """Extract meaningful keywords from spell name and editor ID."""
        # Combine name and editor ID
        text = f"{spell_name} {editor_id}".lower()

        # Remove common prefixes/suffixes
        text = re.sub(r'\b(spell|_spell|spell_)\b', ' ', text)
        text = re.sub(r'\b(cc|dlc\d?|wb|nat|nws|vsvsse\d+|bgssse\d+|krtsse\d+)\b', ' ', text)

        # Split on non-alphanumeric
        words = re.split(r'[^a-z]+', text)

        # Filter
        keywords = [w for w in words if len(w) > 2 and w not in self.STOP_WORDS]

        return keywords

    def discover_themes_sklearn(self, spells: List[Dict]) -> Dict[str, DiscoveredTheme]:
        """Use TF-IDF + clustering to discover themes."""
        if not spells:
            return {}

        # Build text corpus from spell names
        corpus = []
        spell_info = []
        for spell in spells:
            name = spell.get('name', '')
            editor_id = spell.get('editor_id', '')
            text = f"{name} {editor_id}".lower()
            # Clean up
            text = re.sub(r'\b(cc|dlc\d?|wb|nat|nws|vsvsse\d+|bgssse\d+|krtsse\d+|_spell)\b', ' ', text)
            corpus.append(text)
            spell_info.append(spell)

        # Add effect-based keywords to improve clustering
        enhanced_corpus = []
        for text, spell in zip(corpus, spell_info):
            # Add keywords based on spell effects we can infer from names
            enhanced = text
            name_lower = spell.get('name', '').lower()

            # Fear/calm/frenzy detection for Illusion
            if any(kw in name_lower for kw in ['fear', 'rout', 'dismay', 'hysteria']):
                enhanced += ' effect_fear'
            if any(kw in name_lower for kw in ['calm', 'pacify', 'harmony']):
                enhanced += ' effect_calm'
            if any(kw in name_lower for kw in ['fury', 'frenzy', 'rage', 'mayhem']):
                enhanced += ' effect_frenzy'
            if any(kw in name_lower for kw in ['rally', 'courage', 'call to arms']):
                enhanced += ' effect_rally'
            if any(kw in name_lower for kw in ['invisible', 'muffle', 'shadow']):
                enhanced += ' effect_stealth'

            # Destruction elements
            if any(kw in name_lower for kw in ['fire', 'flame', 'burn', 'inferno', 'incinerate']):
                enhanced += ' element_fire'
            if any(kw in name_lower for kw in ['frost', 'ice', 'cold', 'freeze', 'blizzard']):
                enhanced += ' element_frost'
            if any(kw in name_lower for kw in ['shock', 'lightning', 'thunder', 'spark', 'bolt']):
                enhanced += ' element_shock'

            enhanced_corpus.append(enhanced)

        corpus = enhanced_corpus

        # Vectorize
        self.vectorizer = TfidfVectorizer(
            max_features=500,
            stop_words=list(self.STOP_WORDS),
            ngram_range=(1, 2),
            min_df=1  # Allow unique terms for better discrimination
        )

        try:
            self.spell_vectors = self.vectorizer.fit_transform(corpus)
        except ValueError:
            # Not enough unique terms
            return self.discover_themes_basic(spells)

        # Determine optimal cluster count
        n_clusters = min(self.max_themes, max(3, len(spells) // 8))

        # Cluster
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        labels = kmeans.fit_predict(self.spell_vectors)

        # Group spells by cluster
        clusters = defaultdict(list)
        for i, label in enumerate(labels):
            clusters[label].append(spell_info[i])

        # Convert clusters to themes
        themes = {}
        feature_names = self.vectorizer.get_feature_names_out()

        for cluster_id, cluster_spells in clusters.items():
            if len(cluster_spells) < self.min_theme_size:
                continue

            # Get top keywords for this cluster
            cluster_indices = [i for i, l in enumerate(labels) if l == cluster_id]
            cluster_vectors = self.spell_vectors[cluster_indices]

            # Average TF-IDF scores
            avg_scores = np.asarray(cluster_vectors.mean(axis=0)).flatten()
            top_indices = avg_scores.argsort()[-10:][::-1]
            top_keywords = [feature_names[i] for i in top_indices if avg_scores[i] > 0]

            # Generate theme name from top keywords
            theme_name = self._generate_theme_name(top_keywords, cluster_spells)

            # Build tier distribution
            tier_dist = Counter(s.get('skillLevel', s.get('skillLevel', s.get('tier', 'Apprentice'))) for s in cluster_spells)

            # Create SpellInfo objects
            spell_infos = []
            for s in cluster_spells:
                info = SpellInfo(
                    name=s.get('name', ''),
                    tier=s.get('skillLevel', s.get('tier', 'Apprentice')),
                    editor_id=s.get('editor_id', ''),
                    theme=theme_name
                )
                spell_infos.append(info)
                self.spell_info_map[info.name] = info

            theme = DiscoveredTheme(
                name=theme_name,
                keywords=set(top_keywords),
                spells=spell_infos,
                tier_distribution=dict(tier_dist),
                confidence=len(cluster_spells) / len(spells)
            )
            themes[theme_name] = theme

            # Map spells to theme
            for spell in cluster_spells:
                self.spell_to_theme[spell['name']] = theme_name

        return themes

    def discover_themes_basic(self, spells: List[Dict]) -> Dict[str, DiscoveredTheme]:
        """Basic keyword frequency clustering without sklearn."""
        # Extract keywords for each spell
        spell_keywords = {}
        all_keywords = Counter()

        for spell in spells:
            name = spell.get('name', '')
            editor_id = spell.get('editor_id', '')
            keywords = self.extract_keywords(name, editor_id)
            spell_keywords[name] = keywords
            all_keywords.update(keywords)

        # Find dominant keywords (potential themes)
        theme_keywords = [kw for kw, count in all_keywords.most_common(self.max_themes * 2)
                        if count >= self.min_theme_size]

        # Cluster spells by their dominant keyword
        themes = defaultdict(list)
        for spell in spells:
            name = spell.get('name', '')
            keywords = spell_keywords.get(name, [])

            # Find best matching theme keyword
            best_theme = None
            for kw in keywords:
                if kw in theme_keywords:
                    best_theme = kw
                    break

            if best_theme:
                themes[best_theme].append(spell)
            else:
                themes['misc'].append(spell)

        # Convert to DiscoveredTheme objects
        result = {}
        for theme_name, theme_spells in themes.items():
            if len(theme_spells) < self.min_theme_size and theme_name != 'misc':
                # Merge small themes into misc
                themes['misc'].extend(theme_spells)
                continue

            tier_dist = Counter(s.get('skillLevel', s.get('skillLevel', s.get('tier', 'Apprentice'))) for s in theme_spells)

            # Collect all keywords from theme spells
            all_kw = set()
            for s in theme_spells:
                all_kw.update(self.extract_keywords(s['name'], s.get('editor_id', '')))

            # Create SpellInfo objects
            spell_infos = []
            for s in theme_spells:
                info = SpellInfo(
                    name=s.get('name', ''),
                    tier=s.get('skillLevel', s.get('tier', 'Apprentice')),
                    editor_id=s.get('editor_id', ''),
                    theme=theme_name
                )
                spell_infos.append(info)
                self.spell_info_map[info.name] = info

            theme = DiscoveredTheme(
                name=theme_name,
                keywords=all_kw,
                spells=spell_infos,
                tier_distribution=dict(tier_dist),
                confidence=len(theme_spells) / len(spells)
            )
            result[theme_name] = theme

            for spell in theme_spells:
                self.spell_to_theme[spell['name']] = theme_name

        return result

    def _generate_theme_name(self, keywords: List[str], spells: List[Dict]) -> str:
        """Generate a meaningful theme name from keywords and spell names."""
        if not keywords:
            return "arcane"

        # Count keyword frequency in spell names
        keyword_counts = Counter()
        for spell in spells:
            name = spell.get('name', '').lower()
            for kw in keywords[:5]:  # Check top 5
                if kw in name:
                    keyword_counts[kw] += 1

        # Pick most frequent keyword that appears in spell names
        for kw, count in keyword_counts.most_common():
            if count >= 2 and len(kw) > 3:
                return kw

        # Fallback to first keyword
        for kw in keywords:
            if len(kw) > 3:
                return kw

        return keywords[0] if keywords else "arcane"

    def discover_themes(self, spells: List[Dict]) -> Dict[str, DiscoveredTheme]:
        """
        Main entry point: discover themes from spell list.
        Uses sklearn if available, falls back to basic method.
        """
        if HAS_SKLEARN and len(spells) >= 10:
            self.discovered_themes = self.discover_themes_sklearn(spells)
        else:
            self.discovered_themes = self.discover_themes_basic(spells)

        return self.discovered_themes

    def find_edge_cases(self, confidence_threshold: float = 0.3) -> List[Dict]:
        """
        Find spells that don't fit well into their assigned theme.
        These are candidates for LLM classification.

        Returns list of dicts with spell info and reason for uncertainty.
        """
        if not HAS_SKLEARN or self.spell_vectors is None:
            return []

        edge_cases = []

        # Get cluster centroids for each theme
        theme_centroids = {}
        for theme_name in self.discovered_themes:
            theme_spells = [s.name for s in self.discovered_themes[theme_name].spells]
            indices = [i for i, name in enumerate(self.spell_to_theme.keys())
                      if name in theme_spells]
            if indices:
                centroid = self.spell_vectors[indices].mean(axis=0)
                theme_centroids[theme_name] = np.asarray(centroid).flatten()

        # Check each spell's distance to its assigned theme centroid
        spell_names = list(self.spell_to_theme.keys())
        for i, spell_name in enumerate(spell_names):
            assigned_theme = self.spell_to_theme.get(spell_name)
            if not assigned_theme or assigned_theme not in theme_centroids:
                continue

            # Calculate similarity to assigned theme
            spell_vec = self.spell_vectors[i].toarray().flatten()
            assigned_sim = cosine_similarity(
                spell_vec.reshape(1, -1),
                theme_centroids[assigned_theme].reshape(1, -1)
            )[0][0]

            # Find best alternative theme
            best_alt_sim = 0
            best_alt_theme = None
            for theme_name, centroid in theme_centroids.items():
                if theme_name == assigned_theme:
                    continue
                sim = cosine_similarity(
                    spell_vec.reshape(1, -1),
                    centroid.reshape(1, -1)
                )[0][0]
                if sim > best_alt_sim:
                    best_alt_sim = sim
                    best_alt_theme = theme_name

            # Edge case if similarity is low or very close to another theme
            if assigned_sim < confidence_threshold:
                edge_cases.append({
                    'spell': spell_name,
                    'assigned_theme': assigned_theme,
                    'confidence': assigned_sim,
                    'reason': 'Low confidence match',
                    'alternative': best_alt_theme,
                    'alt_confidence': best_alt_sim
                })
            elif best_alt_sim > 0 and (assigned_sim - best_alt_sim) < 0.1:
                edge_cases.append({
                    'spell': spell_name,
                    'assigned_theme': assigned_theme,
                    'confidence': assigned_sim,
                    'reason': f'Close to {best_alt_theme} ({best_alt_sim:.2f} vs {assigned_sim:.2f})',
                    'alternative': best_alt_theme,
                    'alt_confidence': best_alt_sim
                })

        return edge_cases

    def generate_llm_prompt(self, edge_cases: List[Dict], school: str = "") -> str:
        """Generate an LLM prompt for classifying edge case spells."""
        if not edge_cases:
            return ""

        themes_list = "\n".join(f"- {name}: {', '.join(list(t.keywords)[:5])}"
                               for name, t in self.discovered_themes.items())

        spells_list = "\n".join(
            f"- {ec['spell']} (currently: {ec['assigned_theme']}, reason: {ec['reason']})"
            for ec in edge_cases[:10]  # Limit to 10
        )

        return f"""You are classifying spells for a spell tree in Skyrim{f' ({school} school)' if school else ''}.

The following themes were automatically discovered:
{themes_list}

These spells need manual classification - they don't fit well into their auto-assigned themes:
{spells_list}

For each spell, respond with the best theme from the list above.
Format: SpellName: theme_name

Consider:
1. The spell's name and likely effect
2. Similar spells in each theme
3. Logical progression within the tree
"""

    def find_theme_affinities(self) -> Dict[Tuple[str, str], float]:
        """
        Calculate affinities between discovered themes.
        Used for cross-theme prerequisite links.
        """
        if not HAS_SKLEARN or self.vectorizer is None:
            return {}

        affinities = {}
        theme_names = list(self.discovered_themes.keys())

        # Calculate theme centroids
        theme_centroids = {}
        for theme_name, theme in self.discovered_themes.items():
            # Get vectors for this theme's spells
            theme_indices = []
            for i, spell_name in enumerate(self.spell_to_theme.keys()):
                if self.spell_to_theme.get(spell_name) == theme_name:
                    theme_indices.append(i)

            if theme_indices and self.spell_vectors is not None:
                centroid = self.spell_vectors[theme_indices].mean(axis=0)
                theme_centroids[theme_name] = np.asarray(centroid).flatten()

        # Calculate pairwise similarities
        for i, t1 in enumerate(theme_names):
            for t2 in theme_names[i+1:]:
                if t1 in theme_centroids and t2 in theme_centroids:
                    sim = cosine_similarity(
                        theme_centroids[t1].reshape(1, -1),
                        theme_centroids[t2].reshape(1, -1)
                    )[0][0]
                    # Convert to 0-100 affinity
                    affinity = max(0, min(100, int(sim * 100)))
                    affinities[(t1, t2)] = affinity
                    affinities[(t2, t1)] = affinity

        return affinities


class DynamicTreeBuilder:
    """
    Builds spell trees dynamically from discovered themes.
    Handles any number of roots and unknown spell mods.
    """

    TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']

    def __init__(self,
                 root_count: int = 1,
                 cross_theme_links: bool = True,
                 affinity_threshold: int = 60):
        """
        Args:
            root_count: How many root spells (0 = auto based on themes)
            cross_theme_links: Whether to create links between themes
            affinity_threshold: Minimum affinity for cross-theme links
        """
        self.root_count = root_count
        self.cross_theme_links = cross_theme_links
        self.affinity_threshold = affinity_threshold

    def build_tree(self,
                   spells: List[Dict],
                   discovery: LiveThemeDiscovery) -> Dict:
        """
        Build a complete spell tree from spells.

        Returns dict with:
            themes: discovered themes
            nodes: positioned spell nodes
            links: prerequisite connections
            roots: root spell names
        """
        # Discover themes
        themes = discovery.discover_themes(spells)

        if not themes:
            return {'themes': {}, 'nodes': [], 'links': [], 'roots': []}

        # Determine root count
        actual_root_count = self.root_count
        if actual_root_count == 0:
            # Auto: one root per major theme
            actual_root_count = min(len(themes), 5)

        # Select root spells (lowest tier from each top theme)
        roots = self._select_roots(themes, actual_root_count)

        # Build tree structure
        nodes = []
        links = []

        # Process each theme
        theme_lanes = self._assign_theme_lanes(themes, actual_root_count)

        for theme_name, theme in themes.items():
            lane_start = theme_lanes.get(theme_name, 0)
            theme_nodes, theme_links = self._build_theme_branch(
                theme, lane_start, roots
            )
            nodes.extend(theme_nodes)
            links.extend(theme_links)

        # Add cross-theme links if enabled
        if self.cross_theme_links:
            affinities = discovery.find_theme_affinities()
            cross_links = self._create_cross_theme_links(
                nodes, themes, affinities
            )
            links.extend(cross_links)

        return {
            'themes': {name: {
                'keywords': list(t.keywords),
                'spell_count': len(t.spells),
                'tiers': t.tier_distribution
            } for name, t in themes.items()},
            'nodes': nodes,
            'links': links,
            'roots': roots
        }

    def _select_roots(self,
                      themes: Dict[str, DiscoveredTheme],
                      count: int) -> List[str]:
        """Select root spells from the discovered themes."""
        # Sort themes by spell count (largest first)
        sorted_themes = sorted(
            themes.values(),
            key=lambda t: len(t.spells),
            reverse=True
        )

        roots = []
        for theme in sorted_themes[:count]:
            # Find lowest tier spell in this theme
            best_spell = None
            best_tier_idx = 999

            for spell in theme.spells:
                try:
                    tier_idx = self.TIER_ORDER.index(spell.tier)
                except ValueError:
                    tier_idx = 1  # Default to Apprentice level

                if tier_idx < best_tier_idx:
                    best_tier_idx = tier_idx
                    best_spell = spell

            if best_spell:
                roots.append(best_spell.name)

        return roots[:count]

    def _assign_theme_lanes(self,
                            themes: Dict[str, DiscoveredTheme],
                            root_count: int) -> Dict[str, int]:
        """Assign horizontal lane positions to each theme."""
        # Sort by size for consistent ordering
        sorted_themes = sorted(themes.keys(),
                              key=lambda t: len(themes[t].spells),
                              reverse=True)

        lanes = {}
        lane = 0
        lane_width = max(3, 12 // len(themes))  # Spread themes across width

        for theme in sorted_themes:
            lanes[theme] = lane
            lane += lane_width

        return lanes

    def _build_theme_branch(self,
                            theme: DiscoveredTheme,
                            lane_start: int,
                            roots: List[str]) -> Tuple[List[Dict], List[Dict]]:
        """Build nodes and links for a single theme branch."""
        nodes = []
        links = []

        # Group spells by tier (spells are now SpellInfo objects)
        tier_spells: Dict[str, List[SpellInfo]] = defaultdict(list)
        for spell in theme.spells:
            tier_spells[spell.tier].append(spell)

        # Position spells
        prev_tier_spell_names = []
        for tier_idx, tier in enumerate(self.TIER_ORDER):
            spells_in_tier = tier_spells.get(tier, [])

            for i, spell in enumerate(spells_in_tier):
                is_root = spell.name in roots

                node = {
                    'name': spell.name,
                    'theme': theme.name,
                    'tier': tier,
                    'tier_index': tier_idx,
                    'lane': lane_start + (i % 3),
                    'is_root': is_root
                }
                nodes.append(node)

                # Create links from previous tier
                if prev_tier_spell_names and not is_root:
                    # Link to closest spell in previous tier
                    prereq = prev_tier_spell_names[i % len(prev_tier_spell_names)]
                    links.append({
                        'from': prereq,
                        'to': spell.name,
                        'type': 'progression'
                    })

            if spells_in_tier:
                prev_tier_spell_names = [s.name for s in spells_in_tier]

        return nodes, links

    def _create_cross_theme_links(self,
                                   nodes: List[Dict],
                                   themes: Dict[str, DiscoveredTheme],
                                   affinities: Dict[Tuple[str, str], float]) -> List[Dict]:
        """Create links between related themes."""
        cross_links = []

        # Find theme pairs with high affinity
        for (t1, t2), affinity in affinities.items():
            if affinity < self.affinity_threshold:
                continue

            if t1 not in themes or t2 not in themes:
                continue

            # Find a bridge point (Expert level spell in t1 -> Master in t2)
            t1_nodes = [n for n in nodes if n['theme'] == t1 and n['tier'] == 'Expert']
            t2_nodes = [n for n in nodes if n['theme'] == t2 and n['tier'] == 'Master']

            if t1_nodes and t2_nodes:
                cross_links.append({
                    'from': t1_nodes[0]['name'],
                    'to': t2_nodes[0]['name'],
                    'type': 'cross_theme',
                    'affinity': affinity
                })

        return cross_links


def test_with_scanned_data():
    """Test the live discovery system with actual scanned spell data."""

    # Load scan data - check multiple locations
    scan_locations = [
        Path(r'G:\MODSTAGING\HIRCINE\overwrite\SKSE\Plugins\SpellLearning\schools'),
        Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools'),
    ]

    scan_dir = None
    for loc in scan_locations:
        if loc.exists():
            scan_dir = loc
            break

    if not scan_dir:
        print("ERROR: No spell scan directory found")
        return

    print(f"Using scans from: {scan_dir}\n")

    print("=" * 60)
    print("LIVE THEME DISCOVERY TEST")
    print("=" * 60)
    print("\nThis system discovers themes at RUNTIME with NO predefined categories.")
    print("It can handle completely unknown spell mods like 'Forbidden Blood Spells'.\n")

    for scan_file in sorted(scan_dir.glob("*_spells.json")):
        school = scan_file.stem.replace("_spells", "").title()

        with open(scan_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        spells = data.get('spells', [])
        if not spells:
            continue

        print("#" * 60)
        print(f"# {school.upper()} ({len(spells)} spells)")
        print("#" * 60)

        # Create discovery instance
        discovery = LiveThemeDiscovery(min_theme_size=3, max_themes=10)

        # Build tree with dynamic discovery
        builder = DynamicTreeBuilder(
            root_count=0,  # Auto-detect
            cross_theme_links=True,
            affinity_threshold=50
        )

        tree = builder.build_tree(spells, discovery)

        # Report results
        print(f"\nDiscovered {len(tree['themes'])} themes:")
        for theme_name, theme_info in sorted(tree['themes'].items(),
                                             key=lambda x: x[1]['spell_count'],
                                             reverse=True):
            print(f"  {theme_name}: {theme_info['spell_count']} spells")
            print(f"    Keywords: {theme_info['keywords'][:5]}")
            print(f"    Tiers: {theme_info['tiers']}")

        print(f"\nTree structure:")
        print(f"  Roots: {tree['roots']}")
        print(f"  Nodes: {len(tree['nodes'])}")
        print(f"  Links: {len(tree['links'])}")

        # Count link types
        link_types = Counter(l['type'] for l in tree['links'])
        print(f"  Link types: {dict(link_types)}")

        # Show cross-theme links
        cross_links = [l for l in tree['links'] if l['type'] == 'cross_theme']
        if cross_links:
            print(f"\n  Cross-theme links:")
            for link in cross_links[:5]:
                print(f"    {link['from']} -> {link['to']} (affinity: {link.get('affinity', '?')})")

        # Show edge cases that need LLM
        edge_cases = discovery.find_edge_cases(confidence_threshold=0.3)
        if edge_cases:
            print(f"\n  Edge cases for LLM ({len(edge_cases)} spells):")
            for ec in edge_cases[:5]:
                print(f"    {ec['spell']}: {ec['reason']}")

        # Save tree to JSON file
        output_dir = Path(__file__).parent / "test_output"
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / f"{school}_dynamic_tree.json"

        # Convert tree to format compatible with tree_viewer.html
        output_data = {
            'school': school,
            'ruleset': 'dynamic',
            'root': tree['roots'][0] if tree['roots'] else None,
            'themes': tree['themes'],
            'nodes': [
                {
                    'formId': node.get('name', ''),  # Use name as ID for now
                    'name': node.get('name', ''),
                    'tier': node.get('tier', 'Unknown'),
                    'theme': node.get('theme', 'arcane'),
                    'element': node.get('theme', 'arcane'),  # Theme as element
                    'prerequisites': [],  # Will be populated from links
                    'children': [],
                    'is_root': node.get('is_root', False)
                }
                for node in tree['nodes']
            ],
            'links': tree['links'],
            'roots': tree['roots'],
            'edge_cases': edge_cases[:20] if edge_cases else []
        }

        # Build prerequisite/children from links
        node_map = {n['name']: n for n in output_data['nodes']}
        for link in tree['links']:
            from_name = link['from']
            to_name = link['to']
            if to_name in node_map:
                node_map[to_name]['prerequisites'].append(from_name)
            if from_name in node_map:
                node_map[from_name]['children'].append(to_name)

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2)

        print(f"  Saved to: {output_file.name}")
        print()


def demo_unknown_mod():
    """
    Demonstrate handling of a completely unknown spell mod.
    Simulates 'Forbidden Blood Magic' mod that we have no data on.
    """
    print("=" * 60)
    print("DEMO: Unknown Spell Mod - 'Forbidden Blood Magic'")
    print("=" * 60)
    print("\nSimulating a mod with spell types we've never seen...\n")

    # Simulated spell data from an unknown mod
    unknown_spells = [
        {'name': 'Blood Drain', 'tier': 'Novice', 'editor_id': 'FBM_BloodDrain'},
        {'name': 'Crimson Touch', 'tier': 'Novice', 'editor_id': 'FBM_CrimsonTouch'},
        {'name': 'Sanguine Bolt', 'tier': 'Apprentice', 'editor_id': 'FBM_SanguineBolt'},
        {'name': 'Blood Boil', 'tier': 'Apprentice', 'editor_id': 'FBM_BloodBoil'},
        {'name': 'Hemorrhage', 'tier': 'Adept', 'editor_id': 'FBM_Hemorrhage'},
        {'name': 'Bloodletting', 'tier': 'Adept', 'editor_id': 'FBM_Bloodletting'},
        {'name': 'Crimson Storm', 'tier': 'Expert', 'editor_id': 'FBM_CrimsonStorm'},
        {'name': 'Blood Pact', 'tier': 'Expert', 'editor_id': 'FBM_BloodPact'},
        {'name': 'Exsanguinate', 'tier': 'Master', 'editor_id': 'FBM_Exsanguinate'},
        # Some bone/necro spells mixed in
        {'name': 'Bone Shield', 'tier': 'Novice', 'editor_id': 'FBM_BoneShield'},
        {'name': 'Bone Spear', 'tier': 'Apprentice', 'editor_id': 'FBM_BoneSpear'},
        {'name': 'Skeleton Army', 'tier': 'Adept', 'editor_id': 'FBM_SkeletonArmy'},
        {'name': 'Bone Storm', 'tier': 'Expert', 'editor_id': 'FBM_BoneStorm'},
        # Some soul spells
        {'name': 'Soul Siphon', 'tier': 'Novice', 'editor_id': 'FBM_SoulSiphon'},
        {'name': 'Spirit Drain', 'tier': 'Apprentice', 'editor_id': 'FBM_SpiritDrain'},
        {'name': 'Soul Tear', 'tier': 'Adept', 'editor_id': 'FBM_SoulTear'},
        {'name': 'Spectral Harvest', 'tier': 'Expert', 'editor_id': 'FBM_SpectralHarvest'},
    ]

    # Create discovery and builder
    discovery = LiveThemeDiscovery(min_theme_size=3, max_themes=5)
    builder = DynamicTreeBuilder(root_count=3, cross_theme_links=True)

    # Build tree (this also discovers themes)
    tree = builder.build_tree(unknown_spells, discovery)

    print("Discovered themes from unknown mod:")
    for name, theme in discovery.discovered_themes.items():
        print(f"\n  {name.upper()}:")
        print(f"    Spells: {[s.name for s in theme.spells]}")
        print(f"    Keywords: {list(theme.keywords)[:5]}")

    print(f"\nGenerated tree with {len(tree['roots'])} roots:")
    for root in tree['roots']:
        print(f"  - {root}")

    print(f"\nTotal links: {len(tree['links'])}")

    # Show the branching structure
    print("\nBranching structure:")
    for theme_name in tree['themes']:
        theme_nodes = [n for n in tree['nodes'] if n['theme'] == theme_name]
        print(f"\n  {theme_name} branch:")
        for tier in ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']:
            tier_nodes = [n for n in theme_nodes if n['tier'] == tier]
            if tier_nodes:
                print(f"    {tier}: {[n['name'] for n in tier_nodes]}")


if __name__ == '__main__':
    # First demo unknown mod handling
    demo_unknown_mod()

    print("\n" + "=" * 60 + "\n")

    # Then test with real scanned data
    test_with_scanned_data()
