# Heart of Magic - Spell Learning System

A spell progression system for Skyrim SE/AE that creates skill trees for learning spells. Spells must be unlocked through a progression tree before they can be learned from spell tomes.

## Requirements

### Required
- **Skyrim SE/AE** (1.5.97+ or AE)
- **SKSE64** - [Download](https://skse.silverlock.org/)
- **Address Library for SKSE Plugins** - [Nexus](https://www.nexusmods.com/skyrimspecialedition/mods/32444)
- **PrismaUI** - UI framework (included or separate download)
- **OpenRouter API Key** - For LLM-powered tree generation (optional)

### Optional (for Complex Build mode)
- **Python 3.10+** - Required for the "BUILD TREE (Complex)" option
  - Download from [python.org](https://www.python.org/downloads/)
  - During installation, check "Add Python to PATH"

## Installation

### Using Mod Organizer 2 (Recommended)
1. Download `HeartOfMagic_v1.0.zip`
2. In MO2, click "Install a new mod from archive" (📦 icon)
3. Select the downloaded ZIP file
4. Name it "Heart of Magic" and click OK
5. Enable the mod in your load order

### Manual Installation
1. Extract `HeartOfMagic_v1.0.zip` to your Skyrim `Data` folder
2. Your folder structure should look like:
   ```
   Data/
   ├── Scripts/
   │   ├── SpellLearning_Bridge.pex
   │   └── ...
   ├── SKSE/
   │   └── Plugins/
   │       ├── SpellLearning.dll
   │       └── SpellLearning/
   │           └── SpellTreeBuilder/
   │               ├── build_tree.py
   │               └── ...
   └── PrismaUI/
       └── views/
           └── SpellLearning/
               └── ...
   ```

### Python Setup (for Complex Build)
If you want to use the **BUILD TREE (Complex)** option for better thematic spell grouping:

**Easy Setup (Recommended):**
1. Install Python 3.9 or newer from https://www.python.org/downloads/
   - **IMPORTANT**: Check "Add Python to PATH" during installation!
2. Navigate to `Data\SKSE\Plugins\SpellLearning\SpellTreeBuilder\`
3. Double-click **`setup.bat`**
4. Done! The script installs everything automatically.

**Manual Setup:**
If the setup script doesn't work, open Command Prompt in the SpellTreeBuilder folder and run:
```
cd "C:\path\to\Skyrim\Data\SKSE\Plugins\SpellLearning\SpellTreeBuilder"
python -m pip install -r requirements.txt
```
Use `python -m pip` (not plain `pip`) so it uses the same Python that's on your PATH. If only `py` works, use: `py -3.11 -m pip install -r requirements.txt` (see Troubleshooting below).

**Python Version:**
- Minimum: Python 3.9
- Recommended: Python 3.10 or 3.11
- Python 3.12+ should also work

**Optional: Using a venv**

Yes, you can use a Python virtual environment for the Complex Build tool. The plugin runs `python build_tree.py ...` from the game; it uses whatever `python` is on your PATH unless we add venv detection.

| | Pros | Cons |
|---|------|------|
| **Venv** | **Isolation** – no conflict with other projects or system Python (e.g. you have 3.13 elsewhere; venv can be 3.11 + known-good scikit-learn). **Reproducible** – same deps per mod install. **No global pollution** – packages stay inside the mod folder. **Clean uninstall** – delete mod folder = delete venv. | **Plugin must use it** – in-game Complex Build currently runs `python` from PATH. To use a venv, the DLL would need to look for `SpellTreeBuilder\.venv\Scripts\python.exe` (Windows) and call that if present. **Don’t ship venv in the zip** – release stays small; users run setup to create the venv and install deps (same as now, but setup would create `.venv` first). **Slightly more setup** – “run setup.bat” becomes “run setup.bat (creates .venv + pip install)”. |

- **Manual use today:** You can create a venv in the SpellTreeBuilder folder and run the script yourself: `python build_tree.py -i ... -o ...`. The in-game “BUILD TREE (Complex)” button will still use system `python` unless the plugin is updated to prefer the venv interpreter when present.
- **If we add venv support:** Setup script would run `python -m venv .venv` then `.venv\Scripts\pip install -r requirements.txt`. The C++ plugin would check for `SpellTreeBuilder\.venv\Scripts\python.exe` (or `Scripts/python.exe` relative to the script) and use it if it exists, otherwise fall back to `python` on PATH.

## Usage

### Opening the UI
- Press the configured hotkey (default: check MCM/keybinds)
- Or use the console command: `coc SpellLearningPanel`

### Building Your Spell Tree

1. **Scan Spells**
   - Click **SCAN ALL SPELLS** to discover your installed spell mods
   - Wait for the scan to complete

2. **Generate Tree**
   - **BUILD TREE (Complex)** - Recommended if you have Python installed
     - Uses fuzzy NLP matching for intelligent thematic grouping
     - Fire spells connect to fire spells, healing to healing, etc.
   - **BUILD TREE (Simple)** - No Python required
     - Basic theme grouping using JavaScript
     - Still creates valid progression trees

3. **View Your Tree**
   - Click the **SPELL TREE** tab to see your generated tree
   - Navigate by clicking on spell nodes
   - Zoom with mouse wheel or +/- buttons

### Unlocking Spells
- Start with the root spell in each school (e.g., Flames for Destruction)
- Learn connected spells by meeting their requirements:
  - **Hard Requirements** - Must learn ALL of these first
  - **Soft Requirements** - Must learn X out of Y options
- Once a spell is unlocked, you can learn it from spell tomes

### Settings
- **Developer Mode** - Enables advanced options (tree rules, debug grid, etc.)
- **Cheat Mode** - Allows unlocking any spell instantly
- **Discovery Mode** - Choose how mystery spells are revealed

## Build Modes Comparison

| Feature | Complex (Python) | Simple (JS) |
|---------|-----------------|-------------|
| Thematic Grouping | Fuzzy NLP matching | Basic keyword matching |
| Prerequisites | Hard/Soft with tier weighting | Hard/Soft basic |
| Alternate Paths | Yes | Yes |
| Shape Control | Yes | No |
| LLM Auto-Config | Yes (optional) | No |
| Dependencies | Python 3.10+ | None |

## Troubleshooting

### "pip" is not recognized / "py" gives scikit-learn errors
This usually happens for one of these reasons:

1. **Python wasn't added to PATH**  
   During install from [python.org](https://www.python.org/downloads/), you must check **"Add Python to PATH"**. If you missed it:
   - Re-run the installer and choose "Modify" → enable "Add Python to PATH", or
   - Use the full path to pip, e.g. `"C:\Users\YourName\AppData\Local\Programs\Python\Python311\python.exe" -m pip install -r requirements.txt` (adjust path to your Python version).

2. **Cmd was already open**  
   PATH is set when the window opens. After installing Python, close Command Prompt and open a **new** one (or restart the PC), then try `python -m pip install -r requirements.txt` again.

3. **Using `py` runs a different Python**  
   The Windows "Python Launcher" (`py`) can point at a different Python (e.g. 32-bit, or an old 2.7/3.6). scikit-learn needs **64-bit Python 3.9–3.12** and often has no wheel for 32-bit or very new (e.g. 3.13) versions, so you get "failed to find a suitable install for scikit-learn".
   - Check what you have: `py -0p` (lists installed Pythons).
   - Install with a specific version: `py -3.11 -m pip install -r requirements.txt` (use 3.10 or 3.11 if you have it).
   - Prefer installing from python.org (64-bit) and using `python -m pip` so the mod's "Complex Build" finds the same Python.

4. **Upgrade pip first**  
   Old pip can fail to find wheels. Run: `python -m pip install --upgrade pip` then `python -m pip install -r requirements.txt`.

### "Python not found" error
- Ensure Python is installed and added to PATH
- Restart your computer after installing Python
- Try running `python --version` in Command Prompt

### Tree not generating
- Make sure you scanned spells first
- Check the Output area for error messages
- Try the Simple Build if Complex fails

### Spells not appearing
- Some spells may be filtered out (NPC-only, duplicates)
- Check "Scan Spell Tomes Only" setting
- Enable Developer Mode to see Output Fields options

### UI not opening
- Ensure PrismaUI is installed correctly
- Check SKSE is loading (see SKSE logs)
- Verify SpellLearning.dll exists in SKSE/Plugins

## Credits
- SKSE Team for SKSE64
- PrismaUI developers
- OpenRouter for LLM API access

## License
This mod is provided as-is for personal use. Do not redistribute without permission.
