# Snapped

A Chrome extension that brings Windows Snipping Tool to your browser — paste screenshots onto an infinite canvas, annotate them, and keep everything in one tab.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome) ![Manifest V3](https://img.shields.io/badge/Manifest-V3-green) ![Vanilla JS](https://img.shields.io/badge/Zero-Dependencies-orange)

---

## Features

- **Infinite canvas** — pan and zoom freely; no page boundaries
- **Multiple input methods** — paste (Ctrl+V), drag & drop, file picker, tab capture, or screen region capture
- **Drawing tools** — pen, line, arrow, rectangle, ellipse, text, eraser
- **Selection & editing** — move, resize (8 handles), rotate, duplicate, z-order, multi-select
- **Group operations** — select multiple objects, move/rotate/resize as a group
- **Clipboard export** — copy selection, marquee region, or full canvas to clipboard
- **Session persistence** — canvas auto-saves to localStorage; resume where you left off
- **Zero dependencies** — 100% vanilla JS, Canvas API, Chrome Extension APIs

---

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `extension/` folder

---

## Tools & Shortcuts

| Key | Tool |
|-----|------|
| `V` | Select / Move |
| `P` | Pen |
| `L` | Line |
| `A` | Arrow |
| `R` | Rectangle |
| `E` | Ellipse |
| `T` | Text |
| `X` | Eraser |
| `S` | Snip region → copy to clipboard |
| `Z` | Zoom to region |

| Shortcut | Action |
|----------|--------|
| `Ctrl+V` | Paste image from clipboard |
| `Ctrl+C` | Copy selection / marquee / full canvas |
| `Ctrl+Z` | Undo |
| `Ctrl+0` | Reset zoom |
| `Ctrl+Shift+R` | Reload extension |
| `Del` | Delete selected |
| `Esc` | Deselect |
| `Space + drag` | Pan |
| `Ctrl + scroll` | Zoom |

**Modifier keys during operations:**

| Modifier | Effect |
|----------|--------|
| `Shift` while drawing | Constrain to square / 45° snap |
| `Shift` while resizing | Lock aspect ratio |
| `Shift + click` | Toggle multi-select |
| `Alt + drag` | Duplicate and move clone |
| `Space` while resizing | Temporarily switch to move |

---

## Object Types

| Type | Description |
|------|-------------|
| Image | Pasted / captured screenshots |
| Pen | Freehand strokes |
| Line / Arrow | Straight lines with optional arrowhead |
| Rectangle | Filled or outlined |
| Ellipse | Filled or outlined |
| Text | Editable, resizable text boxes |
| Eraser | Erases to transparent |

---

## File Structure

```
extension/
├── manifest.json          MV3 config
├── background.js          Service worker (capture & message routing)
├── icons/                 Extension icons (16, 48, 128px)
├── popup/
│   ├── popup.html
│   └── popup.js
└── canvas/
    ├── canvas.html        App shell + toolbar
    ├── canvas.css         Warm dark theme
    └── canvas.js          All app logic (~1000 lines, vanilla JS)
```

---

## Design Notes

- All coordinates are stored in **world space**; the viewport transform (`vx`, `vy`, `zoom`) is applied at render time
- Undo is implemented as JSON snapshots (max 60 deep)
- Eraser uses `globalCompositeOperation = 'destination-out'` to erase to transparent
- After drawing a shape, the tool auto-switches to select so you can immediately reposition it
- No build step, no bundler — load the folder directly in Chrome
