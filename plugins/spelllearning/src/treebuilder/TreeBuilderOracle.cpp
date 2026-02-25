#include "treebuilder/TreeBuilderInternal.h"
#include "OpenRouterAPI.h"

#include <algorithm>
#include <chrono>
#include <random>
#include <sstream>

using namespace TreeBuilder::Internal;

// =============================================================================
// ORACLE BUILDER — LLM-Guided Semantic Chain or Cluster Lane Fallback
// =============================================================================

static std::string EscapeForPrompt(const std::string& s)
{
    std::string result;
    result.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '\\': result += "\\\\"; break;
            case '"':  result += "\\\""; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default:   result += c; break;
        }
    }
    return result;
}

// Build LLM grouping prompt for a school's spells
static std::string BuildLLMGroupingPrompt(
    const std::vector<json>& spells, const std::string& schoolName)
{
    std::string spellBlock;
    for (const auto& s : spells) {
        auto fid = s.value("formId", std::string("?"));
        auto name = EscapeForPrompt(s.value("name", fid));
        auto tier = EscapeForPrompt(s.value("skillLevel", std::string("?")));
        auto desc = s.value("description", std::string(""));
        if (desc.empty()) desc = s.value("desc", std::string(""));
        if (desc.size() > 60) desc = desc.substr(0, 60);
        desc = EscapeForPrompt(desc);

        std::string effStr;
        auto effs = s.value("effectNames", json::array());
        if (effs.is_array()) {
            int count = 0;
            for (const auto& e : effs) {
                if (count >= 3) break;
                if (e.is_string()) {
                    if (!effStr.empty()) effStr += ", ";
                    effStr += EscapeForPrompt(e.get<std::string>());
                    count++;
                }
            }
        }

        spellBlock += "  - id=\"" + fid + "\" name=\"" + name + "\" tier=" + tier;
        if (!effStr.empty()) spellBlock += " effects=[" + effStr + "]";
        if (!desc.empty()) spellBlock += " desc=\"" + desc + "\"";
        spellBlock += "\n";
    }

    auto firstFid = spells.empty() ? "0x000"
        : spells[0].value("formId", std::string("0x000"));

    return "You are a Skyrim spell taxonomy expert. "
        "These are " + schoolName + " spells. Group them into thematic "
        "learning chains within the " + schoolName + " school.\n\n"
        "Group these spells into 3-8 thematic learning chains. Order each chain from\n"
        "simplest/most fundamental to most advanced. Every spell must belong to\n"
        "exactly one chain. Each chain should represent a coherent progression\n"
        "(e.g., \"Fire Mastery\": Flames -> Fire Rune -> Fireball -> Incinerate).\n\n"
        "SPELLS:\n" + spellBlock + "\n"
        "Return ONLY valid JSON in this exact format (no explanation):\n"
        "{\n"
        "  \"chains\": [\n"
        "    {\n"
        "      \"name\": \"Chain Theme Name\",\n"
        "      \"narrative\": \"Brief 1-sentence learning progression description\",\n"
        "      \"spellIds\": [\"" + firstFid + "\", ...]\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        "RULES:\n"
        "- Every spell ID from the list above MUST appear in exactly one chain\n"
        "- Order spells within each chain from easiest (Novice) to hardest (Master)\n"
        "- 3-8 chains total\n"
        "- Chain names should be evocative (e.g., \"Pyromancer's Path\", \"Frost Mastery\")\n"
        "- Return ONLY the JSON object";
}

// Parse and validate LLM chain response
static std::vector<json> ParseLLMChains(
    const std::string& responseContent,
    const std::unordered_set<std::string>& validIds)
{
    std::vector<json> result;

    // Try to find JSON in the response (LLM may wrap it in markdown)
    std::string jsonStr = responseContent;

    // Strip markdown code fences if present
    auto jsonStart = jsonStr.find('{');
    auto jsonEnd = jsonStr.rfind('}');
    if (jsonStart != std::string::npos && jsonEnd != std::string::npos && jsonEnd > jsonStart)
        jsonStr = jsonStr.substr(jsonStart, jsonEnd - jsonStart + 1);

    json parsed;
    try {
        parsed = json::parse(jsonStr);
    } catch (const std::exception& e) {
        logger::warn("Oracle: Failed to parse LLM JSON: {}", e.what());
        return {};
    }

    auto chains = parsed.value("chains", json::array());
    if (!chains.is_array() || chains.empty()) {
        logger::warn("Oracle: LLM response missing 'chains' array");
        return {};
    }

    std::unordered_set<std::string> seenIds;

    for (const auto& chain : chains) {
        if (!chain.is_object()) continue;
        auto name = chain.value("name", std::string(""));
        auto spellIds = chain.value("spellIds", json::array());
        auto narrative = chain.value("narrative", std::string(""));
        if (name.empty() || !spellIds.is_array() || spellIds.empty()) continue;

        json filteredIds = json::array();
        for (const auto& sid : spellIds) {
            if (!sid.is_string()) continue;
            auto id = sid.get<std::string>();
            if (validIds.contains(id) && !seenIds.contains(id)) {
                filteredIds.push_back(id);
                seenIds.insert(id);
            }
        }

        if (!filteredIds.empty()) {
            json cleaned;
            cleaned["name"] = name;
            cleaned["narrative"] = narrative;
            cleaned["spellIds"] = filteredIds;
            result.push_back(cleaned);
        }
    }

    // Any missed spells get appended to last chain
    if (!result.empty()) {
        auto& lastChain = result.back();
        for (const auto& vid : validIds) {
            if (!seenIds.contains(vid))
                lastChain["spellIds"].push_back(vid);
        }
    }

    return result;
}

// Merge chains with similar names (>50% word overlap)
static std::vector<json> MergeSimilarChains(const std::vector<json>& chains)
{
    if (chains.size() <= 1) return chains;

    auto splitWords = [](const std::string& s) -> std::unordered_set<std::string> {
        std::unordered_set<std::string> words;
        std::istringstream iss(s);
        std::string word;
        while (iss >> word) {
            std::transform(word.begin(), word.end(), word.begin(),
                [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            words.insert(word);
        }
        return words;
    };

    std::vector<bool> used(chains.size(), false);
    std::vector<json> merged;

    for (size_t i = 0; i < chains.size(); ++i) {
        if (used[i]) continue;
        used[i] = true;

        json combined = chains[i];
        auto wordsA = splitWords(chains[i].value("name", std::string("")));

        for (size_t j = i + 1; j < chains.size(); ++j) {
            if (used[j]) continue;
            auto wordsB = splitWords(chains[j].value("name", std::string("")));

            if (!wordsA.empty() && !wordsB.empty()) {
                int overlap = 0;
                for (const auto& w : wordsA)
                    if (wordsB.contains(w)) overlap++;
                float ratio = static_cast<float>(overlap) /
                    std::min(wordsA.size(), wordsB.size());

                if (ratio >= 0.5f) {
                    std::unordered_set<std::string> existingIds;
                    for (const auto& id : combined["spellIds"])
                        if (id.is_string()) existingIds.insert(id.get<std::string>());
                    for (const auto& id : chains[j]["spellIds"]) {
                        if (!id.is_string()) continue;
                        if (existingIds.contains(id.get<std::string>())) continue;
                        existingIds.insert(id.get<std::string>());
                        combined["spellIds"].push_back(id);
                    }
                    used[j] = true;
                    if (combined.value("narrative", std::string("")).empty())
                        combined["narrative"] = chains[j].value("narrative", std::string(""));
                }
            }
        }

        merged.push_back(combined);
    }

    return merged;
}

// Call LLM to group spells into chains (with batching for large lists)
static std::vector<json> LLMGroupSpells(
    const std::vector<json>& spells,
    const std::string& schoolName,
    int batchSize)
{
    std::unordered_set<std::string> validIds;
    for (const auto& s : spells)
        if (s.contains("formId") && s["formId"].is_string())
            validIds.insert(s["formId"].get<std::string>());

    if (static_cast<int>(spells.size()) <= batchSize) {
        // Single batch
        auto prompt = BuildLLMGroupingPrompt(spells, schoolName);
        auto response = OpenRouterAPI::SendPrompt(
            "You are a game design AI that outputs only valid JSON.",
            prompt);

        if (!response.success) {
            logger::warn("Oracle LLM call failed for {}: {}", schoolName, response.error);
            return {};
        }

        return ParseLLMChains(response.content, validIds);
    }

    // Multi-batch
    std::vector<json> allChains;
    for (int start = 0; start < static_cast<int>(spells.size()); start += batchSize) {
        int end = std::min(start + batchSize, static_cast<int>(spells.size()));
        std::vector<json> batch(spells.begin() + start, spells.begin() + end);

        std::unordered_set<std::string> batchIds;
        for (const auto& s : batch)
            if (s.contains("formId") && s["formId"].is_string())
                batchIds.insert(s["formId"].get<std::string>());

        auto prompt = BuildLLMGroupingPrompt(batch, schoolName);
        auto response = OpenRouterAPI::SendPrompt(
            "You are a game design AI that outputs only valid JSON.",
            prompt);

        if (response.success) {
            auto batchChains = ParseLLMChains(response.content, batchIds);
            for (auto& c : batchChains) allChains.push_back(std::move(c));
        }
    }

    if (allChains.empty()) return {};

    // Merge similar chains across batches
    auto merged = MergeSimilarChains(allChains);

    // Verify coverage
    std::unordered_set<std::string> covered;
    for (const auto& c : merged)
        for (const auto& id : c["spellIds"])
            if (id.is_string()) covered.insert(id.get<std::string>());

    for (const auto& vid : validIds)
        if (!covered.contains(vid) && !merged.empty())
            merged.back()["spellIds"].push_back(vid);

    return merged;
}

// Build a school tree from LLM-provided chains
static json BuildSchoolTreeLLM(
    const std::vector<json>& spells,
    const std::string& schoolName,
    const std::vector<json>& chains,
    int maxChildren,
    const TreeBuilder::BuildConfig& config,
    std::mt19937& rng)
{
    if (spells.empty() || chains.empty()) return nullptr;
    (void)maxChildren;  // Chains are sequential; capacity handled by force-connect

    // Group by tier and pick root
    std::unordered_map<std::string, std::vector<json>> byTier;
    for (const auto& spell : spells) {
        auto tier = spell.value("skillLevel", std::string(""));
        if (TreeBuilder::TierIndex(tier) < 0) tier = "Novice";
        byTier[tier].push_back(spell);
    }

    auto* rootSpell = PickRoot(byTier, config, schoolName, rng);
    if (!rootSpell) return nullptr;
    auto rootId = rootSpell->value("formId", std::string(""));

    // Create nodes
    std::unordered_map<std::string, TreeBuilder::TreeNode> nodes;
    std::unordered_map<std::string, json> spellLookup;
    for (const auto& spell : spells) {
        auto fid = spell.value("formId", std::string(""));
        if (!fid.empty()) {
            nodes[fid] = TreeBuilder::TreeNode::FromSpell(spell);
            spellLookup[fid] = spell;
        }
    }

    if (!nodes.contains(rootId)) return nullptr;
    auto& rootNode = nodes[rootId];
    rootNode.isRoot = true;
    rootNode.depth = 0;

    std::unordered_set<std::string> connected;
    connected.insert(rootId);

    // Build each chain as a directed path
    for (const auto& chain : chains) {
        auto chainName = chain.value("name", std::string("Unnamed"));
        auto chainIds = chain.value("spellIds", json::array());

        std::vector<std::string> validChainIds;
        for (const auto& id : chainIds) {
            if (id.is_string() && nodes.contains(id.get<std::string>()))
                validChainIds.push_back(id.get<std::string>());
        }
        if (validChainIds.empty()) continue;

        // Sort by tier for consistent progression
        std::sort(validChainIds.begin(), validChainIds.end(),
            [&nodes, &spellLookup](const std::string& a, const std::string& b) {
                int ta = TreeBuilder::TierIndex(nodes[a].tier);
                int tb = TreeBuilder::TierIndex(nodes[b].tier);
                if (ta < 0) ta = 99;
                if (tb < 0) tb = 99;
                if (ta != tb) return ta < tb;
                float ca = spellLookup[a].value("magickaCost", 0.0f);
                float cb = spellLookup[b].value("magickaCost", 0.0f);
                return ca < cb;
            });

        // Tag nodes with chain name
        for (const auto& fid : validChainIds) nodes[fid].theme = chainName;

        // Connect chain root to school root
        auto& chainRootId = validChainIds[0];
        if (chainRootId != rootId && !connected.contains(chainRootId)) {
            TreeBuilder::LinkNodes(rootNode, nodes[chainRootId]);
            connected.insert(chainRootId);
        }

        // Link rest of chain sequentially
        auto prevId = (chainRootId != rootId) ? chainRootId : rootId;
        for (size_t i = 1; i < validChainIds.size(); ++i) {
            auto& fid = validChainIds[i];
            if (connected.contains(fid)) continue;
            auto prevIt = nodes.find(prevId);
            auto curIt = nodes.find(fid);
            if (prevIt != nodes.end() && curIt != nodes.end()) {
                TreeBuilder::LinkNodes(prevIt->second, curIt->second);
                connected.insert(fid);
                prevId = fid;
            }
        }
    }

    // Force-connect remaining unconnected nodes
    for (auto& [fid, node] : nodes) {
        if (connected.contains(fid)) continue;
        int nodeTier = std::max(0, TreeBuilder::TierIndex(node.tier));
        TreeBuilder::TreeNode* bestP = nullptr;
        float bestSc = -std::numeric_limits<float>::max();

        for (const auto& cid : connected) {
            auto& cnode = nodes[cid];
            int ct = std::max(0, TreeBuilder::TierIndex(cnode.tier));
            float sc = (ct <= nodeTier) ? 100.0f - (nodeTier - ct) * 5.0f : -200.0f;
            if (!node.theme.empty() && node.theme == cnode.theme) sc += 25.0f;
            sc -= static_cast<float>(cnode.children.size()) * 10.0f;
            if (sc > bestSc) { bestSc = sc; bestP = &cnode; }
        }
        if (bestP) {
            TreeBuilder::LinkNodes(*bestP, node);
            connected.insert(fid);
        } else {
            TreeBuilder::LinkNodes(rootNode, node);
            connected.insert(fid);
        }
    }

    // Serialize
    const auto& schoolColors = TreeBuilder::GetSchoolColors();
    auto color = schoolColors.contains(schoolName) ? schoolColors.at(schoolName) : std::string("#888888");

    json nodesList = json::array();
    for (const auto& [fid, nd] : nodes) {
        auto d = nd.ToDict();
        if (!nd.theme.empty()) d["chain"] = nd.theme;
        nodesList.push_back(d);
    }

    json chainMeta = json::array();
    for (const auto& chain : chains)
        chainMeta.push_back({
            {"name", chain.value("name", std::string(""))},
            {"spellIds", chain.value("spellIds", json::array())},
            {"narrative", chain.value("narrative", std::string(""))}
        });

    json schoolResult;
    schoolResult["root"] = rootId;
    schoolResult["layoutStyle"] = "oracle_llm";
    schoolResult["color"] = color;
    schoolResult["nodes"] = nodesList;
    schoolResult["chains"] = chainMeta;
    schoolResult["config_used"] = {
        {"shape", "oracle_chains"}, {"density", config.density},
        {"symmetry", config.symmetry}, {"source", "oracle_llm"},
        {"chain_style", config.chainStyle}
    };
    return schoolResult;
}

// Build a school tree in Cluster Lane fallback mode (no LLM)
static json BuildSchoolTreeFallback(
    const std::vector<json>& spells,
    const std::string& schoolName,
    const std::vector<std::string>& themes,
    int maxChildren,
    const TreeBuilder::BuildConfig& config,
    std::mt19937& rng)
{
    if (spells.empty()) return nullptr;

    std::unordered_map<std::string, std::vector<json>> byTier;
    for (const auto& spell : spells) {
        auto tier = spell.value("skillLevel", std::string(""));
        if (TreeBuilder::TierIndex(tier) < 0) tier = "Novice";
        byTier[tier].push_back(spell);
    }

    auto* rootSpell = PickRoot(byTier, config, schoolName, rng);
    if (!rootSpell) return nullptr;
    auto rootId = rootSpell->value("formId", std::string(""));

    std::unordered_map<std::string, TreeBuilder::TreeNode> nodes;
    for (const auto& spell : spells) {
        auto fid = spell.value("formId", std::string(""));
        if (!fid.empty()) nodes[fid] = TreeBuilder::TreeNode::FromSpell(spell);
    }
    if (!nodes.contains(rootId)) return nullptr;

    auto& rootNode = nodes[rootId];
    rootNode.isRoot = true;
    rootNode.depth = 0;

    // Group spells by theme
    auto groups = themes.empty()
        ? std::unordered_map<std::string, std::vector<json>>{{"General", spells}}
        : TreeBuilder::GroupSpellsBestFit(spells, themes, 30);

    std::unordered_set<std::string> connected;
    connected.insert(rootId);
    json chainMeta = json::array();

    for (const auto& [themeName, themeSpells] : groups) {
        if (themeName == "_unassigned" || themeSpells.empty()) continue;

        // Sort by tier then cost
        auto sorted = themeSpells;
        std::sort(sorted.begin(), sorted.end(), [](const json& a, const json& b) {
            int ta = TreeBuilder::TierIndex(a.value("skillLevel", std::string("")));
            int tb = TreeBuilder::TierIndex(b.value("skillLevel", std::string("")));
            if (ta < 0) ta = 99;
            if (tb < 0) tb = 99;
            if (ta != tb) return ta < tb;
            return a.value("magickaCost", 0.0f) < b.value("magickaCost", 0.0f);
        });

        json chainIds = json::array();
        for (const auto& s : sorted) {
            auto fid = s.value("formId", std::string(""));
            if (!fid.empty() && nodes.contains(fid)) {
                chainIds.push_back(fid);
                nodes[fid].theme = themeName;
            }
        }
        if (chainIds.empty()) continue;

        // Connect first spell to root
        auto firstId = chainIds[0].get<std::string>();
        if (firstId != rootId && !connected.contains(firstId)) {
            if (static_cast<int>(rootNode.children.size()) < maxChildren) {
                TreeBuilder::LinkNodes(rootNode, nodes[firstId]);
            } else {
                // Find available parent
                TreeBuilder::TreeNode* avail = nullptr;
                size_t minCh = 999;
                for (const auto& cid : connected) {
                    auto& n = nodes[cid];
                    if (n.children.size() < minCh && static_cast<int>(n.children.size()) < maxChildren) {
                        minCh = n.children.size();
                        avail = &n;
                    }
                }
                if (avail) TreeBuilder::LinkNodes(*avail, nodes[firstId]);
                else TreeBuilder::LinkNodes(rootNode, nodes[firstId]);
            }
            connected.insert(firstId);
        }

        // Chain rest sequentially
        auto prevId = (firstId != rootId) ? firstId : rootId;
        for (size_t i = 1; i < chainIds.size(); ++i) {
            auto fid = chainIds[i].get<std::string>();
            if (connected.contains(fid)) continue;
            auto prevIt = nodes.find(prevId);
            if (prevIt != nodes.end() &&
                static_cast<int>(prevIt->second.children.size()) < maxChildren) {
                TreeBuilder::LinkNodes(prevIt->second, nodes[fid]);
                connected.insert(fid);
                prevId = fid;
            } else {
                TreeBuilder::TreeNode* avail = nullptr;
                size_t minCh = 999;
                for (const auto& cid : connected) {
                    auto& n = nodes[cid];
                    // Fallback allows +2 overflow to avoid orphan nodes in edge cases
                    if (n.children.size() < minCh && static_cast<int>(n.children.size()) < maxChildren + 2) {
                        minCh = n.children.size();
                        avail = &n;
                    }
                }
                if (avail) {
                    TreeBuilder::LinkNodes(*avail, nodes[fid]);
                    connected.insert(fid);
                    prevId = fid;
                }
            }
        }

        // Capitalize theme name for display
        auto displayName = themeName;
        if (!displayName.empty()) displayName[0] = static_cast<char>(toupper(static_cast<unsigned char>(displayName[0])));

        chainMeta.push_back({
            {"name", displayName},
            {"spellIds", chainIds},
            {"narrative", themeName + " progression lane"}
        });
    }

    // Handle unassigned
    if (groups.contains("_unassigned")) {
        for (const auto& spell : groups.at("_unassigned")) {
            auto fid = spell.value("formId", std::string(""));
            if (fid.empty() || !nodes.contains(fid) || connected.contains(fid)) continue;
            nodes[fid].theme = "_unassigned";
            TreeBuilder::TreeNode* avail = nullptr;
            size_t minCh = 999;
            for (const auto& cid : connected) {
                auto& n = nodes[cid];
                if (n.children.size() < minCh && static_cast<int>(n.children.size()) < maxChildren) {
                    minCh = n.children.size();
                    avail = &n;
                }
            }
            if (avail) {
                TreeBuilder::LinkNodes(*avail, nodes[fid]);
                connected.insert(fid);
            }
        }
    }

    // Force-connect remaining
    for (auto& [fid, nd] : nodes) {
        if (connected.contains(fid)) continue;
        int nodeTier = std::max(0, TreeBuilder::TierIndex(nd.tier));
        TreeBuilder::TreeNode* bestP = nullptr;
        float bestSc = -std::numeric_limits<float>::max();
        for (const auto& cid : connected) {
            auto& cnd = nodes[cid];
            int ct = std::max(0, TreeBuilder::TierIndex(cnd.tier));
            float sc = (ct <= nodeTier) ? 100.0f - (nodeTier - ct) * 5.0f : -200.0f;
            if (!nd.theme.empty() && nd.theme == cnd.theme) sc += 25.0f;
            sc -= static_cast<float>(cnd.children.size()) * 10.0f;
            if (sc > bestSc) { bestSc = sc; bestP = &cnd; }
        }
        if (bestP) TreeBuilder::LinkNodes(*bestP, nd);
        else TreeBuilder::LinkNodes(rootNode, nd);
        connected.insert(fid);
    }

    const auto& schoolColors = TreeBuilder::GetSchoolColors();
    auto color = schoolColors.contains(schoolName) ? schoolColors.at(schoolName) : std::string("#888888");

    json nodesList = json::array();
    for (const auto& [fid, nd] : nodes) {
        auto d = nd.ToDict();
        if (!nd.theme.empty()) d["chain"] = nd.theme;
        nodesList.push_back(d);
    }

    json schoolResult;
    schoolResult["root"] = rootId;
    schoolResult["layoutStyle"] = "oracle_cluster_lane";
    schoolResult["color"] = color;
    schoolResult["nodes"] = nodesList;
    schoolResult["chains"] = chainMeta;
    schoolResult["config_used"] = {
        {"shape", "cluster_lanes"}, {"density", config.density},
        {"symmetry", config.symmetry}, {"source", "oracle_fallback"}
    };
    return schoolResult;
}

TreeBuilder::BuildResult TreeBuilder::BuildOracle(
    const std::vector<json>& spells,
    const BuildConfig& config)
{
    auto startTime = std::chrono::steady_clock::now();
    BuildResult result;

    int usedSeed = config.seed;
    if (usedSeed == 0)
        usedSeed = static_cast<int>(
            std::chrono::system_clock::now().time_since_epoch().count() % 1000000);
    std::mt19937 rng(usedSeed);

    float chaos = std::clamp(config.chaos, 0.0f, 1.0f);
    int maxChildren = std::clamp(config.maxChildrenPerNode, 1, 8);
    if (maxChildren == 3) maxChildren = 4;  // Oracle defaults to 4

    // Check if LLM is available
    bool llmAvailable = false;
    if (config.llmApi && config.llmApi->enabled && !config.llmApi->apiKey.empty()) {
        // NOTE: Mutates global config. Thread safety depends on single-threaded tree building.
        auto& orConfig = OpenRouterAPI::GetConfig();
        orConfig.apiKey = config.llmApi->apiKey;
        if (!config.llmApi->model.empty()) orConfig.model = config.llmApi->model;
        orConfig.maxTokens = 3000;
        llmAvailable = true;
    } else {
        // Try loading from OpenRouterAPI's own config file
        OpenRouterAPI::Initialize();
        llmAvailable = !OpenRouterAPI::GetConfig().apiKey.empty();
    }

    std::string actualMode = llmAvailable ? "llm" : "fallback";
    logger::info("Oracle builder: mode={}, chaos={}, batchSize={}",
                 actualMode, chaos, config.batchSize);

    static const std::unordered_set<std::string> VALID_SCHOOLS = {
        "Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"
    };

    std::unordered_map<std::string, std::vector<json>> schoolSpells;
    for (const auto& spell : spells) {
        auto school = spell.value("school", std::string(""));
        if (VALID_SCHOOLS.contains(school))
            schoolSpells[school].push_back(spell);
    }

    // Discover themes for fallback / quality signal
    auto themesMap = DiscoverThemesPerSchool(spells, config.topThemesPerSchool);
    themesMap = MergeWithHints(themesMap, config.topThemesPerSchool + 4);

    json treeData;
    treeData["version"] = "1.0";
    treeData["schools"] = json::object();

    for (auto& [schoolName, schoolSpellList] : schoolSpells) {
        if (schoolSpellList.empty()) continue;

        json schoolResult = nullptr;

        // Try LLM mode
        if (llmAvailable) {
            try {
                auto chains = LLMGroupSpells(schoolSpellList, schoolName, config.batchSize);
                if (!chains.empty()) {
                    schoolResult = BuildSchoolTreeLLM(
                        schoolSpellList, schoolName, chains,
                        maxChildren, config, rng);
                    if (!schoolResult.is_null()) {
                        logger::info("Oracle {}: LLM built {} nodes, {} chains",
                            schoolName,
                            schoolResult["nodes"].size(),
                            chains.size());
                    }
                } else {
                    logger::warn("Oracle {}: LLM returned no chains, falling back", schoolName);
                }
            } catch (const std::exception& e) {
                logger::error("Oracle {}: LLM error: {}", schoolName, e.what());
            }
        }

        // Fallback: Cluster Lane
        if (schoolResult.is_null()) {
            if (llmAvailable) actualMode = "mixed";
            auto schoolThemes = themesMap.contains(schoolName)
                ? themesMap[schoolName] : std::vector<std::string>{};
            schoolResult = BuildSchoolTreeFallback(
                schoolSpellList, schoolName, schoolThemes,
                maxChildren, config, rng);
        }

        if (!schoolResult.is_null())
            treeData["schools"][schoolName] = schoolResult;
    }

    treeData["generatedAt"] = std::to_string(
        std::chrono::system_clock::now().time_since_epoch().count());
    treeData["generator"] = "OracleTreeBuilder (LLM-Guided, C++)";
    treeData["seed"] = usedSeed;
    treeData["llm_mode"] = actualMode;
    treeData["config"] = {
        {"shape", actualMode == "fallback" ? "cluster_lanes" : "oracle_chains"},
        {"density", config.density}, {"symmetry", config.symmetry},
        {"chaos", chaos}, {"chain_style", config.chainStyle}
    };

    ValidateAndFix(treeData, maxChildren, config.autoFixUnreachable);

    auto endTime = std::chrono::steady_clock::now();
    result.elapsedMs = std::chrono::duration<float, std::milli>(endTime - startTime).count();
    result.treeData = std::move(treeData);
    result.success = true;
    return result;
}
