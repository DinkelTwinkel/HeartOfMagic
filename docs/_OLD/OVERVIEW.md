# Heart of Magic — Overview

*Product name: **Heart of Magic**. Project/codebase: SpellLearning (unchanged for compatibility).*

## System Summary

A Skyrim SKSE mod that creates an AI-generated spell learning tree with an active, XP-based progression system. Players must practice prerequisite spells and study spell tomes to unlock new spells through a structured learning path.

---

## Core Concept

**Traditional Skyrim:** Find spell tome → Instantly learn spell

**This System:**
- AI generates a logical spell tree with prerequisites (OpenRouter LLM or Python builder)
- Players set learning targets for spells they want to learn
- Gain XP by casting prerequisite spells and reading tomes
- Spells granted **early but weakened** at 25% progress, scaling to full power at mastery
- Progressive revelation: spell details hidden until XP thresholds reached
- Chip-based settings presets (Default/Easy/Hard + user-created) and scanner presets
- FormID persistence ensures trees survive load order changes

---

## System Architecture

### 1. Spell Scanner & Tree Generation
- Scans all spells from loaded plugins
- Extracts spell properties (school, tier, effects, cost, etc.)
- **Tree build modes (outside developer mode):** **BUILD TREE (Complex)** uses Python NLP + settings-aware JS builder (recommended); **BUILD TREE (Simple)** uses JS-only procedural builder (no Python). Developer mode adds AUTO COMPLEX (Python full tree) and AUTO AI (LLM). See `docs/ARCHITECTURE.md` for flows.
- LLM (AUTO AI) creates prerequisite chains grouped by magic school when used
- **LLM determines XP requirements** for each spell based on:
  - Spell complexity and tier
  - Expected casts needed (considering player will hit targets 70% of time, deal damage 50% of time)
  - Difficulty setting (easy/normal/hard/expert/master) - affects XP multiplier
  - Base XP per cast from configuration
  - Hit/damage/heal/buff bonus multipliers
  - Formula: `requiredXP = (ExpectedCasts * BaseXPPerCast * TierMultiplier) * DifficultyMultiplier`
- **LLM can mark spells as orphaned** (don't fit tree structure)
  - Orphaned spells appear floating in their school (separate from main tree)
  - No prerequisites required - can be learned immediately
  - Still have XP requirements (determined by LLM)
  - Examples: Unique quest reward spells, standalone utility spells, spells with unique mechanics
- Tree saved as JSON for in-game use (includes requiredXP and orphanedSpells)

### 2. Tree Visualization (PrismaUI)
- Interactive spell tree display (configurable hotkey, default F9)
- Radial wheel rendering with school-based sectors
- Visual states: Locked, Available, Learning, Weakened, Practicing, Mastered, Orphaned
- Discovery Mode: hides locked nodes, shows "???" for upcoming spells
- Canvas 2D, WebGL 3D, and 3D globe alternative views
- Visual-First Builder: manual drag-drop tree creation
- Edit Mode: add/remove nodes, modify links in-tree
- LLM-suggested layout styles per school
- **Orphaned spells** appear floating separately (no tree connections)

### 3. Progression System
- **Learning Targets**: Player selects spells to learn (one per school or single mode)
- **XP Tracking**: Per-spell XP progress, saved in SKSE co-save
- **Prerequisites**: Must master prerequisite spells (100% XP) before children become available
- **Early Spell Learning**: Spell granted at 25% progress but **weakened** (20% power)
- **Progressive Effectiveness**: Power scales in 6 discrete steps (Budding → Mastered)
- **Self-Cast Requirement**: After 75% progress, must cast the spell itself for XP
- **Auto-Mastery**: Full power restored at 100%, children unlocked

### 4. XP Sources
- **Self-Cast**: Casting the learning target spell itself (100% XP, no cap)
- **Direct Prerequisites**: Casting direct prereqs of target (100% multiplier, 50% cap)
- **Same School**: Casting same-school spells (50% multiplier, 15% cap)
- **Any Spell**: Casting other school spells (10% multiplier, 5% cap)
- **Spell Tome Reading**: XP grant when reading a tome for a tree spell (25% of required XP)
- **Tome Inventory Bonus**: +25% XP while spell tome in inventory

### 5. Spell Tome Hook
- Intercepts spell tome reading before vanilla script
- When spell is in learning tree: grants XP, sets target, keeps book (doesn't teach)
- When spell is NOT in tree: vanilla behavior (teaches + consumes)

---

## Progression Flow

### Example: Learning Fireball

1. **Prerequisites**: Must master "Flames" and "Firebolt" first (100% XP each)
2. **Set Target**: Player sets "Fireball" as learning target
   - LLM determined: 400 XP required (based on spell complexity and difficulty)
   - Player has learned 6/8 Apprentice Destruction spells → +30% tier mastery bonus
3. **Gain XP** (sources have caps to encourage varied practice):
   - Cast "Firebolt" (direct prereq, 100% multiplier, capped at 50% of required = 200 XP max)
   - Cast other Destruction spells (50% multiplier, capped at 15% of required = 60 XP max)
   - Cast any other spells (10% multiplier, capped at 5% of required = 20 XP max)
   - Read "Fireball" spell tome → instant 25% of required XP = 100 XP
   - Own "Fireball" tome → +25% passive XP bonus while in inventory
   - Remaining XP must come from self-casting Fireball (no cap)
4. **Early Learning**: At 25% (100 XP), spell granted at 20% power ("Budding")
5. **Power Scaling**: 35% → 50% → 65% → 80% power as XP grows
6. **Mastery**: At 100% (400 XP), full power restored, children unlocked

### Example: Learning Orphaned Spell

1. **No Prerequisites**: Orphaned spell "UniqueQuestSpell" has no prerequisites
2. **Set Target**: Player sets "UniqueQuestSpell" as learning target
   - LLM determined: 400 XP required (standalone spell, moderate complexity)
3. **Gain XP**: Cast any spells from same school to gain XP
   - Or cast the spell itself if already known from quest
4. **Learn Spell**: XP reaches 400 → Spell automatically learned

### Key Mechanics

- **One Target Per School**: Can learn multiple spells simultaneously (one per magic school)
- **Progress Saved**: Can switch targets freely, progress is preserved
- **LLM-Determined XP**: Each spell's XP requirement is calculated by LLM based on complexity, difficulty, and expected casts
- **Orphaned Spells**: Some spells don't fit the tree (marked by LLM) - appear floating, no prerequisites needed
- **Tier Mastery**: Learning more spells from previous tier boosts next tier learning (+5% per spell, max +50%)
- **Effective Usage Rewarded**: Combat usage grants more XP than practice casting
- **Broad Exploration Rewarded**: Learning many spells from one tier makes the next tier easier

---

## Technical Implementation

### Event Tracking

**1. Spell Cast Tracking** (`TESSpellCastEvent`)
- Detects when player casts spells
- Grants base XP to learning targets
- Filters for prerequisite spells only

**2. Spell Hit Tracking** (`TESHitEvent`)
- Detects when player spells hit targets
- Grants +50% bonus XP for successful hits
- Distinguishes spell hits from weapon hits

**3. Effect Application Tracking** (`TESMagicEffectApplyEvent`)
- Detects when spell effects are applied
- Identifies effect types (damage, heal, buff)
- Grants appropriate bonus XP (+100% damage/heal, +75% buff)

**4. Recent Cast Tracking**
- Maintains queue of recently cast spells (5 second window)
- Matches hits/effects to originating spells
- Prevents false positives from NPC casts

### DEST Integration (Bundled)

**Don't Eat Spell Tomes (DEST) - Bundled:**
- DEST functionality is bundled with the mod (always available)
- SpellTomeHook intercepts tome reading directly in C++
- No external mod dependency required
- Converts tome reading to XP instead of instant learning

### Data Persistence

**Save Game Data:**
- Per-spell XP progress (all spells, not just active targets)
- Current learning targets per school
- Learned spell FormIDs
- Tome ownership/study status

**Storage:**
- SKSE cosave (serialization interface)
- JSON backup (optional)
- Version tracking for updates

---

## Configuration

### XP System
```yaml
baseXPPerCast: 5.0              # Base XP per spell cast
directPrereqMultiplier: 1.0      # Full XP for direct prerequisites
indirectPrereqMultiplier: 0.5    # 50% XP for indirect prerequisites

# Tier Mastery Bonus
enableTierMasteryBonus: true     # Enable mastery bonus system
tierMasteryMaxBonus: 0.5        # Maximum +50% XP gain from mastery
tierMasteryPerSpellBonus: 0.05  # +5% per spell learned (10 spells = 50%)

bonusXPOnHit: 0.5                # +50% when spell hits target
bonusXPOnDamage: 1.0             # +100% when spell damages enemy
bonusXPOnHeal: 1.0               # +100% when spell heals ally
bonusXPOnBuff: 0.75              # +75% when spell applies buff

tierMultipliers:
  novice: 1.0
  apprentice: 1.5
  adept: 2.0
  expert: 2.5
  master: 3.0
```

### XP Requirements & Difficulty
```yaml
# XP requirements are determined by LLM, not fixed values
# These are fallback defaults if LLM doesn't provide requiredXP
baseXPRequirements:
  novice: 100
  apprentice: 250
  adept: 500
  expert: 1000
  master: 2000

# Difficulty setting passed to LLM for XP calculation
difficulty: "normal"  # easy, normal, hard, expert, master
difficultyMultipliers:
  easy: 0.5      # LLM calculates 50% of normal XP requirements
  normal: 1.0    # Standard XP requirements
  hard: 1.5      # LLM calculates 150% of normal XP requirements
  expert: 2.0    # LLM calculates 200% of normal XP requirements
  master: 2.5    # LLM calculates 250% of normal XP requirements
```

### Early Learning
```yaml
earlySpellLearning:
  enabled: true
  unlockThreshold: 25            # % to grant spell (weakened)
  minEffectiveness: 20           # Starting power % (Budding stage)
  maxEffectiveness: 80           # Max before mastery (Refining stage)
  selfCastRequiredAt: 75         # % after which must cast spell itself
  selfCastXPMultiplier: 150      # % XP multiplier for self-casting
  binaryEffectThreshold: 80      # Binary effects blocked below this %
  modifyGameDisplay: true        # Show "(Learning - X%)" in game menus
  powerSteps:                    # Discrete power stages
    - { xp: 25, power: 20, label: "Budding" }
    - { xp: 40, power: 35, label: "Developing" }
    - { xp: 55, power: 50, label: "Practicing" }
    - { xp: 70, power: 65, label: "Advancing" }
    - { xp: 85, power: 80, label: "Refining" }
    # 100% XP = 100% power = "Mastered" (implicit)
```

### Spell Tome Learning
```yaml
spellTomeLearning:
  enabled: true                    # Master toggle for tome hook
  useProgressionSystem: true       # XP/weakened spell vs vanilla instant learn
  grantXPOnRead: true              # Grant XP when reading tome
  autoSetLearningTarget: true      # Auto-set spell as learning target
  xpPercentToGrant: 25             # % of required XP to grant on tome read
  tomeInventoryBoost: true         # Enable inventory boost
  tomeInventoryBoostPercent: 25    # % bonus XP when tome in inventory
  requirePrereqs: true             # Require tree prerequisites to be mastered
  requireAllPrereqs: true          # Require ALL prereqs (vs just one)
```

---

## User Experience

### Discovery
- **F9 hotkey (default)**: Opens Heart of Magic panel
- **First-Time Notification**: Brief tutorial message
- **MCM Integration**: Optional menu entry

### Learning Process
1. Open panel (F9)
2. Browse spell tree by school
3. Select spell to learn:
   - Tree spells: Must have prerequisites unlocked
   - Orphaned spells: No prerequisites needed (can learn immediately)
4. Cast prerequisite spells (or any spells from same school for orphaned spells) to gain XP
5. Find spell tome for bonus XP
6. Spell automatically learned when XP reaches requiredXP (determined by LLM)

### Visual Feedback
- **Locked**: Greyed out, prerequisites not met (name hidden until 10% XP)
- **Available**: Can be set as learning target
- **Learning**: Progress bar showing XP advancement
- **Weakened**: Spell granted early but at reduced power (20-80%)
- **Practicing**: Self-cast required (after 75% progress)
- **Mastered**: Full power, checkmark, children unlocked
- **Orphaned**: Floating position, standalone badge, no prerequisites needed

### Benefits
- **Structured Progression**: Clear learning path
- **Active Engagement**: Must practice to learn
- **Strategic Choices**: Choose which spells to learn
- **Tier Mastery Rewarded**: Learning broadly from one tier speeds up the next
- **Effective Usage Rewarded**: Combat grants more XP
- **Non-Intrusive**: Works alongside vanilla learning

---

## File Structure

See **`docs/ARCHITECTURE.md`** for full file tree and module list. Summary:

```
HeartOfMagic/
├── plugin/src/              # SKSE C++ plugin
├── PrismaUI/views/SpellLearning/SpellLearningPanel/
│   ├── index.html           # UI + module load order
│   ├── script.js            # Init, button wiring (e.g. Simple/Complex)
│   └── modules/             # 40+ JS modules (tree: settingsAwareTreeBuilder, proceduralTreeBuilder, …)
├── Scripts/Source/          # Papyrus scripts
├── SKSE/Plugins/SpellLearning/
│   ├── custom_prompts/      # LLM prompt templates
│   └── SpellTreeBuilder/    # Python tree builder (fuzzy NLP, build_tree.py)
└── docs/                    # ARCHITECTURE.md = implementation reference
```

---

## Development Status

### Tier 1: Foundation ✅
- [x] PrismaUI panel setup
- [x] Spell scanning
- [x] LLM prompt generation
- [x] Basic UI display

### Tier 2: Tree Building ✅
- [x] LLM response parser (OpenRouter API)
- [x] Tree validation (reachability, LLM self-correction, auto-fix)
- [x] Tree persistence (JSON + FormID persistence)
- [x] Import/Export functionality
- [x] Python-based Complex Build alternative

### Tier 3: Visualization ✅
- [x] Interactive radial tree rendering (SVG + Canvas + WebGL)
- [x] Node states (locked/available/learning/weakened/practicing/mastered)
- [x] Progress bars and XP display
- [x] School-based sectors with customizable colors
- [x] Discovery Mode (progressive reveal)
- [x] Visual-First Builder + Edit Mode
- [x] 3D Globe alternative view
- [x] 6 difficulty profiles + custom

### Tier 4: Progression System ✅
- [x] Learning target selection (per-school or single mode)
- [x] Spell cast tracking with XP multipliers
- [x] Early spell learning (grant at 25%, weakened)
- [x] Progressive effectiveness (6 power steps)
- [x] Self-cast requirement after 67%
- [x] Auto-mastery at 100%
- [x] Spell Tome Hook (intercept tomes, grant XP)

### Tier 5: Integration ✅
- [x] DEST integration (bundled)
- [x] SKSE co-save persistence
- [x] FormID persistence (survives load order changes)
- [x] Performance optimization (shared_mutex, cached player pointer)
- [x] Papyrus API for inter-mod communication

---

## Key APIs Used

### CommonLibSSE-NG
- `RE::TESSpellCastEvent` - Spell cast detection
- `RE::TESHitEvent` - Spell hit detection
- `RE::TESMagicEffectApplyEvent` - Effect application detection
- `RE::ScriptEventSourceHolder` - Event registration
- `RE::PlayerCharacter` - Player reference (cached with `std::call_once`)
- `RE::SpellItem` - Spell data access
- `RE::Actor::VisitSpells()` - Spell knowledge checking
- `RE::TESObjectBOOK` - Spell tome hook (vtable ProcessBook override)
- `RE::ActiveEffect` - Magnitude scaling for weakened spells

### SKSE
- `SKSE::SerializationInterface` - Save game persistence (co-save)
- `SKSE::MessagingInterface` - Game lifecycle events
- `SKSE::GetTaskInterface()` - Main thread execution from background threads

### PrismaUI
- View registration and management
- JavaScript ↔ C++ communication (`RegisterJSListener` / `InteropCall`)
- Hotkey handling (configurable DirectInput scancode)

### WinHTTP
- OpenRouter API calls for LLM tree generation
- Python installer downloads (embedded Python 3.12.8)

---

## Summary

Heart of Magic transforms spell acquisition from random discovery into a structured, skill-based progression. Players actively practice prerequisite spells and study tomes to unlock new spells, with XP caps encouraging varied practice across spell sources. The bundled DEST (Don't Eat Spell Tomes) functionality intercepts tome reading to feed the progression system, while early spell learning grants spells at reduced power before mastery. The system integrates seamlessly with existing Skyrim mechanics, providing a flexible and engaging learning experience.

**Core Philosophy:** Practice makes perfect - the more you use spells effectively, the faster you learn new ones.
