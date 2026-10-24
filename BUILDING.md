# Building Feather & Frame

## What's here

- `module.json`: the manifest. Change `version` here before each release.
- `src/main.js`: the Foundry side (window, Send to Actor, map preview, sheet buttons).
- `src/tool.html`: the tool page (layout, styles and all the image code). The `__RING__`, `__FAVICON__`, `__DISCORD_SERVER__` and `__DISCORD_USER__` markers are replaced with the images from `assets/` during the build.
- `src/ccs.css`: styles for the Foundry window and the sheet buttons.
- `assets/`: the default ring, the icon and the two Discord pictures.
- `build.mjs`: the build script.

## Build

You need Node.js 18 or newer (nodejs.org). In this folder, run:

```
node build.mjs
```

It writes everything to `dist/`:

- `dist/feather-and-frame/`: the module folder. To test, copy it into your Foundry `Data/modules` folder, then restart Foundry.
- `dist/feather-and-frame.zip` and `dist/module.json`: the two files to attach to a GitHub release.
- `dist/feather-and-frame.html`: the standalone tool page. Open it in Chrome or Edge.

## Release

1. Raise `version` in `module.json` (for example 0.9.14 to 0.9.15).
2. Run `node build.mjs`.
3. On GitHub, draft a release tagged with the new version and attach `dist/module.json` and `dist/feather-and-frame.zip`.

The script and style names in the build carry the version (`main-0.9.15.js`), so Foundry can't keep running a cached older copy after an update.
