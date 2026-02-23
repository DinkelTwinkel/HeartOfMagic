#include "Common.h"
#include "uimanager/UIManager.h"
#include "ThreadUtils.h"

// =============================================================================
// CLIPBOARD CALLBACKS (Windows API)
// =============================================================================

void UIManager::OnCopyToClipboard(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: CopyToClipboard - no content provided");
        return;
    }

    logger::info("UIManager: CopyToClipboard ({} bytes)", strlen(argument));

    std::string argStr(argument);

    AddTaskToGameThread("CopyToClipboard", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        bool success = false;

        // Use Windows clipboard API
        if (OpenClipboard(nullptr)) {
            EmptyClipboard();

            // Calculate size needed (including null terminator)
            size_t len = argStr.size() + 1;
            HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, len);

            if (hMem) {
                char* pMem = static_cast<char*>(GlobalLock(hMem));
                if (pMem) {
                    memcpy(pMem, argStr.c_str(), len);
                    GlobalUnlock(hMem);

                    if (SetClipboardData(CF_TEXT, hMem)) {
                        success = true;
                        logger::info("UIManager: Successfully copied to clipboard");
                    } else {
                        logger::error("UIManager: SetClipboardData failed");
                        GlobalFree(hMem);
                    }
                } else {
                    logger::error("UIManager: GlobalLock failed");
                    GlobalFree(hMem);
                }
            } else {
                logger::error("UIManager: GlobalAlloc failed");
            }

            CloseClipboard();
        } else {
            logger::error("UIManager: OpenClipboard failed");
        }

        instance->NotifyCopyComplete(success);
    });
}

void UIManager::OnGetClipboard([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: GetClipboard callback triggered");

    AddTaskToGameThread("GetClipboard", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        std::string content;

        // Use Windows clipboard API
        if (OpenClipboard(nullptr)) {
            HANDLE hData = GetClipboardData(CF_TEXT);

            if (hData) {
                char* pszText = static_cast<char*>(GlobalLock(hData));
                if (pszText) {
                    content = pszText;
                    GlobalUnlock(hData);
                    logger::info("UIManager: Read {} bytes from clipboard", content.size());
                } else {
                    logger::warn("UIManager: GlobalLock failed on clipboard data");
                }
            } else {
                logger::warn("UIManager: No text data in clipboard");
            }

            CloseClipboard();
        } else {
            logger::error("UIManager: OpenClipboard failed");
        }

        // Send content to UI (even if empty)
        instance->SendClipboardContent(content);
    });
}

// =============================================================================
// PRESET FILE I/O
// =============================================================================

static std::filesystem::path GetPresetsBasePath()
{
    return "Data/SKSE/Plugins/SpellLearning/presets";
}

// Sanitize a preset name for use as a filename (remove dangerous chars)
static std::string SanitizePresetFilename(const std::string& name)
{
    std::string safe;
    safe.reserve(name.size());
    for (char c : name) {
        if (c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' ||
            c == '"' || c == '<'  || c == '>' || c == '|') {
            safe += '_';
        } else {
            safe += c;
        }
    }
    // Trim trailing dots/spaces (Windows doesn't allow them in filenames)
    while (!safe.empty() && (safe.back() == '.' || safe.back() == ' ')) {
        safe.pop_back();
    }
    if (safe.empty()) safe = "_unnamed";
    return safe;
}

void UIManager::OnSavePreset(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SavePreset - no data provided");
        return;
    }

    std::string argStr(argument);

    AddTaskToGameThread("SavePreset", [argStr]() {
        try {
            json args = json::parse(argStr);
            std::string type = args.value("type", "");
            std::string name = args.value("name", "");
            json data = args.value("data", json::object());

            if (type.empty() || name.empty()) {
                logger::warn("UIManager: SavePreset - missing type or name");
                return;
            }

            std::string safeName = SanitizePresetFilename(name);
            auto dir = GetPresetsBasePath() / type;
            std::filesystem::create_directories(dir);

            auto filePath = dir / (safeName + ".json");
            std::ofstream file(filePath);
            if (!file.is_open()) {
                logger::error("UIManager: SavePreset - failed to open {}", filePath.string());
                return;
            }
            file << data.dump(2);
            file.close();

            logger::info("UIManager: SavePreset - saved {}/{}.json", type, safeName);
        } catch (const std::exception& e) {
            logger::error("UIManager: SavePreset exception: {}", e.what());
        }
    });
}

void UIManager::OnDeletePreset(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: DeletePreset - no data provided");
        return;
    }

    std::string argStr(argument);

    AddTaskToGameThread("DeletePreset", [argStr]() {
        try {
            json args = json::parse(argStr);
            std::string type = args.value("type", "");
            std::string name = args.value("name", "");

            if (type.empty() || name.empty()) {
                logger::warn("UIManager: DeletePreset - missing type or name");
                return;
            }

            std::string safeName = SanitizePresetFilename(name);
            auto filePath = GetPresetsBasePath() / type / (safeName + ".json");

            if (std::filesystem::exists(filePath)) {
                std::filesystem::remove(filePath);
                logger::info("UIManager: DeletePreset - deleted {}/{}.json", type, safeName);
            } else {
                logger::warn("UIManager: DeletePreset - file not found: {}", filePath.string());
            }
        } catch (const std::exception& e) {
            logger::error("UIManager: DeletePreset exception: {}", e.what());
        }
    });
}

void UIManager::OnLoadPresets(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: LoadPresets - no data provided");
        return;
    }

    // Copy argument — must defer via AddTask to avoid re-entrant JS calls.
    // InteropCall back into JS from within a RegisterJSListener callback
    // doesn't work in Ultralight (re-entrant), so we defer to SKSE task thread.
    std::string argStr(argument);

    AddTaskToGameThread("LoadPresets", [argStr]() {
        auto* instance = GetSingleton();

        try {
            json args = json::parse(argStr);
            std::string type = args.value("type", "");

            if (type.empty()) {
                logger::warn("UIManager: LoadPresets - missing type");
                return;
            }

            auto dir = GetPresetsBasePath() / type;
            json result;
            result["type"] = type;
            result["presets"] = json::array();

            if (std::filesystem::exists(dir) && std::filesystem::is_directory(dir)) {
                for (const auto& entry : std::filesystem::directory_iterator(dir)) {
                    if (!entry.is_regular_file()) continue;
                    auto ext = entry.path().extension().string();
                    // Case-insensitive .json check
                    if (ext != ".json" && ext != ".JSON") continue;

                    try {
                        std::ifstream file(entry.path());
                        json presetData = json::parse(file);

                        // Use the filename (without extension) as key, but prefer "name" inside the JSON
                        std::string key = entry.path().stem().string();
                        if (presetData.contains("name") && presetData["name"].is_string()) {
                            key = presetData["name"].get<std::string>();
                        }

                        json presetEntry;
                        presetEntry["key"] = key;
                        presetEntry["data"] = presetData;
                        result["presets"].push_back(presetEntry);

                        logger::info("UIManager: LoadPresets - loaded {}/{}", type, key);
                    } catch (const std::exception& e) {
                        logger::warn("UIManager: LoadPresets - failed to parse {}: {}",
                                     entry.path().string(), e.what());
                    }
                }
            } else {
                // Directory doesn't exist yet - that's fine, return empty array
                logger::info("UIManager: LoadPresets - no presets directory for type '{}'", type);
            }

            std::string resultStr = result.dump();
            logger::info("UIManager: LoadPresets - sending {} {} presets to UI",
                         result["presets"].size(), type);
            instance->m_prismaUI->InteropCall(instance->m_view, "onPresetsLoaded", resultStr.c_str());

        } catch (const std::exception& e) {
            logger::error("UIManager: LoadPresets exception: {}", e.what());
        }
    });
}

// =============================================================================
// AUTO-TEST CALLBACKS
// =============================================================================

void UIManager::OnLoadTestConfig([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: LoadTestConfig callback triggered");

    AddTaskToGameThread("LoadTestConfig", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        std::filesystem::path configPath = "Data/SKSE/Plugins/SpellLearning/test_config.json";

        try {
            if (!std::filesystem::exists(configPath)) {
                logger::info("UIManager: No test_config.json found - test mode disabled");
                // Send empty/disabled response
                nlohmann::json response;
                response["enabled"] = false;
                instance->m_prismaUI->InteropCall(instance->m_view, "onTestConfigLoaded", response.dump().c_str());
                return;
            }

            std::ifstream file(configPath);
            if (!file.is_open()) {
                logger::error("UIManager: Failed to open test_config.json");
                return;
            }

            std::stringstream buffer;
            buffer << file.rdbuf();
            file.close();

            // Parse and validate
            nlohmann::json config = nlohmann::json::parse(buffer.str());

            logger::info("UIManager: Test config loaded - enabled: {}, preset: {}",
                         config.value("enabled", false),
                         config.value("preset", "unknown"));

            // Send to JS
            instance->m_prismaUI->InteropCall(instance->m_view, "onTestConfigLoaded", config.dump().c_str());

        } catch (const std::exception& e) {
            logger::error("UIManager: Exception loading test config: {}", e.what());
        }
    });
}

void UIManager::OnSaveTestResults(const char* argument)
{
    logger::info("UIManager: SaveTestResults callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveTestResults - no content");
        return;
    }

    try {
        // Parse the argument to get the results JSON string
        nlohmann::json request = nlohmann::json::parse(argument);
        std::string resultsJson = request.value("results", "{}");

        // Create output directory
        std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning";
        std::filesystem::create_directories(outputDir);

        // Write results file
        std::filesystem::path resultsPath = outputDir / "test_results.json";
        std::ofstream file(resultsPath);
        if (file.is_open()) {
            file << resultsJson;
            file.close();
            logger::info("UIManager: Saved test results to {}", resultsPath.string());
        } else {
            logger::error("UIManager: Failed to open test_results.json for writing");
        }

    } catch (const std::exception& e) {
        logger::error("UIManager: Exception saving test results: {}", e.what());
    }
}
