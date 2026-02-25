#include "Common.h"
#include "uimanager/UIManager.h"
#include "ProgressionManager.h"
#include "SpellEffectivenessHook.h"
#include "ThreadUtils.h"

// =============================================================================
// PROGRESSION SYSTEM CALLBACKS
// =============================================================================

void UIManager::OnSetLearningTarget(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SetLearningTarget - no data provided");
        return;
    }

    logger::info("UIManager: SetLearningTarget: {}", argument);

    std::string argStr(argument);

    AddTaskToGameThread("SetLearningTarget", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        try {
            json request = json::parse(argStr);
            std::string school = request.value("school", "");
            std::string formIdStr = request.value("formId", "");

            if (school.empty() || formIdStr.empty()) {
                logger::warn("UIManager: SetLearningTarget - missing school or formId");
                return;
            }

            // Parse formId (handle 0x prefix)
            RE::FormID formId = std::stoul(formIdStr, nullptr, 0);

            // Parse prerequisites array if provided
            std::vector<RE::FormID> prereqs;
            if (request.contains("prerequisites") && request["prerequisites"].is_array()) {
                for (const auto& prereqJson : request["prerequisites"]) {
                    std::string prereqStr = prereqJson.get<std::string>();
                    RE::FormID prereqId = std::stoul(prereqStr, nullptr, 0);
                    if (prereqId != 0) {
                        prereqs.push_back(prereqId);
                    }
                }
                logger::info("UIManager: Received {} direct prerequisites for {:08X}", prereqs.size(), formId);
            }

            auto* pm = ProgressionManager::GetSingleton();
            pm->SetLearningTarget(school, formId, prereqs);

            // Set requiredXP from tree data if provided (syncs JS tree XP to C++)
            if (request.contains("requiredXP") && request["requiredXP"].is_number()) {
                float requiredXP = request["requiredXP"].get<float>();
                if (requiredXP > 0) {
                    pm->SetRequiredXP(formId, requiredXP);
                    logger::info("UIManager: Set requiredXP for {:08X} to {:.0f} (from tree)", formId, requiredXP);
                }
            }

            // Notify UI
            json response;
            response["success"] = true;
            response["school"] = school;
            response["formId"] = formIdStr;
            instance->m_prismaUI->InteropCall(instance->m_view, "onLearningTargetSet", response.dump().c_str());

            // Update spell state to "learning" so canvas renderer shows learning visuals
            instance->UpdateSpellState(formIdStr, "learning");

        } catch (const std::exception& e) {
            logger::error("UIManager: SetLearningTarget exception: {}", e.what());
        }
    });
}

void UIManager::OnClearLearningTarget(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        return;
    }

    logger::info("UIManager: ClearLearningTarget: {}", argument);

    std::string argStr(argument);

    AddTaskToGameThread("ClearLearningTarget", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        try {
            json request = json::parse(argStr);
            std::string school = request.value("school", "");

            if (!school.empty()) {
                // Get the current learning target formId BEFORE clearing
                RE::FormID targetId = ProgressionManager::GetSingleton()->GetLearningTarget(school);

                ProgressionManager::GetSingleton()->ClearLearningTarget(school);

                // Update UI to show spell is no longer in learning state
                if (targetId != 0) {
                    std::stringstream ss;
                    ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << targetId;
                    instance->UpdateSpellState(ss.str(), "available");
                    logger::info("UIManager: Cleared learning target {} - set to available", ss.str());
                }
            }
        } catch (const std::exception& e) {
            logger::error("UIManager: ClearLearningTarget exception: {}", e.what());
        }
    });
}

void UIManager::OnUnlockSpell(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: UnlockSpell - no formId provided");
        return;
    }

    logger::info("UIManager: UnlockSpell: {}", argument);

    std::string argStr(argument);

    AddTaskToGameThread("UnlockSpell", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        try {
            json request = json::parse(argStr);
            std::string formIdStr = request.value("formId", "");

            if (formIdStr.empty()) {
                logger::warn("UIManager: UnlockSpell - no formId");
                return;
            }

            RE::FormID formId = std::stoul(formIdStr, nullptr, 0);

            bool success = ProgressionManager::GetSingleton()->UnlockSpell(formId);

            instance->NotifySpellUnlocked(formId, success);

            if (success) {
                instance->UpdateSpellState(formIdStr, "unlocked");
            }

        } catch (const std::exception& e) {
            logger::error("UIManager: UnlockSpell exception: {}", e.what());
        }
    });
}

void UIManager::OnGetProgress([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: GetProgress requested");

    AddTaskToGameThread("GetProgress", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        std::string progressJson = ProgressionManager::GetSingleton()->GetProgressJSON();
        instance->SendProgressData(progressJson);
    });
}

void UIManager::OnGetPlayerKnownSpells([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: GetPlayerKnownSpells requested");

    AddTaskToGameThread("GetPlayerKnownSpells", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        auto* player = RE::PlayerCharacter::GetSingleton();

        if (!player) {
            logger::error("UIManager: Cannot get player spells - player not found");
            return;
        }

        json result;
        json knownSpells = json::array();
        json weakenedSpells = json::array();  // Track which spells are early-learned/weakened
        std::set<RE::FormID> foundSpells;  // Track to avoid duplicates

        // Get effectiveness hook for checking weakened state
        auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();

        // Helper lambda to check if a spell is a valid combat spell (not ability/passive)
        auto isValidCombatSpell = [](RE::SpellItem* spell) -> bool {
            if (!spell) return false;

            // Filter by spell type - only include actual spells, not abilities/powers/etc
            auto spellType = spell->GetSpellType();
            if (spellType != RE::MagicSystem::SpellType::kSpell) {
                return false;
            }

            // Must have a casting type (not constant effect)
            auto castType = spell->GetCastingType();
            if (castType == RE::MagicSystem::CastingType::kConstantEffect) {
                return false;
            }

            // Must have a magicka cost (filters out free abilities)
            auto* costEffect = spell->GetCostliestEffectItem();
            if (!costEffect || !costEffect->baseEffect) {
                return false;
            }

            // Check it's from a magic school
            auto school = costEffect->baseEffect->GetMagickSkill();
            if (school != RE::ActorValue::kAlteration &&
                school != RE::ActorValue::kConjuration &&
                school != RE::ActorValue::kDestruction &&
                school != RE::ActorValue::kIllusion &&
                school != RE::ActorValue::kRestoration) {
                return false;
            }

            return true;
        };

        // Get the player's spell list from ActorBase
        auto* actorBase = player->GetActorBase();
        if (actorBase) {
            auto* spellList = actorBase->GetSpellList();
            if (spellList && spellList->spells) {
                for (uint32_t i = 0; i < spellList->numSpells; ++i) {
                    auto* spell = spellList->spells[i];
                    if (spell && foundSpells.find(spell->GetFormID()) == foundSpells.end()) {
                        if (isValidCombatSpell(spell)) {
                            std::stringstream ss;
                            ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << spell->GetFormID();
                            knownSpells.push_back(ss.str());
                            foundSpells.insert(spell->GetFormID());

                            // Check if this spell is weakened (early-learned)
                            if (effectivenessHook && effectivenessHook->IsEarlyLearnedSpell(spell->GetFormID())) {
                                weakenedSpells.push_back(ss.str());
                                logger::info("UIManager: Player knows spell: {} ({}) [WEAKENED]", spell->GetName(), ss.str());
                            } else {
                                logger::info("UIManager: Player knows spell: {} ({})", spell->GetName(), ss.str());
                            }
                        } else {
                            logger::trace("UIManager: Skipping non-combat spell/ability: {} ({:08X})",
                                spell->GetName(), spell->GetFormID());
                        }
                    }
                }
            }
        }

        // Also check spells added at runtime via AddSpell
        for (auto* spell : player->GetActorRuntimeData().addedSpells) {
            if (spell && foundSpells.find(spell->GetFormID()) == foundSpells.end()) {
                if (isValidCombatSpell(spell)) {
                    std::stringstream ss;
                    ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << spell->GetFormID();
                    knownSpells.push_back(ss.str());
                    foundSpells.insert(spell->GetFormID());

                    // Check if this spell is weakened (early-learned)
                    if (effectivenessHook && effectivenessHook->IsEarlyLearnedSpell(spell->GetFormID())) {
                        weakenedSpells.push_back(ss.str());
                        logger::info("UIManager: Player added spell: {} ({}) [WEAKENED]", spell->GetName(), ss.str());
                    } else {
                        logger::info("UIManager: Player added spell: {} ({})", spell->GetName(), ss.str());
                    }
                }
            }
        }

        result["knownSpells"] = knownSpells;
        result["weakenedSpells"] = weakenedSpells;  // Include list of early-learned spells
        result["count"] = knownSpells.size();

        logger::info("UIManager: Found {} valid combat spells", knownSpells.size());
        instance->m_prismaUI->InteropCall(instance->m_view, "onPlayerKnownSpells", result.dump().c_str());
    });
}

void UIManager::OnCheatUnlockSpell(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: CheatUnlockSpell - no formId provided");
        return;
    }

    logger::info("UIManager: CheatUnlockSpell (cheat mode): {}", argument);

    std::string argStr(argument);

    AddTaskToGameThread("CheatUnlockSpell", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        try {
            json request = json::parse(argStr);
            std::string formIdStr = request.value("formId", "");

            if (formIdStr.empty()) {
                logger::warn("UIManager: CheatUnlockSpell - no formId");
                return;
            }

            RE::FormID formId = std::stoul(formIdStr, nullptr, 0);

            // Get player and spell
            auto* player = RE::PlayerCharacter::GetSingleton();
            auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(formId);

            if (!player || !spell) {
                logger::error("UIManager: CheatUnlockSpell - failed to get player or spell {:08X}", formId);
                return;
            }

            // Add spell to player (cheat - no XP required)
            player->AddSpell(spell);

            logger::info("UIManager: Cheat unlocked spell {} ({:08X})", spell->GetName(), formId);

            instance->NotifySpellUnlocked(formId, true);
            instance->UpdateSpellState(formIdStr, "unlocked");

        } catch (const std::exception& e) {
            logger::error("UIManager: CheatUnlockSpell exception: {}", e.what());
        }
    });
}

void UIManager::OnRelockSpell(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: RelockSpell - no formId provided");
        return;
    }

    logger::info("UIManager: RelockSpell (cheat mode): {}", argument);

    std::string argStr(argument);

    AddTaskToGameThread("RelockSpell", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        try {
            json request = json::parse(argStr);
            std::string formIdStr = request.value("formId", "");

            if (formIdStr.empty()) {
                logger::warn("UIManager: RelockSpell - no formId");
                return;
            }

            RE::FormID formId = std::stoul(formIdStr, nullptr, 0);

            // Get player and spell
            auto* player = RE::PlayerCharacter::GetSingleton();
            auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(formId);

            if (!player || !spell) {
                logger::error("UIManager: RelockSpell - failed to get player or spell {:08X}", formId);
                return;
            }

            // Remove spell from player
            player->RemoveSpell(spell);

            logger::info("UIManager: Relocked spell {} ({:08X})", spell->GetName(), formId);

            // Notify UI that spell was relocked
            json notify;
            std::stringstream ss;
            ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
            notify["formId"] = ss.str();
            notify["success"] = true;
            notify["relocked"] = true;

            instance->m_prismaUI->InteropCall(instance->m_view, "onSpellRelocked", notify.dump().c_str());
            instance->UpdateSpellState(formIdStr, "available");

        } catch (const std::exception& e) {
            logger::error("UIManager: RelockSpell exception: {}", e.what());
        }
    });
}

void UIManager::OnSetSpellXP(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SetSpellXP - no data provided");
        return;
    }

    std::string argStr(argument);
    logger::info("UIManager: SetSpellXP (cheat mode): {}", argStr);

    AddTaskToGameThread("SetSpellXP", [argStr]() {
        try {
            json request = json::parse(argStr);
            std::string formIdStr = request.value("formId", "");
            float xp = request.value("xp", 0.0f);

            if (formIdStr.empty()) {
                logger::warn("UIManager: SetSpellXP - no formId");
                return;
            }

            RE::FormID formId = std::stoul(formIdStr, nullptr, 0);
            if (formId == 0) {
                logger::warn("UIManager: SetSpellXP - formId resolved to 0 for '{}', ignoring", formIdStr);
                return;
            }

            auto* progressionMgr = ProgressionManager::GetSingleton();
            if (progressionMgr) {
                progressionMgr->SetSpellXP(formId, xp);
                logger::info("UIManager: Set XP for spell {:08X} to {:.0f}", formId, xp);
            }
        } catch (const std::exception& e) {
            logger::error("UIManager: SetSpellXP exception: {}", e.what());
        }
    });
}

void UIManager::OnSetTreePrerequisites(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SetTreePrerequisites - no data provided");
        return;
    }

    std::string argStr(argument);
    logger::info("UIManager: SetTreePrerequisites called");

    AddTaskToGameThread("SetTreePrerequisites", [argStr]() {
        try {
            json request = json::parse(argStr);

            // Check if this is a clear command
            if (request.contains("clear") && request["clear"].get<bool>()) {
                ProgressionManager::GetSingleton()->ClearAllTreePrerequisites();
                logger::info("UIManager: Cleared all tree prerequisites");
                return;
            }

            // Otherwise, expect an array of spell prerequisites
            // Format: [{ "formId": "0x...", "prereqs": ["0x...", "0x..."] }, ...]
            if (!request.is_array()) {
                logger::error("UIManager: SetTreePrerequisites - expected array");
                return;
            }

            auto* pm = ProgressionManager::GetSingleton();
            if (!pm) {
                logger::error("UIManager: SetTreePrerequisites - ProgressionManager not available");
                return;
            }
            int count = 0;

            for (const auto& entry : request) {
                if (!entry.is_object()) {
                    logger::warn("UIManager: SetTreePrerequisites - non-object entry in array, skipping");
                    continue;
                }

                std::string formIdStr = entry.value("formId", "");
                if (formIdStr.empty()) continue;

                RE::FormID formId = 0;
                try {
                    formId = std::stoul(formIdStr, nullptr, 0);
                } catch (...) {
                    logger::warn("UIManager: Could not parse formId '{}' - skipping", formIdStr);
                    continue;
                }

                if (formId == 0) {
                    logger::warn("UIManager: SetTreePrerequisites - formId resolved to 0 for '{}', skipping", formIdStr);
                    continue;
                }

                // Parse hard/soft prerequisites (new unified system)
                ProgressionManager::PrereqRequirements reqs;

                // Parse hard prerequisites (must have ALL)
                if (entry.contains("hardPrereqs") && entry["hardPrereqs"].is_array()) {
                    for (const auto& prereqStr : entry["hardPrereqs"]) {
                        if (prereqStr.is_string()) {
                            try {
                                RE::FormID prereqId = std::stoul(prereqStr.get<std::string>(), nullptr, 0);
                                reqs.hardPrereqs.push_back(prereqId);
                            } catch (...) {
                                logger::warn("UIManager: Could not parse hardPrereq '{}' for spell {:08X}",
                                    prereqStr.get<std::string>(), formId);
                            }
                        }
                    }
                }

                // Parse soft prerequisites (need X of these)
                if (entry.contains("softPrereqs") && entry["softPrereqs"].is_array()) {
                    for (const auto& prereqStr : entry["softPrereqs"]) {
                        if (prereqStr.is_string()) {
                            try {
                                RE::FormID prereqId = std::stoul(prereqStr.get<std::string>(), nullptr, 0);
                                reqs.softPrereqs.push_back(prereqId);
                            } catch (...) {
                                logger::warn("UIManager: Could not parse softPrereq '{}' for spell {:08X}",
                                    prereqStr.get<std::string>(), formId);
                            }
                        }
                    }
                }

                // Parse softNeeded count
                reqs.softNeeded = entry.value("softNeeded", 0);

                // Legacy fallback: parse old "prereqs" field as all hard
                if (reqs.hardPrereqs.empty() && reqs.softPrereqs.empty() &&
                    entry.contains("prereqs") && entry["prereqs"].is_array()) {
                    for (const auto& prereqStr : entry["prereqs"]) {
                        if (prereqStr.is_string()) {
                            try {
                                RE::FormID prereqId = std::stoul(prereqStr.get<std::string>(), nullptr, 0);
                                reqs.hardPrereqs.push_back(prereqId);
                            } catch (const std::exception& e) {
                                logger::warn("UIManager: Failed to parse prereq formId: {}", e.what());
                            } catch (...) {
                                logger::warn("UIManager: Failed to parse prereq formId (unknown error)");
                            }
                        }
                    }
                }

                // Log spells with prerequisites for debugging
                if (!reqs.hardPrereqs.empty() || !reqs.softPrereqs.empty()) {
                    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(formId);
                    logger::info("UIManager: Setting prereqs for {:08X} '{}': {} hard, {} soft (need {})",
                        formId, spell ? spell->GetName() : "UNKNOWN",
                        reqs.hardPrereqs.size(), reqs.softPrereqs.size(), reqs.softNeeded);
                }

                pm->SetPrereqRequirements(formId, reqs);
                count++;
            }

            logger::info("UIManager: Set tree prerequisites for {} spells", count);

        } catch (const std::exception& e) {
            logger::error("UIManager: SetTreePrerequisites exception: {}", e.what());
        }
    });
}
