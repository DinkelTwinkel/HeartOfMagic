// =============================================================================
// ProgressionManagerAPI.cpp — Public modder API (sourced XP, raw XP, sources)
// =============================================================================

#include "ProgressionManager.h"
#include "uimanager/UIManager.h"

// =============================================================================
// PUBLIC MODDER API
// =============================================================================

bool ProgressionManager::RegisterModdedXPSource(const std::string& sourceId, const std::string& displayName, bool internal)
{
    // Check if already registered
    if (m_xpSettings.moddedSources.find(sourceId) != m_xpSettings.moddedSources.end()) {
        logger::info("ProgressionManager: Modded source '{}' already registered", sourceId);
        return false;
    }

    // Create default config
    ModdedSourceConfig config;
    config.displayName = displayName.empty() ? sourceId : displayName;
    config.enabled = true;
    config.multiplier = 100.0f;
    config.cap = 25.0f;
    config.internal = internal;
    m_xpSettings.moddedSources[sourceId] = config;

    logger::info("ProgressionManager: Registered {} XP source '{}' (display: '{}')",
        internal ? "internal" : "modded", sourceId, config.displayName);

    // Only notify UI for external (non-internal) sources
    if (!internal) {
        UIManager::GetSingleton()->NotifyModdedSourceRegistered(sourceId, config.displayName, config.multiplier, config.cap);
    }

    // Fire ModEvent
    SendModEvent("SpellLearning_SourceRegistered", sourceId, 0.0f, nullptr);

    return true;
}

float ProgressionManager::AddSourcedXP(RE::FormID targetId, float amount, const std::string& sourceName)
{
    if (targetId == 0 || amount <= 0.0f) return 0.0f;

    // Initialize progress entry if missing
    if (m_spellProgress.find(targetId) == m_spellProgress.end()) {
        SpellProgress newProgress;
        newProgress.requiredXP = GetRequiredXP(targetId);
        m_spellProgress[targetId] = newProgress;
    }

    auto& progress = m_spellProgress[targetId];

    // Already mastered
    if (progress.unlocked && progress.progressPercent >= 1.0f) return 0.0f;

    // Apply global multiplier
    float adjustedAmount = amount * m_xpSettings.globalMultiplier;

    // Built-in sources
    if (sourceName == "any" || sourceName == "school" || sourceName == "direct" || sourceName == "self") {
        float maxFromSource = 0.0f;
        float currentFromSource = 0.0f;

        if (sourceName == "any") {
            adjustedAmount *= m_xpSettings.multiplierAny;
            maxFromSource = progress.requiredXP * (m_xpSettings.capAny / 100.0f);
            currentFromSource = progress.xpFromAny;
        } else if (sourceName == "school") {
            adjustedAmount *= m_xpSettings.multiplierSchool;
            maxFromSource = progress.requiredXP * (m_xpSettings.capSchool / 100.0f);
            currentFromSource = progress.xpFromSchool;
        } else if (sourceName == "direct") {
            adjustedAmount *= m_xpSettings.multiplierDirect;
            maxFromSource = progress.requiredXP * (m_xpSettings.capDirect / 100.0f);
            currentFromSource = progress.xpFromDirect;
        } else {  // "self" - no cap
            // Self-casting uses the direct multiplier — casting the target spell IS direct interaction
            adjustedAmount *= m_xpSettings.multiplierDirect;
            maxFromSource = progress.requiredXP;
            currentFromSource = progress.xpFromSelf;
        }

        float remaining = maxFromSource - currentFromSource;
        adjustedAmount = (std::min)(adjustedAmount, (std::max)(0.0f, remaining));

        if (adjustedAmount > 0.0f) {
            if (sourceName == "any")         progress.xpFromAny += adjustedAmount;
            else if (sourceName == "school") progress.xpFromSchool += adjustedAmount;
            else if (sourceName == "direct") progress.xpFromDirect += adjustedAmount;
            else                             progress.xpFromSelf += adjustedAmount;
        }
    }
    // Modded sources
    else {
        // Auto-register if unknown
        if (m_xpSettings.moddedSources.find(sourceName) == m_xpSettings.moddedSources.end()) {
            RegisterModdedXPSource(sourceName, sourceName);
        }

        auto& srcConfig = m_xpSettings.moddedSources[sourceName];
        if (!srcConfig.enabled) return 0.0f;

        // Apply source-specific multiplier
        adjustedAmount *= (srcConfig.multiplier / 100.0f);

        // Apply cap
        float maxFromSource = progress.requiredXP * (srcConfig.cap / 100.0f);
        float currentFromSource = progress.xpFromModded[sourceName];
        float remaining = maxFromSource - currentFromSource;
        adjustedAmount = (std::min)(adjustedAmount, (std::max)(0.0f, remaining));

        if (adjustedAmount > 0.0f) {
            progress.xpFromModded[sourceName] += adjustedAmount;
        }
    }

    if (adjustedAmount > 0.0f) {
        AddXP(targetId, adjustedAmount);
        SendModEvent("SpellLearning_XPGained", sourceName, adjustedAmount,
                      RE::TESForm::LookupByID(targetId));
    }

    return adjustedAmount;
}

float ProgressionManager::AddRawXP(RE::FormID targetId, float amount)
{
    if (targetId == 0 || amount <= 0.0f) return 0.0f;

    // Initialize progress entry if missing
    if (m_spellProgress.find(targetId) == m_spellProgress.end()) {
        SpellProgress newProgress;
        newProgress.requiredXP = GetRequiredXP(targetId);
        m_spellProgress[targetId] = newProgress;
    }

    auto& progress = m_spellProgress[targetId];
    if (progress.unlocked && progress.progressPercent >= 1.0f) return 0.0f;

    // Clamp to remaining XP needed
    float currentXP = progress.GetCurrentXP();
    float remaining = progress.requiredXP - currentXP;
    float actualAmount = (std::min)(amount, (std::max)(0.0f, remaining));

    if (actualAmount > 0.0f) {
        AddXP(targetId, actualAmount);
        SendModEvent("SpellLearning_XPGained", "raw", actualAmount,
                      RE::TESForm::LookupByID(targetId));
    }

    return actualAmount;
}

float ProgressionManager::GetSourceCap(const std::string& sourceName) const
{
    if (sourceName == "any")    return m_xpSettings.capAny;
    if (sourceName == "school") return m_xpSettings.capSchool;
    if (sourceName == "direct") return m_xpSettings.capDirect;
    if (sourceName == "self")   return 100.0f;  // Self has no cap

    // Check modded sources
    auto it = m_xpSettings.moddedSources.find(sourceName);
    if (it != m_xpSettings.moddedSources.end()) {
        return it->second.cap;
    }

    return 0.0f;  // Unknown source
}
