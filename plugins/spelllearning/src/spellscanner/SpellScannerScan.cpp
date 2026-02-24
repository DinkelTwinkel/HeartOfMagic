#include "Common.h"
#include "SpellScanner.h"
#include "SpellEffectivenessHook.h"

namespace SpellScanner
{
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
                logger::error("SpellScanner: FormId too long ({} chars), rejecting: {}", cleanId.length(), formIdStr);
                return "";
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
