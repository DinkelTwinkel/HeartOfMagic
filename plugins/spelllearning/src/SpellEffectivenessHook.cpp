#include "SpellEffectivenessHook.h"
#include "ProgressionManager.h"
#include "UIManager.h"
#include <regex>
#include <sstream>
#include <chrono>
#include <set>
#include <iomanip>
#include <mutex>
#include <shared_mutex>
#include "RE/M/MagicMenu.h"
#include "RE/G/GFxValue.h"
#include "RE/T/TESDescription.h"

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
// SPELL NAME DISPLAY HOOK
// =============================================================================
// Hooks SpellItem's GetFullName to show "(Learning - X%)" for early-learned spells

namespace {
    // Storage for modified spell names (thread-local to avoid allocation issues)
    thread_local std::string g_modifiedName;
}

struct SpellNameHook
{
    // Hook MagicItem's GetFullName via the TESFullName component
    // 
    // MagicItem layout:
    //   +0x00: TESBoundObject (vtable[0])
    //   +0x30: TESFullName    (vtable[1]) <-- GetFullName is here
    //   +0x40: BGSKeywordForm (vtable[2])
    //
    // When we hook VTABLE_MagicItem[1] (the TESFullName vtable for MagicItem),
    // we get called when GetFullName is invoked on any MagicItem subclass
    // (SpellItem, ScrollItem, EnchantmentItem, etc.)
    //
    // TESFullName::GetFullName is at virtual index 5:
    //   0-3: BaseFormComponent overrides  
    //   4: GetFullNameLength
    //   5: GetFullName
    
    static const char* thunk(RE::TESFullName* a_fullName)
    {
        // Call original first - ALWAYS call this to get base behavior
        const char* originalName = func(a_fullName);
        
        // Early exit for invalid pointers
        if (!a_fullName) {
            return originalName;
        }
        
        // Since we hooked VTABLE_SpellItem[1], we KNOW this is a SpellItem
        // TESFullName is at offset +0x30 in SpellItem (via MagicItem inheritance)
        // Recover the SpellItem pointer by subtracting the offset
        auto* spell = reinterpret_cast<RE::SpellItem*>(
            reinterpret_cast<std::uintptr_t>(a_fullName) - 0x30
        );
        
        // Validate the spell pointer and form type as a safety check
        if (!spell) {
            return originalName;
        }
        
        // Additional safety: verify this is actually a spell form type
        // This prevents crashes if the vtable is shared unexpectedly
        RE::FormType formType = spell->GetFormType();
        if (formType != RE::FormType::Spell) {
            return originalName;
        }
        
        RE::FormID spellId = spell->GetFormID();

        // PERFORMANCE: One-time log to confirm hook is working (thread-safe)
        static std::once_flag s_firstLogFlag;
        std::call_once(s_firstLogFlag, [&]() {
            logger::info("SpellNameHook: Hook active - first spell queried: {} ({:08X})",
                originalName ? originalName : "(null)", spellId);
        });

        auto* hook = SpellEffectivenessHook::GetSingleton();
        if (!hook || !hook->GetSettings().modifyGameDisplay) {
            return originalName;
        }

        // Check if spell is early-learned
        if (!hook->IsEarlyLearnedSpell(spellId)) {
            return originalName;
        }

        // Get the modified name from cache
        g_modifiedName = hook->GetModifiedSpellName(spell);
        if (!g_modifiedName.empty()) {
            // PERFORMANCE: Use trace level for hot path logging
            logger::trace("SpellNameHook: Returning modified name for {:08X}", spellId);
            return g_modifiedName.c_str();
        }
        
        return originalName;
    }
    
    static inline REL::Relocation<decltype(thunk)> func;
    
    static void Install()
    {
        // Hook TESFullName::GetFullName in the SpellItem vtable
        // SpellItem has 6 vtables (see Offsets_VTABLE.h):
        //   [0] = Main (TESBoundObject/MagicItem)
        //   [1] = TESFullName (at offset +0x30)
        //   [2] = BGSKeywordForm
        //   [3] = BGSEquipType
        //   [4] = BGSMenuDisplayObject
        //   [5] = TESDescription
        //
        // TESFullName virtuals (from BaseFormComponent):
        //   0: destructor
        //   1: InitializeDataComponent
        //   2: ClearDataComponent
        //   3: CopyComponent
        //   4: GetFullNameLength
        //   5: GetFullName  <-- we hook this
        REL::Relocation<std::uintptr_t> vtbl{ RE::VTABLE_SpellItem[1] };
        func = vtbl.write_vfunc(0x5, thunk);
        
        logger::info("SpellEffectivenessHook: SpellItem TESFullName::GetFullName hook installed (vtable[1], index 5)");
    }
};

// =============================================================================
// MAGIC MENU UI HOOK (SAFEST APPROACH - NO POINTER ARITHMETIC)
// =============================================================================
// Hooks MagicMenu::PostDisplay to modify spell names in the UI via GFx
// This avoids all pointer arithmetic issues by working at the UI layer

struct MagicMenuUIHook
{
    // Track when menu was last updated to avoid updating every frame
    static inline std::unordered_map<RE::MagicMenu*, std::chrono::steady_clock::time_point> s_lastUpdateTime;
    static inline std::mutex s_updateMutex;
    static constexpr auto UPDATE_INTERVAL_MS = std::chrono::milliseconds(500);  // Update every 500ms
    
    static void thunk(RE::MagicMenu* a_menu)
    {
        // Call original first
        func(a_menu);
        
        // Only modify if menu is valid and display modification is enabled
        if (!a_menu) {
            return;
        }
        
        auto* hook = SpellEffectivenessHook::GetSingleton();
        if (!hook || !hook->GetSettings().modifyGameDisplay) {
            return;
        }
        
        // Throttle updates to avoid performance issues
        auto now = std::chrono::steady_clock::now();
        {
            std::lock_guard<std::mutex> lock(s_updateMutex);
            auto it = s_lastUpdateTime.find(a_menu);
            if (it != s_lastUpdateTime.end()) {
                auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - it->second);
                if (elapsed < UPDATE_INTERVAL_MS) {
                    return;  // Too soon, skip update
                }
            }
            s_lastUpdateTime[a_menu] = now;
        }
        
        // Update spell names in the UI
        UpdateSpellNamesInMenu(a_menu);
    }
    
    static void UpdateSpellNamesInMenu(RE::MagicMenu* a_menu)
    {
        if (!a_menu) {
            return;
        }
        
        auto* uiMovie = a_menu->uiMovie.get();
        if (!uiMovie) {
            return;
        }
        
        auto* hook = SpellEffectivenessHook::GetSingleton();
        if (!hook) {
            return;
        }
        
        // Log that we're attempting update (only first time)
        static bool firstAttempt = true;
        if (firstAttempt) {
            logger::info("MagicMenuUIHook: First update attempt - checking for early-learned spells");
            
            // Log what spells are tracked as early-learned
            auto earlySpells = hook->GetEarlyLearnedSpells();
            logger::info("MagicMenuUIHook: {} early-learned spells tracked", earlySpells.size());
            for (RE::FormID spellId : earlySpells) {
                auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellId);
                logger::info("  - {:08X} '{}'", spellId, spell ? spell->GetName() : "UNKNOWN");
            }
            firstAttempt = false;
        }
        
        // Get root from uiMovie
        RE::GFxValue root;
        uiMovie->GetVariable(&root, "_root");
        if (!root.IsObject()) {
            return;
        }
        
        // Try to find early-learned spells and update their names
        auto earlySpells = hook->GetEarlyLearnedSpells();
        for (RE::FormID spellId : earlySpells) {
            auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellId);
            if (!spell) continue;
            
            std::string modifiedName = hook->GetModifiedSpellName(spell);
            if (modifiedName.empty() || modifiedName == spell->GetName()) {
                continue;
            }
            
            UpdateSpellNameInGFx(root, spellId, modifiedName, spell->GetName());
        }
    }
    
    static void UpdateSpellNameInGFx(RE::GFxValue& root, RE::FormID spellId, const std::string& modifiedName, const char* originalName)
    {
        if (!root.IsObject()) {
            return;
        }
        
        // Log structure exploration (first time only)
        static bool loggedStructure = false;
        if (!loggedStructure) {
            logger::info("MagicMenuUIHook: Exploring GFx structure for MagicMenu...");
            LogGfxStructure(root, "root", 0);
            loggedStructure = true;
        }
        
        // Try different GFx paths that MagicMenu/SkyUI might use
        // The magic menu structure is typically: Menu_mc.itemList.entryList[]
        
        // Path 1: Menu_mc.itemList.entryList[]
        RE::GFxValue menuMc;
        if (root.GetMember("Menu_mc", &menuMc) && menuMc.IsObject()) {
            if (TryUpdateInItemList(menuMc, spellId, modifiedName, originalName)) {
                return;
            }
        }
        
        // Path 2: Direct itemList (vanilla)
        if (TryUpdateInItemList(root, spellId, modifiedName, originalName)) {
            return;
        }
        
        // Path 3: InventoryLists.itemList (SkyUI)
        RE::GFxValue invLists;
        if (root.GetMember("InventoryLists", &invLists) && invLists.IsObject()) {
            if (TryUpdateInItemList(invLists, spellId, modifiedName, originalName)) {
                return;
            }
        }
    }
    
    static bool TryUpdateInItemList(RE::GFxValue& parent, RE::FormID spellId, const std::string& modifiedName, const char* originalName)
    {
        RE::GFxValue itemList;
        if (!parent.GetMember("itemList", &itemList) || !itemList.IsObject()) {
            return false;
        }
        
        RE::GFxValue entryList;
        if (!itemList.GetMember("entryList", &entryList) || !entryList.IsArray()) {
            return false;
        }
        
        std::uint32_t arraySize = entryList.GetArraySize();
        for (std::uint32_t i = 0; i < arraySize; ++i) {
            RE::GFxValue entry;
            if (!entryList.GetElement(i, &entry) || !entry.IsObject()) {
                continue;
            }
            
            // Try to match by formId first
            RE::GFxValue formIdValue;
            if (entry.GetMember("formId", &formIdValue) && formIdValue.IsNumber()) {
                std::uint32_t entryFormId = static_cast<std::uint32_t>(formIdValue.GetNumber());
                if (entryFormId == spellId) {
                    RE::GFxValue nameValue(modifiedName.c_str());
                    entry.SetMember("text", nameValue);
                    
                    // Also try to update description if present
                    TryUpdateDescription(entry, spellId);
                    
                    logger::info("MagicMenuUIHook: Updated spell {:08X} '{}' -> '{}'", spellId, originalName, modifiedName);
                    return true;
                }
            }
            
            // Fallback: match by name
            RE::GFxValue textValue;
            if (entry.GetMember("text", &textValue) && textValue.IsString()) {
                const char* entryText = textValue.GetString();
                if (entryText && strcmp(entryText, originalName) == 0) {
                    RE::GFxValue nameValue(modifiedName.c_str());
                    entry.SetMember("text", nameValue);
                    
                    // Also try to update description
                    TryUpdateDescription(entry, spellId);
                    
                    logger::info("MagicMenuUIHook: Updated spell by name match '{}' -> '{}'", originalName, modifiedName);
                    return true;
                }
            }
        }
        
        return false;
    }
    
    static void TryUpdateDescription(RE::GFxValue& entry, RE::FormID spellId)
    {
        auto* hook = SpellEffectivenessHook::GetSingleton();
        if (!hook->IsEarlyLearnedSpell(spellId)) {
            return;
        }
        
        // Get the spell
        auto* spell = RE::TESForm::LookupByID<RE::SpellItem>(spellId);
        if (!spell) {
            return;
        }
        
        // Get scaled description
        std::string scaledDesc = hook->GetScaledSpellDescription(spell);
        if (scaledDesc.empty()) {
            return;
        }
        
        // Try common description field names
        const char* descFields[] = {"description", "desc", "effectDescription", "info"};
        for (const char* fieldName : descFields) {
            RE::GFxValue descValue;
            if (entry.GetMember(fieldName, &descValue)) {
                RE::GFxValue newDesc(scaledDesc.c_str());
                entry.SetMember(fieldName, newDesc);
                logger::info("MagicMenuUIHook: Updated description field '{}' for spell {:08X}", fieldName, spellId);
                return;
            }
        }
    }
    
    static void LogGfxStructure(RE::GFxValue& obj, const std::string& path, int depth)
    {
        if (depth > 3) return;  // Limit depth to avoid spam
        
        if (!obj.IsObject()) {
            return;
        }
        
        // Try to get some common member names
        const char* members[] = {"Menu_mc", "itemList", "entryList", "InventoryLists", "spellList", "text", "formId"};
        for (const char* member : members) {
            RE::GFxValue child;
            if (obj.GetMember(member, &child)) {
                std::string childPath = path + "." + member;
                if (child.IsObject()) {
                    logger::info("MagicMenuUIHook: Found {} (object)", childPath);
                    LogGfxStructure(child, childPath, depth + 1);
                } else if (child.IsArray()) {
                    logger::info("MagicMenuUIHook: Found {} (array, size={})", childPath, child.GetArraySize());
                } else if (child.IsString()) {
                    logger::info("MagicMenuUIHook: Found {} = '{}'", childPath, child.GetString());
                } else if (child.IsNumber()) {
                    logger::info("MagicMenuUIHook: Found {} = {}", childPath, child.GetNumber());
                }
            }
        }
    }
    
    static inline REL::Relocation<decltype(thunk)> func;
    
    static void Install()
    {
        // Hook MagicMenu::PostDisplay (vtable index 0x6)
        // This is called after the menu is rendered, so we can safely modify GFx values
        REL::Relocation<std::uintptr_t> vtbl{ RE::VTABLE_MagicMenu[0] };
        func = vtbl.write_vfunc(0x6, thunk);
        
        logger::info("SpellEffectivenessHook: MagicMenu::PostDisplay hook installed (UI-level, safe)");
    }
};

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
    if (m_earlyLearnedSpells.empty()) {
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

// =============================================================================
// EARLY-LEARNED SPELL TRACKING
// =============================================================================

void SpellEffectivenessHook::AddEarlyLearnedSpell(RE::FormID formId)
{
    std::unique_lock<std::shared_mutex> lock(m_mutex);
    m_earlyLearnedSpells.insert(formId);
    logger::info("SpellEffectivenessHook: Added spell {:08X} to early-learned set", formId);
}

void SpellEffectivenessHook::RemoveEarlyLearnedSpell(RE::FormID formId)
{
    std::unique_lock<std::shared_mutex> lock(m_mutex);
    m_earlyLearnedSpells.erase(formId);
    logger::info("SpellEffectivenessHook: Removed spell {:08X} from early-learned set (mastered)", formId);
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
    if (m_earlyLearnedSpells.empty()) {
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
        m_earlyLearnedSpells.insert(formId);
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
        
        // Apply the modified description
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
    if (!spell || !m_settings.enabled) {
        return originalMagnitude;
    }
    
    RE::FormID spellId = spell->GetFormID();
    float effectiveness = CalculateEffectiveness(spellId);
    
    return originalMagnitude * effectiveness;
}

// Helper: Scale numbers in a description string that match spell magnitudes
static std::string ScaleDescriptionNumbers(const std::string& description, 
                                           const std::vector<float>& magnitudes,
                                           float effectiveness)
{
    if (description.empty() || effectiveness >= 1.0f) {
        return description;
    }
    
    std::string result = description;
    
    // Build a set of magnitude values to look for (as integers, rounded)
    std::set<int> magValues;
    for (float mag : magnitudes) {
        if (mag > 0.0f) {
            magValues.insert(static_cast<int>(std::round(mag)));
            // Also check for slight variations due to floating point
            magValues.insert(static_cast<int>(mag));
            magValues.insert(static_cast<int>(std::ceil(mag)));
            magValues.insert(static_cast<int>(std::floor(mag)));
        }
    }
    
    // PERFORMANCE: Static regex - compiled once instead of every call
    // Match numbers that are:
    // - Preceded by word boundary or space
    // - Followed by word boundary, space, or common suffixes like "points", "damage", "%"
    static const std::regex numberRegex(R"(\b(\d+(?:\.\d+)?)\b)");
    
    std::string::const_iterator searchStart(result.cbegin());
    std::smatch match;
    std::string newResult;
    size_t lastPos = 0;
    
    while (std::regex_search(searchStart, result.cend(), match, numberRegex)) {
        size_t matchPos = match.position(0) + (searchStart - result.cbegin());
        
        // Add text before the match
        newResult += result.substr(lastPos, matchPos - lastPos);
        
        // Get the matched number
        std::string numStr = match[1].str();
        float numValue = std::stof(numStr);
        int intValue = static_cast<int>(std::round(numValue));
        
        // Check if this number matches a magnitude value
        if (magValues.find(intValue) != magValues.end()) {
            // Scale this number
            float scaledValue = numValue * effectiveness;
            
            // Format: keep decimal if original had decimal, else integer
            if (numStr.find('.') != std::string::npos) {
                std::ostringstream oss;
                oss << std::fixed << std::setprecision(1) << scaledValue;
                newResult += oss.str();
            } else {
                newResult += std::to_string(static_cast<int>(std::round(scaledValue)));
            }
        } else {
            // Not a magnitude - keep original (likely duration or area)
            newResult += numStr;
        }
        
        lastPos = matchPos + match.length(0);
        searchStart = match.suffix().first;
    }
    
    // Add remaining text
    newResult += result.substr(lastPos);
    
    return newResult;
}

std::string SpellEffectivenessHook::GetScaledSpellDescription(RE::SpellItem* spell) const
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
        if (baseEffect->magicItemDescription.data()) {
            effectDesc = baseEffect->magicItemDescription.data();
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
    a_intfc->WriteRecordData(&count, sizeof(count));
    
    // Write each formId
    for (RE::FormID formId : m_earlyLearnedSpells) {
        a_intfc->WriteRecordData(&formId, sizeof(formId));
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
            }
        }
    }
    
    // Refresh all spell displays after load (outside mutex to avoid deadlock)
    // Use SKSE task interface to delay this until game is fully loaded
    SKSE::GetTaskInterface()->AddTask([this]() {
        RefreshAllSpellDisplays();
    });
}

void SpellEffectivenessHook::OnRevert([[maybe_unused]] SKSE::SerializationInterface* a_intfc)
{
    std::unique_lock<std::shared_mutex> lock(m_mutex);
    m_earlyLearnedSpells.clear();
    m_displayCache.clear();
    m_originalSpellNames.clear();
    m_originalEffectDescriptions.clear();
    m_effectSpellTracking.clear();
    logger::info("SpellEffectivenessHook: Cleared all early-learned spell data on revert");
}
