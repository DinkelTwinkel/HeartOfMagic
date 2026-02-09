# Presets: Creating and Sharing

Heart of Magic has two preset systems that let you save, share, and load configurations.

## Preset Types

| Type | What It Saves | Use Case |
|------|---------------|----------|
| **Settings Presets** | XP rates, tier requirements, progression tuning, early spell learning, tome learning | "Easy mode", "Hardcore", custom difficulty |
| **Scanner Presets** | Root layout, growth algorithm settings, grid config, spell matching mode, PreReq Master locks | "Wide radial tree", "Tight clustered", custom visual style |

## In-Game Operations

### Save a Preset

1. Configure your settings the way you want them
2. Click the **[+] Save** button next to the preset chips
3. Enter a name in the prompt
4. Your preset appears as a new chip

### Apply a Preset

Click on any preset chip. All settings for that type update immediately.

### Update a Preset

1. Apply a preset (it highlights as active)
2. Adjust settings
3. Click the refresh button on the active chip
4. Current settings overwrite the saved preset

### Rename a Preset

Double-click the preset chip name. An inline text field appears — type the new name and press Enter.

### Delete a Preset

1. Click the X button on a preset chip
2. The button turns red (armed)
3. Click again within 2 seconds to confirm deletion

The Default preset cannot be deleted.

## Built-In Settings Presets

Three settings presets ship with the mod:

### Default (Normal)

Balanced progression. 100 XP for Novice spells up to 1500 XP for Master. Standard casting multipliers.

### Easy

2x faster progression. Half the XP requirements. Higher casting multipliers and caps. Wider early learning effectiveness range. More XP from spell tomes.

### Hard

75% XP rate. 50-67% higher tier requirements. Lower casting multipliers and caps. Narrower early learning range. Higher reveal thresholds (more discovery before seeing spell details).

## What Settings Presets Save

- XP global multiplier and per-source multipliers (Direct/School/Any)
- XP caps per source
- Tier XP requirements (Novice through Master)
- Learning mode and reveal thresholds
- Early spell learning (enabled, unlock threshold, effectiveness range, power steps)
- Spell tome learning (enabled, XP grant, inventory boost, prerequisite requirements)
- Discovery mode and notification settings

## What Scanner Presets Save

- Tree generation parameters (all procedural settings)
- Root base settings (Sun mode: ring tier, grid density, grid type; Flat mode: line points, direction)
- Active root mode (Sun/Flat)
- Classic growth settings (spread, radial bias, center mask, spell matching mode)
- Tree growth settings (trunk thickness, branch/trunk/root allocation)
- Active growth mode (Classic/Tree)
- PreReq Master settings (lock percentages, tier constraints, distribution mode)

## File Locations

Presets are stored as individual JSON files:

```
Skyrim SE/Data/SKSE/Plugins/SpellLearning/
  presets/
    settings/
      Default.json
      Easy.json
      Hard.json
      MyCustomDifficulty.json
    scanner/
      WideRadial.json
      TightClustered.json
```

Under MO2, these may be in the **Overwrite** folder:
```
MO2/overwrite/SKSE/Plugins/SpellLearning/presets/...
```

## Sharing Presets

### Exporting

1. Navigate to the preset folder on disk (see File Locations above)
2. Copy the `.json` file for the preset you want to share
3. Share the file (Nexus, Discord, etc.)

### Importing

1. Download the preset `.json` file
2. Drop it into the correct folder:
   - Settings presets go in `presets/settings/`
   - Scanner presets go in `presets/scanner/`
3. Restart the game (or reopen the Heart of Magic panel)
4. The preset appears as a chip in the UI

### Preset File Format

Settings preset example:

```json
{
  "name": "Relaxed Explorer",
  "created": 1707521234567,
  "builtIn": false,
  "settings": {
    "xpGlobalMultiplier": 1.5,
    "xpMultiplierDirect": 120,
    "xpMultiplierSchool": 60,
    "xpMultiplierAny": 15,
    "xpCapDirect": 55,
    "xpCapSchool": 20,
    "xpCapAny": 8,
    "xpNovice": 75,
    "xpApprentice": 150,
    "xpAdept": 300,
    "xpExpert": 600,
    "xpMaster": 1200,
    "learningMode": "perSchool",
    "revealName": 8,
    "revealEffects": 20,
    "revealDescription": 40,
    "earlySpellLearning": {
      "enabled": true,
      "unlockThreshold": 20,
      "minEffectiveness": 25,
      "maxEffectiveness": 75
    },
    "spellTomeLearning": {
      "enabled": true,
      "xpPercentToGrant": 30,
      "tomeInventoryBoost": true,
      "tomeInventoryBoostPercent": 30
    }
  }
}
```

Scanner preset example:

```json
{
  "name": "Wide Radial",
  "created": 1707521234567,
  "settings": {
    "treeGeneration": { },
    "sunSettings": {
      "ringTier": 5,
      "nodeSize": 25,
      "rootsPerSchool": 4,
      "gridDensity": 0.8,
      "gridType": "EqualArea",
      "invertGrowth": false
    },
    "activeMode": "sun",
    "classicSettings": {
      "spread": 100,
      "radialBias": 0.5,
      "spellMatching": "smart"
    },
    "treeGrowthActiveMode": "classic",
    "prmEnabled": true,
    "prmSettings": {
      "globalLockPercent": 30
    }
  }
}
```

## Tips

- Start from a built-in preset and tweak from there
- Scanner presets pair with specific root modes — a Sun-based scanner preset won't look right if applied with Flat mode active
- Share your presets on the mod's Nexus page for others to try
- Back up your presets folder before updating the mod
