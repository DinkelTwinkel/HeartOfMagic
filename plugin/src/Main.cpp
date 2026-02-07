#include "PCH.h"
#include "UIManager.h"
#include "SpellScanner.h"
#include "SpellCastHandler.h"
#include "ProgressionManager.h"
#include "ISLIntegration.h"
#include "XPSource.h"
#include "SpellCastXPSource.h"
#include "SpellEffectivenessHook.h"
#include "SpellTomeHook.h"
#include "PapyrusAPI.h"

// =============================================================================
// LOGGING SETUP
// =============================================================================

void SetupLog()
{
    auto path = logger::log_directory();
    if (!path) {
        return;
    }

    *path /= PLUGIN_NAME ".log"sv;

    auto sink = std::make_shared<spdlog::sinks::basic_file_sink_mt>(path->string(), true);
    auto log = std::make_shared<spdlog::logger>("global log"s, std::move(sink));

    log->set_level(spdlog::level::info);
    log->flush_on(spdlog::level::info);

    spdlog::set_default_logger(std::move(log));
    spdlog::set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%l] %v");
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
            // Don't break - continue processing in case there are multiple hotkey events
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
}

void OnGameLoaded(SKSE::SerializationInterface* a_intfc)
{
    logger::info("SKSE Serialization: Game loaded");
    ProgressionManager::GetSingleton()->OnGameLoaded(a_intfc);
    SpellEffectivenessHook::GetSingleton()->OnGameLoaded(a_intfc);
}

void OnRevert(SKSE::SerializationInterface* a_intfc)
{
    logger::info("SKSE Serialization: Reverting (new game or loading different save)");
    ProgressionManager::GetSingleton()->OnRevert(a_intfc);
    SpellEffectivenessHook::GetSingleton()->OnRevert(a_intfc);
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
    
    // Note: ISLIntegration removed - SpellTomeHook now handles spell tome interception directly in C++
    
    // Register and initialize XP sources (spell casting only - tomes handled by SpellTomeHook)
    auto& registry = SpellLearning::XPSourceRegistry::GetSingleton();
    registry.Register<SpellLearning::SpellCastXPSource>();
    // Note: ISLTomeXPSource removed - SpellTomeHook grants XP directly
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
}

void OnPostLoadGame()
{
    logger::info("Save game loaded - notifying UI to refresh player data");
    // Progress is automatically loaded by OnGameLoaded serialization callback

    // Fix input/focus state that may be left bad by other mods or previous session
    if (UIManager::GetSingleton()->IsInitialized()) {
        UIManager::GetSingleton()->EnsureFocusReleased();
    }

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
// SKSE PLUGIN INFO
// =============================================================================

SKSEPluginInfo(
    .Version = { 1, 2, 5, 1 },
    .Name = "SpellLearning",
    .Author = "Spooky",
    .SupportEmail = "",
    .StructCompatibility = SKSE::StructCompatibility::Independent,
    .RuntimeCompatibility = SKSE::VersionIndependence::AddressLibrary
)

// =============================================================================
// SKSE PLUGIN LOAD
// =============================================================================

SKSEPluginLoad(const SKSE::LoadInterface* skse)
{
    SKSE::Init(skse);
    SetupLog();

    logger::info("{} v{} by {} loading...", PLUGIN_NAME, PLUGIN_VERSION, PLUGIN_AUTHOR);

    // Register messaging interface
    auto messaging = SKSE::GetMessagingInterface();
    if (!messaging->RegisterListener(MessageHandler)) {
        logger::error("Failed to register messaging listener");
        return false;
    }
    
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
    } else {
        logger::error("Failed to get Papyrus interface - API functions unavailable");
    }

    logger::info("{} loaded successfully", PLUGIN_NAME);
    return true;
}
