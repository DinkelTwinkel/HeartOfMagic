#include "SpellEffectivenessHook.h"
#include "ProgressionManager.h"

// =============================================================================
// SINGLETON
// =============================================================================

SpellEffectivenessHook* SpellEffectivenessHook::GetSingleton()
{
    static SpellEffectivenessHook singleton;
    return &singleton;
}

// =============================================================================
// HOOK INSTALLATION
// =============================================================================

// =============================================================================
// EFFECTIVENESS HOOK TEMPLATE
// =============================================================================
// ActiveEffect::AdjustForPerks is a virtual function (index 0) that exists on
// every ActiveEffect subclass. Real spell effects dispatch through their own
// subclass vtables — NOT the base ActiveEffect vtable. We must hook each
// subclass vtable individually to intercept actual spell casts.
//
// This template generates a unique hook struct per subclass so each gets its
// own static `func` trampoline (the original function pointer).
// =============================================================================

// Shared player pointer cache — safe because PlayerCharacter::GetSingleton()
// returns the same pointer for the entire game session.
static RE::PlayerCharacter* g_cachedPlayer = nullptr;

template<std::size_t UniqueID>
struct EffectivenessHook
{
    static void thunk(RE::ActiveEffect* a_effect, RE::Actor* a_caster, RE::MagicTarget* a_target)
    {
        // Call original first to let perks apply
        func(a_effect, a_caster, a_target);

        // PERFORMANCE: Early exit for non-player casters (most common case)
        if (!a_caster) {
            return;
        }
        if (!g_cachedPlayer) {
            g_cachedPlayer = RE::PlayerCharacter::GetSingleton();
        }
        if (!g_cachedPlayer || a_caster != g_cachedPlayer) {
            return;
        }

        // Player spell — apply effectiveness scaling
        SpellEffectivenessHook::GetSingleton()->ApplyEffectivenessScalingFast(a_effect);
    }

    static inline REL::Relocation<decltype(thunk)> func;
};

// Helper to install a hook on a specific vtable
template<std::size_t ID>
static void InstallEffectivenessHook(REL::VariantID vtableID, const char* name)
{
    REL::Relocation<std::uintptr_t> vtbl{ vtableID };
    EffectivenessHook<ID>::func = vtbl.write_vfunc(0x0, EffectivenessHook<ID>::thunk);
    logger::info("SpellEffectivenessHook: Hooked AdjustForPerks on {}", name);
}

void SpellEffectivenessHook::Install()
{
    logger::info("SpellEffectivenessHook: Installing hooks on all ActiveEffect subclass vtables...");

    // Each hook needs a unique template ID so it gets its own static trampoline.
    // The ID values are arbitrary — they just need to be unique per instantiation.

    // === Base class (catch-all, unlikely to fire but harmless) ===
    InstallEffectivenessHook<0>(RE::VTABLE_ActiveEffect[0], "ActiveEffect");

    // === HIGH PRIORITY: Common spell effects ===
    InstallEffectivenessHook<1>(RE::VTABLE_ValueModifierEffect[0], "ValueModifierEffect");
    InstallEffectivenessHook<2>(RE::VTABLE_DualValueModifierEffect[0], "DualValueModifierEffect");
    InstallEffectivenessHook<3>(RE::VTABLE_PeakValueModifierEffect[0], "PeakValueModifierEffect");
    InstallEffectivenessHook<4>(RE::VTABLE_ValueAndConditionsEffect[0], "ValueAndConditionsEffect");
    InstallEffectivenessHook<5>(RE::VTABLE_AccumulatingValueModifierEffect[0], "AccumulatingValueModifierEffect");
    InstallEffectivenessHook<6>(RE::VTABLE_TargetValueModifierEffect[0], "TargetValueModifierEffect");
    InstallEffectivenessHook<7>(RE::VTABLE_AbsorbEffect[0], "AbsorbEffect");
    InstallEffectivenessHook<8>(RE::VTABLE_CloakEffect[0], "CloakEffect");
    InstallEffectivenessHook<9>(RE::VTABLE_SummonCreatureEffect[0], "SummonCreatureEffect");
    InstallEffectivenessHook<10>(RE::VTABLE_ReanimateEffect[0], "ReanimateEffect");
    InstallEffectivenessHook<11>(RE::VTABLE_BoundItemEffect[0], "BoundItemEffect");

    // === MEDIUM PRIORITY: Specific spell types ===
    InstallEffectivenessHook<12>(RE::VTABLE_ParalysisEffect[0], "ParalysisEffect");
    InstallEffectivenessHook<13>(RE::VTABLE_InvisibilityEffect[0], "InvisibilityEffect");
    InstallEffectivenessHook<14>(RE::VTABLE_EtherealizationEffect[0], "EtherealizationEffect");
    InstallEffectivenessHook<15>(RE::VTABLE_SlowTimeEffect[0], "SlowTimeEffect");
    InstallEffectivenessHook<16>(RE::VTABLE_TelekinesisEffect[0], "TelekinesisEffect");
    InstallEffectivenessHook<17>(RE::VTABLE_DetectLifeEffect[0], "DetectLifeEffect");
    InstallEffectivenessHook<18>(RE::VTABLE_NightEyeEffect[0], "NightEyeEffect");
    InstallEffectivenessHook<19>(RE::VTABLE_LightEffect[0], "LightEffect");
    InstallEffectivenessHook<20>(RE::VTABLE_CureEffect[0], "CureEffect");
    InstallEffectivenessHook<21>(RE::VTABLE_SpawnHazardEffect[0], "SpawnHazardEffect");
    InstallEffectivenessHook<22>(RE::VTABLE_EnhanceWeaponEffect[0], "EnhanceWeaponEffect");

    // === LOWER PRIORITY: Illusion / NPC / rare effects ===
    InstallEffectivenessHook<23>(RE::VTABLE_CalmEffect[0], "CalmEffect");
    InstallEffectivenessHook<24>(RE::VTABLE_FrenzyEffect[0], "FrenzyEffect");
    InstallEffectivenessHook<25>(RE::VTABLE_DemoralizeEffect[0], "DemoralizeEffect");
    InstallEffectivenessHook<26>(RE::VTABLE_RallyEffect[0], "RallyEffect");
    InstallEffectivenessHook<27>(RE::VTABLE_TurnUndeadEffect[0], "TurnUndeadEffect");
    InstallEffectivenessHook<28>(RE::VTABLE_BanishEffect[0], "BanishEffect");
    InstallEffectivenessHook<29>(RE::VTABLE_CommandEffect[0], "CommandEffect");
    InstallEffectivenessHook<30>(RE::VTABLE_CommandSummonedEffect[0], "CommandSummonedEffect");
    InstallEffectivenessHook<31>(RE::VTABLE_DisarmEffect[0], "DisarmEffect");
    InstallEffectivenessHook<32>(RE::VTABLE_SoulTrapEffect[0], "SoulTrapEffect");
    InstallEffectivenessHook<33>(RE::VTABLE_StaggerEffect[0], "StaggerEffect");
    InstallEffectivenessHook<34>(RE::VTABLE_GrabActorEffect[0], "GrabActorEffect");
    InstallEffectivenessHook<35>(RE::VTABLE_DispelEffect[0], "DispelEffect");
    InstallEffectivenessHook<36>(RE::VTABLE_DarknessEffect[0], "DarknessEffect");
    InstallEffectivenessHook<37>(RE::VTABLE_DisguiseEffect[0], "DisguiseEffect");
    InstallEffectivenessHook<38>(RE::VTABLE_OpenEffect[0], "OpenEffect");
    InstallEffectivenessHook<39>(RE::VTABLE_ScriptEffect[0], "ScriptEffect");
    InstallEffectivenessHook<40>(RE::VTABLE_ConcussionEffect[0], "ConcussionEffect");

    logger::info("SpellEffectivenessHook: Installation complete — 41 vtable hooks installed");
}

// =============================================================================
// DISPLAY HOOKS (NO-OP STUB)
// =============================================================================
// Direct spell name modification is used instead of UI hooks.
// This stub is kept because Main.cpp calls InstallDisplayHooks().

void SpellEffectivenessHook::InstallDisplayHooks()
{
    logger::info("SpellEffectivenessHook: Installing display hooks...");

    // Direct spell name modification approach:
    // We now directly modify SpellItem::fullName when tracking early-learned spells.
    // This works with vanilla UI, SkyUI, and any other UI mod without needing hooks.
    //
    // The name is modified:
    // - When GrantEarlySpell is called (spell becomes early-learned)
    // - When power step changes (via CheckAndUpdatePowerStep)
    // - When game loads (via RefreshAllSpellDisplays)
    //
    // The name is restored:
    // - When spell is mastered (via MarkMastered)

    // No hooks needed - direct modification is safer and more compatible
    logger::info("SpellEffectivenessHook: Using direct spell name modification (no UI hooks needed)");
}

// =============================================================================
// EFFECTIVENESS SCALING - Called from hook
// =============================================================================

// Fast path version - called from hook after player check is already done
void SpellEffectivenessHook::ApplyEffectivenessScalingFast(RE::ActiveEffect* a_effect)
{
    if (!a_effect) {
        return;
    }

    // PERFORMANCE: Check if feature is disabled first (no locks needed)
    if (!m_settings.enabled) {
        return;
    }

    // PERFORMANCE: Fast check if we have ANY early-learned spells at all
    // This avoids mutex lock for the common case of no early spells
    if (m_earlySpellCount.load(std::memory_order_acquire) == 0) {
        return;
    }

    // Get the spell that created this effect
    auto* spell = a_effect->spell;
    if (!spell) {
        return;
    }

    RE::FormID spellId = spell->GetFormID();

    // Check if this spell needs nerfing (uses mutex, but only for player spells)
    if (!NeedsNerfing(spellId)) {
        return;
    }

    // Calculate effectiveness
    float effectiveness = CalculateEffectiveness(spellId);

    // Check for binary effects that need minimum threshold
    auto* baseEffect = a_effect->effect ? a_effect->effect->baseEffect : nullptr;
    if (baseEffect) {
        auto archetype = baseEffect->GetArchetype();
        bool isBinaryEffect = (archetype == RE::EffectArchetype::kParalysis ||
                              archetype == RE::EffectArchetype::kInvisibility ||
                              archetype == RE::EffectArchetype::kEtherealize);

        if (isBinaryEffect) {
            float progressPercent = ProgressionManager::GetSingleton()->GetProgress(spellId).progressPercent * 100.0f;
            if (progressPercent < m_settings.binaryEffectThreshold) {
                a_effect->magnitude = 0.0f;
                logger::trace("SpellEffectivenessHook: Binary effect {:08X} blocked", spellId);
                return;
            }
        }
    }

    // Scale magnitude only — NOT duration.
    // Scaling duration makes many spells unusable (e.g. 12-second armor buff is worthless).
    // Players expect "weaker but full duration" for early-learned spells.
    a_effect->magnitude *= effectiveness;

    // Use trace level logging to reduce overhead (only visible with verbose logging)
    logger::trace("SpellEffectivenessHook: Scaled {:08X} magnitude to {}%", spellId, static_cast<int>(effectiveness * 100));
}

// Legacy version for compatibility (calls fast version after player check)
void SpellEffectivenessHook::ApplyEffectivenessScaling(RE::ActiveEffect* a_effect)
{
    if (!a_effect) {
        return;
    }

    // Check player
    RE::Actor* caster = a_effect->caster.get().get();
    RE::PlayerCharacter* player = RE::PlayerCharacter::GetSingleton();
    if (!caster || caster != player) {
        return;
    }

    ApplyEffectivenessScalingFast(a_effect);
}

// =============================================================================
// SETTINGS MANAGEMENT
// =============================================================================

void SpellEffectivenessHook::SetSettings(const EarlyLearningSettings& settings)
{
    std::unique_lock<std::shared_mutex> lock(m_mutex);
    m_settings = settings;
    logger::info("SpellEffectivenessHook: Settings updated - enabled: {}, unlock: {}%, min: {}%, max: {}%",
        settings.enabled, settings.unlockThreshold, settings.minEffectiveness, settings.maxEffectiveness);
}

SpellEffectivenessHook::EarlyLearningSettings SpellEffectivenessHook::GetSettings() const
{
    std::shared_lock<std::shared_mutex> lock(m_mutex);
    return m_settings;
}

std::vector<SpellEffectivenessHook::PowerStep> SpellEffectivenessHook::GetPowerSteps() const
{
    std::shared_lock<std::shared_mutex> lock(m_mutex);
    return m_powerSteps;
}

int SpellEffectivenessHook::GetNumPowerSteps() const
{
    std::shared_lock<std::shared_mutex> lock(m_mutex);
    return static_cast<int>(m_powerSteps.size());
}

// =============================================================================
// EARLY-LEARNED SPELL TRACKING
// =============================================================================

// =============================================================================
// CENTRALIZED EARLY-SET MUTATION HELPERS
// =============================================================================
// Caller MUST hold unique_lock on m_mutex.

void SpellEffectivenessHook::AddToEarlySet(RE::FormID formId)
{
    auto [it, inserted] = m_earlyLearnedSpells.insert(formId);
    if (inserted) {
        m_earlySpellCount.fetch_add(1, std::memory_order_release);
    }
}

void SpellEffectivenessHook::RemoveFromEarlySet(RE::FormID formId)
{
    size_t erased = m_earlyLearnedSpells.erase(formId);
    if (erased > 0) {
        m_earlySpellCount.fetch_sub(1, std::memory_order_release);
    }
}

void SpellEffectivenessHook::AddEarlyLearnedSpell(RE::FormID formId)
{
    std::unique_lock<std::shared_mutex> lock(m_mutex);
    AddToEarlySet(formId);
}

void SpellEffectivenessHook::RemoveEarlyLearnedSpell(RE::FormID formId)
{
    std::unique_lock<std::shared_mutex> lock(m_mutex);
    RemoveFromEarlySet(formId);
}

bool SpellEffectivenessHook::IsEarlyLearnedSpell(RE::FormID formId) const
{
    // PERFORMANCE: Use shared_lock for read-only access (allows concurrent reads)
    std::shared_lock<std::shared_mutex> lock(m_mutex);
    if (m_earlyLearnedSpells.empty()) {
        return false;
    }
    return m_earlyLearnedSpells.find(formId) != m_earlyLearnedSpells.end();
}

std::unordered_set<RE::FormID> SpellEffectivenessHook::GetEarlyLearnedSpells() const
{
    std::shared_lock<std::shared_mutex> lock(m_mutex);
    return m_earlyLearnedSpells;
}

bool SpellEffectivenessHook::NeedsNerfing(RE::FormID spellFormId) const
{
    // PERFORMANCE: Fast checks first (no locks)
    if (!m_settings.enabled) {
        return false;
    }
    if (m_earlySpellCount.load(std::memory_order_acquire) == 0) {
        return false;
    }
    return IsEarlyLearnedSpell(spellFormId);
}

// =============================================================================
// POWER STEP MANAGEMENT
// =============================================================================

void SpellEffectivenessHook::SetPowerSteps(const std::vector<PowerStep>& steps)
{
    std::unique_lock<std::shared_mutex> lock(m_mutex);

    // Copy steps and ensure Mastered is always at the end
    m_powerSteps.clear();
    for (const auto& step : steps) {
        if (step.progressThreshold < 100.0f) {  // Skip any existing 100% entry
            m_powerSteps.push_back(step);
        }
    }

    // Sort by progress threshold
    std::sort(m_powerSteps.begin(), m_powerSteps.end(),
        [](const PowerStep& a, const PowerStep& b) {
            return a.progressThreshold < b.progressThreshold;
        });

    // Always add Mastered at 100%
    m_powerSteps.push_back({ 100.0f, 1.00f, "Mastered" });

    logger::info("SpellEffectivenessHook: Updated power steps ({} steps)", m_powerSteps.size());
    for (size_t i = 0; i < m_powerSteps.size(); ++i) {
        logger::info("  Step {}: {}% XP -> {}% power ({})",
            i + 1,
            static_cast<int>(m_powerSteps[i].progressThreshold),
            static_cast<int>(m_powerSteps[i].effectiveness * 100),
            m_powerSteps[i].label);
    }
}

// =============================================================================
// POWER STEP CALCULATIONS (Stepped, not continuous)
// =============================================================================

int SpellEffectivenessHook::GetCurrentPowerStep(RE::FormID spellFormId) const
{
    auto progress = ProgressionManager::GetSingleton()->GetProgress(spellFormId);
    float progressPercent = progress.progressPercent * 100.0f;

    std::shared_lock<std::shared_mutex> lock(m_mutex);
    int numSteps = static_cast<int>(m_powerSteps.size());

    // Find which step we're at (highest step where progress >= threshold)
    for (int i = numSteps - 1; i >= 0; --i) {
        if (progressPercent >= m_powerSteps[i].progressThreshold) {
            return i;
        }
    }
    return 0;  // Default to first step
}

float SpellEffectivenessHook::GetSteppedEffectiveness(RE::FormID spellFormId) const
{
    int step = GetCurrentPowerStep(spellFormId);
    std::shared_lock<std::shared_mutex> lock(m_mutex);
    if (step >= 0 && step < static_cast<int>(m_powerSteps.size())) {
        return m_powerSteps[step].effectiveness;
    }
    return 1.0f;  // Full effectiveness if something went wrong
}

std::string SpellEffectivenessHook::GetPowerStepLabel(int step) const
{
    std::shared_lock<std::shared_mutex> lock(m_mutex);
    if (step < 0 || step >= static_cast<int>(m_powerSteps.size())) {
        return "Unknown";
    }
    return m_powerSteps[step].label;
}

float SpellEffectivenessHook::CalculateEffectiveness(RE::FormID spellFormId) const
{
    if (!NeedsNerfing(spellFormId)) {
        return 1.0f;  // Full effectiveness
    }

    // Use stepped effectiveness instead of continuous
    return GetSteppedEffectiveness(spellFormId);
}
