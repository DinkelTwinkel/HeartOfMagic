# Distribution.cmake
# Assembles the release distribution folder after all targets are built.
# Requires: DIST_VERSION_DIR (from top-level CMakeLists.txt)
#           PAPYRUS_ISL_SOURCES, PAPYRUS_SPELLLEARNING_SOURCES, PAPYRUS_OUTPUT_DIR
#           (from Papyrus.cmake, if Papyrus compiler is available)

if(NOT DEFINED DIST_VERSION_DIR)
    message(STATUS "DIST_VERSION_DIR not defined - distribution assembly disabled")
    return()
endif()

# ============================================================================
# Distribution target - assembles release folder after all DLLs are built
# ============================================================================

add_custom_target(assemble_dist ALL
    COMMENT "Assembling release distribution...")

add_dependencies(assemble_dist SpellLearning DontEatSpellTomes SL_BookXP)

if(TARGET papyrus_build)
    add_dependencies(assemble_dist papyrus_build)
endif()

# ============================================================================
# 1. Clean and create directory structure
# ============================================================================

add_custom_command(TARGET assemble_dist POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E rm -rf "${DIST_VERSION_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${DIST_VERSION_DIR}/fomod"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${DIST_VERSION_DIR}/SKSE/Plugins"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${DIST_VERSION_DIR}/Scripts/Source"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${DIST_VERSION_DIR}/optional/ISLPatch/SKSE/Plugins"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${DIST_VERSION_DIR}/optional/ISLPatch/Scripts/Source"
    VERBATIM
)

# ============================================================================
# 2. Copy DLLs
# ============================================================================

add_custom_command(TARGET assemble_dist POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy
    "$<TARGET_FILE:SpellLearning>"
    "${DIST_VERSION_DIR}/SKSE/Plugins/"
    COMMAND "${CMAKE_COMMAND}" -E $<IF:$<BOOL:$<TARGET_PDB_FILE:SpellLearning>>,copy,true>
    "$<$<BOOL:$<TARGET_PDB_FILE:SpellLearning>>:$<TARGET_PDB_FILE:SpellLearning>>"
    "${DIST_VERSION_DIR}/SKSE/Plugins/"


    COMMAND "${CMAKE_COMMAND}" -E copy
    "$<TARGET_FILE:SL_BookXP>"
    "${DIST_VERSION_DIR}/SKSE/Plugins/"
    COMMAND "${CMAKE_COMMAND}" -E $<IF:$<BOOL:$<TARGET_PDB_FILE:SL_BookXP>>,copy,true>
    "$<$<BOOL:$<TARGET_PDB_FILE:SL_BookXP>>:$<TARGET_PDB_FILE:SL_BookXP>>"
    "${DIST_VERSION_DIR}/SKSE/Plugins/"

    COMMAND "${CMAKE_COMMAND}" -E copy
    "$<TARGET_FILE:DontEatSpellTomes>"
    "${DIST_VERSION_DIR}/optional/ISLPatch/SKSE/Plugins/"
    COMMAND "${CMAKE_COMMAND}" -E $<IF:$<BOOL:$<TARGET_PDB_FILE:DontEatSpellTomes>>,copy,true>
    "$<$<BOOL:$<TARGET_PDB_FILE:DontEatSpellTomes>>:$<TARGET_PDB_FILE:DontEatSpellTomes>>"
    "${DIST_VERSION_DIR}/optional/ISLPatch/SKSE/Plugins/"
    COMMAND "${CMAKE_COMMAND}" -E echo "Copying DLLs..."
    VERBATIM
)

# ============================================================================
# 3. Copy fomod files (info.xml is version-substituted by configure_file
#    in the top-level CMakeLists.txt)
# ============================================================================

add_custom_command(TARGET assemble_dist POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy
    "${CMAKE_SOURCE_DIR}/fomod/info.xml"
    "${DIST_VERSION_DIR}/fomod/"
    COMMAND "${CMAKE_COMMAND}" -E copy
    "${CMAKE_SOURCE_DIR}/fomod/ModuleConfig.xml"
    "${DIST_VERSION_DIR}/fomod/"
    COMMAND "${CMAKE_COMMAND}" -E echo "Copying fomod files..."
    VERBATIM
)

# ============================================================================
# 4. Copy SKSE runtime data (presets, custom_prompts, test_config)
# ============================================================================

add_custom_command(TARGET assemble_dist POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy_directory
    "${CMAKE_SOURCE_DIR}/SKSE/Plugins/SpellLearning"
    "${DIST_VERSION_DIR}/SKSE/Plugins/SpellLearning"
    COMMAND "${CMAKE_COMMAND}" -E echo "Copying SKSE runtime data..."
    VERBATIM
)

# ============================================================================
# 5. Copy PrismaUI views
# ============================================================================

add_custom_command(TARGET assemble_dist POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy_directory
    "${CMAKE_SOURCE_DIR}/PrismaUI/views"
    "${DIST_VERSION_DIR}/PrismaUI/views"
    COMMAND "${CMAKE_COMMAND}" -E echo "Copying PrismaUI views..."
    VERBATIM
)

# ============================================================================
# 6. Copy Papyrus scripts to distribution
#    SpellLearning scripts -> Scripts/ and Scripts/Source/
#    ISL scripts -> optional/ISLPatch/Scripts/ and optional/ISLPatch/Scripts/Source/
# ============================================================================

if(TARGET papyrus_build)
    # SpellLearning .psc sources and compiled .pex
    foreach(_psc_path IN LISTS PAPYRUS_SPELLLEARNING_SOURCES)
        get_filename_component(_name "${_psc_path}" NAME)
        get_filename_component(_name_we "${_psc_path}" NAME_WE)
        add_custom_command(TARGET assemble_dist POST_BUILD
            COMMAND "${CMAKE_COMMAND}" -E copy
            "${_psc_path}"
            "${DIST_VERSION_DIR}/Scripts/Source/${_name}"
            COMMAND "${CMAKE_COMMAND}" -E copy
            "${PAPYRUS_OUTPUT_DIR}/${_name_we}.pex"
            "${DIST_VERSION_DIR}/Scripts/${_name_we}.pex"
            VERBATIM
        )
    endforeach()

    # ISL .psc sources and compiled .pex
    foreach(_psc_path IN LISTS PAPYRUS_ISL_SOURCES)
        get_filename_component(_name "${_psc_path}" NAME)
        get_filename_component(_name_we "${_psc_path}" NAME_WE)
        add_custom_command(TARGET assemble_dist POST_BUILD
            COMMAND "${CMAKE_COMMAND}" -E copy
            "${_psc_path}"
            "${DIST_VERSION_DIR}/optional/ISLPatch/Scripts/Source/${_name}"
            COMMAND "${CMAKE_COMMAND}" -E copy
            "${PAPYRUS_OUTPUT_DIR}/${_name_we}.pex"
            "${DIST_VERSION_DIR}/optional/ISLPatch/Scripts/${_name_we}.pex"
            VERBATIM
        )
    endforeach()
endif()

# ============================================================================
# 7. Create zip archive of the distribution folder
# ============================================================================

get_filename_component(_dist_folder_name "${DIST_VERSION_DIR}" NAME)

add_custom_command(TARGET assemble_dist POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E tar cf
    "${DIST_DIR}/${_dist_folder_name}.zip"
    --format=zip
    -- "${_dist_folder_name}"
    WORKING_DIRECTORY "${DIST_DIR}"
    COMMAND "${CMAKE_COMMAND}" -E echo "Creating ${_dist_folder_name}.zip..."
    VERBATIM
)

message(STATUS "Distribution assembly configured:")
message(STATUS "  Output:   ${DIST_VERSION_DIR}")
message(STATUS "  Archive:  ${DIST_DIR}/${_dist_folder_name}.zip")
