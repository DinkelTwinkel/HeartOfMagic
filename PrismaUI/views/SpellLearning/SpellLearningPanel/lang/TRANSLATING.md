# Translating Heart of Magic

Thank you for helping translate Heart of Magic! This guide explains how to create a translation for the Spell Learning panel.

## Quick Start

1. Copy `en.json` and rename it to your language code (e.g. `fr.json`, `de.json`, `es.json`, `pt-br.json`)
2. Translate the values (right side of each line) - **do NOT change the keys** (left side)
3. Update the `_meta` section with your language name and your name as author
4. Edit `lang/locale.js` and change `'en'` to your locale code (e.g. `'fr'`)
5. Test in-game by opening the Heart of Magic panel

**Important:** Only edit `locale.js` to set your language - do NOT edit `index.html`. The `locale.js` file is safe to overwrite and will not be changed by mod updates.

## File Format

Translation files are JSON. Each line is a `"key": "value"` pair:

```json
{
    "settings.devDebug.title": "Developer & Debug",
    "settings.devDebug.cheatMode": "Cheat Mode"
}
```

- **Keys** (left side) - Do NOT change these. They are IDs used by the code.
- **Values** (right side) - Translate these into your language.

## Variables / Interpolation

Some strings contain `{{variable}}` placeholders that get replaced with dynamic values at runtime:

```json
{
    "progression.stage": "Stage {{number}}",
    "progression.xpProgress": "{{current}} / {{required}} XP"
}
```

**Rules:**
- Keep the `{{variableName}}` exactly as-is (don't translate what's inside the braces)
- You can move the variable to a different position in the sentence to match your language's grammar
- Example for German: `"progression.stage": "Stufe {{number}}"`

## HTML in Values

A few keys use HTML tags (like `<strong>`). Keep the HTML tags intact:

```json
{
    "settings.devDebug.cheatModeActive": "(!) <strong>Cheat mode active!</strong>"
}
```

These use `data-i18n-html` in the code and will render the HTML. Only translate the text, not the tags.

## The _meta Section

Update this with your translation's info:

```json
{
    "_meta": {
        "language": "Francais",
        "locale": "fr",
        "author": "Your Name",
        "version": "1.0.0"
    }
}
```

## Missing Keys

If a key is missing from your translation file, the English text from the HTML will be shown as a fallback. You don't need to translate every single key to get started - untranslated strings will just appear in English.

## Testing Your Translation

1. Place your translation file (e.g. `fr.json`) in the `lang/` folder
2. Edit `lang/locale.js` and change `'en'` to your locale code:
   ```js
   window._i18nLocale = 'fr';
   ```
3. Launch the game and open the Heart of Magic panel
4. Check the browser console (F12 in dev harness) for any `[i18n]` messages

**Note:** You do NOT need to edit `index.html`. The `locale.js` file controls which language is loaded. This file is specifically designed to be overwritten by translators and will not be changed by mod updates.

## Key Naming Convention

Keys use dot-notation to organize by UI section:

| Prefix | Section |
|--------|---------|
| `header.*` | Top bar / title |
| `tabs.*` | Tab labels |
| `scanner.*` | Spell scanner |
| `tree.*` | Tree viewer |
| `settings.*` | Settings panel |
| `settings.devDebug.*` | Developer & Debug settings |
| `detail.*` | Spell detail panel |
| `status.*` | Status messages |
| `progression.*` | Progression/XP text |
| `buttons.*` | Button labels |
| `modals.*` | Modal/dialog text |

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

## Tips

- Keep translations concise - UI space is limited
- Test with longer strings to make sure they don't overflow
- If unsure about context, check `index.html` to see where the key is used
- The `data-i18n` attribute on an HTML element tells you its translation key
