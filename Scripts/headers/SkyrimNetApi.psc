Scriptname SkyrimNetApi

int Function RegisterDecorator(String decoratorID, String sourceScript, String functionName) Global Native
int Function RegisterAction(String actionName, String description, String eligibilityScriptName, String eligibilityFunctionName, String executionScriptName, String executionFunctionName, String triggeringEventTypesCsv, String categoryStr, int defaultPriority, String parameterSchemaJson, String customCategory="", String tags="") Global Native
int Function RegisterSubCategory(String actionName, String description, String eligibilityScriptName, String eligibilityFunctionName, String triggeringEventTypesCsv, int defaultPriority, String customParentCategory, String customCategory) Global Native
int Function RegisterTag(String tagName, String eligibilityScriptName, String eligibilityFunctionName) Global Native
bool Function IsActionRegistered(String actionName) Global Native
int Function UnregisterAction(String actionName) Global Native
int Function ExecuteAction(string actionName, Actor akOriginator, string argsJson) global native
int Function SetActionCooldown(string actionName, int cooldownTimeSeconds) global native
int Function GetRemainingCooldown(string actionName) global native
int Function RegisterShortLivedEvent(String eventId, String eventType, String description, String data, int ttlMs, Actor sourceActor, Actor targetActor) Global Native
int Function RegisterEvent(String eventType, String content, Actor originatorActor, Actor targetActor) Global Native
int Function RegisterDialogue(Actor speaker, String dialogue) Global Native
int Function RegisterDialogueToListener(Actor speaker, Actor listener, String dialogue) Global Native
int Function PurgeDialogue() Global Native
int Function RegisterPackage(Actor akActor, String packageName, int priority, int flags, bool isPersistent) Global Native
int Function UnregisterPackage(Actor akActor, String packageName) Global Native
int Function ScheduleDelayedPackageRemoval(Actor akActor, String packageName, int delaySeconds) Global Native
int Function ClearAllPackages(Actor akActor) Global Native
int Function ClearAllPackagesGlobally() Global Native
int Function CancelPendingPackageTasks(Actor akActor) Global Native
int Function HasPackage(Actor akActor, String packageName) Global Native
int Function ReinforcePackages(Actor akActor) Global Native
int Function SendCustomPromptToLLM(String promptName, String variant, String contextJson, Quest callbackQuest, String callbackScriptName, String callbackFunctionName) Global Native
int Function DirectNarration(String content, Actor originatorActor = None, Actor targetActor = None) Global Native
int Function RegisterPersistentEvent(String content, Actor originatorActor = None, Actor targetActor = None) Global Native
String Function GetJsonString(String jsonString, String key, String defaultValue) Global Native
int Function GetJsonInt(String jsonString, String key, int defaultValue) Global Native
bool Function GetJsonBool(String jsonString, String key, bool defaultValue) Global Native
float Function GetJsonFloat(String jsonString, String key, float defaultValue) Global Native
Actor Function GetJsonActor(String jsonString, String key, Actor defaultValue) Global Native
Actor Function FindActorByName(String actorName) Global Native
String Function JoinStrings(String[] strings, String[] noun) Global Native
String Function GetConfigString(String configName, String path, String defaultValue) Global Native
int Function GetConfigInt(String configName, String path, int defaultValue) Global Native
bool Function GetConfigBool(String configName, String path, bool defaultValue) Global Native
float Function GetConfigFloat(String configName, String path, float defaultValue) Global Native
bool Function PatchConfig(String name, String jsonPatch) Global Native
String Function GetBuildVersion() Global Native
String Function GetBuildType() Global Native
bool Function IsRecordingInput() Global Native
bool Function IsRunningVR() Global Native
int Function GetSpeechQueueSize() Global Native
int Function GetTimeSinceLastAudioEnded() Global Native
String Function RenderTemplate(String templateName, String variableName, String variableValue) Global Native
String Function ParseString(String inputStr, String variableName, String variableValue) Global Native
String Function UpdateActorDynamicBio(Actor actor) Global Native
String Function GenerateDiaryEntry(Actor actor) Global Native
int Function RegisterEventSchema(String eventType, String displayName, String description, String fieldsJson, String formatTemplatesJson, bool isEphemeral, int defaultTTLMs, bool shortLivedEnabled = true, bool interrupt = false) Global Native
bool Function ValidateEventData(String eventType, String dataJson) Global Native
String Function FormatEvent(String eventJson, String mode) Global Native
String Function GetSchemaInfo(String eventType) Global Native
String Function GetAllEventTypes() Global Native
bool Function IsEventTypeRegistered(String eventType) Global Native
String Function GetAllSchemasInfo() Global Native
int Function RegisterVirtualNPC(String name, String displayName, String voiceId, String conversationMode, String language) Global Native
int Function UpdateVirtualNPC(String name, String displayName, String voiceId, String conversationMode, String language) Global Native
int Function EnableVirtualNPC(String name) Global Native
int Function DisableVirtualNPC(String name) Global Native
int Function OpenSkyrimNetUI() Global Native
int Function TriggerRecordSpeechPressed() Global Native
int Function TriggerRecordSpeechReleased(float duration) Global Native
int Function TriggerToggleOpenMic() Global Native
int Function TriggerTextInput() Global Native
int Function TriggerToggleGameMaster() Global Native
int Function TriggerToggleContinuousMode() Global Native
int Function TriggerToggleWorldEventReactions() Global Native
int Function TriggerToggleWhisperMode() Global Native
int Function TriggerTextThought() Global Native
int Function TriggerVoiceThoughtPressed() Global Native
int Function TriggerVoiceThoughtReleased(float duration) Global Native
int Function TriggerTextDialogueTransform() Global Native
int Function TriggerVoiceDialogueTransformPressed() Global Native
int Function TriggerVoiceDialogueTransformReleased(float duration) Global Native
int Function TriggerDirectInput() Global Native
int Function TriggerVoiceDirectInputPressed() Global Native
int Function TriggerVoiceDirectInputReleased(float duration) Global Native
int Function TriggerContinueNarration() Global Native
int Function TriggerPlayerThought() Global Native
int Function TriggerPlayerDialogue() Global Native
int Function TriggerPlayerTTS(String dialogue) Global Native
bool Function IsPlayerTTSFinished() Global Native
int Function PrepareNPCDialogue(String playerDialogueText) Global Native
bool Function IsNPCDialogueReady() Global Native
int Function SetCppHotkeysEnabled(bool enabled) Global Native
bool Function IsCppHotkeysEnabled() Global Native
bool Function IsContinuousModeEnabled() Global Native
int Function TriggerCaptureCrosshairPressed() Global Native
int Function TriggerCaptureCrosshairReleased(float holdDuration) Global Native
int Function TriggerGenerateDiaryBio() Global Native
int Function TriggerInterruptDialogue() Global Native
