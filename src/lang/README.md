# iglo.monitor translations

Translations live in this repository under `src/lang/`. The English catalog, `en.json`, defines the translation keys. Existing catalogs were inherited from Uptime Kuma; that project's Weblate instance does not manage iglo.monitor translations.

To update a translation, edit its JSON catalog and preserve interpolation names such as `{name}`, `{0}`, and linked message references. Keep project references spelled `iglo.monitor`.

To add a language, create its catalog and add the language code and display name to `languageList` in [src/i18n.ts](../i18n.ts). Missing messages fall back to English.

Validate catalogs with:

```bash
bun test ./test/backend-test/check-translations.test.ts
bun run build:frontend
```

The canonical repository is [iglo-tech/iglo.monitor](https://github.com/iglo-tech/iglo.monitor), on the `main` branch.
