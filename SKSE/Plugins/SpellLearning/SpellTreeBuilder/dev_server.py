#!/usr/bin/env python3
"""
Dev Server for Spell Tree Builder

Lightweight HTTP server that exposes build_tree.py as a REST API
for the PrismaUI dev harness. Runs on localhost:5556.

Usage:
    python dev_server.py
    python dev_server.py --port 5556

The dev harness bridge (dev-harness-bridge.js) will POST to
http://localhost:5556/build with the same JSON payload that the
C++ bridge sends to ProceduralPythonGenerate.
"""

import http.server
import json
import sys
import random
import time
import traceback
from pathlib import Path
from datetime import datetime

# Ensure script dir is on path
_script_dir = str(Path(__file__).resolve().parent)
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from tree_builder import build_spell_trees, SCHOOL_DEFAULT_SHAPES
from validator import validate_tree, get_validation_summary, fix_unreachable_nodes
from theme_discovery import extract_spell_text, discover_themes_per_school
from prereq_master_scorer import process_request as prm_score

PORT = 5556


class BuildHandler(http.server.BaseHTTPRequestHandler):
    """Handle POST /build requests from the dev harness."""

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path not in ('/build', '/score'):
            self.send_error(404, 'Not found')
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        if self.path == '/score':
            return self._handle_score(body)

        try:
            request = json.loads(body)
            result = self._run_build(request)
            response = json.dumps(result, ensure_ascii=False)

            self.send_response(200)
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(response.encode('utf-8'))

        except Exception as e:
            traceback.print_exc()
            error_result = json.dumps({
                'success': False,
                'error': str(e),
                'elapsed': '0'
            })
            self.send_response(200)  # Still 200 so JS can parse the error
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(error_result.encode('utf-8'))

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, format, *args):
        # Compact logging
        print(f"[DevServer] {args[0]}")

    # ------------------------------------------------------------------
    # Pre Req Master NLP scoring
    # ------------------------------------------------------------------

    def _handle_score(self, body):
        """Handle POST /score - Pre Req Master NLP scoring."""
        try:
            start = time.time()
            request = json.loads(body)
            pairs_count = len(request.get('pairs', []))
            print(f"\n[DevServer] SCORE REQUEST: {pairs_count} pairs")

            result_json = prm_score(request)
            result = json.loads(result_json)

            elapsed = time.time() - start
            print(f"[DevServer] Scored {result.get('count', 0)} pairs in {elapsed:.2f}s")

            response = json.dumps(result, ensure_ascii=False)
            self.send_response(200)
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(response.encode('utf-8'))

        except Exception as e:
            traceback.print_exc()
            error_result = json.dumps({'success': False, 'error': str(e)})
            self.send_response(200)
            self._cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(error_result.encode('utf-8'))

    # ------------------------------------------------------------------
    # Build pipeline (mirrors build_tree.py _main_impl logic)
    # ------------------------------------------------------------------

    def _run_build(self, request):
        spells = request.get('spells', [])
        config = request.get('config', {})
        school_filter = request.get('schoolFilter', None)

        start = time.time()
        print(f"\n{'='*60}")
        print(f"[DevServer] BUILD REQUEST: {len(spells)} spells")
        print(f"{'='*60}")

        if not spells:
            return {'success': False, 'error': 'No spells provided', 'elapsed': '0'}

        # Seed
        seed = config.get('seed', int(time.time() * 1000) % 1000000)
        random.seed(seed)
        config['seed'] = seed
        print(f"[DevServer] Seed: {seed}")

        # Defaults
        config.setdefault('shape', 'organic')
        config.setdefault('max_children_per_node', 3)
        config.setdefault('top_themes_per_school', 8)
        config.setdefault('density', 0.6)
        config.setdefault('symmetry', 0.3)
        config.setdefault('convergence_chance', 0.4)

        # School filter
        if school_filter:
            spells = [s for s in spells if s.get('school') == school_filter]
            print(f"[DevServer] Filtered to {school_filter}: {len(spells)} spells")

        # Count schools
        schools = {}
        for spell in spells:
            school = spell.get('school', 'Unknown')
            if not school or school in ('null', 'undefined', 'None', ''):
                school = 'Hedge Wizard'
            schools[school] = schools.get(school, 0) + 1

        print(f"[DevServer] Schools: {', '.join(f'{s} ({c})' for s, c in sorted(schools.items()))}")

        # Build per-school configs
        school_configs = {}
        pre_configs = config.get('school_configs', {})
        for school_name in schools:
            if school_name in pre_configs:
                school_configs[school_name] = pre_configs[school_name]
            else:
                school_configs[school_name] = {
                    'shape': SCHOOL_DEFAULT_SHAPES.get(school_name, config.get('shape', 'organic')),
                    'density': config.get('density', 0.6),
                    'symmetry': config.get('symmetry', 0.3),
                    'convergence_chance': config.get('convergence_chance', 0.4),
                    'source': 'config'
                }
        config['school_configs'] = school_configs

        # Fuzzy analysis if requested
        fuzzy_data = None
        if config.get('run_fuzzy_analysis') or config.get('return_fuzzy_data'):
            try:
                from build_tree import compute_fuzzy_relationships
                fuzzy_data = compute_fuzzy_relationships(spells, top_n=5)
                print(f"[DevServer] Fuzzy: {len(fuzzy_data.get('relationships', {}))} relationships")
            except Exception as e:
                print(f"[DevServer] Fuzzy analysis skipped: {e}")
                fuzzy_data = {'relationships': {}, 'similarity_scores': {}, 'groups': {}, 'themes': {}}

        # Build trees
        print(f"[DevServer] Building trees (shape={config['shape']})...")
        tree_data = build_spell_trees(spells, config)

        tree_data['generatedAt'] = datetime.now().isoformat()
        tree_data['generator'] = 'SpellTreeBuilder (DevServer)'
        tree_data['config'] = {
            'shape': config['shape'],
            'density': config.get('density', 0.6),
            'symmetry': config.get('symmetry', 0.3),
        }
        tree_data['seed'] = seed
        tree_data['school_configs'] = school_configs

        # Include fuzzy data if requested
        if fuzzy_data and config.get('return_fuzzy_data'):
            tree_data['fuzzy_relationships'] = fuzzy_data.get('relationships', {})
            tree_data['similarity_scores'] = fuzzy_data.get('similarity_scores', {})
            tree_data['fuzzy_groups'] = fuzzy_data.get('groups', {})
            tree_data['spell_themes'] = fuzzy_data.get('themes', {})

        # Validate + auto-fix
        max_children = config.get('max_children_per_node', 3)
        validation = validate_tree(tree_data, max_children)
        summary = get_validation_summary(validation)

        if summary['total_errors'] > 0:
            print(f"[DevServer] Auto-fixing {summary['total_errors']} issues...")
            for school_name, school_data in tree_data.get('schools', {}).items():
                nodes_list = school_data.get('nodes', [])
                nodes_dict = {n['formId']: n for n in nodes_list}
                root_id = school_data.get('root')
                if root_id:
                    fixes = fix_unreachable_nodes(nodes_dict, root_id, max_children)
                    if fixes > 0:
                        school_data['nodes'] = list(nodes_dict.values())

        elapsed = time.time() - start
        output_spells = sum(len(s.get('nodes', [])) for s in tree_data.get('schools', {}).values())
        print(f"[DevServer] Done: {output_spells}/{len(spells)} spells in {elapsed:.2f}s")
        print(f"{'='*60}\n")

        return {
            'success': True,
            'treeData': tree_data,
            'elapsed': f'{elapsed:.2f}'
        }


def main():
    port = PORT
    if len(sys.argv) > 1:
        for i, arg in enumerate(sys.argv[1:]):
            if arg == '--port' and i + 2 < len(sys.argv):
                port = int(sys.argv[i + 2])

    print(f"{'='*60}")
    print(f"  Spell Tree Builder - Dev Server")
    print(f"  http://localhost:{port}/build")
    print(f"{'='*60}")
    print(f"  POST /build with JSON: {{ spells: [...], config: {{...}} }}")
    print(f"  The dev harness bridge will auto-connect when running.")
    print(f"  Press Ctrl+C to stop.\n")

    server = http.server.HTTPServer(('', port), BuildHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[DevServer] Stopped.")
        server.server_close()


if __name__ == '__main__':
    main()
