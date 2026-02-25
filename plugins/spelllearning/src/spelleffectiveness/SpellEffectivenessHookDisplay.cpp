#include "SpellEffectivenessHook.h"
#include <sstream>

// =============================================================================
// GAME THREAD INVARIANT
// =============================================================================
// All functions in this file that read or write RE game object fields
// (RE::SpellItem::fullName, RE::EffectSetting::magicItemDescription) MUST run
// on the Skyrim game thread. These fields are NOT protected by m_mutex.
//
// m_mutex protects only our internal data structures (m_displayCache,
// m_originalSpellNames, m_originalEffectDescriptions, m_effectSpellTracking).
//
// Game-thread execution is guaranteed by the call chain:
//   - RefreshAllSpellDisplays()      ← SKSE serialization callback (game thread)
//   - CheckAndUpdatePowerStep()      ← ProgressionManager update (game thread)
//   - GrantEarlySpell()              ← SpellCastHandler / SpellTomeHook (game thread)
//   - MarkMastered()                 ← ProgressionManager (game thread)
//   - UIManager callbacks            ← marshalled via AddTaskToGameThread()
//
// DO NOT call these functions from background threads. Use AddTaskToGameThread()
// to marshal calls if needed (see ThreadUtils.h).
// =============================================================================

// =============================================================================
// DISPLAY CACHE MANAGEMENT
// =============================================================================

std::string SpellEffectivenessHook::GetModifiedSpellName(RE::SpellItem* spell)
{
    if (!spell) {
        return "";
    }

    RE::FormID spellId = spell->GetFormID();

    // Check if not early-learned - return original name
    if (!IsEarlyLearnedSpell(spellId)) {
        return spell->GetName();
    }

    // Check cache (read-only)
    {
        std::shared_lock<std::shared_mutex> lock(m_mutex);
        auto it = m_displayCache.find(spellId);
        if (it != m_displayCache.end() && !it->second.modifiedName.empty()) {
            return it->second.modifiedName;
        }
    }

    // Build modified name - update cache
    UpdateSpellDisplayCache(spellId, spell);

    std::shared_lock<std::shared_mutex> lock(m_mutex);
    auto it = m_displayCache.find(spellId);
    if (it != m_displayCache.end()) {
        return it->second.modifiedName;
    }
    return "";
}

void SpellEffectivenessHook::UpdateSpellDisplayCache(RE::FormID spellFormId, RE::SpellItem* spell)
{
    if (!spell) {
        spell = RE::TESForm::LookupByID<RE::SpellItem>(spellFormId);
    }
    if (!spell) {
        return;
    }

    int step = GetCurrentPowerStep(spellFormId);

    float effectiveness = 1.0f;
    std::string stepLabel = "Unknown";
    int numSteps = 0;

    // Get step info under lock (read-only)
    {
        std::shared_lock<std::shared_mutex> lock(m_mutex);
        numSteps = static_cast<int>(m_powerSteps.size());
        if (step >= 0 && step < numSteps) {
            effectiveness = m_powerSteps[step].effectiveness;
            stepLabel = m_powerSteps[step].label;
        }
    }

    int powerPercent = static_cast<int>(effectiveness * 100);

    // CRITICAL: Get or store the ORIGINAL name (before any modifications)
    // This prevents stacking modifications like "Spell (Learning - 20%) (Learning - 35%)"
    std::string originalName;
    {
        std::unique_lock<std::shared_mutex> lock(m_mutex);
        auto it = m_originalSpellNames.find(spellFormId);
        if (it != m_originalSpellNames.end()) {
            // Use stored original name
            originalName = it->second;
        } else {
            // First time seeing this spell - store its current name as original
            originalName = spell->GetName();
            m_originalSpellNames[spellFormId] = originalName;
            logger::info("SpellEffectivenessHook: Stored original name for {:08X}: '{}'",
                spellFormId, originalName);
        }
    }

    // Build modified name: "Spell Name (Learning - 35%)"
    std::string modifiedName;
    if (step < numSteps - 1) {  // Not mastered (last step is always 100%)
        modifiedName = std::format("{} (Learning - {}%)", originalName, powerPercent);
    } else {
        modifiedName = originalName;  // Mastered - no tag
    }

    // Build modified description with scaled values
    std::string modifiedDesc = GetScaledSpellDescription(spell);

    // Update cache (write operation)
    {
        std::unique_lock<std::shared_mutex> lock(m_mutex);
        SpellDisplayCache& cache = m_displayCache[spellFormId];
        cache.originalName = originalName;
        cache.modifiedName = modifiedName;
        cache.modifiedDescription = modifiedDesc;
        cache.currentStep = step;
        cache.cachedEffectiveness = effectiveness;
    }

    logger::info("SpellEffectivenessHook: Updated display cache for {:08X} - {} (step {}: {}%)",
        spellFormId, modifiedName, step, powerPercent);
}

bool SpellEffectivenessHook::CheckAndUpdatePowerStep(RE::FormID spellFormId)
{
    if (!IsEarlyLearnedSpell(spellFormId)) {
        return false;
    }

    int currentStep = GetCurrentPowerStep(spellFormId);
    int numSteps = GetNumPowerSteps();

    // Check against cached step (read-only)
    {
        std::shared_lock<std::shared_mutex> lock(m_mutex);
        auto it = m_displayCache.find(spellFormId);
        if (it != m_displayCache.end()) {
            if (it->second.currentStep == currentStep) {
                return false;  // No change
            }
        }
    }

    // Step changed - update cache and apply new name/description
    UpdateSpellDisplayCache(spellFormId);
    ApplyModifiedSpellName(spellFormId);
    ApplyModifiedDescriptions(spellFormId);

    // Check if mastered (last step = 100%)
    if (currentStep == numSteps - 1) {
        MarkMastered(spellFormId);
    }

    return true;  // Step changed
}

void SpellEffectivenessHook::RefreshAllSpellDisplays()
{
    logger::info("SpellEffectivenessHook: Refreshing all spell displays after load...");

    std::unordered_set<RE::FormID> spellsCopy;
    {
        std::shared_lock<std::shared_mutex> lock(m_mutex);
        spellsCopy = m_earlyLearnedSpells;
    }

    for (RE::FormID spellId : spellsCopy) {
        auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellId);
        if (spell) {
            UpdateSpellDisplayCache(spellId, spell);

            // Apply the modified name and description to the actual spell
            ApplyModifiedSpellName(spellId);
            ApplyModifiedDescriptions(spellId);

            // Verify player still has the spell
            auto* player = RE::PlayerCharacter::GetSingleton();
            if (player && !player->HasSpell(spell)) {
                // Re-grant it
                player->AddSpell(spell);
                logger::info("SpellEffectivenessHook: Re-granted spell {} on load", spell->GetName());
            }
        }
    }

    logger::info("SpellEffectivenessHook: Refreshed {} spell displays", spellsCopy.size());
}

// =============================================================================
// DIRECT SPELL NAME MODIFICATION
// =============================================================================
// Directly modify the spell's internal TESFullName to show learning status
// This works with vanilla UI, SkyUI, and any other UI mod

void SpellEffectivenessHook::ApplyModifiedSpellName(RE::FormID spellFormId)
{
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellFormId);
    if (!spell) {
        return;
    }

    // Make sure we have the display cache updated (read-only)
    std::string modifiedName;
    std::string originalName;
    {
        std::shared_lock<std::shared_mutex> lock(m_mutex);
        auto it = m_displayCache.find(spellFormId);
        if (it == m_displayCache.end()) {
            return;  // No cache entry
        }
        modifiedName = it->second.modifiedName;
        originalName = it->second.originalName;
    }

    if (modifiedName.empty() || modifiedName == originalName) {
        return;  // No modification needed
    }

    // Directly set the spell's full name
    // TESFullName is a component of MagicItem (parent of SpellItem)
    spell->fullName = modifiedName;

    logger::info("SpellEffectivenessHook: Applied modified name to spell {:08X}: '{}'",
        spellFormId, modifiedName);
}

void SpellEffectivenessHook::RestoreOriginalSpellName(RE::FormID spellFormId)
{
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellFormId);
    if (!spell) {
        return;
    }

    // Get original name from storage (more reliable than cache)
    std::string originalName;
    {
        std::unique_lock<std::shared_mutex> lock(m_mutex);

        // First try the dedicated original name storage
        auto origIt = m_originalSpellNames.find(spellFormId);
        if (origIt != m_originalSpellNames.end()) {
            originalName = origIt->second;
            // Remove from storage since spell is mastered
            m_originalSpellNames.erase(origIt);
        } else {
            // Fallback to cache
            auto it = m_displayCache.find(spellFormId);
            if (it != m_displayCache.end()) {
                originalName = it->second.originalName;
            }
        }
    }

    if (originalName.empty()) {
        return;
    }

    // Restore the original name
    spell->fullName = originalName;

    logger::info("SpellEffectivenessHook: Restored original name for spell {:08X}: '{}'",
        spellFormId, originalName);
}

void SpellEffectivenessHook::RefreshAllSpellNames()
{
    logger::info("SpellEffectivenessHook: Refreshing all spell names and descriptions...");

    std::unordered_set<RE::FormID> spellsCopy;
    {
        std::shared_lock<std::shared_mutex> lock(m_mutex);
        spellsCopy = m_earlyLearnedSpells;
    }

    for (RE::FormID spellId : spellsCopy) {
        UpdateSpellDisplayCache(spellId);
        ApplyModifiedSpellName(spellId);
        ApplyModifiedDescriptions(spellId);
    }

    logger::info("SpellEffectivenessHook: Refreshed {} spell names/descriptions", spellsCopy.size());
}

// =============================================================================
// DIRECT DESCRIPTION MODIFICATION
// =============================================================================
// Directly modifies EffectSetting::magicItemDescription to show scaled values.
// We track which effects are used by early-learned spells and modify their
// description templates to show scaled magnitude/duration values.
//
// WARNING: This modifies shared effect data. Multiple spells using the same
// effect will all show the modified description. We track usage counts to
// only restore when the last spell using an effect is mastered.

void SpellEffectivenessHook::ApplyModifiedDescriptions(RE::FormID spellFormId)
{
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellFormId);
    if (!spell) {
        return;
    }

    float effectiveness = CalculateEffectiveness(spellFormId);
    if (effectiveness >= 1.0f) {
        return;  // Mastered - no modification needed
    }

    int powerPercent = static_cast<int>(effectiveness * 100);

    for (auto* effect : spell->effects) {
        if (!effect || !effect->baseEffect) continue;

        auto* baseEffect = effect->baseEffect;
        RE::FormID effectId = baseEffect->GetFormID();

        // Store original description and track spell-effect relationship (write operation)
        bool alreadyTrackedForThisSpell = false;
        {
            std::unique_lock<std::shared_mutex> lock(m_mutex);

            // Check if this spell has already been tracked for this effect
            // This prevents double-counting when ApplyModifiedDescriptions is called multiple times
            auto& spellSet = m_effectSpellTracking[effectId];
            if (spellSet.find(spellFormId) != spellSet.end()) {
                alreadyTrackedForThisSpell = true;
            } else {
                // First time this spell is using this effect - track it
                spellSet.insert(spellFormId);

                // Store original description if not already stored
                // (game-thread read of baseEffect->magicItemDescription — see invariant at top of file)
                if (m_originalEffectDescriptions.find(effectId) == m_originalEffectDescriptions.end()) {
                    if (baseEffect->magicItemDescription.data()) {
                        m_originalEffectDescriptions[effectId] = baseEffect->magicItemDescription.data();
                        logger::info("SpellEffectivenessHook: Stored original description for effect {:08X}: '{}'",
                            effectId, m_originalEffectDescriptions[effectId]);
                    }
                }

                logger::trace("SpellEffectivenessHook: Tracking spell {:08X} for effect {:08X} (total: {})",
                    spellFormId, effectId, spellSet.size());
            }
        }

        // Get original values from this specific effect item
        float magnitude = effect->GetMagnitude();

        // Only magnitude is scaled — duration stays full (handled by game engine)
        float scaledMag = magnitude * effectiveness;

        // Get original description template (read-only)
        std::string originalDesc;
        {
            std::shared_lock<std::shared_mutex> lock(m_mutex);
            auto it = m_originalEffectDescriptions.find(effectId);
            if (it != m_originalEffectDescriptions.end()) {
                originalDesc = it->second;
            }
        }

        if (originalDesc.empty()) {
            continue;
        }

        // Create modified description by replacing ONLY <mag> with scaled values.
        // Leave <dur> and <area> tags intact so the game engine substitutes them
        // natively (preserving its own formatting like "1 minute" etc).
        std::string modifiedDesc = originalDesc;

        // Replace <mag> with scaled magnitude
        size_t pos = modifiedDesc.find("<mag>");
        while (pos != std::string::npos) {
            modifiedDesc.replace(pos, 5, std::to_string(static_cast<int>(scaledMag)));
            pos = modifiedDesc.find("<mag>");
        }

        // Prepend power indicator
        modifiedDesc = "[" + std::to_string(powerPercent) + "% Power] " + modifiedDesc;

        // Apply the modified description (game-thread only — not guarded by m_mutex)
        baseEffect->magicItemDescription = modifiedDesc;

        logger::info("SpellEffectivenessHook: Modified description for effect {:08X}: '{}'",
            effectId, modifiedDesc);
    }
}

void SpellEffectivenessHook::RestoreOriginalDescriptions(RE::FormID spellFormId)
{
    auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellFormId);
    if (!spell) {
        return;
    }

    for (auto* effect : spell->effects) {
        if (!effect || !effect->baseEffect) continue;

        auto* baseEffect = effect->baseEffect;
        RE::FormID effectId = baseEffect->GetFormID();

        std::string originalDesc;
        bool shouldRestore = false;

        {
            std::unique_lock<std::shared_mutex> lock(m_mutex);

            // Remove this spell from the effect's tracking set
            auto trackIt = m_effectSpellTracking.find(effectId);
            if (trackIt != m_effectSpellTracking.end()) {
                trackIt->second.erase(spellFormId);

                logger::trace("SpellEffectivenessHook: Untracking spell {:08X} from effect {:08X} (remaining: {})",
                    spellFormId, effectId, trackIt->second.size());

                if (trackIt->second.empty()) {
                    // Last spell using this effect is mastered - restore original
                    shouldRestore = true;
                    m_effectSpellTracking.erase(trackIt);
                }
            }

            if (shouldRestore) {
                auto descIt = m_originalEffectDescriptions.find(effectId);
                if (descIt != m_originalEffectDescriptions.end()) {
                    originalDesc = descIt->second;
                    m_originalEffectDescriptions.erase(descIt);
                }
            }
        }

        if (shouldRestore && !originalDesc.empty()) {
            // Game-thread only — not guarded by m_mutex
            baseEffect->magicItemDescription = originalDesc;
            logger::info("SpellEffectivenessHook: Restored original description for effect {:08X}: '{}'",
                effectId, originalDesc);
        }
    }
}

void SpellEffectivenessHook::RefreshAllDescriptions()
{
    logger::info("SpellEffectivenessHook: Refreshing all spell descriptions...");

    std::unordered_set<RE::FormID> spellsCopy;
    {
        std::shared_lock<std::shared_mutex> lock(m_mutex);
        spellsCopy = m_earlyLearnedSpells;
    }

    for (RE::FormID spellId : spellsCopy) {
        ApplyModifiedDescriptions(spellId);
    }

    logger::info("SpellEffectivenessHook: Refreshed {} spell descriptions", spellsCopy.size());
}

// =============================================================================
// DESCRIPTION SCALING HELPERS
// =============================================================================
// Helper functions for generating scaled description text.

float SpellEffectivenessHook::GetScaledMagnitude(RE::SpellItem* spell, float originalMagnitude) const
{
    if (!spell || !m_settingsEnabled.load(std::memory_order_acquire)) {
        return originalMagnitude;
    }

    RE::FormID spellId = spell->GetFormID();
    float effectiveness = CalculateEffectiveness(spellId);

    return originalMagnitude * effectiveness;
}

std::string SpellEffectivenessHook::GetScaledSpellDescription(RE::SpellItem* spell)
{
    if (!spell) {
        return "";
    }

    RE::FormID spellId = spell->GetFormID();
    float effectiveness = CalculateEffectiveness(spellId);

    // Get description from the spell's effects
    if (spell->effects.empty()) {
        return "";
    }

    // Collect all magnitude values from this spell
    std::vector<float> magnitudes;
    for (auto* effect : spell->effects) {
        if (effect) {
            float mag = effect->GetMagnitude();
            if (mag > 0.0f) {
                magnitudes.push_back(mag);
            }
        }
    }

    // Build the raw description text (what the game would show)
    // We'll simulate what the game does: for each effect, get its description
    // and substitute <mag>, <dur>, <area> with actual values
    std::stringstream descStream;
    bool isWeakened = (effectiveness < 1.0f);
    bool firstEffect = true;

    for (auto* effect : spell->effects) {
        if (!effect || !effect->baseEffect) continue;

        auto* baseEffect = effect->baseEffect;

        // Get the effect's description template
        std::string effectDesc;
        // Prefer original stored description over potentially-modified game data
        RE::FormID effectId = baseEffect->GetFormID();
        {
            std::shared_lock<std::shared_mutex> lock(m_mutex);
            auto origIt = m_originalEffectDescriptions.find(effectId);
            if (origIt != m_originalEffectDescriptions.end()) {
                effectDesc = origIt->second;
            }
        }
        if (effectDesc.empty()) {
            // Store original description under exclusive lock on first encounter.
            // m_mutex protects m_originalEffectDescriptions (our internal cache).
            // The read of baseEffect->magicItemDescription.data() is safe because
            // this function runs on the game thread (see invariant at top of file).
            if (baseEffect->magicItemDescription.data()) {
                std::unique_lock<std::shared_mutex> lock(m_mutex);
                auto origIt = m_originalEffectDescriptions.find(effectId);
                if (origIt != m_originalEffectDescriptions.end()) {
                    effectDesc = origIt->second;
                } else {
                    effectDesc = baseEffect->magicItemDescription.data();
                    m_originalEffectDescriptions[effectId] = effectDesc;
                }
            }
        }

        if (effectDesc.empty()) {
            // Fallback: use effect name
            const char* effectName = baseEffect->GetFullName();
            if (effectName && effectName[0]) {
                effectDesc = effectName;
            }
        }

        if (!effectDesc.empty()) {
            // Substitute only <mag> — leave <dur> and <area> for the game engine
            float magnitude = effect->GetMagnitude();

            // Scale magnitude for display
            float displayMag = isWeakened ? magnitude * effectiveness : magnitude;

            // Replace <mag> with scaled value
            size_t magPos = effectDesc.find("<mag>");
            while (magPos != std::string::npos) {
                effectDesc.replace(magPos, 5, std::to_string(static_cast<int>(displayMag)));
                magPos = effectDesc.find("<mag>");
            }

            if (!firstEffect) {
                descStream << " ";
            }
            firstEffect = false;
            descStream << effectDesc;
        }
    }

    std::string result = descStream.str();

    // Add power indicator if weakened
    if (isWeakened && !result.empty()) {
        result = "[" + std::to_string(static_cast<int>(effectiveness * 100)) + "% Power] " + result;
    }

    return result;
}
