#pragma once

#include <string>
#include <functional>
#include <future>

namespace OpenRouterAPI {

    struct Config {
        std::string apiKey;
        std::string model = "anthropic/claude-sonnet-4";  // Default model
        int maxTokens = 64000;
    };

    struct Response {
        bool success = false;
        std::string content;
        std::string error;
    };

    // Initialize with API key (loaded from config file)
    bool Initialize();
    
    // Get current config
    Config& GetConfig();
    
    // Save config to file
    void SaveConfig();

    // Send a prompt to OpenRouter (async)
    // Callback will be called on completion
    void SendPromptAsync(
        const std::string& systemPrompt,
        const std::string& userPrompt,
        std::function<void(const Response&)> callback
    );

    // Send a prompt (blocking)
    Response SendPrompt(
        const std::string& systemPrompt,
        const std::string& userPrompt
    );

}
