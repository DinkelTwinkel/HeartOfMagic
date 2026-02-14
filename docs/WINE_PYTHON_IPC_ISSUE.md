# Wine/Proton Python IPC Issue — Summary for External Consultation

## The Problem

A Skyrim SKSE plugin (C++ DLL) needs to communicate with an embedded Windows Python 3.12 subprocess. On **native Windows**, this works perfectly using anonymous pipes (`CreatePipe` + `STARTF_USESTDHANDLES`). On **Linux via Wine/Proton**, the Python process spawns but crashes or cannot communicate.

The mod runs inside MO2 (Mod Organizer 2) with USVFS virtual filesystem. The Python subprocess runs `server.py`, a persistent JSON-line protocol server that handles spell tree building requests. Heavy imports (sklearn, numpy) are loaded once at startup.

## Architecture

```
SkyrimSE.exe (Wine/Proton)
  └─ SpellLearning.dll (SKSE plugin, C++)
       └─ PythonBridge class
            └─ CreateProcessW → python.exe -u server.py [--port N]
                 └─ JSON-line protocol over pipes (Windows) or TCP socket (Wine)
```

- **C++ side**: `PythonBridge.cpp` — spawns Python, sends commands via stdin pipe (or TCP socket), reads responses via stdout pipe (or TCP socket) on a background reader thread.
- **Python side**: `server.py` — reads JSON commands from stdin (or TCP socket), sends JSON responses to stdout (or TCP socket). All debug logging goes to `server.log` file.
- **Python exe**: Windows embedded Python 3.12.8 (`python-3.12.8-embed-amd64.zip`), auto-downloaded and extracted by the mod's installer. Uses `._pth` file for path configuration.

## What Works on Wine

- `std::system("python.exe get-pip.py")` — works perfectly (PythonInstaller uses this)
- `std::system("python.exe -m pip install -r requirements.txt")` — works perfectly
- Download (WinHTTP), ZIP extraction (miniz), file I/O — all work
- The entire auto-setup pipeline (download Python, extract, install pip, install requirements) completes successfully
- TCP socket creation, bind, listen, accept, connect — all work
- Python.exe CAN launch and connect to TCP sockets

## What Fails on Wine

`CreateProcessW` with `STARTF_USESTDHANDLES` pipe redirection. The Python process either:
1. Exits immediately with no output captured (exit code `0x80000100`)
2. Connects to TCP but crashes ~150ms later (same exit code)

Exit code `0x80000100` = `2147483904` decimal. This appears to be a Wine-specific NTSTATUS code, not a standard Windows error.

## Attempt History (Chronological)

### Attempt 1: Environment Variable Fix
**Problem**: Python printed `LookupError: unknown encoding: utf-8PYTHONUNBUFFERED=1PYTHONDONTWRITEBYTECODE=1`
**Cause**: Environment block null separators were broken. `envBlock += L"PYTHONIOENCODING=utf-8\0"` — the `\0` in a `wchar_t*` string literal is eaten by `std::wstring::operator+=(const wchar_t*)` which stops at the first null.
**Fix**: Changed to `envBlock += L"PYTHONIOENCODING=utf-8"; envBlock += L'\0';` (separate wchar_t append)
**Result**: Fixed the encoding error, but process still exits with `0x80000100`

### Attempt 2: Remove CREATE_NO_WINDOW
**Theory**: `CREATE_NO_WINDOW` prevents Wine from initializing the console subsystem that python.exe (a console app) needs.
**Change**: Removed `CREATE_NO_WINDOW` flag on Wine.
**Result**: Still `0x80000100`. Wine also fails without `CREATE_NO_WINDOW`.

### Attempt 3: Restore CREATE_NO_WINDOW + Correct Env Vars
**Theory**: Both env var fix AND `CREATE_NO_WINDOW` were needed simultaneously (previous attempts only had one or the other).
**Change**: Both fixes together.
**Result**: Still `0x80000100`. No output captured from Python.

### Attempt 4: TCP Socket IPC (Bypass Pipes Entirely)
**Theory**: Pipe handle inheritance is fundamentally broken in Wine/Proton. TCP localhost sockets work reliably.
**Changes**:
- C++ creates TCP listen socket on `127.0.0.1:0` (OS picks port)
- Passes `--port N` to Python command line
- Spawns Python WITHOUT `STARTF_USESTDHANDLES` (no pipe redirection)
- Sets `bInheritHandles = FALSE`
- Accepts TCP connection from Python
- All read/write goes through `recv()`/`send()` instead of `ReadFile()`/`WriteFile()`
- Python side: `argparse` for `--port`, `socket.connect()`, wraps socket in file objects for `readline()`/`write()`

**Result**: **Partial success** — Python DOES connect to TCP socket (confirmed in logs). But process crashes ~150ms after connecting with same exit code `0x80000100`. No data received through TCP before crash. The connection proves Python starts and executes our code (argparse, socket.connect), but crashes during module imports or I/O initialization.

### Attempt 5: NUL Device Handles + CREATE_NEW_CONSOLE (Current — Untested)
**Theory**: Python.exe is a console application. Without valid stdin/stdout/stderr handles, Python's I/O initialization crashes even though we don't use them (TCP handles real communication). `CREATE_NO_WINDOW` prevents console creation, `CREATE_NEW_CONSOLE` creates a real (hidden) console.
**Changes**:
- Open `NUL` device with `CreateFileW(L"NUL", ...)` for stdin/stdout/stderr
- Pass NUL handles via `STARTF_USESTDHANDLES` so Python has valid I/O handles
- Use `CREATE_NEW_CONSOLE` instead of `CREATE_NO_WINDOW` on Wine (gives Python a real console subsystem)
- Set `bInheritHandles = TRUE` (needed for NUL handle inheritance)
- Keep TCP socket for actual communication

**Status**: Built, not yet tested by Linux user.

## Key Observations

1. **`std::system()` works, `CreateProcessW` doesn't**: The critical difference is that `std::system()` runs through `cmd.exe /c "..."`, which creates a proper console environment. `CreateProcessW` with `CREATE_NO_WINDOW` or without stdio handles doesn't.

2. **TCP connection succeeds**: In Attempt 4, Python successfully connects to the TCP socket (C++ `accept()` returns, logs "TCP connection established"). This proves Python.exe launches, parses arguments, and executes socket.connect(). It crashes AFTER connecting, during startup (probably imports or I/O init).

3. **Consistent exit code**: `0x80000100` appears in every failed attempt. It's not a standard Windows NTSTATUS code. It may be Wine-specific.

4. **Timing**: Python crashes ~150-300ms after spawn. With TCP, it connects at ~200ms and crashes at ~350ms. The timing suggests it gets through basic Python init and our early server.py code, but crashes during heavy imports or first stdout write.

5. **No server.log check yet**: We haven't confirmed whether `server.log` is written on the Linux system. If it exists and has content, it would reveal exactly where Python crashes.

## Relevant Code

### C++ Side: PythonBridge.cpp (SpawnProcess — Wine TCP path)
```cpp
// TCP socket approach on Wine
EnsureWSAStartup();
SOCKET listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
// bind to 127.0.0.1:0, listen(1), getsockname to get port

// Open NUL for stdin/stdout/stderr (Attempt 5)
HANDLE hNulIn = CreateFileW(L"NUL", GENERIC_READ, ...);
HANDLE hNulOut = CreateFileW(L"NUL", GENERIC_WRITE, ...);

// Command line
cmdLine = L"\"python.exe\" -u \"server.py\" --port " + port;

// STARTUPINFO with NUL handles
si.hStdInput = hNulIn;
si.hStdOutput = hNulOut;
si.hStdError = hNulOut;
si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
si.wShowWindow = SW_HIDE;

// CREATE_NEW_CONSOLE on Wine, CREATE_NO_WINDOW on native Windows
createFlags = CREATE_NEW_CONSOLE | CREATE_UNICODE_ENVIRONMENT;
bInheritHandles = TRUE;

CreateProcessW(nullptr, cmdLine, ..., TRUE, createFlags, envBlock, workingDir, &si, &pi);

// Accept TCP connection (15s timeout via select())
m_socket = accept(listenSock, nullptr, nullptr);
// Reader thread uses recv(m_socket, ...) instead of ReadFile(pipe, ...)
```

### Python Side: server.py (TCP socket mode)
```python
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=0)
args = parser.parse_args()

if args.port > 0:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect(('127.0.0.1', args.port))
    sock_file_r = sock.makefile('r', encoding='utf-8')
    _sock_file_w = sock.makefile('w', encoding='utf-8')

# Heavy imports (sklearn, etc.)
from tree_build_tree import build_tree_from_data  # <-- crash may happen here

# Ready signal sent via TCP (or stdout if no --port)
send_response("__ready__", True, {"pid": os.getpid()})

# Main loop reads from sock_file_r (TCP) or sys.stdin
for line in input_source:
    # handle JSON commands
```

## Environment Details

- **Host OS**: Linux (unknown distro)
- **Wine/Proton**: Via Steam Proton (version unknown)
- **Game**: Skyrim Special Edition AE (1.6.1170)
- **Python**: Windows embedded 3.12.8 (PE binary running under Wine)
- **MO2**: Running under Wine with USVFS
- **Wine drive mapping**: `Z:\media\SSD\Steam\steamapps\common\Skyrim Special Edition\` → Linux filesystem
- **MO2 overwrite**: `Z:\media\SSD\SkyrimModding\overwrite\` (Python exe installed here)
- **MO2 mod folder**: `Z:\media\SSD\SkyrimModding\mods\Heart of Magic\` (server.py here)

## Wine Detection
```cpp
// WineDetect.h
static bool IsRunningUnderWine() {
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    return ntdll && GetProcAddress(ntdll, "wine_get_version");
}
```

## Questions for Consultation

1. What does Wine exit code `0x80000100` mean? Is it a console initialization failure?
2. Is there a known Wine bug with `CreateProcessW` + `CREATE_NO_WINDOW` for console applications?
3. Would `DETACHED_PROCESS` work better than `CREATE_NO_WINDOW` or `CREATE_NEW_CONSOLE`?
4. Is there a way to make `CreateProcessW` on Wine behave like `std::system()` / `cmd.exe /c`?
5. Could the `-u` (unbuffered) Python flag cause crashes when stdio is invalid?
6. Should we just use `std::system()` or `_popen()` instead of `CreateProcessW` for the Wine path?
7. Is there a Wine-specific API or workaround for subprocess stdio redirection?
