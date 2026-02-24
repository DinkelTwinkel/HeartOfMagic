#include "treebuilder/TreeBuilderInternal.h"

#include <algorithm>
#include <chrono>
#include <queue>
#include <random>

using namespace TreeBuilder::Internal;

// =============================================================================
// GRAPH BUILDER — Greedy Arborescence with Constraint Enforcement
// =============================================================================

// Constrain branching factor (reroute weakest children of overloaded nodes)
static void ConstrainBranching(
    std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes,
    int maxChildren,
    const TreeBuilder::SimilarityMatrix& sims)
{
    for (int pass = 0; pass < 10; ++pass) {
        bool changed = false;
        for (auto& [fid, node] : nodes) {
            if (static_cast<int>(node.children.size()) <= maxChildren) continue;

            // Score children by affinity
            std::vector<std::pair<float, std::string>> childScores;
            for (const auto& chFid : node.children) {
                float sc = sims.GetEffectSim(fid, chFid) * 30.0f
                         + sims.GetTextSim(fid, chFid) * 20.0f
                         + sims.GetNameSim(fid, chFid) * 10.0f;
                childScores.emplace_back(sc, chFid);
            }
            std::sort(childScores.begin(), childScores.end(),
                [](const auto& a, const auto& b) { return a.first > b.first; });

            std::unordered_set<std::string> keep;
            for (int i = 0; i < maxChildren && i < static_cast<int>(childScores.size()); ++i)
                keep.insert(childScores[i].second);

            for (size_t i = maxChildren; i < childScores.size(); ++i) {
                auto& rerouteFid = childScores[i].second;
                auto rerouteIt = nodes.find(rerouteFid);
                if (rerouteIt == nodes.end()) continue;

                // Find best sibling to adopt
                TreeBuilder::TreeNode* bestSib = nullptr;
                float bestSibSc = -std::numeric_limits<float>::max();
                for (const auto& sibFid : keep) {
                    auto sibIt = nodes.find(sibFid);
                    if (sibIt == nodes.end() ||
                        static_cast<int>(sibIt->second.children.size()) >= maxChildren)
                        continue;
                    float sc = sims.GetEffectSim(sibFid, rerouteFid) * 30.0f
                             + sims.GetTextSim(sibFid, rerouteFid) * 20.0f
                             - static_cast<float>(sibIt->second.children.size()) * 5.0f;
                    if (sc > bestSibSc) { bestSibSc = sc; bestSib = &sibIt->second; }
                }

                if (!bestSib) {
                    // Try any node with capacity at lower or equal tier
                    int rTier = std::max(0, TreeBuilder::TierIndex(rerouteIt->second.tier));
                    for (auto& [oFid, oNode] : nodes) {
                        if (oFid == rerouteFid || oFid == fid) continue;
                        if (static_cast<int>(oNode.children.size()) >= maxChildren) continue;
                        int oTier = std::max(0, TreeBuilder::TierIndex(oNode.tier));
                        if (oTier <= rTier) { bestSib = &oNode; break; }
                    }
                }

                if (bestSib) {
                    TreeBuilder::UnlinkNodes(node, rerouteIt->second);
                    TreeBuilder::LinkNodes(*bestSib, rerouteIt->second);
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }
}

// Enforce tier ordering (child tier should be > parent tier)
static void EnforceTierOrdering(
    std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes,
    const std::string& rootId,
    int maxChildren,
    const TreeBuilder::SimilarityMatrix& sims)
{
    for (int pass = 0; pass < 5; ++pass) {
        bool found = false;
        for (auto& [fid, node] : nodes) {
            int nodeTier = std::max(0, TreeBuilder::TierIndex(node.tier));

            for (const auto& chFid : std::vector<std::string>(node.children)) {
                auto chIt = nodes.find(chFid);
                if (chIt == nodes.end()) continue;
                int chTier = std::max(0, TreeBuilder::TierIndex(chIt->second.tier));

                if (chTier <= nodeTier && fid != rootId) {
                    // Find better parent at lower tier
                    TreeBuilder::TreeNode* newParent = nullptr;
                    float bestSc = -std::numeric_limits<float>::max();
                    for (auto& [cFid, cNode] : nodes) {
                        if (cFid == chFid || cFid == fid) continue;
                        int cTier = std::max(0, TreeBuilder::TierIndex(cNode.tier));
                        if (cTier >= chTier) continue;
                        if (static_cast<int>(cNode.children.size()) >= maxChildren) continue;
                        float sc = sims.GetEffectSim(cFid, chFid) * 20.0f
                                 + sims.GetTextSim(cFid, chFid) * 15.0f
                                 - static_cast<float>(cNode.children.size()) * 5.0f
                                 - std::abs(chTier - cTier - 1) * 3.0f;
                        if (sc > bestSc) { bestSc = sc; newParent = &cNode; }
                    }
                    if (newParent) {
                        TreeBuilder::UnlinkNodes(node, chIt->second);
                        TreeBuilder::LinkNodes(*newParent, chIt->second);
                        found = true;
                    }
                }
            }
        }
        if (!found) break;
    }
}

// Assign depths via BFS
static void AssignDepthsBFS(
    std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes,
    const std::string& rootId)
{
    auto rootIt = nodes.find(rootId);
    if (rootIt == nodes.end()) return;

    rootIt->second.depth = 0;
    std::unordered_set<std::string> visited;
    visited.insert(rootId);
    std::queue<std::string> bfsQ;
    bfsQ.push(rootId);

    while (!bfsQ.empty()) {
        auto curFid = bfsQ.front();
        bfsQ.pop();
        auto& cur = nodes[curFid];
        for (const auto& chFid : cur.children) {
            if (visited.contains(chFid)) continue;
            auto chIt = nodes.find(chFid);
            if (chIt != nodes.end()) {
                chIt->second.depth = cur.depth + 1;
                visited.insert(chFid);
                bfsQ.push(chFid);
            }
        }
    }

    // Unvisited nodes get tier-based depth
    for (auto& [fid, nd] : nodes)
        if (!visited.contains(fid))
            nd.depth = std::max(0, TreeBuilder::TierIndex(nd.tier));
}

TreeBuilder::BuildResult TreeBuilder::BuildGraph(
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
    float forceBalance = std::clamp(config.forceBalance, 0.0f, 1.0f);
    int maxChildren = std::clamp(config.maxChildrenPerNode, 1, 8);

    if (config.gridHint) {
        auto& hint = *config.gridHint;
        if (hint.mode == "sun" && maxChildren > 3 && hint.avgPointsPerSchool < 40)
            maxChildren = 3;
        else if (hint.mode == "flat" && maxChildren < 5 && hint.avgPointsPerSchool > 60)
            maxChildren = 5;
    }

    static const std::unordered_set<std::string> VALID_SCHOOLS = {
        "Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"
    };

    std::unordered_map<std::string, std::vector<json>> schoolSpells;
    for (const auto& spell : spells) {
        auto school = spell.value("school", std::string(""));
        if (VALID_SCHOOLS.contains(school))
            schoolSpells[school].push_back(spell);
    }

    auto themesMap = DiscoverThemesPerSchool(spells, config.topThemesPerSchool);
    themesMap = MergeWithHints(themesMap, config.topThemesPerSchool + 4);

    const auto& schoolColors = GetSchoolColors();

    json treeData;
    treeData["version"] = "1.0";
    treeData["schools"] = json::object();

    for (auto& [schoolName, schoolSpellList] : schoolSpells) {
        if (schoolSpellList.empty()) continue;

        auto sims = ComputeSimilarityMatrix(schoolSpellList);
        auto schoolThemes = themesMap.contains(schoolName)
            ? themesMap[schoolName] : std::vector<std::string>{};

        // Group by tier
        std::unordered_map<std::string, std::vector<json>> byTier;
        std::vector<json> unknownTier;
        for (const auto& spell : schoolSpellList) {
            auto tier = spell.value("skillLevel", std::string(""));
            if (TierIndex(tier) >= 0)
                byTier[tier].push_back(spell);
            else
                unknownTier.push_back(spell);
        }
        for (auto& u : unknownTier) byTier["Novice"].push_back(u);

        auto* rootSpell = PickRoot(byTier, config, schoolName, rng);
        if (!rootSpell) continue;
        auto rootFormId = rootSpell->value("formId", std::string(""));

        // Create nodes
        std::unordered_map<std::string, TreeNode> nodes;
        for (const auto& spell : schoolSpellList) {
            auto node = TreeNode::FromSpell(spell);
            nodes[node.formId] = std::move(node);
        }
        if (!nodes.contains(rootFormId)) continue;

        auto& rootNode = nodes[rootFormId];
        rootNode.isRoot = true;
        rootNode.depth = 0;

        // Assign themes
        if (!schoolThemes.empty()) {
            // Build formId -> index lookup to avoid O(n^2) linear search
            std::unordered_map<std::string, size_t> spellIndex;
            for (size_t idx = 0; idx < schoolSpellList.size(); ++idx)
                spellIndex[schoolSpellList[idx].value("formId", std::string(""))] = idx;

            for (auto& [fid, node] : nodes) {
                auto idxIt = spellIndex.find(fid);
                if (idxIt != spellIndex.end()) {
                    auto [theme, score] = GetSpellPrimaryTheme(schoolSpellList[idxIt->second], schoolThemes);
                    node.theme = (score > 30) ? theme : "";
                }
            }
        }

        // Precompute tier indices
        std::unordered_map<std::string, int> tierIdxMap;
        for (const auto& [fid, nd] : nodes)
            tierIdxMap[fid] = std::max(0, TierIndex(nd.tier));

        // === Greedy tier-ordered builder ===
        for (auto& [fid, nd] : nodes) { nd.children.clear(); nd.prerequisites.clear(); }
        rootNode.isRoot = true;

        std::unordered_set<std::string> connected;
        connected.insert(rootFormId);
        std::unordered_map<int, std::vector<TreeNode*>> available;
        available[0].push_back(&rootNode);

        for (int tierIdx = 0; tierIdx < TIER_COUNT; ++tierIdx) {
            auto tierName = std::string(TIER_NAMES[tierIdx]);
            auto it = byTier.find(tierName);
            if (it == byTier.end()) continue;

            auto tierSpells = it->second;
            std::shuffle(tierSpells.begin(), tierSpells.end(), rng);
            std::vector<TreeNode*> placedThisTier;

            for (const auto& spell : tierSpells) {
                auto fid = spell.value("formId", std::string(""));
                if (fid == rootFormId || connected.contains(fid)) continue;
                auto nodeIt = nodes.find(fid);
                if (nodeIt == nodes.end()) continue;
                auto& node = nodeIt->second;

                TreeNode* bestParent = nullptr;
                float bestScore = -std::numeric_limits<float>::max();

                for (int searchTier = tierIdx; searchTier >= 0; --searchTier) {
                    for (auto* cand : available[searchTier]) {
                        if (static_cast<int>(cand->children.size()) >= maxChildren) continue;

                        float score = 0.0f;
                        score += sims.GetEffectSim(fid, cand->formId) * 40.0f;
                        score += sims.GetTextSim(fid, cand->formId) * 30.0f * chaos;
                        score += sims.GetNameSim(fid, cand->formId) * 20.0f;

                        if (!node.theme.empty() && !cand->theme.empty() && node.theme == cand->theme)
                            score += 15.0f;

                        int td = tierIdx - searchTier;
                        if (td == 1) score += 10.0f;
                        else if (td == 0) score += 5.0f;
                        else if (td > 2) score -= (td - 2) * 5.0f;

                        score -= static_cast<float>(cand->children.size()) * 6.0f;

                        std::uniform_real_distribution<float> jd(-2.0f, 2.0f);
                        score += jd(rng);

                        if (score > bestScore) { bestScore = score; bestParent = cand; }
                    }
                }

                if (bestParent) {
                    LinkNodes(*bestParent, node);
                    node.depth = tierIdx;
                    connected.insert(fid);
                    placedThisTier.push_back(&node);

                    if (static_cast<int>(bestParent->children.size()) >= maxChildren) {
                        for (auto& [d, plist] : available)
                            plist.erase(
                                std::remove_if(plist.begin(), plist.end(),
                                    [&bestParent](TreeNode* p) { return p->formId == bestParent->formId; }),
                                plist.end());
                    }
                }
            }

            for (auto* pn : placedThisTier)
                if (static_cast<int>(pn->children.size()) < maxChildren)
                    available[tierIdx].push_back(pn);
        }

        // Force-connect remaining
        for (auto& [fid, nd] : nodes) {
            if (!connected.contains(fid)) {
                LinkNodes(rootNode, nd);
                connected.insert(fid);
            }
        }

        // Post-process: constrain branching, enforce tier ordering, assign depths
        ConstrainBranching(nodes, maxChildren, sims);
        EnforceTierOrdering(nodes, rootFormId, maxChildren, sims);
        AssignDepthsBFS(nodes, rootFormId);

        // Serialize
        auto schoolBaseColor = schoolColors.contains(schoolName)
            ? schoolColors.at(schoolName) : std::string("#888888");

        json nodesList = json::array();
        for (const auto& [fid, nd] : nodes) nodesList.push_back(nd.ToDict());

        json schoolResult;
        schoolResult["root"] = rootFormId;
        schoolResult["layoutStyle"] = "graph_arborescence";
        schoolResult["color"] = schoolBaseColor;
        schoolResult["nodes"] = nodesList;
        schoolResult["config_used"] = {
            {"shape", "graph_arborescence"}, {"chaos", chaos},
            {"force_balance", forceBalance}, {"density", config.density},
            {"symmetry", config.symmetry}, {"source", "graph"}
        };

        treeData["schools"][schoolName] = schoolResult;
    }

    treeData["generatedAt"] = std::to_string(
        std::chrono::system_clock::now().time_since_epoch().count());
    treeData["generator"] = "GraphTreeBuilder (Greedy Arborescence, C++)";
    treeData["seed"] = usedSeed;
    treeData["config"] = {
        {"shape", "graph_arborescence"}, {"chaos", chaos},
        {"force_balance", forceBalance}, {"density", config.density},
        {"symmetry", config.symmetry}
    };

    ValidateAndFix(treeData, maxChildren, config.autoFixUnreachable);

    auto endTime = std::chrono::steady_clock::now();
    result.elapsedMs = std::chrono::duration<float, std::milli>(endTime - startTime).count();
    result.treeData = std::move(treeData);
    result.success = true;
    return result;
}
