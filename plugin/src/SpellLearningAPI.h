#pragma once

// =============================================================================
// SpellLearning Public C++ API
// =============================================================================
//
// Include this header in your SKSE plugin to interact with SpellLearning.
//
// Two communication methods:
//   1. SKSE Messaging (fire-and-forget, no dependency required)
//   2. API Interface (full access, requires SpellLearning DLL loaded)
//
// === SKSE Messaging (recommended for simple use) ===
//
//   SpellLearning::AddXPMessage msg;
//   msg.spellFormID = 0x00012AB5;
//   msg.amount = 50.0f;
//   msg.sourceType = SpellLearning::XPSourceType::Custom;
//   strncpy(msg.sourceName, "mymod_source", sizeof(msg.sourceName));
//
//   SKSE::GetMessagingInterface()->Dispatch(
//       SpellLearning::kMessageType_AddXP, &msg, sizeof(msg), "SpellLearning");
//
// === API Interface (full access) ===
//
//   // In your kPostLoad handler:
//   SKSE::GetMessagingInterface()->Dispatch(
//       SpellLearning::kMessageType_RequestAPI, nullptr, 0, "SpellLearning");
//
//   // In your message handler for "SpellLearning":
//   if (msg->type == SpellLearning::kMessageType_RequestAPI) {
//       auto* api = static_cast<SpellLearning::ISpellLearningAPI*>(msg->data);
//       api->AddSourcedXP(formId, 50.0f, "mymod_source");
//   }
//
// =============================================================================

#include <cstdint>
#include <cstring>
#include <string>

namespace SpellLearning {

    constexpr uint32_t kAPIVersion = 1;

    // SKSE message types (dispatched to plugin name "SpellLearning")
    enum MessageType : uint32_t {
        kMessageType_RequestAPI     = 0x534C0001,  // Request ISpellLearningAPI pointer
        kMessageType_AddXP          = 0x534C0002,  // Fire-and-forget XP grant
        kMessageType_RegisterSource = 0x534C0003,  // Fire-and-forget source registration
    };

    enum class XPSourceType : uint32_t {
        Any = 0,
        School = 1,
        Direct = 2,
        Self = 3,
        Raw = 4,       // Bypasses all caps and multipliers
        Custom = 5     // Uses sourceName field
    };

    // Message struct for kMessageType_AddXP
    struct AddXPMessage {
        uint32_t spellFormID;
        float amount;
        XPSourceType sourceType;
        char sourceName[64];  // For Custom type -- null-terminated source ID
    };

    // Message struct for kMessageType_RegisterSource
    struct RegisterSourceMessage {
        char sourceId[64];      // Null-terminated source ID
        char displayName[128];  // Null-terminated display name for UI
    };

    // Full API interface (returned via kMessageType_RequestAPI)
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
        if (src) {
            strncpy(dest, src, destSize - 1);
            dest[destSize - 1] = '\0';
        } else {
            dest[0] = '\0';
        }
    }

}  // namespace SpellLearning
