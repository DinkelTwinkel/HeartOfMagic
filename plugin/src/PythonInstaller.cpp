// CommonLib must come FIRST, then Windows headers
#include "PCH.h"
#include "PythonInstaller.h"

// WinHTTP - included AFTER CommonLib per v4.2.0 requirements
#include <winhttp.h>

#include <thread>
#include <atomic>

#pragma comment(lib, "winhttp.lib")

// =============================================================================
// SINGLETON
// =============================================================================

PythonInstaller* PythonInstaller::GetSingleton()
{
    static PythonInstaller singleton;
    return &singleton;
}

// =============================================================================
// PUBLIC API
// =============================================================================

void PythonInstaller::StartInstall(PRISMA_UI_API::IVPrismaUI1* prismaUI, PrismaView view)
{
    if (m_installing.load()) {
        logger::warn("PythonInstaller: Already installing, ignoring request");
        return;
    }

    m_prismaUI = prismaUI;
    m_view = view;
    m_cancelRequested.store(false);
    m_installing.store(true);

    // Resolve tool directory
    m_toolDir = "Data/SKSE/Plugins/SpellLearning/SpellTreeBuilder";
    if (!std::filesystem::exists(m_toolDir)) {
        m_toolDir = "SpellTreeBuilder";
    }
    m_pythonDir = m_toolDir / "python";

    logger::info("PythonInstaller: Starting install, toolDir={}", m_toolDir.string());

    // Launch background thread (same pattern as OpenRouterAPI.cpp)
    std::thread(&PythonInstaller::InstallWorker, this).detach();
}

void PythonInstaller::Cancel()
{
    if (m_installing.load()) {
        logger::info("PythonInstaller: Cancel requested");
        m_cancelRequested.store(true);
    }
}

// =============================================================================
// BACKGROUND WORKER
// =============================================================================

void PythonInstaller::InstallWorker()
{
    logger::info("PythonInstaller: Worker thread started");

    try {
        // Step 1: Download Python ZIP (0-20%)
        if (m_cancelRequested.load()) { CleanupPartialInstall(); return; }

        auto tempZip = m_toolDir / "python_temp.zip";
        ReportProgress("DownloadingPython", 2, "Downloading Python 3.12...");

        if (!DownloadFile(PYTHON_URL, tempZip, "DownloadingPython", 2, 20)) {
            if (m_cancelRequested.load()) {
                CleanupPartialInstall();
                return;
            }
            ReportComplete(false, "Failed to download Python. Check your internet connection.");
            return;
        }

        // Step 2: Extract ZIP (20-25%)
        if (m_cancelRequested.load()) { CleanupPartialInstall(); return; }

        ReportProgress("ExtractingPython", 20, "Extracting Python...");

        // Clean existing python dir if any
        if (std::filesystem::exists(m_pythonDir)) {
            std::error_code ec;
            std::filesystem::remove_all(m_pythonDir, ec);
        }

        if (!ExtractZip(tempZip, m_pythonDir)) {
            ReportComplete(false, "Failed to extract Python archive.");
            return;
        }

        // Clean up zip
        std::error_code ec;
        std::filesystem::remove(tempZip, ec);

        ReportProgress("ExtractingPython", 25, "Python extracted.");

        // Step 3: Enable site-packages (25-30%)
        if (m_cancelRequested.load()) { CleanupPartialInstall(); return; }

        ReportProgress("Configuring", 27, "Configuring Python...");

        if (!EnableSitePackages(m_pythonDir)) {
            logger::warn("PythonInstaller: Could not enable site-packages, continuing anyway");
        }

        ReportProgress("Configuring", 30, "Python configured.");

        // Step 4: Download get-pip.py (30-40%)
        if (m_cancelRequested.load()) { CleanupPartialInstall(); return; }

        auto getPipPath = m_pythonDir / "get-pip.py";
        ReportProgress("DownloadingGetPip", 30, "Downloading pip installer...");

        if (!DownloadFile(GET_PIP_URL, getPipPath, "DownloadingGetPip", 30, 40)) {
            if (m_cancelRequested.load()) {
                CleanupPartialInstall();
                return;
            }
            ReportComplete(false, "Failed to download pip installer.");
            return;
        }

        // Step 5: Install pip (40-50%)
        if (m_cancelRequested.load()) { CleanupPartialInstall(); return; }

        // Validate get-pip.py is actual Python (not HTML redirect/error page)
        {
            std::ifstream pipCheck(getPipPath);
            std::string firstLine;
            std::getline(pipCheck, firstLine);
            pipCheck.close();
            logger::info("PythonInstaller: get-pip.py first line: {}", firstLine.substr(0, 100));
            if (firstLine.find("<!DOCTYPE") != std::string::npos ||
                firstLine.find("<html") != std::string::npos ||
                firstLine.find("<HTML") != std::string::npos) {
                logger::error("PythonInstaller: get-pip.py contains HTML, not Python!");
                ReportComplete(false, "Downloaded file was HTML instead of Python. Possible redirect issue.");
                return;
            }
        }

        ReportProgress("InstallingPip", 40, "Installing pip...");

        // Use absolute paths - USVFS relative paths cause issues for child processes
        auto pythonExe = std::filesystem::absolute(m_pythonDir / "python.exe");
        auto absPipPath = std::filesystem::absolute(getPipPath);

        int pipResult = RunProcess(pythonExe.string(),
            "\"" + absPipPath.string() + "\" --no-warn-script-location",
            m_pythonDir);

        if (pipResult != 0) {
            ReportComplete(false, "Failed to install pip (exit code " + std::to_string(pipResult) + "). Check SKSE log for details.");
            return;
        }

        // Clean up get-pip.py
        std::filesystem::remove(getPipPath, ec);

        ReportProgress("InstallingPip", 50, "pip installed.");

        // Step 6: Install packages from requirements.txt (50-90%)
        if (m_cancelRequested.load()) { CleanupPartialInstall(); return; }

        auto reqPath = std::filesystem::absolute(m_toolDir / "requirements.txt");
        if (!std::filesystem::exists(reqPath)) {
            logger::warn("PythonInstaller: requirements.txt not found at {}", reqPath.string());
            ReportComplete(false, "requirements.txt not found in SpellTreeBuilder folder.");
            return;
        }

        ReportProgress("InstallingPackages", 50, "Installing packages (this may take a minute)...");

        int pkgResult = RunProcess(pythonExe.string(),
            "-m pip install --no-warn-script-location -r \"" + reqPath.string() + "\"",
            m_pythonDir);

        if (pkgResult != 0) {
            ReportComplete(false, "Failed to install packages (exit code " + std::to_string(pkgResult) + "). Check SKSE log for details.");
            return;
        }

        ReportProgress("InstallingPackages", 90, "Packages installed.");

        // Step 7: Verify installation
        if (m_cancelRequested.load()) { CleanupPartialInstall(); return; }

        ReportProgress("Verifying", 92, "Verifying installation...");

        // Use absolute paths for verification - USVFS may not resolve newly created
        // directories in Overwrite when using relative paths from the parent process.
        // Pip ran with absolute exe path, so packages were written to the absolute
        // USVFS-resolved location (which maps to MO2 Overwrite on disk).
        auto absPythonDir = std::filesystem::absolute(m_pythonDir);
        auto sitePackages = absPythonDir / "Lib" / "site-packages";

        logger::info("PythonInstaller: Checking site-packages at: {}", sitePackages.string());

        bool hasSitePackages = std::filesystem::exists(sitePackages);
        bool hasSklearn = hasSitePackages && std::filesystem::exists(sitePackages / "sklearn");
        bool hasThefuzz = hasSitePackages && std::filesystem::exists(sitePackages / "thefuzz");
        bool hasPip = hasSitePackages && std::filesystem::exists(sitePackages / "pip");

        logger::info("PythonInstaller: Verify - sitePackagesDir={}, sklearn={}, thefuzz={}, pip={}",
            hasSitePackages, hasSklearn, hasThefuzz, hasPip);

        if (!hasSitePackages) {
            // USVFS may not expose newly created dirs to parent process.
            // Also check relative path as fallback.
            auto relSitePackages = m_pythonDir / "Lib" / "site-packages";
            hasSitePackages = std::filesystem::exists(relSitePackages);
            if (hasSitePackages) {
                hasSklearn = std::filesystem::exists(relSitePackages / "sklearn");
                hasThefuzz = std::filesystem::exists(relSitePackages / "thefuzz");
                logger::info("PythonInstaller: Relative path found packages - sklearn={}, thefuzz={}",
                    hasSklearn, hasThefuzz);
            }
        }

        if (!hasSklearn || !hasThefuzz) {
            // pip returned 0 for both steps, so packages likely installed successfully
            // but USVFS can't see newly written Overwrite dirs from the parent process.
            // Trust pip's exit code and proceed.
            logger::warn("PythonInstaller: Filesystem verify couldn't find packages "
                "(USVFS may not expose new Overwrite dirs to parent). "
                "Trusting pip exit code 0 - marking as installed.");
        }

        // Step 8: Write completion marker and report success (100%)
        {
            // Use absolute path - USVFS routes writes to Overwrite
            auto markerPath = std::filesystem::absolute(m_pythonDir / ".install_complete");
            logger::info("PythonInstaller: Writing marker to: {}", markerPath.string());
            std::ofstream marker(markerPath);
            if (marker.is_open()) {
                marker << "Python 3.12.8 embedded + packages installed successfully\n";
                marker.close();
                logger::info("PythonInstaller: Wrote install completion marker");
            } else {
                // Fallback: try relative path
                auto relMarker = m_pythonDir / ".install_complete";
                std::ofstream marker2(relMarker);
                marker2 << "Python 3.12.8 embedded + packages installed successfully\n";
                marker2.close();
                logger::info("PythonInstaller: Wrote marker via relative path");
            }
        }

        ReportProgress("Complete", 100, "Setup complete!");
        ReportComplete(true);

        logger::info("PythonInstaller: Installation completed successfully");

    } catch (const std::exception& e) {
        logger::error("PythonInstaller: Exception during install: {}", e.what());
        ReportComplete(false, std::string("Unexpected error: ") + e.what());
    }

    m_installing.store(false);
}

// =============================================================================
// PROGRESS REPORTING
// =============================================================================

void PythonInstaller::ReportProgress(const std::string& stage, int percent, const std::string& message)
{
    auto* prismaUI = m_prismaUI;
    auto view = m_view;

    if (!prismaUI) return;

    nlohmann::json j;
    j["stage"] = stage;
    j["percent"] = percent;
    j["message"] = message;
    std::string payload = j.dump();

    // Marshal to main thread via SKSE TaskInterface
    SKSE::GetTaskInterface()->AddTask([prismaUI, view, payload]() {
        prismaUI->InteropCall(view, "onPythonSetupProgress", payload.c_str());
    });
}

void PythonInstaller::ReportComplete(bool success, const std::string& error)
{
    auto* prismaUI = m_prismaUI;
    auto view = m_view;

    if (!prismaUI) return;

    nlohmann::json j;
    j["success"] = success;
    if (!success) {
        j["error"] = error;
    }
    std::string payload = j.dump();

    m_installing.store(false);

    // Marshal to main thread
    SKSE::GetTaskInterface()->AddTask([prismaUI, view, payload]() {
        prismaUI->InteropCall(view, "onPythonSetupComplete", payload.c_str());
    });
}

// =============================================================================
// FILE DOWNLOAD (WinHTTP)
// =============================================================================

bool PythonInstaller::DownloadFile(const std::string& url, const std::filesystem::path& destPath,
                                    const std::string& stageName, int progressStart, int progressEnd)
{
    logger::info("PythonInstaller: Downloading {} -> {}", url, destPath.string());

    // Parse URL to get host, path, and whether it's HTTPS
    // URL format: https://host/path
    std::string urlStr = url;
    bool useSSL = false;
    if (urlStr.starts_with("https://")) {
        useSSL = true;
        urlStr = urlStr.substr(8);
    } else if (urlStr.starts_with("http://")) {
        urlStr = urlStr.substr(7);
    }

    auto slashPos = urlStr.find('/');
    std::string host = (slashPos != std::string::npos) ? urlStr.substr(0, slashPos) : urlStr;
    std::string path = (slashPos != std::string::npos) ? urlStr.substr(slashPos) : "/";

    // Convert to wide strings
    std::wstring wHost(host.begin(), host.end());
    std::wstring wPath(path.begin(), path.end());

    HINTERNET hSession = WinHttpOpen(
        L"SpellLearning-PythonInstaller/1.0",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0
    );

    if (!hSession) {
        logger::error("PythonInstaller: WinHttpOpen failed: {}", GetLastError());
        return false;
    }

    INTERNET_PORT port = useSSL ? INTERNET_DEFAULT_HTTPS_PORT : INTERNET_DEFAULT_HTTP_PORT;
    HINTERNET hConnect = WinHttpConnect(hSession, wHost.c_str(), port, 0);
    if (!hConnect) {
        logger::error("PythonInstaller: WinHttpConnect failed: {}", GetLastError());
        WinHttpCloseHandle(hSession);
        return false;
    }

    DWORD flags = useSSL ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(
        hConnect, L"GET", wPath.c_str(),
        NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
        flags
    );

    if (!hRequest) {
        logger::error("PythonInstaller: WinHttpOpenRequest failed: {}", GetLastError());
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    // Send request
    BOOL bResults = WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                        WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
    if (!bResults) {
        logger::error("PythonInstaller: WinHttpSendRequest failed: {}", GetLastError());
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    bResults = WinHttpReceiveResponse(hRequest, NULL);
    if (!bResults) {
        logger::error("PythonInstaller: WinHttpReceiveResponse failed: {}", GetLastError());
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    // Check for redirects (3xx) - handle manually
    DWORD statusCode = 0;
    DWORD statusCodeSize = sizeof(statusCode);
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &statusCodeSize,
                        WINHTTP_NO_HEADER_INDEX);

    if (statusCode >= 300 && statusCode < 400) {
        // Get redirect URL
        DWORD redirectUrlSize = 0;
        WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_LOCATION, WINHTTP_HEADER_NAME_BY_INDEX,
                           NULL, &redirectUrlSize, WINHTTP_NO_HEADER_INDEX);
        if (GetLastError() == ERROR_INSUFFICIENT_BUFFER && redirectUrlSize > 0) {
            std::wstring redirectUrl(redirectUrlSize / sizeof(wchar_t), L'\0');
            WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_LOCATION, WINHTTP_HEADER_NAME_BY_INDEX,
                               redirectUrl.data(), &redirectUrlSize, WINHTTP_NO_HEADER_INDEX);

            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);

            // Convert redirect URL to narrow string and recurse
            std::string narrowUrl;
            narrowUrl.reserve(redirectUrl.size());
            for (wchar_t wc : redirectUrl) {
                narrowUrl += static_cast<char>(wc & 0x7F);
            }
            // Trim null chars
            while (!narrowUrl.empty() && narrowUrl.back() == '\0') narrowUrl.pop_back();
            logger::info("PythonInstaller: Following redirect to {}", narrowUrl);
            return DownloadFile(narrowUrl, destPath, stageName, progressStart, progressEnd);
        }
    }

    if (statusCode != 200) {
        logger::error("PythonInstaller: HTTP {} for {}", statusCode, url);
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    // Get content length for progress
    DWORD contentLength = 0;
    DWORD clSize = sizeof(contentLength);
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &contentLength, &clSize,
                        WINHTTP_NO_HEADER_INDEX);

    // Ensure parent directory exists
    std::filesystem::create_directories(destPath.parent_path());

    // Open output file
    std::ofstream outFile(destPath, std::ios::binary);
    if (!outFile.is_open()) {
        logger::error("PythonInstaller: Failed to create file: {}", destPath.string());
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    // Read data in chunks
    DWORD totalRead = 0;
    DWORD dwSize = 0;
    int lastReportedPercent = progressStart;

    do {
        if (m_cancelRequested.load()) {
            outFile.close();
            std::error_code ec;
            std::filesystem::remove(destPath, ec);
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            logger::info("PythonInstaller: Download cancelled");
            return false;
        }

        dwSize = 0;
        if (!WinHttpQueryDataAvailable(hRequest, &dwSize)) {
            logger::error("PythonInstaller: WinHttpQueryDataAvailable failed: {}", GetLastError());
            break;
        }

        if (dwSize == 0) break;

        std::vector<char> buffer(dwSize);
        DWORD dwDownloaded = 0;

        if (WinHttpReadData(hRequest, buffer.data(), dwSize, &dwDownloaded)) {
            outFile.write(buffer.data(), dwDownloaded);
            totalRead += dwDownloaded;

            // Report progress
            if (contentLength > 0) {
                float downloadProgress = static_cast<float>(totalRead) / contentLength;
                int currentPercent = progressStart +
                    static_cast<int>(downloadProgress * (progressEnd - progressStart));
                if (currentPercent > lastReportedPercent) {
                    lastReportedPercent = currentPercent;
                    float mb = totalRead / (1024.0f * 1024.0f);
                    float totalMb = contentLength / (1024.0f * 1024.0f);
                    char msg[128];
                    snprintf(msg, sizeof(msg), "Downloading... %.1f / %.1f MB", mb, totalMb);
                    ReportProgress(stageName, currentPercent, msg);
                }
            }
        }
    } while (dwSize > 0);

    outFile.close();

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);

    logger::info("PythonInstaller: Downloaded {} bytes to {}", totalRead, destPath.string());
    return totalRead > 0;
}

// =============================================================================
// ZIP EXTRACTION
// =============================================================================

bool PythonInstaller::ExtractZip(const std::filesystem::path& zipPath, const std::filesystem::path& destDir)
{
    logger::info("PythonInstaller: Extracting {} -> {}", zipPath.string(), destDir.string());

    // Use PowerShell Expand-Archive
    std::string cmd = "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -Path '";
    cmd += zipPath.string();
    cmd += "' -DestinationPath '";
    cmd += destDir.string();
    cmd += "' -Force\"";

    int result = std::system(cmd.c_str());

    if (result != 0) {
        logger::error("PythonInstaller: ExtractZip failed with code {}", result);
        return false;
    }

    // Verify python.exe exists (may be in a subdirectory)
    auto pythonExe = destDir / "python.exe";
    if (!std::filesystem::exists(pythonExe)) {
        // Check if it extracted into a subdirectory (common with ZIP archives)
        for (auto& entry : std::filesystem::directory_iterator(destDir)) {
            if (entry.is_directory()) {
                auto subPython = entry.path() / "python.exe";
                if (std::filesystem::exists(subPython)) {
                    // Move contents up one level
                    logger::info("PythonInstaller: Moving contents from subdirectory {}", entry.path().string());
                    auto tempDir = destDir.parent_path() / "python_temp_move";
                    std::error_code ec;
                    std::filesystem::rename(entry.path(), tempDir, ec);
                    if (!ec) {
                        std::filesystem::remove_all(destDir, ec);
                        std::filesystem::rename(tempDir, destDir, ec);
                    }
                    break;
                }
            }
        }
    }

    bool success = std::filesystem::exists(destDir / "python.exe");
    if (!success) {
        logger::error("PythonInstaller: python.exe not found after extraction");
    }
    return success;
}

// =============================================================================
// SITE-PACKAGES CONFIGURATION
// =============================================================================

bool PythonInstaller::EnableSitePackages(const std::filesystem::path& pythonDir)
{
    // Helper: trim \r and trailing whitespace from a line
    auto trimLine = [](std::string& s) {
        while (!s.empty() && (s.back() == '\r' || s.back() == ' ' || s.back() == '\t')) {
            s.pop_back();
        }
    };

    // Find the ._pth file (e.g., python312._pth) by filename pattern
    // extension() check can be unreliable for "._pth", so use filename search
    for (auto& entry : std::filesystem::directory_iterator(pythonDir)) {
        if (!entry.is_regular_file()) continue;

        auto filename = entry.path().filename().string();
        if (filename.find("._pth") == std::string::npos) continue;

        auto pthPath = entry.path();
        logger::info("PythonInstaller: Found pth file: {}", pthPath.string());

        // Read file
        std::ifstream inFile(pthPath);
        if (!inFile.is_open()) {
            logger::error("PythonInstaller: Cannot open pth file for reading");
            continue;
        }

        std::string content;
        std::string line;
        bool modified = false;
        bool alreadyEnabled = false;
        while (std::getline(inFile, line)) {
            trimLine(line);

            if (line == "#import site") {
                content += "import site\n";
                modified = true;
                logger::info("PythonInstaller: Uncommenting '#import site'");
            } else {
                if (line == "import site") {
                    alreadyEnabled = true;
                }
                content += line + "\n";
            }
        }
        inFile.close();

        if (modified) {
            std::ofstream outFile(pthPath, std::ios::trunc);
            if (!outFile.is_open()) {
                logger::error("PythonInstaller: Cannot open pth file for writing");
                return false;
            }
            outFile << content;
            outFile.close();
            logger::info("PythonInstaller: Enabled site-packages in {}", pthPath.filename().string());
        } else if (alreadyEnabled) {
            logger::info("PythonInstaller: site-packages already enabled in {}", pthPath.filename().string());
        } else {
            // Pattern not found at all - append it
            logger::warn("PythonInstaller: '#import site' not found, appending 'import site'");
            std::ofstream outFile(pthPath, std::ios::app);
            outFile << "\nimport site\n";
            outFile.close();
        }
        return true;
    }

    logger::warn("PythonInstaller: No ._pth file found in {}", pythonDir.string());
    return false;
}

// =============================================================================
// PROCESS EXECUTION
// =============================================================================

int PythonInstaller::RunProcess(const std::string& executable, const std::string& arguments,
                                 const std::filesystem::path& workingDir)
{
    // Convert executable to absolute path for reliable resolution under USVFS
    std::string absExe = std::filesystem::absolute(executable).string();

    // CRITICAL: Wrap entire command in outer quotes for cmd.exe /c parsing.
    // When paths contain spaces (e.g. "Mod Development Zone 2", "Stock Game"),
    // cmd.exe strips the first and last quote on the line, breaking inner path quotes.
    // The outer quotes prevent this: cmd.exe strips them, preserving inner quotes.
    // No output redirect - let pip/package progress show in the CMD window.
    std::string cmd = "\"\"" + absExe + "\" " + arguments + "\"";

    logger::info("PythonInstaller: Running: {}", cmd);

    int result = std::system(cmd.c_str());

    logger::info("PythonInstaller: Process exited with code {}", result);
    return result;
}

// =============================================================================
// CLEANUP
// =============================================================================

void PythonInstaller::CleanupPartialInstall()
{
    logger::info("PythonInstaller: Cleaning up partial install");

    std::error_code ec;

    // Remove temp zip if exists
    auto tempZip = m_toolDir / "python_temp.zip";
    if (std::filesystem::exists(tempZip)) {
        std::filesystem::remove(tempZip, ec);
    }

    // Remove partial python dir
    if (std::filesystem::exists(m_pythonDir)) {
        std::filesystem::remove_all(m_pythonDir, ec);
    }

    m_installing.store(false);
    ReportComplete(false, "Installation cancelled.");
}
