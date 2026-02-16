// ============================================================================
// treebuilder-test  —  Standalone TreeBuilder test harness
// ============================================================================
// Runs the TreeBuilder algorithms outside of Skyrim/SKSE.
//
// Usage:
//   treebuilder-test -i spells.json -o tree.json -t classic
//   treebuilder-test --input spells.json --output tree.json --type thematic --seed 42
//   treebuilder-test -i spells.json -o tree.json -t graph -c config.json
//
// Input JSON: either a raw array of spell objects, or an object with a
// "spells" key (matches the in-game UIManager format).
// ============================================================================

#include "Common.h"

#include <chrono>
#include <fstream>
#include <iostream>

#include <nlohmann/json.hpp>

#include "TreeBuilder.h"

using json = nlohmann::json;

// ============================================================================
// Oracle stub  —  satisfies the linker without compiling TreeBuilderOracle.cpp
// ============================================================================

namespace TreeBuilder {
    BuildResult BuildOracle(const std::vector<json>& /*spells*/,
                            const BuildConfig& /*config*/)
    {
        BuildResult result;
        result.success = false;
        result.error   = "Oracle mode is not available in the standalone test harness.";
        return result;
    }
}

// ============================================================================
// Helpers
// ============================================================================

static void PrintUsage(const char* argv0)
{
    std::cerr
        << "Usage: " << argv0 << " [options]\n"
        << "\n"
        << "Required:\n"
        << "  -i, --input  <file>   Input spell JSON file\n"
        << "  -o, --output <file>   Output tree JSON file\n"
        << "  -t, --type   <type>   Builder type: classic, tree, graph, thematic\n"
        << "\n"
        << "Optional:\n"
        << "  -s, --seed   <n>      Random seed (default: 0)\n"
        << "  -c, --config <file>   Config JSON file (default: built-in defaults)\n"
        << "  -h, --help            Show this help\n";
}

static json ReadJsonFile(const std::string& path)
{
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + path);
    }
    return json::parse(file);
}

static void WriteJsonFile(const std::string& path, const json& data)
{
    std::ofstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file for writing: " + path);
    }
    file << data.dump(2);
}

// ============================================================================
// Main
// ============================================================================

int main(int argc, char* argv[])
{
    std::string inputPath;
    std::string outputPath;
    std::string type;
    std::string configPath;
    int         seed = 0;

    // ----- Parse arguments ---------------------------------------------------
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if ((arg == "-i" || arg == "--input") && i + 1 < argc) {
            inputPath = argv[++i];
        } else if ((arg == "-o" || arg == "--output") && i + 1 < argc) {
            outputPath = argv[++i];
        } else if ((arg == "-t" || arg == "--type") && i + 1 < argc) {
            type = argv[++i];
        } else if ((arg == "-s" || arg == "--seed") && i + 1 < argc) {
            seed = std::stoi(argv[++i]);
        } else if ((arg == "-c" || arg == "--config") && i + 1 < argc) {
            configPath = argv[++i];
        } else if (arg == "-h" || arg == "--help") {
            PrintUsage(argv[0]);
            return 0;
        } else {
            std::cerr << "Unknown argument: " << arg << "\n";
            PrintUsage(argv[0]);
            return 1;
        }
    }

    if (inputPath.empty() || outputPath.empty() || type.empty()) {
        std::cerr << "Error: --input, --output, and --type are required.\n\n";
        PrintUsage(argv[0]);
        return 1;
    }

    // ----- Map type to command string ----------------------------------------
    static const std::unordered_map<std::string, std::string> kTypeToCommand = {
        {"classic",  "build_tree_classic"},
        {"tree",     "build_tree"},
        {"graph",    "build_tree_graph"},
        {"thematic", "build_tree_thematic"},
    };

    auto it = kTypeToCommand.find(type);
    if (it == kTypeToCommand.end()) {
        std::cerr << "Error: unknown type '" << type
                  << "'. Must be one of: classic, tree, graph, thematic\n";
        return 1;
    }
    auto command = it->second;

    // ----- Set up spdlog console logger --------------------------------------
    spdlog::set_level(spdlog::level::info);

    // ----- Read input --------------------------------------------------------
    json inputJson;
    try {
        inputJson = ReadJsonFile(inputPath);
    } catch (const std::exception& e) {
        std::cerr << "Error reading input: " << e.what() << "\n";
        return 1;
    }

    // Accept either a raw array or an object with a "spells" key
    std::vector<json> spells;
    json spellsArray;

    if (inputJson.is_array()) {
        spellsArray = inputJson;
    } else if (inputJson.is_object() && inputJson.contains("spells")) {
        spellsArray = inputJson["spells"];
    } else {
        std::cerr << "Error: input JSON must be an array of spells, "
                     "or an object with a \"spells\" key.\n";
        return 1;
    }

    spells.reserve(spellsArray.size());
    for (auto& s : spellsArray) {
        spells.push_back(std::move(s));
    }

    // ----- Read config -------------------------------------------------------
    json configJson = json::object();
    if (!configPath.empty()) {
        try {
            configJson = ReadJsonFile(configPath);
        } catch (const std::exception& e) {
            std::cerr << "Error reading config: " << e.what() << "\n";
            return 1;
        }
    }

    // Inject seed from CLI (overrides config file if both provided)
    if (seed != 0 || !configJson.contains("seed")) {
        configJson["seed"] = seed;
    }

    // ----- Build tree --------------------------------------------------------
    std::cout << "Building " << type << " tree from "
              << spells.size() << " spells (seed=" << seed << ")...\n";

    auto result = TreeBuilder::Build(command, spells, configJson);

    if (!result.success) {
        std::cerr << "Build failed: " << result.error << "\n";
        return 1;
    }

    // ----- Write output ------------------------------------------------------
    try {
        WriteJsonFile(outputPath, result.treeData);
    } catch (const std::exception& e) {
        std::cerr << "Error writing output: " << e.what() << "\n";
        return 1;
    }

    std::cout << "Done. " << spells.size() << " spells -> " << outputPath
              << " (" << result.elapsedMs << " ms)\n";
    return 0;
}
