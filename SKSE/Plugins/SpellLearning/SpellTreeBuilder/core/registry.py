"""
Plugin Registry for auto-discovery of shapes and formations.

Provides decorators and registries for the plugin system:
- @register_shape("name") - Register a shape class
- @register_formation("name") - Register a formation class
- ShapeRegistry.get("name") - Get shape class by name
- FormationRegistry.get("name") - Get formation class by name
"""

from typing import Dict, Type, Optional, List, Any, Callable


class PluginRegistry:
    """
    Base registry for plugin auto-discovery.
    
    Subclass this for specific plugin types (shapes, formations).
    """
    
    _plugins: Dict[str, Type] = {}
    _plugin_type: str = "plugin"
    
    @classmethod
    def register(cls, name: str) -> Callable[[Type], Type]:
        """
        Decorator to register a plugin class.
        
        Usage:
            @MyRegistry.register("plugin_name")
            class MyPlugin:
                ...
        """
        def decorator(plugin_class: Type) -> Type:
            cls._plugins[name.lower()] = plugin_class
            # Store name on class for introspection
            plugin_class._registry_name = name.lower()
            return plugin_class
        return decorator
    
    @classmethod
    def get(cls, name: str) -> Optional[Type]:
        """Get a plugin class by name."""
        return cls._plugins.get(name.lower())
    
    @classmethod
    def get_all(cls) -> Dict[str, Type]:
        """Get all registered plugins."""
        return cls._plugins.copy()
    
    @classmethod
    def list_names(cls) -> List[str]:
        """Get list of all registered plugin names."""
        return list(cls._plugins.keys())
    
    @classmethod
    def has(cls, name: str) -> bool:
        """Check if a plugin is registered."""
        return name.lower() in cls._plugins
    
    @classmethod
    def create(cls, name: str, *args, **kwargs) -> Any:
        """
        Create an instance of a registered plugin.
        
        Args:
            name: Plugin name
            *args, **kwargs: Arguments passed to plugin constructor
        
        Returns:
            Plugin instance
        
        Raises:
            KeyError: If plugin not found
        """
        plugin_class = cls.get(name)
        if plugin_class is None:
            available = ', '.join(cls.list_names())
            raise KeyError(
                f"Unknown {cls._plugin_type} '{name}'. "
                f"Available: {available}"
            )
        return plugin_class(*args, **kwargs)


class ShapeRegistry(PluginRegistry):
    """Registry for tree shape plugins."""
    _plugins: Dict[str, Type] = {}
    _plugin_type: str = "shape"


class FormationRegistry(PluginRegistry):
    """Registry for formation plugins (unused)."""
    _plugins: Dict[str, Type] = {}
    _plugin_type: str = "formation"


# Convenience decorators
def register_shape(name: str) -> Callable[[Type], Type]:
    """
    Decorator to register a shape class.
    
    Usage:
        @register_shape("organic")
        class OrganicShape(ShapeProfile):
            ...
    """
    return ShapeRegistry.register(name)


def register_formation(name: str) -> Callable[[Type], Type]:
    """
    Decorator to register a formation class.
    
    Usage:
        @register_formation("circular")
        class CircularFormation(BaseFormation):
            ...
    """
    return FormationRegistry.register(name)
