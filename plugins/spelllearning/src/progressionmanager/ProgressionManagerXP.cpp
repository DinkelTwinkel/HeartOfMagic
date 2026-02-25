// =============================================================================
// ProgressionManagerXP.cpp — XP settings, spell cast XP, progress tracking
// =============================================================================

#include "ProgressionManager.h"
#include "uimanager/UIManager.h"
#include "SpellEffectivenessHook.h"
#include "SpellTomeHook.h"
#include "SpellScanner.h"

// =============================================================================
// XP SETTINGS
// =============================================================================

void ProgressionManager::SetXPSettings(const XPSettings& settings)
{
    m_xpSettings = settings;
    logger::info("ProgressionManager: XP settings updated - mode: {}, global: x{:.0f}, direct: {:.0f}%, school: {:.0f}%, any: {:.0f}%",
        m_xpSettings.learningMode,
        m_xpSettings.globalMultiplier,
        m_xpSettings.multiplierDirect * 100,
        m_xpSettings.multiplierSchool * 100,
        m_xpSettings.multiplierAny * 100);
    logger::info("ProgressionManager: XP caps - any: {:.0f}%, school: {:.0f}%, direct: {:.0f}%",
        m_xpSettings.capAny,
        m_xpSettings.capSchool,
        m_xpSettings.capDirect);
    logger::info("ProgressionManager: Tier XP - Novice: {:.0f}, Apprentice: {:.0f}, Adept: {:.0f}, Expert: {:.0f}, Master: {:.0f}",
        m_xpSettings.xpNovice,
        m_xpSettings.xpApprentice,
        m_xpSettings.xpAdept,
        m_xpSettings.xpExpert,
        m_xpSettings.xpMaster);
}

float ProgressionManager::GetXPForTier(const std::string& tier) const
{
    std::string tierLower = tier;
    std::transform(tierLower.begin(), tierLower.end(), tierLower.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    if (tierLower == "novice") return m_xpSettings.xpNovice;
    if (tierLower == "apprentice") return m_xpSettings.xpApprentice;
    if (tierLower == "adept") return m_xpSettings.xpAdept;
    if (tierLower == "expert") return m_xpSettings.xpExpert;
    if (tierLower == "master") return m_xpSettings.xpMaster;

    return m_xpSettings.xpNovice;  // Default to novice
}

void ProgressionManager::SetSpellXP(RE::FormID formId, float xp)
{
    // Direct XP manipulation for cheat mode
    auto& progress = m_spellProgress[formId];

    // Ensure xp is non-negative
    xp = (std::max)(0.0f, xp);

    // Calculate progress percent from XP and required XP
    if (progress.requiredXP > 0) {
        progress.progressPercent = xp / progress.requiredXP;
    } else {
        progress.progressPercent = 0.0f;  // Don't mark as mastered when requiredXP is not set
    }

    m_dirty = true;

    logger::info("ProgressionManager: SetSpellXP {:08X} to {:.0f} XP ({:.1f}%, cheat mode)",
        formId, xp, progress.progressPercent * 100.0f);
}

// =============================================================================
// XP TRACKING (spell cast events)
// =============================================================================

void ProgressionManager::OnSpellCast(const std::string& school, RE::FormID castSpellId, float baseXP)
{
    // Apply global multiplier first
    float adjustedBaseXP = baseXP * m_xpSettings.globalMultiplier;

    // Get early learning settings
    auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
    const auto& earlySettings = effectivenessHook->GetSettings();

    // Iterate through all learning targets and grant XP based on settings
    for (auto& [targetSchool, targetId] : m_learningTargets) {
        if (targetId == 0) continue;

        // Check if target is already fully mastered
        auto progress = GetProgress(targetId);
        if (progress.unlocked && progress.progressPercent >= 1.0f) continue;

        // =========================================================================
        // SELF-CAST REQUIREMENT CHECK
        // =========================================================================
        bool isCastingLearningTarget = (castSpellId == targetId);
        float currentProgress = progress.progressPercent * 100.0f;  // Convert to percentage

        if (earlySettings.enabled && currentProgress >= earlySettings.selfCastRequiredAt) {
            // After selfCastRequiredAt threshold, ONLY self-casting grants XP
            if (!isCastingLearningTarget) {
                logger::trace("ProgressionManager: Progress {:.0f}% >= selfCastRequiredAt {:.0f}% - "
                    "only self-casting grants XP (cast spell {:08X} != target {:08X})",
                    currentProgress, earlySettings.selfCastRequiredAt, castSpellId, targetId);
                continue;  // Skip this target, no XP from non-self casts
            }
        }

        // =========================================================================
        // DETERMINE XP SOURCE AND CHECK CAPS
        // =========================================================================
        float multiplier = 0.0f;
        enum class XPSource { Any, School, Direct, Self };
        XPSource source = XPSource::Any;

        if (isCastingLearningTarget) {
            // Casting the learning target itself - SELF source
            source = XPSource::Self;
            if (earlySettings.enabled) {
                // After early unlock, casting the spell itself grants bonus XP
                if (effectivenessHook->IsEarlyLearnedSpell(targetId)) {
                    multiplier = m_xpSettings.multiplierDirect * earlySettings.selfCastXPMultiplier;
                    logger::trace("ProgressionManager: Self-casting early-learned spell - multiplier {:.0f}% x {:.1f} = {:.0f}%",
                        m_xpSettings.multiplierDirect * 100, earlySettings.selfCastXPMultiplier, multiplier * 100);
                } else {
                    // Spell not yet early-unlocked - use direct multiplier
                    multiplier = m_xpSettings.multiplierDirect;
                }
            } else {
                multiplier = m_xpSettings.multiplierDirect;
            }
        } else if (targetSchool == school) {
            // Same school as cast spell - check if DIRECT prereq or just same SCHOOL
            if (IsDirectPrerequisite(targetId, castSpellId)) {
                // Cast spell is a direct prerequisite of the target
                source = XPSource::Direct;
                multiplier = m_xpSettings.multiplierDirect;
                logger::trace("ProgressionManager: Direct prereq cast {:08X} for target {:08X} - using direct multiplier {:.0f}%",
                    castSpellId, targetId, multiplier * 100);
            } else {
                // Same school but not a direct prereq
                source = XPSource::School;
                multiplier = m_xpSettings.multiplierSchool;
                logger::trace("ProgressionManager: Same school cast - using school multiplier {:.0f}%", multiplier * 100);
            }
        } else {
            // Different school - ANY source
            source = XPSource::Any;
            multiplier = m_xpSettings.multiplierAny;
            logger::trace("ProgressionManager: Different school cast - using any multiplier {:.0f}%", multiplier * 100);
        }

        // Skip if multiplier is 0
        if (multiplier <= 0.0f) continue;

        // Calculate XP gain
        float xpGain = adjustedBaseXP * multiplier;

        // =========================================================================
        // TOME INVENTORY BOOST - bonus XP if player has the spell tome in inventory
        // =========================================================================
        auto* tomeHook = SpellTomeHook::GetSingleton();
        if (tomeHook && tomeHook->GetSettings().tomeInventoryBoost) {
            float tomeBoost = tomeHook->GetXPMultiplier(targetId);
            if (tomeBoost > 1.0f) {
                xpGain *= tomeBoost;
                logger::trace("ProgressionManager: Tome inventory boost applied to {:08X}, xpGain = {:.1f}",
                    targetId, xpGain);
            }
        }

        // =========================================================================
        // CHECK XP CAPS - limit contribution from each source type
        // =========================================================================
        auto& progRef = m_spellProgress[targetId];
        float maxXPFromSource = 0.0f;
        float currentXPFromSource = 0.0f;

        switch (source) {
            case XPSource::Any:
                maxXPFromSource = progRef.requiredXP * (m_xpSettings.capAny / 100.0f);
                currentXPFromSource = progRef.xpFromAny;
                break;
            case XPSource::School:
                maxXPFromSource = progRef.requiredXP * (m_xpSettings.capSchool / 100.0f);
                currentXPFromSource = progRef.xpFromSchool;
                break;
            case XPSource::Direct:
                maxXPFromSource = progRef.requiredXP * (m_xpSettings.capDirect / 100.0f);
                currentXPFromSource = progRef.xpFromDirect;
                break;
            case XPSource::Self:
                // Self-casting has no cap - can go to 100%
                maxXPFromSource = progRef.requiredXP;
                currentXPFromSource = progRef.xpFromSelf;
                break;
        }

        // Clamp XP gain to not exceed cap
        float remainingCap = maxXPFromSource - currentXPFromSource;
        if (remainingCap <= 0.0f) {
            logger::trace("ProgressionManager: Source cap reached for {:08X} (source: {}, cap: {:.1f}%)",
                targetId,
                source == XPSource::Any ? "any" : source == XPSource::School ? "school" : source == XPSource::Direct ? "direct" : "self",
                source == XPSource::Any ? m_xpSettings.capAny : source == XPSource::School ? m_xpSettings.capSchool : source == XPSource::Direct ? m_xpSettings.capDirect : 100.0f);
            continue;  // Skip this target, cap reached
        }

        float actualXPGain = (std::min)(xpGain, remainingCap);

        // Track XP by source
        switch (source) {
            case XPSource::Any:    progRef.xpFromAny += actualXPGain; break;
            case XPSource::School: progRef.xpFromSchool += actualXPGain; break;
            case XPSource::Direct: progRef.xpFromDirect += actualXPGain; break;
            case XPSource::Self:   progRef.xpFromSelf += actualXPGain; break;
        }

        // In "single" mode, only the first learning target gets XP
        // In "perSchool" mode, each school's target gets XP independently
        if (m_xpSettings.learningMode == "single") {
            // Only process the first active learning target
            AddXP(targetId, actualXPGain);
            logger::trace("ProgressionManager: Cast {:08X} granted {:.1f} XP (capped from {:.1f}) to target {:08X} (single mode, source: {})",
                castSpellId, actualXPGain, xpGain, targetId,
                source == XPSource::Any ? "any" : source == XPSource::School ? "school" : source == XPSource::Direct ? "direct" : "self");
            return;  // Only one target in single mode
        } else {
            // Per-school mode - each school's target gets XP
            AddXP(targetId, actualXPGain);
            logger::trace("ProgressionManager: Cast {:08X} granted {:.1f} XP (capped from {:.1f}) to target {:08X} (school: {}, source: {})",
                castSpellId, actualXPGain, xpGain, targetId, targetSchool,
                source == XPSource::Any ? "any" : source == XPSource::School ? "school" : source == XPSource::Direct ? "direct" : "self");
        }
    }
}

// =============================================================================
// XP GRANTING (core AddXP logic with early learning and mastery)
// =============================================================================

void ProgressionManager::AddXP(RE::FormID targetSpellId, float amount)
{
    auto& progress = m_spellProgress[targetSpellId];

    // If already fully mastered (unlocked in old system OR 100% in new system), no more XP needed
    if (progress.unlocked && progress.progressPercent >= 1.0f) {
        return;
    }

    float oldXP = progress.GetCurrentXP();
    float oldProgress = progress.progressPercent;
    float newXP = (std::min)(oldXP + amount, progress.requiredXP);  // Parentheses to avoid Windows min macro

    // Update progress percentage
    // requiredXP == 0 means XP requirements not initialized — treat as no progress, not instant mastery
    if (progress.requiredXP > 0) {
        progress.progressPercent = newXP / progress.requiredXP;
    } else {
        progress.progressPercent = 0.0f;
        logger::warn("ProgressionManager: AddXP for {:08X} but requiredXP is 0 — XP update ignored", targetSpellId);
    }
    progress.progressPercent = (std::min)(progress.progressPercent, 1.0f);
    m_dirty = true;

    // PERFORMANCE: Use trace for frequent XP updates (only visible with verbose logging)
    logger::trace("ProgressionManager: Spell {:08X} XP: {:.1f} -> {:.1f} / {:.1f} ({:.1f}%)",
        targetSpellId, oldXP, newXP, progress.requiredXP, progress.progressPercent * 100.0f);

    // =========================================================================
    // EARLY SPELL LEARNING - Grant spell at threshold, master at 100%
    // Power steps: 25%, 40%, 55%, 70%, 85%, 100%
    // =========================================================================
    auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
    const auto& earlySettings = effectivenessHook->GetSettings();

    if (earlySettings.enabled) {
        float unlockThreshold = earlySettings.unlockThreshold / 100.0f;  // Convert to 0-1
        float newProgress = progress.progressPercent;

        // Check if we just crossed the unlock threshold (first grant)
        if (oldProgress < unlockThreshold && newProgress >= unlockThreshold) {
            // Grant the spell early (nerfed)
            auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(targetSpellId);
            if (spell) {
                SpellEffectivenessHook::GrantEarlySpell(spell);
                logger::info("ProgressionManager: Early granted spell {:08X} at {:.0f}% progress",
                    targetSpellId, newProgress * 100.0f);

                // Fire ModEvent: SpellLearning_SpellEarlyGranted
                auto* costliest = spell->GetCostliestEffectItem();
                std::string schoolStr = (costliest && costliest->baseEffect)
                    ? SpellScanner::GetSchoolName(costliest->baseEffect->GetMagickSkill())
                    : "Unknown";
                SendModEvent("SpellLearning_SpellEarlyGranted", schoolStr, newProgress * 100.0f, spell);
            }
        }

        // Check if power step changed (for display updates)
        // This only updates name/description when crossing step thresholds
        bool stepChanged = effectivenessHook->CheckAndUpdatePowerStep(targetSpellId);
        if (stepChanged) {
            int currentStep = effectivenessHook->GetCurrentPowerStep(targetSpellId);
            float effectiveness = effectivenessHook->GetSteppedEffectiveness(targetSpellId);
            logger::info("ProgressionManager: Spell {:08X} power step changed to {} ({}%)",
                targetSpellId, effectivenessHook->GetPowerStepLabel(currentStep),
                static_cast<int>(effectiveness * 100));

            // Show notification for power step increase
            auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(targetSpellId);
            if (spell) {
                char notification[256];
                snprintf(notification, sizeof(notification), "%s power increased to %d%%",
                    spell->GetName(), static_cast<int>(effectiveness * 100));
                RE::SendHUDMessage::ShowHUDMessage(notification);

                // Fire ModEvent: SpellLearning_ProgressMilestone
                SendModEvent("SpellLearning_ProgressMilestone",
                    effectivenessHook->GetPowerStepLabel(currentStep),
                    effectiveness * 100.0f, spell);
            }
        }

        // Check if we just reached 100% mastery
        if (oldProgress < 1.0f && newProgress >= 1.0f) {
            // Mark as mastered - this removes the nerf
            effectivenessHook->MarkMastered(targetSpellId);
            progress.unlocked = true;  // Also mark as unlocked in progress system

            logger::info("ProgressionManager: Spell {:08X} MASTERED - nerf removed!", targetSpellId);

            // Show mastery notification
            auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(targetSpellId);
            if (spell) {
                char notification[256];
                snprintf(notification, sizeof(notification), "%s MASTERED! Full power unlocked.",
                    spell->GetName());
                RE::SendHUDMessage::ShowHUDMessage(notification);

                // Fire ModEvent: SpellLearning_SpellMastered
                auto* costliest = spell->GetCostliestEffectItem();
                std::string schoolStr = (costliest && costliest->baseEffect)
                    ? SpellScanner::GetSchoolName(costliest->baseEffect->GetMagickSkill())
                    : "Unknown";
                SendModEvent("SpellLearning_SpellMastered", schoolStr, 0.0f, spell);
            }

            // Clear learning target for this school (spell is mastered)
            ClearLearningTargetForSpell(targetSpellId);

            // Notify UI that spell is fully unlocked/mastered (not just "ready")
            UIManager::GetSingleton()->NotifySpellUnlocked(targetSpellId, true);
        }
    } else {
        // Old behavior: notify when ready to unlock (100%)
        if (progress.progressPercent >= 1.0f) {
            logger::info("ProgressionManager: Spell {:08X} is ready to unlock!", targetSpellId);
            UIManager::GetSingleton()->NotifySpellReady(targetSpellId);
        }
    }

    // Notify UI of progress update
    UIManager::GetSingleton()->NotifyProgressUpdate(targetSpellId, newXP, progress.requiredXP);
}

void ProgressionManager::AddXP(const std::string& formIdStr, float amount)
{
    // Parse hex string to FormID (supports "0x" prefix)
    RE::FormID formId = 0;
    try {
        formId = std::stoul(formIdStr, nullptr, 16);
    } catch (const std::exception& e) {
        logger::error("ProgressionManager: Failed to parse formId '{}': {}", formIdStr, e.what());
        return;
    }

    AddXP(formId, amount);
}

void ProgressionManager::AddXPNoGrant(const std::string& formIdStr, float amount)
{
    // ISL compatibility: Record XP progress without triggering early spell grant.
    // ISL's scripts call AddSpell when study is complete — we must not AddSpell
    // before that or ISL thinks the player already knows the spell.
    RE::FormID formId = 0;
    try {
        formId = std::stoul(formIdStr, nullptr, 16);
    } catch (const std::exception& e) {
        logger::error("ProgressionManager: Failed to parse formId '{}': {}", formIdStr, e.what());
        return;
    }

    auto& progress = m_spellProgress[formId];

    if (progress.unlocked && progress.progressPercent >= 1.0f) {
        return;
    }

    float oldXP = progress.GetCurrentXP();
    float newXP = (std::min)(oldXP + amount, progress.requiredXP);

    // requiredXP == 0 means XP requirements not initialized — treat as no progress, not instant mastery
    if (progress.requiredXP > 0) {
        progress.progressPercent = newXP / progress.requiredXP;
    } else {
        progress.progressPercent = 0.0f;
        logger::warn("ProgressionManager: [ISL-NoGrant] AddXP for {:08X} but requiredXP is 0 — XP update ignored", formId);
    }
    progress.progressPercent = (std::min)(progress.progressPercent, 1.0f);
    m_dirty = true;

    logger::info("ProgressionManager: [ISL-NoGrant] Spell {:08X} XP: {:.1f} -> {:.1f} / {:.1f} ({:.1f}%)",
        formId, oldXP, newXP, progress.requiredXP, progress.progressPercent * 100.0f);

    // NOTE: Deliberately skipping GrantEarlySpell and power step updates.
    // ISL will call AddSpell when study completes, at which point our
    // SpellEffectivenessHook will apply the appropriate power scaling.
}

// =============================================================================
// REQUIRED XP LOOKUP
// =============================================================================

float ProgressionManager::GetRequiredXP(const std::string& formIdStr) const
{
    // Parse hex string to FormID (supports "0x" prefix)
    RE::FormID formId = 0;
    try {
        formId = std::stoul(formIdStr, nullptr, 16);
    } catch (const std::exception& e) {
        logger::error("ProgressionManager: Failed to parse formId '{}': {}", formIdStr, e.what());
        return 0.0f;
    }

    return GetRequiredXP(formId);
}

float ProgressionManager::GetRequiredXP(RE::FormID formId) const
{
    auto it = m_spellProgress.find(formId);
    if (it != m_spellProgress.end() && it->second.requiredXP > 0) {
        return it->second.requiredXP;
    }

    // If no progress data, try to determine from spell tier
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(formId);
    if (spell) {
        // Use perk-based tier detection (fixes modded master spells with minimumSkill=0)
        std::string tier = SpellScanner::DetermineSpellTier(spell);
        return GetXPForTier(tier);
    }

    return m_xpSettings.xpNovice;  // Default to novice
}

// =============================================================================
// SPELL AVAILABILITY & PROGRESS QUERIES
// =============================================================================

bool ProgressionManager::IsSpellAvailableToLearn(const std::string& formIdStr) const
{
    RE::FormID formId = 0;
    try {
        formId = std::stoul(formIdStr, nullptr, 16);
    } catch (const std::exception& e) {
        logger::error("ProgressionManager: Failed to parse formId '{}': {}", formIdStr, e.what());
        return false;
    }

    return IsSpellAvailableToLearn(formId);
}

bool ProgressionManager::IsSpellAvailableToLearn(RE::FormID formId) const
{
    // A spell is available to learn if:
    // 1. It exists in our progress tracking (meaning it's in the tree)
    // 2. It's not yet unlocked
    // 3. All prerequisites are met (hard/soft system)

    auto it = m_spellProgress.find(formId);
    if (it == m_spellProgress.end()) {
        return false;  // Not in our tree
    }

    if (it->second.unlocked) {
        return false;  // Already unlocked
    }

    // Check tree prerequisites (hard/soft system)
    return AreTreePrerequisitesMet(formId);
}

ProgressionManager::SpellProgress ProgressionManager::GetProgress(RE::FormID formId) const
{
    auto it = m_spellProgress.find(formId);
    if (it != m_spellProgress.end()) {
        return it->second;
    }
    return SpellProgress{};
}

void ProgressionManager::SetRequiredXP(RE::FormID formId, float required)
{
    if (required <= 0.0f) {
        logger::warn("ProgressionManager: SetRequiredXP called with non-positive value {:.1f} for {:08X}, clamping to 1.0", required, formId);
        required = 1.0f;
    }
    m_spellProgress[formId].requiredXP = required;
}
