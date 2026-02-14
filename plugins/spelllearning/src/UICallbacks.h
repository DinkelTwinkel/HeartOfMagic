#pragma once

#include "PCH.h"
#include "PrismaUI.h"

// Forward declarations
class UIManager;

namespace UICallbacks {

/**
 * UICallbacks namespace contains all the callback handler declarations
 * organized by category. These functions are called from UIManager::OnDomReady
 * when JavaScript sends messages to C++.
 * 
 * Each category is implemented in its own .cpp file for maintainability.
 */

// =============================================================================
// SCANNER CALLBACKS (UICallbacks_Scanner.cpp)
// =============================================================================

void OnScanSpells(UIManager* ui, const char* argument);
void OnSaveOutput(UIManager* ui, const char* argument);
void OnSaveOutputBySchool(UIManager* ui, const char* argument);

// =============================================================================
// TREE CALLBACKS (UICallbacks_Tree.cpp)
// =============================================================================

void OnLoadSpellTree(UIManager* ui, const char* argument);
void OnSaveSpellTree(UIManager* ui, const char* argument);
void OnLoadPrompt(UIManager* ui, const char* argument);
void OnSavePrompt(UIManager* ui, const char* argument);
void OnGetSpellInfo(UIManager* ui, const char* argument);
void OnGetSpellInfoBatch(UIManager* ui, const char* argument);

// =============================================================================
// PROGRESSION CALLBACKS (UICallbacks_Progression.cpp)
// =============================================================================

void OnSetLearningTarget(UIManager* ui, const char* argument);
void OnClearLearningTarget(UIManager* ui, const char* argument);
void OnUnlockSpell(UIManager* ui, const char* argument);
void OnGetProgress(UIManager* ui, const char* argument);
void OnGetPlayerKnownSpells(UIManager* ui, const char* argument);
void OnCheatUnlockSpell(UIManager* ui, const char* argument);
void OnRelockSpell(UIManager* ui, const char* argument);
void OnSetSpellXP(UIManager* ui, const char* argument);

// =============================================================================
// SETTINGS CALLBACKS (UICallbacks_Settings.cpp)
// =============================================================================

void OnLoadSettings(UIManager* ui, const char* argument);
void OnSaveSettings(UIManager* ui, const char* argument);
void OnLoadUnifiedConfig(UIManager* ui, const char* argument);
void OnSaveUnifiedConfig(UIManager* ui, const char* argument);
void OnSetHotkey(UIManager* ui, const char* argument);

// =============================================================================
// CLIPBOARD CALLBACKS (UICallbacks_Settings.cpp)
// =============================================================================

void OnCopyToClipboard(UIManager* ui, const char* argument);
void OnGetClipboard(UIManager* ui, const char* argument);

// =============================================================================
// LLM CALLBACKS (OpenRouter integration)
// =============================================================================

void OnCheckLLM(UIManager* ui, const char* argument);
void OnLLMGenerate(UIManager* ui, const char* argument);
void OnPollLLMResponse(UIManager* ui, const char* argument);
void OnLoadLLMConfig(UIManager* ui, const char* argument);
void OnSaveLLMConfig(UIManager* ui, const char* argument);

} // namespace UICallbacks
