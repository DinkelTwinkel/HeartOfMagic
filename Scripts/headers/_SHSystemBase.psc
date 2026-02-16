Scriptname _SHSystemBase extends Quest

Actor Property Player auto
GlobalVariable Property _SHUpdateInterval Auto
GlobalVariable Property _SHHungerRate auto
GlobalVariable Property _SHThirstRate Auto
GlobalVariable Property _SHFatigueRate Auto
GlobalVariable Property _SHCurrentHungerLevel Auto
GlobalVariable Property _SHCurrentThirstLevel Auto
GlobalVariable Property _SHCurrentFatigueLevel Auto
GlobalVariable Property _SHCurrentColdLevel Auto
GlobalVariable Property _SHMessagesEnabled auto
GlobalVariable Property _SHNeedsDeath auto
GlobalVariable Property _SHHungerTimeStamp Auto
GlobalVariable Property _SHFatigueTimeStamp Auto
GlobalVariable Property _SHThirstTimeStamp Auto
GlobalVariable Property _SHColdLastTimeStamp Auto
GlobalVariable Property _SHColdCurrentTimeStamp Auto
GlobalVariable Property _SHHungerShouldBeDisabled auto
GlobalVariable Property _SHThirstShouldBeDisabled auto
GlobalVariable Property _SHFatigueShouldBeDisabled auto
GlobalVariable Property _SHColdShouldBeDisabled auto
GlobalVariable Property _SHIsSexMale auto
GlobalVariable Property _SHToggleSounds auto
GlobalVariable Property _SHFirstPersonMessages auto
GlobalVariable Property _SHIsInDialogue auto
GlobalVariable Property _SH_PerkRank_Hydrated auto
GlobalVariable Property _SH_PerkRank_Slumber auto
GlobalVariable Property _SH_PerkRank_ThermalIntensity auto
GlobalVariable Property _SH_PerkRank_Connoisseur auto
GlobalVariable Property _SH_PerkRank_Reservoir auto
GlobalVariable Property _SH_PerkRank_Repose auto
GlobalVariable Property _SH_PerkRank_AmbientWarmth auto
GlobalVariable Property _SH_PerkRank_Conviviality auto
GlobalVariable Property _SHPauseNeedsCombat auto
GlobalVariable Property _SHPauseNeedsDialogue auto
GlobalVariable Property _SHPauseNeedsOblivion auto
GlobalVariable Property _SHTutorials Auto
GlobalVariable Property _SHWerewolfPauseNeeds auto
bool Property FastTravelled = false auto
_SunHelmMain Property _SHMain auto
bool Property HungerWasSleeping = false auto
bool Property ThirstWasSleeping = false auto
bool Property PauseForCombat auto
bool Property PauseForDialogue auto
bool Property PauseForOblivion auto
bool Property PauseForBeastForm auto

Function StartSystem() native
Function StopSystem() native
Function PauseUpdates() native
Function ResumeUpdates() native
bool Function IsBetween(float checkVal, int valOne, int valTwo) native
int Function Round(float number) native
Function DisplayNotifications(Message first, Message third) native
Function ApplyFx(Sound male, Sound female) native
Function UpdateNeed() native
Function RemoveSystemEffects() native
Function SetValuesOnStoryServed(Location akLocation) native
Function SetTimeStamps() native
