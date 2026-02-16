Scriptname CompanionsHousekeepingScript extends Quest Conditional

Faction Property CompanionsFaction auto
MiscObject Property GoldReward auto
int Property GoldRewardMinorAmount auto
int Property GoldRewardModerateAmount auto
int Property GoldRewardMajorAmount auto
Quest Property TrainingQuest auto
ReferenceAlias Property VilkasSword auto
ReferenceAlias Property VilkasQuestSword auto
ReferenceAlias Property CurrentFollower auto
DialogueFollowerScript Property FollowerScript auto
GlobalVariable Property PlayerFollowerCount auto
DarkBrotherhood Property DBScript auto
Actor Property CiceroFollower auto
Actor Property DBInitiateFollower1 auto
Actor Property DBInitiateFollower2 auto
ReferenceAlias Property Skjor auto
ReferenceAlias Property Aela auto
ReferenceAlias Property Farkas auto
ReferenceAlias Property Vilkas auto
ReferenceAlias Property Kodlak auto
ReferenceAlias Property Athis auto
ReferenceAlias Property Njada auto
ReferenceAlias Property Ria auto
ReferenceAlias Property Torvar auto
ReferenceAlias Property Eorlund auto
Faction Property TrainerFaction auto
ReferenceAlias Property TrialObserver auto
Weapon Property VilkasWeapon auto
LeveledItem Property CompanionsArmor auto
LeveledItem Property SkyforgeSteelWeapons auto
ObjectReference Property EorlundVendorChest auto
GlobalVariable Property GearChance auto
ReferenceAlias Property GenericDialogueSuppressor1 auto
ReferenceAlias Property GenericDialogueSuppressor2 auto
ReferenceAlias Property GenericDialogueSuppressor3 auto
ReferenceAlias Property GenericDialogueSuppressor4 auto
GlobalVariable Property PlayerIsWerewolf auto
Quest Property WerewolfChangeTrackingQuest auto
Spell Property WerewolfImmunity auto
Spell Property BeastForm auto
Spell Property HircinesRingPower auto
Race Property PlayerOriginalRace auto
FormList Property PlayableRaceList Auto
FormList Property PlayableVampireList Auto
Race Property ArgonianRace auto
Race Property ArgonianRaceVampire auto
Race Property BretonRace auto
Race Property BretonRaceVampire auto
Race Property DarkElfRace auto
Race Property DarkElfRaceVampire auto
Race Property HighElfRace auto
Race Property HighElfRaceVampire auto
Race Property ImperialRace auto
Race Property ImperialRaceVampire auto
Race Property KhajiitRace auto
Race Property KhajiitRaceVampire auto
Race Property NordRace auto
Race Property NordRaceVampire auto
Race Property OrcRace auto
Race Property OrcRaceVampire auto
Race Property RedguardRace auto
Race Property RedguardRaceVampire auto
Race Property WoodElfRace auto
Race Property WoodElfRaceVampire auto
Shout Property CurrentHowl auto
WordOfPower Property CurrentHowlWord1 auto
WordOfPower Property CurrentHowlWord2 auto
WordOfPower Property CurrentHowlWord3 auto
ReferenceAlias Property RadiantQuestgiver auto
Faction Property CurrentFollowerFaction auto
int Property C04MinLevel auto
CompanionsRadiantQuest Property AelaCurrentQuest auto
CompanionsRadiantQuest Property VilkasCurrentQuest auto
CompanionsRadiantQuest Property FarkasCurrentQuest auto
CompanionsRadiantQuest Property SkjorCurrentQuest auto
CompanionsRadiantQuest Property AelaNextQuest auto
CompanionsRadiantQuest Property VilkasNextQuest auto
CompanionsRadiantQuest Property FarkasNextQuest auto
CompanionsRadiantQuest Property SkjorNextQuest auto
Keyword Property AelaRadiantKeyword auto
Keyword Property SkjorRadiantKeyword auto
Keyword Property VilkasRadiantKeyword auto
Keyword Property FarkasRadiantKeyword auto
Keyword Property ReconRadiantKeyword auto
Quest Property RadiantMiscObjQuest auto
int Property RadiantQuestsUntilC01 auto
int Property RadiantQuestsUntilC03 auto
int Property RadiantQuestsUntilC04 auto
CompanionsStoryQuest Property C01 auto
CompanionsStoryQuest Property C02 auto
CompanionsStoryQuest Property C03 auto
CompanionsStoryQuest Property C04 auto
CompanionsStoryQuest Property C05 auto
CompanionsStoryQuest Property C06 auto
CompanionsRadiantQuest Property CR01 auto
CompanionsRadiantQuest Property CR02 auto
CompanionsRadiantQuest Property CR03 auto
CompanionsRadiantQuest Property CR04 auto
CompanionsRadiantQuest Property CR05 auto
CompanionsRadiantQuest Property CR06 auto
CompanionsRadiantQuest Property CR07 auto
CompanionsRadiantQuest Property CR08 auto
CompanionsRadiantQuest Property CR09 auto
CompanionsRadiantQuest Property CR10 auto
CompanionsRadiantQuest Property CR11 auto
CompanionsRadiantQuest Property CR12 auto
CompanionsRadiantQuest Property CR13 auto
CompanionsRadiantQuest Property CR14 auto
CompanionsStoryQuest Property CurrentStoryQuest auto
int Property AelaQuests auto
int Property FarkasQuests auto
int Property VilkasQuests auto
int Property SkjorQuests auto
LocationAlias Property DustmansCairn auto
LocationAlias Property GallowsRock auto
LocationAlias Property YsgramorsTomb auto

CompanionsRadiantQuest Function GetRadiantQuestFromIndex(int questIndex) native
int Function GetIndexFromRadiantQuest(Quest rQuest) native
Function OnInit() native
Function USSEP_RealSetupCompanions() native
Function SetUpCompanions() native
Function PlayerJoin() native
Function SetPlayerOriginalRace() native
Function OpenSkyforge() native
Function GiveVilkasBackHisSword() native
Function CycleRadiantQuests() native
Function PickRadiantQuest(Actor questgiver) native
Function RegisterRadiantQuest(CompanionsRadiantQuest newRadiant) native
Function AcceptRadiantQuest(Actor questgiver, bool comesAlong) native
Function ShutdownRadiantQuests(Actor exception = None) native
Function ShutdownRadiantQuestsFor(Actor busy) native
Function ReOpenAllRadiantQuests() native
Function KickOffReconQuests() native
int Function CompleteRadiantQuest(CompanionsRadiantQuest rq) native
Actor Function GetFavoriteQuestgiver() native
Function StartStoryQuest(CompanionsStoryQuest storyToStart) native
Function CompleteStoryQuest(CompanionsStoryQuest storyToEnd) native
Function AddHarbingerPerks() native
Function CurePlayer() native
Function Shutup(Actor toBeShut) native
Function UnShutup(Actor toBeUnShut) native
Function SwapFollowers() native
Function CleanupFollowerState() native
