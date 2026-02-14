#include "TreeBuilderInternal.h"

#include <algorithm>
#include <chrono>
#include <numeric>

// =============================================================================
// TIER UTILITIES
// =============================================================================

int TreeBuilder::TierIndex(const std::string& tierName)
{
    for (int i = 0; i < TIER_COUNT; ++i) {
        if (tierName == TIER_NAMES[i]) return i;
    }
    return -1;
}

// =============================================================================
// TREE NODE
// =============================================================================

TreeBuilder::TreeNode TreeBuilder::TreeNode::FromSpell(const json& spell)
{
    TreeNode node;
    node.formId = spell.value("formId", std::string(""));
    node.name = spell.value("name", node.formId);
    node.tier = spell.value("skillLevel", std::string("Unknown"));
    node.school = spell.value("school", std::string("Unknown"));
    node.spellData = spell;
    return node;
}

void TreeBuilder::TreeNode::AddChild(const std::string& childId)
{
    if (std::find(children.begin(), children.end(), childId) == children.end()) {
        children.push_back(childId);
    }
}

void TreeBuilder::TreeNode::AddPrerequisite(const std::string& prereqId)
{
    if (std::find(prerequisites.begin(), prerequisites.end(), prereqId) == prerequisites.end()) {
        prerequisites.push_back(prereqId);
    }
}

json TreeBuilder::TreeNode::ToDict() const
{
    json result;
    result["formId"] = formId;
    result["children"] = children;
    result["prerequisites"] = prerequisites;
    result["tier"] = depth + 1;  // 1-indexed tiers for output

    if (!name.empty()) result["name"] = name;
    if (!tier.empty() && tier != "Unknown") result["skillLevel"] = tier;
    if (!section.empty()) result["section"] = section;
    if (!theme.empty()) result["theme"] = theme;

    return result;
}

void TreeBuilder::LinkNodes(TreeNode& parent, TreeNode& child)
{
    parent.AddChild(child.formId);
    child.AddPrerequisite(parent.formId);
    child.depth = parent.depth + 1;
}

void TreeBuilder::UnlinkNodes(TreeNode& parent, TreeNode& child)
{
    auto& pc = parent.children;
    pc.erase(std::remove(pc.begin(), pc.end(), child.formId), pc.end());

    auto& cp = child.prerequisites;
    cp.erase(std::remove(cp.begin(), cp.end(), parent.formId), cp.end());
}

// =============================================================================
// SIMILARITY MATRIX
// =============================================================================

float TreeBuilder::SimilarityMatrix::GetTextSim(const std::string& a, const std::string& b) const
{
    auto it = textSims.find(a + ":" + b);
    return (it != textSims.end()) ? it->second : 0.0f;
}

float TreeBuilder::SimilarityMatrix::GetNameSim(const std::string& a, const std::string& b) const
{
    auto it = nameSims.find(a + ":" + b);
    return (it != nameSims.end()) ? it->second : 0.0f;
}

float TreeBuilder::SimilarityMatrix::GetEffectSim(const std::string& a, const std::string& b) const
{
    auto it = effectSims.find(a + ":" + b);
    return (it != effectSims.end()) ? it->second : 0.0f;
}

TreeBuilder::SimilarityMatrix TreeBuilder::ComputeSimilarityMatrix(const std::vector<json>& spells)
{
    SimilarityMatrix matrix;

    // Collect form IDs, names, and effect names
    std::vector<std::string> formIds;
    std::unordered_map<std::string, std::string> spellNames;
    std::unordered_map<std::string, std::vector<std::string>> spellEffectNames;
    std::vector<std::vector<std::string>> tokenizedDocs;

    for (const auto& s : spells) {
        auto fid = s.value("formId", std::string(""));
        if (fid.empty()) continue;

        formIds.push_back(fid);
        spellNames[fid] = s.value("name", std::string(""));

        // Extract effect names
        std::vector<std::string> effectNames;
        if (s.contains("effects") && s["effects"].is_array()) {
            for (const auto& e : s["effects"]) {
                std::string ename;
                if (e.is_object() && e.contains("name") && e["name"].is_string())
                    ename = e["name"].get<std::string>();
                else if (e.is_string())
                    ename = e.get<std::string>();
                if (!ename.empty()) effectNames.push_back(ename);
            }
        }
        if (s.contains("effectNames") && s["effectNames"].is_array()) {
            for (const auto& e : s["effectNames"]) {
                if (e.is_string()) {
                    auto en = e.get<std::string>();
                    if (!en.empty()) effectNames.push_back(en);
                }
            }
        }
        spellEffectNames[fid] = effectNames;

        // Build text for TF-IDF
        json spellForText;
        spellForText["name"] = s.value("name", std::string(""));
        spellForText["desc"] = s.contains("description") ? s.value("description", std::string(""))
                                                          : s.value("desc", std::string(""));
        // Flatten effects to strings
        json effectsFlat = json::array();
        if (s.contains("effects") && s["effects"].is_array()) {
            for (const auto& e : s["effects"]) {
                if (e.is_string()) effectsFlat.push_back(e);
                else if (e.is_object() && e.contains("name")) effectsFlat.push_back(e["name"]);
            }
        }
        spellForText["effects"] = effectsFlat;

        auto text = TreeNLP::BuildSpellText(spellForText);
        tokenizedDocs.push_back(TreeNLP::Tokenize(text));
    }

    // Compute TF-IDF vectors
    auto tfidfVectors = TreeNLP::ComputeTfIdf(tokenizedDocs);
    auto n = formIds.size();

    // Pairwise text similarity
    for (size_t i = 0; i < n; ++i) {
        for (size_t j = i + 1; j < n; ++j) {
            float sim = TreeNLP::CosineSimilarity(tfidfVectors[i], tfidfVectors[j]);
            if (sim > 0.05f) {
                auto keyAB = formIds[i] + ":" + formIds[j];
                auto keyBA = formIds[j] + ":" + formIds[i];
                matrix.textSims[keyAB] = sim;
                matrix.textSims[keyBA] = sim;
            }
        }
    }

    // Pairwise name similarity (char n-grams)
    for (size_t i = 0; i < n; ++i) {
        for (size_t j = i + 1; j < n; ++j) {
            auto& na = spellNames[formIds[i]];
            auto& nb = spellNames[formIds[j]];
            if (!na.empty() && !nb.empty()) {
                float nsim = TreeNLP::CharNgramSimilarity(na, nb);
                if (nsim > 0.1f) {
                    auto keyAB = formIds[i] + ":" + formIds[j];
                    auto keyBA = formIds[j] + ":" + formIds[i];
                    matrix.nameSims[keyAB] = nsim;
                    matrix.nameSims[keyBA] = nsim;
                }
            }
        }
    }

    // Pairwise effect-name affinity
    for (size_t i = 0; i < n; ++i) {
        for (size_t j = i + 1; j < n; ++j) {
            auto& effsA = spellEffectNames[formIds[i]];
            auto& effsB = spellEffectNames[formIds[j]];
            if (effsA.empty() || effsB.empty()) continue;

            float bestSim = 0.0f;
            for (const auto& ea : effsA) {
                for (const auto& eb : effsB) {
                    float sim = TreeNLP::CharNgramSimilarity(ea, eb);
                    bestSim = std::max(bestSim, sim);
                }
            }
            if (bestSim > 0.3f) {
                auto keyAB = formIds[i] + ":" + formIds[j];
                auto keyBA = formIds[j] + ":" + formIds[i];
                matrix.effectSims[keyAB] = bestSim;
                matrix.effectSims[keyBA] = bestSim;
            }
        }
    }

    return matrix;
}

// =============================================================================
// BUILD CONFIGURATION
// =============================================================================

TreeBuilder::BuildConfig TreeBuilder::BuildConfig::FromJson(const json& config)
{
    BuildConfig bc;
    bc.seed = config.value("seed", 0);
    bc.maxChildrenPerNode = config.value("max_children_per_node", 3);
    bc.topThemesPerSchool = config.value("top_themes_per_school", 8);
    bc.autoFixUnreachable = config.value("auto_fix_unreachable", true);
    bc.preferVanillaRoots = config.value("prefer_vanilla_roots", true);
    bc.density = config.value("density", 0.6f);
    bc.symmetry = config.value("symmetry", 0.3f);
    bc.chaos = config.value("chaos", 0.0f);
    bc.convergenceChance = config.value("convergence_chance", 0.4f);
    bc.forceBalance = config.value("force_balance", 0.5f);
    bc.branchStyle = config.value("branch_style", std::string("chain"));
    bc.chainStyle = config.value("chain_style", std::string("linear"));
    bc.batchSize = std::max(5, config.value("batch_size", 20));

    // LLM API config
    if (config.contains("llm_api") && config["llm_api"].is_object()) {
        auto& la = config["llm_api"];
        BuildConfig::LLMApiConfig llm;
        llm.enabled = la.value("enabled", false);
        llm.provider = la.value("provider", std::string("openrouter"));
        llm.apiKey = la.value("api_key", std::string(""));
        llm.model = la.value("model", std::string(""));
        llm.url = la.value("url", std::string(""));
        bc.llmApi = llm;
    }

    // Selected roots
    if (config.contains("selected_roots") && config["selected_roots"].is_object()) {
        for (auto& [school, val] : config["selected_roots"].items()) {
            if (val.is_object() && val.contains("formId")) {
                bc.selectedRoots[school] = val["formId"].get<std::string>();
            } else if (val.is_string()) {
                bc.selectedRoots[school] = val.get<std::string>();
            }
        }
    }

    // Grid hint
    if (config.contains("grid_hint") && config["grid_hint"].is_object()) {
        auto& gh = config["grid_hint"];
        BuildConfig::GridHint hint;
        hint.mode = gh.value("mode", std::string("sun"));
        hint.schoolCount = gh.value("schoolCount", 5);
        hint.avgPointsPerSchool = gh.value("avgPointsPerSchool", 0);
        bc.gridHint = hint;
    }

    return bc;
}

// =============================================================================
// SCHOOL COLORS
// =============================================================================

const std::unordered_map<std::string, std::string>& TreeBuilder::GetSchoolColors()
{
    static const std::unordered_map<std::string, std::string> colors = {
        {"Destruction", "#ef4444"},
        {"Conjuration", "#a855f7"},
        {"Alteration",  "#22c55e"},
        {"Illusion",    "#3b82f6"},
        {"Restoration", "#eab308"},
    };
    return colors;
}

// =============================================================================
// THEME COLOR DERIVATION
// =============================================================================

std::unordered_map<std::string, std::string>
TreeBuilder::DeriveThemeColors(const std::string& schoolColorHex,
                               const std::vector<std::string>& themes)
{
    std::unordered_map<std::string, std::string> colors;
    if (themes.empty()) return colors;

    // Parse base color
    auto hex = schoolColorHex;
    if (!hex.empty() && hex[0] == '#') hex = hex.substr(1);

    float r = 0.6f, g = 0.6f, b = 0.6f;
    if (hex.size() >= 6) {
        try {
            r = std::stoul(hex.substr(0, 2), nullptr, 16) / 255.0f;
            g = std::stoul(hex.substr(2, 2), nullptr, 16) / 255.0f;
            b = std::stoul(hex.substr(4, 2), nullptr, 16) / 255.0f;
        } catch (...) {}
    }

    // RGB to HLS
    float maxC = std::max({r, g, b});
    float minC = std::min({r, g, b});
    float L = (maxC + minC) / 2.0f;
    float H = 0.0f, S = 0.0f;
    if (maxC != minC) {
        float d = maxC - minC;
        S = (L > 0.5f) ? d / (2.0f - maxC - minC) : d / (maxC + minC);
        if (maxC == r) H = (g - b) / d + (g < b ? 6.0f : 0.0f);
        else if (maxC == g) H = (b - r) / d + 2.0f;
        else H = (r - g) / d + 4.0f;
        H /= 6.0f;
    }

    // HLS to RGB helper
    auto hueToRgb = [](float p, float q, float t) -> float {
        if (t < 0.0f) t += 1.0f;
        if (t > 1.0f) t -= 1.0f;
        if (t < 1.0f / 6.0f) return p + (q - p) * 6.0f * t;
        if (t < 0.5f) return q;
        if (t < 2.0f / 3.0f) return p + (q - p) * (2.0f / 3.0f - t) * 6.0f;
        return p;
    };
    auto hlsToRgb = [&](float h, float l, float s, float& outR, float& outG, float& outB) {
        if (s == 0.0f) { outR = outG = outB = l; }
        else {
            float q2 = (l < 0.5f) ? l * (1.0f + s) : l + s - l * s;
            float p2 = 2.0f * l - q2;
            outR = hueToRgb(p2, q2, h + 1.0f / 3.0f);
            outG = hueToRgb(p2, q2, h);
            outB = hueToRgb(p2, q2, h - 1.0f / 3.0f);
        }
    };

    auto sortedThemes = themes;
    std::sort(sortedThemes.begin(), sortedThemes.end());
    int themeCount = static_cast<int>(sortedThemes.size());

    for (int i = 0; i < themeCount; ++i) {
        float hue = (themeCount == 1)
            ? H
            : std::fmod(H + static_cast<float>(i) / themeCount, 1.0f);

        float sat = std::clamp(S * (0.85f + 0.3f * (static_cast<float>(i) / std::max(themeCount - 1, 1))),
                               0.2f, 1.0f);
        float lit = std::clamp(L, 0.25f, 0.75f);

        float nr, ng, nb;
        hlsToRgb(hue, lit, sat, nr, ng, nb);

        char buf[8];
        snprintf(buf, sizeof(buf), "#%02x%02x%02x",
                 static_cast<int>(nr * 255), static_cast<int>(ng * 255), static_cast<int>(nb * 255));
        colors[sortedThemes[i]] = buf;
    }

    if (!colors.contains("other"))
        colors["other"] = "#6b7280";

    return colors;
}

// =============================================================================
// INTERNAL SHARED HELPERS
// =============================================================================

bool TreeBuilder::Internal::IsVanillaFormId(const std::string& formIdStr)
{
    try {
        auto val = std::stoul(formIdStr, nullptr, 16);
        return (val >> 24) < 0x05;
    } catch (...) {
        return false;
    }
}

const json* TreeBuilder::Internal::PickRoot(
    const std::unordered_map<std::string, std::vector<json>>& byTier,
    const BuildConfig& config,
    const std::string& school,
    std::mt19937& rng)
{
    // User override
    auto overrideIt = config.selectedRoots.find(school);
    if (overrideIt != config.selectedRoots.end()) {
        for (const auto& [tier, spells] : byTier) {
            for (const auto& s : spells) {
                if (s.value("formId", std::string("")) == overrideIt->second) {
                    return &s;
                }
            }
        }
    }

    // Auto-pick: prefer vanilla from lowest tier
    for (int i = 0; i < TIER_COUNT; ++i) {
        auto it = byTier.find(TIER_NAMES[i]);
        if (it == byTier.end() || it->second.empty()) continue;

        if (config.preferVanillaRoots) {
            std::vector<const json*> vanilla;
            for (const auto& s : it->second) {
                if (IsVanillaFormId(s.value("formId", std::string("")))) {
                    vanilla.push_back(&s);
                }
            }
            if (!vanilla.empty()) {
                std::uniform_int_distribution<int> dist(0, static_cast<int>(vanilla.size()) - 1);
                return vanilla[dist(rng)];
            }
        }

        std::uniform_int_distribution<int> dist(0, static_cast<int>(it->second.size()) - 1);
        return &it->second[dist(rng)];
    }

    return nullptr;
}

void TreeBuilder::Internal::SortByTierAndCost(std::vector<json>& spells)
{
    std::sort(spells.begin(), spells.end(), [](const json& a, const json& b) {
        int tierA = TierIndex(a.value("skillLevel", std::string("")));
        int tierB = TierIndex(b.value("skillLevel", std::string("")));
        if (tierA < 0) tierA = 99;
        if (tierB < 0) tierB = 99;
        if (tierA != tierB) return tierA < tierB;
        float costA = a.value("magickaCost", 0.0f);
        float costB = b.value("magickaCost", 0.0f);
        if (costA == 0.0f) costA = a.value("baseCost", 0.0f);
        if (costB == 0.0f) costB = b.value("baseCost", 0.0f);
        if (costA != costB) return costA < costB;
        return a.value("name", std::string("")) < b.value("name", std::string(""));
    });
}

std::unordered_map<std::string, TreeBuilder::TreeNode>
TreeBuilder::Internal::RebuildValNodes(const json& schoolData)
{
    std::unordered_map<std::string, TreeNode> valNodes;
    for (const auto& nd : schoolData["nodes"]) {
        TreeNode n;
        n.formId = nd.value("formId", std::string(""));
        n.name = nd.value("name", std::string(""));
        n.tier = nd.value("skillLevel", std::string("Unknown"));
        n.depth = nd.value("tier", 1) - 1;
        n.theme = nd.value("theme", std::string(""));
        if (nd.contains("children") && nd["children"].is_array())
            for (const auto& c : nd["children"])
                if (c.is_string()) n.children.push_back(c.get<std::string>());
        if (nd.contains("prerequisites") && nd["prerequisites"].is_array())
            for (const auto& p : nd["prerequisites"])
                if (p.is_string()) n.prerequisites.push_back(p.get<std::string>());
        valNodes[n.formId] = std::move(n);
    }
    return valNodes;
}

void TreeBuilder::Internal::ValidateAndFix(json& treeData, int maxChildren, bool autoFix)
{
    if (autoFix) {
        for (auto& [schoolName, schoolData] : treeData["schools"].items()) {
            auto rootId = schoolData.value("root", std::string(""));
            if (rootId.empty()) continue;

            auto valNodes = RebuildValNodes(schoolData);
            int fixes = FixUnreachableNodes(valNodes, rootId, maxChildren);
            if (fixes > 0) {
                json fixedNodes = json::array();
                for (const auto& [fid, n] : valNodes)
                    fixedNodes.push_back(n.ToDict());
                schoolData["nodes"] = fixedNodes;
            }
        }
    }

    int totalNodes = 0, reachableNodes = 0;
    bool allValid = true;
    for (auto& [schoolName, schoolData] : treeData["schools"].items()) {
        auto rootId = schoolData.value("root", std::string(""));
        if (rootId.empty()) continue;

        auto valNodes = RebuildValNodes(schoolData);
        totalNodes += static_cast<int>(valNodes.size());
        auto unlocked = SimulateUnlocks(valNodes, rootId);
        reachableNodes += static_cast<int>(unlocked.size());
        if (static_cast<int>(unlocked.size()) != static_cast<int>(valNodes.size()))
            allValid = false;
    }

    treeData["validation"] = {
        {"all_valid", allValid},
        {"total_nodes", totalNodes},
        {"reachable_nodes", reachableNodes}
    };
}

// =============================================================================
// HIGH-LEVEL API
// =============================================================================

TreeBuilder::BuildResult TreeBuilder::Build(
    const std::string& command,
    const std::vector<json>& spells,
    const json& configJson)
{
    auto config = BuildConfig::FromJson(configJson);

    logger::info("TreeBuilder::Build command='{}', spells={}, seed={}",
                 command, spells.size(), config.seed);

    if (command == "build_tree_classic") {
        return BuildClassic(spells, config);
    } else if (command == "build_tree") {
        return BuildTree(spells, config);
    } else if (command == "build_tree_thematic") {
        return BuildThematic(spells, config);
    } else if (command == "build_tree_graph") {
        return BuildGraph(spells, config);
    } else if (command == "build_tree_oracle") {
        return BuildOracle(spells, config);
    } else {
        BuildResult result;
        result.success = false;
        result.error = "Unknown build command: " + command;
        return result;
    }
}
