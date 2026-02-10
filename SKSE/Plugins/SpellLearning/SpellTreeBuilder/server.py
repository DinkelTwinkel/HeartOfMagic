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

import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

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
LOG_FILE = Path(__file__).parent / "server.log"

# Command registry: builders self-register so server.py doesn't need
# hardcoded if/elif chains for each mode. Built-in commands (ping,
# shutdown, prm_score) are handled directly in main().
COMMAND_HANDLERS = {}


def register_command(name, handler):
    """Register a command handler. Called by builder modules on import."""
    COMMAND_HANDLERS[name] = handler


def log(msg):
    """Write to log file. Never print to stdout (reserved for protocol)."""
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


def send_response(request_id, success, result=None, error=None):
    """Send a JSON-line response to stdout (C++ reader thread)."""
    msg = {"id": request_id, "success": success}
    if result is not None:
        msg["result"] = result
    if error is not None:
        msg["error"] = error
    line = json.dumps(msg, ensure_ascii=False) + "\n"
    sys.stdout.write(line)
    sys.stdout.flush()


def main():
    # Initialize log
    try:
        with open(LOG_FILE, 'w', encoding='utf-8') as f:
            f.write(f"=== PythonBridge Server - {datetime.now().isoformat()} ===\n")
            f.write(f"PID: {os.getpid()}\n")
            f.write(f"Python: {sys.version}\n")
            f.write(f"CWD: {os.getcwd()}\n\n")
    except Exception:
        pass

    log("Importing modules...")

    # Heavy imports happen ONCE at startup — this is the whole point of the
    # persistent process. sklearn, numpy, etc. stay loaded between calls.

    # Tree Growth builder (NLP-based) — try module folder first, fallback to local
    _build_tree_import_error = None
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
    try:
        from classic_build_tree import classic_build_tree_from_data
        register_command('build_tree_classic', classic_build_tree_from_data)
        log("Imported + registered classic_build_tree_from_data from classic module")
    except Exception as e:
        _classic_build_import_error = f"{type(e).__name__}: {e}"
        log(f"WARNING: Could not import classic_build_tree_from_data: {_classic_build_import_error}")
        log(f"Traceback:\n{traceback.format_exc()}")

    try:
        from prereq_master_scorer import process_request as prm_process
        log("Imported prereq_master_scorer.process_request")
    except Exception as e:
        log(f"WARNING: Could not import prereq_master_scorer: {e}")
        log(f"Traceback:\n{traceback.format_exc()}")
        prm_process = None

    log(f"Registered commands: {list(COMMAND_HANDLERS.keys())}")

    # Pre-import sklearn so first build_tree call doesn't pay the cost
    try:
        import sklearn  # noqa: F401
        log("Pre-imported sklearn")
    except ImportError:
        log("sklearn not available (optional)")

    log("All imports complete. Sending ready signal.")

    # Signal ready to C++
    send_response("__ready__", True, {"pid": os.getpid()})

    # Main loop: read JSON-line commands from stdin
    for line in sys.stdin:
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


if __name__ == "__main__":
    main()
