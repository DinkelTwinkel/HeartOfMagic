Scriptname _SHHeatDetection extends ReferenceAlias

_SHColdSystem Property Cold auto
FormList Property _SHHeatSourcesAll Auto
FormList Property _SHHeatSourcesSmall Auto
FormList Property _SHHeatSourcesNormal Auto
FormList Property _SHHeatSourcesLarge Auto
GlobalVariable Property _SHNormalSourceRadius auto
GlobalVariable Property _SHSmallSourceRadius auto
GlobalVariable Property _SHCurrentColdLevel Auto
GlobalVariable Property _SHLargeSourceRadius auto
GlobalVariable Property _SHToggleSounds auto
GlobalVariable Property _SHIsSexMale auto
GlobalVariable Property _SHIsNearHeatSource auto
GlobalVariable Property _SHIsInFreezingWater auto
GlobalVariable Property _SH_PerkRank_ThermalIntensity auto
GlobalVariable Property _SHFirstPersonMessages auto
GlobalVariable Property _SHCurrentRegionInt auto
GlobalVariable Property _SHColdLevelCap auto
GlobalVariable Property _SHFreezingTemp auto
GlobalVariable Property _SHRegionTemperature auto
Keyword Property LocTypeInn auto
Message Property _SHFreezingWaterMessage auto
ImageSpaceModifier Property _SHColdISM2 auto
Sound Property _SHMaleFrigid auto
Sound Property _SHFemaleFrigid auto
Actor Property PlayerRef auto
Message Property _SHNearHeatMessage auto
Message Property _SHNearHeatMessageFirst auto
float Property lastTime auto

Function StartSystem() native
Function StopSystem() native
Function Update() native
Function SetNumberOfUpdates() native
Function ApplyHeatSource() native
Function ApplyFreezingWater() native
bool Function SearchForHeatSources() native
bool Function CheckForFreezingWater() native
