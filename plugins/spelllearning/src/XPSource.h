#pragma once

#include "Common.h"
#include <algorithm>
#include <string>
#include <memory>
#include <vector>

namespace SpellLearning {

/**
 * IXPSource - Interface for pluggable XP gain sources
 * 
 * Implement this interface to add new ways for players to gain XP toward spells.
 * Examples: spell casting, tome reading, skill training, quest rewards, etc.
 */
class IXPSource {
public:
    virtual ~IXPSource() = default;
    
    /**
     * Get the unique name of this XP source
     * Used for logging, settings keys, and identification
     */
    virtual std::string GetName() const = 0;
    
    /**
     * Get a user-friendly display name for UI
     */
    virtual std::string GetDisplayName() const = 0;
    
    /**
     * Get a description of how this XP source works
     */
    virtual std::string GetDescription() const = 0;
    
    /**
     * Check if this XP source is currently enabled
     * Sources can be disabled via settings
     */
    virtual bool IsEnabled() const = 0;
    
    /**
     * Set the enabled state of this XP source
     */
    virtual void SetEnabled(bool enabled) = 0;
    
    /**
     * Check if this XP source is available (dependencies met, mods detected, etc.)
     */
    virtual bool IsAvailable() const = 0;
    
    /**
     * Initialize the XP source (register event handlers, detect mods, etc.)
     * Called once on game data load
     */
    virtual void Initialize() = 0;
    
    /**
     * Shutdown the XP source (unregister handlers, cleanup)
     * Called when mod is unloading
     */
    virtual void Shutdown() = 0;
    
    /**
     * Get the priority of this XP source (higher = checked first)
     * Used when multiple sources could handle the same event
     */
    virtual int GetPriority() const { return 0; }
};

/**
 * XPSourceRegistry - Singleton registry for XP sources
 * 
 * All XP sources register here and are managed centrally.
 */
class XPSourceRegistry {
public:
    static XPSourceRegistry& GetSingleton() {
        static XPSourceRegistry instance;
        return instance;
    }
    
    /**
     * Register an XP source
     * Takes ownership of the source
     */
    void Register(std::unique_ptr<IXPSource> source) {
        m_sources.push_back(std::move(source));
        // Sort by priority (descending)
        std::sort(m_sources.begin(), m_sources.end(), 
            [](const auto& a, const auto& b) {
                return a->GetPriority() > b->GetPriority();
            });
    }
    
    /**
     * Register an XP source via template (creates the source)
     */
    template<typename T, typename... Args>
    void Register(Args&&... args) {
        Register(std::make_unique<T>(std::forward<Args>(args)...));
    }
    
    /**
     * Get an XP source by name
     */
    IXPSource* Get(const std::string& name) {
        for (auto& source : m_sources) {
            if (source->GetName() == name) {
                return source.get();
            }
        }
        return nullptr;
    }
    
    /**
     * Get all registered XP sources
     */
    const std::vector<std::unique_ptr<IXPSource>>& GetAll() const {
        return m_sources;
    }
    
    /**
     * Get all enabled and available XP sources
     */
    std::vector<IXPSource*> GetActive() const {
        std::vector<IXPSource*> active;
        for (const auto& source : m_sources) {
            if (source->IsEnabled() && source->IsAvailable()) {
                active.push_back(source.get());
            }
        }
        return active;
    }
    
    /**
     * Initialize all registered sources
     */
    void InitializeAll() {
        for (auto& source : m_sources) {
            if (source->IsEnabled()) {
                logger::info("XPSourceRegistry: Initializing source '{}'", source->GetName());
                source->Initialize();
            }
        }
    }
    
    /**
     * Shutdown all registered sources
     */
    void ShutdownAll() {
        for (auto& source : m_sources) {
            source->Shutdown();
        }
    }
    
    /**
     * Clear all registered sources
     */
    void Clear() {
        ShutdownAll();
        m_sources.clear();
    }

private:
    XPSourceRegistry() = default;
    ~XPSourceRegistry() = default;
    XPSourceRegistry(const XPSourceRegistry&) = delete;
    XPSourceRegistry& operator=(const XPSourceRegistry&) = delete;
    
    std::vector<std::unique_ptr<IXPSource>> m_sources;
};

/**
 * BaseXPSource - Convenience base class for XP sources
 * 
 * Provides common implementation details, override as needed.
 */
class BaseXPSource : public IXPSource {
public:
    BaseXPSource(const std::string& name, const std::string& displayName, const std::string& description)
        : m_name(name), m_displayName(displayName), m_description(description), m_enabled(true) {}
    
    std::string GetName() const override { return m_name; }
    std::string GetDisplayName() const override { return m_displayName; }
    std::string GetDescription() const override { return m_description; }
    
    bool IsEnabled() const override { return m_enabled; }
    void SetEnabled(bool enabled) override { m_enabled = enabled; }
    
    bool IsAvailable() const override { return true; }  // Override if dependencies needed
    
    void Initialize() override {}  // Override to add initialization logic
    void Shutdown() override {}    // Override to add cleanup logic

protected:
    std::string m_name;
    std::string m_displayName;
    std::string m_description;
    bool m_enabled;
};

} // namespace SpellLearning
