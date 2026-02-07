#pragma once

#include "RE/Skyrim.h"
#include "SKSE/SKSE.h"

// Windows API for encoding conversion (MultiByteToWideChar, WideCharToMultiByte)
// Must come after CommonLib headers
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <Windows.h>

#include <spdlog/sinks/basic_file_sink.h>
#include <spdlog/sinks/msvc_sink.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <format>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

using namespace std::literals;
namespace logger = SKSE::log;
using json = nlohmann::json;
