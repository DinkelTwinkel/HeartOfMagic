// =============================================================================
// LEGACY DISPLAY HOOKS (ARCHIVED — NOT CALLED AT RUNTIME)
// =============================================================================
// These implementations were replaced by the "direct spell name modification"
// approach (see SpellEffectivenessHookDisplay.cpp). They are kept here for
// reference. InstallDisplayHooks() in SpellEffectivenessHookCore.cpp is a
// no-op — neither SpellNameHook::Install() nor MagicMenuUIHook::Install()
// is ever called.
// =============================================================================

#include "SpellEffectivenessHook.h"
#include "ProgressionManager.h"
#include "uimanager/UIManager.h"
#include "RE/M/MagicMenu.h"
#include "RE/G/GFxValue.h"
#include "RE/T/TESDescription.h"
#include <regex>
#include <chrono>
#include <set>
#include <iomanip>
#include <mutex>

// =============================================================================
// SPELL NAME DISPLAY HOOK (LEGACY)
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
// MAGIC MENU UI HOOK (LEGACY)
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

// =============================================================================
// SCALE DESCRIPTION NUMBERS (LEGACY)
// =============================================================================
// Regex-based number scaling in description strings. Superseded by the <mag>
// tag replacement approach used in ApplyModifiedDescriptions and
// GetScaledSpellDescription.

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
