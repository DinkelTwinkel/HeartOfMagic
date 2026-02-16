Scriptname Survival_NeedExhaustion extends Survival_NeedBase

Message Property Survival_HelpExhaustionHigh auto
GlobalVariable Property Survival_HelpShown_Exhaustion auto
ReferenceAlias Property PlayerAlias auto
FormList Property Survival_ExhaustionResistRacesMajor auto
FormList Property Survival_ExhaustionResistRacesMinor auto
GlobalVariable Property Survival_RacialBonusMajor auto
GlobalVariable Property Survival_RacialBonusMinor auto
GlobalVariable Property Survival_AfflictionExhaustionChance auto
Spell Property Survival_AfflictionAddled auto
Spell Property Survival_DiseaseBrownRot auto
Spell Property Survival_DiseaseBrownRot2 auto
Spell Property Survival_DiseaseBrownRot3 auto
Spell Property VampireVampirism auto
Spell Property WerewolfImmunity auto
Message Property Survival_AfflictionAddledMsg auto
Quest Property PlayerSleepQuest auto
Quest Property RelationshipMarriageFIN auto
Quest Property BYOHRelationshipAdoption auto
Spell Property Rested auto
Spell Property WellRested auto
Spell Property MarriageSleepAbility auto
Spell Property BYOHAdoptionSleepAbilityMale auto
Spell Property BYOHAdoptionSleepAbilityFemale auto
Spell Property pDoomLoverAbility auto
Keyword Property LocTypeInn auto
Keyword Property LocTypePlayerHouse auto
ReferenceAlias Property LoveInterest Auto
LocationAlias Property CurrentHomeLocation Auto
Message Property BeastBloodMessage auto
Message Property MarriageRestedMessage auto
Message Property WellRestedMessage auto
Message Property RestedMessage auto
Message Property BYOHAdoptionRestedMessageMale auto
Message Property BYOHAdoptionRestedMessageFemale auto
CompanionsHousekeepingScript Property CHScript Auto
Spell[] Property needSpellsNoDisease auto

Function StartNeed() native
Function SetNeedStageValues() native
Function StopNeed() native
Function NeedUpdateGameTime() native
Function IncreaseExhaustion(float amount) native
Function DecreaseExhaustion(float amount, bool qualitySleep = false) native
Function ApplyExhaustionStage(float newExhaustionValue, float oldExhaustionValue, bool canGetRestedBonus) native
float Function IncrementNeedByTick(float rateReductionMultiplier = 0.0) native
bool Function CanGetRestedBonus(bool showMessages = false) native
bool Function PlayerIsVampireOrWerewolf() native
Function SelectCorrectEffects() native
Function SwitchToNoDiseaseEffects() native
Function SwitchToDiseaseEffects() native
float Function GetBrownRotEffectMult() native
Function RemoveAllNeedSpells() native
Function ApplyNormalRestedBonus() native
Function ApplyAdoptionBonus() native
Function RemoveAdoptionRested() native
Function UpdateAttributePenalty(float afNeedValue, string asAttributeAV = "", string asPenaltyAV = "") native
Function ClearAttributePenalty(string asPenaltyAV = "") native
