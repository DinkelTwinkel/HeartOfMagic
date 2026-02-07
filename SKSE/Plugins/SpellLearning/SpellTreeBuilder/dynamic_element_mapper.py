#!/usr/bin/env python3
"""
Dynamic Element Mapper

Uses TF-IDF and clustering to discover spell themes from actual spell data,
then maps them to element categories. Works with any mod's spells.

Flow:
1. Extract text from all spells (name, effects, descriptions)
2. TF-IDF vectorize to find significant terms
3. Cluster spells by similarity
4. Map clusters to element categories (using seed keywords + learned associations)
5. For unknown clusters, infer element from cluster characteristics
"""

import json
import re
import numpy as np
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Set, Tuple, Optional
from dataclasses import dataclass, field

# Try sklearn, fallback to simple approach if not available
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    from sklearn.cluster import KMeans
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    print("WARNING: sklearn not available, using fallback keyword matching")

# Paths
SCHOOLS_DIR = Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools')

# =============================================================================
# ELEMENT SEED KEYWORDS (used to bootstrap, not as the only source)
# =============================================================================

ELEMENT_SEEDS = {
    'fire': ['fire', 'flame', 'burn', 'heat', 'inferno', 'blaze', 'scorch', 'ignite', 'pyre', 'ember', 'magma', 'lava', 'incinerate'],
    'frost': ['frost', 'ice', 'cold', 'freeze', 'chill', 'frozen', 'glacial', 'snow', 'blizzard', 'hail', 'frigid', 'winter'],
    'shock': ['shock', 'lightning', 'thunder', 'electric', 'spark', 'volt', 'arc', 'jolt', 'static', 'charge', 'current'],
    'earth': ['stone', 'rock', 'earth', 'boulder', 'crystal', 'mineral', 'sand', 'quake', 'tremor', 'geo', 'terra', 'ground'],
    'water': ['water', 'wave', 'tide', 'aqua', 'flood', 'rain', 'stream', 'ocean', 'sea', 'liquid', 'flow', 'splash'],
    'wind': ['wind', 'air', 'gust', 'breeze', 'cyclone', 'tornado', 'gale', 'tempest', 'zephyr', 'draft', 'blow'],
    'dark': ['dark', 'shadow', 'void', 'death', 'soul', 'curse', 'necrotic', 'drain', 'wither', 'decay', 'corrupt'],
    'holy': ['holy', 'divine', 'sacred', 'light', 'radiant', 'blessed', 'purify', 'sanctify', 'celestial', 'heaven'],
    'arcane': ['arcane', 'magic', 'mana', 'ether', 'mystic', 'enchant', 'spell', 'sorcery', 'eldritch'],
}

# Stop words to exclude from analysis
STOP_WORDS = {
    'the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'is', 'are', 'was', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
    'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    'target', 'targets', 'spell', 'spells', 'effect', 'effects', 'damage',
    'point', 'points', 'second', 'seconds', 'per', 'level', 'levels',
    'health', 'magicka', 'stamina', 'caster', 'casting', 'cast',
    'novice', 'apprentice', 'adept', 'expert', 'master',
}


@dataclass
class SpellAnalysis:
    form_id: str
    name: str
    text: str  # Combined searchable text
    keywords: Set[str]
    detected_element: str = 'arcane'
    element_confidence: float = 0.0
    cluster_id: int = -1
    similar_spells: List[Tuple[str, float]] = field(default_factory=list)


# =============================================================================
# TEXT EXTRACTION
# =============================================================================

def extract_spell_text(spell: Dict) -> str:
    """Extract all searchable text from a spell."""
    parts = []

    # Spell name (most important)
    if 'name' in spell:
        parts.append(spell['name'])
        # Also add individual words
        parts.extend(spell['name'].split())

    # Editor ID often has useful info
    if 'editorId' in spell:
        # Split camelCase: "FireBoltSpell" -> "Fire Bolt Spell"
        editor_clean = re.sub(r'([a-z])([A-Z])', r'\1 \2', spell['editorId'])
        parts.append(editor_clean)

    # Effect names
    if 'effectNames' in spell:
        for effect in spell['effectNames']:
            parts.append(effect)

    # Full effects with descriptions
    if 'effects' in spell:
        for effect in spell['effects']:
            if isinstance(effect, dict):
                if 'name' in effect:
                    parts.append(effect['name'])
                if 'description' in effect:
                    parts.append(effect['description'])

    # Keywords from the spell record
    if 'keywords' in spell:
        for kw in spell['keywords']:
            # Clean up keyword (remove prefixes like "Magic")
            cleaned = re.sub(r'^Magic', '', str(kw))
            cleaned = re.sub(r'([A-Z])', r' \1', cleaned).strip()
            parts.append(cleaned)

    return ' '.join(parts).lower()


def extract_keywords(text: str) -> Set[str]:
    """Extract significant keywords from text."""
    # Get words 3+ chars, not in stop words
    words = re.findall(r'\b[a-z]{3,}\b', text.lower())
    return {w for w in words if w not in STOP_WORDS}


# =============================================================================
# DYNAMIC ELEMENT DETECTION
# =============================================================================

def detect_element_static(text: str, keywords: Set[str]) -> Tuple[str, float]:
    """Detect element using seed keywords (fast fallback)."""
    scores = {}

    for element, seeds in ELEMENT_SEEDS.items():
        score = 0
        for seed in seeds:
            # Exact word match
            if seed in keywords:
                score += 3
            # Substring match
            elif seed in text:
                score += 1
        scores[element] = score

    if max(scores.values()) == 0:
        return 'arcane', 0.0

    best_element = max(scores, key=scores.get)
    confidence = scores[best_element] / (sum(scores.values()) + 0.01)
    return best_element, confidence


class DynamicElementMapper:
    """
    Discovers element mappings from spell data using TF-IDF and clustering.
    """

    def __init__(self, spells: List[Dict]):
        self.spells = spells
        self.analyses: Dict[str, SpellAnalysis] = {}
        self.vectorizer = None
        self.tfidf_matrix = None
        self.cluster_elements: Dict[int, str] = {}
        self.learned_keywords: Dict[str, Set[str]] = defaultdict(set)

    def analyze_all(self) -> Dict[str, SpellAnalysis]:
        """Run full analysis on all spells."""

        # Step 1: Extract text and create initial analyses
        for spell in self.spells:
            form_id = spell['formId']
            text = extract_spell_text(spell)
            keywords = extract_keywords(text)

            self.analyses[form_id] = SpellAnalysis(
                form_id=form_id,
                name=spell['name'],
                text=text,
                keywords=keywords,
            )

        if HAS_SKLEARN and len(self.spells) >= 5:
            self._analyze_with_tfidf()
        else:
            self._analyze_static()

        return self.analyses

    def _analyze_static(self):
        """Fallback: Use static keyword matching."""
        for analysis in self.analyses.values():
            element, confidence = detect_element_static(analysis.text, analysis.keywords)
            analysis.detected_element = element
            analysis.element_confidence = confidence

    def _analyze_with_tfidf(self):
        """Use TF-IDF for dynamic theme discovery."""

        # Step 2: TF-IDF vectorization
        texts = [a.text for a in self.analyses.values()]
        form_ids = list(self.analyses.keys())

        self.vectorizer = TfidfVectorizer(
            max_features=500,
            min_df=1,
            max_df=0.9,
            ngram_range=(1, 2),
            stop_words=list(STOP_WORDS),
        )

        self.tfidf_matrix = self.vectorizer.fit_transform(texts)
        feature_names = self.vectorizer.get_feature_names_out()

        # Step 3: Find similar spells for each spell
        similarity_matrix = cosine_similarity(self.tfidf_matrix)

        for i, form_id in enumerate(form_ids):
            similarities = similarity_matrix[i]
            # Get top 5 similar (excluding self)
            top_indices = np.argsort(similarities)[::-1][1:6]
            similar = [(form_ids[j], similarities[j]) for j in top_indices if similarities[j] > 0.1]
            self.analyses[form_id].similar_spells = similar

        # Step 4: Cluster spells
        n_clusters = min(12, len(self.spells) // 5 + 1)
        if n_clusters >= 2:
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            clusters = kmeans.fit_predict(self.tfidf_matrix.toarray())

            for i, form_id in enumerate(form_ids):
                self.analyses[form_id].cluster_id = int(clusters[i])

        # Step 5: Determine element for each cluster
        self._map_clusters_to_elements(feature_names)

        # Step 6: Learn new keywords from clusters
        self._learn_keywords_from_clusters()

    def _map_clusters_to_elements(self, feature_names):
        """Map each cluster to an element based on its members."""

        # Group spells by cluster
        cluster_spells: Dict[int, List[SpellAnalysis]] = defaultdict(list)
        for analysis in self.analyses.values():
            if analysis.cluster_id >= 0:
                cluster_spells[analysis.cluster_id].append(analysis)

        # For each cluster, determine dominant element
        for cluster_id, members in cluster_spells.items():
            element_votes = defaultdict(float)

            for member in members:
                # Use static detection as a vote
                elem, conf = detect_element_static(member.text, member.keywords)
                element_votes[elem] += conf + 0.1  # Small base vote

            # Also check cluster's top TF-IDF terms
            if self.tfidf_matrix is not None:
                cluster_indices = [i for i, a in enumerate(self.analyses.values())
                                  if a.cluster_id == cluster_id]
                if cluster_indices:
                    cluster_tfidf = self.tfidf_matrix[cluster_indices].mean(axis=0).A1
                    top_term_indices = np.argsort(cluster_tfidf)[::-1][:10]
                    top_terms = [feature_names[i] for i in top_term_indices]

                    for term in top_terms:
                        for elem, seeds in ELEMENT_SEEDS.items():
                            if any(seed in term for seed in seeds):
                                element_votes[elem] += 0.5

            # Assign element to cluster
            if element_votes:
                best_element = max(element_votes, key=element_votes.get)
                self.cluster_elements[cluster_id] = best_element
            else:
                self.cluster_elements[cluster_id] = 'arcane'

        # Apply cluster elements to members
        for analysis in self.analyses.values():
            if analysis.cluster_id >= 0:
                cluster_elem = self.cluster_elements.get(analysis.cluster_id, 'arcane')
                static_elem, static_conf = detect_element_static(analysis.text, analysis.keywords)

                # If static detection is confident, use it; otherwise use cluster
                if static_conf > 0.5:
                    analysis.detected_element = static_elem
                    analysis.element_confidence = static_conf
                else:
                    analysis.detected_element = cluster_elem
                    analysis.element_confidence = 0.3  # Cluster-based confidence
            else:
                # No cluster, use static
                elem, conf = detect_element_static(analysis.text, analysis.keywords)
                analysis.detected_element = elem
                analysis.element_confidence = conf

    def _learn_keywords_from_clusters(self):
        """Learn new keywords associated with each element from cluster analysis."""

        if self.vectorizer is None:
            return

        feature_names = self.vectorizer.get_feature_names_out()

        # For each element, find terms that appear frequently in that element's spells
        element_spells: Dict[str, List[int]] = defaultdict(list)
        form_ids = list(self.analyses.keys())

        for i, form_id in enumerate(form_ids):
            elem = self.analyses[form_id].detected_element
            element_spells[elem].append(i)

        for element, indices in element_spells.items():
            if len(indices) < 2:
                continue

            # Get mean TF-IDF for this element's spells
            elem_tfidf = self.tfidf_matrix[indices].mean(axis=0).A1

            # Get overall mean
            overall_tfidf = self.tfidf_matrix.mean(axis=0).A1

            # Find terms that are distinctively high for this element
            distinctiveness = elem_tfidf / (overall_tfidf + 0.001)
            top_indices = np.argsort(distinctiveness)[::-1][:20]

            for idx in top_indices:
                term = feature_names[idx]
                if distinctiveness[idx] > 1.5 and len(term) >= 3:
                    # This term is distinctive for this element
                    self.learned_keywords[element].add(term)

    def get_element(self, form_id: str) -> Tuple[str, float]:
        """Get element for a spell."""
        if form_id in self.analyses:
            a = self.analyses[form_id]
            return a.detected_element, a.element_confidence
        return 'arcane', 0.0

    def get_similar_spells(self, form_id: str) -> List[Tuple[str, float]]:
        """Get similar spells based on TF-IDF similarity."""
        if form_id in self.analyses:
            return self.analyses[form_id].similar_spells
        return []

    def print_analysis(self):
        """Print analysis results."""
        print(f"\n{'='*60}")
        print("DYNAMIC ELEMENT ANALYSIS")
        print(f"{'='*60}")
        print(f"Total spells: {len(self.analyses)}")
        print(f"Using sklearn: {HAS_SKLEARN}")

        # Element distribution
        elem_counts = defaultdict(int)
        for a in self.analyses.values():
            elem_counts[a.detected_element] += 1

        print(f"\nElement Distribution:")
        for elem, count in sorted(elem_counts.items(), key=lambda x: -x[1]):
            pct = 100 * count / len(self.analyses)
            print(f"  {elem}: {count} ({pct:.1f}%)")

        # Cluster info
        if self.cluster_elements:
            print(f"\nClusters ({len(self.cluster_elements)}):")
            for cluster_id, elem in sorted(self.cluster_elements.items()):
                members = [a.name for a in self.analyses.values() if a.cluster_id == cluster_id]
                print(f"  Cluster {cluster_id} ({elem}): {len(members)} spells")
                for name in members[:5]:
                    print(f"    - {name}")
                if len(members) > 5:
                    print(f"    ... and {len(members)-5} more")

        # Learned keywords
        if self.learned_keywords:
            print(f"\nLearned Keywords:")
            for elem, keywords in sorted(self.learned_keywords.items()):
                if keywords:
                    print(f"  {elem}: {', '.join(list(keywords)[:10])}")

        # Low confidence spells (might need attention)
        low_conf = [a for a in self.analyses.values() if a.element_confidence < 0.3]
        if low_conf:
            print(f"\nLow Confidence ({len(low_conf)} spells):")
            for a in low_conf[:10]:
                print(f"  {a.name} -> {a.detected_element} (conf: {a.element_confidence:.2f})")


# =============================================================================
# TESTING
# =============================================================================

def test_school(school: str):
    """Test dynamic element mapping on a school."""
    spell_file = SCHOOLS_DIR / f"{school}_spells.json"
    if not spell_file.exists():
        print(f"No data for {school}")
        return

    with open(spell_file) as f:
        data = json.load(f)

    spells = data.get('spells', [])
    print(f"\n{'#'*60}")
    print(f"# {school.upper()} ({len(spells)} spells)")
    print(f"{'#'*60}")

    mapper = DynamicElementMapper(spells)
    mapper.analyze_all()
    mapper.print_analysis()

    return mapper


def main():
    print("=" * 60)
    print("DYNAMIC ELEMENT MAPPER TEST")
    print("=" * 60)

    schools = ['Destruction', 'Conjuration', 'Restoration', 'Alteration', 'Illusion']

    for school in schools:
        test_school(school)

    print("\n" + "=" * 60)
    print("CONCLUSION")
    print("=" * 60)
    print("""
Dynamic NLP element mapping:
1. Extracts text from spell names, effects, descriptions, keywords
2. Uses TF-IDF to find significant terms
3. Clusters similar spells together
4. Maps clusters to elements using seed keywords + learned patterns
5. Learns NEW keywords from cluster analysis

This handles mod spells that use non-standard naming conventions.
""")


if __name__ == '__main__':
    main()
