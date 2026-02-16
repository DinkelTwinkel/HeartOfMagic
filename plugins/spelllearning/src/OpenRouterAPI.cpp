// CommonLib must come FIRST, then Windows headers
#include "Common.h"
#include "OpenRouterAPI.h"

#include <curl/curl.h>

#include <fstream>
#include <nlohmann/json.hpp>
#include <thread>



using json = nlohmann::json;

namespace OpenRouterAPI {

    // =============================================================================
    // UTF-8 SANITIZATION - Fixes invalid characters that crash JSON serialization
    // =============================================================================
    
    /**
     * Sanitize a string to valid UTF-8 by replacing invalid bytes with ASCII equivalents.
     * Windows-1252 characters (0x80-0x9F) and other invalid UTF-8 sequences break JSON parsing.
     * This prevents crashes like: [json.exception.type_error.316] invalid UTF-8 byte
     */
    static std::string SanitizeToUTF8(const std::string& input)
    {
        std::string result;
        result.reserve(input.size());
        
        size_t i = 0;
        while (i < input.size()) {
            unsigned char c = static_cast<unsigned char>(input[i]);
            
            if (c < 0x80) {
                // ASCII (0x00-0x7F) - always valid
                result += static_cast<char>(c);
                i++;
            } else if (c >= 0x80 && c <= 0x9F) {
                // Windows-1252 control characters - replace with ASCII equivalents
                switch (c) {
                    case 0x91: result += '\''; break;  // Left single quote
                    case 0x92: result += '\''; break;  // Right single quote
                    case 0x93: result += '"'; break;   // Left double quote
                    case 0x94: result += '"'; break;   // Right double quote
                    case 0x96: result += '-'; break;   // En dash
                    case 0x97: result += '-'; break;   // Em dash
                    case 0x85: result += "..."; break; // Ellipsis
                    case 0x99: result += "(TM)"; break; // Trademark
                    default: result += '?'; break;     // Unknown - replace with ?
                }
                i++;
            } else if ((c & 0xE0) == 0xC0) {
                // 2-byte UTF-8 sequence (110xxxxx 10xxxxxx)
                if (i + 1 < input.size() && (static_cast<unsigned char>(input[i + 1]) & 0xC0) == 0x80) {
                    result += input[i];
                    result += input[i + 1];
                    i += 2;
                } else {
                    result += '?';  // Invalid sequence
                    i++;
                }
            } else if ((c & 0xF0) == 0xE0) {
                // 3-byte UTF-8 sequence (1110xxxx 10xxxxxx 10xxxxxx)
                if (i + 2 < input.size() && 
                    (static_cast<unsigned char>(input[i + 1]) & 0xC0) == 0x80 &&
                    (static_cast<unsigned char>(input[i + 2]) & 0xC0) == 0x80) {
                    result += input[i];
                    result += input[i + 1];
                    result += input[i + 2];
                    i += 3;
                } else {
                    result += '?';  // Invalid sequence
                    i++;
                }
            } else if ((c & 0xF8) == 0xF0) {
                // 4-byte UTF-8 sequence (11110xxx 10xxxxxx 10xxxxxx 10xxxxxx)
                if (i + 3 < input.size() && 
                    (static_cast<unsigned char>(input[i + 1]) & 0xC0) == 0x80 &&
                    (static_cast<unsigned char>(input[i + 2]) & 0xC0) == 0x80 &&
                    (static_cast<unsigned char>(input[i + 3]) & 0xC0) == 0x80) {
                    result += input[i];
                    result += input[i + 1];
                    result += input[i + 2];
                    result += input[i + 3];
                    i += 4;
                } else {
                    result += '?';  // Invalid sequence
                    i++;
                }
            } else {
                // Invalid UTF-8 lead byte or continuation byte in wrong position
                result += '?';
                i++;
            }
        }
        
        return result;
    }

    static Config s_config;
    static bool s_initialized = false;
    static bool s_curlInitialized = false;
    static std::filesystem::path s_configPath = "Data/SKSE/Plugins/SpellLearning/openrouter_config.json";

    bool Initialize() {
        if (s_initialized) return true;

        // Initialize CURL globally
        if (!s_curlInitialized) {
            CURLcode result = curl_global_init(CURL_GLOBAL_ALL);
            if (result != CURLE_OK) {
                logger::error("OpenRouterAPI: Failed to initialize CURL: {}", curl_easy_strerror(result));
                return false;
            }
            s_curlInitialized = true;
            logger::info("OpenRouterAPI: CURL initialized successfully");
        }

        // Create directory if needed
        std::filesystem::create_directories(s_configPath.parent_path());

        // Try to load config
        if (std::filesystem::exists(s_configPath)) {
            try {
                std::ifstream file(s_configPath);
                json j;
                file >> j;
                
                s_config.apiKey = j.value("apiKey", "");
                s_config.model = j.value("model", "anthropic/claude-sonnet-4");
                s_config.maxTokens = j.value("maxTokens", 4096);
                
                logger::info("OpenRouterAPI: Loaded config, key length: {}", s_config.apiKey.length());
            } catch (const std::exception& e) {
                logger::error("OpenRouterAPI: Failed to load config: {}", e.what());
            }
        } else {
            // Create default config file
            SaveConfig();
            logger::info("OpenRouterAPI: Created default config file at {}", s_configPath.string());
        }

        s_initialized = true;
        return !s_config.apiKey.empty();
    }

    void Shutdown() {
        if (s_curlInitialized) {
            curl_global_cleanup();
            s_curlInitialized = false;
            logger::info("OpenRouterAPI: CURL cleaned up");
        }
        s_initialized = false;
    }

    Config& GetConfig() {
        return s_config;
    }

    void SaveConfig() {
        try {
            json j;
            j["apiKey"] = s_config.apiKey;
            j["model"] = s_config.model;
            j["maxTokens"] = s_config.maxTokens;

            std::ofstream file(s_configPath);
            if (!file.is_open()) {
                logger::error("OpenRouterAPI: Failed to open config file for writing: {}", s_configPath.string());
                return;
            }
            file << j.dump(2);
            
            logger::info("OpenRouterAPI: Saved config");
        } catch (const std::exception& e) {
            logger::error("OpenRouterAPI: Failed to save config: {}", e.what());
        }
    }

    // CURL write callback to collect response data
    static size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
        std::string* response = static_cast<std::string*>(userp);
        size_t totalSize = size * nmemb;
        response->append(static_cast<char*>(contents), totalSize);
        return totalSize;
    }

    // Internal HTTP POST function
    static std::string HttpPost(const std::string& host, const std::string& path, 
                                 const std::string& body, const std::string& authHeader) {
        std::string response;
        
        // Initialize CURL handle
        CURL* curl = curl_easy_init();
        if (!curl) {
            logger::error("OpenRouterAPI: Failed to initialize CURL handle");
            return "";
        }

        // Build the full URL
        std::string url = "https://" + host + path;
        
        // Set up CURL options
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, body.length());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L); // Disable SSL verification for now
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L); // Disable host verification for now
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L); // 30 second timeout
        
        // Set up headers
        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");
        std::string auth = "Authorization: Bearer " + authHeader;
        headers = curl_slist_append(headers, auth.c_str());
        headers = curl_slist_append(headers, "HTTP-Referer: https://github.com/SpellLearning");
        headers = curl_slist_append(headers, "X-Title: SpellLearning");
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        
        // Set user agent
        curl_easy_setopt(curl, CURLOPT_USERAGENT, "SpellLearning/1.0");
        
        // Perform the request
        CURLcode res = curl_easy_perform(curl);
        
        // Clean up headers
        curl_slist_free_all(headers);
        
        if (res != CURLE_OK) {
            logger::error("OpenRouterAPI: CURL request failed: {}", curl_easy_strerror(res));
            curl_easy_cleanup(curl);
            return "";
        }
        
        // Get HTTP response code
        long httpCode = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
        
        curl_easy_cleanup(curl);
        
        if (httpCode != 200) {
            logger::error("OpenRouterAPI: HTTP request failed with code: {}", httpCode);
            return "";
        }
        
        return response;
    }

    // Internal: uses explicit config to avoid racing on s_config from a background thread
    static Response SendPromptWithConfig(const std::string& systemPrompt,
                                         const std::string& userPrompt,
                                         const Config& config) {
        Response response;

        if (config.apiKey.empty()) {
            response.error = "API key not configured";
            logger::error("OpenRouterAPI: {}", response.error);
            return response;
        }

        // Build request body
        json requestBody;
        requestBody["model"] = config.model;
        requestBody["max_tokens"] = config.maxTokens;
        requestBody["messages"] = json::array({
            {{"role", "system"}, {"content", systemPrompt}},
            {{"role", "user"}, {"content", userPrompt}}
        });

        std::string body = requestBody.dump();
        logger::info("OpenRouterAPI: Sending request, body length: {}", body.length());

        // Make HTTP request
        std::string httpResponse = HttpPost(
            "openrouter.ai",
            "/api/v1/chat/completions",
            body,
            config.apiKey
        );

        if (httpResponse.empty()) {
            response.error = "HTTP request failed";
            return response;
        }

        logger::info("OpenRouterAPI: Got response, length: {}", httpResponse.length());

        // Parse response
        try {
            json j = json::parse(httpResponse);
            
            if (j.contains("error")) {
                // Sanitize error message too in case it contains invalid UTF-8
                response.error = SanitizeToUTF8(j["error"].value("message", "Unknown API error"));
                logger::error("OpenRouterAPI: API error: {}", response.error);
                return response;
            }

            if (j.contains("choices") && j["choices"].is_array() && !j["choices"].empty()) {
                // Sanitize LLM response to valid UTF-8 before storing
                // This prevents JSON serialization crashes from invalid byte sequences
                std::string rawContent = j["choices"][0]["message"]["content"].get<std::string>();
                response.content = SanitizeToUTF8(rawContent);
                response.success = true;
                logger::info("OpenRouterAPI: Success, content length: {} (sanitized from {})", 
                            response.content.length(), rawContent.length());
            } else {
                response.error = "Invalid response format";
                logger::error("OpenRouterAPI: {}", response.error);
            }
        } catch (const std::exception& e) {
            response.error = std::string("Failed to parse response: ") + e.what();
            logger::error("OpenRouterAPI: {}", response.error);
        }

        return response;
    }

    Response SendPrompt(const std::string& systemPrompt, const std::string& userPrompt) {
        return SendPromptWithConfig(systemPrompt, userPrompt, s_config);
    }

    void SendPromptAsync(const std::string& systemPrompt, const std::string& userPrompt,
                         std::function<void(const Response&)> callback) {
        logger::info("OpenRouterAPI: Starting async request thread");
        
        // Snapshot config so the background thread doesn't race with game-thread mutations
        Config configCopy = s_config;
        
        std::thread([systemPrompt, userPrompt, callback, configCopy]() {
            logger::info("OpenRouterAPI: Thread started, calling SendPrompt");
            Response response = SendPromptWithConfig(systemPrompt, userPrompt, configCopy);
            
            logger::info("OpenRouterAPI: SendPrompt returned, success={}, content_len={}, error={}", 
                        response.success, response.content.length(), response.error);
            
            // Call callback on main thread via SKSE task
            auto* taskInterface = SKSE::GetTaskInterface();
            if (taskInterface) {
                logger::info("OpenRouterAPI: Adding task to SKSE task interface");
                taskInterface->AddTask([callback, response]() {
                    logger::info("OpenRouterAPI: SKSE task executing callback");
                    callback(response);
                    logger::info("OpenRouterAPI: Callback completed");
                });
            } else {
                logger::error("OpenRouterAPI: SKSE task interface is null! Calling callback directly (may cause issues)");
                callback(response);
            }
        }).detach();
        
        logger::info("OpenRouterAPI: Thread detached");
    }

}
