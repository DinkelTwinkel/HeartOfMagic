#pragma once

#include "PCH.h"
#include <SKSE/RegistrationSet.h>
#include <mutex>

// =============================================================================
// ISL / DEST Integration
// =============================================================================
// Provides compatibility with "Immersive Spell Learning - DESTified" (ISL).
//
// ISL uses DontEatSpellTomes.dll which hooks TESObjectBOOK::Read — the same
// site our SpellTomeHook patches.  Running both DLLs crashes the game.
//
// Solution:
//   1. We implement the DEST Papyrus API (DEST_AliasExt native functions)
//      inside SpellLearning.dll so ISL's Papyrus scripts work without
//      the original DontEatSpellTomes.dll.
//   2. A dummy DontEatSpellTomes.dll (ships with our FOMOD) overwrites
//      ISL's real DLL via MO2 file conflict, eliminating the hook clash.
//   3. When our SpellTomeHook fires, we dispatch OnSpellTomeRead to ISL's
//      registered alias AND grant our XP (first read only).
//   4. ISL handles the study UX (menus, animations, time).  When ISL
//      finishes and calls AddSpell, our SpellEffectivenessHook applies
//      reduced power based on earned XP.
// =============================================================================

namespace DESTIntegration {

    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------
    struct DESTConfig {
        bool enabled = true;   // Enable ISL/DEST integration when detected
    };

    // -------------------------------------------------------------------------
    // Detection
    // -------------------------------------------------------------------------

    /// Has any DEST/ISL plugin been found in the load order?
    bool IsDESTInstalled();

    /// Is ISL specifically installed (DEST_ISL.esp)?
    bool IsISLInstalled();

    /// Detected plugin file name (for logging).
    const char* GetDESTPluginName();

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /// Scan load order for DEST/ISL plugins.  Call during kDataLoaded.
    void Initialize();

    /// Tear down.
    void Shutdown();

    /// True when ISL is loaded AND integration is enabled in config.
    bool IsActive();

    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------
    DESTConfig& GetConfig();
    void SetConfig(const DESTConfig& config);

    // -------------------------------------------------------------------------
    // Event dispatch  (called from SpellTomeHook)
    // -------------------------------------------------------------------------

    /// Dispatch OnSpellTomeRead to all Papyrus aliases that registered via
    /// DEST_AliasExt.RegisterForSpellTomeReadEvent().
    void DispatchSpellTomeRead(RE::TESObjectBOOK* a_book,
                               RE::SpellItem*      a_spell,
                               RE::TESObjectREFR*  a_container);

    // -------------------------------------------------------------------------
    // Legacy handler (kept for non-ISL DEST setups / direct C++ path)
    // -------------------------------------------------------------------------
    bool OnSpellTomeRead(RE::TESObjectBOOK* book,
                         RE::SpellItem*      spell,
                         RE::TESObjectREFR*  container);

    // -------------------------------------------------------------------------
    // Papyrus native function registration
    // -------------------------------------------------------------------------

    /// Register DEST_AliasExt native functions so ISL scripts work.
    bool RegisterDESTAliasExtFunctions(RE::BSScript::IVirtualMachine* vm);

    /// Register our own SpellLearning_DEST / SpellLearning_ISL helpers.
    bool RegisterPapyrusFunctions(RE::BSScript::IVirtualMachine* vm);

    // -------------------------------------------------------------------------
    // Auto-registration (fix existing saves where alias registrations were
    // stored in the real DontEatSpellTomes.dll's co-save, not ours)
    // -------------------------------------------------------------------------
    void AutoRegisterISLAliases();

    // -------------------------------------------------------------------------
    // Serialization  (persist registered aliases across save/load)
    // -------------------------------------------------------------------------
    void OnGameSaved(SKSE::SerializationInterface* a_intfc);
    void OnGameLoaded(SKSE::SerializationInterface* a_intfc);
    void OnRevert(SKSE::SerializationInterface* a_intfc);
}

// Backwards-compat alias
namespace ISLIntegration = DESTIntegration;
