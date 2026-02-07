Scriptname SpellLearning_Bridge Hidden

; =============================================================================
; SpellLearning SkyrimNet Bridge
; Reads request files written by C++ and sends to SkyrimNet LLM
; =============================================================================

String Property REQUEST_PATH = "Data/SKSE/Plugins/SpellLearning/skyrimnet_request.json" AutoReadOnly
String Property RESPONSE_PATH = "Data/SKSE/Plugins/SpellLearning/skyrimnet_response.json" AutoReadOnly

; Called by SkyrimNet when LLM responds to our request
Function OnSpellTreeResponse(String response, int success) Global
    ; Write format: success|response (simple delimiter for C++ to parse)
    String output = success + "|" + response
    MiscUtil.WriteToFile("Data/SKSE/Plugins/SpellLearning/skyrimnet_response.json", output, false)
    Debug.Trace("[SpellLearning] LLM Response received, success=" + success + ", length=" + StringUtil.GetLength(response))
EndFunction

; Check if SkyrimNet is available
bool Function IsSkyrimNetAvailable() Global
    return SKSE.GetPluginVersion("SkyrimNet") != -1
EndFunction

; Process the current school request from C++
; Call this from console: cgf "SpellLearning_Bridge.ProcessRequest"
; C++ writes request to skyrimnet_request.json before JS calls this
Function ProcessRequest() Global
    Debug.Trace("[SpellLearning] ProcessRequest called")
    
    if !IsSkyrimNetAvailable()
        Debug.Trace("[SpellLearning] ERROR: SkyrimNet not available")
        Debug.Notification("SpellLearning: SkyrimNet not found!")
        return
    endif
    
    ; Read request file written by C++
    String requestPath = "Data/SKSE/Plugins/SpellLearning/skyrimnet_request.json"
    
    if !MiscUtil.FileExists(requestPath)
        Debug.Trace("[SpellLearning] ERROR: Request file not found")
        Debug.Notification("SpellLearning: No request pending")
        return
    endif
    
    String requestData = MiscUtil.ReadFromFile(requestPath)
    if StringUtil.GetLength(requestData) == 0
        Debug.Trace("[SpellLearning] ERROR: Request file empty")
        return
    endif
    
    Debug.Trace("[SpellLearning] Read request, length=" + StringUtil.GetLength(requestData))
    
    ; Clear response file first
    MiscUtil.WriteToFile("Data/SKSE/Plugins/SpellLearning/skyrimnet_response.json", "", false)
    
    ; Extract school name from the JSON (simple string search)
    ; Request format: {"school":"SchoolName","spellData":"...","rules":"..."}
    String schoolName = ExtractJsonValue(requestData, "school")
    
    Debug.Trace("[SpellLearning] Sending to SkyrimNet for school: " + schoolName)
    Debug.Notification("SpellLearning: Generating " + schoolName + " tree...")
    
    ; Send to SkyrimNet using custom prompt
    ; The custom_prompt file handles the actual prompt formatting
    int result = SkyrimNetApi.SendCustomPromptToLLM("spell_tree_generator", schoolName, requestData, None, "SpellLearning_Bridge", "OnSpellTreeResponse")
    
    if result > 0
        Debug.Trace("[SpellLearning] Request queued successfully, id=" + result)
    else
        Debug.Trace("[SpellLearning] Request failed, error=" + result)
        Debug.Notification("SpellLearning: Request failed!")
        ; Write error to response
        MiscUtil.WriteToFile("Data/SKSE/Plugins/SpellLearning/skyrimnet_response.json", "0|{\"error\":\"SendCustomPromptToLLM failed with code " + result + "\"}", false)
    endif
EndFunction

; Simple JSON value extractor (for basic key-value pairs)
String Function ExtractJsonValue(String jsonStr, String keyName) Global
    ; Look for "key":"value" pattern
    String searchFor = "\"" + keyName + "\":\""
    int startPos = StringUtil.Find(jsonStr, searchFor)
    if startPos < 0
        return ""
    endif
    
    startPos = startPos + StringUtil.GetLength(searchFor)
    int endPos = StringUtil.Find(jsonStr, "\"", startPos)
    if endPos < 0
        return ""
    endif
    
    return StringUtil.Substring(jsonStr, startPos, endPos - startPos)
EndFunction
