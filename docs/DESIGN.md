# Spell Learning System - Design Document

**Status:** Design intent and historical reference. **Tiers 1–5 are implemented.** For current implementation details (components, tree generation flow, modules) see **`ARCHITECTURE.md`** and **`QUICK_REFERENCE.md`**.

---

## Overview

A Skyrim SKSE mod that creates an AI-generated spell learning tree. The system:
1. Scans all spells in the game, extracting their properties and relationships
2. Sends spell data to an LLM with a customizable prompt to generate a learning tree
3. Displays the tree in-game via PrismaUI, allowing player progression through spell unlocks

---

## Core Systems

### System 1: Spell Scanner & Data Extractor
- Scans all SpellItem records from loaded plugins
- Extracts: name, school, level, effects, magnitude, duration, cost, casting type, delivery, keywords
- Outputs structured JSON suitable for LLM consumption
- Generates an LLM prompt that instructs tree construction

### System 2: LLM Output Interpreter
- Parses LLM response (structured JSON tree format)
- Builds internal spell tree graph structure
- Validates spell references exist in game
- Handles tree serialization/deserialization to file

### System 3: PrismaUI Display
- Interactive tree visualization
- Shows spell nodes with connections
- Highlights unlocked/locked/available spells
- Allows spell unlocking (future tier)

### System 4: Progression Controller ✅ (Implemented)
- Tracks which spells player has unlocked (ProgressionManager, SKSE co-save)
- Enforces prerequisite requirements; grants spells when unlocked (early at threshold, full at 100%)
- Persists progress in save game

---

## Development Tiers

### Tier 1: Foundation & Spell Scanning
**Goal:** Get the UI working, scan spells, and produce LLM-ready output

#### 1.1 PrismaUI Panel Setup ✅
- [x] Create basic HTML/CSS/JS view for SpellLearningPanel
- [x] Register F9 hotkey to toggle panel visibility
- [x] Panel shows: title, status text, scan button, editable text area

#### 1.2 SKSE Plugin Foundation ✅
- [x] Create C++ plugin with CMake build
- [x] Register with PrismaUI for view management
- [x] Hotkey handler (F9 = scancode 67)
- [x] Basic logging

#### 1.3 Spell Scanning ✅
- [x] Iterate all SpellItem forms from data handler
- [ ] Extract relevant spell data:
  - EditorID, FormID, Name
  - School (Alteration, Conjuration, Destruction, Illusion, Restoration)
  - Skill Level (Novice, Apprentice, Adept, Expert, Master)
  - Magicka Cost
  - Effects (name, magnitude, duration)
  - Casting Type (Fire and Forget, Concentration, etc.)
  - Delivery (Self, Touch, Aimed, Target Location)
  - Keywords
- [x] Filter to player-learnable spells (exclude abilities, powers, lesser powers)

#### 1.4 LLM Prompt Generation ✅
- [x] Generate structured JSON of all spells
- [ ] Create system prompt that instructs LLM to:
  - Group spells by school
  - Create prerequisite chains based on spell difficulty
  - Start each school with 1 basic spell
  - Branch outward with logical progressions
  - **Calculate XP requirements** for each spell based on:
    - Base XP per cast (from configuration)
    - Expected casts needed (considering hit/damage bonuses)
    - Spell complexity and tier
    - Difficulty setting (easy/normal/hard/expert/master)
  - **Mark orphaned spells** that don't fit tree structure (place in `orphanedSpells` array)
  - Output in specific JSON tree format with `requiredXP` and `orphanedSpells` fields
- [ ] Include XP calculation parameters in prompt (baseXPPerCast, bonuses, difficulty multipliers)
- [x] Save prompt + spell data to file
- [x] Display in UI text area (editable)

#### 1.5 Testing Tier 1 ✅
- [x] Launch game, press F9, verify panel appears
- [x] Click scan button, verify spells are scanned (check logs)
- [x] Verify output file created with spell data + prompt
- [x] Verify text area shows the content

---

### Tier 2: LLM Integration & Tree Building ✅ (Implemented)
**Goal:** Process LLM output and build the spell tree data structure. Implemented; tree can also be built via BUILD TREE (Complex) or (Simple)—see ARCHITECTURE.md.

#### 2.1 LLM Response Format
Define expected JSON structure:
```json
{
  "version": "1.0",
  "difficulty": "normal",
  "schools": {
    "Destruction": {
      "root": "Flames",
      "nodes": [
        {
          "spellId": "Flames",
          "formId": "0x00012FCD",
          "children": ["Firebolt", "Frostbite"],
          "prerequisites": [],
          "requiredXP": 100,
          "description": "Basic fire spell, starting point for destruction magic"
        },
        {
          "spellId": "Firebolt",
          "formId": "0x0001C789",
          "children": ["Fireball", "Incinerate"],
          "prerequisites": ["Flames"],
          "requiredXP": 250,
          "description": "Intermediate fire projectile"
        }
      ],
      "orphanedSpells": [
        {
          "spellId": "SpecialSpell",
          "formId": "0x000ABCDE",
          "requiredXP": 500,
          "description": "Unique spell that doesn't fit the tree structure"
        }
      ]
    }
  }
}
```

**Key Fields:**
- **requiredXP**: LLM-determined XP requirement for learning this spell (based on difficulty, spell complexity, and XP gain rates)
- **orphanedSpells**: Spells that don't fit into the tree structure (appear floating in their school)
- **difficulty**: Overall difficulty setting used for XP calculations ("easy", "normal", "hard", "expert", "master")

#### 2.2 Tree Parser
- [ ] Parse LLM JSON response
- [ ] Validate spell references against game data
- [ ] Build SpellNode graph structure
- [ ] Handle missing/invalid spells gracefully

#### 2.3 Tree Persistence
- [ ] Save parsed tree to JSON file
- [ ] Load tree from file on game start
- [ ] UI button to "Import LLM Response"
- [ ] Text area for pasting LLM response

#### 2.4 Testing Tier 2
- [ ] Manually paste sample LLM response in UI
- [ ] Click import, verify tree builds (check logs)
- [ ] Verify tree file saved
- [ ] Reload game, verify tree loads

---

### Tier 3: Tree Visualization
**Goal:** Display the spell tree graphically in PrismaUI

#### 3.1 Tree Rendering
- [ ] Canvas/SVG based tree display
- [ ] Nodes for each spell (icon, name, school color)
- [ ] Lines connecting prerequisite → unlocked spell
- [ ] Zoom/pan controls
- [ ] School filter tabs

#### 3.2 Node States
- [ ] Locked (greyed out, prerequisite not met)
- [ ] Available (prerequisite met, can unlock)
- [ ] Unlocked (full color, player knows spell)
- [ ] Orphaned (floating position, standalone badge, no prerequisites)
- [ ] Visual feedback for state changes

#### 3.3 Node Interaction
- [ ] Hover: show spell tooltip (effects, cost, description, requiredXP)
- [ ] Click: select node, show details panel
- [ ] Orphaned spells: show "Standalone" badge, no prerequisite display
- [ ] Future: unlock button on available nodes

#### 3.4 Testing Tier 3
- [ ] Load tree, verify visual display
- [ ] Test zoom/pan
- [ ] Test school filters
- [ ] Verify node states display correctly
- [ ] Verify orphaned spells appear floating (separate from tree)
- [ ] Verify orphaned spells show "Standalone" badge
- [ ] Verify requiredXP is displayed for all spells

---

### Tier 4: Progression System (Future)
**Goal:** Track and manage player spell unlocking

#### 4.1 Progress Tracking
- [ ] Track unlocked spells per save
- [ ] SKSE cosave integration for persistence
- [ ] Check prerequisites when attempting unlock

#### 4.2 Spell Granting
- [ ] When spell unlocked, add to player spell list
- [ ] Remove spell if "un-unlocking" (optional)

#### 4.3 Unlock Requirements
- [ ] Basic: just prerequisites
- [ ] Advanced: skill level requirements
- [ ] Advanced: spell tome consumption
- [ ] Advanced: perk requirements

---

## Technical Architecture

### File Structure
```
SpellLearning/
├── plugin/
│   ├── src/
│   │   ├── Main.cpp              # SKSE entry, hotkey registration
│   │   ├── SpellScanner.cpp      # Spell enumeration and data extraction
│   │   ├── SpellScanner.h
│   │   ├── TreeBuilder.cpp       # LLM response parser, tree structure
│   │   ├── TreeBuilder.h
│   │   ├── UIManager.cpp         # PrismaUI communication
│   │   ├── UIManager.h
│   │   ├── PrismaUI_API.h        # PrismaUI header
│   │   └── PCH.h
│   ├── CMakeLists.txt
│   ├── CMakePresets.json
│   └── vcpkg.json
├── PrismaUI/
│   └── views/
│       └── SpellLearningPanel/
│           ├── index.html
│           ├── script.js
│           └── styles.css
├── docs/
│   ├── DESIGN.md                 # This file
│   └── LLM_PROMPT_TEMPLATE.md    # Default prompt template
├── config/
│   └── settings.yaml             # User settings
└── data/
    ├── spell_scan_output.json    # Last scan results
    ├── llm_prompt.txt            # Generated prompt for LLM
    └── spell_tree.json           # Parsed spell tree
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         TIER 1                                  │
│  ┌──────────┐    ┌─────────────┐    ┌──────────────────┐       │
│  │ F9 Key   │───►│ Open Panel  │───►│ PrismaUI View    │       │
│  └──────────┘    └─────────────┘    └──────────────────┘       │
│                                              │                  │
│  ┌──────────────┐    ┌─────────────┐         ▼                 │
│  │ Scan Button  │───►│ SpellScanner│───►┌──────────────┐       │
│  └──────────────┘    └─────────────┘    │ JSON Output  │       │
│                                         │ + LLM Prompt │       │
│                                         └──────────────┘       │
│                                                │                │
│                                                ▼                │
│                                         ┌──────────────┐       │
│                                         │ Text Editor  │       │
│                                         │ (editable)   │       │
│                                         └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         TIER 2                                  │
│  ┌──────────────┐                                               │
│  │ User pastes  │                                               │
│  │ LLM response │                                               │
│  └──────┬───────┘                                               │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐    ┌─────────────┐    ┌──────────────┐       │
│  │ Import Btn   │───►│ TreeBuilder │───►│ spell_tree   │       │
│  └──────────────┘    │ (validate)  │    │ .json        │       │
│                      └─────────────┘    └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         TIER 3                                  │
│  ┌──────────────┐    ┌─────────────┐    ┌──────────────┐       │
│  │ spell_tree   │───►│ JS Renderer │───►│ Canvas/SVG   │       │
│  │ .json        │    │             │    │ Tree Display │       │
│  └──────────────┘    └─────────────┘    └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### PrismaUI Communication

**C++ → JS:**
```cpp
// Send spell scan results to UI
PrismaUI::ExecuteJS("SpellLearningPanel", 
    "updateSpellData(" + jsonData + ")");
```

**JS → C++:**
```javascript
// Request spell scan
window.callCpp('ScanSpells', '');

// Import tree from text
window.callCpp('ImportTree', jsonString);
```

**Registered JS Functions:**
```javascript
window.updateSpellData = function(json) { ... }
window.updateTreeData = function(json) { ... }
window.updateStatus = function(message) { ... }
```

---

## Spell Data Schema

### Scan Output Format
```json
{
  "scanTimestamp": "2026-01-27T12:00:00Z",
  "spellCount": 472,
  "spells": [
    {
      "formId": "0x00012FCD",
      "editorId": "Flames",
      "name": "Flames",
      "school": "Destruction",
      "skillLevel": "Novice",
      "magickaCost": 14,
      "castingType": "Concentration",
      "delivery": "Aimed",
      "chargeTime": 0.0,
      "effects": [
        {
          "name": "Flames",
          "magnitude": 8.0,
          "duration": 0,
          "area": 0,
          "description": "A gout of fire that does 8 points per second"
        }
      ],
      "keywords": ["MagicDamageFire"],
      "plugin": "Skyrim.esm"
    }
  ]
}
```

### LLM Prompt Template
See `docs/LLM_PROMPT_TEMPLATE.md` for the default prompt.

Key prompt instructions:
1. Group spells by school (5 schools)
2. Each school starts with exactly 1 root spell (typically Novice level)
3. Create logical progression chains
4. Consider: same effect but stronger → linear chain
5. Consider: branching into different elements (fire/frost/shock)
6. Consider: skill level as rough difficulty indicator
7. **Determine XP Requirements**: Calculate `requiredXP` for each spell based on:
   - Base XP per cast (from configuration)
   - Expected casts needed (considering hit/damage bonuses)
   - Spell complexity and tier
   - Difficulty setting (easy/normal/hard/expert/master)
   - Formula: `requiredXP = (ExpectedCasts * BaseXPPerCast * TierMultiplier) * DifficultyMultiplier`
8. **Orphan Spells**: Some spells may not fit the tree structure (unique mechanics, standalone spells). Place these in `orphanedSpells` array - they appear floating in their school without prerequisites
9. Output strictly valid JSON matching the schema

---

## Configuration

### settings.yaml
```yaml
# SpellLearning Configuration

ui:
  hotkey: 67  # F9 (DirectInput scancode)
  defaultTab: "Destruction"
  
scanner:
  includeModSpells: true
  excludePlugins:
    - "ccBGSSSE037-Curios.esl"  # Example exclusion
  minMagickaCost: 0
  maxMagickaCost: 999999
  
tree:
  autoLoadOnStart: true
  treeFilePath: "Data/SKSE/Plugins/SpellLearning/spell_tree.json"

llm:
  promptTemplatePath: "Data/SKSE/Plugins/SpellLearning/llm_prompt_template.txt"
  outputPath: "Data/SKSE/Plugins/SpellLearning/llm_output.json"
  difficulty: "normal"  # easy, normal, hard, expert, master
  # LLM uses this to calculate XP requirements
  # Also receives baseXPPerCast and bonus multipliers for calculations
```

---

## Success Criteria

### Tier 1 Complete When:
- [x] F9 opens/closes PrismaUI panel
- [x] Panel displays title, status, scan button, text area
- [x] Scan button triggers spell enumeration
- [x] Spell data + LLM prompt appears in text area
- [x] Output saved to file
- [x] SKSE logs show scan progress and results

### Tier 2 Complete When:
- [ ] Can paste LLM JSON response into text area
- [ ] Import button parses and validates tree
- [ ] Tree saved to spell_tree.json (includes requiredXP and orphanedSpells)
- [ ] Tree loads on game start
- [ ] Invalid spell references logged as warnings
- [ ] Orphaned spells parsed and stored separately
- [ ] Fallback XP requirements used if LLM doesn't provide requiredXP

### Tier 3 Complete When:
- [ ] Tree displays visually with nodes and edges
- [ ] Orphaned spells appear floating (separate from tree)
- [ ] Can zoom and pan the view
- [ ] School tabs filter display
- [ ] Node hover shows spell details (including requiredXP)
- [ ] Node states visually distinct (including orphaned state)
- [ ] Orphaned spells show "Standalone" badge

---

## Dependencies

- **SKSE64** - Script extender
- **CommonLibSSE-NG** - Modern SKSE plugin framework
- **PrismaUI 1.2.0+** - In-game HTML/JS UI framework
- **nlohmann/json** - C++ JSON library (via vcpkg)
- **yaml-cpp** - Configuration loading (via vcpkg)

---

## Notes

- The LLM call happens outside the game (user copies prompt, runs LLM, pastes result)
- Future enhancement: integrate local LLM or API call from mod
- Spell tree is per-playthrough, not global (stored in save-specific location eventually)
- Consider mod compatibility: handle spells added by other mods gracefully
