// =============================================================================
// ProgressionManagerTargets.cpp — Learning targets, prerequisites, unlocking
// =============================================================================

#include "ProgressionManager.h"
#include "uimanager/UIManager.h"
#include "SpellEffectivenessHook.h"
#include "SpellScanner.h"

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

    // Fire ModEvent: SpellLearning_TargetChanged (set)
    SendModEvent("SpellLearning_TargetChanged", school, 1.0f, RE::TESForm::LookupByID(formId));

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
        SpellProgress progress;
        progress.requiredXP = GetRequiredXP(formId);
        m_spellProgress[formId] = progress;
    }

    // If switching back to a spell with progress above early threshold, regrant it
    if (earlySettings.enabled && formId != 0) {
        effectivenessHook->CheckAndRegrantSpell(formId);
    }
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

        // Notify UI that learning target was cleared
        UIManager::GetSingleton()->NotifyLearningTargetCleared(oldTargetId);
    }

    m_learningTargets.erase(school);
    m_dirty = true;

    // Fire ModEvent: SpellLearning_TargetChanged (cleared)
    SendModEvent("SpellLearning_TargetChanged", school, 0.0f, nullptr);
}

void ProgressionManager::ClearLearningTargetForSpell(RE::FormID formId)
{
    // Find and clear the learning target that matches this formId
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(formId);
    if (!spell) return;

    auto* effect = spell->GetCostliestEffectItem();
    if (!effect || !effect->baseEffect) return;

    auto school = effect->baseEffect->GetMagickSkill();
    std::string schoolName = SpellScanner::GetSchoolName(school);
    if (schoolName == "Unknown") return;

    // Only clear if this spell is the current target for this school
    auto it = m_learningTargets.find(schoolName);
    if (it != m_learningTargets.end() && it->second == formId) {
        ClearLearningTarget(schoolName);
        logger::info("ProgressionManager: Cleared learning target for {} (spell {:08X} mastered)",
            schoolName, formId);
    }
}

// =============================================================================
// DIRECT PREREQUISITE CHECKING
// =============================================================================

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

// =============================================================================
// SET LEARNING TARGET FROM TOME
// =============================================================================

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
    std::string schoolName = SpellScanner::GetSchoolName(school);
    if (schoolName == "Unknown") {
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
            logger::info("ProgressionManager: Single mode - clearing {} target for new {} target",
                schoolToClear, schoolName);
            ClearLearningTarget(schoolToClear);
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

    // Remove from early-learned tracking before clearing target, so ClearLearningTarget
    // doesn't call RemoveEarlySpellFromPlayer which would undo the AddSpell above.
    auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
    effectivenessHook->MarkMastered(formId);

    logger::info("ProgressionManager: Unlocked spell {} ({:08X})", spell->GetName(), formId);

    // Clear learning target for this school (spell is learned)
    auto* effect = spell->GetCostliestEffectItem();
    if (effect && effect->baseEffect) {
        auto school = effect->baseEffect->GetMagickSkill();
        std::string schoolName = SpellScanner::GetSchoolName(school);
        if (schoolName != "Unknown") {
            ClearLearningTarget(schoolName);
        } else {
            // Unknown school — find and clear by formId instead
            logger::warn("ProgressionManager: Unknown school for unlocked spell {:08X}, searching by formId", formId);
            std::string schoolToErase;
            for (const auto& [s, targetId] : m_learningTargets) {
                if (targetId == formId) {
                    schoolToErase = s;
                    break;
                }
            }
            if (!schoolToErase.empty()) {
                ClearLearningTarget(schoolToErase);
            }
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
