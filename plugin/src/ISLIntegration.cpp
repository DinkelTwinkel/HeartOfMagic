#include "ISLIntegration.h"
#include "ProgressionManager.h"
#include "UIManager.h"
#include "SpellEffectivenessHook.h"

namespace DESTIntegration {
    
    namespace {
        // Don't Eat Spell Tomes possible plugin names
        constexpr const char* DEST_PLUGIN_NAMES[] = {
            "DontEatSpellTomes.esp",        // Most common name
            "DontEatSpellTomes.esl",
            "Don't Eat Spell Tomes.esp",    // With spaces
            "Don't Eat Spell Tomes.esl",
            "DEST_ISL.esp",                 // ISL-DESTified variant
            "DEST_ISL.esl",
            "ISL-DESTified.esp",            // Alternative naming
            "ISL-DESTified.esl"
        };
        constexpr size_t DEST_PLUGIN_COUNT = sizeof(DEST_PLUGIN_NAMES) / sizeof(DEST_PLUGIN_NAMES[0]);
        
        const char* g_detectedPluginName = nullptr;
        bool g_destInstalled = false;
        bool g_active = false;
        DESTConfig g_config;
    }
    
    bool IsDESTInstalled() {
        return g_destInstalled;
    }
    
    const char* GetDESTPluginName() {
        return g_detectedPluginName ? g_detectedPluginName : "DontEatSpellTomes.esp";
    }
    
    void Initialize() {
        logger::info("DESTIntegration: Checking for Don't Eat Spell Tomes mod...");
        
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        if (!dataHandler) {
            logger::error("DESTIntegration: Failed to get TESDataHandler");
            return;
        }
        
        // Check all possible plugin names
        g_destInstalled = false;
        g_detectedPluginName = nullptr;
        
        for (size_t i = 0; i < DEST_PLUGIN_COUNT; ++i) {
            if (dataHandler->LookupModByName(DEST_PLUGIN_NAMES[i]) != nullptr) {
                g_destInstalled = true;
                g_detectedPluginName = DEST_PLUGIN_NAMES[i];
                logger::info("DESTIntegration: Found plugin: {}", g_detectedPluginName);
                break;
            }
        }
        
        if (g_destInstalled) {
            logger::info("DESTIntegration: Don't Eat Spell Tomes detected!");
            
            if (g_config.enabled) {
                g_active = true;
                logger::info("DESTIntegration: Integration enabled");
            } else {
                logger::info("DESTIntegration: Integration disabled in settings");
            }
        } else {
            logger::info("DESTIntegration: Don't Eat Spell Tomes not found, integration inactive");
        }
    }
    
    void Shutdown() {
        g_active = false;
        logger::info("DESTIntegration: Shutdown");
    }
    
    bool IsActive() {
        return g_active && g_destInstalled && g_config.enabled;
    }
    
    DESTConfig& GetConfig() {
        return g_config;
    }
    
    void SetConfig(const DESTConfig& config) {
        g_config = config;
        
        if (g_destInstalled) {
            g_active = g_config.enabled;
            logger::info("DESTIntegration: Config updated - enabled: {}", g_config.enabled);
        }
    }
    
    bool OnSpellTomeRead(RE::TESObjectBOOK* book, RE::SpellItem* spell, RE::TESObjectREFR* /*container*/) {
        if (!IsActive()) {
            return false;  // Not active, let default behavior happen
        }
        
        if (!book || !spell) {
            logger::warn("DESTIntegration: OnSpellTomeRead called with null book or spell");
            return false;
        }
        
        logger::info("DESTIntegration: Spell tome read - {} ({})", 
                    book->GetName(), spell->GetName());
        
        // Get the spell's form ID as hex string for our system
        char formIdStr[16];
        snprintf(formIdStr, sizeof(formIdStr), "0x%08X", spell->GetFormID());
        
        auto* pm = ProgressionManager::GetSingleton();
        
        // =========================================================================
        // CHECK PREREQUISITES
        // =========================================================================
        if (!pm->IsSpellAvailableToLearn(formIdStr)) {
            RE::SendHUDMessage::ShowHUDMessage("You lack the knowledge to grasp this magic.");
            logger::info("DESTIntegration: Spell {} not available to learn (prerequisites not met)", formIdStr);
            return true;  // Handled - keep tome
        }
        
        // Check if player already knows this spell
        auto* player = RE::PlayerCharacter::GetSingleton();
        if (player && player->HasSpell(spell)) {
            RE::SendHUDMessage::ShowHUDMessage("You have already learned this spell.");
            logger::info("DESTIntegration: Player already knows spell {}", formIdStr);
            return true;  // Handled - keep tome
        }
        
        // =========================================================================
        // CALCULATE AND GRANT XP TO REACH EARLY ACCESS THRESHOLD
        // =========================================================================
        auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
        const auto& earlySettings = effectivenessHook->GetSettings();
        
        // Get required XP for this spell
        float requiredXP = pm->GetRequiredXP(formIdStr);
        if (requiredXP <= 0) {
            // Spell not in tree or no XP requirement set - use default
            requiredXP = pm->GetXPForTier("novice");
            logger::warn("DESTIntegration: No required XP found for {}, using default {}", formIdStr, requiredXP);
        }
        
        // Calculate XP to reach early access threshold
        float threshold = earlySettings.unlockThreshold / 100.0f;
        float xpToGrant = requiredXP * threshold;
        
        logger::info("DESTIntegration: Granting {:.0f} XP to {} ({}% of {:.0f} required)", 
            xpToGrant, formIdStr, threshold * 100, requiredXP);
        
        // Grant XP - this will trigger early spell granting at threshold
        pm->AddXP(formIdStr, xpToGrant);
        
        // =========================================================================
        // AUTO-SET AS LEARNING TARGET
        // =========================================================================
        pm->SetLearningTargetFromTome(formIdStr, spell);
        
        // =========================================================================
        // NOTIFY PLAYER
        // =========================================================================
        char notification[256];
        snprintf(notification, sizeof(notification), 
                 "You begin to grasp %s...", spell->GetName());
        RE::SendHUDMessage::ShowHUDMessage(notification);
        
        // Update UI
        UIManager::GetSingleton()->NotifyProgressUpdate(formIdStr);
        
        logger::info("DESTIntegration: Successfully processed tome for {} - player now has early access", 
            spell->GetName());
        
        return true;  // Handled - keep tome
    }
    
    // =========================================================================
    // Papyrus Native Functions
    // =========================================================================
    
    namespace Papyrus {
        
        // Called from our Papyrus script when DEST fires OnSpellTomeRead
        bool OnTomeRead(RE::StaticFunctionTag*, RE::TESObjectBOOK* book, RE::SpellItem* spell, RE::TESObjectREFR* container) {
            return OnSpellTomeRead(book, spell, container);
        }
        
        // Check if DEST integration is active
        bool IsIntegrationActive(RE::StaticFunctionTag*) {
            return IsActive();
        }
    }
    
    bool RegisterPapyrusFunctions(RE::BSScript::IVirtualMachine* vm) {
        if (!vm) {
            logger::error("DESTIntegration: Failed to register Papyrus functions - VM is null");
            return false;
        }
        
        // Register under new script name SpellLearning_DEST
        vm->RegisterFunction("OnTomeRead", "SpellLearning_DEST", Papyrus::OnTomeRead);
        vm->RegisterFunction("IsIntegrationActive", "SpellLearning_DEST", Papyrus::IsIntegrationActive);
        
        // Also register under old name for backwards compatibility during transition
        vm->RegisterFunction("OnTomeRead", "SpellLearning_ISL", Papyrus::OnTomeRead);
        vm->RegisterFunction("IsIntegrationActive", "SpellLearning_ISL", Papyrus::IsIntegrationActive);
        
        logger::info("DESTIntegration: Registered Papyrus functions");
        return true;
    }
}
