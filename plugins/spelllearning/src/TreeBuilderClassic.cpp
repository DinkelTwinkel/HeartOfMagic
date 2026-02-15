#include "TreeBuilderInternal.h"

#include <algorithm>
#include <chrono>
#include <random>

using namespace TreeBuilder::Internal;

// =============================================================================
// CLASSIC BUILDER — Tier-First Tree Construction
// =============================================================================

// Find best parent for a node in Classic mode
static TreeBuilder::TreeNode* FindBestClassicParent(
    TreeBuilder::TreeNode& node,
    std::unordered_map<int, std::vector<TreeBuilder::TreeNode*>>& available,
    int tierIdx,
    int maxChildren,
    const TreeBuilder::SimilarityMatrix& sims,
    std::mt19937& rng)
{
    // Collect candidates from lower tiers
    std::vector<std::pair<TreeBuilder::TreeNode*, int>> candidates;

    for (int tierDist = 1; tierDist <= tierIdx + 1; ++tierDist) {
        int targetD = tierIdx - tierDist;
        if (targetD < 0) break;

        auto it = available.find(targetD);
        if (it != available.end()) {
            for (auto* c : it->second) {
                if (static_cast<int>(c->children.size()) < maxChildren) {
                    candidates.emplace_back(c, tierDist);
                }
            }
        }
        if (!candidates.empty()) break;
    }

    // Same tier for tier 0
    if (candidates.empty() && tierIdx == 0) {
        auto it = available.find(0);
        if (it != available.end()) {
            for (auto* c : it->second) {
                if (static_cast<int>(c->children.size()) < maxChildren &&
                    c->formId != node.formId) {
                    candidates.emplace_back(c, 0);
                }
            }
        }
    }

    // Last resort: expand capacity
    if (candidates.empty()) {
        for (auto& [d, parents] : available) {
            for (auto* p : parents) {
                if (static_cast<int>(p->children.size()) < maxChildren + 2) {
                    candidates.emplace_back(p, std::abs(tierIdx - d) + 5);
                }
            }
            if (!candidates.empty()) break;
        }
    }

    if (candidates.empty()) return nullptr;

    // Score candidates
    std::uniform_real_distribution<float> jitter(-2.0f, 2.0f);
    float bestScore = -std::numeric_limits<float>::max();
    TreeBuilder::TreeNode* bestParent = nullptr;

    for (auto& [candidate, tierDist] : candidates) {
        float score = 0.0f;

        // Tier distance penalty
        score -= std::max(0, tierDist - 1) * 5.0f;

        // Effect-name affinity (strongest signal)
        float effectSim = sims.GetEffectSim(node.formId, candidate->formId);
        score += effectSim * 40.0f;

        // Theme match
        if (!node.theme.empty() && !candidate->theme.empty()) {
            if (node.theme == candidate->theme) {
                float themeBonus = (effectSim > 0.5f) ? 25.0f : 15.0f;
                score += themeBonus;
            } else {
                score -= 10.0f;
            }
        }

        // Combined NLP similarity
        float textSim = sims.GetTextSim(node.formId, candidate->formId);
        float nameSim = sims.GetNameSim(node.formId, candidate->formId);
        float combinedSim = textSim * 0.4f + nameSim * 0.6f;
        score += combinedSim * 30.0f;

        // Load balance
        score -= static_cast<float>(candidate->children.size()) * 8.0f;

        // Prefer immediate predecessor tier
        if (candidate->depth == tierIdx - 1) score += 10.0f;
        else if (candidate->depth == tierIdx - 2) score += 5.0f;

        // Random jitter
        score += jitter(rng);

        if (score > bestScore) {
            bestScore = score;
            bestParent = candidate;
        }
    }

    return bestParent;
}

TreeBuilder::BuildResult TreeBuilder::BuildClassic(
    const std::vector<json>& spells,
    const BuildConfig& config)
{
    auto startTime = std::chrono::steady_clock::now();
    BuildResult result;

    // Seed RNG
    int usedSeed = config.seed;
    if (usedSeed == 0) {
        usedSeed = static_cast<int>(
            std::chrono::system_clock::now().time_since_epoch().count() % 1000000);
    }
    std::mt19937 rng(usedSeed);

    int maxChildren = config.maxChildrenPerNode;

    // Adapt max_children based on grid hint
    if (config.gridHint) {
        auto& hint = *config.gridHint;
        if (hint.mode == "sun" && maxChildren > 2 && hint.avgPointsPerSchool < 40) {
            maxChildren = 2;
        } else if (hint.mode == "flat" && maxChildren < 4 && hint.avgPointsPerSchool > 60) {
            maxChildren = 4;
        }
    }

    // Group spells by school
    static const std::unordered_set<std::string> VALID_SCHOOLS = {
        "Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"
    };

    std::unordered_map<std::string, std::vector<json>> schoolSpells;
    for (const auto& spell : spells) {
        auto school = spell.value("school", std::string(""));
        if (VALID_SCHOOLS.contains(school)) {
            schoolSpells[school].push_back(spell);
        }
    }

    // Discover themes
    auto themes = DiscoverThemesPerSchool(spells, config.topThemesPerSchool);
    themes = MergeWithHints(themes, config.topThemesPerSchool + 4);

    // Build each school's tree
    json treeData;
    treeData["version"] = "1.0";
    treeData["schools"] = json::object();

    for (auto& [schoolName, schoolSpellList] : schoolSpells) {
        if (schoolSpellList.empty()) continue;

        // Compute per-school similarity matrix (avoids wasted cross-school pairs)
        auto sims = ComputeSimilarityMatrix(schoolSpellList);

        auto schoolThemes = themes.contains(schoolName) ? themes[schoolName] : std::vector<std::string>{};

        // Group by tier
        std::unordered_map<std::string, std::vector<json>> byTier;
        for (const auto& spell : schoolSpellList) {
            auto tier = spell.value("skillLevel", std::string(""));
            if (TierIndex(tier) < 0) tier = "Novice";
            byTier[tier].push_back(spell);
        }

        // Pick root
        auto* rootSpell = PickRoot(byTier, config, schoolName, rng);
        if (!rootSpell) continue;

        auto rootFormId = rootSpell->value("formId", std::string(""));

        // Create all nodes
        std::unordered_map<std::string, TreeNode> nodes;
        for (const auto& spell : schoolSpellList) {
            auto node = TreeNode::FromSpell(spell);
            nodes[node.formId] = std::move(node);
        }

        auto& root = nodes[rootFormId];
        root.isRoot = true;
        root.depth = 0;

        // Assign themes
        for (auto& [fid, node] : nodes) {
            if (!schoolThemes.empty()) {
                auto [theme, score] = GetSpellPrimaryTheme(node.spellData, schoolThemes);
                node.theme = (score > 30) ? theme : "";
            }
        }

        // Build tree tier-by-tier
        std::unordered_set<std::string> connected;
        connected.insert(rootFormId);

        std::unordered_map<int, std::vector<TreeNode*>> available;
        available[0].push_back(&root);

        for (int tierIdx = 0; tierIdx < TIER_COUNT; ++tierIdx) {
            auto tierName = std::string(TIER_NAMES[tierIdx]);
            auto it = byTier.find(tierName);
            if (it == byTier.end()) continue;

            auto tierSpells = it->second;

            // Shuffle for variety
            std::shuffle(tierSpells.begin(), tierSpells.end(), rng);

            std::vector<TreeNode*> placedThisTier;

            for (const auto& spell : tierSpells) {
                auto fid = spell.value("formId", std::string(""));
                if (fid == rootFormId || connected.contains(fid)) continue;

                auto nodeIt = nodes.find(fid);
                if (nodeIt == nodes.end()) continue;

                auto* parent = FindBestClassicParent(
                    nodeIt->second, available, tierIdx, maxChildren, sims, rng);

                if (parent) {
                    LinkNodes(*parent, nodeIt->second);
                    nodeIt->second.depth = tierIdx;
                    connected.insert(fid);
                    placedThisTier.push_back(&nodeIt->second);

                    // Update availability
                    if (static_cast<int>(parent->children.size()) >= maxChildren) {
                        for (auto& [d, plist] : available) {
                            plist.erase(
                                std::remove_if(plist.begin(), plist.end(),
                                    [&](TreeNode* p) { return p->formId == parent->formId; }),
                                plist.end());
                        }
                    }
                }
            }

            // Add placed nodes as available parents
            for (auto* pn : placedThisTier) {
                if (static_cast<int>(pn->children.size()) < maxChildren) {
                    available[tierIdx].push_back(pn);
                }
            }
        }

        // Force-connect unconnected nodes
        std::vector<std::string> unconnectedIds;
        for (const auto& [nid, nd] : nodes) {
            if (!connected.contains(nid)) {
                unconnectedIds.push_back(nid);
            }
        }

        for (const auto& orphanId : unconnectedIds) {
            auto& orphanNode = nodes[orphanId];
            int nodeTierIdx = std::max(0, TierIndex(orphanNode.tier));
            TreeNode* bestParent = nullptr;
            float bestScore = -std::numeric_limits<float>::max();

            for (const auto& cid : connected) {
                auto& cnode = nodes[cid];
                int cnodeTierIdx = std::max(0, TierIndex(cnode.tier));
                float score = 0.0f;

                if (cnodeTierIdx <= nodeTierIdx) {
                    score += 100.0f;
                    score -= static_cast<float>(nodeTierIdx - cnodeTierIdx) * 5.0f;
                } else {
                    score -= 200.0f;
                }

                float effectSim = sims.GetEffectSim(orphanId, cid);
                score += effectSim * 30.0f;

                if (!orphanNode.theme.empty() && !cnode.theme.empty() && orphanNode.theme == cnode.theme) {
                    score += 15.0f;
                }

                score -= static_cast<float>(cnode.children.size()) * 8.0f;

                if (score > bestScore) {
                    bestScore = score;
                    bestParent = &cnode;
                }
            }

            if (bestParent) {
                LinkNodes(*bestParent, orphanNode);
                orphanNode.depth = nodeTierIdx;
                connected.insert(orphanId);
            }
        }

        // Serialize nodes
        json schoolResult;
        schoolResult["root"] = rootFormId;
        schoolResult["layoutStyle"] = "tier_first";

        json nodesList = json::array();
        for (const auto& [nid, nd] : nodes) {
            nodesList.push_back(nd.ToDict());
        }
        schoolResult["nodes"] = nodesList;
        schoolResult["config_used"] = {
            {"shape", "tier_first"},
            {"density", config.density},
            {"symmetry", config.symmetry},
            {"source", "classic"}
        };

        treeData["schools"][schoolName] = schoolResult;
    }

    // Metadata
    treeData["generatedAt"] = std::to_string(
        std::chrono::system_clock::now().time_since_epoch().count());
    treeData["generator"] = "ClassicTreeBuilder (Tier-First, C++)";
    treeData["seed"] = usedSeed;
    treeData["config"] = {
        {"shape", "tier_first"},
        {"density", config.density},
        {"symmetry", config.symmetry}
    };

    // Validate and auto-fix
    ValidateAndFix(treeData, maxChildren, config.autoFixUnreachable);

    auto endTime = std::chrono::steady_clock::now();
    result.elapsedMs = std::chrono::duration<float, std::milli>(endTime - startTime).count();
    result.treeData = std::move(treeData);
    result.success = true;
    return result;
}
