Scriptname _SHPlayerScript extends ReferenceAlias

_SunHelmMain Property _SHMain auto
PRKF__SHMiscActivations_052EE749 Property _SHActivations auto
FormList Property _SHAlcoholList auto
FormList Property _SHSkoomaList auto
FormList Property _ShBlackBooks auto
FormList Property _SHCampfireBackPacks auto
bool Property stopUpdating = false auto
Keyword Property _SH_AlcoholDrinkKeyword auto
Spell Property _SHSkoomaSpell auto
GlobalVariable Property _SHIsRidingDragon auto
GlobalVariable Property _SHEnabled auto
GlobalVariable Property _SHDisableFT auto
GlobalVariable Property _SHIsLichGlobal auto
GlobalVariable Property _SHIsInDialogue auto
GlobalVariable Property _SHForceDisableCold auto
GlobalVariable Property _SHWaterskinEquip auto
GlobalVariable Property _SHIsVR auto
GlobalVariable Property _SHVampireNeedsOption Auto
GlobalVariable Property _SHHungerShouldBeDisabled auto
GlobalVariable Property _SHThirstShouldBeDisabled auto
GlobalVariable Property _SHFatigueShouldBeDisabled auto
GlobalVariable Property _SHColdShouldBeDisabled auto
GlobalVariable Property _SHInnKeeperDialogue auto
GlobalVariable Property _SHModShouldBeEnabled Auto
GlobalVariable Property _SHBedrollSleep auto
Spell Property _SHBeverageWarmthSpell auto
GlobalVariable Property _SHColdActive auto
Keyword Property _SHHotBeverage auto
FormList Property _SHHotBeverageList auto
FormList Property _SHLichRaceList auto
Actor Property Player auto

Function UpdateActivationPerk() native
Function CheckNeedsDisabled() native
Function Update() native
Function CheckFT() native
bool Function AlcoholCheck() native
Function HotBeverageCheck() native
bool Function CheckLich() native
bool Function SkoomaCheck() native
