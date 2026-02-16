Scriptname Ingredient extends Form

bool Function IsHostile() native
Function LearnEffect(int aiIndex) native
int Function LearnNextEffect() native
Function LearnAllEffects() native
int Function GetNumEffects() native
float Function GetNthEffectMagnitude(int index) native
int Function GetNthEffectArea(int index) native
int Function GetNthEffectDuration(int index) native
MagicEffect Function GetNthEffectMagicEffect(int index) native
int Function GetCostliestEffectIndex() native
Function SetNthEffectMagnitude(int index, float value) native
Function SetNthEffectArea(int index, int value) native
Function SetNthEffectDuration(int index, int value) native
bool Function GetIsNthEffectKnown(int index) native
float[] Function GetEffectMagnitudes() native
int[] Function GetEffectAreas() native
int[] Function GetEffectDurations() native
MagicEffect[] Function GetMagicEffects() native
