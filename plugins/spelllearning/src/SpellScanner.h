#pragma once

#include "PCH.h"

namespace SpellScanner
{
    // Field output configuration
    struct FieldConfig {
        bool editorId = true;
        bool magickaCost = true;
        bool minimumSkill = false;
        bool castingType = false;
        bool delivery = false;
        bool chargeTime = false;
        bool plugin = false;
        bool effects = false;
        bool effectNames = false;
        bool keywords = false;
    };

    // Scan configuration (fields + user prompt)
    struct ScanConfig {
        FieldConfig fields;
        std::string treeRulesPrompt;
    };

    // Parse scan config from JSON string (includes fields and treeRulesPrompt)
    ScanConfig ParseScanConfig(const std::string& jsonConfig);

    // Parse field config from JSON string (legacy support)
    FieldConfig ParseFieldConfig(const std::string& jsonConfig);

    // Scan all spells and return JSON output with spell data + prompts
    std::string ScanAllSpells(const ScanConfig& config);
    std::string ScanAllSpells(const FieldConfig& config = FieldConfig{});

    // Scan spells via spell tomes (avoids duplicates, only learnable spells)
    std::string ScanSpellTomes(const ScanConfig& config);

    // Get the system instructions for LLM output format (hidden from user)
    std::string GetSystemInstructions();

    // Get spell info by FormID (for Tree Viewer)
    // Returns JSON with: formId, name, editorId, school, level, cost, type, effects, description
    std::string GetSpellInfoByFormId(const std::string& formIdStr);

    // =========================================================================
    // PERSISTENT FORMID FUNCTIONS (Load Order Resilient)
    // =========================================================================

    // Convert runtime FormID to persistent format: "PluginName.esp|0x00123456"
    // This format survives load order changes because it stores plugin name + local ID
    std::string GetPersistentFormId(RE::FormID formId);

    // Resolve persistent ID back to runtime FormID
    // Returns 0 if plugin not loaded or invalid format
    RE::FormID ResolvePersistentFormId(const std::string& persistentId);

    // Check if a FormID is currently valid (form exists in game)
    bool IsFormIdValid(RE::FormID formId);

    // Check if a FormID string is currently valid
    bool IsFormIdValid(const std::string& formIdStr);

    // Tree validation result
    struct TreeValidationResult {
        int totalNodes = 0;
        int validNodes = 0;
        int invalidNodes = 0;
        int resolvedFromPersistent = 0;
        std::vector<std::string> missingPlugins;      // Plugins that couldn't be found
        std::vector<std::string> invalidFormIds;      // FormIDs that couldn't be resolved
    };

    // Validate and optionally fix a spell tree JSON
    // - Validates all FormIDs exist
    // - Attempts to resolve from persistentId if formId fails
    // - Updates formId field with resolved value
    // - Returns validation statistics
    TreeValidationResult ValidateAndFixTree(json& treeData);

    // Helper functions
    std::string GetSchoolName(RE::ActorValue school);
    std::string GetCastingTypeName(RE::MagicSystem::CastingType type);
    std::string GetDeliveryName(RE::MagicSystem::Delivery delivery);
    std::string GetSkillLevelName(uint32_t minimumSkill);
    std::string GetSkillLevelFromPerk(RE::BGSPerk* perk);
    std::string DetermineSpellTier(RE::SpellItem* spell);
    std::string GetPluginName(RE::FormID formId);
}
