# Translating Heart of Magic

Heart of Magic supports community translations. The UI text is driven by a lightweight i18n system that loads language files at startup.

## How It Works

All translatable strings are stored in JSON files in the `lang/` folder inside the mod's PrismaUI directory:

```
Data/PrismaUI/views/SpellLearning/SpellLearningPanel/
  lang/
    en.json          <- English (default)
    fr.json          <- your translation goes here
    TRANSLATING.md   <- detailed translation reference
```

Under MO2, this is inside the mod folder:
```
MO2/mods/HeartOfMagic_RELEASE/PrismaUI/views/SpellLearning/SpellLearningPanel/lang/
```

## Creating a Translation

### 1. Copy the English file

Copy `lang/en.json` and rename it to your language code:

| Code | Language | Filename |
|------|----------|----------|
| `fr` | French | `fr.json` |
| `de` | German | `de.json` |
| `es` | Spanish | `es.json` |
| `pt-br` | Brazilian Portuguese | `pt-br.json` |
| `ru` | Russian | `ru.json` |
| `zh-cn` | Simplified Chinese | `zh-cn.json` |
| `zh-tw` | Traditional Chinese | `zh-tw.json` |
| `ja` | Japanese | `ja.json` |
| `ko` | Korean | `ko.json` |
| `it` | Italian | `it.json` |
| `pl` | Polish | `pl.json` |

### 2. Translate the values

Open the JSON file and translate the **values** (right side). Do NOT change the **keys** (left side):

```json
{
    "_meta": {
        "language": "Francais",
        "locale": "fr",
        "author": "Your Name",
        "version": "1.0.0"
    },
    "settings.devDebug.title": "Developpeur et debogage",
    "settings.devDebug.cheatMode": "Mode triche"
}
```

### 3. Handle variables and HTML

Some strings have `{{variable}}` placeholders — keep them exactly as-is but you can reposition them:

```json
"progression.xpProgress": "{{current}} / {{required}} XP"
```

Some strings have HTML tags — keep the tags, translate the text:

```json
"settings.devDebug.cheatModeActive": "(!) <strong>Mode triche actif!</strong>"
```

### 4. Set the active language

In `index.html`, find this line near the bottom:

```html
<script>initI18n('en');</script>
```

Change `'en'` to your locale code:

```html
<script>initI18n('fr');</script>
```

## Testing

1. Place your translation file in the `lang/` folder
2. Update the `initI18n()` call in `index.html`
3. Launch Skyrim and open the Heart of Magic panel
4. Missing translations fall back to the English text in the HTML — untranslated strings appear in English, not as broken keys

## String Organization

Translation keys are organized by UI section:

| Prefix | Section |
|--------|---------|
| `header.*` | Top bar / title |
| `tabs.*` | Tab labels |
| `scanner.*` | Spell scanner |
| `tree.*` | Tree viewer |
| `settings.*` | Settings panel |
| `detail.*` | Spell detail panel |
| `status.*` | Status messages |
| `progression.*` | Progression / XP text |
| `buttons.*` | Button labels |
| `modals.*` | Modal / dialog text |

## Tips

- Keep translations concise — UI space is limited, especially for button labels
- Test with longer strings to check for overflow
- You don't need to translate every key to get started — untranslated strings stay in English
- Check `index.html` to see where a key is used if the context is unclear (look for `data-i18n="your.key"`)

## Sharing Your Translation

Share your `XX.json` file on the mod's Nexus page or submit it as a community contribution. Include:
- The language file
- Your name/credit
- Which version of Heart of Magic it was translated for

Users install it by dropping the file into their `lang/` folder and changing the `initI18n()` call.

## Detailed Reference

For the full translation specification (API details, DOM attributes, interpolation rules), see `lang/TRANSLATING.md` inside the PrismaUI folder.
