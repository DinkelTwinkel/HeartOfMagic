cmake_minimum_required(VERSION 3.21)

# ==========================================================================
# DummyDEST — Inert replacement for DontEatSpellTomes.dll
# ==========================================================================
# This is a valid SKSE plugin that loads but does NOTHING.
# It exists solely to overwrite ISL's real DontEatSpellTomes.dll via MO2
# file conflict, eliminating the hook clash with SpellLearning.dll.
#
# SpellLearning.dll provides the DEST_AliasExt native Papyrus functions
# that ISL's scripts need, so ISL works unchanged.
# ==========================================================================

project(
    DontEatSpellTomes
    VERSION 9.9.9
    DESCRIPTION "Heart of Magic ISL compatibility shim — replaces original DEST DLL"
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# CommonLib (same shared copy as main project)
set(COMMONLIB_PATH "${CMAKE_SOURCE_DIR}/../../../../shared/CommonLibSSE-NG" CACHE PATH "Path to CommonLibSSE-NG")

set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ENABLE_SKYRIM_SE ON CACHE BOOL "" FORCE)
set(ENABLE_SKYRIM_AE ON CACHE BOOL "" FORCE)
set(ENABLE_SKYRIM_VR OFF CACHE BOOL "" FORCE)

if(EXISTS "${COMMONLIB_PATH}/CMakeLists.txt")
    add_subdirectory("${COMMONLIB_PATH}" "${CMAKE_CURRENT_BINARY_DIR}/CommonLibSSE" EXCLUDE_FROM_ALL)
else()
    message(FATAL_ERROR "CommonLibSSE-NG not found at ${COMMONLIB_PATH}")
endif()

find_package(spdlog CONFIG REQUIRED)

add_library(${PROJECT_NAME} SHARED src/Main.cpp)

target_include_directories(${PROJECT_NAME} PRIVATE src)

target_compile_definitions(${PROJECT_NAME} PRIVATE
    UNICODE _UNICODE
    SPDLOG_COMPILED_LIB=1
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    CommonLibSSE::CommonLibSSE
    spdlog::spdlog
)

set_target_properties(${PROJECT_NAME} PROPERTIES
    OUTPUT_NAME "DontEatSpellTomes"
)

# Copy to the FOMOD optional folder
set(FOMOD_DEST "${CMAKE_SOURCE_DIR}/../../fomod/optional/ISLPatch/SKSE/Plugins")
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${FOMOD_DEST}"
    COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:${PROJECT_NAME}> "${FOMOD_DEST}/"
    COMMENT "Copying dummy DontEatSpellTomes.dll to FOMOD optional folder"
)
