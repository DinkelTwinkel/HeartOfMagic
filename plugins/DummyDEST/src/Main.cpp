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

#include "Common.h"

SKSEPluginLoad(const SKSE::LoadInterface* skse) {
    SKSE::Init(skse, false);
    SetupLog(
        "DontEatSpellTomes (Heart of Magic shim): Loaded. "
        "This is an inert replacement - SpellLearning.dll provides DEST API.");

    return true;
}
