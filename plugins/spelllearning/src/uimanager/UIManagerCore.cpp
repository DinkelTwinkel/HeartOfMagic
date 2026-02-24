#include "Common.h"
#include "uimanager/UIManager.h"
#include "uimanager/UIManagerInternal.h"
#include "PapyrusAPI.h"
#include "ISLIntegration.h"
#include "ThreadUtils.h"

// =============================================================================
// SINGLETON
// =============================================================================

UIManager* UIManager::GetSingleton()
{
    static UIManager singleton;
    return &singleton;
}

// =============================================================================
// FILE PATHS
// =============================================================================

std::filesystem::path UIManager::GetPromptFilePath()
{
    return "Data/SKSE/Plugins/SpellLearning/tree_rules_prompt.txt";
}

std::filesystem::path UIManager::GetTreeFilePath()
{
    return "Data/SKSE/Plugins/SpellLearning/spell_tree.json";
}

// =============================================================================
// INITIALIZATION
// =============================================================================

bool UIManager::Initialize()
{
    if (m_isInitialized) {
        return true;
    }

    logger::info("UIManager: Initializing PrismaUI connection...");

    // Request the PrismaUI API
    m_prismaUI = PRISMA_UI_API::RequestPluginAPI<PRISMA_UI_API::IVPrismaUI1>();

    if (!m_prismaUI) {
        logger::error("UIManager: Failed to get PrismaUI API - is PrismaUI.dll loaded?");
        return false;
    }

    logger::info("UIManager: PrismaUI API obtained");

    // =========================================================================
    // Create Single Panel View (contains Scanner, Tree Rules, and Spell Tree tabs)
    // =========================================================================
    //m_view = m_prismaUI->CreateViewAccelerated("SpellLearning/SpellLearningPanel/index.html", OnDomReady);
    m_view = m_prismaUI->CreateView("SpellLearning/SpellLearningPanel/index.html", OnDomReady);

    if (!m_prismaUI->IsValid(m_view)) {
        logger::error("UIManager: Failed to create Panel view");
        return false;
    }

    logger::info("UIManager: Panel view created");

    // Register JS callbacks - Scanner tab
    m_prismaUI->RegisterJSListener(m_view, "ScanSpells", OnScanSpells);
    m_prismaUI->RegisterJSListener(m_view, "SaveOutput", OnSaveOutput);
    m_prismaUI->RegisterJSListener(m_view, "SaveOutputBySchool", OnSaveOutputBySchool);
    m_prismaUI->RegisterJSListener(m_view, "LoadPrompt", OnLoadPrompt);
    m_prismaUI->RegisterJSListener(m_view, "SavePrompt", OnSavePrompt);

    // Register JS callbacks - Tree tab
    m_prismaUI->RegisterJSListener(m_view, "LoadSpellTree", OnLoadSpellTree);
    m_prismaUI->RegisterJSListener(m_view, "GetSpellInfo", OnGetSpellInfo);
    m_prismaUI->RegisterJSListener(m_view, "GetSpellInfoBatch", OnGetSpellInfoBatch);
    m_prismaUI->RegisterJSListener(m_view, "SaveSpellTree", OnSaveSpellTree);

    // Register JS callbacks - Progression system
    m_prismaUI->RegisterJSListener(m_view, "SetLearningTarget", OnSetLearningTarget);
    m_prismaUI->RegisterJSListener(m_view, "ClearLearningTarget", OnClearLearningTarget);
    m_prismaUI->RegisterJSListener(m_view, "UnlockSpell", OnUnlockSpell);
    m_prismaUI->RegisterJSListener(m_view, "GetProgress", OnGetProgress);
    m_prismaUI->RegisterJSListener(m_view, "CheatUnlockSpell", OnCheatUnlockSpell);
    m_prismaUI->RegisterJSListener(m_view, "RelockSpell", OnRelockSpell);
    m_prismaUI->RegisterJSListener(m_view, "GetPlayerKnownSpells", OnGetPlayerKnownSpells);
    m_prismaUI->RegisterJSListener(m_view, "SetSpellXP", OnSetSpellXP);
    m_prismaUI->RegisterJSListener(m_view, "SetTreePrerequisites", OnSetTreePrerequisites);

    // Register JS callbacks - Settings (unified config)
    m_prismaUI->RegisterJSListener(m_view, "LoadSettings", OnLoadSettings);  // Legacy
    m_prismaUI->RegisterJSListener(m_view, "SaveSettings", OnSaveSettings);  // Legacy
    m_prismaUI->RegisterJSListener(m_view, "LoadUnifiedConfig", OnLoadUnifiedConfig);
    m_prismaUI->RegisterJSListener(m_view, "SaveUnifiedConfig", OnSaveUnifiedConfig);
    m_prismaUI->RegisterJSListener(m_view, "SetHotkey", OnSetHotkey);
    m_prismaUI->RegisterJSListener(m_view, "SetPauseGameOnFocus", OnSetPauseGameOnFocus);

    // Register JS callbacks - Clipboard
    m_prismaUI->RegisterJSListener(m_view, "CopyToClipboard", OnCopyToClipboard);
    m_prismaUI->RegisterJSListener(m_view, "GetClipboard", OnGetClipboard);

    // Register JS callbacks - LLM integration (OpenRouter)
    m_prismaUI->RegisterJSListener(m_view, "CheckLLM", OnCheckLLM);
    m_prismaUI->RegisterJSListener(m_view, "LLMGenerate", OnLLMGenerate);
    m_prismaUI->RegisterJSListener(m_view, "PollLLMResponse", OnPollLLMResponse);
    m_prismaUI->RegisterJSListener(m_view, "LoadLLMConfig", OnLoadLLMConfig);
    m_prismaUI->RegisterJSListener(m_view, "SaveLLMConfig", OnSaveLLMConfig);
    m_prismaUI->RegisterJSListener(m_view, "LogMessage", OnLogMessage);

    // Register JS callbacks - Procedural tree generation (C++ native)
    m_prismaUI->RegisterJSListener(m_view, "ProceduralTreeGenerate", OnProceduralTreeGenerate);

    // Register JS callbacks - Pre Req Master NLP scoring (C++ native)
    m_prismaUI->RegisterJSListener(m_view, "PreReqMasterScore", OnPreReqMasterScore);

    // Register JS callbacks - Preset file I/O
    m_prismaUI->RegisterJSListener(m_view, "SavePreset", OnSavePreset);
    m_prismaUI->RegisterJSListener(m_view, "DeletePreset", OnDeletePreset);
    m_prismaUI->RegisterJSListener(m_view, "LoadPresets", OnLoadPresets);

    // Register JS callbacks - Panel control
    m_prismaUI->RegisterJSListener(m_view, "HidePanel", OnHidePanel);

    // Register JS callbacks - Auto-test
    m_prismaUI->RegisterJSListener(m_view, "loadTestConfig", OnLoadTestConfig);
    m_prismaUI->RegisterJSListener(m_view, "saveTestResults", OnSaveTestResults);

    // Register console message callback (API v2+)
    if ((m_prismaUIv2 = PRISMA_UI_API::RequestPluginAPI<PRISMA_UI_API::IVPrismaUI2>())) {
        m_prismaUIv2->RegisterConsoleCallback(m_view, OnConsoleMessage);
        logger::info("UIManager: Console callback registered");
    } else {
        logger::warn("UIManager: PrismaUI v2 API not available - console callback not registered");
    }

    logger::info("UIManager: JS listeners registered");

    m_prismaUI->Hide(m_view);
    m_isPanelVisible = false;

    m_isInitialized = true;
    logger::info("UIManager: Initialization complete");
    return true;
}

// =============================================================================
// PANEL VISIBILITY
// =============================================================================

void UIManager::TogglePanel()
{
    if (m_isPanelVisible) {
        HidePanel();
    } else {
        ShowPanel();
    }
}

void UIManager::ShowPanel()
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::warn("UIManager: Cannot show panel - not initialized");
        return;
    }

    if (m_isPanelVisible) {
        return;
    }

    logger::info("UIManager: Showing Panel (pauseGame={})", m_pauseGameOnFocus);

    m_prismaUI->Show(m_view);
    m_prismaUI->Focus(m_view, m_pauseGameOnFocus);
    m_isPanelVisible = true;
    m_hasFocus = true;

    logger::info("UIManager: Show + Focus applied (hasFocus={})", m_prismaUI->HasFocus(m_view));

    // Notify JS that panel is now visible - triggers refresh of known spells
    m_prismaUI->InteropCall(m_view, "onPanelShowing", "");

    // Send ModEvent for other mods listening
    PapyrusAPI::SendMenuOpenedEvent();
}

void UIManager::HidePanel()
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::warn("UIManager: Cannot hide panel - not initialized");
        return;
    }

    if (!m_isPanelVisible) {
        return;
    }

    logger::info("UIManager: Hiding Panel");

    m_prismaUI->Unfocus(m_view);
    m_prismaUI->Hide(m_view);
    m_isPanelVisible = false;
    m_hasFocus = false;

    // Notify JS
    m_prismaUI->InteropCall(m_view, "onPanelHiding", "");

    // Send ModEvent for other mods listening
    PapyrusAPI::SendMenuClosedEvent();
}

void UIManager::EnsureFocusReleased()
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }

    if (m_isPanelVisible) {
        logger::info("UIManager: Game loaded with panel visible - hiding panel");
        HidePanel();
        return;
    }

    logger::info("UIManager: Ensuring focus is released");
    m_prismaUI->Unfocus(m_view);
    m_hasFocus = false;
}

// =============================================================================
// PRISMAUI DOM READY CALLBACK
// =============================================================================

void UIManager::OnDomReady(PrismaView view)
{
    logger::info("UIManager: Panel DOM ready - setting up JS bridge");

    auto* instance = GetSingleton();
    if (!instance->m_prismaUI) {
        return;
    }

    // Inject callCpp bridge wrapper
    const char* setupScript = R"(
        window.callCpp = function(functionName, argument) {
            if (window.skyrimBridge && typeof window.skyrimBridge[functionName] === 'function') {
                window.skyrimBridge[functionName](argument);
                return true;
            }
            if (typeof window[functionName] === 'function') {
                window[functionName](argument);
                return true;
            }
            console.warn('[SpellLearning] callCpp: function not found:', functionName);
            return false;
        };

        window._cppBridgeReady = true;
        console.log('[SpellLearning] C++ bridge ready');
    )";

    instance->m_prismaUI->Invoke(view, setupScript, nullptr);

    // Notify JS that we're ready
    instance->m_prismaUI->InteropCall(view, "onPrismaReady", "");
}

// =============================================================================
// PANEL CONTROL CALLBACKS
// =============================================================================

void UIManager::OnHidePanel([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: HidePanel callback triggered from JS");
    GetSingleton()->HidePanel();
}

// =============================================================================
// HOTKEY / PAUSE CALLBACKS
// =============================================================================

void UIManager::OnSetHotkey(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SetHotkey - no key code provided");
        return;
    }

    try {
        uint32_t keyCode = static_cast<uint32_t>(std::stoul(argument));
        logger::info("UIManager: Setting hotkey to code {}", keyCode);
        UpdateInputHandlerHotkey(keyCode);
    } catch (const std::exception& e) {
        logger::error("UIManager: SetHotkey exception: {}", e.what());
    }
}

void UIManager::OnSetPauseGameOnFocus(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SetPauseGameOnFocus - no value provided");
        return;
    }

    std::string value(argument);
    bool pause = (value == "true" || value == "1");
    logger::info("UIManager: Setting pauseGameOnFocus to {}", pause);
    GetSingleton()->SetPauseGameOnFocus(pause);
}

// =============================================================================
// LOG MESSAGE CALLBACK
// =============================================================================

void UIManager::OnLogMessage(const char* argument)
{
    if (!argument || strlen(argument) == 0) return;

    try {
        json data = json::parse(argument);
        std::string level = SafeJsonValue<std::string>(data, "level", "info");
        std::string message = SafeJsonValue<std::string>(data, "message", "");

        if (level == "warn" || level == "warning") {
            logger::warn("{}", message);
        } else if (level == "error") {
            logger::error("{}", message);
        } else {
            logger::info("{}", message);
        }
    } catch (...) {
        // Fallback: just log the raw argument
        logger::info("JS: {}", argument);
    }
}

// =============================================================================
// CONSOLE MESSAGE CALLBACK
// =============================================================================

// TODO: change level based on devMode and verboseMode
void UIManager::OnConsoleMessage(PrismaView view, PRISMA_UI_API::ConsoleMessageLevel level, const char* message)
{
    switch (level) {
        case PRISMA_UI_API::ConsoleMessageLevel::Error:
            logger::error("[JS]: {}", message);
            break;
        case PRISMA_UI_API::ConsoleMessageLevel::Warning:
            logger::warn("[JS]: {}", message);
            break;
        case PRISMA_UI_API::ConsoleMessageLevel::Debug:
            logger::debug("[JS] View {}: {}", view, message);
            break;
        default:
            logger::info("[JS] View {}: {}", view, message);
            break;
    }
}

// =============================================================================
// DEST DETECTION NOTIFICATION
// =============================================================================

void UIManager::NotifyDESTDetectionStatus()
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::warn("UIManager: Cannot notify DEST status - PrismaUI not valid");
        return;
    }

    bool detected = DESTIntegration::IsDESTInstalled();
    std::string js = detected ? "true" : "false";

    logger::info("UIManager: Notifying UI of DEST detection status: {}", detected ? "Detected" : "Not Detected");
    m_prismaUI->InteropCall(m_view, "onDESTDetectionUpdate", js.c_str());
}
