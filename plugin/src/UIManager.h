#pragma once

#include "PCH.h"
#include "PrismaUI_API.h"

class UIManager
{
public:
    static UIManager* GetSingleton();

    // Initialize PrismaUI connection
    bool Initialize();

    // Panel visibility (single panel with tabs)
    void TogglePanel();
    void ShowPanel();
    void HidePanel();
    bool IsPanelVisible() const { return m_isPanelVisible; }
    bool IsInitialized() const { return m_isInitialized; }

    // Send data to Scanner Tab
    void SendSpellData(const std::string& jsonData);
    void UpdateStatus(const std::string& message);
    void SendPrompt(const std::string& promptContent);
    void NotifyPromptSaved(bool success);

    // Send data to Tree Tab (same panel)
    void SendTreeData(const std::string& jsonData);
    void SendSpellInfo(const std::string& jsonData);
    void SendSpellInfoBatch(const std::string& jsonData);
    void SendValidationResult(const std::string& jsonData);
    void UpdateSpellState(const std::string& formId, const std::string& state);
    void UpdateTreeStatus(const std::string& message);

    // Clipboard support
    void SendClipboardContent(const std::string& content);
    void NotifyCopyComplete(bool success);

    // Progression system notifications
    void NotifyProgressUpdate(RE::FormID formId, float currentXP, float requiredXP);
    void NotifyProgressUpdate(const std::string& formIdStr);  // Triggers UI refresh for spell
    void NotifySpellReady(RE::FormID formId);
    void NotifySpellUnlocked(RE::FormID formId, bool success);
    void NotifyLearningTargetSet(const std::string& school, RE::FormID formId, const std::string& spellName);
    void NotifyLearningTargetCleared(RE::FormID formId);  // When a learning target is switched/cleared
    
    // Game state notifications
    void NotifyMainMenuLoaded();      // Called on kDataLoaded - reset tree states
    void NotifySaveGameLoaded();      // Called on kPostLoadGame - refresh player data
    void SendProgressData(const std::string& jsonData);
    
    // Focus management for main menu → game transition
    void EnsureFocusReleased();       // Call on game load to fix input lock
    
    // ISL integration notifications
    void NotifyISLDetectionStatus();  // Notify UI of ISL-DESTified mod detection

    // Get the PrismaUI API (for SpellScanner to use)
    PRISMA_UI_API::IVPrismaUI1* GetAPI() const { return m_prismaUI; }
    PrismaView GetView() const { return m_view; }

    // File paths
    static std::filesystem::path GetPromptFilePath();
    static std::filesystem::path GetTreeFilePath();

private:
    UIManager() = default;
    ~UIManager() = default;
    UIManager(const UIManager&) = delete;
    UIManager& operator=(const UIManager&) = delete;

    // PrismaUI callbacks - All on single view
    static void OnDomReady(PrismaView view);
    
    // Scanner tab callbacks
    static void OnScanSpells(const char* argument);
    static void OnSaveOutput(const char* argument);
    static void OnSaveOutputBySchool(const char* argument);
    static void OnLoadPrompt(const char* argument);
    static void OnSavePrompt(const char* argument);
    
    // Tree tab callbacks
    static void OnLoadSpellTree(const char* argument);
    static void OnGetSpellInfo(const char* argument);
    static void OnGetSpellInfoBatch(const char* argument);
    static void OnSaveSpellTree(const char* argument);
    
    // Progression callbacks
    static void OnSetLearningTarget(const char* argument);
    static void OnClearLearningTarget(const char* argument);
    static void OnUnlockSpell(const char* argument);
    static void OnGetProgress(const char* argument);
    static void OnCheatUnlockSpell(const char* argument);
    static void OnRelockSpell(const char* argument);
    static void OnSetSpellXP(const char* argument);
    static void OnGetPlayerKnownSpells(const char* argument);
    static void OnSetHotkey(const char* argument);
    static void OnSetPauseGameOnFocus(const char* argument);
    static void OnSetTreePrerequisites(const char* argument);
    
    // Settings callbacks (legacy)
    static void OnLoadSettings(const char* argument);
    static void OnSaveSettings(const char* argument);
    
    // Unified config callbacks
    static void OnLoadUnifiedConfig(const char* argument);
    static void OnSaveUnifiedConfig(const char* argument);

    // Clipboard callbacks
    static void OnCopyToClipboard(const char* argument);
    static void OnGetClipboard(const char* argument);

    // LLM integration callbacks (OpenRouter)
    static void OnCheckLLM(const char* argument);
    static void OnLLMGenerate(const char* argument);
    static void OnPollLLMResponse(const char* argument);
    static void OnLoadLLMConfig(const char* argument);
    static void OnSaveLLMConfig(const char* argument);
    static void OnLogMessage(const char* argument);
    
    // Procedural tree generation (Python)
    static void OnProceduralPythonGenerate(const char* argument);

    // Python setup callbacks
    static void OnSetupPython(const char* argument);
    static void OnCancelPythonSetup(const char* argument);

    // Panel control callbacks
    static void OnHidePanel(const char* argument);

    // Auto-test callbacks
    static void OnLoadTestConfig(const char* argument);
    static void OnSaveTestResults(const char* argument);

    // PrismaUI members
    PRISMA_UI_API::IVPrismaUI1* m_prismaUI = nullptr;
    PrismaView m_view = 0;
    bool m_isPanelVisible = false;
    bool m_isInitialized = false;
    bool m_hasFocus = false;  // Track if we have focus (for main menu → game fix)
    bool m_pauseGameOnFocus = false;  // Default false to avoid input conflicts with menu mods in heavy modlists

    // Check if Python addon (SpellTreeBuilder) is installed
    void CheckPythonAddonStatus();
    
public:
    // Settings
    void SetPauseGameOnFocus(bool pause) { m_pauseGameOnFocus = pause; }
    bool GetPauseGameOnFocus() const { return m_pauseGameOnFocus; }
};
