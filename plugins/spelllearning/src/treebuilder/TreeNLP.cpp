#include "treebuilder/TreeNLP.h"

#include <rapidfuzz/distance/Levenshtein.hpp>
#include <rapidfuzz/fuzz.hpp>

#include <algorithm>
#include <cmath>
#include <numeric>
#include <regex>
#include <set>
#include <sstream>

// =============================================================================
// STOP WORDS — words filtered from TF-IDF analysis
// =============================================================================

static const std::unordered_set<std::string> kStopWords = {
    // Generic spell words
    "spell", "magic", "magical", "target", "targets", "effect", "effects",
    "damage", "point", "points", "second", "seconds", "per", "for",
    "does", "causes", "cast", "caster", "casting", "level", "levels",
    "health", "magicka", "stamina", "drain", "drains",
    // Effect description fragments
    "deals", "deal", "dur", "duration", "mag", "magnitude",
    "nearby", "enemies", "enemy", "increased", "increases", "increase",
    "decreased", "decreases", "decrease", "reduces", "reduced", "reduce",
    "restores", "restore", "restored", "absorb", "absorbs", "absorbed",
    "extra", "takes", "take", "time", "over", "while", "also",
    "resistance", "chance", "once", "each", "within", "range",
    "stronger", "powerful", "greater", "lesser", "more", "less",
    // Skill level words
    "novice", "apprentice", "adept", "expert", "master",
    // Common prepositions, articles, etc.
    "to", "a", "an", "of", "in", "on", "at", "is", "are", "be", "with",
    "that", "this", "their", "your", "and", "or", "but", "not", "all",
    "the", "was", "were", "been", "being", "have", "has", "had", "do",
    "did", "will", "would", "could", "should", "may", "might", "can",
    "shall", "from", "by", "as", "if", "its", "it", "they", "them",
    "he", "she", "his", "her", "we", "you", "who", "which", "when",
    "where", "how", "what", "than", "then", "into", "about", "up",
    "out", "no", "so", "just", "very", "too", "any", "some", "such",
};

// =============================================================================
// UTILITY
// =============================================================================

std::string TreeNLP::ToLower(const std::string& s)
{
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return result;
}

bool TreeNLP::IsStopWord(const std::string& word)
{
    return kStopWords.contains(word);
}

// =============================================================================
// TOKENIZATION
// =============================================================================

std::vector<std::string> TreeNLP::Tokenize(const std::string& text)
{
    if (text.empty()) return {};

    std::string lower = ToLower(text);

    // Replace non-alphanumeric with spaces
    for (auto& c : lower) {
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != ' ') {
            c = ' ';
        }
    }

    // Split on whitespace, filter words <= 2 chars
    std::vector<std::string> tokens;
    std::istringstream iss(lower);
    std::string word;
    while (iss >> word) {
        if (word.size() > 2) {
            tokens.push_back(std::move(word));
        }
    }
    return tokens;
}

std::string TreeNLP::BuildSpellText(const json& spellData)
{
    std::string parts;

    // Name (2x weight via repetition)
    if (spellData.contains("name") && spellData["name"].is_string()) {
        auto name = spellData["name"].get<std::string>();
        if (!name.empty()) {
            parts += name + " " + name + " ";
        }
    }

    // Description
    if (spellData.contains("desc") && spellData["desc"].is_string()) {
        auto desc = spellData["desc"].get<std::string>();
        if (!desc.empty()) {
            parts += desc + " ";
        }
    }

    // Effects (string array)
    if (spellData.contains("effects") && spellData["effects"].is_array()) {
        for (const auto& eff : spellData["effects"]) {
            if (eff.is_string()) {
                auto s = eff.get<std::string>();
                if (!s.empty()) {
                    parts += s + " ";
                }
            }
        }
    }

    return parts;
}

std::string TreeNLP::BuildThemeText(const json& spellData)
{
    std::string parts;

    // Name (3x weight)
    if (spellData.contains("name") && spellData["name"].is_string()) {
        auto name = spellData["name"].get<std::string>();
        if (!name.empty()) {
            parts += name + " " + name + " " + name + " ";
        }
    }

    // Effect names (3x weight)
    if (spellData.contains("effectNames") && spellData["effectNames"].is_array()) {
        for (const auto& en : spellData["effectNames"]) {
            if (en.is_string()) {
                auto s = en.get<std::string>();
                if (!s.empty()) {
                    parts += s + " " + s + " " + s + " ";
                }
            }
        }
    }

    // Full effect descriptions (1x)
    if (spellData.contains("effects") && spellData["effects"].is_array()) {
        for (const auto& eff : spellData["effects"]) {
            if (eff.is_object()) {
                if (eff.contains("name") && eff["name"].is_string())
                    parts += eff["name"].get<std::string>() + " ";
                if (eff.contains("description") && eff["description"].is_string())
                    parts += eff["description"].get<std::string>() + " ";
            }
        }
    }

    // Keywords
    if (spellData.contains("keywords") && spellData["keywords"].is_array()) {
        for (const auto& kw : spellData["keywords"]) {
            if (kw.is_string()) {
                auto s = kw.get<std::string>();
                // Strip "Magic" prefix and split camelCase
                if (s.size() > 5 && s.substr(0, 5) == "Magic") {
                    s = s.substr(5);
                }
                // Insert spaces before uppercase letters (camelCase splitting)
                std::string split;
                for (size_t i = 0; i < s.size(); ++i) {
                    if (i > 0 && std::isupper(static_cast<unsigned char>(s[i]))) {
                        split += ' ';
                    }
                    split += s[i];
                }
                parts += split + " ";
            }
        }
    }

    return parts;
}

// =============================================================================
// TF-IDF VECTORIZATION
// =============================================================================

std::vector<TreeNLP::SparseVector> TreeNLP::ComputeTfIdf(
    const std::vector<std::vector<std::string>>& documents)
{
    if (documents.empty()) return {};

    // Document frequency: how many documents contain each token
    std::unordered_map<std::string, int> df;
    for (const auto& doc : documents) {
        std::unordered_set<std::string> unique(doc.begin(), doc.end());
        for (const auto& token : unique) {
            df[token]++;
        }
    }

    // IDF: smoothed inverse document frequency
    const auto nDocs = static_cast<float>(documents.size());
    std::unordered_map<std::string, float> idf;
    for (const auto& [token, freq] : df) {
        idf[token] = std::log((nDocs + 1.0f) / (static_cast<float>(freq) + 1.0f)) + 1.0f;
    }

    // Compute TF-IDF vectors with L2 norms
    std::vector<SparseVector> vectors;
    vectors.reserve(documents.size());

    for (const auto& doc : documents) {
        SparseVector sv;
        if (doc.empty()) {
            vectors.push_back(std::move(sv));
            continue;
        }

        // Term frequency
        std::unordered_map<std::string, int> tf;
        for (const auto& token : doc) {
            tf[token]++;
        }

        float total = static_cast<float>(doc.size());
        float normSq = 0.0f;

        for (const auto& [token, count] : tf) {
            float w = (static_cast<float>(count) / total) * idf[token];
            sv.weights[token] = w;
            normSq += w * w;
        }

        sv.norm = (normSq > 0.0f) ? std::sqrt(normSq) : 0.0f;
        vectors.push_back(std::move(sv));
    }

    return vectors;
}

// =============================================================================
// SIMILARITY METRICS
// =============================================================================

float TreeNLP::CosineSimilarity(const SparseVector& a, const SparseVector& b)
{
    if (a.norm == 0.0f || b.norm == 0.0f) return 0.0f;

    // Iterate over the smaller vector for speed
    const auto* fewer = &a;
    const auto* more = &b;
    if (fewer->weights.size() > more->weights.size()) {
        std::swap(fewer, more);
    }

    float dot = 0.0f;
    for (const auto& [token, wa] : fewer->weights) {
        auto it = more->weights.find(token);
        if (it != more->weights.end()) {
            dot += wa * it->second;
        }
    }

    return dot / (a.norm * b.norm);
}

float TreeNLP::CharNgramSimilarity(const std::string& a, const std::string& b, int n)
{
    auto la = ToLower(a);
    auto lb = ToLower(b);

    // Strip whitespace
    auto isSpace = [](unsigned char c) { return std::isspace(c) != 0; };
    la.erase(std::remove_if(la.begin(), la.end(), isSpace), la.end());
    lb.erase(std::remove_if(lb.begin(), lb.end(), isSpace), lb.end());

    if (static_cast<int>(la.size()) < n || static_cast<int>(lb.size()) < n) {
        return 0.0f;
    }

    // Pack n-gram bytes into uint32_t to avoid string heap allocations
    auto packNgram = [](const char* s, int len) -> uint32_t {
        uint32_t h = 0;
        for (int i = 0; i < len; ++i)
            h = (h << 8) | static_cast<uint8_t>(s[i]);
        return h;
    };

    // Generate n-gram sets using packed integers
    std::unordered_set<uint32_t> gramsA, gramsB;
    for (int i = 0; i <= static_cast<int>(la.size()) - n; ++i)
        gramsA.insert(packNgram(la.data() + i, n));
    for (int i = 0; i <= static_cast<int>(lb.size()) - n; ++i)
        gramsB.insert(packNgram(lb.data() + i, n));

    // Jaccard similarity: |intersection| / |union|
    int intersection = 0;
    for (auto g : gramsA) {
        if (gramsB.contains(g))
            ++intersection;
    }

    int unionSize = static_cast<int>(gramsA.size() + gramsB.size()) - intersection;
    return (unionSize > 0) ? static_cast<float>(intersection) / static_cast<float>(unionSize) : 0.0f;
}

// =============================================================================
// FUZZY STRING MATCHING
// =============================================================================

int TreeNLP::LevenshteinDistance(const std::string& a, const std::string& b)
{
    return static_cast<int>(rapidfuzz::levenshtein_distance(a, b));
}

int TreeNLP::FuzzyRatio(const std::string& a, const std::string& b)
{
    if (a.empty() && b.empty()) return 100;
    if (a.empty() || b.empty()) return 0;

    return static_cast<int>(std::round(
        rapidfuzz::fuzz::ratio(ToLower(a), ToLower(b))));
}

int TreeNLP::FuzzyPartialRatio(const std::string& shorter, const std::string& longer)
{
    if (shorter.empty() || longer.empty()) return 0;

    // rapidfuzz handles shorter/longer swap internally
    return static_cast<int>(std::round(
        rapidfuzz::fuzz::partial_ratio(ToLower(shorter), ToLower(longer))));
}

int TreeNLP::FuzzyTokenSetRatio(const std::string& a, const std::string& b)
{
    if (a.empty() && b.empty()) return 100;
    if (a.empty() || b.empty()) return 0;

    return static_cast<int>(std::round(
        rapidfuzz::fuzz::token_set_ratio(a, b)));
}

// =============================================================================
// THEME SCORING
// =============================================================================

int TreeNLP::CalculateThemeScore(const json& spellData, const std::string& theme)
{
    std::string text = ToLower(BuildThemeText(spellData));
    std::string spellName = ToLower(
        spellData.contains("name") && spellData["name"].is_string()
            ? spellData["name"].get<std::string>()
            : "");
    std::string themeLower = ToLower(theme);

    // Strategy 1: Substring check (exact match bonus)
    int substringBonus = 0;
    if (spellName.find(themeLower) != std::string::npos) {
        substringBonus = 40;  // Name match (higher bonus)
    } else if (text.find(themeLower) != std::string::npos) {
        substringBonus = 30;
    }

    // Cache theme pattern for reuse across partial_ratio calls
    rapidfuzz::fuzz::CachedPartialRatio<char> cachedTheme(themeLower);

    // Strategy 2: Partial ratio (best substring match)
    int partialScore = static_cast<int>(std::round(cachedTheme.similarity(text)));

    // Strategy 3: Token set ratio (handles word reordering)
    int tokenScore = static_cast<int>(std::round(
        rapidfuzz::fuzz::token_set_ratio(themeLower, text)));

    // Strategy 4: Direct name comparison (weighted 1.2x)
    float nameScore = static_cast<float>(
        static_cast<int>(std::round(cachedTheme.similarity(spellName)))) * 1.2f;

    // Combine scores (weighted average)
    float combined =
        static_cast<float>(partialScore) * 0.25f +
        static_cast<float>(tokenScore) * 0.25f +
        nameScore * 0.3f +
        static_cast<float>(substringBonus);

    return std::min(100, static_cast<int>(combined));
}

// =============================================================================
// PRE-REQ MASTER SCORING
// =============================================================================

std::vector<TreeNLP::ScoredCandidate> TreeNLP::ScorePRMCandidates(
    const json& spellData,
    const std::vector<json>& candidates,
    const PRMSettings& settings,
    int topN)
{
    if (candidates.empty()) return {};

    // Build document corpus: spell + all candidates
    std::string spellText = BuildSpellText(spellData);
    auto spellTokens = Tokenize(spellText);

    std::vector<std::vector<std::string>> allDocs;
    allDocs.push_back(spellTokens);

    for (const auto& cand : candidates) {
        allDocs.push_back(Tokenize(BuildSpellText(cand)));
    }

    // Compute TF-IDF
    auto vectors = ComputeTfIdf(allDocs);
    const auto& spellVec = vectors[0];

    // Score each candidate
    std::vector<ScoredCandidate> scored;
    scored.reserve(candidates.size());

    for (size_t i = 0; i < candidates.size(); ++i) {
        float nlpScore = CosineSimilarity(spellVec, vectors[i + 1]);

        float finalScore = nlpScore;

        // Blend with proximity if nearby mode
        if (settings.poolSource == "nearby" && settings.proximityBias > 0.0f) {
            float dist = 0.0f;
            if (candidates[i].contains("distance") && candidates[i]["distance"].is_number()) {
                dist = candidates[i]["distance"].get<float>();
            } else {
                dist = settings.maxDistance;
            }
            float proxScore = (settings.maxDistance > 0.0f)
                ? std::max(0.0f, 1.0f - (dist / settings.maxDistance))
                : 0.0f;
            finalScore = (1.0f - settings.proximityBias) * nlpScore
                       + settings.proximityBias * proxScore;
        }

        std::string nodeId;
        if (candidates[i].contains("nodeId") && candidates[i]["nodeId"].is_string()) {
            nodeId = candidates[i]["nodeId"].get<std::string>();
        }

        scored.push_back({std::move(nodeId), std::round(finalScore * 10000.0f) / 10000.0f});
    }

    // Sort descending by score
    std::sort(scored.begin(), scored.end(),
        [](const auto& a, const auto& b) { return a.score > b.score; });

    // Return top N
    if (static_cast<int>(scored.size()) > topN) {
        scored.resize(topN);
    }

    return scored;
}

json TreeNLP::ProcessPRMRequest(const json& request)
{
    auto pairs = request.value("pairs", json::array());
    auto settingsJson = request.value("settings", json::object());

    PRMSettings settings;
    settings.proximityBias = settingsJson.value("proximityBias", 0.5f);
    settings.poolSource = settingsJson.value("poolSource", std::string("nearby"));
    settings.maxDistance = settingsJson.value("distance", 5.0f);

    json scores = json::array();

    for (const auto& pair : pairs) {
        auto spellId = pair.value("spellId", std::string(""));
        auto spellData = pair.value("spell", json::object());
        auto candidatesJson = pair.value("candidates", json::array());

        std::vector<json> candidates;
        for (const auto& c : candidatesJson) {
            candidates.push_back(c);
        }

        auto results = ScorePRMCandidates(spellData, candidates, settings);

        if (!results.empty()) {
            json entry;
            entry["spellId"] = spellId;
            entry["bestMatch"] = results[0].nodeId;
            entry["score"] = results[0].score;

            json topCandidates = json::array();
            for (const auto& r : results) {
                topCandidates.push_back({{"nodeId", r.nodeId}, {"score", r.score}});
            }
            entry["topCandidates"] = topCandidates;

            scores.push_back(entry);
        }
    }

    return {
        {"success", true},
        {"scores", scores},
        {"count", scores.size()}
    };
}
