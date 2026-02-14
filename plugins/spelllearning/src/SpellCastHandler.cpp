#include "SpellCastHandler.h"
#include "ProgressionManager.h"
#include "SpellEffectivenessHook.h"

SpellCastHandler* SpellCastHandler::GetSingleton()
{
    static SpellCastHandler singleton;
    return &singleton;
}

void SpellCastHandler::Register()
{
    if (m_registered) {
        return;
    }

    auto* eventSource = RE::ScriptEventSourceHolder::GetSingleton();
    if (eventSource) {
        eventSource->AddEventSink(this);
        m_registered = true;
        logger::info("SpellCastHandler: Registered for spell cast events");
    } else {
        logger::error("SpellCastHandler: Failed to get event source holder");
    }
}

void SpellCastHandler::Unregister()
{
    if (!m_registered) {
        return;
    }

    auto* eventSource = RE::ScriptEventSourceHolder::GetSingleton();
    if (eventSource) {
        eventSource->RemoveEventSink(this);
        m_registered = false;
        logger::info("SpellCastHandler: Unregistered from spell cast events");
    }
}

RE::BSEventNotifyControl SpellCastHandler::ProcessEvent(
    const RE::TESSpellCastEvent* a_event,
    RE::BSTEventSource<RE::TESSpellCastEvent>*)
{
    if (!a_event) {
        return RE::BSEventNotifyControl::kContinue;
    }

    // PERFORMANCE: Check player first (most common early exit for NPC casts)
    auto* player = RE::PlayerCharacter::GetSingleton();
    if (!player) {
        return RE::BSEventNotifyControl::kContinue;
    }
    
    // PERFORMANCE: Compare object handles directly before dereferencing
    auto casterHandle = a_event->object;
    if (!casterHandle || casterHandle.get() != player) {
        return RE::BSEventNotifyControl::kContinue;
    }

    // Get the spell that was cast
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(a_event->spell);
    if (!spell) {
        return RE::BSEventNotifyControl::kContinue;
    }

    // Filter out non-spell items (powers, lesser powers, abilities, etc.)
    auto spellType = spell->GetSpellType();
    if (spellType != RE::MagicSystem::SpellType::kSpell) {
        return RE::BSEventNotifyControl::kContinue;
    }

    // Get spell school
    auto* effect = spell->GetCostliestEffectItem();
    if (!effect || !effect->baseEffect) {
        return RE::BSEventNotifyControl::kContinue;
    }

    auto school = effect->baseEffect->GetMagickSkill();
    std::string schoolName;
    switch (school) {
        case RE::ActorValue::kAlteration:  schoolName = "Alteration"; break;
        case RE::ActorValue::kConjuration: schoolName = "Conjuration"; break;
        case RE::ActorValue::kDestruction: schoolName = "Destruction"; break;
        case RE::ActorValue::kIllusion:    schoolName = "Illusion"; break;
        case RE::ActorValue::kRestoration: schoolName = "Restoration"; break;
        default: return RE::BSEventNotifyControl::kContinue;
    }

    // Calculate XP based on magicka cost (higher cost = more XP)
    float magickaCost = spell->CalculateMagickaCost(player);
    float xpGain = (std::max)(1.0f, magickaCost / 10.0f);  // Parentheses to avoid Windows max macro

    // PERFORMANCE: Use trace level for frequent events (only visible with verbose logging)
    logger::trace("SpellCastHandler: Player cast {} ({:08X}) - school: {}, cost: {:.1f}, XP: {:.1f}",
        spell->GetName(), 
        spell->GetFormID(),
        schoolName,
        magickaCost,
        xpGain);

    // Grant XP to learning targets in this school
    ProgressionManager::GetSingleton()->OnSpellCast(schoolName, spell->GetFormID(), xpGain);

    // =========================================================================
    // THROTTLED WEAKENED SPELL NOTIFICATION
    // Show "Weakened spell at X% effectiveness" at configurable interval when casting early-learned spells
    // =========================================================================
    if (m_weakenedNotificationsEnabled) {
        auto* effectivenessHook = SpellEffectivenessHook::GetSingleton();
        RE::FormID spellFormId = spell->GetFormID();
        
        if (effectivenessHook && effectivenessHook->IsEarlyLearnedSpell(spellFormId)) {
            // Accumulate XP gained
            m_accumulatedXP += xpGain;
            
            auto now = std::chrono::steady_clock::now();
            auto elapsed = std::chrono::duration_cast<std::chrono::duration<float>>(now - m_lastWeakenedNotifTime).count();
            
            // Show notification at configured interval (or on first cast of this spell)
            if (elapsed >= m_notificationIntervalSeconds || m_lastNotifiedSpell != spellFormId) {
                float effectiveness = effectivenessHook->CalculateEffectiveness(spellFormId);
                int effectivenessPercent = static_cast<int>(effectiveness * 100);
                
                char notification[256];
                if (m_accumulatedXP > 0.1f) {
                    snprintf(notification, sizeof(notification), 
                        "%s operating at %d%% power (+%.1f XP)", 
                        spell->GetName(), effectivenessPercent, m_accumulatedXP);
                } else {
                    snprintf(notification, sizeof(notification), 
                        "%s operating at %d%% power", 
                        spell->GetName(), effectivenessPercent);
                }
                RE::SendHUDMessage::ShowHUDMessage(notification);
                
                // Reset tracking
                m_lastWeakenedNotifTime = now;
                m_accumulatedXP = 0.0f;
                m_lastNotifiedSpell = spellFormId;
            }
        }
    }

    return RE::BSEventNotifyControl::kContinue;
}
