#pragma once

#include <string>

// =============================================================================
// ENCODING & SANITIZATION UTILITIES
// =============================================================================
// Common text utilities used throughout the plugin:
// - UTF-8 conversion/validation (encoding)
// - Filename sanitization (filesystem safety)
// =============================================================================

namespace EncodingUtils
{
    // Convert string from system ANSI codepage (GBK/Shift-JIS/etc.) to UTF-8.
    // Skyrim's GetFullName() returns strings in the system's ANSI codepage.
    // The codepage used is determined by the user's Windows locale (CP_ACP).
    std::string ConvertToUTF8(const std::string& input);

    // Sanitize a string to valid UTF-8 for safe JSON serialization.
    // If already valid UTF-8, returns the input unchanged (fast path).
    // Otherwise converts from the system's ANSI codepage.
    std::string SanitizeToUTF8(const std::string& input);

    // Sanitize a string for use as a Windows filename.
    // Replaces forbidden characters (/ \ : * ? " < > |) and control characters
    // (0x00-0x1F) with underscores, trims trailing dots/spaces, prefixes Windows
    // reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) with "_",
    // and returns "_unnamed" if the result is empty.
    std::string SanitizeFilename(const std::string& name);
}
