"""
Math utilities for tree layout and shape calculations.

Provides:
- Vector2D: 2D vector operations
- Angle utilities: normalization, interpolation
- Common math helpers: lerp, clamp, etc.
"""

from typing import Tuple, List
from dataclasses import dataclass
import math


@dataclass
class Vector2D:
    """Simple 2D vector for layout calculations."""
    
    x: float = 0.0
    y: float = 0.0
    
    def __add__(self, other: 'Vector2D') -> 'Vector2D':
        return Vector2D(self.x + other.x, self.y + other.y)
    
    def __sub__(self, other: 'Vector2D') -> 'Vector2D':
        return Vector2D(self.x - other.x, self.y - other.y)
    
    def __mul__(self, scalar: float) -> 'Vector2D':
        return Vector2D(self.x * scalar, self.y * scalar)
    
    def __truediv__(self, scalar: float) -> 'Vector2D':
        if scalar == 0:
            return Vector2D(0, 0)
        return Vector2D(self.x / scalar, self.y / scalar)
    
    def __neg__(self) -> 'Vector2D':
        return Vector2D(-self.x, -self.y)
    
    @property
    def magnitude(self) -> float:
        """Length of the vector."""
        return math.sqrt(self.x * self.x + self.y * self.y)
    
    @property
    def normalized(self) -> 'Vector2D':
        """Unit vector in same direction."""
        mag = self.magnitude
        if mag == 0:
            return Vector2D(0, 0)
        return self / mag
    
    @property
    def angle(self) -> float:
        """Angle in radians from positive X axis."""
        return math.atan2(self.y, self.x)
    
    def distance_to(self, other: 'Vector2D') -> float:
        """Distance to another vector."""
        return (self - other).magnitude
    
    def dot(self, other: 'Vector2D') -> float:
        """Dot product with another vector."""
        return self.x * other.x + self.y * other.y
    
    def rotate(self, angle_rad: float) -> 'Vector2D':
        """Rotate vector by angle in radians."""
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)
        return Vector2D(
            self.x * cos_a - self.y * sin_a,
            self.x * sin_a + self.y * cos_a
        )
    
    def to_tuple(self) -> Tuple[float, float]:
        """Convert to tuple."""
        return (self.x, self.y)
    
    @classmethod
    def from_angle(cls, angle_rad: float, magnitude: float = 1.0) -> 'Vector2D':
        """Create vector from angle and magnitude."""
        return cls(
            math.cos(angle_rad) * magnitude,
            math.sin(angle_rad) * magnitude
        )
    
    @classmethod
    def from_tuple(cls, t: Tuple[float, float]) -> 'Vector2D':
        """Create vector from tuple."""
        return cls(t[0], t[1])


def normalize_angle(angle_rad: float) -> float:
    """Normalize angle to [-pi, pi] range."""
    while angle_rad > math.pi:
        angle_rad -= 2 * math.pi
    while angle_rad < -math.pi:
        angle_rad += 2 * math.pi
    return angle_rad


def lerp(a: float, b: float, t: float) -> float:
    """Linear interpolation between a and b."""
    return a + (b - a) * t


def clamp(value: float, min_val: float, max_val: float) -> float:
    """Clamp value to [min_val, max_val] range."""
    return max(min_val, min(max_val, value))


def distribute_angles(count: int, start_angle: float = 0.0, 
                      spread: float = 2 * math.pi) -> List[float]:
    """
    Distribute angles evenly within a spread.
    
    Args:
        count: Number of angles to generate
        start_angle: Starting angle in radians
        spread: Total angular spread in radians (2*pi for full circle)
    
    Returns:
        List of angles in radians
    """
    if count <= 0:
        return []
    if count == 1:
        return [start_angle + spread / 2]
    
    step = spread / count
    return [start_angle + step * i + step / 2 for i in range(count)]


def points_on_circle(center: Vector2D, radius: float, 
                     count: int, start_angle: float = 0.0) -> List[Vector2D]:
    """
    Generate points evenly distributed on a circle.
    
    Args:
        center: Center of the circle
        radius: Radius of the circle
        count: Number of points
        start_angle: Starting angle in radians
    
    Returns:
        List of Vector2D points
    """
    angles = distribute_angles(count, start_angle, 2 * math.pi)
    return [center + Vector2D.from_angle(a, radius) for a in angles]


def points_on_arc(center: Vector2D, radius: float, count: int,
                  start_angle: float, end_angle: float) -> List[Vector2D]:
    """
    Generate points evenly distributed on an arc.
    
    Args:
        center: Center of the arc
        radius: Radius of the arc
        count: Number of points
        start_angle: Starting angle in radians
        end_angle: Ending angle in radians
    
    Returns:
        List of Vector2D points
    """
    spread = end_angle - start_angle
    angles = distribute_angles(count, start_angle, spread)
    return [center + Vector2D.from_angle(a, radius) for a in angles]
