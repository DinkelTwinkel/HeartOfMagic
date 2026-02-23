#include "Common.h"
#include "SpellScanner.h"

namespace SpellScanner
{
    // =============================================================================
    // PERSISTENT FORMID FUNCTIONS (Load Order Resilient)
    // =============================================================================

    std::string GetPersistentFormId(RE::FormID formId)
    {
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) return "";

        uint8_t modIndex = (formId >> 24) & 0xFF;
        uint32_t localFormId = 0;
        const RE::TESFile* plugin = nullptr;

        if (modIndex == 0xFE) {
            // Light plugin (ESL)
            uint16_t lightIndex = (formId >> 12) & 0xFFF;
            plugin = dataHandler->LookupLoadedLightModByIndex(lightIndex);
            localFormId = formId & 0x00000FFF;  // Only 12 bits for light plugins
        } else {
            // Regular plugin
            plugin = dataHandler->LookupLoadedModByIndex(modIndex);
            localFormId = formId & 0x00FFFFFF;  // 24 bits for regular plugins
        }

        if (plugin && plugin->fileName && strlen(plugin->fileName) > 0) {
            return std::format("{}|0x{:06X}", plugin->fileName, localFormId);
        }

        return "";  // Unknown plugin
    }

    RE::FormID ResolvePersistentFormId(const std::string& persistentId)
    {
        // Parse "PluginName.esp|0x123456" format
        auto pipePos = persistentId.find('|');
        if (pipePos == std::string::npos || pipePos == 0) {
            logger::trace("SpellScanner: Invalid persistent ID format (no pipe): {}", persistentId);
            return 0;
        }

        std::string pluginName = persistentId.substr(0, pipePos);
        std::string localIdStr = persistentId.substr(pipePos + 1);

        // Parse local FormID
        uint32_t localFormId = 0;
        try {
            if (localIdStr.length() >= 2 && (localIdStr.substr(0, 2) == "0x" || localIdStr.substr(0, 2) == "0X")) {
                localIdStr = localIdStr.substr(2);
            }
            localFormId = std::stoul(localIdStr, nullptr, 16);
        } catch (const std::exception& e) {
            logger::warn("SpellScanner: Invalid local FormID in persistent ID: {} ({})", persistentId, e.what());
            return 0;
        }

        // Look up plugin by name
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) return 0;

        const RE::TESFile* plugin = dataHandler->LookupModByName(pluginName);
        if (!plugin) {
            logger::trace("SpellScanner: Plugin not loaded: {}", pluginName);
            return 0;
        }

        // Reconstruct full FormID with current mod index
        if (plugin->IsLight()) {
            // Light plugin: 0xFEXXX + 12-bit local ID
            std::uint32_t lightIndex = plugin->GetPartialIndex();
            return (0xFE000000 | ((lightIndex) << 12) | (localFormId & 0xFFF));
        } else {
            // Regular plugin: mod index + 24-bit local ID
            uint8_t modIndex = plugin->GetCompileIndex();
            return (static_cast<uint32_t>(modIndex) << 24) | (localFormId & 0x00FFFFFF);
        }
    }

    bool IsFormIdValid(RE::FormID formId)
    {
        if (formId == 0) return false;
        auto* form = RE::TESForm::LookupByID(formId);
        return form != nullptr;
    }

    bool IsFormIdValid(const std::string& formIdStr)
    {
        if (formIdStr.empty()) return false;

        RE::FormID formId = 0;
        try {
            std::string cleanId = formIdStr;
            if (cleanId.length() >= 2 && (cleanId.substr(0, 2) == "0x" || cleanId.substr(0, 2) == "0X")) {
                cleanId = cleanId.substr(2);
            }
            formId = std::stoul(cleanId, nullptr, 16);
        } catch (...) {
            return false;
        }

        return IsFormIdValid(formId);
    }

    TreeValidationResult ValidateAndFixTree(json& treeData)
    {
        TreeValidationResult result;
        std::set<std::string> missingPluginsSet;
        std::set<std::string> invalidFormIdsSet;

        if (!treeData.contains("schools")) {
            logger::warn("SpellScanner: Tree has no schools key");
            return result;
        }

        for (auto& [schoolName, schoolData] : treeData["schools"].items()) {
            if (!schoolData.contains("nodes") || !schoolData["nodes"].is_array()) {
                continue;
            }

            auto& nodes = schoolData["nodes"];
            std::vector<size_t> nodesToRemove;

            for (size_t i = 0; i < nodes.size(); ++i) {
                auto& node = nodes[i];
                result.totalNodes++;

                if (!node.contains("formId")) {
                    nodesToRemove.push_back(i);
                    result.invalidNodes++;
                    continue;
                }

                std::string formIdStr = node["formId"].get<std::string>();
                bool isValid = IsFormIdValid(formIdStr);

                if (!isValid && node.contains("persistentId")) {
                    // Try to resolve from persistent ID
                    std::string persistentId = node["persistentId"].get<std::string>();
                    RE::FormID resolvedId = ResolvePersistentFormId(persistentId);

                    if (resolvedId != 0 && IsFormIdValid(resolvedId)) {
                        // Update formId with resolved value
                        node["formId"] = std::format("0x{:08X}", resolvedId);
                        isValid = true;
                        result.resolvedFromPersistent++;
                        logger::info("SpellScanner: Resolved {} -> 0x{:08X} from persistent ID",
                            formIdStr, resolvedId);
                    } else {
                        // Extract plugin name from persistent ID for error reporting
                        auto pipePos = persistentId.find('|');
                        if (pipePos != std::string::npos) {
                            missingPluginsSet.insert(persistentId.substr(0, pipePos));
                        }
                    }
                }

                if (isValid) {
                    result.validNodes++;
                } else {
                    nodesToRemove.push_back(i);
                    result.invalidNodes++;
                    invalidFormIdsSet.insert(formIdStr);
                    logger::warn("SpellScanner: Invalid FormID in tree: {}", formIdStr);
                }
            }

            // Remove invalid nodes (reverse order to preserve indices)
            for (auto it = nodesToRemove.rbegin(); it != nodesToRemove.rend(); ++it) {
                nodes.erase(nodes.begin() + *it);
            }

            // Clean up children/prerequisites that reference removed nodes
            for (auto& node : nodes) {
                if (node.contains("children") && node["children"].is_array()) {
                    auto& children = node["children"];
                    children.erase(
                        std::remove_if(children.begin(), children.end(),
                            [&invalidFormIdsSet](const json& child) {
                                return invalidFormIdsSet.count(child.get<std::string>()) > 0;
                            }),
                        children.end());
                }
                if (node.contains("prerequisites") && node["prerequisites"].is_array()) {
                    auto& prereqs = node["prerequisites"];
                    prereqs.erase(
                        std::remove_if(prereqs.begin(), prereqs.end(),
                            [&invalidFormIdsSet](const json& prereq) {
                                return invalidFormIdsSet.count(prereq.get<std::string>()) > 0;
                            }),
                        prereqs.end());
                }
            }

            // Update root if it was invalid
            if (schoolData.contains("root")) {
                std::string rootId = schoolData["root"].get<std::string>();
                if (invalidFormIdsSet.count(rootId) > 0) {
                    // Find first remaining node as new root
                    if (!nodes.empty() && nodes[0].contains("formId")) {
                        schoolData["root"] = nodes[0]["formId"];
                        logger::info("SpellScanner: Updated {} root to {}", schoolName, nodes[0]["formId"].dump());
                    }
                }
            }
        }

        // Convert sets to vectors
        result.missingPlugins.assign(missingPluginsSet.begin(), missingPluginsSet.end());
        result.invalidFormIds.assign(invalidFormIdsSet.begin(), invalidFormIdsSet.end());

        logger::info("SpellScanner: Tree validation complete - {}/{} valid, {} resolved from persistent, {} invalid",
            result.validNodes, result.totalNodes, result.resolvedFromPersistent, result.invalidNodes);

        return result;
    }
}
