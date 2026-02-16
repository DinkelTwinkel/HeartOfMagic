Scriptname SKI_WidgetBase extends SKI_QuestBase

String Property WidgetName = "I-forgot-to-set-the-widget name" auto
Bool Property RequireExtend = true auto
String Property HAnchor auto
Float Property Y auto
Float Property X auto
String Property HUD_MENU auto
String Property VAnchor auto
Float Property Alpha auto
Int Property WidgetID auto
Bool Property Ready auto
String Property WidgetRoot auto
String[] Property Modes auto

Function TweenTo(Float a_x, Float a_y, Float a_duration) native
Function UpdateWidgetVAnchor() native
String Function GetWidgetType() native
Function OnGameReload() native
Float[] Function GetDimensions() native
Function UpdateWidgetHAnchor() native
Function FadeTo(Float a_alpha, Float a_duration) native
Bool Function IsExtending() native
Function TweenToX(Float a_x, Float a_duration) native
Function UpdateWidgetClientInfo() native
Function OnWidgetLoad() native
Function UpdateWidgetPositionY() native
Function OnInit() native
Function UpdateWidgetModes() native
Function UpdateWidgetPositionX() native
Function OnWidgetInit() native
Function UpdateWidgetAlpha() native
Function OnWidgetManagerReady(String a_eventName, String a_strArg, Float a_numArg, Form a_sender) native
String Function GetWidgetSource() native
Function OnWidgetReset() native
Function TweenToY(Float a_y, Float a_duration) native
