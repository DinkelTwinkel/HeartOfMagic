#include "ISLIntegration.h"
#include "ProgressionManager.h"
#include "UIManager.h"
#include "SpellEffectivenessHook.h"

namespace DESTIntegration {

    // =========================================================================
    // Internal state
    // =========================================================================
    namespace {
        constexpr const char* DEST_PLUGIN_NAMES[] = {
            "DEST_ISL.esp",
            "DEST_ISL.esl",
            "DontEatSpellTomes.esp",
            "DontEatSpellTomes.esl",
            "Don't Eat Spell Tomes.esp",
            "Don't Eat Spell Tomes.esl",
            "ISL-DESTified.esp",
            "ISL-DESTified.esl"
        };
        constexpr size_t DEST_PLUGIN_COUNT = sizeof(DEST_PLUGIN_NAMES) / sizeof(DEST_PLUGIN_NAMES[0]);

        const char* g_detectedPluginName = nullptr;
        bool        g_destInstalled = false;
        bool        g_islInstalled  = false;   // DEST_ISL.esp specifically
        bool        g_active        = false;
        DESTConfig  g_config;

        // SKSE registration set for OnSpellTomeRead event dispatch.
        // Registered aliases receive: OnSpellTomeRead(Book, Spell, ObjectReference)
        // Serialization record type for the registration set
        constexpr std::uint32_t kDESTRegType    = 'DEST';
        constexpr std::uint32_t kDESTRegVersion = 1;

        SKSE::RegistrationSet<RE::TESObjectBOOK*, RE::SpellItem*, RE::TESObjectREFR*>
            g_spellTomeEventRegs("OnSpellTomeRead"sv);
    }

    // =========================================================================
    // Detection helpers
    // =========================================================================

    bool IsDESTInstalled() { return g_destInstalled; }

    bool IsISLInstalled() { return g_islInstalled; }

    const char* GetDESTPluginName()
    {
        return g_detectedPluginName ? g_detectedPluginName : "DEST_ISL.esp";
    }

    bool IsActive()
    {
        return g_active && g_destInstalled && g_config.enabled;
    }

    DESTConfig& GetConfig() { return g_config; }

    void SetConfig(const DESTConfig& config)
    {
        g_config = config;
        if (g_destInstalled) {
            g_active = g_config.enabled;
            logger::info("DESTIntegration: Config updated - enabled: {}", g_config.enabled);
        }
    }

    // =========================================================================
    // Initialize — scan load order
    // =========================================================================

    void Initialize()
    {
        logger::info("DESTIntegration: Checking for DEST / ISL mods...");

        auto* dh = RE::TESDataHandler::GetSingleton();
        if (!dh) {
            logger::error("DESTIntegration: TESDataHandler unavailable");
            return;
        }

        g_destInstalled     = false;
        g_islInstalled      = false;
        g_detectedPluginName = nullptr;

        for (size_t i = 0; i < DEST_PLUGIN_COUNT; ++i) {
            if (dh->LookupModByName(DEST_PLUGIN_NAMES[i])) {
                g_destInstalled      = true;
                g_detectedPluginName = DEST_PLUGIN_NAMES[i];

                // Check if this is specifically the ISL variant
                std::string_view name(DEST_PLUGIN_NAMES[i]);
                if (name.find("ISL") != std::string_view::npos) {
                    g_islInstalled = true;
                }

                logger::info("DESTIntegration: Found plugin '{}'", g_detectedPluginName);
                break;
            }
        }

        if (g_destInstalled) {
            g_active = g_config.enabled;
            logger::info("DESTIntegration: ISL={} active={}", g_islInstalled, g_active);
        } else {
            logger::info("DESTIntegration: No DEST/ISL plugins found — integration inactive");
        }
    }

    void Shutdown()
    {
        g_active = false;
        g_spellTomeEventRegs.Clear();
        logger::info("DESTIntegration: Shutdown");
    }

    // =========================================================================
    // Event dispatch
    // =========================================================================

    void DispatchSpellTomeRead(RE::TESObjectBOOK* a_book,
                               RE::SpellItem*      a_spell,
                               RE::TESObjectREFR*  a_container)
    {
        logger::info("DESTIntegration: Dispatching OnSpellTomeRead to registered aliases "
                     "(book='{}', spell='{}')",
                     a_book ? a_book->GetName() : "NULL",
                     a_spell ? a_spell->GetName() : "NULL");

        g_spellTomeEventRegs.SendEvent(a_book, a_spell, a_container);
    }

    // =========================================================================
    // Legacy C++ handler (non-ISL DEST path, kept for reference/fallback)
    // =========================================================================

    bool OnSpellTomeRead(RE::TESObjectBOOK* book, RE::SpellItem* spell,
                         RE::TESObjectREFR* /*container*/)
    {
        if (!IsActive()) return false;
        if (!book || !spell) return false;

        logger::info("DESTIntegration::OnSpellTomeRead — {} ({})",
                     book->GetName(), spell->GetName());

        char formIdStr[32];
        snprintf(formIdStr, sizeof(formIdStr), "0x%08X", spell->GetFormID());

        auto* pm = ProgressionManager::GetSingleton();
        if (!pm->IsSpellAvailableToLearn(formIdStr)) {
            RE::SendHUDMessage::ShowHUDMessage("You lack the knowledge to grasp this magic.");
            return true;
        }

        auto* player = RE::PlayerCharacter::GetSingleton();
        if (player && player->HasSpell(spell)) {
            RE::SendHUDMessage::ShowHUDMessage("You have already learned this spell.");
            return true;
        }

        auto* effectHook   = SpellEffectivenessHook::GetSingleton();
        const auto& earlyS = effectHook->GetSettings();

        float reqXP    = pm->GetRequiredXP(formIdStr);
        if (reqXP <= 0) reqXP = pm->GetXPForTier("novice");
        float threshold = earlyS.unlockThreshold / 100.0f;
        float xpGrant   = reqXP * threshold;

        pm->AddXP(formIdStr, xpGrant);
        pm->SetLearningTargetFromTome(formIdStr, spell);

        char note[256];
        snprintf(note, sizeof(note), "You begin to grasp %s...", spell->GetName());
        RE::SendHUDMessage::ShowHUDMessage(note);

        UIManager::GetSingleton()->NotifyProgressUpdate(formIdStr);
        return true;
    }

    // =========================================================================
    // DEST_AliasExt Papyrus Native Functions
    // =========================================================================
    //
    // These replicate the API that DontEatSpellTomes.dll exposes so ISL's
    // unmodified Papyrus scripts work when our dummy DLL replaces the real one.
    //
    //   Scriptname DEST_AliasExt Hidden
    //   Function RegisterForSpellTomeReadEvent(Alias akAlias) global native
    //   Function UnregisterForSpellTomeReadEvent(Alias akAlias) global native
    //
    // =========================================================================

    namespace DEST_Papyrus {

        void RegisterForSpellTomeReadEvent(RE::StaticFunctionTag*,
                                           RE::BGSBaseAlias* a_alias)
        {
            if (!a_alias) {
                logger::warn("DEST_AliasExt: RegisterForSpellTomeReadEvent called with null alias");
                return;
            }

            if (g_spellTomeEventRegs.Register(a_alias)) {
                logger::info("DEST_AliasExt: Alias registered for OnSpellTomeRead events");
            } else {
                logger::warn("DEST_AliasExt: Failed to register alias (already registered?)");
            }
        }

        void UnregisterForSpellTomeReadEvent(RE::StaticFunctionTag*,
                                             RE::BGSBaseAlias* a_alias)
        {
            if (!a_alias) {
                logger::warn("DEST_AliasExt: UnregisterForSpellTomeReadEvent called with null alias");
                return;
            }

            if (g_spellTomeEventRegs.Unregister(a_alias)) {
                logger::info("DEST_AliasExt: Alias unregistered from OnSpellTomeRead events");
            }
        }
    }

    // Also replicate DEST_UIExt (ISL uses it for notifications)
    //   Scriptname DEST_UIExt Hidden
    //   Function Notification(string, string, bool) global native
    namespace DEST_UI_Papyrus {

        void Notification(RE::StaticFunctionTag*,
                          RE::BSFixedString a_text,
                          [[maybe_unused]] RE::BSFixedString a_soundID,
                          [[maybe_unused]] bool a_cancelIfQueued)
        {
            if (!a_text.empty()) {
                RE::SendHUDMessage::ShowHUDMessage(a_text.c_str());
            }
        }
    }

    // =========================================================================
    // Registration
    // =========================================================================

    bool RegisterDESTAliasExtFunctions(RE::BSScript::IVirtualMachine* vm)
    {
        if (!vm) return false;

        // DEST_AliasExt — spell tome event registration
        vm->RegisterFunction("RegisterForSpellTomeReadEvent",
                             "DEST_AliasExt",
                             DEST_Papyrus::RegisterForSpellTomeReadEvent);

        vm->RegisterFunction("UnregisterForSpellTomeReadEvent",
                             "DEST_AliasExt",
                             DEST_Papyrus::UnregisterForSpellTomeReadEvent);

        // DEST_UIExt — notification helper
        vm->RegisterFunction("Notification",
                             "DEST_UIExt",
                             DEST_UI_Papyrus::Notification);

        logger::info("DESTIntegration: Registered DEST_AliasExt + DEST_UIExt Papyrus native functions");
        return true;
    }

    namespace Papyrus {

        bool OnTomeRead(RE::StaticFunctionTag*, RE::TESObjectBOOK* book,
                        RE::SpellItem* spell, RE::TESObjectREFR* container)
        {
            return OnSpellTomeRead(book, spell, container);
        }

        bool IsIntegrationActive(RE::StaticFunctionTag*)
        {
            return IsActive();
        }
    }

    bool RegisterPapyrusFunctions(RE::BSScript::IVirtualMachine* vm)
    {
        if (!vm) return false;

        vm->RegisterFunction("OnTomeRead",          "SpellLearning_DEST", Papyrus::OnTomeRead);
        vm->RegisterFunction("IsIntegrationActive",  "SpellLearning_DEST", Papyrus::IsIntegrationActive);
        vm->RegisterFunction("OnTomeRead",          "SpellLearning_ISL",  Papyrus::OnTomeRead);
        vm->RegisterFunction("IsIntegrationActive",  "SpellLearning_ISL",  Papyrus::IsIntegrationActive);

        logger::info("DESTIntegration: Registered SpellLearning_DEST/ISL Papyrus functions");
        return true;
    }

    // =========================================================================
    // Serialization — persist alias registrations across save/load
    // =========================================================================

    void OnGameSaved(SKSE::SerializationInterface* a_intfc)
    {
        g_spellTomeEventRegs.Save(a_intfc, kDESTRegType, kDESTRegVersion);
        logger::info("DESTIntegration: Saved DEST event registrations");
    }

    void OnGameLoaded(SKSE::SerializationInterface* a_intfc)
    {
        g_spellTomeEventRegs.Load(a_intfc);
        logger::info("DESTIntegration: Loaded DEST event registrations");
    }

    void OnRevert(SKSE::SerializationInterface* a_intfc)
    {
        g_spellTomeEventRegs.Revert(a_intfc);
        logger::info("DESTIntegration: Reverted DEST event registrations");
    }
}
