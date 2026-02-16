Scriptname _SHColdWidgetScript extends SKI_WidgetBase

GlobalVariable Property _SHUITempLevel Auto
GlobalVariable Property _SHColdWidgetX Auto
GlobalVariable Property _SHColdWidgetY Auto
GlobalVariable Property _SHHideColdWidget auto
_SunHelmMain Property _SHMain auto
Bool Property Enabled auto

String Function GetWidgetSource() native
String Function GetWidgetType() native
Function UpdateWidget() native
