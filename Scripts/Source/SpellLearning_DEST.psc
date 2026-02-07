Scriptname SpellLearning_DEST Hidden
{Native functions for SpellLearning DEST integration.
All logic is handled in C++ - these are just bindings.
NO STATE - clean mod removal.}

; Forward tome read event to C++ - returns true if handled
; C++ handles: prereq check, XP grant, learning target, notifications
bool Function OnTomeRead(Book akBook, Spell akSpell, ObjectReference akContainer) global native

; Check if DEST integration is active
bool Function IsIntegrationActive() global native
