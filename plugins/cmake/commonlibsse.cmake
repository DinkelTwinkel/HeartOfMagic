# commonlibsse.cmake - CommonLibSSE-NG configuration
# Locates, configures, and adds the CommonLibSSE-NG submodule.
# Uses CMAKE_CURRENT_LIST_DIR so this module works regardless of
# which CMakeLists.txt includes it.

set(CommonLibPath "${CMAKE_CURRENT_LIST_DIR}/../external/commonlibsse-ng")
set(CommonLibName "CommonLibSSE")

# Read CommonLibSSE version from its vcpkg.json
set(COMMONLIB_VCPKG_JSON_PATH "${CommonLibPath}/vcpkg.json")
if(NOT EXISTS "${COMMONLIB_VCPKG_JSON_PATH}")
    message(FATAL_ERROR
        "CommonLibSSE-NG vcpkg.json not found at \"${COMMONLIB_VCPKG_JSON_PATH}\". "
        "Ensure the CommonLibSSE-NG submodule is checked out: git submodule update --init")
endif()
file(READ "${COMMONLIB_VCPKG_JSON_PATH}" COMMONLIB_VCPKG_JSON_CONTENT)
string(JSON COMMONLIBSSE_VERSION ERROR_VARIABLE _COMMONLIBSSE_VERSION_JSON_ERROR
    GET "${COMMONLIB_VCPKG_JSON_CONTENT}" "version-semver")
if(_COMMONLIBSSE_VERSION_JSON_ERROR)
    message(FATAL_ERROR
        "Failed to extract \"version-semver\" from \"${COMMONLIB_VCPKG_JSON_PATH}\": "
        "${_COMMONLIBSSE_VERSION_JSON_ERROR}")
endif()
message(STATUS "Configuring CommonLibSSE-NG version ${COMMONLIBSSE_VERSION}")
set(COMMONLIBSSE_VERSION "${COMMONLIBSSE_VERSION}" CACHE STRING "CommonLibSSE-NG version" FORCE)

# Save original build type
set(_saved_build_type "${CMAKE_BUILD_TYPE}")

# Always build CommonLibSSE in Release mode to disable assertions and enable optimizations
set(CMAKE_BUILD_TYPE "Release")
add_definitions(-D_CRT_SECURE_NO_WARNINGS -DNDEBUG)

# Disable CommonLibSSE tests when building as subdirectory
set(BUILD_TESTS OFF CACHE BOOL "Disable CommonLibSSE tests" FORCE)

# CommonLib runtime configuration
set(ENABLE_SKYRIM_SE ON CACHE BOOL "Enable Skyrim SE support" FORCE)
set(ENABLE_SKYRIM_AE ON CACHE BOOL "Enable Skyrim AE support" FORCE)
set(ENABLE_SKYRIM_VR OFF CACHE BOOL "Enable Skyrim VR support" FORCE)
set(SKSE_SUPPORT_XBYAK ON CACHE BOOL "Enable Xbyak support" FORCE)

# Add CommonLibSSE-NG as a subdirectory with EXCLUDE_FROM_ALL
add_subdirectory("${CommonLibPath}" "${CMAKE_BINARY_DIR}/CommonLibSSE" EXCLUDE_FROM_ALL)

# Include the CommonLibSSE helper cmake functions (provides add_commonlibsse_plugin macro)
include("${CommonLibPath}/cmake/CommonLibSSE.cmake")

# Restore original build type for the main project
set(CMAKE_BUILD_TYPE "${_saved_build_type}")

# Expose CommonLibSSE version to C++ code
add_compile_definitions(COMMONLIBSSE_VERSION="${COMMONLIBSSE_VERSION}")
