project(
    treebuilder-test
    VERSION ${PROJECT_VERSION}
    DESCRIPTION "Standalone test harness for TreeBuilder algorithms"
    LANGUAGES CXX
)

set(SL_SRC_DIR "${CMAKE_SOURCE_DIR}/plugins/spelllearning/src")

add_executable(${PROJECT_NAME}
    treebuilder-test.cpp
    ${SL_SRC_DIR}/TreeNLP.cpp
    ${SL_SRC_DIR}/TreeBuilderCore.cpp
    ${SL_SRC_DIR}/TreeBuilderClassic.cpp
    ${SL_SRC_DIR}/TreeBuilderTree.cpp
    ${SL_SRC_DIR}/TreeBuilderGraph.cpp
    ${SL_SRC_DIR}/TreeBuilderThematic.cpp
    ${SL_SRC_DIR}/TreeBuilderThemes.cpp
    ${SL_SRC_DIR}/SimdKernels.cpp
)

target_compile_features(${PROJECT_NAME} PRIVATE cxx_std_23)

# Stub headers (PCH.h, Common.h) MUST come first so they shadow the real
# plugin headers that pull in RE/Skyrim.h and SKSE/SKSE.h.
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${SL_SRC_DIR}
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    hwy::hwy
    hwy::hwy_contrib
)

# Highway foreach_target dispatch must not be merged into unity build groups
set_source_files_properties(${SL_SRC_DIR}/SimdKernels.cpp PROPERTIES
    SKIP_UNITY_BUILD_INCLUSION ON
)
