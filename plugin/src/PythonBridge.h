#pragma once

#include "PCH.h"
#include <atomic>
#include <condition_variable>
#include <functional>
#include <queue>
#include <thread>

// Persistent Python subprocess manager.
// Spawns a single python.exe running server.py on first use, communicates via
// stdin/stdout JSON-line protocol. Eliminates per-call startup overhead (~1.5s)
// and keeps heavy imports (sklearn, etc.) loaded between calls.
class PythonBridge
{
public:
    static PythonBridge* GetSingleton();

    bool IsReady() const { return m_ready.load(); }
    bool IsRunning() const { return m_running.load(); }

    // Send a command asynchronously. Callback fires on SKSE main thread.
    // command: "build_tree", "prm_score", "ping", "shutdown"
    // payload: JSON string with command-specific data
    using Callback = std::function<void(bool success, const std::string& result)>;
    void SendCommand(const std::string& command, const std::string& payload, Callback callback);

    // Kill the Python process. Called on DLL unload.
    void Shutdown();

    // --- Path resolution helpers (moved from UIManager.cpp) ---

    static std::filesystem::path ResolvePhysicalPath(const std::filesystem::path& virtualPath);
    static std::vector<std::filesystem::path> GetMO2ModsFolders(const std::filesystem::path& cwd);
    static std::vector<std::filesystem::path> GetMO2OverwriteFolders(const std::filesystem::path& cwd);
    static void FixEmbeddedPythonPthFile(const std::filesystem::path& pythonExePath);

private:
    PythonBridge() = default;
    ~PythonBridge();

    PythonBridge(const PythonBridge&) = delete;
    PythonBridge& operator=(const PythonBridge&) = delete;

    // Lazy-spawn on first SendCommand
    bool EnsureProcess();
    bool SpawnProcess();
    void KillProcess();

    // Background threads
    void ReaderThread();

    // Find python.exe and server.py on disk (handles MO2/USVFS)
    struct PythonPaths {
        std::filesystem::path pythonExe;
        std::filesystem::path serverScript;
        std::filesystem::path scriptDir;
    };
    PythonPaths ResolvePythonPaths();

    // Generate a simple request ID
    std::string GenerateRequestId();

    // Process handles
    HANDLE m_hProcess = nullptr;
    HANDLE m_hStdinWrite = nullptr;
    HANDLE m_hStdoutRead = nullptr;
    DWORD m_processId = 0;

    // State
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_ready{false};
    std::atomic<bool> m_shutdownRequested{false};
    std::atomic<int> m_restartCount{0};
    std::atomic<uint64_t> m_nextRequestId{1};
    static constexpr int MAX_RESTARTS = 3;
    static constexpr int READY_TIMEOUT_MS = 15000;
    static constexpr int BUILD_TREE_TIMEOUT_MS = 120000;
    static constexpr int PRM_TIMEOUT_MS = 30000;

    // Threading
    std::thread m_readerThread;
    std::mutex m_mutex;
    std::condition_variable m_readyCv;

    // Inflight requests awaiting response
    struct PendingRequest {
        std::string id;
        Callback callback;
        std::chrono::steady_clock::time_point sentAt;
    };
    std::unordered_map<std::string, PendingRequest> m_inflightRequests;

    // Cached paths
    PythonPaths m_cachedPaths;
    bool m_pathsResolved = false;
};
