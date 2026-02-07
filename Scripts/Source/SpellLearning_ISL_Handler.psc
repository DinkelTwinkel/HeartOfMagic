Scriptname SpellLearning_ISL_Handler extends ReferenceAlias
{Handles OnSpellTomeRead events from ISL-DESTified and redirects to SpellLearning's XP system.
Attach this script to a player alias on a quest that starts game enabled.}

; Import ISL's event registration API
Import DEST_AliasExt

Event OnInit()
    ; Register for spell tome read events from ISL's SKSE plugin
    RegisterForSpellTomeReadEvent(self)
    Debug.Trace("[SpellLearning] ISL Handler initialized - registered for OnSpellTomeRead events")
EndEvent

Event OnPlayerLoadGame()
    ; Re-register after loading a save
    RegisterForSpellTomeReadEvent(self)
    Debug.Trace("[SpellLearning] ISL Handler re-registered after game load")
EndEvent

; This event is fired by ISL's DontEatSpellTomes.dll when player reads a spell tome
Event OnSpellTomeRead(Book akBook, Spell akSpell, ObjectReference akContainer)
    Debug.Trace("[SpellLearning] OnSpellTomeRead: " + akBook.GetName() + " -> " + akSpell.GetName())
    
    ; Check if our integration is active
    If !SpellLearning_ISL.IsIntegrationActive()
        Debug.Trace("[SpellLearning] ISL integration disabled, letting ISL handle it")
        Return  ; Let ISL's default handler process it
    EndIf
    
    ; Call our C++ handler
    bool handled = SpellLearning_ISL.OnTomeRead(akBook, akSpell, akContainer)
    
    If handled
        Debug.Trace("[SpellLearning] Tome read handled by SpellLearning")
        ; We handled it - ISL's handler will also run but we've already granted XP
        ; To fully disable ISL's handler, we would need to unregister their alias
        ; which is done in the C++ code on game load
    Else
        Debug.Trace("[SpellLearning] Tome read not handled - spell not in our system")
    EndIf
EndEvent
