# ==========================================================================
# SL_BookXP -- SpellLearning Book Reading XP addon
# ==========================================================================
# CommonLibSSE-NG, compiler flags, and vcpkg packages are provided
# by the top-level CMakeLists.txt super-build.
# ==========================================================================

project(
    SL_BookXP
    VERSION 1.0.0
    DESCRIPTION "SpellLearning API Test - Book Reading XP"
    LANGUAGES CXX
)

if(PROJECT_SOURCE_DIR STREQUAL PROJECT_BINARY_DIR)
    message(FATAL_ERROR "In-source builds not allowed. Use: cmake -B build")
endif()

add_commonlibsse_plugin(${PROJECT_NAME}
    NAME ${PROJECT_NAME}
    AUTHOR "HeartOfMagic"
    USE_ADDRESS_LIBRARY
    MINIMUM_SKSE_VERSION "2.0.12"
    VERSION ${PROJECT_VERSION}
    SOURCES
        src/Main.cpp
)

target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_precompile_headers(${PROJECT_NAME} PRIVATE src/PCH.h)

target_link_libraries(${PROJECT_NAME} PRIVATE
    spdlog::spdlog
)

set_target_properties(${PROJECT_NAME} PROPERTIES
    OUTPUT_NAME "SL_BookXP"
)

## Post-build: Copy DLL to MO2
#set(MO2_RELEASE_PATH "D:/MODDING/Mod Development Zone 2/MO2/mods/SL_BookXP_RELEASE/SKSE/Plugins")
#add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
#    COMMAND ${CMAKE_COMMAND} -E make_directory "${MO2_RELEASE_PATH}"
#    COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE:${PROJECT_NAME}> "${MO2_RELEASE_PATH}/"
#    COMMENT "Copying SL_BookXP.dll to MO2"
#)
