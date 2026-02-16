# ==========================================================================
# SL_BookXP -- SpellLearning Book Reading XP addon
# ==========================================================================
# CommonLibSSE-NG, compiler flags, and vcpkg packages are provided
# by the top-level CMakeLists.txt super-build.
# ==========================================================================

project(
    SL_BookXP
    VERSION ${PROJECT_VERSION}
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
    OUTPUT_NAME "SL_BookXP"
)
