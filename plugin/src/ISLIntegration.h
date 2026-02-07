#pragma once

#include "PCH.h"

namespace DESTIntegration {
    
    // Don't Eat Spell Tomes (DEST) integration
    // Intercepts spell tome reading events and applies our progression system
    // Pure C++ logic - Papyrus only forwards events
    
    struct DESTConfig {
        bool enabled = true;  // Enable DEST integration when detected
    };
    
    // Check if DEST mod is loaded
    bool IsDESTInstalled();
    
    // Get the detected plugin name
    const char* GetDESTPluginName();
    
    // Initialize DEST integration (call after data loaded)
    void Initialize();
    
    // Shutdown DEST integration
    void Shutdown();
    
    // Check if integration is active
    bool IsActive();
    
    // Get/Set configuration
    DESTConfig& GetConfig();
    void SetConfig(const DESTConfig& config);
    
    // Called when a spell tome is read (from our Papyrus hook)
    // Returns true if we handled it (tome kept), false otherwise
    // All logic handled here: prereq check, XP grant, auto-target, notification
    bool OnSpellTomeRead(RE::TESObjectBOOK* book, RE::SpellItem* spell, RE::TESObjectREFR* container);
    
    // Papyrus native function registrations
    bool RegisterPapyrusFunctions(RE::BSScript::IVirtualMachine* vm);
}

// Keep old namespace as alias for backwards compatibility during transition
namespace ISLIntegration = DESTIntegration;
