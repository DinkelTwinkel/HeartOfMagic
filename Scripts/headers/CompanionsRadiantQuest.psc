Scriptname CompanionsRadiantQuest extends Quest Conditional

Quest Property ParentQuest auto
ReferenceAlias Property Questgiver auto
ReferenceAlias Property MapMarker auto
bool Property IsRegistered = false auto
int Property RewardAmount = 100 auto
bool Property Succeeded = false auto
bool Property Premature = false auto

Function Setup() native
Function Accepted() native
Function Rejected() native
Function Finished(bool _succeeded = true, bool _finished = true) native
Function Cleanup() native
Function PrematureShutdown() native
