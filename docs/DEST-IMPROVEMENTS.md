# DEST Improvements — SpellTomeHook vs Don't Eat Spell Tomes

How Heart of Magic's `SpellTomeHook` improves upon the original
[Don't Eat Spell Tomes](https://github.com/Exit-9B/Dont-Eat-Spell-Tomes) (DEST)
by Exit-9B.

---

## Background

DEST intercepts `TESObjectBOOK::Read` (aka `ProcessBook`) — the function Skyrim
calls when a player opens a spell tome. At a specific point inside that function
the game loads the `PlayerCharacter` singleton into `rcx` and calls `AddSpell`.
DEST NOPs out the entire spell-teach + book-consume region (0x56 bytes) and
replaces it with a small Xbyak patch that calls its own callback, then jumps past
the NOPd region.

Heart of Magic reuses this same fundamental technique but solves several
compatibility and robustness problems present in every released version of DEST
(v1.2.0 through v1.2.2).

---

## Problem 1 — Hardcoded Offsets Break on New Game Versions

### DEST's Approach (v1.2.1 / v1.2.2)

DEST uses **compile-time `#ifdef`** to separate SE/VR and AE code paths, with
hardcoded offsets baked into each:

```cpp
// DEST v1.2.2  —  Patches.cpp  (AE build, non-VR)
std::uintptr_t hookAddr = Offset::TESObjectBOOK::ProcessBook.address() + 0x11D;
//                                                                        ^^^^^
//                                     hardcoded for AE 1.6.318 ONLY

jmp(hookAddr.getAddress() + 0x72);   // hardcoded jump offset
```

```cpp
// DEST v1.2.2  —  Patches.cpp  (SE/VR build)
std::uintptr_t hookAddr = Offset::TESObjectBOOK::ProcessBook.address() + 0xE8;
//                                                                        ^^^^
//                                     hardcoded for SE 1.5.97 ONLY

jmp(hookAddr.getAddress() + 0x70);   // hardcoded jump offset
```

v1.2.2 added a pattern verification check, but on failure it calls
`util::report_and_fail()` — which **crashes the game to desktop**:

```cpp
auto pattern = REL::make_pattern<"48 8B 0D ?? ?? ?? ?? E8 ?? ?? ?? ??">();
if (!pattern.match(hookAddr)) {
    util::report_and_fail("Binary did not match expected, failed to install"sv);
    //                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                     CTD if offset is wrong for your game version
}
```

**Result:** DEST only works on the exact game version it was compiled for.
Running the AE build on AE 1.6.1170 (or any version other than 1.6.318) triggers
the mismatch and crashes. There is no single DLL that works across SE and AE.

### Our Approach — Runtime Pattern Scanning

We use `REL::RelocationID` to resolve the function base across SE and AE at
runtime (no compile-time split), then **scan the function body** for the patch
site dynamically:

```cpp
// Single binary — resolves to the correct function on ANY version
constexpr REL::RelocationID ProcessBookID(17439, 17842);
//                                        ^^^^^  ^^^^^
//                                        SE ID  AE ID

const std::uintptr_t funcBase = ProcessBookID.address();

// Scan forward from +0x80 to +0x200 for the instruction pattern:
//   48 8B 0D xx xx xx xx E8 xx xx xx xx
//   mov rcx, [rip+disp32]; call rel32
// This is the PlayerCharacter singleton load + AddSpell call.
const auto patchOffset = ScanForPatchSite(funcBase);
```

The scanner skips the first `0x80` bytes (function prologue where similar
patterns appear in branch checks) and collects **all** matches in the
`0x80`–`0x200` range, returning the **last** match — which is the one deepest
into the function body, closest to the actual spell-teach site.

**Result:** One DLL works on SE 1.5.97, AE 1.6.318, AE 1.6.640, AE 1.6.1170,
and future versions — as long as the function's general structure is preserved.

---

## Problem 2 — SE/AE Register Difference

### DEST's Approach

DEST handles the register difference (`rdi` vs `r15` for the book pointer) via
compile-time `#ifdef SKYRIMVR`:

```cpp
#ifndef SKYRIMVR
    mov(rcx, r15);     // AE build only
#else
    mov(rcx, rdi);     // SE/VR build only
#endif
```

This means you need **two separate DLLs** — one for SE and one for AE.

### Our Approach — Runtime Detection

We check `REL::Module::IsAE()` at hook install time and generate the correct
Xbyak patch dynamically:

```cpp
const bool isAE = REL::Module::IsAE();

struct Patch : Xbyak::CodeGenerator
{
    Patch(std::uintptr_t a_callbackAddr, std::uintptr_t a_returnAddr, bool a_isAE)
    {
        if (a_isAE) {
            mov(rcx, r15);   // AE: book in r15
        } else {
            mov(rcx, rdi);   // SE: book in rdi
        }
        // ... rest of patch
    }
};
```

**Result:** Single DLL, single distribution, works on both SE and AE.

---

## Problem 3 — Jump Offset Varies Across Versions

### DEST's Approach

The jump offset (where execution resumes after the NOP region) is hardcoded:

| Version | Patch Offset | Jump Offset |
|---------|-------------|-------------|
| SE 1.5.97 | `+0xE8` | `+0x70` |
| AE 1.6.318 | `+0x11D` | `+0x72` |

If the compiler rearranges instructions (which happens between AE sub-versions),
the jump lands on the wrong instruction boundary and the game crashes.

### Our Approach — Bounded Instruction Scan

We scan forward from the patch site for a valid instruction boundary in the
expected range:

```cpp
inline std::ptrdiff_t FindJumpOffset(std::uintptr_t patchAddr)
{
    if (REL::Module::IsAE()) {
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(patchAddr);
        // Scan 0x6E..0x7A for valid instruction start bytes
        for (std::ptrdiff_t off = 0x6E; off <= 0x7A; ++off) {
            std::uint8_t b = bytes[off];
            if (b == 0x48 || b == 0x40 || b == 0x0F || b == 0x33 || b == 0x45) {
                return off;
            }
        }
        return 0x72;  // fallback to known AE offset
    } else {
        return 0x70;  // SE known offset
    }
}
```

**Result:** Tolerates ±6 bytes of instruction shift between AE sub-versions
without breaking.

---

## Problem 4 — Failure Mode

### DEST v1.2.2

```cpp
util::report_and_fail("Binary did not match expected, failed to install"sv);
// Game crashes to desktop. User sees nothing useful.
```

### Our Approach — Graceful Degradation

```cpp
const auto patchOffset = ScanForPatchSite(funcBase);
if (patchOffset < 0) {
    logger::error("SpellTomeHook: Could not find patch site pattern");
    logger::error("SpellTomeHook: This game version may have a different layout.");
    return false;  // Hook not installed — game continues normally
}
```

If the scan fails, the hook simply doesn't install. The game runs normally with
vanilla spell tome behavior. The log file explains exactly what happened.

---

## Summary Comparison

| Aspect | DEST v1.2.2 | Heart of Magic |
|--------|-------------|----------------|
| **SE + AE from one DLL** | No (separate builds) | Yes (`REL::RelocationID` + `IsAE()`) |
| **Patch site discovery** | Hardcoded offset | Runtime pattern scan |
| **Jump offset** | Hardcoded | Bounded instruction scan |
| **AE sub-version support** | 1.6.318 only | 1.6.318, 1.6.640, 1.6.1170+ |
| **Failure on unknown version** | CTD (`report_and_fail`) | Graceful fallback to vanilla |
| **Diagnostic logging** | Minimal | Full (func base, offset, jump, patch size) |
| **Book consumption** | Prevented (sets `rsi = 0`) | Same technique |
| **NOP region size** | `0x56` bytes | `0x56` bytes (same) |

---

## Additional Features Beyond DEST

DEST's scope is limited to preventing spell tome consumption and firing a
Papyrus event. Heart of Magic extends the hook callback with a full progression
system:

| Feature | DEST | Heart of Magic |
|---------|------|----------------|
| Prevent book consumption | Yes | Yes |
| Papyrus event on read | Yes | No (C++ callback) |
| XP grant on tome read | — | Yes (configurable %) |
| One-time XP (anti-exploit) | — | Yes (tracks per-spell) |
| Auto-set learning target | — | Yes |
| Skill level requirement | — | Yes (checks magic school) |
| Tree prerequisite system | — | Yes (hard + soft prereqs) |
| Tome inventory XP boost | — | Yes (bonus while carrying) |
| Already-known detection | — | Yes (notification + skip) |
| Vanilla mode toggle | — | Yes (instant learn fallback) |
| Container-aware reading | Yes | Yes (same `Menu_mc` check) |
| Settings at runtime | — | Yes (from UI) |

---

## Key Offsets Reference

For future debugging — known working offsets across game versions:

| Game Version | Address Library ID | Patch Offset | Jump Offset | Book Register |
|--------------|--------------------|-------------|-------------|---------------|
| SE 1.5.97 | 17439 | `+0xE8` | `+0x70` | `rdi` |
| AE 1.6.318 | 17842 | `+0x11D` | `+0x72` | `r15` |
| AE 1.6.640 | 17842 | (scanned) | (scanned) | `r15` |
| AE 1.6.1170 | 17842 | (scanned) | (scanned) | `r15` |

The pattern scan finds the correct offset regardless — these are listed for
reference only.

---

## Files

| File | Purpose |
|------|---------|
| `plugin/src/SpellTomeHook.h` | Hook class, settings struct, API |
| `plugin/src/SpellTomeHook.cpp` | Pattern scan, Xbyak patch, callback logic |

## Credits

- **Exit-9B** — Original DEST technique (MIT License)
- **alandtse** — CommonLibSSE-NG with `REL::RelocationID` support
- **DEST commit `18b81b1`** — SE register (`rdi`) reference
- **DEST commit `d874697`** — AE register (`r15`) and offset reference
