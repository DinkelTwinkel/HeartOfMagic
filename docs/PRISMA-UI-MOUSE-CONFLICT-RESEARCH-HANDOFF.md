# Heart of Magic / Spell Learning – Prisma UI Mouse Lock – Conflict Research Handoff

Handoff for **Claude Code** to perform **research and assessment** to narrow down which **mod conflict** causes the Prisma UI mouse lock (cursor visible but not movable) in some load orders and not others. This doc defines the data sources, methodology, and deliverables. Implementation fixes remain in `projects/SpellLearning/docs/PRISMA-UI-MOUSE-BUG-HANDOFF.md`.

---

## Purpose

1. **Compare plugin lists** where the bug **happens** vs **does not happen**.
2. **Produce a prioritized candidate list** of plugins that appear only in “happens” (or differ in load order) and are likely to affect input/focus/menu (and thus are conflict suspects).
3. **Suggest a testing plan** (e.g. binary search) so the user or a follow-up session can confirm the culprit.
4. **Document the process** so the research can be re-run or updated when new lists are provided.

---

## Bug Summary (Context)

**Symptom:** When opening the Heart of Magic / Spell Learning Prisma UI (e.g. F9), the mouse cursor **appears** but **cannot be moved**. The UI is visible; input is effectively locked.

**Observed behavior:**

| Source | Mouse behavior |
|--------|----------------|
| `c:\Users\jason\Downloads\Plugins.txt` | **Happens** (mouse locked) |
| `c:\Users\jason\Downloads\plugins (1).txt` | **Does not happen** (mouse moves) |
| `g:\MODSTAGING\HIRCINE\profiles\Hymns of Hircine - Lord's Vision\plugins.txt` | **Happens** (mouse locked) |
| `g:\MODSTAGING\HIRCINE\profiles\Hymns of Hircine - Lord's Vision\modlist.txt` | Same profile as above (mod list order / install names) |

**Implication:** The issue is **load-order or mod-set dependent**. A plugin (or combination) present in the “happens” lists and absent or ordered differently in the “doesn’t happen” list is a conflict candidate.

---

## Data Sources (Canonical Paths)

Use these exact paths when scripting or re-running the research.

| Role | Path | Notes |
|------|------|--------|
| **Happens – list A** | `c:\Users\jason\Downloads\Plugins.txt` | Large list (~900+ plugins). |
| **Does not happen** | `c:\Users\jason\Downloads\plugins (1).txt` | Smaller list (~420+ plugins). |
| **Happens – list B** | `g:\MODSTAGING\HIRCINE\profiles\Hymns of Hircine - Lord's Vision\plugins.txt` | MO2 profile “Hymns of Hircine - Lord's Vision”. |
| **Mod list (same profile)** | `g:\MODSTAGING\HIRCINE\profiles\Hymns of Hircine - Lord's Vision\modlist.txt` | MO2 mod names/order; use to map plugin names to mods if needed. |

**Plugin list format:** One plugin per line; lines may start with `*` (enabled). Plugin name is the line with leading `*` stripped and trimmed (e.g. `*TrueHUD.esl` → `TrueHUD.esl`). Normalize to a single canonical form (e.g. lowercase or case-fold) when comparing.

---

## Research Tasks (For Claude Code)

### 1. Extract and normalize plugin names

- Parse each of the four files above (only the two `plugins.txt` and `plugins (1).txt` for plugin **sets**; `modlist.txt` is for mod-name context).
- From each `plugins.txt` / `plugins (1).txt`: collect **enabled** plugin names (lines starting with `*`). Strip `*` and trim. Normalize for comparison (e.g. case-insensitive or lowercased).
- Produce three sets:
  - **Happens_A** = plugins from `c:\Users\jason\Downloads\Plugins.txt`
  - **NoBug** = plugins from `c:\Users\jason\Downloads\plugins (1).txt`
  - **Happens_B** = plugins from `g:\MODSTAGING\HIRCINE\profiles\Hymns of Hircine - Lord's Vision\plugins.txt`

### 2. Compute candidate sets

- **Only_in_Happens_A** = Happens_A − NoBug (plugins in the first “happens” list but not in the “doesn’t happen” list).
- **Only_in_Happens_B** = Happens_B − NoBug.
- **Common_happens_only** = Only_in_Happens_A ∩ Only_in_Happens_B (plugins that appear in both “happens” lists and not in “doesn’t happen” — **high-priority candidates**).
- Optionally: **In_NoBug_but_not_Happens** = NoBug − (Happens_A ∪ Happens_B) to see what’s in the working list but missing in the broken ones (less likely to be the lock cause, but useful for completeness).

### 3. Prioritize candidates (for conflict likelihood)

Focus on plugins that **touch input, menu, UI, or camera**, e.g.:

- **Input / control:** Anything with “Input”, “Control”, “Hotkey”, “Key”, “Menu” (e.g. `InputBuffer.esl`, `TES4WaitMenu.esl`).
- **HUD / camera:** `TrueHUD`, `SmoothCam`, `SmoothCam.esl`, etc.
- **UI / overlay:** “UI”, “HUD”, “Overlay”, “Wheel”, “QuickLoot”, “RaceMenu”, “MCM”, “Extensions”.
- **Other Prisma / overlay frameworks:** Any mod known to use PrismaUI or similar in-game UI (e.g. ChatBox, Moody) — for **order** or **focus** conflicts, not necessarily “only in happens”.
- **SKSE / low-level:** Mods that register input sinks or menu hooks (often have “Fix”, “Tweak”, “Framework” in name and are known to hook input).

Sort the **Common_happens_only** list by this priority (input/UI/camera first), then output a **short list of top N candidates** (e.g. 15–30) for manual or binary-search testing.

### 4. Document results in this repo

- Add a **“Research results”** section (or separate `PRISMA-UI-MOUSE-CONFLICT-CANDIDATES.md`) under `projects/HeartOfMagic/docs/` containing:
  - Date of run and paths used.
  - Counts: |Happens_A|, |NoBug|, |Happens_B|, |Common_happens_only|.
  - The **prioritized candidate list** (top N) with a one-line reason (e.g. “Input buffer / menu”).
  - Optional: full set of **Common_happens_only** or a link to a generated file listing them.

### 5. Propose a testing plan

- **Binary search:** Split the top candidates into two groups; disable one half in MO2, test. If bug persists, switch to the other half; repeat until a single plugin (or small set) is identified.
- **Single-disable:** If the list is small, suggest disabling the top 5–10 candidates one at a time and testing after each.
- **Load order:** If two lists differ mainly by order (e.g. TrueHUD/SmoothCam/SpellLearning order), suggest moving Heart of Magic / SpellLearning (or PrismaUI) earlier/later and retesting.

---

## Suggested Script Location and Format

- **Script:** Add a small script (e.g. PowerShell or Python) under `projects/HeartOfMagic/scripts/` or `docs/` that:
  - Reads the three plugin list paths (or uses the canonical paths above).
  - Outputs the sets and the prioritized candidate list (and optionally writes `PRISMA-UI-MOUSE-CONFLICT-CANDIDATES.md`).
- **Format:** Plain text or Markdown table: plugin name, which set(s) it’s in, priority reason.

---

## Success Criteria

1. **Reproducible:** Another run of the script (or manual steps) on the same files produces the same candidate set.
2. **Prioritized:** At least one ordered list of conflict candidates (prioritized by input/UI/camera relevance).
3. **Actionable:** A short testing plan (binary search or single-disable) is documented.
4. **Linked:** This handoff and any results file reference `projects/SpellLearning/docs/PRISMA-UI-MOUSE-BUG-HANDOFF.md` for **code-side** hypotheses and fixes (focus deferral, EnsureFocusReleased on load, etc.), so that once a conflict plugin is found, both “workaround (disable/reorder)” and “code fix” can be considered.

---

## References

- **Code / fix context:** `projects/SpellLearning/docs/PRISMA-UI-MOUSE-BUG-HANDOFF.md` — UIManager ShowPanel/Focus, EnsureFocusReleased, input handler, PrismaUI API.
- **Project:** Heart of Magic (Spell Learning) — `projects/HeartOfMagic/`, `projects/SpellLearning/`; Prisma UI panel opened via hotkey (default F9).
- **Workspace rules:** `CLAUDE.md` at repo root (paths, deploy, release).

---

## Optional: Quick Reference – Files to Create/Update

| File | Action |
|------|--------|
| `projects/HeartOfMagic/docs/PRISMA-UI-MOUSE-CONFLICT-RESEARCH-HANDOFF.md` | This handoff (done). |
| `projects/HeartOfMagic/docs/PRISMA-UI-MOUSE-CONFLICT-CANDIDATES.md` | Create when research is run; store candidate list and counts. |
| `projects/HeartOfMagic/scripts/Compare-PluginListsForMouseConflict.ps1` (or similar) | Optional: script that parses the three plugin lists and outputs candidates. |

Once the conflict plugin(s) are identified, update `PRISMA-UI-MOUSE-BUG-HANDOFF.md` (or COMMON-ERRORS) with “Known conflict: Mod X – workaround: disable or load after Y.”
