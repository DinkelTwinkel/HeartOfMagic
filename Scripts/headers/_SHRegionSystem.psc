Scriptname _SHRegionSystem extends Quest

GlobalVariable Property _SHRateGoal auto
GlobalVariable Property _SHColdActive auto
GlobalVariable Property _SHColdFX auto
GlobalVariable Property _SHUITempLevel Auto
GlobalVariable Property _SHForceDisableCold auto
GlobalVariable Property _SHCurrentRegionInt auto
GlobalVariable Property _SHSeasonsEnabled auto
GlobalVariable Property _SHFreezingTemp auto
GlobalVariable Property _SHCoolTemp auto
GlobalVariable Property _SHReachTemp auto
GlobalVariable Property _SHComfTemp auto
GlobalVariable Property _SHMarshTemp auto
GlobalVariable Property _SHVolcanicTemp auto
GlobalVariable Property _SHThroatFreezeTemp auto
GlobalVariable Property _SHWarmTemp auto
GlobalVariable Property GameMonth auto
GlobalVariable Property _SHInInteriorType auto
GlobalVariable Property _SHRegionTemperature auto
Weather Property DLC02VolcanicAshStorm01 auto
FormList Property _SHColdInteriors auto
FormList Property _SHInteriorWorldSpaces Auto
FormList Property _SHColdCloudyWeather auto
FormList Property _SHBlizzardWeathers auto
_SHCompatabilityScript Property Compat auto
_SunHelmMain Property _SHMain auto
bool Property freezingRegion = false auto
bool Property comfRegion = false auto
bool Property coolRegion = false auto
bool Property pineRegion = false auto
bool Property highHrothgarRegion = false auto
bool Property marshRegion = false auto
bool Property volcanicRegion = false auto
bool Property throatRegion = false auto
bool Property reachRegion = false auto
Float[] Property SeasonMult auto
Spell Property _SHRegionSpell auto
Actor Property PlayerRef auto
int Property CurrentRegion auto
int Property CurrentMonth auto

Function StartSystem() native
Function StopSystem() native
Function UpdateCurrentRegionTemp() native
int Function CalculateRegionTemp() native
int Function MakeUnknownRegionGuess() native
