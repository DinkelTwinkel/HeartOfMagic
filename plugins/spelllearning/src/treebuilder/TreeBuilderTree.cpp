#include "treebuilder/TreeBuilderInternal.h"

#include <algorithm>
#include <chrono>
#include <queue>
#include <random>

using namespace TreeBuilder::Internal;

// =============================================================================
// TREE BUILDER — NLP Thematic with Round-Robin & Convergence
// =============================================================================

static bool IsDescendant(
    const std::string& potentialAncestor,
    const std::string& nodeId,
    const std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes)
{
    // Returns true if nodeId is in the subtree of potentialAncestor (via children).
    // Used to prevent creating cycles during convergence enforcement.
    auto paIt = nodes.find(potentialAncestor);
    auto ndIt = nodes.find(nodeId);
    if (paIt == nodes.end() || ndIt == nodes.end()) return false;

    // Ancestor must have strictly smaller depth than descendant
    if (paIt->second.depth >= ndIt->second.depth) return false;

    // BFS from potentialAncestor, traverse children, look for nodeId
    std::unordered_set<std::string> visited;
    std::queue<std::string> bfsQ;
    bfsQ.push(potentialAncestor);
    while (!bfsQ.empty()) {
        auto fid = bfsQ.front();
        bfsQ.pop();
        if (visited.contains(fid)) continue;
        visited.insert(fid);
        if (fid == nodeId) return true;
        auto it = nodes.find(fid);
        if (it != nodes.end())
            for (const auto& ch : it->second.children) bfsQ.push(ch);
    }
    return false;
}

// Get all nodes reachable from root via children
static std::unordered_set<std::string> GetReachableFromRoot(
    const std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes,
    const std::string& rootId)
{
    std::unordered_set<std::string> reachable;
    std::queue<std::string> bfsQ;
    bfsQ.push(rootId);
    while (!bfsQ.empty()) {
        auto fid = bfsQ.front();
        bfsQ.pop();
        if (reachable.contains(fid)) continue;
        reachable.insert(fid);
        auto it = nodes.find(fid);
        if (it != nodes.end())
            for (const auto& ch : it->second.children) bfsQ.push(ch);
    }
    return reachable;
}

// Assign sections (root/trunk/branch) based on depth
static void AssignSections(
    std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes,
    const std::string& rootId)
{
    int maxDepth = 0;
    for (const auto& [fid, nd] : nodes) maxDepth = std::max(maxDepth, nd.depth);

    if (maxDepth == 0) {
        for (auto& [fid, nd] : nodes) nd.section = "root";
        return;
    }

    int rootCutoff = std::max(0, static_cast<int>(maxDepth * 0.2f));
    int trunkCutoff = std::max(rootCutoff + 1, static_cast<int>(maxDepth * 0.7f));

    for (auto& [fid, nd] : nodes) {
        if (fid == rootId || nd.depth <= rootCutoff)
            nd.section = "root";
        else if (nd.depth <= trunkCutoff)
            nd.section = "trunk";
        else
            nd.section = "branch";
    }
}

TreeBuilder::BuildResult TreeBuilder::BuildTree(
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

    int maxChildren = config.maxChildrenPerNode;

    if (config.gridHint) {
        auto& hint = *config.gridHint;
        if (hint.mode == "sun" && maxChildren > 2 && hint.avgPointsPerSchool < 40)
            maxChildren = 2;
        else if (hint.mode == "flat" && maxChildren < 4 && hint.avgPointsPerSchool > 60)
            maxChildren = 4;
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

    json treeData;
    treeData["version"] = "1.0";
    treeData["schools"] = json::object();

    for (auto& [schoolName, schoolSpellList] : schoolSpells) {
        if (schoolSpellList.empty()) continue;

        // Compute per-school similarity matrix (avoids wasted cross-school pairs)
        auto sims = ComputeSimilarityMatrix(schoolSpellList);

        auto schoolThemes = themesMap.contains(schoolName)
            ? themesMap[schoolName] : std::vector<std::string>{};

        // Create nodes and assign themes
        std::unordered_map<std::string, TreeNode> nodes;
        for (const auto& spell : schoolSpellList) {
            auto node = TreeNode::FromSpell(spell);
            if (!schoolThemes.empty()) {
                auto [theme, score] = GetSpellPrimaryTheme(spell, schoolThemes);
                node.theme = (score > 30) ? theme : "_unassigned";
            }
            nodes[node.formId] = std::move(node);
        }

        // Group by tier and pick root
        std::unordered_map<std::string, std::vector<json>> byTier;
        for (const auto& spell : schoolSpellList) {
            auto tier = spell.value("skillLevel", std::string(""));
            if (TierIndex(tier) < 0) tier = "Novice";
            byTier[tier].push_back(spell);
        }

        auto* rootSpell = PickRoot(byTier, config, schoolName, rng);
        if (!rootSpell) continue;
        auto rootFormId = rootSpell->value("formId", std::string(""));
        if (!nodes.contains(rootFormId)) continue;

        auto& root = nodes[rootFormId];
        root.isRoot = true;
        root.depth = 0;

        // Group spells by theme
        auto grouped = GroupSpellsBestFit(schoolSpellList, schoolThemes, 30);

        // === Round-robin tier-interleaved connection ===
        std::unordered_set<std::string> connected;
        connected.insert(rootFormId);
        std::unordered_map<int, std::vector<TreeNode*>> available;
        available[0].push_back(&root);

        // Sort themes by size (largest first)
        std::vector<std::string> sortedThemes;
        for (const auto& [t, s] : grouped)
            if (t != "_unassigned" && !s.empty()) sortedThemes.push_back(t);
        std::sort(sortedThemes.begin(), sortedThemes.end(),
            [&grouped](const std::string& a, const std::string& b) {
                return grouped[a].size() > grouped[b].size();
            });

        // Build per-theme queues sorted by tier
        std::unordered_map<std::string, std::vector<json>> themeQueues;
        for (const auto& theme : sortedThemes) {
            auto q = grouped[theme];
            std::sort(q.begin(), q.end(), [](const json& a, const json& b) {
                int ta = TreeBuilder::TierIndex(a.value("skillLevel", std::string("")));
                int tb = TreeBuilder::TierIndex(b.value("skillLevel", std::string("")));
                if (ta < 0) ta = 99;
                if (tb < 0) tb = 99;
                return ta < tb;
            });
            themeQueues[theme] = std::move(q);
        }

        std::unordered_map<std::string, TreeNode*> themeParents;
        for (const auto& t : sortedThemes) themeParents[t] = nullptr;

        std::unordered_map<std::string, int> themeIndices;
        for (const auto& t : sortedThemes) themeIndices[t] = 0;

        int maxRounds = 0;
        for (const auto& [t, q] : themeQueues)
            maxRounds = std::max(maxRounds, static_cast<int>(q.size()));

        std::uniform_real_distribution<float> jitter(-2.0f, 2.0f);

        for (int round = 0; round < maxRounds; ++round) {
            for (const auto& theme : sortedThemes) {
                int idx = themeIndices[theme];
                auto& queue = themeQueues[theme];
                if (idx >= static_cast<int>(queue.size())) continue;

                auto& spell = queue[idx];
                auto formId = spell.value("formId", std::string(""));
                themeIndices[theme] = idx + 1;

                if (connected.contains(formId)) {
                    if (nodes.contains(formId))
                        themeParents[theme] = &nodes[formId];
                    continue;
                }

                auto nodeIt = nodes.find(formId);
                if (nodeIt == nodes.end()) continue;
                auto& node = nodeIt->second;
                int tierDepth = std::max(0, TierIndex(node.tier));

                // Find parent: score all candidates
                TreeNode* bestParent = nullptr;
                float bestScore = -std::numeric_limits<float>::max();

                for (int d = std::max(0, tierDepth - 2); d <= tierDepth; ++d) {
                    for (auto* cand : available[d]) {
                        if (static_cast<int>(cand->children.size()) >= maxChildren)
                            continue;

                        float score = 0.0f;

                        // Theme matching
                        if (!node.theme.empty() && !cand->theme.empty() &&
                            node.theme != "_unassigned" && cand->theme != "_unassigned") {
                            if (node.theme == cand->theme)
                                score += 170.0f;  // 100 + 70 coherence
                            else
                                score -= 50.0f;
                        }

                        // Tier progression
                        int tierDiff = tierDepth - cand->depth;
                        if (tierDiff == 1) score += 50.0f;
                        else if (tierDiff == 2) score += 30.0f;
                        else if (tierDiff > 2) score -= 20.0f;
                        else if (tierDiff == 0) score += 10.0f;

                        // NLP similarity
                        score += sims.GetTextSim(node.formId, cand->formId) * 60.0f;

                        // Capacity penalty
                        float childRatio = static_cast<float>(cand->children.size()) / maxChildren;
                        score -= childRatio * 30.0f;

                        score += jitter(rng);

                        if (score > bestScore) {
                            bestScore = score;
                            bestParent = cand;
                        }
                    }
                }

                // Fallback: any lower-depth parent
                if (!bestParent) {
                    for (int d = tierDepth - 1; d >= 0 && !bestParent; --d) {
                        for (auto* p : available[d]) {
                            // Fallback allows +2 overflow to avoid orphan nodes in edge cases
                            if (static_cast<int>(p->children.size()) < maxChildren + 2) {
                                bestParent = p;
                                break;
                            }
                        }
                    }
                }

                if (bestParent) {
                    LinkNodes(*bestParent, node);
                    connected.insert(formId);

                    if (static_cast<int>(node.children.size()) < maxChildren)
                        available[node.depth].push_back(&node);

                    themeParents[theme] = &node;
                }
            }
        }

        // Process unassigned spells
        auto& unassigned = grouped["_unassigned"];
        for (const auto& spell : unassigned) {
            auto formId = spell.value("formId", std::string(""));
            if (connected.contains(formId)) continue;
            auto nodeIt = nodes.find(formId);
            if (nodeIt == nodes.end()) continue;
            auto& node = nodeIt->second;
            int tierDepth = std::max(0, TierIndex(node.tier));

            TreeNode* bestParent = nullptr;
            float bestScore = -std::numeric_limits<float>::max();
            for (int d = std::max(0, tierDepth - 2); d <= tierDepth; ++d) {
                for (auto* cand : available[d]) {
                    if (static_cast<int>(cand->children.size()) >= maxChildren) continue;
                    float score = 0.0f;
                    int tierDiff = tierDepth - cand->depth;
                    if (tierDiff == 1) score += 50.0f;
                    else if (tierDiff == 0) score += 10.0f;
                    score += sims.GetTextSim(node.formId, cand->formId) * 60.0f;
                    score -= static_cast<float>(cand->children.size()) / maxChildren * 30.0f;
                    if (score > bestScore) { bestScore = score; bestParent = cand; }
                }
            }
            if (bestParent) {
                LinkNodes(*bestParent, node);
                connected.insert(formId);
                if (static_cast<int>(node.children.size()) < maxChildren)
                    available[node.depth].push_back(&node);
            }
        }

        // Connect orphans
        std::vector<std::string> orphanIds;
        for (const auto& [fid, nd] : nodes)
            if (!connected.contains(fid)) orphanIds.push_back(fid);

        for (const auto& orphanId : orphanIds) {
            auto& orphan = nodes[orphanId];
            int tierDepth = std::max(0, TierIndex(orphan.tier));
            TreeNode* bestP = nullptr;
            float bestSc = -9999.0f;

            for (const auto& cid : connected) {
                auto& cnd = nodes[cid];
                if (static_cast<int>(cnd.children.size()) >= maxChildren) continue;
                float score = 0.0f;
                if (cnd.depth < tierDepth) { score += 50.0f; if (cnd.depth == tierDepth - 1) score += 30.0f; }
                else if (cnd.depth == tierDepth) score += 10.0f;
                else score -= 50.0f;
                if (cnd.theme == orphan.theme && !orphan.theme.empty()) score += 40.0f;
                score -= static_cast<float>(cnd.children.size()) * 15.0f;
                if (score > bestSc) { bestSc = score; bestP = &cnd; }
            }
            if (bestP) {
                LinkNodes(*bestP, orphan);
                connected.insert(orphanId);
            } else {
                // Over-capacity fallback
                TreeNode* leastLoaded = nullptr;
                for (auto& [cid, cnd] : nodes) {
                    if (!connected.contains(cid)) continue;
                    if (cnd.depth < tierDepth) {
                        if (!leastLoaded || cnd.children.size() < leastLoaded->children.size())
                            leastLoaded = &cnd;
                    }
                }
                if (leastLoaded) {
                    LinkNodes(*leastLoaded, orphan);
                    connected.insert(orphanId);
                }
            }
        }

        // === Convergence enforcement ===
        // Expert spells need 2+ prereqs, Master needs 3+
        auto reachable = GetReachableFromRoot(nodes, rootFormId);

        for (auto& [fid, node] : nodes) {
            if (fid == rootFormId) continue;
            int tierDepth = std::max(0, TierIndex(node.tier));
            int minPrereqs = (tierDepth >= 4) ? 3 : (tierDepth >= 3) ? 2 : 0;
            if (minPrereqs == 0 || static_cast<int>(node.prerequisites.size()) >= minPrereqs)
                continue;

            int needed = minPrereqs - static_cast<int>(node.prerequisites.size());

            // Find convergence candidates
            std::vector<std::pair<float, std::string>> candidates;
            for (const auto& [candId, cand] : nodes) {
                if (candId == fid) continue;
                if (std::find(node.prerequisites.begin(), node.prerequisites.end(), candId)
                    != node.prerequisites.end()) continue;
                if (!reachable.contains(candId)) continue;
                if (cand.depth >= node.depth) continue;
                if (IsDescendant(candId, fid, nodes)) continue;

                float convScore = 0.0f;
                convScore += sims.GetTextSim(fid, candId) * 40.0f;
                int depthDiff = std::abs(node.depth - cand.depth);
                convScore += std::max(0.0f, 20.0f - depthDiff * 10.0f);
                if (cand.theme != node.theme) convScore += 10.0f;
                candidates.emplace_back(convScore, candId);
            }

            std::sort(candidates.begin(), candidates.end(),
                [](const auto& a, const auto& b) { return a.first > b.first; });

            int added = 0;
            for (const auto& [sc, candId] : candidates) {
                if (added >= needed) break;
                node.AddPrerequisite(candId);
                added++;
            }
        }

        // Ensure all reachable
        for (int pass = 0; pass < 20; ++pass) {
            auto unlockable = SimulateUnlocks(nodes, rootFormId);
            std::vector<std::string> unreachable;
            for (const auto& [fid, nd] : nodes)
                if (!unlockable.contains(fid)) unreachable.push_back(fid);
            if (unreachable.empty()) break;

            bool fixedAny = false;
            for (const auto& fid : unreachable) {
                auto& node = nodes[fid];
                std::vector<std::string> blocking;
                for (const auto& p : node.prerequisites)
                    if (!unlockable.contains(p)) blocking.push_back(p);

                if (!blocking.empty()) {
                    for (const auto& bp : blocking) {
                        node.prerequisites.erase(
                            std::remove(node.prerequisites.begin(), node.prerequisites.end(), bp),
                            node.prerequisites.end());
                        if (nodes.contains(bp)) {
                            auto& pn = nodes[bp];
                            pn.children.erase(
                                std::remove(pn.children.begin(), pn.children.end(), fid),
                                pn.children.end());
                        }
                    }
                    fixedAny = true;
                } else if (node.prerequisites.empty()) {
                    // Reconnect
                    std::string bestP;
                    int bestSc = -9999;
                    for (const auto& uid : unlockable) {
                        if (uid == fid) continue;
                        auto& cand = nodes[uid];
                        if (static_cast<int>(cand.children.size()) >= maxChildren) continue;
                        int sc = 0;
                        int td = std::max(0, TierIndex(node.tier));
                        if (cand.depth < td) sc += 50;
                        if (cand.theme == node.theme && !node.theme.empty()) sc += 40;
                        sc -= static_cast<int>(cand.children.size()) * 10;
                        if (sc > bestSc) { bestSc = sc; bestP = uid; }
                    }
                    if (!bestP.empty()) {
                        LinkNodes(nodes[bestP], node);
                        fixedAny = true;
                    }
                }
            }
            if (!fixedAny) break;
        }

        // Assign sections
        AssignSections(nodes, rootFormId);

        // Serialize
        json schoolResult;
        schoolResult["root"] = rootFormId;
        schoolResult["layoutStyle"] = "radial";
        json nodesList = json::array();
        for (const auto& [fid, nd] : nodes) nodesList.push_back(nd.ToDict());
        schoolResult["nodes"] = nodesList;
        schoolResult["config_used"] = {
            {"shape", "tree_nlp"}, {"density", config.density},
            {"symmetry", config.symmetry}, {"source", "tree"}
        };

        treeData["schools"][schoolName] = schoolResult;
    }

    treeData["generatedAt"] = std::to_string(
        std::chrono::system_clock::now().time_since_epoch().count());
    treeData["generator"] = "TreeBuilder (NLP Thematic Round-Robin, C++)";
    treeData["seed"] = usedSeed;
    treeData["config"] = {
        {"shape", "tree_nlp"}, {"density", config.density},
        {"symmetry", config.symmetry}
    };

    ValidateAndFix(treeData, maxChildren, config.autoFixUnreachable);

    auto endTime = std::chrono::steady_clock::now();
    result.elapsedMs = std::chrono::duration<float, std::milli>(endTime - startTime).count();
    result.treeData = std::move(treeData);
    result.success = true;
    return result;
}
