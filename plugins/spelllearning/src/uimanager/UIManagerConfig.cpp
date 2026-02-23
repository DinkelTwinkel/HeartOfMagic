#include "Common.h"
#include "uimanager/UIManager.h"
#include "uimanager/UIManagerInternal.h"
#include "ProgressionManager.h"
#include "SpellEffectivenessHook.h"
#include "SpellTomeHook.h"
#include "SpellCastHandler.h"
#include "PassiveLearningSource.h"
#include "OpenRouterAPI.h"
#include "ISLIntegration.h"
#include "ThreadUtils.h"

// =============================================================================
// SETTINGS (Legacy - now uses Unified Config)
// =============================================================================

std::filesystem::path GetSettingsFilePath()
{
    return "Data/SKSE/Plugins/SpellLearning/settings.json";
}

std::filesystem::path GetUnifiedConfigPath()
{
    return "Data/SKSE/Plugins/SpellLearning/config.json";
}

void UIManager::OnLoadSettings(const char* argument)
{
    // Legacy - redirect to unified config
    OnLoadUnifiedConfig(argument);
}

void UIManager::OnSaveSettings(const char* argument)
{
    // Legacy - redirect to unified config
    OnSaveUnifiedConfig(argument);
}

// =============================================================================
// UNIFIED CONFIG (All settings in one file)
// =============================================================================

// Generate a complete default config with all required fields
json GenerateDefaultConfig() {
    return json{
        {"hotkey", "F8"},
        {"hotkeyCode", 66},
        {"pauseGameOnFocus", true},  // If false, game continues running when UI is open
        {"cheatMode", false},
        {"verboseLogging", false},
        // Heart animation settings
        {"heartAnimationEnabled", true},
        {"heartPulseSpeed", 0.06},
        {"heartBgOpacity", 1.0},
        {"heartBgColor", "#0a0a14"},
        {"heartRingColor", "#b8a878"},
        {"learningPathColor", "#00ffff"},
        {"activeProfile", "normal"},
        {"learningMode", "perSchool"},
        {"xpGlobalMultiplier", 1},
        {"xpMultiplierDirect", 100},
        {"xpMultiplierSchool", 50},
        {"xpMultiplierAny", 10},
        {"xpCapAny", 5},
        {"xpCapSchool", 15},
        {"xpCapDirect", 50},
        {"xpNovice", 100},
        {"xpApprentice", 200},
        {"xpAdept", 400},
        {"xpExpert", 800},
        {"xpMaster", 1500},
        {"revealName", 10},
        {"revealEffects", 25},
        {"revealDescription", 50},
        {"discoveryMode", false},
        {"nodeSizeScaling", true},
        {"earlySpellLearning", {
            {"enabled", true},
            {"unlockThreshold", 25.0f},
            {"selfCastRequiredAt", 75.0f},
            {"selfCastXPMultiplier", 150.0f},
            {"binaryEffectThreshold", 80.0f},
            {"modifyGameDisplay", true},
            {"powerSteps", json::array({
                {{"xp", 25}, {"power", 20}, {"label", "Budding"}},
                {{"xp", 40}, {"power", 35}, {"label", "Developing"}},
                {{"xp", 55}, {"power", 50}, {"label", "Practicing"}},
                {{"xp", 70}, {"power", 65}, {"label", "Advancing"}},
                {{"xp", 85}, {"power", 80}, {"label", "Refining"}},
                {{"xp", 100}, {"power", 100}, {"label", "Mastered"}}
            })}
        }},
        {"spellTomeLearning", {
            {"enabled", true},
            {"useProgressionSystem", true},
            {"grantXPOnRead", true},
            {"autoSetLearningTarget", true},
            {"showNotifications", true},
            {"xpPercentToGrant", 25.0f},
            {"tomeInventoryBoost", true},
            {"tomeInventoryBoostPercent", 25.0f},
            {"requirePrereqs", true},
            {"requireAllPrereqs", true},
            {"requireSkillLevel", false}
        }},
        {"passiveLearning", {
            {"enabled", false},
            {"scope", "novice"},
            {"xpPerGameHour", 5},
            {"maxByTier", {
                {"novice", 100},
                {"apprentice", 75},
                {"adept", 50},
                {"expert", 25},
                {"master", 5}
            }}
        }},
        {"notifications", {
            {"weakenedSpellNotifications", true},
            {"weakenedSpellInterval", 10.0f}
        }},
        {"llm", {
            {"apiKey", ""},
            {"model", "anthropic/claude-sonnet-4"},
            {"maxTokens", 64000}
        }},
        {"schoolColors", json::object()},
        {"customProfiles", json::object()}
    };
}

// Recursively merge src into dst, only overwriting non-null values
void MergeJsonNonNull(json& dst, const json& src) {
    if (!src.is_object()) return;
    for (auto& [key, value] : src.items()) {
        if (value.is_null()) continue;  // Skip null values
        if (value.is_object() && dst.contains(key) && dst[key].is_object()) {
            MergeJsonNonNull(dst[key], value);  // Recursive merge for objects
        } else {
            dst[key] = value;  // Overwrite with non-null value
        }
    }
}

void UIManager::OnLoadUnifiedConfig([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: LoadUnifiedConfig requested");

    AddTaskToGameThread("LoadUnifiedConfig", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        auto path = GetUnifiedConfigPath();

    // Also check legacy paths and merge if needed
    auto legacySettingsPath = GetSettingsFilePath();
    auto legacyLLMPath = std::filesystem::path("Data/SKSE/Plugins/SpellLearning/openrouter_config.json");

    // Start with complete defaults - this ensures all fields exist
    json unifiedConfig = GenerateDefaultConfig();
    bool configFileExists = false;

    // Try to load existing unified config and merge (non-null values only)
    if (std::filesystem::exists(path)) {
        try {
            std::ifstream file(path);
            json loadedConfig = json::parse(file);
            MergeJsonNonNull(unifiedConfig, loadedConfig);
            configFileExists = true;
            logger::info("UIManager: Loaded and merged unified config");
        } catch (const std::exception& e) {
            logger::warn("UIManager: Failed to parse unified config: {} - using defaults", e.what());
        }
    } else {
        logger::info("UIManager: No config file found, using defaults");
    }

    // Migrate legacy settings if they exist
    if (std::filesystem::exists(legacySettingsPath)) {
        try {
            std::ifstream file(legacySettingsPath);
            json legacySettings = json::parse(file);
            MergeJsonNonNull(unifiedConfig, legacySettings);
            logger::info("UIManager: Migrated legacy settings.json");
        } catch (...) {}
    }

    // Migrate legacy LLM config
    if (std::filesystem::exists(legacyLLMPath)) {
        try {
            std::ifstream file(legacyLLMPath);
            json legacyLLM = json::parse(file);
            json llmConfig = {
                {"apiKey", SafeJsonValue<std::string>(legacyLLM, "apiKey", "")},
                {"model", SafeJsonValue<std::string>(legacyLLM, "model", "anthropic/claude-sonnet-4")},
                {"maxTokens", SafeJsonValue<int>(legacyLLM, "maxTokens", 64000)}
            };
            MergeJsonNonNull(unifiedConfig["llm"], llmConfig);
            logger::info("UIManager: Migrated legacy openrouter_config.json");
        } catch (...) {}
    }

    // Save defaults if no config file existed (creates the file for user)
    if (!configFileExists) {
        try {
            std::filesystem::create_directories(path.parent_path());
            std::ofstream outFile(path);
            outFile << unifiedConfig.dump(2);
            logger::info("UIManager: Created default config file at {}", path.string());
        } catch (const std::exception& e) {
            logger::warn("UIManager: Failed to save default config: {}", e.what());
        }
    }

    // Update InputHandler with loaded hotkey
    if (unifiedConfig.contains("hotkeyCode") && !unifiedConfig["hotkeyCode"].is_null()) {
        uint32_t keyCode = unifiedConfig["hotkeyCode"].get<uint32_t>();
        UpdateInputHandlerHotkey(keyCode);
        logger::info("UIManager: Updated hotkey from config: {}", keyCode);
    }

    // Update pause game on focus setting
    if (unifiedConfig.contains("pauseGameOnFocus") && !unifiedConfig["pauseGameOnFocus"].is_null()) {
        bool pauseGame = unifiedConfig["pauseGameOnFocus"].get<bool>();
        GetSingleton()->SetPauseGameOnFocus(pauseGame);
        logger::info("UIManager: Updated pauseGameOnFocus from config: {}", pauseGame);
    }

    // Update ProgressionManager with loaded XP settings
    // All fields are guaranteed to exist from defaults, but use SafeJsonValue for extra safety
    ProgressionManager::XPSettings xpSettings;
    xpSettings.learningMode = SafeJsonValue<std::string>(unifiedConfig, "learningMode", "perSchool");
    xpSettings.globalMultiplier = SafeJsonValue<float>(unifiedConfig, "xpGlobalMultiplier", 1.0f);
    xpSettings.multiplierDirect = SafeJsonValue<float>(unifiedConfig, "xpMultiplierDirect", 100.0f) / 100.0f;
    xpSettings.multiplierSchool = SafeJsonValue<float>(unifiedConfig, "xpMultiplierSchool", 50.0f) / 100.0f;
    xpSettings.multiplierAny = SafeJsonValue<float>(unifiedConfig, "xpMultiplierAny", 10.0f) / 100.0f;
    // XP caps (max contribution from each source)
    xpSettings.capAny = SafeJsonValue<float>(unifiedConfig, "xpCapAny", 5.0f);
    xpSettings.capSchool = SafeJsonValue<float>(unifiedConfig, "xpCapSchool", 15.0f);
    xpSettings.capDirect = SafeJsonValue<float>(unifiedConfig, "xpCapDirect", 50.0f);
    // Tier XP requirements
    xpSettings.xpNovice = SafeJsonValue<float>(unifiedConfig, "xpNovice", 100.0f);
    xpSettings.xpApprentice = SafeJsonValue<float>(unifiedConfig, "xpApprentice", 200.0f);
    xpSettings.xpAdept = SafeJsonValue<float>(unifiedConfig, "xpAdept", 400.0f);
    xpSettings.xpExpert = SafeJsonValue<float>(unifiedConfig, "xpExpert", 800.0f);
    xpSettings.xpMaster = SafeJsonValue<float>(unifiedConfig, "xpMaster", 1500.0f);
    // Preserve modded sources registered by API consumers before config loaded
    xpSettings.moddedSources = ProgressionManager::GetSingleton()->GetXPSettings().moddedSources;
    ProgressionManager::GetSingleton()->SetXPSettings(xpSettings);

    // Update SpellEffectivenessHook with early learning settings
    if (unifiedConfig.contains("earlySpellLearning") && !unifiedConfig["earlySpellLearning"].is_null()) {
        auto& elConfig = unifiedConfig["earlySpellLearning"];
        SpellEffectivenessHook::EarlyLearningSettings elSettings;
        elSettings.enabled = SafeJsonValue<bool>(elConfig, "enabled", true);
        elSettings.unlockThreshold = SafeJsonValue<float>(elConfig, "unlockThreshold", 25.0f);
        elSettings.selfCastRequiredAt = SafeJsonValue<float>(elConfig, "selfCastRequiredAt", 75.0f);
        elSettings.selfCastXPMultiplier = SafeJsonValue<float>(elConfig, "selfCastXPMultiplier", 150.0f) / 100.0f;
        elSettings.binaryEffectThreshold = SafeJsonValue<float>(elConfig, "binaryEffectThreshold", 80.0f);
        elSettings.modifyGameDisplay = SafeJsonValue<bool>(elConfig, "modifyGameDisplay", true);
        SpellEffectivenessHook::GetSingleton()->SetSettings(elSettings);

        // Load configurable power steps if present
        if (elConfig.contains("powerSteps") && !elConfig["powerSteps"].is_null() && elConfig["powerSteps"].is_array()) {
            std::vector<SpellEffectivenessHook::PowerStep> steps;
            for (const auto& stepJson : elConfig["powerSteps"]) {
                if (stepJson.is_null()) continue;
                SpellEffectivenessHook::PowerStep step;
                step.progressThreshold = SafeJsonValue<float>(stepJson, "xp", 25.0f);
                step.effectiveness = SafeJsonValue<float>(stepJson, "power", 20.0f) / 100.0f;  // Convert % to 0-1
                step.label = SafeJsonValue<std::string>(stepJson, "label", "Stage");
                steps.push_back(step);
            }
            if (!steps.empty()) {
                SpellEffectivenessHook::GetSingleton()->SetPowerSteps(steps);
            }
        }
    }

    // Update SpellTomeHook with tome learning settings
    if (unifiedConfig.contains("spellTomeLearning") && !unifiedConfig["spellTomeLearning"].is_null()) {
        auto& tomeConfig = unifiedConfig["spellTomeLearning"];
        SpellTomeHook::Settings tomeSettings;
        tomeSettings.enabled = SafeJsonValue<bool>(tomeConfig, "enabled", true);
        tomeSettings.useProgressionSystem = SafeJsonValue<bool>(tomeConfig, "useProgressionSystem", true);
        tomeSettings.grantXPOnRead = SafeJsonValue<bool>(tomeConfig, "grantXPOnRead", true);
        tomeSettings.autoSetLearningTarget = SafeJsonValue<bool>(tomeConfig, "autoSetLearningTarget", true);
        tomeSettings.showNotifications = SafeJsonValue<bool>(tomeConfig, "showNotifications", true);
        tomeSettings.xpPercentToGrant = SafeJsonValue<float>(tomeConfig, "xpPercentToGrant", 25.0f);
        tomeSettings.tomeInventoryBoost = SafeJsonValue<bool>(tomeConfig, "tomeInventoryBoost", true);
        tomeSettings.tomeInventoryBoostPercent = SafeJsonValue<float>(tomeConfig, "tomeInventoryBoostPercent", 25.0f);
        // Learning requirements
        tomeSettings.requirePrereqs = SafeJsonValue<bool>(tomeConfig, "requirePrereqs", true);
        tomeSettings.requireAllPrereqs = SafeJsonValue<bool>(tomeConfig, "requireAllPrereqs", true);
        tomeSettings.requireSkillLevel = SafeJsonValue<bool>(tomeConfig, "requireSkillLevel", false);
        SpellTomeHook::GetSingleton()->SetSettings(tomeSettings);
        logger::info("UIManager: Applied SpellTomeHook settings - useProgressionSystem: {}, requirePrereqs: {}, requireAllPrereqs: {}, requireSkillLevel: {}",
            tomeSettings.useProgressionSystem, tomeSettings.requirePrereqs, tomeSettings.requireAllPrereqs, tomeSettings.requireSkillLevel);
    }

    // Update PassiveLearningSource with passive learning settings
    if (unifiedConfig.contains("passiveLearning") && !unifiedConfig["passiveLearning"].is_null()) {
        auto& plConfig = unifiedConfig["passiveLearning"];
        SpellLearning::PassiveLearningSource::Settings plSettings;
        plSettings.enabled = SafeJsonValue<bool>(plConfig, "enabled", false);
        plSettings.scope = SafeJsonValue<std::string>(plConfig, "scope", "novice");
        plSettings.xpPerGameHour = SafeJsonValue<float>(plConfig, "xpPerGameHour", 5.0f);
        if (plConfig.contains("maxByTier") && plConfig["maxByTier"].is_object()) {
            auto& tiers = plConfig["maxByTier"];
            plSettings.maxNovice = SafeJsonValue<float>(tiers, "novice", 100.0f);
            plSettings.maxApprentice = SafeJsonValue<float>(tiers, "apprentice", 75.0f);
            plSettings.maxAdept = SafeJsonValue<float>(tiers, "adept", 50.0f);
            plSettings.maxExpert = SafeJsonValue<float>(tiers, "expert", 25.0f);
            plSettings.maxMaster = SafeJsonValue<float>(tiers, "master", 5.0f);
        }
        auto* passiveSource = SpellLearning::PassiveLearningSource::GetSingleton();
        if (passiveSource) {
            passiveSource->SetSettings(plSettings);
        }
        logger::info("UIManager: Applied passive learning settings - enabled: {}, scope: {}, xp/hr: {}",
            plSettings.enabled, plSettings.scope, plSettings.xpPerGameHour);
    }

    // Update SpellCastHandler with notification settings
    if (unifiedConfig.contains("notifications") && !unifiedConfig["notifications"].is_null()) {
        auto& notifConfig = unifiedConfig["notifications"];
        auto* castHandler = SpellCastHandler::GetSingleton();
        castHandler->SetWeakenedNotificationsEnabled(SafeJsonValue<bool>(notifConfig, "weakenedSpellNotifications", true));
        castHandler->SetNotificationInterval(SafeJsonValue<float>(notifConfig, "weakenedSpellInterval", 10.0f));
        logger::info("UIManager: Applied notification settings - weakened enabled: {}, interval: {}s",
            castHandler->GetWeakenedNotificationsEnabled(), castHandler->GetNotificationInterval());
    }

    // Strip internal sources from config before sending to UI (they have their own UI sections)
    if (unifiedConfig.contains("moddedXPSources") && unifiedConfig["moddedXPSources"].is_object()) {
        auto& sources = ProgressionManager::GetSingleton()->GetXPSettings().moddedSources;
        for (auto it = unifiedConfig["moddedXPSources"].begin(); it != unifiedConfig["moddedXPSources"].end();) {
            if (sources.count(it.key()) && sources.at(it.key()).internal) {
                it = unifiedConfig["moddedXPSources"].erase(it);
            } else {
                ++it;
            }
        }
    }

    // Send to UI
    std::string configStr = unifiedConfig.dump();
    logger::info("UIManager: Sending unified config to UI ({} bytes)", configStr.size());
    instance->m_prismaUI->InteropCall(instance->m_view, "onUnifiedConfigLoaded", configStr.c_str());

    // Re-notify all registered external modded XP sources to the UI.
    // Sources registered before PrismaUI was ready had their notifications dropped,
    // so we push them all now that the view is live. Skip internal sources (e.g. passive).
    auto& moddedSources = ProgressionManager::GetSingleton()->GetXPSettings().moddedSources;
    int notifiedCount = 0;
    for (auto& [srcId, srcConfig] : moddedSources) {
        if (srcConfig.internal) continue;
        instance->NotifyModdedSourceRegistered(srcId, srcConfig.displayName, srcConfig.multiplier, srcConfig.cap);
        notifiedCount++;
    }
    if (notifiedCount > 0) {
        logger::info("UIManager: Re-notified {} modded XP sources to UI", notifiedCount);
    }

    // Notify UI of ISL detection status (fresh detection, not from saved config)
    instance->NotifyISLDetectionStatus();
    });
}

void UIManager::OnSaveUnifiedConfig(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveUnifiedConfig - no data provided");
        return;
    }

    // Debounce: skip if we saved very recently (prevents double-save on panel close)
    auto* instance = GetSingleton();
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - instance->m_lastConfigSaveTime).count();
    if (elapsed < kConfigSaveDebounceMs) {
        logger::info("UIManager: SaveUnifiedConfig debounced ({}ms since last save)", elapsed);
        return;
    }
    instance->m_lastConfigSaveTime = now;

    logger::info("UIManager: SaveUnifiedConfig");

    // Capture the argument as a string so we can defer the heavy work
    std::string configData(argument);

    // Defer the actual save + settings reapplication to the next game frame
    // This prevents disk I/O from competing with the game engine during the
    // critical resume frame when the panel closes and the game un-pauses
    AddTaskToGameThread("SaveUnifiedConfig", [configData = std::move(configData)]() {
        auto* inst = GetSingleton();
        inst->DoSaveUnifiedConfig(configData);
    });
}

void UIManager::DoSaveUnifiedConfig(const std::string& configData)
{
    auto path = GetUnifiedConfigPath();

    // Ensure directory exists
    std::filesystem::create_directories(path.parent_path());

    try {
        // Parse incoming config
        json newConfig = json::parse(configData);

        // Load existing config to preserve any fields not in the update
        json existingConfig;
        if (std::filesystem::exists(path)) {
            try {
                std::ifstream existingFile(path);
                existingConfig = json::parse(existingFile);
            } catch (...) {}
        }

        // Merge new config into existing (new values override)
        for (auto& [key, value] : newConfig.items()) {
            existingConfig[key] = value;
        }

        // Update hotkey in InputHandler if changed
        if (newConfig.contains("hotkeyCode")) {
            uint32_t keyCode = newConfig["hotkeyCode"].get<uint32_t>();
            UpdateInputHandlerHotkey(keyCode);
        }

        // Update pause game on focus if changed
        if (newConfig.contains("pauseGameOnFocus")) {
            bool pauseGame = newConfig["pauseGameOnFocus"].get<bool>();
            GetSingleton()->SetPauseGameOnFocus(pauseGame);
        }

        // Update XP settings in ProgressionManager if changed
        ProgressionManager::XPSettings xpSettings;
        xpSettings.learningMode = SafeJsonValue<std::string>(newConfig, "learningMode", "perSchool");
        xpSettings.globalMultiplier = SafeJsonValue<float>(newConfig, "xpGlobalMultiplier", 1.0f);
        xpSettings.multiplierDirect = SafeJsonValue<float>(newConfig, "xpMultiplierDirect", 100.0f) / 100.0f;
        xpSettings.multiplierSchool = SafeJsonValue<float>(newConfig, "xpMultiplierSchool", 50.0f) / 100.0f;
        xpSettings.multiplierAny = SafeJsonValue<float>(newConfig, "xpMultiplierAny", 10.0f) / 100.0f;
        // XP caps (max contribution from each source)
        xpSettings.capAny = SafeJsonValue<float>(newConfig, "xpCapAny", 5.0f);
        xpSettings.capSchool = SafeJsonValue<float>(newConfig, "xpCapSchool", 15.0f);
        xpSettings.capDirect = SafeJsonValue<float>(newConfig, "xpCapDirect", 50.0f);
        // Tier XP requirements
        xpSettings.xpNovice = SafeJsonValue<float>(newConfig, "xpNovice", 100.0f);
        xpSettings.xpApprentice = SafeJsonValue<float>(newConfig, "xpApprentice", 200.0f);
        xpSettings.xpAdept = SafeJsonValue<float>(newConfig, "xpAdept", 400.0f);
        xpSettings.xpExpert = SafeJsonValue<float>(newConfig, "xpExpert", 800.0f);
        xpSettings.xpMaster = SafeJsonValue<float>(newConfig, "xpMaster", 1500.0f);

        // Load modded XP source settings from config
        if (newConfig.contains("moddedXPSources") && newConfig["moddedXPSources"].is_object()) {
            for (auto& [srcId, srcData] : newConfig["moddedXPSources"].items()) {
                ProgressionManager::ModdedSourceConfig config;
                config.displayName = SafeJsonValue<std::string>(srcData, "displayName", srcId);
                config.enabled = SafeJsonValue<bool>(srcData, "enabled", true);
                config.multiplier = SafeJsonValue<float>(srcData, "multiplier", 100.0f);
                config.cap = SafeJsonValue<float>(srcData, "cap", 25.0f);
                xpSettings.moddedSources[srcId] = config;
            }
            logger::info("UIManager: Loaded {} modded XP source configs", xpSettings.moddedSources.size());
        }

        // Preserve modded sources registered by API consumers that aren't in the saved config
        for (auto& [srcId, srcConfig] : ProgressionManager::GetSingleton()->GetXPSettings().moddedSources) {
            if (xpSettings.moddedSources.find(srcId) == xpSettings.moddedSources.end()) {
                xpSettings.moddedSources[srcId] = srcConfig;
            }
        }
        ProgressionManager::GetSingleton()->SetXPSettings(xpSettings);

        // Update early learning settings in SpellEffectivenessHook if changed
        if (newConfig.contains("earlySpellLearning") && !newConfig["earlySpellLearning"].is_null()) {
            auto& elConfig = newConfig["earlySpellLearning"];
            SpellEffectivenessHook::EarlyLearningSettings elSettings;
            elSettings.enabled = SafeJsonValue<bool>(elConfig, "enabled", true);
            elSettings.unlockThreshold = SafeJsonValue<float>(elConfig, "unlockThreshold", 25.0f);
            elSettings.selfCastRequiredAt = SafeJsonValue<float>(elConfig, "selfCastRequiredAt", 75.0f);
            elSettings.selfCastXPMultiplier = SafeJsonValue<float>(elConfig, "selfCastXPMultiplier", 150.0f) / 100.0f;
            elSettings.binaryEffectThreshold = SafeJsonValue<float>(elConfig, "binaryEffectThreshold", 80.0f);
            elSettings.modifyGameDisplay = SafeJsonValue<bool>(elConfig, "modifyGameDisplay", true);
            SpellEffectivenessHook::GetSingleton()->SetSettings(elSettings);

            // Load configurable power steps if present
            if (elConfig.contains("powerSteps") && !elConfig["powerSteps"].is_null() && elConfig["powerSteps"].is_array()) {
                std::vector<SpellEffectivenessHook::PowerStep> steps;
                for (const auto& stepJson : elConfig["powerSteps"]) {
                    if (stepJson.is_null()) continue;
                    SpellEffectivenessHook::PowerStep step;
                    step.progressThreshold = SafeJsonValue<float>(stepJson, "xp", 25.0f);
                    step.effectiveness = SafeJsonValue<float>(stepJson, "power", 20.0f) / 100.0f;  // Convert % to 0-1
                    step.label = SafeJsonValue<std::string>(stepJson, "label", "Stage");
                    steps.push_back(step);
                }
                if (!steps.empty()) {
                    SpellEffectivenessHook::GetSingleton()->SetPowerSteps(steps);
                }
            }
        }

        // Update SpellTomeHook settings if changed
        if (newConfig.contains("spellTomeLearning") && !newConfig["spellTomeLearning"].is_null()) {
            auto& tomeConfig = newConfig["spellTomeLearning"];
            SpellTomeHook::Settings tomeSettings;
            tomeSettings.enabled = SafeJsonValue<bool>(tomeConfig, "enabled", true);
            tomeSettings.useProgressionSystem = SafeJsonValue<bool>(tomeConfig, "useProgressionSystem", true);
            tomeSettings.grantXPOnRead = SafeJsonValue<bool>(tomeConfig, "grantXPOnRead", true);
            tomeSettings.autoSetLearningTarget = SafeJsonValue<bool>(tomeConfig, "autoSetLearningTarget", true);
            tomeSettings.showNotifications = SafeJsonValue<bool>(tomeConfig, "showNotifications", true);
            tomeSettings.xpPercentToGrant = SafeJsonValue<float>(tomeConfig, "xpPercentToGrant", 25.0f);
            tomeSettings.tomeInventoryBoost = SafeJsonValue<bool>(tomeConfig, "tomeInventoryBoost", true);
            tomeSettings.tomeInventoryBoostPercent = SafeJsonValue<float>(tomeConfig, "tomeInventoryBoostPercent", 25.0f);
            // Learning requirements
            tomeSettings.requirePrereqs = SafeJsonValue<bool>(tomeConfig, "requirePrereqs", true);
            tomeSettings.requireAllPrereqs = SafeJsonValue<bool>(tomeConfig, "requireAllPrereqs", true);
            tomeSettings.requireSkillLevel = SafeJsonValue<bool>(tomeConfig, "requireSkillLevel", false);
            SpellTomeHook::GetSingleton()->SetSettings(tomeSettings);
            logger::info("UIManager: Applied SpellTomeHook settings from save");
        }

        // Update passive learning settings if changed
        if (newConfig.contains("passiveLearning") && !newConfig["passiveLearning"].is_null()) {
            auto& plConfig = newConfig["passiveLearning"];
            SpellLearning::PassiveLearningSource::Settings plSettings;
            plSettings.enabled = SafeJsonValue<bool>(plConfig, "enabled", false);
            plSettings.scope = SafeJsonValue<std::string>(plConfig, "scope", "novice");
            plSettings.xpPerGameHour = SafeJsonValue<float>(plConfig, "xpPerGameHour", 5.0f);
            if (plConfig.contains("maxByTier") && plConfig["maxByTier"].is_object()) {
                auto& tiers = plConfig["maxByTier"];
                plSettings.maxNovice = SafeJsonValue<float>(tiers, "novice", 100.0f);
                plSettings.maxApprentice = SafeJsonValue<float>(tiers, "apprentice", 75.0f);
                plSettings.maxAdept = SafeJsonValue<float>(tiers, "adept", 50.0f);
                plSettings.maxExpert = SafeJsonValue<float>(tiers, "expert", 25.0f);
                plSettings.maxMaster = SafeJsonValue<float>(tiers, "master", 5.0f);
            }
            auto* passiveSource = SpellLearning::PassiveLearningSource::GetSingleton();
            if (passiveSource) {
                passiveSource->SetSettings(plSettings);
            }
            logger::info("UIManager: Applied passive learning settings from save - enabled: {}",
                plSettings.enabled);
        }

        // Update notification settings if changed
        if (newConfig.contains("notifications") && !newConfig["notifications"].is_null()) {
            auto& notifConfig = newConfig["notifications"];
            auto* castHandler = SpellCastHandler::GetSingleton();
            castHandler->SetWeakenedNotificationsEnabled(SafeJsonValue<bool>(notifConfig, "weakenedSpellNotifications", true));
            castHandler->SetNotificationInterval(SafeJsonValue<float>(notifConfig, "weakenedSpellInterval", 10.0f));
            logger::info("UIManager: Applied notification settings from save - interval: {}s",
                castHandler->GetNotificationInterval());
        }

        // Write merged config
        std::ofstream file(path);
        file << existingConfig.dump(2);  // Pretty print with 2 space indent

        logger::info("UIManager: Unified config saved to {}", path.string());

        // Also update OpenRouter if LLM settings changed
        if (newConfig.contains("llm") && !newConfig["llm"].is_null()) {
            auto& llm = newConfig["llm"];
            auto& config = OpenRouterAPI::GetConfig();

            std::string newKey = SafeJsonValue<std::string>(llm, "apiKey", "");
            if (!newKey.empty() && newKey.find("...") == std::string::npos) {
                config.apiKey = newKey;
            }
            config.model = SafeJsonValue<std::string>(llm, "model", config.model);
            config.maxTokens = SafeJsonValue<int>(llm, "maxTokens", config.maxTokens);

            // Save to OpenRouter's config file too for compatibility
            OpenRouterAPI::SaveConfig();
        }

    } catch (const std::exception& e) {
        logger::error("UIManager: Failed to save unified config: {}", e.what());
    }
}
