Scriptname _SHWeatherSystem extends Quest

Actor Property PlayerRef auto
FormList Property _SHColdCloudyWeather auto
FormList Property _SHBlizzardWeathers auto
Weather Property DLC02VolcanicAshStorm01 auto
Weather Property CurrentWeather auto
GlobalVariable Property _SHCurrentRegionInt Auto
GlobalVariable Property _SHWeatherTemperature auto

Function StartSystem() native
Function StopSystem() native
Function ForceUpdate() native
int Function CalculateWeatherTemp(Weather calcWeather) native
Weather Function GetRealCurrentWeather() native
