Scriptname SpellLearning Hidden

; =============================================================================
; SpellLearning Papyrus API
; =============================================================================
; This script provides native functions for other mods to interact with
; the SpellLearning UI panel.
;
; All functions are global (don't require an object instance).
;
; EXAMPLE USAGE:
;   SpellLearning.OpenMenu()
;   if SpellLearning.IsMenuOpen()
;       Debug.Notification("SpellLearning menu is open!")
;   endif
;
; MOD EVENTS:
;   You can also listen for UI state changes via ModEvents:
;
;   Event OnInit()
;       RegisterForModEvent("SpellLearning_MenuOpened", "OnSpellLearningOpened")
;       RegisterForModEvent("SpellLearning_MenuClosed", "OnSpellLearningClosed")
;   EndEvent
;
;   Event OnSpellLearningOpened()
;       Debug.Notification("SpellLearning UI opened!")
;   EndEvent
;
;   Event OnSpellLearningClosed()
;       Debug.Notification("SpellLearning UI closed!")
;   EndEvent
; =============================================================================

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
