Scriptname _SHThirstSystem extends _SHSystemBase

int Property _SHThirstStage0 auto
int Property _SHThirstStage1 auto
int Property _SHThirstStage2 auto
int Property _SHThirstStage3 auto
int Property _SHThirstStage4 auto
int Property _SHThirstStage5 auto
Potion Property _SHWaterBottleMead auto
Spell Property _SHThirstSpell1 Auto
Spell Property _SHThirstSpell2 Auto
Spell Property _SHThirstSpell3 Auto
Spell Property _SHThirstSpell4 Auto
Spell Property _SHThirstSpell5 Auto
Spell Property _SHThirstSpell6 Auto
Message Property _SHThirstMessage0 auto
Message Property _SHThirstMessage1 auto
Message Property _SHThirstMessage2 auto
Message Property _SHThirstMessage3 auto
Message Property _SHThirstMessage4 auto
Message Property _SHThirstMessage5 auto
Message Property _SHThirstTut auto
Message Property _SHThirstMessage0First auto
Message Property _SHThirstMessage1First auto
Message Property _SHThirstMessage2First auto
Message Property _SHThirstMessage3First auto
Message Property _SHThirstMessage4First auto
Message Property _SHThirstMessage5First auto
Sound Property _SHThirstSoundsF auto
Sound Property _SHThirstSoundsM auto
GlobalVariable Property _SHThirstTutEnabled auto
GlobalVariable Property _SHFirstTimeEnabled auto
GlobalVariable Property _SHWaterskinAdded auto
GlobalVariable Property _SHIsVampireGlobal auto

Function StartSystem() native
Function StopSystem() native
Function UpdateNeed() native
Function GetNewSystemStage() native
Function ApplySystemEffects() native
Function RemoveSystemEffects() native
Function IncrementThirstLevel() native
Function DecreaseThirstLevel(float decAmount) native
Function IncreaseThirstLevel(float incAmount) native
Function SetValuesOnStoryServed(Location akLocation) native
int Function GetThirstPercent() native
Function PauseUpdates() native
Function ResumeUpdates() native
Function SetTimeStamps() native
