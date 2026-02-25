# Shared Effect Description Display Issue

## Problem

`SpellEffectivenessHookDisplay.cpp` modifies `baseEffect->magicItemDescription` directly when applying early-learning effectiveness scaling. Since `RE::EffectSetting` (base effect) objects are **shared** across all spells that use them, writing a per-spell description into this shared field causes display inconsistency.

### Example

1. Player has **Firebolt** (35% effectiveness) and **Fireball** (50% effectiveness), both early-learned.
2. Both spells share the "Fire Damage" base effect (`RE::EffectSetting`).
3. `ApplyModifiedDescriptions` is called for Firebolt -- writes `"[35% Power] Deals X fire damage"` into the shared `magicItemDescription`.
4. `ApplyModifiedDescriptions` is called for Fireball -- overwrites to `"[50% Power] Deals Y fire damage"`.
5. **Result**: Both Firebolt and Fireball now show 50% in their effect descriptions.

### Impact

- **Display only** -- actual magnitude scaling is correct (applied per-effect in the vtable hook, not from the description)
- Affects the magic menu effect description text
- Most noticeable when players have multiple early-learned spells from the same school/element sharing base effects (Fire Damage, Frost Damage, etc.)
- The code acknowledges this limitation in `SpellEffectivenessHookDisplay.cpp` (see the `ApplyModifiedDescriptions` function and its "shared effect" comments)

### Current Mitigation

The `m_effectSpellTracking` system tracks which spells reference each base effect and only restores the original description when the **last** spell using that effect is mastered. This prevents orphaned modified descriptions but does not solve the overwrite conflict between two active early-learned spells.

## Possible Solutions

### Option A: Per-spell description cache (display-time lookup)

Instead of modifying the shared `EffectSetting`, maintain a `std::unordered_map<FormID, std::unordered_map<FormID, std::string>>` mapping `(spell, baseEffect) -> modifiedDescription`. Hook the UI description display to look up the spell-specific description at render time.

**Pros**: Correct per-spell descriptions; no shared state mutation.
**Cons**: Requires finding and hooking the description display codepath (may be deep in the engine UI). Could be complex depending on how Skyrim resolves effect descriptions for display.

### Option B: Hook GetDescription rather than modifying the field

Override `RE::EffectSetting::GetDescription()` (or equivalent) with a detour that checks if the current context is an early-learned spell and returns the appropriate modified description dynamically. **Note:** Verify that `GetDescription()` exists as a hookable virtual on `RE::EffectSetting` in the CommonLibSSE-NG headers before attempting this approach.

**Pros**: Clean separation; descriptions computed on demand.
**Cons**: Need to determine the "current spell context" at description-display time, which may not be straightforward if the engine only passes the base effect to the description formatter.

### Option C: Accept the limitation with improved last-write-wins

Keep the current approach but apply descriptions in a deterministic order (e.g., always apply for the spell with the lowest effectiveness last), so the displayed description is at least consistently the "weakest" version. Add a log warning when shared effects are detected.

**Pros**: Minimal code change; behavior becomes predictable.
**Cons**: Still incorrect for all but the last-applied spell. Users with many shared-effect early-learned spells would still see wrong descriptions.

### Option D: Unique EffectSetting clones per spell

When an early-learned spell is detected, clone its `RE::EffectSetting` objects and point the spell's effects at the clones. Modify the clone's description freely.

**Pros**: Completely correct; each spell has independent descriptions.
**Cons**: Creating game-engine object clones is risky (memory management, form system integration, serialization). Could cause issues with other mods or engine systems that expect shared `EffectSetting` pointers.

## Recommendation

**Option A** is the safest and most correct approach. The key challenge is identifying the right hook point for description display. Research needed:

1. Check `RE::MagicItem::GetDescription()` and `RE::EffectSetting::magicItemDescription` usage in CommonLibSSE-NG headers
2. Check if there's a virtual function on `ActiveEffect` or `MagicItem` that formats the effect description for the UI
3. Look at how the magic menu (`RE::MagicMenu`) accesses effect descriptions

If no suitable hook exists, **Option C** provides a pragmatic improvement with minimal risk.
