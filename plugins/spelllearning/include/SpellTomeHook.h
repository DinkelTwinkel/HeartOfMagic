#pragma once

#include "Common.h"
#include <mutex>
#include <unordered_set>

// =============================================================================
// SpellTomeHook
// =============================================================================
// Hooks TESObjectBOOK::ProcessBook to intercept spell tome reading.
// When a spell tome is read:
//   - If spell is in our learning system: grant XP, set as target, DON'T teach, keep book
//   - If spell is NOT in our system: let vanilla proceed (teach + consume)
//
// Based on "Don't Eat Spell Tomes" by Exit-9B (MIT License)
// =============================================================================

class SpellTomeHook
{
public:
    static SpellTomeHook* GetSingleton();

    // Install the hook - call during kPostLoad
    static bool Install();

    // Settings
    struct Settings {
        bool enabled = true;                    // Enable tome interception
        bool useProgressionSystem = true;       // true = our XP/weakened spell system, false = vanilla instant learn
        bool grantXPOnRead = true;              // Grant XP when reading tome
        bool autoSetLearningTarget = true;      // Auto-set spell as learning target
        bool showNotifications = true;          // Show in-game notifications
        float xpPercentToGrant = 25.0f;         // % of required XP to grant (matches early access threshold)
        
        // Tome inventory XP boost - bonus XP while tome is in inventory
        bool tomeInventoryBoost = true;         // Enable inventory boost feature
        float tomeInventoryBoostPercent = 25.0f;// % bonus XP when tome is in inventory
        
        // Learning requirements
        bool requirePrereqs = true;             // Require tree prerequisites to be mastered
        bool requireAllPrereqs = true;          // Require ALL prereqs (vs just one)
        bool requireSkillLevel = false;         // Require minimum skill level for spell tier
    };

    void SetSettings(const Settings& settings) { m_settings = settings; }
    const Settings& GetSettings() const { return m_settings; }

    // Check if hook is installed and active
    bool IsInstalled() const { return m_installed; }
    bool IsActive() const { return m_installed && m_settings.enabled; }
    
    // Check if player has a spell tome for a specific spell in their inventory
    // Used for the tome inventory XP boost feature
    static bool PlayerHasSpellTome(RE::FormID spellFormId);
    
    // Get XP multiplier for spell (includes tome inventory boost if applicable)
    float GetXPMultiplier(RE::FormID spellFormId) const;
    
    // Check if XP has already been granted for this spell from a tome
    bool HasGrantedTomeXP(RE::FormID spellFormId) const;
    
    // Mark that XP has been granted for this spell from a tome
    void MarkTomeXPGranted(RE::FormID spellFormId);
    
    // Clear tome XP tracking (for new game/reload)
    void ClearTomeXPTracking();

private:
    SpellTomeHook() = default;
    ~SpellTomeHook() = default;
    SpellTomeHook(const SpellTomeHook&) = delete;
    SpellTomeHook& operator=(const SpellTomeHook&) = delete;

    // Called when player reads a spell tome
    // Returns true if we handled it (don't teach, don't consume)
    // Returns false to let vanilla proceed
    static void OnSpellTomeRead(RE::TESObjectBOOK* a_book, RE::SpellItem* a_spell);

    // Check prereqs + skill level — returns true if player can learn, false if blocked
    // Shows notification if blocked. Used by both ISL and non-ISL paths.
    static bool CheckLearningRequirements(RE::SpellItem* a_spell, RE::FormID spellFormId);

    // Get the container the book is in (if reading from container)
    static RE::TESObjectREFR* GetBookContainer();

    // Internal state
    Settings m_settings;
    bool m_installed = false;
    
    // Track which spells have already received XP from tome reading
    // Prevents exploit of reading same tome multiple times
    std::unordered_set<RE::FormID> m_tomeXPGranted;
    mutable std::mutex m_mutex;
};
