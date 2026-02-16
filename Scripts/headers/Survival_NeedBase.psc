Scriptname Survival_NeedBase extends Quest

Actor Property PlayerRef auto
Survival_ConditionsScript Property conditions auto
Spell[] Property needSpells auto
Message[] Property needMessagesWhenIncreasing auto
Message[] Property needMessagesWhenDecreasing auto
GlobalVariable Property NeedUpdateGameTimeInterval auto
GlobalVariable Property NeedValue auto
GlobalVariable Property PenaltyPercentGlobal auto
GlobalVariable Property NeedRate auto
GlobalVariable Property NeedMaxValue auto
GlobalVariable Property Survival_NeedSleepReducedMetabolismMult auto
GlobalVariable Property Survival_ExhaustionOverEncumberedMult auto
Spell Property AttributePenaltySpell auto
MagicEffect Property AttributePenaltyEffect auto
ReferenceAlias Property PlayerDialogueTarget auto
GlobalVariable Property Survival_PlayerLastKnownDaysJailed auto
GlobalVariable Property Survival_WasLastNearbyTravelRef auto
Sound[] Property needSoundFXs auto
Sound[] Property needSoundFXsFemale auto
float[] Property needRumbleSmallMotorStrengths auto
float[] Property needRumbleBigMotorStrengths auto
float[] Property needRumbleDurations auto
bool[] Property needPlaySoundFXsOnImprove auto
bool[] Property needPlayRumblesOnImprove auto

Function StartNeed() native
Function StopNeed() native
Function SetInOblivion(bool inOblivion = true) native
Function WaitForUnlock() native
float Function IncrementNeed(float currentNeedValue, float amountToIncrementBy, float maxValue = -1.0) native
float Function DecrementNeed(float currentNeedValue, float amountToDecrementBy, float customMinValue = -1.0, float customMaxValue = -1.0) native
float Function GetAmountToIncrementBy(int ticks, float rateReductionMultiplier) native
float Function GetNeedRatePerTick() native
float Function GetTotalAV(string asAttributeAV, string asPenaltyAV) native
Function ClearAttributePenalty(string asPenaltyAV = "") native
Function HandleAttributeDiseaseApply(Spell akDisease, ActiveMagicEffect akEffectToDispel, Actor akTarget) native
Function UpdateAttributePenalty(float afNeedValue, string asAttributeAV = "", string asPenaltyAV = "") native
Function ApplyAttributePenalty(float afTotalAV, float afNeedValue, string asAttributeAV, string asPenaltyAV) native
Function QueuePenaltySpellReApply() native
float Function GetMaxStageValue(int maxStageId) native
int Function GetTicks(float currentTimeInGameHours, float lastTimeInGameHours) native
Function ApplyNeedStagePlayerEffects(bool increasing, Spell stageSpell, Message stageMessage, message stageMessageOnDecrease = None) native
Function ApplyNeedSFX(bool increasing, Sound sfx, Sound sfxFemale = None, bool applyOnDecrease = false) native
Function ApplyNeedRumble(bool increasing, float rumbleSmall = -1.0, float rumbleBig = -1.0, float rumbleDuration = -1.0, bool applyOnDecrease = false) native
bool Function IsTalkingToNPC() native
Function NeedUpdateGameTime() native
Function RemoveAllNeedSpells() native
Function SetNeedStageValues() native
Function BaseScriptExtensionError(string functionName) native
