#include "Common.h"
#include "uimanager/UIManager.h"
#include "ProgressionManager.h"

// =============================================================================
// SEND DATA TO SCANNER TAB
// =============================================================================

void UIManager::SendSpellData(const std::string& jsonData)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::error("UIManager: Cannot send spell data - not initialized");
        return;
    }

    logger::info("UIManager: Sending spell data to UI ({} bytes)", jsonData.size());
    m_prismaUI->InteropCall(m_view, "updateSpellData", jsonData.c_str());
}

void UIManager::UpdateStatus(const std::string& message)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    json statusJson = message;
    m_prismaUI->InteropCall(m_view, "updateStatus", statusJson.dump().c_str());
}

void UIManager::SendPrompt(const std::string& promptContent)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::error("UIManager: Cannot send prompt - not initialized");
        return;
    }

    logger::info("UIManager: Sending prompt to UI ({} bytes)", promptContent.size());
    m_prismaUI->InteropCall(m_view, "updatePrompt", promptContent.c_str());
}

void UIManager::NotifyPromptSaved(bool success)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    std::string result = success ? "true" : "false";
    m_prismaUI->InteropCall(m_view, "onPromptSaved", result.c_str());
}

// =============================================================================
// SEND DATA TO TREE TAB
// =============================================================================

void UIManager::SendTreeData(const std::string& jsonData)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::error("UIManager: Cannot send tree data - not initialized");
        return;
    }

    logger::info("UIManager: Sending tree data to UI ({} bytes)", jsonData.size());
    m_prismaUI->InteropCall(m_view, "updateTreeData", jsonData.c_str());
}

void UIManager::SendSpellInfo(const std::string& jsonData)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::error("UIManager: Cannot send spell info - not initialized");
        return;
    }

    m_prismaUI->InteropCall(m_view, "updateSpellInfo", jsonData.c_str());
}

void UIManager::SendSpellInfoBatch(const std::string& jsonData)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::error("UIManager: Cannot send spell info batch - not initialized");
        return;
    }

    logger::info("UIManager: Sending batch spell info to UI ({} bytes)", jsonData.size());
    m_prismaUI->InteropCall(m_view, "updateSpellInfoBatch", jsonData.c_str());
}

void UIManager::UpdateSpellState(const std::string& formId, const std::string& state)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    // Build JSON with both parameters
    json stateData;
    stateData["formId"] = formId;
    stateData["state"] = state;
    m_prismaUI->InteropCall(m_view, "updateSpellState", stateData.dump().c_str());
}

void UIManager::UpdateTreeStatus(const std::string& message)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    json statusJson = message;
    m_prismaUI->InteropCall(m_view, "updateTreeStatus", statusJson.dump().c_str());
}

// =============================================================================
// CLIPBOARD DATA SENDERS
// =============================================================================

void UIManager::SendClipboardContent(const std::string& content)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::error("UIManager: Cannot send clipboard content - not initialized");
        return;
    }

    logger::info("UIManager: Sending clipboard content to UI ({} bytes)", content.size());
    m_prismaUI->InteropCall(m_view, "onClipboardContent", content.c_str());
}

void UIManager::NotifyCopyComplete(bool success)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    std::string result = success ? "true" : "false";
    m_prismaUI->InteropCall(m_view, "onCopyComplete", result.c_str());
}

// =============================================================================
// PROGRESSION NOTIFICATIONS
// =============================================================================

void UIManager::NotifyProgressUpdate(RE::FormID formId, float currentXP, float requiredXP)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::warn("UIManager: Cannot notify progress - PrismaUI not valid");
        return;
    }

    // PERFORMANCE: Skip UI updates when panel is not visible
    // The UI will refresh when it becomes visible anyway
    if (!m_isPanelVisible) {
        return;
    }

    // Get the full progress info to include unlocked status
    auto progress = ProgressionManager::GetSingleton()->GetProgress(formId);

    json update;
    std::stringstream ss;
    ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
    update["formId"] = ss.str();
    update["currentXP"] = currentXP;
    update["requiredXP"] = requiredXP;
    update["progress"] = requiredXP > 0 ? (currentXP / requiredXP) : 0.0f;
    update["ready"] = currentXP >= requiredXP;
    update["unlocked"] = progress.unlocked;  // Include unlocked status

    // PERFORMANCE: Use trace for frequent progress updates
    logger::trace("UIManager: Sending progress update to UI - formId: {}, XP: {:.1f}/{:.1f}, unlocked: {}",
        ss.str(), currentXP, requiredXP, progress.unlocked);
    m_prismaUI->InteropCall(m_view, "onProgressUpdate", update.dump().c_str());
}

void UIManager::NotifyProgressUpdate(const std::string& formIdStr)
{
    // Get progress from ProgressionManager and send to UI
    RE::FormID formId = 0;
    try {
        formId = std::stoul(formIdStr, nullptr, 16);
    } catch (const std::exception& e) {
        logger::error("UIManager: Failed to parse formId '{}': {}", formIdStr, e.what());
        return;
    }

    auto progress = ProgressionManager::GetSingleton()->GetProgress(formId);
    NotifyProgressUpdate(formId, progress.GetCurrentXP(), progress.requiredXP);
}

void UIManager::NotifySpellReady(RE::FormID formId)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    // PERFORMANCE: Skip UI updates when panel is not visible
    if (!m_isPanelVisible) {
        return;
    }

    json notify;
    std::stringstream ss;
    ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
    notify["formId"] = ss.str();
    notify["ready"] = true;

    m_prismaUI->InteropCall(m_view, "onSpellReady", notify.dump().c_str());
}

void UIManager::NotifySpellUnlocked(RE::FormID formId, bool success)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    json notify;
    std::stringstream ss;
    ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
    notify["formId"] = ss.str();
    notify["success"] = success;

    m_prismaUI->InteropCall(m_view, "onSpellUnlocked", notify.dump().c_str());
}

void UIManager::NotifyLearningTargetSet(const std::string& school, RE::FormID formId, const std::string& spellName)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    json notify;
    std::stringstream ss;
    ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
    std::string formIdStr = ss.str();

    notify["school"] = school;
    notify["formId"] = formIdStr;
    notify["spellName"] = spellName;

    logger::info("UIManager: Notifying UI of learning target set: {} -> {} ({})", school, spellName, formIdStr);
    m_prismaUI->InteropCall(m_view, "onLearningTargetSet", notify.dump().c_str());

    // Also update the spell state to "learning" so canvas renderer shows learning visuals
    UpdateSpellState(formIdStr, "learning");
}

void UIManager::NotifyLearningTargetCleared(RE::FormID formId)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    if (formId == 0) {
        return;
    }

    std::stringstream ss;
    ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
    std::string formIdStr = ss.str();

    logger::info("UIManager: Learning target cleared: {} - setting to available", formIdStr);

    // Update the spell state back to "available" since it's no longer being learned
    UpdateSpellState(formIdStr, "available");
}

void UIManager::NotifyModdedSourceRegistered(const std::string& sourceId,
                                              const std::string& displayName,
                                              float multiplier, float cap)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::warn("UIManager: Cannot notify modded source registered - PrismaUI not valid");
        return;
    }

    nlohmann::json j;
    j["sourceId"] = sourceId;
    j["displayName"] = displayName;
    j["multiplier"] = multiplier;
    j["cap"] = cap;
    j["enabled"] = true;

    logger::info("UIManager: Notifying UI - modded XP source registered: '{}' ('{}')", sourceId, displayName);
    m_prismaUI->InteropCall(m_view, "onModdedXPSourceRegistered", j.dump().c_str());
}

void UIManager::NotifyMainMenuLoaded()
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::warn("UIManager: Cannot notify main menu loaded - PrismaUI not valid");
        return;
    }

    logger::info("UIManager: Notifying UI - main menu loaded, resetting tree states");
    m_prismaUI->InteropCall(m_view, "onResetTreeStates", "");
}

void UIManager::NotifySaveGameLoaded()
{
    // FIRST: Ensure focus is released (fixes main menu → game input lock)
    EnsureFocusReleased();

    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::warn("UIManager: Cannot notify save game loaded - PrismaUI not valid");
        return;
    }

    logger::info("UIManager: Notifying UI - save game loaded, refreshing player data");
    m_prismaUI->InteropCall(m_view, "onSaveGameLoaded", "");
}

void UIManager::SendProgressData(const std::string& jsonData)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    m_prismaUI->InteropCall(m_view, "onProgressData", jsonData.c_str());
}
