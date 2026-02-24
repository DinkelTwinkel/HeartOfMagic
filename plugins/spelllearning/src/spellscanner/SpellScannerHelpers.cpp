#include "Common.h"
#include "SpellScanner.h"

namespace SpellScanner
{
    // =============================================================================
    // SYSTEM INSTRUCTIONS (Hidden from user - defines output format)
    // =============================================================================

    std::string GetSystemInstructions()
    {
        return R"(
## OUTPUT FORMAT REQUIREMENTS (CRITICAL - Follow exactly)

You MUST return ONLY valid JSON matching this exact schema. No explanations, no markdown code blocks, just raw JSON.

{
  "version": "1.0",
  "schools": {
    "Alteration": {
      "root": "0xFORMID_OF_ROOT_SPELL",
      "nodes": [
        {
          "formId": "0xFORMID",
          "children": ["0xCHILD_FORMID_1", "0xCHILD_FORMID_2"],
          "prerequisites": ["0xPREREQ_FORMID"],
          "tier": 1
        }
      ]
    },
    "Conjuration": { ... },
    "Destruction": { ... },
    "Illusion": { ... },
    "Restoration": { ... }
  }
}

### Field Requirements:
- **formId**: The hex FormID from the spell data (e.g., "0x00012FCD"). MUST match exactly.
- **children**: Array of formIds that this spell unlocks. Empty array [] if none.
- **prerequisites**: Array of formIds required before learning. Empty array [] for root spells.
- **tier**: Integer depth in tree. Root = 1, children of root = 2, etc.
- **root**: The formId of the single root spell for each school.

### Critical Rules:
1. Use ONLY formIds in the output - names/descriptions are NOT needed (retrieved in-game)
2. Every spell from the input MUST appear exactly once in the output
3. Each school has exactly ONE root spell (prerequisites = [])
4. FormIds must be EXACT matches from the spell data - no modifications
5. Return raw JSON only - no markdown, no explanations, no code fences

## SPELL DATA:
)";
    }

    // =============================================================================
    // CONFIG PARSING
    // =============================================================================

    ScanConfig ParseScanConfig(const std::string& jsonConfig)
    {
        ScanConfig config;

        if (jsonConfig.empty()) {
            return config;
        }

        try {
            json j = json::parse(jsonConfig);

            // Parse fields object
            if (j.contains("fields")) {
                auto& f = j["fields"];
                if (f.contains("editorId")) config.fields.editorId = f["editorId"].get<bool>();
                if (f.contains("magickaCost")) config.fields.magickaCost = f["magickaCost"].get<bool>();
                if (f.contains("minimumSkill")) config.fields.minimumSkill = f["minimumSkill"].get<bool>();
                if (f.contains("castingType")) config.fields.castingType = f["castingType"].get<bool>();
                if (f.contains("delivery")) config.fields.delivery = f["delivery"].get<bool>();
                if (f.contains("chargeTime")) config.fields.chargeTime = f["chargeTime"].get<bool>();
                if (f.contains("plugin")) config.fields.plugin = f["plugin"].get<bool>();
                if (f.contains("effects")) config.fields.effects = f["effects"].get<bool>();
                if (f.contains("effectNames")) config.fields.effectNames = f["effectNames"].get<bool>();
                if (f.contains("keywords")) config.fields.keywords = f["keywords"].get<bool>();
            }

            // Parse tree rules prompt
            if (j.contains("treeRulesPrompt")) {
                config.treeRulesPrompt = j["treeRulesPrompt"].get<std::string>();
            }

            logger::info("SpellScanner: ScanConfig parsed - editorId:{}, treeRulesPrompt length:{}",
                config.fields.editorId, config.treeRulesPrompt.length());
        } catch (const std::exception& e) {
            logger::warn("SpellScanner: Failed to parse scan config: {}", e.what());
        }

        return config;
    }

    FieldConfig ParseFieldConfig(const std::string& jsonConfig)
    {
        FieldConfig config;

        if (jsonConfig.empty()) {
            return config;
        }

        try {
            json j = json::parse(jsonConfig);

            if (j.contains("editorId")) config.editorId = j["editorId"].get<bool>();
            if (j.contains("magickaCost")) config.magickaCost = j["magickaCost"].get<bool>();
            if (j.contains("minimumSkill")) config.minimumSkill = j["minimumSkill"].get<bool>();
            if (j.contains("castingType")) config.castingType = j["castingType"].get<bool>();
            if (j.contains("delivery")) config.delivery = j["delivery"].get<bool>();
            if (j.contains("chargeTime")) config.chargeTime = j["chargeTime"].get<bool>();
            if (j.contains("plugin")) config.plugin = j["plugin"].get<bool>();
            if (j.contains("effects")) config.effects = j["effects"].get<bool>();
            if (j.contains("effectNames")) config.effectNames = j["effectNames"].get<bool>();
            if (j.contains("keywords")) config.keywords = j["keywords"].get<bool>();

            logger::info("SpellScanner: FieldConfig parsed - editorId:{}, magickaCost:{}",
                config.editorId, config.magickaCost);
        } catch (const std::exception& e) {
            logger::warn("SpellScanner: Failed to parse field config: {}", e.what());
        }

        return config;
    }

    // =============================================================================
    // HELPER FUNCTIONS
    // =============================================================================

    bool IsValidMagicSchool(RE::ActorValue school)
    {
        switch (school) {
            case RE::ActorValue::kAlteration:
            case RE::ActorValue::kConjuration:
            case RE::ActorValue::kDestruction:
            case RE::ActorValue::kIllusion:
            case RE::ActorValue::kRestoration:
                return true;
            default:
                return false;
        }
    }

    std::string GetSchoolName(RE::ActorValue school)
    {
        switch (school) {
            case RE::ActorValue::kAlteration: return "Alteration";
            case RE::ActorValue::kConjuration: return "Conjuration";
            case RE::ActorValue::kDestruction: return "Destruction";
            case RE::ActorValue::kIllusion: return "Illusion";
            case RE::ActorValue::kRestoration: return "Restoration";
            default: return "Unknown";
        }
    }

    std::string GetCastingTypeName(RE::MagicSystem::CastingType type)
    {
        switch (type) {
            case RE::MagicSystem::CastingType::kConstantEffect: return "Constant Effect";
            case RE::MagicSystem::CastingType::kFireAndForget: return "Fire and Forget";
            case RE::MagicSystem::CastingType::kConcentration: return "Concentration";
            case RE::MagicSystem::CastingType::kScroll: return "Scroll";
            default: return "Unknown";
        }
    }

    std::string GetDeliveryName(RE::MagicSystem::Delivery delivery)
    {
        switch (delivery) {
            case RE::MagicSystem::Delivery::kSelf: return "Self";
            case RE::MagicSystem::Delivery::kTouch: return "Touch";
            case RE::MagicSystem::Delivery::kAimed: return "Aimed";
            case RE::MagicSystem::Delivery::kTargetActor: return "Target Actor";
            case RE::MagicSystem::Delivery::kTargetLocation: return "Target Location";
            default: return "Unknown";
        }
    }

    std::string GetSkillLevelName(uint32_t minimumSkill)
    {
        if (minimumSkill < 25) return "Novice";
        if (minimumSkill < 50) return "Apprentice";
        if (minimumSkill < 75) return "Adept";
        if (minimumSkill < 100) return "Expert";
        return "Master";
    }

    std::string GetSkillLevelFromPerk(RE::BGSPerk* perk)
    {
        if (!perk) return "";

        const char* editorId = perk->GetFormEditorID();
        if (!editorId || strlen(editorId) == 0) return "";

        std::string id(editorId);
        std::string lower = id;
        std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

        // Check for tier keywords in perk editor ID
        // Vanilla pattern: {School}{Tier}{Number} e.g., DestructionMaster100
        // Check Master first (most important to not misclassify)
        if (lower.find("master") != std::string::npos) return "Master";
        if (lower.find("expert") != std::string::npos) return "Expert";
        if (lower.find("adept") != std::string::npos) return "Adept";
        if (lower.find("apprentice") != std::string::npos) return "Apprentice";
        if (lower.find("novice") != std::string::npos) return "Novice";

        // Fallback: check numeric suffix (00, 25, 50, 75, 100)
        if (id.length() >= 3 && id.substr(id.length() - 3) == "100") return "Master";
        if (id.length() >= 2) {
            std::string suffix = id.substr(id.length() - 2);
            if (suffix == "75") return "Expert";
            if (suffix == "50") return "Adept";
            if (suffix == "25") return "Apprentice";
            if (suffix == "00") return "Novice";
        }

        return "";  // Unknown perk, caller should fall back to minimumSkill
    }

    std::string DetermineSpellTier(RE::SpellItem* spell)
    {
        if (!spell) return "Novice";

        // First: try the half-cost perk (most reliable for modded spells)
        // CommonLib calls this castingPerk, but it's the HalfCostPerk field in the SPEL record
        if (spell->data.castingPerk) {
            std::string perkTier = GetSkillLevelFromPerk(spell->data.castingPerk);
            if (!perkTier.empty()) {
                return perkTier;
            }
        }

        // Fallback: use minimumSkill from first effect
        uint32_t minimumSkill = 0;
        if (spell->effects.size() > 0) {
            auto* firstEffect = spell->effects[0];
            if (firstEffect && firstEffect->baseEffect) {
                minimumSkill = firstEffect->baseEffect->GetMinimumSkillLevel();
            }
        }

        return GetSkillLevelName(minimumSkill);
    }

    std::string GetPluginName(RE::FormID formId)
    {
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) return "Unknown";

        uint8_t modIndex = (formId >> 24) & 0xFF;

        if (modIndex == 0xFE) {
            uint16_t lightIndex = (formId >> 12) & 0xFFF;
            const auto* file = dataHandler->LookupLoadedLightModByIndex(lightIndex);
            if (file) {
                return file->fileName;
            }
        } else {
            const auto* file = dataHandler->LookupLoadedModByIndex(modIndex);
            if (file) {
                return file->fileName;
            }
        }

        return "Unknown";
    }
}
