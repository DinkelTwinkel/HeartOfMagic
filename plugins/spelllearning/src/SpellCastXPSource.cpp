#include "SpellCastXPSource.h"

namespace SpellLearning {

// ISLTomeXPSource is deprecated - SpellTomeHook handles tome XP directly in C++
bool ISLTomeXPSource::IsAvailable() const {
    return false;  // No longer used - SpellTomeHook handles this
}

} // namespace SpellLearning
