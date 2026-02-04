// WinHTTP needs Windows types - must come before CommonLibSSE 
// (which uses WIN32_LEAN_AND_MEAN)
#define NOMINMAX
#include <winsock2.h>
#include <windows.h>
#include <winhttp.h>

#include "PCH.h"
#include "OpenRouterAPI.h"
#include <fstream>
#include <thread>
#include <nlohmann/json.hpp>

#pragma comment(lib, "winhttp.lib")

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
    static std::filesystem::path s_configPath = "Data/SKSE/Plugins/SpellLearning/openrouter_config.json";

    bool Initialize() {
        if (s_initialized) return true;

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
            file << j.dump(2);
            
            logger::info("OpenRouterAPI: Saved config");
        } catch (const std::exception& e) {
            logger::error("OpenRouterAPI: Failed to save config: {}", e.what());
        }
    }

    // Internal HTTP POST function
    static std::string HttpPost(const std::string& host, const std::string& path, 
                                 const std::string& body, const std::string& authHeader) {
        std::string result;
        
        HINTERNET hSession = WinHttpOpen(
            L"SpellLearning/1.0",
            WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
            WINHTTP_NO_PROXY_NAME,
            WINHTTP_NO_PROXY_BYPASS,
            0
        );

        if (!hSession) {
            logger::error("OpenRouterAPI: WinHttpOpen failed: {}", GetLastError());
            return "";
        }

        // Convert host to wide string
        std::wstring wHost(host.begin(), host.end());
        
        HINTERNET hConnect = WinHttpConnect(hSession, wHost.c_str(), INTERNET_DEFAULT_HTTPS_PORT, 0);
        if (!hConnect) {
            logger::error("OpenRouterAPI: WinHttpConnect failed: {}", GetLastError());
            WinHttpCloseHandle(hSession);
            return "";
        }

        // Convert path to wide string
        std::wstring wPath(path.begin(), path.end());

        HINTERNET hRequest = WinHttpOpenRequest(
            hConnect,
            L"POST",
            wPath.c_str(),
            NULL,
            WINHTTP_NO_REFERER,
            WINHTTP_DEFAULT_ACCEPT_TYPES,
            WINHTTP_FLAG_SECURE
        );

        if (!hRequest) {
            logger::error("OpenRouterAPI: WinHttpOpenRequest failed: {}", GetLastError());
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            return "";
        }

        // Set headers
        std::wstring headers = L"Content-Type: application/json\r\n";
        headers += L"Authorization: Bearer ";
        headers += std::wstring(authHeader.begin(), authHeader.end());
        headers += L"\r\n";
        headers += L"HTTP-Referer: https://github.com/SpellLearning\r\n";
        headers += L"X-Title: SpellLearning\r\n";

        BOOL bResults = WinHttpSendRequest(
            hRequest,
            headers.c_str(),
            -1,
            (LPVOID)body.c_str(),
            (DWORD)body.length(),
            (DWORD)body.length(),
            0
        );

        if (!bResults) {
            logger::error("OpenRouterAPI: WinHttpSendRequest failed: {}", GetLastError());
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            return "";
        }

        bResults = WinHttpReceiveResponse(hRequest, NULL);
        if (!bResults) {
            logger::error("OpenRouterAPI: WinHttpReceiveResponse failed: {}", GetLastError());
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            return "";
        }

        // Read response
        DWORD dwSize = 0;
        DWORD dwDownloaded = 0;

        do {
            dwSize = 0;
            if (!WinHttpQueryDataAvailable(hRequest, &dwSize)) {
                logger::error("OpenRouterAPI: WinHttpQueryDataAvailable failed: {}", GetLastError());
                break;
            }

            if (dwSize == 0) break;

            char* buffer = new char[dwSize + 1];
            ZeroMemory(buffer, dwSize + 1);

            if (WinHttpReadData(hRequest, buffer, dwSize, &dwDownloaded)) {
                result.append(buffer, dwDownloaded);
            }

            delete[] buffer;
        } while (dwSize > 0);

        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);

        return result;
    }

    Response SendPrompt(const std::string& systemPrompt, const std::string& userPrompt) {
        Response response;

        if (s_config.apiKey.empty()) {
            response.error = "API key not configured";
            logger::error("OpenRouterAPI: {}", response.error);
            return response;
        }

        // Build request body
        json requestBody;
        requestBody["model"] = s_config.model;
        requestBody["max_tokens"] = s_config.maxTokens;
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
            s_config.apiKey
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

    void SendPromptAsync(const std::string& systemPrompt, const std::string& userPrompt,
                         std::function<void(const Response&)> callback) {
        logger::info("OpenRouterAPI: Starting async request thread");
        
        std::thread([systemPrompt, userPrompt, callback]() {
            logger::info("OpenRouterAPI: Thread started, calling SendPrompt");
            Response response = SendPrompt(systemPrompt, userPrompt);
            
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
