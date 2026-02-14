// ==========================================================================
// DummyDEST — Inert DontEatSpellTomes.dll replacement
// ==========================================================================
// This SKSE plugin does NOTHING.  It exists to replace ISL's real
// DontEatSpellTomes.dll via MO2 file conflict so that ISL's hook
// doesn't clash with Heart of Magic's SpellTomeHook.
//
// SpellLearning.dll provides the DEST_AliasExt and DEST_UIExt native
// Papyrus functions that ISL's scripts call, so ISL works unchanged.
// ==========================================================================

#include "RE/Skyrim.h"
#include "SKSE/SKSE.h"

SKSEPluginInfo(
    .Version   = { 9, 9, 9, 0 },
    .Name      = "DontEatSpellTomes",
    .Author    = "Heart of Magic (compatibility shim)",
    .StructCompatibility   = SKSE::StructCompatibility::Independent,
    .RuntimeCompatibility  = SKSE::VersionIndependence::AddressLibrary
)

SKSEPluginLoad(const SKSE::LoadInterface* skse)
{
    SKSE::Init(skse);

    // Intentionally empty — SpellLearning.dll handles everything.
    // This DLL exists only to prevent the real DontEatSpellTomes.dll
    // from loading and conflicting with our spell tome hook.

    auto log = spdlog::default_logger();
    if (log) {
        log->info("DontEatSpellTomes (Heart of Magic shim): Loaded. "
                  "This is an inert replacement - SpellLearning.dll provides DEST API.");
    }

    return true;
}
