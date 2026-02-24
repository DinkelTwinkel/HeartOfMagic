#include "Common.h"
#include "uimanager/UIManager.h"
#include "uimanager/UIManagerInternal.h"
#include "OpenRouterAPI.h"
#include "ThreadUtils.h"

// =============================================================================
// LLM STATUS CHECK
// =============================================================================

void UIManager::OnCheckLLM([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: CheckLLM callback triggered (OpenRouter mode)");

    AddTaskToGameThread("CheckLLM", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Initialize OpenRouter API
        bool hasApiKey = OpenRouterAPI::Initialize();

        json result;
        result["available"] = hasApiKey;
        result["version"] = hasApiKey ? "OpenRouter: " + OpenRouterAPI::GetConfig().model : "No API key";

        if (!hasApiKey) {
            logger::warn("UIManager: OpenRouter API key not configured. Edit: Data/SKSE/Plugins/SpellLearning/openrouter_config.json");
        } else {
            logger::info("UIManager: OpenRouter ready with model: {}", OpenRouterAPI::GetConfig().model);
        }

        // Send result to UI
        instance->m_prismaUI->InteropCall(instance->m_view, "onLLMStatus", result.dump().c_str());
    });
}

// =============================================================================
// LLM TREE GENERATION
// =============================================================================

void UIManager::OnLLMGenerate([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: LLM Generate callback triggered (OpenRouter mode)");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: LLM Generate - no data provided");
        return;
    }

    std::string argStr(argument);

    AddTaskToGameThread("LLMGenerate", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        try {
            json request = json::parse(argStr);

        std::string schoolName = request.value("school", "");
        std::string spellData = request.value("spellData", "");
        std::string promptRules = request.value("promptRules", "");

        // NOTE: Mutates global config for this request. Thread safety depends on
        // UI callbacks being serialized via AddTaskToGameThread.
        auto& config = OpenRouterAPI::GetConfig();
        if (request.contains("model") && !request["model"].get<std::string>().empty()) {
            config.model = request["model"].get<std::string>();
            logger::info("UIManager: Using model from request: {}", config.model);
        }
        if (request.contains("maxTokens") && request["maxTokens"].is_number_integer()) {
            int maxTokens = request["maxTokens"].get<int>();
            if (maxTokens > 0 && maxTokens <= 100000) {
                config.maxTokens = maxTokens;
                logger::info("UIManager: Using maxTokens from request: {}", config.maxTokens);
            } else {
                logger::warn("UIManager: maxTokens {} out of range, keeping default {}", maxTokens, config.maxTokens);
            }
        }
        if (request.contains("apiKey") && !request["apiKey"].get<std::string>().empty()) {
            std::string newKey = request["apiKey"].get<std::string>();
            if (newKey.find("...") == std::string::npos) {  // Not masked
                config.apiKey = newKey;
            }
        }

        // Get tree generation settings
        bool allowMultiplePrereqs = request.value("allowMultiplePrereqs", true);
        bool aggressiveValidation = request.value("aggressiveValidation", true);

        logger::info("UIManager: LLM generate request for school: {}, spellData length: {}, model: {}, maxTokens: {}, multiPrereqs: {}, aggressiveValidation: {}",
                    schoolName, spellData.length(), config.model, config.maxTokens, allowMultiplePrereqs, aggressiveValidation);

        // Check if API key is configured
        if (config.apiKey.empty()) {
            json errorResponse;
            errorResponse["status"] = "error";
            errorResponse["school"] = schoolName;
            errorResponse["message"] = "API key not configured - check Settings";
            instance->m_prismaUI->InteropCall(instance->m_view, "onLLMQueued", errorResponse.dump().c_str());
            return;
        }

        // Notify UI that we're processing
        json queuedResponse;
        queuedResponse["status"] = "queued";
        queuedResponse["school"] = schoolName;
        queuedResponse["message"] = "Sending to OpenRouter...";
        instance->m_prismaUI->InteropCall(instance->m_view, "onLLMQueued", queuedResponse.dump().c_str());

        // Build prompts
        std::string systemPrompt = R"(You are a Skyrim spell tree architect. Your task is to create a logical spell learning tree for a single magic school. You MUST return ONLY valid JSON - no explanations, no markdown code blocks, just raw JSON.

## OUTPUT FORMAT

Return ONLY this JSON structure:

{
  "version": "1.0",
  "schools": {
    "SCHOOL_NAME": {
      "root": "0xFORMID",
      "layoutStyle": "radial",
      "nodes": [
        {
          "formId": "0xFORMID",
          "children": ["0xCHILD1"],
          "prerequisites": [],
          "tier": 1
        }
      ]
    }
  }
}

## LAYOUT STYLES - Choose one per school based on tree structure:
- radial: Nodes spread in a fan pattern. Best for balanced trees with many branches (2-3 children per node)
- focused: Nodes stay close to center line. Best for linear progressions with few branches
- clustered: Related spells group together. Best for trees with clear thematic divisions (elements, spell families)
- cascading: Nodes cascade in staggered columns. Best for deep trees with many tiers
- organic: Slightly varied positions for natural feel. Best for mixed/modded spell collections

## CRITICAL RULES
1. Use ONLY formIds from the spell data - copy them EXACTLY
2. Every spell MUST appear exactly ONCE
3. Each school has exactly ONE root spell (prerequisites=[])
4. Maximum 3 children per node
5. Same-tier branching allowed (Novice can unlock Novice)
6. NEVER put a spell as its own prerequisite (no self-references!)
7. Choose layoutStyle based on how you structured the tree
8. AVOID long linear chains (A->B->C->D->...) - prefer branching trees where nodes have 2-3 children
9. Group similar spell variants (e.g. Locust I, II, III) under a common parent rather than in a chain
10. Return raw JSON ONLY - no markdown, no explanations
11. EVERY spell MUST be reachable from the root! There must be a valid unlock path from root to EVERY spell
12. NO PREREQUISITE CYCLES! Never create circular dependencies (A->B->C->A). The tree must be a DAG (directed acyclic graph)
13. Children array defines unlock paths - a spell's children can be unlocked AFTER the parent is unlocked
14. If a spell has multiple prerequisites, ALL of those prerequisites must be independently reachable from root)";

        // Add multiple prerequisite encouragement if enabled
        if (allowMultiplePrereqs) {
            systemPrompt += R"(

## MULTIPLE PREREQUISITES (ENABLED)
You are ENCOURAGED to design spells with MULTIPLE prerequisites to create interesting unlock choices:
- Expert/Master spells should often require 2 prerequisites (convergence points)
- Example: "Firestorm" requires BOTH "Fireball" AND "Fire Rune" to unlock
- This creates branching unlock paths where players must master multiple spell lines
- Aim for 20-30% of non-root spells to have 2 prerequisites
- Never more than 3 prerequisites per spell
- All prerequisites must be reachable from root independently)";
        }

        // Add validation rules based on setting
        if (!aggressiveValidation) {
            systemPrompt += R"(

## RELAXED VALIDATION
You have more freedom in tree design:
- Cross-tier connections allowed (Adept spell can lead to Apprentice)
- Some experimental/unusual unlock paths are acceptable
- Focus on thematic connections over strict tier progression)";
        }

        // Check request type
        bool isCorrection = request.value("isCorrection", false);
        bool isColorSuggestion = request.value("isColorSuggestion", false);
        std::string correctionPrompt = request.value("correctionPrompt", "");

        std::string userPrompt;
        std::string effectiveSystemPrompt = systemPrompt;

        if (isColorSuggestion) {
            // Color suggestion mode - simple prompt, no system context needed
            effectiveSystemPrompt = "You are a helpful assistant. Respond only with valid JSON.";
            userPrompt = promptRules;  // The full prompt is in promptRules for color suggestions
            logger::info("UIManager: Color suggestion request");
        } else if (isCorrection && !correctionPrompt.empty()) {
            // Correction mode - use the correction prompt directly
            userPrompt = correctionPrompt;
            logger::info("UIManager: Correction request for {}", schoolName);
        } else {
            // Normal generation mode
            userPrompt = "Create a spell learning tree for the " + schoolName + " school of magic.\n\n";

            if (!promptRules.empty()) {
                userPrompt += "## USER RULES\n" + promptRules + "\n\n";
            }

            userPrompt += "## SPELL DATA FOR " + schoolName + "\n\n" + spellData;
        }

        logger::info("UIManager: Sending to OpenRouter, system prompt length: {}, user prompt length: {}",
                    effectiveSystemPrompt.length(), userPrompt.length());

        // Send async request to OpenRouter
        OpenRouterAPI::SendPromptAsync(effectiveSystemPrompt, userPrompt,
            [instance, schoolName](const OpenRouterAPI::Response& response) {
                json result;

                if (response.success) {
                    result["hasResponse"] = true;
                    result["success"] = 1;
                    result["response"] = response.content;
                    logger::info("UIManager: OpenRouter success for {}, response length: {}",
                                schoolName, response.content.length());
                } else {
                    result["hasResponse"] = true;
                    result["success"] = 0;
                    result["response"] = response.error;
                    logger::error("UIManager: OpenRouter error for {}: {}", schoolName, response.error);
                }

                instance->m_prismaUI->InteropCall(instance->m_view, "onLLMPollResult", result.dump().c_str());
            });

    } catch (const std::exception& e) {
        logger::error("UIManager: LLM Generate exception: {}", e.what());

        json errorResult;
        errorResult["hasResponse"] = true;
        errorResult["success"] = 0;
        errorResult["response"] = std::string("Exception: ") + e.what();
        instance->m_prismaUI->InteropCall(instance->m_view, "onLLMPollResult", errorResult.dump().c_str());
    }
    });
}

// =============================================================================
// LLM RESPONSE POLLING (Legacy file-based)
// =============================================================================

void UIManager::OnPollLLMResponse([[maybe_unused]] const char* argument)
{
    AddTaskToGameThread("PollLLMResponse", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        std::filesystem::path responsePath = "Data/SKSE/Plugins/SpellLearning/skyrimnet_response.json";

        json result;
        result["hasResponse"] = false;

        if (std::filesystem::exists(responsePath)) {
            try {
                std::ifstream file(responsePath);
                std::string content((std::istreambuf_iterator<char>(file)),
                                   std::istreambuf_iterator<char>());
                file.close();

                if (!content.empty()) {
                    // Papyrus writes format: "success|response"
                    // Where success is 0 or 1, and response is the LLM JSON
                    size_t delimPos = content.find('|');

                    if (delimPos != std::string::npos) {
                        std::string successStr = content.substr(0, delimPos);
                        std::string response = content.substr(delimPos + 1);

                        int success = 0;
                        try {
                            success = std::stoi(successStr);
                        } catch (...) {
                            logger::warn("UIManager: Failed to parse success value: {}", successStr);
                        }

                        result["hasResponse"] = true;
                        result["success"] = success;
                        result["response"] = response;

                        logger::info("UIManager: Found LLM response, success={}, length={}",
                                    success, response.length());

                        // Clear the response file after reading
                        std::ofstream clearFile(responsePath);
                        clearFile << "";
                        clearFile.close();
                    } else {
                        logger::warn("UIManager: Response missing delimiter, content: {}",
                                    content.substr(0, 50));
                    }
                }
            } catch (const std::exception& e) {
                logger::warn("UIManager: Failed to read LLM response: {}", e.what());
            }
        }

        instance->m_prismaUI->InteropCall(instance->m_view, "onLLMPollResult", result.dump().c_str());
    });
}

// =============================================================================
// LLM CONFIG (OpenRouter)
// =============================================================================

void UIManager::OnLoadLLMConfig([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: LoadLLMConfig callback triggered");

    AddTaskToGameThread("LoadLLMConfig", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Initialize OpenRouter (loads config from file)
        OpenRouterAPI::Initialize();

        auto& config = OpenRouterAPI::GetConfig();

        json result;
        result["apiKey"] = config.apiKey;  // Will be masked in JS
        result["model"] = config.model;
        result["maxTokens"] = config.maxTokens;

        instance->m_prismaUI->InteropCall(instance->m_view, "onLLMConfigLoaded", result.dump().c_str());

        logger::info("UIManager: LLM config sent to UI, hasKey: {}", !config.apiKey.empty());
    });
}

void UIManager::OnSaveLLMConfig(const char* argument)
{
    logger::info("UIManager: SaveLLMConfig callback triggered");

    std::string argStr(argument ? argument : "");

    AddTaskToGameThread("SaveLLMConfig", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        json result;
        result["success"] = false;

        try {
            json request = json::parse(argStr);

            auto& config = OpenRouterAPI::GetConfig();

            // Only update API key if a new one was provided
            std::string newKey = SafeJsonValue<std::string>(request, "apiKey", "");
            if (!newKey.empty() && newKey.find("...") == std::string::npos) {
                config.apiKey = newKey;
                logger::info("UIManager: Updated API key, length: {}", newKey.length());
            }

            // Always update model
            config.model = SafeJsonValue<std::string>(request, "model", config.model);

            // Update maxTokens if provided
            int newMaxTokens = SafeJsonValue<int>(request, "maxTokens", config.maxTokens);
            if (newMaxTokens > 0 && newMaxTokens <= 100000) {
                config.maxTokens = newMaxTokens;
            }

            // Save to file
            OpenRouterAPI::SaveConfig();

            result["success"] = true;
            logger::info("UIManager: LLM config saved, model: {}", config.model);

        } catch (const std::exception& e) {
            result["error"] = e.what();
            logger::error("UIManager: Failed to save LLM config: {}", e.what());
        }

        instance->m_prismaUI->InteropCall(instance->m_view, "onLLMConfigSaved", result.dump().c_str());
    });
}
