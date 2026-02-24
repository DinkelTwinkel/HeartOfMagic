#include "SpellEffectivenessHook.h"
#include "ProgressionManager.h"
#include "uimanager/UIManager.h"
#include "ThreadUtils.h"

// =============================================================================
// SPELL GRANTING
// =============================================================================

void SpellEffectivenessHook::GrantEarlySpell(RE::SpellItem* spell)
{
    if (!spell) {
        return;
    }

    auto* player = RE::PlayerCharacter::GetSingleton();
    if (!player) {
        return;
    }

    auto* hook = GetSingleton();
    RE::FormID formId = spell->GetFormID();
    bool alreadyHasSpell = player->HasSpell(spell);
    bool alreadyTracked = hook->IsEarlyLearnedSpell(formId);

    // Add spell to player if they don't have it
    if (!alreadyHasSpell) {
        player->AddSpell(spell);
        logger::info("SpellEffectivenessHook: Added spell {} ({:08X}) to player",
            spell->GetName(), formId);

        // Show notification that spell was granted (weakened)
        char notification[256];
        int step = hook->GetCurrentPowerStep(formId);
        std::string label = hook->GetPowerStepLabel(step);
        snprintf(notification, sizeof(notification), "%s %s learned (weakened)",
            label.c_str(), spell->GetName());
        RE::SendHUDMessage::ShowHUDMessage(notification);
    }

    // Track as early-learned even if player already has it (but not if already tracked)
    if (!alreadyTracked) {
        hook->AddEarlyLearnedSpell(formId);
        hook->UpdateSpellDisplayCache(formId, spell);

        // Apply the modified name and description to the actual spell (works with SkyUI)
        hook->ApplyModifiedSpellName(formId);
        hook->ApplyModifiedDescriptions(formId);

        logger::info("SpellEffectivenessHook: Now tracking {} ({:08X}) as early-learned (had spell: {})",
            spell->GetName(), formId, alreadyHasSpell);

        // Notify UI
        UIManager::GetSingleton()->UpdateSpellState(
            std::format("0x{:08X}", formId), "weakened");
    } else {
        logger::trace("SpellEffectivenessHook: Spell {} ({:08X}) already tracked as early-learned",
            spell->GetName(), formId);
    }
}

void SpellEffectivenessHook::RegisterISLPendingSpell(RE::SpellItem* spell)
{
    if (!spell) return;

    RE::FormID formId = spell->GetFormID();

    // Add to early-learned tracking so effectiveness hook will nerf when ISL teaches it.
    // Do NOT call player->AddSpell — ISL handles that after study is complete.
    {
        std::unique_lock<std::shared_mutex> lock(m_mutex);
        if (m_earlyLearnedSpells.find(formId) != m_earlyLearnedSpells.end()) {
            logger::trace("SpellEffectivenessHook: ISL pending spell {} ({:08X}) already tracked",
                spell->GetName(), formId);
            return;
        }
        AddToEarlySet(formId);
    }

    logger::info("SpellEffectivenessHook: Registered ISL pending spell {} ({:08X}) for weakness tracking",
        spell->GetName(), formId);

    // Store original name NOW (before any modification) so we have it for later.
    // Do NOT modify spell name/description yet — ISL reads akSpell.GetName() in
    // its study notifications, and we don't want "(Learning - 20%)" showing there.
    // Name/description modifications are applied later in OnStudyComplete.
    {
        std::unique_lock<std::shared_mutex> lock(m_mutex);
        if (m_originalSpellNames.find(formId) == m_originalSpellNames.end()) {
            m_originalSpellNames[formId] = spell->GetName();
            logger::info("SpellEffectivenessHook: Stored original name for ISL pending spell {:08X}: '{}'",
                formId, spell->GetName());
        }
    }

    // Notify UI of the new tracked state (no name change yet)
    UIManager::GetSingleton()->UpdateSpellState(
        std::format("0x{:08X}", formId), "studying");
}

void SpellEffectivenessHook::MarkMastered(RE::FormID spellFormId)
{
    // Restore original spell name and description BEFORE removing from tracking
    RestoreOriginalSpellName(spellFormId);
    RestoreOriginalDescriptions(spellFormId);

    RemoveEarlyLearnedSpell(spellFormId);

    // Clear display cache since spell is now at full power
    {
        std::unique_lock<std::shared_mutex> lock(m_mutex);
        m_displayCache.erase(spellFormId);
    }

    logger::info("SpellEffectivenessHook: Spell {:08X} mastered - nerf removed, name restored", spellFormId);

    // Notify UI
    UIManager::GetSingleton()->UpdateSpellState(
        std::format("0x{:08X}", spellFormId), "mastered");
}

// =============================================================================
// SPELL REMOVAL / RE-GRANTING (for learning target changes)
// =============================================================================

void SpellEffectivenessHook::RemoveEarlySpellFromPlayer(RE::FormID spellFormId)
{
    auto* player = RE::PlayerCharacter::GetSingleton();
    if (!player) {
        return;
    }

    // Get the spell
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellFormId);
    if (!spell) {
        logger::warn("SpellEffectivenessHook: Could not find spell {:08X} to remove", spellFormId);
        return;
    }

    // Only remove if player has it and it's in our early-learned set
    auto* hook = GetSingleton();
    if (!hook->IsEarlyLearnedSpell(spellFormId)) {
        return;  // Not an early-learned spell, don't touch it
    }

    if (player->HasSpell(spell)) {
        player->RemoveSpell(spell);
        logger::info("SpellEffectivenessHook: Removed early-learned spell {} ({:08X}) from player",
            spell->GetName(), spellFormId);
    }

    // Remove from tracking but keep progress data
    hook->RemoveEarlyLearnedSpell(spellFormId);

    // Clear display cache
    {
        std::unique_lock<std::shared_mutex> lock(hook->m_mutex);
        hook->m_displayCache.erase(spellFormId);
    }

    // Notify UI
    UIManager::GetSingleton()->UpdateSpellState(
        std::format("0x{:08X}", spellFormId), "available");
}

void SpellEffectivenessHook::CheckAndRegrantSpell(RE::FormID spellFormId)
{
    auto* player = RE::PlayerCharacter::GetSingleton();
    if (!player) {
        return;
    }

    // Get current progress
    auto progress = ProgressionManager::GetSingleton()->GetProgress(spellFormId);
    float progressPercent = progress.progressPercent * 100.0f;

    logger::info("SpellEffectivenessHook: CheckAndRegrantSpell {:08X} - progress {:.1f}%, threshold {:.1f}%",
        spellFormId, progressPercent, m_settings.unlockThreshold);

    // Check if progress is above early learning threshold but below 100% (mastery)
    if (progressPercent >= m_settings.unlockThreshold && progressPercent < 100.0f) {
        // Get the spell
        auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellFormId);
        if (!spell) {
            logger::warn("SpellEffectivenessHook: Could not find spell {:08X} to regrant", spellFormId);
            return;
        }

        bool playerHasSpell = player->HasSpell(spell);
        bool isTracked = IsEarlyLearnedSpell(spellFormId);

        // Add spell if player doesn't have it
        if (!playerHasSpell) {
            player->AddSpell(spell);
            logger::info("SpellEffectivenessHook: Added spell {} ({:08X}) to player",
                spell->GetName(), spellFormId);
        }

        // Always add to early-learned tracking if not already tracked
        // (Needed even if player already has spell from previous session)
        if (!isTracked) {
            AddEarlyLearnedSpell(spellFormId);
            UpdateSpellDisplayCache(spellFormId, spell);

            logger::info("SpellEffectivenessHook: Tracking spell {} ({:08X}) as early-learned - progress {:.1f}%",
                spell->GetName(), spellFormId, progressPercent);

            // Notify UI
            UIManager::GetSingleton()->UpdateSpellState(
                std::format("0x{:08X}", spellFormId), "weakened");
        }
    }
}

// =============================================================================
// SKSE CO-SAVE SERIALIZATION
// =============================================================================

void SpellEffectivenessHook::OnGameSaved(SKSE::SerializationInterface* a_intfc)
{
    std::shared_lock<std::shared_mutex> lock(m_mutex);

    if (!a_intfc->OpenRecord(kEarlyLearnedRecord, 1)) {
        logger::error("SpellEffectivenessHook: Failed to open early-learned record for saving");
        return;
    }

    // Write count
    uint32_t count = static_cast<uint32_t>(m_earlyLearnedSpells.size());
    if (!a_intfc->WriteRecordData(&count, sizeof(count))) {
        logger::error("SpellEffectivenessHook: Failed to write early-learned spell count");
        return;
    }

    // Write each formId
    for (RE::FormID formId : m_earlyLearnedSpells) {
        if (!a_intfc->WriteRecordData(&formId, sizeof(formId))) {
            logger::error("SpellEffectivenessHook: Failed to write early-learned spell {:08X}", formId);
            return;
        }
    }

    logger::info("SpellEffectivenessHook: Saved {} early-learned spells", count);
}

void SpellEffectivenessHook::OnGameLoaded(SKSE::SerializationInterface* a_intfc)
{
    {
        std::unique_lock<std::shared_mutex> lock(m_mutex);

        uint32_t type, version, length;

        while (a_intfc->GetNextRecordInfo(type, version, length)) {
            if (type == kEarlyLearnedRecord) {
                // Read count
                uint32_t count = 0;
                if (!a_intfc->ReadRecordData(&count, sizeof(count))) {
                    logger::error("SpellEffectivenessHook: Failed to read early-learned count");
                    return;
                }

                // Read formIds
                m_earlyLearnedSpells.clear();
                m_earlySpellCount.store(0, std::memory_order_release);
                m_displayCache.clear();  // Clear display cache too

                for (uint32_t i = 0; i < count; ++i) {
                    RE::FormID formId = 0;
                    if (!a_intfc->ReadRecordData(&formId, sizeof(formId))) {
                        logger::error("SpellEffectivenessHook: Failed to read formId at index {}", i);
                        break;
                    }

                    // Resolve formId in case load order changed
                    RE::FormID resolvedId = 0;
                    if (a_intfc->ResolveFormID(formId, resolvedId)) {
                        m_earlyLearnedSpells.insert(resolvedId);
                    } else {
                        logger::warn("SpellEffectivenessHook: Failed to resolve formId {:08X}", formId);
                    }
                }

                logger::info("SpellEffectivenessHook: Loaded {} early-learned spells", m_earlyLearnedSpells.size());
                m_earlySpellCount.store(m_earlyLearnedSpells.size(), std::memory_order_release);
            }
        }
    }

    // Refresh all spell displays after load (outside mutex to avoid deadlock)
    // Use SKSE task interface to delay this until game is fully loaded
    AddTaskToGameThread("RefreshSpellDisplays", [this]() {
        RefreshAllSpellDisplays();
    });
}

void SpellEffectivenessHook::OnRevert([[maybe_unused]] SKSE::SerializationInterface* a_intfc)
{
    std::unique_lock<std::shared_mutex> lock(m_mutex);
    m_earlyLearnedSpells.clear();
    m_earlySpellCount.store(0, std::memory_order_release);
    m_displayCache.clear();
    m_originalSpellNames.clear();
    m_originalEffectDescriptions.clear();
    m_effectSpellTracking.clear();
    logger::info("SpellEffectivenessHook: Cleared all early-learned spell data on revert");
}
