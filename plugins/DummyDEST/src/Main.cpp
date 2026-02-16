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

  // Intentionally empty — SpellLearning.dll handles everything.
  // This DLL exists only to prevent the real DontEatSpellTomes.dll
  // from loading and conflicting with our spell tome hook.

  logger::init();

  // pattern: [2024-01-01 12:00:00.000] [info] [1234] [sourcefile.cpp:123] Log
  spdlog::set_pattern("[%Y-%m-%d %T.%e] [%l] [%t] [%s:%#] %v");
  spdlog::set_level(spdlog::level::info);

  logger::info(
      "DontEatSpellTomes (Heart of Magic shim): Loaded. "
      "This is an inert replacement - SpellLearning.dll provides DEST API.");

  return true;
}
