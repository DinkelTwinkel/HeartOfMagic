#include "SpellTomeHook.h"
#include "ProgressionManager.h"
#include "SpellEffectivenessHook.h"
#include "UIManager.h"
#include "ISLIntegration.h"

// Xbyak for assembly code generation
#include <xbyak/xbyak.h>

#include <mutex>

// =============================================================================
// Offset for TESObjectBOOK::ProcessBook
// =============================================================================
// This is the function that handles reading books, including spell tomes.
// We patch at the point where it would teach the spell and consume the book.
// Based on DEST by Exit-9B

namespace
{
    // Function ID for TESObjectBOOK::Read (aka ProcessBook)
    // SE (1.5.97):    ID 17439
    // AE (1.6.317+):  ID 17842
    // Source: CommonLibSSE-NG src/RE/T/TESObjectBOOK.cpp — RELOCATION_ID(17439, 17842)
    constexpr REL::RelocationID ProcessBookID(17439, 17842);

    // Size of code we're replacing (must NOP this much)
    constexpr std::size_t PatchSize = 0x56;

    // Scan the function body for the patch site pattern.
    // We look for: 48 8B 0D ?? ?? ?? ?? E8 ?? ?? ?? ??
    //   (mov rcx, [rip+disp32]; call rel32)
    // This is the instruction sequence right before the spell-teach call,
    // and it's the same signature across SE 1.5.97, AE 1.6.318, and AE 1.6.1170+.
    // Returns offset from function start, or -1 on failure.
    inline std::ptrdiff_t ScanForPatchSite(std::uintptr_t funcBase)
    {
        // Pattern: mov rcx,[rip+??] ; call ??
        // Bytes:   48 8B 0D xx xx xx xx  E8 xx xx xx xx
        // This pattern occurs at the point where PlayerCharacter singleton is
        // loaded into rcx before AddSpell is called. It's deep into the function
        // body (SE: +0xE8, AE 1.6.318: +0x11D) so we skip the first 0x80 bytes
        // to avoid matching earlier mov rcx,[rip+??] ; call ?? sequences in the
        // function prologue / branch-condition checks.
        constexpr std::size_t kScanStart = 0x80;   // skip prologue
        constexpr std::size_t kScanEnd   = 0x200;  // search up to 512 bytes

        const auto* bytes = reinterpret_cast<const std::uint8_t*>(funcBase);

        // Collect all matches; pick the LAST one in range (closest to the spell-teach site)
        std::ptrdiff_t lastMatch = -1;
        for (std::size_t i = kScanStart; i + 12 <= kScanEnd; ++i) {
            if (bytes[i]     == 0x48 &&
                bytes[i + 1] == 0x8B &&
                bytes[i + 2] == 0x0D &&
                bytes[i + 7] == 0xE8) {
                lastMatch = static_cast<std::ptrdiff_t>(i);
            }
        }
        return lastMatch;
    }

    // After the patch site, find the end of the block we replace.
    // We search forward from the patch site for the instruction that
    // follows the spell-teach region — typically a test/jmp or mov rsi sequence.
    // The "jump offset" is the distance from patch site to just past the NOPd region.
    // We scan for the first "48 83 C4" (add rsp, imm8) or "48 8D" (lea) after
    // the patch site as the resume point. If not found, fall back to known offsets.
    inline std::ptrdiff_t FindJumpOffset(std::uintptr_t patchAddr)
    {
        // Scan forward from patch site for a safe resume point.
        // The original code region is ~0x56 bytes. The resume point should be
        // at roughly +0x70 (SE) or +0x72 (AE) from the patch site.
        // We look for a "test" or "mov" instruction near that range.
        // For safety, use known offsets as primary, with a bounded search.
        if (REL::Module::IsAE()) {
            // Try common AE offsets: 0x72 (1.6.318), then scan nearby
            const auto* bytes = reinterpret_cast<const std::uint8_t*>(patchAddr);
            // Check a range of offsets for a valid instruction boundary
            for (std::ptrdiff_t off = 0x6E; off <= 0x7A; ++off) {
                // Look for common instruction starts after the block:
                // 48 (REX.W prefix), 40 (REX prefix), 0F (two-byte opcode)
                std::uint8_t b = bytes[off];
                if (b == 0x48 || b == 0x40 || b == 0x0F || b == 0x33 || b == 0x45) {
                    return off;
                }
            }
            return 0x72;  // fallback
        } else {
            return 0x70;  // SE known offset
        }
    }
}

// =============================================================================
// Singleton
// =============================================================================

SpellTomeHook* SpellTomeHook::GetSingleton()
{
    static SpellTomeHook singleton;
    return &singleton;
}

// =============================================================================
// Hook Callback
// =============================================================================

void SpellTomeHook::OnSpellTomeRead(RE::TESObjectBOOK* a_book, RE::SpellItem* a_spell)
{
    auto* hook = GetSingleton();
    
    if (!a_book || !a_spell) {
        logger::warn("SpellTomeHook: Null book or spell in callback");
        return;
    }
    
    logger::info("SpellTomeHook: Player reading spell tome '{}' for spell '{}'",
                 a_book->GetName(), a_spell->GetName());
    
    auto* player = RE::PlayerCharacter::GetSingleton();
    if (!player) {
        logger::error("SpellTomeHook: Player not available");
        return;
    }

    // =========================================================================
    // ISL INTEGRATION — Immersive Spell Learning compatibility
    // =========================================================================
    // When ISL is active we delegate the user-facing experience (study menus,
    // animations, time passage) to ISL's Papyrus scripts.  We still grant our
    // XP on first read so the spell's effectiveness scales through our system.
    // ISL's AddSpell at the end of study gives the player the spell, and our
    // SpellEffectivenessHook applies power scaling based on earned XP.
    // =========================================================================
    if (DESTIntegration::IsActive()) {
        logger::info("SpellTomeHook: ISL/DEST active — delegating to ISL");

        RE::FormID spellFormId = a_spell->GetFormID();
        char formIdStr[32];
        snprintf(formIdStr, sizeof(formIdStr), "0x%08X", spellFormId);

        auto* pm = ProgressionManager::GetSingleton();

        // Grant our XP on FIRST read only (anti-exploit)
        if (pm && !hook->HasGrantedTomeXP(spellFormId)) {
            float requiredXP = pm->GetRequiredXP(formIdStr);
            if (requiredXP <= 0) requiredXP = 100.0f;

            float xpToGrant = requiredXP * (hook->m_settings.xpPercentToGrant / 100.0f);
            pm->AddXP(formIdStr, xpToGrant);
            hook->MarkTomeXPGranted(spellFormId);

            if (hook->m_settings.autoSetLearningTarget) {
                pm->SetLearningTargetFromTome(formIdStr, a_spell);
            }

            logger::info("SpellTomeHook: [ISL] Granted {:.1f} XP ({:.0f}%) for '{}'",
                         xpToGrant, hook->m_settings.xpPercentToGrant, a_spell->GetName());

            // Notify UI so the tree updates
            UIManager::GetSingleton()->NotifyProgressUpdate(formIdStr);
        }

        // Dispatch the event to ISL's Papyrus alias.
        // ISL handles: study menu, animations, time, and eventually AddSpell.
        // If player already knows the spell, ISL shows its own "already known"
        // or "forget" dialog.
        DESTIntegration::DispatchSpellTomeRead(a_book, a_spell, nullptr);
        return;
    }

    // =========================================================================
    // NON-ISL PATH — our built-in spell tome handling
    // =========================================================================

    // Check if player already knows this spell
    if (player->HasSpell(a_spell)) {
        if (hook->m_settings.showNotifications) {
            RE::SendHUDMessage::ShowHUDMessage("You already know this spell.");
        }
        logger::info("SpellTomeHook: Player already knows '{}', keeping tome", a_spell->GetName());
        return;
    }
    
    // =========================================================================
    // VANILLA MODE - Instant learn, consume book (like normal Skyrim)
    // =========================================================================
    if (!hook->m_settings.enabled || !hook->m_settings.useProgressionSystem) {
        logger::info("SpellTomeHook: Using VANILLA mode - teaching spell instantly");
        
        // Teach the spell
        player->AddSpell(a_spell);
        
        // Remove book from inventory (vanilla behavior)
        auto* container = GetBookContainer();
        RE::TESObjectREFR* removeFrom = container ? container : player->AsReference();
        if (removeFrom) {
            removeFrom->RemoveItem(a_book, 1, RE::ITEM_REMOVE_REASON::kRemove, nullptr, nullptr);
        }
        
        if (hook->m_settings.showNotifications) {
            char msg[256];
            snprintf(msg, sizeof(msg), "Learned %s", a_spell->GetName());
            RE::SendHUDMessage::ShowHUDMessage(msg);
        }
        
        logger::info("SpellTomeHook: Vanilla mode - taught '{}', consumed tome", a_spell->GetName());
        return;
    }
    
    // =========================================================================
    // PROGRESSION MODE - XP gain, weakened spell system
    // =========================================================================
    logger::info("SpellTomeHook: Using PROGRESSION mode for spell '{}'", a_spell->GetName());
    
    // Convert FormID to string format for ProgressionManager
    char formIdStr[32];
    snprintf(formIdStr, sizeof(formIdStr), "0x%08X", a_spell->GetFormID());
    
    auto* pm = ProgressionManager::GetSingleton();
    if (!pm) {
        logger::error("SpellTomeHook: ProgressionManager not available");
        return;
    }
    
    RE::FormID spellFormId = a_spell->GetFormID();
    
    // =========================================================================
    // TREE PREREQUISITE CHECK - Hard/Soft prerequisite system
    // Hard prereqs: Must have ALL mastered
    // Soft prereqs: Must have at least softNeeded mastered
    // =========================================================================
    logger::info("SpellTomeHook: Checking prerequisites for spell {:08X} '{}' - requirePrereqs={}", 
        spellFormId, a_spell->GetName(), hook->m_settings.requirePrereqs);
    
    if (hook->m_settings.requirePrereqs) {
        auto reqs = pm->GetPrereqRequirements(spellFormId);
        bool hasAnyPrereqs = !reqs.hardPrereqs.empty() || !reqs.softPrereqs.empty();
        
        logger::info("SpellTomeHook: Prereqs for {:08X}: {} hard, {} soft (need {})", 
            spellFormId, reqs.hardPrereqs.size(), reqs.softPrereqs.size(), reqs.softNeeded);
        
        if (hasAnyPrereqs) {
            // Check hard prerequisites - ALL must be mastered
            std::vector<RE::FormID> unmetHard;
            for (RE::FormID prereqId : reqs.hardPrereqs) {
                bool mastered = pm->IsSpellMastered(prereqId);
                auto* prereqSpell = RE::TESForm::LookupByID<RE::SpellItem>(prereqId);
                logger::info("SpellTomeHook:   - HARD {:08X} '{}' mastered={}", 
                    prereqId, prereqSpell ? prereqSpell->GetName() : "UNKNOWN", mastered);
                if (!mastered) {
                    unmetHard.push_back(prereqId);
                }
            }
            
            // Check soft prerequisites - need at least softNeeded mastered
            int softMastered = 0;
            std::vector<RE::FormID> unmetSoft;
            for (RE::FormID prereqId : reqs.softPrereqs) {
                bool mastered = pm->IsSpellMastered(prereqId);
                auto* prereqSpell = RE::TESForm::LookupByID<RE::SpellItem>(prereqId);
                logger::info("SpellTomeHook:   - SOFT {:08X} '{}' mastered={}", 
                    prereqId, prereqSpell ? prereqSpell->GetName() : "UNKNOWN", mastered);
                if (mastered) {
                    softMastered++;
                } else {
                    unmetSoft.push_back(prereqId);
                }
            }
            
            int softNeeded = reqs.softNeeded;
            bool hardMet = unmetHard.empty();
            bool softMet = (softNeeded <= 0) || (softMastered >= softNeeded);
            
            logger::info("SpellTomeHook: hardMet={}, softMet={} ({}/{})", 
                hardMet, softMet, softMastered, softNeeded);
            
            if (!hardMet || !softMet) {
                // Build notification message
                if (hook->m_settings.showNotifications) {
                    std::string msg;
                    
                    if (!hardMet) {
                        // List required hard prereqs
                        std::vector<std::string> spellNames;
                        for (RE::FormID prereqId : unmetHard) {
                            auto* prereqSpell = RE::TESForm::LookupByID<RE::SpellItem>(prereqId);
                            if (prereqSpell) {
                                spellNames.push_back(prereqSpell->GetName());
                            }
                        }
                        
                        msg = "You must first master ";
                        for (size_t i = 0; i < spellNames.size(); i++) {
                            if (i == 0) msg += spellNames[i];
                            else if (i == spellNames.size() - 1) msg += " and " + spellNames[i];
                            else msg += ", " + spellNames[i];
                        }
                    } else if (!softMet) {
                        // Explain soft prereq requirement
                        int stillNeeded = softNeeded - softMastered;
                        msg = "You need to master " + std::to_string(stillNeeded) + " more related spell";
                        if (stillNeeded > 1) msg += "s";
                    }
                    
                    msg += " to grasp this tome";
                    RE::SendHUDMessage::ShowHUDMessage(msg.c_str());
                }
                
                logger::info("SpellTomeHook: Player missing prerequisites for '{}' (hardMet={}, softMet={})", 
                    a_spell->GetName(), hardMet, softMet);
                return;  // Don't learn, keep the tome
            }
        }
    }
    
    // =========================================================================
    // SKILL LEVEL CHECK - Must meet minimum skill requirement (if enabled)
    // =========================================================================
    if (hook->m_settings.requireSkillLevel) {
        auto* spellEffect = a_spell->GetCostliestEffectItem();
        if (spellEffect && spellEffect->baseEffect) {
            int minimumSkill = static_cast<int>(spellEffect->baseEffect->data.minimumSkill);
            auto school = spellEffect->baseEffect->GetMagickSkill();
            
            if (minimumSkill > 0) {
                float playerSkill = player->AsActorValueOwner()->GetActorValue(school);
                
                if (playerSkill < minimumSkill) {
                    if (hook->m_settings.showNotifications) {
                        char msg[256];
                        const char* schoolName = "";
                        switch (school) {
                            case RE::ActorValue::kAlteration:  schoolName = "Alteration"; break;
                            case RE::ActorValue::kConjuration: schoolName = "Conjuration"; break;
                            case RE::ActorValue::kDestruction: schoolName = "Destruction"; break;
                            case RE::ActorValue::kIllusion:    schoolName = "Illusion"; break;
                            case RE::ActorValue::kRestoration: schoolName = "Restoration"; break;
                            default: schoolName = "magic"; break;
                        }
                        snprintf(msg, sizeof(msg), 
                            "You lack the %s skill to learn this spell. (%s: %.0f/%d)",
                            schoolName, schoolName, playerSkill, minimumSkill);
                        RE::SendHUDMessage::ShowHUDMessage(msg);
                    }
                    logger::info("SpellTomeHook: Player lacks skill for '{}' (needs {}, has {:.0f})", 
                        a_spell->GetName(), minimumSkill, player->AsActorValueOwner()->GetActorValue(school));
                    return;  // Don't learn, keep the tome
                }
            }
        }
    }
    
    // =========================================================================
    // CHECK IF TOME XP ALREADY GRANTED - Prevent exploit
    // =========================================================================
    bool alreadyGrantedXP = hook->HasGrantedTomeXP(spellFormId);
    
    // Calculate XP to grant (percentage of required XP)
    float requiredXP = pm->GetRequiredXP(formIdStr);
    if (requiredXP <= 0) {
        requiredXP = 100.0f;  // Default fallback
    }
    
    float xpToGrant = requiredXP * (hook->m_settings.xpPercentToGrant / 100.0f);
    
    // Auto-set as learning target FIRST (initializes progress entry)
    // This is allowed even if XP was already granted (player might have changed target)
    if (hook->m_settings.autoSetLearningTarget) {
        pm->SetLearningTargetFromTome(formIdStr, a_spell);
    }
    
    // Grant XP ONLY if not already granted for this spell
    if (hook->m_settings.grantXPOnRead && !alreadyGrantedXP) {
        pm->AddXP(formIdStr, xpToGrant);
        hook->MarkTomeXPGranted(spellFormId);
        
        logger::info("SpellTomeHook: Granted {:.1f} XP ({:.0f}% of {:.1f} required) for '{}'",
                     xpToGrant, hook->m_settings.xpPercentToGrant, requiredXP, a_spell->GetName());
        
        // Show notification
        if (hook->m_settings.showNotifications) {
            char msg[256];
            snprintf(msg, sizeof(msg), "You begin to study %s...", a_spell->GetName());
            RE::SendHUDMessage::ShowHUDMessage(msg);
        }
    } else if (alreadyGrantedXP) {
        logger::info("SpellTomeHook: XP already granted for '{}' - no additional XP", a_spell->GetName());
        
        // Show different notification
        if (hook->m_settings.showNotifications) {
            char msg[256];
            snprintf(msg, sizeof(msg), "You review %s... (no additional insight)", a_spell->GetName());
            RE::SendHUDMessage::ShowHUDMessage(msg);
        }
    }
    
    // Notify UI
    UIManager::GetSingleton()->NotifyProgressUpdate(formIdStr);
    
    // Book is NOT consumed, NOT removed from inventory
    logger::info("SpellTomeHook: Tome '{}' kept in inventory", a_book->GetName());
}

// =============================================================================
// Get Container (for books read from containers)
// =============================================================================

RE::TESObjectREFR* SpellTomeHook::GetBookContainer()
{
    const auto ui = RE::UI::GetSingleton();
    if (!ui) return nullptr;
    
    const auto menu = ui->GetMenu<RE::ContainerMenu>();
    if (!menu) return nullptr;
    
    const auto movie = menu->uiMovie;
    if (!movie) return nullptr;
    
    // Check if viewing a container
    RE::GFxValue isViewingContainer;
    movie->Invoke("Menu_mc.isViewingContainer", &isViewingContainer, nullptr, 0);
    
    if (!isViewingContainer.GetBool()) {
        return nullptr;
    }
    
    // Get the container reference
    auto refHandle = menu->GetTargetRefHandle();
    RE::TESObjectREFRPtr refr;
    RE::LookupReferenceByHandle(refHandle, refr);
    
    return refr.get();
}

// =============================================================================
// Install Hook
// =============================================================================

bool SpellTomeHook::Install()
{
    logger::info("SpellTomeHook: Installing spell tome read hook...");
    logger::info("SpellTomeHook: Runtime = {} ({})",
        REL::Module::get().version().string(),
        REL::Module::IsAE() ? "AE" : "SE");

    // Get the base address of TESObjectBOOK::Read
    const std::uintptr_t funcBase = ProcessBookID.address();
    logger::info("SpellTomeHook: Function base at {:X}", funcBase);

    // Scan the function body for the patch site (version-independent)
    const auto patchOffset = ScanForPatchSite(funcBase);
    if (patchOffset < 0) {
        logger::error("SpellTomeHook: Could not find patch site pattern (48 8B 0D xx E8 xx) in function body");
        logger::error("SpellTomeHook: This game version may have a different TESObjectBOOK::Read layout.");
        return false;
    }

    const std::uintptr_t hookAddr = funcBase + patchOffset;
    logger::info("SpellTomeHook: Patch site found at offset +{:X} (addr {:X})", patchOffset, hookAddr);

    // Find the jump offset (resume point after patched region)
    const auto jumpOffset = FindJumpOffset(hookAddr);
    const auto patchSize = PatchSize;
    logger::info("SpellTomeHook: Jump offset = +{:X}, patch size = {:X}", jumpOffset, patchSize);
    
    // Create the patch using Xbyak
    // Register usage differs between SE and AE:
    //   SE:  rdi = TESObjectBOOK*   (source: DEST v1.2.0 SE, commit 18b81b1)
    //   AE:  r15 = TESObjectBOOK*
    // rdx = RE::SpellItem* in both versions
    const bool isAE = REL::Module::IsAE();

    struct Patch : Xbyak::CodeGenerator
    {
        Patch(std::uintptr_t a_callbackAddr, std::uintptr_t a_returnAddr, bool a_isAE)
        {
            // Move book pointer to rcx (first param for our callback)
            if (a_isAE) {
                mov(rcx, r15);  // AE: book is in r15
            } else {
                mov(rcx, rdi);  // SE: book is in rdi
            }
            // rdx already has spell pointer (second param)
            
            // Load our callback address and call it
            mov(rax, a_callbackAddr);
            call(rax);
            
            // Set rsi = 0 to prevent book consumption
            // This flag is checked after the patched region
            xor_(rsi, rsi);
            
            // Jump to return address (past the patched region)
            mov(rax, a_returnAddr);
            jmp(rax);
        }
    };
    
    std::uintptr_t callbackAddr = reinterpret_cast<std::uintptr_t>(&OnSpellTomeRead);
    std::uintptr_t returnAddr = hookAddr + jumpOffset;  // Where to jump after our code
    Patch patch(callbackAddr, returnAddr, isAE);
    patch.ready();
    
    // Verify patch size
    if (patch.getSize() > patchSize) {
        logger::error("SpellTomeHook: Patch too large ({} bytes, max {})", patch.getSize(), patchSize);
        return false;
    }
    
    logger::info("SpellTomeHook: Patch size: {} bytes (max {})", patch.getSize(), patchSize);
    
    // Write the patch
    // First, NOP out the entire region we're replacing
    REL::safe_fill(hookAddr, REL::NOP, patchSize);
    
    // Then write our patch code
    REL::safe_write(hookAddr, patch.getCode(), patch.getSize());
    
    GetSingleton()->m_installed = true;
    logger::info("SpellTomeHook: Hook installed successfully!");
    
    return true;
}

// =============================================================================
// Helper: Check if player has a spell tome for a specific spell
// =============================================================================

bool SpellTomeHook::PlayerHasSpellTome(RE::FormID spellFormId)
{
    auto* player = RE::PlayerCharacter::GetSingleton();
    if (!player) return false;
    
    auto inventory = player->GetInventory();
    
    for (const auto& [item, data] : inventory) {
        if (!item) continue;
        
        // data.first is count, data.second is InventoryEntryData
        if (data.first <= 0) continue;
        
        // Check if it's a book
        auto* book = item->As<RE::TESObjectBOOK>();
        if (!book) continue;
        
        // Check if it's a spell tome
        if (!book->TeachesSpell()) continue;
        
        // Check if it teaches the spell we're looking for
        auto* taughtSpell = book->GetSpell();
        if (taughtSpell && taughtSpell->GetFormID() == spellFormId) {
            return true;
        }
    }
    
    return false;
}

// =============================================================================
// Helper: Get XP multiplier (includes tome inventory boost)
// =============================================================================

float SpellTomeHook::GetXPMultiplier(RE::FormID spellFormId) const
{
    float multiplier = 1.0f;
    
    // Check if tome inventory boost is enabled and player has the tome
    if (m_settings.tomeInventoryBoost && PlayerHasSpellTome(spellFormId)) {
        multiplier += m_settings.tomeInventoryBoostPercent / 100.0f;
        logger::trace("SpellTomeHook: Tome inventory boost active for {:08X}, multiplier = {:.2f}",
                     spellFormId, multiplier);
    }
    
    return multiplier;
}

// =============================================================================
// Tome XP Tracking - Prevent exploit of reading same tome multiple times
// =============================================================================

bool SpellTomeHook::HasGrantedTomeXP(RE::FormID spellFormId) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_tomeXPGranted.find(spellFormId) != m_tomeXPGranted.end();
}

void SpellTomeHook::MarkTomeXPGranted(RE::FormID spellFormId)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_tomeXPGranted.insert(spellFormId);
    logger::info("SpellTomeHook: Marked spell {:08X} as having received tome XP", spellFormId);
}

void SpellTomeHook::ClearTomeXPTracking()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_tomeXPGranted.clear();
    logger::info("SpellTomeHook: Cleared tome XP tracking");
}
