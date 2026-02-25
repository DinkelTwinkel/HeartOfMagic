cmake_minimum_required(VERSION 3.25)

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
file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/VERSION" PROJECT_VERSION)
project(HeartOfMagic VERSION ${PROJECT_VERSION} LANGUAGES CXX)

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
find_package(curl CONFIG REQUIRED)
find_package(hwy CONFIG REQUIRED)

# ============================================================================
# Sub-projects
# ============================================================================

set(DIST_DIR "${CMAKE_SOURCE_DIR}/dist")
set(DIST_VERSION_DIR "${DIST_DIR}/${PROJECT_NAME}_${PROJECT_VERSION}")

add_subdirectory(plugins/spelllearning)
add_subdirectory(plugins/DummyDEST)
add_subdirectory(plugins/BookXP)
add_subdirectory(tools)

# Generate fomod/info.xml from template with current version
configure_file(
    "${CMAKE_SOURCE_DIR}/fomod/info.xml.in"
    "${CMAKE_SOURCE_DIR}/fomod/info.xml"
    @ONLY
)

# Papyrus script compilation
include(Papyrus)

# Distribution folder assembly
include(Distribution)
