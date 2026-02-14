cmake_minimum_required(VERSION 3.21)

project(
    SL_BookXP
    VERSION 1.0.0
    DESCRIPTION "SpellLearning API Test - Book Reading XP"
    LANGUAGES CXX
)

if(PROJECT_SOURCE_DIR STREQUAL PROJECT_BINARY_DIR)
    message(FATAL_ERROR "In-source builds not allowed. Use: cmake -B build")
endif()

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Dependencies
find_package(spdlog CONFIG REQUIRED)

# CommonLib - shared from workspace
set(COMMONLIB_PATH "${CMAKE_SOURCE_DIR}/../../../../../shared/CommonLibSSE-NG" CACHE PATH "Path to CommonLibSSE-NG")

set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ENABLE_SKYRIM_SE ON CACHE BOOL "" FORCE)
set(ENABLE_SKYRIM_AE ON CACHE BOOL "" FORCE)
set(ENABLE_SKYRIM_VR OFF CACHE BOOL "" FORCE)

if(EXISTS "${COMMONLIB_PATH}/CMakeLists.txt")
    message(STATUS "Using CommonLibSSE-NG at ${COMMONLIB_PATH}")
    add_subdirectory("${COMMONLIB_PATH}" "${CMAKE_CURRENT_BINARY_DIR}/CommonLibSSE" EXCLUDE_FROM_ALL)
else()
    message(FATAL_ERROR "CommonLibSSE-NG not found at ${COMMONLIB_PATH}")
endif()

# Source
add_library(${PROJECT_NAME} SHARED src/Main.cpp)

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_compile_features(${PROJECT_NAME} PRIVATE cxx_std_23)

target_compile_definitions(${PROJECT_NAME} PRIVATE
    UNICODE
    _UNICODE
    SPDLOG_COMPILED_LIB=1
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    CommonLibSSE::CommonLibSSE
    spdlog::spdlog
)

set_target_properties(${PROJECT_NAME} PROPERTIES
    OUTPUT_NAME "SL_BookXP"
)

# Post-build: Copy DLL to MO2
set(MO2_RELEASE_PATH "D:/MODDING/Mod Development Zone 2/MO2/mods/SL_BookXP_RELEASE/SKSE/Plugins")
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${MO2_RELEASE_PATH}"
    COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:${PROJECT_NAME}> "${MO2_RELEASE_PATH}/"
    COMMENT "Copying SL_BookXP.dll to MO2"
)
