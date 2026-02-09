#!/usr/bin/env python3
"""
Persistent Python server for PythonBridge (C++ SKSE plugin).

Communicates via stdin/stdout JSON-line protocol.
All debug/logging goes to a log file — stdout is reserved for protocol only.

Protocol:
    C++ -> Python (stdin):  {"id":"req_1","command":"build_tree","data":{...}}\n
    Python -> C++ (stdout): {"id":"req_1","success":true,"result":{...}}\n

Commands:
    build_tree  - Build spell tree from spell data + config
    prm_score   - Score spell-candidate pairs using TF-IDF similarity
    ping        - Health check
    shutdown    - Graceful exit
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

# Log file for debug output (NOT stdout)
LOG_FILE = Path(__file__).parent / "server.log"


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
    try:
        from build_tree import build_tree_from_data
        log("Imported build_tree_from_data")
    except ImportError as e:
        log(f"WARNING: Could not import build_tree_from_data: {e}")
        build_tree_from_data = None

    try:
        from prereq_master_scorer import process_request as prm_process
        log("Imported prereq_master_scorer.process_request")
    except ImportError as e:
        log(f"WARNING: Could not import prereq_master_scorer: {e}")
        prm_process = None

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

            if command == "shutdown":
                log("Shutdown requested")
                send_response(request_id, True, {"status": "shutting_down"})
                break

            elif command == "ping":
                send_response(request_id, True, {"status": "alive", "pid": os.getpid()})

            elif command == "build_tree":
                if build_tree_from_data is None:
                    send_response(request_id, False, error="build_tree module not available")
                    continue

                spells = data.get("spells", [])
                config = data.get("config", {})

                log(f"build_tree: {len(spells)} spells, config keys: {list(config.keys())}")
                start = datetime.now()

                result = build_tree_from_data(spells, config)

                elapsed = (datetime.now() - start).total_seconds()
                log(f"build_tree completed in {elapsed:.2f}s")

                send_response(request_id, True, result)

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
