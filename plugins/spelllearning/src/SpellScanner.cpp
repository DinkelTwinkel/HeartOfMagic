#include "PCH.h"
#include "SpellScanner.h"
#include "SpellEffectivenessHook.h"

namespace SpellScanner
{
    // =============================================================================
    // UTF-8 ENCODING - Handles international text (Chinese/Japanese/Korean/etc.)
    // =============================================================================
    
    // Forward declaration
    std::string SanitizeToUTF8Strict(const std::string& input);
    
    /**
     * Convert string from system ANSI codepage (e.g., GBK for Chinese Windows) to UTF-8.
     * This is needed because Skyrim's GetFullName() returns strings in the system's ANSI codepage,
     * not UTF-8. Chinese/Japanese/Korean users will have GBK/Shift-JIS/EUC-KR encoded strings.
     */
    std::string ConvertToUTF8(const std::string& input)
    {
        if (input.empty()) return input;
        
        // First, convert from ANSI (system codepage) to wide string (UTF-16)
        int wideLen = MultiByteToWideChar(CP_ACP, 0, input.c_str(), -1, nullptr, 0);
        if (wideLen <= 0) {
            // Conversion failed, return sanitized version as fallback
            return SanitizeToUTF8Strict(input);
        }
        
        std::wstring wideStr(wideLen, L'\0');
        MultiByteToWideChar(CP_ACP, 0, input.c_str(), -1, &wideStr[0], wideLen);
        
        // Then convert from UTF-16 to UTF-8
        int utf8Len = WideCharToMultiByte(CP_UTF8, 0, wideStr.c_str(), -1, nullptr, 0, nullptr, nullptr);
        if (utf8Len <= 0) {
            return SanitizeToUTF8Strict(input);
        }
        
        std::string utf8Str(utf8Len, '\0');
        WideCharToMultiByte(CP_UTF8, 0, wideStr.c_str(), -1, &utf8Str[0], utf8Len, nullptr, nullptr);
        
        // Remove null terminator if present
        if (!utf8Str.empty() && utf8Str.back() == '\0') {
            utf8Str.pop_back();
        }
        
        return utf8Str;
    }

    /**
     * Strict UTF-8 sanitization - validates and fixes invalid UTF-8 sequences.
     * Uses Windows API (MB_ERR_INVALID_CHARS) for correct handling of overlongs,
     * surrogates, and code points above U+10FFFF.
     */
    std::string SanitizeToUTF8Strict(const std::string& input)
    {
        // Fast path: validate entire string as UTF-8 via Windows API
        int wideLen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                           input.c_str(), static_cast<int>(input.size()),
                                           nullptr, 0);
        if (wideLen > 0) {
            // Already valid UTF-8 — round-trip through UTF-16 to normalize
            std::wstring wide(wideLen, L'\0');
            MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                               input.c_str(), static_cast<int>(input.size()),
                               &wide[0], wideLen);
            int utf8Len = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), wideLen,
                                              nullptr, 0, nullptr, nullptr);
            std::string result(utf8Len, '\0');
            WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), wideLen,
                               &result[0], utf8Len, nullptr, nullptr);
            return result;
        }

        // Invalid UTF-8 somewhere — salvage byte by byte
        std::string result;
        result.reserve(input.size());

        size_t i = 0;
        while (i < input.size()) {
            unsigned char c = static_cast<unsigned char>(input[i]);

            if (c < 0x80) {
                result += static_cast<char>(c);
                ++i;
                continue;
            }

            // Determine expected multi-byte sequence length
            int seqLen = 0;
            if (c >= 0xC2 && c <= 0xDF) seqLen = 2;
            else if (c >= 0xE0 && c <= 0xEF) seqLen = 3;
            else if (c >= 0xF0 && c <= 0xF4) seqLen = 4;

            if (seqLen > 0 && i + seqLen <= input.size()) {
                // Let the API validate this sequence (catches overlongs, surrogates, etc.)
                int testLen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                                  &input[i], seqLen, nullptr, 0);
                if (testLen > 0) {
                    result.append(input, i, seqLen);
                    i += seqLen;
                    continue;
                }
            }

            // Windows-1252 control characters — map to ASCII equivalents
            if (c >= 0x80 && c <= 0x9F) {
                switch (c) {
                    case 0x91: case 0x92: result += '\''; break;
                    case 0x93: case 0x94: result += '"'; break;
                    case 0x96: case 0x97: result += '-'; break;
                    case 0x85: result += "..."; break;
                    case 0x99: result += "(TM)"; break;
                    default: break;
                }
            }
            ++i;
        }

        return result;
    }

    /**
     * Convert a string to valid UTF-8 for JSON serialization.
     * Handles:
     * - Chinese (GBK), Japanese (Shift-JIS), Korean (EUC-KR) via system codepage
     * - Windows-1252 special characters
     * - Already-valid UTF-8 (passed through efficiently)
     */
    std::string SanitizeToUTF8(const std::string& input)
    {
        if (input.empty()) return input;
        
        // Check if input is already valid UTF-8 via Windows API
        // MB_ERR_INVALID_CHARS correctly rejects overlongs, surrogates, and >U+10FFFF
        if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                input.c_str(), static_cast<int>(input.size()),
                                nullptr, 0) > 0) {
            return input;
        }
        
        // Not valid UTF-8, try converting from system codepage (GBK/Shift-JIS/etc.)
        return ConvertToUTF8(input);
    }

    // =============================================================================
    // SYSTEM INSTRUCTIONS (Hidden from user - defines output format)
    // =============================================================================

    std::string GetSystemInstructions()
    {
        return R"(
## OUTPUT FORMAT REQUIREMENTS (CRITICAL - Follow exactly)

You MUST return ONLY valid JSON matching this exact schema. No explanations, no markdown code blocks, just raw JSON.

```json
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
```

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

    // =============================================================================
    // PERSISTENT FORMID FUNCTIONS (Load Order Resilient)
    // =============================================================================

    std::string GetPersistentFormId(RE::FormID formId)
    {
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) return "";

        uint8_t modIndex = (formId >> 24) & 0xFF;
        uint32_t localFormId = 0;
        const RE::TESFile* plugin = nullptr;

        if (modIndex == 0xFE) {
            // Light plugin (ESL)
            uint16_t lightIndex = (formId >> 12) & 0xFFF;
            plugin = dataHandler->LookupLoadedLightModByIndex(lightIndex);
            localFormId = formId & 0x00000FFF;  // Only 12 bits for light plugins
        } else {
            // Regular plugin
            plugin = dataHandler->LookupLoadedModByIndex(modIndex);
            localFormId = formId & 0x00FFFFFF;  // 24 bits for regular plugins
        }

        if (plugin && plugin->fileName && strlen(plugin->fileName) > 0) {
            return std::format("{}|0x{:06X}", plugin->fileName, localFormId);
        }

        return "";  // Unknown plugin
    }

    RE::FormID ResolvePersistentFormId(const std::string& persistentId)
    {
        // Parse "PluginName.esp|0x123456" format
        auto pipePos = persistentId.find('|');
        if (pipePos == std::string::npos || pipePos == 0) {
            logger::trace("SpellScanner: Invalid persistent ID format (no pipe): {}", persistentId);
            return 0;
        }

        std::string pluginName = persistentId.substr(0, pipePos);
        std::string localIdStr = persistentId.substr(pipePos + 1);

        // Parse local FormID
        uint32_t localFormId = 0;
        try {
            if (localIdStr.length() >= 2 && (localIdStr.substr(0, 2) == "0x" || localIdStr.substr(0, 2) == "0X")) {
                localIdStr = localIdStr.substr(2);
            }
            localFormId = std::stoul(localIdStr, nullptr, 16);
        } catch (const std::exception& e) {
            logger::warn("SpellScanner: Invalid local FormID in persistent ID: {} ({})", persistentId, e.what());
            return 0;
        }

        // Look up plugin by name
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) return 0;

        const RE::TESFile* plugin = dataHandler->LookupModByName(pluginName);
        if (!plugin) {
            logger::trace("SpellScanner: Plugin not loaded: {}", pluginName);
            return 0;
        }

        // Reconstruct full FormID with current mod index
        if (plugin->IsLight()) {
            // Light plugin: 0xFEXXX + 12-bit local ID
            std::uint32_t lightIndex = plugin->GetPartialIndex();
            return (0xFE000000 | ((lightIndex) << 12) | (localFormId & 0xFFF));
        } else {
            // Regular plugin: mod index + 24-bit local ID
            uint8_t modIndex = plugin->GetCompileIndex();
            return (static_cast<uint32_t>(modIndex) << 24) | (localFormId & 0x00FFFFFF);
        }
    }

    bool IsFormIdValid(RE::FormID formId)
    {
        if (formId == 0) return false;
        auto* form = RE::TESForm::LookupByID(formId);
        return form != nullptr;
    }

    bool IsFormIdValid(const std::string& formIdStr)
    {
        if (formIdStr.empty()) return false;

        RE::FormID formId = 0;
        try {
            std::string cleanId = formIdStr;
            if (cleanId.length() >= 2 && (cleanId.substr(0, 2) == "0x" || cleanId.substr(0, 2) == "0X")) {
                cleanId = cleanId.substr(2);
            }
            formId = std::stoul(cleanId, nullptr, 16);
        } catch (...) {
            return false;
        }

        return IsFormIdValid(formId);
    }

    TreeValidationResult ValidateAndFixTree(json& treeData)
    {
        TreeValidationResult result;
        std::set<std::string> missingPluginsSet;
        std::set<std::string> invalidFormIdsSet;

        if (!treeData.contains("schools")) {
            logger::warn("SpellScanner: Tree has no schools key");
            return result;
        }

        for (auto& [schoolName, schoolData] : treeData["schools"].items()) {
            if (!schoolData.contains("nodes") || !schoolData["nodes"].is_array()) {
                continue;
            }

            auto& nodes = schoolData["nodes"];
            std::vector<size_t> nodesToRemove;

            for (size_t i = 0; i < nodes.size(); ++i) {
                auto& node = nodes[i];
                result.totalNodes++;

                if (!node.contains("formId")) {
                    nodesToRemove.push_back(i);
                    result.invalidNodes++;
                    continue;
                }

                std::string formIdStr = node["formId"].get<std::string>();
                bool isValid = IsFormIdValid(formIdStr);

                if (!isValid && node.contains("persistentId")) {
                    // Try to resolve from persistent ID
                    std::string persistentId = node["persistentId"].get<std::string>();
                    RE::FormID resolvedId = ResolvePersistentFormId(persistentId);

                    if (resolvedId != 0 && IsFormIdValid(resolvedId)) {
                        // Update formId with resolved value
                        node["formId"] = std::format("0x{:08X}", resolvedId);
                        isValid = true;
                        result.resolvedFromPersistent++;
                        logger::info("SpellScanner: Resolved {} -> 0x{:08X} from persistent ID",
                            formIdStr, resolvedId);
                    } else {
                        // Extract plugin name from persistent ID for error reporting
                        auto pipePos = persistentId.find('|');
                        if (pipePos != std::string::npos) {
                            missingPluginsSet.insert(persistentId.substr(0, pipePos));
                        }
                    }
                }

                if (isValid) {
                    result.validNodes++;
                } else {
                    nodesToRemove.push_back(i);
                    result.invalidNodes++;
                    invalidFormIdsSet.insert(formIdStr);
                    logger::warn("SpellScanner: Invalid FormID in tree: {}", formIdStr);
                }
            }

            // Remove invalid nodes (reverse order to preserve indices)
            for (auto it = nodesToRemove.rbegin(); it != nodesToRemove.rend(); ++it) {
                nodes.erase(nodes.begin() + *it);
            }

            // Clean up children/prerequisites that reference removed nodes
            for (auto& node : nodes) {
                if (node.contains("children") && node["children"].is_array()) {
                    auto& children = node["children"];
                    children.erase(
                        std::remove_if(children.begin(), children.end(),
                            [&invalidFormIdsSet](const json& child) {
                                return invalidFormIdsSet.count(child.get<std::string>()) > 0;
                            }),
                        children.end());
                }
                if (node.contains("prerequisites") && node["prerequisites"].is_array()) {
                    auto& prereqs = node["prerequisites"];
                    prereqs.erase(
                        std::remove_if(prereqs.begin(), prereqs.end(),
                            [&invalidFormIdsSet](const json& prereq) {
                                return invalidFormIdsSet.count(prereq.get<std::string>()) > 0;
                            }),
                        prereqs.end());
                }
            }

            // Update root if it was invalid
            if (schoolData.contains("root")) {
                std::string rootId = schoolData["root"].get<std::string>();
                if (invalidFormIdsSet.count(rootId) > 0) {
                    // Find first remaining node as new root
                    if (!nodes.empty() && nodes[0].contains("formId")) {
                        schoolData["root"] = nodes[0]["formId"];
                        logger::info("SpellScanner: Updated {} root to {}", schoolName, nodes[0]["formId"].dump());
                    }
                }
            }
        }

        // Convert sets to vectors
        result.missingPlugins.assign(missingPluginsSet.begin(), missingPluginsSet.end());
        result.invalidFormIds.assign(invalidFormIdsSet.begin(), invalidFormIdsSet.end());

        logger::info("SpellScanner: Tree validation complete - {}/{} valid, {} resolved from persistent, {} invalid",
            result.validNodes, result.totalNodes, result.resolvedFromPersistent, result.invalidNodes);

        return result;
    }

    // =============================================================================
    // SPELL SCANNING
    // =============================================================================

    json ScanSpellsToJson(const FieldConfig& fields)
    {
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) {
            logger::error("SpellScanner: Failed to get TESDataHandler");
            return json::array();
        }

        const auto& allSpells = dataHandler->GetFormArray<RE::SpellItem>();
        logger::info("SpellScanner: Found {} total spell forms", allSpells.size());

        json spellArray = json::array();
        int scannedCount = 0;
        int skippedCount = 0;
        int filteredCount = 0;
        
        // Diagnostic counters for debugging scan failures
        int skipType = 0;       // Failed spellType check
        int skipNoName = 0;     // Empty name
        int skipNoSchool = 0;   // No magic school
        int diagSamples = 0;    // How many diagnostic samples logged

        // Helper function to check if editorId indicates a non-player spell
        auto isNonPlayerSpell = [](const std::string& editorId) -> bool {
            // Lowercase for comparison
            std::string lower = editorId;
            std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
            
            // Skip trap spells
            if (lower.find("trap") != std::string::npos) return true;
            
            // Skip creature abilities (start with "cr")
            if (lower.substr(0, 2) == "cr") return true;
            
            // Skip shrine/altar blessings
            if (lower.find("altar") != std::string::npos) return true;
            if (lower.find("shrine") != std::string::npos) return true;
            if (lower.find("blessing") != std::string::npos && lower.find("spell") != std::string::npos) return true;
            
            // Skip dungeon-specific spells (usually not learnable)
            if (lower.substr(0, 3) == "dun") return true;
            
            // Skip perk-related spells
            if (lower.substr(0, 4) == "perk") return true;
            
            // Skip hazard effects
            if (lower.find("hazard") != std::string::npos) return true;
            
            // Skip NPC powers
            if (lower.substr(0, 5) == "power") return true;
            
            // Skip test spells
            if (lower.substr(0, 4) == "test") return true;
            
            // Skip quest-specific spells (MGxx pattern for college quests)
            if (lower.length() >= 4 && lower.substr(0, 2) == "mg" && 
                std::isdigit(lower[2]) && std::isdigit(lower[3])) return true;
            
            // Skip specific NPC abilities
            if (lower.find("mgr") == 0) return true;  // MGR prefix spells
            if (lower.find("voice") != std::string::npos) return true;  // Dragon shout variants
            if (lower.find("teleport") != std::string::npos && lower.find("pet") != std::string::npos) return true;
            
            // Skip hand-specific variants (keep only base spell to avoid duplicates)
            // e.g., FlamesLeftHand, FlamesRightHand -> keep only Flames
            if (lower.find("lefthand") != std::string::npos) return true;
            if (lower.find("righthand") != std::string::npos) return true;
            
            // Skip _Copy variants
            if (lower.find("copy") != std::string::npos) return true;
            
            // Skip DLC-specific reused base game spells (usually have DLC1/DLC2 prefix + same name)
            // These are often duplicates for DLC NPCs
            
            return false;
        };

        // Log a sample of the first few forms for diagnostics
        {
            int sampleCount = 0;
            for (auto* spell : allSpells) {
                if (!spell || sampleCount >= 5) break;
                const char* sName = spell->GetFullName();
                const char* sEdId = spell->GetFormEditorID();
                logger::info("SpellScanner DIAG: sample[{}] formId=0x{:08X} type={} name='{}' editorId='{}'",
                    sampleCount, spell->GetFormID(),
                    static_cast<int>(spell->data.spellType),
                    sName ? sName : "(null)",
                    sEdId ? sEdId : "(null)");
                sampleCount++;
            }
        }

        // First pass: count how many spells have spellType == kSpell.
        // On SE 1.5.97 the SpellItem::Data struct layout may differ from AE,
        // causing spell->data.spellType to read garbage.  If ZERO spells pass
        // the type check we disable it and rely on other heuristics instead.
        bool useTypeFilter = true;
        {
            int kSpellCount = 0;
            for (auto* spell : allSpells) {
                if (spell && spell->data.spellType == RE::MagicSystem::SpellType::kSpell) {
                    kSpellCount++;
                }
            }
            if (kSpellCount == 0 && allSpells.size() > 0) {
                logger::warn("SpellScanner: 0/{} spells have spellType==kSpell — likely SE struct layout mismatch. Disabling type filter.",
                    allSpells.size());
                useTypeFilter = false;
            } else {
                logger::info("SpellScanner: {}/{} spells have spellType==kSpell", kSpellCount, allSpells.size());
            }
        }

        for (auto* spell : allSpells) {
            if (!spell) continue;

            if (useTypeFilter && spell->data.spellType != RE::MagicSystem::SpellType::kSpell) {
                skipType++;
                skippedCount++;
                // Log first few non-kSpell types for diagnosis
                if (diagSamples < 3) {
                    const char* dn = spell->GetFullName();
                    logger::info("SpellScanner DIAG: skip type={} for '{}' (0x{:08X})",
                        static_cast<int>(spell->data.spellType),
                        dn ? dn : "(unnamed)",
                        spell->GetFormID());
                    diagSamples++;
                }
                continue;
            }

            const char* rawEditorId = spell->GetFormEditorID();
            std::string name = spell->GetFullName();
            RE::FormID formId = spell->GetFormID();

            // EditorID may be empty on SE 1.5.97 without po3's Tweaks — that's OK
            bool hasEditorId = (rawEditorId && strlen(rawEditorId) > 0);
            std::string editorIdStr = hasEditorId ? std::string(rawEditorId) : "";

            // Name is required — skip truly unnamed forms
            if (name.empty()) {
                skipNoName++;
                skippedCount++;
                continue;
            }
            
            // Filter out spells where name looks like a FormID (broken/missing data)
            // These show up as "0x000A26FF" or similar hex strings
            if (name.length() >= 2 && (name.substr(0, 2) == "0x" || name.substr(0, 2) == "0X")) {
                filteredCount++;
                continue;
            }
            
            // Also filter if name is all digits/hex (no actual name)
            bool allHex = true;
            for (char c : name) {
                if (!std::isxdigit(static_cast<unsigned char>(c)) && c != ' ') {
                    allHex = false;
                    break;
                }
            }
            if (allHex && name.length() >= 6) {
                filteredCount++;
                continue;
            }

            // Filter out non-player spells based on editorId patterns (only when available)
            if (hasEditorId && isNonPlayerSpell(editorIdStr)) {
                filteredCount++;
                continue;
            }

            // When no EditorID available, use name-based heuristics to filter junk
            if (!hasEditorId) {
                std::string lowerName = name;
                std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), ::tolower);
                
                // Skip obvious non-player spells by name patterns
                if (lowerName.find("\xD9\x81\xD8\xAE") != std::string::npos) { filteredCount++; continue; }  // trap (Arabic: فخ)
                // Skip spells with very generic/system names
                if (lowerName == "yourspellname" || lowerName == "yourspell") { filteredCount++; continue; }
            }

            RE::ActorValue school = RE::ActorValue::kNone;

            if (spell->effects.size() > 0) {
                auto* firstEffect = spell->effects[0];
                if (firstEffect && firstEffect->baseEffect) {
                    school = firstEffect->baseEffect->GetMagickSkill();
                }
            }

            if (!IsValidMagicSchool(school)) {
                skipNoSchool++;
                skippedCount++;
                continue;
            }

            // Filter out spells with no effects or broken effect data
            bool hasValidEffect = false;
            for (auto* effect : spell->effects) {
                if (effect && effect->baseEffect) {
                    std::string effectName = effect->baseEffect->GetFullName();
                    // Check effect has a real name (not empty or FormID-like)
                    if (!effectName.empty() && effectName.length() > 2 &&
                        effectName.substr(0, 2) != "0x" && effectName.substr(0, 2) != "0X") {
                        hasValidEffect = true;
                        break;
                    }
                }
            }
            if (!hasValidEffect) {
                filteredCount++;
                continue;
            }

            json spellJson;

            // Essential fields (always included)
            spellJson["formId"] = std::format("0x{:08X}", formId);
            spellJson["persistentId"] = GetPersistentFormId(formId);  // Load order resilient ID
            spellJson["name"] = SanitizeToUTF8(name);  // Sanitize for valid UTF-8 JSON
            spellJson["school"] = GetSchoolName(school);
            spellJson["skillLevel"] = DetermineSpellTier(spell);

            // Optional fields
            if (fields.editorId && hasEditorId) {
                spellJson["editorId"] = editorIdStr;
            } else if (fields.editorId) {
                spellJson["editorId"] = "";  // Empty string when not available (SE 1.5.97)
            }
            if (fields.magickaCost) {
                spellJson["magickaCost"] = spell->CalculateMagickaCost(nullptr);
            }
            if (fields.minimumSkill) {
                uint32_t minSkill = 0;
                if (spell->effects.size() > 0 && spell->effects[0] && spell->effects[0]->baseEffect) {
                    minSkill = spell->effects[0]->baseEffect->GetMinimumSkillLevel();
                }
                spellJson["minimumSkill"] = minSkill;
            }
            if (fields.castingType) {
                spellJson["castingType"] = GetCastingTypeName(spell->data.castingType);
            }
            if (fields.delivery) {
                spellJson["delivery"] = GetDeliveryName(spell->data.delivery);
            }
            if (fields.chargeTime) {
                spellJson["chargeTime"] = spell->data.chargeTime;
            }
            if (fields.plugin) {
                spellJson["plugin"] = GetPluginName(formId);
            }

            // Effects
            if (fields.effects) {
                json effectsArray = json::array();
                for (auto* effect : spell->effects) {
                    if (!effect || !effect->baseEffect) continue;

                    json effectJson;
                    effectJson["name"] = SanitizeToUTF8(effect->baseEffect->GetFullName());
                    effectJson["magnitude"] = effect->effectItem.magnitude;
                    effectJson["duration"] = effect->effectItem.duration;
                    effectJson["area"] = effect->effectItem.area;

                    const char* description = effect->baseEffect->magicItemDescription.c_str();
                    if (description && strlen(description) > 0) {
                        effectJson["description"] = SanitizeToUTF8(description);
                    }
                    effectsArray.push_back(effectJson);
                }
                spellJson["effects"] = effectsArray;
            } else if (fields.effectNames) {
                json effectNamesArray = json::array();
                for (auto* effect : spell->effects) {
                    if (effect && effect->baseEffect) {
                        effectNamesArray.push_back(SanitizeToUTF8(effect->baseEffect->GetFullName()));
                    }
                }
                spellJson["effectNames"] = effectNamesArray;
            }

            // Keywords
            if (fields.keywords && spell->keywords) {
                json keywordsArray = json::array();
                for (uint32_t i = 0; i < spell->numKeywords; i++) {
                    if (spell->keywords[i]) {
                        const char* kwEditorId = spell->keywords[i]->GetFormEditorID();
                        if (kwEditorId && strlen(kwEditorId) > 0) {
                            keywordsArray.push_back(kwEditorId);
                        }
                    }
                }
                spellJson["keywords"] = keywordsArray;
            }

            spellArray.push_back(spellJson);
            scannedCount++;
        }

        // Check if any spells had EditorIDs (diagnostic for SE 1.5.97 compatibility)
        int editorIdCount = 0;
        for (const auto& s : spellArray) {
            if (s.contains("editorId") && !s["editorId"].get<std::string>().empty()) {
                editorIdCount++;
            }
        }
        
        logger::info("SpellScanner: Scanned {} spells, skipped {} (type:{}, noName:{}, noSchool:{}), filtered {}", 
                     scannedCount, skippedCount, skipType, skipNoName, skipNoSchool, filteredCount);
        if (scannedCount > 0 && editorIdCount == 0) {
            logger::warn("SpellScanner: No EditorIDs available — SE 1.5.97 without po3 Tweaks? Name-based filtering active.");
        } else if (scannedCount > 0) {
            logger::info("SpellScanner: EditorIDs available for {}/{} spells", editorIdCount, scannedCount);
        }
        return spellArray;
    }

    // =============================================================================
    // MAIN SCAN FUNCTIONS
    // =============================================================================

    std::string ScanAllSpells(const ScanConfig& config)
    {
        logger::info("SpellScanner: Starting spell scan with ScanConfig...");

        json spellArray = ScanSpellsToJson(config.fields);

        // Build timestamp
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        std::tm tmBuf{};
        gmtime_s(&tmBuf, &time);
        std::stringstream ss;
        ss << std::put_time(&tmBuf, "%Y-%m-%dT%H:%M:%SZ");

        // Build output JSON
        json output;
        output["scanTimestamp"] = ss.str();
        output["spellCount"] = spellArray.size();
        output["spells"] = spellArray;

        // Combine prompts: User's tree rules + System instructions + Spell data
        std::string combinedPrompt;
        
        // Add user's tree rules prompt (visible/editable)
        if (!config.treeRulesPrompt.empty()) {
            combinedPrompt += "## TREE CREATION RULES\n\n";
            combinedPrompt += config.treeRulesPrompt;
            combinedPrompt += "\n\n";
        }
        
        // Add system instructions (hidden from user)
        combinedPrompt += GetSystemInstructions();

        output["llmPrompt"] = SanitizeToUTF8(combinedPrompt);  // Sanitize user prompt for valid UTF-8 JSON

        return output.dump(2);
    }

    std::string ScanAllSpells(const FieldConfig& config)
    {
        // Legacy function - create ScanConfig with empty tree rules
        ScanConfig scanConfig;
        scanConfig.fields = config;
        scanConfig.treeRulesPrompt = "";
        
        return ScanAllSpells(scanConfig);
    }

    // =============================================================================
    // SCAN SPELL TOMES (Avoids duplicates - only learnable spells)
    // =============================================================================

    std::string ScanSpellTomes(const ScanConfig& config)
    {
        logger::info("SpellScanner: Starting spell TOME scan...");

        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) {
            logger::error("SpellScanner: Failed to get TESDataHandler");
            return "{}";
        }

        const auto& allBooks = dataHandler->GetFormArray<RE::TESObjectBOOK>();
        logger::info("SpellScanner: Found {} total book forms", allBooks.size());

        json spellArray = json::array();
        std::set<RE::FormID> seenSpellIds;  // Track unique spells
        int tomeCount = 0;
        int skippedDuplicates = 0;
        const FieldConfig& fields = config.fields;

        for (auto* book : allBooks) {
            if (!book) continue;

            // Check if this book teaches a spell
            if (!book->TeachesSpell()) continue;

            RE::SpellItem* spell = book->GetSpell();
            if (!spell) continue;

            // Skip if we've already seen this spell
            RE::FormID spellFormId = spell->GetFormID();
            if (seenSpellIds.count(spellFormId) > 0) {
                skippedDuplicates++;
                continue;
            }
            seenSpellIds.insert(spellFormId);

            // Get spell info
            const char* spellEditorId = spell->GetFormEditorID();
            std::string spellName = spell->GetFullName();

            if (spellName.empty()) continue;

            // Get school from first effect
            RE::ActorValue school = RE::ActorValue::kNone;

            if (spell->effects.size() > 0) {
                auto* firstEffect = spell->effects[0];
                if (firstEffect && firstEffect->baseEffect) {
                    school = firstEffect->baseEffect->GetMagickSkill();
                }
            }

            // Skip non-magic spells (only allow the 5 vanilla schools)
            if (!IsValidMagicSchool(school)) continue;

            // Build spell JSON (same format as ScanSpellsToJson)
            json spellJson;

            // Essential fields (always included)
            spellJson["formId"] = std::format("0x{:08X}", spellFormId);
            spellJson["persistentId"] = GetPersistentFormId(spellFormId);  // Load order resilient ID
            spellJson["name"] = SanitizeToUTF8(spellName);  // Sanitize for valid UTF-8 JSON
            spellJson["school"] = GetSchoolName(school);
            spellJson["skillLevel"] = DetermineSpellTier(spell);

            // Also include tome info for reference (sanitize - mods like DynDOLOD can have invalid UTF-8 in book names)
            spellJson["tomeFormId"] = std::format("0x{:08X}", book->GetFormID());
            spellJson["tomeName"] = SanitizeToUTF8(book->GetFullName());

            // Optional fields
            if (fields.editorId && spellEditorId) {
                spellJson["editorId"] = spellEditorId;
            } else if (fields.editorId) {
                spellJson["editorId"] = "";
            }
            if (fields.magickaCost) {
                spellJson["magickaCost"] = spell->CalculateMagickaCost(nullptr);
            }
            if (fields.minimumSkill) {
                uint32_t minSkill = 0;
                if (spell->effects.size() > 0 && spell->effects[0] && spell->effects[0]->baseEffect) {
                    minSkill = spell->effects[0]->baseEffect->GetMinimumSkillLevel();
                }
                spellJson["minimumSkill"] = minSkill;
            }
            if (fields.castingType) {
                spellJson["castingType"] = GetCastingTypeName(spell->data.castingType);
            }
            if (fields.delivery) {
                spellJson["delivery"] = GetDeliveryName(spell->data.delivery);
            }
            if (fields.chargeTime) {
                spellJson["chargeTime"] = spell->data.chargeTime;
            }
            if (fields.plugin) {
                spellJson["plugin"] = GetPluginName(spellFormId);
            }

            // Effects
            if (fields.effects) {
                json effectsArray = json::array();
                for (auto* effect : spell->effects) {
                    if (!effect || !effect->baseEffect) continue;

                    json effectJson;
                    effectJson["name"] = SanitizeToUTF8(effect->baseEffect->GetFullName());
                    effectJson["magnitude"] = effect->effectItem.magnitude;
                    effectJson["duration"] = effect->effectItem.duration;
                    effectJson["area"] = effect->effectItem.area;

                    const char* description = effect->baseEffect->magicItemDescription.c_str();
                    if (description && strlen(description) > 0) {
                        effectJson["description"] = SanitizeToUTF8(description);
                    }
                    effectsArray.push_back(effectJson);
                }
                spellJson["effects"] = effectsArray;
            } else if (fields.effectNames) {
                json effectNamesArray = json::array();
                for (auto* effect : spell->effects) {
                    if (effect && effect->baseEffect) {
                        effectNamesArray.push_back(SanitizeToUTF8(effect->baseEffect->GetFullName()));
                    }
                }
                spellJson["effectNames"] = effectNamesArray;
            }

            // Keywords
            if (fields.keywords && spell->keywords) {
                json keywordsArray = json::array();
                for (uint32_t i = 0; i < spell->numKeywords; i++) {
                    if (spell->keywords[i]) {
                        const char* kwEditorId = spell->keywords[i]->GetFormEditorID();
                        if (kwEditorId && strlen(kwEditorId) > 0) {
                            keywordsArray.push_back(kwEditorId);
                        }
                    }
                }
                spellJson["keywords"] = keywordsArray;
            }

            spellArray.push_back(spellJson);
            tomeCount++;
        }

        logger::info("SpellScanner: Found {} unique spells from tomes, skipped {} duplicates", 
                     tomeCount, skippedDuplicates);

        // Build timestamp
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        std::tm tmBuf{};
        gmtime_s(&tmBuf, &time);
        std::stringstream ss;
        ss << std::put_time(&tmBuf, "%Y-%m-%dT%H:%M:%SZ");

        // Build output JSON
        json output;
        output["scanTimestamp"] = ss.str();
        output["scanMode"] = "spell_tomes";
        output["spellCount"] = spellArray.size();
        output["spells"] = spellArray;

        // Combine prompts
        std::string combinedPrompt;
        if (!config.treeRulesPrompt.empty()) {
            combinedPrompt += "## TREE CREATION RULES\n\n";
            combinedPrompt += config.treeRulesPrompt;
            combinedPrompt += "\n\n";
        }
        combinedPrompt += GetSystemInstructions();
        output["llmPrompt"] = SanitizeToUTF8(combinedPrompt);  // Sanitize user prompt for valid UTF-8 JSON

        return output.dump(2);
    }

    // =============================================================================
    // GET SPELL INFO BY FORMID (For Tree Viewer)
    // =============================================================================

    std::string GetSpellInfoByFormId(const std::string& formIdStr)
    {
        // Parse formId from hex string (e.g., "0x00012FCC" or "00012FCC")
        RE::FormID formId = 0;
        try {
            std::string cleanId = formIdStr;
            if (cleanId.length() >= 2 && (cleanId.substr(0, 2) == "0x" || cleanId.substr(0, 2) == "0X")) {
                cleanId = cleanId.substr(2);
            }
            
            // Validate: FormIDs should be max 8 hex characters
            if (cleanId.length() > 8) {
                logger::warn("SpellScanner: FormId too long ({}), truncating: {}", cleanId.length(), formIdStr);
                cleanId = cleanId.substr(0, 8);  // Truncate to 8 chars
            }
            
            // Validate hex characters only
            for (char c : cleanId) {
                if (!std::isxdigit(static_cast<unsigned char>(c))) {
                    logger::error("SpellScanner: Invalid hex character in formId: {}", formIdStr);
                    return "";
                }
            }
            
            formId = std::stoul(cleanId, nullptr, 16);
        } catch (const std::exception& e) {
            logger::error("SpellScanner: Invalid formId format: {} ({})", formIdStr, e.what());
            return "";
        }

        // Look up the spell form
        auto* form = RE::TESForm::LookupByID(formId);
        if (!form) {
            logger::warn("SpellScanner: Form not found for ID: {} (parsed: 0x{:08X})", formIdStr, formId);
            return "";
        }

        auto* spell = form->As<RE::SpellItem>();
        if (!spell) {
            logger::warn("SpellScanner: Form {} is not a spell", formIdStr);
            return "";
        }

        // Build spell info JSON
        json spellInfo;
        spellInfo["formId"] = formIdStr;
        spellInfo["name"] = SanitizeToUTF8(spell->GetFullName());  // Sanitize for valid UTF-8 JSON
        
        const char* editorId = spell->GetFormEditorID();
        spellInfo["editorId"] = editorId ? editorId : "";

        // Get school and level
        std::string school = "Unknown";
        uint32_t minimumSkill = 0;

        if (spell->effects.size() > 0) {
            auto* firstEffect = spell->effects[0];
            if (firstEffect && firstEffect->baseEffect) {
                RE::ActorValue schoolAV = firstEffect->baseEffect->GetMagickSkill();
                school = GetSchoolName(schoolAV);
                minimumSkill = firstEffect->baseEffect->GetMinimumSkillLevel();
            }
        }

        // Use perk-based tier detection (fixes modded master spells with minimumSkill=0)
        std::string level = DetermineSpellTier(spell);

        spellInfo["school"] = school;
        spellInfo["level"] = level;
        spellInfo["skillLevel"] = level;  // Alias
        spellInfo["minimumSkill"] = minimumSkill;
        
        spellInfo["cost"] = spell->CalculateMagickaCost(nullptr);
        spellInfo["magickaCost"] = spellInfo["cost"];  // Alias
        
        spellInfo["type"] = GetCastingTypeName(spell->data.castingType);
        spellInfo["castingType"] = spellInfo["type"];  // Alias
        
        spellInfo["delivery"] = GetDeliveryName(spell->data.delivery);
        spellInfo["chargeTime"] = spell->data.chargeTime;
        spellInfo["plugin"] = GetPluginName(formId);

        // Effects
        json effectsArray = json::array();
        json effectNamesArray = json::array();
        std::string description;

        for (auto* effect : spell->effects) {
            if (!effect || !effect->baseEffect) continue;

            std::string effectName = SanitizeToUTF8(effect->baseEffect->GetFullName());
            effectNamesArray.push_back(effectName);

            json effectJson;
            effectJson["name"] = effectName;
            effectJson["magnitude"] = effect->effectItem.magnitude;
            effectJson["duration"] = effect->effectItem.duration;
            effectJson["area"] = effect->effectItem.area;

            const char* desc = effect->baseEffect->magicItemDescription.c_str();
            if (desc && strlen(desc) > 0) {
                std::string descSanitized = SanitizeToUTF8(desc);
                effectJson["description"] = descSanitized;
                if (description.empty()) {
                    description = descSanitized;  // Use first effect's description as spell description
                }
            }
            effectsArray.push_back(effectJson);
        }

        spellInfo["effects"] = effectsArray;
        spellInfo["effectNames"] = effectNamesArray;
        spellInfo["description"] = description;
        
        // Add effectiveness info for early-learned spells
        auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
        if (effectivenessHook && effectivenessHook->IsEarlyLearnedSpell(formId)) {
            float effectiveness = effectivenessHook->CalculateEffectiveness(formId);
            spellInfo["isWeakened"] = true;
            spellInfo["effectiveness"] = static_cast<int>(effectiveness * 100);  // As percentage
            
            // Add scaled effect values
            json scaledEffectsArray = json::array();
            for (auto* effect : spell->effects) {
                if (!effect || !effect->baseEffect) continue;
                
                json scaledEffect;
                scaledEffect["name"] = SanitizeToUTF8(effect->baseEffect->GetFullName());
                scaledEffect["originalMagnitude"] = effect->effectItem.magnitude;
                scaledEffect["scaledMagnitude"] = static_cast<int>(effect->effectItem.magnitude * effectiveness);
                scaledEffect["duration"] = effect->effectItem.duration;
                scaledEffectsArray.push_back(scaledEffect);
            }
            spellInfo["scaledEffects"] = scaledEffectsArray;
        } else {
            spellInfo["isWeakened"] = false;
            spellInfo["effectiveness"] = 100;
        }

        return spellInfo.dump();
    }
}
