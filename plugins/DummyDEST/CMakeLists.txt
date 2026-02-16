# ==========================================================================
# DummyDEST -- Inert replacement for DontEatSpellTomes.dll
# ==========================================================================
# This is a valid SKSE plugin that loads but does NOTHING.
# It exists solely to overwrite ISL's real DontEatSpellTomes.dll via MO2
# file conflict, eliminating the hook clash with SpellLearning.dll.
#
# SpellLearning.dll provides the DEST_AliasExt native Papyrus functions
# that ISL's scripts need, so ISL works unchanged.
#
# CommonLibSSE-NG, compiler flags, and vcpkg packages are provided
# by the top-level CMakeLists.txt super-build.
# ==========================================================================

project(
    DontEatSpellTomes
    VERSION ${PROJECT_VERSION}
    DESCRIPTION "Heart of Magic ISL compatibility shim -- replaces original DEST DLL"
    LANGUAGES CXX
)

add_commonlibsse_plugin(${PROJECT_NAME}
    NAME ${PROJECT_NAME}
    AUTHOR "Heart of Magic (compatibility shim)"
    USE_ADDRESS_LIBRARY
    MINIMUM_SKSE_VERSION "2.0.12"
    VERSION ${PROJECT_VERSION}
    SOURCES
        src/Main.cpp
)

# Include directories
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/..
)

# Precompiled header
target_precompile_headers(${PROJECT_NAME} PRIVATE 
    ${CMAKE_CURRENT_SOURCE_DIR}/../PCH.h
)

target_compile_features(${PROJECT_NAME} PRIVATE cxx_std_23)

target_link_libraries(${PROJECT_NAME} PRIVATE
    spdlog::spdlog
)

set_target_properties(${PROJECT_NAME} PROPERTIES
    OUTPUT_NAME "DontEatSpellTomes"
)
