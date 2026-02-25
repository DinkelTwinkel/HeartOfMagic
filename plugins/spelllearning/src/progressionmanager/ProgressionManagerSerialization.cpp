// =============================================================================
// ProgressionManagerSerialization.cpp — SKSE co-save, legacy save/load, JSON
// =============================================================================

#include "ProgressionManager.h"
#include "SKSE/SKSE.h"
#include <fstream>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// =============================================================================
// SKSE CO-SAVE SERIALIZATION
// =============================================================================

void ProgressionManager::OnGameSaved(SKSE::SerializationInterface* a_intfc)
{
    logger::info("ProgressionManager: Saving to co-save...");

    // Write learning targets record
    if (!a_intfc->OpenRecord(kTargetsRecord, kSerializationVersion)) {
        logger::error("ProgressionManager: Failed to open targets record for writing");
        return;
    }

    // Write number of targets
    uint32_t numTargets = static_cast<uint32_t>(m_learningTargets.size());
    a_intfc->WriteRecordData(&numTargets, sizeof(numTargets));

    // Write each target: school string length, school string, formId
    for (auto& [school, formId] : m_learningTargets) {
        uint32_t schoolLen = static_cast<uint32_t>(school.length());
        a_intfc->WriteRecordData(&schoolLen, sizeof(schoolLen));
        a_intfc->WriteRecordData(school.c_str(), schoolLen);
        a_intfc->WriteRecordData(&formId, sizeof(formId));
    }

    logger::info("ProgressionManager: Saved {} learning targets", numTargets);

    // Write progress record
    if (!a_intfc->OpenRecord(kProgressRecord, kSerializationVersion)) {
        logger::error("ProgressionManager: Failed to open progress record for writing");
        return;
    }

    // Write number of progress entries
    uint32_t numProgress = static_cast<uint32_t>(m_spellProgress.size());
    a_intfc->WriteRecordData(&numProgress, sizeof(numProgress));

    // Write each progress: formId, progressPercent, unlocked, [v2: modded source XP]
    for (auto& [formId, progress] : m_spellProgress) {
        a_intfc->WriteRecordData(&formId, sizeof(formId));
        a_intfc->WriteRecordData(&progress.progressPercent, sizeof(progress.progressPercent));
        uint8_t unlocked = progress.unlocked ? 1 : 0;
        a_intfc->WriteRecordData(&unlocked, sizeof(unlocked));

        // v2: Write modded source XP tracking
        uint32_t moddedCount = static_cast<uint32_t>(progress.xpFromModded.size());
        a_intfc->WriteRecordData(&moddedCount, sizeof(moddedCount));
        for (auto& [name, xp] : progress.xpFromModded) {
            uint32_t nameLen = static_cast<uint32_t>(name.length());
            a_intfc->WriteRecordData(&nameLen, sizeof(nameLen));
            a_intfc->WriteRecordData(name.c_str(), nameLen);
            a_intfc->WriteRecordData(&xp, sizeof(xp));
        }
    }

    logger::info("ProgressionManager: Saved {} spell progress entries to co-save", numProgress);
    m_dirty = false;
}

void ProgressionManager::OnGameLoaded(SKSE::SerializationInterface* a_intfc)
{
    logger::info("ProgressionManager: Loading from co-save...");

    // Clear existing data first
    ClearAllProgress();

    uint32_t type, version, length;

    while (a_intfc->GetNextRecordInfo(type, version, length)) {
        if (version != kSerializationVersion && version != 1) {
            logger::warn("ProgressionManager: Skipping record with unsupported version (got {}, expected {} or 1)",
                version, kSerializationVersion);
            continue;
        }

        switch (type) {
            case kTargetsRecord: {
                // Read learning targets
                uint32_t numTargets = 0;
                if (!a_intfc->ReadRecordData(&numTargets, sizeof(numTargets))) {
                    logger::error("ProgressionManager: Failed to read numTargets");
                    break;
                }

                for (uint32_t i = 0; i < numTargets; ++i) {
                    uint32_t schoolLen = 0;
                    if (!a_intfc->ReadRecordData(&schoolLen, sizeof(schoolLen))) {
                        logger::error("ProgressionManager: Failed to read schoolLen at target {}", i);
                        break;
                    }
                    if (schoolLen > 4096) {
                        logger::error("ProgressionManager: schoolLen {} exceeds limit at target {}", schoolLen, i);
                        break;
                    }

                    std::string school(schoolLen, '\0');
                    if (!a_intfc->ReadRecordData(school.data(), schoolLen)) {
                        logger::error("ProgressionManager: Failed to read school string at target {}", i);
                        break;
                    }

                    RE::FormID formId = 0;
                    if (!a_intfc->ReadRecordData(&formId, sizeof(formId))) {
                        logger::error("ProgressionManager: Failed to read formId at target {}", i);
                        break;
                    }

                    // Resolve formId (handles load order changes)
                    RE::FormID resolvedId = 0;
                    if (a_intfc->ResolveFormID(formId, resolvedId)) {
                        m_learningTargets[school] = resolvedId;
                        logger::info("ProgressionManager: Loaded target {} -> {:08X}", school, resolvedId);
                    } else {
                        logger::warn("ProgressionManager: Failed to resolve target formId {:08X}", formId);
                    }
                }

                logger::info("ProgressionManager: Loaded {} learning targets", m_learningTargets.size());
                break;
            }

            case kProgressRecord: {
                // Read spell progress
                uint32_t numProgress = 0;
                if (!a_intfc->ReadRecordData(&numProgress, sizeof(numProgress))) {
                    logger::error("ProgressionManager: Failed to read numProgress");
                    break;
                }

                for (uint32_t i = 0; i < numProgress; ++i) {
                    RE::FormID formId = 0;
                    if (!a_intfc->ReadRecordData(&formId, sizeof(formId))) {
                        logger::error("ProgressionManager: Failed to read formId at progress entry {}", i);
                        break;
                    }

                    float progressPercent = 0.0f;
                    if (!a_intfc->ReadRecordData(&progressPercent, sizeof(progressPercent))) {
                        logger::error("ProgressionManager: Failed to read progressPercent at progress entry {}", i);
                        break;
                    }

                    uint8_t unlocked = 0;
                    if (!a_intfc->ReadRecordData(&unlocked, sizeof(unlocked))) {
                        logger::error("ProgressionManager: Failed to read unlocked at progress entry {}", i);
                        break;
                    }

                    // v2: Read modded source XP tracking
                    std::unordered_map<std::string, float> moddedXP;
                    if (version >= 2) {
                        uint32_t moddedCount = 0;
                        if (!a_intfc->ReadRecordData(&moddedCount, sizeof(moddedCount))) {
                            logger::error("ProgressionManager: Failed to read moddedCount at progress entry {}", i);
                            break;
                        }
                        if (moddedCount > 4096) {
                            logger::error("ProgressionManager: moddedCount {} exceeds limit at progress entry {}", moddedCount, i);
                            break;
                        }
                        for (uint32_t m = 0; m < moddedCount; ++m) {
                            uint32_t nameLen = 0;
                            if (!a_intfc->ReadRecordData(&nameLen, sizeof(nameLen))) {
                                logger::error("ProgressionManager: Failed to read nameLen at progress entry {}, modded {}", i, m);
                                break;
                            }
                            if (nameLen > 4096) {
                                logger::error("ProgressionManager: nameLen {} exceeds limit at progress entry {}, modded {}", nameLen, i, m);
                                break;
                            }
                            std::string name(nameLen, '\0');
                            if (!a_intfc->ReadRecordData(name.data(), nameLen)) {
                                logger::error("ProgressionManager: Failed to read name string at progress entry {}, modded {}", i, m);
                                break;
                            }
                            float xp = 0.0f;
                            if (!a_intfc->ReadRecordData(&xp, sizeof(xp))) {
                                logger::error("ProgressionManager: Failed to read xp at progress entry {}, modded {}", i, m);
                                break;
                            }
                            moddedXP[name] = xp;
                        }
                    }

                    // Resolve formId (handles load order changes)
                    RE::FormID resolvedId = 0;
                    if (a_intfc->ResolveFormID(formId, resolvedId)) {
                        SpellProgress progress;
                        progress.progressPercent = progressPercent;
                        progress.unlocked = unlocked != 0;
                        progress.xpFromModded = std::move(moddedXP);
                        // requiredXP will be set from tree data later
                        m_spellProgress[resolvedId] = progress;

                        logger::info("ProgressionManager: Loaded progress {:08X} -> {:.1f}% {} ({} modded sources)",
                            resolvedId, progressPercent * 100.0f, unlocked ? "(unlocked)" : "",
                            progress.xpFromModded.size());
                    } else {
                        logger::warn("ProgressionManager: Failed to resolve progress formId {:08X}", formId);
                    }
                }

                logger::info("ProgressionManager: Loaded {} spell progress entries", m_spellProgress.size());
                break;
            }

            default:
                logger::warn("ProgressionManager: Unknown record type: {}", type);
                break;
        }
    }

    logger::info("ProgressionManager: Co-save load complete");
}

void ProgressionManager::OnRevert(SKSE::SerializationInterface*)
{
    logger::info("ProgressionManager: Reverting (new game or load)");
    ClearAllProgress();
}

// =============================================================================
// LEGACY SAVE/LOAD (JSON files - kept for backwards compatibility)
// =============================================================================

void ProgressionManager::SetCurrentSave(const std::string& saveName)
{
    if (m_currentSaveName != saveName) {
        m_currentSaveName = saveName;
        logger::info("ProgressionManager: Save name set to '{}'", saveName);
    }
}

void ProgressionManager::LoadProgress(const std::string& saveName)
{
    // This is now a no-op - progress is loaded from co-save
    // Kept for backwards compatibility
    SetCurrentSave(saveName);
    logger::info("ProgressionManager: LoadProgress called (legacy) - using co-save data");
}

void ProgressionManager::SaveProgress()
{
    // This is now a no-op - progress is saved to co-save automatically
    // Kept for backwards compatibility
    logger::trace("ProgressionManager: SaveProgress called (legacy) - using co-save");
}

std::string ProgressionManager::GetProgressJSON() const
{
    json j;

    // Learning targets
    json targets = json::object();
    for (auto& [school, formId] : m_learningTargets) {
        std::stringstream ss;
        ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
        targets[school] = ss.str();
    }
    j["learningTargets"] = targets;

    // Spell progress
    json progress = json::object();
    for (auto& [formId, data] : m_spellProgress) {
        std::stringstream ss;
        ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
        std::string formIdStr = ss.str();

        float currentXP = data.GetCurrentXP();
        progress[formIdStr] = {
            {"xp", currentXP},
            {"required", data.requiredXP},
            {"progress", data.progressPercent},
            {"unlocked", data.unlocked},
            {"ready", !data.unlocked && data.progressPercent >= 1.0f}
        };
    }
    j["spellProgress"] = progress;

    return j.dump();
}
