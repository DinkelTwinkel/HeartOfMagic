#pragma once

#include "PCH.h"

// =============================================================================
// PapyrusAPI - Exposes functions for other mods to interact with SpellLearning
// =============================================================================
//
// Script name: SpellLearning
//
// === MENU FUNCTIONS ===
//   - OpenMenu()           : Opens the SpellLearning UI panel
//   - CloseMenu()          : Closes the SpellLearning UI panel
//   - ToggleMenu()         : Toggles the SpellLearning UI panel
//   - IsMenuOpen()         : Returns true if the UI panel is currently open
//   - GetVersion()         : Returns the mod version as a string
//
// === XP FUNCTIONS ===
//   - RegisterXPSource()   : Register a named XP source (creates UI controls)
//   - AddSourcedXP()       : Grant XP through the cap system with named source
//   - AddRawXP()           : Grant raw XP bypassing ALL caps and multipliers
//   - SetSpellXP()         : Set exact XP value (debug/cheat)
//
// === PROGRESS QUERIES ===
//   - GetSpellProgress()           : 0.0-100.0%
//   - GetSpellCurrentXP()          : Raw XP number
//   - GetSpellRequiredXP()         : XP needed to master
//   - IsSpellMastered()            : 100% + unlocked
//   - IsSpellUnlocked()            : Granted to player
//   - IsSpellAvailableToLearn()    : In tree, prereqs met
//   - ArePrerequisitesMet()        : Tree prereqs check
//
// === LEARNING TARGET CONTROL ===
//   - GetLearningTarget()          : Get target spell for a school
//   - GetAllLearningTargets()      : Get all current learning targets
//   - GetLearningMode()            : "perSchool" or "single"
//   - SetLearningTarget()          : Set learning target (auto-determines school)
//   - SetLearningTargetForSchool() : Set target for specific school
//   - ClearLearningTarget()        : Clear target for a school
//   - ClearAllLearningTargets()    : Clear all targets
//
// === SETTINGS QUERIES ===
//   - GetGlobalXPMultiplier()      : Current global multiplier
//   - GetXPForTier()               : XP required for a tier
//   - GetSourceCap()               : Cap for any source (built-in or modded)
//
// =============================================================================
// MOD EVENTS - Other mods can listen for these events
// =============================================================================
//
//   "SpellLearning_MenuOpened"          - UI panel opened
//   "SpellLearning_MenuClosed"          - UI panel closed
//   "SpellLearning_XPGained"            - After any XP added (strArg=source, numArg=amount, sender=Spell)
//   "SpellLearning_SpellMastered"       - Spell reached 100% (strArg=school, sender=Spell)
//   "SpellLearning_SpellEarlyGranted"   - Early grant at threshold (strArg=school, numArg=progress%, sender=Spell)
//   "SpellLearning_TargetChanged"       - Target set/cleared (strArg=school, numArg=1.0/0.0, sender=Spell/None)
//   "SpellLearning_ProgressMilestone"   - Power step crossed (strArg=label, numArg=effectiveness%, sender=Spell)
//   "SpellLearning_SourceRegistered"    - New modded source (strArg=sourceId)

namespace PapyrusAPI
{
    // Register all native functions with SKSE
    bool RegisterFunctions(RE::BSScript::IVirtualMachine* vm);

    // === Menu Functions ===
    void OpenMenu(RE::StaticFunctionTag*);
    void CloseMenu(RE::StaticFunctionTag*);
    void ToggleMenu(RE::StaticFunctionTag*);
    bool IsMenuOpen(RE::StaticFunctionTag*);
    RE::BSFixedString GetVersion(RE::StaticFunctionTag*);

    // === XP Functions ===
    void RegisterXPSource(RE::StaticFunctionTag*, RE::BSFixedString sourceId, RE::BSFixedString displayName);
    float AddSourcedXP(RE::StaticFunctionTag*, RE::SpellItem* spell, float amount, RE::BSFixedString sourceName);
    float AddRawXP(RE::StaticFunctionTag*, RE::SpellItem* spell, float amount);
    void SetSpellXP(RE::StaticFunctionTag*, RE::SpellItem* spell, float xp);

    // === Progress Queries ===
    float GetSpellProgress(RE::StaticFunctionTag*, RE::SpellItem* spell);
    float GetSpellCurrentXP(RE::StaticFunctionTag*, RE::SpellItem* spell);
    float GetSpellRequiredXP(RE::StaticFunctionTag*, RE::SpellItem* spell);
    bool IsSpellMastered(RE::StaticFunctionTag*, RE::SpellItem* spell);
    bool IsSpellUnlocked(RE::StaticFunctionTag*, RE::SpellItem* spell);
    bool IsSpellAvailableToLearn(RE::StaticFunctionTag*, RE::SpellItem* spell);
    bool ArePrerequisitesMet(RE::StaticFunctionTag*, RE::SpellItem* spell);

    // === Learning Target Control ===
    RE::SpellItem* GetLearningTarget(RE::StaticFunctionTag*, RE::BSFixedString schoolName);
    std::vector<RE::SpellItem*> GetAllLearningTargets(RE::StaticFunctionTag*);
    RE::BSFixedString GetLearningMode(RE::StaticFunctionTag*);
    void SetLearningTarget(RE::StaticFunctionTag*, RE::SpellItem* spell);
    void SetLearningTargetForSchool(RE::StaticFunctionTag*, RE::BSFixedString schoolName, RE::SpellItem* spell);
    void ClearLearningTarget(RE::StaticFunctionTag*, RE::BSFixedString schoolName);
    void ClearAllLearningTargets(RE::StaticFunctionTag*);

    // === Settings Queries ===
    float GetGlobalXPMultiplier(RE::StaticFunctionTag*);
    float GetXPForTier(RE::StaticFunctionTag*, RE::BSFixedString tier);
    float GetSourceCap(RE::StaticFunctionTag*, RE::BSFixedString sourceName);

    // === ModEvent senders (called by UIManager) ===
    void SendMenuOpenedEvent();
    void SendMenuClosedEvent();
}
