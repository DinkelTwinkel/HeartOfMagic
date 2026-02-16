Scriptname _SHWidgetScript extends SKI_WidgetBase

_SunHelmMain Property _SHMain auto
GlobalVariable Property _SHCurrentHungerLevel auto
GlobalVariable Property _SHCurrentThirstLevel auto
GlobalVariable Property _SHCurrentFatigueLevel auto
GlobalVariable Property _SHToggleWidgets Auto
GlobalVariable Property _SHWidgetOrientation Auto
GlobalVariable Property _SHWidgetPreset Auto
GlobalVariable Property _SHWidgetDisplayType Auto
GlobalVariable Property _SHWidgetXOffset Auto
GlobalVariable Property _SHWidgetYOffset Auto
Bool Property Enabled auto
int Property WidgetX auto
int Property WidgetY auto

String Function GetWidgetSource() native
String Function GetWidgetType() native
Function UpdateWidget() native
int Function SetLevel(int NeedStage) native
int Function SetPercent(int NeedStage) native
