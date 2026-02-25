#include "Common.h"
#include "uimanager/UIManager.h"
#include "SpellScanner.h"
#include "SpellCastHandler.h"
#include "ProgressionManager.h"
#include "ISLIntegration.h"
#include "XPSource.h"
#include "SpellCastXPSource.h"
#include "PassiveLearningSource.h"
#include "SpellEffectivenessHook.h"
#include "SpellTomeHook.h"
#include "PapyrusAPI.h"
#include "SpellLearningAPI.h"

// =============================================================================
// SPELL LEARNING API IMPLEMENTATION (for SKSE inter-plugin messaging)
// =============================================================================

class SpellLearningAPIImpl : public SpellLearning::ISpellLearningAPI
{
public:
    static SpellLearningAPIImpl* GetSingleton()
    {
        static SpellLearningAPIImpl singleton;
        return &singleton;
    }

    uint32_t GetAPIVersion() const override { return SpellLearning::kAPIVersion; }

    float AddSourcedXP(uint32_t spellFormID, float amount, const std::string& sourceName) override
    {
        return ProgressionManager::GetSingleton()->AddSourcedXP(
            static_cast<RE::FormID>(spellFormID), amount, sourceName);
    }

    float AddRawXP(uint32_t spellFormID, float amount) override
    {
        return ProgressionManager::GetSingleton()->AddRawXP(
            static_cast<RE::FormID>(spellFormID), amount);
    }

    void SetSpellXP(uint32_t spellFormID, float xp) override
    {
        ProgressionManager::GetSingleton()->SetSpellXP(
            static_cast<RE::FormID>(spellFormID), xp);
    }

    bool IsSpellMastered(uint32_t spellFormID) const override
    {
        return ProgressionManager::GetSingleton()->IsSpellMastered(
            static_cast<RE::FormID>(spellFormID));
    }

    bool IsSpellAvailableToLearn(uint32_t spellFormID) const override
    {
        return ProgressionManager::GetSingleton()->IsSpellAvailableToLearn(
            static_cast<RE::FormID>(spellFormID));
    }

    float GetRequiredXP(uint32_t spellFormID) const override
    {
        return ProgressionManager::GetSingleton()->GetRequiredXP(
            static_cast<RE::FormID>(spellFormID));
    }

    float GetProgress(uint32_t spellFormID) const override
    {
        auto progress = ProgressionManager::GetSingleton()->GetProgress(
            static_cast<RE::FormID>(spellFormID));
        return progress.progressPercent * 100.0f;
    }

    uint32_t GetLearningTarget(const std::string& school) const override
    {
        return static_cast<uint32_t>(
            ProgressionManager::GetSingleton()->GetLearningTarget(school));
    }

    void SetLearningTarget(uint32_t spellFormID) override
    {
        auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(
            static_cast<RE::FormID>(spellFormID));
        if (spell) {
            std::stringstream ss;
            ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << spellFormID;
            ProgressionManager::GetSingleton()->SetLearningTargetFromTome(ss.str(), spell);
        }
    }

    void ClearLearningTarget(const std::string& school) override
    {
        ProgressionManager::GetSingleton()->ClearLearningTarget(school);
    }

    float GetGlobalMultiplier() const override
    {
        return ProgressionManager::GetSingleton()->GetXPSettings().globalMultiplier;
    }

    bool RegisterXPSource(const std::string& sourceId, const std::string& displayName) override
    {
        return ProgressionManager::GetSingleton()->RegisterModdedXPSource(sourceId, displayName);
    }

private:
    SpellLearningAPIImpl() = default;
};

// Handle incoming SKSE messages from other plugins
void OnExternalPluginMessage(SKSE::MessagingInterface::Message* a_msg)
{
    if (!a_msg) return;

    switch (a_msg->type) {
        case SpellLearning::kMessageType_RequestAPI: {
            logger::info("SpellLearning: API requested by external plugin");
            auto* api = SpellLearningAPIImpl::GetSingleton();
            SKSE::GetMessagingInterface()->Dispatch(
                SpellLearning::kMessageType_RequestAPI,
                api, sizeof(void*), nullptr);
            break;
        }
        case SpellLearning::kMessageType_AddXP: {
            if (a_msg->dataLen >= sizeof(SpellLearning::AddXPMessage)) {
                auto* msg = static_cast<SpellLearning::AddXPMessage*>(a_msg->data);
                std::string sourceName;

                switch (msg->sourceType) {
                    case SpellLearning::XPSourceType::Any:    sourceName = "any"; break;
                    case SpellLearning::XPSourceType::School: sourceName = "school"; break;
                    case SpellLearning::XPSourceType::Direct: sourceName = "direct"; break;
                    case SpellLearning::XPSourceType::Self:   sourceName = "self"; break;
                    case SpellLearning::XPSourceType::Raw:
                        ProgressionManager::GetSingleton()->AddRawXP(
                            static_cast<RE::FormID>(msg->spellFormID), msg->amount);
                        return;
                    case SpellLearning::XPSourceType::Custom:
                        sourceName = msg->sourceName;
                        break;
                    default:
                        logger::warn("SpellLearning: External AddXP with unknown sourceType {}",
                            static_cast<uint32_t>(msg->sourceType));
                        return;
                }

                ProgressionManager::GetSingleton()->AddSourcedXP(
                    static_cast<RE::FormID>(msg->spellFormID), msg->amount, sourceName);
                logger::info("SpellLearning: External AddXP({:08X}, {:.1f}, '{}')",
                    msg->spellFormID, msg->amount, sourceName);
            }
            break;
        }
        case SpellLearning::kMessageType_RegisterSource: {
            if (a_msg->dataLen >= sizeof(SpellLearning::RegisterSourceMessage)) {
                auto* msg = static_cast<SpellLearning::RegisterSourceMessage*>(a_msg->data);
                ProgressionManager::GetSingleton()->RegisterModdedXPSource(
                    msg->sourceId, msg->displayName);
                logger::info("SpellLearning: External RegisterSource('{}', '{}')",
                    msg->sourceId, msg->displayName);
            }
            break;
        }
    }
}

// =============================================================================
// INPUT HANDLER - Configurable Hotkey
// =============================================================================

class InputHandler : public RE::BSTEventSink<RE::InputEvent*>
{
public:
    static InputHandler* GetSingleton()
    {
        static InputHandler singleton;
        return &singleton;
    }

    void Register()
    {
        auto* inputManager = RE::BSInputDeviceManager::GetSingleton();
        if (inputManager) {
            inputManager->AddEventSink(this);
            logger::info("Input handler registered with hotkey code: {}", m_hotkeyCode);
        }
    }
    
    void SetHotkeyCode(uint32_t code)
    {
        m_hotkeyCode = code;
        logger::info("InputHandler: Hotkey code updated to {}", code);
    }
    
    uint32_t GetHotkeyCode() const { return m_hotkeyCode; }

    RE::BSEventNotifyControl ProcessEvent(
        RE::InputEvent* const* a_event,
        RE::BSTEventSource<RE::InputEvent*>*) override
    {
        if (!a_event) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // PERFORMANCE: Single pass through events, exit early when possible
        for (auto* event = *a_event; event; event = event->next) {
            // Skip non-button events immediately
            if (event->eventType != RE::INPUT_EVENT_TYPE::kButton) {
                continue;
            }

            auto* buttonEvent = static_cast<RE::ButtonEvent*>(event);
            
            // PERFORMANCE: Check device first (cheapest check)
            if (buttonEvent->device != RE::INPUT_DEVICE::kKeyboard) {
                continue;
            }
            
            // PERFORMANCE: Check key code before IsDown (idCode is a simple member access)
            if (buttonEvent->idCode != m_hotkeyCode) {
                continue;
            }
            
            // Only process key down events
            if (!buttonEvent->IsDown()) {
                continue;
            }

            // Matched! Toggle the panel
            logger::info("Hotkey {} pressed - toggling Spell Learning Panel", m_hotkeyCode);
            UIManager::GetSingleton()->TogglePanel();
            break;  // Only process one hotkey event per frame to prevent double-toggle
        }

        return RE::BSEventNotifyControl::kContinue;
    }

private:
    InputHandler() : m_hotkeyCode(66) {}  // Default F8 = 66
    ~InputHandler() = default;
    InputHandler(const InputHandler&) = delete;
    InputHandler& operator=(const InputHandler&) = delete;
    
    uint32_t m_hotkeyCode;
};

// Global function to update hotkey (called from UIManager)
void UpdateInputHandlerHotkey(uint32_t keyCode)
{
    InputHandler::GetSingleton()->SetHotkeyCode(keyCode);
}

// =============================================================================
// SKSE SERIALIZATION CALLBACKS (Co-save)
// =============================================================================

constexpr uint32_t kSerializationUniqueID = 'SPLL';  // Spell Learning

void OnGameSaved(SKSE::SerializationInterface* a_intfc)
{
    logger::info("SKSE Serialization: Game saved");
    ProgressionManager::GetSingleton()->OnGameSaved(a_intfc);
    SpellEffectivenessHook::GetSingleton()->OnGameSaved(a_intfc);
    // NOTE: DEST registrations are NOT serialized to co-save.
    // They are re-established on each load via AutoRegisterISLAliases()
    // in OnPostLoadGame, since OnInit() only fires once per save creation.
}

void OnGameLoaded(SKSE::SerializationInterface* a_intfc)
{
    logger::info("SKSE Serialization: Game loaded");
    ProgressionManager::GetSingleton()->OnGameLoaded(a_intfc);
    SpellEffectivenessHook::GetSingleton()->OnGameLoaded(a_intfc);
    // NOTE: DEST registrations are handled via AutoRegisterISLAliases()
    // in OnPostLoadGame, not through serialization.
}

void OnRevert(SKSE::SerializationInterface* a_intfc)
{
    logger::info("SKSE Serialization: Reverting (new game or loading different save)");
    ProgressionManager::GetSingleton()->OnRevert(a_intfc);
    SpellEffectivenessHook::GetSingleton()->OnRevert(a_intfc);
    // NOTE: Do NOT revert DEST registrations here.
    // AutoRegisterISLAliases() in OnPostLoadGame will re-establish them.
    // Reverting would clear them, and since OnInit() only fires once per
    // save creation, they'd never come back until the next load.
}

// =============================================================================
// SKSE MESSAGE HANDLER
// =============================================================================

void OnDataLoaded()
{
    logger::info("Data loaded (main menu) - initializing systems");
    
    // Initialize UI Manager (connects to PrismaUI)
    if (UIManager::GetSingleton()->Initialize()) {
        logger::info("UIManager initialized successfully");
        
        // Reset tree states on main menu load - all spells start locked
        UIManager::GetSingleton()->NotifyMainMenuLoaded();
    } else {
        logger::error("Failed to initialize UIManager - PrismaUI may not be loaded");
    }

    // Register input handler for hotkey
    InputHandler::GetSingleton()->Register();
    
    // Register spell cast event handler for XP tracking
    SpellCastHandler::GetSingleton()->Register();
    logger::info("SpellCastHandler registered for XP tracking");
    
    // Initialize ISL/DEST integration (detects DEST_ISL.esp and enables event dispatch)
    DESTIntegration::Initialize();
    
    // Register and initialize XP sources
    auto& registry = SpellLearning::XPSourceRegistry::GetSingleton();
    registry.Register<SpellLearning::SpellCastXPSource>();
    registry.Register<SpellLearning::PassiveLearningSource>();
    registry.InitializeAll();
    logger::info("XP sources registered: {} total, {} active", 
                 registry.GetAll().size(), registry.GetActive().size());
}

void OnNewGame()
{
    logger::info("New game started - progression will be cleared");
    // Progress is automatically cleared by OnRevert callback

    // Fix input lock if UI was open in main menu
    if (UIManager::GetSingleton()->IsInitialized()) {
        UIManager::GetSingleton()->EnsureFocusReleased();
    }

    // Reset passive learning timer
    auto* passive = SpellLearning::PassiveLearningSource::GetSingleton();
    if (passive) passive->OnGameLoad();
}

void OnPostLoadGame()
{
    logger::info("Save game loaded - notifying UI to refresh player data");
    // Progress is automatically loaded by OnGameLoaded serialization callback

    // Fix input/focus state that may be left bad by other mods or previous session
    if (UIManager::GetSingleton()->IsInitialized()) {
        UIManager::GetSingleton()->EnsureFocusReleased();
    }

    // Reset passive learning timer for loaded save
    auto* passive = SpellLearning::PassiveLearningSource::GetSingleton();
    if (passive) passive->OnGameLoad();

    // Re-register ISL aliases every save load.
    // OnInit() only fires once per save creation (not on load), so on fresh
    // game launch → existing save, g_spellTomeEventRegs is empty.
    // AutoRegisterISLAliases scans DEST_ISL quests for player aliases and
    // registers them so spell tome read events dispatch correctly.
    DESTIntegration::AutoRegisterISLAliases();

    // Notify UI to refresh - this will:
    // 1. Reset tree states to locked/available
    // 2. Request fresh progress data from co-save
    // 3. Check which spells the player knows
    if (UIManager::GetSingleton()->IsInitialized()) {
        UIManager::GetSingleton()->NotifySaveGameLoaded();
    }
}

void MessageHandler(SKSE::MessagingInterface::Message* a_msg)
{
    switch (a_msg->type) {
        case SKSE::MessagingInterface::kPostLoad:
            // Install hooks after all plugins are loaded but before game data
            SpellEffectivenessHook::Install();
            SpellEffectivenessHook::InstallDisplayHooks();

            // Install spell tome hook (intercepts book reading)
            if (SpellTomeHook::Install()) {
                logger::info("SpellTomeHook installed - spell tome interception active");
            } else {
                logger::error("SpellTomeHook failed to install - spell tomes will use vanilla behavior");
            }
            break;
        case SKSE::MessagingInterface::kPostPostLoad: {
            // Broadcast API to all listening plugins
            // Consumers register with: messaging->RegisterListener("SpellLearning", callback)
            auto* api = SpellLearningAPIImpl::GetSingleton();
            SKSE::GetMessagingInterface()->Dispatch(
                SpellLearning::kMessageType_APIReady,
                api, sizeof(void*), nullptr);
            logger::info("SpellLearning: API broadcasted to all listeners (v{})", api->GetAPIVersion());
            break;
        }
        case SKSE::MessagingInterface::kDataLoaded:
            OnDataLoaded();
            break;
        case SKSE::MessagingInterface::kNewGame:
            OnNewGame();
            break;
        case SKSE::MessagingInterface::kPostLoadGame:
            OnPostLoadGame();
            break;
    }
}

// =============================================================================
// SKSE PLUGIN LOAD
// =============================================================================

SKSEPluginLoad(const SKSE::LoadInterface* a_skse)
{
    SKSE::Init(a_skse, false);
    SetupLog();

    // Register messaging interface
    auto messaging = SKSE::GetMessagingInterface();
    if (!messaging->RegisterListener(MessageHandler)) {
        logger::error("Failed to register messaging listener");
        return false;
    }

    logger::info("SpellLearning: API will be broadcasted at kPostPostLoad for addon plugins");
    
    // Register serialization interface (co-save)
    auto serialization = SKSE::GetSerializationInterface();
    if (serialization) {
        serialization->SetUniqueID(kSerializationUniqueID);
        serialization->SetSaveCallback(OnGameSaved);
        serialization->SetLoadCallback(OnGameLoaded);
        serialization->SetRevertCallback(OnRevert);
        logger::info("SKSE Serialization interface registered (co-save enabled)");
    } else {
        logger::error("Failed to get SKSE serialization interface - co-save disabled!");
    }
    
    // Register Papyrus API functions for other mods to call
    auto papyrus = SKSE::GetPapyrusInterface();
    if (papyrus) {
        papyrus->Register(PapyrusAPI::RegisterFunctions);
        logger::info("Papyrus API registered - other mods can call SpellLearning.OpenMenu() etc.");
        
        // Register DEST_AliasExt native functions (ISL compatibility)
        // This provides the same API that DontEatSpellTomes.dll exposes,
        // allowing ISL's unmodified Papyrus scripts to work with our hook.
        papyrus->Register(DESTIntegration::RegisterDESTAliasExtFunctions);
        papyrus->Register(DESTIntegration::RegisterPapyrusFunctions);
        logger::info("DEST/ISL Papyrus API registered - ISL compatibility active");
    } else {
        logger::error("Failed to get Papyrus interface - API functions unavailable");
    }

    logger::info("{} loaded successfully", SKSE::GetPluginName());
    return true;
}
