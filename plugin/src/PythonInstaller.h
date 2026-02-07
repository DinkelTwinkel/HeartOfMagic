#pragma once

#include "PCH.h"
#include "PrismaUI_API.h"

#include <atomic>
#include <thread>

/**
 * PythonInstaller - Downloads and installs embedded Python + packages
 * for the SpellTreeBuilder (Complex Build mode).
 *
 * Uses WinHTTP for downloads, runs in a background thread,
 * reports progress to JS via PrismaUI InteropCall.
 */
class PythonInstaller
{
public:
    static PythonInstaller* GetSingleton();

    // Start the installation process in a background thread
    void StartInstall(PRISMA_UI_API::IVPrismaUI1* prismaUI, PrismaView view);

    // Cancel a running installation
    void Cancel();

    // Check if installation is currently running
    bool IsInstalling() const { return m_installing.load(); }

private:
    PythonInstaller() = default;
    ~PythonInstaller() = default;
    PythonInstaller(const PythonInstaller&) = delete;
    PythonInstaller& operator=(const PythonInstaller&) = delete;

    // Background worker
    void InstallWorker();

    // Progress reporting (thread-safe via SKSE TaskInterface)
    void ReportProgress(const std::string& stage, int percent, const std::string& message);
    void ReportComplete(bool success, const std::string& error = "");

    // Download a file via WinHTTP, returns true on success
    bool DownloadFile(const std::string& url, const std::filesystem::path& destPath,
                      const std::string& stageName, int progressStart, int progressEnd);

    // Extract ZIP via PowerShell
    bool ExtractZip(const std::filesystem::path& zipPath, const std::filesystem::path& destDir);

    // Enable site-packages in embedded Python (edit ._pth file)
    bool EnableSitePackages(const std::filesystem::path& pythonDir);

    // Run a process and wait for completion, returns exit code
    int RunProcess(const std::string& executable, const std::string& arguments,
                   const std::filesystem::path& workingDir);

    // Cleanup partial install on failure/cancel
    void CleanupPartialInstall();

    // State
    std::atomic<bool> m_installing{false};
    std::atomic<bool> m_cancelRequested{false};

    // PrismaUI references (only valid during install)
    PRISMA_UI_API::IVPrismaUI1* m_prismaUI = nullptr;
    PrismaView m_view = 0;

    // Install paths
    std::filesystem::path m_toolDir;
    std::filesystem::path m_pythonDir;

    // Download URLs
    static constexpr const char* PYTHON_URL =
        "https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip";
    static constexpr const char* GET_PIP_URL =
        "https://bootstrap.pypa.io/get-pip.py";
};
