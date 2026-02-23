#include "Common.h"
#include "SpellScanner.h"

namespace SpellScanner
{
    // =============================================================================
    // UTF-8 ENCODING - Handles international text (Chinese/Japanese/Korean/etc.)
    // =============================================================================

    // Forward declaration (internal to this file)
    std::string SanitizeToUTF8Strict(const std::string& input);

    /**
     * Convert string from system ANSI codepage (e.g., GBK for Chinese Windows) to UTF-8.
     * This is needed because Skyrim's GetFullName() returns strings in the system's ANSI codepage,
     * not UTF-8. Chinese/Japanese/Korean users will have GBK/Shift-JIS/EUC-KR encoded strings.
     */
    std::string ConvertToUTF8(const std::string& input)
    {
        if (input.empty()) return input;

        // First, convert from ANSI (system codepage) to wide string (UTF-16)
        int wideLen = MultiByteToWideChar(CP_ACP, 0, input.c_str(), -1, nullptr, 0);
        if (wideLen <= 0) {
            // Conversion failed, return sanitized version as fallback
            return SanitizeToUTF8Strict(input);
        }

        std::wstring wideStr(wideLen, L'\0');
        MultiByteToWideChar(CP_ACP, 0, input.c_str(), -1, &wideStr[0], wideLen);

        // Then convert from UTF-16 to UTF-8
        int utf8Len = WideCharToMultiByte(CP_UTF8, 0, wideStr.c_str(), -1, nullptr, 0, nullptr, nullptr);
        if (utf8Len <= 0) {
            return SanitizeToUTF8Strict(input);
        }

        std::string utf8Str(utf8Len, '\0');
        WideCharToMultiByte(CP_UTF8, 0, wideStr.c_str(), -1, &utf8Str[0], utf8Len, nullptr, nullptr);

        // Remove null terminator if present
        if (!utf8Str.empty() && utf8Str.back() == '\0') {
            utf8Str.pop_back();
        }

        return utf8Str;
    }

    /**
     * Strict UTF-8 sanitization - validates and fixes invalid UTF-8 sequences.
     * Uses Windows API (MB_ERR_INVALID_CHARS) for correct handling of overlongs,
     * surrogates, and code points above U+10FFFF.
     */
    std::string SanitizeToUTF8Strict(const std::string& input)
    {
        // Fast path: validate entire string as UTF-8 via Windows API
        int wideLen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                           input.c_str(), static_cast<int>(input.size()),
                                           nullptr, 0);
        if (wideLen > 0) {
            // Already valid UTF-8 — round-trip through UTF-16 to normalize
            std::wstring wide(wideLen, L'\0');
            MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                               input.c_str(), static_cast<int>(input.size()),
                               &wide[0], wideLen);
            int utf8Len = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), wideLen,
                                              nullptr, 0, nullptr, nullptr);
            std::string result(utf8Len, '\0');
            WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), wideLen,
                               &result[0], utf8Len, nullptr, nullptr);
            return result;
        }

        // Invalid UTF-8 somewhere — salvage byte by byte
        std::string result;
        result.reserve(input.size());

        size_t i = 0;
        while (i < input.size()) {
            unsigned char c = static_cast<unsigned char>(input[i]);

            if (c < 0x80) {
                result += static_cast<char>(c);
                ++i;
                continue;
            }

            // Determine expected multi-byte sequence length
            int seqLen = 0;
            if (c >= 0xC2 && c <= 0xDF) seqLen = 2;
            else if (c >= 0xE0 && c <= 0xEF) seqLen = 3;
            else if (c >= 0xF0 && c <= 0xF4) seqLen = 4;

            if (seqLen > 0 && i + seqLen <= input.size()) {
                // Let the API validate this sequence (catches overlongs, surrogates, etc.)
                int testLen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                                  &input[i], seqLen, nullptr, 0);
                if (testLen > 0) {
                    result.append(input, i, seqLen);
                    i += seqLen;
                    continue;
                }
            }

            // Windows-1252 control characters — map to ASCII equivalents
            if (c >= 0x80 && c <= 0x9F) {
                switch (c) {
                    case 0x91: case 0x92: result += '\''; break;
                    case 0x93: case 0x94: result += '"'; break;
                    case 0x96: case 0x97: result += '-'; break;
                    case 0x85: result += "..."; break;
                    case 0x99: result += "(TM)"; break;
                    default: break;
                }
            }
            ++i;
        }

        return result;
    }

    /**
     * Convert a string to valid UTF-8 for JSON serialization.
     * Handles:
     * - Chinese (GBK), Japanese (Shift-JIS), Korean (EUC-KR) via system codepage
     * - Windows-1252 special characters
     * - Already-valid UTF-8 (passed through efficiently)
     */
    std::string SanitizeToUTF8(const std::string& input)
    {
        if (input.empty()) return input;

        // Check if input is already valid UTF-8 via Windows API
        // MB_ERR_INVALID_CHARS correctly rejects overlongs, surrogates, and >U+10FFFF
        if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                input.c_str(), static_cast<int>(input.size()),
                                nullptr, 0) > 0) {
            return input;
        }

        // Not valid UTF-8, try converting from system codepage (GBK/Shift-JIS/etc.)
        return ConvertToUTF8(input);
    }
}
