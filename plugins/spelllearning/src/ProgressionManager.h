#pragma once

#include "Common.h"
#include <unordered_map>
#include <string>
#include <filesystem>

class ProgressionManager
{
public:
    struct SpellProgress {
        float progressPercent = 0.0f;  // 0.0 to 1.0 (percentage stored in co-save)
        float requiredXP = 100.0f;     // Loaded from tree data at runtime
        bool unlocked = false;

        // XP from each source (for cap tracking)
        float xpFromAny = 0.0f;        // XP gained from any-spell casts
        float xpFromSchool = 0.0f;     // XP gained from same-school casts
        float xpFromDirect = 0.0f;     // XP gained from direct prereq casts
        float xpFromSelf = 0.0f;       // XP gained from self-casting

        // XP from modded sources (for per-source cap tracking)
        std::unordered_map<std::string, float> xpFromModded;  // source name -> tracked XP

        // Computed property
        float GetCurrentXP() const { return progressPercent * requiredXP; }
        float GetTotalTrackedXP() const { return xpFromAny + xpFromSchool + xpFromDirect + xpFromSelf; }
    };

    static ProgressionManager* GetSingleton();

    // Learning targets (one per school)
    void SetLearningTarget(const std::string& school, RE::FormID formId, const std::vector<RE::FormID>& prereqs = {});
    RE::FormID GetLearningTarget(const std::string& school) const;
    void ClearLearningTarget(const std::string& school);
    void ClearLearningTargetForSpell(RE::FormID formId);  // Clear target when spell is mastered
    
    // Direct prerequisite checking (for XP bonuses)
    bool IsDirectPrerequisite(RE::FormID targetSpellId, RE::FormID castSpellId) const;
    void SetTargetPrerequisites(RE::FormID targetSpellId, const std::vector<RE::FormID>& prereqs);
    
    // Tree prerequisites - unified hard/soft system
    // Hard prereqs: ALL must be mastered
    // Soft prereqs: at least softNeeded must be mastered
    struct PrereqRequirements {
        std::vector<RE::FormID> hardPrereqs;   // Must have ALL of these
        std::vector<RE::FormID> softPrereqs;   // Must have X of these (where X = softNeeded)
        int softNeeded = 0;                     // How many soft prereqs required
    };
    
    void SetPrereqRequirements(RE::FormID spellId, const PrereqRequirements& reqs);
    void ClearAllTreePrerequisites();  // Called when tree reloads
    PrereqRequirements GetPrereqRequirements(RE::FormID spellId) const;
    bool AreTreePrerequisitesMet(RE::FormID spellId) const;
    std::vector<RE::FormID> GetUnmetHardPrerequisites(RE::FormID spellId) const;
    std::pair<int, int> GetSoftPrerequisiteStatus(RE::FormID spellId) const;  // (mastered, needed)
    bool IsSpellMastered(RE::FormID spellId) const;  // 100% progress or explicitly unlocked
    
    // Legacy compatibility
    void SetTreePrerequisites(RE::FormID spellId, const std::vector<RE::FormID>& prereqs);
    std::vector<RE::FormID> GetTreePrerequisites(RE::FormID spellId) const;

    // XP tracking
    void OnSpellCast(const std::string& school, RE::FormID castSpellId, float baseXP);
    void AddXP(RE::FormID targetSpellId, float amount);
    void AddXP(const std::string& formIdStr, float amount);  // String overload for DEST integration
    void AddXPNoGrant(const std::string& formIdStr, float amount);  // Record XP without early spell grant (ISL compat)
    SpellProgress GetProgress(RE::FormID formId) const;
    void SetRequiredXP(RE::FormID formId, float required);
    
    // Get required XP for a spell (from progress data or tier default)
    float GetRequiredXP(const std::string& formIdStr) const;
    float GetRequiredXP(RE::FormID formId) const;
    
    // Set learning target from tome reading (auto-determines school)
    void SetLearningTargetFromTome(const std::string& formIdStr, RE::SpellItem* spell);

    // Spell unlocking
    bool CanUnlock(RE::FormID formId) const;
    bool UnlockSpell(RE::FormID formId);
    bool IsUnlocked(RE::FormID formId) const;
    
    // Check if a spell is available to learn (has progress entry, not yet unlocked)
    bool IsSpellAvailableToLearn(const std::string& formIdStr) const;
    bool IsSpellAvailableToLearn(RE::FormID formId) const;

    // =========================================================================
    // SKSE CO-SAVE SERIALIZATION
    // =========================================================================
    static constexpr uint32_t kSerializationVersion = 2;
    static constexpr uint32_t kProgressRecord = 'SLPR';  // Spell Learning Progress Record
    static constexpr uint32_t kTargetsRecord = 'SLTR';   // Spell Learning Targets Record
    
    // Called by SKSE serialization callbacks
    void OnGameSaved(SKSE::SerializationInterface* a_intfc);
    void OnGameLoaded(SKSE::SerializationInterface* a_intfc);
    void OnRevert(SKSE::SerializationInterface* a_intfc);

    // Legacy save/load (for external JSON files - kept for backwards compat)
    void LoadProgress(const std::string& saveName);
    void SaveProgress();
    void SetCurrentSave(const std::string& saveName);
    std::string GetCurrentSave() const { return m_currentSaveName; }

    // Get all progress data for UI
    std::string GetProgressJSON() const;
    
    // Clear all progress (called on new game/revert)
    void ClearAllProgress();
    
    // Modded XP source configuration (per-source balancing)
    struct ModdedSourceConfig {
        std::string displayName;    // e.g. "Combat Training"
        bool enabled = true;
        float multiplier = 100.0f;  // 0-200%
        float cap = 25.0f;          // 0-100% of required XP
        bool internal = false;      // Internal sources use cap tracking but don't show in modded UI
    };

    // XP Settings (loaded from unified config)
    struct XPSettings {
        std::string learningMode = "perSchool";  // "perSchool" or "single"
        float globalMultiplier = 1.0f;   // Direct multiplier (1.0 = normal, 2.0 = double XP)
        float multiplierDirect = 1.0f;   // 0.0-1.0 for direct prerequisite spells
        float multiplierSchool = 0.5f;   // 0.0-1.0 for same school spells
        float multiplierAny = 0.1f;      // 0.0-1.0 for any spell
        // XP caps (max % contribution from each source, 0-100)
        float capAny = 5.0f;             // Max 5% from any spell casts
        float capSchool = 15.0f;         // Max 15% from same-school casts
        float capDirect = 50.0f;         // Max 50% from direct prereq casts
        // Tier XP requirements
        float xpNovice = 100.0f;
        float xpApprentice = 200.0f;
        float xpAdept = 400.0f;
        float xpExpert = 800.0f;
        float xpMaster = 1500.0f;
        // Modded XP sources (registered by external mods)
        std::unordered_map<std::string, ModdedSourceConfig> moddedSources;
    };
    
    void SetXPSettings(const XPSettings& settings);
    const XPSettings& GetXPSettings() const { return m_xpSettings; }
    XPSettings& GetXPSettingsMutable() { return m_xpSettings; }
    float GetXPForTier(const std::string& tier) const;

    // Direct XP manipulation (cheat mode)
    void SetSpellXP(RE::FormID formId, float xp);

    // =========================================================================
    // PUBLIC MODDER API
    // =========================================================================

    // Grant XP through the cap system with named source.
    // Built-in sources: "any", "school", "direct", "self"
    // Custom sources: any string (auto-registers if unknown)
    // Returns actual XP granted after caps/multipliers.
    float AddSourcedXP(RE::FormID targetId, float amount, const std::string& sourceName = "direct");

    // Grant raw XP bypassing ALL caps and multipliers.
    float AddRawXP(RE::FormID targetId, float amount);

    // Register a named modded XP source (creates UI controls).
    // Returns true if newly registered, false if already existed.
    // Internal sources use cap tracking but don't appear in the modded XP sources UI.
    bool RegisterModdedXPSource(const std::string& sourceId, const std::string& displayName, bool internal = false);

    // Get the cap value for a source (works for built-in and modded)
    float GetSourceCap(const std::string& sourceName) const;

    // Send a ModEvent to Papyrus listeners
    static void SendModEvent(const char* eventName, const std::string& strArg, float numArg, RE::TESForm* sender = nullptr);

private:
    ProgressionManager() = default;
    ~ProgressionManager() = default;
    ProgressionManager(const ProgressionManager&) = delete;
    ProgressionManager& operator=(const ProgressionManager&) = delete;

    std::filesystem::path GetProgressFilePath() const;

    // Learning targets: school name -> spell formId
    std::unordered_map<std::string, RE::FormID> m_learningTargets;
    
    // Direct prerequisites: target spell formId -> list of prereq formIds (for XP bonuses)
    std::unordered_map<RE::FormID, std::vector<RE::FormID>> m_targetPrerequisites;
    
    // Tree prerequisites: spell formId -> hard/soft prereq requirements
    std::unordered_map<RE::FormID, PrereqRequirements> m_prereqRequirements;

    // Progress data: spell formId -> progress
    std::unordered_map<RE::FormID, SpellProgress> m_spellProgress;

    // Current save name for file naming
    std::string m_currentSaveName = "default";

    // Dirty flag for save optimization
    bool m_dirty = false;
    
    // XP Settings
    XPSettings m_xpSettings;
};
