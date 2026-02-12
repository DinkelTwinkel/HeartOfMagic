#include "PythonBridge.h"
#include "WineDetect.h"

#pragma comment(lib, "ws2_32.lib")

static bool s_wsaInitialized = false;
static void EnsureWSAStartup() {
    if (!s_wsaInitialized) {
        WSADATA wsaData;
        WSAStartup(MAKEWORD(2, 2), &wsaData);
        s_wsaInitialized = true;
    }
}

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

    bool isWine = IsRunningUnderWine();

    // On Wine, use python.exe wrapped in cmd.exe /c — cmd.exe initializes the console
    // environment properly, which avoids Wine's broken CreateProcess handle inheritance.
    // This mirrors how std::system() launches processes (and std::system works on Wine).
    std::filesystem::path pythonExe = paths.pythonExe;

    auto pythonHome = pythonExe.parent_path().wstring();

    // Build environment block
    std::wstring envBlock;
    wchar_t* currentEnv = GetEnvironmentStringsW();
    if (currentEnv) {
        for (wchar_t* p = currentEnv; *p; p += wcslen(p) + 1) {
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
    envBlock += L"PYTHONIOENCODING=utf-8";
    envBlock += L'\0';
    envBlock += L"PYTHONUNBUFFERED=1";
    envBlock += L'\0';
    envBlock += L"PYTHONDONTWRITEBYTECODE=1";
    envBlock += L'\0';
    if (isWine) {
        // Prevent numpy/OpenBLAS crashes on Wine — these C extensions use SIMD
        // and threading features that Wine's ucrtbase.dll may not fully support.
        envBlock += L"OPENBLAS_NUM_THREADS=1";
        envBlock += L'\0';
        envBlock += L"OPENBLAS_CORETYPE=Haswell";
        envBlock += L'\0';
        envBlock += L"NPY_DISABLE_CPU_FEATURES=AVX512F,AVX512CD,AVX512_SKX,AVX512_CLX,AVX512_CNL,AVX512_ICL";
        envBlock += L'\0';
    }
    envBlock += L'\0';  // Double null terminator

    // =========================================================================
    // Wine/Proton: Use TCP socket for IPC (pipe inheritance is broken in Wine)
    // Windows: Use anonymous pipes (standard, fast)
    // =========================================================================

    HANDLE hStdinRead = nullptr;
    HANDLE hStdoutWrite = nullptr;
    int tcpPort = 0;
    SOCKET listenSock = INVALID_SOCKET;

    if (isWine) {
        // TCP socket approach — bypasses broken pipe inheritance in Wine/Proton
        EnsureWSAStartup();

        listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (listenSock == INVALID_SOCKET) {
            logger::error("PythonBridge: Failed to create TCP listen socket ({})", WSAGetLastError());
            return false;
        }

        sockaddr_in addr = {};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;  // OS picks a free port

        if (bind(listenSock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR ||
            listen(listenSock, 1) == SOCKET_ERROR) {
            logger::error("PythonBridge: Failed to bind/listen TCP socket ({})", WSAGetLastError());
            closesocket(listenSock);
            return false;
        }

        sockaddr_in boundAddr = {};
        int addrLen = sizeof(boundAddr);
        getsockname(listenSock, reinterpret_cast<sockaddr*>(&boundAddr), &addrLen);
        tcpPort = ntohs(boundAddr.sin_port);

        logger::info("PythonBridge: Wine detected — using cmd.exe /c wrapper + TCP socket on port {}", tcpPort);
    } else {
        // Standard pipe approach for native Windows
        SECURITY_ATTRIBUTES sa = {};
        sa.nLength = sizeof(sa);
        sa.bInheritHandle = TRUE;

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

        SetHandleInformation(m_hStdinWrite, HANDLE_FLAG_INHERIT, 0);
        SetHandleInformation(m_hStdoutRead, HANDLE_FLAG_INHERIT, 0);
    }

    // Build command line
    std::wstring cmdLine;
    if (isWine) {
        // Wrap in cmd.exe /c — Wine handles cmd.exe process creation properly
        // (std::system uses this internally and works on Wine). cmd.exe initializes
        // the console environment, giving Python valid stdio file descriptors.
        // The outer quotes are stripped by cmd.exe's /c parser, inner quotes preserved.
        cmdLine = L"cmd.exe /c \"\"" + pythonExe.wstring() + L"\" -u \""
                + paths.serverScript.wstring() + L"\" --port "
                + std::to_wstring(tcpPort) + L" --wine\"";
    } else {
        cmdLine = L"\"" + pythonExe.wstring() + L"\" -u \""
                + paths.serverScript.wstring() + L"\"";
    }

    STARTUPINFOW si = {};
    si.cb = sizeof(si);
    if (isWine) {
        // Don't set STARTF_USESTDHANDLES — cmd.exe manages its own console/stdio.
        // This matches how std::system() launches processes.
        si.dwFlags = 0;
    } else {
        si.hStdInput = hStdinRead;
        si.hStdOutput = hStdoutWrite;
        si.hStdError = hStdoutWrite;
        si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE;
    }

    PROCESS_INFORMATION pi = {};

    logger::info("PythonBridge: Spawning: {}", std::filesystem::path(cmdLine).string());

    DWORD createFlags = CREATE_UNICODE_ENVIRONMENT;
    if (!isWine) {
        createFlags |= CREATE_NO_WINDOW;
    }
    // Wine: no CREATE_NO_WINDOW / DETACHED_PROCESS — cmd.exe needs a console to
    // properly initialize stdio for the child Python process. The console won't be
    // visible in Proton's virtual desktop.

    BOOL ok = CreateProcessW(
        nullptr,
        cmdLine.data(),
        nullptr,
        nullptr,
        isWine ? FALSE : TRUE,  // Wine: cmd.exe manages its own handles; Windows: inherit pipe handles
        createFlags,
        envBlock.data(),
        paths.scriptDir.wstring().c_str(),
        &si,
        &pi
    );

    // Close inherited handles (child has its own copies now)
    if (hStdinRead) CloseHandle(hStdinRead);
    if (hStdoutWrite) CloseHandle(hStdoutWrite);

    if (!ok) {
        DWORD err = GetLastError();
        logger::error("PythonBridge: CreateProcess failed ({})", err);
        if (isWine) {
            logger::error("PythonBridge: Wine/Proton detected — ensure Windows python.exe is installed. "
                "Use the Auto-Setup button or manually extract the Python embed ZIP (3.11.9 for Wine).");
            closesocket(listenSock);
        } else {
            CloseHandle(m_hStdinWrite);
            CloseHandle(m_hStdoutRead);
            m_hStdinWrite = nullptr;
            m_hStdoutRead = nullptr;
        }
        return false;
    }

    // On Wine, accept the incoming TCP connection from Python
    if (isWine) {
        logger::info("PythonBridge: Waiting for Python to connect on port {}...", tcpPort);

        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(listenSock, &readSet);
        timeval timeout = {15, 0};  // 15 second timeout

        int selResult = select(0, &readSet, nullptr, nullptr, &timeout);
        if (selResult <= 0) {
            logger::error("PythonBridge: Python did not connect to TCP socket within 15s");
            closesocket(listenSock);
            TerminateProcess(pi.hProcess, 1);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            return false;
        }

        m_socket = accept(listenSock, nullptr, nullptr);
        closesocket(listenSock);

        if (m_socket == INVALID_SOCKET) {
            logger::error("PythonBridge: Failed to accept TCP connection ({})", WSAGetLastError());
            TerminateProcess(pi.hProcess, 1);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            return false;
        }

        m_useSocket = true;
        logger::info("PythonBridge: TCP connection established with Python");
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

    // Close socket if using TCP mode
    if (m_useSocket && m_socket != INVALID_SOCKET) {
        shutdown(m_socket, SD_BOTH);
        closesocket(m_socket);
        m_socket = INVALID_SOCKET;
        m_useSocket = false;
    }

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
        int received = 0;
        if (m_useSocket) {
            // TCP socket mode (Wine/Proton)
            received = recv(m_socket, buf, sizeof(buf) - 1, 0);
            if (received <= 0) break;
        } else {
            // Pipe mode (native Windows)
            BOOL ok = ReadFile(m_hStdoutRead, buf, sizeof(buf) - 1, &bytesRead, nullptr);
            if (!ok || bytesRead == 0) break;
            received = static_cast<int>(bytesRead);
        }

        buf[received] = '\0';
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

    // Write to Python (socket or pipe)
    bool writeOk = false;
    if (m_useSocket) {
        int sent = send(m_socket, line.c_str(), static_cast<int>(line.size()), 0);
        writeOk = (sent > 0);
        if (!writeOk) {
            logger::error("PythonBridge: Failed to send via TCP socket ({})", WSAGetLastError());
        }
    } else {
        DWORD written;
        writeOk = WriteFile(m_hStdinWrite, line.c_str(), static_cast<DWORD>(line.size()), &written, nullptr);
        if (!writeOk) {
            logger::error("PythonBridge: Failed to write to stdin pipe ({})", GetLastError());
        }
    }

    if (!writeOk) {
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
    std::string cmd = "{\"id\":\"__shutdown__\",\"command\":\"shutdown\"}\n";
    if (m_useSocket && m_socket != INVALID_SOCKET) {
        send(m_socket, cmd.c_str(), static_cast<int>(cmd.size()), 0);
    } else if (m_hStdinWrite) {
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
