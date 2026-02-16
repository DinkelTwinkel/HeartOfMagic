Scriptname _SH_MCMScript extends SKI_ConfigBase

_SunHelmMain Property _SHMain auto
_SHWidgetScript Property _SHWidget auto
GlobalVariable Property _SHMessagesEnabled auto
GlobalVariable Property _SHNeedsDeath auto
GlobalVariable Property _SHDisableFT auto
GlobalVariable Property _SHEnabled Auto
GlobalVariable Property _SHCannibalism auto
GlobalVariable Property _SHDrunkSkoomaFX auto
GlobalVariable Property _SHColdFX auto
GlobalVariable Property _SHHungerTutEnabled auto
GlobalVariable Property _SHThirstTutEnabled auto
GlobalVariable Property _SHFatigueTutEnabled auto
GlobalVariable Property _SHHungerShouldBeDisabled auto
GlobalVariable Property _SHThirstShouldBeDisabled auto
GlobalVariable Property _SHFatigueShouldBeDisabled auto
GlobalVariable Property _SHColdShouldBeDisabled auto
GlobalVariable Property _SHRateGoal auto
GlobalVariable Property _SHToggleSounds auto
GlobalVariable Property _SHAnimationsEnabled auto
GlobalVariable Property _SHGiveBottles auto
GlobalVariable Property _SHFirstPersonMessages auto
GlobalVariable Property _SHForceDisableCold auto
GlobalVariable Property _SHColdWidgetX Auto
GlobalVariable Property _SHColdWidgetY Auto
GlobalVariable Property _SHHideColdWidget auto
GlobalVariable Property _SHRawDamage auto
GlobalVariable Property _SHCarryWeight auto
GlobalVariable Property _SHCampfireSkillTreeInstalled auto
GlobalVariable Property _SHWaterskinEquip auto
GlobalVariable Property _SHRefillAnims auto
GlobalVariable Property _SHDetailedContinuance auto
GlobalVariable Property _SHContinuance1Line auto
GlobalVariable Property _SHSeasonsEnabled auto
GlobalVariable Property _SHPauseNeedsCombat auto
GlobalVariable Property _SHPauseNeedsDialogue auto
GlobalVariable Property _SH_PerkRank_Hydrated auto
GlobalVariable Property _SH_PerkRank_Slumber auto
GlobalVariable Property _SH_PerkRank_ThermalIntensity auto
GlobalVariable Property _SH_PerkRank_Connoisseur auto
GlobalVariable Property _SH_PerkRank_Reservoir auto
GlobalVariable Property _SH_PerkRank_Repose auto
GlobalVariable Property _SH_PerkRank_AmbientWarmth auto
GlobalVariable Property _SH_PerkRank_Conviviality auto
GlobalVariable Property _SH_PerkRank_Unyielding auto
GlobalVariable Property _SHHungerRate auto
GlobalVariable Property _SHThirstRate auto
GlobalVariable Property _SHFatigueRate auto
GlobalVariable Property _SHWaterskinLocation auto
GlobalVariable Property _SHPauseNeedsOblivion auto
GlobalVariable Property _SHWerewolfPauseNeeds auto
GlobalVariable Property _SHWerewolfFatigue auto
GlobalVariable Property _SHWidgetXOffset Auto
GlobalVariable Property _SHWidgetYOffset Auto
GlobalVariable Property _SHToggleWidgets Auto
GlobalVariable Property _SHFillHotKey Auto
GlobalVariable Property _SHContHotKey Auto
GlobalVariable Property _SHWidgetHotKey Auto
GlobalVariable Property _SHTutorials Auto
GlobalVariable Property _SHWidgetOrientation Auto
GlobalVariable Property _SHWidgetPreset Auto
GlobalVariable Property _SHWidgetDisplayType Auto
GlobalVariable Property _SHNumDrinks Auto
GlobalVariable Property _SHWerewolfFeedOptions Auto
GlobalVariable Property _SHVampireNeedsOption Auto
GlobalVariable Property _SHInnKeeperDialogue Auto
GlobalVariable Property _SHEatDrinkHotkey Auto
GlobalVariable Property _SHModShouldBeEnabled Auto
GlobalVariable Property _SHIsVampireGlobal auto
Actor Property PlayerRef auto
string Property Ext = ".json" AutoReadOnly
string Property ConfigDir auto
string Property DefaultFile auto

int Function GetVersion() native
Function SetDefaultValues() native
Function SaveSettings(string a_path) native
Function LoadSettings(string a_path) native
Function PopulateBrowseFileEntries() native
Function RefundSkillPoints() native
Function ClearSurvivalPerks() native
Function CheckToggleMod() native
Function ApplyModStatus() native
