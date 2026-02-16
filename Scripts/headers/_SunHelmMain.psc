Scriptname _SunHelmMain extends Quest

_SH_MCMScript Property _SHMcm auto
_SHPlayerScript Property _SHPlayer auto
Quest Property _SHStart auto
Quest Property _SHDialogueQuest auto
Actor Property Player auto
Activator Property _SH_Survival_NodeController auto
GlobalVariable Property _SHEnabled Auto
GlobalVariable Property _SHDisableFT auto
GlobalVariable Property _SHTutsEnabled auto
GlobalVariable Property _SHFirstTimeEnabled auto
GlobalVariable Property _SHCannibalism auto
GlobalVariable Property _SHRawDamage auto
GlobalVariable Property _SHCarryWeight auto
GlobalVariable Property _SHHungerShouldBeDisabled auto
GlobalVariable Property _SHThirstShouldBeDisabled auto
GlobalVariable Property _SHFatigueShouldBeDisabled auto
GlobalVariable Property _SHColdShouldBeDisabled auto
GlobalVariable Property _SHFirstPersonMessages auto
GlobalVariable Property _SHIsLichGlobal auto
GlobalVariable Property _SHAnimationsEnabled auto
GlobalVariable Property _SHForceDisableCold auto
GlobalVariable Property _SHRefillAnims auto
GlobalVariable Property _SHIsSexMale auto
GlobalVariable Property _SHContinuance1Line auto
GlobalVariable Property _SHDetailedContinuance auto
GlobalVariable Property _SHVampireNeedsOption Auto
GlobalVariable Property _SHNumDrinks Auto
GlobalVariable Property _SHIsVampireGlobal auto
GlobalVariable Property _SHIsInWater auto
GlobalVariable Property _SHIsVR auto
WorldSpace Property Tamriel Auto
WorldSpace Property DLC2SolstheimWorld Auto
WorldSpace Property BSHeartland auto
WorldSpace Property Wyrmstooth auto
Spell Property _SHConfigSpell Auto
Spell Property _SHPlayerSpell auto
Spell Property _SHContinuanceSpell auto
Spell Property _SHFillAllSpell auto
Spell Property _SHDrunkSpell auto
Spell Property _SHSkoomaSpell auto
Spell Property _SHFoodPoisoningSpell auto
Ingredient Property SaltPile Auto
_SHHungerSystem Property Hunger Auto
_SHThirstSystem Property Thirst Auto
_SHFatigueSystem Property Fatigue Auto
_SHCompatabilityScript Property ModComp auto
_SHColdSystem Property Cold auto
Message Property _SHSleepStartMessage Auto
Message Property _SHStandWater auto
Message Property _SHStandWaterFirst auto
LeveledItem Property LItemFoodInnCommon auto
LeveledItem Property LItemBarrelFoodSame75 auto
LeveledItem Property DLC2LootBanditRandom auto
LeveledItem Property LootBanditRandom auto
LeveledItem Property LootBanditRandomWizard auto
LeveledItem Property _SHLLWaterSkin15 auto
LeveledItem Property _SHLLWater15 auto
LeveledItem Property _SHLLWater25 auto
Potion Property _SHWaterBottleMead auto
Potion Property _SHWaterBottleWine auto
Potion Property _SHWaterskin_1 auto
Potion Property _SHWaterskin_2 auto
Potion Property _SHWaterskin_3 auto
Potion Property _SHWaterskinSalt auto
Potion Property _SHSujammaWaterBottle auto
Potion Property _SHSaltBottleMead auto
Potion Property _SHSaltBottleWine auto
Potion Property _SHSaltBottleSujamma auto
MiscObject Property _SHEmptyMeadMisc auto
MiscObject Property _SHEmptyWineMisc auto
MiscObject Property _SHEmptySujammaMisc auto
bool Property SkyrimVR auto
Sound Property _SHDrink auto
Sound Property _SHFillWaterM auto
Perk Property UndeathLichPerk auto
bool Property SKSEInstalled = false auto
bool Property BeastWerewolf auto
bool Property HumanWerewolf auto
bool Property VampireThirst = true auto
bool Property CampfireInstalled = false auto
bool Property introMessageShown = false auto
bool Property MCMCannibal = false auto
bool Property HasFoodPoison = false auto
int Property SKSEVersion auto
MiscObject Property _SHMeadEmptyMisc auto
MiscObject Property _SHWineEmptyMisc auto
MiscObject Property _SHWaterskinEmpty auto
Perk Property _SHCannibalPerks auto
Perk Property _SHMiscActivations auto
Float Property WidgetAlphaLevel = 100.00 auto
int Property _SHDrinksConsumed auto
Idle Property idlepickup_ground Auto
Idle Property IdleStop_Loose Auto
Keyword Property IsBeastRace auto
Keyword Property _SH_LightFoodKeyword auto
Keyword Property _SH_MediumFoodKeyword auto
Keyword Property _SH_HeavyFoodKeyword auto
Keyword Property _SH_SoupKeyword auto
Keyword Property _SH_MeadBottleKeyword auto
Keyword Property _SH_WineBottleKeyword auto
Keyword Property _SH_SujammaBottleKeyword auto
Keyword Property _SH_MeadWATERBottleKeyword auto
Keyword Property _SH_WineWATERBottleKeyword auto
Keyword Property _SH_SujammaWATERBottleKeyword auto
Keyword Property _SH_DrinkKeyword auto
Keyword Property _SH_AlcoholDrinkKeyword auto
Keyword Property _SHSaltWaterKeyword auto
Keyword Property VendorItemFoodRaw auto
Race Property WoodElfRace auto
float Property ModVersion auto
bool Property isInOblivion auto
FormList Property _SHOblivionWorlds auto
FormList Property _SHOblivionLctns auto
FormList Property _SHOblivionCells auto
bool Property wasInOblivion = false auto
string Property NoSKSE = "SKSE NOT INSTALLED. SUNHELM MAY NOT FUNCTION PROPERLY" auto
string Property NoSkyUI = "SkyUI not installed. A limited config spell can be used to start the mod, but settings wont be available." auto
Bool Property InWater auto

Function CheckForUpdate() native
Function CheckGameInfo() native
Function StartMod() native
Function StopMod() native
Function ModStartPowersPerks() native
Function ModStartPlayerUpdates() native
Function ModStartSystems() native
Function ModStartCannibalism() native
Function HandleModStartDiseases() native
Function HandleModStopDiseases() native
Function RemovePowersAndEffects() native
Function AddPowers() native
Function DrinkAndFill() native
Function AlcoholDrink() native
Function ResetDrinkCount() native
Function ContinuancePower() native
Function AddDrinksAndOthersToList() native
Function RemoveDrinksFromList() native
Function PlayFillAnimation(bool playFillSound = true) native
bool Function IsInSaltwater() native
Function VampireChangeNeeds(int option) native
Function LichChangeNeeds(int option) native
Function StartSystems() native
Function StopSystems() native
Function PauseNeeds() native
Function ResumeNeeds() native
Function UpdateAllTimeStamps() native
Function StopThirst() native
Function StopHunger() native
Function StopFatigue() native
Function StopCold() native
Function StartCold() native
Function StartFatigue() native
Function StartHunger() native
Function StartThirst() native
