# Python Troubleshooting

Heart of Magic uses an embedded Python environment to build spell trees. The "Complex Build" button triggers a Python script that analyzes your spell list and generates the tree structure. Python is installed automatically from the in-game UI, but if that fails, this guide covers how to fix it.

## Normal Install Flow

1. Open the Heart of Magic panel in-game
2. Click **Setup Python** (appears if Python is not detected)
3. The installer downloads Python 3.12.8 (embedded), pip, and required packages
4. Progress bar shows each stage — takes 1-3 minutes depending on internet speed
5. When complete, the Build button becomes available

## Common Problems

### "Download failed after multiple attempts"

**Cause**: Firewall, antivirus, or network issue blocking the download.

**Fix**:
1. Check if your firewall/antivirus is blocking Skyrim or SKSE from making network requests
2. Add an exception for `python.org` and `bootstrap.pypa.io`
3. Try again
4. If still failing, use the Manual Installation below

### "Failed to extract Python archive"

**Cause**: Corrupt download or file permission issue.

**Fix**:
1. Navigate to `Data/SKSE/Plugins/SpellLearning/SpellTreeBuilder/`
2. Delete `python_temp.zip` if it exists
3. Delete the `python/` folder if it exists
4. Try the in-game installer again
5. If running MO2, try running MO2 as administrator

### "get-pip.py contains HTML, not Python"

**Cause**: A CDN or corporate proxy redirected the download to an error page instead of the actual Python script.

**Fix**:
1. Download `get-pip.py` manually from https://bootstrap.pypa.io/get-pip.py
2. Save it to `SpellTreeBuilder/python/get-pip.py`
3. Continue with the Manual Installation steps below from step 4

### "Failed to install packages"

**Cause**: Missing `requirements.txt` or package incompatibility.

**Fix**:
1. Verify `SpellTreeBuilder/requirements.txt` exists in the mod files
2. If missing, reinstall the mod — the file should be included
3. If present, try the manual pip install (step 5 in Manual Installation below)

### Build button stays disabled after install

**Cause**: MO2's virtual filesystem (USVFS) is hiding the completion marker file.

**Fix**:
1. Check the MO2 **Overwrite** folder for `SKSE/Plugins/SpellLearning/SpellTreeBuilder/python/`
2. If the python folder is there with `.install_complete`, the install succeeded — restart MO2
3. If `.install_complete` is missing, create it manually (empty file is fine)
4. Refresh MO2 (F5) and relaunch the game

### Stuck on partial install

**Cause**: Game crashed or was force-quit during Python setup.

**Fix**:
1. Navigate to `SpellTreeBuilder/` (check both the mod folder and MO2 Overwrite)
2. Delete the `python/` folder entirely
3. Delete `python_temp.zip` if present
4. Relaunch and try the in-game installer again

## Manual Installation

If the in-game installer won't work, you can set up Python manually.

### Requirements

- Internet access (for downloading)
- ~100 MB disk space

### Steps

**1. Download Python 3.12.8 Embedded**

Download from: https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip

**2. Extract to the SpellTreeBuilder folder**

Extract the ZIP contents to:
```
Data/SKSE/Plugins/SpellLearning/SpellTreeBuilder/python/
```

Under MO2, put this in your mod folder or Overwrite:
```
MO2/mods/HeartOfMagic_RELEASE/SKSE/Plugins/SpellLearning/SpellTreeBuilder/python/
```

After extraction, `python.exe` should be directly inside the `python/` folder (not in a subfolder).

**3. Enable site-packages**

Find the file `python312._pth` in the `python/` folder. Open it in a text editor.

Find the line:
```
#import site
```

Remove the `#` to uncomment it:
```
import site
```

Save the file. This allows pip to install third-party packages.

**4. Install pip**

Download `get-pip.py` from: https://bootstrap.pypa.io/get-pip.py

Save it to the `python/` folder. Then open a command prompt in the `python/` folder and run:

```cmd
python.exe get-pip.py --no-warn-script-location
```

**5. Install required packages**

Still in the command prompt, run:

```cmd
python.exe -m pip install --no-warn-script-location -r ..\requirements.txt
```

The `requirements.txt` file is in the `SpellTreeBuilder/` folder (one level up from `python/`). It installs:

| Package | Purpose |
|---------|---------|
| scikit-learn | TF-IDF vectorization for theme discovery |
| thefuzz | Fuzzy string matching for spell grouping |
| python-Levenshtein | Fast string distance calculations |
| requests | HTTP client (for optional LLM features) |

**6. Create the completion marker**

Create an empty file named `.install_complete` in the `python/` folder. This tells the mod that Python is ready.

**7. Verify**

Check that these exist:
- `SpellTreeBuilder/python/python.exe`
- `SpellTreeBuilder/python/.install_complete`
- `SpellTreeBuilder/python/Lib/site-packages/sklearn/`
- `SpellTreeBuilder/python/Lib/site-packages/thefuzz/`

Restart the game and open Heart of Magic. The Build button should now be enabled.

## MO2-Specific Notes

- **USVFS quirks**: MO2's virtual filesystem can hide files written by child processes. If Python installs successfully but the mod doesn't detect it, check the **Overwrite** folder.
- **Absolute paths**: The installer uses absolute paths internally to work around USVFS limitations. If you move your MO2 installation, you may need to reinstall Python.
- **Restart MO2**: After any manual changes to mod files, restart MO2 (not just F5 refresh) to ensure the virtual filesystem picks up the changes.

## Verifying Python Works

Open the Heart of Magic panel. If Python is correctly installed, you'll see:
- **"Python ready (detected)"** status in green
- The **Build Tree** button is enabled (after scanning spells)
- No "Setup Python" button visible

If you still see "Setup Python" after a successful install, check that `build_tree.py` exists in `SpellTreeBuilder/` — this is the Python script that the mod actually runs. If only the Python environment is present but the script is missing, reinstall the mod.
