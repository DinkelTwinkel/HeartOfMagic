#pragma once

// Detect Wine/Proton runtime. Cached after first call.
inline bool IsRunningUnderWine()
{
    static int cached = -1;
    if (cached >= 0) return cached != 0;

    HMODULE ntdll = GetModuleHandleA("ntdll.dll");
    if (ntdll) {
        auto wine_get_version = reinterpret_cast<const char*(*)()>(
            GetProcAddress(ntdll, "wine_get_version"));
        if (wine_get_version) {
            cached = 1;
            return true;
        }
    }
    cached = 0;
    return false;
}
