# Spell Learning System - Technical Research

## Overview

This document outlines the technical implementation details for tracking spell progression, including:
- CommonLibSSE-NG APIs for spell cast tracking
- Spell knowledge checking
- ISL (Immersive Spell Learning) mod integration
- XP tracking and persistence

---

## Spell Cast Tracking

### Method 1: TESSpellCastEvent (Recommended)

**Event Type:** `RE::TESSpellCastEvent`

**Structure:**
```cpp
struct TESSpellCastEvent {
    NiPointer<TESObjectREFR> object;  // Actor casting the spell
    FormID                   spell;   // FormID of the spell being cast
};
```

**Registration:**
```cpp
#include "RE/T/TESSpellCastEvent.h"
#include "RE/S/ScriptEventSourceHolder.h"

class SpellCastEventHandler : public RE::BSTEventSink<RE::TESSpellCastEvent> {
public:
    static SpellCastEventHandler* GetSingleton() {
        static SpellCastEventHandler instance;
        return &instance;
    }

    RE::BSEventNotifyControl ProcessEvent(
        const RE::TESSpellCastEvent* event,
        RE::BSTEventSource<RE::TESSpellCastEvent>*) override
    {
        if (!event || !event->object) {
            return RE::BSEventNotifyControl::kContinue;
        }

        auto* actor = event->object->As<RE::Actor>();
        if (!actor) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // Only track player casts
        if (actor != RE::PlayerCharacter::GetSingleton()) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // Get spell from FormID
        auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(event->spell);
        if (!spell) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // Process spell cast for XP tracking
        OnPlayerSpellCast(spell);
        
        return RE::BSEventNotifyControl::kContinue;
    }

private:
    void OnPlayerSpellCast(RE::SpellItem* spell) {
        // Check if spell is a prerequisite for any learning targets
        // Grant XP to relevant learning targets
        // Log for debugging
    }
};

// Register in SKSEPluginLoad or OnDataLoaded:
void RegisterSpellCastTracking() {
    auto* eventHolder = RE::ScriptEventSourceHolder::GetSingleton();
    if (eventHolder) {
        eventHolder->AddEventSink<RE::TESSpellCastEvent>(
            SpellCastEventHandler::GetSingleton()
        );
        logger::info("Spell cast event handler registered");
    }
}
```

**Advantages:**
- Fires when spell is actually cast (not just equipped)
- Works for all spell types (spells, scrolls, shouts)
- Reliable and well-supported in CommonLibSSE-NG
- Low overhead

**Considerations:**
- Event fires for ALL actors, filter for player only
- May fire multiple times for concentration spells (check casting state)
- FormID needs to be resolved to SpellItem*

---

## Spell Hit & Effect Tracking (Bonus XP)

### Method 1: TESHitEvent (Spell Hits)

**Event Type:** `RE::TESHitEvent`

**Structure:**
```cpp
struct TESHitEvent {
    NiPointer<TESObjectREFR> target;      // Actor being hit
    NiPointer<TESObjectREFR> cause;       // Actor causing the hit
    FormID                   source;      // Weapon/Spell FormID
    FormID                   projectile;  // Projectile FormID (for spells)
    Flag                     flags;       // Power attack, sneak, blocked, etc.
};
```

**Registration:**
```cpp
#include "RE/T/TESHitEvent.h"

class SpellHitEventHandler : public RE::BSTEventSink<RE::TESHitEvent> {
public:
    static SpellHitEventHandler* GetSingleton() {
        static SpellHitEventHandler instance;
        return &instance;
    }

    RE::BSEventNotifyControl ProcessEvent(
        const RE::TESHitEvent* event,
        RE::BSTEventSource<RE::TESHitEvent>*) override
    {
        if (!event || !event->target || !event->cause) {
            return RE::BSEventNotifyControl::kContinue;
        }

        auto* attacker = event->cause->As<RE::Actor>();
        auto* target = event->target->As<RE::Actor>();

        // Only track player-initiated hits
        if (!attacker || attacker != RE::PlayerCharacter::GetSingleton()) {
            return RE::BSEventNotifyControl::kContinue;
        }

        if (!target) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // Check if source is a spell (not a weapon)
        auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(event->source);
        if (!spell) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // Process spell hit for bonus XP
        OnPlayerSpellHit(spell, target);
        
        return RE::BSEventNotifyControl::kContinue;
    }

private:
    void OnPlayerSpellHit(RE::SpellItem* spell, RE::Actor* target) {
        // Grant bonus XP for hitting target
        // Check if spell damages or heals for additional bonus
        auto* manager = SpellProgressionManager::GetSingleton();
        manager->GrantSpellHitXP(spell, target);
    }
};

// Register alongside spell cast handler
void RegisterSpellHitTracking() {
    auto* eventHolder = RE::ScriptEventSourceHolder::GetSingleton();
    if (eventHolder) {
        eventHolder->AddEventSink<RE::TESHitEvent>(
            SpellHitEventHandler::GetSingleton()
        );
        logger::info("Spell hit event handler registered");
    }
}
```

**Advantages:**
- Detects when spells actually hit targets
- Can distinguish between player and NPC hits
- Works for all spell delivery types (aimed, touch, etc.)

**Considerations:**
- May fire for blocked hits (check flags)
- Projectile spells may have delay between cast and hit
- Need to track recent casts to match hits to spells

---

### Method 2: TESMagicEffectApplyEvent (Effect Application)

**Event Type:** `RE::TESMagicEffectApplyEvent`

**Structure:**
```cpp
struct TESMagicEffectApplyEvent {
    NiPointer<TESObjectREFR> target;       // Actor receiving effect
    NiPointer<TESObjectREFR> caster;      // Actor casting spell
    FormID                   magicEffect; // MagicEffect FormID
};
```

**Registration:**
```cpp
#include "RE/T/TESMagicEffectApplyEvent.h"

class MagicEffectApplyHandler : public RE::BSTEventSink<RE::TESMagicEffectApplyEvent> {
public:
    static MagicEffectApplyHandler* GetSingleton() {
        static MagicEffectApplyHandler instance;
        return &instance;
    }

    RE::BSEventNotifyControl ProcessEvent(
        const RE::TESMagicEffectApplyEvent* event,
        RE::BSTEventSource<RE::TESMagicEffectApplyEvent>*) override
    {
        if (!event || !event->caster || !event->target) {
            return RE::BSEventNotifyControl::kContinue;
        }

        auto* caster = event->caster->As<RE::Actor>();
        if (!caster || caster != RE::PlayerCharacter::GetSingleton()) {
            return RE::BSEventNotifyControl::kContinue;
        }

        auto* target = event->target->As<RE::Actor>();
        if (!target) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // Get magic effect
        auto* effect = RE::TESForm::LookupByID<RE::EffectSetting>(event->magicEffect);
        if (!effect) {
            return RE::BSEventNotifyControl::kContinue;
        }

        // Find the spell that contains this effect
        auto* spell = FindSpellFromEffect(effect, caster);
        if (spell) {
            OnPlayerEffectApplied(spell, effect, target);
        }
        
        return RE::BSEventNotifyControl::kContinue;
    }

private:
    RE::SpellItem* FindSpellFromEffect(RE::EffectSetting* effect, RE::Actor* caster) {
        // Check recently cast spells to find which one applied this effect
        // This requires tracking recent spell casts
        auto* manager = SpellProgressionManager::GetSingleton();
        return manager->GetRecentSpellCast(effect);
    }

    void OnPlayerEffectApplied(RE::SpellItem* spell, RE::EffectSetting* effect, RE::Actor* target) {
        // Determine effect type (damage, heal, buff, etc.)
        auto archetype = effect->data.archetype;
        bool isDamage = IsDamageEffect(effect);
        bool isHeal = IsHealEffect(effect);
        bool isBuff = IsBuffEffect(effect);

        // Grant appropriate bonus XP
        auto* manager = SpellProgressionManager::GetSingleton();
        if (isDamage) {
            manager->GrantSpellDamageXP(spell, target);
        } else if (isHeal) {
            manager->GrantSpellHealXP(spell, target);
        } else if (isBuff) {
            manager->GrantSpellBuffXP(spell, target);
        } else {
            manager->GrantSpellHitXP(spell, target);  // Generic hit bonus
        }
    }

    bool IsDamageEffect(RE::EffectSetting* effect) {
        // Check archetype for damage effects
        auto archetype = effect->data.archetype;
        return archetype == RE::EffectArchetypes::ArchetypeID::kValueModifier &&
               effect->data.flags.any(RE::EffectSetting::EffectSettingData::Flag::kDetrimental) &&
               effect->data.primaryAV == RE::ActorValue::kHealth;
    }

    bool IsHealEffect(RE::EffectSetting* effect) {
        // Check archetype for restore health effects
        auto archetype = effect->data.archetype;
        return archetype == RE::EffectArchetypes::ArchetypeID::kValueModifier &&
               effect->data.flags.any(RE::EffectSetting::EffectSettingData::Flag::kRecover) &&
               effect->data.primaryAV == RE::ActorValue::kHealth;
    }

    bool IsBuffEffect(RE::EffectSetting* effect) {
        // Check for beneficial effects (not damage/heal)
        auto archetype = effect->data.archetype;
        return !effect->data.flags.any(RE::EffectSetting::EffectSettingData::Flag::kDetrimental) &&
               !effect->data.flags.any(RE::EffectSetting::EffectSettingData::Flag::kRecover);
    }
};
```

**Advantages:**
- Detects when effects are actually applied
- Can identify effect type (damage, heal, buff)
- More precise than hit events for effect-based spells

**Considerations:**
- Need to track recent spell casts to match effects to spells
- Some spells have multiple effects (may fire multiple times)
- Self-targeted spells may need special handling

---

### Combined Tracking Strategy

**Recommended Approach:**
1. **Track spell casts** via `TESSpellCastEvent` - grant base XP
2. **Track spell hits** via `TESHitEvent` - grant hit bonus XP
3. **Track effect application** via `TESMagicEffectApplyEvent` - grant damage/heal/buff bonus XP

**Implementation:**
```cpp
class SpellProgressionManager {
private:
    // Track recent spell casts (to match hits/effects to spells)
    struct RecentCast {
        RE::FormID spellFormID;
        std::chrono::steady_clock::time_point timestamp;
    };
    std::deque<RecentCast> m_recentCasts;
    static constexpr float CAST_WINDOW_SECONDS = 5.0f;  // Match hits within 5 seconds

public:
    void OnSpellCast(RE::SpellItem* spell) {
        // Grant base XP
        GrantBaseXP(spell);

        // Track recent cast
        RecentCast cast;
        cast.spellFormID = spell->GetFormID();
        cast.timestamp = std::chrono::steady_clock::now();
        m_recentCasts.push_back(cast);

        // Clean old casts
        CleanOldCasts();
    }

    void GrantSpellHitXP(RE::SpellItem* spell, RE::Actor* target) {
        // Check if this spell was recently cast
        if (!IsRecentCast(spell)) {
            return;  // Not a player cast, ignore
        }

        // Grant hit bonus XP
        float baseXP = CalculateBaseXP(spell);
        float bonusXP = baseXP * GetConfig().bonusXPOnHit;
        GrantXP(spell, bonusXP);

        logger::debug("Spell {} hit target: +{} bonus XP", 
            spell->GetName(), bonusXP);
    }

    void GrantSpellDamageXP(RE::SpellItem* spell, RE::Actor* target) {
        if (!IsRecentCast(spell)) {
            return;
        }

        float baseXP = CalculateBaseXP(spell);
        float bonusXP = baseXP * GetConfig().bonusXPOnDamage;
        GrantXP(spell, bonusXP);

        logger::debug("Spell {} damaged {}: +{} bonus XP", 
            spell->GetName(), target->GetDisplayFullName(), bonusXP);
    }

    void GrantSpellHealXP(RE::SpellItem* spell, RE::Actor* target) {
        if (!IsRecentCast(spell)) {
            return;
        }

        float baseXP = CalculateBaseXP(spell);
        float bonusXP = baseXP * GetConfig().bonusXPOnHeal;
        GrantXP(spell, bonusXP);

        logger::debug("Spell {} healed {}: +{} bonus XP", 
            spell->GetName(), target->GetDisplayFullName(), bonusXP);
    }

    void GrantSpellBuffXP(RE::SpellItem* spell, RE::Actor* target) {
        if (!IsRecentCast(spell)) {
            return;
        }

        float baseXP = CalculateBaseXP(spell);
        float bonusXP = baseXP * GetConfig().bonusXPOnBuff;
        GrantXP(spell, bonusXP);

        logger::debug("Spell {} buffed {}: +{} bonus XP", 
            spell->GetName(), target->GetDisplayFullName(), bonusXP);
    }

private:
    bool IsRecentCast(RE::SpellItem* spell) {
        auto now = std::chrono::steady_clock::now();
        auto cutoff = now - std::chrono::duration<float>(CAST_WINDOW_SECONDS);

        for (const auto& cast : m_recentCasts) {
            if (cast.spellFormID == spell->GetFormID() && 
                cast.timestamp > cutoff) {
                return true;
            }
        }
        return false;
    }

    void CleanOldCasts() {
        auto now = std::chrono::steady_clock::now();
        auto cutoff = now - std::chrono::duration<float>(CAST_WINDOW_SECONDS);

        m_recentCasts.erase(
            std::remove_if(m_recentCasts.begin(), m_recentCasts.end(),
                [cutoff](const RecentCast& cast) {
                    return cast.timestamp < cutoff;
                }),
            m_recentCasts.end()
        );
    }
};
```

**XP Calculation Example:**
```cpp
float CalculateTotalXP(RE::SpellItem* spell, bool hitTarget, bool damaged, bool healed, bool buffed) {
    float baseXP = 5.0f * GetTierMultiplier(spell);
    
    float totalXP = baseXP;
    
    if (hitTarget) {
        totalXP += baseXP * 0.5f;  // +50% hit bonus
    }
    
    if (damaged) {
        totalXP += baseXP * 1.0f;  // +100% damage bonus
    } else if (healed) {
        totalXP += baseXP * 1.0f;  // +100% heal bonus
    } else if (buffed) {
        totalXP += baseXP * 0.75f;  // +75% buff bonus
    }
    
    return totalXP;
}
```

---

### Method 2: SKSE ActionEvent (Alternative)

**Event Type:** `SKSE::ActionEvent`

**Structure:**
```cpp
struct ActionEvent {
    enum class Type {
        kSpellCast = 1,
        kSpellFire = 2,
        // ...
    };
    RE::Actor* actor;
    RE::TESForm* sourceForm;  // Spell, weapon, etc.
    Slot slot;  // Left, Right, Voice
};
```

**Registration:**
```cpp
#include "SKSE/Events.h"

class ActionEventHandler : public RE::BSTEventSink<SKSE::ActionEvent> {
public:
    RE::BSEventNotifyControl ProcessEvent(
        const SKSE::ActionEvent* event,
        RE::BSTEventSource<SKSE::ActionEvent>*) override
    {
        if (!event || event->actor != RE::PlayerCharacter::GetSingleton()) {
            return RE::BSEventNotifyControl::kContinue;
        }

        if (event->type == SKSE::ActionEvent::Type::kSpellCast ||
            event->type == SKSE::ActionEvent::Type::kSpellFire)
        {
            auto* spell = event->sourceForm->As<RE::SpellItem>();
            if (spell) {
                OnPlayerSpellCast(spell);
            }
        }
        
        return RE::BSEventNotifyControl::kContinue;
    }
};

// Register via SKSE messaging interface
void RegisterActionEvents() {
    auto* messaging = SKSE::GetMessagingInterface();
    messaging->RegisterListener([](SKSE::MessagingInterface::Message* msg) {
        if (msg->type == SKSE::MessagingInterface::kDataLoaded) {
            auto* eventSource = SKSE::GetActionEventSource();
            eventSource->AddEventSink(ActionEventHandler::GetSingleton());
        }
    });
}
```

**Advantages:**
- More granular (can distinguish cast vs fire)
- Part of SKSE interface (may be more stable)

**Disadvantages:**
- Requires SKSE messaging interface
- Less commonly used than TESSpellCastEvent

---

## Spell Knowledge Checking

### Check if Player Knows a Spell

**Method 1: Actor::HasSpell() (Papyrus Native)**

```cpp
bool PlayerHasSpell(RE::SpellItem* spell) {
    auto* player = RE::PlayerCharacter::GetSingleton();
    if (!player || !spell) {
        return false;
    }
    
    // Check base spell list (from actor base)
    auto* base = player->GetActorBase();
    if (base && base->spellList) {
        for (auto& spellData : base->spellList->spells) {
            if (spellData.spell == spell) {
                return true;
            }
        }
    }
    
    // Check runtime-added spells
    auto* addedSpells = player->GetAddedSpells();
    if (addedSpells) {
        for (auto* addedSpell : *addedSpells) {
            if (addedSpell == spell) {
                return true;
            }
        }
    }
    
    return false;
}
```

**Method 2: VisitSpells (More Efficient for Multiple Checks)**

```cpp
class SpellVisitor : public RE::Actor::ForEachSpellVisitor {
public:
    SpellVisitor(RE::SpellItem* target) : m_target(target), m_found(false) {}
    
    RE::BSContainer::ForEachResult operator()(RE::SpellItem* spell) override {
        if (spell == m_target) {
            m_found = true;
            return RE::BSContainer::ForEachResult::kStop;
        }
        return RE::BSContainer::ForEachResult::kContinue;
    }
    
    bool Found() const { return m_found; }
    
private:
    RE::SpellItem* m_target;
    bool m_found;
};

bool PlayerHasSpell(RE::SpellItem* spell) {
    auto* player = RE::PlayerCharacter::GetSingleton();
    if (!player || !spell) {
        return false;
    }
    
    SpellVisitor visitor(spell);
    player->VisitSpells(visitor);
    return visitor.Found();
}
```

---

## ISL (Immersive Spell Learning) Integration

### Mod Analysis

**Mod Name:** Immersive Spell Learning - DESTified  
**Version:** 1.4.5  
**Plugin:** `DEST_ISL.esp`  
**DLL:** `DontEatSpellTomes.dll` (SKSE plugin)

### Key Scripts

**1. DEST_ISL_PlayerSpellLearningScript.psc**
- Main script handling spell tome reading
- Registers for `OnSpellTomeRead` event
- Manages study sessions and progress tracking

**2. DEST_AliasExt.psc**
- Native functions for spell tome read events
- `RegisterForSpellTomeReadEvent()` - Register for events
- `UnregisterForSpellTomeReadEvent()` - Unregister

### Integration Points

#### Option 1: Hook into OnSpellTomeRead Event (Recommended)

**How It Works:**
- ISL uses a native function `RegisterForSpellTomeReadEvent()` 
- This likely hooks into the game's spell tome reading system
- We can register our own handler to detect when player studies spells

**Implementation:**
```cpp
// Check if ISL is installed
bool IsISLInstalled() {
    auto* islPlugin = RE::TESDataHandler::GetSingleton()->LookupModByName("DEST_ISL.esp");
    return islPlugin != nullptr;
}

// Register for spell tome read events (if ISL provides API)
// Note: This may require ISL to expose a native function or we need to hook into their system
```

**Challenges:**
- ISL's native functions may not be exposed to other mods
- May need to hook into their DLL or use Papyrus events

#### Option 2: Monitor Study Progress via Global Variables

**ISL Globals (from script analysis):**
- `hoursStudiedTotal` - Total hours studied for current spell
- `hoursToMaster` - Required hours to learn spell
- `hoursLeft` - Remaining hours needed

**Implementation:**
```cpp
// Poll ISL globals to detect active study sessions
class ISLIntegration {
public:
    static bool IsPlayerStudying() {
        if (!IsISLInstalled()) {
            return false;
        }
        
        // Get ISL globals
        auto* hoursStudied = RE::TESForm::LookupByEditorID<RE::TESGlobal>("DEST_ISL_hoursStudiedTotal");
        auto* hoursToMaster = RE::TESForm::LookupByEditorID<RE::TESGlobal>("DEST_ISL_hoursToMaster");
        
        if (!hoursStudied || !hoursToMaster) {
            return false;
        }
        
        float studied = hoursStudied->value;
        float required = hoursToMaster->value;
        
        // If studying (has progress but not complete)
        return studied > 0.0f && studied < required;
    }
    
    static float GetStudyProgress() {
        auto* hoursStudied = RE::TESForm::LookupByEditorID<RE::TESGlobal>("DEST_ISL_hoursStudiedTotal");
        auto* hoursToMaster = RE::TESForm::LookupByEditorID<RE::TESGlobal>("DEST_ISL_hoursToMaster");
        
        if (!hoursStudied || !hoursToMaster || hoursToMaster->value <= 0.0f) {
            return 0.0f;
        }
        
        return hoursStudied->value / hoursToMaster->value;
    }
    
    static RE::SpellItem* GetCurrentlyStudyingSpell() {
        // ISL stores the spell being studied - need to find how
        // May be in a formlist or stored in a quest alias
        // This requires further investigation of ISL's structure
        return nullptr;
    }
};
```

**Advantages:**
- No need for ISL API
- Works by reading game state
- Simple to implement

**Disadvantages:**
- Requires polling (check every frame/second)
- May miss rapid state changes
- Depends on ISL's internal structure (may break with updates)

#### Option 3: Hook into GameHour Changes During Study

**How ISL Works:**
- When player studies, ISL advances `GameHour` global
- We can detect rapid GameHour changes as indicator of study

**Implementation:**
```cpp
class GameHourMonitor {
private:
    float m_lastGameHour = 0.0f;
    std::chrono::steady_clock::time_point m_lastCheck;
    
public:
    void Update() {
        auto* gameHour = RE::TESForm::LookupByEditorID<RE::TESGlobal>("GameHour");
        if (!gameHour) {
            return;
        }
        
        float currentHour = gameHour->value;
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
            now - m_lastCheck
        ).count();
        
        // If game hour advanced significantly in short time, player is likely studying
        if (elapsed < 5.0 && (currentHour - m_lastGameHour) > 0.1f) {
            // Player may be studying - check ISL state
            if (ISLIntegration::IsPlayerStudying()) {
                // Grant XP based on time advanced
                float hoursStudied = currentHour - m_lastGameHour;
                GrantXPFromStudyTime(hoursStudied);
            }
        }
        
        m_lastGameHour = currentHour;
        m_lastCheck = now;
    }
};
```

**Advantages:**
- Works without ISL API
- Detects study sessions automatically

**Disadvantages:**
- May trigger on normal time passage (waiting, sleeping)
- Less precise than direct integration

#### Option 4: Direct DLL Hook (Advanced)

**If ISL exposes functions:**
```cpp
// Hypothetical - would need ISL to export these
extern "C" {
    bool ISL_IsPlayerStudying();
    float ISL_GetStudyProgress();
    RE::SpellItem* ISL_GetStudyingSpell();
    float ISL_GetHoursStudied();
}
```

**Or hook into ISL's internal functions:**
- Requires reverse engineering ISL's DLL
- More complex but most reliable
- May break with ISL updates

---

## Recommended Integration Strategy

### Phase 1: Basic Spell Cast Tracking

1. **Register TESSpellCastEvent handler**
   - Track all player spell casts
   - Filter to only spells that are prerequisites for learning targets
   - Grant base XP based on configuration
   - Track recent casts for hit/effect matching

2. **Register TESHitEvent handler**
   - Detect when player spells hit targets
   - Grant bonus XP for successful hits
   - Distinguish between spell hits and weapon hits

3. **Register TESMagicEffectApplyEvent handler**
   - Detect when spell effects are applied
   - Identify effect types (damage, heal, buff)
   - Grant appropriate bonus XP based on effect type

2. **Implement XP tracking system**
   - Store per-spell XP progress
   - Check prerequisites before granting XP
   - Handle tier multipliers and direct/indirect prerequisites
   - Track recent spell casts for hit/effect matching
   - Calculate bonus XP for effective usage (hits, damage, heals, buffs)

### Phase 2: ISL Integration (Optional)

1. **Detect ISL installation**
   - Check for `DEST_ISL.esp` in load order
   - Enable ISL integration if found

2. **Monitor study sessions**
   - Use Option 2 (Global Variables) for initial implementation
   - Poll `hoursStudiedTotal` and `hoursToMaster` globals
   - Convert study time to XP

3. **Advanced integration (future)**
   - If ISL provides API, use direct integration
   - Or implement DLL hook for more reliable tracking

### Phase 3: Optimization

1. **Reduce polling overhead**
   - Only check ISL state when player is in study-able locations
   - Cache spell lookups
   - Batch XP updates

2. **Event-driven updates**
   - If possible, register for ISL events directly
   - Reduce polling to event-driven updates

---

## XP Tracking Implementation

### Data Structure

```cpp
struct SpellXPProgress {
    RE::FormID spellFormID;      // Spell being learned
    float currentXP;              // Current XP progress
    float requiredXP;             // Total XP needed
    bool isActiveTarget;          // Is this the active learning target?
    std::chrono::steady_clock::time_point lastUpdate;
};

class SpellProgressionManager {
private:
    std::unordered_map<RE::FormID, SpellXPProgress> m_spellProgress;
    std::unordered_map<RE::FormID, RE::FormID> m_activeTargets;  // School -> Spell
    
public:
    // Grant XP to a spell
    void GrantXP(RE::SpellItem* spell, float xp) {
        auto formID = spell->GetFormID();
        auto it = m_spellProgress.find(formID);
        
        if (it != m_spellProgress.end()) {
            it->second.currentXP += xp;
            it->second.lastUpdate = std::chrono::steady_clock::now();
            
            // Check if spell is learned
            if (it->second.currentXP >= it->second.requiredXP) {
                LearnSpell(spell);
            }
        }
    }
    
    // Set learning target
    void SetLearningTarget(RE::SpellItem* spell, RE::ActorValue school) {
        // Validate prerequisites
        if (!HasPrerequisites(spell)) {
            logger::warn("Cannot set learning target: prerequisites not met");
            return;
        }
        
        // Clear previous target for this school
        auto prevIt = m_activeTargets.find(static_cast<RE::FormID>(school));
        if (prevIt != m_activeTargets.end()) {
            auto prevProgressIt = m_spellProgress.find(prevIt->second);
            if (prevProgressIt != m_spellProgress.end()) {
                prevProgressIt->second.isActiveTarget = false;
            }
        }
        
        // Set new target
        m_activeTargets[static_cast<RE::FormID>(school)] = spell->GetFormID();
        
        // Initialize or update progress
        auto& progress = m_spellProgress[spell->GetFormID()];
        progress.spellFormID = spell->GetFormID();
        progress.isActiveTarget = true;
        if (progress.requiredXP == 0.0f) {
            progress.requiredXP = CalculateRequiredXP(spell);
        }
    }
    
    // Check if spell has prerequisites unlocked
    bool HasPrerequisites(RE::SpellItem* spell) {
        // Get prerequisites from spell tree
        auto* tree = SpellTreeManager::GetSingleton();
        auto prerequisites = tree->GetPrerequisites(spell);
        
        for (auto* prereq : prerequisites) {
            if (!PlayerHasSpell(prereq)) {
                return false;
            }
        }
        return true;
    }
    
    // Calculate required XP based on tier and prerequisites
    float CalculateRequiredXP(RE::SpellItem* spell) {
        // Implementation based on progression design
        // Base XP * (1 + prereqCount * multiplier) * tier multiplier
        return 0.0f;  // Placeholder
    }
    
    // Learn spell (add to player)
    void LearnSpell(RE::SpellItem* spell) {
        auto* player = RE::PlayerCharacter::GetSingleton();
        if (player && !PlayerHasSpell(spell)) {
            player->AddSpell(spell, false);
            logger::info("Player learned spell: {}", spell->GetName());
            
            // Clear from progress tracking
            m_spellProgress.erase(spell->GetFormID());
        }
    }
};
```

---

## Save Game Persistence

### Serialization

```cpp
constexpr uint32_t kSerializationID = 'SPLR';  // Spell Learning

void SaveCallback(SKSE::SerializationInterface* intfc) {
    auto* manager = SpellProgressionManager::GetSingleton();
    
    // Save spell progress
    uint32_t count = static_cast<uint32_t>(manager->m_spellProgress.size());
    intfc->WriteRecord('SPXP', kSerializationID, &count, sizeof(count));
    
    for (const auto& [formID, progress] : manager->m_spellProgress) {
        intfc->WriteRecord('SPRG', kSerializationID, &progress, sizeof(progress));
    }
    
    // Save active targets
    uint32_t targetCount = static_cast<uint32_t>(manager->m_activeTargets.size());
    intfc->WriteRecord('SPTG', kSerializationID, &targetCount, sizeof(targetCount));
    
    for (const auto& [school, spell] : manager->m_activeTargets) {
        intfc->WriteRecord('SPAT', kSerializationID, &school, sizeof(school));
        intfc->WriteRecord('SPAT', kSerializationID, &spell, sizeof(spell));
    }
}

void LoadCallback(SKSE::SerializationInterface* intfc) {
    auto* manager = SpellProgressionManager::GetSingleton();
    manager->m_spellProgress.clear();
    manager->m_activeTargets.clear();
    
    uint32_t type;
    uint32_t version;
    uint32_t length;
    
    while (intfc->GetNextRecordInfo(type, version, length)) {
        switch (type) {
            case 'SPXP': {
                uint32_t count;
                intfc->ReadRecordData(&count, sizeof(count));
                // Read spell progress entries
                break;
            }
            case 'SPRG': {
                SpellXPProgress progress;
                intfc->ReadRecordData(&progress, sizeof(progress));
                manager->m_spellProgress[progress.spellFormID] = progress;
                break;
            }
            // ... handle other record types
        }
    }
}
```

---

## Summary

### Recommended Approach

1. **Spell Cast Tracking:** Use `TESSpellCastEvent` - reliable and well-supported
2. **Spell Hit Tracking:** Use `TESHitEvent` - detect when spells hit targets for bonus XP
3. **Effect Tracking:** Use `TESMagicEffectApplyEvent` - detect damage/heal/buff effects for bonus XP
4. **Spell Knowledge:** Use `Actor::VisitSpells()` for efficient checking
5. **ISL Integration:** Start with global variable polling, upgrade to direct API if available
6. **XP Tracking:** Implement per-spell progress tracking with save game persistence
   - Base XP from casting
   - Bonus XP from hitting targets
   - Bonus XP from damaging enemies
   - Bonus XP from healing allies
   - Bonus XP from applying buffs
7. **Optimization:** Cache lookups, batch updates, reduce polling frequency, track recent casts efficiently

### Next Steps

1. Implement spell cast event handler (`TESSpellCastEvent`)
2. Implement spell hit event handler (`TESHitEvent`) for bonus XP
3. Implement magic effect apply event handler (`TESMagicEffectApplyEvent`) for damage/heal/buff detection
4. Create spell progression manager with recent cast tracking
5. Add ISL detection and basic integration
6. Implement save game serialization
7. Test with ISL mod installed and not installed
8. Test bonus XP system (hits, damage, heals, buffs)
9. Optimize based on performance profiling
