# Wine/Proton Python Compatibility

## Current Status (Testing)

The mod runs on Linux via Wine/Proton using **Windows embedded Python** with the following workarounds:

- **TCP socket IPC** instead of pipes (pipe inheritance is broken in Wine)
- **`cmd.exe /c` wrapper with `CREATE_NEW_CONSOLE`** — cmd.exe properly chains the process environment to Python, while `CREATE_NEW_CONSOLE` allocates a console so both cmd.exe and Python get valid stdio handles even from Steam/Proton (no parent console). `SW_HIDE` keeps the console window invisible.
- **Subprocess isolation** to detect numpy segfaults before they crash the server
- **sys.modules poisoning** to prevent segfault-causing imports while letting pure-Python fallbacks work
- **Python 3.11.9** for Wine (3.12+ has additional Wine issues)
- **Extended timeouts** — 30s TCP connect, 120s ready signal (numpy/sklearn subprocess tests take ~30s each)

All 5 tree builders register and work. Tree building completes successfully with 866 spells in ~6s.

## The numpy Problem

numpy's C extensions (.pyd files compiled with MSVC) crash with `STATUS_DLL_INIT_FAILED` (exit code `0x80000100` / `2147483904`) when imported under Wine/Proton. This is a hard segfault at the C level — `try/except ImportError` cannot catch it.

**Root cause**: numpy's OpenBLAS/BLAS binaries use SIMD instructions and threading primitives that Wine's ucrtbase.dll doesn't fully implement. Environment variables like `OPENBLAS_NUM_THREADS=1`, `OPENBLAS_CORETYPE=Haswell`, and `NPY_DISABLE_CPU_FEATURES` do not help — the crash happens during DLL initialization before these are read.

**Affected**: numpy, sklearn, and any package that imports them at module level.

**Current workaround**:
1. When `--wine` flag is passed, server.py spawns `python -c "import numpy"` in an isolated subprocess
2. If that subprocess crashes (exit code != 0), numpy/sklearn are "poisoned" in `sys.modules` with dummy modules that raise `ImportError` on attribute access
3. Builder modules with `try: import numpy except ImportError` fallbacks gracefully degrade to pure-Python implementations
4. Builder modules that are pure-Python (prereq_master_scorer, etc.) work unchanged

## Debugging Timeline

### Attempt 7: First Wine/Proton investigation
- Discovered pipes are broken on Wine (no handle inheritance)
- Switched to TCP socket IPC
- Used cmd.exe /c wrapper for CreateProcess
- Python started but crashed during module imports

### Attempt 8: Python 3.11.9 for Wine
- Hypothesis: Python 3.12 has Wine issues, try 3.11.9
- Added `PYTHON_URL_WINE` to PythonInstaller for automatic version selection
- Result: **Same crash** — numpy segfaults on both 3.11.9 and 3.12.8
- Conclusion: The issue is numpy's C extensions, not the Python version

### Attempt 9: Subprocess isolation
- Test `import numpy` in isolated subprocess before importing in main process
- If subprocess crashes, skip ALL numpy-dependent builder imports
- Result: **Server starts!** First successful launch on Wine
- Problem: Zero builders registered (all were skipped)

### Attempt 9b: Poison modules
- Instead of skipping builder imports entirely, poison `sys.modules` with dummy entries
- Modules with `try/except ImportError` fallbacks now work
- Result: **All 5 builders registered**, tree built successfully
- This is the current shipping solution

### Attempt 10: Direct spawn + CREATE_NEW_CONSOLE
- **Problem**: Two Steam/Proton users reported TCP connection timeout — Python never connected
- **Root cause**: cmd.exe /c without `CREATE_NEW_CONSOLE` only works if the parent process has a console (e.g. launched from terminal). Steam/Proton launches have no console → cmd.exe/Python get no stdio → Python crashes before executing server.py
- **Fix**: Spawn python.exe directly (no cmd.exe wrapper) with `CREATE_NEW_CONSOLE | CREATE_UNICODE_ENVIRONMENT` and `STARTF_USESHOWWINDOW + SW_HIDE`. The console gives Python valid stdin/stdout/stderr handles; SW_HIDE keeps it invisible in Proton's virtual desktop. TCP socket handles actual communication.
- **Also**: Increased TCP timeout from 15s → 30s, ready timeout from 15s → 120s (Wine numpy/sklearn subprocess tests take ~30s each). Added exit code diagnostics on TCP timeout.
- **Result**: Python process exits with code 1 (0x1) — a Python-level error, not a DLL crash. The new diagnostics work (exit code captured), but Python never reaches TCP connect. Direct spawn may bypass Wine's process chain setup that cmd.exe handles.

### Attempt 11: cmd.exe /c + CREATE_NEW_CONSOLE (current)
- **Problem**: Direct python.exe spawn (Attempt 10) exits with code 1 before connecting
- **Hypothesis**: cmd.exe is needed for Wine's process chain to properly set up the environment for Python. The original cmd.exe approach worked for terminal users — only the missing console was the issue.
- **Fix**: Combine both approaches — use `cmd.exe /c` wrapper WITH `CREATE_NEW_CONSOLE | CREATE_UNICODE_ENVIRONMENT` and `STARTF_USESHOWWINDOW + SW_HIDE`. cmd.exe chains the environment to Python, CREATE_NEW_CONSOLE gives valid stdio, SW_HIDE keeps it invisible.
- **Also**: Added pre-spawn verification that resolved server.py path exists on disk.

### Attempt 12: Linux native Python (removed)
- Hypothesis: Launch Linux native python3 (where numpy works natively) as Phase 1, fall back to Windows Python as Phase 2
- Implementation: Find python3 at Z:\usr\bin\python3, write bash script to /tmp/, launch via cmd.exe /c bash
- Result: **python3 and bash found**, paths converted correctly, bash script written, process launched, but **TCP connection timed out after 5s**
- Phase 2 fallback worked perfectly
- **Removed from codebase** to eliminate 5s startup delay

## Future: Linux Native Python (Phase 1)

### Why it would be valuable
- numpy and sklearn work natively on Linux — no segfaults, no poison modules
- Full NLP/TF-IDF scoring for better spell tree quality
- All builder features at full capability instead of pure-Python fallbacks

### What was attempted
The code (removed in cleanup, preserved in git history and this doc):

1. **Path conversion**: `wine_get_unix_file_name()` from kernel32.dll converts Windows paths to Unix paths. This worked correctly:
   ```
   Z:\usr\bin\python3 -> /usr/bin/python3
   Z:\media\SSD\.../server.py -> /media/SSD/.../server.py
   ```

2. **Finding Linux Python**: Check `Z:\usr\bin\python3`, `Z:\usr\local\bin\python3`, etc. via `std::filesystem::exists()`. Worked — found python3 at Z:\usr\bin\python3.

3. **Bash script**: Write to Z:\tmp\hom_server_<pid>.sh (maps to /tmp/...):
   ```bash
   #!/bin/bash
   exec "/usr/bin/python3" -u "/path/to/server.py" --port 41817 2>>"/path/to/linux_server.log"
   ```
   File was written successfully.

4. **Launch**: `cmd.exe /c Z:\bin\bash "/tmp/hom_server_2204.sh"` — CreateProcess succeeded, got pid 2624.

5. **TCP connection**: Bound to 127.0.0.1:41817, waited 5s — **timed out**.

### Why it likely failed

Several hypotheses (not confirmed — need more diagnostics):

1. **Proton pressure-vessel container**: Modern Proton uses pressure-vessel to containerize the game. cmd.exe runs inside the container, but launching bash/python3 might put them in a different namespace where 127.0.0.1 is not shared with the Wine process.

2. **cmd.exe doesn't properly chain to ELF binaries**: While Wine's CreateProcess can launch ELF binaries directly, cmd.exe /c might not handle the ELF → native execution transition correctly. cmd.exe might report success but bash never actually runs.

3. **bash can't find the script**: The script path `/tmp/hom_server_2204.sh` should exist, but the path might not resolve correctly within the execution context. A more robust approach would embed the commands directly instead of using a script file.

4. **Linux Python can't connect to Wine's TCP socket**: Wine translates Winsock bind() to Linux socket bind(), so the port should be on real localhost. But if the Linux process runs in a different network namespace (container), it wouldn't see the same port.

5. **Missing python3 dependencies**: The system python3 might be missing packages needed by server.py (argparse, socket, json are stdlib so this is unlikely, but the server.py path discovery might fail).

### Investigation steps for the future

1. **Add bash diagnostics**: Modify the bash script to write debug info BEFORE exec:
   ```bash
   #!/bin/bash
   LOG="/tmp/hom_linux_diag.log"
   echo "$(date): bash started, PID=$$" >> "$LOG"
   echo "python3 path: $(which python3 2>&1)" >> "$LOG"
   echo "python3 version: $(python3 --version 2>&1)" >> "$LOG"
   echo "can connect: $(python3 -c 'import socket; s=socket.socket(); s.connect(("127.0.0.1", PORT)); print("YES")' 2>&1)" >> "$LOG"
   exec "/usr/bin/python3" -u "/path/to/server.py" --port PORT 2>>"$LOG"
   ```
   Have tester check Z:\tmp\hom_linux_diag.log after launch.

2. **Try direct CreateProcess on ELF**: Skip cmd.exe wrapper entirely. Wine 3.0+ can launch ELF binaries directly via CreateProcess. The process handle will be NULL, but we don't need it — the TCP connection is what matters. Use socket closure for cleanup instead of TerminateProcess.

3. **Try `start /unix`**: Wine's start.exe has special `/unix` flag for launching Linux binaries:
   ```
   start.exe /unix /bin/bash /tmp/script.sh
   ```

4. **Try flatpak-spawn**: If running under Flatpak/pressure-vessel, `flatpak-spawn --host` can escape the container:
   ```bash
   flatpak-spawn --host python3 -u /path/to/server.py --port N
   ```

5. **Increase timeout**: Try 15-30s instead of 5s in case Linux Python is slow to start.

6. **Check /tmp/hom_linux_server.log**: Ask tester to check if this file exists after launch. If it doesn't, bash never ran (or couldn't write to /tmp/).

7. **Test with vanilla Proton vs GE-Proton**: Different Proton versions have different container configurations. GE-Proton is more permissive.

### Key APIs for implementation

```cpp
// Convert Windows path to Unix path (kernel32.dll Wine export)
using fn_t = char*(__cdecl*)(const wchar_t*);
auto wine_get_unix_file_name = (fn_t)GetProcAddress(
    GetModuleHandleA("kernel32.dll"), "wine_get_unix_file_name");

// Find Linux binaries via Z:\ drive mapping
std::filesystem::exists("Z:\\usr\\bin\\python3")  // checks /usr/bin/python3

// Wine detection
auto wine_get_version = GetProcAddress(
    GetModuleHandleA("ntdll.dll"), "wine_get_version");
```

### Architecture (for when this is re-attempted)

```
SpawnProcess() — Wine detected
|
+-- Phase 1: Try Linux native python3
|   +-- Find python3 at Z:\usr\bin\python3 etc.
|   +-- Convert server.py path to Unix via wine_get_unix_file_name()
|   +-- Write bash script with diagnostics to Z:\tmp\
|   +-- Launch via cmd.exe /c bash (or direct ELF CreateProcess)
|   +-- Wait for TCP connection (10-15s timeout)
|   +-- If connected: numpy works natively, all builders at full capability
|
+-- Phase 2: Fall back to Windows Python (current approach)
    +-- Direct: python.exe -u server.py --port N --wine
    +-- CREATE_NEW_CONSOLE + SW_HIDE for valid stdio
    +-- Poison modules prevent segfault
    +-- Pure-Python fallback paths for all builders
```

## Files involved

| File | Role |
|------|------|
| `plugin/src/PythonBridge.cpp` | Process spawning, TCP socket IPC, Wine workarounds |
| `plugin/src/PythonBridge.h` | Bridge class declaration |
| `plugin/src/WineDetect.h` | Wine detection via ntdll.dll `wine_get_version` |
| `plugin/src/PythonInstaller.h` | Python download URLs (3.11.9 for Wine, 3.12.8 for Windows) |
| `plugin/src/PythonInstaller.cpp` | Wine-aware Python installer |
| `SKSE/.../SpellTreeBuilder/server.py` | Python server: subprocess isolation, poison modules, builder registration |
