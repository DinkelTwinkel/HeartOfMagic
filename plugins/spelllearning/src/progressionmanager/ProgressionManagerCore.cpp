// =============================================================================
// ProgressionManagerCore.cpp — Singleton, utility helpers, progress reset
// =============================================================================

#include "ProgressionManager.h"
#include "SKSE/SKSE.h"

ProgressionManager* ProgressionManager::GetSingleton()
{
    static ProgressionManager singleton;
    return &singleton;
}

std::filesystem::path ProgressionManager::GetProgressFilePath() const
{
    // Sanitize save name — strip path separators and special characters
    std::string safeName = m_currentSaveName;
    for (auto& c : safeName) {
        if (c == '/' || c == '\\' || c == ':' || c == '.' || c == '<' || c == '>' || c == '"' || c == '|' || c == '?' || c == '*') {
            c = '_';
        }
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
    m_dirty = false;
}
