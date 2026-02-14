#pragma once

#include "XPSource.h"
#include <atomic>
#include <thread>
#include <mutex>

namespace SpellLearning {

/**
 * PassiveLearningSource - XP from game time passing
 *
 * Grants XP to active learning targets as in-game time passes.
 * Uses RE::Calendar to track game hours and a background polling thread.
 * All XP grants are dispatched to the game thread via SKSE::GetTaskInterface().
 *
 * Settings (from unified config "passiveLearning"):
 *  - enabled: master toggle
 *  - scope: which spells gain passive XP ("all", "root", "novice")
 *  - xpPerGameHour: XP per in-game hour per spell
 *  - maxByTier: cap % per tier (novice/apprentice/adept/expert/master)
 */
class PassiveLearningSource : public BaseXPSource {
public:
    struct Settings {
        bool enabled = false;
        std::string scope = "novice";   // "all", "root", "novice"
        float xpPerGameHour = 5.0f;
        // Max % of required XP grantable from passive source per tier
        float maxNovice = 100.0f;
        float maxApprentice = 75.0f;
        float maxAdept = 50.0f;
        float maxExpert = 25.0f;
        float maxMaster = 5.0f;
    };

    PassiveLearningSource()
        : BaseXPSource(
            "passive",
            "Passive Learning",
            "Gain XP over time while spells are set as learning targets."
          )
    {}

    ~PassiveLearningSource() override { Shutdown(); }

    void Initialize() override;
    void Shutdown() override;

    int GetPriority() const override { return 50; }

    void SetSettings(const Settings& settings);
    const Settings& GetSettings() const { return m_settings; }

    // Called when game loads (reset time tracking)
    void OnGameLoad();

    static PassiveLearningSource* GetSingleton();

private:
    void PollLoop();
    void GrantPassiveXP(float gameHoursElapsed);
    float GetTierCap(float requiredXP) const;
    bool IsSpellEligible(RE::FormID spellId) const;

    Settings m_settings;
    std::mutex m_settingsMutex;

    // Polling thread
    std::atomic<bool> m_running{false};
    std::thread m_pollThread;

    // Game time tracking
    float m_lastGameTime = 0.0f;
    bool m_initialized = false;

    static PassiveLearningSource* s_singleton;
};

} // namespace SpellLearning
