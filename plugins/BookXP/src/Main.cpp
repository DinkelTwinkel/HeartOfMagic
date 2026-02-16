// =============================================================================
// SL_BookXP - SpellLearning C++ API Test Plugin
// =============================================================================
// Grants spell learning XP when the player reads normal books.
// Demonstrates the SpellLearning C++ API:
//   1. Register for API broadcast from SpellLearning
//   2. Receive ISpellLearningAPI at kPostPostLoad
//   3. Use API to register XP source and grant XP
//
// No ESP required - pure SKSE DLL plugin.
// =============================================================================

#include "Common.h"

#include "SpellLearningAPI.h"

static constexpr float XP_PER_BOOK = 15.0f;
static constexpr const char* SOURCE_ID = "book_reading";
static constexpr const char* SOURCE_DISPLAY = "Book Reading";

// Cached API pointer (set when SpellLearning broadcasts at kPostPostLoad)
static SpellLearning::ISpellLearningAPI* g_api = nullptr;

// Track whether we've registered our source (do it once at kDataLoaded)
static bool g_sourceRegistered = false;

// =============================================================================
// LOGGING SETUP
// =============================================================================

static void SetupLog()
{
    logger::init();
    // pattern: [2024-01-01 12:00:00.000] [info] [1234] [sourcefile.cpp:123] Log message
    spdlog::set_pattern("[%Y-%m-%d %T.%e] [%l] [%t] [%s:%#] %v");
    spdlog::set_level(spdlog::level::info);
}

// =============================================================================
// BOOK MENU WATCHER
// =============================================================================
// Detects when the player opens any book via BookMenu.
// Normal books always open BookMenu. Spell tomes are intercepted by
// SpellLearning's SpellTomeHook before reaching BookMenu, so we only
// see non-spell-tome books here.

class BookMenuWatcher : public RE::BSTEventSink<RE::MenuOpenCloseEvent>
{
public:
    static BookMenuWatcher* GetSingleton()
    {
        static BookMenuWatcher instance;
        return &instance;
    }

    RE::BSEventNotifyControl ProcessEvent(
        const RE::MenuOpenCloseEvent* a_event,
        RE::BSTEventSource<RE::MenuOpenCloseEvent>*) override
    {
        if (!a_event || !a_event->opening) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // "Book Menu" is the vanilla menu name when opening a book
        if (a_event->menuName != RE::BookMenu::MENU_NAME) {
            return RE::BSEventNotifyControl::kContinue;
        }

        logger::info("SL_BookXP: BookMenu opened - book read detected!");

        if (g_api) {
            GrantXPViaAPI();
        } else {
            logger::warn("SL_BookXP: API not available, cannot grant XP");
        }

        return RE::BSEventNotifyControl::kContinue;
    }

private:
    BookMenuWatcher() = default;

    // Full API path - query targets and grant XP with source tracking
    static void GrantXPViaAPI()
    {
        logger::info("SL_BookXP: Granting XP via API");

        const char* schools[] = {
            "Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"
        };

        int granted = 0;
        for (const char* school : schools) {
            uint32_t targetId = g_api->GetLearningTarget(school);
            if (targetId != 0) {
                logger::info("SL_BookXP: Found learning target {:08X} for {}", targetId, school);
                float actual = g_api->AddSourcedXP(targetId, XP_PER_BOOK, SOURCE_ID);
                if (actual > 0.0f) {
                    logger::info("SL_BookXP: Granted {:.1f} XP to {:08X} ({})",
                        actual, targetId, school);
                    granted++;
                } else {
                    logger::info("SL_BookXP: XP capped for {:08X} ({}) - returned {:.1f}",
                        targetId, school, actual);
                }
            }
        }

        if (granted > 0) {
            auto msg = fmt::format("[BookXP] +{:.0f} XP to {} spell(s)", XP_PER_BOOK, granted);
            RE::SendHUDMessage::ShowHUDMessage(msg.c_str());
            logger::info("SL_BookXP: {}", msg);
        } else {
            logger::info("SL_BookXP: No active learning targets");
        }
    }
};

// =============================================================================
// SKSE MESSAGE HANDLERS
// =============================================================================

void OnSKSEMessage(SKSE::MessagingInterface::Message* a_msg)
{
    if (!a_msg) return;

    switch (a_msg->type) {
        case SKSE::MessagingInterface::kDataLoaded: {
            logger::info("SL_BookXP: kDataLoaded");

            // Register our XP source via the API (creates UI controls in settings)
            if (g_api && !g_sourceRegistered) {
                bool ok = g_api->RegisterXPSource(SOURCE_ID, SOURCE_DISPLAY);
                logger::info("SL_BookXP: RegisterXPSource('{}', '{}') = {}",
                    SOURCE_ID, SOURCE_DISPLAY, ok);
                g_sourceRegistered = true;
            } else if (!g_api) {
                logger::warn("SL_BookXP: API not available at kDataLoaded - source not registered");
            }

            // Register for BookMenu events
            auto* ui = RE::UI::GetSingleton();
            if (ui) {
                ui->AddEventSink<RE::MenuOpenCloseEvent>(BookMenuWatcher::GetSingleton());
                logger::info("SL_BookXP: BookMenu event sink registered - listening for book reads");
            } else {
                logger::error("SL_BookXP: Failed to get UI singleton!");
            }
            break;
        }
    }
}

// Receive API broadcast from SpellLearning (sent at kPostPostLoad)
void OnSpellLearningMessage(SKSE::MessagingInterface::Message* a_msg)
{
    if (!a_msg) return;

    if (a_msg->type == SpellLearning::kMessageType_APIReady && a_msg->data) {
        g_api = static_cast<SpellLearning::ISpellLearningAPI*>(a_msg->data);
        logger::info("SL_BookXP: Received SpellLearning API v{} - full access available!",
            g_api->GetAPIVersion());
    } else {
        logger::info("SL_BookXP: Received message from SpellLearning (type=0x{:X}, data={})",
            a_msg->type, a_msg->data ? "valid" : "null");
    }
}

// =============================================================================
// SKSE PLUGIN ENTRY
// =============================================================================

SKSEPluginLoad(const SKSE::LoadInterface* a_skse)
{
    SKSE::Init(a_skse, false);
    SetupLog();

    logger::info("{} v{} by {}", SKSE::GetPluginName(), SKSE::GetPluginVersion(), SKSE::GetPluginAuthor());
    logger::info("  built using CommonLibSSE-NG v{}", COMMONLIBSSE_VERSION);
    logger::info("  Running on Skyrim v{}", REL::Module::get().version().string());

    logger::info("===========================================");
    logger::info("  SL_BookXP v1.0.0 loaded");
    logger::info("  SpellLearning C++ API Test Plugin");
    logger::info("===========================================");

    auto messaging = SKSE::GetMessagingInterface();

    // Listen for SKSE lifecycle events (kDataLoaded)
    messaging->RegisterListener(OnSKSEMessage);
    logger::info("SL_BookXP: SKSE message listener registered");

    // Listen for SpellLearning API broadcast (arrives at kPostPostLoad)
    messaging->RegisterListener("SpellLearning", OnSpellLearningMessage);
    logger::info("SL_BookXP: Listening for SpellLearning API broadcast");

    logger::info("SL_BookXP: Initialization complete");
    return true;
}
