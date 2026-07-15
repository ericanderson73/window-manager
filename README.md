# Window Manager for Stream Deck +

Control the focused window from Stream Deck + dials. Move, resize, snap, and move windows between monitors without leaving your current task.

## Features

- Move the focused window horizontally or vertically.
- Resize the focused window from its center.
- Snap the focused window to the left or right half, or to either outer third, of its current display.
- Move the focused window to the previous or next connected monitor.
- Tap the action's touch-strip control to restore the window's original position and size.
- Set the movement or resize step per action; hold the dial while turning for a 5× step.
- Customize each action's touch-strip background color.

## Requirements

- Stream Deck + and Stream Deck 7.1 or later.
- macOS 12 or later, or Windows 10 or later.
- On macOS, grant Stream Deck accessibility permission when prompted so it can control the focused window.

## Install

Download and open [com.bamabit.window-manager.streamDeckPlugin](dist/com.bamabit.window-manager.streamDeckPlugin) to install it in Stream Deck. Then add the Window Manager actions to Stream Deck + dials.

## Usage

Turn an action's dial to affect the currently focused window. For move and resize actions, choose the pixel step in the Property Inspector. Press and turn for a larger adjustment. Tap the action's touch-strip control to restore the position and size captured before the first adjustment or snap.

## Development

```sh
npm install
npm run build
npx streamdeck validate com.bamabit.window-manager.sdPlugin
npx streamdeck pack com.bamabit.window-manager.sdPlugin --output dist --force --no-update-check
```

The packaged release is written to `dist/com.bamabit.window-manager.streamDeckPlugin`.

## Release notes

See [dist/RELEASE_NOTES.md](dist/RELEASE_NOTES.md) for the current release notes.
