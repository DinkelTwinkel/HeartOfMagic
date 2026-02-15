#pragma once

// =============================================================================
// SpellLearning Public C++ API
// =============================================================================
//
// Include this header in your SKSE plugin to interact with SpellLearning.
//
// === Setup (in SKSEPluginLoad) ===
//
//   // Register to receive API broadcast from SpellLearning
//   SKSE::GetMessagingInterface()->RegisterListener("SpellLearning", OnSpellLearningMessage);
//
// === Receiving the API (in your message callback) ===
//
//   void OnSpellLearningMessage(SKSE::MessagingInterface::Message* msg) {
//       if (msg->type == SpellLearning::kMessageType_APIReady && msg->data) {
//           auto* api = static_cast<SpellLearning::ISpellLearningAPI*>(msg->data);
//           // Store and use api pointer
//       }
//   }
//
// SpellLearning broadcasts the API at kPostPostLoad. Your plugin receives it
// automatically if you registered with RegisterListener("SpellLearning", ...).
// Use the API at kDataLoaded or later when game data is available.
//
// =============================================================================

#include <cstdint>
#include <cstring>
#include <string>

namespace SpellLearning {

    constexpr uint32_t kAPIVersion = 1;

    // SKSE message types
    // kMessageType_APIReady is broadcasted BY SpellLearning at kPostPostLoad.
    // Register with: messaging->RegisterListener("SpellLearning", callback)
    enum MessageType : uint32_t {
        kMessageType_APIReady       = 0x534C0001,  // Broadcasted with ISpellLearningAPI* as data
        kMessageType_AddXP          = 0x534C0002,  // Reserved for future fire-and-forget
        kMessageType_RegisterSource = 0x534C0003,  // Reserved for future fire-and-forget

        // Legacy alias (do NOT dispatch this — use the broadcasted API instead)
        kMessageType_RequestAPI     = kMessageType_APIReady,
    };

    enum class XPSourceType : uint32_t {
        Any = 0,
        School = 1,
        Direct = 2,
        Self = 3,
        Raw = 4,       // Bypasses all caps and multipliers
        Custom = 5     // Uses sourceName field
    };

    // Message struct for kMessageType_AddXP (reserved)
    struct AddXPMessage {
        uint32_t spellFormID;
        float amount;
        XPSourceType sourceType;
        char sourceName[64];  // For Custom type -- null-terminated source ID
    };

    // Message struct for kMessageType_RegisterSource (reserved)
    struct RegisterSourceMessage {
        char sourceId[64];      // Null-terminated source ID
        char displayName[128];  // Null-terminated display name for UI
    };

    // Full API interface (received via kMessageType_APIReady broadcast)
    class ISpellLearningAPI {
    public:
        virtual ~ISpellLearningAPI() = default;

        virtual uint32_t GetAPIVersion() const = 0;

        // XP
        virtual float AddSourcedXP(uint32_t spellFormID, float amount, const std::string& sourceName) = 0;
        virtual float AddRawXP(uint32_t spellFormID, float amount) = 0;
        virtual void SetSpellXP(uint32_t spellFormID, float xp) = 0;

        // Queries
        virtual bool IsSpellMastered(uint32_t spellFormID) const = 0;
        virtual bool IsSpellAvailableToLearn(uint32_t spellFormID) const = 0;
        virtual float GetRequiredXP(uint32_t spellFormID) const = 0;
        virtual float GetProgress(uint32_t spellFormID) const = 0;

        // Targets
        virtual uint32_t GetLearningTarget(const std::string& school) const = 0;
        virtual void SetLearningTarget(uint32_t spellFormID) = 0;
        virtual void ClearLearningTarget(const std::string& school) = 0;

        // Settings
        virtual float GetGlobalMultiplier() const = 0;

        // Source registration
        virtual bool RegisterXPSource(const std::string& sourceId, const std::string& displayName) = 0;
    };

    // Convenience: null-safe string copy for message structs
    inline void CopySourceName(char* dest, size_t destSize, const char* src) {
        if (destSize == 0) return;
        if (src) {
            strncpy(dest, src, destSize - 1);
            dest[destSize - 1] = '\0';
        } else {
            dest[0] = '\0';
        }
    }

}  // namespace SpellLearning
