#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <algorithm>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <format>
#include <fstream>
#include <functional>
#include <iomanip>
#include <mutex>
#include <nlohmann/json.hpp>
#include <numeric>
#include <queue>
#include <random>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "RE/Skyrim.h"
#include "SKSE/SKSE.h"

using namespace std::literals;
namespace logger = SKSE::log;
using json = nlohmann::json;
