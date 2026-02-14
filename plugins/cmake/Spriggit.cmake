# GamePlugin.cmake
# Configures Spriggit serialization (text format -> .esp binary plugin)

# Early exit if DIST_VERSION_DIR is not defined
if(NOT DEFINED DIST_VERSION_DIR)
    message(STATUS "DIST_VERSION_DIR not defined - game plugin serialization disabled")
    return()
endif()

# Check if Spriggit CLI is available
set(SPRIGGIT_VERSION "0.40.0" CACHE STRING "Spriggit CLI version")

set(SPRIGGIT_CLI "${CMAKE_SOURCE_DIR}/external/SpriggitCLI-${SPRIGGIT_VERSION}/Spriggit.CLI.exe")

if(EXISTS "${SPRIGGIT_CLI}")
    # Plugin source and output directories
    set(PLUGIN_SOURCE_DIR "${CMAKE_SOURCE_DIR}/plugins/prismaui_example")
    set(PLUGIN_BUILD_DIR "${BUILD_ROOT}/external_builds/plugins")
    set(PLUGIN_ESP_FILE "${PLUGIN_BUILD_DIR}/prismaui_example.esp")
    set(PLUGIN_DEST_DIR "${DIST_VERSION_DIR}")

    # Check if plugin source directory exists
    if(EXISTS "${PLUGIN_SOURCE_DIR}")
        message(STATUS "Game plugin source found - configuring serialization")

        # Collect all plugin source files for dependency tracking
        # NOTE: GLOB_RECURSE collects files at configure time. If you add new plugin files,
        # you must reconfigure CMake for those files to be tracked as dependencies.
        file(GLOB_RECURSE PLUGIN_SOURCES
            "${PLUGIN_SOURCE_DIR}/*.json"
        )

        # Stamp file to track last serialization - use shared location outside preset-specific build folder
        set(PLUGIN_BUILD_STAMP "${BUILD_ROOT}/plugin_build.stamp")

        # Ensure output directory exists
        file(MAKE_DIRECTORY "${PLUGIN_BUILD_DIR}")

        # Create custom command that only runs when sources change
        add_custom_command(
            OUTPUT "${PLUGIN_BUILD_STAMP}"
            COMMAND "${SPRIGGIT_CLI}" convert-to-plugin -i "${PLUGIN_SOURCE_DIR}" -o "${PLUGIN_ESP_FILE}"
            COMMAND ${CMAKE_COMMAND} -E touch "${PLUGIN_BUILD_STAMP}"
            WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
            DEPENDS ${PLUGIN_SOURCES}
            COMMENT "Serializing game plugin from Spriggit text format..."
            VERBATIM
        )

        # Create target that depends on the stamp file
        add_custom_target(plugin_build ALL DEPENDS "${PLUGIN_BUILD_STAMP}")

        # Make main project depend on plugin build
        add_dependencies(${PROJECT_NAME} plugin_build)

        # Post-build: Copy .esp to output folder
        add_custom_command(
            TARGET ${PROJECT_NAME}
            POST_BUILD
            COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${PLUGIN_ESP_FILE}" "${PLUGIN_DEST_DIR}/prismaui_example.esp"
            COMMENT "Copying prismaui_example.esp to ${PLUGIN_DEST_DIR}"
            VERBATIM
        )

        # Print helpful messages
        message(STATUS "Game plugin serialization configured:")
        message(STATUS "  Source:      ${PLUGIN_SOURCE_DIR}")
        message(STATUS "  Build:       ${PLUGIN_ESP_FILE}")
        message(STATUS "  Destination: ${PLUGIN_DEST_DIR}")
        message(STATUS "NOTE: Reconfigure CMake if you add new plugin source files")
    else()
        message(FATAL_ERROR "Plugin source directory not found at ${PLUGIN_SOURCE_DIR}")
    endif()
else()
    message(FATAL_ERROR "Spriggit CLI not found at ${SPRIGGIT_CLI}. Please extract SpriggitCLI-${SPRIGGIT_VERSION} to external/")
endif()
