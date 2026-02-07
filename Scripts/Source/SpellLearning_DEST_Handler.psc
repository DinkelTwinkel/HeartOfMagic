Scriptname SpellLearning_DEST_Handler extends Quest
{Minimal event forwarder for DEST integration.
NO STATE - clean mod removal.
All logic handled in C++ via SpellLearning_DEST native functions.}

import DEST_FormExt

Event OnInit()
    RegisterForSpellTomeReadEvent(self as Form)
    Debug.Trace("[SpellLearning] DEST handler registered for spell tome events")
EndEvent

Event OnSpellTomeRead(Book akBook, Spell akSpell, ObjectReference akContainer)
    ; Forward everything to C++ immediately - no logic here
    SpellLearning_DEST.OnTomeRead(akBook, akSpell, akContainer)
EndEvent
