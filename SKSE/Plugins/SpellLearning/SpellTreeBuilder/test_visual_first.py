#!/usr/bin/env python3
"""
Visual-First Tree Builder Test Script

Loads spell data, simulates the layout algorithm, and outputs metrics for assessment.
Run: python test_visual_first.py [spell_file.json]
"""

import json
import math
import random
import sys
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import time

# =============================================================================
# CONFIGURATION
# =============================================================================

@dataclass
class LayoutConfig:
    base_radius: float = 80.0
    tier_spacing: float = 80.0  # Same as base_radius for uniform grid
    grid_density: int = 10
    school_padding: float = 8.0  # degrees
    max_tiers: int = 5
    min_node_spacing: float = 55.0  # Minimum pixels between nodes

@dataclass 
class SchoolConfig:
    shape: str = "organic"
    density: float = 0.6
    convergence: float = 0.4
    slice_weight: float = 1.0

LAYOUT_CONFIG = LayoutConfig()

def get_scaled_config(spell_count: int, sector_angle: float) -> Dict:
    """
    Calculate layout config that balances:
    1. Fitting all spells
    2. Keeping wheel at reasonable size
    3. Avoiding overlap
    
    Strategy: 
    - Use arc length calculation to determine how many nodes fit per ring
    - Determine how many tiers needed
    - Set radius to keep good spacing
    """
    # Config constants - compact yet readable
    MIN_NODE_SPACING = 28  # Minimum pixels between node centers
    MIN_TIER_SPACING = 25  # Minimum pixels between tier rings  
    BASE_RADIUS = 60       # Starting radius
    
    # Calculate how many nodes can fit on one ring at a given radius
    def nodes_per_ring_at_radius(radius: float, sector_deg: float) -> int:
        arc_length = (sector_deg / 360) * 2 * math.pi * radius
        return max(1, int(arc_length / MIN_NODE_SPACING))
    
    # Binary search for optimal config
    best_config = None
    
    for num_tiers in range(5, 30):  # Allow up to 30 tiers
        # Try different tier spacings
        for tier_spacing in [25, 28, 32, 36, 40]:
            max_radius = BASE_RADIUS + tier_spacing * (num_tiers - 1)
            
            # Calculate total capacity
            total_capacity = 1  # Root node
            for t in range(1, num_tiers):
                radius = BASE_RADIUS + t * tier_spacing
                total_capacity += nodes_per_ring_at_radius(radius, sector_angle)
            
            if total_capacity >= spell_count:
                # Found a valid config
                avg_nodes_per_ring = int(spell_count / num_tiers)
                config = {
                    "base_radius": BASE_RADIUS,
                    "tier_spacing": tier_spacing,
                    "num_tiers": num_tiers,
                    "points_per_ring_fn": lambda r: nodes_per_ring_at_radius(r, sector_angle),
                    "max_radius": max_radius,
                    "total_capacity": total_capacity,
                }
                
                if best_config is None or max_radius < best_config["max_radius"]:
                    best_config = config
    
    # Fallback if no config found
    if best_config is None:
        num_tiers = 15
        tier_spacing = 60
        best_config = {
            "base_radius": BASE_RADIUS,
            "tier_spacing": tier_spacing,
            "num_tiers": num_tiers,
            "points_per_ring_fn": lambda r: nodes_per_ring_at_radius(r, sector_angle),
            "max_radius": BASE_RADIUS + tier_spacing * (num_tiers - 1),
            "total_capacity": 999,
        }
    
    print(f"  [Config] {spell_count} spells: {best_config['num_tiers']} tiers, spacing={best_config['tier_spacing']}, max_r={best_config['max_radius']:.0f}, capacity={best_config['total_capacity']}")
    
    return best_config

# Reduced jitter for denser, more user-friendly layout
JITTER_PROFILES = {
    "organic":  {"radius": 0.05, "angle": 2},
    "radial":   {"radius": 0.02, "angle": 0.5},
    "spiky":    {"radius": 0.08, "angle": 3},
    "mountain": {"radius": 0.04, "angle": 2},
    "cloud":    {"radius": 0.06, "angle": 3},
    "cascade":  {"radius": 0.02, "angle": 1},
    "linear":   {"radius": 0.01, "angle": 0.5},
    "grid":     {"radius": 0.00, "angle": 0},
}

TIER_NAMES = ["Novice", "Apprentice", "Adept", "Expert", "Master"]

# =============================================================================
# SEEDED RANDOM
# =============================================================================

class SeededRandom:
    def __init__(self, seed: int):
        self.state = seed or int(time.time() * 1000)
    
    def random(self) -> float:
        self.state = (self.state * 1103515245 + 12345) & 0x7fffffff
        return self.state / 0x7fffffff

# =============================================================================
# GRID GENERATION
# =============================================================================

@dataclass
class GridPoint:
    tier: int
    col: int
    col_total: int
    is_root: bool
    grid_radius: float
    grid_angle: float
    x: float
    y: float
    angle_norm: float
    radius_norm: float
    spoke_angle: float
    selected: bool = False
    spell: Optional[Dict] = None
    school: str = ""

@dataclass
class SliceInfo:
    start_angle: float
    end_angle: float
    sector_angle: float
    spoke_angle: float
    weight: float

def calculate_slice_angles(schools_data: Dict) -> Dict[str, SliceInfo]:
    school_names = list(schools_data.keys())
    num_schools = len(school_names)
    
    if num_schools == 0:
        return {}
    
    # Calculate weights
    total_weight = 0
    school_weights = {}
    for name, data in schools_data.items():
        spell_count = len(data.get("spells", []))
        slice_weight = data.get("config", {}).get("slice_weight", 1.0)
        school_weights[name] = spell_count * slice_weight
        total_weight += school_weights[name]
    
    # Distribute 360°
    total_padding = num_schools * LAYOUT_CONFIG.school_padding
    available_angle = 360 - total_padding
    
    slice_angles = {}
    current_angle = -90  # Start at top
    
    for name in school_names:
        sector_angle = (school_weights[name] / total_weight) * available_angle
        spoke_angle = current_angle + sector_angle / 2
        
        slice_angles[name] = SliceInfo(
            start_angle=current_angle,
            end_angle=current_angle + sector_angle,
            sector_angle=sector_angle,
            spoke_angle=spoke_angle,
            weight=school_weights[name]
        )
        
        current_angle += sector_angle + LAYOUT_CONFIG.school_padding
    
    return slice_angles

def generate_full_grid(slice_info: SliceInfo, spell_count: int = 50) -> List[GridPoint]:
    # Get scaled config for this spell count
    scaled = get_scaled_config(spell_count, slice_info.sector_angle)
    base_radius = scaled["base_radius"]
    tier_spacing = scaled["tier_spacing"]
    num_tiers = scaled["num_tiers"]
    
    points = []
    
    for tier in range(num_tiers):
        radius = base_radius + (tier * tier_spacing)
        
        # Tier 0 = 1 root point
        if tier == 0:
            ring_points = 1
        else:
            # Calculate points based on arc length at this radius
            arc_length = (slice_info.sector_angle / 360) * 2 * math.pi * radius
            ring_points = max(2, int(arc_length / 28))  # 28px spacing (matches MIN_NODE_SPACING)
        
        usable_angle = slice_info.sector_angle * 0.92
        angle_step = usable_angle / (ring_points - 1) if ring_points > 1 else 0
        start_angle = slice_info.spoke_angle - usable_angle / 2
        
        for i in range(ring_points):
            if tier == 0 or ring_points == 1:
                grid_angle = slice_info.spoke_angle
            else:
                grid_angle = start_angle + (i * angle_step)
            
            rad = math.radians(grid_angle)
            x = math.cos(rad) * radius
            y = math.sin(rad) * radius
            
            points.append(GridPoint(
                tier=tier,
                col=i,
                col_total=ring_points,
                is_root=(tier == 0),
                grid_radius=radius,
                grid_angle=grid_angle,
                x=x,
                y=y,
                angle_norm=(grid_angle - slice_info.start_angle) / slice_info.sector_angle if slice_info.sector_angle > 0 else 0.5,
                radius_norm=tier / (num_tiers - 1) if num_tiers > 1 else 0,
                spoke_angle=slice_info.spoke_angle
            ))
    
    return points

# =============================================================================
# POINT SELECTION
# =============================================================================

def select_by_tier_distribution(grid: List[GridPoint], spell_count: int, rng: SeededRandom) -> List[int]:
    # Group by tier
    by_tier = {}
    max_tier = 0
    for idx, p in enumerate(grid):
        if p.tier not in by_tier:
            by_tier[p.tier] = []
        by_tier[p.tier].append((p, idx))
        max_tier = max(max_tier, p.tier)
    
    num_tiers = max_tier + 1
    
    # Tier 0 gets 1, rest distributed evenly with slight outer bias
    spells_per_tier = {0: min(1, len(by_tier.get(0, [])))}
    remaining = spell_count - 1
    
    # Calculate available capacity per tier
    tier_capacity = {t: len(by_tier.get(t, [])) for t in range(num_tiers)}
    total_capacity = sum(tier_capacity.get(t, 0) for t in range(1, num_tiers))
    
    if total_capacity == 0:
        return []
    
    allocated = spells_per_tier[0]
    
    # Distribute remaining evenly across tiers
    for t in range(1, num_tiers):
        available = tier_capacity.get(t, 0)
        if available == 0:
            continue
        # Proportional distribution based on capacity
        target = int(remaining * available / total_capacity)
        spells_per_tier[t] = min(target, available)
        allocated += spells_per_tier[t]
    
    # Fill remaining from all tiers (favor fuller tiers for visual balance)
    attempts = 0
    while allocated < spell_count and attempts < 1000:
        added = False
        for t in range(1, num_tiers):
            available = tier_capacity.get(t, 0)
            if spells_per_tier.get(t, 0) < available and allocated < spell_count:
                spells_per_tier[t] = spells_per_tier.get(t, 0) + 1
                allocated += 1
                added = True
        if not added:
            break
        attempts += 1
    
    # Select points
    selected = []
    for t in range(num_tiers):
        tier_points = by_tier.get(t, [])
        needed = spells_per_tier.get(t, 0)
        
        if needed == 0 or not tier_points:
            continue
        
        # Sort by angle
        tier_points.sort(key=lambda x: x[0].grid_angle)
        
        # Even selection
        step = len(tier_points) / needed if needed > 0 else 1
        for i in range(needed):
            idx = int(i * step)
            if idx < len(tier_points):
                selected.append(tier_points[idx][1])
    
    return selected

def select_grid_points(grid: List[GridPoint], spell_count: int, config: SchoolConfig, seed: int) -> List[GridPoint]:
    rng = SeededRandom(seed)
    
    # Filter grid for shape (simplified)
    filtered = grid
    if config.shape == "mountain":
        filtered = [p for p in grid if abs(p.angle_norm - 0.5) * 2 <= 1.0 - (p.tier / LAYOUT_CONFIG.max_tiers) * 0.7]
    elif config.shape == "linear":
        filtered = [p for p in grid if abs(p.angle_norm - 0.5) * 2 <= 0.3]
    
    selected_indices = select_by_tier_distribution(filtered, spell_count, rng)
    
    selected = []
    for idx in selected_indices:
        if 0 <= idx < len(grid):
            grid[idx].selected = True
            selected.append(grid[idx])
    
    return selected

def apply_jitter(points: List[GridPoint], config: SchoolConfig, seed: int):
    jitter = JITTER_PROFILES.get(config.shape, JITTER_PROFILES["organic"])
    rng = SeededRandom(seed)
    
    for p in points:
        radius_offset = (rng.random() - 0.5) * 2 * p.grid_radius * jitter["radius"]
        p.grid_radius += radius_offset
        
        angle_offset = (rng.random() - 0.5) * 2 * jitter["angle"]
        p.grid_angle += angle_offset
        
        rad = math.radians(p.grid_angle)
        p.x = math.cos(rad) * p.grid_radius
        p.y = math.sin(rad) * p.grid_radius

# =============================================================================
# SPELL ASSIGNMENT & EDGES
# =============================================================================

def get_tier_index(skill_level: str) -> int:
    if isinstance(skill_level, int):
        return skill_level
    try:
        return TIER_NAMES.index(skill_level)
    except ValueError:
        return 0

def assign_spells(positions: List[GridPoint], spells: List[Dict], seed: int):
    """
    Assign spells to positions. Maps spell skill levels to position tiers.
    With many tiers, we map: Novice=early tiers, Master=late tiers.
    """
    rng = SeededRandom(seed)
    
    # Find max tier in positions
    max_pos_tier = max(p.tier for p in positions) if positions else 4
    
    # Group spells by skill level (0-4)
    by_skill = {}
    for spell in spells:
        skill = get_tier_index(spell.get("skillLevel", "Novice"))
        if skill not in by_skill:
            by_skill[skill] = []
        by_skill[skill].append(spell)
    
    # Shuffle each skill level
    for skill_spells in by_skill.values():
        for i in range(len(skill_spells) - 1, 0, -1):
            j = int(rng.random() * (i + 1))
            skill_spells[i], skill_spells[j] = skill_spells[j], skill_spells[i]
    
    # Map skill levels to position tiers
    # skill 0 (Novice) -> tiers 0-1
    # skill 1 (Apprentice) -> tiers 2-3
    # skill 2 (Adept) -> middle tiers
    # skill 3 (Expert) -> later tiers
    # skill 4 (Master) -> final tiers
    
    def skill_to_tier_range(skill: int, max_tier: int) -> range:
        if max_tier <= 4:
            return range(skill, skill + 1)
        
        # Map 5 skill levels to max_tier positions
        tier_per_skill = max_tier / 5
        start = int(skill * tier_per_skill)
        end = int((skill + 1) * tier_per_skill)
        return range(start, max(start + 1, end))
    
    # Collect all unassigned spells in order
    all_spells = []
    for skill in range(5):
        all_spells.extend(by_skill.get(skill, []))
    
    # Assign spells to available positions, preferring tier mapping
    assigned = 0
    spell_idx = 0
    
    # First pass: assign by skill-to-tier mapping
    for skill in range(5):
        skill_spells = by_skill.get(skill, [])
        tier_range = skill_to_tier_range(skill, max_pos_tier)
        tier_positions = [p for p in positions if p.tier in tier_range and p.spell is None]
        
        for spell in skill_spells:
            if tier_positions:
                pos = tier_positions.pop(0)
                pos.spell = spell
                assigned += 1
    
    # Second pass: fill remaining positions with leftover spells
    remaining_spells = [s for skill_spells in by_skill.values() for s in skill_spells]
    remaining_spells = [s for s in remaining_spells if not any(p.spell == s for p in positions)]
    
    empty_positions = [p for p in positions if p.spell is None]
    for pos in empty_positions:
        if remaining_spells:
            pos.spell = remaining_spells.pop(0)
            assigned += 1
    
    return assigned

def build_edges(positions: List[GridPoint], convergence: float, seed: int) -> List[Dict]:
    edges = []
    rng = SeededRandom(seed)
    
    # Group by tier
    by_tier = {}
    max_tier = 0
    for p in positions:
        if p.spell is None:
            continue
        if p.tier not in by_tier:
            by_tier[p.tier] = []
        by_tier[p.tier].append(p)
        max_tier = max(max_tier, p.tier)
    
    def distance(a, b):
        return math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2)
    
    for tier in range(1, max_tier + 1):
        current = by_tier.get(tier, [])
        prev = by_tier.get(tier - 1, [])
        
        if not prev:
            # Try tier-2 as fallback
            prev = by_tier.get(tier - 2, [])
        
        if not prev:
            continue
        
        for pos in current:
            # Sort prev by distance
            sorted_prev = sorted(prev, key=lambda p: distance(pos, p))
            
            if sorted_prev:
                edges.append({
                    "from": sorted_prev[0].spell.get("formId"),
                    "to": pos.spell.get("formId"),
                    "type": "primary"
                })
            
            if len(sorted_prev) > 1 and rng.random() < convergence:
                edges.append({
                    "from": sorted_prev[1].spell.get("formId"),
                    "to": pos.spell.get("formId"),
                    "type": "convergence"
                })
    
    return edges

# =============================================================================
# ASSESSMENT METRICS
# =============================================================================

def calculate_metrics(positions: List[GridPoint], edges: List[Dict]) -> Dict:
    """Calculate quality metrics for the layout."""
    
    if not positions:
        return {"error": "No positions"}
    
    # Filter to assigned positions
    assigned = [p for p in positions if p.spell is not None]
    
    if not assigned:
        return {"error": "No assigned spells"}
    
    # 1. Overlap detection - count pairs too close together
    # Use 20px threshold - only flag actual visual overlaps (center-to-center)
    # Nodes ~40px wide, so centers < 20px apart = overlapping visually
    overlaps = 0
    min_dist = 20  # True visual overlap threshold
    for i, p1 in enumerate(assigned):
        for p2 in assigned[i+1:]:
            dist = math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2)
            if dist < min_dist:
                overlaps += 1
    
    # 2. Distribution uniformity - standard deviation of distances from center
    distances = [math.sqrt(p.x**2 + p.y**2) for p in assigned]
    avg_dist = sum(distances) / len(distances)
    variance = sum((d - avg_dist)**2 for d in distances) / len(distances)
    dist_std = math.sqrt(variance)
    
    # 3. Tier distribution
    tier_counts = {}
    for p in assigned:
        tier_counts[p.tier] = tier_counts.get(p.tier, 0) + 1
    
    # 4. Edge crossing (simplified - just count)
    edge_crossings = 0  # Would need proper line intersection check
    
    # 5. Angular spread per tier
    angular_spreads = {}
    for tier in range(5):
        tier_points = [p for p in assigned if p.tier == tier]
        if len(tier_points) > 1:
            angles = sorted([p.grid_angle for p in tier_points])
            gaps = [angles[i+1] - angles[i] for i in range(len(angles)-1)]
            if gaps:
                angular_spreads[tier] = {
                    "min_gap": min(gaps),
                    "max_gap": max(gaps),
                    "avg_gap": sum(gaps) / len(gaps)
                }
    
    return {
        "total_assigned": len(assigned),
        "overlapping_pairs": overlaps,
        "overlap_percentage": (overlaps * 2 / len(assigned) * 100) if assigned else 0,
        "avg_distance_from_center": avg_dist,
        "distance_std_dev": dist_std,
        "tier_distribution": tier_counts,
        "angular_spreads": angular_spreads,
        "edge_count": len(edges),
        "primary_edges": len([e for e in edges if e.get("type") == "primary"]),
        "convergence_edges": len([e for e in edges if e.get("type") == "convergence"]),
    }

def assess_quality(metrics: Dict) -> Dict:
    """Generate quality assessment from metrics."""
    
    issues = []
    score = 100
    
    # Overlap check
    if metrics.get("overlap_percentage", 0) > 10:
        issues.append(f"High overlap: {metrics['overlap_percentage']:.1f}%")
        score -= 20
    elif metrics.get("overlap_percentage", 0) > 5:
        issues.append(f"Some overlap: {metrics['overlap_percentage']:.1f}%")
        score -= 10
    
    # Tier distribution check
    tier_dist = metrics.get("tier_distribution", {})
    if tier_dist.get(0, 0) > 1:
        issues.append(f"Too many root nodes: {tier_dist.get(0)}")
        score -= 15
    
    # Check if tier 0 has exactly 1 node per school
    # (This would need school info to properly check)
    
    # Distance spread check
    if metrics.get("distance_std_dev", 0) > 100:
        issues.append("High distance variance - uneven spread")
        score -= 10
    
    return {
        "score": max(0, score),
        "grade": "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 70 else "D" if score >= 60 else "F",
        "issues": issues,
        "passed": score >= 70
    }

# =============================================================================
# MAIN
# =============================================================================

def generate_and_assess(spells: List[Dict], config: SchoolConfig, seed: int = 12345):
    """Run full generation and assessment."""
    
    start_time = time.time()
    
    # Group by school
    by_school = {}
    for spell in spells:
        school = spell.get("school", "Unknown")
        if not school or school in ("null", "None", ""):
            school = "Hedge Wizard"
        if school not in by_school:
            by_school[school] = []
        by_school[school].append(spell)
    
    # Build schools data
    schools_data = {
        name: {"spells": spells_list, "config": {"slice_weight": 1.0}}
        for name, spells_list in by_school.items()
    }
    
    print(f"\n{'='*60}")
    print(f"VISUAL-FIRST TREE GENERATION TEST")
    print(f"{'='*60}")
    print(f"Total spells: {len(spells)}")
    print(f"Schools: {list(by_school.keys())}")
    print(f"Config: shape={config.shape}, density={config.density}, convergence={config.convergence}")
    print(f"Seed: {seed}")
    print(f"{'='*60}\n")
    
    # Calculate slices
    slice_angles = calculate_slice_angles(schools_data)
    
    all_positions = []
    all_edges = []
    all_grid_points = []
    
    for school_name, data in schools_data.items():
        school_spells = data["spells"]
        slice_info = slice_angles[school_name]
        school_seed = seed + hash(school_name) % 100000
        
        print(f"Processing {school_name}: {len(school_spells)} spells, {slice_info.sector_angle:.1f}° slice")
        
        # Generate grid (scaled for spell count)
        grid = generate_full_grid(slice_info, len(school_spells))
        all_grid_points.extend(grid)
        
        # Select points
        selected = select_grid_points(grid, len(school_spells), config, school_seed)
        
        # Apply jitter
        apply_jitter(selected, config, school_seed + 1)
        
        # Assign spells
        assigned = assign_spells(selected, school_spells, school_seed + 2)
        
        # Build edges
        edges = build_edges(selected, config.convergence, school_seed + 3)
        
        # Mark school
        for p in selected:
            p.school = school_name
        
        all_positions.extend(selected)
        all_edges.extend(edges)
        
        print(f"  Grid points: {len(grid)}, Selected: {len(selected)}, Assigned: {assigned}, Edges: {len(edges)}")
    
    elapsed = time.time() - start_time
    
    # Calculate metrics
    print(f"\n{'='*60}")
    print("METRICS")
    print(f"{'='*60}")
    
    metrics = calculate_metrics(all_positions, all_edges)
    for key, value in metrics.items():
        if isinstance(value, dict):
            print(f"  {key}:")
            for k, v in value.items():
                print(f"    {k}: {v}")
        else:
            print(f"  {key}: {value}")
    
    # Assessment
    print(f"\n{'='*60}")
    print("ASSESSMENT")
    print(f"{'='*60}")
    
    assessment = assess_quality(metrics)
    print(f"  Score: {assessment['score']}/100 ({assessment['grade']})")
    print(f"  Passed: {'YES' if assessment['passed'] else 'NO'}")
    if assessment['issues']:
        print(f"  Issues:")
        for issue in assessment['issues']:
            print(f"    - {issue}")
    
    print(f"\n  Generation time: {elapsed*1000:.1f}ms")
    print(f"{'='*60}\n")
    
    return {
        "metrics": metrics,
        "assessment": assessment,
        "elapsed_ms": elapsed * 1000
    }

def load_spells_from_file(filepath: str) -> List[Dict]:
    """Load spells from a JSON file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if "spells" in data:
        return data["spells"]
    elif isinstance(data, list):
        return data
    else:
        raise ValueError("Could not find spells array in JSON")

def generate_sample_spells(count: int) -> List[Dict]:
    """Generate sample spell data for testing."""
    schools = ["Destruction", "Restoration", "Alteration", "Conjuration", "Illusion"]
    
    spells = []
    for i in range(count):
        school = random.choice(schools)
        tier = random.choices(TIER_NAMES, weights=[0.25, 0.25, 0.2, 0.2, 0.1])[0]
        spells.append({
            "formId": f"0x{0x100000 + i:06X}",
            "name": f"{school[:3]}_Spell_{i+1}",
            "school": school,
            "skillLevel": tier
        })
    
    return spells

def load_all_schools(folder: str) -> Dict[str, List[Dict]]:
    """Load all school JSON files from a folder."""
    schools = {}
    folder_path = Path(folder)
    
    for json_file in folder_path.glob("*_spells.json"):
        school_name = json_file.stem.replace("_spells", "")
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if "spells" in data:
            schools[school_name] = data["spells"]
            print(f"  Loaded {school_name}: {len(data['spells'])} spells")
    
    return schools

def test_full_wheel(schools_data: Dict[str, List[Dict]], school_configs: Dict[str, SchoolConfig], seed: int = 12345):
    """Test complete wheel with all schools having different configs."""
    
    start_time = time.time()
    
    # Build unified schools dict
    schools_unified = {}
    total_spells = 0
    for name, spells in schools_data.items():
        cfg = school_configs.get(name, SchoolConfig())
        schools_unified[name] = {
            "spells": spells,
            "config": {"slice_weight": cfg.slice_weight}
        }
        total_spells += len(spells)
    
    print(f"\n{'='*70}")
    print(f"FULL WHEEL TEST - {len(schools_data)} schools, {total_spells} total spells")
    print(f"{'='*70}")
    
    # Calculate slices
    slice_angles = calculate_slice_angles(schools_unified)
    
    all_positions = []
    all_edges = []
    school_metrics = {}
    
    for school_name, data in schools_unified.items():
        school_spells = data["spells"]
        slice_info = slice_angles[school_name]
        cfg = school_configs.get(school_name, SchoolConfig())
        school_seed = seed + hash(school_name) % 100000
        
        print(f"\n  {school_name}: {len(school_spells)} spells, {slice_info.sector_angle:.1f}° slice, shape={cfg.shape}")
        
        # Generate grid
        grid = generate_full_grid(slice_info, len(school_spells))
        
        # Select points
        selected = select_grid_points(grid, len(school_spells), cfg, school_seed)
        
        # Apply jitter
        apply_jitter(selected, cfg, school_seed + 1)
        
        # Assign spells
        assigned = assign_spells(selected, school_spells, school_seed + 2)
        
        # Build edges
        edges = build_edges(selected, cfg.convergence, school_seed + 3)
        
        # Mark school
        for p in selected:
            p.school = school_name
        
        all_positions.extend(selected)
        all_edges.extend(edges)
        
        # Calculate per-school metrics
        school_metrics[school_name] = calculate_metrics(selected, edges)
        print(f"    Assigned: {assigned}/{len(school_spells)}, Overlaps: {school_metrics[school_name].get('overlapping_pairs', 0)}")
    
    elapsed = time.time() - start_time
    
    # Overall metrics
    overall = calculate_metrics(all_positions, all_edges)
    
    print(f"\n{'='*70}")
    print("OVERALL WHEEL METRICS")
    print(f"{'='*70}")
    print(f"  Total nodes: {overall.get('total_assigned', 0)}")
    print(f"  Total overlaps: {overall.get('overlapping_pairs', 0)} ({overall.get('overlap_percentage', 0):.1f}%)")
    print(f"  Avg distance from center: {overall.get('avg_distance_from_center', 0):.0f}px")
    print(f"  Distance std dev: {overall.get('distance_std_dev', 0):.0f}px")
    print(f"  Total edges: {overall.get('edge_count', 0)}")
    print(f"  Generation time: {elapsed*1000:.1f}ms")
    
    # Assess spread - is it too large?
    max_dist = max(math.sqrt(p.x**2 + p.y**2) for p in all_positions if p.spell)
    print(f"  Max radius: {max_dist:.0f}px")
    
    # User-friendliness score
    uf_score = 100
    issues = []
    
    if overall.get('overlap_percentage', 0) > 50:
        uf_score -= 20
        issues.append(f"High overlap ({overall.get('overlap_percentage', 0):.0f}%)")
    
    if max_dist > 800:
        uf_score -= 15
        issues.append(f"Too spread out (max radius {max_dist:.0f}px)")
    
    if overall.get('distance_std_dev', 0) > 150:
        uf_score -= 10
        issues.append(f"Uneven distribution (std dev {overall.get('distance_std_dev', 0):.0f})")
    
    # Check if schools have distinct visual identity (different shapes help)
    unique_shapes = len(set(school_configs[s].shape for s in schools_data.keys() if s in school_configs))
    if unique_shapes < 3:
        uf_score -= 10
        issues.append(f"Low variety ({unique_shapes} unique shapes)")
    
    print(f"\n  USER-FRIENDLINESS SCORE: {uf_score}/100")
    if issues:
        for issue in issues:
            print(f"    - {issue}")
    
    return {
        "overall": overall,
        "school_metrics": school_metrics,
        "uf_score": uf_score,
        "max_radius": max_dist,
        "issues": issues
    }

if __name__ == "__main__":
    # Define unique configs per school for visual identity
    school_configs = {
        "Destruction": SchoolConfig(shape="spiky", density=0.7, convergence=0.5, slice_weight=1.2),
        "Restoration": SchoolConfig(shape="organic", density=0.6, convergence=0.3, slice_weight=1.0),
        "Alteration": SchoolConfig(shape="grid", density=0.8, convergence=0.4, slice_weight=1.0),
        "Conjuration": SchoolConfig(shape="radial", density=0.7, convergence=0.6, slice_weight=1.1),
        "Illusion": SchoolConfig(shape="cloud", density=0.5, convergence=0.3, slice_weight=0.9),
    }
    
    # TEST A: Realistic moderate load (300 spells)
    print("\n" + "="*70)
    print("TEST A: MODERATE LOAD (300 spells, ~60 per school)")
    print("="*70)
    moderate_data = {
        "Destruction": generate_sample_spells(80),
        "Restoration": generate_sample_spells(50),
        "Alteration": generate_sample_spells(60),
        "Conjuration": generate_sample_spells(70),
        "Illusion": generate_sample_spells(40),
    }
    resultA = test_full_wheel(moderate_data, school_configs, seed=12345)
    
    # TEST B: Heavier load (600 spells)
    print("\n" + "="*70)
    print("TEST B: HEAVIER LOAD (600 spells)")
    print("="*70)
    heavier_data = {
        "Destruction": generate_sample_spells(160),
        "Restoration": generate_sample_spells(100),
        "Alteration": generate_sample_spells(120),
        "Conjuration": generate_sample_spells(140),
        "Illusion": generate_sample_spells(80),
    }
    resultB = test_full_wheel(heavier_data, school_configs, seed=12345)
    
    # TEST C: Real data from file
    print("\n" + "="*70)
    print("TEST C: REAL DATA (from spell files)")
    print("="*70)
    SCHOOLS_FOLDER = r"G:\MODSTAGING\HIRCINE\overwrite\SKSE\Plugins\SpellLearning\schools"
    print("Loading real spell files...")
    real_data = load_all_schools(SCHOOLS_FOLDER)
    if real_data:
        resultC = test_full_wheel(real_data, school_configs, seed=12345)
    else:
        print("Could not load real data, skipping")
        resultC = {"uf_score": 0, "max_radius": 0, "overall": {"overlap_percentage": 0}}
    
    # Summary
    print("\n" + "="*70)
    print("COMPARISON SUMMARY")
    print("="*70)
    print(f"{'Test':<30} {'UF Score':<12} {'Max Radius':<12} {'Overlaps':<12} {'Assigned':<12}")
    print("-"*70)
    print(f"{'A: Moderate (300)':<30} {resultA['uf_score']:<12} {resultA['max_radius']:.0f}px{'':<5} {resultA['overall'].get('overlap_percentage', 0):.0f}%{'':<6} {resultA['overall'].get('total_assigned', 0)}")
    print(f"{'B: Heavier (600)':<30} {resultB['uf_score']:<12} {resultB['max_radius']:.0f}px{'':<5} {resultB['overall'].get('overlap_percentage', 0):.0f}%{'':<6} {resultB['overall'].get('total_assigned', 0)}")
    if real_data:
        print(f"{'C: Real Data (1500+)':<30} {resultC['uf_score']:<12} {resultC['max_radius']:.0f}px{'':<5} {resultC['overall'].get('overlap_percentage', 0):.0f}%{'':<6} {resultC['overall'].get('total_assigned', 0)}")
