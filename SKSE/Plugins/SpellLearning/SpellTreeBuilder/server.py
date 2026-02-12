#!/usr/bin/env python3
"""
Persistent Python server for PythonBridge (C++ SKSE plugin).

Communicates via stdin/stdout JSON-line protocol.
All debug/logging goes to a log file — stdout is reserved for protocol only.

Protocol:
    C++ -> Python (stdin):  {"id":"req_1","command":"build_tree","data":{...}}\n
    Python -> C++ (stdout): {"id":"req_1","success":true,"result":{...}}\n

Commands:
    build_tree          - Build spell tree (Tree Growth mode, NLP-based)
    build_tree_classic  - Build spell tree (Classic Growth mode, tier-first)
    prm_score           - Score spell-candidate pairs using TF-IDF similarity
    ping                - Health check
    shutdown            - Graceful exit
"""

import argparse
import json
import os
import socket
import sys
import traceback
from datetime import datetime
from pathlib import Path

# Guard against None stdout/stderr (pythonw.exe on Wine sets them to None,
# which causes crashes if any imported module tries to print during import).
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w', encoding='utf-8')

# Ensure the script's own directory is on sys.path so local imports work
_script_dir = str(Path(__file__).resolve().parent)
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

# Add PrismaUI module python dirs to sys.path so each growth mode's
# bundled Python builder can be imported (modularity: each module
# bundles its own builder alongside its JS files).
# Dynamic discovery: any modules/*/python/ dir is auto-added.
_prisma_modules = Path(__file__).resolve().parent.parent.parent.parent.parent / \
    "PrismaUI" / "views" / "SpellLearning" / "SpellLearningPanel" / "modules"

if _prisma_modules.is_dir():
    for _subdir in _prisma_modules.glob('*/python'):
        if _subdir.is_dir():
            _mod_path = str(_subdir)
            if _mod_path not in sys.path:
                sys.path.insert(0, _mod_path)
else:
    # Fallback to hardcoded paths if parent dir not found
    for _subdir in ['classic/python', 'tree/python']:
        _mod_path = str(_prisma_modules / _subdir)
        if os.path.isdir(_mod_path) and _mod_path not in sys.path:
            sys.path.insert(0, _mod_path)

# Log file for debug output (NOT stdout)
# Try multiple locations — mod folders on Wine/Proton may be read-only.
LOG_FILE = None
for _log_candidate in [
    Path(__file__).resolve().parent / "server.log",          # Same dir as server.py
    Path(sys.executable).resolve().parent / "server.log",    # Python dir (overwrite, writable)
    Path(os.environ.get('TEMP', os.environ.get('TMP', '/tmp'))) / "SpellLearning_server.log",
]:
    try:
        with open(_log_candidate, 'a', encoding='utf-8') as _f:
            _f.write("")  # Test write
        LOG_FILE = _log_candidate
        break
    except Exception:
        continue
if LOG_FILE is None:
    LOG_FILE = Path(__file__).resolve().parent / "server.log"  # Fallback, may fail silently

# Command registry: builders self-register so server.py doesn't need
# hardcoded if/elif chains for each mode. Built-in commands (ping,
# shutdown, prm_score) are handled directly in main().
COMMAND_HANDLERS = {}


def register_command(name, handler):
    """Register a command handler. Called by builder modules on import."""
    COMMAND_HANDLERS[name] = handler


def log(msg, flush_to_disk=False):
    """Write to log file. Never print to stdout (reserved for protocol).

    flush_to_disk: if True, force OS-level sync so the message survives a hard crash.
    Use before operations that might segfault (e.g. importing C extensions on Wine).
    """
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
            if flush_to_disk:
                f.flush()
                os.fsync(f.fileno())
    except Exception:
        pass


_sock_file_w = None  # Set to socket file object when using TCP mode


def tcp_diag(msg):
    """Send diagnostic line through TCP socket. Shows up in SKSE log as
    'PythonBridge [python]: ...' even if log file can't be written."""
    if _sock_file_w is not None:
        try:
            _sock_file_w.write(f"DIAG: {msg}\n")
            _sock_file_w.flush()
        except Exception:
            pass


def send_response(request_id, success, result=None, error=None):
    """Send a JSON-line response to C++ reader thread (stdout or TCP socket)."""
    msg = {"id": request_id, "success": success}
    if result is not None:
        msg["result"] = result
    if error is not None:
        msg["error"] = error
    line = json.dumps(msg, ensure_ascii=False) + "\n"
    out = _sock_file_w if _sock_file_w is not None else sys.stdout
    out.write(line)
    out.flush()


def main():
    global _sock_file_w

    # Parse command-line arguments (C++ passes --port N on Wine/Proton)
    parser = argparse.ArgumentParser(description='PythonBridge Server')
    parser.add_argument('--port', type=int, default=0,
                        help='TCP port to connect to (Wine/Proton mode)')
    parser.add_argument('--wine', action='store_true',
                        help='Running under Wine/Proton (C++ auto-detects)')
    args = parser.parse_args()

    # Initialize log
    try:
        with open(LOG_FILE, 'w', encoding='utf-8') as f:
            f.write(f"=== PythonBridge Server - {datetime.now().isoformat()} ===\n")
            f.write(f"PID: {os.getpid()}\n")
            f.write(f"Python: {sys.version}\n")
            f.write(f"CWD: {os.getcwd()}\n")
            f.write(f"TCP port: {args.port}\n")
            f.write(f"Log file: {LOG_FILE}\n\n")
    except Exception:
        pass

    # TCP socket mode: connect back to C++ listener on localhost
    sock = None
    sock_file_r = None
    if args.port > 0:
        log(f"TCP mode: connecting to 127.0.0.1:{args.port}")
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect(('127.0.0.1', args.port))
            sock_file_r = sock.makefile('r', encoding='utf-8')
            _sock_file_w = sock.makefile('w', encoding='utf-8')
            log("TCP connection established")
        except Exception as e:
            log(f"FATAL: Failed to connect to TCP port {args.port}: {e}")
            sys.exit(1)

        # Redirect stdout/stderr to devnull to prevent crashes from stray print()
        # calls in imported modules (sklearn, etc.). pythonw.exe sets them to None
        # which causes AttributeError on print(). We redirect to devnull instead.
        try:
            devnull = open(os.devnull, 'w', encoding='utf-8')
            sys.stdout = devnull
            sys.stderr = devnull
            log("Redirected stdout/stderr to devnull (TCP mode)")
        except Exception as e:
            log(f"WARNING: Could not redirect stdout/stderr: {e}")

    # Log diagnostic info for debugging Wine/Proton crashes
    # Send through TCP so diagnostics appear in SKSE log even if log file fails
    tcp_diag(f"Python {sys.version}")
    tcp_diag(f"platform={sys.platform} cwd={os.getcwd()}")
    tcp_diag(f"executable={sys.executable}")
    tcp_diag(f"log_file={LOG_FILE}")
    tcp_diag(f"stdout={type(sys.stdout).__name__} stderr={type(sys.stderr).__name__}")
    log(f"sys.path: {sys.path}", flush_to_disk=True)
    log(f"sys.executable: {sys.executable}")
    log(f"sys.platform: {sys.platform}")
    log(f"sys.stdout type: {type(sys.stdout)}")
    log(f"sys.stderr type: {type(sys.stderr)}")

    tcp_diag("=== Starting imports ===")
    log("=== Starting module imports (flush before each to survive crashes) ===",
        flush_to_disk=True)

    # On Wine/Proton, numpy C extensions (.pyd) can SEGFAULT during import —
    # a hard crash that try/except cannot catch. We test in an isolated subprocess
    # first. If it crashes, we skip numpy/sklearn and all builders that need them.
    _numpy_ok = False
    _sklearn_ok = False

    if args.wine:
        tcp_diag("Wine mode: testing numpy in subprocess...")
        log("Wine mode: testing numpy import in isolated subprocess...", flush_to_disk=True)
        import subprocess
        try:
            result = subprocess.run(
                [sys.executable, '-c', 'import numpy; print(numpy.__version__)'],
                capture_output=True, text=True, timeout=30,
                env={**os.environ, 'OPENBLAS_NUM_THREADS': '1',
                     'OPENBLAS_CORETYPE': 'Haswell'}
            )
            if result.returncode == 0:
                ver = result.stdout.strip()
                _numpy_ok = True
                tcp_diag(f"numpy subprocess OK: {ver}")
                log(f"Wine numpy subprocess test PASSED: {ver}")
                # Safe to import in main process
                import numpy
            else:
                tcp_diag(f"numpy subprocess CRASHED (exit {result.returncode})")
                log(f"Wine numpy subprocess CRASHED: exit={result.returncode} "
                    f"stderr={result.stderr[:500]}")
        except subprocess.TimeoutExpired:
            tcp_diag("numpy subprocess TIMEOUT (30s)")
            log("Wine numpy subprocess TIMEOUT")
        except Exception as e:
            tcp_diag(f"numpy subprocess error: {e}")
            log(f"Wine numpy subprocess error: {type(e).__name__}: {e}")

        if _numpy_ok:
            tcp_diag("Wine mode: testing sklearn in subprocess...")
            log("Wine mode: testing sklearn import in isolated subprocess...", flush_to_disk=True)
            try:
                result = subprocess.run(
                    [sys.executable, '-c', 'import sklearn; print(sklearn.__version__)'],
                    capture_output=True, text=True, timeout=30,
                    env={**os.environ, 'OPENBLAS_NUM_THREADS': '1',
                         'OPENBLAS_CORETYPE': 'Haswell'}
                )
                if result.returncode == 0:
                    ver = result.stdout.strip()
                    _sklearn_ok = True
                    tcp_diag(f"sklearn subprocess OK: {ver}")
                    log(f"Wine sklearn subprocess test PASSED: {ver}")
                    import sklearn
                else:
                    tcp_diag(f"sklearn subprocess CRASHED (exit {result.returncode})")
                    log(f"Wine sklearn subprocess CRASHED: exit={result.returncode} "
                        f"stderr={result.stderr[:500]}")
            except subprocess.TimeoutExpired:
                tcp_diag("sklearn subprocess TIMEOUT")
                log("Wine sklearn subprocess TIMEOUT")
            except Exception as e:
                tcp_diag(f"sklearn subprocess error: {e}")
                log(f"Wine sklearn subprocess error: {type(e).__name__}: {e}")
        else:
            tcp_diag("Wine mode: SKIPPING sklearn (numpy failed)")
            log("Wine mode: skipping sklearn (numpy crashed in subprocess)")
    else:
        # Native Windows — import directly (no segfault risk)
        tcp_diag("importing numpy...")
        log("IMPORT TEST: attempting 'import numpy'...", flush_to_disk=True)
        try:
            import numpy
            _numpy_ok = True
            tcp_diag(f"numpy {numpy.__version__} OK")
            log(f"IMPORT TEST: numpy {numpy.__version__} OK")
        except Exception as e:
            tcp_diag(f"numpy FAILED: {type(e).__name__}: {e}")
            log(f"IMPORT TEST: numpy FAILED: {type(e).__name__}: {e}")
            log(f"Traceback:\n{traceback.format_exc()}")

        if _numpy_ok:
            tcp_diag("importing sklearn...")
            log("IMPORT TEST: attempting 'import sklearn'...", flush_to_disk=True)
            try:
                import sklearn
                _sklearn_ok = True
                tcp_diag(f"sklearn {sklearn.__version__} OK")
                log(f"IMPORT TEST: sklearn {sklearn.__version__} OK")
            except Exception as e:
                tcp_diag(f"sklearn FAILED: {type(e).__name__}: {e}")
                log(f"IMPORT TEST: sklearn FAILED: {type(e).__name__}: {e}")
                log(f"Traceback:\n{traceback.format_exc()}")
        else:
            log("IMPORT TEST: skipping sklearn (numpy failed)")

    tcp_diag(f"base imports done: numpy={_numpy_ok} sklearn={_sklearn_ok}")
    log(f"IMPORT TEST complete: numpy={_numpy_ok}, sklearn={_sklearn_ok}",
        flush_to_disk=True)

    # Heavy imports happen ONCE at startup — this is the whole point of the
    # persistent process. sklearn, numpy, etc. stay loaded between calls.
    #
    # On Wine, if numpy/sklearn crashed in subprocess test, we MUST skip importing
    # any builder module that imports numpy/sklearn at module level — otherwise
    # the import triggers the same segfault in our main process.

    prm_process = None  # Set below if import succeeds

    # On Wine, if numpy/sklearn segfault, we "poison" sys.modules so that any
    # submodule doing `import numpy` gets ImportError instead of a segfault.
    # Modules like theme_discovery.py already have `try: import numpy except ImportError`
    # fallback paths, so they'll gracefully degrade to pure-Python mode.
    if not _numpy_ok and args.wine:
        tcp_diag("Poisoning numpy/sklearn in sys.modules (prevent segfault on import)")
        log("Wine mode: poisoning numpy/sklearn in sys.modules to prevent segfault")
        import types
        _poison = types.ModuleType('numpy')
        _poison.__version__ = '0.0.0'
        _poison.__path__ = []
        # Make any attribute access raise ImportError so sklearn etc. fail cleanly
        class _PoisonModule(types.ModuleType):
            def __getattr__(self, name):
                raise ImportError(f"numpy unavailable on Wine (C extensions crash)")
        sys.modules['numpy'] = _PoisonModule('numpy')
        sys.modules['numpy.core'] = _PoisonModule('numpy.core')
        sys.modules['sklearn'] = _PoisonModule('sklearn')
        sys.modules['sklearn.feature_extraction'] = _PoisonModule('sklearn.feature_extraction')
        sys.modules['sklearn.feature_extraction.text'] = _PoisonModule('sklearn.feature_extraction.text')
        log("Wine mode: numpy/sklearn poisoned — submodules will use fallback paths")

    # Import builder modules. On Wine with poisoned numpy, modules that have
    # try/except ImportError fallbacks (theme_discovery, etc.) will gracefully
    # degrade. Pure-Python modules (prereq_master_scorer, core.node) work as-is.

    # Tree Growth builder (NLP-based) — try module folder first, fallback to local
    _build_tree_import_error = None
    tcp_diag("importing tree_build_tree...")
    log("Importing tree_build_tree...", flush_to_disk=True)
    try:
        from tree_build_tree import build_tree_from_data
        register_command('build_tree', build_tree_from_data)
        log("Imported + registered build_tree_from_data from tree module")
    except Exception:
        try:
            from build_tree import build_tree_from_data
            register_command('build_tree', build_tree_from_data)
            log("Imported + registered build_tree_from_data from local fallback")
        except Exception as e:
            _build_tree_import_error = f"{type(e).__name__}: {e}"
            log(f"WARNING: Could not import build_tree_from_data: {_build_tree_import_error}")
            log(f"Traceback:\n{traceback.format_exc()}")

    # Classic Growth builder (tier-first)
    _classic_build_import_error = None
    tcp_diag("importing classic_build_tree...")
    log("Importing classic_build_tree...", flush_to_disk=True)
    try:
        from classic_build_tree import classic_build_tree_from_data
        register_command('build_tree_classic', classic_build_tree_from_data)
        log("Imported + registered classic_build_tree_from_data from classic module")
    except Exception as e:
        _classic_build_import_error = f"{type(e).__name__}: {e}"
        log(f"WARNING: Could not import classic_build_tree_from_data: {_classic_build_import_error}")
        log(f"Traceback:\n{traceback.format_exc()}")

    # Graph Growth builder (Edmonds' arborescence)
    tcp_diag("importing graph_build_tree...")
    log("Importing graph_build_tree...", flush_to_disk=True)
    try:
        from graph_build_tree import graph_build_tree_from_data
        register_command('build_tree_graph', graph_build_tree_from_data)
        log("Imported + registered graph_build_tree_from_data from graph module")
    except Exception as e:
        log(f"WARNING: Could not import graph_build_tree_from_data: {type(e).__name__}: {e}")
        log(f"Traceback:\n{traceback.format_exc()}")

    # Oracle Growth builder (LLM-guided semantic chains)
    tcp_diag("importing oracle_build_tree...")
    log("Importing oracle_build_tree...", flush_to_disk=True)
    try:
        from oracle_build_tree import oracle_build_tree_from_data
        register_command('build_tree_oracle', oracle_build_tree_from_data)
        log("Imported + registered oracle_build_tree_from_data from oracle module")
    except Exception as e:
        log(f"WARNING: Could not import oracle_build_tree_from_data: {type(e).__name__}: {e}")
        log(f"Traceback:\n{traceback.format_exc()}")

    # Thematic Growth builder (theme-first BFS)
    tcp_diag("importing thematic_build_tree...")
    log("Importing thematic_build_tree...", flush_to_disk=True)
    try:
        from thematic_build_tree import thematic_build_tree_from_data
        register_command('build_tree_thematic', thematic_build_tree_from_data)
        log("Imported + registered thematic_build_tree_from_data from thematic module")
    except Exception as e:
        log(f"WARNING: Could not import thematic_build_tree_from_data: {type(e).__name__}: {e}")
        log(f"Traceback:\n{traceback.format_exc()}")

    tcp_diag("importing prereq_master_scorer...")
    log("Importing prereq_master_scorer...", flush_to_disk=True)
    try:
        from prereq_master_scorer import process_request as prm_process
        log("Imported prereq_master_scorer.process_request")
    except Exception as e:
        log(f"WARNING: Could not import prereq_master_scorer: {e}")
        log(f"Traceback:\n{traceback.format_exc()}")
        prm_process = None

    log(f"Registered commands: {list(COMMAND_HANDLERS.keys())}")

    log("All imports complete. Sending ready signal.")

    # Signal ready to C++
    send_response("__ready__", True, {"pid": os.getpid()})

    # Main loop: read JSON-line commands from stdin or TCP socket
    input_source = sock_file_r if sock_file_r is not None else sys.stdin
    for line in input_source:
        line = line.strip()
        if not line:
            continue

        request_id = None
        try:
            msg = json.loads(line)
            request_id = msg.get("id", "unknown")
            command = msg.get("command", "")
            data = msg.get("data", {})

            log(f"Received command: {command} (id: {request_id})")

            # Built-in commands (not in registry)
            if command == "shutdown":
                log("Shutdown requested")
                send_response(request_id, True, {"status": "shutting_down"})
                break

            elif command == "ping":
                send_response(request_id, True, {"status": "alive", "pid": os.getpid()})

            elif command == "prm_score":
                if prm_process is None:
                    send_response(request_id, False, error="prereq_master_scorer module not available")
                    continue

                log(f"prm_score: {len(data.get('pairs', []))} pairs")
                start = datetime.now()

                result_json = prm_process(json.dumps(data))
                result = json.loads(result_json)

                elapsed = (datetime.now() - start).total_seconds()
                log(f"prm_score completed in {elapsed:.2f}s")

                send_response(request_id, result.get("success", False), result)

            elif command in COMMAND_HANDLERS:
                # Registry-based command dispatch (tree builders, etc.)
                handler = COMMAND_HANDLERS[command]

                spells = data.get("spells", [])
                config = data.get("config", {})

                if data.get("fallback"):
                    config["fallback"] = True

                log(f"{command}: {len(spells)} spells, config keys: {list(config.keys())}")
                start = datetime.now()

                result = handler(spells, config)

                elapsed = (datetime.now() - start).total_seconds()
                log(f"{command} completed in {elapsed:.2f}s")

                send_response(request_id, True, result)

            else:
                send_response(request_id, False, error=f"Unknown command: {command}")

        except json.JSONDecodeError as e:
            log(f"Invalid JSON: {e} — line: {line[:200]}")
            if request_id:
                send_response(request_id, False, error=f"Invalid JSON: {e}")
        except Exception as e:
            error_detail = f"{type(e).__name__}: {e}"
            tb = traceback.format_exc()
            log(f"Error handling command: {error_detail}\n{tb}")
            rid = request_id or "unknown"
            send_response(rid, False, error=error_detail)

    log("Server exiting")

    # Clean up TCP socket
    if sock is not None:
        try:
            sock.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
