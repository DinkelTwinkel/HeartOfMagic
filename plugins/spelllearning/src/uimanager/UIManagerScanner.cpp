#include "Common.h"
#include "uimanager/UIManager.h"
#include "SpellScanner.h"
#include "ThreadUtils.h"

// =============================================================================
// SCANNER TAB CALLBACKS
// =============================================================================

void UIManager::OnScanSpells(const char* argument)
{
    logger::info("UIManager: ScanSpells callback triggered");

    std::string argStr(argument ? argument : "");

    AddTaskToGameThread("ScanSpells", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Parse the scan configuration
        SpellScanner::ScanConfig scanConfig;
        bool useTomeMode = false;

        if (!argStr.empty()) {
            try {
                json j = json::parse(argStr);
                scanConfig = SpellScanner::ParseScanConfig(argStr.c_str());

                // Check for scan mode
                if (j.contains("scanMode") && j["scanMode"].get<std::string>() == "tomes") {
                    useTomeMode = true;
                }
            } catch (...) {
                // If parsing fails, use defaults
            }
        }

        std::string result;
        if (useTomeMode) {
            instance->UpdateStatus("Scanning spell tomes...");
            result = SpellScanner::ScanSpellTomes(scanConfig);
        } else {
            instance->UpdateStatus("Scanning all spells...");
            result = SpellScanner::ScanAllSpells(scanConfig);
        }

        // Send result back to UI
        instance->SendSpellData(result);
    });
}

void UIManager::OnSaveOutput(const char* argument)
{
    logger::info("UIManager: SaveOutput callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveOutput - no content to save");
        return;
    }

    std::string argStr(argument);

    AddTaskToGameThread("SaveOutput", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Create output directory
        std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning";
        std::filesystem::create_directories(outputDir);

        // Write to file
        std::filesystem::path outputPath = outputDir / "spell_scan_output.json";

        try {
            std::ofstream file(outputPath);
            if (file.is_open()) {
                file << argStr;
                file.close();
                logger::info("UIManager: Saved output to {}", outputPath.string());
                instance->UpdateStatus("Saved to spell_scan_output.json");
            } else {
                logger::error("UIManager: Failed to open output file");
                instance->UpdateStatus("Failed to save file");
            }
        } catch (const std::exception& e) {
            logger::error("UIManager: Exception while saving: {}", e.what());
            instance->UpdateStatus("Error saving file");
        }
    });
}

void UIManager::OnSaveOutputBySchool(const char* argument)
{
    logger::info("UIManager: SaveOutputBySchool callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveOutputBySchool - no content to save");
        return;
    }

    std::string argStr(argument);

    AddTaskToGameThread("SaveOutputBySchool", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        try {
            // Parse the JSON object containing school outputs
            json schoolOutputs = json::parse(argStr);

            // Create output directory
            std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning/schools";
            std::filesystem::create_directories(outputDir);

            int savedCount = 0;

            // Save each school to its own file
            for (auto& [school, content] : schoolOutputs.items()) {
                std::string filename = school + "_spells.json";
                std::filesystem::path outputPath = outputDir / filename;

                std::ofstream file(outputPath);
                if (file.is_open()) {
                    // Content is already a JSON string, write it directly
                    if (content.is_string()) {
                        file << content.get<std::string>();
                    } else {
                        file << content.dump(2);
                    }
                    file.close();
                    logger::info("UIManager: Saved {} to {}", school, outputPath.string());
                    savedCount++;
                } else {
                    logger::error("UIManager: Failed to save {}", school);
                }
            }

            std::string statusMsg = "Saved " + std::to_string(savedCount) + " school files to /schools/";
            logger::info("UIManager: {}", statusMsg);
            instance->UpdateStatus(statusMsg);

        } catch (const std::exception& e) {
            logger::error("UIManager: Exception in SaveOutputBySchool: {}", e.what());
            instance->UpdateStatus("Error saving school files");
        }
    });
}

void UIManager::OnLoadPrompt([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: LoadPrompt callback triggered");

    AddTaskToGameThread("LoadPrompt", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        auto promptPath = GetPromptFilePath();

        // Check if saved prompt exists
        if (!std::filesystem::exists(promptPath)) {
            logger::info("UIManager: No saved prompt file found, using default");
            return;
        }

        try {
            std::ifstream file(promptPath);
            if (file.is_open()) {
                std::stringstream buffer;
                buffer << file.rdbuf();
                file.close();

                std::string promptContent = buffer.str();
                logger::info("UIManager: Loaded prompt from file ({} bytes)", promptContent.size());

                instance->SendPrompt(promptContent);
            } else {
                logger::warn("UIManager: Could not open prompt file");
            }
        } catch (const std::exception& e) {
            logger::error("UIManager: Exception while loading prompt: {}", e.what());
        }
    });
}

void UIManager::OnSavePrompt(const char* argument)
{
    logger::info("UIManager: SavePrompt callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SavePrompt - no content to save");
        return;
    }

    std::string argStr(argument);

    AddTaskToGameThread("SavePrompt", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Create output directory
        std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning";
        std::filesystem::create_directories(outputDir);

        auto promptPath = GetPromptFilePath();

        try {
            std::ofstream file(promptPath);
            if (file.is_open()) {
                file << argStr;
                file.close();
                logger::info("UIManager: Saved prompt to {}", promptPath.string());
                instance->NotifyPromptSaved(true);
            } else {
                logger::error("UIManager: Failed to open prompt file for writing");
                instance->NotifyPromptSaved(false);
            }
        } catch (const std::exception& e) {
            logger::error("UIManager: Exception while saving prompt: {}", e.what());
            instance->NotifyPromptSaved(false);
        }
    });
}
