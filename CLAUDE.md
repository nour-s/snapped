# Snapped — Project Context for Claude Code

A Chrome extension (Manifest V3) that replicates Windows Snipping Tool in the browser.
**Goal**: paste multiple screenshots onto one infinite canvas, draw/annotate on top, manage them in one tab.
**Constraint**: zero external libraries — 100% vanilla JS, Canvas API, Chrome Extension APIs.

## Load the Extension

Chrome → `chrome://extensions` → Load unpacked → select `extension/` folder.

---

## File Map

```
extension/
├── manifest.json          MV3; permissions: desktopCapture, tabs, activeTab, storage
├── background.js          Service worker — handles openCanvas, captureRegion, captureTab
├── icons/icon{16,48,128}.png   Amber #d4a373 solid PNGs (generated via pure Node.js, no npm)
├── popup/popup.html+js    "Open Canvas" button → sends {action:'openCanvas'} to background
└── canvas/
    ├── canvas.html        Full toolbar (inline SVG icons) + overlay DOM elements
    ├── canvas.css         All styling; warm dark CSS vars
    └── canvas.js          ~1000 lines — all app logic
```

---

## Color Scheme (canvas.css)

```
--bg:      #1a1917   infinite canvas background
--surface: #21201e   toolbar
--overlay: #2e2c29
--text:    #e2e0dc
--accent:  #d4a373   amber — selection handles, active buttons
--red:     #e06c75   default stroke color
--page:    #252320   canvas page rect
```

---

## Object Model

`state.objects[]` — array of plain objects, all redrawn on every `render()` call.

| type | key fields |
|------|-----------|
| `image` | x, y, w, h, dataURL, imgEl |
| `pen` | points:[{x,y}], color, size |
| `eraser` | points:[{x,y}], size |
| `line` | x1,y1,x2,y2, color, size, arrow:bool |
| `rect` | x,y,w,h, color, size, filled:bool |
| `ellipse` | x,y,w,h, color, size, filled:bool |
| `text` | x,y,w,h, text, color, fontSize |

### Coordinate System

All object coords are in **world space**. Transforms:
- `wx2sx(wx) = (wx - state.vx) * state.zoom`  (world → screen)
- `screenToWorld(sx,sy)` inverts the above
- Pan: `state.vx, state.vy`; Zoom: `state.zoom`

---

## Key State Fields (canvas.js)

```js
state = {
  objects, undoStack,            // core data (undo: JSON snapshots, max 60)
  selected,                      // primary selected index (shows resize handles)
  selectedSet,                   // Set of all selected indices
  marqueeStart, marqueeRect,     // rubber-band selection drag
  editingTextIndex,              // index of text object with active <input>
  tool, color, size, filled,     // current draw settings
  vx, vy, zoom, pageW, pageH,   // viewport
  resizeHandle,                  // 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'move'
  resizeDragStart, resizeObjStart, resizeAspect,
  spaceAnchor,                   // {wx,wy,snap} — set when Space first pressed during resize
  altDown, shiftDown, spaceDown,
}
```

---

## Tools & Shortcuts

| Key | Action |
|-----|--------|
| V | Select / Move |
| P | Pen |
| L | Line |
| A | Arrow |
| R | Rectangle |
| E | Ellipse |
| T | Text |
| X | Eraser |
| S | Snip region (draw → copy to clipboard) |
| Z | Zoom to region (drag to zoom canvas to that area) |
| Ctrl+Z | Undo |
| Ctrl+C | Copy selection / marquee region / full canvas to clipboard |
| Ctrl+0 | Reset zoom |
| Del | Delete selected |
| Esc | Deselect |
| Space+drag | Pan |
| Ctrl+scroll | Zoom |

**Modifier keys during operations:**
- **Shift** while drawing → square / 45° snap
- **Shift** while resizing → proportional (aspect-locked)
- **Shift** + click → toggle multi-select
- **Space** while resizing → temporarily switches to move (no jump on release via `spaceAnchor`)
- **Alt** while dragging → duplicate and move the clone

**After drawing a shape** (rect/ellipse/line/arrow): tool auto-switches to select so the new object is immediately draggable.

---

## Image Input

1. Ctrl+V / paste event
2. Drag & drop onto canvas
3. File button (multi-select)
4. Tab capture — `chrome.tabs.captureVisibleTab`
5. Region capture — desktop stream → `requestVideoFrameCallback` for first frame → overlay rubber-band → crops to selection

---

## Selection & Style Controls

- Clicking an object syncs the color picker, size slider, and fill toggle to the object's current values.
- Changing color/size/fill while objects are selected updates those objects live (not just future ones).
- Multi-select: Shift+click or rubber-band marquee drag over empty space.
- Group move preserves per-object position snapshots.
- Resize handles (8 directions) shown for single-selected image/rect/ellipse/text.

---

## Text Tool

- Click → transparent `<input>` appears auto-focused at click position.
- Type → live preview renders on canvas behind the input.
- Click away or Enter → commits (removes object if empty).
- Escape → cancels.
- Double-click existing text (in select tool) → re-edits.
- Resizable via handles — fontSize scales with height.

---

## Session Persistence

- `localStorage` key: `canvas_session`, debounced 1s after changes.
- On load: if data found → "Continue / Start Fresh" modal.
- Images serialized as dataURLs; `imgEl` recreated on deserialize with `onload → render()`.

---

## Region Capture Flow

1. Click region button → background calls `chrome.desktopCapture.chooseDesktopMedia`
2. Returns `streamId` → `getUserMedia({video:{chromeMediaSource:'desktop', ...}})`
3. `requestVideoFrameCallback` (fallback: 150ms timeout) → draws to undimmed `srcCanvas`
4. Stream stops; dimmed overlay shown using `srcCanvas`
5. User rubber-bands a region → mouseup → crops `srcCanvas` → `addImage()`

---

## Key Functions

| Function | Role |
|----------|------|
| `render()` | Full redraw: grid, page shadow, objects, selection decorations |
| `drawObject(ctx, obj)` | Per-type draw dispatch |
| `getBounds(obj)` | `{x,y,w,h}` bounding box for any type |
| `handleSelectMouseDown` | 1) handle hit → resize; 2) object hit → move/dup; 3) empty → marquee |
| `applySingleResize` | Space-move with anchor, re-anchor on release, shift-proportional |
| `applyGroupMove` | Moves all selectedSet objects |
| `showTextInputForObj` | Positions & focuses `<input>` over text object |
| `syncControlsToSelection` | Updates toolbar controls to match selected object |
| `compositeObjects` | Off-screen canvas for clipboard/export |
| `copyToClipboard` | Cmd+C: selection or marquee region or full canvas |
| `snapshot / undo` | JSON undo stack |
| `startRegionCapture` | Kicks off desktop capture flow |
| `addImage` | Creates image object centered in viewport |
| `fitAll` | Zooms/pans to fit all content |

---

## Design Decisions

- No external libraries; icon PNGs generated with pure Node.js + zlib.
- Eraser uses `globalCompositeOperation = 'destination-out'` — erases to transparent.
- Pen/eraser strokes do **not** auto-switch to select after drawing (shapes do).
- Text tool stays active after committing (unlike shapes).
- `state.pageW/H` is visual reference only — not a clipping boundary.

---

## Git

- Repo: https://github.com/nour-s/snapped — branch: `master`
- `bfc84bb` — Round 1: initial extension
- `cacb38c` — Round 2: SVG icons, warm theme, rubber-band select, text rework, modifiers, zoom, clipboard
