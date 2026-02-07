#include "PapyrusAPI.h"
#include "UIManager.h"
#include "SKSE/SKSE.h"

namespace PapyrusAPI
{
    constexpr const char* SCRIPT_NAME = "SpellLearning";
    constexpr const char* MOD_VERSION = "1.0.0";
    
    // ModEvent names
    constexpr const char* EVENT_MENU_OPENED = "SpellLearning_MenuOpened";
    constexpr const char* EVENT_MENU_CLOSED = "SpellLearning_MenuClosed";
    
    void OpenMenu(RE::StaticFunctionTag*)
    {
        logger::info("PapyrusAPI: OpenMenu called");
        
        auto* uiManager = UIManager::GetSingleton();
        if (uiManager && uiManager->IsInitialized()) {
            uiManager->ShowPanel();
        } else {
            logger::warn("PapyrusAPI: UIManager not initialized, cannot open menu");
        }
    }
    
    void CloseMenu(RE::StaticFunctionTag*)
    {
        logger::info("PapyrusAPI: CloseMenu called");
        
        auto* uiManager = UIManager::GetSingleton();
        if (uiManager && uiManager->IsInitialized()) {
            uiManager->HidePanel();
        }
    }
    
    void ToggleMenu(RE::StaticFunctionTag*)
    {
        logger::info("PapyrusAPI: ToggleMenu called");
        
        auto* uiManager = UIManager::GetSingleton();
        if (uiManager && uiManager->IsInitialized()) {
            uiManager->TogglePanel();
        } else {
            logger::warn("PapyrusAPI: UIManager not initialized, cannot toggle menu");
        }
    }
    
    bool IsMenuOpen(RE::StaticFunctionTag*)
    {
        auto* uiManager = UIManager::GetSingleton();
        if (uiManager) {
            return uiManager->IsPanelVisible();
        }
        return false;
    }
    
    RE::BSFixedString GetVersion(RE::StaticFunctionTag*)
    {
        return RE::BSFixedString(MOD_VERSION);
    }
    
    void SendMenuOpenedEvent()
    {
        logger::info("PapyrusAPI: Sending {} ModEvent", EVENT_MENU_OPENED);
        SKSE::ModCallbackEvent modEvent(EVENT_MENU_OPENED, "", 0.0f, nullptr);
        SKSE::GetModCallbackEventSource()->SendEvent(&modEvent);
    }
    
    void SendMenuClosedEvent()
    {
        logger::info("PapyrusAPI: Sending {} ModEvent", EVENT_MENU_CLOSED);
        SKSE::ModCallbackEvent modEvent(EVENT_MENU_CLOSED, "", 0.0f, nullptr);
        SKSE::GetModCallbackEventSource()->SendEvent(&modEvent);
    }
    
    bool RegisterFunctions(RE::BSScript::IVirtualMachine* vm)
    {
        if (!vm) {
            logger::error("PapyrusAPI: Failed to register functions - VM is null");
            return false;
        }
        
        // Register functions under script name "SpellLearning"
        // Usage: SpellLearning.OpenMenu()
        
        vm->RegisterFunction("OpenMenu", SCRIPT_NAME, OpenMenu);
        vm->RegisterFunction("CloseMenu", SCRIPT_NAME, CloseMenu);
        vm->RegisterFunction("ToggleMenu", SCRIPT_NAME, ToggleMenu);
        vm->RegisterFunction("IsMenuOpen", SCRIPT_NAME, IsMenuOpen);
        vm->RegisterFunction("GetVersion", SCRIPT_NAME, GetVersion);
        
        logger::info("PapyrusAPI: Registered {} functions under script '{}'", 5, SCRIPT_NAME);
        
        return true;
    }
}
