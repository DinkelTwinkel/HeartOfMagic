// =============================================================================
// ProgressionManagerCore.cpp — Singleton, utility helpers, progress reset
// =============================================================================

#include "ProgressionManager.h"
#include "EncodingUtils.h"
#include "SKSE/SKSE.h"

ProgressionManager* ProgressionManager::GetSingleton()
{
    static ProgressionManager singleton;
    return &singleton;
}

std::filesystem::path ProgressionManager::GetProgressFilePath() const
{
    if (m_currentSaveName.empty()) {
        logger::warn("ProgressionManager: Save name is empty, using fallback filename");
    }
    std::string safeName = EncodingUtils::SanitizeFilename(m_currentSaveName);
    // Defense-in-depth: reject if sanitized name still contains ".."
    if (safeName.find("..") != std::string::npos) {
        logger::error("ProgressionManager: Rejected suspicious save name: {}", m_currentSaveName);
        safeName = "_unnamed";
    }
    std::string filename = "progress_" + safeName + ".json";
    return std::filesystem::path("Data/SKSE/Plugins/SpellLearning") / filename;
}

// =============================================================================
// MOD EVENT HELPER
// =============================================================================

void ProgressionManager::SendModEvent(const char* eventName, const std::string& strArg, float numArg, RE::TESForm* sender)
{
    auto* eventSource = SKSE::GetModCallbackEventSource();
    if (!eventSource) {
        logger::warn("ProgressionManager: Cannot send ModEvent '{}' - event source not available", eventName);
        return;
    }
    SKSE::ModCallbackEvent modEvent(eventName, RE::BSFixedString(strArg.c_str()), numArg, sender);
    eventSource->SendEvent(&modEvent);
    logger::trace("ProgressionManager: Sent ModEvent '{}' (str={}, num={:.1f})", eventName, strArg, numArg);
}

// =============================================================================
// PROGRESS RESET
// =============================================================================

void ProgressionManager::ClearAllProgress()
{
    logger::info("ProgressionManager: Clearing all progress data");
    m_learningTargets.clear();
    m_spellProgress.clear();
    m_targetPrerequisites.clear();
    ClearAllTreePrerequisites();  // clears m_prereqRequirements
    m_dirty = false;
}
