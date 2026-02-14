#pragma once

// Suppress winsock v1 so windows.h (pulled in by CommonLib) won't define
// winsock1 symbols.  This lets us safely include <winsock2.h> AFTER CommonLib.
#ifndef _WINSOCKAPI_
#define _WINSOCKAPI_
#endif

#include "RE/Skyrim.h"
#include "SKSE/SKSE.h"

// Windows API for encoding conversion (MultiByteToWideChar, WideCharToMultiByte)
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
#include <functional>
#include <iomanip>
#include <mutex>
#include <numeric>
#include <queue>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace std::literals;
namespace logger = SKSE::log;
using json = nlohmann::json;
