#pragma once

#include "PCH.h"

namespace logger = SKSE::log;

/// Shared log setup + startup banner for all Heart of Magic plugins.
/// @param extraLine  Optional plugin-specific message printed inside the banner.
inline void SetupLog(const char* extraLine = nullptr)
{
    logger::init();
    // pattern: [2024-01-01 12:00:00.000] [info] [1234] [sourcefile.cpp:123] Log message
    spdlog::set_pattern("[%Y-%m-%d %T.%e] [%l] [%t] [%s:%#] %v");
    spdlog::set_level(spdlog::level::info);

    logger::info("===========================================");
    logger::info("{} v{} by {} loading...",
        SKSE::GetPluginName(), SKSE::GetPluginVersion(), SKSE::GetPluginAuthor());
    if (extraLine) {
        logger::info("  {}", extraLine);
    }
    logger::info("  built using CommonLibSSE-NG v{}", COMMONLIBSSE_VERSION);
    logger::info("  Running on Skyrim v{}", REL::Module::get().version().string());
    logger::info("===========================================");
}
