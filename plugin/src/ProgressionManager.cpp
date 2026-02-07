#include "ProgressionManager.h"
#include "UIManager.h"
#include "SpellEffectivenessHook.h"
#include "SpellTomeHook.h"
#include <fstream>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

ProgressionManager* ProgressionManager::GetSingleton()
{
    static ProgressionManager singleton;
    return &singleton;
}

std::filesystem::path ProgressionManager::GetProgressFilePath() const
{
    std::string filename = "progress_" + m_currentSaveName + ".json";
    return std::filesystem::path("Data/SKSE/Plugins/SpellLearning") / filename;
}

// =============================================================================
// LEARNING TARGETS
// =============================================================================

void ProgressionManager::SetLearningTarget(const std::string& school, RE::FormID formId, const std::vector<RE::FormID>& prereqs)
{
    auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
    const auto& earlySettings = effectivenessHook->GetSettings();
    
    // Check if there's an existing learning target for this school
    auto it = m_learningTargets.find(school);
    if (it != m_learningTargets.end() && it->second != 0 && it->second != formId) {
        RE::FormID oldTargetId = it->second;
        
        // If old target was early-learned and not mastered, remove the spell from player
        if (earlySettings.enabled && effectivenessHook->IsEarlyLearnedSpell(oldTargetId)) {
            logger::info("ProgressionManager: Switching learning target in {} from {:08X} to {:08X}",
                school, oldTargetId, formId);
            
            // Remove the early spell from player (they can regain it by setting it as target again)
            SpellEffectivenessHook::RemoveEarlySpellFromPlayer(oldTargetId);
        }
        
        // Notify UI that old target is no longer being learned
        UIManager::GetSingleton()->NotifyLearningTargetCleared(oldTargetId);
        
        // Clear old target's prerequisites
        m_targetPrerequisites.erase(oldTargetId);
    }
    
    m_learningTargets[school] = formId;
    m_dirty = true;
    
    // Store the prerequisites for direct prereq detection
    if (!prereqs.empty()) {
        m_targetPrerequisites[formId] = prereqs;
        logger::info("ProgressionManager: Set {} direct prerequisites for {:08X}", prereqs.size(), formId);
    } else {
        m_targetPrerequisites.erase(formId);
    }
    
    logger::info("ProgressionManager: Set learning target for {} to {:08X}", school, formId);
    
    // Initialize progress if not exists
    if (m_spellProgress.find(formId) == m_spellProgress.end()) {
        m_spellProgress[formId] = SpellProgress{};
    }
    
    // If switching back to a spell with progress above early threshold, regrant it
    if (earlySettings.enabled && formId != 0) {
        effectivenessHook->CheckAndRegrantSpell(formId);
    }
}

bool ProgressionManager::IsDirectPrerequisite(RE::FormID targetSpellId, RE::FormID castSpellId) const
{
    auto it = m_targetPrerequisites.find(targetSpellId);
    if (it == m_targetPrerequisites.end()) {
        return false;
    }
    
    const auto& prereqs = it->second;
    return std::find(prereqs.begin(), prereqs.end(), castSpellId) != prereqs.end();
}

void ProgressionManager::SetTargetPrerequisites(RE::FormID targetSpellId, const std::vector<RE::FormID>& prereqs)
{
    if (prereqs.empty()) {
        m_targetPrerequisites.erase(targetSpellId);
    } else {
        m_targetPrerequisites[targetSpellId] = prereqs;
        logger::info("ProgressionManager: Set {} prerequisites for {:08X}", prereqs.size(), targetSpellId);
    }
}

// =============================================================================
// TREE PREREQUISITES - UNIFIED HARD/SOFT SYSTEM
// =============================================================================
// Hard prereqs: ALL must be mastered
// Soft prereqs: at least softNeeded must be mastered
// Single prereq = always hard (enforced by JS generation)

void ProgressionManager::SetPrereqRequirements(RE::FormID spellId, const PrereqRequirements& reqs)
{
    if (reqs.hardPrereqs.empty() && reqs.softPrereqs.empty()) {
        m_prereqRequirements.erase(spellId);
    } else {
        m_prereqRequirements[spellId] = reqs;
        logger::trace("ProgressionManager: Set prereqs for {:08X}: {} hard, {} soft (need {})", 
            spellId, reqs.hardPrereqs.size(), reqs.softPrereqs.size(), reqs.softNeeded);
    }
}

// Legacy compatibility
void ProgressionManager::SetTreePrerequisites(RE::FormID spellId, const std::vector<RE::FormID>& prereqs)
{
    PrereqRequirements reqs;
    // Treat all as hard for legacy compatibility
    reqs.hardPrereqs = prereqs;
    reqs.softNeeded = 0;
    SetPrereqRequirements(spellId, reqs);
}

void ProgressionManager::ClearAllTreePrerequisites()
{
    m_prereqRequirements.clear();
    logger::info("ProgressionManager: Cleared all tree prerequisites");
}

ProgressionManager::PrereqRequirements ProgressionManager::GetPrereqRequirements(RE::FormID spellId) const
{
    auto it = m_prereqRequirements.find(spellId);
    if (it != m_prereqRequirements.end()) {
        return it->second;
    }
    return PrereqRequirements{};
}

// Legacy compatibility
std::vector<RE::FormID> ProgressionManager::GetTreePrerequisites(RE::FormID spellId) const
{
    auto reqs = GetPrereqRequirements(spellId);
    // Return all prereqs combined for legacy code
    std::vector<RE::FormID> all = reqs.hardPrereqs;
    all.insert(all.end(), reqs.softPrereqs.begin(), reqs.softPrereqs.end());
    return all;
}

bool ProgressionManager::IsSpellMastered(RE::FormID spellId) const
{
    // Check our progress tracking
    auto it = m_spellProgress.find(spellId);
    if (it != m_spellProgress.end()) {
        // Mastered if unlocked flag is set OR progress is at 100%
        if (it->second.unlocked || it->second.progressPercent >= 1.0f) {
            return true;
        }
    }
    
    // Also check if player knows the spell and it's NOT in our early-learned tracking
    // (meaning they learned it some other way, like vanilla)
    auto* player = RE::PlayerCharacter::GetSingleton();
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellId);
    if (player && spell && player->HasSpell(spell)) {
        auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
        if (!effectivenessHook || !effectivenessHook->IsEarlyLearnedSpell(spellId)) {
            // Player has the spell and it's not weakened = mastered
            return true;
        }
    }
    
    return false;
}

bool ProgressionManager::AreTreePrerequisitesMet(RE::FormID spellId) const
{
    auto reqs = GetPrereqRequirements(spellId);
    
    // No prerequisites = always available (root spell)
    if (reqs.hardPrereqs.empty() && reqs.softPrereqs.empty()) {
        return true;
    }
    
    // Check ALL hard prerequisites must be mastered
    for (RE::FormID prereqId : reqs.hardPrereqs) {
        if (!IsSpellMastered(prereqId)) {
            return false;
        }
    }
    
    // Check soft prerequisites: need at least softNeeded mastered
    if (reqs.softNeeded > 0 && !reqs.softPrereqs.empty()) {
        int masteredCount = 0;
        for (RE::FormID prereqId : reqs.softPrereqs) {
            if (IsSpellMastered(prereqId)) {
                masteredCount++;
            }
        }
        if (masteredCount < reqs.softNeeded) {
            return false;
        }
    }
    
    return true;
}

std::vector<RE::FormID> ProgressionManager::GetUnmetHardPrerequisites(RE::FormID spellId) const
{
    std::vector<RE::FormID> unmet;
    auto reqs = GetPrereqRequirements(spellId);
    
    for (RE::FormID prereqId : reqs.hardPrereqs) {
        if (!IsSpellMastered(prereqId)) {
            unmet.push_back(prereqId);
        }
    }
    
    return unmet;
}

std::pair<int, int> ProgressionManager::GetSoftPrerequisiteStatus(RE::FormID spellId) const
{
    auto reqs = GetPrereqRequirements(spellId);
    
    int masteredCount = 0;
    for (RE::FormID prereqId : reqs.softPrereqs) {
        if (IsSpellMastered(prereqId)) {
            masteredCount++;
        }
    }
    
    return { masteredCount, reqs.softNeeded };
}

RE::FormID ProgressionManager::GetLearningTarget(const std::string& school) const
{
    auto it = m_learningTargets.find(school);
    if (it != m_learningTargets.end()) {
        return it->second;
    }
    return 0;
}

void ProgressionManager::ClearLearningTarget(const std::string& school)
{
    // Check if there was an active target to clear
    auto it = m_learningTargets.find(school);
    if (it != m_learningTargets.end() && it->second != 0) {
        RE::FormID oldTargetId = it->second;
        
        // If old target was early-learned and not mastered, remove the spell from player
        auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
        const auto& earlySettings = effectivenessHook->GetSettings();
        
        if (earlySettings.enabled && effectivenessHook->IsEarlyLearnedSpell(oldTargetId)) {
            logger::info("ProgressionManager: Clearing learning target in {} - removing early spell {:08X}",
                school, oldTargetId);
            
            // Remove the early spell from player
            SpellEffectivenessHook::RemoveEarlySpellFromPlayer(oldTargetId);
        }
        
        // Clear prerequisites for this target
        m_targetPrerequisites.erase(oldTargetId);
    }
    
    m_learningTargets.erase(school);
    m_dirty = true;
}

void ProgressionManager::ClearLearningTargetForSpell(RE::FormID formId)
{
    // Find and clear the learning target that matches this formId
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(formId);
    if (!spell) return;
    
    auto* effect = spell->GetCostliestEffectItem();
    if (!effect || !effect->baseEffect) return;
    
    auto school = effect->baseEffect->GetMagickSkill();
    std::string schoolName;
    switch (school) {
        case RE::ActorValue::kAlteration:  schoolName = "Alteration"; break;
        case RE::ActorValue::kConjuration: schoolName = "Conjuration"; break;
        case RE::ActorValue::kDestruction: schoolName = "Destruction"; break;
        case RE::ActorValue::kIllusion:    schoolName = "Illusion"; break;
        case RE::ActorValue::kRestoration: schoolName = "Restoration"; break;
        default: return;
    }
    
    // Only clear if this spell is the current target for this school
    auto it = m_learningTargets.find(schoolName);
    if (it != m_learningTargets.end() && it->second == formId) {
        ClearLearningTarget(schoolName);
        logger::info("ProgressionManager: Cleared learning target for {} (spell {:08X} mastered)", 
            schoolName, formId);
    }
}

// =============================================================================
// XP TRACKING
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
    std::transform(tierLower.begin(), tierLower.end(), tierLower.begin(), ::tolower);
    
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
        progress.progressPercent = 0.0f;
    }
    
    m_dirty = true;
    
    logger::info("ProgressionManager: SetSpellXP {:08X} to {:.0f} XP ({:.1f}%, cheat mode)", 
        formId, xp, progress.progressPercent * 100.0f);
}

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
    progress.progressPercent = progress.requiredXP > 0 ? (newXP / progress.requiredXP) : 1.0f;
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
        // Get spell's minimum skill level from its effects to determine tier
        int skillLevel = 0;
        for (std::uint32_t i = 0; i < spell->effects.size(); ++i) {
            auto* effect = spell->effects[i];
            if (effect && effect->baseEffect) {
                int effectLevel = static_cast<int>(effect->baseEffect->data.minimumSkill);
                skillLevel = (std::max)(skillLevel, effectLevel);
            }
        }
        
        // Map skill level to tier
        if (skillLevel <= 25) return m_xpSettings.xpNovice;
        if (skillLevel <= 50) return m_xpSettings.xpApprentice;
        if (skillLevel <= 75) return m_xpSettings.xpAdept;
        if (skillLevel <= 100) return m_xpSettings.xpExpert;
        return m_xpSettings.xpMaster;
    }
    
    return m_xpSettings.xpNovice;  // Default to novice
}

void ProgressionManager::SetLearningTargetFromTome(const std::string& formIdStr, RE::SpellItem* spell)
{
    if (!spell) {
        // Try to look up by form ID
        RE::FormID formId = 0;
        try {
            formId = std::stoul(formIdStr, nullptr, 16);
        } catch (const std::exception& e) {
            logger::error("ProgressionManager: Failed to parse formId '{}': {}", formIdStr, e.what());
            return;
        }
        spell = RE::TESForm::LookupByID<RE::SpellItem>(formId);
        if (!spell) {
            logger::error("ProgressionManager: Could not find spell for formId {}", formIdStr);
            return;
        }
    }
    
    // Determine spell school from its costliest effect
    auto* effect = spell->GetCostliestEffectItem();
    if (!effect || !effect->baseEffect) {
        logger::warn("ProgressionManager: Could not determine school for spell {}", spell->GetName());
        return;
    }
    
    auto school = effect->baseEffect->GetMagickSkill();
    std::string schoolName;
    switch (school) {
        case RE::ActorValue::kAlteration:  schoolName = "Alteration"; break;
        case RE::ActorValue::kConjuration: schoolName = "Conjuration"; break;
        case RE::ActorValue::kDestruction: schoolName = "Destruction"; break;
        case RE::ActorValue::kIllusion:    schoolName = "Illusion"; break;
        case RE::ActorValue::kRestoration: schoolName = "Restoration"; break;
        default: 
            logger::warn("ProgressionManager: Unknown school for spell {}", spell->GetName());
            return;
    }
    
    RE::FormID formId = spell->GetFormID();
    
    // =========================================================================
    // LEARNING MODE ENFORCEMENT
    // In "single" mode: clear ALL other learning targets before setting new one
    // In "perSchool" mode: only the same-school target is replaced (handled by SetLearningTarget)
    // =========================================================================
    if (m_xpSettings.learningMode == "single") {
        // Clear all learning targets in OTHER schools first
        std::vector<std::string> schoolsToClear;
        for (const auto& [existingSchool, existingTarget] : m_learningTargets) {
            if (existingSchool != schoolName && existingTarget != 0) {
                schoolsToClear.push_back(existingSchool);
            }
        }
        
        for (const auto& schoolToClear : schoolsToClear) {
            RE::FormID oldTargetId = m_learningTargets[schoolToClear];
            logger::info("ProgressionManager: Single mode - clearing {} target {:08X} for new {} target",
                schoolToClear, oldTargetId, schoolName);
            
            // Remove the early spell if it was granted
            auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
            if (effectivenessHook && effectivenessHook->IsEarlyLearnedSpell(oldTargetId)) {
                SpellEffectivenessHook::RemoveEarlySpellFromPlayer(oldTargetId);
            }
            
            // Notify UI that this spell is no longer being learned
            UIManager::GetSingleton()->NotifyLearningTargetCleared(oldTargetId);
            
            // Clear the target
            m_learningTargets.erase(schoolToClear);
            m_targetPrerequisites.erase(oldTargetId);
        }
    }
    
    // Initialize progress if not exists
    if (m_spellProgress.find(formId) == m_spellProgress.end()) {
        SpellProgress progress;
        progress.requiredXP = GetRequiredXP(formId);
        m_spellProgress[formId] = progress;
    }
    
    // Set as learning target (empty prereqs since tome provides direct learning)
    // This also handles clearing any existing target in the SAME school
    SetLearningTarget(schoolName, formId, {});
    
    logger::info("ProgressionManager: Set {} spell {} as learning target from tome", 
        schoolName, spell->GetName());
    
    // Notify UI immediately so it knows this is a learning target BEFORE we grant the spell
    UIManager::GetSingleton()->NotifyLearningTargetSet(schoolName, formId, spell->GetName());
}

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
    m_spellProgress[formId].requiredXP = required;
}

// =============================================================================
// SPELL UNLOCKING
// =============================================================================

bool ProgressionManager::CanUnlock(RE::FormID formId) const
{
    auto it = m_spellProgress.find(formId);
    if (it == m_spellProgress.end()) {
        return false;
    }

    // Check XP requirement
    if (it->second.unlocked || it->second.progressPercent < 1.0f) {
        return false;
    }

    // Check tree prerequisites (hard/soft system)
    if (!AreTreePrerequisitesMet(formId)) {
        logger::trace("ProgressionManager: Cannot unlock {:08X} - prerequisites not met", formId);
        return false;
    }

    return true;
}

bool ProgressionManager::UnlockSpell(RE::FormID formId)
{
    if (!CanUnlock(formId)) {
        logger::warn("ProgressionManager: Cannot unlock {:08X} - not ready", formId);
        return false;
    }
    
    // Get player and spell
    auto* player = RE::PlayerCharacter::GetSingleton();
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(formId);
    
    if (!player || !spell) {
        logger::error("ProgressionManager: Failed to get player or spell {:08X}", formId);
        return false;
    }
    
    // Add spell to player
    player->AddSpell(spell);
    
    // Mark as unlocked
    m_spellProgress[formId].unlocked = true;
    m_dirty = true;
    
    logger::info("ProgressionManager: Unlocked spell {} ({:08X})", spell->GetName(), formId);
    
    // Clear learning target for this school (spell is learned)
    auto* effect = spell->GetCostliestEffectItem();
    if (effect && effect->baseEffect) {
        auto school = effect->baseEffect->GetMagickSkill();
        std::string schoolName;
        switch (school) {
            case RE::ActorValue::kAlteration:  schoolName = "Alteration"; break;
            case RE::ActorValue::kConjuration: schoolName = "Conjuration"; break;
            case RE::ActorValue::kDestruction: schoolName = "Destruction"; break;
            case RE::ActorValue::kIllusion:    schoolName = "Illusion"; break;
            case RE::ActorValue::kRestoration: schoolName = "Restoration"; break;
            default: break;
        }
        if (!schoolName.empty()) {
            ClearLearningTarget(schoolName);
        }
    }
    
    return true;
}

bool ProgressionManager::IsUnlocked(RE::FormID formId) const
{
    auto it = m_spellProgress.find(formId);
    if (it != m_spellProgress.end()) {
        return it->second.unlocked;
    }
    return false;
}

// =============================================================================
// SKSE CO-SAVE SERIALIZATION
// =============================================================================

void ProgressionManager::ClearAllProgress()
{
    logger::info("ProgressionManager: Clearing all progress data");
    m_learningTargets.clear();
    m_spellProgress.clear();
    m_dirty = false;
}

void ProgressionManager::OnGameSaved(SKSE::SerializationInterface* a_intfc)
{
    logger::info("ProgressionManager: Saving to co-save...");
    
    // Write learning targets record
    if (!a_intfc->OpenRecord(kTargetsRecord, kSerializationVersion)) {
        logger::error("ProgressionManager: Failed to open targets record for writing");
        return;
    }
    
    // Write number of targets
    uint32_t numTargets = static_cast<uint32_t>(m_learningTargets.size());
    a_intfc->WriteRecordData(&numTargets, sizeof(numTargets));
    
    // Write each target: school string length, school string, formId
    for (auto& [school, formId] : m_learningTargets) {
        uint32_t schoolLen = static_cast<uint32_t>(school.length());
        a_intfc->WriteRecordData(&schoolLen, sizeof(schoolLen));
        a_intfc->WriteRecordData(school.c_str(), schoolLen);
        a_intfc->WriteRecordData(&formId, sizeof(formId));
    }
    
    logger::info("ProgressionManager: Saved {} learning targets", numTargets);
    
    // Write progress record
    if (!a_intfc->OpenRecord(kProgressRecord, kSerializationVersion)) {
        logger::error("ProgressionManager: Failed to open progress record for writing");
        return;
    }
    
    // Write number of progress entries
    uint32_t numProgress = static_cast<uint32_t>(m_spellProgress.size());
    a_intfc->WriteRecordData(&numProgress, sizeof(numProgress));
    
    // Write each progress: formId, progressPercent, unlocked
    for (auto& [formId, progress] : m_spellProgress) {
        a_intfc->WriteRecordData(&formId, sizeof(formId));
        a_intfc->WriteRecordData(&progress.progressPercent, sizeof(progress.progressPercent));
        uint8_t unlocked = progress.unlocked ? 1 : 0;
        a_intfc->WriteRecordData(&unlocked, sizeof(unlocked));
    }
    
    logger::info("ProgressionManager: Saved {} spell progress entries to co-save", numProgress);
    m_dirty = false;
}

void ProgressionManager::OnGameLoaded(SKSE::SerializationInterface* a_intfc)
{
    logger::info("ProgressionManager: Loading from co-save...");
    
    // Clear existing data first
    ClearAllProgress();
    
    uint32_t type, version, length;
    
    while (a_intfc->GetNextRecordInfo(type, version, length)) {
        if (version != kSerializationVersion) {
            logger::warn("ProgressionManager: Skipping record with mismatched version (got {}, expected {})", 
                version, kSerializationVersion);
            continue;
        }
        
        switch (type) {
            case kTargetsRecord: {
                // Read learning targets
                uint32_t numTargets = 0;
                a_intfc->ReadRecordData(&numTargets, sizeof(numTargets));
                
                for (uint32_t i = 0; i < numTargets; ++i) {
                    uint32_t schoolLen = 0;
                    a_intfc->ReadRecordData(&schoolLen, sizeof(schoolLen));
                    
                    std::string school(schoolLen, '\0');
                    a_intfc->ReadRecordData(school.data(), schoolLen);
                    
                    RE::FormID formId = 0;
                    a_intfc->ReadRecordData(&formId, sizeof(formId));
                    
                    // Resolve formId (handles load order changes)
                    RE::FormID resolvedId = 0;
                    if (a_intfc->ResolveFormID(formId, resolvedId)) {
                        m_learningTargets[school] = resolvedId;
                        logger::info("ProgressionManager: Loaded target {} -> {:08X}", school, resolvedId);
                    } else {
                        logger::warn("ProgressionManager: Failed to resolve target formId {:08X}", formId);
                    }
                }
                
                logger::info("ProgressionManager: Loaded {} learning targets", m_learningTargets.size());
                break;
            }
            
            case kProgressRecord: {
                // Read spell progress
                uint32_t numProgress = 0;
                a_intfc->ReadRecordData(&numProgress, sizeof(numProgress));
                
                for (uint32_t i = 0; i < numProgress; ++i) {
                    RE::FormID formId = 0;
                    a_intfc->ReadRecordData(&formId, sizeof(formId));
                    
                    float progressPercent = 0.0f;
                    a_intfc->ReadRecordData(&progressPercent, sizeof(progressPercent));
                    
                    uint8_t unlocked = 0;
                    a_intfc->ReadRecordData(&unlocked, sizeof(unlocked));
                    
                    // Resolve formId (handles load order changes)
                    RE::FormID resolvedId = 0;
                    if (a_intfc->ResolveFormID(formId, resolvedId)) {
                        SpellProgress progress;
                        progress.progressPercent = progressPercent;
                        progress.unlocked = unlocked != 0;
                        // requiredXP will be set from tree data later
                        m_spellProgress[resolvedId] = progress;
                        
                        logger::info("ProgressionManager: Loaded progress {:08X} -> {:.1f}% {}", 
                            resolvedId, progressPercent * 100.0f, unlocked ? "(unlocked)" : "");
                    } else {
                        logger::warn("ProgressionManager: Failed to resolve progress formId {:08X}", formId);
                    }
                }
                
                logger::info("ProgressionManager: Loaded {} spell progress entries", m_spellProgress.size());
                break;
            }
            
            default:
                logger::warn("ProgressionManager: Unknown record type: {}", type);
                break;
        }
    }
    
    logger::info("ProgressionManager: Co-save load complete");
}

void ProgressionManager::OnRevert(SKSE::SerializationInterface*)
{
    logger::info("ProgressionManager: Reverting (new game or load)");
    ClearAllProgress();
}

// =============================================================================
// LEGACY SAVE/LOAD (JSON files - kept for backwards compatibility)
// =============================================================================

void ProgressionManager::SetCurrentSave(const std::string& saveName)
{
    if (m_currentSaveName != saveName) {
        m_currentSaveName = saveName;
        logger::info("ProgressionManager: Save name set to '{}'", saveName);
    }
}

void ProgressionManager::LoadProgress(const std::string& saveName)
{
    // This is now a no-op - progress is loaded from co-save
    // Kept for backwards compatibility
    SetCurrentSave(saveName);
    logger::info("ProgressionManager: LoadProgress called (legacy) - using co-save data");
}

void ProgressionManager::SaveProgress()
{
    // This is now a no-op - progress is saved to co-save automatically
    // Kept for backwards compatibility
    logger::trace("ProgressionManager: SaveProgress called (legacy) - using co-save");
}

std::string ProgressionManager::GetProgressJSON() const
{
    json j;
    
    // Learning targets
    json targets = json::object();
    for (auto& [school, formId] : m_learningTargets) {
        std::stringstream ss;
        ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
        targets[school] = ss.str();
    }
    j["learningTargets"] = targets;
    
    // Spell progress
    json progress = json::object();
    for (auto& [formId, data] : m_spellProgress) {
        std::stringstream ss;
        ss << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << formId;
        std::string formIdStr = ss.str();
        
        float currentXP = data.GetCurrentXP();
        progress[formIdStr] = {
            {"xp", currentXP},
            {"required", data.requiredXP},
            {"progress", data.progressPercent},
            {"unlocked", data.unlocked},
            {"ready", !data.unlocked && data.progressPercent >= 1.0f}
        };
    }
    j["spellProgress"] = progress;
    
    return j.dump();
}
