#pragma once

// Suppress winsock v1 so windows.h (pulled in by CommonLib) won't define
// winsock1 symbols.  This lets us safely include <winsock2.h> AFTER CommonLib.
#ifndef _WINSOCKAPI_
#define _WINSOCKAPI_
#endif

#include "RE/Skyrim.h"
#include "SKSE/SKSE.h"

// WinSock2 for TCP socket IPC (PythonBridge Wine/Proton support)
// Safe after CommonLib because we suppressed winsock v1 above
#include <winsock2.h>
#include <ws2tcpip.h>

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
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

using namespace std::literals;
namespace logger = SKSE::log;
using json = nlohmann::json;
