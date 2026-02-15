# ============================================================================
# PROJECT CONFIGURATION
# ============================================================================

# OpenMP support for parallel pairwise similarity loops
string(APPEND CMAKE_CXX_FLAGS " /openmp")

project(
    SpellLearning
    VERSION 2.3.0
    DESCRIPTION "AI-Generated Spell Learning Tree System"
    LANGUAGES CXX
)

set(PLUGIN_AUTHOR "DinkelZombie")

# ============================================================================
# Build Configuration
# ============================================================================

if(PROJECT_SOURCE_DIR STREQUAL PROJECT_BINARY_DIR)
    message(FATAL_ERROR "In-source builds not allowed. Use: cmake -B build")
endif()

# Create SKSE plugin using CommonLibSSE function
# (CommonLib target and macro provided by top-level CMakeLists.txt)
add_commonlibsse_plugin(${PROJECT_NAME}
    NAME ${PROJECT_NAME}
    AUTHOR "${PLUGIN_AUTHOR}"
    USE_ADDRESS_LIBRARY
    MINIMUM_SKSE_VERSION "2.0.12"
    VERSION ${PROJECT_VERSION}
    SOURCES
        src/Main.cpp
        src/UIManager.cpp
        src/SpellScanner.cpp
        src/OpenRouterAPI.cpp
        src/SpellCastHandler.cpp
        src/ProgressionManager.cpp
        src/ISLIntegration.cpp
        src/SpellCastXPSource.cpp
        src/PassiveLearningSource.cpp
        src/SpellEffectivenessHook.cpp
        src/SpellTomeHook.cpp
        src/PapyrusAPI.cpp
        src/TreeNLP.cpp
        src/TreeBuilderCore.cpp
        src/TreeBuilderThemes.cpp
        src/TreeBuilderClassic.cpp
        src/TreeBuilderTree.cpp
        src/TreeBuilderThematic.cpp
        src/TreeBuilderGraph.cpp
        src/TreeBuilderOracle.cpp
        src/SimdKernels.cpp
)

# Include directories
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# Precompiled header
target_precompile_headers(${PROJECT_NAME} PRIVATE include/PCH.h)

target_compile_features(${PROJECT_NAME} PRIVATE cxx_std_23)

target_link_libraries(${PROJECT_NAME} PRIVATE
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    xbyak::xbyak
    CURL::libcurl
    hwy::hwy
    hwy::hwy_contrib
)

# Highway foreach_target dispatch must not be merged into unity build groups
set_source_files_properties(src/SimdKernels.cpp PROPERTIES
    SKIP_UNITY_BUILD_INCLUSION ON
    SKIP_PRECOMPILE_HEADERS ON
)

set_target_properties(${PROJECT_NAME} PROPERTIES
    OUTPUT_NAME "${PROJECT_NAME}"
)

# Generate fomod/info.xml from template with current version
configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/../../fomod/info.xml.in"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../fomod/info.xml"
    @ONLY
)

# Post-build: Copy DLL to MO2 RELEASE folder
#set(MO2_RELEASE_PATH "D:/MODDING/Mod Development Zone 2/MO2/mods/HeartOfMagic_RELEASE/SKSE/Plugins")
#add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
#    COMMAND ${CMAKE_COMMAND} -E make_directory "${MO2_RELEASE_PATH}"
#    COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:${PROJECT_NAME}> "${MO2_RELEASE_PATH}/"
#    COMMENT "Copying DLL to MO2 RELEASE folder"
#)

# Post-build: Copy PrismaUI views to MO2 RELEASE folder
# PrismaUI expects views in: PrismaUI/views/{ViewName}/index.html
# UIManager creates views with path "SpellLearning/SpellLearningPanel/index.html"
# So the full path should be: PrismaUI/views/SpellLearning/SpellLearningPanel/index.html
# Note: Tree viewer is now a tab in SpellLearningPanel, not a separate view
#set(PRISMAUI_SRC "${CMAKE_CURRENT_SOURCE_DIR}/../PrismaUI/views/SpellLearning")
#set(PRISMAUI_DST "D:/MODDING/Mod Development Zone 2/MO2/mods/HeartOfMagic_RELEASE/PrismaUI/views/${PROJECT_NAME}")
#add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
#    COMMAND ${CMAKE_COMMAND} -E make_directory "${PRISMAUI_DST}/SpellLearningPanel"
#    COMMAND ${CMAKE_COMMAND} -E copy_directory "${PRISMAUI_SRC}/SpellLearningPanel" "${PRISMAUI_DST}/SpellLearningPanel"
#    COMMENT "Copying PrismaUI views to MO2 RELEASE folder"
#)
