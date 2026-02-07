Scriptname SpellLearning_QuestScript extends Quest

; =============================================================================
; SpellLearning Quest Script
; Attaches to a quest to enable the global functions in SpellLearning_Bridge
; Also provides a polling mechanism to check for pending requests
; =============================================================================

Event OnInit()
    Debug.Trace("[SpellLearning] Quest initialized")
    ; Register for menu close to check for pending requests
    RegisterForMenu("PrismaUI_FocusMenu")
EndEvent

Event OnMenuClose(String menuName)
    if menuName == "PrismaUI_FocusMenu"
        ; Check if there's a pending request when UI closes
        CheckForPendingRequest()
    endif
EndEvent

Function CheckForPendingRequest()
    String requestPath = "Data/SKSE/Plugins/SpellLearning/skyrimnet_request.json"
    
    if MiscUtil.FileExists(requestPath)
        String content = MiscUtil.ReadFromFile(requestPath)
        if StringUtil.GetLength(content) > 10
            Debug.Trace("[SpellLearning] Found pending request, processing...")
            SpellLearning_Bridge.ProcessRequest()
        endif
    endif
EndFunction

; Manual trigger function - can be called via console: 
; prid xx000800 (quest form ID)
; call CheckForPendingRequest
Function ManualProcess()
    Debug.Trace("[SpellLearning] Manual process triggered")
    SpellLearning_Bridge.ProcessRequest()
EndFunction
