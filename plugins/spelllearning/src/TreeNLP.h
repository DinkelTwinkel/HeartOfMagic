#pragma once

#include "PCH.h"

// =============================================================================
// TreeNLP — Core NLP algorithms for spell tree generation
//
// Implements TF-IDF vectorization, cosine similarity, character n-gram
// similarity, and fuzzy string matching. These are the building blocks
// used by all tree builder modes.
//
// Replaces the Python prereq_master_scorer.py + spell_grouper.py algorithms.
// =============================================================================

namespace TreeNLP
{
    // =========================================================================
    // TYPES
    // =========================================================================

    // Sparse TF-IDF vector: token → weight, with pre-computed L2 norm
    struct SparseVector {
        std::unordered_map<std::string, float> weights;
        float norm = 0.0f;
    };

    // Scored candidate result (for PRM and parent selection)
    struct ScoredCandidate {
        std::string nodeId;
        float       score = 0.0f;
    };

    // =========================================================================
    // TOKENIZATION
    // =========================================================================

    // Tokenize text: lowercase, strip non-alphanumeric, filter words <= 2 chars
    std::vector<std::string> Tokenize(const std::string& text);

    // Build combined text from spell JSON data (name 2x, desc, effects)
    std::string BuildSpellText(const json& spellData);

    // Build combined text with heavier name/effect weighting for theme discovery
    std::string BuildThemeText(const json& spellData);

    // =========================================================================
    // TF-IDF
    // =========================================================================

    // Compute TF-IDF vectors for a set of documents (each doc = token list).
    // Returns sparse vectors with pre-computed L2 norms.
    std::vector<SparseVector> ComputeTfIdf(
        const std::vector<std::vector<std::string>>& documents);

    // =========================================================================
    // SIMILARITY METRICS
    // =========================================================================

    // Cosine similarity between two sparse TF-IDF vectors (0.0 to 1.0)
    float CosineSimilarity(const SparseVector& a, const SparseVector& b);

    // Character n-gram Jaccard similarity between two strings (0.0 to 1.0)
    // Catches morphological families: "Firebolt" vs "Fireball" ≈ 0.45
    float CharNgramSimilarity(const std::string& a, const std::string& b, int n = 3);

    // =========================================================================
    // FUZZY STRING MATCHING (replaces Python thefuzz library)
    // =========================================================================

    // Levenshtein edit distance between two strings
    int LevenshteinDistance(const std::string& a, const std::string& b);

    // Simple ratio: 1.0 - (editDistance / maxLength). Range [0, 100].
    int FuzzyRatio(const std::string& a, const std::string& b);

    // Partial ratio: best FuzzyRatio of shorter string against all
    // same-length substrings of the longer string. Range [0, 100].
    int FuzzyPartialRatio(const std::string& shorter, const std::string& longer);

    // Token set ratio: tokenize both strings, compute ratio using
    // intersection + remainder tokens. Range [0, 100].
    int FuzzyTokenSetRatio(const std::string& a, const std::string& b);

    // =========================================================================
    // THEME SCORING (replaces spell_grouper.py::calculate_theme_score)
    // =========================================================================

    // Score how well a spell matches a theme using multiple fuzzy strategies.
    // Returns 0-100.
    int CalculateThemeScore(const json& spellData, const std::string& theme);

    // =========================================================================
    // STOP WORDS
    // =========================================================================

    // Check if a word is in the spell stop word list
    bool IsStopWord(const std::string& word);

    // =========================================================================
    // PRE-REQ MASTER SCORING (replaces prereq_master_scorer.py)
    // =========================================================================

    // PRM scoring settings
    struct PRMSettings {
        float proximityBias = 0.5f;
        std::string poolSource = "nearby";
        float maxDistance = 5.0f;
    };

    // Score candidates against a spell for PRM lock assignment.
    // Returns top N candidates sorted by score (descending).
    std::vector<ScoredCandidate> ScorePRMCandidates(
        const json& spellData,
        const std::vector<json>& candidates,
        const PRMSettings& settings,
        int topN = 5);

    // Process a full PRM scoring request (matches Python process_request API)
    json ProcessPRMRequest(const json& request);

    // =========================================================================
    // UTILITY
    // =========================================================================

    // Lowercase a string (ASCII-safe, sufficient for English spell names)
    std::string ToLower(const std::string& s);
}
