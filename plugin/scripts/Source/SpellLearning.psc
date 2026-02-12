Scriptname SpellLearning Hidden

; =============================================================================
; SpellLearning Papyrus API
; =============================================================================
; All functions are global (don't require an object instance).
;
; EXAMPLE USAGE:
;   ; Grant XP through a custom source
;   SpellLearning.RegisterXPSource("my_training", "Combat Training")
;   float granted = SpellLearning.AddSourcedXP(someSpell, 50.0, "my_training")
;
;   ; Query progress
;   float pct = SpellLearning.GetSpellProgress(someSpell)
;   bool mastered = SpellLearning.IsSpellMastered(someSpell)
;
; MOD EVENTS:
;   RegisterForModEvent("SpellLearning_XPGained", "OnXPGained")
;   RegisterForModEvent("SpellLearning_SpellMastered", "OnMastered")
;   RegisterForModEvent("SpellLearning_SpellEarlyGranted", "OnEarlyGranted")
;   RegisterForModEvent("SpellLearning_TargetChanged", "OnTargetChanged")
;   RegisterForModEvent("SpellLearning_ProgressMilestone", "OnMilestone")
;   RegisterForModEvent("SpellLearning_SourceRegistered", "OnSourceRegistered")
;
;   Event OnXPGained(string sourceName, float amount, Form spellForm)
;   EndEvent
;
;   Event OnMastered(string school, float unused, Form spellForm)
;   EndEvent
; =============================================================================

; === Menu Functions ===

; Opens the SpellLearning UI panel
Function OpenMenu() global native

; Closes the SpellLearning UI panel
Function CloseMenu() global native

; Toggles the SpellLearning UI panel (open if closed, close if open)
Function ToggleMenu() global native

; Returns true if the SpellLearning UI panel is currently open
bool Function IsMenuOpen() global native

; Returns the SpellLearning mod version as a string (e.g., "1.0.0")
string Function GetVersion() global native

; === XP Functions ===

; Register a named XP source (recommended before granting XP).
; Creates a UI entry with per-source multiplier + cap controls.
; If not called, AddSourcedXP auto-registers with sourceId as display name.
Function RegisterXPSource(string sourceId, string displayName) global native

; Grant XP through the cap system.
; Built-in sources: "any", "school", "direct", "self"
; Custom sources: any string (auto-registers if not already known)
; Applies: amount x source multiplier x global multiplier, clamped to source cap.
; Returns actual XP granted.
float Function AddSourcedXP(Spell akSpell, float amount, string sourceName = "direct") global native

; Grant raw XP bypassing ALL caps and multipliers.
; For quest rewards where amount is pre-determined.
float Function AddRawXP(Spell akSpell, float amount) global native

; Set exact XP value (debug/cheat).
Function SetSpellXP(Spell akSpell, float xp) global native

; === Progress Queries ===

; Returns progress as percentage (0.0 - 100.0)
float Function GetSpellProgress(Spell akSpell) global native

; Returns raw XP currently earned
float Function GetSpellCurrentXP(Spell akSpell) global native

; Returns total XP needed to master
float Function GetSpellRequiredXP(Spell akSpell) global native

; Returns true if spell is at 100% XP and unlocked
bool Function IsSpellMastered(Spell akSpell) global native

; Returns true if spell has been granted to the player
bool Function IsSpellUnlocked(Spell akSpell) global native

; Returns true if spell is in tree, not yet unlocked, and prerequisites are met
bool Function IsSpellAvailableToLearn(Spell akSpell) global native

; Returns true if all tree prerequisites for this spell are mastered
bool Function ArePrerequisitesMet(Spell akSpell) global native

; === Learning Target Control ===

; Get the current learning target spell for a school (e.g., "Destruction")
; Returns None if no target is set
Spell Function GetLearningTarget(string schoolName) global native

; Get all current learning targets across all schools
Spell[] Function GetAllLearningTargets() global native

; Get the current learning mode ("perSchool" or "single")
string Function GetLearningMode() global native

; Set a spell as learning target (auto-determines school from spell data)
Function SetLearningTarget(Spell akSpell) global native

; Set a spell as learning target for a specific school
Function SetLearningTargetForSchool(string schoolName, Spell akSpell) global native

; Clear the learning target for a school
Function ClearLearningTarget(string schoolName) global native

; Clear all learning targets
Function ClearAllLearningTargets() global native

; === Settings Queries (read-only) ===

; Get the current global XP multiplier
float Function GetGlobalXPMultiplier() global native

; Get XP required for a tier (e.g., "novice", "expert")
float Function GetXPForTier(string tier) global native

; Get the cap percentage for a source. Works for built-in ("any", "school",
; "direct", "self") and modded sources.
float Function GetSourceCap(string sourceName) global native
