Scriptname _SHFatigueSystem extends _SHSystemBase

int Property _SHFatigueStage0 auto
int Property _SHFatigueStage1 auto
int Property _SHFatigueStage2 auto
int Property _SHFatigueStage3 auto
int Property _SHFatigueStage4 auto
int Property _SHFatigueStage5 auto
keyword Property LocTypePlayerHouse auto
Spell Property _SHFatigueSpell1 auto
Spell Property _SHFatigueSpell2 auto
Spell Property _SHFatigueSpell3 auto
Spell Property _SHFatigueSpell4 auto
Spell Property _SHFatigueSpell5 auto
Spell Property _SHFatigueSpell6 auto
spell Property WellRested auto
spell Property Rested auto
Message Property _SHFatigue0 auto
Message Property _SHFatigue1 auto
Message Property _SHFatigue2 auto
Message Property _SHFatigue3 auto
Message Property _SHFatigue4 auto
Message Property _SHFatigue5 auto
Message Property _SHFatigueTut auto
Message Property _SHFatigue0First auto
Message Property _SHFatigue1First auto
Message Property _SHFatigue2First auto
Message Property _SHFatigue3First auto
Message Property _SHFatigue4First auto
Message Property _SHFatigue5First auto
Message Property _SHBedroll auto
Message Property _SHBedrollFirst auto
Sound Property _SHFatigueSoundsF auto
Sound Property _SHFatigueSoundsM auto
quest Property PlayerSleepQuest auto
quest Property RelationshipMarriageFIN auto
quest Property BYOHRelationshipAdoption auto
referencealias Property LoveInterest auto
spell Property MarriageRested auto
locationalias Property CurrentHomeLocation auto
message Property BYOHAdoptionRestedMessageMale auto
message Property BYOHAdoptionRestedMessageFemale auto
spell Property BYOHAdoptionSleepAbilityMale auto
spell Property BYOHAdoptionSleepAbilityFemale auto
message Property MarriageRestedMessage auto
GlobalVariable Property _SHFatigueTutEnabled auto
GlobalVariable Property _SHFatigueSleepRestoreAmount auto
GlobalVariable Property _SHBedrollSleep auto

Function DetectSleepStart(float afSleepStartTime) native
Function DetectSleepStop() native
Function StartSystem() native
Function StopVanillaSleep() native
Function ApplySpouseAdoptionBonuses() native
Function StopSystem() native
Function UpdateNeed() native
Function ApplySystemEffects() native
Function RemoveSystemEffects() native
Function GetNewSystemStage() native
Function IncrementFatigueLevel() native
Function IncreaseFatigueLevel(float amount) native
float Function GetSleepDecreaseAmount() native
Function DecreaseFatigueLevel(float decAmount) native
Function SetFatigueLevel(float amount) native
int Function GetFatiguePercent() native
Function PauseUpdates() native
Function ResumeUpdates() native
Function SetValuesOnStoryServed(Location akLocation) native
Function SetTimeStamps() native
