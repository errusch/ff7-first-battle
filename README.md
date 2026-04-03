# FF7 First Battle

Interactive browser recreation of the opening Final Fantasy VII battle, reimagined through a warm Pretext-inspired UI language.

Repo:
- https://github.com/errusch/ff7-first-battle

## What it includes
- Playable ATB battle with Cloud and Barret versus two Shinra MPs
- Mouse and keyboard controls
- Target selection, attack / magic / item / defend flow
- Enemy AI turns
- Victory and defeat states
- Original synthesized battle loop and UI / hit / magic / victory sounds
- Pretext-powered text wrapping for the battle banner and field-note bubbles

## Controls
- Start Battle: click the start button or press Enter
- Navigate: Arrow keys or W/S
- Confirm: Enter / Space or click
- Back: Escape / Backspace

## Tech
- React + TypeScript + Vite
- `@chenglou/pretext` for text layout / shrink-wrap style rendering
- `tone` for recreated audio

## Run locally
```bash
npm install
npm run dev
```
Then open:
- http://127.0.0.1:4173

## Build
```bash
npm run build
npm run preview
```

## Notes on fidelity
- The game aims to recreate the feel of FF7's first battle while translating the UI into a more editorial Pretext-style presentation.
- Music and sound effects are recreated/original approximations, not shipped copyrighted Square audio files.
- The project focuses on one polished interactive encounter, not a full RPG engine.
