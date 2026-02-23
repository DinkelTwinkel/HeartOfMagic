#include "treebuilder/TreeBuilderInternal.h"

#include <algorithm>
#include <chrono>
#include <deque>
#include <queue>
#include <random>

using namespace TreeBuilder::Internal;

// =============================================================================
// THEMATIC BUILDER — Theme-First BFS Tree Construction
// =============================================================================

// Find a node with child capacity via BFS walk
static TreeBuilder::TreeNode* FindParentWithCapacity(
    TreeBuilder::TreeNode* start,
    std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes,
    int maxChildren)
{
    std::unordered_set<std::string> visited;
    std::queue<std::string> bfsQueue;
    bfsQueue.push(start->formId);

    while (!bfsQueue.empty()) {
        auto cur = bfsQueue.front();
        bfsQueue.pop();
        if (visited.contains(cur)) continue;
        visited.insert(cur);

        auto it = nodes.find(cur);
        if (it == nodes.end()) continue;

        if (static_cast<int>(it->second.children.size()) < maxChildren)
            return &it->second;

        for (const auto& prereq : it->second.prerequisites)
            if (!visited.contains(prereq)) bfsQueue.push(prereq);
        for (const auto& child : it->second.children)
            if (!visited.contains(child)) bfsQueue.push(child);
    }

    return nullptr;
}

// Build a BFS branch of spells off an attachment point
static std::vector<std::string> BuildThemeBranch(
    std::vector<json>& spells,
    TreeBuilder::TreeNode* attachment,
    std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes,
    std::unordered_set<std::string>& connected,
    int maxChildren)
{
    std::vector<std::string> placed;

    std::deque<std::string> parentQueue;
    if (static_cast<int>(attachment->children.size()) < maxChildren)
        parentQueue.push_back(attachment->formId);

    for (const auto& spell : spells) {
        auto fid = spell.value("formId", std::string(""));
        if (fid.empty() || connected.contains(fid)) continue;

        auto nodeIt = nodes.find(fid);
        if (nodeIt == nodes.end()) continue;

        while (!parentQueue.empty()) {
            auto frontIt = nodes.find(parentQueue.front());
            if (frontIt != nodes.end() &&
                static_cast<int>(frontIt->second.children.size()) < maxChildren)
                break;
            parentQueue.pop_front();
        }

        if (parentQueue.empty()) {
            auto* found = FindParentWithCapacity(attachment, nodes, maxChildren);
            if (found)
                parentQueue.push_back(found->formId);
            else
                continue;
        }

        auto& parent = nodes[parentQueue.front()];
        TreeBuilder::LinkNodes(parent, nodeIt->second);
        connected.insert(fid);
        placed.push_back(fid);
        parentQueue.push_back(fid);
    }

    return placed;
}

// Find best attachment point for a new theme branch
static TreeBuilder::TreeNode* FindAttachmentPoint(
    const json& representative,
    std::unordered_map<std::string, TreeBuilder::TreeNode>& nodes,
    const std::unordered_set<std::string>& connected,
    const TreeBuilder::SimilarityMatrix& sims,
    float chaos, std::mt19937& rng)
{
    auto repFid = representative.value("formId", std::string(""));
    if (repFid.empty()) return nullptr;

    TreeBuilder::TreeNode* bestNode = nullptr;
    float bestScore = -std::numeric_limits<float>::max();
    std::uniform_real_distribution<float> jitter(-1.0f, 1.0f);
    std::uniform_real_distribution<float> chaosJitter(-20.0f, 20.0f);

    for (const auto& placedFid : connected) {
        auto it = nodes.find(placedFid);
        if (it == nodes.end()) continue;

        float score = sims.GetEffectSim(repFid, placedFid) * 35.0f
                    + sims.GetTextSim(repFid, placedFid) * 25.0f
                    + sims.GetNameSim(repFid, placedFid) * 20.0f;

        int tierIdx = TreeBuilder::TierIndex(it->second.tier);
        if (tierIdx < 0) tierIdx = 2;
        score -= tierIdx * 5.0f;
        score -= static_cast<float>(it->second.children.size()) * 8.0f;

        if (chaos > 0.0f) score += chaosJitter(rng) * chaos;
        score += jitter(rng);

        if (score > bestScore) {
            bestScore = score;
            bestNode = &it->second;
        }
    }

    return bestNode;
}

TreeBuilder::BuildResult TreeBuilder::BuildThematic(
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
    float chaos = config.chaos;

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

    const auto& schoolColors = GetSchoolColors();

    json treeData;
    treeData["version"] = "1.0";
    treeData["schools"] = json::object();

    for (auto& [schoolName, schoolSpellList] : schoolSpells) {
        if (schoolSpellList.empty()) continue;

        auto sims = ComputeSimilarityMatrix(schoolSpellList);
        auto schoolThemes = themesMap.contains(schoolName)
            ? themesMap[schoolName] : std::vector<std::string>{};

        // Group spells into themes
        auto themeGroups = GroupSpellsBestFit(schoolSpellList, schoolThemes, 30);
        std::vector<json> orphanSpells;
        if (themeGroups.contains("_unassigned")) {
            orphanSpells = themeGroups["_unassigned"];
            themeGroups.erase("_unassigned");
        }
        for (auto it = themeGroups.begin(); it != themeGroups.end(); )
            it->second.empty() ? it = themeGroups.erase(it) : ++it;

        if (themeGroups.empty())
            themeGroups["_all"] = schoolSpellList;

        // Rank themes by spell count
        std::vector<std::string> rankedThemes;
        for (const auto& [t, s] : themeGroups) rankedThemes.push_back(t);
        std::sort(rankedThemes.begin(), rankedThemes.end(),
            [&themeGroups](const std::string& a, const std::string& b) {
                return themeGroups[a].size() > themeGroups[b].size();
            });
        std::string trunkTheme = rankedThemes[0];

        // Group by tier for root picking
        std::unordered_map<std::string, std::vector<json>> byTier;
        for (const auto& spell : schoolSpellList) {
            auto tier = spell.value("skillLevel", std::string(""));
            if (TierIndex(tier) < 0) tier = "Novice";
            byTier[tier].push_back(spell);
        }

        auto* rootSpell = PickRoot(byTier, config, schoolName, rng);
        if (!rootSpell) continue;
        auto rootFormId = rootSpell->value("formId", std::string(""));

        // Create all nodes
        std::unordered_map<std::string, TreeNode> nodes;
        std::unordered_map<std::string, std::string> spellThemeMap;

        for (const auto& [themeName, tSpells] : themeGroups) {
            for (const auto& spell : tSpells) {
                auto fid = spell.value("formId", std::string(""));
                if (!fid.empty()) {
                    nodes[fid] = TreeNode::FromSpell(spell);
                    spellThemeMap[fid] = themeName;
                }
            }
        }
        for (const auto& spell : orphanSpells) {
            auto fid = spell.value("formId", std::string(""));
            if (!fid.empty() && !nodes.contains(fid)) {
                nodes[fid] = TreeNode::FromSpell(spell);
                spellThemeMap[fid] = "other";
            }
        }
        if (!nodes.contains(rootFormId)) {
            nodes[rootFormId] = TreeNode::FromSpell(*rootSpell);
            spellThemeMap[rootFormId] = trunkTheme;
        }

        auto& root = nodes[rootFormId];
        root.isRoot = true;
        root.depth = 0;
        root.theme = trunkTheme;

        for (auto& [fid, tm] : spellThemeMap)
            if (nodes.contains(fid)) nodes[fid].theme = tm;

        std::unordered_set<std::string> connected;
        connected.insert(rootFormId);
        json branchesMeta = json::array();

        // Build trunk chain
        auto trunkSpellsRaw = themeGroups[trunkTheme];
        trunkSpellsRaw.erase(
            std::remove_if(trunkSpellsRaw.begin(), trunkSpellsRaw.end(),
                [&rootFormId](const json& s) {
                    return s.value("formId", std::string("")) == rootFormId;
                }),
            trunkSpellsRaw.end());
        SortByTierAndCost(trunkSpellsRaw);
        auto trunkPlaced = BuildThemeBranch(trunkSpellsRaw, &root, nodes, connected, maxChildren);

        {
            json tb;
            tb["theme"] = trunkTheme;
            tb["attachmentPoint"] = rootFormId;
            json ids = json::array();
            ids.push_back(rootFormId);
            for (const auto& id : trunkPlaced) ids.push_back(id);
            tb["spellIds"] = ids;
            branchesMeta.push_back(tb);
        }

        // BFS theme expansion
        for (size_t ti = 1; ti < rankedThemes.size(); ++ti) {
            auto& nextTheme = rankedThemes[ti];
            auto& tSpellsRaw = themeGroups[nextTheme];
            if (tSpellsRaw.empty()) continue;
            SortByTierAndCost(tSpellsRaw);

            auto* attachment = FindAttachmentPoint(tSpellsRaw[0], nodes, connected, sims, chaos, rng);
            if (!attachment) attachment = &root;

            auto themePlaced = BuildThemeBranch(tSpellsRaw, attachment, nodes, connected, maxChildren);

            json branch;
            branch["theme"] = nextTheme;
            branch["attachmentPoint"] = attachment->formId;
            json ids = json::array();
            for (const auto& id : themePlaced) ids.push_back(id);
            branch["spellIds"] = ids;
            branchesMeta.push_back(branch);
        }

        // Sweep orphans
        std::vector<std::string> orphanFids;
        for (const auto& [fid, nd] : nodes)
            if (!connected.contains(fid)) orphanFids.push_back(fid);

        for (const auto& fid : orphanFids) {
            auto& node = nodes[fid];
            int nodeTierIdx = std::max(0, TierIndex(node.tier));
            TreeNode* bestParent = nullptr;
            float bestScore = -std::numeric_limits<float>::max();

            for (const auto& cid : connected) {
                auto& cnode = nodes[cid];
                int ct = std::max(0, TierIndex(cnode.tier));
                float score = (ct <= nodeTierIdx)
                    ? 100.0f - (nodeTierIdx - ct) * 5.0f
                    : -200.0f;
                score += sims.GetEffectSim(fid, cid) * 30.0f;
                score += sims.GetTextSim(fid, cid) * 15.0f;
                score += sims.GetNameSim(fid, cid) * 10.0f;
                if (!node.theme.empty() && !cnode.theme.empty() && node.theme == cnode.theme)
                    score += 15.0f;
                score -= static_cast<float>(cnode.children.size()) * 8.0f;
                if (score > bestScore) { bestScore = score; bestParent = &cnode; }
            }
            if (bestParent) {
                LinkNodes(*bestParent, node);
                node.depth = nodeTierIdx;
                connected.insert(fid);
            }
        }

        // "Other" branch for unaccounted connected nodes
        std::unordered_set<std::string> allBranchFids;
        for (const auto& b : branchesMeta)
            if (b.contains("spellIds") && b["spellIds"].is_array())
                for (const auto& id : b["spellIds"])
                    if (id.is_string()) allBranchFids.insert(id.get<std::string>());

        std::vector<std::string> otherFids;
        for (const auto& fid : connected)
            if (!allBranchFids.contains(fid)) otherFids.push_back(fid);
        if (!otherFids.empty()) {
            json ob;
            ob["theme"] = "other";
            ob["attachmentPoint"] = rootFormId;
            json ids = json::array();
            for (const auto& id : otherFids) ids.push_back(id);
            ob["spellIds"] = ids;
            branchesMeta.push_back(ob);
        }

        // Derive theme colors
        auto schoolBaseColor = schoolColors.contains(schoolName)
            ? schoolColors.at(schoolName) : std::string("#94a3b8");
        std::vector<std::string> activeThemes;
        for (const auto& [fid, nd] : nodes) {
            auto& t = nd.theme;
            if (!t.empty() && std::find(activeThemes.begin(), activeThemes.end(), t) == activeThemes.end())
                activeThemes.push_back(t);
        }
        auto themeColors = DeriveThemeColors(schoolBaseColor, activeThemes);

        json nodesList = json::array();
        for (const auto& [fid, nd] : nodes) {
            auto nodeJson = nd.ToDict();
            nodeJson["themeColor"] = themeColors.contains(nd.theme)
                ? themeColors[nd.theme] : schoolBaseColor;
            nodesList.push_back(nodeJson);
        }
        for (auto& b : branchesMeta) {
            auto bTheme = b.value("theme", std::string(""));
            b["color"] = themeColors.contains(bTheme) ? themeColors[bTheme] : schoolBaseColor;
        }

        json schoolResult;
        schoolResult["root"] = rootFormId;
        schoolResult["layoutStyle"] = "thematic_bfs";
        schoolResult["color"] = schoolBaseColor;
        schoolResult["branches"] = branchesMeta;
        schoolResult["nodes"] = nodesList;
        schoolResult["config_used"] = {
            {"shape", "thematic_bfs"}, {"density", config.density},
            {"symmetry", config.symmetry}, {"chaos", chaos},
            {"branch_style", config.branchStyle}, {"source", "thematic"}
        };
        treeData["schools"][schoolName] = schoolResult;
    }

    treeData["generatedAt"] = std::to_string(
        std::chrono::system_clock::now().time_since_epoch().count());
    treeData["generator"] = "ThematicTreeBuilder (Theme-First BFS, C++)";
    treeData["seed"] = usedSeed;
    treeData["config"] = {
        {"shape", "thematic_bfs"}, {"density", config.density},
        {"symmetry", config.symmetry}, {"chaos", chaos},
        {"branch_style", config.branchStyle}
    };

    ValidateAndFix(treeData, maxChildren, config.autoFixUnreachable);

    auto endTime = std::chrono::steady_clock::now();
    result.elapsedMs = std::chrono::duration<float, std::milli>(endTime - startTime).count();
    result.treeData = std::move(treeData);
    result.success = true;
    return result;
}
