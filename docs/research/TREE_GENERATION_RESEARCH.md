# Tree Generation Research: Algorithms, NLP, and LLM Approaches

Research into more effective generation patterns for spell trees — covering traditional algorithms, NLP similarity techniques, LLM-based solutions, and hybrid strategies that mix them.

**Context**: Heart of Magic builds spell progression trees from ~500 flat spells with names, short descriptions, school/tier metadata. Trees must be parent-child hierarchies where parent=prerequisite, child=unlock. Runs as a Skyrim SKSE mod addon with a Python backend.

---

## Table of Contents

1. [Current System Analysis](#1-current-system-analysis)
2. [NLP Similarity: Beyond TF-IDF](#2-nlp-similarity-beyond-tf-idf)
3. [Tree Generation Algorithms](#3-tree-generation-algorithms)
4. [LLM-Based Approaches](#4-llm-based-approaches)
5. [Hybrid Strategies](#5-hybrid-strategies)
6. [Dependency Budget](#6-dependency-budget)
7. [Grid-Aware Tree Building](#7-grid-aware-tree-building)
8. [Recommendations](#8-recommendations)

---

## 1. Current System Analysis

### What We Have

Six distinct NLP implementations across the codebase:

| Implementation | Technique | Location | Accuracy | Speed |
|---|---|---|---|---|
| Theme Discovery | sklearn TF-IDF (bigrams) | `theme_discovery.py` | High | Slow |
| Tree Builder | Composite scoring (TF-IDF + tier + theme) | `tree_builder.py` | High | Slow |
| Classic Builder | Jaccard similarity + theme counting | `classic_build_tree.py` | Medium | Fast |
| PreReqMaster Scorer | Pure-Python TF-IDF cosine | `prereq_master_scorer.py` | Medium | Fast |
| Fuzzy Relationships | sklearn cosine_similarity matrix | `build_tree.py` | Medium | Slow |
| Procedural JS | Simplified TF-IDF + substring matching | `proceduralTreeBuilder.js` | Low | Very Fast |

### Current Scoring Formulas

**Tree Builder (primary)** — composite parent selection:
```
score = 0
if same_theme:          score += 100
if cross_theme:         score -= 50
if tier_diff == 1:      score += 50    # adjacent tier
if tier_diff == 2:      score += 30    # skip one
if tier_diff > 2:       score -= 20    # penalize large jumps
if tier_diff <= 0:      score -= 100   # prevent upward links
score -= (children_ratio * 30)         # capacity balancing
score += (cosine_sim * 60)             # NLP text similarity
score += random.uniform(-5, 5)         # jitter
```

**Classic Builder** — simpler tier-first:
```
score = 0
if same_theme:          score += 10
else:                   score -= 2
score += jaccard_sim * 5
score -= child_count * 1.5
if depth == tier - 1:   score += 2     # immediate predecessor
score += random.uniform(-0.5, 0.5)
```

**PreReqMaster** — proximity-blended NLP:
```
final = (1 - proximity_bias) * nlp_score + proximity_bias * proximity_score
nlp_score = cosine_similarity(tfidf_vector_a, tfidf_vector_b)
proximity_score = max(0, 1 - (distance / max_distance))
```

### Known Weaknesses

1. **No semantic understanding** — bag-of-words treats "paralyze" and "stun" as unrelated. "Flame" and "Fire" get zero similarity in word-level TF-IDF
2. **IDF formula inconsistency** — three different smoothing formulas across implementations
3. **Substring matching in JS** — `"fire"` matches `"firewall"`, false positives
4. **O(n²) pairwise computation** — full similarity matrix rebuilt every time, no caching
5. **Threshold proliferation** — hard-coded values (0.05, 0.1, 30, 50, 100) tuned by trial and error
6. **Domain stop words remove useful terms** — "restore" filtered out but critical for Restoration spells
7. **Jaccard ignores word importance** — all words weighted equally in Classic builder
8. **No morphological awareness** — "Firebolt" and "Fireball" share the "Fire-" prefix but get zero word-overlap credit

---

## 2. NLP Similarity: Beyond TF-IDF

### Tier 1: Zero New Dependencies (scikit-learn only)

#### Character N-Gram TF-IDF

Replace word-level TF-IDF with character n-grams for spell **names**. scikit-learn already supports this.

```python
from sklearn.feature_extraction.text import TfidfVectorizer
vectorizer = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4))
sim_matrix = cosine_similarity(vectorizer.fit_transform(spell_names))
```

How it works: decomposes "Firebolt" into `{Fi, ir, re, eb, bo, ol, lt, Fir, ire, reb, ...}`. "Fireball" shares `{Fi, ir, re, eb, Fir, ire, reb, Fire, ireb}` — high cosine similarity despite being different words.

| Spell A | Spell B | Word TF-IDF | Char N-Gram |
|---------|---------|-------------|-------------|
| Firebolt | Fireball | 0.0 | ~0.75 |
| Frost Cloak | Frost Atronach | ~0.5 | ~0.6 |
| Flames | Fire Storm | 0.0 | ~0.3 |
| Blizzard | Frost | 0.0 | 0.0 |

**Strength**: Catches all "Fire-", "Frost-", "Conjure-" prefix families perfectly. Zero new dependencies.
**Weakness**: Purely morphological. "Blizzard" and "Frost" share no character n-grams.
**Verdict**: Should be the first upgrade. Massive improvement for spell names at zero cost.

#### BM25 / BM25+

Adds term-frequency saturation and length normalization to TF-IDF. BM25+ fixes bias against short docs.

**Verdict**: Marginal improvement. The features BM25 adds solve problems that barely exist in 1-4 word spell names. Not worth the switch.

### Tier 2: Add Metadata Similarity (~0 MB extra)

#### Hybrid Text + Metadata Scoring

Combine text similarity with categorical features already in the data:

```python
alpha, beta, gamma = 0.3, 0.4, 0.3
combined = (alpha * name_char_ngram_sim +
            beta  * desc_word_tfidf_sim +
            gamma * metadata_sim)

# metadata_sim components:
# same school: +1.0, same tier: +0.5, same element: +0.8, same cast type: +0.3
```

This alone may solve "Blizzard"/"Frost" — both are frost-element Destruction spells.

**Verdict**: Strongly recommended as the combination layer. Most controllable approach.

### Tier 3: Semantic Embeddings (~100-150 MB)

#### Compressed FastText (Best for Names)

FastText decomposes words into character n-grams (3-6 chars) and sums their embeddings. Produces meaningful vectors for **any string**, including game-invented words never seen in training.

```
"Firebolt" → <Fi, Fir, ire, reb, ebo, bol, olt, lt> → sum → dense vector
"Fireball" → <Fi, Fir, ire, reb, eba, bal, all, ll> → sum → dense vector
```

Shared n-grams produce similar vectors. Unlike char n-gram TF-IDF, FastText also knows that "Fire" and "Flame" are semantically related from pre-training.

- **Library**: gensim (~50 MB) + `compress-fasttext` to shrink the model to ~20-50 MB
- **Handles**: OOV words, compound game terms, morphological patterns
- **Verdict**: Best technique for spell name similarity specifically. Subword decomposition is almost purpose-built for game terminology.

#### Word Mover's Distance (Best for Short Pairs)

Computes the minimum "travel cost" to transform one document's word distribution into another's through embedding space.

```
WMD("Ice Storm", "Frost Blizzard") → low distance
  "Ice" travels to "Frost" (nearby in embedding space)
  "Storm" travels to "Blizzard" (nearby in embedding space)
```

With 1-4 words per document the transportation problem is tiny. Each pair computation is instant.

- **Library**: gensim `wmdistance()` + GloVe 50d vectors (~70 MB)
- **Strength**: Captures semantic relationships TF-IDF completely misses
- **Weakness**: Compound words ("Firebolt") are single tokens, may be OOV → use FastText vectors instead of GloVe

#### Soft Cosine Similarity (Middle Ground)

Standard cosine treats every word dimension as independent. Soft Cosine uses a word-similarity matrix so that "Fire" and "Flame" are not treated as orthogonal.

- **Library**: gensim `SoftCosineSimilarity` + word embeddings
- **Verdict**: Strong middle ground between pure TF-IDF and full neural. Captures synonyms without transformer overhead.

### Tier 4: Neural Sentence Embeddings (~150 MB with FastEmbed)

#### FastEmbed + ONNX Runtime (No PyTorch)

Sentence-transformers normally require PyTorch (~2 GB). **FastEmbed** by Qdrant uses ONNX Runtime instead — total ~150 MB.

```python
from fastembed import TextEmbedding
model = TextEmbedding("BAAI/bge-small-en-v1.5")  # 33 MB, 384-dim
vectors = list(model.embed(["Firebolt: A bolt of fire that does 25 damage"]))
```

Best for descriptions (5-20 words). Concatenate name + description for best results.

| Model | Size | Dimensions | Notes |
|---|---|---|---|
| `bge-small-en-v1.5` | 33 MB | 384 | FastEmbed default, CPU-optimized |
| `all-MiniLM-L6-v2` | 22 MB | 384 | Most popular lightweight |
| `all-MiniLM-L12-v2` | ~50 MB | 384 | Slightly better quality |

**Verdict**: Best semantic quality. 500 spells embeds in 1-3 seconds on CPU. The ~150 MB footprint is the tradeoff.

### Pre-Computed Embeddings Strategy

Compute vectors at dev time with the best model available, ship only the vectors:

```python
# Dev time: use sentence-transformers with full PyTorch
vectors = model.encode(all_spell_texts)
np.save("spell_vectors.npy", vectors)  # ~150 KB for 500 spells × 384 dims
```

At runtime: load the .npy file, run clustering. Zero heavy dependencies for the end user.

---

## 3. Tree Generation Algorithms

### Hierarchical Agglomerative Clustering

Each spell starts as its own cluster. The two most similar clusters merge repeatedly. The merge history IS the tree (dendrogram).

```python
from scipy.cluster.hierarchy import linkage, to_tree
Z = linkage(distance_matrix, method='ward')
root = to_tree(Z)  # ClusterNode with .left, .right, .dist
```

**Ward's method** minimizes within-cluster variance → balanced, even clusters.

| Aspect | Detail |
|---|---|
| Output | Binary tree (dendrogram) |
| Post-processing | Flatten shallow merges into multi-child nodes |
| Complexity | O(n² log n) with Ward + nearest-neighbor chain |
| Dependencies | scipy (~35 MB) — we already have it |
| Deterministic | Yes |

**Pros**: Directly produces a tree. Mature, rock-solid. Ward gives balanced clusters.
**Cons**: Binary-only from raw output. No inherent directionality (similarity grouping, not prerequisite ordering). Ward technically requires Euclidean distance.

### Minimum Spanning Tree (Prim's / Kruskal's)

Build a complete similarity graph, extract the minimum-weight spanning tree: the subset of edges connecting all nodes with minimum total cost.

```python
import networkx as nx
G = nx.Graph()
for i, j in pairs:
    G.add_edge(spell_i, spell_j, weight=1 - similarity[i][j])
mst = nx.minimum_spanning_tree(G, algorithm='kruskal')
```

| Aspect | Detail |
|---|---|
| Output | Multi-child tree (natural) |
| Post-processing | Choose root, orient edges |
| Complexity | O(E log V) |
| Dependencies | NetworkX (~5 MB) — pure Python |
| Deterministic | Yes |

**Pros**: Naturally produces multi-child trees. Very fast. 3-line implementation.
**Cons**: **Star topology risk** — one generic spell becomes a hub with dozens of children. Sensitive to distance metric. No inherent hierarchy of abstraction.

### Edmonds' Algorithm (Directed Minimum Spanning Arborescence)

The **directed** version of MST. Given a root and directed edge weights, finds the optimal directed tree.

```python
mst = nx.minimum_spanning_arborescence(directed_graph)
```

| Aspect | Detail |
|---|---|
| Output | Directed rooted tree — exactly a skill tree |
| Post-processing | None — ready to use |
| Complexity | O(EV) standard, O(E + V log V) optimized |
| Dependencies | NetworkX (built-in) |

**Pros**: Produces a directed, rooted tree. Can encode asymmetric relationships (A is a good parent for B ≠ B is a good parent for A). Optimal solution, not an approximation.
**Cons**: Must define directed edge weights (what makes A a good parent of B?). Root choice affects entire structure.

**Key insight**: This lets us encode domain knowledge directly:
```python
# Edge weight = cost of B being a child of A
weight = (1.0 - text_similarity) * 0.4       # NLP distance
       + tier_penalty(A, B) * 0.3             # lower tier should parent higher
       + school_mismatch(A, B) * 0.2          # same school preferred
       + capacity_penalty(A) * 0.1            # balance child count
```

### Community Detection → Tree (Louvain / Leiden)

Two-phase: discover natural groupings, then build tree from communities.

**Phase 1**: Leiden algorithm at multiple resolution parameters
**Phase 2**: Stack resolution levels — coarsest = schools, finest = individual spells

```python
# Phase 1: Multi-resolution community detection
import leidenalg, igraph
coarse = leidenalg.find_partition(G, resolution=0.5)   # ~5 schools
medium = leidenalg.find_partition(G, resolution=1.0)   # ~20 sub-schools
fine   = leidenalg.find_partition(G, resolution=2.0)   # ~80 spell groups

# Phase 2: Stack into tree
# Root → Schools → Sub-schools → Spell groups → Individual spells
```

| Aspect | Detail |
|---|---|
| Output | Multi-level hierarchy with meaningful intermediate nodes |
| Complexity | O(n log n) amortized |
| Dependencies | `leidenalg` (~1 MB) + `python-igraph` (~10 MB) |
| Deterministic | No (but stable with enough resolution levels) |

**Pros**: Produces natural "school" groupings. Multi-resolution gives explicit depth control. Intermediate nodes are semantically meaningful.
**Cons**: Two-phase pipeline. Non-deterministic. Intermediate nodes need naming.

**Lightweight alternative**: Louvain via `python-louvain` (~100 KB) + NetworkX. Lower quality but minimal dependencies.

### Algorithm Comparison

| Algorithm | Produces Tree? | Directed? | Multi-Child? | Meaningful Inner Nodes? | Min Dependency |
|---|---|---|---|---|---|
| Agglomerative | Yes (binary) | No | After flattening | No | scipy (35 MB) |
| MST (Kruskal) | Yes | After rooting | Natural | No | NetworkX (5 MB) |
| Edmonds' | Yes | Yes (native) | Natural | No | NetworkX (0 extra) |
| Leiden Communities | With post-processing | After rooting | Natural | Yes | igraph (10 MB) |
| Louvain | With post-processing | After rooting | Natural | Yes | python-louvain (100 KB) |

---

## 4. LLM-Based Approaches

### Direct Taxonomy Generation (API)

Feed the LLM a flat spell list, get back a hierarchy as structured JSON.

```
Prompt: "Organize these Destruction spells into a skill tree hierarchy.
         Novice spells should be near the root, Master at the leaves.
         Group by elemental theme (fire, frost, shock).
         Return as JSON matching this schema: {...}"
```

| Aspect | Detail |
|---|---|
| Quality | GPT-4/Claude: good. Smaller models: inconsistent |
| Cost (500 spells) | $0.05-$0.50 via Claude Haiku batch |
| Offline | No — requires API |
| Deterministic | No |

**Gotcha**: LLMs produce logically backwards relationships (parent/child swapped) and internal inconsistencies in large taxonomies. Best used for sub-tasks (classify 50 spells per batch) not full taxonomy at once.

### LLM-Assisted Embedding + Clustering

Use a transformer model to embed spells, then algorithmic clustering for structure.

```
Step 1: Embed with all-MiniLM-L6-v2 (22 MB model, offline)
Step 2: Agglomerative clustering with scipy (offline)
Step 3: Cut dendrogram at 3-4 levels
Step 4: Name clusters with LLM (optional, API or local)
```

**Key tool discovered**: [pyhercules](https://github.com/bandeerun/pyhercules) (MIT) — recursive k-means + LLM cluster labeling. Supports local models. Directly applicable to spell trees.

**Verdict**: Strongest fully-offline approach. Embedding is free and fast. Clustering is deterministic. LLM naming is optional.

### Few-Shot Tree Construction

Provide 2-5 hand-crafted example subtrees, ask LLM to extend the pattern.

```
Example:
Destruction → Fire Magic → Basic Fire → [Flames (Novice), Firebolt (Apprentice)]

Now organize [these Conjuration spells] the same way.
```

**Verdict**: High quality when examples are well-crafted. Low code complexity — primarily prompt engineering. Requires API.

### Local Small Models for Classification

Run a small model locally to classify spells into categories, then build tree algorithmically.

| Model | Params | RAM | Best For |
|---|---|---|---|
| Phi-4 Mini | ~4B | ~4 GB | Best quality/size for structured tasks |
| Mistral 7B Instruct | 7B | ~6 GB | Strong instruction following |
| Qwen 2 0.5B | 0.5B | ~1 GB | Ultra-lightweight basic classification |

With Ollama + GBNF grammars, output is constrained to valid JSON schemas.

**Critical insight**: Small models handle enum classification well (fire vs frost vs shock) but struggle with designing tree structure. Use as classification step → feed into algorithmic tree construction.

### RAG with Elder Scrolls Lore

Build a vector index over Elder Scrolls wiki data, retrieve context per spell.

**Resource**: [Elder Scrolls Wiki Dataset](https://huggingface.co/datasets/RoyalCities/Elder_Scrolls_Wiki_Dataset) — 27,778 UESP pages, CC BY-SA 2.5.

**Verdict**: Overkill when school/tier metadata already exists. Valuable when spells come from multiple mods with inconsistent categorization.

### Build-Time vs Runtime

Tree generation is a **build-time** task (user clicks "Build Tree" once), not a runtime task (every frame). This means:

- Heavier algorithms are acceptable (5-30 second build is fine)
- API calls are viable (one-time cost, not per-frame)
- Pre-computation strategies work (embed once, ship vectors)
- End users don't need LLM infrastructure — mod author generates trees, ships the JSON

---

## 5. Hybrid Strategies

### Strategy A: Char N-Grams + Metadata (Minimal — ~30 MB)

Zero new dependencies. Immediate quality boost.

```
1. Character n-gram TF-IDF on spell names (morphological matching)
2. Word-level TF-IDF on descriptions (semantic matching)
3. Metadata similarity (school, tier, element)
4. Weighted combination → distance matrix
5. Agglomerative clustering OR existing tree_builder with better similarity
```

**Expected improvement**: "Firebolt"/"Fireball" now cluster together. Same-school same-tier spells strongly grouped. Still misses "Blizzard"/"Frost" semantic link.

### Strategy B: FastText + Edmonds' (Medium — ~100 MB)

Best quality without neural sentence models.

```
1. Compressed FastText embeddings for spell names (subword-aware)
2. Word-level TF-IDF for descriptions
3. Metadata features
4. Weighted combination → directed edge weights
5. Edmonds' arborescence → directed rooted tree per school
6. Post-process: inject tier ordering as constraint
```

**Expected improvement**: "Blizzard" and "Frost" now semantically linked. Subword handling catches all compound game terms. Directed tree means prerequisite relationships are first-class.

### Strategy C: Neural Embed + Leiden + MST (Full — ~150 MB)

Highest quality. Mirrors Skyrim's actual skill tree structure.

```
1. FastEmbed bge-small-en-v1.5 on name+description (384-dim vectors)
2. Leiden community detection at coarse resolution → spell schools
3. MST or Edmonds' within each school → prerequisite chains
4. Inject tier metadata as depth constraints (Novice=shallow, Master=deep)
5. Validate: no cycles, all nodes reachable, tier ordering respected
```

**Expected improvement**: Schools discovered from text (not just metadata). Within-school grouping by theme and progression. Best semantic understanding.

### Strategy D: Pre-Computed Vectors (Ship ~150 KB, Runtime ~35 MB)

Best quality with minimal end-user footprint.

```
Dev time:
1. sentence-transformers all-MiniLM-L6-v2 embeds all known spells
2. Save as spell_vectors.npy (~150 KB)
3. Ship with mod

Runtime:
1. Load spell_vectors.npy
2. For unknown spells (modded): char n-gram fallback
3. Agglomerative clustering → tree
4. Only scipy + numpy needed (~35 MB)
```

### Strategy E: LLM Hybrid (Best — API at build time)

Combine algorithmic rigor with LLM semantic understanding.

```
1. Embed all spells with FastEmbed (offline, free)
2. Reduce to 5-10 dimensions with PCA
3. Agglomerative clustering with Ward linkage
4. Cut dendrogram at 3-4 levels
5. Name clusters via Claude Haiku ($0.05 total) or local Phi-4 Mini
6. Validate against hand-crafted example trees
7. Ship pre-built tree JSON — no user-side LLM needed
```

---

## 6. Dependency Budget

Current system requires: `sklearn` (~30 MB), `numpy` (~25 MB) = ~55 MB base.

| Strategy | Additional Dependencies | Total Footprint | Quality Gain |
|---|---|---|---|
| A: Char N-Grams | None | ~55 MB (current) | Moderate |
| B: FastText + Edmonds' | gensim (~50 MB), NetworkX (~5 MB) | ~110 MB | High |
| C: Neural + Leiden | FastEmbed (~150 MB), leidenalg (~1 MB), igraph (~10 MB) | ~215 MB | Highest |
| D: Pre-Computed | None at runtime | ~55 MB (current) | Highest (dev-time cost) |
| E: LLM Hybrid | FastEmbed (~150 MB) + API key | ~205 MB + API | Highest + named clusters |

### Library Size Reference

| Library | Install Size | Purpose |
|---|---|---|
| scikit-learn | ~30 MB | TF-IDF, clustering (already have) |
| numpy | ~25 MB | Matrix operations (already have) |
| scipy | ~35 MB | Hierarchical clustering, linkage |
| NetworkX | ~5 MB | Graph algorithms, MST, Edmonds' |
| gensim | ~50 MB | Word2Vec, FastText, WMD, Soft Cosine |
| compress-fasttext | ~5 MB | Shrink FastText models to 20-50 MB |
| FastEmbed (ONNX) | ~150 MB | Neural embeddings without PyTorch |
| python-louvain | ~100 KB | Community detection (lightweight) |
| leidenalg + igraph | ~11 MB | Community detection (best quality) |
| sentence-transformers | ~2 GB+ | Neural embeddings (dev-time only) |

---

## 7. Grid-Aware Tree Building

### The Architectural Gap

Every algorithm in this document — TF-IDF clustering, MST, Edmonds', Leiden, LLM-assisted — produces **abstract tree structure** (parent-child links). None of them know about the **visual grid** where nodes will be placed. The current pipeline has a hard wall between structure and layout:

```
Python Builder                    JS Layout Engine
─────────────                    ─────────────────
Builds parent-child links   →   Places nodes on grid points
Knows: spell text, tier          Knows: grid shape, coordinates
Does NOT know: grid mode,        Does NOT know: why spells are
  available space, radial           linked, thematic grouping
  tiers, angular sectors
```

This means a structurally "perfect" tree (great thematic grouping) can render poorly if its shape doesn't match the grid. And the builder has no way to know what shape would render well.

### Current Grid System

Root Preview generates two types of grids:

**SUN mode (radial)**: Concentric rings around center. Schools occupy angular sectors.
- Grid types: naive (uniform), linear (variable density), fibonacci (spiral), square, equalArea
- Key params: `spokes` (angular divisions), `tiers` (radial rings), `tierSpacing` (ring gap), `ringRadius` (where roots sit)
- Each grid point has pre-computed `_neighbors[]` for BFS traversal

**FLAT mode (linear)**: Cartesian grid. Schools occupy segments along a line.
- Key params: `spacing` (cell size), `lineLength`, `direction` (horizontal/vertical)
- Same neighbor-based BFS placement as SUN

**What layout gets from the grid**: `gridPoints[]` with coordinates + neighbors, `schools[]` with arc/segment boundaries, utility functions like `getSchoolAtAngle()`.

**What happens when tree overflows**: Dynamic grid expansion (`_densifyGrid()`) adds midpoints and radial extensions for up to 50 rounds. Nodes that still can't fit are silently dropped.

### Current Shape Controls (All JS-Side, Visual Only)

| Control | Effect | Location |
|---|---|---|
| Tier zones | Radial band per skill level (Novice inner, Master outer) | classicSettings.js |
| Spread slider | Dense (clustered center) vs sparse (sprawling) | classicSettings.js |
| Grid type | Point distribution pattern (naive/fibonacci/square/etc.) | treePreviewSun.js |
| SUN vs FLAT | Radial vs linear root line | Root preview toggle |
| Fan-out cap | Max 5 children placed per BFS wave | classicLayout.js |
| Theme sectors | Angular bias for spell themes | classicLayout.js |
| Dynamic expansion | Auto-add grid points when tree overflows | classicLayout.js |

None of these change tree **structure** — they only change where existing nodes land.

### Missing: Structural Shape Controls (Python-Side)

The tree builder needs to know the grid's shape to produce trees that render well. Here are the levers:

#### Max Branching Factor (Width Control)

Already exists as `max_children_per_node` but only as a soft scoring penalty. Making it a **hard cap** prevents pathological shapes:

```python
# Soft (current): score -= children_ratio * 30
# Hard (proposed): if len(candidate.children) >= max_children: skip candidate
```

| Grid Mode | Recommended Max Children |
|---|---|
| SUN (few spokes) | 3-4 (angular space is limited) |
| SUN (many spokes) | 5-6 |
| FLAT (horizontal) | 4-5 (vertical spread is limited) |
| FLAT (vertical) | 6-8 (more room to spread) |

#### Target Depth (Depth Control)

Force tree depth to match available grid space:

```python
if grid_hint and grid_hint['mode'] == 'sun':
    target_depth = grid_hint['tiers']           # match radial rings
elif grid_hint and grid_hint['mode'] == 'flat':
    target_depth = grid_hint['growth_columns']   # match linear growth space
else:
    target_depth = 5                             # default (Novice→Master)
```

For algorithms that produce dendrograms (agglomerative clustering), depth is controlled by **where you cut**:
- Cut high (few clusters) → shallow, wide tree → good for SUN with few tiers
- Cut low (many clusters) → deep, narrow tree → good for FLAT with long growth axis
- Multi-level cuts at tier boundaries → controlled depth matching grid exactly

#### Balance Ratio (Evenness Control)

Controls how even subtrees are. Affects visual density distribution.

```python
# After tree is built, rebalance:
for node in tree:
    if len(node.children) > target_max:
        # Split overloaded node: create intermediate grouping nodes
        groups = cluster_children(node.children, target_max)
        node.children = [make_group_node(g) for g in groups]
```

Ward linkage naturally produces balanced trees. MST and Edmonds' don't — they need post-processing.

#### Shape Profiles

Tell the builder what overall silhouette to aim for:

| Profile | Description | Best For | How to Achieve |
|---|---|---|---|
| **Cone** | Few nodes near root, many at leaves | SUN radial (natural skill tree look) | Increase max_children at deeper tiers |
| **Column** | Even width at every depth | FLAT linear grids | Fixed max_children across all depths |
| **Fan** | Wide and shallow (depth 2-3) | SUN with few radial tiers | Low target_depth, high max_children |
| **Diamond** | Narrow root, wide middle, narrow leaves | Dense radial with tier zones | Variable max_children by depth |
| **Vine** | Long chains with occasional branches | FLAT vertical (tall narrow space) | Low max_children (2-3), high target_depth |

Implementation: map shape profile to per-depth branching limits:

```python
SHAPE_PROFILES = {
    'cone':    lambda depth, max_d: 2 + depth,              # wider at leaves
    'column':  lambda depth, max_d: 4,                       # constant width
    'fan':     lambda depth, max_d: max(8 - depth * 2, 2),  # wide at top
    'diamond': lambda depth, max_d: 4 + 2 * (1 - abs(2 * depth/max_d - 1)),
    'vine':    lambda depth, max_d: 2,                       # always narrow
}

def max_children_at_depth(depth, profile='cone', max_depth=5):
    return SHAPE_PROFILES[profile](depth, max_depth)
```

### Passing Grid Hints to Python

To close the feedback gap, JS would pass grid metadata when triggering a build:

```javascript
// In classicMain.js buildTree():
var gridData = TreePreview.getOutput();
var gridHint = {
    mode: gridData.mode,                        // 'sun' or 'flat'
    tiers: gridData.grid.tiers || null,         // radial rings (SUN)
    spokes: gridData.grid.spokes || null,       // angular divisions (SUN)
    spacing: gridData.grid.spacing || null,     // cell size (FLAT)
    columns: gridData.grid.linePoints || null,  // growth columns (FLAT)
    schoolCount: gridData.schools.length,
    avgPointsPerSchool: Math.floor(gridData.gridPoints.length / gridData.schools.length)
};

window.callCpp('ProceduralPythonGenerate', JSON.stringify({
    command: 'build_tree_classic',
    spells: spellsToProcess,
    config: config,
    grid_hint: gridHint    // NEW: grid shape metadata
}));
```

Python builder uses hints as soft constraints:

```python
def classic_build_tree_from_data(spells, config_dict):
    grid = config_dict.get('grid_hint', {})

    if grid.get('mode') == 'sun':
        max_depth = min(grid.get('tiers', 5), 8)
        base_branching = max(grid.get('spokes', 10) // (grid.get('schoolCount', 5) * 2), 3)
    elif grid.get('mode') == 'flat':
        max_depth = min(grid.get('columns', 20), 15)
        base_branching = 4
    else:
        max_depth = 5
        base_branching = 4

    shape = config_dict.get('shape_profile', 'cone')
    # ... use max_depth, base_branching, and shape profile during tree construction
```

### Algorithm-Specific Shape Control

Each researched algorithm has different shape-control mechanisms:

| Algorithm | Width Control | Depth Control | Balance Control |
|---|---|---|---|
| **Agglomerative** | Flatten threshold (merge distance) | Dendrogram cut level | Ward linkage (inherent) |
| **MST** | Post-process: split high-degree nodes | Post-process: chain shortening | Degree-constrained MST variant |
| **Edmonds'** | Edge weight: penalize high in-degree | Edge weight: penalize deep chains | Weight by subtree size |
| **Leiden** | Resolution parameter (coarse=wide) | Number of resolution levels | Inherently balanced |
| **LLM** | Prompt: "max 4 children per node" | Prompt: "max 5 levels deep" | Prompt: "balance subtree sizes" |

### Degree-Constrained MST

A key variant for preventing star topologies. Standard MST can give one node 50+ children. A **degree-constrained MST** limits maximum node degree to k.

The exact problem is NP-hard, but practical approximations exist:
1. Build standard MST
2. For each node with degree > k, remove the highest-weight edges
3. Reconnect orphaned subtrees to their next-best parent (respecting degree limit)

```python
def constrain_degree(mst, max_degree):
    for node in mst:
        while len(node.neighbors) > max_degree:
            worst_edge = max(node.edges, key=lambda e: e.weight)
            orphan = worst_edge.other(node)
            mst.remove_edge(worst_edge)
            # Reconnect orphan to best available parent
            candidates = [n for n in mst.nodes
                         if len(n.neighbors) < max_degree and n != orphan]
            best = min(candidates, key=lambda c: distance(c, orphan))
            mst.add_edge(best, orphan)
    return mst
```

### What This Enables

With grid-aware building, the user experience becomes:

1. User picks SUN mode with 5 radial tiers → builder targets depth 5, cone profile
2. User picks FLAT horizontal → builder targets depth 15, column profile
3. User adjusts tier zones → builder respects tier bands as depth constraints
4. User switches to "fan" shape → builder produces wide shallow trees that fill the radial space

The key insight: **tree structure and visual layout should be co-designed, not independent**. The current wall between Python (structure) and JS (layout) forces the layout engine to do heroic work mapping arbitrary trees onto fixed grids. Grid hints let the builder meet the layout halfway.

---

## 8. Recommendations

### Immediate Win (No New Dependencies)

**Switch to character n-gram TF-IDF for spell names.** Single line change in `theme_discovery.py`:

```python
# Before:
vectorizer = TfidfVectorizer(max_features=50, ...)

# After (for name similarity):
name_vectorizer = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4))
desc_vectorizer = TfidfVectorizer(max_features=50, ...)  # keep word-level for descriptions
```

This alone fixes "Firebolt"/"Fireball" getting zero similarity.

### Short Term (Strategy A)

1. Char n-gram TF-IDF for names + word TF-IDF for descriptions
2. Weighted combination with metadata (school, tier, element)
3. Unify IDF formulas across all implementations
4. Replace Jaccard in classic_build_tree.py with char n-gram cosine

### Medium Term (Strategy B or D)

Choose based on distribution model:
- **If shipping Python addon**: Strategy B (FastText + Edmonds') — ~100 MB, all offline
- **If minimal footprint matters**: Strategy D (pre-computed vectors) — ship 150 KB, runtime needs only current deps

### Long Term (Strategy E)

LLM-assisted tree generation at dev time:
1. Use best available model to embed + cluster + name groups
2. Ship the resulting tree JSON with the mod
3. Algorithmic fallback for modded spells not in the pre-built tree
4. Users never need an API key — it's a dev-time tool

### What NOT to Do

- **Don't add PyTorch/TensorFlow** — 2 GB+ for sentence-transformers is too much for a mod
- **Don't require internet at runtime** — mod users expect offline functionality
- **Don't use taxonomy induction (Hearst patterns)** — spell descriptions are too short, patterns don't fire
- **Don't use force-directed layout as tree generation** — it's a layout algorithm, not a structure algorithm
- **Don't use BM25** — marginal improvement over TF-IDF for uniform-length short texts

---

## Appendix A: External Research Review

Three external documents were evaluated against our system and research. Summary of findings and actionable takeaways.

### Documents Reviewed

1. **"Skill Tree System Design & Research"** — Academic-style paper on Runtime Spell Tree Generalization (RSTG). Proposes Meandering River / Orbital Shell / Fractal Bough layouts, root modules (Narrative Anchor, Archetype Prism, Environmental Adapter), growth modules (Synergy Magnet, Void Corruption, Constellation Linker).

2. **"Modded Spell Tree System Design"** — Evaluative paper on runtime generalization. Proposes FastText + Leiden + Edmonds' pipeline, CAT for refinement, Quota Trees, BSP partitioning, force-directed layout with boundary constraints. Compares to PoE Cluster Jewels, Wolcen Gate of Fates, Grim Dawn Devotion.

3. **"Modded Spell Tree Runtime Generalization"** — Concise technical roadmap. Tiered approach (char n-grams → FastText + Edmonds' → FastEmbed + Leiden), chaos slider concept, local LLM constrained decoding, ONNX-first philosophy.

### What We Already Have or Researched

| External Proposal | Our Equivalent | Status |
|---|---|---|
| FastText subword embeddings | Research Section 2 Tier 3 | Researched (Strategy B) |
| Leiden community detection | Research Section 3 | Researched but deprioritized (metadata already provides schools) |
| Edmonds' arborescence | Research Section 3 | Researched, top algorithmic pick |
| Grid-based auto-layout | classicLayout.js BFS + grid system | **Already built** |
| Semantic weighting / scoring | tree_builder.py composite formula | **Already built** |
| Max children / quota control | max_children_per_node + shape profiles | **Already designed** |
| Char n-gram TF-IDF | Research Section 2 Tier 1 | Researched, immediate win |
| Tiered NLP roadmap | Research Strategies A-E | **Already planned** |

### What's Impractical for Our Use Case

| External Proposal | Why It Doesn't Fit |
|---|---|
| **Force-directed layout** | Can't enforce tier zones, school angular sectors, or radial ring placement. Our grid+BFS system is purpose-built for skill trees with spatial constraints. Force-directed is for generic graph visualization. |
| **CAT (Causal Additive Trees)** | Supervised learning algorithm requiring labeled training data (X, y pairs). We have 500 spells with metadata, not thousands of labeled "good prerequisite" examples. Wrong problem domain. |
| **BSP (Binary Space Partitioning)** | For raycasting, collision detection, and 3D rendering. Our grid is pre-computed with neighbor lists; BSP adds complexity without benefit. |
| **Sugiyama layered layout** | Produces "corporate org chart" aesthetics. Our radial/linear grid system with theme sectors produces more organic skill-tree-appropriate layouts. |
| **Hyperbolic layout** | Interesting for 1000+ node trees but requires custom rendering math. Our dynamic grid expansion handles overflow more simply. |

### Actionable Ideas Worth Considering

#### The "Chaos Slider" (from Doc 3)

A single slider (0.0 → 1.0) that blends metadata-driven structure vs NLP-driven discovery:

```python
# chaos = 0.0: strict tier/school hierarchy (Classic feel)
# chaos = 1.0: pure text similarity, cross-school connections (Discovery feel)
metadata_weight = 1.0 - chaos
nlp_weight = chaos

distance = metadata_weight * metadata_distance + nlp_weight * nlp_distance
```

This is a cleaner UX abstraction than our current separate controls (spell matching mode + tier zones + spread). Could be exposed as a single "Structure ↔ Discovery" slider in settings. Internally maps to weights in the distance matrix.

**Feasibility**: Easy to implement. Just changes the weighted combination in scoring formulas. Could even be a Python config parameter.

#### Collapsible Sub-Trees / "Fractal Bough" (from Doc 1)

When tree density is high, auto-detect bottleneck nodes (single edge connecting a sub-branch to main tree) and render them as collapsed "bud" nodes. Click to expand.

**What this solves**: Visual clutter when 50+ mods add spells. The main tree stays readable; details expand on demand.

**Feasibility**: Medium. Requires JS-side detection of bottleneck nodes + expand/collapse animation + re-layout of displaced neighbors. Not trivial but doable in classicLayout.js.

#### Ghost Branches (from Doc 1)

Render unreachable nodes (locked prerequisites) at reduced scale (0.5x) and opacity (50%). Focuses player attention on the "active frontier."

**What this solves**: Cognitive overload when viewing the full tree with hundreds of locked spells.

**Feasibility**: Easy. The renderer already knows lock state per node. Just apply scale + opacity CSS based on `isLocked` flag.

#### Constrained Decoding for Local LLMs (from Doc 3)

Beyond Ollama's GBNF grammars, the **Guidance** and **Outlines** Python libraries can force local LLMs to output structured JSON matching a schema. More flexible than GBNF for complex nested schemas.

```python
# Outlines: constrained generation
from outlines import models, generate
model = models.transformers("microsoft/Phi-4-mini")
generator = generate.json(model, SpellTreeSchema)
result = generator("Classify these spells into a tree: ...")
```

**Feasibility**: Dev-time tool only (not shipped with mod). Useful if we pursue Strategy E (LLM hybrid at build time).

#### Voronoi Biome Coloring (from Doc 1)

Generate Voronoi cells behind school clusters, colored by school theme. Creates a "political map" effect that makes school boundaries visually obvious.

**Feasibility**: Medium. Requires computing Voronoi diagram from school cluster centroids and rendering colored polygons behind the grid. Canvas-friendly but adds rendering complexity.

### What The External Docs Got Wrong

1. **Confuse tree structure with layout** — propose force-directed for building trees when it's a layout algorithm
2. **Ignore Skyrim-specific constraints** — no mention of FormID persistence, SKSE architecture, or Papyrus save compatibility
3. **Propose supervised ML for unsupervised problems** — CAT requires training data that doesn't exist
4. **Academic citation padding** — many citations are generic web results (Reddit threads, YouTube videos, Figma docs) dressed up as academic sources
5. **Underestimate metadata** — when you already have school/tier/element data, you don't need Leiden to "discover" schools
6. **No mention of determinism** — critical for reproducible mod behavior across sessions

### Verdict

Our research doc (`TREE_GENERATION_RESEARCH.md`) is more comprehensive, more practical, and more honest about tradeoffs than all three external documents combined. The external docs confirm our roadmap direction (char n-grams → FastText + Edmonds' → neural embeddings) but add no algorithms we hadn't already identified. The actionable UX ideas (chaos slider, ghost branches, collapsible sub-trees) are worth considering as future polish.

---

## Appendix B: Key Internal Research Sources

| Topic | Source |
|---|---|
| Hierarchical clustering | scipy docs, sklearn AgglomerativeClustering |
| Minimum spanning arborescence | Edmonds (1967), NetworkX implementation |
| Leiden algorithm | Traag et al. (2019), leidenalg package |
| FastText subword embeddings | Bojanowski et al. (2017), gensim |
| FastEmbed ONNX runtime | Qdrant fastembed package |
| LLM taxonomy generation | Enterprise Knowledge (2024), Bob DuCharme experiments |
| LLM hierarchical clustering | pyhercules (MIT), BERTopic hierarchical topics |
| TELEClass hybrid | Zhang et al. (ACM Web Conference 2025) |
| Density-based LLM trees | arXiv:2512.23471 |
| Elder Scrolls dataset | HuggingFace RoyalCities/Elder_Scrolls_Wiki_Dataset |
| Soft Cosine Measure | Sidorov et al. (2014), gensim implementation |
| Word Mover's Distance | Kusner et al. (2015), gensim implementation |

## Appendix C: Algorithm Complexity Quick Reference

| Algorithm | Time | Space | Deterministic |
|---|---|---|---|
| TF-IDF vectorization | O(n × v) | O(n × v) | Yes |
| Char n-gram TF-IDF | O(n × c) | O(n × c) | Yes |
| Cosine similarity matrix | O(n² × d) | O(n²) | Yes |
| Ward agglomerative | O(n² log n) | O(n²) | Yes |
| Kruskal MST | O(E log E) | O(V + E) | Yes |
| Edmonds' arborescence | O(E + V log V) | O(V + E) | Yes |
| Louvain | O(n log n) | O(n + m) | No |
| Leiden | O(n log n) | O(n + m) | No |
| FastText embed (500 spells) | O(n × w) | O(n × d) | Yes |
| WMD (per pair, 1-4 words) | O(w³) ≈ O(1) | O(w²) | Yes |
