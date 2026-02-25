#include "Common.h"
#include "uimanager/UIManager.h"
#include "SpellScanner.h"
#include "ProgressionManager.h"
#include "treebuilder/TreeBuilder.h"
#include "treebuilder/TreeNLP.h"
#include "ThreadUtils.h"

// =============================================================================
// TREE TAB CALLBACKS
// =============================================================================

void UIManager::OnLoadSpellTree([[maybe_unused]] const char* argument)
{
    logger::info("UIManager: LoadSpellTree callback triggered");

    AddTaskToGameThread("LoadSpellTree", []() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        auto treePath = GetTreeFilePath();

        // Check if saved tree exists
        if (!std::filesystem::exists(treePath)) {
            logger::info("UIManager: No saved spell tree found");
            instance->UpdateTreeStatus("No saved tree - import one");
            return;
        }

        try {
            std::ifstream file(treePath);
            if (file.is_open()) {
                std::stringstream buffer;
                buffer << file.rdbuf();
                file.close();

                std::string treeContent = buffer.str();
                logger::info("UIManager: Loaded spell tree from file ({} bytes)", treeContent.size());

                // Parse and validate tree - this resolves persistentId to current formId
                // when load order has changed since tree was generated
                try {
                    json treeData = json::parse(treeContent);

                    // Validate and fix form IDs using persistent IDs
                    auto validationResult = SpellScanner::ValidateAndFixTree(treeData);
                    if (validationResult.resolvedFromPersistent > 0) {
                        logger::info("UIManager: Resolved {} spells from persistent IDs (load order changed)",
                            validationResult.resolvedFromPersistent);
                        // Update tree content with resolved form IDs
                        treeContent = treeData.dump();
                    }
                    if (validationResult.invalidNodes > 0) {
                        logger::warn("UIManager: {} spells could not be resolved (plugins may be missing)",
                            validationResult.invalidNodes);
                    }

                    // Send validated tree data to viewer
                    instance->SendTreeData(treeContent);

                    // Collect all formIds, fetch spell info, and sync requiredXP to ProgressionManager
                    std::vector<std::string> formIds;
                    auto* pm = ProgressionManager::GetSingleton();
                    int xpSyncCount = 0;

                    if (treeData.contains("schools")) {
                        for (auto& [schoolName, schoolData] : treeData["schools"].items()) {
                            if (schoolData.contains("nodes")) {
                                for (auto& node : schoolData["nodes"]) {
                                    if (node.contains("formId")) {
                                        std::string formIdStr = node["formId"].get<std::string>();
                                        formIds.push_back(formIdStr);

                                        // Sync requiredXP from tree to ProgressionManager
                                        if (node.contains("requiredXP") && node["requiredXP"].is_number()) {
                                            float reqXP = node["requiredXP"].get<float>();
                                            if (reqXP > 0) {
                                                try {
                                                    RE::FormID formId = std::stoul(formIdStr, nullptr, 0);
                                                    pm->SetRequiredXP(formId, reqXP);
                                                    xpSyncCount++;
                                                } catch (const std::exception& e) {
                                                    logger::warn("UIManager: Failed to parse formId '{}' for XP sync: {}", formIdStr, e.what());
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (xpSyncCount > 0) {
                        logger::info("UIManager: Synced requiredXP for {} spells from tree to ProgressionManager", xpSyncCount);
                    }

                    // Fetch spell info for all formIds and send as batch
                    if (!formIds.empty()) {
                        json spellInfoArray = json::array();
                        for (const auto& formIdStr : formIds) {
                            auto spellInfo = SpellScanner::GetSpellInfoByFormId(formIdStr);
                            if (!spellInfo.empty()) {
                                try {
                                    spellInfoArray.push_back(json::parse(spellInfo));
                                } catch (const std::exception& e) {
                                    logger::warn("UIManager: Failed to parse spell info for formId {}: {}", formIdStr, e.what());
                                }
                            }
                        }
                        instance->SendSpellInfoBatch(spellInfoArray.dump());
                    }
                } catch (const std::exception& e) {
                    logger::error("UIManager: Failed to parse/validate tree: {}", e.what());
                    // Still try to send raw content as fallback
                    instance->SendTreeData(treeContent);
                }

            } else {
                logger::warn("UIManager: Could not open spell tree file");
            }
        } catch (const std::exception& e) {
            logger::error("UIManager: Exception while loading spell tree: {}", e.what());
        }
    });
}

void UIManager::OnGetSpellInfo(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: GetSpellInfo - no formId provided");
        return;
    }

    logger::info("UIManager: GetSpellInfo for formId: {}", argument);

    std::string argStr(argument);

    AddTaskToGameThread("GetSpellInfo", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Get spell info from SpellScanner
        std::string spellInfo = SpellScanner::GetSpellInfoByFormId(argStr);

        if (!spellInfo.empty()) {
            instance->SendSpellInfo(spellInfo);
        } else {
            logger::warn("UIManager: No spell found for formId: {}", argStr);
        }
    });
}

void UIManager::OnGetSpellInfoBatch(const char* argument)
{
    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: GetSpellInfoBatch - no data provided");
        return;
    }

    std::string argStr(argument);

    AddTaskToGameThread("GetSpellInfoBatch", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        try {
            // Parse JSON array of formIds
            json formIdArray = json::parse(argStr);

            if (!formIdArray.is_array()) {
                logger::error("UIManager: GetSpellInfoBatch - expected JSON array");
                return;
            }

            logger::info("UIManager: GetSpellInfoBatch for {} formIds", formIdArray.size());

            json resultArray = json::array();
            int foundCount = 0;
            int notFoundCount = 0;

            for (const auto& formIdJson : formIdArray) {
                if (!formIdJson.is_string()) {
                    logger::warn("UIManager: Skipping non-string formId in batch request");
                    continue;
                }
                std::string formIdStr = formIdJson.get<std::string>();

                // Validate formId format (should be 0x followed by 8 hex chars)
                if (formIdStr.length() < 3 || formIdStr.substr(0, 2) != "0x") {
                    logger::warn("UIManager: Invalid formId format: {}", formIdStr);
                    json notFound;
                    notFound["formId"] = formIdStr;
                    notFound["notFound"] = true;
                    resultArray.push_back(notFound);
                    notFoundCount++;
                    continue;
                }

                std::string spellInfo = SpellScanner::GetSpellInfoByFormId(formIdStr);

                if (!spellInfo.empty()) {
                    try {
                        resultArray.push_back(json::parse(spellInfo));
                        foundCount++;
                    } catch (const std::exception& e) {
                        logger::warn("UIManager: Failed to parse spell info in batch for {}: {}", formIdStr, e.what());
                        json notFound;
                        notFound["formId"] = formIdStr;
                        notFound["notFound"] = true;
                        resultArray.push_back(notFound);
                        notFoundCount++;
                    }
                } else {
                    json notFound;
                    notFound["formId"] = formIdStr;
                    notFound["notFound"] = true;
                    resultArray.push_back(notFound);
                    notFoundCount++;
                }
            }

            logger::info("UIManager: Batch result - {} found, {} not found", foundCount, notFoundCount);

            // Send batch result
            instance->SendSpellInfoBatch(resultArray.dump());

        } catch (const std::exception& e) {
            logger::error("UIManager: GetSpellInfoBatch exception: {}", e.what());
        }
    });
}

void UIManager::OnSaveSpellTree(const char* argument)
{
    logger::info("UIManager: SaveSpellTree callback triggered");

    if (!argument || strlen(argument) == 0) {
        logger::warn("UIManager: SaveSpellTree - no content to save");
        return;
    }

    std::string argStr(argument);

    AddTaskToGameThread("SaveSpellTree", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Create output directory
        std::filesystem::path outputDir = "Data/SKSE/Plugins/SpellLearning";
        std::filesystem::create_directories(outputDir);

        // Write to file
        auto treePath = GetTreeFilePath();

        try {
            std::ofstream file(treePath);
            if (file.is_open()) {
                file << argStr;
                file.flush();
                if (file.fail()) {
                    logger::error("UIManager: Failed to write spell tree to {}", treePath.string());
                    instance->UpdateTreeStatus("Save failed");
                } else {
                    logger::info("UIManager: Saved spell tree to {}", treePath.string());
                    instance->UpdateTreeStatus("Tree saved");
                }
            } else {
                logger::error("UIManager: Failed to open spell tree file for writing");
                instance->UpdateTreeStatus("Save failed");
            }
        } catch (const std::exception& e) {
            logger::error("UIManager: Exception while saving spell tree: {}", e.what());
            instance->UpdateTreeStatus("Save failed");
        }
    });
}

// =============================================================================
// PROCEDURAL TREE GENERATION (C++ native)
// =============================================================================

void UIManager::OnProceduralTreeGenerate(const char* argument)
{
    logger::info("UIManager: ProceduralTreeGenerate callback triggered (C++ native)");

    // Copy argument — must defer via AddTask to avoid re-entrant JS calls.
    // InteropCall back into JS from within a RegisterJSListener callback
    // doesn't work in Ultralight (re-entrant), so we defer to SKSE task thread.
    std::string argStr(argument ? argument : "");

    AddTaskToGameThread("ProceduralTreeGenerate", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Guard against concurrent tree builds
        bool expected = false;
        if (!instance->m_treeBuildInProgress.compare_exchange_strong(expected, true)) {
            logger::warn("UIManager: Tree build already in progress, ignoring request");
            nlohmann::json response;
            response["success"] = false;
            response["error"] = "Tree build already in progress. Please wait for the current build to finish.";
            instance->m_prismaUI->InteropCall(instance->m_view, "onProceduralTreeComplete", response.dump().c_str());
            return;
        }

        try {
            nlohmann::json request = nlohmann::json::parse(argStr);

            std::string command = "build_tree";
            if (request.contains("command") && request["command"].is_string()) {
                command = request["command"].get<std::string>();
            }

            auto spellsJson = request.value("spells", nlohmann::json::array());
            auto configJson = request.value("config", nlohmann::json::object());

            // Convert spells array (plain C++ data — no RE:: needed)
            std::vector<json> spells;
            spells.reserve(spellsJson.size());
            for (const auto& s : spellsJson) {
                spells.push_back(s);
            }

            logger::info("UIManager: Dispatching tree build to background thread ({} command, {} spells)", command, spells.size());

            // Launch background thread — TreeBuilder has ZERO RE:: dependencies
            std::thread([command, spells = std::move(spells), configJson]() {
                try {
                    auto result = TreeBuilder::Build(command, spells, configJson);

                    // Marshal result back to game thread for UI callback
                    AddTaskToGameThread("TreeBuildComplete", [result = std::move(result), command]() {
                        auto* inst = GetSingleton();
                        if (!inst) return;
                        inst->m_treeBuildInProgress = false;

                        if (!inst->m_prismaUI) return;

                        nlohmann::json response;
                        if (result.success) {
                            response["success"] = true;
                            response["treeData"] = result.treeData.dump();
                            response["elapsed"] = result.elapsedMs / 1000.0;
                            logger::info("UIManager: {} completed in {:.2f}s Data size: {} bytes (background thread)", command, result.elapsedMs / 1000.0, result.treeData.dump().size());
                        } else {
                            response["success"] = false;
                            response["error"] = result.error;
                            logger::error("UIManager: {} failed: {}", command, result.error);
                        }

                        inst->m_prismaUI->InteropCall(inst->m_view, "onProceduralTreeComplete", response.dump().c_str());
                    });
                } catch (const std::exception& e) {
                    logger::error("UIManager: TreeBuilder::Build exception: {}", e.what());
                    AddTaskToGameThread("TreeBuildFailed", [error = std::string(e.what())]() {
                        auto* inst = GetSingleton();
                        if (!inst) return;
                        inst->m_treeBuildInProgress = false;
                        if (!inst->m_prismaUI) return;
                        nlohmann::json response;
                        response["success"] = false;
                        response["error"] = error;
                        inst->m_prismaUI->InteropCall(inst->m_view, "onProceduralTreeComplete", response.dump().c_str());
                    });
                } catch (...) {
                    logger::error("UIManager: TreeBuilder::Build unknown exception");
                    AddTaskToGameThread("TreeBuildFailed", []() {
                        auto* inst = GetSingleton();
                        if (!inst) return;
                        inst->m_treeBuildInProgress = false;
                        if (!inst->m_prismaUI) return;
                        nlohmann::json response;
                        response["success"] = false;
                        response["error"] = "Unknown internal error during tree build";
                        inst->m_prismaUI->InteropCall(inst->m_view, "onProceduralTreeComplete", response.dump().c_str());
                    });
                }
            }).detach();

        } catch (const std::exception& e) {
            logger::error("UIManager: ProceduralTreeGenerate failed: {}", e.what());
            instance->m_treeBuildInProgress = false;

            nlohmann::json response;
            response["success"] = false;
            response["error"] = e.what();
            instance->m_prismaUI->InteropCall(instance->m_view, "onProceduralTreeComplete", response.dump().c_str());
        }
    });
}

// =============================================================================
// PRE REQ MASTER NLP SCORING (C++ native)
// =============================================================================

void UIManager::OnPreReqMasterScore(const char* argument)
{
    logger::info("UIManager: PreReqMasterScore callback triggered (C++ native)");

    std::string argStr(argument ? argument : "");

    AddTaskToGameThread("PreReqMasterScore", [argStr]() {
        auto* instance = GetSingleton();
        if (!instance || !instance->m_prismaUI) return;

        // Guard against concurrent PRM scoring
        bool expected = false;
        if (!instance->m_prmScoreInProgress.compare_exchange_strong(expected, true)) {
            logger::warn("UIManager: PRM scoring already in progress, ignoring request");
            nlohmann::json response;
            response["success"] = false;
            response["error"] = "PRM scoring already in progress. Please wait.";
            instance->m_prismaUI->InteropCall(instance->m_view, "onPreReqMasterComplete", response.dump().c_str());
            return;
        }

        try {
            nlohmann::json request = nlohmann::json::parse(argStr);

            logger::info("UIManager: Dispatching PRM scoring to background thread");

            // Launch background thread — TreeNLP has ZERO RE:: dependencies
            std::thread([request = std::move(request)]() {
                try {
                    auto startTime = std::chrono::high_resolution_clock::now();
                    auto result = TreeNLP::ProcessPRMRequest(request);
                    auto endTime = std::chrono::high_resolution_clock::now();
                    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime).count() / 1000.0;

                    logger::info("UIManager: prm_score completed in {:.2f}s (background thread)", elapsed);

                    AddTaskToGameThread("PRMScoreComplete", [result = std::move(result)]() {
                        auto* inst = GetSingleton();
                        if (!inst) return;
                        inst->m_prmScoreInProgress = false;

                        if (!inst->m_prismaUI) return;
                        inst->m_prismaUI->InteropCall(inst->m_view, "onPreReqMasterComplete", result.dump().c_str());
                    });
                } catch (const std::exception& e) {
                    logger::error("UIManager: ProcessPRMRequest exception: {}", e.what());
                    AddTaskToGameThread("PRMScoreFailed", [error = std::string(e.what())]() {
                        auto* inst = GetSingleton();
                        if (!inst) return;
                        inst->m_prmScoreInProgress = false;
                        if (!inst->m_prismaUI) return;
                        nlohmann::json result;
                        result["success"] = false;
                        result["error"] = error;
                        inst->m_prismaUI->InteropCall(inst->m_view, "onPreReqMasterComplete", result.dump().c_str());
                    });
                } catch (...) {
                    logger::error("UIManager: ProcessPRMRequest unknown exception");
                    AddTaskToGameThread("PRMScoreFailed", []() {
                        auto* inst = GetSingleton();
                        if (!inst) return;
                        inst->m_prmScoreInProgress = false;
                        if (!inst->m_prismaUI) return;
                        nlohmann::json result;
                        result["success"] = false;
                        result["error"] = "Unknown internal error during PRM scoring";
                        inst->m_prismaUI->InteropCall(inst->m_view, "onPreReqMasterComplete", result.dump().c_str());
                    });
                }
            }).detach();

        } catch (const std::exception& e) {
            logger::error("UIManager: PRM scoring failed: {}", e.what());
            instance->m_prmScoreInProgress = false;

            nlohmann::json response;
            response["success"] = false;
            response["error"] = e.what();
            instance->m_prismaUI->InteropCall(instance->m_view, "onPreReqMasterComplete", response.dump().c_str());
        }
    });
}
