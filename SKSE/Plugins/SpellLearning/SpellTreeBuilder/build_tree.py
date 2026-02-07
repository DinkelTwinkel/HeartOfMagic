#!/usr/bin/env python3
"""
Procedural Spell Tree Builder

Generates spell learning trees from spell scan JSON using modular systems.
Supports configurable shapes, branching energy, and LLM enhancement.

Usage:
    python build_tree.py --input spell_scan.json --output spell_tree.json
    python build_tree.py --input spell_scan.json -o tree.json --shape radial
    python build_tree.py --list-shapes
    python build_tree.py -i spells.json -o tree.json --density 0.8

Features:
    - Multiple tree shapes (organic, radial, grid, cascade, etc.)
    - Branching energy for growth control
    - Optional LLM enhancement for themed groups
    - 100% coverage guaranteed
    - Deterministic results with --seed
"""

import argparse
import json
import sys
import random
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional

# Setup file logging for in-game debugging
LOG_FILE = Path(__file__).parent / "build_tree.log"

def log_to_file(msg):
    """Write to log file for in-game debugging."""
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except:
        pass

def clear_log():
    """Clear log file at start of run."""
    try:
        with open(LOG_FILE, 'w', encoding='utf-8') as f:
            f.write(f"=== SpellTreeBuilder Log - {datetime.now().isoformat()} ===\n\n")
    except:
        pass

# Ensure the script's own directory is on sys.path so local imports work
# even when the working directory is different (e.g. game's Stock Game folder)
_script_dir = str(Path(__file__).resolve().parent)
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from tree_builder import build_spell_trees, SpellTreeBuilder, SCHOOL_DEFAULT_SHAPES
from validator import validate_tree, get_validation_summary, fix_unreachable_nodes
from config import TreeBuilderConfig, DEFAULT_AUTO_CONFIGURE_PROMPT, DEFAULT_GROUP_ENHANCEMENT_PROMPT
from theme_discovery import extract_spell_text, discover_themes_per_school

# Import shapes for listing
try:
    from shapes import list_shapes, get_shape
    HAS_SHAPES = True
except ImportError:
    HAS_SHAPES = False

# Import growth for auto-configure
try:
    from growth import AutoConfigurator, get_schools_from_spells, AVAILABLE_SHAPES
    HAS_GROWTH = True
except ImportError:
    HAS_GROWTH = False
    AVAILABLE_SHAPES = ['organic', 'radial', 'grid']


def compute_fuzzy_relationships(spells: list, top_n: int = 5) -> Dict[str, Any]:
    """
    Compute fuzzy (semantic) relationships between spells using TF-IDF cosine similarity.
    
    Returns:
        {
            'relationships': {formId: [related_formIds]},  # Top N related spells per spell
            'similarity_scores': {'formId1:formId2': score},  # Pairwise similarity scores
            'groups': {theme: [formIds]},  # Theme-based groupings
            'themes': {formId: [themes]}  # Detected themes per spell
        }
    """
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    import numpy as np
    
    log_to_file(f"[Fuzzy] Computing relationships for {len(spells)} spells...")
    print(f"[Fuzzy] Computing relationships for {len(spells)} spells...")
    
    if len(spells) < 2:
        return {'relationships': {}, 'similarity_scores': {}, 'groups': {}, 'themes': {}}
    
    # Build corpus of spell texts
    corpus = []
    form_ids = []
    for spell in spells:
        text = extract_spell_text(spell)
        corpus.append(text if text.strip() else spell.get('name', 'unknown'))
        form_ids.append(spell.get('formId', str(len(form_ids))))
    
    # TF-IDF vectorization
    try:
        vectorizer = TfidfVectorizer(
            stop_words='english',
            max_features=200,
            min_df=1,
            max_df=0.9,
            ngram_range=(1, 2)
        )
        tfidf_matrix = vectorizer.fit_transform(corpus)
        
        # Compute pairwise cosine similarity
        similarity_matrix = cosine_similarity(tfidf_matrix)
        
    except Exception as e:
        log_to_file(f"[Fuzzy] TF-IDF failed: {e}")
        print(f"[Fuzzy] TF-IDF failed: {e}")
        return {'relationships': {}, 'similarity_scores': {}, 'groups': {}, 'themes': {}}
    
    # Build relationships and scores
    relationships = {}
    similarity_scores = {}
    
    for i, form_id in enumerate(form_ids):
        # Get similarity scores for this spell (excluding self)
        scores = [(j, similarity_matrix[i, j]) for j in range(len(form_ids)) if j != i]
        
        # Sort by similarity (highest first)
        scores.sort(key=lambda x: x[1], reverse=True)
        
        # Get top N related spells (above threshold)
        related = []
        for j, score in scores[:top_n]:
            if score > 0.1:  # Minimum similarity threshold
                related.append(form_ids[j])
                # Store pairwise score
                key = f"{form_id}:{form_ids[j]}"
                similarity_scores[key] = round(float(score), 3)
        
        relationships[form_id] = related
    
    # Discover themes per school and group spells
    themes_per_school = discover_themes_per_school(spells, top_n=5)
    
    # Build group assignments based on themes
    groups = {}
    spell_themes = {}
    
    for school_name, themes in themes_per_school.items():
        school_spells = [s for s in spells if s.get('school', 'Unknown') == school_name]
        
        for theme in themes:
            theme_key = f"{school_name}_{theme}"
            groups[theme_key] = []
            
            for spell in school_spells:
                text = extract_spell_text(spell).lower()
                if theme.lower() in text:
                    form_id = spell.get('formId')
                    groups[theme_key].append(form_id)
                    
                    # Track themes per spell
                    if form_id not in spell_themes:
                        spell_themes[form_id] = []
                    spell_themes[form_id].append(theme)
    
    # Remove empty groups
    groups = {k: v for k, v in groups.items() if v}
    
    log_to_file(f"[Fuzzy] Found {len(relationships)} spell relationships, {len(groups)} groups")
    print(f"[Fuzzy] Found {len(relationships)} spell relationships, {len(groups)} groups")
    
    return {
        'relationships': relationships,
        'similarity_scores': similarity_scores,
        'groups': groups,
        'themes': spell_themes
    }


def load_spell_data(input_path: str) -> Dict[str, Any]:
    """Load spell scan JSON data."""
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if 'spells' in data:
        return data
    elif isinstance(data, list):
        return {'spells': data}
    else:
        spells = []
        for school, school_spells in data.items():
            if isinstance(school_spells, list):
                for spell in school_spells:
                    spell['school'] = school
                    spells.append(spell)
        return {'spells': spells}


def load_config(config_path: Optional[str]) -> Dict[str, Any]:
    """Load configuration from JSON file or use defaults."""
    config = TreeBuilderConfig().to_dict()
    
    if config_path:
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                user_config = json.load(f)
                config.update(user_config)
        except FileNotFoundError:
            print(f"[Warning] Config file not found: {config_path}")
        except json.JSONDecodeError as e:
            print(f"[Warning] Invalid config JSON: {e}")
    
    return config


def print_available_shapes():
    """Print all available shape presets."""
    print("\n=== Available Tree Shapes ===\n")
    
    if HAS_SHAPES:
        shapes = list_shapes()
        for name in sorted(shapes):
            shape_cls = get_shape(name)
            desc = getattr(shape_cls, 'description', 'No description') if shape_cls else 'No description'
            print(f"  {name:12} - {desc}")
    else:
        print("  organic     - Natural tree with varied branching")
        print("  radial      - Star/spoke pattern from center")
        print("  grid        - Matrix/lattice arrangement")
    
    print("\nUsage: python build_tree.py -i spells.json -o tree.json --shape organic")
    print()


def main():
    # Clear and initialize log file
    clear_log()
    log_to_file("Script started")
    log_to_file(f"Python: {sys.version}")
    log_to_file(f"Working dir: {Path.cwd()}")
    log_to_file(f"Script path: {__file__}")
    log_to_file(f"Args: {sys.argv}")
    
    try:
        return _main_impl()
    except Exception as e:
        error_msg = f"FATAL ERROR: {type(e).__name__}: {e}\n{traceback.format_exc()}"
        log_to_file(error_msg)
        print(error_msg, file=sys.stderr)
        sys.exit(1)

def _main_impl():
    parser = argparse.ArgumentParser(
        description='Build spell learning trees with configurable shapes and growth',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python build_tree.py -i spells.json -o tree.json
    python build_tree.py -i spells.json -o tree.json --shape radial
    python build_tree.py -i spells.json -o tree.json --density 0.8 --symmetry 0.5
    python build_tree.py -i spells.json -o tree.json --random-settings
    python build_tree.py --list-shapes
        """
    )
    
    # Input/Output
    parser.add_argument('-i', '--input', help='Input spell scan JSON file')
    parser.add_argument('-o', '--output', help='Output tree JSON file')
    parser.add_argument('-c', '--config', help='Configuration JSON file')
    
    # Shape options
    parser.add_argument('--shape', choices=AVAILABLE_SHAPES,
                        help='Tree shape preset (default: from config or organic)')
    parser.add_argument('--list-shapes', action='store_true',
                        help='List all available tree shapes')
    
    # Growth parameters
    parser.add_argument('--density', type=float, help='Tree density (0.0-1.0)')
    parser.add_argument('--symmetry', type=float, help='Tree symmetry (0.0-1.0)')
    parser.add_argument('--max-children', type=int, help='Max children per node (default: 3)')
    
    # Branching energy
    parser.add_argument('--min-straight', type=int, help='Min straight connections before branch')
    parser.add_argument('--max-straight', type=int, help='Max straight connections before forced branch')
    parser.add_argument('--energy-randomness', type=float, help='Branching randomness (0.0-1.0)')
    
    # Convergence
    parser.add_argument('--convergence', type=float, help='Convergence probability (0.0-1.0)')
    parser.add_argument('--themes', type=int, help='Themes per school (default: 8)')
    
    # Random mode
    parser.add_argument('--random-settings', action='store_true',
                        help='Use random settings for each school')
    parser.add_argument('--seed', type=int, help='Random seed for reproducibility')
    
    # Validation
    parser.add_argument('--validate-only', action='store_true',
                        help='Only validate input without generating')
    parser.add_argument('--no-auto-fix', action='store_true',
                        help='Disable automatic fixing of unreachable nodes')
    
    # Output options
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    parser.add_argument('--pretty', action='store_true', help='Pretty-print JSON')
    
    args = parser.parse_args()
    
    # Handle --list-shapes
    if args.list_shapes:
        print_available_shapes()
        sys.exit(0)
    
    # Validate required arguments
    if not args.input:
        parser.error("--input is required (or use --list-shapes)")
    if not args.validate_only and not args.output:
        parser.error("--output is required unless --validate-only")
    
    # Build configuration from file (if provided) merged with defaults
    log_to_file(f"Loading config from: {args.config}")
    config = load_config(args.config)
    log_to_file(f"Config loaded. Keys: {list(config.keys())}")
    
    # Set random seed - priority: CLI arg > config file > auto-generate
    # This allows the in-game UI to pass a seed via config
    if args.seed is not None:
        used_seed = args.seed
        seed_source = 'CLI'
    elif config.get('seed') is not None:
        used_seed = int(config['seed'])
        seed_source = 'config'
    else:
        # Generate a seed based on time so runs are different but reproducible if user notes the seed
        import time
        used_seed = int(time.time() * 1000) % 1000000
        seed_source = 'auto'
    
    random.seed(used_seed)
    config['seed'] = used_seed
    print(f"[Info] Random seed: {used_seed} (source: {seed_source})")
    log_to_file(f"Random seed: {used_seed} (source: {seed_source})")
    
    # Override with command line args ONLY if explicitly provided (not None)
    if args.shape is not None:
        config['shape'] = args.shape
    elif 'shape' not in config:
        config['shape'] = 'organic'
    
    if args.max_children is not None:
        config['max_children_per_node'] = args.max_children
    elif 'max_children_per_node' not in config:
        config['max_children_per_node'] = 3
    
    if args.themes is not None:
        config['top_themes_per_school'] = args.themes
    elif 'top_themes_per_school' not in config:
        config['top_themes_per_school'] = 8
    
    config['auto_fix_unreachable'] = not args.no_auto_fix
    
    if args.density is not None:
        config['density'] = max(0.0, min(1.0, args.density))
    if args.symmetry is not None:
        config['symmetry'] = max(0.0, min(1.0, args.symmetry))
    if args.convergence is not None:
        config['convergence_chance'] = max(0.0, min(1.0, args.convergence))
    
    # Branching energy overrides
    if args.min_straight is not None or args.max_straight is not None or args.energy_randomness is not None:
        energy = config.get('branching_energy', {})
        if args.min_straight is not None:
            energy['min_straight'] = args.min_straight
        if args.max_straight is not None:
            energy['max_straight'] = args.max_straight
        if args.energy_randomness is not None:
            energy['randomness'] = args.energy_randomness
        config['branching_energy'] = energy
    
    if args.seed is not None:
        config['seed'] = args.seed
    
    # Log LLM config if present
    llm_auto = config.get('llm_auto_configure', {})
    llm_groups = config.get('llm_groups', {})
    llm_keyword_class = config.get('llm_keyword_classification', {})
    llm_api = config.get('llm_api', {})
    
    print("\n" + "="*60)
    print("SPELL TREE BUILDER - CONFIGURATION")
    print("="*60)
    
    # Log base config
    print(f"[Config] Default Shape: {config.get('shape', 'organic')}")
    print(f"[Config] Default Density: {config.get('density', 0.6)}, Symmetry: {config.get('symmetry', 0.3)}")
    print(f"[Config] Branching Energy: min={config.get('branching_energy', {}).get('min_straight', 2)}, max={config.get('branching_energy', {}).get('max_straight', 5)}")
    
    # Log LLM settings
    print(f"\n[LLM] Auto-Config Enabled: {llm_auto.get('enabled', False)}")
    print(f"[LLM] Groups Enabled: {llm_groups.get('enabled', False)}")
    print(f"[LLM] API Key Provided: {'YES' if llm_api.get('api_key') else 'NO'}")
    print(f"[LLM] Model: {llm_api.get('model', 'not set')}")
    
    # Check for pre-configured school configs from JS
    pre_school_configs = config.get('school_configs', {})
    if pre_school_configs:
        print(f"\n[Config] Pre-configured school configs from JS: {list(pre_school_configs.keys())}")
        for sc_name, sc_cfg in pre_school_configs.items():
            print(f"  {sc_name}: shape={sc_cfg.get('shape')}, source={sc_cfg.get('source', 'unknown')}")
    
    print("="*60 + "\n")
    
    # Load input data
    log_to_file(f"Loading spells from: {args.input}")
    print(f"[Info] Loading: {args.input}")
    try:
        spell_data = load_spell_data(args.input)
        log_to_file(f"Loaded spell data successfully")
    except FileNotFoundError:
        print(f"[Error] File not found: {args.input}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"[Error] Invalid JSON: {e}")
        sys.exit(1)
    
    spells = spell_data.get('spells', [])
    print(f"[Info] Loaded {len(spells)} spells")
    
    if not spells:
        print("[Error] No spells found")
        sys.exit(1)
    
    # Count schools
    schools = {}
    for spell in spells:
        school = spell.get('school', 'Unknown')
        schools[school] = schools.get(school, 0) + 1
    print(f"[Info] Schools: {', '.join(f'{s} ({c})' for s, c in sorted(schools.items()))}")
    
    if args.validate_only:
        print("[Info] Validate-only mode")
        sys.exit(0)
    
    # Handle random settings mode
    if args.random_settings and HAS_GROWTH:
        print("[Info] Using random settings per school")
        configurator = AutoConfigurator()
        school_configs = configurator.generate_all_random(list(schools.keys()))
        for school, school_cfg in school_configs.items():
            print(f"  {school}: shape={school_cfg.shape}, density={school_cfg.density:.2f}")
        # Note: Per-school config would need to be passed differently
        # For now, just randomize the global config
        random_cfg = configurator.generate_random_config("_global")
        config['shape'] = random_cfg.shape
        config['density'] = random_cfg.density
        config['symmetry'] = random_cfg.symmetry
    
    # ==========================================================================
    # LLM Enhancement: Auto-configure per-school settings
    # ==========================================================================
    llm_client = None
    school_configs = {}  # Store per-school configs for output
    llm_groups_data = {}  # Store LLM-enhanced group data
    
    # Group spells by school for LLM sampling
    school_spells = {}
    for spell in spells:
        school = spell.get('school', 'Unknown')
        if not school or school in ('null', 'undefined', 'None', ''):
            school = 'Hedge Wizard'
        if school not in school_spells:
            school_spells[school] = []
        school_spells[school].append(spell)
    
    # Initialize LLM client if any LLM feature is enabled
    print(f"\n[LLM] === LLM Configuration Check ===")
    print(f"[LLM] Auto-config enabled: {llm_auto.get('enabled', False)}")
    print(f"[LLM] Groups enabled: {llm_groups.get('enabled', False)}")
    print(f"[LLM] API key present: {bool(llm_api.get('api_key', ''))}")
    print(f"[LLM] Prompt template length: {len(llm_auto.get('prompt_template', ''))}")
    log_to_file(f"[LLM] Auto-config enabled: {llm_auto.get('enabled')}, API key present: {bool(llm_api.get('api_key'))}")
    
    if llm_auto.get('enabled') or llm_groups.get('enabled') or llm_keyword_class.get('enabled'):
        try:
            from llm_client import create_client_from_config, auto_configure_school, auto_configure_all_schools, enhance_themed_group
            llm_client = create_client_from_config(config)
            print(f"[LLM] Client created: {llm_client is not None}")
        except ImportError as e:
            print(f"[LLM] Import error: {e}")
    else:
        print("[LLM] LLM features disabled in config")
    
    # LLM Auto-Config: Get settings for ALL schools at once (so LLM has full context)
    if llm_client and llm_auto.get('enabled'):
        print("\n[LLM] === Starting LLM Auto-Configuration (ALL SCHOOLS) ===")
        prompt_template = llm_auto.get('prompt_template', '')
        
        if prompt_template:
            # Prepare sample spells for each school
            schools_sample_data = {}
            for school_name in schools.keys():
                sample = school_spells.get(school_name, [])[:10]
                if sample:
                    schools_sample_data[school_name] = sample
            
            # Single LLM call for ALL schools
            print(f"[LLM] Configuring {len(schools_sample_data)} schools in ONE call...")
            all_llm_results = auto_configure_all_schools(llm_client, schools_sample_data, prompt_template)
            
            # Process results for each school
            for school_name, llm_result in all_llm_results.items():
                if llm_result:
                    # Validate and normalize the config
                    school_cfg = {
                        'shape': llm_result.get('shape', 'organic'),
                        'density': float(llm_result.get('density', 0.6)),
                        'symmetry': float(llm_result.get('symmetry', 0.3)),
                        'convergence_chance': float(llm_result.get('convergence_chance', 0.4)),
                        'source': 'llm',
                        'reasoning': llm_result.get('reasoning', '')
                    }
                    
                    # Handle branching energy if provided
                    if 'branching_energy' in llm_result:
                        be = llm_result['branching_energy']
                        school_cfg['min_straight'] = int(be.get('min_straight', 2))
                        school_cfg['max_straight'] = int(be.get('max_straight', 5))
                        school_cfg['energy_randomness'] = float(be.get('randomness', 0.3))
                    else:
                        school_cfg['min_straight'] = int(llm_result.get('min_straight', 2))
                        school_cfg['max_straight'] = int(llm_result.get('max_straight', 5))
                        school_cfg['energy_randomness'] = 0.3
                    
                    school_configs[school_name] = school_cfg
                    log_to_file(f"[LLM] {school_name} config: {school_cfg}")
                    print(f"[LLM] {school_name}: shape={school_cfg['shape']}, density={school_cfg['density']:.2f}")
                    if school_cfg.get('reasoning'):
                        print(f"[LLM]   -> reason: {school_cfg['reasoning'][:80]}...")
        else:
            print("[LLM] No prompt template provided for auto-config")
    
    # If no LLM or LLM failed, use config values or generate random per-school
    for school_name in schools.keys():
        if school_name not in school_configs:
            # Use values from config or defaults
            school_configs[school_name] = {
                'shape': SCHOOL_DEFAULT_SHAPES.get(school_name, config.get('shape', 'organic')),
                'density': config.get('density', 0.6),
                'symmetry': config.get('symmetry', 0.3),
                'min_straight': config.get('branching_energy', {}).get('min_straight', 2),
                'max_straight': config.get('branching_energy', {}).get('max_straight', 5),
                'convergence_chance': config.get('convergence_chance', 0.4),
                'source': 'config'
            }
    
    # Store school_configs in main config so tree_builder can use them
    config['school_configs'] = school_configs

    # ==========================================================================
    # LLM Enhancement: Keyword Classification for unmatched spells
    # ==========================================================================
    if llm_client and llm_keyword_class.get('enabled'):
        print("\n[LLM Keywords] === Starting LLM Keyword Classification ===")
        log_to_file("[LLM Keywords] Starting keyword classification")
        try:
            from keyword_classifier import classify_all_schools

            def kw_progress(processed, total, school):
                print(f"[LLM Keywords] {school}: {processed}/{total}")

            total_classified = classify_all_schools(
                client=llm_client,
                spells=spells,
                batch_size=llm_keyword_class.get('batch_size', 100),
                min_confidence=llm_keyword_class.get('min_confidence', 40),
                top_themes=config.get('top_themes_per_school', 8),
                progress_callback=kw_progress
            )

            print(f"[LLM Keywords] Total classified: {total_classified}/{len(spells)} spells")
            log_to_file(f"[LLM Keywords] Classified {total_classified}/{len(spells)} spells")
        except ImportError as e:
            print(f"[LLM Keywords] Import error (missing thefuzz?): {e}")
            log_to_file(f"[LLM Keywords] Import error: {e}")
        except Exception as e:
            print(f"[LLM Keywords] Error: {e}")
            log_to_file(f"[LLM Keywords] Error: {e}")
            import traceback
            traceback.print_exc()

    # ==========================================================================
    # Fuzzy Analysis: Compute spell relationships using TF-IDF similarity
    # ==========================================================================
    fuzzy_data = None
    if config.get('run_fuzzy_analysis', False) or config.get('return_fuzzy_data', False):
        print("\n[Fuzzy] Running fuzzy NLP analysis for spell relationships...")
        log_to_file("[Fuzzy] Starting fuzzy analysis...")
        
        try:
            fuzzy_data = compute_fuzzy_relationships(spells, top_n=5)
            print(f"[Fuzzy] Found relationships for {len(fuzzy_data.get('relationships', {}))} spells")
            print(f"[Fuzzy] Found {len(fuzzy_data.get('groups', {}))} themed groups")
        except Exception as e:
            print(f"[Fuzzy] Error: {e}")
            log_to_file(f"[Fuzzy] Error: {e}")
            fuzzy_data = {'relationships': {}, 'similarity_scores': {}, 'groups': {}, 'themes': {}}
    
    # Build trees
    print(f"\n[Info] Building trees (shape={config['shape']})...")
    start_time = datetime.now()
    
    tree_data = build_spell_trees(spells, config)
    
    # ==========================================================================
    # LLM Enhancement: Themed Groups (runs AFTER tree building)
    # ==========================================================================
    if llm_client and llm_groups.get('enabled'):
        print("\n[LLM Groups] Discovering and enhancing themed groups...")
        group_prompt = llm_groups.get('prompt_template', '')
        
        if group_prompt:
            try:
                from theme_discovery import discover_themes_per_school
                from spell_grouper import group_spells_by_themes
                
                # Discover themes per school
                school_themes = discover_themes_per_school(spells, top_n=5)
                
                for school_name, themes in school_themes.items():
                    if not themes:
                        continue
                    
                    print(f"[LLM Groups] {school_name}: themes = {themes}")
                    log_to_file(f"[LLM Groups] {school_name}: themes = {themes}")
                    
                    # Get spells for this school
                    school_spell_list = [s for s in spells if s.get('school') == school_name]
                    
                    # Group spells by discovered themes
                    grouped = group_spells_by_themes(school_spell_list, themes)
                    
                    # Enhance top groups with LLM
                    for theme, theme_spells in list(grouped.items())[:3]:  # Top 3 groups
                        if len(theme_spells) < 2:
                            continue
                        
                        print(f"[LLM Groups]   Enhancing '{theme}' ({len(theme_spells)} spells)...")
                        group_result = enhance_themed_group(
                            llm_client, 
                            [theme],
                            theme_spells[:5],
                            group_prompt
                        )
                        
                        if group_result:
                            group_key = f"{school_name}_{theme}"
                            llm_groups_data[group_key] = {
                                'school': school_name,
                                'original_theme': theme,
                                'spell_count': len(theme_spells),
                                **group_result
                            }
                            print(f"[LLM Groups]   -> Name: {group_result.get('group_name', theme)}")
                            print(f"[LLM Groups]   -> Color: {group_result.get('group_color', '#888')}")
                            print(f"[LLM Groups]   -> Style: {group_result.get('growth_style', 'default')}")
                            log_to_file(f"[LLM Groups] Enhanced: {group_key} -> {group_result}")
                
                print(f"[LLM Groups] Enhanced {len(llm_groups_data)} groups total")
                
            except Exception as e:
                print(f"[LLM Groups] Error: {e}")
                log_to_file(f"[LLM Groups] Error: {e}")
        else:
            print("[LLM Groups] No prompt template provided")
    
    tree_data['generatedAt'] = datetime.now().isoformat()
    tree_data['generator'] = 'SpellTreeBuilder (Modular)'
    tree_data['config'] = {
        'shape': config['shape'],
        'density': config.get('density', 0.6),
        'symmetry': config.get('symmetry', 0.3),
    }
    # Always include the seed that was used
    tree_data['seed'] = config['seed']
    
    # Include per-school configs so JS can update the UI controls
    tree_data['school_configs'] = school_configs
    
    # Include LLM group data if available
    if llm_groups_data:
        tree_data['llm_groups'] = llm_groups_data
    
    # Include fuzzy relationship data if requested (for visual-first edge building)
    if fuzzy_data and config.get('return_fuzzy_data', False):
        tree_data['fuzzy_relationships'] = fuzzy_data.get('relationships', {})
        tree_data['similarity_scores'] = fuzzy_data.get('similarity_scores', {})
        tree_data['fuzzy_groups'] = fuzzy_data.get('groups', {})
        tree_data['spell_themes'] = fuzzy_data.get('themes', {})
        print(f"[Fuzzy] Included fuzzy data in output: {len(tree_data['fuzzy_relationships'])} relationships")
    
    build_time = (datetime.now() - start_time).total_seconds()
    print(f"[Info] Built in {build_time:.2f}s")
    
    # Validate
    print("[Info] Validating...")
    validation = validate_tree(tree_data, config['max_children_per_node'])
    summary = get_validation_summary(validation)
    
    print(f"[Info] Valid: {summary['valid_schools']}/{summary['total_schools']} schools")
    print(f"[Info] Reachable: {summary['reachable_nodes']}/{summary['total_nodes']} nodes")
    
    if summary['total_errors'] > 0 and config.get('auto_fix_unreachable', True):
        print("[Info] Auto-fixing unreachable nodes...")
        total_fixes = 0
        for school_name, school_data in tree_data.get('schools', {}).items():
            nodes_list = school_data.get('nodes', [])
            nodes_dict = {n['formId']: n for n in nodes_list}
            root_id = school_data.get('root')
            if root_id:
                fixes = fix_unreachable_nodes(nodes_dict, root_id, config['max_children_per_node'])
                if fixes > 0:
                    print(f"  Fixed {fixes} in {school_name}")
                    total_fixes += fixes
                    school_data['nodes'] = list(nodes_dict.values())
        
        if total_fixes > 0:
            validation = validate_tree(tree_data, config['max_children_per_node'])
            summary = get_validation_summary(validation)
    
    # Coverage
    output_spells = sum(len(s.get('nodes', [])) for s in tree_data.get('schools', {}).values())
    if output_spells == len(spells):
        print(f"[Success] 100% coverage: {output_spells} spells")
    else:
        print(f"[Warning] Coverage: {output_spells}/{len(spells)}")
    
    # Write output
    print(f"[Info] Writing: {args.output}")
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(tree_data, f, indent=2 if args.pretty else None, ensure_ascii=False)
    
    print(f"[Success] Saved ({output_path.stat().st_size / 1024:.1f} KB)")
    
    print("\n" + "="*60)
    print("GENERATION COMPLETE - SUMMARY")
    print("="*60)
    print(f"Total Spells: {len(spells)} -> {output_spells} nodes")
    print(f"Schools: {len(tree_data.get('schools', {}))}")
    print(f"Build Time: {build_time:.2f}s")
    print(f"Validation: {'PASSED' if summary['all_valid'] else 'WARNINGS'}")
    
    # Show per-school config summary
    print(f"\n--- Per-School Configs Used ---")
    for school_name, school_data in tree_data.get('schools', {}).items():
        cfg_used = school_data.get('config_used', {})
        if cfg_used:
            print(f"  {school_name}:")
            print(f"    Shape: {cfg_used.get('shape', 'organic')}")
            print(f"    Density: {cfg_used.get('density', 0.6):.2f}")
            print(f"    Symmetry: {cfg_used.get('symmetry', 0.3):.2f}")
            print(f"    Source: {cfg_used.get('source', 'default')}")
        else:
            print(f"  {school_name}: default config")
    
    # Show LLM stats
    llm_count = sum(1 for s in school_configs.values() if s.get('source') == 'llm')
    if llm_count > 0:
        print(f"\n--- LLM Statistics ---")
        print(f"  Schools configured by LLM: {llm_count}/{len(school_configs)}")
    
    print("="*60)
    
    log_to_file(f"COMPLETED: all_valid={summary['all_valid']}, exit_code={0 if summary['all_valid'] else 1}")
    sys.exit(0 if summary['all_valid'] else 1)


if __name__ == '__main__':
    main()
