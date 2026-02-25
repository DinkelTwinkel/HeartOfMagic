#pragma once

#include "Common.h"

#include <functional>
#include <string>

// =============================================================================
// THREAD UTILITIES - Safe dispatch to the main game thread
// =============================================================================

// Submits a named task to the SKSE main game thread with null-check and
// exception safety. All code that needs to call RE:: APIs or interact with
// game state from a callback or background thread should use this instead
// of calling SKSE::GetTaskInterface()->AddTask() directly.
//
// - taskName: Human-readable label for debug/error logs
// - task: The work to execute on the game thread
//
// If the TaskInterface is unavailable (SKSE init failure), the task is
// dropped and an error is logged. Any unhandled exception inside the task
// is caught and logged rather than crashing Skyrim.
inline void AddTaskToGameThread(std::string taskName, std::function<void()>&& task)
{
    const SKSE::TaskInterface* taskInterface = SKSE::GetTaskInterface();
    if (taskInterface) {
        logger::debug("AddTaskToGameThread: Submitting task '{}' to main game thread", taskName);
        auto safeTask = [taskName = std::move(taskName), task = std::move(task)]() {
            try {
                task();
            } catch (const std::exception& e) {
                logger::error("AddTaskToGameThread: Exception in task '{}': {}", taskName, e.what());
            } catch (...) {
                logger::error("AddTaskToGameThread: Unknown exception in task '{}'", taskName);
            }
        };
        taskInterface->AddTask(std::move(safeTask));
    } else {
        logger::error("AddTaskToGameThread: TaskInterface is nullptr — dropping task '{}'", taskName);
    }
}
