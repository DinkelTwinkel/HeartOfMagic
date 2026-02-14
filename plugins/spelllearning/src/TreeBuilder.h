#pragma once

#include "PCH.h"
#include "TreeNLP.h"

// =============================================================================
// TreeBuilder — Spell tree construction engine
//
// Replaces the Python tree building pipeline (server.py, tree_builder.py,
// classic_build_tree.py, theme_discovery.py, spell_grouper.py, validator.py).
//
// Provides multiple builder modes:
//   - Classic: Tier-first ordering (Novice→Master depth constraint)
//   - Thematic: NLP-driven parent selection with round-robin theme interleaving
//
// All algorithms are deterministic given a seed.
// =============================================================================

namespace TreeBuilder
{
    // =========================================================================
    // TIER CONSTANTS
    // =========================================================================

    inline constexpr const char* TIER_NAMES[] = {
        "Novice", "Apprentice", "Adept", "Expert", "Master"
    };
    inline constexpr int TIER_COUNT = 5;

    // Tier name → index (0-4), returns -1 for unknown
    int TierIndex(const std::string& tierName);

    // =========================================================================
    // TREE NODE
    // =========================================================================

    struct TreeNode {
        std::string formId;
        std::string name;
        std::string tier       = "Unknown";
        std::string school     = "Unknown";
        std::string theme;                       // NLP-assigned theme (may be empty)
        std::string section;                     // "root", "trunk", "branch" (may be empty)

        std::vector<std::string> children;       // formIds of child nodes
        std::vector<std::string> prerequisites;  // formIds of prerequisite nodes
        int depth = 0;
        bool isRoot = false;

        json spellData;  // original spell JSON (kept for NLP scoring)

        // Create from spell JSON dict
        static TreeNode FromSpell(const json& spell);

        // Add child/prerequisite (no duplicates)
        void AddChild(const std::string& childId);
        void AddPrerequisite(const std::string& prereqId);

        // Serialize to output JSON format
        json ToDict() const;
    };

    // Create bidirectional parent-child link
    void LinkNodes(TreeNode& parent, TreeNode& child);

    // Remove bidirectional link
    void UnlinkNodes(TreeNode& parent, TreeNode& child);

    // =========================================================================
    // SIMILARITY MATRIX
    // =========================================================================

    // Pre-computed pairwise similarity scores. Key format: "formIdA:formIdB"
    struct SimilarityMatrix {
        std::unordered_map<std::string, float> textSims;    // TF-IDF cosine
        std::unordered_map<std::string, float> nameSims;    // char n-gram on names
        std::unordered_map<std::string, float> effectSims;  // char n-gram on effect names

        // Get similarity between two spells (returns 0 if not computed)
        float GetTextSim(const std::string& a, const std::string& b) const;
        float GetNameSim(const std::string& a, const std::string& b) const;
        float GetEffectSim(const std::string& a, const std::string& b) const;
    };

    // Compute pairwise similarity matrix for all spells
    SimilarityMatrix ComputeSimilarityMatrix(const std::vector<json>& spells);

    // =========================================================================
    // THEME DISCOVERY (replaces theme_discovery.py)
    // =========================================================================

    // Vanilla theme hints per school
    const std::unordered_map<std::string, std::vector<std::string>>& GetVanillaThemeHints();

    // Discover themes per school using TF-IDF keyword extraction
    std::unordered_map<std::string, std::vector<std::string>>
    DiscoverThemesPerSchool(const std::vector<json>& spells, int topN = 8);

    // Merge discovered themes with vanilla hints (hints take priority)
    std::unordered_map<std::string, std::vector<std::string>>
    MergeWithHints(const std::unordered_map<std::string, std::vector<std::string>>& discovered,
                   int maxThemes = 10);

    // =========================================================================
    // SPELL GROUPING (replaces spell_grouper.py)
    // =========================================================================

    // Assign each spell to its best-matching theme
    std::unordered_map<std::string, std::vector<json>>
    GroupSpellsBestFit(const std::vector<json>& spells,
                      const std::vector<std::string>& themes,
                      int minScore = 30);

    // Get the best matching theme for a single spell
    std::pair<std::string, int>
    GetSpellPrimaryTheme(const json& spell, const std::vector<std::string>& themes);

    // =========================================================================
    // TREE VALIDATION (replaces validator.py)
    // =========================================================================

    struct ValidationResult {
        bool allValid = true;
        int totalNodes = 0;
        int reachableNodes = 0;
        int unreachableCount = 0;
        int cycleCount = 0;
        std::vector<std::string> unreachableIds;
        std::vector<std::string> warnings;
    };

    // Simulate progressive unlock from root, return set of reachable formIds
    std::unordered_set<std::string> SimulateUnlocks(
        const std::unordered_map<std::string, TreeNode>& nodes,
        const std::string& rootId);

    // Find unreachable nodes in a school tree
    std::vector<std::string> FindUnreachableNodes(
        const std::unordered_map<std::string, TreeNode>& nodes,
        const std::string& rootId);

    // Detect cycles using DFS
    std::vector<std::vector<std::string>> DetectCycles(
        const std::unordered_map<std::string, TreeNode>& nodes);

    // Validate a school tree (returns validation result)
    ValidationResult ValidateSchoolTree(
        const std::unordered_map<std::string, TreeNode>& nodes,
        const std::string& rootId,
        int maxChildren);

    // Fix unreachable nodes by removing blocking prereqs and reconnecting
    int FixUnreachableNodes(
        std::unordered_map<std::string, TreeNode>& nodes,
        const std::string& rootId,
        int maxChildren);

    // =========================================================================
    // BUILDER CONFIGURATION
    // =========================================================================

    struct BuildConfig {
        int seed = 0;                  // RNG seed (0 = time-based)
        int maxChildrenPerNode = 3;
        int topThemesPerSchool = 8;
        bool autoFixUnreachable = true;
        bool preferVanillaRoots = true;
        float density = 0.6f;
        float symmetry = 0.3f;
        float chaos = 0.0f;           // 0=strict metadata, 1=pure NLP discovery
        float convergenceChance = 0.4f;
        float forceBalance = 0.5f;    // Graph mode: jitter to prevent star topology
        std::string branchStyle = "chain";  // "chain", "bfs", "balanced"
        std::string chainStyle = "linear"; // Oracle: "linear" or "branching"
        int batchSize = 20;                // Oracle: spells per LLM batch

        // LLM API config (Oracle builder)
        struct LLMApiConfig {
            bool enabled = false;
            std::string provider = "openrouter";  // "openrouter" or "ollama"
            std::string apiKey;
            std::string model;
            std::string url;
        };
        std::optional<LLMApiConfig> llmApi;

        // Per-school root overrides: school → formId
        std::unordered_map<std::string, std::string> selectedRoots;

        // Grid layout hint (from JS preview)
        struct GridHint {
            std::string mode;           // "sun" or "flat"
            int schoolCount = 5;
            int avgPointsPerSchool = 0;
        };
        std::optional<GridHint> gridHint;

        // Parse from JSON config dict
        static BuildConfig FromJson(const json& config);
    };

    // =========================================================================
    // BUILDER RESULT
    // =========================================================================

    struct BuildResult {
        json treeData;       // Full tree JSON matching Python output format
        bool success = false;
        std::string error;
        float elapsedMs = 0.0f;
    };

    // =========================================================================
    // BUILDER MODES
    // =========================================================================

    // Classic builder: tier-first ordering (Novice=depth0, Master=depth4)
    BuildResult BuildClassic(const std::vector<json>& spells, const BuildConfig& config);

    // Tree builder: NLP thematic with round-robin theme interleaving,
    // branching energy, and convergence (multi-prerequisite gates)
    BuildResult BuildTree(const std::vector<json>& spells, const BuildConfig& config);

    // Graph builder: Edmonds' minimum spanning arborescence (directed MST)
    BuildResult BuildGraph(const std::vector<json>& spells, const BuildConfig& config);

    // Thematic builder: 3D similarity BFS with per-theme branch construction
    BuildResult BuildThematic(const std::vector<json>& spells, const BuildConfig& config);

    // Oracle builder: LLM-guided semantic chain grouping (fallback: cluster lanes)
    BuildResult BuildOracle(const std::vector<json>& spells, const BuildConfig& config);

    // =========================================================================
    // HIGH-LEVEL API (called from UIManager)
    // =========================================================================

    // Build a spell tree using the specified command/mode.
    // Commands: "build_tree_classic", "build_tree", "build_tree_graph",
    //           "build_tree_thematic", "build_tree_oracle"
    BuildResult Build(const std::string& command,
                      const std::vector<json>& spells,
                      const json& configJson);

    // =========================================================================
    // THEME COLORS (for Thematic builder)
    // =========================================================================

    // Derive per-theme colors from a school base color
    std::unordered_map<std::string, std::string>
    DeriveThemeColors(const std::string& schoolColorHex,
                      const std::vector<std::string>& themes);

    // School base colors
    const std::unordered_map<std::string, std::string>& GetSchoolColors();
}
