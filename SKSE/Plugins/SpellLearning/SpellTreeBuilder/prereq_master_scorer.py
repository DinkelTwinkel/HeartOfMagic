"""
prereq_master_scorer.py - NLP similarity scorer for Pre Req Master

Scores spell-candidate pairs using TF-IDF + cosine similarity on combined
text of spell name, description, and effects. Used to find the most
thematically related spell to assign as a lock prerequisite.

Called from C++ bridge with command 'PreReqMasterScore'.

Input JSON:
{
    "pairs": [
        {
            "spellId": "0x000123",
            "spell": {"name": "...", "desc": "...", "effects": ["..."]},
            "candidates": [
                {"nodeId": "0x000456", "name": "...", "desc": "...", "effects": ["..."], "distance": 5.0}
            ]
        }
    ],
    "settings": {
        "proximityBias": 0.5,
        "poolSource": "nearby",
        "distance": 5
    }
}

Output JSON:
{
    "success": true,
    "scores": [
        {"spellId": "0x000123", "bestMatch": "0x000456", "score": 0.85}
    ]
}
"""

import json
import sys
import re
from collections import Counter
import math


def tokenize(text):
    """Simple tokenizer: lowercase, remove non-alphanumeric, filter short words."""
    if not text:
        return []
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s]', ' ', text)
    return [w for w in text.split() if len(w) > 2]


def build_text(spell_data):
    """Combine name, description, and effects into a single text blob."""
    parts = []
    if spell_data.get('name'):
        # Weight name more heavily by repeating it
        parts.append(spell_data['name'])
        parts.append(spell_data['name'])
    if spell_data.get('desc'):
        parts.append(spell_data['desc'])
    for effect in spell_data.get('effects', []):
        if effect:
            parts.append(effect)
    return ' '.join(parts)


def compute_tfidf(documents):
    """Compute TF-IDF vectors for a list of documents (token lists).

    Returns list of (vec, norm) tuples where vec is {token: weight} and
    norm is the pre-computed L2 magnitude for fast cosine similarity.
    """
    # Document frequency
    df = Counter()
    for doc in documents:
        unique_tokens = set(doc)
        for token in unique_tokens:
            df[token] += 1

    n_docs = len(documents)
    idf = {}
    for token, freq in df.items():
        idf[token] = math.log((n_docs + 1) / (freq + 1)) + 1  # smoothed IDF

    # TF-IDF vectors with pre-computed norms
    vectors = []
    for doc in documents:
        tf = Counter(doc)
        total = len(doc) if doc else 1
        vec = {}
        norm_sq = 0.0
        for token, count in tf.items():
            w = (count / total) * idf.get(token, 1.0)
            vec[token] = w
            norm_sq += w * w
        vectors.append((vec, math.sqrt(norm_sq) if norm_sq > 0 else 0.0))

    return vectors


def cosine_similarity(vec_a_norm, vec_b_norm):
    """Compute cosine similarity between two (vec, norm) tuples."""
    vec_a, mag_a = vec_a_norm
    vec_b, mag_b = vec_b_norm

    if mag_a == 0 or mag_b == 0:
        return 0.0

    # Dot product — iterate over the smaller vector for speed
    if len(vec_a) > len(vec_b):
        vec_a, vec_b = vec_b, vec_a
    dot = 0.0
    for token, wa in vec_a.items():
        wb = vec_b.get(token)
        if wb is not None:
            dot += wa * wb

    return dot / (mag_a * mag_b)


def score_pair(spell_data, candidates, settings, top_n=5):
    """
    Score all candidates against a spell using TF-IDF cosine similarity.
    Returns the top N matches with their scores (for weighted random selection in JS).
    """
    if not candidates:
        return None

    proximity_bias = settings.get('proximityBias', 0.5)
    max_distance = settings.get('distance', 5)
    pool_source = settings.get('poolSource', 'nearby')

    # Build document corpus: spell + all candidates
    spell_text = build_text(spell_data)
    spell_tokens = tokenize(spell_text)

    all_docs = [spell_tokens]
    candidate_tokens = []
    for cand in candidates:
        tokens = tokenize(build_text(cand))
        candidate_tokens.append(tokens)
        all_docs.append(tokens)

    # Compute TF-IDF
    vectors = compute_tfidf(all_docs)
    spell_vec = vectors[0]

    scored = []

    for i, cand in enumerate(candidates):
        cand_vec = vectors[i + 1]
        nlp_score = cosine_similarity(spell_vec, cand_vec)

        # Blend with proximity if nearby mode
        if pool_source == 'nearby' and proximity_bias > 0:
            dist = cand.get('distance', max_distance)
            prox_score = max(0, 1 - (dist / max_distance)) if max_distance > 0 else 0
            final_score = (1 - proximity_bias) * nlp_score + proximity_bias * prox_score
        else:
            final_score = nlp_score

        scored.append({
            'nodeId': cand.get('nodeId'),
            'score': round(final_score, 4)
        })

    # Sort descending by score and return top N
    scored.sort(key=lambda x: x['score'], reverse=True)
    top = scored[:top_n]

    if top:
        return {
            'bestMatch': top[0]['nodeId'],  # keep for backwards compat
            'score': top[0]['score'],
            'topCandidates': top
        }
    return None


def process_request(request_json):
    """Process the full Pre Req Master scoring request."""
    try:
        data = json.loads(request_json) if isinstance(request_json, str) else request_json
    except json.JSONDecodeError as e:
        return json.dumps({'success': False, 'error': f'Invalid JSON: {e}'})

    pairs = data.get('pairs', [])
    settings = data.get('settings', {})

    scores = []
    for pair in pairs:
        spell_id = pair.get('spellId')
        spell_data = pair.get('spell', {})
        candidates = pair.get('candidates', [])

        result = score_pair(spell_data, candidates, settings)
        if result:
            result['spellId'] = spell_id
            scores.append(result)

    return json.dumps({
        'success': True,
        'scores': scores,
        'count': len(scores)
    })


# Entry point when called from C++ bridge
if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Pre Req Master NLP Scorer')
    parser.add_argument('-i', '--input', help='Input JSON file path')
    parser.add_argument('-o', '--output', help='Output JSON file path')
    args, unknown = parser.parse_known_args()

    if args.input:
        # File I/O mode (called from C++ bridge)
        with open(args.input, 'r', encoding='utf-8') as f:
            input_json = f.read()
        result = process_request(input_json)
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(result)
        else:
            print(result)
    elif unknown:
        # Legacy: inline JSON argument
        input_json = unknown[0]
        result = process_request(input_json)
        print(result)
    else:
        # Legacy: stdin
        input_json = sys.stdin.read()
        result = process_request(input_json)
        print(result)
