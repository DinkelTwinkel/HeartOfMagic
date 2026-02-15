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
    VERSION 9.9.9
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

target_include_directories(${PROJECT_NAME} PRIVATE src)

target_precompile_headers(${PROJECT_NAME} PRIVATE src/PCH.h)

target_compile_features(${PROJECT_NAME} PRIVATE cxx_std_23)

target_link_libraries(${PROJECT_NAME} PRIVATE
    spdlog::spdlog
)

set_target_properties(${PROJECT_NAME} PROPERTIES
    OUTPUT_NAME "DontEatSpellTomes"
)

# Copy to the FOMOD optional folder
#set(FOMOD_DEST "${CMAKE_CURRENT_SOURCE_DIR}/../../fomod/optional/ISLPatch/SKSE/Plugins")
#add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
#    COMMAND ${CMAKE_COMMAND} -E make_directory "${FOMOD_DEST}"
#    COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:${PROJECT_NAME}> "${FOMOD_DEST}/"
#    COMMENT "Copying dummy DontEatSpellTomes.dll to FOMOD optional folder"
#)
