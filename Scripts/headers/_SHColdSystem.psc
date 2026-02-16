Scriptname _SHColdSystem extends _SHSystemBase

globalvariable Property TimeScale auto
Keyword Property LocTypeInn auto
keyword Property MagicFlameCloak auto
int Property CurrentColdStage = -1 auto
int Property CurrentColdLevelLimit auto
_SHColdWidgetScript Property ColdWidget auto
_SHRegionSystem Property RegionSys auto
_SHWeatherSystem Property WeatherSys auto
Spell Property _SHColdSpell0 auto
Spell Property _SHColdSpell1 auto
Spell Property _SHColdSpell2 auto
Spell Property _SHColdSpell3 auto
Spell Property _SHColdSpell4 auto
Spell Property _SHColdSpell5 auto
Spell Property _SHSwimDetectionSpell auto
Spell Property _SHFrostResistWarmthSpell auto
int Property _SHColdStage0 auto
int Property _SHColdStage1 auto
int Property _SHColdStage2 auto
int Property _SHColdStage3 auto
int Property _SHColdStage4 auto
int Property _SHColdStage5 auto
_SHHeatDetection Property Heat auto
Message Property _SHColdStageMessage0 auto
Message Property _SHColdStageMessage1 auto
Message Property _SHColdStageMessage2 auto
Message Property _SHColdStageMessage3 auto
Message Property _SHColdStageMessage4 auto
Message Property _SHColdStageMessage5 auto
Message Property _SHColdStageMessage0First auto
Message Property _SHColdStageMessage1First auto
Message Property _SHColdStageMessage2First auto
Message Property _SHColdStageMessage3First auto
Message Property _SHColdStageMessage4First auto
Message Property _SHColdStageMessage5First auto
Message Property _SHEnvMessage0 auto
Message Property _SHEnvMessage1 auto
Message Property _SHEnvMessage2 auto
Message Property _SHEnvMessage3 auto
Message Property _SHEnvMessage4 auto
Message Property _SHEnvMessage5 auto
Message Property _SHWarmerMessage auto
Message Property _SHWarmerMessageFirst auto
Message Property _SHColdTut auto
Message Property _SHComfInteriorMessage auto
GlobalVariable Property _SHRateGoal auto
GlobalVariable Property _SHColdActive auto
GlobalVariable Property _SHColdFX auto
GlobalVariable Property _SHUITempLevel Auto
GlobalVariable Property _SHForceDisableCold auto
GlobalVariable Property _SHIsNearHeatSource auto
GlobalVariable Property _SHIsInFreezingWater auto
GlobalVariable Property _SHColdLevelCap auto
GlobalVariable Property _SHFreezingNightPen auto
GlobalVariable Property _SHCoolNightPen auto
GlobalVariable Property _SHWarmNightPen auto
GlobalVariable Property _SHAmbientTemperature auto
GlobalVariable Property _SHRegionTemperature auto
GlobalVariable Property _SHWeatherTemperature auto
GlobalVariable Property _SHInInteriorType auto
GlobalVariable Property _SHFrigidThreshold auto
GlobalVariable Property _SHIsVR auto
Sound Property _SHMaleFreezing auto
Sound Property _SHMaleFrigid auto
Sound Property _SHFemaleFreezing auto
Sound Property _SHFemaleFrigid auto
Keyword Property Survival_ArmorCold auto
Keyword Property Survival_ArmorWarm auto
ImageSpaceModifier Property _SHColdISM1 auto
ImageSpaceModifier Property _SHColdISM2 auto
ImageSpaceModifier Property _SHColdISM3 auto
bool Property startup = false auto
bool Property waitForColdSleepCheck = false auto
bool Property flameCloak = false auto
Float Property WarmthRatingBonus auto
Float Property ColdPerUpdate auto

Function StartSystem() native
Function StopSystem() native
Function StartSubSystems() native
Function StopSubSystems() native
Function StartUpdates() native
Function UpdateNeed() native
Function SetColdLevelLimit() native
Function UpdateCurrentColdLevel(float warmthResistancePerc) native
Function DecreaseColdLevel(float amount) native
Function IncreaseColdLevel(float amount) native
Function SetCurrentColdTemp() native
int Function CalculateNightPenalty() native
Function ApplyColdEffects() native
Function DisplayNotificationsImod(Message first, Message third, ImageSpaceModifier imod) native
Function SetValuesOnStoryServed(Location akLocation) native
Function ShowEnvironmentMessage() native
Function SetTemperatureUI(float oldVal, float newVal, int forcedValue = 100) native
Function SetColdStage() native
Function RemoveSystemEffects() native
Function SetTimeStamps() native
Function CheckColdDamage() native
float Function GetCurrentWarmthLimit() native
Function SetColdLevel(float amount) native
Float Function GetCurrentHourOfDay() native
int Function VRCalcArmorWarmth(bool MessageRequest = false) native
int Function GetArmorItemWarmth(Armor Item, int EquipLoc) native
