#!/usr/bin/env python3
"""
Improved Theme Discovery System
================================
Improvements over live_theme_discovery.py:
1. Uses editorId prefixes, tomeName for better keywords
2. Splits large themes into sub-themes
3. LLM edge case resolution via OpenRouter API
"""

import json
import re
import os
from pathlib import Path
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.cluster import KMeans
    from sklearn.metrics.pairwise import cosine_similarity
    import numpy as np
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

# Try to import LLM client
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


@dataclass
class SpellInfo:
    """Complete info about a spell."""
    name: str
    tier: str
    editor_id: str = ""
    theme: str = ""
    sub_theme: str = ""
    confidence: float = 1.0


@dataclass
class DiscoveredTheme:
    """A theme discovered from spell data."""
    name: str
    keywords: Set[str] = field(default_factory=set)
    spells: List[SpellInfo] = field(default_factory=list)
    tier_distribution: Dict[str, int] = field(default_factory=dict)
    sub_themes: Dict[str, List[SpellInfo]] = field(default_factory=dict)
    confidence: float = 1.0

    def spell_names(self) -> List[str]:
        return [s.name for s in self.spells]


class ImprovedThemeDiscovery:
    """
    Improved theme discovery with:
    1. EditorId prefix extraction
    2. TomeName keyword extraction
    3. Large theme splitting
    4. LLM edge case resolution
    """

    STOP_WORDS = {
        'spell', 'the', 'of', 'and', 'a', 'to', 'in', 'for', 'is', 'on',
        'that', 'by', 'this', 'with', 'cc', 'dlc', 'wb', 'nat', 'npc',
        'lesser', 'greater', 'master', 'expert', 'apprentice', 'novice',
        'i', 'ii', 'iii', 'iv', 'v', 'conjure', 'summon', 'cast', 'tome',
        'odn', 'con', 'des', 'res', 'alt', 'ill'  # Common prefixes
    }

    TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']

    # Known mod themes - spells from these mods get their own theme (if no strong thematic match)
    MOD_THEMES = {
        'vigilant.esm': 'vigilant',
        'glenmoril.esm': 'glenmoril',
        'unslaad.esm': 'unslaad',
        'necrotic.esp': 'necrotic',
        'natura.esp': 'natura',
        'apocalypse - magic of skyrim.esp': 'apocalypse',
        'triumvirate - mage archetypes.esp': 'triumvirate',
        'lost grimoire.esp': 'lost_grimoire',
        'lostgrimoire.esp': 'lost_grimoire',
        'odin - skyrim magic overhaul.esp': 'odin',
        'tonal architect.esp': 'tonal',
        'dac0da.esm': 'dacoda',
        'immersive wenches.esp': 'wenches',
    }

    # Dynamically discovered strong thematic keywords (populated by first-pass clustering)
    # These override mod-based assignment for smart routing
    dynamic_thematic_keywords: Set[str] = set()

    # EditorId category patterns
    EDITOR_ID_PATTERNS = {
        # Conjuration
        r'daedra|dremora': 'daedra',
        r'atronach|elemental': 'atronach',
        r'familiar|spirit': 'familiar',
        r'reanimate|zombie|undead|thrall|corpse': 'undead',
        r'bound|weapon': 'bound',
        r'banish': 'banish',
        r'skeleton|bone': 'skeleton',
        r'summon|call': 'summon',

        # Destruction
        r'fire|flame|burn|inferno': 'fire',
        r'frost|ice|cold|blizzard': 'frost',
        r'shock|lightning|spark|thunder': 'shock',
        r'earth|stone|rock': 'earth',
        r'water|aqua|wave': 'water',
        r'wind|air|gust': 'wind',
        r'shadow|dark|void': 'shadow',
        r'blood|crimson': 'blood',
        r'arcane|magic': 'arcane',

        # Restoration
        r'heal|restoration|cure': 'healing',
        r'ward|shield|protect': 'ward',
        r'turn|repel|bane': 'turn_undead',
        r'poison|venom|toxic': 'poison',
        r'sun|holy|divine': 'holy',
        r'circle|aura': 'circle',

        # Illusion
        r'fear|terror|rout': 'fear',
        r'calm|pacify|harmony': 'calm',
        r'frenzy|fury|rage': 'frenzy',
        r'rally|courage': 'rally',
        r'invis|muffle|shadow|stealth': 'stealth',
        r'illusion|phantom|figment': 'illusion',

        # Alteration
        r'flesh|armor|oak|stone|iron|ebony|dragon': 'armor',
        r'paralysis|paralyze': 'paralysis',
        r'detect|sense': 'detect',
        r'light|candle|mage': 'light',
        r'transmute': 'transmute',
        r'telekinesis': 'telekinesis',
        r'polymorph|shapeshift': 'polymorph',
        r'teleport': 'teleport',
    }

    def __init__(self,
                 min_theme_size: int = 3,
                 max_themes: int = 15,
                 max_theme_size: int = 100,
                 llm_api_key: str = None,
                 verbose: bool = True):
        self.min_theme_size = min_theme_size
        self.max_themes = max_themes
        self.max_theme_size = max_theme_size
        self.llm_api_key = llm_api_key or os.environ.get('OPENROUTER_API_KEY')
        self.verbose = verbose

        self.discovered_themes: Dict[str, DiscoveredTheme] = {}
        self.spell_to_theme: Dict[str, str] = {}
        self.spell_info_map: Dict[str, SpellInfo] = {}
        self.vectorizer = None
        self.spell_vectors = None
        self.clustered_spell_names: List[str] = []  # Spells that went through TF-IDF clustering
        self.llm_routing_log: List[Dict] = []  # LLM routing decisions for ambiguous mod spells
        self.branch_assignments: Dict[str, str] = {}  # spell_name -> parent_theme (for branch spells)

        # Stage logging for verification
        self.stage_log: List[Dict] = []

    def _log(self, stage: str, message: str, data: Dict = None):
        """Log a stage event for verification."""
        entry = {'stage': stage, 'message': message, 'data': data or {}}
        self.stage_log.append(entry)
        if self.verbose:
            prefix = f"[{stage}]"
            print(f"  {prefix} {message}")

    def get_stage_summary(self) -> Dict:
        """Get summary of all stages for LLM verification."""
        return {
            'stages_completed': list(set(e['stage'] for e in self.stage_log)),
            'dynamic_keywords_count': len(self.dynamic_thematic_keywords),
            'dynamic_keywords_sample': sorted(self.dynamic_thematic_keywords)[:15],
            'themes_discovered': len(self.discovered_themes),
            'theme_names': list(self.discovered_themes.keys()),
            'branch_count': len(self.branch_assignments),
            'branch_by_theme': dict(Counter(self.branch_assignments.values())),
            'llm_decisions': len(self.llm_routing_log),
            'spells_clustered': len(self.clustered_spell_names),
            'total_spells_assigned': len(self.spell_to_theme),
        }

    def extract_mod_name(self, persistent_id: str) -> Optional[str]:
        """Extract mod/ESP name from persistentId like 'Vigilant.esm|0x10D83A'."""
        if '|' in persistent_id:
            mod = persistent_id.split('|')[0].lower()
            return mod
        return None

    def extract_mod_theme(self, persistent_id: str) -> Optional[str]:
        """Get theme name for known mods."""
        mod = self.extract_mod_name(persistent_id)
        if mod:
            return self.MOD_THEMES.get(mod)
        return None

    def discover_thematic_keywords(self, spells: List[Dict]) -> Set[str]:
        """First-pass clustering to dynamically discover strong thematic keywords.

        Clusters ALL spells (ignoring mod) to find natural themes like:
        - fire, flame, burn (fire theme)
        - frost, ice, cold (frost theme)
        - chrono, time, temporal (time magic from unknown mod)

        Returns set of keywords that indicate strong thematic identity.
        """
        if not HAS_SKLEARN or len(spells) < 20:
            self._log('TIER1', 'Skipped first-pass (sklearn unavailable or too few spells)')
            return set()

        self._log('TIER1', f'Starting first-pass keyword discovery on {len(spells)} spells')

        # Build simple corpus from all spells
        corpus = []
        for spell in spells:
            keywords = self.extract_rich_keywords(spell)
            corpus.append(' '.join(keywords))

        # Vectorize
        vectorizer = TfidfVectorizer(
            max_features=500,
            stop_words=list(self.STOP_WORDS),
            ngram_range=(1, 1),  # Single words only for keyword extraction
            min_df=2  # Must appear in at least 2 spells
        )

        try:
            vectors = vectorizer.fit_transform(corpus)
        except ValueError:
            return set()

        # Cluster into rough themes
        n_clusters = min(12, max(5, len(spells) // 40))
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        labels = kmeans.fit_predict(vectors)

        # Extract top keywords from each cluster
        feature_names = vectorizer.get_feature_names_out()
        strong_keywords = set()

        for cluster_id in range(n_clusters):
            cluster_indices = [i for i, label in enumerate(labels) if label == cluster_id]
            if len(cluster_indices) < 5:  # Skip tiny clusters
                continue

            # Get average TF-IDF scores for this cluster
            cluster_vectors = vectors[cluster_indices]
            avg_scores = np.asarray(cluster_vectors.mean(axis=0)).flatten()

            # Top keywords for this cluster
            top_indices = avg_scores.argsort()[-8:][::-1]
            for idx in top_indices:
                score = avg_scores[idx]
                if score > 0.05:  # Significant weight
                    keyword = feature_names[idx]
                    # Skip generic/prefix keywords
                    if (len(keyword) > 3 and
                        not keyword.startswith(('category_', 'element_', 'effect_', 'mod_')) and
                        keyword not in self.STOP_WORDS):
                        strong_keywords.add(keyword)

        self._log('TIER1', f'Found {len(strong_keywords)} thematic keywords', {
            'keywords': sorted(strong_keywords)[:20],
            'cluster_count': n_clusters
        })
        return strong_keywords

    def has_strong_thematic_keywords(self, spell: Dict) -> Tuple[bool, List[str]]:
        """Check if spell has strong thematic keywords that should override mod assignment.

        Fire spells from Apocalypse should go to 'fire' theme, not 'apocalypse'.
        But generic spells like 'Apocalypse Blessing' should stay in mod theme.

        Uses dynamically discovered keywords from first-pass clustering.

        Returns:
            (has_strong, matched_keywords) - whether spell has strong keywords and which ones
        """
        if not self.dynamic_thematic_keywords:
            return False, []

        name_lower = spell.get('name', '').lower()
        editor_id = spell.get('editorId', spell.get('editor_id', '')).lower()
        combined = f"{name_lower} {editor_id}"

        matched = []
        for keyword in self.dynamic_thematic_keywords:
            if keyword in combined:
                matched.append(keyword)

        # Strong = 2+ keywords, or 1 very distinctive keyword (fire, frost, undead, etc.)
        distinctive = {'fire', 'frost', 'shock', 'lightning', 'ice', 'flame', 'undead',
                       'skeleton', 'zombie', 'daedra', 'atronach', 'heal', 'ward', 'fear',
                       'calm', 'frenzy', 'invisibility', 'paralyze', 'bound'}

        has_distinctive = any(kw in distinctive for kw in matched)
        is_strong = len(matched) >= 2 or has_distinctive

        return is_strong, matched

    def _auto_branch_decision(self, spell: Dict, matched_keywords: List[str]) -> Tuple[str, Optional[str]]:
        """NLP-based auto-branch decision when LLM is disabled.

        Uses DYNAMICALLY DISCOVERED keywords and themes to decide if a mod spell
        should become a branch of a core thematic tree.

        Returns: ('branch', parent_theme) or ('mod', None)
        """
        # Use dynamically discovered keywords - no hardcoding!
        if not self.dynamic_thematic_keywords:
            return 'mod', None

        # Build comprehensive text from all available spell metadata
        spell_name = spell.get('name', '').lower()
        editor_id = spell.get('editorId', spell.get('editor_id', '')).lower()
        description = spell.get('description', '').lower()
        effect_name = spell.get('effectName', spell.get('effect_name', '')).lower()
        tome_name = spell.get('tomeName', '').lower()

        # Combine all text sources for comprehensive matching
        combined_text = f"{spell_name} {editor_id} {description} {effect_name} {tome_name}"

        # Find all dynamically discovered keywords in the spell's text
        found_keywords = []
        for keyword in self.dynamic_thematic_keywords:
            if keyword in combined_text:
                found_keywords.append(keyword)
                # Extra weight for spell name matches (most reliable)
                if keyword in spell_name:
                    found_keywords.append(keyword)  # Count twice

        # Also include the matched_keywords passed in
        found_keywords.extend(matched_keywords)

        if not found_keywords:
            return 'mod', None

        # Find which discovered theme best matches these keywords
        # by checking which theme's keyword set has most overlap
        best_theme = None
        best_overlap = 0

        for theme_name, theme in self.discovered_themes.items():
            # Skip mod-based themes (they have 'mod' in keywords)
            if 'mod' in theme.keywords:
                continue

            # Count keyword overlap
            theme_keywords_lower = {kw.lower() for kw in theme.keywords}
            overlap = sum(1 for kw in found_keywords if kw in theme_keywords_lower)

            # Also check if theme name itself matches
            if theme_name.lower() in combined_text:
                overlap += 2

            if overlap > best_overlap:
                best_overlap = overlap
                best_theme = theme_name

        # Threshold: need at least 2 overlapping keywords to make a branch decision
        if best_overlap >= 2 and best_theme:
            return 'branch', best_theme

        return 'mod', None

    def ask_llm_for_routing(self, spell: Dict, mod_theme: str, matched_keywords: List[str]) -> Tuple[str, Optional[str]]:
        """Ask LLM whether spell should join a thematic tree as a branch or stay in mod theme.

        Returns: ('branch', 'theme_name') or ('mod', None)

        If 'branch', the spell joins the thematic tree as a child/branch.
        This creates hierarchy: fire_tree -> [natura_fire_branch] -> fire spells from natura
        """
        if not self.llm_api_key or not HAS_REQUESTS:
            return 'mod', None  # Fallback to mod theme if no LLM

        spell_name = spell.get('name', '')
        keywords_str = ', '.join(matched_keywords) if matched_keywords else 'none'

        # Map keywords to likely parent themes
        keyword_to_theme = {
            'fire': 'fire', 'flame': 'fire', 'burn': 'fire', 'inferno': 'fire',
            'frost': 'frost', 'ice': 'frost', 'cold': 'frost', 'freeze': 'frost',
            'shock': 'shock', 'lightning': 'shock', 'thunder': 'shock', 'spark': 'shock',
            'stone': 'earth', 'rock': 'earth', 'earth': 'earth', 'boulder': 'earth',
            'water': 'water', 'wave': 'water', 'aqua': 'water', 'tide': 'water',
            'wind': 'wind', 'gust': 'wind', 'air': 'wind', 'gale': 'wind',
            'shadow': 'shadow', 'dark': 'shadow', 'void': 'shadow',
            'blood': 'blood', 'crimson': 'blood', 'drain': 'blood',
            'holy': 'holy', 'divine': 'holy', 'sacred': 'holy',
            'undead': 'undead', 'skeleton': 'undead', 'zombie': 'undead',
            'heal': 'healing', 'restore': 'healing', 'cure': 'healing',
            'fear': 'fear', 'terror': 'fear',
            'calm': 'calm', 'pacify': 'calm',
            'frenzy': 'frenzy', 'fury': 'frenzy', 'rage': 'frenzy',
        }

        # Find potential parent theme from keywords
        potential_themes = []
        for kw in matched_keywords:
            if kw in keyword_to_theme:
                potential_themes.append(keyword_to_theme[kw])

        if not potential_themes:
            return 'mod', None  # No clear theme match

        primary_theme = potential_themes[0]

        prompt = f"""A spell from the "{mod_theme}" mod needs tree placement in a skill tree UI.

Spell: "{spell_name}"
Element/theme keywords found: {keywords_str}
Potential parent tree: {primary_theme}

The skill tree groups spells by element/effect. Should "{spell_name}":
A) Appear in the {primary_theme} tree (because it's clearly a {primary_theme} spell regardless of source mod)
B) Appear in a separate "{mod_theme}" section (because it's unique to that mod)

Key question: Is "{spell_name}" fundamentally a {primary_theme} spell that just happens to come from a mod?
- If YES (e.g., "Fire Bolt" from any mod is still a fire spell) -> A
- If NO (e.g., spell has unique identity beyond just its element) -> B

Reply A or B."""

        try:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.llm_api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "anthropic/claude-3-haiku",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 10,
                    "temperature": 0.1
                },
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
                answer = result['choices'][0]['message']['content'].strip().upper()
                if 'A' in answer:
                    return 'branch', primary_theme
                else:
                    return 'mod', None
            else:
                return 'mod', None

        except Exception:
            return 'mod', None

    def extract_category_from_editor_id(self, editor_id: str) -> Optional[str]:
        """Extract category from editorId using pattern matching."""
        editor_lower = editor_id.lower()

        for pattern, category in self.EDITOR_ID_PATTERNS.items():
            if re.search(pattern, editor_lower):
                return category

        return None

    def extract_rich_keywords(self, spell: Dict) -> List[str]:
        """Extract keywords from all available spell data."""
        keywords = []

        # From name
        name = spell.get('name', '').lower()
        name_words = re.split(r'[^a-z]+', name)
        keywords.extend([w for w in name_words if len(w) > 2 and w not in self.STOP_WORDS])

        # From editorId - extract meaningful parts
        editor_id = spell.get('editorId', spell.get('editor_id', '')).lower()
        # Split on underscores and numbers
        editor_parts = re.split(r'[_\d]+', editor_id)
        keywords.extend([p for p in editor_parts if len(p) > 2 and p not in self.STOP_WORDS])

        # Category from editorId
        category = self.extract_category_from_editor_id(editor_id)
        if category:
            keywords.append(f'category_{category}')

        # From tomeName
        tome_name = spell.get('tomeName', '').lower()
        tome_words = re.split(r'[^a-z]+', tome_name)
        keywords.extend([w for w in tome_words if len(w) > 3 and w not in self.STOP_WORDS])

        return keywords

    def build_enhanced_corpus(self, spells: List[Dict]) -> Tuple[List[str], List[Dict], Dict[str, List[Dict]]]:
        """Build TF-IDF corpus with enhanced keyword extraction.

        Returns:
            corpus: List of keyword strings for TF-IDF
            spell_info: List of spell dicts for clustering
            mod_grouped: Dict of mod_theme -> [spells] for pre-assigned spells
        """
        corpus = []
        spell_info = []
        mod_grouped = defaultdict(list)  # Spells pre-assigned by mod

        llm_routing_decisions = []  # Track LLM decisions for logging
        branch_spells = defaultdict(list)  # parent_theme -> [spells to add as branch]

        for spell in spells:
            # PRIORITY 1: Check if spell belongs to a known mod
            persistent_id = spell.get('persistentId', '')
            mod_theme = self.extract_mod_theme(persistent_id)

            if mod_theme:
                # Check for thematic keywords
                is_strong, matched_keywords = self.has_strong_thematic_keywords(spell)

                if is_strong:
                    # Strong thematic keywords -> definitely cluster (no LLM needed)
                    pass  # Fall through to clustering
                elif matched_keywords:
                    # Has weak thematic keywords - decide branch vs mod
                    if self.llm_api_key:
                        # LLM decides: branch or mod
                        routing, parent_theme = self.ask_llm_for_routing(spell, mod_theme, matched_keywords)
                        llm_routing_decisions.append({
                            'spell': spell.get('name'),
                            'mod': mod_theme,
                            'keywords': matched_keywords,
                            'decision': routing,
                            'parent_theme': parent_theme
                        })
                    else:
                        # NO LLM: Use NLP-based auto-branch for clear elemental keywords
                        routing, parent_theme = self._auto_branch_decision(spell, matched_keywords)
                        if routing == 'branch':
                            llm_routing_decisions.append({
                                'spell': spell.get('name'),
                                'mod': mod_theme,
                                'keywords': matched_keywords,
                                'decision': 'branch (auto)',
                                'parent_theme': parent_theme
                            })

                    if routing == 'branch' and parent_theme:
                        # Add to branch list - will be linked as children of parent theme
                        branch_spells[parent_theme].append(spell)
                        self.branch_assignments[spell.get('name', '')] = parent_theme
                        # Still add to clustering so it gets positioned
                        pass  # Fall through to clustering
                    elif routing == 'mod':
                        mod_grouped[mod_theme].append(spell)
                        continue
                else:
                    # No thematic keywords -> mod theme fallback
                    mod_grouped[mod_theme].append(spell)
                    continue

            # Get all keywords for spells that need clustering
            keywords = self.extract_rich_keywords(spell)

            # Add mod name as a keyword even for unknown mods (helps clustering)
            mod_name = self.extract_mod_name(persistent_id)
            if mod_name:
                # Clean mod name for keyword
                mod_keyword = re.sub(r'[^a-z]', '', mod_name.replace('.esp', '').replace('.esm', ''))
                if len(mod_keyword) > 3:
                    keywords.append(f'mod_{mod_keyword}')

            # Add effect-based keywords from name
            name_lower = spell.get('name', '').lower()

            # Fear/calm/frenzy for Illusion
            if any(kw in name_lower for kw in ['fear', 'rout', 'dismay', 'hysteria']):
                keywords.append('effect_fear')
            if any(kw in name_lower for kw in ['calm', 'pacify', 'harmony']):
                keywords.append('effect_calm')
            if any(kw in name_lower for kw in ['fury', 'frenzy', 'rage', 'mayhem']):
                keywords.append('effect_frenzy')
            if any(kw in name_lower for kw in ['rally', 'courage']):
                keywords.append('effect_rally')
            if any(kw in name_lower for kw in ['invisible', 'muffle', 'shadow']):
                keywords.append('effect_stealth')

            # Destruction elements
            if any(kw in name_lower for kw in ['fire', 'flame', 'burn', 'inferno', 'incinerate']):
                keywords.append('element_fire')
            if any(kw in name_lower for kw in ['frost', 'ice', 'cold', 'freeze', 'blizzard']):
                keywords.append('element_frost')
            if any(kw in name_lower for kw in ['shock', 'lightning', 'thunder', 'spark', 'bolt']):
                keywords.append('element_shock')

            # Conjuration types
            editor_id = spell.get('editorId', spell.get('editor_id', '')).lower()
            if 'atronach' in editor_id or 'atronach' in name_lower:
                keywords.append('summon_atronach')
            if 'daedra' in editor_id or 'dremora' in name_lower:
                keywords.append('summon_daedra')
            if 'zombie' in editor_id or 'reanimate' in editor_id or 'corpse' in name_lower:
                keywords.append('summon_undead')
            if 'bound' in editor_id or 'bound' in name_lower:
                keywords.append('bound_weapon')
            if 'familiar' in editor_id or 'familiar' in name_lower:
                keywords.append('summon_familiar')
            if 'skeleton' in editor_id or 'skeleton' in name_lower:
                keywords.append('summon_skeleton')

            # SECOND PASS BOOST: Repeat discovered thematic keywords for higher TF-IDF weight
            boosted_keywords = []
            for kw in keywords:
                boosted_keywords.append(kw)
                # If this keyword was discovered as thematically important, boost it
                if kw in self.dynamic_thematic_keywords:
                    boosted_keywords.extend([kw, kw])  # Triple weight for discovered keywords

            # Build text for TF-IDF
            text = ' '.join(boosted_keywords)
            corpus.append(text)
            spell_info.append(spell)

        # Store and log routing decisions
        self.llm_routing_log = llm_routing_decisions
        if llm_routing_decisions:
            branch_count = sum(1 for d in llm_routing_decisions if 'branch' in d['decision'])
            mod_count = sum(1 for d in llm_routing_decisions if d['decision'] == 'mod')
            parent_counts = Counter(d.get('parent_theme') for d in llm_routing_decisions if 'branch' in d['decision'])

            routing_type = 'LLM' if self.llm_api_key else 'Auto-branch'
            self._log('TIER2', f'{routing_type} routing: {len(llm_routing_decisions)} decisions', {
                'branch_count': branch_count,
                'mod_count': mod_count,
                'branch_by_theme': dict(parent_counts.most_common(10))
            })

        return corpus, spell_info, mod_grouped

    def discover_themes(self, spells: List[Dict]) -> Dict[str, DiscoveredTheme]:
        """Discover themes with priority: thematic > mod > LLM.

        Priority order:
        1. Strong Thematic Keywords (Highest) - fire/frost/undead spells cluster together
        2. ESP/Mod Theme - Known mods get their own theme for generic spells
        3. Dynamic Clustering - TF-IDF + KMeans for remaining spells
        4. LLM Correction (called separately) - For low-confidence assignments
        """
        if not spells:
            return {}

        # FIRST PASS: Discover thematic keywords dynamically
        self.dynamic_thematic_keywords = self.discover_thematic_keywords(spells)

        # Build enhanced corpus - uses dynamic keywords for smart routing
        corpus, spell_info, mod_grouped = self.build_enhanced_corpus(spells)

        # PRIORITY 1: Create themes from known mods
        themes = {}
        for mod_theme, mod_spells in mod_grouped.items():
            if len(mod_spells) < self.min_theme_size:
                # Too few spells, add back to clustering
                spell_info.extend(mod_spells)
                corpus.extend([' '.join(self.extract_rich_keywords(s)) for s in mod_spells])
                continue

            self._log('TIER1', f"Mod theme '{mod_theme}': {len(mod_spells)} spells (from ESP)")

            # Create SpellInfo objects
            spell_infos = []
            tier_dist = Counter()
            for s in mod_spells:
                tier = s.get('skillLevel', s.get('tier', 'Apprentice'))
                tier_dist[tier] += 1
                info = SpellInfo(
                    name=s.get('name', ''),
                    tier=tier,
                    editor_id=s.get('editorId', s.get('editor_id', '')),
                    theme=mod_theme,
                    confidence=1.0  # High confidence for mod-based assignment
                )
                spell_infos.append(info)
                self.spell_info_map[info.name] = info
                self.spell_to_theme[s['name']] = mod_theme

            themes[mod_theme] = DiscoveredTheme(
                name=mod_theme,
                keywords={mod_theme, 'mod'},
                spells=spell_infos,
                tier_distribution=dict(tier_dist),
                confidence=1.0
            )

        # PRIORITY 2: Cluster remaining spells
        if not HAS_SKLEARN or len(spell_info) < 10:
            basic_themes = self._discover_basic(spell_info)
            themes.update(basic_themes)
            self.discovered_themes = themes
            return themes

        # Vectorize
        self.vectorizer = TfidfVectorizer(
            max_features=800,
            stop_words=list(self.STOP_WORDS),
            ngram_range=(1, 2),
            min_df=1
        )

        try:
            self.spell_vectors = self.vectorizer.fit_transform(corpus)
            # Track which spells went through clustering (for cross-theme link indexing)
            self.clustered_spell_names = [s.get('name', '') for s in spell_info]
        except ValueError:
            basic_themes = self._discover_basic(spell_info)
            themes.update(basic_themes)
            self.discovered_themes = themes
            return themes

        # Determine cluster count - more clusters for larger spell sets
        n_clusters = min(self.max_themes, max(5, len(spell_info) // 30))

        # Cluster
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        labels = kmeans.fit_predict(self.spell_vectors)

        # Group spells by cluster
        clusters = defaultdict(list)
        for i, label in enumerate(labels):
            clusters[label].append((spell_info[i], i))  # Store index for vector lookup

        # Convert clusters to themes (add to existing mod-based themes)
        feature_names = self.vectorizer.get_feature_names_out()

        for cluster_id, cluster_items in clusters.items():
            cluster_spells = [item[0] for item in cluster_items]
            cluster_indices = [item[1] for item in cluster_items]

            if len(cluster_spells) < self.min_theme_size:
                continue

            # Get top keywords for this cluster
            cluster_vectors = self.spell_vectors[cluster_indices]
            avg_scores = np.asarray(cluster_vectors.mean(axis=0)).flatten()
            top_indices = avg_scores.argsort()[-15:][::-1]
            top_keywords = [feature_names[i] for i in top_indices if avg_scores[i] > 0]

            # Generate theme name
            theme_name = self._generate_theme_name(top_keywords, cluster_spells)

            # Build tier distribution
            tier_dist = Counter(s.get('skillLevel', s.get('tier', 'Unknown'))
                               for s in cluster_spells)

            # Create SpellInfo objects
            spell_infos = []
            for s in cluster_spells:
                info = SpellInfo(
                    name=s.get('name', ''),
                    tier=s.get('skillLevel', s.get('tier', 'Apprentice')),
                    editor_id=s.get('editorId', s.get('editor_id', '')),
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

            for s in cluster_spells:
                self.spell_to_theme[s['name']] = theme_name

        # Split large themes
        themes = self._split_large_themes(themes)

        self.discovered_themes = themes
        return themes

    def _split_large_themes(self, themes: Dict[str, DiscoveredTheme]) -> Dict[str, DiscoveredTheme]:
        """Split themes that are too large into sub-themes."""
        new_themes = {}

        for theme_name, theme in themes.items():
            if len(theme.spells) <= self.max_theme_size:
                new_themes[theme_name] = theme
                continue

            # This theme is too large - split by sub-category
            self._log('TIER1', f"Splitting large theme '{theme_name}' ({len(theme.spells)} spells)")

            # Group by category from editorId
            sub_groups = defaultdict(list)
            for spell in theme.spells:
                category = self.extract_category_from_editor_id(spell.editor_id)
                if category:
                    sub_groups[category].append(spell)
                else:
                    sub_groups['other'].append(spell)

            # Create sub-themes
            for sub_name, sub_spells in sub_groups.items():
                if len(sub_spells) < self.min_theme_size:
                    # Too small, merge into 'other'
                    sub_groups['other'].extend(sub_spells)
                    continue

                new_theme_name = f"{theme_name}_{sub_name}"

                # Update spell info
                for spell in sub_spells:
                    spell.theme = new_theme_name
                    spell.sub_theme = sub_name
                    self.spell_to_theme[spell.name] = new_theme_name

                tier_dist = Counter(s.tier for s in sub_spells)

                new_themes[new_theme_name] = DiscoveredTheme(
                    name=new_theme_name,
                    keywords=theme.keywords | {sub_name},
                    spells=sub_spells,
                    tier_distribution=dict(tier_dist),
                    confidence=len(sub_spells) / len(theme.spells)
                )

            # Handle 'other' group
            other_spells = sub_groups.get('other', [])
            if other_spells and len(other_spells) >= self.min_theme_size:
                for spell in other_spells:
                    spell.theme = theme_name
                    self.spell_to_theme[spell.name] = theme_name

                tier_dist = Counter(s.tier for s in other_spells)
                new_themes[theme_name] = DiscoveredTheme(
                    name=theme_name,
                    keywords=theme.keywords,
                    spells=other_spells,
                    tier_distribution=dict(tier_dist),
                    confidence=len(other_spells) / len(theme.spells)
                )

        return new_themes

    def _generate_theme_name(self, keywords: List[str], spells: List[Dict]) -> str:
        """Generate meaningful theme name."""
        if not keywords:
            return "arcane"

        # Prioritize category_ prefixed keywords
        for kw in keywords:
            if kw.startswith('category_'):
                return kw.replace('category_', '')
            if kw.startswith('element_'):
                return kw.replace('element_', '')
            if kw.startswith('effect_'):
                return kw.replace('effect_', '')
            if kw.startswith('summon_'):
                return kw.replace('summon_', '')

        # Count keyword frequency in spell names
        keyword_counts = Counter()
        for spell in spells:
            name = spell.get('name', '').lower()
            for kw in keywords[:8]:
                if kw in name and not kw.startswith(('category_', 'element_', 'effect_')):
                    keyword_counts[kw] += 1

        for kw, count in keyword_counts.most_common():
            if count >= 2 and len(kw) > 3:
                return kw

        # Fallback
        for kw in keywords:
            if len(kw) > 3 and not kw.startswith(('category_', 'element_')):
                return kw

        return keywords[0] if keywords else "arcane"

    def _discover_basic(self, spells: List[Dict]) -> Dict[str, DiscoveredTheme]:
        """Basic discovery without sklearn."""
        themes = defaultdict(list)

        for spell in spells:
            category = self.extract_category_from_editor_id(
                spell.get('editorId', spell.get('editor_id', ''))
            )
            if category:
                themes[category].append(spell)
            else:
                themes['arcane'].append(spell)

        result = {}
        for theme_name, theme_spells in themes.items():
            if len(theme_spells) < self.min_theme_size:
                themes['arcane'].extend(theme_spells)
                continue

            spell_infos = []
            for s in theme_spells:
                info = SpellInfo(
                    name=s.get('name', ''),
                    tier=s.get('skillLevel', s.get('tier', 'Apprentice')),
                    editor_id=s.get('editorId', s.get('editor_id', '')),
                    theme=theme_name
                )
                spell_infos.append(info)
                self.spell_info_map[info.name] = info
                self.spell_to_theme[info.name] = theme_name

            tier_dist = Counter(s.tier for s in spell_infos)
            result[theme_name] = DiscoveredTheme(
                name=theme_name,
                keywords={theme_name},
                spells=spell_infos,
                tier_distribution=dict(tier_dist)
            )

        self.discovered_themes = result
        return result

    def find_edge_cases(self, confidence_threshold: float = 0.3) -> List[Dict]:
        """Find spells with low confidence assignments (only for clustered spells)."""
        if not HAS_SKLEARN or self.spell_vectors is None:
            return []

        edge_cases = []
        clustered_names = set(self.clustered_spell_names)

        # Calculate cluster centroids (only for themes with clustered spells)
        theme_centroids = {}
        for theme_name in self.discovered_themes:
            # Only include spells that went through clustering
            theme_spells = [s.name for s in self.discovered_themes[theme_name].spells
                           if s.name in clustered_names]
            if not theme_spells:
                continue  # Skip mod-based themes

            indices = [i for i, name in enumerate(self.clustered_spell_names)
                      if name in theme_spells]
            if indices:
                centroid = self.spell_vectors[indices].mean(axis=0)
                theme_centroids[theme_name] = np.asarray(centroid).flatten()

        # Check each clustered spell
        for i, spell_name in enumerate(self.clustered_spell_names):
            assigned_theme = self.spell_to_theme.get(spell_name)
            if not assigned_theme or assigned_theme not in theme_centroids:
                continue

            spell_vec = self.spell_vectors[i].toarray().flatten()
            assigned_sim = cosine_similarity(
                spell_vec.reshape(1, -1),
                theme_centroids[assigned_theme].reshape(1, -1)
            )[0][0]

            if assigned_sim < confidence_threshold:
                edge_cases.append({
                    'spell': spell_name,
                    'assigned_theme': assigned_theme,
                    'confidence': assigned_sim,
                    'reason': 'Low confidence match'
                })

        return edge_cases

    def resolve_edge_cases_llm(self, edge_cases: List[Dict], school: str = "") -> Dict[str, str]:
        """Resolve edge cases using LLM API."""
        if not edge_cases or not self.llm_api_key or not HAS_REQUESTS:
            return {}

        # Build prompt
        themes_desc = "\n".join(
            f"- {name}: {', '.join(list(t.keywords)[:5])}"
            for name, t in self.discovered_themes.items()
        )

        spells_desc = "\n".join(
            f"- {ec['spell']} (currently: {ec['assigned_theme']})"
            for ec in edge_cases[:15]  # Limit batch size
        )

        prompt = f"""You are classifying spells for {school} school in Skyrim.

Available themes:
{themes_desc}

Classify these spells that need better theme assignment:
{spells_desc}

For each spell, respond with the best theme from the list.
Format each line as: SpellName: theme_name
Only output the classifications, nothing else."""

        try:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.llm_api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "anthropic/claude-3-haiku",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 500
                },
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                text = result['choices'][0]['message']['content']

                # Parse responses
                resolutions = {}
                for line in text.strip().split('\n'):
                    if ':' in line:
                        spell, theme = line.split(':', 1)
                        spell = spell.strip()
                        theme = theme.strip().lower()
                        if theme in self.discovered_themes:
                            resolutions[spell] = theme

                return resolutions
            else:
                print(f"  LLM API error: {response.status_code}")
                return {}

        except Exception as e:
            print(f"  LLM API exception: {e}")
            return {}


class ImprovedTreeBuilder:
    """Build trees with the improved discovery system."""

    TIER_ORDER = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master']

    def __init__(self,
                 root_count: int = 5,
                 cross_theme_links: bool = True,
                 affinity_threshold: int = 50):
        self.root_count = root_count
        self.cross_theme_links = cross_theme_links
        self.affinity_threshold = affinity_threshold

    def build_tree(self, spells: List[Dict], discovery: ImprovedThemeDiscovery) -> Dict:
        """Build tree with improved discovery."""
        themes = discovery.discover_themes(spells)

        if not themes:
            return {'themes': {}, 'nodes': [], 'links': [], 'roots': []}

        # Root count
        actual_root_count = self.root_count
        if actual_root_count == 0:
            actual_root_count = min(len(themes), 5)

        # Select roots
        roots = self._select_roots(themes, actual_root_count)

        # Build tree
        nodes = []
        links = []
        theme_lanes = self._assign_theme_lanes(themes, actual_root_count)

        for theme_name, theme in themes.items():
            lane_start = theme_lanes.get(theme_name, 0)
            theme_nodes, theme_links = self._build_theme_branch(theme, lane_start, roots)
            nodes.extend(theme_nodes)
            links.extend(theme_links)

        # Cross-theme links
        if self.cross_theme_links and HAS_SKLEARN:
            cross_links = self._create_cross_theme_links(nodes, themes, discovery)
            links.extend(cross_links)

        # Branch links - connect branch spells as children of their parent theme
        if discovery.branch_assignments:
            branch_links = self._create_branch_links(nodes, themes, discovery)
            links.extend(branch_links)

        return {
            'themes': {name: {
                'keywords': list(t.keywords)[:10],
                'spell_count': len(t.spells),
                'tiers': t.tier_distribution,
                'branch_spells': [s for s, t in discovery.branch_assignments.items() if t == name]
            } for name, t in themes.items()},
            'nodes': nodes,
            'links': links,
            'roots': roots,
            'branch_count': len(discovery.branch_assignments)
        }

    def _select_roots(self, themes: Dict[str, DiscoveredTheme], count: int) -> List[str]:
        """Select root spells - one per theme, no duplicates."""
        sorted_themes = sorted(themes.values(), key=lambda t: len(t.spells), reverse=True)

        roots = []
        used_names = set()

        for theme in sorted_themes:
            if len(roots) >= count:
                break

            # Find best unused spell in this theme
            best_spell = None
            best_tier_idx = 999

            for spell in theme.spells:
                if spell.name in used_names:
                    continue

                try:
                    tier_idx = self.TIER_ORDER.index(spell.tier)
                except ValueError:
                    tier_idx = 1

                if tier_idx < best_tier_idx:
                    best_tier_idx = tier_idx
                    best_spell = spell

            if best_spell and best_spell.name not in used_names:
                roots.append(best_spell.name)
                used_names.add(best_spell.name)

        return roots

    def _assign_theme_lanes(self, themes: Dict[str, DiscoveredTheme], root_count: int) -> Dict[str, int]:
        """Assign lanes to themes."""
        sorted_themes = sorted(themes.keys(), key=lambda t: len(themes[t].spells), reverse=True)
        lanes = {}
        lane = 0
        lane_width = max(3, 15 // max(1, len(themes)))

        for theme in sorted_themes:
            lanes[theme] = lane
            lane += lane_width

        return lanes

    def _build_theme_branch(self, theme: DiscoveredTheme, lane_start: int,
                            roots: List[str]) -> Tuple[List[Dict], List[Dict]]:
        """Build nodes and links for a theme branch with tier gap filling."""
        nodes = []
        links = []

        # Group by tier
        tier_spells: Dict[str, List[SpellInfo]] = defaultdict(list)
        for spell in theme.spells:
            tier_spells[spell.tier].append(spell)

        # Find the last tier that had spells (for gap filling)
        last_tier_with_spells = None
        last_tier_spell_names = []

        for tier_idx, tier in enumerate(self.TIER_ORDER):
            spells_in_tier = tier_spells.get(tier, [])

            for i, spell in enumerate(spells_in_tier):
                is_root = spell.name in roots

                node = {
                    'name': spell.name,
                    'theme': theme.name,
                    'tier': tier,
                    'tier_index': tier_idx,
                    'lane': lane_start + (i % 4),
                    'is_root': is_root
                }
                nodes.append(node)

                # Create link from previous tier (with gap filling)
                if last_tier_spell_names and not is_root:
                    # Link from last tier that had spells (fills gaps)
                    prereq = last_tier_spell_names[i % len(last_tier_spell_names)]
                    links.append({
                        'from': prereq,
                        'to': spell.name,
                        'type': 'progression'
                    })

            # Update last tier tracking (only if we had spells)
            if spells_in_tier:
                last_tier_with_spells = tier
                last_tier_spell_names = [s.name for s in spells_in_tier]

        return nodes, links

    def _create_cross_theme_links(self, nodes: List[Dict], themes: Dict[str, DiscoveredTheme],
                                   discovery: ImprovedThemeDiscovery) -> List[Dict]:
        """Create cross-theme links between clustered themes (not mod-based themes)."""
        cross_links = []

        if not discovery.vectorizer or discovery.spell_vectors is None:
            return cross_links

        # Only clustered spells have vectors - use clustered_spell_names for indexing
        clustered_names = set(discovery.clustered_spell_names)

        # Calculate theme centroids (only for themes with clustered spells)
        theme_centroids = {}
        for theme_name, theme in themes.items():
            # Get only spells that went through clustering
            spell_names = [s.name for s in theme.spells if s.name in clustered_names]
            if not spell_names:
                continue  # Skip mod-based themes with no clustered spells

            # Find indices in the clustered_spell_names list
            indices = [i for i, name in enumerate(discovery.clustered_spell_names)
                      if name in spell_names]
            if indices:
                centroid = discovery.spell_vectors[indices].mean(axis=0)
                theme_centroids[theme_name] = np.asarray(centroid).flatten()

        # Find high-affinity pairs
        theme_names = list(themes.keys())
        for i, t1 in enumerate(theme_names):
            for t2 in theme_names[i+1:]:
                if t1 not in theme_centroids or t2 not in theme_centroids:
                    continue

                sim = cosine_similarity(
                    theme_centroids[t1].reshape(1, -1),
                    theme_centroids[t2].reshape(1, -1)
                )[0][0]
                affinity = int(sim * 100)

                if affinity >= self.affinity_threshold:
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

    def _create_branch_links(self, nodes: List[Dict], themes: Dict[str, DiscoveredTheme],
                              discovery: ImprovedThemeDiscovery) -> List[Dict]:
        """Create links from branch spells to their parent theme spells.

        Branch spells (from mods with weak thematic keywords) are linked as children
        of spells in their parent theme, creating a hierarchical branch structure.

        Example: Stone Spray (natura) -> linked as child of Earthquake (earth theme)
        """
        branch_links = []

        if not discovery.branch_assignments:
            return branch_links

        # Build node lookup
        node_by_name = {n['name']: n for n in nodes}

        # Group branch spells by parent theme
        branches_by_theme = defaultdict(list)
        for spell_name, parent_theme in discovery.branch_assignments.items():
            branches_by_theme[parent_theme].append(spell_name)

        # For each parent theme, find suitable parent spells for branches
        for parent_theme, branch_spell_names in branches_by_theme.items():
            # Find spells in the parent theme (potential parents for branches)
            parent_theme_nodes = [n for n in nodes
                                  if n.get('theme', '').startswith(parent_theme)
                                  and n['name'] not in branch_spell_names]

            if not parent_theme_nodes:
                continue

            # Sort parent nodes by tier (higher tier = better parent for branch)
            tier_order = {t: i for i, t in enumerate(self.TIER_ORDER)}
            parent_theme_nodes.sort(
                key=lambda n: tier_order.get(n.get('tier', 'Novice'), 0),
                reverse=True
            )

            # Link each branch spell to a parent in the theme
            for i, branch_name in enumerate(branch_spell_names):
                if branch_name not in node_by_name:
                    continue

                branch_node = node_by_name[branch_name]

                # Find a suitable parent (same or lower tier)
                branch_tier_idx = tier_order.get(branch_node.get('tier', 'Novice'), 0)

                for parent_node in parent_theme_nodes:
                    parent_tier_idx = tier_order.get(parent_node.get('tier', 'Novice'), 0)

                    # Parent should be same or lower tier
                    if parent_tier_idx <= branch_tier_idx:
                        branch_links.append({
                            'from': parent_node['name'],
                            'to': branch_name,
                            'type': 'branch',
                            'parent_theme': parent_theme
                        })
                        break

        if branch_links:
            # Log branch link creation for verification
            by_theme = Counter(l['parent_theme'] for l in branch_links)
            if hasattr(discovery, '_log'):
                discovery._log('TIER2', f'Created {len(branch_links)} branch links', {
                    'by_theme': dict(by_theme)
                })

        return branch_links


def run_improved_test():
    """Run test with improved discovery."""
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
        print("ERROR: No scan directory found")
        return

    # Check for LLM API key
    llm_api_key = os.environ.get('OPENROUTER_API_KEY')
    if llm_api_key:
        print("=" * 80)
        print("IMPROVED THEME DISCOVERY TEST (WITH LLM ROUTING)")
        print("=" * 80)
        print(f"\nLLM API Key: {llm_api_key[:20]}...")
    else:
        print("=" * 80)
        print("IMPROVED THEME DISCOVERY TEST (NO LLM)")
        print("=" * 80)
        print("\nTip: Set OPENROUTER_API_KEY env var to enable LLM routing")

    print(f"\nUsing scans from: {scan_dir}")
    print("\nPriority order:")
    print("  1. Strong thematic keywords -> cluster (no LLM needed)")
    print("  2. Ambiguous mod spells -> LLM decides cluster vs mod" if llm_api_key else "  2. Mod spells -> mod theme (no LLM)")
    print("  3. Dynamic clustering -> TF-IDF + KMeans")
    print("  4. LLM edge case correction (post-clustering)\n")

    for scan_file in sorted(scan_dir.glob("*_spells.json")):
        school = scan_file.stem.replace("_spells", "").title()

        with open(scan_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        spells = data.get('spells', [])
        if not spells:
            continue

        print("#" * 80)
        print(f"# {school.upper()} ({len(spells)} spells)")
        print("#" * 80)

        discovery = ImprovedThemeDiscovery(
            min_theme_size=3,
            max_themes=15,
            max_theme_size=80,
            llm_api_key=llm_api_key
        )

        builder = ImprovedTreeBuilder(root_count=5, cross_theme_links=True)
        tree = builder.build_tree(spells, discovery)

        print(f"\nDiscovered {len(tree['themes'])} themes:")
        for name, info in sorted(tree['themes'].items(),
                                 key=lambda x: x[1]['spell_count'], reverse=True):
            print(f"  {name}: {info['spell_count']} spells")

        print(f"\nTree: {len(tree['roots'])} roots, {len(tree['links'])} links")
        print(f"Roots: {tree['roots'][:5]}")

        # Edge cases
        edge_cases = discovery.find_edge_cases(0.3)
        print(f"Edge cases: {len(edge_cases)} ({len(edge_cases)/len(spells)*100:.1f}%)")

        # Show LLM routing decisions if any
        if discovery.llm_routing_log:
            print(f"\nLLM Routing Decisions ({len(discovery.llm_routing_log)}):")
            for decision in discovery.llm_routing_log[:5]:  # Show first 5
                arrow = "-> cluster" if decision['decision'] == 'cluster' else "-> mod"
                print(f"  {decision['spell']}: [{', '.join(decision['keywords'])}] {arrow}")
            if len(discovery.llm_routing_log) > 5:
                print(f"  ... and {len(discovery.llm_routing_log) - 5} more")

        # Save
        output_dir = Path(__file__).parent / "test_output"
        output_dir.mkdir(exist_ok=True)
        output_file = output_dir / f"{school}_improved_tree.json"

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump({
                'school': school,
                'ruleset': 'improved',
                'themes': tree['themes'],
                'nodes': tree['nodes'],
                'links': tree['links'],
                'roots': tree['roots'],
                'edge_case_count': len(edge_cases)
            }, f, indent=2)

        print(f"Saved: {output_file.name}\n")


if __name__ == '__main__':
    run_improved_test()
