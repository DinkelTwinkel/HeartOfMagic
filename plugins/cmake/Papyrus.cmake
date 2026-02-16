# Papyrus.cmake
# Configures Papyrus script compilation during build.
# Exports: PAPYRUS_ISL_SOURCES, PAPYRUS_SPELLLEARNING_SOURCES, PAPYRUS_OUTPUT_DIR
#          (consumed by Distribution.cmake for release folder assembly)

# Early exit if DIST_VERSION_DIR is not defined
if(NOT DEFINED DIST_VERSION_DIR)
    message(STATUS "DIST_VERSION_DIR not defined - Papyrus script compilation disabled")
    return()
endif()

set(PAPYRUS_COMPILER "${CMAKE_SOURCE_DIR}/plugins/external/papyrus-compiler/papyrus.exe")

if(EXISTS "${PAPYRUS_COMPILER}")
    set(PAPYRUS_HEADERS_DIR "${CMAKE_SOURCE_DIR}/Scripts/headers")
    set(PAPYRUS_SOURCES_DIR "${CMAKE_SOURCE_DIR}/Scripts/Source")
    set(PAPYRUS_OUTPUT_DIR "${CMAKE_BINARY_DIR}/Scripts/output")
    set(PAPYRUS_BUILD_STAMP "${CMAKE_BINARY_DIR}/Scripts_build.stamp")

    # ISL compatibility scripts (distributed to optional/ISLPatch/)
    set(PAPYRUS_ISL_SOURCES
        "${PAPYRUS_SOURCES_DIR}/DEST_AliasExt.psc"
        "${PAPYRUS_SOURCES_DIR}/DEST_ISL_PlayerSpellLearningScript.psc"
        "${PAPYRUS_SOURCES_DIR}/DEST_UIExt.psc"
    )

    # SpellLearning core scripts (distributed to Scripts/)
    set(PAPYRUS_SPELLLEARNING_SOURCES
        "${PAPYRUS_SOURCES_DIR}/DEST_FormExt.psc"
        "${PAPYRUS_SOURCES_DIR}/SL_BookXP_QuestScript.psc"
        "${PAPYRUS_SOURCES_DIR}/SpellLearning_Bridge.psc"
        "${PAPYRUS_SOURCES_DIR}/SpellLearning_DEST_Handler.psc"
        "${PAPYRUS_SOURCES_DIR}/SpellLearning_DEST.psc"
        "${PAPYRUS_SOURCES_DIR}/SpellLearning_ISL_Handler.psc"
        "${PAPYRUS_SOURCES_DIR}/SpellLearning_ISL.psc"
        "${PAPYRUS_SOURCES_DIR}/SpellLearning_QuestScript.psc"
        "${PAPYRUS_SOURCES_DIR}/SpellLearning.psc"
    )

    # Ensure output directory exists
    file(MAKE_DIRECTORY "${PAPYRUS_OUTPUT_DIR}")

    # Single compiler invocation — all scripts are in the same source directory
    add_custom_command(
        OUTPUT "${PAPYRUS_BUILD_STAMP}"
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${PAPYRUS_OUTPUT_DIR}"
        COMMAND "${PAPYRUS_COMPILER}" -nocache
            -h "${PAPYRUS_HEADERS_DIR}"
            -i "${PAPYRUS_SOURCES_DIR}"
            -output "${PAPYRUS_OUTPUT_DIR}"
        COMMAND "${CMAKE_COMMAND}" -E touch "${PAPYRUS_BUILD_STAMP}"
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
        DEPENDS ${PAPYRUS_ISL_SOURCES} ${PAPYRUS_SPELLLEARNING_SOURCES}
        COMMENT "Compiling Papyrus scripts..."
        VERBATIM
    )

    add_custom_target(papyrus_build ALL DEPENDS "${PAPYRUS_BUILD_STAMP}")

    message(STATUS "Papyrus script compilation configured:")
    message(STATUS "  Compiler:    ${PAPYRUS_COMPILER}")
    message(STATUS "  Headers:     ${PAPYRUS_HEADERS_DIR}")
    message(STATUS "  Sources:     ${PAPYRUS_SOURCES_DIR}")
    message(STATUS "  Output:      ${PAPYRUS_OUTPUT_DIR}")
    message(STATUS "NOTE: Reconfigure CMake if you add new script files")
else()
    message(WARNING
        "Papyrus compiler not found at ${PAPYRUS_COMPILER}. "
        "Papyrus script compilation will be skipped. "
        "Place papyrus.exe under plugins/external/papyrus-compiler/ to enable.")
endif()
