# Feather & Frame

A Foundry VTT module for making dynamic ring tokens. Load your character art, fit it to the ring, and send it straight to an actor.

## Install

In Foundry's setup screen, open Add-on Modules, click Install Module and paste this manifest URL:

```
https://github.com/Crow-ley/Feather-and-Frame/releases/latest/download/module.json
```

It needs Foundry v13 or newer. I use it with the dnd5e and Tidy 5e sheets, on the desktop, it also works on ForgeVTT.

## Features

- Auto-fit places the art in the ring. Standard tokens are 1024 px; Oversized tokens are 2048 px for art that spills well past the grid square.
- Overhang corners for quick tokens.
- Restore and Erase brushes, plus Lasso and Fuzzy select
- One-click removal for plain backgrounds
- Uses the ring picked in Foundry's Dynamic Token Ring setting, colored the way the actor's token will look
- Custom rings, and backgrounds with a saved ring library.
- Combine custom rings and backgrounds into dynamic rings, built into Foundry.
- Inner Ring Overhang for dynamic rings
- Tokens keep up with ring changes. Switch the world’s ring and the next time the world loads, tokens are rebuilt from their saved edits to fit the new ring. Hand changed tokens are left alone
- An option to bake the ring into the image for VTTs without dynamic rings
- Send to Actor uploads the token, turns on the ring and sets the scale values for you. It can also set the portrait (the original image or another one you pick) and update tokens already placed on scenes.
- Wildcard sets: send several tokens as one set and Foundry gives each token you place a random one, ring included. You can add more to a set later, and choose which token's original art becomes the portrait.
- Saved edits: each send can keep the token's edits with the actor. Next time you pick the actor it will load from where you left off.
- Works with actors stored in compendiums (GM only, can be turned off in the settings): drag one from a compendium onto the actor box. Sending changes the compendium entry, so unlock the compendium first.
- Actor search bar for worlds with many actors
- Preview on Map shows your edits on the actor's token in the open scene before you send. Only you see it.
- Drag tokens from the list next to the one you're editing to compare them.
- Ctrl+Z undoes brush strokes, moves and scaling.
- A GM setting lets players make tokens for characters they own. Players without Foundry's upload permission can still use it: their token goes to a GM, who sees a preview and approves it before anything is uploaded.

## Usage

Click on a character's portrait while the sheet is in edit mode to open the tool, shift+click to change the portrait like normal. You can also open it from the Actors sidebar or an actor's right-click menu. Load an image, adjust it, pick the actor and click Send to Actor.

Standard tokens get a token scale of 1 and a ring scale correction of 1. Oversized tokens get 2 and 2. You can change these in the module settings.

## Without Foundry

The tool also works on its own for other VTTs or plain token making. Each release has two downloads for this:

- `Feather.Frame.html`, the same tool as a single web page that opens in any browser.

Both make the same ringed tokens as the module and save them as WebP files. Without Foundry there's no dynamic ring to read, so they use a plain default ring, or a custom ring you load. Bake the ring into the image for VTTs that don't have dynamic rings.

## Outside connections

This module makes no outside requests

The fonts, icons and images ship with the module. The two fonts, IM Fell English SC and Alegreya Sans, are under the SIL Open Font License; the license files are in `assets/fonts`.

## Credits

Code written with help from Claude (AI).

## License

The code is under the MIT License; see [LICENSE](LICENSE). The fonts keep their own SIL Open Font License.

## Help

If something isn't working, join the [Burn Bin Inn Discord server](https://discord.gg/HXHdzXR6mC) or send me a DM on Discord at .mordecai.
