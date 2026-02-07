#!/usr/bin/env python3
"""Integration test for Spell Tree Builder."""

import json
from tree_builder import build_spell_trees
from validator import validate_tree, get_validation_summary

# Sample spell data (12 spells across 2 schools)
sample_spells = [
    {'formId': '0x00012FCD', 'name': 'Flames', 'school': 'Destruction', 'effectNames': ['Fire Damage'], 'skillLevel': 'Novice'},
    {'formId': '0x00012FCE', 'name': 'Frostbite', 'school': 'Destruction', 'effectNames': ['Frost Damage'], 'skillLevel': 'Novice'},
    {'formId': '0x00012FCF', 'name': 'Sparks', 'school': 'Destruction', 'effectNames': ['Shock Damage'], 'skillLevel': 'Novice'},
    {'formId': '0x0001C789', 'name': 'Firebolt', 'school': 'Destruction', 'effectNames': ['Fire Damage'], 'skillLevel': 'Apprentice'},
    {'formId': '0x0001C78A', 'name': 'Ice Spike', 'school': 'Destruction', 'effectNames': ['Frost Damage'], 'skillLevel': 'Apprentice'},
    {'formId': '0x0001C78B', 'name': 'Lightning Bolt', 'school': 'Destruction', 'effectNames': ['Shock Damage'], 'skillLevel': 'Apprentice'},
    {'formId': '0x0001C78C', 'name': 'Fireball', 'school': 'Destruction', 'effectNames': ['Fire Damage'], 'skillLevel': 'Adept'},
    {'formId': '0x0001C78D', 'name': 'Ice Storm', 'school': 'Destruction', 'effectNames': ['Frost Damage'], 'skillLevel': 'Adept'},
    {'formId': '0x0001C78E', 'name': 'Chain Lightning', 'school': 'Destruction', 'effectNames': ['Shock Damage'], 'skillLevel': 'Adept'},
    {'formId': '0x0005AD5C', 'name': 'Oakflesh', 'school': 'Alteration', 'effectNames': ['Armor'], 'skillLevel': 'Novice'},
    {'formId': '0x0005AD5D', 'name': 'Stoneflesh', 'school': 'Alteration', 'effectNames': ['Armor'], 'skillLevel': 'Apprentice'},
    {'formId': '0x0005AD5E', 'name': 'Ironflesh', 'school': 'Alteration', 'effectNames': ['Armor'], 'skillLevel': 'Adept'},
]

def main():
    print('=' * 50)
    print('Spell Tree Builder Integration Test')
    print('=' * 50)
    
    print(f'\nInput: {len(sample_spells)} spells')
    
    print('\nBuilding trees...')
    trees = build_spell_trees(sample_spells)
    
    schools = trees.get('schools', {})
    print(f'Generated {len(schools)} schools: {list(schools.keys())}')
    
    total_nodes = sum(len(s.get('nodes', [])) for s in schools.values())
    print(f'Total nodes: {total_nodes}')
    
    print('\nValidating...')
    results = validate_tree(trees)
    summary = get_validation_summary(results)
    
    print(f'Validation: {summary["valid_schools"]}/{summary["total_schools"]} schools valid')
    print(f'Reachable: {summary["reachable_nodes"]}/{summary["total_nodes"]} nodes')
    
    if summary['total_errors'] > 0:
        print(f'Errors: {summary["total_errors"]}')
        for school, result in results.items():
            for error in result.errors:
                print(f'  - {error}')
    
    # Show tree structure for each school
    print('\nTree Structure:')
    for school_name, school_data in schools.items():
        root = school_data.get('root')
        nodes = school_data.get('nodes', [])
        print(f'  {school_name} ({len(nodes)} nodes, root: {root})')
        
        # Show first few nodes
        for node in nodes[:5]:
            prereqs = node.get('prerequisites', [])
            children = node.get('children', [])
            prereq_str = f'prereqs: {len(prereqs)}' if prereqs else 'ROOT'
            children_str = f'children: {len(children)}' if children else 'leaf'
            print(f'    {node["formId"]}: {prereq_str}, {children_str}')
        if len(nodes) > 5:
            print(f'    ... and {len(nodes) - 5} more')
    
    result_str = 'PASSED' if summary['all_valid'] else 'FAILED'
    print(f'\n{"=" * 50}')
    print(f'Result: {result_str}')
    print(f'{"=" * 50}')
    
    return 0 if summary['all_valid'] else 1

if __name__ == '__main__':
    exit(main())
