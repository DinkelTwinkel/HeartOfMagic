# Spell Learning System - Progression Design

## Overview

This document outlines how Skyrim players will interact with the Spell Learning system to unlock new spells and progress through the spell tree. The system transforms spell acquisition from random tome discovery into an **active, XP-based learning system** where players must practice prerequisite spells and study spell tomes to progress.

---

## Discovery & Access

### Initial Discovery

**Method 1: Hotkey Access (Primary)**
- Press **F9** at any time to open the Spell Learning Panel
- Panel appears as an overlay UI (PrismaUI)
- No prerequisites - available from game start

**Method 2: MCM Integration (Optional)**
- If MCM is installed, add menu entry: "Spell Learning Tree"
- Provides settings and access point for players who prefer MCM

**Method 3: In-Game Notification (First Time)**
- On first game load with mod installed, show brief notification:
  - *"Press F9 to access the Spell Learning Tree"*
- One-time notification, dismissible

### UI Overview

When F9 is pressed, players see:
- **Tree Visualization**: Interactive spell tree with nodes and connections
- **School Tabs**: Filter by Destruction, Conjuration, Alteration, Illusion, Restoration
- **Spell Details Panel**: Shows selected spell information
- **Progress Indicators**: Visual feedback for unlocked/learning/locked spells
- **Learning Target**: Currently selected spell being learned (with XP progress bar)
- **XP Sources**: Shows which prerequisite spells grant XP and if spell tome is available

---

## XP-Based Spell Learning System

### Core Mechanics

**How It Works:**
1. Player opens Spell Learning Panel (F9)
2. Player selects a spell node they want to learn (must have prerequisites unlocked)
3. Spell becomes the **"Learning Target"** - shown with progress bar
4. Player gains XP toward that spell by:
   - **Casting prerequisite spells** (previous nodes in the tree)
   - **Reading the spell tome** for the target spell (if available, provides bonus XP)
   - **Active study time** (if using Immersive Spell Learning mod - time spent studying grants XP)
5. When XP reaches 100%, spell is automatically learned and added to player's spell list
6. Player can switch learning targets at any time (progress is saved per spell)

**Key Features:**
- **Active Learning**: Players must practice with prerequisite spells
- **Tome Boost**: Having the spell tome significantly speeds up learning
- **Per-Spell XP**: Each spell node tracks its own XP independently
- **Multiple Targets**: Can learn multiple spells simultaneously (one per school)

---

### Setting a Learning Target

**How to Select:**
1. Click on any spell node that has prerequisites met
2. Click "Set as Learning Target" button (or right-click → "Learn This Spell")
3. Spell node shows:
   - Progress bar (0% to 100%)
   - Current XP / Required XP
   - List of prerequisite spells that grant XP
   - Tome status (Owned/Not Owned)

**Requirements:**
- All prerequisite spells must be **unlocked** (learned)
  - Exception: Orphaned spells have no prerequisites and can be learned directly
- Can only have one learning target per magic school at a time
- Can switch targets freely (progress is preserved)

**Example:**
- Player wants to learn "Fireball"
- Prerequisites: "Flames" and "Firebolt" must be unlocked
- Player sets "Fireball" as learning target
- Progress bar shows: 0/600 XP (XP requirement determined by LLM)

**Orphaned Spells:**
- Spells that don't fit the tree structure (marked by LLM)
- Appear floating in their school (no tree connections)
- No prerequisites required - can be learned immediately
- Still have XP requirements (determined by LLM)
- Example: Unique quest reward spells, standalone utility spells

---

### Gaining XP

#### Method 1: Casting Prerequisite Spells

**How It Works:**
- Each time player casts a prerequisite spell, target spell gains XP
- XP per cast is based on spell tier and relationship to target
- **Bonus XP** is granted when the spell successfully hits a target or applies an effect

**XP Formula:**
```
Base XP = 5 * (Target Spell Tier Multiplier)
Tier Multipliers:
  Novice → Apprentice: 1.0x
  Apprentice → Adept: 1.5x
  Adept → Expert: 2.0x
  Expert → Master: 2.5x

Direct Prerequisite: Full XP
Indirect Prerequisite (2+ steps away): 50% XP

Previous Tier Mastery Bonus:
  - Count spells learned from previous tier (same school)
  - Bonus = (Spells Learned / Total Previous Tier Spells) * Max Bonus
  - Example: Learned 8/10 Novice Destruction spells → +80% of max bonus
  - Max bonus: +50% XP gain (configurable)
  - Encourages exploring the full tree before advancing

Bonus XP (when spell hits/applies effect):
  - Spell hits target: +50% base XP
  - Spell damages enemy: +100% base XP (damage effects)
  - Spell heals ally: +100% base XP (restore health effects)
  - Spell applies beneficial effect: +75% base XP (buffs, etc.)
```

**Example:**
- Learning "Fireball" (Adept)
- Player has learned 6/8 Apprentice Destruction spells → +37.5% mastery bonus
- Casting "Firebolt" (direct prerequisite):
  - Base: +7.5 XP per cast
  - With mastery bonus: +10.31 XP (7.5 * 1.375)
  - Hits target: +15.47 XP (10.31 + 50% hit bonus)
  - Damages enemy: +20.63 XP (10.31 + 100% damage bonus)
- Casting "Flames" (indirect prerequisite): +3.75 XP base, +5.16 XP with mastery bonus
- Casting "Fireball" itself: No XP (already learning it)

**Mastery Bonus Example:**
- Learning first Apprentice spell (0/10 Novice learned): No bonus
- Learning 5th Apprentice spell (8/10 Novice learned): +40% XP gain
- Learning 10th Apprentice spell (10/10 Novice learned): +50% XP gain (max)

**Effective Usage Rewards:**
- **Just casting** (into air): Base XP only
- **Hitting a target**: 1.5x XP (encourages aiming)
- **Damaging enemies**: 2.0x XP (combat effectiveness)
- **Healing allies**: 2.0x XP (support effectiveness)
- **Applying buffs**: 1.75x XP (utility effectiveness)

**Configuration:**
```yaml
progression:
  baseXPPerCast: 5.0
  directPrereqMultiplier: 1.0
  indirectPrereqMultiplier: 0.5
  tierMultipliers:
    novice: 1.0
    apprentice: 1.5
    adept: 2.0
    expert: 2.5
    master: 3.0
  
  # Previous Tier Mastery Bonus
  enableTierMasteryBonus: true    # Enable mastery bonus system
  tierMasteryMaxBonus: 0.5        # Maximum +50% XP gain from mastery
  tierMasteryPerSpellBonus: 0.05   # +5% per spell learned (10 spells = 50%)
  
  # Bonus XP for effective spell usage
  bonusXPOnHit: 0.5              # +50% XP when spell hits target
  bonusXPOnDamage: 1.0            # +100% XP when spell damages enemy
  bonusXPOnHeal: 1.0              # +100% XP when spell heals ally
  bonusXPOnBuff: 0.75             # +75% XP when spell applies beneficial effect
```

#### Method 2: Reading Spell Tome (Speed Boost)

**How It Works:**
1. Player finds spell tome in world (or already owns it)
2. Tome appears in inventory (not consumed immediately)
3. If spell is set as learning target, tome provides bonus XP

**Tome Benefits:**
- **Passive Bonus**: +50% XP gain from casting prerequisites (while tome is in inventory)
- **Active Study**: Right-click tome → "Study Spell Tome" → Grants large XP boost (one-time per learning session)
- **Tome Status**: UI shows "Tome Owned" badge on spell node

**XP from Active Study:**
```
Tome XP = 100 * (Target Spell Tier Multiplier)
Can be used once per spell learning session
```

**Example:**
- Learning "Fireball" (Adept tier)
- Player owns "Fireball" tome
- Casting "Firebolt" normally: +7.5 XP
- With tome in inventory: +11.25 XP (50% bonus)
- Right-click tome → "Study": +200 XP (one-time)

**Configuration:**
```yaml
progression:
  tomePassiveBonus: 0.5        # 50% XP bonus while tome owned
  tomeActiveStudyMultiplier: 100  # Base XP from studying tome
  tomeStudyCooldown: false     # Allow multiple study sessions
```

#### Method 3: Active Study Time (ISL Integration)

**How It Works:**
- If **Immersive Spell Learning (ISL)** mod is installed and active
- When player is actively studying a spell tome (using ISL's study mechanics)
- Time spent studying grants XP toward that spell in our system
- Creates synergy: ISL handles the immersive study experience, our system tracks progression

**Integration Details:**
1. Player sets spell as learning target in Spell Learning Panel
2. Player uses ISL to study the spell tome (wait/rest to study)
3. While studying, our system detects active study session
4. XP is granted based on study time (real-time or session-based)
5. Both systems work together: ISL provides immersion, our system provides tree structure

**XP from Study Time:**
```
Real-Time Study Mode:
  XP per second = (Base XP Rate) * (Tier Multiplier) * (Skill Level Bonus)
  
Session-Based Study Mode:
  XP per session = (Session Duration) * (XP per minute) * (Tier Multiplier)
```

**Example:**
- Learning "Fireball" (Adept tier, 600 XP required)
- Player uses ISL to study "Fireball" tome
- ISL study session: 2 hours game time
- XP gained: 2 hours * 0.5 XP/minute * 2.0 (Adept) = 120 XP
- Player also casts "Firebolt" 40 times: +300 XP
- Total: 420 XP → Continue studying or casting to complete

**Benefits:**
- **Dual Progression**: Study time in ISL contributes to tree progression
- **Flexible Learning**: Can study OR cast prerequisites OR both
- **Immersive**: ISL's study mechanics feel natural
- **Strategic**: Players choose how to learn (active casting vs. passive study)

**Configuration:**
```yaml
progression:
  # ISL Integration
  enableISLIntegration: true        # Enable ISL compatibility
  islXPPerMinute: 0.5              # Base XP per minute of study time
  islRealTimeMode: true            # Use real-time study (vs session-based)
  islSkillLevelBonus: true         # Scale XP based on magic skill level
  islSkillBonusMultiplier: 0.01    # 1% bonus per skill level (e.g., 50 skill = +50%)
  
  # ISL Detection
  islPluginName: "ImmersiveSpellLearning.esp"  # ISL plugin to detect
  islCheckInterval: 1.0            # Check for active study every N seconds
```

**Technical Implementation:**
- Detect ISL mod via `Game.GetModByName()`
- Hook into ISL's study events/callbacks (if available)
- Or poll player state: check if player is in "studying" state
- Track study time and convert to XP based on configuration
- Display ISL study progress in Spell Learning Panel UI

---

### XP Requirements Per Spell

**LLM-Determined Requirements:**
- XP requirements are determined by the LLM when generating the spell tree
- LLM calculates requirements based on:
  - Spell complexity and tier
  - Expected number of casts needed (considering player will hit targets, deal damage, etc.)
  - Base XP per cast (from configuration)
  - Difficulty setting (easy/normal/hard/expert/master)
  - Prerequisite count and tree position

**LLM Calculation Factors:**
```
The LLM receives:
- Base XP per cast: 5.0 (configurable)
- Hit bonus: +50%
- Damage/heal bonus: +100%
- Buff bonus: +75%
- Tier multipliers: 1.0 to 3.0
- Difficulty multipliers: 0.5x (easy) to 2.0x (master)

LLM estimates:
- Expected casts assuming player hits targets 70% of the time
- Expected damage/heal/buff application rates
- Spell complexity (simple spells = fewer casts, complex = more)
- Tree position (early spells = easier, late spells = harder)

Result: requiredXP value for each spell
```

**Example:**
- "Fireball" (Adept tier, mid-tree position):
  - LLM estimates: ~40 casts needed with 70% hit rate and 50% damage rate
  - Base: 40 * 7.5 XP = 300 XP
  - With bonuses: ~600 XP (LLM accounts for effective usage)
  - Difficulty (normal): 1.0x multiplier
  - **LLM sets: requiredXP = 600**

**Orphaned Spells:**
- Some spells don't fit the tree structure (unique mechanics, standalone spells)
- LLM places these in `orphanedSpells` array
- Orphaned spells appear floating in their school (no prerequisites, no connections)
- Can be learned directly (no prerequisite requirement)
- Still have `requiredXP` determined by LLM

**Note:** Mastery bonus increases XP gain rate, effectively reducing the time needed to learn spells, but the `requiredXP` value from LLM remains fixed.

**Configuration:**
```yaml
progression:
  # XP requirements are determined by LLM, not fixed values
  # These are fallback defaults if LLM doesn't provide requiredXP
  baseXPRequirements:
    novice: 100
    apprentice: 250
    adept: 500
    expert: 1000
    master: 2000
  
  # Difficulty settings passed to LLM for XP calculation
  difficulty: "normal"  # easy, normal, hard, expert, master
  difficultyMultipliers:
    easy: 0.5
    normal: 1.0
    hard: 1.5
    expert: 2.0
    master: 2.5
```

---

### Learning Multiple Spells

**Per-School Limitation:**
- Can only have **one learning target per magic school** at a time
- Can switch targets freely (progress saved)
- Progress continues even when not the active target

**Example:**
- Destruction: Learning "Fireball" (300/600 XP)
- Conjuration: Learning "Conjure Flame Atronach" (150/500 XP)
- Restoration: No target set
- Player can switch Destruction target to "Incinerate" (progress on "Fireball" is saved)

**UI Display:**
- Active learning targets shown in sidebar
- Progress bars visible on spell nodes
- Can click "Switch Target" to change active spell

---

## Progression States & Visual Feedback

### Spell Node States

**1. Locked (Greyed Out)**
- Visual: Grey/desaturated color, locked icon overlay
- Tooltip: *"Requires: [List of prerequisite spells]"*
- Interaction: Click shows details but cannot set as target

**2. Available (Can Learn)**
- Visual: Normal color, "Available" badge
- Tooltip: *"Click to set as learning target"*
- Interaction: Click to set as learning target, shows XP requirements

**3. Learning (Active Target)**
- Visual: Highlighted border, glow effect, progress bar overlay
- Tooltip: *"Learning: [Current XP] / [Required XP] XP"*
- Shows:
  - Progress bar (0-100%)
  - XP sources (which prerequisites grant XP)
  - Tome status (Owned/Not Owned)
- Interaction: Click to view details, can switch target

**4. Learning (Inactive Target)**
- Visual: Dimmed highlight, progress bar overlay
- Tooltip: *"Learning (paused): [Current XP] / [Required XP] XP"*
- Progress is saved but not actively gaining XP
- Interaction: Click to make active target

**5. Unlocked (Learned)**
- Visual: Full color, checkmark icon, "Learned" badge
- Tooltip: *"You know this spell"*
- Interaction: Click shows spell details, can view in spell menu

**6. Root Spell (Starting Point)**
- Visual: Special "Start Here" badge, distinct styling
- Tooltip: *"Starting spell for [School] - No prerequisites needed"*
- Interaction: Can set as learning target immediately (no prerequisites)

**7. Orphaned Spell (Standalone)**
- Visual: Floating position, distinct border style, "Standalone" badge
- Tooltip: *"Standalone spell - No prerequisites needed"*
- No tree connections (appears separate from main tree)
- Can be learned directly (no prerequisite requirement)
- Still has XP requirement (determined by LLM)
- Interaction: Can set as learning target immediately

---

## Progression Flow Examples

### Example 1: Learning Fireball (XP-Based)

```
1. Player opens panel, sees Destruction tab
2. Root spell "Flames" is Available (no prerequisites)
3. Player sets "Flames" as learning target
4. Player casts "Flames" 20 times:
   - 10 casts hit enemies → 10 * 7.5 XP (base) = 75 XP
   - 10 casts hit and damage → 10 * 15 XP (2x bonus) = 150 XP
   - Total: 225 XP → "Flames" learned (exceeded 100 XP requirement)
5. "Firebolt" becomes Available (prerequisite: Flames unlocked)
6. Player sets "Firebolt" as learning target (250 XP required)
   - Player has learned 1/10 Novice Destruction spells → +5% mastery bonus
7. Player casts "Flames" 30 times (all hit enemies):
   - 30 * 3.75 XP (indirect prereq, base) = 112.5 XP
   - With mastery bonus (+5%): 30 * 3.94 XP = 118.2 XP
   - With hit bonus: 30 * 5.91 XP = 177.3 XP
8. Player finds "Firebolt" tome → Studies it → +250 XP → "Firebolt" learned instantly
9. "Fireball" becomes Available (prerequisite: Firebolt unlocked)
10. Player sets "Fireball" as learning target (600 XP required)
    - Player has learned 6/8 Apprentice Destruction spells → +37.5% mastery bonus
11. Player casts "Firebolt" 50 times in combat (all hit and damage):
    - Base: 50 * 7.5 XP = 375 XP
    - With mastery bonus (+37.5%): 50 * 10.31 XP = 515.6 XP
    - With damage bonus (+100%): 50 * 20.63 XP = 1031.3 XP
    - With tome passive bonus (+50%): 50 * 30.94 XP = 1547 XP
12. "Fireball" learned! (exceeded 600 XP requirement, much faster due to mastery)
```

### Example 2: Multi-School Learning

```
1. Player sets "Flames" (Destruction) as learning target
2. Player sets "Healing" (Restoration) as learning target
3. Player sets "Oakflesh" (Alteration) as learning target
4. Player goes adventuring, casting all three spells
5. All three spells gain XP simultaneously:
   - "Flames": 80/100 XP (from casting Flames)
   - "Healing": 60/100 XP (from casting Healing)
   - "Oakflesh": 40/100 XP (from casting Oakflesh)
6. Player focuses on Destruction, casts "Flames" more
7. "Flames" completes first → Learned
8. "Healing" and "Oakflesh" continue learning in background
```

### Example 3: Tome Boost Strategy

```
1. Player wants to learn "Fireball" (600 XP required)
2. Player finds "Fireball" tome early (before prerequisites met)
3. Player unlocks prerequisites: "Flames" and "Firebolt"
4. Player sets "Fireball" as learning target
5. Player owns tome → Passive +50% XP bonus active
6. Player casts "Firebolt" 40 times:
   - Base: 7.5 XP per cast = 300 XP
   - With tome bonus: 11.25 XP per cast = 450 XP
7. Player studies tome → +200 XP
8. Total: 650 XP → "Fireball" learned (faster than without tome)
```

### Example 4: Switching Learning Targets

```
1. Player sets "Fireball" as learning target (300/600 XP)
2. Player finds "Incinerate" tome and wants to learn it instead
3. Player switches target to "Incinerate" (0/600 XP)
4. "Fireball" progress is saved (300/600 XP, inactive)
5. Player learns "Incinerate" completely
6. Player switches back to "Fireball" (300/600 XP, resumes learning)
```

### Example 5: ISL Integration - Study Time Grants XP

```
1. Player sets "Fireball" as learning target (0/600 XP)
2. Player owns "Fireball" tome
3. Player uses ISL to study "Fireball" tome:
   - Activates study session (wait/rest to study)
   - ISL shows study progress (0% → 100%)
4. While studying, our system grants XP:
   - Study for 1 hour game time
   - XP gained: 60 minutes * 0.5 XP/min * 2.0 (Adept) = 60 XP
5. Player also casts "Firebolt" 30 times: +225 XP
6. Total: 285 XP / 600 XP
7. Player continues studying:
   - Study for 2 more hours: +120 XP
   - Cast "Firebolt" 20 more times: +150 XP
8. Total: 555 XP → Player studies tome (active study): +200 XP
9. "Fireball" learned! (755/600 XP)
```

---

## Integration with Skyrim Systems

### Spell Menu Integration

**When a spell is learned (XP reaches 100%):**
- Spell is immediately added to player's spell list
- Appears in Magic menu under appropriate school
- Can be equipped and cast like any other spell
- No distinction from spells learned via vanilla tome reading
- Notification: *"You have learned [Spell Name]!"*

**Spell Removal (Optional):**
- Configuration option: `allowSpellRemoval: false`
- If enabled, right-click unlocked spell in tree → "Forget Spell"
- Removes spell from player's list
- Useful for respeccing or correcting mistakes

### Save Game Persistence

**What Gets Saved:**
- List of learned spell FormIDs (completed)
- Per-spell XP progress (for all spells, not just active targets)
- Current learning targets per school
- Tome ownership status (which tomes have been studied)
- Per-save, not global (each character has own progression)
- Stored in SKSE cosave or JSON file in save-specific location

**Save Game Compatibility:**
- Version tracking for future updates
- Migration logic if tree structure changes
- Graceful handling of removed spells (mod uninstalled)

### Mod Compatibility

**Handling Missing Spells:**
- If spell from tree is no longer in load order:
  - Mark as "Unavailable" in UI
  - Show warning: *"Spell not found in current load order"*
  - Don't block progression of other spells

**Handling New Spells:**
- If new spell mod is installed:
  - Player must re-scan spells (button in UI)
  - New tree generated, but existing unlocks preserved
  - New spells appear as Locked until prerequisites met

**Immersive Spell Learning (ISL) Integration:**
- **Automatic Detection**: System detects if ISL mod is installed
- **Dual Progression**: Study time in ISL grants XP in our system
- **UI Integration**: Shows ISL study progress in Spell Learning Panel
- **Configuration**: Can enable/disable ISL integration in settings
- **Synergy**: 
  - ISL provides immersive study mechanics (wait/rest to study)
  - Our system provides structured tree progression
  - Both work together seamlessly
- **Fallback**: If ISL not installed, system works normally (casting + tomes only)

**How ISL Integration Works:**
1. Player sets spell as learning target in Spell Learning Panel
2. Player uses ISL to study the spell tome (immersive study session)
3. Our system detects active ISL study session
4. XP is granted based on study time (configurable rate)
5. Progress shown in both systems:
   - ISL: Shows study completion percentage
   - Spell Learning Panel: Shows XP progress toward learning
6. When either system completes, spell is learned

---

## Player Experience Goals

### 1. Clear Progression Path

**Goal:** Players should always know what to do next.

**Implementation:**
- Visual highlighting of Available spells (can be set as targets)
- "Current Learning" panel showing active targets with progress
- Progress percentage per school
- Achievement-style badges for milestones
- XP gain notifications (optional): *"+X XP toward [Spell Name]"*

### 2. Meaningful Choices

**Goal:** Players should feel their choices matter.

**Implementation:**
- Branching paths (e.g., Fire vs Frost vs Shock)
- No single "optimal" path
- Different builds unlock different branches
- Respec option (if enabled) allows experimentation

### 3. Rewarding Progression

**Goal:** Unlocking spells should feel satisfying.

**Implementation:**
- Visual/audio feedback on spell learned (particle effect, sound)
- Progress bars showing XP advancement in real-time
- "Spells Learned" counter
- XP gain feedback (optional floating numbers)
- Milestone rewards (learn 10 spells → bonus, etc.)

### 4. Non-Intrusive

**Goal:** System should enhance, not replace, existing gameplay.

**Implementation:**
- Optional system (can still learn spells via tomes if preferred)
- No forced tutorials
- Can ignore system entirely if desired
- Works alongside vanilla spell learning

---

## Configuration Options

### User Settings (settings.yaml)

```yaml
progression:
  # XP System
  baseXPPerCast: 5.0              # Base XP per spell cast
  directPrereqMultiplier: 1.0      # XP multiplier for direct prerequisites
  indirectPrereqMultiplier: 0.5    # XP multiplier for indirect prerequisites (2+ steps)
  
  # Tier multipliers (affects XP requirements and gains)
  tierMultipliers:
    novice: 1.0
    apprentice: 1.5
    adept: 2.0
    expert: 2.5
    master: 3.0
  
  # Base XP requirements per tier (fallback defaults if LLM doesn't provide)
  baseXPRequirements:
    novice: 100
    apprentice: 250
    adept: 500
    expert: 1000
    master: 2000
  
  # Difficulty setting for LLM XP calculation
  difficulty: "normal"  # easy, normal, hard, expert, master
  difficultyMultipliers:
    easy: 0.5
    normal: 1.0
    hard: 1.5
    expert: 2.0
    master: 2.5
  
  # Previous Tier Mastery Bonus
  enableTierMasteryBonus: true     # Enable mastery bonus system
  tierMasteryMaxBonus: 0.5        # Maximum +50% XP gain from mastery
  tierMasteryPerSpellBonus: 0.05  # +5% per spell learned (10 spells = 50%)
  
  # Spell Tome System
  tomePassiveBonus: 0.5            # 50% XP bonus while tome owned
  tomeActiveStudyMultiplier: 100   # Base XP from studying tome
  tomeStudyCooldown: false         # Allow multiple study sessions per spell
  
  # ISL Integration (Immersive Spell Learning)
  enableISLIntegration: true      # Enable ISL compatibility
  islXPPerMinute: 0.5              # Base XP per minute of study time
  islRealTimeMode: true            # Use real-time study (vs session-based)
  islSkillLevelBonus: true         # Scale XP based on magic skill level
  islSkillBonusMultiplier: 0.01    # 1% bonus per skill level
  islPluginName: "ImmersiveSpellLearning.esp"  # ISL plugin to detect
  islCheckInterval: 1.0            # Check for active study every N seconds
  
  # Learning Targets
  maxTargetsPerSchool: 1           # One target per school
  allowMultipleSchools: true       # Can learn from multiple schools simultaneously
  
  # UI behavior
  showProgressBars: true
  showXPRequirements: true
  showXPPerCast: true              # Show "+X XP per cast" on tooltips
  highlightLearningTargets: true
  showTomeStatus: true             # Show "Tome Owned" badges
  autoFocusLearningTargets: false
  
  # Notifications
  showLearnNotification: true      # Popup when spell learned
  showXPGainNotification: false     # Show "+X XP" floating text (optional)
  showMilestoneNotification: true  # Popup at milestones
  notificationDuration: 3.0        # Seconds
```

---

## Future Enhancements

### Tier 1: Core Progression (Current Focus)
- XP-based learning system
- Learning target selection
- XP gain from casting prerequisites
- Visual tree display with progress bars

### Tier 2: Tome Integration
- Spell tome passive bonus
- Active tome study action
- Tome ownership tracking
- Tome status indicators in UI
- ISL (Immersive Spell Learning) integration
- Study time XP conversion

### Tier 3: Advanced Features
- Multiple learning targets (one per school)
- XP gain notifications
- Progress persistence
- Skill level recommendations (optional gating)

### Tier 4: Polish & QoL
- Achievement system
- Progress statistics
- Export/import progression
- XP gain rate indicators
- Learning time estimates

---

## Testing Scenarios

### Scenario 1: New Character - Learning First Spell
1. Start new game
2. Open Spell Learning Panel (F9)
3. Verify all root spells are Available
4. Set "Flames" as learning target
   - Verify requiredXP is shown (from LLM, e.g., 100 XP)
5. Cast "Flames" 20 times
6. Verify XP progress increases
7. Verify spell is learned when XP reaches requiredXP
8. Verify spell appears in Magic menu

### Scenario 1b: Learning Orphaned Spell
1. Open Spell Learning Panel (F9)
2. Navigate to school with orphaned spells
3. Verify orphaned spells appear floating (separate from tree)
4. Verify orphaned spells show "Standalone" badge
5. Set orphaned spell as learning target (no prerequisites needed)
6. Cast any spells from same school to gain XP
7. Verify spell learned when XP reaches requiredXP (from LLM)

### Scenario 2: Learning with Prerequisites
1. Load save with "Flames" already learned
2. Open Spell Learning Panel
3. Set "Firebolt" as learning target (requires Flames)
4. Cast "Flames" 30 times
5. Verify "Firebolt" gains XP
6. Verify "Firebolt" is learned when XP complete

### Scenario 3: Tome Boost
1. Player owns "Fireball" tome
2. Set "Fireball" as learning target
3. Verify "Tome Owned" badge appears
4. Cast prerequisite spells
5. Verify XP gain is 50% higher (passive bonus)
6. Right-click tome → "Study Spell Tome"
7. Verify large XP boost applied
8. Verify spell learned faster than without tome

### Scenario 4: Multiple Learning Targets
1. Set "Flames" (Destruction) as learning target
2. Set "Healing" (Restoration) as learning target
3. Cast both spells
4. Verify both gain XP simultaneously
5. Verify can only have one target per school
6. Switch target from "Flames" to "Firebolt"
7. Verify "Flames" progress is saved

### Scenario 5: Progress Persistence
1. Set "Fireball" as learning target, gain 300/600 XP
2. Save game and exit
3. Load save game
4. Verify "Fireball" still shows 300/600 XP
5. Verify can resume learning

### Scenario 6: Mod Compatibility
1. Install spell mod
2. Re-scan spells
3. Verify new spells appear in tree
4. Verify existing XP progress preserved
5. Uninstall spell mod
6. Verify missing spells handled gracefully (marked unavailable)

### Scenario 7: ISL Integration
1. Install Immersive Spell Learning mod
2. Set "Fireball" as learning target
3. Use ISL to study "Fireball" tome (wait/rest)
4. Verify XP increases while studying
5. Verify XP rate matches configuration (e.g., 0.5 XP/minute)
6. Verify study time contributes to learning progress
7. Verify spell learned when XP reaches 100% (from study + casting)
8. Verify UI shows both ISL study progress and XP progress

### Scenario 8: Tier Mastery Bonus
1. Learn 0 Novice Destruction spells
2. Set first Apprentice spell as learning target
3. Cast prerequisite, verify base XP (no mastery bonus)
4. Learn 5 Novice Destruction spells
5. Set another Apprentice spell as learning target
6. Cast prerequisite, verify +25% XP gain (5 * 5% = 25%)
7. Learn all 10 Novice Destruction spells
8. Set another Apprentice spell as learning target
9. Cast prerequisite, verify +50% XP gain (max mastery bonus)
10. Verify mastery bonus only applies to next tier (not same tier)

---

## Summary

The Spell Learning progression system provides players with:

1. **Active Learning**: Players must practice prerequisite spells to learn new ones
2. **XP-Based Progression**: Each spell requires XP gained through casting and tome study
3. **Tome Integration**: Finding spell tomes significantly speeds up learning
4. **Visual Feedback**: Clear progress bars and XP tracking for each spell
5. **Flexible Targeting**: Can learn multiple spells simultaneously (one per school)

**Core Gameplay Loop:**
1. Select a spell to learn (must have prerequisites unlocked)
2. Gain XP through multiple methods:
   - Cast prerequisite spells (base XP)
   - Mastery bonus if learned many previous tier spells (+5% per spell, max +50%)
   - Hit/damage/heal/buff bonuses for effective usage
   - Study spell tome (if using ISL mod)
   - Read/study tome for bonus XP
3. Find the spell tome to boost learning speed (passive +50% XP bonus)
4. Spell is automatically learned when XP reaches 100%
5. Learning more spells from a tier makes the next tier easier (mastery bonus)

**Key Benefits:**
- **Active Engagement**: Players must use spells to learn new ones (not just click to unlock)
- **Exploration Rewards**: Finding spell tomes provides meaningful progression boost
- **Strategic Choices**: Players choose which spells to learn based on available prerequisites
- **Tier Mastery System**: Learning more spells from one tier makes the next tier easier, encouraging broad exploration
- **Natural Pacing**: XP requirements scale with spell tier, preventing instant mastery
- **Non-Intrusive**: Works alongside vanilla spell learning, doesn't replace it
- **Mod Integration**: Compatible with Immersive Spell Learning for dual progression paths

**ISL Compatibility:**
- Study time in ISL grants XP in our system
- Both systems work together: ISL provides immersion, our system provides structure
- Players can learn through casting, studying, or both
- Flexible learning methods suit different playstyles

The system transforms spell acquisition from passive discovery into an active learning experience where players must practice magic to advance, while maintaining the exploration and discovery elements of Skyrim through spell tome integration. Integration with Immersive Spell Learning adds an additional immersive study path that complements the prerequisite-based casting system.
