#include "treebuilder/TreeBuilderInternal.h"

#include <algorithm>
#include <set>

// =============================================================================
// THEME DISCOVERY
// =============================================================================

const std::unordered_map<std::string, std::vector<std::string>>& TreeBuilder::GetVanillaThemeHints()
{
    static const std::unordered_map<std::string, std::vector<std::string>> hints = {
        {"Destruction", {"fire", "frost", "shock", "cloak", "rune", "wall", "bolt", "storm"}},
        {"Conjuration", {"conjure", "summon", "bound", "atronach", "zombie", "raise", "reanimate", "dremora"}},
        {"Alteration",  {"flesh", "armor", "paralyze", "detect", "light", "transmute", "waterbreathing", "telekinesis"}},
        {"Illusion",    {"fury", "fear", "calm", "courage", "invisibility", "muffle", "frenzy", "pacify"}},
        {"Restoration", {"heal", "healing", "ward", "turn", "undead", "cure", "bane", "circle"}},
    };
    return hints;
}

std::unordered_map<std::string, std::vector<std::string>>
TreeBuilder::DiscoverThemesPerSchool(const std::vector<json>& spells, int topN)
{
    static const std::unordered_set<std::string> VALID_SCHOOLS = {
        "Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"
    };

    // Group spells by school
    std::unordered_map<std::string, std::vector<json>> schoolSpells;
    for (const auto& spell : spells) {
        auto school = spell.value("school", std::string(""));
        if (VALID_SCHOOLS.contains(school)) {
            schoolSpells[school].push_back(spell);
        }
    }

    std::unordered_map<std::string, std::vector<std::string>> result;

    for (const auto& [school, sSpells] : schoolSpells) {
        if (sSpells.size() < 2) continue;

        // Build text corpus for this school
        std::vector<std::vector<std::string>> documents;
        for (const auto& spell : sSpells) {
            auto text = TreeNLP::BuildThemeText(spell);
            auto tokens = TreeNLP::Tokenize(text);
            // Filter stop words
            std::vector<std::string> filtered;
            for (const auto& t : tokens) {
                if (!TreeNLP::IsStopWord(t)) {
                    filtered.push_back(t);
                }
            }
            documents.push_back(std::move(filtered));
        }

        // Compute TF-IDF
        auto vectors = TreeNLP::ComputeTfIdf(documents);

        // Sum TF-IDF scores per term across all documents
        std::unordered_map<std::string, float> termScores;
        for (const auto& vec : vectors) {
            for (const auto& [token, weight] : vec.weights) {
                termScores[token] += weight;
            }
        }

        // Sort by score descending, take top N
        std::vector<std::pair<std::string, float>> sorted(termScores.begin(), termScores.end());
        std::sort(sorted.begin(), sorted.end(),
            [](const auto& a, const auto& b) { return a.second > b.second; });

        std::vector<std::string> themes;
        for (const auto& [term, score] : sorted) {
            if (TreeNLP::IsStopWord(term)) continue;
            if (term.size() <= 2) continue;
            themes.push_back(term);
            if (static_cast<int>(themes.size()) >= topN) break;
        }

        result[school] = std::move(themes);
    }

    return result;
}

std::unordered_map<std::string, std::vector<std::string>>
TreeBuilder::MergeWithHints(
    const std::unordered_map<std::string, std::vector<std::string>>& discovered,
    int maxThemes)
{
    const auto& hints = GetVanillaThemeHints();
    std::unordered_map<std::string, std::vector<std::string>> merged;

    for (const auto& [school, themes] : discovered) {
        auto hintIt = hints.find(school);
        if (hintIt != hints.end()) {
            // Hints first, then fill with discovered themes
            auto result = hintIt->second;
            std::unordered_set<std::string> hintLower;
            for (const auto& h : result) hintLower.insert(TreeNLP::ToLower(h));

            for (const auto& t : themes) {
                if (!hintLower.contains(TreeNLP::ToLower(t))) {
                    result.push_back(t);
                    if (static_cast<int>(result.size()) >= maxThemes) break;
                }
            }
            merged[school] = std::vector<std::string>(result.begin(),
                result.begin() + std::min(static_cast<int>(result.size()), maxThemes));
        } else {
            merged[school] = std::vector<std::string>(themes.begin(),
                themes.begin() + std::min(static_cast<int>(themes.size()), maxThemes));
        }
    }

    // Add hint-only schools not in discovered
    for (const auto& [school, hintThemes] : hints) {
        if (!merged.contains(school)) {
            merged[school] = hintThemes;
        }
    }

    return merged;
}

// =============================================================================
// SPELL GROUPING
// =============================================================================

std::pair<std::string, int>
TreeBuilder::GetSpellPrimaryTheme(const json& spell, const std::vector<std::string>& themes)
{
    if (themes.empty()) return {"_unassigned", 0};

    std::string bestTheme;
    int bestScore = 0;

    for (const auto& theme : themes) {
        int score = TreeNLP::CalculateThemeScore(spell, theme);
        if (score > bestScore) {
            bestScore = score;
            bestTheme = theme;
        }
    }

    return {bestTheme.empty() ? "_unassigned" : bestTheme, bestScore};
}

std::unordered_map<std::string, std::vector<json>>
TreeBuilder::GroupSpellsBestFit(const std::vector<json>& spells,
                                const std::vector<std::string>& themes,
                                int minScore)
{
    std::unordered_map<std::string, std::vector<json>> groups;
    for (const auto& theme : themes) {
        groups[theme] = {};
    }
    groups["_unassigned"] = {};

    for (const auto& spell : spells) {
        auto [bestTheme, bestScore] = GetSpellPrimaryTheme(spell, themes);

        if (bestScore >= minScore && !bestTheme.empty() && bestTheme != "_unassigned") {
            groups[bestTheme].push_back(spell);
        } else {
            groups["_unassigned"].push_back(spell);
        }
    }

    // Reclassify unassigned spells with LLM keywords (if present)
    auto& unassigned = groups["_unassigned"];
    std::vector<json> reclassified;
    for (const auto& spell : unassigned) {
        auto llmKw = spell.value("llm_keyword", std::string(""));
        if (llmKw.empty()) continue;

        if (groups.contains(llmKw)) {
            groups[llmKw].push_back(spell);
            reclassified.push_back(spell);
        } else {
            auto parent = spell.value("llm_keyword_parent", std::string(""));
            if (!parent.empty() && groups.contains(parent)) {
                groups[parent].push_back(spell);
                reclassified.push_back(spell);
            }
        }
    }
    for (const auto& r : reclassified) {
        auto fid = r.value("formId", std::string(""));
        unassigned.erase(
            std::remove_if(unassigned.begin(), unassigned.end(),
                [&fid](const json& s) { return s.value("formId", std::string("")) == fid; }),
            unassigned.end());
    }

    return groups;
}

// =============================================================================
// TREE VALIDATION
// =============================================================================

std::unordered_set<std::string> TreeBuilder::SimulateUnlocks(
    const std::unordered_map<std::string, TreeNode>& nodes,
    const std::string& rootId)
{
    std::unordered_set<std::string> unlocked;
    if (!nodes.contains(rootId)) return unlocked;

    unlocked.insert(rootId);

    // Fixed-point iteration: keep unlocking until no new unlocks
    bool changed = true;
    while (changed) {
        changed = false;
        for (const auto& [fid, node] : nodes) {
            if (unlocked.contains(fid)) continue;

            // Node unlocks when ALL prerequisites are unlocked
            bool allPrereqsMet = true;
            for (const auto& prereq : node.prerequisites) {
                if (!unlocked.contains(prereq)) {
                    allPrereqsMet = false;
                    break;
                }
            }

            if (allPrereqsMet && !node.prerequisites.empty()) {
                unlocked.insert(fid);
                changed = true;
            }
        }
    }

    return unlocked;
}

std::vector<std::string> TreeBuilder::FindUnreachableNodes(
    const std::unordered_map<std::string, TreeNode>& nodes,
    const std::string& rootId)
{
    auto unlocked = SimulateUnlocks(nodes, rootId);

    std::vector<std::string> unreachable;
    for (const auto& [fid, node] : nodes) {
        if (!unlocked.contains(fid)) {
            unreachable.push_back(fid);
        }
    }
    return unreachable;
}

std::vector<std::vector<std::string>> TreeBuilder::DetectCycles(
    const std::unordered_map<std::string, TreeNode>& nodes)
{
    // DFS-based cycle detection
    std::vector<std::vector<std::string>> cycles;
    std::unordered_set<std::string> visited;
    std::unordered_set<std::string> inStack;
    std::vector<std::string> stack;

    std::function<void(const std::string&)> dfs = [&](const std::string& nodeId) {
        if (inStack.contains(nodeId)) {
            // Found a cycle — extract it
            std::vector<std::string> cycle;
            auto it = std::find(stack.begin(), stack.end(), nodeId);
            if (it != stack.end()) {
                for (; it != stack.end(); ++it) {
                    cycle.push_back(*it);
                }
                cycle.push_back(nodeId);
                cycles.push_back(std::move(cycle));
            }
            return;
        }
        if (visited.contains(nodeId)) return;

        visited.insert(nodeId);
        inStack.insert(nodeId);
        stack.push_back(nodeId);

        auto it = nodes.find(nodeId);
        if (it != nodes.end()) {
            for (const auto& childId : it->second.children) {
                dfs(childId);
            }
        }

        stack.pop_back();
        inStack.erase(nodeId);
    };

    for (const auto& [fid, node] : nodes) {
        if (!visited.contains(fid)) {
            dfs(fid);
        }
    }

    return cycles;
}

TreeBuilder::ValidationResult TreeBuilder::ValidateSchoolTree(
    const std::unordered_map<std::string, TreeNode>& nodes,
    const std::string& rootId,
    int maxChildren)
{
    ValidationResult result;
    result.totalNodes = static_cast<int>(nodes.size());

    if (!nodes.contains(rootId)) {
        result.allValid = false;
        result.warnings.push_back("Root node not found: " + rootId);
        return result;
    }

    // Check reachability
    auto unlocked = SimulateUnlocks(nodes, rootId);
    result.reachableNodes = static_cast<int>(unlocked.size());
    result.unreachableCount = result.totalNodes - result.reachableNodes;

    for (const auto& [fid, node] : nodes) {
        if (!unlocked.contains(fid)) {
            result.unreachableIds.push_back(fid);
        }
    }

    // Check cycles
    auto cycles = DetectCycles(nodes);
    result.cycleCount = static_cast<int>(cycles.size());

    // Check max children violations
    for (const auto& [fid, node] : nodes) {
        if (static_cast<int>(node.children.size()) > maxChildren + 2) {
            result.warnings.push_back(
                "Node " + fid + " has " + std::to_string(node.children.size()) +
                " children (max " + std::to_string(maxChildren) + ")");
        }
    }

    result.allValid = (result.unreachableCount == 0 && result.cycleCount == 0);
    return result;
}

int TreeBuilder::FixUnreachableNodes(
    std::unordered_map<std::string, TreeNode>& nodes,
    const std::string& rootId,
    int maxChildren)
{
    int totalFixes = 0;

    for (int pass = 0; pass < 20; ++pass) {
        auto unreachable = FindUnreachableNodes(nodes, rootId);
        if (unreachable.empty()) break;

        bool fixedAny = false;

        for (const auto& fid : unreachable) {
            auto& node = nodes[fid];

            // Strategy 1: Remove blocking prerequisites
            // Find prereqs that are themselves unreachable
            std::vector<std::string> blockingPrereqs;
            auto currentUnlocked = SimulateUnlocks(nodes, rootId);

            for (const auto& prereq : node.prerequisites) {
                if (!currentUnlocked.contains(prereq)) {
                    blockingPrereqs.push_back(prereq);
                }
            }

            if (!blockingPrereqs.empty()) {
                for (const auto& bp : blockingPrereqs) {
                    // Remove this prerequisite
                    node.prerequisites.erase(
                        std::remove(node.prerequisites.begin(), node.prerequisites.end(), bp),
                        node.prerequisites.end());
                    // Also remove from parent's children
                    if (nodes.contains(bp)) {
                        auto& parent = nodes[bp];
                        parent.children.erase(
                            std::remove(parent.children.begin(), parent.children.end(), fid),
                            parent.children.end());
                    }
                }
                totalFixes++;
                fixedAny = true;
                continue;
            }

            // Strategy 2: If no prerequisites at all, connect to root or nearest available
            if (node.prerequisites.empty()) {
                // Find best parent among reachable nodes
                std::string bestParent;
                int bestChildCount = std::numeric_limits<int>::max();

                for (const auto& [rid, rnode] : nodes) {
                    if (!currentUnlocked.contains(rid)) continue;
                    if (rid == fid) continue;
                    if (static_cast<int>(rnode.children.size()) < maxChildren &&
                        static_cast<int>(rnode.children.size()) < bestChildCount) {
                        bestChildCount = static_cast<int>(rnode.children.size());
                        bestParent = rid;
                    }
                }

                if (!bestParent.empty()) {
                    LinkNodes(nodes[bestParent], node);
                    totalFixes++;
                    fixedAny = true;
                } else {
                    // Last resort: connect to root (even if over capacity)
                    LinkNodes(nodes[rootId], node);
                    totalFixes++;
                    fixedAny = true;
                }
            }
        }

        if (!fixedAny) break;
    }

    return totalFixes;
}
