Scriptname SpellLearning_ISL Hidden
{Native function stubs for SpellLearning ISL integration.
These functions are implemented in SpellLearning.dll}

; Called when a spell tome is read - returns true if we handled it
bool Function OnTomeRead(Book akBook, Spell akSpell, ObjectReference akContainer) global native

; Check if ISL integration is currently active
bool Function IsIntegrationActive() global native

; Get the XP per hour setting
float Function GetXPPerHour() global native

; Get the tome inventory bonus setting (0.0 - 1.0)
float Function GetTomeBonus() global native

; Enable or disable ISL integration
Function SetEnabled(bool enabled) global native
