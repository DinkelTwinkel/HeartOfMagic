#include "PCH.h"
#include "UIManager.h"
#include "SpellScanner.h"
#include "OpenRouterAPI.h"
#include "ProgressionManager.h"
#include "ISLIntegration.h"
#include "SpellEffectivenessHook.h"
#include "SpellTomeHook.h"
#include "SpellCastHandler.h"
#include "PapyrusAPI.h"

// =============================================================================
// JSON HELPER - Safe value accessor that handles null values
// =============================================================================

// nlohmann::json::value() throws type_error.306 when key exists but is null.
// This helper safely returns the default if the key is missing OR null.
template<typename T>
T SafeJsonValue(const nlohmann::json& j, const std::string& key, const T& defaultValue) {
    if (j.contains(key) && !j[key].is_null()) {
        try {
            return j[key].get<T>();
        } catch (...) {
            return defaultValue;
        }
    }
    return defaultValue;
}

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
    m_prismaUI = static_cast<PRISMA_UI_API::IVPrismaUI1*>(
        PRISMA_UI_API::RequestPluginAPI(PRISMA_UI_API::InterfaceVersion::V1)
    );

    if (!m_prismaUI) {
        logger::error("UIManager: Failed to get PrismaUI API - is PrismaUI.dll loaded?");
        return false;
    }

    logger::info("UIManager: PrismaUI API obtained");

    // =========================================================================
    // Create Single Panel View (contains Scanner, Tree Rules, and Spell Tree tabs)
    // =========================================================================
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
    
    // Register JS callbacks - Procedural tree generation (Python)
    m_prismaUI->RegisterJSListener(m_view, "ProceduralPythonGenerate", OnProceduralPythonGenerate);
    
    // Register JS callbacks - Panel control
    m_prismaUI->RegisterJSListener(m_view, "HidePanel", OnHidePanel);

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

    // Prevent rapid toggling
    if (m_isPanelVisible) {
        logger::info("UIManager: ShowPanel called but already visible - skipping");
        return;
    }

    // Log current state before changes - detailed for debugging in heavy load orders
    int currentOrder = m_prismaUI->GetOrder(m_view);
    bool currentlyHidden = m_prismaUI->IsHidden(m_view);
    bool currentlyHasFocus = m_prismaUI->HasFocus(m_view);
    logger::info("UIManager: ShowPanel - BEFORE: order={}, hidden={}, hasFocus={}, pauseGame={} "
                 "[heavy load order debugging]",
                 currentOrder, currentlyHidden, currentlyHasFocus, m_pauseGameOnFocus);

    // =========================================================================
    // FIX FOR HEAVY MOD LISTS (HIRCINE BUG):
    // In heavy mod lists, the game's input state can be in a weird state where
    // the cursor is visible but mouse movement doesn't work. This happens because
    // other mods or PrismaUI views may have left input routing in a bad state.
    //
    // Solution: Reset input state by toggling cursor visibility and pushing/popping
    // a menu input context, similar to what happens when pressing Escape.
    // =========================================================================

    // Step 1: Reset any stale PrismaUI focus state
    if (currentlyHasFocus) {
        logger::info("UIManager: Clearing stale focus before showing panel");
        m_prismaUI->Unfocus(m_view);
    }

    // Step 2: Prime the input system by toggling menu controls
    // This resets the game's input routing similar to opening/closing a menu
    auto* controlMap = RE::ControlMap::GetSingleton();
    if (controlMap) {
        // Push cursor context to ensure mouse input is routed to menus
        controlMap->PushInputContext(RE::ControlMap::InputContextID::kCursor);
        logger::info("UIManager: Pushed cursor input context to prime input system");
    }

    // Step 3: Reset MenuCursor state if it's in a bad state
    auto* menuCursor = RE::MenuCursor::GetSingleton();
    if (menuCursor) {
        // Log cursor state for debugging
        logger::info("UIManager: MenuCursor state - showCursorCount={}, pos=({}, {})",
                     menuCursor->showCursorCount, menuCursor->cursorPosX, menuCursor->cursorPosY);
    }

    // Set high view order to ensure we're on top of other PrismaUI views
    // This prevents other mods' views from intercepting mouse input
    constexpr int HIGH_VIEW_ORDER = 9999;
    m_prismaUI->SetOrder(m_view, HIGH_VIEW_ORDER);

    m_prismaUI->Show(m_view);
    m_isPanelVisible = true;

    // Log state after Show
    logger::info("UIManager: ShowPanel - after Show: order={}, hidden={}",
                 m_prismaUI->GetOrder(m_view), m_prismaUI->IsHidden(m_view));

    // Defer Focus to next frame - in heavy mod lists the view may not be ready for input
    // immediately; requesting focus too soon can leave mouse visible but unmovable
    bool pauseGame = m_pauseGameOnFocus;
    SKSE::GetTaskInterface()->AddTask([this, pauseGame]() {
        if (!m_isPanelVisible || !m_prismaUI || !m_prismaUI->IsValid(m_view)) {
            return;
        }

        // Pop the cursor context we pushed earlier - this "cycles" the input state
        auto* controlMap = RE::ControlMap::GetSingleton();
        if (controlMap) {
            controlMap->PopInputContext(RE::ControlMap::InputContextID::kCursor);
            logger::info("UIManager: Popped cursor input context");
        }

        // First focus attempt (frame N+1)
        m_prismaUI->Focus(m_view, pauseGame);
        m_hasFocus = true;
        bool hasFocusNow = m_prismaUI->HasFocus(m_view);

        // Forcefully hide Windows cursor - PrismaUI has its own cursor
        // Loop until counter goes negative (cursor hidden)
        while (::ShowCursor(FALSE) >= 0) {};

        // Log detailed state including MenuCursor
        auto* menuCursor = RE::MenuCursor::GetSingleton();
        if (menuCursor) {
            logger::info("UIManager: Deferred Focus applied (pauseGame={}, hasFocus={}, cursorCount={})",
                         pauseGame, hasFocusNow, menuCursor->showCursorCount);
        } else {
            logger::info("UIManager: Deferred Focus applied (pauseGame={}, hasFocus={})", pauseGame, hasFocusNow);
        }

        // Schedule additional focus attempts with verification
        // In large mod lists, we may need multiple attempts until input routing is correct
        ScheduleFocusRetry(pauseGame, 1);
    });

    // Notify JS that panel is now visible - triggers refresh of known spells
    m_prismaUI->InteropCall(m_view, "onPanelShowing", "");

    // Check if Python addon is installed (SpellTreeBuilder) and notify JS
    CheckPythonAddonStatus();

    // Send ModEvent for other mods listening
    PapyrusAPI::SendMenuOpenedEvent();
}

void UIManager::CheckPythonAddonStatus()
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) return;

    // Check if build_tree.py exists in the expected location
    std::string pythonScript = "Data/SKSE/Plugins/SpellLearning/SpellTreeBuilder/build_tree.py";
    bool installed = std::filesystem::exists(pythonScript);
    
    // Also check dev location as fallback
    if (!installed) {
        installed = std::filesystem::exists("SpellTreeBuilder/build_tree.py");
    }

    logger::info("UIManager: Python addon (SpellTreeBuilder) installed: {}", installed);

    // Send status to JS
    std::string status = installed ? "true" : "false";
    m_prismaUI->InteropCall(m_view, "onPythonAddonStatus", status.c_str());
}

// Helper to schedule focus retries with exponential backoff
// In heavy mod lists, input routing may take several frames to stabilize
void UIManager::ScheduleFocusRetry(bool pauseGame, int attempt)
{
    constexpr int MAX_FOCUS_ATTEMPTS = 5;

    if (attempt > MAX_FOCUS_ATTEMPTS) {
        logger::error("UIManager: Focus still not working after {} attempts! "
                      "Input state may be corrupted by another mod. Try pressing Escape to reset.",
                      MAX_FOCUS_ATTEMPTS);
        return;
    }

    SKSE::GetTaskInterface()->AddTask([this, pauseGame, attempt]() {
        if (!m_isPanelVisible || !m_prismaUI || !m_prismaUI->IsValid(m_view)) {
            return;
        }

        // Check if we already have working focus
        bool hasFocus = m_prismaUI->HasFocus(m_view);

        // Additional check: verify MenuCursor is in correct state
        auto* menuCursor = RE::MenuCursor::GetSingleton();
        bool cursorVisible = menuCursor && menuCursor->showCursorCount > 0;

        if (hasFocus && cursorVisible) {
            logger::info("UIManager: Focus verified on attempt {} (cursorCount={})",
                         attempt, menuCursor ? menuCursor->showCursorCount : -1);
            return;  // Success!
        }

        logger::info("UIManager: Focus retry attempt {} (hasFocus={}, cursorVisible={})",
                     attempt, hasFocus, cursorVisible);

        // Try to fix the state
        if (!hasFocus) {
            // Re-apply focus
            m_prismaUI->Focus(m_view, pauseGame);
        }

        if (!cursorVisible && menuCursor) {
            // Force cursor visible through Skyrim's system
            menuCursor->SetCursorVisibility(true);
            logger::info("UIManager: Forced cursor visibility via MenuCursor");
        }

        // Schedule next retry
        ScheduleFocusRetry(pauseGame, attempt + 1);
    });
}

void UIManager::HidePanel()
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::warn("UIManager: Cannot hide panel - not initialized");
        return;
    }

    // Prevent rapid toggling
    if (!m_isPanelVisible && !m_hasFocus) {
        logger::info("UIManager: HidePanel called but already hidden - skipping");
        return;
    }

    bool hadFocusBefore = m_prismaUI->HasFocus(m_view);
    logger::info("UIManager: Hiding Panel (hadFocus={})", hadFocusBefore);

    // IMPORTANT: Update state flags FIRST before any async operations
    // This prevents race conditions with rapid toggling
    m_isPanelVisible = false;
    m_hasFocus = false;

    // Unfocus and hide immediately - PrismaUI handles the input release
    m_prismaUI->Unfocus(m_view);
    m_prismaUI->Hide(m_view);

    // NOTE: Do NOT restore Windows cursor - Skyrim manages its own cursor during gameplay
    // The cursor counter stays negative, which is correct for gameplay

    // Restore default order so we don't interfere with other PrismaUI mods while hidden
    m_prismaUI->SetOrder(m_view, 0);

    // Notify JS AFTER unfocus is complete (non-blocking)
    m_prismaUI->InteropCall(m_view, "onPanelHiding", "");

    // Send ModEvent for other mods listening
    PapyrusAPI::SendMenuClosedEvent();

    // TIMING FIX: Schedule an additional unfocus on the next frame
    // This catches cases where the game engine hasn't fully processed the unfocus yet
    SKSE::GetTaskInterface()->AddTask([this]() {
        if (!m_isPanelVisible && m_prismaUI && m_prismaUI->IsValid(m_view)) {
            m_prismaUI->Unfocus(m_view);  // Redundant unfocus ensures clean state
            bool stillHasFocus = m_prismaUI->HasFocus(m_view);
            if (stillHasFocus) {
                logger::warn("UIManager: View still has focus after deferred Unfocus");
            }
        }
    });
}

void UIManager::EnsureFocusReleased()
{
    // Called when game loads to fix input lock from main menu → game transition
    // Also useful for fixing state after mod conflicts
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        return;
    }
    
    // If panel is visible when game loads, hide it
    if (m_isPanelVisible) {
        logger::info("UIManager: Game loaded with panel visible - hiding panel");
        HidePanel();
        return;
    }
    
    // Always force unfocus to be safe - this catches cases where:
    // - Our m_hasFocus flag is out of sync
    // - Another mod left focus in a bad state
    // - Game state changed without proper cleanup
    logger::info("UIManager: Ensuring focus is released (hasFocus={}, isPanelVisible={})", m_hasFocus, m_isPanelVisible);
    m_prismaUI->Unfocus(m_view);
    m_hasFocus = false;
    
    // TIMING FIX: In large modlists, the unfocus might not take effect immediately
    // Schedule multiple deferred unfocus calls to ensure it sticks
    auto* taskInterface = SKSE::GetTaskInterface();
    if (taskInterface) {
        // First deferred unfocus - next frame
        taskInterface->AddTask([this]() {
            if (!m_isPanelVisible && m_prismaUI && m_prismaUI->IsValid(m_view)) {
                m_prismaUI->Unfocus(m_view);
            }
        });
        
        // Second deferred unfocus - two frames later, gives time for other mods
        taskInterface->AddTask([this]() {
            auto* task2 = SKSE::GetTaskInterface();
            if (task2) {
                task2->AddTask([this]() {
                    if (!m_isPanelVisible && m_prismaUI && m_prismaUI->IsValid(m_view)) {
                        m_prismaUI->Unfocus(m_view);
                        logger::info("UIManager: Deferred unfocus completed");
                    }
                });
            }
        });
    }
}

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

void UIManager::SendValidationResult(const std::string& jsonData)
{
    if (!m_prismaUI || !m_prismaUI->IsValid(m_view)) {
        logger::error("UIManager: Cannot send validation result - not initialized");
        return;
    }

    logger::info("UIManager: Sending tree validation result to UI");
    m_prismaUI->InteropCall(m_view, "updateValidationResult", jsonData.c_str());
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
// PRISMAUI CALLBACKS
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
// SCANNER TAB CALLBACKS
// =============================================================================

void UIManager::OnScanSpells(const char* argument)
{
    logger::info("UIManager: ScanSpells callback triggered");

    auto* instance = GetSingleton();

    // Parse the scan configuration
    SpellScanner::ScanConfig scanConfig;
    bool useTomeMode = false;
    
    if (argument && strlen(argument) > 0) {
        try {
            json j = json::parse(argument);
            scanConfig = SpellScanner::ParseScanConfig(argument);
            
            // Check for scan mode
            if (j.contains("scanMode") && j["scanMode"].get<std::string>() == "tomes") {
                useTomeMode = true;
            }
        } catch (...) {
            // If parsing fails, use defaults
        }
    }

    std::string result;
    if (useTomeMode) {
        instance->UpdateStatus("Scanning spell tomes...");
        result = SpellScanner::ScanSpellTomes(scanConfig);
    } else {
        instance->UpdateStatus("Scanning all spells...");
        result = SpellScanner::ScanAllSpells(scanConfig);
    }

    // Send result back to UI
    instance->SendSpellData(result);
}

void UIManager::OnSaveOutput(const char* argument)
{
    logger::info("UIManager: SaveOutput callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveOutput - no content to save");
        return;
    }

    auto* instance = GetSingleton();

    // Create output directory
    std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning";
    std::filesystem::create_directories(outputDir);

    // Write to file
    std::filesystem::path outputPath = outputDir / "spell_scan_output.json";
    
    try {
        std::ofstream file(outputPath);
        if (file.is_open()) {
            file << argument;
            file.close();
            logger::info("UIManager: Saved output to {}", outputPath.string());
            instance->UpdateStatus("Saved to spell_scan_output.json");
        } else {
            logger::error("UIManager: Failed to open output file");
            instance->UpdateStatus("Failed to save file");
        }
    } catch (const std::exception& e) {
        logger::error("UIManager: Exception while saving: {}", e.what());
        instance->UpdateStatus("Error saving file");
    }
}

void UIManager::OnSaveOutputBySchool(const char* argument)
{
    logger::info("UIManager: SaveOutputBySchool callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveOutputBySchool - no content to save");
        return;
    }

    auto* instance = GetSingleton();

    try {
        // Parse the JSON object containing school outputs
        json schoolOutputs = json::parse(argument);
        
        // Create output directory
        std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning/schools";
        std::filesystem::create_directories(outputDir);

        int savedCount = 0;
        
        // Save each school to its own file
        for (auto& [school, content] : schoolOutputs.items()) {
            std::string filename = school + "_spells.json";
            std::filesystem::path outputPath = outputDir / filename;
            
            std::ofstream file(outputPath);
            if (file.is_open()) {
                // Content is already a JSON string, write it directly
                if (content.is_string()) {
                    file << content.get<std::string>();
                } else {
                    file << content.dump(2);
                }
                file.close();
                logger::info("UIManager: Saved {} to {}", school, outputPath.string());
                savedCount++;
            } else {
                logger::error("UIManager: Failed to save {}", school);
            }
        }

        std::string statusMsg = "Saved " + std::to_string(savedCount) + " school files to /schools/";
        logger::info("UIManager: {}", statusMsg);
        instance->UpdateStatus(statusMsg);

    } catch (const std::exception& e) {
        logger::error("UIManager: Exception in SaveOutputBySchool: {}", e.what());
        instance->UpdateStatus("Error saving school files");
    }
}

void UIManager::OnLoadPrompt(const char* argument)
{
    logger::info("UIManager: LoadPrompt callback triggered");

    auto* instance = GetSingleton();
    auto promptPath = GetPromptFilePath();

    // Check if saved prompt exists
    if (!std::filesystem::exists(promptPath)) {
        logger::info("UIManager: No saved prompt file found, using default");
        return;
    }

    try {
        std::ifstream file(promptPath);
        if (file.is_open()) {
            std::stringstream buffer;
            buffer << file.rdbuf();
            file.close();
            
            std::string promptContent = buffer.str();
            logger::info("UIManager: Loaded prompt from file ({} bytes)", promptContent.size());
            
            instance->SendPrompt(promptContent);
        } else {
            logger::warn("UIManager: Could not open prompt file");
        }
    } catch (const std::exception& e) {
        logger::error("UIManager: Exception while loading prompt: {}", e.what());
    }
}

void UIManager::OnSavePrompt(const char* argument)
{
    logger::info("UIManager: SavePrompt callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SavePrompt - no content to save");
        return;
    }

    auto* instance = GetSingleton();

    // Create output directory
    std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning";
    std::filesystem::create_directories(outputDir);

    auto promptPath = GetPromptFilePath();

    try {
        std::ofstream file(promptPath);
        if (file.is_open()) {
            file << argument;
            file.close();
            logger::info("UIManager: Saved prompt to {}", promptPath.string());
            instance->NotifyPromptSaved(true);
        } else {
            logger::error("UIManager: Failed to open prompt file for writing");
            instance->NotifyPromptSaved(false);
        }
    } catch (const std::exception& e) {
        logger::error("UIManager: Exception while saving prompt: {}", e.what());
        instance->NotifyPromptSaved(false);
    }
}

// =============================================================================
// TREE TAB CALLBACKS
// =============================================================================

void UIManager::OnLoadSpellTree(const char* argument)
{
    logger::info("UIManager: LoadSpellTree callback triggered");

    auto* instance = GetSingleton();
    auto treePath = GetTreeFilePath();

    // Check if saved tree exists
    if (!std::filesystem::exists(treePath)) {
        logger::info("UIManager: No saved spell tree found");
        instance->UpdateTreeStatus("No saved tree - import one");
        return;
    }

    try {
        std::ifstream file(treePath);
        if (file.is_open()) {
            std::stringstream buffer;
            buffer << file.rdbuf();
            file.close();

            std::string treeContent = buffer.str();
            logger::info("UIManager: Loaded spell tree from file ({} bytes)", treeContent.size());

            // Parse and validate tree
            json treeData;
            try {
                treeData = json::parse(treeContent);
            } catch (const std::exception& e) {
                logger::error("UIManager: Failed to parse tree JSON: {}", e.what());
                instance->UpdateTreeStatus("Error: Invalid tree JSON");
                return;
            }

            // Validate and fix FormIDs (handles load order changes)
            auto validationResult = SpellScanner::ValidateAndFixTree(treeData);

            // Log validation results
            logger::info("UIManager: Tree validation - {}/{} valid, {} resolved, {} invalid",
                validationResult.validNodes, validationResult.totalNodes,
                validationResult.resolvedFromPersistent, validationResult.invalidNodes);

            if (!validationResult.missingPlugins.empty()) {
                logger::warn("UIManager: Missing plugins:");
                for (const auto& plugin : validationResult.missingPlugins) {
                    logger::warn("  - {}", plugin);
                }
            }

            // Save fixed tree if any changes were made
            bool treeModified = (validationResult.resolvedFromPersistent > 0 || validationResult.invalidNodes > 0);
            if (treeModified) {
                // Update version to 2.0 if not already
                if (!treeData.contains("version") || treeData["version"] != "2.0") {
                    treeData["version"] = "2.0";
                }

                try {
                    std::ofstream outFile(treePath);
                    if (outFile.is_open()) {
                        outFile << treeData.dump(2);
                        outFile.close();
                        logger::info("UIManager: Saved fixed tree with {} FormID updates", validationResult.resolvedFromPersistent);
                    }
                } catch (const std::exception& e) {
                    logger::error("UIManager: Failed to save fixed tree: {}", e.what());
                }
            }

            // Send validated tree data to viewer
            instance->SendTreeData(treeData.dump());

            // Build status message
            std::string statusMsg;
            if (validationResult.invalidNodes > 0) {
                statusMsg = std::format("Loaded tree - {} spells ({} removed due to missing plugins)",
                    validationResult.validNodes, validationResult.invalidNodes);
            } else if (validationResult.resolvedFromPersistent > 0) {
                statusMsg = std::format("Loaded tree - {} spells ({} fixed after load order change)",
                    validationResult.validNodes, validationResult.resolvedFromPersistent);
            } else {
                statusMsg = std::format("Loaded tree - {} spells", validationResult.validNodes);
            }
            instance->UpdateTreeStatus(statusMsg);

            // Send validation result to UI for potential warning display
            json validationJson;
            validationJson["totalNodes"] = validationResult.totalNodes;
            validationJson["validNodes"] = validationResult.validNodes;
            validationJson["invalidNodes"] = validationResult.invalidNodes;
            validationJson["resolvedFromPersistent"] = validationResult.resolvedFromPersistent;
            validationJson["missingPlugins"] = validationResult.missingPlugins;
            instance->SendValidationResult(validationJson.dump());

            // Fetch spell info for all valid formIds
            std::vector<std::string> formIds;
            if (treeData.contains("schools")) {
                for (auto& [schoolName, schoolData] : treeData["schools"].items()) {
                    if (schoolData.contains("nodes")) {
                        for (auto& node : schoolData["nodes"]) {
                            if (node.contains("formId")) {
                                formIds.push_back(node["formId"].get<std::string>());
                            }
                        }
                    }
                }
            }

            // Fetch spell info and send as batch
            if (!formIds.empty()) {
                json spellInfoArray = json::array();
                for (const auto& formIdStr : formIds) {
                    auto spellInfo = SpellScanner::GetSpellInfoByFormId(formIdStr);
                    if (!spellInfo.empty()) {
                        spellInfoArray.push_back(json::parse(spellInfo));
                    }
                }
                instance->SendSpellInfoBatch(spellInfoArray.dump());
            }

        } else {
            logger::warn("UIManager: Could not open spell tree file");
        }
    } catch (const std::exception& e) {
        logger::error("UIManager: Exception while loading spell tree: {}", e.what());
    }
}

void UIManager::OnGetSpellInfo(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: GetSpellInfo - no formId provided");
        return;
    }

    logger::info("UIManager: GetSpellInfo for formId: {}", argument);

    auto* instance = GetSingleton();

    // Get spell info from SpellScanner
    std::string spellInfo = SpellScanner::GetSpellInfoByFormId(argument);
    
    if (!spellInfo.empty()) {
        instance->SendSpellInfo(spellInfo);
    } else {
        logger::warn("UIManager: No spell found for formId: {}", argument);
    }
}

void UIManager::OnGetSpellInfoBatch(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: GetSpellInfoBatch - no data provided");
        return;
    }

    auto* instance = GetSingleton();

    try {
        // Parse JSON array of formIds
        json formIdArray = json::parse(argument);
        
        if (!formIdArray.is_array()) {
            logger::error("UIManager: GetSpellInfoBatch - expected JSON array");
            return;
        }

        logger::info("UIManager: GetSpellInfoBatch for {} formIds", formIdArray.size());

        json resultArray = json::array();
        int foundCount = 0;
        int notFoundCount = 0;

        for (const auto& formIdJson : formIdArray) {
            std::string formIdStr = formIdJson.get<std::string>();
            
            // Validate formId format (should be 0x followed by 8 hex chars)
            if (formIdStr.length() < 3 || formIdStr.substr(0, 2) != "0x") {
                logger::warn("UIManager: Invalid formId format: {}", formIdStr);
                json notFound;
                notFound["formId"] = formIdStr;
                notFound["notFound"] = true;
                resultArray.push_back(notFound);
                notFoundCount++;
                continue;
            }

            std::string spellInfo = SpellScanner::GetSpellInfoByFormId(formIdStr);
            
            if (!spellInfo.empty()) {
                resultArray.push_back(json::parse(spellInfo));
                foundCount++;
            } else {
                json notFound;
                notFound["formId"] = formIdStr;
                notFound["notFound"] = true;
                resultArray.push_back(notFound);
                notFoundCount++;
            }
        }

        logger::info("UIManager: Batch result - {} found, {} not found", foundCount, notFoundCount);

        // Send batch result
        instance->SendSpellInfoBatch(resultArray.dump());

    } catch (const std::exception& e) {
        logger::error("UIManager: GetSpellInfoBatch exception: {}", e.what());
    }
}

void UIManager::OnSaveSpellTree(const char* argument)
{
    logger::info("UIManager: SaveSpellTree callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveSpellTree - no content to save");
        return;
    }

    auto* instance = GetSingleton();

    // Create output directory
    std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning";
    std::filesystem::create_directories(outputDir);

    // Write to file
    auto treePath = GetTreeFilePath();
    
    try {
        std::ofstream file(treePath);
        if (file.is_open()) {
            file << argument;
            file.close();
            logger::info("UIManager: Saved spell tree to {}", treePath.string());
            instance->UpdateTreeStatus("Tree saved");
        } else {
            logger::error("UIManager: Failed to open spell tree file for writing");
            instance->UpdateTreeStatus("Save failed");
        }
    } catch (const std::exception& e) {
        logger::error("UIManager: Exception while saving spell tree: {}", e.what());
        instance->UpdateTreeStatus("Save failed");
    }
}

void UIManager::OnSetLearningTarget(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SetLearningTarget - no data provided");
        return;
    }

    logger::info("UIManager: SetLearningTarget: {}", argument);

    try {
        json request = json::parse(argument);
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
        
        ProgressionManager::GetSingleton()->SetLearningTarget(school, formId, prereqs);
        
        // Notify UI
        auto* instance = GetSingleton();
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
}

void UIManager::OnClearLearningTarget(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        return;
    }

    logger::info("UIManager: ClearLearningTarget: {}", argument);

    try {
        json request = json::parse(argument);
        std::string school = request.value("school", "");
        
        if (!school.empty()) {
            // Get the current learning target formId BEFORE clearing
            RE::FormID targetId = ProgressionManager::GetSingleton()->GetLearningTarget(school);
            
            ProgressionManager::GetSingleton()->ClearLearningTarget(school);
            
            // Update UI to show spell is no longer in learning state
            if (targetId != 0) {
                auto* instance = GetSingleton();
                std::stringstream ss;
                ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << targetId;
                instance->UpdateSpellState(ss.str(), "available");
                logger::info("UIManager: Cleared learning target {} - set to available", ss.str());
            }
        }
    } catch (const std::exception& e) {
        logger::error("UIManager: ClearLearningTarget exception: {}", e.what());
    }
}

void UIManager::OnUnlockSpell(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: UnlockSpell - no formId provided");
        return;
    }

    logger::info("UIManager: UnlockSpell: {}", argument);

    auto* instance = GetSingleton();

    try {
        json request = json::parse(argument);
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
}

void UIManager::OnGetProgress(const char* argument)
{
    logger::info("UIManager: GetProgress requested");
    
    auto* instance = GetSingleton();
    std::string progressJson = ProgressionManager::GetSingleton()->GetProgressJSON();
    instance->SendProgressData(progressJson);
}

void UIManager::OnGetPlayerKnownSpells(const char* argument)
{
    logger::info("UIManager: GetPlayerKnownSpells requested");
    
    auto* instance = GetSingleton();
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
}

void UIManager::OnCheatUnlockSpell(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: CheatUnlockSpell - no formId provided");
        return;
    }

    logger::info("UIManager: CheatUnlockSpell (cheat mode): {}", argument);

    auto* instance = GetSingleton();

    try {
        json request = json::parse(argument);
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
}

void UIManager::OnRelockSpell(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: RelockSpell - no formId provided");
        return;
    }

    logger::info("UIManager: RelockSpell (cheat mode): {}", argument);

    auto* instance = GetSingleton();

    try {
        json request = json::parse(argument);
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
}

void UIManager::OnSetSpellXP(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SetSpellXP - no data provided");
        return;
    }

    logger::info("UIManager: SetSpellXP (cheat mode): {}", argument);

    try {
        json request = json::parse(argument);
        std::string formIdStr = request.value("formId", "");
        float xp = request.value("xp", 0.0f);
        
        if (formIdStr.empty()) {
            logger::warn("UIManager: SetSpellXP - no formId");
            return;
        }
        
        RE::FormID formId = std::stoul(formIdStr, nullptr, 0);
        
        // Update progression manager with the new XP
        auto* progressionMgr = ProgressionManager::GetSingleton();
        if (progressionMgr) {
            progressionMgr->SetSpellXP(formId, xp);
            logger::info("UIManager: Set XP for spell {:08X} to {:.0f}", formId, xp);
        }
        
    } catch (const std::exception& e) {
        logger::error("UIManager: SetSpellXP exception: {}", e.what());
    }
}

void UIManager::OnSetTreePrerequisites(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SetTreePrerequisites - no data provided");
        return;
    }

    logger::info("UIManager: SetTreePrerequisites called");

    try {
        json request = json::parse(argument);
        
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
        int count = 0;
        
        for (const auto& entry : request) {
            std::string formIdStr = entry.value("formId", "");
            if (formIdStr.empty()) continue;
            
            RE::FormID formId = 0;
            try {
                formId = std::stoul(formIdStr, nullptr, 0);
            } catch (...) {
                logger::warn("UIManager: Could not parse formId '{}' - skipping", formIdStr);
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
                        } catch (...) {}
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
}

// =============================================================================
// SETTINGS (Legacy - now uses Unified Config)
// =============================================================================

std::filesystem::path GetSettingsFilePath()
{
    return "Data/SKSE/Plugins/SpellLearning/settings.json";
}

std::filesystem::path GetUnifiedConfigPath()
{
    return "Data/SKSE/Plugins/SpellLearning/config.json";
}

void UIManager::OnLoadSettings(const char* argument)
{
    // Legacy - redirect to unified config
    OnLoadUnifiedConfig(argument);
}

void UIManager::OnSaveSettings(const char* argument)
{
    // Legacy - redirect to unified config
    OnSaveUnifiedConfig(argument);
}

// =============================================================================
// UNIFIED CONFIG (All settings in one file)
// =============================================================================

// Forward declaration for InputHandler access (defined in Main.cpp)
void UpdateInputHandlerHotkey(uint32_t keyCode);

// Generate a complete default config with all required fields
json GenerateDefaultConfig() {
    return json{
        {"hotkey", "F8"},
        {"hotkeyCode", 66},
        {"pauseGameOnFocus", true},  // If false, game continues running when UI is open
        {"cheatMode", false},
        {"verboseLogging", false},
        // Heart animation settings
        {"heartAnimationEnabled", true},
        {"heartPulseSpeed", 0.06},
        {"heartBgOpacity", 1.0},
        {"heartBgColor", "#0a0a14"},
        {"heartRingColor", "#b8a878"},
        {"learningPathColor", "#00ffff"},
        {"activeProfile", "normal"},
        {"learningMode", "perSchool"},
        {"xpGlobalMultiplier", 1},
        {"xpMultiplierDirect", 100},
        {"xpMultiplierSchool", 50},
        {"xpMultiplierAny", 10},
        {"xpCapAny", 5},
        {"xpCapSchool", 15},
        {"xpCapDirect", 50},
        {"xpNovice", 100},
        {"xpApprentice", 200},
        {"xpAdept", 400},
        {"xpExpert", 800},
        {"xpMaster", 1500},
        {"revealName", 10},
        {"revealEffects", 25},
        {"revealDescription", 50},
        {"discoveryMode", false},
        {"nodeSizeScaling", true},
        {"earlySpellLearning", {
            {"enabled", true},
            {"unlockThreshold", 25.0f},
            {"selfCastRequiredAt", 75.0f},
            {"selfCastXPMultiplier", 150.0f},
            {"binaryEffectThreshold", 80.0f},
            {"modifyGameDisplay", true},
            {"powerSteps", json::array({
                {{"xp", 25}, {"power", 20}, {"label", "Budding"}},
                {{"xp", 40}, {"power", 35}, {"label", "Developing"}},
                {{"xp", 55}, {"power", 50}, {"label", "Practicing"}},
                {{"xp", 70}, {"power", 65}, {"label", "Advancing"}},
                {{"xp", 85}, {"power", 80}, {"label", "Refining"}},
                {{"xp", 100}, {"power", 100}, {"label", "Mastered"}}
            })}
        }},
        {"spellTomeLearning", {
            {"enabled", true},
            {"useProgressionSystem", true},
            {"grantXPOnRead", true},
            {"autoSetLearningTarget", true},
            {"showNotifications", true},
            {"xpPercentToGrant", 25.0f},
            {"tomeInventoryBoost", true},
            {"tomeInventoryBoostPercent", 25.0f},
            {"requirePrereqs", true},
            {"requireAllPrereqs", true},
            {"requireSkillLevel", false}
        }},
        {"notifications", {
            {"weakenedSpellNotifications", true},
            {"weakenedSpellInterval", 10.0f}
        }},
        {"llm", {
            {"apiKey", ""},
            {"model", "anthropic/claude-sonnet-4"},
            {"maxTokens", 64000}
        }},
        {"schoolColors", json::object()},
        {"customProfiles", json::object()}
    };
}

// Recursively merge src into dst, only overwriting non-null values
void MergeJsonNonNull(json& dst, const json& src) {
    if (!src.is_object()) return;
    for (auto& [key, value] : src.items()) {
        if (value.is_null()) continue;  // Skip null values
        if (value.is_object() && dst.contains(key) && dst[key].is_object()) {
            MergeJsonNonNull(dst[key], value);  // Recursive merge for objects
        } else {
            dst[key] = value;  // Overwrite with non-null value
        }
    }
}

void UIManager::OnLoadUnifiedConfig(const char* argument)
{
    logger::info("UIManager: LoadUnifiedConfig requested");
    
    auto* instance = GetSingleton();
    auto path = GetUnifiedConfigPath();
    
    // Also check legacy paths and merge if needed
    auto legacySettingsPath = GetSettingsFilePath();
    auto legacyLLMPath = std::filesystem::path("Data/SKSE/Plugins/SpellLearning/openrouter_config.json");
    
    // Start with complete defaults - this ensures all fields exist
    json unifiedConfig = GenerateDefaultConfig();
    bool configFileExists = false;
    
    // Try to load existing unified config and merge (non-null values only)
    if (std::filesystem::exists(path)) {
        try {
            std::ifstream file(path);
            json loadedConfig = json::parse(file);
            MergeJsonNonNull(unifiedConfig, loadedConfig);
            configFileExists = true;
            logger::info("UIManager: Loaded and merged unified config");
        } catch (const std::exception& e) {
            logger::warn("UIManager: Failed to parse unified config: {} - using defaults", e.what());
        }
    } else {
        logger::info("UIManager: No config file found, using defaults");
    }
    
    // Migrate legacy settings if they exist
    if (std::filesystem::exists(legacySettingsPath)) {
        try {
            std::ifstream file(legacySettingsPath);
            json legacySettings = json::parse(file);
            MergeJsonNonNull(unifiedConfig, legacySettings);
            logger::info("UIManager: Migrated legacy settings.json");
        } catch (...) {}
    }
    
    // Migrate legacy LLM config
    if (std::filesystem::exists(legacyLLMPath)) {
        try {
            std::ifstream file(legacyLLMPath);
            json legacyLLM = json::parse(file);
            json llmConfig = {
                {"apiKey", SafeJsonValue<std::string>(legacyLLM, "apiKey", "")},
                {"model", SafeJsonValue<std::string>(legacyLLM, "model", "anthropic/claude-sonnet-4")},
                {"maxTokens", SafeJsonValue<int>(legacyLLM, "maxTokens", 64000)}
            };
            MergeJsonNonNull(unifiedConfig["llm"], llmConfig);
            logger::info("UIManager: Migrated legacy openrouter_config.json");
        } catch (...) {}
    }
    
    // Save defaults if no config file existed (creates the file for user)
    if (!configFileExists) {
        try {
            std::filesystem::create_directories(path.parent_path());
            std::ofstream outFile(path);
            outFile << unifiedConfig.dump(2);
            logger::info("UIManager: Created default config file at {}", path.string());
        } catch (const std::exception& e) {
            logger::warn("UIManager: Failed to save default config: {}", e.what());
        }
    }
    
    // Update InputHandler with loaded hotkey
    if (unifiedConfig.contains("hotkeyCode") && !unifiedConfig["hotkeyCode"].is_null()) {
        uint32_t keyCode = unifiedConfig["hotkeyCode"].get<uint32_t>();
        UpdateInputHandlerHotkey(keyCode);
        logger::info("UIManager: Updated hotkey from config: {}", keyCode);
    }
    
    // Update pause game on focus setting
    if (unifiedConfig.contains("pauseGameOnFocus") && !unifiedConfig["pauseGameOnFocus"].is_null()) {
        bool pauseGame = unifiedConfig["pauseGameOnFocus"].get<bool>();
        GetSingleton()->SetPauseGameOnFocus(pauseGame);
        logger::info("UIManager: Updated pauseGameOnFocus from config: {}", pauseGame);
    }
    
    // Update ProgressionManager with loaded XP settings
    // All fields are guaranteed to exist from defaults, but use SafeJsonValue for extra safety
    ProgressionManager::XPSettings xpSettings;
    xpSettings.learningMode = SafeJsonValue<std::string>(unifiedConfig, "learningMode", "perSchool");
    xpSettings.globalMultiplier = static_cast<float>(SafeJsonValue<int>(unifiedConfig, "xpGlobalMultiplier", 1));
    xpSettings.multiplierDirect = SafeJsonValue<int>(unifiedConfig, "xpMultiplierDirect", 100) / 100.0f;
    xpSettings.multiplierSchool = SafeJsonValue<int>(unifiedConfig, "xpMultiplierSchool", 50) / 100.0f;
    xpSettings.multiplierAny = SafeJsonValue<int>(unifiedConfig, "xpMultiplierAny", 10) / 100.0f;
    // XP caps (max contribution from each source)
    xpSettings.capAny = static_cast<float>(SafeJsonValue<int>(unifiedConfig, "xpCapAny", 5));
    xpSettings.capSchool = static_cast<float>(SafeJsonValue<int>(unifiedConfig, "xpCapSchool", 15));
    xpSettings.capDirect = static_cast<float>(SafeJsonValue<int>(unifiedConfig, "xpCapDirect", 50));
    // Tier XP requirements
    xpSettings.xpNovice = SafeJsonValue<int>(unifiedConfig, "xpNovice", 100);
    xpSettings.xpApprentice = SafeJsonValue<int>(unifiedConfig, "xpApprentice", 200);
    xpSettings.xpAdept = SafeJsonValue<int>(unifiedConfig, "xpAdept", 400);
    xpSettings.xpExpert = SafeJsonValue<int>(unifiedConfig, "xpExpert", 800);
    xpSettings.xpMaster = SafeJsonValue<int>(unifiedConfig, "xpMaster", 1500);
    ProgressionManager::GetSingleton()->SetXPSettings(xpSettings);
    
    // Update SpellEffectivenessHook with early learning settings
    if (unifiedConfig.contains("earlySpellLearning") && !unifiedConfig["earlySpellLearning"].is_null()) {
        auto& elConfig = unifiedConfig["earlySpellLearning"];
        SpellEffectivenessHook::EarlyLearningSettings elSettings;
        elSettings.enabled = SafeJsonValue<bool>(elConfig, "enabled", true);
        elSettings.unlockThreshold = SafeJsonValue<float>(elConfig, "unlockThreshold", 25.0f);
        elSettings.selfCastRequiredAt = SafeJsonValue<float>(elConfig, "selfCastRequiredAt", 75.0f);
        elSettings.selfCastXPMultiplier = SafeJsonValue<float>(elConfig, "selfCastXPMultiplier", 150.0f) / 100.0f;
        elSettings.binaryEffectThreshold = SafeJsonValue<float>(elConfig, "binaryEffectThreshold", 80.0f);
        elSettings.modifyGameDisplay = SafeJsonValue<bool>(elConfig, "modifyGameDisplay", true);
        SpellEffectivenessHook::GetSingleton()->SetSettings(elSettings);
        
        // Load configurable power steps if present
        if (elConfig.contains("powerSteps") && !elConfig["powerSteps"].is_null() && elConfig["powerSteps"].is_array()) {
            std::vector<SpellEffectivenessHook::PowerStep> steps;
            for (const auto& stepJson : elConfig["powerSteps"]) {
                if (stepJson.is_null()) continue;
                SpellEffectivenessHook::PowerStep step;
                step.progressThreshold = SafeJsonValue<float>(stepJson, "xp", 25.0f);
                step.effectiveness = SafeJsonValue<float>(stepJson, "power", 20.0f) / 100.0f;  // Convert % to 0-1
                step.label = SafeJsonValue<std::string>(stepJson, "label", "Stage");
                steps.push_back(step);
            }
            if (!steps.empty()) {
                SpellEffectivenessHook::GetSingleton()->SetPowerSteps(steps);
            }
        }
    }
    
    // Update SpellTomeHook with tome learning settings
    if (unifiedConfig.contains("spellTomeLearning") && !unifiedConfig["spellTomeLearning"].is_null()) {
        auto& tomeConfig = unifiedConfig["spellTomeLearning"];
        SpellTomeHook::Settings tomeSettings;
        tomeSettings.enabled = SafeJsonValue<bool>(tomeConfig, "enabled", true);
        tomeSettings.useProgressionSystem = SafeJsonValue<bool>(tomeConfig, "useProgressionSystem", true);
        tomeSettings.grantXPOnRead = SafeJsonValue<bool>(tomeConfig, "grantXPOnRead", true);
        tomeSettings.autoSetLearningTarget = SafeJsonValue<bool>(tomeConfig, "autoSetLearningTarget", true);
        tomeSettings.showNotifications = SafeJsonValue<bool>(tomeConfig, "showNotifications", true);
        tomeSettings.xpPercentToGrant = SafeJsonValue<float>(tomeConfig, "xpPercentToGrant", 25.0f);
        tomeSettings.tomeInventoryBoost = SafeJsonValue<bool>(tomeConfig, "tomeInventoryBoost", true);
        tomeSettings.tomeInventoryBoostPercent = SafeJsonValue<float>(tomeConfig, "tomeInventoryBoostPercent", 25.0f);
        // Learning requirements
        tomeSettings.requirePrereqs = SafeJsonValue<bool>(tomeConfig, "requirePrereqs", true);
        tomeSettings.requireAllPrereqs = SafeJsonValue<bool>(tomeConfig, "requireAllPrereqs", true);
        tomeSettings.requireSkillLevel = SafeJsonValue<bool>(tomeConfig, "requireSkillLevel", false);
        SpellTomeHook::GetSingleton()->SetSettings(tomeSettings);
        logger::info("UIManager: Applied SpellTomeHook settings - useProgressionSystem: {}, requirePrereqs: {}, requireAllPrereqs: {}, requireSkillLevel: {}",
            tomeSettings.useProgressionSystem, tomeSettings.requirePrereqs, tomeSettings.requireAllPrereqs, tomeSettings.requireSkillLevel);
    }
    
    // Update SpellCastHandler with notification settings
    if (unifiedConfig.contains("notifications") && !unifiedConfig["notifications"].is_null()) {
        auto& notifConfig = unifiedConfig["notifications"];
        auto* castHandler = SpellCastHandler::GetSingleton();
        castHandler->SetWeakenedNotificationsEnabled(SafeJsonValue<bool>(notifConfig, "weakenedSpellNotifications", true));
        castHandler->SetNotificationInterval(SafeJsonValue<float>(notifConfig, "weakenedSpellInterval", 10.0f));
        logger::info("UIManager: Applied notification settings - weakened enabled: {}, interval: {}s",
            castHandler->GetWeakenedNotificationsEnabled(), castHandler->GetNotificationInterval());
    }
    
    // Send to UI
    std::string configStr = unifiedConfig.dump();
    logger::info("UIManager: Sending unified config to UI ({} bytes)", configStr.size());
    instance->m_prismaUI->InteropCall(instance->m_view, "onUnifiedConfigLoaded", configStr.c_str());
    
    // Notify UI of ISL detection status (fresh detection, not from saved config)
    instance->NotifyISLDetectionStatus();
}

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

void UIManager::OnSaveUnifiedConfig(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveUnifiedConfig - no data provided");
        return;
    }

    logger::info("UIManager: SaveUnifiedConfig");
    
    auto path = GetUnifiedConfigPath();
    
    // Ensure directory exists
    std::filesystem::create_directories(path.parent_path());
    
    try {
        // Parse incoming config
        json newConfig = json::parse(argument);
        
        // Load existing config to preserve any fields not in the update
        json existingConfig;
        if (std::filesystem::exists(path)) {
            try {
                std::ifstream existingFile(path);
                existingConfig = json::parse(existingFile);
            } catch (...) {}
        }
        
        // Merge new config into existing (new values override)
        for (auto& [key, value] : newConfig.items()) {
            existingConfig[key] = value;
        }
        
        // Update hotkey in InputHandler if changed
        if (newConfig.contains("hotkeyCode")) {
            uint32_t keyCode = newConfig["hotkeyCode"].get<uint32_t>();
            UpdateInputHandlerHotkey(keyCode);
        }
        
        // Update pause game on focus if changed
        if (newConfig.contains("pauseGameOnFocus")) {
            bool pauseGame = newConfig["pauseGameOnFocus"].get<bool>();
            GetSingleton()->SetPauseGameOnFocus(pauseGame);
        }
        
        // Update XP settings in ProgressionManager if changed
        ProgressionManager::XPSettings xpSettings;
        xpSettings.learningMode = SafeJsonValue<std::string>(newConfig, "learningMode", "perSchool");
        xpSettings.globalMultiplier = static_cast<float>(SafeJsonValue<int>(newConfig, "xpGlobalMultiplier", 1));
        xpSettings.multiplierDirect = SafeJsonValue<int>(newConfig, "xpMultiplierDirect", 100) / 100.0f;
        xpSettings.multiplierSchool = SafeJsonValue<int>(newConfig, "xpMultiplierSchool", 50) / 100.0f;
        xpSettings.multiplierAny = SafeJsonValue<int>(newConfig, "xpMultiplierAny", 10) / 100.0f;
        // XP caps (max contribution from each source)
        xpSettings.capAny = static_cast<float>(SafeJsonValue<int>(newConfig, "xpCapAny", 5));
        xpSettings.capSchool = static_cast<float>(SafeJsonValue<int>(newConfig, "xpCapSchool", 15));
        xpSettings.capDirect = static_cast<float>(SafeJsonValue<int>(newConfig, "xpCapDirect", 50));
        // Tier XP requirements
        xpSettings.xpNovice = SafeJsonValue<int>(newConfig, "xpNovice", 100);
        xpSettings.xpApprentice = SafeJsonValue<int>(newConfig, "xpApprentice", 200);
        xpSettings.xpAdept = SafeJsonValue<int>(newConfig, "xpAdept", 400);
        xpSettings.xpExpert = SafeJsonValue<int>(newConfig, "xpExpert", 800);
        xpSettings.xpMaster = SafeJsonValue<int>(newConfig, "xpMaster", 1500);
        ProgressionManager::GetSingleton()->SetXPSettings(xpSettings);
        
        // Update early learning settings in SpellEffectivenessHook if changed
        if (newConfig.contains("earlySpellLearning") && !newConfig["earlySpellLearning"].is_null()) {
            auto& elConfig = newConfig["earlySpellLearning"];
            SpellEffectivenessHook::EarlyLearningSettings elSettings;
            elSettings.enabled = SafeJsonValue<bool>(elConfig, "enabled", true);
            elSettings.unlockThreshold = SafeJsonValue<float>(elConfig, "unlockThreshold", 25.0f);
            elSettings.selfCastRequiredAt = SafeJsonValue<float>(elConfig, "selfCastRequiredAt", 75.0f);
            elSettings.selfCastXPMultiplier = SafeJsonValue<float>(elConfig, "selfCastXPMultiplier", 150.0f) / 100.0f;
            elSettings.binaryEffectThreshold = SafeJsonValue<float>(elConfig, "binaryEffectThreshold", 80.0f);
            elSettings.modifyGameDisplay = SafeJsonValue<bool>(elConfig, "modifyGameDisplay", true);
            SpellEffectivenessHook::GetSingleton()->SetSettings(elSettings);
            
            // Load configurable power steps if present
            if (elConfig.contains("powerSteps") && !elConfig["powerSteps"].is_null() && elConfig["powerSteps"].is_array()) {
                std::vector<SpellEffectivenessHook::PowerStep> steps;
                for (const auto& stepJson : elConfig["powerSteps"]) {
                    if (stepJson.is_null()) continue;
                    SpellEffectivenessHook::PowerStep step;
                    step.progressThreshold = SafeJsonValue<float>(stepJson, "xp", 25.0f);
                    step.effectiveness = SafeJsonValue<float>(stepJson, "power", 20.0f) / 100.0f;  // Convert % to 0-1
                    step.label = SafeJsonValue<std::string>(stepJson, "label", "Stage");
                    steps.push_back(step);
                }
                if (!steps.empty()) {
                    SpellEffectivenessHook::GetSingleton()->SetPowerSteps(steps);
                }
            }
        }
        
        // Update SpellTomeHook settings if changed
        if (newConfig.contains("spellTomeLearning") && !newConfig["spellTomeLearning"].is_null()) {
            auto& tomeConfig = newConfig["spellTomeLearning"];
            SpellTomeHook::Settings tomeSettings;
            tomeSettings.enabled = SafeJsonValue<bool>(tomeConfig, "enabled", true);
            tomeSettings.useProgressionSystem = SafeJsonValue<bool>(tomeConfig, "useProgressionSystem", true);
            tomeSettings.grantXPOnRead = SafeJsonValue<bool>(tomeConfig, "grantXPOnRead", true);
            tomeSettings.autoSetLearningTarget = SafeJsonValue<bool>(tomeConfig, "autoSetLearningTarget", true);
            tomeSettings.showNotifications = SafeJsonValue<bool>(tomeConfig, "showNotifications", true);
            tomeSettings.xpPercentToGrant = SafeJsonValue<float>(tomeConfig, "xpPercentToGrant", 25.0f);
            tomeSettings.tomeInventoryBoost = SafeJsonValue<bool>(tomeConfig, "tomeInventoryBoost", true);
            tomeSettings.tomeInventoryBoostPercent = SafeJsonValue<float>(tomeConfig, "tomeInventoryBoostPercent", 25.0f);
            // Learning requirements
            tomeSettings.requirePrereqs = SafeJsonValue<bool>(tomeConfig, "requirePrereqs", true);
            tomeSettings.requireAllPrereqs = SafeJsonValue<bool>(tomeConfig, "requireAllPrereqs", true);
            tomeSettings.requireSkillLevel = SafeJsonValue<bool>(tomeConfig, "requireSkillLevel", false);
            SpellTomeHook::GetSingleton()->SetSettings(tomeSettings);
            logger::info("UIManager: Applied SpellTomeHook settings from save");
        }
        
        // Update notification settings if changed
        if (newConfig.contains("notifications") && !newConfig["notifications"].is_null()) {
            auto& notifConfig = newConfig["notifications"];
            auto* castHandler = SpellCastHandler::GetSingleton();
            castHandler->SetWeakenedNotificationsEnabled(SafeJsonValue<bool>(notifConfig, "weakenedSpellNotifications", true));
            castHandler->SetNotificationInterval(SafeJsonValue<float>(notifConfig, "weakenedSpellInterval", 10.0f));
            logger::info("UIManager: Applied notification settings from save - interval: {}s", 
                castHandler->GetNotificationInterval());
        }
        
        // Write merged config
        std::ofstream file(path);
        file << existingConfig.dump(2);  // Pretty print with 2 space indent
        
        logger::info("UIManager: Unified config saved to {}", path.string());
        
        // Also update OpenRouter if LLM settings changed
        if (newConfig.contains("llm") && !newConfig["llm"].is_null()) {
            auto& llm = newConfig["llm"];
            auto& config = OpenRouterAPI::GetConfig();
            
            std::string newKey = SafeJsonValue<std::string>(llm, "apiKey", "");
            if (!newKey.empty() && newKey.find("...") == std::string::npos) {
                config.apiKey = newKey;
            }
            config.model = SafeJsonValue<std::string>(llm, "model", config.model);
            config.maxTokens = SafeJsonValue<int>(llm, "maxTokens", config.maxTokens);
            
            // Save to OpenRouter's config file too for compatibility
            OpenRouterAPI::SaveConfig();
        }
        
    } catch (const std::exception& e) {
        logger::error("UIManager: Failed to save unified config: {}", e.what());
    }
}

// =============================================================================
// CLIPBOARD FUNCTIONS (Windows API)
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

void UIManager::OnCopyToClipboard(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: CopyToClipboard - no content provided");
        return;
    }

    logger::info("UIManager: CopyToClipboard ({} bytes)", strlen(argument));

    auto* instance = GetSingleton();
    bool success = false;

    // Use Windows clipboard API
    if (OpenClipboard(nullptr)) {
        EmptyClipboard();

        // Calculate size needed (including null terminator)
        size_t len = strlen(argument) + 1;
        HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, len);
        
        if (hMem) {
            char* pMem = static_cast<char*>(GlobalLock(hMem));
            if (pMem) {
                memcpy(pMem, argument, len);
                GlobalUnlock(hMem);
                
                if (SetClipboardData(CF_TEXT, hMem)) {
                    success = true;
                    logger::info("UIManager: Successfully copied to clipboard");
                } else {
                    logger::error("UIManager: SetClipboardData failed");
                    GlobalFree(hMem);
                }
            } else {
                logger::error("UIManager: GlobalLock failed");
                GlobalFree(hMem);
            }
        } else {
            logger::error("UIManager: GlobalAlloc failed");
        }

        CloseClipboard();
    } else {
        logger::error("UIManager: OpenClipboard failed");
    }

    instance->NotifyCopyComplete(success);
}

void UIManager::OnGetClipboard(const char* argument)
{
    logger::info("UIManager: GetClipboard callback triggered");

    auto* instance = GetSingleton();
    std::string content;

    // Use Windows clipboard API
    if (OpenClipboard(nullptr)) {
        HANDLE hData = GetClipboardData(CF_TEXT);
        
        if (hData) {
            char* pszText = static_cast<char*>(GlobalLock(hData));
            if (pszText) {
                content = pszText;
                GlobalUnlock(hData);
                logger::info("UIManager: Read {} bytes from clipboard", content.size());
            } else {
                logger::warn("UIManager: GlobalLock failed on clipboard data");
            }
        } else {
            logger::warn("UIManager: No text data in clipboard");
        }

        CloseClipboard();
    } else {
        logger::error("UIManager: OpenClipboard failed");
    }

    // Send content to UI (even if empty)
    instance->SendClipboardContent(content);
}

// =============================================================================
// LLM INTEGRATION (OpenRouter)
// =============================================================================

void UIManager::OnCheckLLM(const char* argument)
{
    logger::info("UIManager: CheckLLM callback triggered (OpenRouter mode)");
    
    auto* instance = GetSingleton();
    
    // Initialize OpenRouter API
    bool hasApiKey = OpenRouterAPI::Initialize();
    
    json result;
    result["available"] = hasApiKey;
    result["version"] = hasApiKey ? "OpenRouter: " + OpenRouterAPI::GetConfig().model : "No API key";
    
    if (!hasApiKey) {
        logger::warn("UIManager: OpenRouter API key not configured. Edit: Data/SKSE/Plugins/SpellLearning/openrouter_config.json");
    } else {
        logger::info("UIManager: OpenRouter ready with model: {}", OpenRouterAPI::GetConfig().model);
    }
    
    // Send result to UI
    instance->m_prismaUI->InteropCall(instance->m_view, "onLLMStatus", result.dump().c_str());
}

void UIManager::OnLLMGenerate(const char* argument)
{
    logger::info("UIManager: LLM Generate callback triggered (OpenRouter mode)");
    
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: LLM Generate - no data provided");
        return;
    }
    
    auto* instance = GetSingleton();
    
    try {
        json request = json::parse(argument);
        
        std::string schoolName = request.value("school", "");
        std::string spellData = request.value("spellData", "");
        std::string promptRules = request.value("promptRules", "");
        
        // Override config from request if provided
        auto& config = OpenRouterAPI::GetConfig();
        if (request.contains("model") && !request["model"].get<std::string>().empty()) {
            config.model = request["model"].get<std::string>();
            logger::info("UIManager: Using model from request: {}", config.model);
        }
        if (request.contains("maxTokens")) {
            config.maxTokens = request["maxTokens"].get<int>();
            logger::info("UIManager: Using maxTokens from request: {}", config.maxTokens);
        }
        if (request.contains("apiKey") && !request["apiKey"].get<std::string>().empty()) {
            std::string newKey = request["apiKey"].get<std::string>();
            if (newKey.find("...") == std::string::npos) {  // Not masked
                config.apiKey = newKey;
            }
        }
        
        // Get tree generation settings
        bool allowMultiplePrereqs = request.value("allowMultiplePrereqs", true);
        bool aggressiveValidation = request.value("aggressiveValidation", true);
        
        logger::info("UIManager: LLM generate request for school: {}, spellData length: {}, model: {}, maxTokens: {}, multiPrereqs: {}, aggressiveValidation: {}", 
                    schoolName, spellData.length(), config.model, config.maxTokens, allowMultiplePrereqs, aggressiveValidation);
        
        // Check if API key is configured
        if (config.apiKey.empty()) {
            json errorResponse;
            errorResponse["status"] = "error";
            errorResponse["school"] = schoolName;
            errorResponse["message"] = "API key not configured - check Settings";
            instance->m_prismaUI->InteropCall(instance->m_view, "onLLMQueued", errorResponse.dump().c_str());
            return;
        }
        
        // Notify UI that we're processing
        json queuedResponse;
        queuedResponse["status"] = "queued";
        queuedResponse["school"] = schoolName;
        queuedResponse["message"] = "Sending to OpenRouter...";
        instance->m_prismaUI->InteropCall(instance->m_view, "onLLMQueued", queuedResponse.dump().c_str());
        
        // Build prompts
        std::string systemPrompt = R"(You are a Skyrim spell tree architect. Your task is to create a logical spell learning tree for a single magic school. You MUST return ONLY valid JSON - no explanations, no markdown code blocks, just raw JSON.

## OUTPUT FORMAT

Return ONLY this JSON structure:

{
  "version": "1.0",
  "schools": {
    "SCHOOL_NAME": {
      "root": "0xFORMID",
      "layoutStyle": "radial",
      "nodes": [
        {
          "formId": "0xFORMID",
          "children": ["0xCHILD1"],
          "prerequisites": [],
          "tier": 1
        }
      ]
    }
  }
}

## LAYOUT STYLES - Choose one per school based on tree structure:
- radial: Nodes spread in a fan pattern. Best for balanced trees with many branches (2-3 children per node)
- focused: Nodes stay close to center line. Best for linear progressions with few branches
- clustered: Related spells group together. Best for trees with clear thematic divisions (elements, spell families)
- cascading: Nodes cascade in staggered columns. Best for deep trees with many tiers
- organic: Slightly varied positions for natural feel. Best for mixed/modded spell collections

## CRITICAL RULES
1. Use ONLY formIds from the spell data - copy them EXACTLY
2. Every spell MUST appear exactly ONCE
3. Each school has exactly ONE root spell (prerequisites=[])
4. Maximum 3 children per node
5. Same-tier branching allowed (Novice can unlock Novice)
6. NEVER put a spell as its own prerequisite (no self-references!)
7. Choose layoutStyle based on how you structured the tree
8. AVOID long linear chains (A->B->C->D->...) - prefer branching trees where nodes have 2-3 children
9. Group similar spell variants (e.g. Locust I, II, III) under a common parent rather than in a chain
10. Return raw JSON ONLY - no markdown, no explanations
11. EVERY spell MUST be reachable from the root! There must be a valid unlock path from root to EVERY spell
12. NO PREREQUISITE CYCLES! Never create circular dependencies (A->B->C->A). The tree must be a DAG (directed acyclic graph)
13. Children array defines unlock paths - a spell's children can be unlocked AFTER the parent is unlocked
14. If a spell has multiple prerequisites, ALL of those prerequisites must be independently reachable from root)";

        // Add multiple prerequisite encouragement if enabled
        if (allowMultiplePrereqs) {
            systemPrompt += R"(

## MULTIPLE PREREQUISITES (ENABLED)
You are ENCOURAGED to design spells with MULTIPLE prerequisites to create interesting unlock choices:
- Expert/Master spells should often require 2 prerequisites (convergence points)
- Example: "Firestorm" requires BOTH "Fireball" AND "Fire Rune" to unlock
- This creates branching unlock paths where players must master multiple spell lines
- Aim for 20-30% of non-root spells to have 2 prerequisites
- Never more than 3 prerequisites per spell
- All prerequisites must be reachable from root independently)";
        }

        // Add validation rules based on setting
        if (!aggressiveValidation) {
            systemPrompt += R"(

## RELAXED VALIDATION
You have more freedom in tree design:
- Cross-tier connections allowed (Adept spell can lead to Apprentice)
- Some experimental/unusual unlock paths are acceptable
- Focus on thematic connections over strict tier progression)";
        }

        // Check request type
        bool isCorrection = request.value("isCorrection", false);
        bool isColorSuggestion = request.value("isColorSuggestion", false);
        std::string correctionPrompt = request.value("correctionPrompt", "");
        
        std::string userPrompt;
        std::string effectiveSystemPrompt = systemPrompt;
        
        if (isColorSuggestion) {
            // Color suggestion mode - simple prompt, no system context needed
            effectiveSystemPrompt = "You are a helpful assistant. Respond only with valid JSON.";
            userPrompt = promptRules;  // The full prompt is in promptRules for color suggestions
            logger::info("UIManager: Color suggestion request");
        } else if (isCorrection && !correctionPrompt.empty()) {
            // Correction mode - use the correction prompt directly
            userPrompt = correctionPrompt;
            logger::info("UIManager: Correction request for {}", schoolName);
        } else {
            // Normal generation mode
            userPrompt = "Create a spell learning tree for the " + schoolName + " school of magic.\n\n";
            
            if (!promptRules.empty()) {
                userPrompt += "## USER RULES\n" + promptRules + "\n\n";
            }
            
            userPrompt += "## SPELL DATA FOR " + schoolName + "\n\n" + spellData;
        }
        
        logger::info("UIManager: Sending to OpenRouter, system prompt length: {}, user prompt length: {}", 
                    effectiveSystemPrompt.length(), userPrompt.length());
        
        // Send async request to OpenRouter
        OpenRouterAPI::SendPromptAsync(effectiveSystemPrompt, userPrompt, 
            [instance, schoolName](const OpenRouterAPI::Response& response) {
                json result;
                
                if (response.success) {
                    result["hasResponse"] = true;
                    result["success"] = 1;
                    result["response"] = response.content;
                    logger::info("UIManager: OpenRouter success for {}, response length: {}", 
                                schoolName, response.content.length());
                } else {
                    result["hasResponse"] = true;
                    result["success"] = 0;
                    result["response"] = response.error;
                    logger::error("UIManager: OpenRouter error for {}: {}", schoolName, response.error);
                }
                
                instance->m_prismaUI->InteropCall(instance->m_view, "onLLMPollResult", result.dump().c_str());
            });
        
    } catch (const std::exception& e) {
        logger::error("UIManager: LLM Generate exception: {}", e.what());
        
        json errorResult;
        errorResult["hasResponse"] = true;
        errorResult["success"] = 0;
        errorResult["response"] = std::string("Exception: ") + e.what();
        instance->m_prismaUI->InteropCall(instance->m_view, "onLLMPollResult", errorResult.dump().c_str());
    }
}

void UIManager::OnPollLLMResponse(const char* argument)
{
    auto* instance = GetSingleton();
    
    std::filesystem::path responsePath = "Data/SKSE/Plugins/SpellLearning/llm_response.json";
    
    json result;
    result["hasResponse"] = false;
    
    if (std::filesystem::exists(responsePath)) {
        try {
            std::ifstream file(responsePath);
            std::string content((std::istreambuf_iterator<char>(file)),
                               std::istreambuf_iterator<char>());
            file.close();
            
            if (!content.empty()) {
                // Papyrus writes format: "success|response"
                // Where success is 0 or 1, and response is the LLM JSON
                size_t delimPos = content.find('|');
                
                if (delimPos != std::string::npos) {
                    std::string successStr = content.substr(0, delimPos);
                    std::string response = content.substr(delimPos + 1);
                    
                    int success = 0;
                    try {
                        success = std::stoi(successStr);
                    } catch (...) {
                        logger::warn("UIManager: Failed to parse success value: {}", successStr);
                    }
                    
                    result["hasResponse"] = true;
                    result["success"] = success;
                    result["response"] = response;
                    
                    logger::info("UIManager: Found LLM response, success={}, length={}", 
                                success, response.length());
                    
                    // Clear the response file after reading
                    std::ofstream clearFile(responsePath);
                    clearFile << "";
                    clearFile.close();
                } else {
                    logger::warn("UIManager: Response missing delimiter, content: {}", 
                                content.substr(0, 50));
                }
            }
        } catch (const std::exception& e) {
            logger::warn("UIManager: Failed to read LLM response: {}", e.what());
        }
    }
    
    instance->m_prismaUI->InteropCall(instance->m_view, "onLLMPollResult", result.dump().c_str());
}

// =============================================================================
// LLM CONFIG (OpenRouter)
// =============================================================================

void UIManager::OnLoadLLMConfig(const char* argument)
{
    logger::info("UIManager: LoadLLMConfig callback triggered");
    
    auto* instance = GetSingleton();
    
    // Initialize OpenRouter (loads config from file)
    OpenRouterAPI::Initialize();
    
    auto& config = OpenRouterAPI::GetConfig();
    
    json result;
    result["apiKey"] = config.apiKey;  // Will be masked in JS
    result["model"] = config.model;
    result["maxTokens"] = config.maxTokens;
    
    instance->m_prismaUI->InteropCall(instance->m_view, "onLLMConfigLoaded", result.dump().c_str());
    
    logger::info("UIManager: LLM config sent to UI, hasKey: {}", !config.apiKey.empty());
}

void UIManager::OnSaveLLMConfig(const char* argument)
{
    logger::info("UIManager: SaveLLMConfig callback triggered");
    
    auto* instance = GetSingleton();
    
    json result;
    result["success"] = false;
    
    try {
        json request = json::parse(argument);
        
        auto& config = OpenRouterAPI::GetConfig();
        
        // Only update API key if a new one was provided
        std::string newKey = SafeJsonValue<std::string>(request, "apiKey", "");
        if (!newKey.empty() && newKey.find("...") == std::string::npos) {
            config.apiKey = newKey;
            logger::info("UIManager: Updated API key, length: {}", newKey.length());
        }
        
        // Always update model
        config.model = SafeJsonValue<std::string>(request, "model", config.model);
        
        // Save to file
        OpenRouterAPI::SaveConfig();
        
        result["success"] = true;
        logger::info("UIManager: LLM config saved, model: {}", config.model);
        
    } catch (const std::exception& e) {
        result["error"] = e.what();
        logger::error("UIManager: Failed to save LLM config: {}", e.what());
    }
    
    instance->m_prismaUI->InteropCall(instance->m_view, "onLLMConfigSaved", result.dump().c_str());
}

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
// PROCEDURAL PYTHON GENERATION
// =============================================================================

void UIManager::OnProceduralPythonGenerate(const char* argument)
{
    logger::info("UIManager: ProceduralPythonGenerate callback triggered");
    
    auto* instance = GetSingleton();
    if (!instance || !instance->m_prismaUI) return;
    
    auto startTime = std::chrono::high_resolution_clock::now();
    
    try {
        // Parse incoming request
        nlohmann::json request = nlohmann::json::parse(argument);
        auto spells = request.value("spells", nlohmann::json::array());
        auto config = request.value("config", nlohmann::json::object());
        
        logger::info("UIManager: Processing {} spells with Python", spells.size());
        
        // Get paths
        auto dataPath = std::filesystem::path("Data/SKSE/Plugins/SpellLearning");
        std::filesystem::create_directories(dataPath);
        
        auto inputPath = dataPath / "procedural_input.json";
        auto outputPath = dataPath / "procedural_output.json";
        
        // Write input file (just the spells array wrapped for the tool)
        nlohmann::json inputData;
        inputData["spells"] = spells;
        
        {
            std::ofstream inputFile(inputPath);
            if (!inputFile.is_open()) {
                throw std::runtime_error("Failed to create input file");
            }
            inputFile << inputData.dump();
        }
        
        // Write config file (full config including LLM options, shape, etc.)
        auto configPath = dataPath / "procedural_config.json";
        {
            std::ofstream configFile(configPath);
            if (!configFile.is_open()) {
                throw std::runtime_error("Failed to create config file");
            }
            configFile << config.dump();
            logger::info("UIManager: Config written: {}", config.dump().substr(0, 200));
        }
        
        // Build Python command
        // Tool location relative to game Data folder
        std::string pythonScript = "Data/SKSE/Plugins/SpellLearning/SpellTreeBuilder/build_tree.py";
        
        // Check if the tool exists in the expected location
        if (!std::filesystem::exists(pythonScript)) {
            // Try alternate location (development)
            pythonScript = "SpellTreeBuilder/build_tree.py";
        }
        
        // Build command line with config file
        std::string cmd = "python \"" + pythonScript + "\"";
        cmd += " -i \"" + inputPath.string() + "\"";
        cmd += " -o \"" + outputPath.string() + "\"";
        cmd += " --config \"" + configPath.string() + "\"";
        
        logger::info("UIManager: Executing: {}", cmd);
        
        // Execute Python
        int result = std::system(cmd.c_str());
        
        if (result != 0) {
            throw std::runtime_error("Python script failed with code " + std::to_string(result));
        }
        
        // Read output
        if (!std::filesystem::exists(outputPath)) {
            throw std::runtime_error("Python did not create output file");
        }
        
        std::string treeJson;
        {
            std::ifstream outputFile(outputPath);
            if (!outputFile.is_open()) {
                throw std::runtime_error("Failed to read output file");
            }
            std::stringstream buffer;
            buffer << outputFile.rdbuf();
            treeJson = buffer.str();
        }
        
        // Calculate elapsed time
        auto endTime = std::chrono::high_resolution_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime).count() / 1000.0;
        
        // Clean up temp files
        std::filesystem::remove(inputPath);
        std::filesystem::remove(outputPath);
        std::filesystem::remove(configPath);
        
        // Send success response
        nlohmann::json response;
        response["success"] = true;
        response["treeData"] = treeJson;
        response["elapsed"] = elapsed;
        
        logger::info("UIManager: Python procedural generation completed in {:.2f}s", elapsed);
        instance->m_prismaUI->InteropCall(instance->m_view, "onProceduralPythonComplete", response.dump().c_str());
        
    } catch (const std::exception& e) {
        logger::error("UIManager: Python procedural generation failed: {}", e.what());
        
        nlohmann::json response;
        response["success"] = false;
        response["error"] = e.what();
        
        instance->m_prismaUI->InteropCall(instance->m_view, "onProceduralPythonComplete", response.dump().c_str());
    }
}

// =============================================================================
// PANEL CONTROL CALLBACKS
// =============================================================================

void UIManager::OnHidePanel(const char* argument)
{
    logger::info("UIManager: HidePanel callback triggered from JS");
    GetSingleton()->HidePanel();
}

// =============================================================================
// DEST DETECTION NOTIFICATION
// =============================================================================

void UIManager::NotifyISLDetectionStatus()
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
