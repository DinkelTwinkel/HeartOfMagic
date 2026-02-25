#pragma once

#include "XPSource.h"

namespace SpellLearning {

/**
 * SpellCastXPSource - XP from casting spells
 * 
 * Grants XP when the player casts spells. XP amount depends on:
 * - Whether the cast spell is a direct prerequisite of the learning target
 * - Whether the cast spell is from the same school as the learning target
 * - Global XP multiplier settings
 */
class SpellCastXPSource : public BaseXPSource {
public:
    SpellCastXPSource() 
        : BaseXPSource(
            "spell_cast",
            "Spell Casting",
            "Gain XP by casting spells. Casting direct prerequisites grants full XP, same-school spells grant reduced XP."
          )
    {}
    
    void Initialize() override {
        BaseXPSource::Initialize();
        // SpellCastHandler is registered separately in Main.cpp
        // This source just tracks that it's available
        logger::info("SpellCastXPSource: Initialized");
    }

    void Shutdown() override {
        BaseXPSource::Shutdown();
        logger::info("SpellCastXPSource: Shutdown");
    }
    
    int GetPriority() const override { 
        return 100;  // High priority - core XP source
    }
};

/**
 * ISLTomeXPSource - XP from ISL-DESTified tome reading
 * 
 * Only available when ISL-DESTified mod is detected.
 * Grants XP when player reads spell tomes through ISL's system.
 */
class ISLTomeXPSource : public BaseXPSource {
public:
    ISLTomeXPSource()
        : BaseXPSource(
            "isl_tome",
            "Spell Tome Reading (ISL)",
            "Gain XP by reading spell tomes. Requires ISL-DESTified mod. XP based on study time."
          )
    {}
    
    bool IsAvailable() const override;
    
    void Initialize() override {
        if (!IsAvailable()) {
            logger::info("ISLTomeXPSource: ISL-DESTified not detected, source unavailable");
            return;
        }
        BaseXPSource::Initialize();
        logger::info("ISLTomeXPSource: Initialized (ISL-DESTified detected)");
    }

    void Shutdown() override {
        BaseXPSource::Shutdown();
        logger::info("ISLTomeXPSource: Shutdown");
    }
    
    int GetPriority() const override {
        return 50;  // Lower priority than spell casting
    }
};

} // namespace SpellLearning
