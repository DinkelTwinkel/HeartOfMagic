#pragma once

#include "PCH.h"

// =============================================================================
// PapyrusAPI - Exposes functions for other mods to interact with SpellLearning
// =============================================================================
// 
// Script name: SpellLearning
// 
// Available functions:
//   - OpenMenu()      : Opens the SpellLearning UI panel
//   - CloseMenu()     : Closes the SpellLearning UI panel
//   - ToggleMenu()    : Toggles the SpellLearning UI panel
//   - IsMenuOpen()    : Returns true if the UI panel is currently open
//   - GetVersion()    : Returns the mod version as a string
//
// Example Papyrus usage:
//   SpellLearning.OpenMenu()
//   if SpellLearning.IsMenuOpen()
//       SpellLearning.CloseMenu()
//   endif
//
// =============================================================================
// MOD EVENTS - Other mods can listen for these events
// =============================================================================
// 
// Event: "SpellLearning_MenuOpened"
//   - Fired when the SpellLearning UI panel is opened
//   - No parameters
//
// Event: "SpellLearning_MenuClosed"  
//   - Fired when the SpellLearning UI panel is closed
//   - No parameters
//
// Example Papyrus listener:
//   Event OnInit()
//       RegisterForModEvent("SpellLearning_MenuOpened", "OnSpellLearningMenuOpened")
//       RegisterForModEvent("SpellLearning_MenuClosed", "OnSpellLearningMenuClosed")
//   EndEvent
//
//   Event OnSpellLearningMenuOpened()
//       Debug.Notification("SpellLearning menu opened!")
//   EndEvent
//
//   Event OnSpellLearningMenuClosed()
//       Debug.Notification("SpellLearning menu closed!")
//   EndEvent

namespace PapyrusAPI
{
    // Register all native functions with SKSE
    bool RegisterFunctions(RE::BSScript::IVirtualMachine* vm);
    
    // Native function implementations
    void OpenMenu(RE::StaticFunctionTag*);
    void CloseMenu(RE::StaticFunctionTag*);
    void ToggleMenu(RE::StaticFunctionTag*);
    bool IsMenuOpen(RE::StaticFunctionTag*);
    RE::BSFixedString GetVersion(RE::StaticFunctionTag*);
    
    // ModEvent senders - called by UIManager when UI state changes
    void SendMenuOpenedEvent();
    void SendMenuClosedEvent();
}
