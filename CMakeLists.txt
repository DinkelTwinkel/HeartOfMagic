cmake_minimum_required(VERSION 3.21)

if(POLICY CMP0135)
    cmake_policy(SET CMP0135 NEW)
endif()

# ============================================================================
# HeartOfMagic - Top-Level Super-Build
# ============================================================================
# All sub-projects share:
#   - CommonLibSSE-NG (built once from plugins/external/commonlibsse-ng/)
#   - vcpkg dependencies (single install at root)
#   - Compiler flags (plugins/cmake/CompilerFlags.cmake)
#   - Static MSVC runtime
# ============================================================================

project(HeartOfMagic LANGUAGES CXX)

# Prevent in-source builds
if(PROJECT_SOURCE_DIR STREQUAL PROJECT_BINARY_DIR)
    message(FATAL_ERROR "In-source builds not allowed. Use: cmake -B build")
endif()

# ============================================================================
# Shared Build Configuration
# ============================================================================

add_definitions(-D_WIN32_WINNT=0x0A00)

# Static runtime for all targets
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Shared cmake modules
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/plugins/cmake")

# Apply compiler flags globally (MSVC optimizations, /EHa, /GL, linker flags)
include(CompilerFlags)

# ============================================================================
# CommonLibSSE-NG (built once, shared by all targets)
# ============================================================================

include(commonlibsse)

# ============================================================================
# Shared vcpkg packages
# ============================================================================

find_package(spdlog CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(xbyak CONFIG REQUIRED)
find_package(miniz CONFIG REQUIRED)

# ============================================================================
# Sub-projects
# ============================================================================

add_subdirectory(plugins/spelllearning)
add_subdirectory(plugins/compatibility/DummyDEST)
add_subdirectory(plugins/addons/BookXP)
