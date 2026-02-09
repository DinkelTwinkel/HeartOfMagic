# SpellLearning Common Errors & Solutions

Quick reference for issues encountered during development.

---

## Crash: nlohmann::json type_error with book/tome (e.g. DynDOLOD "Evil Note")

**Symptom:** CrashLogger shows:
```
Unhandled exception "C++ Exception" ... (nlohmann::json_abi_v3_12_0::detail::type_error*)
Throw Location: SpellLearning.dll+00BAE2B
POSSIBLE RELEVANT OBJECTS:
RSP+8F0: (TESObjectBOOK*) "Evil Note" [0xF200090C] (DynDOLOD.esp)
```

**Cause:** A mod (e.g. DynDOLOD.esp) has a book or spell tome whose **name** or **description** contains invalid UTF-8 (e.g. Windows-1252 smart quote `’` = byte 0x92). When SpellLearning builds JSON for the spell scan or spell info, nlohmann::json throws because it requires valid UTF-8.

**Fix (code):** All strings from game/mods that are written into JSON must be passed through `SanitizeToUTF8()` in SpellScanner.cpp (spell name, tome name, effect names, effect descriptions). This was fixed so tome names and effect names/descriptions in both the tome scan and GetSpellInfoByFormId are now sanitized.

**User workaround:** Update to a SpellLearning build that includes the UTF-8 sanitization fix. No need to remove DynDOLOD or the offending mod.

---

## PrismaUI View Path Mismatch

**Symptom:** Panel doesn't load, PrismaUI.log shows:
```
[E] Failed loading URL: file:///Data/PrismaUI/views/SpellLearning/SpellLearningPanel/index.html. Error: File URL loading failed
```

**Cause:** The path in C++ `CreateView()` must EXACTLY match the deployed folder structure.

**C++ Code (UIManager.cpp):**
```cpp
m_view = m_prismaUI->CreateView("SpellLearning/SpellLearningPanel/index.html", OnDomReady);
```

**Required Deploy Path:**
```
MO2/mods/HeartOfMagic_RELEASE/PrismaUI/views/SpellLearning/SpellLearningPanel/index.html
(Or SpellLearning_RELEASE if using that project name.)
                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                              This part must match CreateView path
```

**Common Mistakes:**
- Deploying to `PrismaUI/views/SpellLearningPanel/` (missing `SpellLearning/` subfolder)
- Deploying to `SKSE/Plugins/PrismaUI/views/...` (wrong root - PrismaUI goes at mod root)

**Fix:** Always check PrismaUI.log for the exact path being requested.

---

## DLL Not Rebuilt / Outdated

**Symptom:** New features don't work, callbacks not triggered, behavior unchanged.

**Diagnosis:** Check timestamps:
```powershell
# Compare DLL timestamp vs source
Get-Item "MO2\mods\SpellLearning_RELEASE\SKSE\Plugins\SpellLearning.dll" | Select LastWriteTime
Get-Item "projects\SpellLearning\plugin\src\UIManager.cpp" | Select LastWriteTime
```

If source is newer than DLL, rebuild is needed.

**Fix:**
```powershell
.\scripts\build.ps1 -ProjectPath "D:\MODDING\Mod Development Zone 2\projects\SpellLearning\plugin"
```

---

## CommonLib: ActorHandle to Actor Pointer

**Symptom:** Compilation error with `RE::NiPointer` conversion.

**Wrong:**
```cpp
RE::Actor* caster = a_effect->caster.get();  // ERROR: can't convert NiPointer to raw pointer
```

**Correct:**
```cpp
// ActorHandle::get() returns NiPointer<Actor>
// NiPointer::get() returns raw Actor*
RE::Actor* caster = a_effect->caster.get().get();
```

**Explanation:**
- `ActorHandle` is `BSPointerHandle<Actor>` - a handle that must be looked up
- `ActorHandle::get()` returns `NiPointer<Actor>` (smart pointer)
- `NiPointer<Actor>::get()` returns `Actor*` (raw pointer)

---

## CommonLib: EffectArchetype Enum Values

**Symptom:** `kWaterBreathing` or similar archetype not found.

**Wrong:**
```cpp
archetype == RE::EffectSetting::Archetype::kWaterBreathing  // DOESN'T EXIST
```

**Correct:** Use `RE::EffectArchetype` and check valid values in `EffectArchetypes.h`:
```cpp
archetype == RE::EffectArchetype::kParalysis      // 21
archetype == RE::EffectArchetype::kInvisibility   // 11
archetype == RE::EffectArchetype::kEtherealize    // 41
```

**Note:** Waterbreathing is implemented via ActorValue modifier, not a dedicated archetype.

---

## CSS calc() in Ultralight

**Symptom:** CSS transforms with `calc()` don't work, panel appears in wrong position.

**Wrong:**
```css
transform: translateX(calc(-100% + 30px));  /* May not work in Ultralight */
```

**Correct:** Use fixed pixel values:
```css
/* For a 260px wide panel, -100% + 30px = -230px */
transform: translateX(-230px);
```

**Ultralight** (PrismaUI's browser engine) has limited CSS support. Avoid:
- Complex `calc()` expressions
- CSS variables in some contexts
- Advanced selectors

---

## Settings Not Loading

**Symptom:** Previous settings lost on game restart.

**Check SpellLearning.log for:**
```
LoadUnifiedConfig requested
```

If missing, the callback isn't being triggered (usually because UI failed to load).

**Settings file location:**
```
Data/SKSE/Plugins/SpellLearning/config.json
```

In MO2, this is virtualized. Check:
- `MO2/overwrite/SKSE/Plugins/SpellLearning/`
- The actual game Data folder

---

## ISL-DESTified Not Detected

**Symptom:** ISL integration shows "Not Detected" despite mod being installed.

**Cause:** Plugin name doesn't match expected names.

**Solution:** Check for ALL possible plugin names:
```cpp
const char* ISL_PLUGIN_NAMES[] = {
    "DontEatSpellTomes.esp",
    "DontEatSpellTomes.esl",
    "Don't Eat Spell Tomes.esp",
    "Don't Eat Spell Tomes.esl",
    "DEST_ISL.esp",
    "DEST_ISL.esl",
    "ISL-DESTified.esp",
    "ISL-DESTified.esl"
};
```

---

## PowerShell vs LS Tool

**NEVER use the LS tool for file verification!** It frequently fails to show existing files.

**Always use PowerShell:**
```powershell
# List files
dir "path\to\folder" -Recurse

# Check specific file
Get-Item "path\to\file.dll" | Select FullName, Length, LastWriteTime

# Find all copies
Get-ChildItem -Path "MO2\mods" -Recurse -Filter "SpellLearning.dll"
```

---

## Build Succeeds But DLL Not Copied

**Symptom:** Build says successful, but DLL not in MO2 folder.

**Check CMakeLists.txt post-build commands:**
```cmake
set(MO2_RELEASE_PATH "D:/MODDING/Mod Development Zone 2/MO2/mods/${PROJECT_NAME}_RELEASE/SKSE/Plugins")
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:${PROJECT_NAME}> "${MO2_RELEASE_PATH}/"
)
```

**Manual copy fallback:**
```powershell
Copy-Item "projects\SpellLearning\plugin\build\Release\SpellLearning.dll" `
          "MO2\mods\SpellLearning_RELEASE\SKSE\Plugins\" -Force
```

---

## Quick Diagnostic Commands

```powershell
# Check all SpellLearning files in MO2
[System.IO.Directory]::GetFiles("D:\MODDING\Mod Development Zone 2\MO2\mods\SpellLearning_RELEASE", "*", [System.IO.SearchOption]::AllDirectories)

# Check SKSE logs
Get-Content "C:\Users\jason\Documents\My Games\Skyrim Special Edition\SKSE\SpellLearning.log" -Tail 50
Get-Content "C:\Users\jason\Documents\My Games\Skyrim Special Edition\SKSE\PrismaUI.log" -Tail 50

# Check DLL loading
Select-String -Path "C:\Users\jason\Documents\My Games\Skyrim Special Edition\SKSE\skse64.log" -Pattern "SpellLearning"
```

---

## Checklist Before Testing

1. [ ] DLL rebuilt after code changes? (check timestamp)
2. [ ] PrismaUI path matches CreateView path?
3. [ ] MO2 refreshed (F5)?
4. [ ] No duplicate mods enabled?
5. [ ] Check SKSE logs for errors on startup
