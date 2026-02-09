cmake_minimum_required(VERSION 3.21)

# ============================================================================
# PROJECT CONFIGURATION
# ============================================================================
project(
    SpellLearning
    VERSION 2.1.0
    DESCRIPTION "AI-Generated Spell Learning Tree System"
    LANGUAGES CXX
)

set(PLUGIN_AUTHOR "Spooky")

# ============================================================================
# CommonLib Fork Selection
# ============================================================================
set(COMMONLIB_FORK "NG" CACHE STRING "CommonLib fork to use (NG or PO3)")

# ============================================================================
# Build Configuration
# ============================================================================

if(PROJECT_SOURCE_DIR STREQUAL PROJECT_BINARY_DIR)
    message(FATAL_ERROR "In-source builds not allowed. Use: cmake -B build")
endif()

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Static runtime
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Dependencies
find_package(spdlog CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(xbyak CONFIG REQUIRED)

# CommonLib configuration - use shared library from workspace
set(COMMONLIB_PATH "${CMAKE_SOURCE_DIR}/../../../shared/CommonLibSSE-NG" CACHE PATH "Path to CommonLibSSE-NG")

if(COMMONLIB_FORK STREQUAL "NG")
    message(STATUS "Using CommonLibSSE-NG (CharmedBaryon fork)")
    set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(ENABLE_SKYRIM_SE ON CACHE BOOL "" FORCE)
    set(ENABLE_SKYRIM_AE ON CACHE BOOL "" FORCE)
    set(ENABLE_SKYRIM_VR OFF CACHE BOOL "" FORCE)
    if(EXISTS "${COMMONLIB_PATH}/CMakeLists.txt")
        message(STATUS "  -> Using shared library at ${COMMONLIB_PATH}")
        add_subdirectory("${COMMONLIB_PATH}" "${CMAKE_CURRENT_BINARY_DIR}/CommonLibSSE" EXCLUDE_FROM_ALL)
    else()
        message(FATAL_ERROR "CommonLibSSE-NG not found at ${COMMONLIB_PATH}")
    endif()
    set(COMMONLIB_TARGET CommonLibSSE::CommonLibSSE)
endif()

# Source files
add_library(${PROJECT_NAME} SHARED
    src/Main.cpp
    src/UIManager.cpp
    src/SpellScanner.cpp
    src/OpenRouterAPI.cpp
    src/SpellCastHandler.cpp
    src/ProgressionManager.cpp
    src/ISLIntegration.cpp
    src/SpellCastXPSource.cpp
    src/SpellEffectivenessHook.cpp
    src/SpellTomeHook.cpp
    src/PapyrusAPI.cpp
    src/PythonInstaller.cpp
    src/PythonBridge.cpp
)

# Include directories
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# Precompiled header
target_precompile_headers(${PROJECT_NAME} PRIVATE include/PCH.h)

target_compile_features(${PROJECT_NAME} PRIVATE cxx_std_23)

target_compile_definitions(${PROJECT_NAME} PRIVATE
    SKSE_SUPPORT_XBYAK=1
    UNICODE
    _UNICODE
    SPDLOG_COMPILED_LIB=1
    PLUGIN_NAME="${PROJECT_NAME}"
    PLUGIN_VERSION="${PROJECT_VERSION}"
    PLUGIN_VERSION_MAJOR=${PROJECT_VERSION_MAJOR}
    PLUGIN_VERSION_MINOR=${PROJECT_VERSION_MINOR}
    PLUGIN_VERSION_PATCH=${PROJECT_VERSION_PATCH}
    PLUGIN_AUTHOR="${PLUGIN_AUTHOR}"
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    ${COMMONLIB_TARGET}
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    xbyak::xbyak
)

# Output name must match project name exactly
set_target_properties(${PROJECT_NAME} PROPERTIES
    OUTPUT_NAME "${PROJECT_NAME}"
)

# Generate fomod/info.xml from template with current version
configure_file(
    "${CMAKE_SOURCE_DIR}/../fomod/info.xml.in"
    "${CMAKE_SOURCE_DIR}/../fomod/info.xml"
    @ONLY
)

# Post-build: Copy DLL to MO2 RELEASE folder
set(MO2_RELEASE_PATH "D:/MODDING/Mod Development Zone 2/MO2/mods/HeartOfMagic_RELEASE/SKSE/Plugins")
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${MO2_RELEASE_PATH}"
    COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:${PROJECT_NAME}> "${MO2_RELEASE_PATH}/"
    COMMENT "Copying DLL to MO2 RELEASE folder"
)

# Post-build: Copy PrismaUI views to MO2 RELEASE folder
# PrismaUI expects views in: PrismaUI/views/{ViewName}/index.html
# UIManager creates views with path "SpellLearning/SpellLearningPanel/index.html"
# So the full path should be: PrismaUI/views/SpellLearning/SpellLearningPanel/index.html
# Note: Tree viewer is now a tab in SpellLearningPanel, not a separate view
set(PRISMAUI_SRC "${CMAKE_SOURCE_DIR}/../PrismaUI/views/SpellLearning")
set(PRISMAUI_DST "D:/MODDING/Mod Development Zone 2/MO2/mods/HeartOfMagic_RELEASE/PrismaUI/views/${PROJECT_NAME}")
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${PRISMAUI_DST}/SpellLearningPanel"
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${PRISMAUI_SRC}/SpellLearningPanel" "${PRISMAUI_DST}/SpellLearningPanel"
    COMMENT "Copying PrismaUI views to MO2 RELEASE folder"
)
