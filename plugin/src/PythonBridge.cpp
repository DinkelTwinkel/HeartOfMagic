#include "PythonBridge.h"
#include "WineDetect.h"

PythonBridge* PythonBridge::GetSingleton()
{
    static PythonBridge singleton;
    return &singleton;
}

PythonBridge::~PythonBridge()
{
    Shutdown();
}

// =============================================================================
// PATH RESOLUTION HELPERS (moved from UIManager.cpp)
// =============================================================================

std::filesystem::path PythonBridge::ResolvePhysicalPath(const std::filesystem::path& virtualPath)
{
    HANDLE hFile = CreateFileW(
        virtualPath.c_str(),
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
        nullptr
    );

    if (hFile == INVALID_HANDLE_VALUE) {
        return virtualPath;
    }

    wchar_t buffer[MAX_PATH * 2];
    DWORD len = GetFinalPathNameByHandleW(hFile, buffer, MAX_PATH * 2, FILE_NAME_NORMALIZED);
    CloseHandle(hFile);

    if (len == 0 || len >= MAX_PATH * 2) {
        return virtualPath;
    }

    std::wstring result(buffer, len);
    if (result.size() >= 4 && result.substr(0, 4) == L"\\\\?\\") {
        result = result.substr(4);
    }

    std::filesystem::path resolved(result);
    if (resolved != virtualPath) {
        logger::info("PythonBridge: ResolvePhysicalPath: '{}' -> '{}'", virtualPath.string(), resolved.string());
    }
    return resolved;
}

std::vector<std::filesystem::path> PythonBridge::GetMO2ModsFolders(const std::filesystem::path& cwd)
{
    std::vector<std::filesystem::path> folders;
    auto parent = cwd.parent_path();

    folders.push_back(parent / "mods");
    folders.push_back(parent / "MODS" / "mods");
    folders.push_back(parent / "downloads" / "mods");

    auto grandparent = parent.parent_path();
    folders.push_back(grandparent / "mods");
    folders.push_back(grandparent / "MODS" / "mods");

    return folders;
}

std::vector<std::filesystem::path> PythonBridge::GetMO2OverwriteFolders(const std::filesystem::path& cwd)
{
    std::vector<std::filesystem::path> folders;
    auto parent = cwd.parent_path();

    folders.push_back(parent / "overwrite");
    folders.push_back(parent / "MODS" / "overwrite");
    folders.push_back(parent / "mods" / "overwrite");

    return folders;
}

void PythonBridge::FixEmbeddedPythonPthFile(const std::filesystem::path& pythonExePath)
{
    auto pythonDir = pythonExePath.parent_path();

    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator(pythonDir, ec)) {
        if (!entry.is_regular_file()) continue;
        if (entry.path().extension().string() != "._pth") continue;

        std::vector<std::string> lines;
        bool needsFix = false;
        {
            std::ifstream in(entry.path());
            if (!in.is_open()) continue;
            std::string line;
            while (std::getline(in, line)) {
                if (!line.empty() && line.back() == '\r') line.pop_back();
                lines.push_back(line);
                if (!line.empty() && line[0] != '#' && line.find("import ") != 0) {
                    if (line.size() < 2 || line[1] != ':') {
                        needsFix = true;
                    }
                }
            }
        }

        if (!needsFix) {
            logger::info("PythonBridge: ._pth file already has absolute paths: {}", entry.path().string());
            return;
        }

        logger::info("PythonBridge: Fixing ._pth file: {}", entry.path().string());
        std::ofstream out(entry.path());
        if (!out.is_open()) return;
        for (const auto& line : lines) {
            if (line.empty() || line[0] == '#' || line.find("import ") == 0) {
                out << line << "\n";
            } else if (line.size() >= 2 && line[1] == ':') {
                out << line << "\n";
            } else {
                auto absPath = (pythonDir / line).string();
                out << absPath << "\n";
                logger::info("PythonBridge: ._pth rewrite: '{}' -> '{}'", line, absPath);
            }
        }
        return;
    }
}

// =============================================================================
// PYTHON PATH DISCOVERY
// =============================================================================

PythonBridge::PythonPaths PythonBridge::ResolvePythonPaths()
{
    if (m_pathsResolved) {
        return m_cachedPaths;
    }

    auto cwd = std::filesystem::current_path();
    logger::info("PythonBridge: Resolving Python paths (cwd: {})", cwd.string());

    std::vector<std::filesystem::path> pythonPaths;
    std::vector<std::filesystem::path> scriptDirs;

    // 1. MO2 Overwrite folders
    for (const auto& owFolder : GetMO2OverwriteFolders(cwd)) {
        auto stb = owFolder / "SKSE" / "Plugins" / "SpellLearning" / "SpellTreeBuilder";
        pythonPaths.push_back(stb / "python" / "python.exe");
        pythonPaths.push_back(stb / ".venv" / "Scripts" / "python.exe");
        pythonPaths.push_back(stb / ".venv" / "bin" / "python");       // Linux venv
        pythonPaths.push_back(stb / ".venv" / "bin" / "python3");      // Linux venv
        scriptDirs.push_back(stb);
    }

    // 2. MO2 mods folders
    for (const auto& modsFolder : GetMO2ModsFolders(cwd)) {
        std::error_code ec;
        if (!std::filesystem::exists(modsFolder, ec) || !std::filesystem::is_directory(modsFolder, ec)) continue;
        for (const auto& entry : std::filesystem::directory_iterator(modsFolder, ec)) {
            if (!entry.is_directory()) continue;
            auto stb = entry.path() / "SKSE" / "Plugins" / "SpellLearning" / "SpellTreeBuilder";
            if (std::filesystem::exists(stb / "python" / "python.exe", ec)) {
                pythonPaths.push_back(stb / "python" / "python.exe");
            }
            if (std::filesystem::exists(stb / ".venv" / "Scripts" / "python.exe", ec)) {
                pythonPaths.push_back(stb / ".venv" / "Scripts" / "python.exe");
            }
            if (std::filesystem::exists(stb / ".venv" / "bin" / "python", ec)) {
                pythonPaths.push_back(stb / ".venv" / "bin" / "python");   // Linux venv
            }
            if (std::filesystem::exists(stb / ".venv" / "bin" / "python3", ec)) {
                pythonPaths.push_back(stb / ".venv" / "bin" / "python3");  // Linux venv
            }
            if (std::filesystem::exists(stb / "build_tree.py", ec)) {
                scriptDirs.push_back(stb);
                logger::info("PythonBridge: Found SpellTreeBuilder in mod: {}", entry.path().filename().string());
            }
        }
    }

    // 3. Vortex / Manual install
    auto realData = cwd / "Data" / "SKSE" / "Plugins" / "SpellLearning" / "SpellTreeBuilder";
    pythonPaths.push_back(realData / "python" / "python.exe");
    pythonPaths.push_back(realData / ".venv" / "Scripts" / "python.exe");
    pythonPaths.push_back(realData / ".venv" / "bin" / "python");      // Linux venv
    pythonPaths.push_back(realData / ".venv" / "bin" / "python3");     // Linux venv
    scriptDirs.push_back(realData);

    // 4. CWD relative
    auto cwdRel = cwd / "SKSE" / "Plugins" / "SpellLearning" / "SpellTreeBuilder";
    pythonPaths.push_back(cwdRel / "python" / "python.exe");
    pythonPaths.push_back(cwdRel / ".venv" / "bin" / "python");        // Linux venv
    scriptDirs.push_back(cwdRel);

    PythonPaths result;

    bool isWine = IsRunningUnderWine();
    if (isWine) {
        logger::info("PythonBridge: Wine/Proton detected — only Windows python.exe is usable with CreateProcess");
    }

    // Find python executable
    for (const auto& path : pythonPaths) {
        std::error_code ec;
        if (!std::filesystem::exists(path, ec)) continue;

        // On Wine, CreateProcess can only run PE (.exe) files.
        // Skip Linux-native Python (e.g. .venv/bin/python -> /usr/bin/python3.9)
        // because it's an ELF binary that CreateProcess can't execute.
        if (isWine) {
            auto ext = path.extension().string();
            if (ext != ".exe" && ext != ".EXE") {
                logger::info("PythonBridge: Skipping non-.exe Python on Wine: {}", path.string());
                continue;
            }
        }

        result.pythonExe = ResolvePhysicalPath(path);
        logger::info("PythonBridge: Found Python at: {}", result.pythonExe.string());
        break;
    }

    // Wine fallback: if no .exe found, log the Linux Python for diagnostics
    if (isWine && result.pythonExe.empty()) {
        for (const auto& path : pythonPaths) {
            std::error_code ec;
            if (std::filesystem::exists(path, ec)) {
                logger::warn("PythonBridge: Linux Python found at {} but cannot be used by CreateProcess. "
                    "Use Auto-Setup to install Windows Python, or manually extract the Windows embedded Python ZIP "
                    "to SpellTreeBuilder/python/", path.string());
                break;
            }
        }
    }

    // Sort script dirs: prefer _RELEASE folders (deploy target) over old copies
    std::stable_sort(scriptDirs.begin(), scriptDirs.end(),
        [](const std::filesystem::path& a, const std::filesystem::path& b) {
            // Walk up from SpellTreeBuilder -> SpellLearning -> Plugins -> SKSE -> mod root
            auto modNameA = a.parent_path().parent_path().parent_path().parent_path().filename().string();
            auto modNameB = b.parent_path().parent_path().parent_path().parent_path().filename().string();
            bool aRelease = modNameA.find("_RELEASE") != std::string::npos;
            bool bRelease = modNameB.find("_RELEASE") != std::string::npos;
            if (aRelease != bRelease) return aRelease;  // _RELEASE first
            return false;  // preserve order otherwise
        });

    // Find script directory — prefer directories with server.py (persistent mode)
    // over those with only build_tree.py (old versions without server.py)
    std::filesystem::path fallbackDir;
    for (const auto& dir : scriptDirs) {
        std::error_code ec;
        if (std::filesystem::exists(dir / "server.py", ec)) {
            result.scriptDir = ResolvePhysicalPath(dir);
            // Resolve server.py independently — under MO2 USVFS, the directory
            // may resolve to Overwrite/ while server.py is in the mod folder.
            result.serverScript = ResolvePhysicalPath(dir / "server.py");
            logger::info("PythonBridge: Found script dir (server.py) at: {}", result.scriptDir.string());
            logger::info("PythonBridge: Resolved server.py at: {}", result.serverScript.string());
            break;
        } else if (fallbackDir.empty() && std::filesystem::exists(dir / "build_tree.py", ec)) {
            fallbackDir = dir;
        }
    }
    if (result.scriptDir.empty() && !fallbackDir.empty()) {
        result.scriptDir = ResolvePhysicalPath(fallbackDir);
        result.serverScript = ResolvePhysicalPath(fallbackDir / "server.py");
        logger::warn("PythonBridge: No server.py found, using build_tree.py dir: {}", result.scriptDir.string());
    }

    if (result.pythonExe.empty()) {
        logger::warn("PythonBridge: Could not find Python executable");
    }
    if (result.scriptDir.empty()) {
        logger::warn("PythonBridge: Could not find SpellTreeBuilder script directory");
    }

    m_cachedPaths = result;
    m_pathsResolved = true;
    return result;
}

// =============================================================================
// REQUEST ID GENERATION
// =============================================================================

std::string PythonBridge::GenerateRequestId()
{
    auto id = m_nextRequestId.fetch_add(1);
    return "req_" + std::to_string(id);
}

// =============================================================================
// PROCESS LIFECYCLE
// =============================================================================

bool PythonBridge::EnsureProcess()
{
    if (m_running.load() && m_ready.load()) {
        return true;
    }

    if (m_running.load() && !m_ready.load()) {
        // Process is starting, wait for ready
        std::unique_lock<std::mutex> lock(m_mutex);
        m_readyCv.wait_for(lock, std::chrono::milliseconds(READY_TIMEOUT_MS), [this] {
            return m_ready.load() || !m_running.load();
        });
        return m_ready.load();
    }

    return SpawnProcess();
}

bool PythonBridge::SpawnProcess()
{
    auto paths = ResolvePythonPaths();
    if (paths.pythonExe.empty() || paths.scriptDir.empty()) {
        logger::error("PythonBridge: Cannot spawn — Python or scripts not found");
        return false;
    }

    // Fix ._pth file before spawning
    FixEmbeddedPythonPthFile(paths.pythonExe);

    // Create pipes for stdin/stdout
    SECURITY_ATTRIBUTES sa = {};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE hStdinRead = nullptr;
    HANDLE hStdoutWrite = nullptr;

    if (!CreatePipe(&hStdinRead, &m_hStdinWrite, &sa, 0)) {
        logger::error("PythonBridge: Failed to create stdin pipe ({})", GetLastError());
        return false;
    }
    if (!CreatePipe(&m_hStdoutRead, &hStdoutWrite, &sa, 0)) {
        logger::error("PythonBridge: Failed to create stdout pipe ({})", GetLastError());
        CloseHandle(hStdinRead);
        CloseHandle(m_hStdinWrite);
        m_hStdinWrite = nullptr;
        return false;
    }

    // Don't inherit our end of the pipes
    SetHandleInformation(m_hStdinWrite, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(m_hStdoutRead, HANDLE_FLAG_INHERIT, 0);

    // Build environment block
    // On Wine, don't set PYTHONHOME — it breaks Linux Python and embedded Python
    // relies on its ._pth file for path resolution, not PYTHONHOME.
    bool isWine = IsRunningUnderWine();
    auto pythonHome = paths.pythonExe.parent_path().wstring();

    std::wstring envBlock;
    wchar_t* currentEnv = GetEnvironmentStringsW();
    if (currentEnv) {
        for (wchar_t* p = currentEnv; *p; p += wcslen(p) + 1) {
            // Skip existing Python env vars to avoid conflicts
            if (_wcsnicmp(p, L"PYTHONHOME=", 11) == 0) continue;
            if (_wcsnicmp(p, L"PYTHONPATH=", 11) == 0) continue;
            if (_wcsnicmp(p, L"PYTHONIOENCODING=", 17) == 0) continue;
            if (_wcsnicmp(p, L"PYTHONUNBUFFERED=", 17) == 0) continue;
            if (_wcsnicmp(p, L"PYTHONDONTWRITEBYTECODE=", 24) == 0) continue;
            envBlock += p;
            envBlock += L'\0';
        }
        FreeEnvironmentStringsW(currentEnv);
    }
    if (!isWine) {
        envBlock += L"PYTHONHOME=" + pythonHome + L'\0';
    }
    // Force UTF-8 encoding for piped stdout/stderr — prevents silent crashes
    // on Wine where locale/encoding detection fails with redirected stdio
    envBlock += L"PYTHONIOENCODING=utf-8\0";
    envBlock += L"PYTHONUNBUFFERED=1\0";
    envBlock += L"PYTHONDONTWRITEBYTECODE=1\0";
    envBlock += L'\0';  // Double null terminator

    // Build command line — use -u for unbuffered binary stdout/stderr
    std::wstring cmdLine = L"\"" + paths.pythonExe.wstring() + L"\" -u \"" + paths.serverScript.wstring() + L"\"";

    STARTUPINFOW si = {};
    si.cb = sizeof(si);
    si.hStdInput = hStdinRead;
    si.hStdOutput = hStdoutWrite;
    si.hStdError = hStdoutWrite;  // Merge stderr into stdout
    si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi = {};

    logger::info("PythonBridge: Spawning: {}", std::filesystem::path(cmdLine).string());

    // On Wine, CREATE_NO_WINDOW can interfere with console subsystem init
    // and break pipe inheritance. Use only CREATE_UNICODE_ENVIRONMENT.
    DWORD createFlags = CREATE_UNICODE_ENVIRONMENT;
    if (!isWine) {
        createFlags |= CREATE_NO_WINDOW;
    }

    BOOL ok = CreateProcessW(
        nullptr,
        cmdLine.data(),
        nullptr,
        nullptr,
        TRUE,  // Inherit handles (for pipes)
        createFlags,
        envBlock.data(),
        paths.scriptDir.wstring().c_str(),
        &si,
        &pi
    );

    // Close child's ends of pipes
    CloseHandle(hStdinRead);
    CloseHandle(hStdoutWrite);

    if (!ok) {
        DWORD err = GetLastError();
        logger::error("PythonBridge: CreateProcess failed ({})", err);
        if (isWine) {
            logger::error("PythonBridge: Wine/Proton detected — CreateProcess cannot run Linux-native Python. "
                "The tree builder requires a Windows python.exe. Use the Auto-Setup button in the mod panel, "
                "or manually download 'python-3.12.8-embed-amd64.zip' from python.org and extract it to "
                "SpellTreeBuilder/python/ inside your mod folder.");
        }
        CloseHandle(m_hStdinWrite);
        CloseHandle(m_hStdoutRead);
        m_hStdinWrite = nullptr;
        m_hStdoutRead = nullptr;
        return false;
    }

    m_hProcess = pi.hProcess;
    m_processId = pi.dwProcessId;
    CloseHandle(pi.hThread);
    m_running = true;
    m_ready = false;

    logger::info("PythonBridge: Process spawned (pid {})", m_processId);

    // Start reader thread
    m_readerThread = std::thread(&PythonBridge::ReaderThread, this);

    // Wait for ready signal
    {
        std::unique_lock<std::mutex> lock(m_mutex);
        bool gotReady = m_readyCv.wait_for(lock, std::chrono::milliseconds(READY_TIMEOUT_MS), [this] {
            return m_ready.load() || !m_running.load();
        });
        if (!gotReady || !m_ready.load()) {
            logger::error("PythonBridge: Python process did not become ready within {}ms", READY_TIMEOUT_MS);
            lock.unlock();  // Must release before KillProcess (it locks m_mutex internally)
            KillProcess();
            return false;
        }
    }

    logger::info("PythonBridge: Process ready");
    return true;
}

void PythonBridge::KillProcess()
{
    m_running = false;
    m_ready = false;

    if (m_hStdinWrite) {
        CloseHandle(m_hStdinWrite);
        m_hStdinWrite = nullptr;
    }

    if (m_hProcess) {
        TerminateProcess(m_hProcess, 1);
        WaitForSingleObject(m_hProcess, 2000);
        CloseHandle(m_hProcess);
        m_hProcess = nullptr;
    }

    if (m_hStdoutRead) {
        CloseHandle(m_hStdoutRead);
        m_hStdoutRead = nullptr;
    }

    if (m_readerThread.joinable()) {
        m_readerThread.join();
    }

    // Fail all inflight requests
    std::vector<Callback> failedCallbacks;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        for (auto& [id, req] : m_inflightRequests) {
            failedCallbacks.push_back(req.callback);
        }
        m_inflightRequests.clear();
    }
    // Fire callbacks outside the lock to avoid re-entrancy issues
    for (auto& cb : failedCallbacks) {
        auto* ti = SKSE::GetTaskInterface();
        if (ti) {
            ti->AddTask([cb]() { cb(false, "Python process terminated"); });
        }
    }
}

// =============================================================================
// READER THREAD
// =============================================================================

void PythonBridge::ReaderThread()
{
    std::string lineBuffer;
    char buf[8192];
    DWORD bytesRead;

    while (m_running.load()) {
        BOOL ok = ReadFile(m_hStdoutRead, buf, sizeof(buf) - 1, &bytesRead, nullptr);
        if (!ok || bytesRead == 0) break;

        buf[bytesRead] = '\0';
        lineBuffer += buf;

        // Process complete lines
        size_t pos;
        while ((pos = lineBuffer.find('\n')) != std::string::npos) {
            std::string line = lineBuffer.substr(0, pos);
            lineBuffer.erase(0, pos + 1);

            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty()) continue;

            // Try to parse as JSON protocol message
            try {
                auto j = nlohmann::json::parse(line);

                if (!j.contains("id")) {
                    // Not a protocol message — probably debug output
                    logger::info("PythonBridge [python]: {}", line.substr(0, 200));
                    continue;
                }

                std::string id = j["id"].get<std::string>();

                // Ready signal
                if (id == "__ready__") {
                    logger::info("PythonBridge: Received ready signal from Python");
                    m_ready = true;
                    m_readyCv.notify_all();
                    continue;
                }

                // Match to pending request
                Callback callback;
                {
                    std::lock_guard<std::mutex> lock(m_mutex);
                    auto it = m_inflightRequests.find(id);
                    if (it == m_inflightRequests.end()) {
                        logger::warn("PythonBridge: Response for unknown request id: {}", id);
                        continue;
                    }
                    callback = it->second.callback;
                    m_inflightRequests.erase(it);
                }

                bool success = j.value("success", false);
                std::string result;
                if (j.contains("result")) {
                    result = j["result"].dump();
                } else if (j.contains("error")) {
                    result = j["error"].get<std::string>();
                }

                // Marshal to SKSE main thread
                auto* taskInterface = SKSE::GetTaskInterface();
                if (taskInterface) {
                    taskInterface->AddTask([callback, success, result]() {
                        callback(success, result);
                    });
                } else {
                    callback(success, result);
                }

            } catch (const nlohmann::json::exception&) {
                // Not JSON — treat as debug/log output from Python
                logger::info("PythonBridge [python]: {}", line.substr(0, 200));
            }
        }
    }

    // Process any remaining data in the buffer (partial lines from crash output)
    if (!lineBuffer.empty()) {
        logger::info("PythonBridge [python-final]: {}", lineBuffer.substr(0, 500));
    }

    // Log exit code for diagnostics
    if (m_hProcess) {
        DWORD exitCode = 0;
        if (GetExitCodeProcess(m_hProcess, &exitCode)) {
            logger::info("PythonBridge: Process exit code: {} (0x{:X})", exitCode, exitCode);
        }
    }

    // Process exited
    if (m_running.load() && !m_shutdownRequested.load()) {
        logger::warn("PythonBridge: Python process exited unexpectedly");
        m_running = false;
        m_ready = false;
        m_readyCv.notify_all();  // Wake up SpawnProcess if waiting for ready

        // Fail inflight requests
        std::vector<Callback> failedCallbacks;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            for (auto& [id, req] : m_inflightRequests) {
                failedCallbacks.push_back(req.callback);
            }
            m_inflightRequests.clear();
        }
        for (auto& cb : failedCallbacks) {
            auto* ti = SKSE::GetTaskInterface();
            if (ti) {
                ti->AddTask([cb]() { cb(false, "Python process exited unexpectedly"); });
            }
        }
    }
}

// =============================================================================
// SEND COMMAND
// =============================================================================

void PythonBridge::SendCommand(const std::string& command, const std::string& payload, Callback callback)
{
    // Ensure process is running (lazy init)
    if (!EnsureProcess()) {
        // Auto-restart if under limit
        if (m_restartCount.load() < MAX_RESTARTS) {
            m_restartCount++;
            logger::info("PythonBridge: Attempting restart ({}/{})", m_restartCount.load(), MAX_RESTARTS);
            m_pathsResolved = false;  // Re-resolve in case paths changed
            if (!SpawnProcess()) {
                callback(false, "Failed to start Python process");
                return;
            }
        } else {
            callback(false, "Python process not available (max restarts exceeded)");
            return;
        }
    }

    auto id = GenerateRequestId();

    // Build JSON-line command
    nlohmann::json msg;
    msg["id"] = id;
    msg["command"] = command;
    msg["data"] = nlohmann::json::parse(payload);
    std::string line = msg.dump() + "\n";

    // Register pending request
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_inflightRequests[id] = {id, callback, std::chrono::steady_clock::now()};
    }

    // Write to stdin pipe
    DWORD written;
    BOOL ok = WriteFile(m_hStdinWrite, line.c_str(), static_cast<DWORD>(line.size()), &written, nullptr);
    if (!ok) {
        logger::error("PythonBridge: Failed to write to stdin pipe ({})", GetLastError());
        std::lock_guard<std::mutex> lock(m_mutex);
        m_inflightRequests.erase(id);
        callback(false, "Failed to send command to Python");
    } else {
        logger::info("PythonBridge: Sent {} command (id: {}, {} bytes)", command, id, line.size());
    }
}

// =============================================================================
// SHUTDOWN
// =============================================================================

void PythonBridge::Shutdown()
{
    if (!m_running.load()) return;

    logger::info("PythonBridge: Shutting down Python process (pid {})", m_processId);
    m_shutdownRequested = true;

    // Send shutdown command
    if (m_hStdinWrite) {
        std::string cmd = "{\"id\":\"__shutdown__\",\"command\":\"shutdown\"}\n";
        DWORD written;
        WriteFile(m_hStdinWrite, cmd.c_str(), static_cast<DWORD>(cmd.size()), &written, nullptr);
    }

    // Wait briefly for graceful exit
    if (m_hProcess) {
        DWORD waitResult = WaitForSingleObject(m_hProcess, 3000);
        if (waitResult == WAIT_TIMEOUT) {
            logger::warn("PythonBridge: Graceful shutdown timed out, terminating");
            TerminateProcess(m_hProcess, 1);
        }
    }

    KillProcess();
    logger::info("PythonBridge: Shutdown complete");
}
