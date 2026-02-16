# Translating Heart of Magic

Thank you for helping translate Heart of Magic! This guide explains how to create a translation for the Spell Learning panel.

## Quick Start

1. Copy `en.json` and rename it to your language code (e.g. `fr.json`, `de.json`, `es.json`)
2. Translate the values (right side of each line) - **do NOT change the keys** (left side)
3. Update the `_meta` section with your language name and your name as author
4. **Generate the `.js` preload file** (see [Generating the Preload File](#generating-the-preload-file)) - **required for in-game use**
5. Edit `locale.js` and change `'en'` to your locale code
6. Test in-game

> **Why both `.json` and `.js`?** Skyrim uses an embedded browser (Ultralight) that cannot load `.json` files via network requests. The `.js` preload injects your translations directly via a `<script>` tag, which always works. The `.json` is the human-editable source; the `.js` is what the game actually reads.

## What to Translate

### File Format

Translation files are flat JSON. Each line is a `"key": "value"` pair:

```json
{
    "settings.devDebug.title": "Developer & Debug",
    "settings.devDebug.cheatMode": "Cheat Mode"
}
```

- **Keys** (left side) - Do NOT change these. They are IDs used by the code.
- **Values** (right side) - Translate these into your language.

### Variables

Some strings contain `{{variable}}` placeholders replaced at runtime:

```json
"progression.stageN": "Stage {{n}}",
"footer.spellCount": "{{total}} spells | {{unlocked}} unlocked"
```

- Keep `{{variableName}}` exactly as-is (don't translate inside the braces)
- You can reorder them to match your language's grammar
- Example: `"footer.spellCount": "{{total}} Zauber | {{unlocked}} freigeschaltet"`

### HTML in Values

A few keys contain HTML tags. Keep the tags intact, translate only the text:

```json
"settings.devDebug.cheatModeActive": "(!) <strong>Cheat mode active!</strong>"
```

### The _meta Section

Update this with your translation info:

```json
{
    "_meta": {
        "language": "Deutsch",
        "locale": "de",
        "author": "Your Name",
        "version": "2.0.0"
    }
}
```

### Missing Keys

If a key is missing from your file, the English text from the HTML is shown as fallback. You don't need to translate every key to get started.

## Generating the Preload File

You need **both** files: the `.json` (source of truth you edit) and the `.js` (what the game loads at runtime).

### Option A: Use the build script (easiest)

A build script is included that generates `.js` preloads for **all** `.json` files in `lang/`:

```
node lang/build-preloads.js
```

Output:
```
  en.js  (541 keys from en.json)
  fr.js  (541 keys from fr.json)
  de.js  (541 keys from de.json)
Done - 3 preload file(s) generated.
```

Run this any time you update your `.json` translation.

### Option B: Manual method (no tools needed)

1. Copy `en.js` and rename it to your locale (e.g. `de.js`)
2. Replace every English value with the matching translation from your `.json`
3. Make sure `_meta.locale` matches your locale code
4. The format is flat dot-notation:
   ```js
   window._i18nPreload = {
       "_meta.language": "Deutsch",
       "_meta.locale": "de",
       "settings.devDebug.title": "Entwickler & Debug",
       // ... all keys
   };
   ```

## Your Translation Package

A complete translation should contain these files, rooted at `data/PrismaUI/views/SpellLearning/SpellLearningPanel/lang/`:

| File | Required | Purpose |
|------|----------|---------|
| `<locale>.json` | Yes | Translation source (human-editable) |
| `<locale>.js` | Yes | Preload file (what the game loads) |
| `locale.js` | Yes | Sets `window._i18nLocale` to your locale code |

**Example folder for a German translation:**
```
lang/
  de.json       <-- your translation
  de.js         <-- generated preload (node lang/build-preloads.js)
  locale.js     <-- contains: window._i18nLocale = 'de';
```

Users install your translation by dropping these 3 files into the `lang/` folder (or as an MO2 mod that overlays them).

## Testing

1. Place your files in the `lang/` folder
2. Verify `locale.js` has your locale code:
   ```js
   window._i18nLocale = 'de';
   ```
3. Launch the game and open the Heart of Magic panel
4. If testing in a browser (dev harness), check console (F12) for `[i18n]` messages:
   - `[i18n] Loaded locale "de" from preload (541 keys)` = working
   - `[i18n] Preload is "en" but requested "de"` = missing `de.js` preload

**Note:** You do NOT need to edit `index.html`. The loading system automatically picks up any locale that has a matching `.js` preload file.

## Key Naming Convention

Keys use dot-notation organized by UI section:

| Prefix | Section |
|--------|---------|
| `header.*` | Top bar / title |
| `tabs.*` | Tab labels |
| `scanner.*` | Spell scanner |
| `tree.*` | Tree viewer |
| `settings.*` | Settings panel |
| `details.*` | Spell detail panel |
| `status.*` | Status bar messages |
| `progression.*` | Progression / XP text |
| `buttons.*` | Button labels |
| `modals.*` | Modal / dialog text |
| `footer.*` | Footer bar |
| `prm.*` | Pre Req Master |
| `preview.*` | Tree preview settings |

## Locale Codes

Use standard language codes:

| Code | Language |
|------|----------|
| `en` | English |
| `fr` | French |
| `de` | German |
| `es` | Spanish |
| `pt-br` | Brazilian Portuguese |
| `ru` | Russian |
| `zh-cn` | Simplified Chinese |
| `zh-tw` | Traditional Chinese |
| `ja` | Japanese |
| `ko` | Korean |
| `it` | Italian |
| `pl` | Polish |
| `tr` | Turkish |

## Tips

- Keep translations concise - UI space is limited
- Test with longer strings to make sure they don't overflow
- If unsure about context, check `index.html` to see where a key is used - the `data-i18n` attribute on an element tells you its key
- The `_meta.version` should match the version of `en.json` you translated from, so we can tell if your translation needs updating
