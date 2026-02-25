#pragma once

#include "Common.h"
#include <atomic>
#include <unordered_set>
#include <unordered_map>
#include <shared_mutex>

// =============================================================================
// SpellEffectivenessHook
// =============================================================================
// Hooks ActiveEffect::AdjustForPerks on ALL ActiveEffect subclass vtables to
// scale spell magnitude based on learning progress. Every real spell effect
// dispatches through its own subclass vtable (ValueModifierEffect, CloakEffect,
// SummonCreatureEffect, etc.) — hooking only the base ActiveEffect vtable would
// miss all actual spell casts. Duration is NOT scaled (only magnitude).
//
// Spells that are "early learned" (unlocked before 100% mastery) have reduced
// effectiveness in 5 discrete steps. Name/description are updated only when
// crossing step thresholds to avoid constant updates.
// =============================================================================

class SpellEffectivenessHook
{
public:
    // Power steps for graduated effectiveness (configurable)
    // Each step corresponds to a progress threshold and power level
    struct PowerStep {
        float progressThreshold;  // XP progress % to reach this step
        float effectiveness;      // Power multiplier at this step (0-1)
        std::string label;        // Display label
    };
    
    // Cached spell display info (name + description)
    struct SpellDisplayCache {
        std::string originalName;
        std::string modifiedName;        // "Spell Name (Learning - 35%)"
        std::string modifiedDescription; // Scaled effect values
        int currentStep = 0;             // Which step we're at (0-5)
        float cachedEffectiveness = 0.0f;
    };

    // Settings for early spell learning feature
    struct EarlyLearningSettings {
        bool enabled = true;
        float unlockThreshold = 25.0f;      // % progress to unlock spell (matches step 1)
        float minEffectiveness = 20.0f;     // % effectiveness at unlock (step 1)
        float maxEffectiveness = 70.0f;     // % effectiveness just before mastery
        float selfCastRequiredAt = 75.0f;   // After this %, must cast spell itself
        float selfCastXPMultiplier = 1.5f;  // XP multiplier for casting learning target
        float binaryEffectThreshold = 80.0f; // Binary effects need this % to work
        bool modifyGameDisplay = true;      // If true, modifies spell name/desc in game menus
                                            // If false, only shows in our UI panel
    };

    static SpellEffectivenessHook* GetSingleton();

    // Install the REL hook - call during plugin load
    static void Install();
    
    // Install spell name/description display hooks
    static void InstallDisplayHooks();

    // Settings management
    void SetSettings(const EarlyLearningSettings& settings);
    EarlyLearningSettings GetSettings() const;

    // Power steps management (configurable)
    void SetPowerSteps(const std::vector<PowerStep>& steps);
    std::vector<PowerStep> GetPowerSteps() const;
    int GetNumPowerSteps() const;
    
    // Early-learned spell tracking
    void AddEarlyLearnedSpell(RE::FormID formId);
    void RemoveEarlyLearnedSpell(RE::FormID formId);  // Called at 100% mastery
    bool IsEarlyLearnedSpell(RE::FormID formId) const;
    std::unordered_set<RE::FormID> GetEarlyLearnedSpells() const;
    
    // Power step calculations
    int GetCurrentPowerStep(RE::FormID spellFormId) const;
    float GetSteppedEffectiveness(RE::FormID spellFormId) const;
    std::string GetPowerStepLabel(int step) const;
    
    // Check if spell needs nerfing (early learned AND not mastered)
    bool NeedsNerfing(RE::FormID spellFormId) const;
    
    // Calculate effectiveness multiplier (stepped, not continuous)
    float CalculateEffectiveness(RE::FormID spellFormId) const;
    
    // Grant spell to player when unlock threshold reached
    static void GrantEarlySpell(RE::SpellItem* spell);
    
    // Register spell for ISL compatibility (early-learned tracking + display, but NO AddSpell)
    // Called when ISL is about to handle study — so when ISL eventually teaches the spell,
    // our effectiveness hook will apply weakness scaling.
    void RegisterISLPendingSpell(RE::SpellItem* spell);
    
    // Remove early spell from player (when switching learning target)
    static void RemoveEarlySpellFromPlayer(RE::FormID spellFormId);
    
    // Re-grant spell if player has enough XP (when returning to learn)
    void CheckAndRegrantSpell(RE::FormID spellFormId);
    
    // Mark spell as mastered - removes nerf
    void MarkMastered(RE::FormID spellFormId);
    
    // Apply effectiveness scaling to an active effect (called from hook)
    void ApplyEffectivenessScaling(RE::ActiveEffect* a_effect);
    
    // Fast path for effectiveness scaling (player check already done)
    void ApplyEffectivenessScalingFast(RE::ActiveEffect* a_effect);
    
    // Get/update modified name for early-learned spell
    std::string GetModifiedSpellName(RE::SpellItem* spell);
    
    // Get modified description showing scaled values
    std::string GetScaledSpellDescription(RE::SpellItem* spell);
    
    // Format a magnitude value with effectiveness scaling
    float GetScaledMagnitude(RE::SpellItem* spell, float originalMagnitude) const;
    
    // Update display cache for a spell (called when step changes)
    void UpdateSpellDisplayCache(RE::FormID spellFormId, RE::SpellItem* spell = nullptr);
    
    // Check if power step changed and update if needed
    bool CheckAndUpdatePowerStep(RE::FormID spellFormId);
    
    // Called after game load to refresh all early-learned spell displays
    void RefreshAllSpellDisplays();
    
    // Directly modify spell's internal name (works with SkyUI and any UI)
    void ApplyModifiedSpellName(RE::FormID spellFormId);
    void RestoreOriginalSpellName(RE::FormID spellFormId);
    void RefreshAllSpellNames();  // Update all tracked spell names
    
    // Directly modify effect descriptions to show scaled values
    void ApplyModifiedDescriptions(RE::FormID spellFormId);
    void RestoreOriginalDescriptions(RE::FormID spellFormId);
    void RefreshAllDescriptions();  // Update all tracked spell descriptions
    
    // Serialization for SKSE co-save
    static constexpr uint32_t kEarlyLearnedRecord = 'SLEL';  // Spell Learning Early Learned
    static constexpr uint32_t kDisplayCacheRecord = 'SLDC';  // Spell Learning Display Cache
    void OnGameSaved(SKSE::SerializationInterface* a_intfc);
    void OnGameLoaded(SKSE::SerializationInterface* a_intfc);
    void OnRevert(SKSE::SerializationInterface* a_intfc);

private:
    SpellEffectivenessHook() = default;
    ~SpellEffectivenessHook() = default;
    SpellEffectivenessHook(const SpellEffectivenessHook&) = delete;
    SpellEffectivenessHook& operator=(const SpellEffectivenessHook&) = delete;

    // Settings
    EarlyLearningSettings m_settings;
    
    // Configurable power steps (initialized with defaults)
    std::vector<PowerStep> m_powerSteps = {
        { 25.0f, 0.20f, "Budding" },
        { 40.0f, 0.35f, "Developing" },
        { 55.0f, 0.50f, "Practicing" },
        { 70.0f, 0.65f, "Advancing" },
        { 85.0f, 0.80f, "Refining" },
        { 100.0f, 1.00f, "Mastered" }  // Final step always present
    };
    
    // =========================================================================
    // GUARDED STATE — all fields below are protected by m_mutex.
    // Use shared_lock for read-only access, unique_lock for mutations.
    // Game object fields (RE::SpellItem::fullName, RE::EffectSetting::magicItemDescription)
    // are NOT protected by m_mutex — they rely on the game-thread-only invariant.
    // =========================================================================

    // Set of spells that are early-learned (granted but not mastered)
    std::unordered_set<RE::FormID> m_earlyLearnedSpells;  // guarded by m_mutex

    // Display cache for modified names/descriptions
    std::unordered_map<RE::FormID, SpellDisplayCache> m_displayCache;  // guarded by m_mutex

    // Original spell names (before modification)
    std::unordered_map<RE::FormID, std::string> m_originalSpellNames;  // guarded by m_mutex

    // Original effect descriptions (keyed by EffectSetting FormID)
    // We track which spells use which effects to know when to restore
    std::unordered_map<RE::FormID, std::string> m_originalEffectDescriptions;  // guarded by m_mutex

    // Track which spells have contributed to each effect's usage count
    // Key: effectId, Value: set of spellIds that are currently using this effect
    // This prevents double-counting when ApplyModifiedDescriptions is called multiple times
    std::unordered_map<RE::FormID, std::unordered_set<RE::FormID>> m_effectSpellTracking;  // guarded by m_mutex

    // Atomic mirror of m_earlyLearnedSpells.size() for lock-free fast-path check.
    // INVARIANT: count == 0 implies set is empty. Maintained by AddToEarlySet/RemoveFromEarlySet.
    // All mutations to m_earlyLearnedSpells MUST go through these helpers to keep count in sync.
    //
    // AddToEarlySet: inserts into m_earlyLearnedSpells, then calls fetch_add(1) only if
    //   insert actually added a new element (checks insert's .second return value).
    // RemoveFromEarlySet: erases from m_earlyLearnedSpells first, then calls fetch_sub(1)
    //   only if erase actually removed an element (checks erase's return value > 0).
    //   This ordering (erase-then-decrement) and the conditional decrement prevent
    //   unsigned wraparound and maintain the count == 0 ↔ set-empty invariant.
    std::atomic<size_t> m_earlySpellCount{0};

    // Atomic mirror of m_settings.enabled for lock-free fast-path check.
    // Maintained by SetSettings. Mirrors the pattern of m_earlySpellCount.
    std::atomic<bool> m_settingsEnabled{true};

    // Reader-writer mutex for thread safety (shared_mutex allows concurrent reads).
    // Protects all internal data structures above. Does NOT protect RE game object
    // fields — those are only accessed from the game thread (see display file comments).
    mutable std::shared_mutex m_mutex;

    // Centralized mutation helpers for m_earlyLearnedSpells / m_earlySpellCount.
    // Caller MUST hold unique_lock on m_mutex.
    // Only modifies m_earlySpellCount when m_earlyLearnedSpells actually changes
    // (conditional fetch_add/fetch_sub based on insert/erase return values).
    void AddToEarlySet(RE::FormID formId);
    void RemoveFromEarlySet(RE::FormID formId);
};
