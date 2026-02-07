#!/usr/bin/env python3
"""
Dynamic Theme System with LLM Fallback

Discovers themes dynamically from spell data, using school-appropriate categories.
Falls back to LLM for edge cases it can't classify.

Features:
1. School-specific theme definitions (not just elements)
2. Dynamic theme discovery via TF-IDF clustering
3. Learned keyword expansion
4. LLM fallback for low-confidence spells
5. Runtime theme building
"""

import json
import re
import numpy as np
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Set, Tuple, Optional, Any
from dataclasses import dataclass, field

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    from sklearn.cluster import KMeans
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

# =============================================================================
# SCHOOL-SPECIFIC THEME DEFINITIONS
# =============================================================================

# Each school has its own theme categories (not just elements)
SCHOOL_THEMES = {
    'Destruction': {
        'type': 'elemental',
        'themes': {
            'fire': ['fire', 'flame', 'burn', 'incinerate', 'inferno', 'blaze', 'scorch', 'heat', 'magma', 'pyre', 'ember'],
            'frost': ['frost', 'ice', 'cold', 'freeze', 'blizzard', 'chill', 'glacial', 'hail', 'snow', 'frozen', 'icy'],
            'shock': ['shock', 'lightning', 'thunder', 'electric', 'spark', 'volt', 'arc', 'jolt', 'static', 'storm'],
            'earth': ['stone', 'rock', 'earth', 'boulder', 'crystal', 'quake', 'tremor', 'geo'],
            'water': ['water', 'wave', 'tide', 'aqua', 'flood', 'rain', 'stream', 'splash'],
            'wind': ['wind', 'air', 'gust', 'breeze', 'cyclone', 'tornado', 'gale', 'tempest', 'zephyr'],
            'dark': ['dark', 'shadow', 'void', 'death', 'soul', 'curse', 'necrotic', 'drain'],
            'holy': ['holy', 'divine', 'sacred', 'light', 'radiant', 'blessed', 'bane', 'sun'],
            'arcane': ['arcane', 'magic', 'elemental', 'chaos', 'energy', 'force'],
        },
    },

    'Conjuration': {
        'type': 'functional',
        'themes': {
            'atronach': ['atronach', 'flame atronach', 'frost atronach', 'storm atronach', 'thrall'],
            'undead': ['zombie', 'skeleton', 'revenant', 'dead', 'thrall', 'necro', 'corpse', 'raise', 'reanimate'],
            'daedra': ['dremora', 'daedra', 'daedric', 'lord', 'xivilai', 'seducer', 'saint'],
            'bound': ['bound', 'sword', 'bow', 'dagger', 'axe', 'weapon', 'battleaxe'],
            'familiar': ['familiar', 'flaming', 'spectral', 'spirit', 'ghost'],
            'nature': ['spriggan', 'wolf', 'bear', 'spider', 'mudcrab', 'deer', 'cat', 'nature', 'animal'],
            'utility': ['soul trap', 'banish', 'command', 'expel', 'teleport'],
        },
    },

    'Restoration': {
        'type': 'functional',
        'themes': {
            'healing': ['heal', 'healing', 'wounds', 'close', 'grand', 'fast', 'restore', 'health', 'life', 'vigor'],
            'ward': ['ward', 'steadfast', 'lesser', 'greater', 'shield', 'protect', 'barrier'],
            'turn_undead': ['turn', 'repel', 'undead', 'bane', 'sun fire', 'vampire'],
            'circle': ['circle', 'guardian', 'protection', 'aura', 'area'],
            'buff': ['strength', 'endurance', 'fortify', 'resistance', 'blessing', 'heart'],
            'poison': ['poison', 'disease', 'cure', 'cleanse', 'antidote', 'locust'],
            'necromancy': ['necromantic', 'death', 'finger', 'bone', 'spirit'],
        },
    },

    'Alteration': {
        'type': 'functional',
        'themes': {
            'armor': ['flesh', 'oakflesh', 'stoneflesh', 'ironflesh', 'ebonyflesh', 'dragonhide', 'bark'],
            'paralysis': ['paralyze', 'paralysis', 'mass paralysis', 'entomb', 'freeze'],
            'light': ['candlelight', 'magelight', 'light', 'lantern', 'illuminate'],
            'transmute': ['transmute', 'transform', 'convert', 'ore'],
            'detect': ['detect', 'life', 'dead', 'aura', 'sense', 'vision'],
            'telekinesis': ['telekinesis', 'levitate', 'float', 'lift', 'magnet'],
            'utility': ['waterbreathing', 'feather', 'burden', 'equilibrium', 'weather', 'storage'],
            'rune': ['rune', 'ash', 'trap', 'acceleration'],
        },
    },

    'Illusion': {
        'type': 'functional',
        'themes': {
            'fear': ['fear', 'rout', 'hysteria', 'terror', 'dread', 'frighten', 'panic'],
            'calm': ['calm', 'pacify', 'harmony', 'peace', 'soothe', 'tranquil'],
            'frenzy': ['frenzy', 'fury', 'mayhem', 'rage', 'enrage', 'berserk', 'madness'],
            'rally': ['rally', 'courage', 'call to arms', 'inspire', 'embolden', 'morale'],
            'stealth': ['muffle', 'invisibility', 'invisible', 'shadow', 'silence', 'sneak', 'fade'],
            'vision': ['clairvoyance', 'sight', 'vision', 'eye', 'reveal', 'see'],
            'mind': ['mind', 'control', 'dominate', 'compel', 'charm', 'mesmerize', 'enslave'],
            'illusion': ['illusion', 'illusory', 'phantom', 'figment', 'mirage', 'hallucinate'],
        },
    },
}

# Theme affinities (for cross-theme linking)
THEME_AFFINITIES = {
    # Conjuration
    ('atronach', 'undead'): 40,
    ('atronach', 'daedra'): 60,
    ('undead', 'daedra'): 50,
    ('familiar', 'nature'): 70,
    ('bound', 'daedra'): 55,

    # Restoration
    ('healing', 'buff'): 75,
    ('healing', 'circle'): 60,
    ('ward', 'circle'): 70,
    ('turn_undead', 'necromancy'): 40,  # Opposites
    ('healing', 'poison'): 50,

    # Alteration
    ('armor', 'paralysis'): 45,
    ('detect', 'light'): 60,
    ('telekinesis', 'utility'): 55,
    ('transmute', 'utility'): 65,

    # Illusion
    ('fear', 'calm'): 40,  # Opposites, but related
    ('frenzy', 'rally'): 45,  # Opposites
    ('fear', 'frenzy'): 60,  # Both aggressive
    ('calm', 'rally'): 65,  # Both positive
    ('stealth', 'mind'): 55,
    ('vision', 'mind'): 60,
}

STOP_WORDS = {
    'the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'is', 'are', 'was', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'this', 'that', 'it', 'its', 'they',
    'target', 'targets', 'spell', 'spells', 'effect', 'effects', 'damage',
    'point', 'points', 'second', 'seconds', 'per', 'level', 'caster', 'casting',
    'health', 'magicka', 'stamina', 'novice', 'apprentice', 'adept', 'expert', 'master',
}


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class SpellThemeAnalysis:
    form_id: str
    name: str
    school: str
    text: str
    detected_theme: str
    confidence: float
    cluster_id: int = -1
    needs_llm: bool = False
    llm_reason: str = ""
    similar_spells: List[Tuple[str, float]] = field(default_factory=list)


@dataclass
class LLMRequest:
    spell_name: str
    spell_text: str
    school: str
    available_themes: List[str]
    top_candidates: List[Tuple[str, float]]
    reason: str


# =============================================================================
# DYNAMIC THEME MAPPER
# =============================================================================

class DynamicThemeMapper:
    """
    Maps spells to themes dynamically using NLP and optional LLM fallback.
    """

    def __init__(self, spells: List[Dict], school: str):
        self.spells = spells
        self.school = school
        self.school_config = SCHOOL_THEMES.get(school, SCHOOL_THEMES['Destruction'])
        self.themes = self.school_config['themes']
        self.analyses: Dict[str, SpellThemeAnalysis] = {}
        self.learned_keywords: Dict[str, Set[str]] = defaultdict(set)
        self.llm_requests: List[LLMRequest] = []
        self.vectorizer = None
        self.tfidf_matrix = None

    def extract_text(self, spell: Dict) -> str:
        """Extract searchable text from spell."""
        parts = [spell.get('name', '')]

        if 'editorId' in spell:
            editor_clean = re.sub(r'([a-z])([A-Z])', r'\1 \2', spell['editorId'])
            parts.append(editor_clean)

        if 'effectNames' in spell:
            parts.extend(spell['effectNames'])

        if 'effects' in spell:
            for effect in spell['effects']:
                if isinstance(effect, dict):
                    parts.append(effect.get('name', ''))
                    parts.append(effect.get('description', ''))

        return ' '.join(parts).lower()

    def detect_theme_static(self, text: str) -> Tuple[str, float, List[Tuple[str, float]]]:
        """Detect theme using keyword matching."""
        scores = {}

        for theme, keywords in self.themes.items():
            score = 0
            for kw in keywords:
                if re.search(rf'\b{re.escape(kw)}\b', text):
                    score += 3  # Exact word
                elif kw in text:
                    score += 1  # Substring

            # Also check learned keywords
            for learned_kw in self.learned_keywords.get(theme, []):
                if learned_kw in text:
                    score += 2

            scores[theme] = score

        # Get top candidates
        sorted_themes = sorted(scores.items(), key=lambda x: -x[1])
        top_candidates = [(t, s) for t, s in sorted_themes if s > 0][:3]

        if not any(scores.values()):
            return 'arcane' if 'arcane' in self.themes else list(self.themes.keys())[0], 0.0, []

        best_theme = sorted_themes[0][0]
        total = sum(scores.values()) + 0.01
        confidence = scores[best_theme] / total

        return best_theme, confidence, top_candidates

    def analyze_all(self, confidence_threshold: float = 0.3) -> Dict[str, SpellThemeAnalysis]:
        """Analyze all spells and identify edge cases for LLM."""

        # Create initial analyses
        for spell in self.spells:
            form_id = spell['formId']
            text = self.extract_text(spell)
            theme, confidence, candidates = self.detect_theme_static(text)

            analysis = SpellThemeAnalysis(
                form_id=form_id,
                name=spell['name'],
                school=self.school,
                text=text,
                detected_theme=theme,
                confidence=confidence,
            )

            # Check if this needs LLM assistance
            if confidence < confidence_threshold:
                analysis.needs_llm = True
                if len(candidates) >= 2 and candidates[0][1] - candidates[1][1] <= 2:
                    analysis.llm_reason = f"Tie between themes: {candidates[0][0]} vs {candidates[1][0]}"
                elif confidence == 0:
                    analysis.llm_reason = "No keyword matches found"
                else:
                    analysis.llm_reason = f"Low confidence ({confidence:.2f})"

                self.llm_requests.append(LLMRequest(
                    spell_name=spell['name'],
                    spell_text=text,
                    school=self.school,
                    available_themes=list(self.themes.keys()),
                    top_candidates=candidates,
                    reason=analysis.llm_reason,
                ))

            self.analyses[form_id] = analysis

        # Run TF-IDF clustering if sklearn available
        if HAS_SKLEARN and len(self.spells) >= 5:
            self._enhance_with_tfidf()

        return self.analyses

    def _enhance_with_tfidf(self):
        """Use TF-IDF to discover additional patterns and learn keywords."""
        texts = [a.text for a in self.analyses.values()]
        form_ids = list(self.analyses.keys())

        self.vectorizer = TfidfVectorizer(
            max_features=300,
            min_df=1,
            max_df=0.9,
            ngram_range=(1, 2),
            stop_words=list(STOP_WORDS),
        )

        try:
            self.tfidf_matrix = self.vectorizer.fit_transform(texts)
        except:
            return

        feature_names = self.vectorizer.get_feature_names_out()

        # Find similar spells
        similarity_matrix = cosine_similarity(self.tfidf_matrix)
        for i, form_id in enumerate(form_ids):
            similarities = similarity_matrix[i]
            top_indices = np.argsort(similarities)[::-1][1:4]
            similar = [(form_ids[j], float(similarities[j])) for j in top_indices if similarities[j] > 0.15]
            self.analyses[form_id].similar_spells = similar

        # Cluster spells
        n_clusters = min(len(self.themes), len(self.spells) // 3 + 1)
        if n_clusters >= 2:
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            clusters = kmeans.fit_predict(self.tfidf_matrix.toarray())

            for i, form_id in enumerate(form_ids):
                self.analyses[form_id].cluster_id = int(clusters[i])

            # Learn keywords from clusters
            self._learn_keywords_from_clusters(feature_names, form_ids, clusters)

    def _learn_keywords_from_clusters(self, feature_names, form_ids, clusters):
        """Learn new keywords associated with each theme from clusters."""

        # Group by detected theme
        theme_indices: Dict[str, List[int]] = defaultdict(list)
        for i, form_id in enumerate(form_ids):
            theme = self.analyses[form_id].detected_theme
            theme_indices[theme].append(i)

        for theme, indices in theme_indices.items():
            if len(indices) < 2:
                continue

            # Get mean TF-IDF for this theme's spells
            theme_tfidf = self.tfidf_matrix[indices].mean(axis=0).A1
            overall_tfidf = self.tfidf_matrix.mean(axis=0).A1

            # Find distinctive terms
            distinctiveness = theme_tfidf / (overall_tfidf + 0.001)
            top_indices = np.argsort(distinctiveness)[::-1][:15]

            for idx in top_indices:
                term = feature_names[idx]
                if distinctiveness[idx] > 1.5 and len(term) >= 3:
                    # Don't add if it's already a seed keyword
                    if not any(term in seeds for seeds in self.themes.values()):
                        self.learned_keywords[theme].add(term)

    def get_theme_affinity(self, theme_a: str, theme_b: str) -> int:
        """Get affinity between two themes."""
        if theme_a == theme_b:
            return 100
        key = tuple(sorted([theme_a, theme_b]))
        return THEME_AFFINITIES.get(key, 20)

    def generate_llm_prompt(self) -> str:
        """Generate a prompt for LLM to classify edge case spells."""
        if not self.llm_requests:
            return ""

        prompt = f"""You are classifying spells for the {self.school} school of magic in Skyrim.

Available themes for {self.school}:
"""
        for theme, keywords in self.themes.items():
            prompt += f"- {theme}: {', '.join(keywords[:5])}...\n"

        prompt += "\nClassify these spells that couldn't be auto-detected:\n\n"

        for req in self.llm_requests[:20]:  # Limit to 20
            prompt += f"Spell: {req.spell_name}\n"
            prompt += f"Text: {req.spell_text[:200]}\n"
            if req.top_candidates:
                prompt += f"Best guesses: {req.top_candidates}\n"
            prompt += f"Reason for uncertainty: {req.reason}\n"
            prompt += "Theme: ???\n\n"

        prompt += """
For each spell, respond with JUST the theme name from the available themes list.
Format: SpellName: theme_name
"""
        return prompt

    def apply_llm_results(self, llm_results: Dict[str, str]):
        """Apply LLM classification results."""
        for spell_name, theme in llm_results.items():
            # Find the spell
            for analysis in self.analyses.values():
                if analysis.name == spell_name and theme in self.themes:
                    analysis.detected_theme = theme
                    analysis.confidence = 0.8  # LLM-assigned confidence
                    analysis.needs_llm = False
                    break

    def print_analysis(self):
        """Print analysis summary."""
        print(f"\n{'='*60}")
        print(f"THEME ANALYSIS: {self.school}")
        print(f"{'='*60}")
        print(f"Total spells: {len(self.analyses)}")
        print(f"Theme type: {self.school_config['type']}")

        # Theme distribution
        theme_counts = defaultdict(int)
        for a in self.analyses.values():
            theme_counts[a.detected_theme] += 1

        print(f"\nTheme Distribution:")
        for theme, count in sorted(theme_counts.items(), key=lambda x: -x[1]):
            pct = 100 * count / len(self.analyses)
            print(f"  {theme}: {count} ({pct:.1f}%)")

        # Edge cases needing LLM
        needs_llm = [a for a in self.analyses.values() if a.needs_llm]
        if needs_llm:
            print(f"\nEdge Cases Needing LLM ({len(needs_llm)}):")
            for a in needs_llm[:10]:
                print(f"  {a.name} -> {a.detected_theme} (conf: {a.confidence:.2f})")
                print(f"    Reason: {a.llm_reason}")

        # Learned keywords
        if self.learned_keywords:
            print(f"\nLearned Keywords:")
            for theme, keywords in self.learned_keywords.items():
                if keywords:
                    print(f"  {theme}: {', '.join(list(keywords)[:8])}")


# =============================================================================
# TESTING
# =============================================================================

def test_all_schools():
    """Test dynamic theme mapping on all schools."""
    SCHOOLS_DIR = Path(r'D:\MODDING\Mod Development Zone 2\MO2\overwrite\SKSE\Plugins\SpellLearning\schools')

    schools = ['Destruction', 'Conjuration', 'Restoration', 'Alteration', 'Illusion']
    all_llm_requests = []

    for school in schools:
        spell_file = SCHOOLS_DIR / f"{school}_spells.json"
        if not spell_file.exists():
            continue

        with open(spell_file) as f:
            data = json.load(f)

        spells = data.get('spells', [])
        print(f"\n{'#'*60}")
        print(f"# {school.upper()} ({len(spells)} spells)")
        print(f"{'#'*60}")

        mapper = DynamicThemeMapper(spells, school)
        mapper.analyze_all(confidence_threshold=0.25)
        mapper.print_analysis()

        all_llm_requests.extend(mapper.llm_requests)

    # Summary of LLM needs
    print("\n" + "=" * 60)
    print("LLM EDGE CASE SUMMARY")
    print("=" * 60)
    print(f"Total spells needing LLM assistance: {len(all_llm_requests)}")

    if all_llm_requests:
        print("\nSample LLM prompt would look like:")
        sample_mapper = DynamicThemeMapper([], 'Destruction')
        sample_mapper.llm_requests = all_llm_requests[:5]
        print(sample_mapper.generate_llm_prompt()[:1500] + "...")

    print("\n" + "=" * 60)
    print("EDGE CASE PATTERNS")
    print("=" * 60)

    # Analyze edge case patterns
    reasons = defaultdict(int)
    for req in all_llm_requests:
        if "Tie" in req.reason:
            reasons["Theme tie"] += 1
        elif "No keyword" in req.reason:
            reasons["No keywords"] += 1
        else:
            reasons["Low confidence"] += 1

    for reason, count in sorted(reasons.items(), key=lambda x: -x[1]):
        print(f"  {reason}: {count}")


if __name__ == '__main__':
    test_all_schools()
