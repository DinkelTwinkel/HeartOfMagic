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

        // =====================================================================
        // ISL Study Callbacks — called from patched DEST_ISL_PlayerSpellLearningScript
        // =====================================================================

        void OnStudyProgress(RE::StaticFunctionTag*,
                             RE::SpellItem* a_spell,
                             int a_hoursStudied,
                             float a_totalStudied,
                             float a_hoursToMaster)
        {
            if (!a_spell || a_hoursToMaster <= 0.0f) return;

            RE::FormID formId = a_spell->GetFormID();
            char formIdStr[32];
            snprintf(formIdStr, sizeof(formIdStr), "0x%08X", formId);

            auto* pm = ProgressionManager::GetSingleton();
            auto* effectHook = SpellEffectivenessHook::GetSingleton();
            if (!pm || !effectHook) return;

            // Calculate proportional XP: this study session's fraction of the
            // total unlock-threshold XP (25% of required by default).
            float reqXP = pm->GetRequiredXP(formIdStr);
            if (reqXP <= 0) reqXP = pm->GetXPForTier("novice");

            float threshold = effectHook->GetSettings().unlockThreshold / 100.0f;
            float totalStudyXP = reqXP * threshold;  // Total XP across all study
            float sessionXP = (static_cast<float>(a_hoursStudied) / a_hoursToMaster) * totalStudyXP;

            pm->AddXPNoGrant(formIdStr, sessionXP);

            logger::info("DESTIntegration: OnStudyProgress — {} studied {} hrs ({:.0f}/{:.0f}), "
                         "granted {:.1f} XP ({:.0f}% of {:.0f} total study XP)",
                         a_spell->GetName(), a_hoursStudied,
                         a_totalStudied, a_hoursToMaster,
                         sessionXP, (sessionXP / totalStudyXP) * 100.0f, totalStudyXP);

            // Do NOT call CheckAndUpdatePowerStep here — the player doesn't have
            // the spell yet, so we shouldn't modify its name/description during study.
            // Name modifications happen in OnStudyComplete after ISL grants the spell.

            // Notify UI
            UIManager::GetSingleton()->NotifyProgressUpdate(formIdStr);
        }

        void OnStudyComplete(RE::StaticFunctionTag*, RE::SpellItem* a_spell)
        {
            if (!a_spell) return;

            RE::FormID formId = a_spell->GetFormID();
            char formIdStr[32];
            snprintf(formIdStr, sizeof(formIdStr), "0x%08X", formId);

            auto* effectHook = SpellEffectivenessHook::GetSingleton();
            if (!effectHook) return;

            // Ensure spell is in early-learned tracking (should already be from
            // RegisterISLPendingSpell, but belt-and-suspenders)
            if (!effectHook->IsEarlyLearnedSpell(formId)) {
                effectHook->RegisterISLPendingSpell(a_spell);
            }

            // NOW apply the modified name/description — ISL has granted the spell,
            // so it's safe to rename. During study we deliberately left the name
            // untouched so ISL's notifications showed the clean spell name.
            effectHook->UpdateSpellDisplayCache(formId, a_spell);
            effectHook->ApplyModifiedSpellName(formId);
            effectHook->ApplyModifiedDescriptions(formId);

            logger::info("DESTIntegration: OnStudyComplete — {} ({:08X}) learned via ISL, "
                         "now at weakened power, name/description modified",
                         a_spell->GetName(), formId);

            // Notify UI
            UIManager::GetSingleton()->NotifyProgressUpdate(formIdStr);
        }
    }

    bool RegisterPapyrusFunctions(RE::BSScript::IVirtualMachine* vm)
    {
        if (!vm) return false;

        vm->RegisterFunction("OnTomeRead",          "SpellLearning_DEST", Papyrus::OnTomeRead);
        vm->RegisterFunction("IsIntegrationActive",  "SpellLearning_DEST", Papyrus::IsIntegrationActive);
        vm->RegisterFunction("OnTomeRead",          "SpellLearning_ISL",  Papyrus::OnTomeRead);
        vm->RegisterFunction("IsIntegrationActive",  "SpellLearning_ISL",  Papyrus::IsIntegrationActive);
        vm->RegisterFunction("OnStudyProgress",     "SpellLearning_ISL",  Papyrus::OnStudyProgress);
        vm->RegisterFunction("OnStudyComplete",     "SpellLearning_ISL",  Papyrus::OnStudyComplete);

        logger::info("DESTIntegration: Registered SpellLearning_DEST/ISL Papyrus functions");
        return true;
    }

    // =========================================================================
    // Auto-registration for existing saves
    // =========================================================================
    // ISL's DEST_ISL_PlayerSpellLearningScript registers for OnSpellTomeRead
    // in OnInit() only (no OnPlayerLoadGame). On existing saves, those
    // registrations were stored in the REAL DontEatSpellTomes.dll's co-save.
    // Our dummy replacement means our RegistrationSet starts empty.
    // Fix: scan DEST_ISL.esp quests on game load and register player aliases.
    // =========================================================================

    void AutoRegisterISLAliases()
    {
        if (!g_destInstalled) return;

        auto* dh = RE::TESDataHandler::GetSingleton();
        if (!dh) return;

        const auto* destMod = dh->LookupModByName(g_detectedPluginName);
        if (!destMod) return;

        uint8_t compileIndex = destMod->compileIndex;
        uint16_t smallFileCompileIndex = destMod->smallFileCompileIndex;

        int registered = 0;

        for (auto& quest : dh->GetFormArray<RE::TESQuest>()) {
            if (!quest || !quest->IsRunning()) continue;

            RE::FormID formId = quest->GetFormID();
            uint8_t modIdx = (formId >> 24) & 0xFF;

            // Check if quest belongs to the DEST_ISL plugin
            bool fromMod = false;
            if (modIdx == 0xFE) {
                // Light plugin (ESL)
                uint16_t lightIdx = (formId >> 12) & 0xFFF;
                fromMod = (compileIndex == 0xFE && lightIdx == smallFileCompileIndex);
            } else {
                fromMod = (modIdx == compileIndex);
            }
            if (!fromMod) continue;

            // Scan aliases for player reference aliases
            for (uint32_t i = 0; i < quest->aliases.size(); i++) {
                auto* alias = quest->aliases[i];
                if (!alias) continue;

                auto* refAlias = skyrim_cast<RE::BGSRefAlias*>(alias);
                if (!refAlias) continue;

                auto* ref = refAlias->GetReference();
                if (ref && ref->IsPlayerRef()) {
                    if (g_spellTomeEventRegs.Register(alias)) {
                        registered++;
                        logger::info("DESTIntegration: Auto-registered player alias '{}' from quest {:08X}",
                            alias->aliasName.c_str(), quest->GetFormID());
                    }
                }
            }
        }

        if (registered > 0) {
            logger::info("DESTIntegration: Auto-registered {} ISL alias(es) for existing save compatibility", registered);
        } else if (g_islInstalled) {
            logger::warn("DESTIntegration: ISL detected but no player aliases found — ISL study popup may not appear");
        }
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

        // Auto-register ISL aliases — fixes existing saves where the real
        // DontEatSpellTomes.dll's registrations were lost
        AutoRegisterISLAliases();
    }

    void OnRevert(SKSE::SerializationInterface* a_intfc)
    {
        g_spellTomeEventRegs.Revert(a_intfc);
        logger::info("DESTIntegration: Reverted DEST event registrations");
    }
}
