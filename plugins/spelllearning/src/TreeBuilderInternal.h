#pragma once

#include "TreeBuilder.h"

#include <random>

// =============================================================================
// Internal helpers shared across TreeBuilder implementation files.
// NOT part of the public API — only included by TreeBuilder*.cpp files.
// =============================================================================

namespace TreeBuilder::Internal
{
    // Check if a formId is likely vanilla (low load order, first 5 slots)
    bool IsVanillaFormId(const std::string& formIdStr);

    // Pick root spell for a school (checks user overrides, prefers vanilla)
    const json* PickRoot(
        const std::unordered_map<std::string, std::vector<json>>& byTier,
        const BuildConfig& config,
        const std::string& school,
        std::mt19937& rng);

    // Sort spells by tier then magicka cost then name
    void SortByTierAndCost(std::vector<json>& spells);

    // Rebuild validation node map from serialized JSON
    std::unordered_map<std::string, TreeNode>
    RebuildValNodes(const json& schoolData);

    // Run validation + auto-fix + stats on tree data (shared by all builders)
    void ValidateAndFix(json& treeData, int maxChildren, bool autoFix);

}  // namespace TreeBuilder::Internal
