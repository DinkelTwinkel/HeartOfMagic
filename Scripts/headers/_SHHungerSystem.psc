Scriptname _SHHungerSystem extends _SHSystemBase

int Property _SHHungerStage0 auto
int Property _SHHungerStage1 auto
int Property _SHHungerStage2 auto
int Property _SHHungerStage3 auto
int Property _SHHungerStage4 auto
int Property _SHHungerStage5 auto
Spell Property _SHHungerSpell1 auto
Spell Property _SHHungerSpell2 auto
Spell Property _SHHungerSpell3 auto
Spell Property _SHHungerSpell4 auto
Spell Property _SHHungerSpell5 auto
Spell Property _SHHungerSpell6 auto
Message Property _SHHunger0 auto
Message Property _SHHunger1 auto
Message Property _SHHunger2 auto
Message Property _SHHunger3 auto
Message Property _SHHunger4 auto
Message Property _SHHunger5 auto
Message Property _SHHungerTut auto
Message Property _SHHunger0First auto
Message Property _SHHunger1First auto
Message Property _SHHunger2First auto
Message Property _SHHunger3First auto
Message Property _SHHunger4First auto
Message Property _SHHunger5First auto
Sound Property _SHHungerSounds auto
GlobalVariable Property _SHHungerTutEnabled auto

Function StartSystem() native
Function StopSystem() native
Function UpdateNeed() native
Function ApplySystemEffects() native
Function RemoveSystemEffects() native
Function ApplyFxGeneric() native
Function GetNewSystemStage() native
Function IncrementHungerLevel() native
Function DecreaseHungerLevel(float decAmount) native
Function SetValuesOnStoryServed(Location akLocation) native
int Function GetHungerPercent() native
Function PauseUpdates() native
Function ResumeUpdates() native
Function SetTimeStamps() native
