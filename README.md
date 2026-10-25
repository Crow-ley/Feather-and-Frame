# Feather & Frame

A Foundry VTT module for making dynamic ring tokens. Load your character art, fit it to the ring, and send it straight to an actor.

## Install

In Foundry's setup screen, open Add-on Modules, click Install Module and paste this manifest URL:

```
https://github.com/Crow-ley/Feather-and-Frame/releases/latest/download/module.json
```

It needs Foundry v13 or newer. I use it with the dnd5e and Tidy 5e sheets, on the desktop. It SHOULD work on forgevtt but I haven't tested as I stopped using that terrible service xd

## Features

- Auto-fit places the art in the ring. Standard tokens are 1024 px; Big Chungus tokens are 2048 px for art that spills well past the grid square.
- Overhang corners let parts of the art sit on top of the ring.
- Restore and Erase brushes, plus Lasso and Fuzzy select
- One-click removal for plain backgrounds
- Uses the ring picked in Foundry's Dynamic Token Ring setting, colored the way the actor's token will look
- Custom rings, with a saved ring library
- An option to bake the ring into the image for VTTs without dynamic rings
- Send to Actor uploads the token, turns on the ring and sets the scale values for you. It can also set the portrait (the original image or another one you pick) and update tokens already placed on scenes.
- Wildcard sets: send several tokens as one set and Foundry gives each token you place a random one, ring included. You can add more to a set later.
- Saved edits: each send can keep the token's edits with the actor. Next time, pick the actor and click Load Saved Edits to carry on where you left off.
- Works with actors stored in compendiums (GM only, can be turned off in the settings): drag one from a compendium onto the actor box, or use the crow on its sheet. Sending changes the compendium entry, so unlock the compendium first.
- Preview on Map shows your edits on the actor's token in the open scene before you send. Only you see it.
- Drag tokens from the list next to the one you're editing to compare them.
- Ctrl+Z undoes brush strokes, moves and scaling.
- Checks GitHub for new versions. When one is out, the GM sees a notice with the manifest URL the first time they open the window that session. You can turn this off in the module settings.
- A GM setting lets players make tokens for characters they own. Players without Foundry's upload permission can still use it: their token goes to a GM, who sees a preview and approves it before anything is uploaded.

## Usage

Click the crow on a character's portrait while the sheet is in edit mode. You can also open it from the Actors sidebar or an actor's right-click menu. Load an image, adjust it, pick the actor and click Send to Actor.

Standard tokens get a token scale of 1 and a ring scale correction of 1. Big Chungus tokens get 2 and 2. You can change these in the module settings.

## Outside connections

The only request the module makes outside your Foundry server is the update check: one request per session to api.github.com, only for the GM. Turn it off with the "Check GitHub for updates" setting and the module stays entirely on your server. Your images are uploaded only to your own Foundry data folder.

The fonts, icons and images ship with the module. The two fonts, IM Fell English SC and Alegreya Sans, are under the SIL Open Font License; the license files are in `assets/fonts`.

## Help

If something isn't working, join the [Burn Bin Inn Discord server](https://discord.gg/HXHdzXR6mC) or send me a DM on Discord at .mordecai.
