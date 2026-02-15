#include "PassiveLearningSource.h"
#include "ProgressionManager.h"
#include "UIManager.h"

namespace SpellLearning {

PassiveLearningSource* PassiveLearningSource::s_singleton = nullptr;

PassiveLearningSource* PassiveLearningSource::GetSingleton() {
    return s_singleton;
}

void PassiveLearningSource::Initialize() {
    s_singleton = this;

    // Register as an internal XP source for per-spell cap tracking (not shown in modded UI)
    ProgressionManager::GetSingleton()->RegisterModdedXPSource("passive", "Passive Learning", true);

    auto* calendar = RE::Calendar::GetSingleton();
    if (calendar) {
        m_lastGameTime = calendar->GetCurrentGameTime();
        m_initialized = true;
    }

    // Start polling thread
    m_running = true;
    m_pollThread = std::thread(&PassiveLearningSource::PollLoop, this);

    logger::info("PassiveLearningSource: Initialized (enabled: {}, scope: {}, xp/hr: {})",
        m_settings.enabled, m_settings.scope, m_settings.xpPerGameHour);
}

void PassiveLearningSource::Shutdown() {
    m_running = false;
    if (m_pollThread.joinable()) {
        m_pollThread.join();
    }
    logger::info("PassiveLearningSource: Shutdown");
}

void PassiveLearningSource::SetSettings(const Settings& settings) {
    std::lock_guard<std::mutex> lock(m_settingsMutex);
    m_settings = settings;
    m_enabled = settings.enabled;
    logger::info("PassiveLearningSource: Settings updated - enabled: {}, scope: {}, xp/hr: {}",
        settings.enabled, settings.scope, settings.xpPerGameHour);
}

void PassiveLearningSource::OnGameLoad() {
    auto* calendar = RE::Calendar::GetSingleton();
    if (calendar) {
        m_lastGameTime = calendar->GetCurrentGameTime();
        m_initialized = true;
        logger::info("PassiveLearningSource: Game loaded, game time: {:.2f}", m_lastGameTime);
    }
}

void PassiveLearningSource::PollLoop() {
    while (m_running) {
        // Sleep 3 real-time seconds between checks
        std::this_thread::sleep_for(std::chrono::seconds(3));

        if (!m_running) break;

        // Quick check without lock
        if (!m_initialized) continue;

        Settings currentSettings;
        {
            std::lock_guard<std::mutex> lock(m_settingsMutex);
            if (!m_settings.enabled) continue;
            currentSettings = m_settings;
        }

        // Must read Calendar on the game thread
        SKSE::GetTaskInterface()->AddTask([this, currentSettings]() {
            auto* calendar = RE::Calendar::GetSingleton();
            if (!calendar) return;

            float currentGameTime = calendar->GetCurrentGameTime();
            float elapsed = currentGameTime - m_lastGameTime;

            // Only grant if positive time elapsed (handles time travel, save loads)
            // and at least ~6 game minutes passed (0.1 hours) to avoid micro-grants
            if (elapsed > 0.1f) {
                m_lastGameTime = currentGameTime;
                GrantPassiveXP(elapsed);
            } else if (elapsed < 0.0f) {
                // Time went backwards (loaded earlier save) - just reset
                m_lastGameTime = currentGameTime;
            }
        });
    }
}

void PassiveLearningSource::GrantPassiveXP(float gameHoursElapsed) {
    Settings currentSettings;
    {
        std::lock_guard<std::mutex> lock(m_settingsMutex);
        currentSettings = m_settings;
    }

    if (!currentSettings.enabled || currentSettings.xpPerGameHour <= 0.0f) return;

    auto* pm = ProgressionManager::GetSingleton();
    if (!pm) return;

    float baseXP = currentSettings.xpPerGameHour * gameHoursElapsed;

    // Iterate all learning targets and grant passive XP
    // m_learningTargets is school -> formId, access via public API
    const std::string schools[] = {"Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"};

    int granted = 0;
    for (const auto& school : schools) {
        RE::FormID targetId = pm->GetLearningTarget(school);
        if (targetId == 0) continue;

        // Check if spell is eligible for passive learning based on scope
        if (!IsSpellEligible(targetId)) continue;

        auto progress = pm->GetProgress(targetId);

        // Skip if already mastered
        if (progress.unlocked && progress.progressPercent >= 1.0f) continue;

        // Check tier cap for passive source
        float tierCap = GetTierCap(progress.requiredXP);
        if (tierCap <= 0.0f) continue;

        // Calculate max XP allowed from passive for this spell
        float maxPassiveXP = (tierCap / 100.0f) * progress.requiredXP;

        // Check how much passive XP has already been granted
        float alreadyGranted = 0.0f;
        auto it = progress.xpFromModded.find("passive");
        if (it != progress.xpFromModded.end()) {
            alreadyGranted = it->second;
        }

        float remaining = maxPassiveXP - alreadyGranted;
        if (remaining <= 0.0f) continue;

        // Clamp to remaining cap
        float xpToGrant = (std::min)(baseXP, remaining);

        // Use AddSourcedXP which handles the modded source cap tracking
        float actual = pm->AddSourcedXP(targetId, xpToGrant, "passive");
        if (actual > 0.0f) {
            granted++;
            logger::trace("PassiveLearningSource: Granted {:.1f} XP to {:08X} ({:.1f} hrs elapsed)",
                actual, targetId, gameHoursElapsed);
        }
    }

    if (granted > 0) {
        logger::info("PassiveLearningSource: Granted passive XP to {} spell(s) ({:.1f} game hours, {:.1f} base XP)",
            granted, gameHoursElapsed, baseXP);
    }
}

float PassiveLearningSource::GetTierCap(float requiredXP) const {
    // Determine tier from required XP and return the matching cap
    const auto& xpSettings = ProgressionManager::GetSingleton()->GetXPSettings();

    Settings currentSettings;
    {
        std::lock_guard<std::mutex> lock(m_settingsMutex);
        currentSettings = m_settings;
    }

    if (requiredXP <= xpSettings.xpNovice) return currentSettings.maxNovice;
    if (requiredXP <= xpSettings.xpApprentice) return currentSettings.maxApprentice;
    if (requiredXP <= xpSettings.xpAdept) return currentSettings.maxAdept;
    if (requiredXP <= xpSettings.xpExpert) return currentSettings.maxExpert;
    return currentSettings.maxMaster;
}

bool PassiveLearningSource::IsSpellEligible(RE::FormID spellId) const {
    Settings currentSettings;
    {
        std::lock_guard<std::mutex> lock(m_settingsMutex);
        currentSettings = m_settings;
    }

    // "all" - every learning target gets passive XP
    if (currentSettings.scope == "all") return true;

    auto* pm = ProgressionManager::GetSingleton();

    // "root" - only spells with no prerequisites (root/starting spells)
    if (currentSettings.scope == "root") {
        auto reqs = pm->GetPrereqRequirements(spellId);
        return reqs.hardPrereqs.empty() && reqs.softPrereqs.empty();
    }

    // "novice" - only novice-tier spells (requiredXP <= xpNovice setting)
    if (currentSettings.scope == "novice") {
        auto progress = pm->GetProgress(spellId);
        return progress.requiredXP <= pm->GetXPSettings().xpNovice;
    }

    return false;
}

} // namespace SpellLearning
