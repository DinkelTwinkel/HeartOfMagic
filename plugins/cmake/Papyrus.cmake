# Papyrus.cmake
# Configures Papyrus script compilation during build

# Early exit if DIST_VERSION_DIR is not defined
if(NOT DEFINED DIST_VERSION_DIR)
    message(STATUS "DIST_VERSION_DIR not defined - Papyrus script distribution disabled")
    return()
endif()

set(PAPYRUS_COMPILER "${CMAKE_SOURCE_DIR}/external/papyrus-compiler/papyrus.exe")

if(EXISTS "${PAPYRUS_COMPILER}")
    set(PAPYRUS_HEADERS_DIR "${CMAKE_SOURCE_DIR}/papyrus_scripts/headers")
    set(PAPYRUS_SOURCES_DIR "${CMAKE_SOURCE_DIR}/papyrus_scripts/sources")
    set(PAPYRUS_OUTPUT_DIR "${BUILD_ROOT}/papyrus_scripts/output")
    set(PAPYRUS_BUILD_STAMP "${BUILD_ROOT}/papyrus_build.stamp")

    # Collect all Papyrus sources and headers for dependency tracking
    set(PAPYRUS_SOURCES
        "${PAPYRUS_SOURCES_DIR}/PrismaUI_Example_mcmscript.psc"
        "${PAPYRUS_SOURCES_DIR}/PrismaUI_NativeFunctions.psc"
    )

    # Ensure output directory exists
    file(MAKE_DIRECTORY "${PAPYRUS_OUTPUT_DIR}")

    add_custom_command(
        OUTPUT "${PAPYRUS_BUILD_STAMP}"
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${PAPYRUS_OUTPUT_DIR}"
        COMMAND "${PAPYRUS_COMPILER}" -nocache -h "${PAPYRUS_HEADERS_DIR}" -i "${PAPYRUS_SOURCES_DIR}" -output "${PAPYRUS_OUTPUT_DIR}"
        COMMAND "${CMAKE_COMMAND}" -E touch "${PAPYRUS_BUILD_STAMP}"
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
        DEPENDS ${PAPYRUS_SOURCES}
        COMMENT "Compiling Papyrus scripts..."
        VERBATIM
    )

    add_custom_target(papyrus_build ALL DEPENDS "${PAPYRUS_BUILD_STAMP}")

    # Make main project depend on Papyrus build
    add_dependencies(${PROJECT_NAME} papyrus_build)

    # Post-build: Copy .psc and .pex files into distribution folders
    add_custom_command(
        TARGET ${PROJECT_NAME}
        POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${DIST_VERSION_DIR}/scripts/source"
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${DIST_VERSION_DIR}/scripts"
        COMMAND "${CMAKE_COMMAND}" -E copy_directory "${PAPYRUS_SOURCES_DIR}" "${DIST_VERSION_DIR}/scripts/source"
        COMMAND "${CMAKE_COMMAND}" -E copy_directory "${PAPYRUS_OUTPUT_DIR}" "${DIST_VERSION_DIR}/scripts"
        COMMENT "Copying Papyrus scripts to ${DIST_VERSION_DIR}"
        VERBATIM
    )

    message(STATUS "Papyrus script compilation configured:")
    message(STATUS "  Compiler:    ${PAPYRUS_COMPILER}")
    message(STATUS "  Headers:     ${PAPYRUS_HEADERS_DIR}")
    message(STATUS "  Sources:     ${PAPYRUS_SOURCES_DIR}")
    message(STATUS "  Output:      ${PAPYRUS_OUTPUT_DIR}")
    message(STATUS "  Destination: ${DIST_VERSION_DIR}/scripts")
    message(STATUS "NOTE: Reconfigure CMake if you add new script files")
else()
    message(FATAL_ERROR "Papyrus compiler not found at ${PAPYRUS_COMPILER}. Please place papyrus.exe under external/papyrus-compiler/")
endif()
