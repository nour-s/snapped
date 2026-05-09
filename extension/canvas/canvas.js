// SnipBoard — canvas.js v2
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOOLBAR_H = 48;
const HANDLE_R  = 5;   // handle circle radius in screen px
const HANDLE_HIT = 10; // hit radius for handles
const PAGE_COLOR = '#252320';
const PAGE_BORDER = 'rgba(255,255,255,0.06)';
const ACCENT = '#d4a373';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  objects: [],
  undoStack: [],

  // Selection
  selected: null,        // primary selected object index (shows resize handles)
  selectedSet: new Set(),// all selected indices

  // Marquee (rubber-band selection)
  marqueeStart: null,    // {wx,wy}
  marqueeRect:  null,    // {x,y,w,h} world coords

  // Text editing
  editingTextIndex: null,

  // Tool & style
  tool:   'select',
  color:  '#e06c75',
  size:   4,
  filled: false,

  // Viewport
  vx: 0, vy: 0, zoom: 1,
  pageW: 1920, pageH: 1080,

  // Drag state
  dragging: false,
  panning:  false,
  panStart: null,
  drawStart: null,
  currentStroke: null,
  currentShape:  null,
  resizeHandle:  null,  // 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'move'
  resizeDragStart: null,
  resizeObjStart:  null,
  resizeAspect:    null, // locked aspect ratio for shift-resize
  spaceWhileResizing: false,

  // Modifier keys
  altDown:   false,
  shiftDown: false,
  spaceDown: false,
};

// ── Elements ─────────────────────────────────────────────────────────────────

const mainCanvas    = document.getElementById('main-canvas');
const ctx           = mainCanvas.getContext('2d');
const regionOverlay = document.getElementById('region-overlay');
const regionCanvas  = document.getElementById('region-canvas');
const regionCtx     = regionCanvas.getContext('2d');
const regionSel     = document.getElementById('region-selection');
const textInput     = document.getElementById('text-input');
const sessionModal  = document.getElementById('session-modal');
const zoomLabel     = document.getElementById('zoom-label');
const colorPicker   = document.getElementById('color-picker');
const sizeSlider    = document.getElementById('size-slider');
const sizeLabelEl   = document.getElementById('size-label');
const fileInput     = document.getElementById('file-input');
const fillToggle    = document.getElementById('fill-toggle');
const marqueeDiv    = document.getElementById('marquee-rect');
const copyToast     = document.getElementById('copy-toast');

// ── Canvas resize ─────────────────────────────────────────────────────────────

function resizeCanvas() {
  mainCanvas.width  = window.innerWidth;
  mainCanvas.height = window.innerHeight - TOOLBAR_H;
  repositionTextInput();
  render();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Coordinate transforms ─────────────────────────────────────────────────────

function screenToWorld(sx, sy) {
  const r = mainCanvas.getBoundingClientRect();
  return { x: (sx - r.left) / state.zoom + state.vx, y: (sy - r.top) / state.zoom + state.vy };
}

const wx2sx = (wx) => (wx - state.vx) * state.zoom;
const wy2sy = (wy) => (wy - state.vy) * state.zoom;

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  drawGrid();

  ctx.save();
  ctx.scale(state.zoom, state.zoom);
  ctx.translate(-state.vx, -state.vy);

  // Canvas page (reference frame)
  ctx.shadowColor  = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur   = 30 / state.zoom;
  ctx.shadowOffsetY = 4 / state.zoom;
  ctx.fillStyle = PAGE_COLOR;
  ctx.fillRect(0, 0, state.pageW, state.pageH);
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = PAGE_BORDER;
  ctx.lineWidth = 1 / state.zoom;
  ctx.strokeRect(0, 0, state.pageW, state.pageH);

  // All objects
  for (let i = 0; i < state.objects.length; i++) {
    drawObject(ctx, state.objects[i]);
  }

  // Live strokes / shapes
  if (state.currentStroke) drawLiveStroke();
  if (state.currentShape)  drawObject(ctx, state.currentShape);

  ctx.restore();

  // Selection decorations (screen space)
  drawSelectionDecorations();

  // Marquee rect
  if (state.marqueeRect) drawMarqueeRect();
}

function drawGrid() {
  const step = 40 * state.zoom;
  const ox = ((-state.vx * state.zoom) % step + step) % step;
  const oy = ((-state.vy * state.zoom) % step + step) % step;
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let x = ox; x < mainCanvas.width; x += step)
    for (let y = oy; y < mainCanvas.height; y += step)
      ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
}

function drawLiveStroke() {
  const obj = state.currentStroke;
  ctx.save();
  applyStrokeStyle(ctx, obj);
  ctx.beginPath();
  const pts = obj.points;
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, obj.size / 2, 0, Math.PI * 2);
    ctx.fillStyle = obj.color; ctx.fill();
  } else {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function applyStrokeStyle(c, obj) {
  c.strokeStyle = obj.color;
  c.lineWidth   = obj.size;
  c.lineCap     = 'round';
  c.lineJoin    = 'round';
}

function drawObject(c, obj) {
  c.save();
  switch (obj.type) {
    case 'image': {
      if (obj.imgEl && obj.imgEl.complete && obj.imgEl.naturalWidth > 0)
        c.drawImage(obj.imgEl, obj.x, obj.y, obj.w, obj.h);
      break;
    }
    case 'pen': {
      applyStrokeStyle(c, obj);
      c.beginPath();
      const pts = obj.points;
      if (pts.length === 1) {
        c.arc(pts[0].x, pts[0].y, obj.size / 2, 0, Math.PI * 2);
        c.fillStyle = obj.color; c.fill();
      } else {
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
        c.stroke();
      }
      break;
    }
    case 'line': {
      applyStrokeStyle(c, obj);
      c.beginPath();
      c.moveTo(obj.x1, obj.y1);
      c.lineTo(obj.x2, obj.y2);
      c.stroke();
      if (obj.arrow) drawArrowHead(c, obj);
      break;
    }
    case 'rect': {
      const x = Math.min(obj.x, obj.x + obj.w), y = Math.min(obj.y, obj.y + obj.h);
      const w = Math.abs(obj.w), h = Math.abs(obj.h);
      applyStrokeStyle(c, obj);
      if (obj.filled) { c.fillStyle = obj.color; c.fillRect(x, y, w, h); }
      else c.strokeRect(x, y, w, h);
      break;
    }
    case 'ellipse': {
      const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
      applyStrokeStyle(c, obj);
      c.beginPath();
      c.ellipse(cx, cy, Math.abs(obj.w / 2), Math.abs(obj.h / 2), 0, 0, Math.PI * 2);
      if (obj.filled) { c.fillStyle = obj.color; c.fill(); }
      else c.stroke();
      break;
    }
    case 'text': {
      if (!obj.text) break;
      c.font      = `${obj.fontSize}px system-ui, -apple-system, sans-serif`;
      c.fillStyle = obj.color;
      c.textBaseline = 'top';
      c.fillText(obj.text, obj.x, obj.y);
      break;
    }
    case 'eraser': {
      c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = 'rgba(0,0,0,1)';
      c.lineWidth   = obj.size;
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      const pts = obj.points;
      if (pts.length === 1) {
        c.arc(pts[0].x, pts[0].y, obj.size / 2, 0, Math.PI * 2);
        c.fillStyle = 'rgba(0,0,0,1)'; c.fill();
      } else {
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
        c.stroke();
      }
      break;
    }
  }
  c.restore();
}

function drawArrowHead(c, obj) {
  const dx = obj.x2 - obj.x1, dy = obj.y2 - obj.y1;
  const angle = Math.atan2(dy, dx);
  const len = Math.max(obj.size * 4, 12);
  c.save();
  c.strokeStyle = obj.color; c.lineWidth = obj.size; c.lineCap = 'round';
  c.beginPath();
  c.moveTo(obj.x2, obj.y2);
  c.lineTo(obj.x2 - len * Math.cos(angle - Math.PI/6), obj.y2 - len * Math.sin(angle - Math.PI/6));
  c.moveTo(obj.x2, obj.y2);
  c.lineTo(obj.x2 - len * Math.cos(angle + Math.PI/6), obj.y2 - len * Math.sin(angle + Math.PI/6));
  c.stroke();
  c.restore();
}

// ── Bounds / handles ──────────────────────────────────────────────────────────

function getBounds(obj) {
  switch (obj.type) {
    case 'image':   return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    case 'rect':    return { x: Math.min(obj.x,obj.x+obj.w), y: Math.min(obj.y,obj.y+obj.h), w: Math.abs(obj.w), h: Math.abs(obj.h) };
    case 'ellipse': return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    case 'text': {
      ctx.save();
      ctx.font = `${obj.fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'top';
      const m = ctx.measureText(obj.text || 'M');
      ctx.restore();
      return { x: obj.x, y: obj.y, w: Math.max(m.width, 20), h: obj.fontSize * 1.3 };
    }
    case 'line': {
      const pad = Math.max(obj.size, 6);
      return { x: Math.min(obj.x1,obj.x2)-pad, y: Math.min(obj.y1,obj.y2)-pad,
               w: Math.abs(obj.x2-obj.x1)+pad*2||20, h: Math.abs(obj.y2-obj.y1)+pad*2||20 };
    }
    case 'pen': case 'eraser': {
      const xs = obj.points.map(p=>p.x), ys = obj.points.map(p=>p.y);
      const pad = obj.size/2;
      const minX=Math.min(...xs)-pad, minY=Math.min(...ys)-pad;
      return { x:minX, y:minY, w:Math.max(...xs)-minX+pad||20, h:Math.max(...ys)-minY+pad||20 };
    }
    default: return { x:0, y:0, w:0, h:0 };
  }
}

function handlePositions(b) {
  const {x,y,w,h} = b;
  return {
    nw:{x,y}, n:{x:x+w/2,y}, ne:{x:x+w,y},
    e:{x:x+w,y:y+h/2},
    se:{x:x+w,y:y+h}, s:{x:x+w/2,y:y+h}, sw:{x,y:y+h},
    w:{x,y:y+h/2},
  };
}

const HANDLE_CURSOR = { nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize',
                         n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize', move:'move' };

// ── Selection decorations ─────────────────────────────────────────────────────

function drawSelectionDecorations() {
  // Multi-select group box (no handles, just dashed box)
  if (state.selectedSet.size > 1) {
    const groupB = groupBounds();
    if (groupB) {
      ctx.save();
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.strokeRect(wx2sx(groupB.x)-2, wy2sy(groupB.y)-2, groupB.w*state.zoom+4, groupB.h*state.zoom+4);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Single-selection handles
  if (state.selected !== null && state.objects[state.selected] && state.selectedSet.size <= 1) {
    const obj = state.objects[state.selected];
    const needsHandles = ['image','text','rect','ellipse'].includes(obj.type);
    const b = getBounds(obj);
    ctx.save();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
    ctx.strokeRect(wx2sx(b.x)-1, wy2sy(b.y)-1, b.w*state.zoom+2, b.h*state.zoom+2);
    ctx.setLineDash([]);

    if (needsHandles) {
      const handles = handlePositions(b);
      ctx.fillStyle = ACCENT; ctx.strokeStyle = '#1a1917'; ctx.lineWidth = 1.5;
      for (const pos of Object.values(handles)) {
        ctx.beginPath();
        ctx.arc(wx2sx(pos.x), wy2sy(pos.y), HANDLE_R, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawMarqueeRect() {
  const r = state.marqueeRect;
  const sx = wx2sx(r.x), sy = wy2sy(r.y);
  const sw = r.w * state.zoom, sh = r.h * state.zoom;
  marqueeDiv.style.left   = Math.min(sx, sx+sw) + 'px';
  marqueeDiv.style.top    = (Math.min(sy, sy+sh) + TOOLBAR_H) + 'px';
  marqueeDiv.style.width  = Math.abs(sw) + 'px';
  marqueeDiv.style.height = Math.abs(sh) + 'px';
  marqueeDiv.style.display = 'block';
}

function groupBounds() {
  if (!state.selectedSet.size) return null;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const idx of state.selectedSet) {
    const b = getBounds(state.objects[idx]);
    minX = Math.min(minX,b.x); minY = Math.min(minY,b.y);
    maxX = Math.max(maxX,b.x+b.w); maxY = Math.max(maxY,b.y+b.h);
  }
  return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
}

// ── Hit testing ───────────────────────────────────────────────────────────────

function hitTestHandle(obj, wx, wy) {
  if (!['image','text','rect','ellipse'].includes(obj.type)) return null;
  const b = getBounds(obj);
  const threshold = HANDLE_HIT / state.zoom;
  for (const [dir, pos] of Object.entries(handlePositions(b))) {
    if (Math.hypot(wx-pos.x, wy-pos.y) <= threshold) return dir;
  }
  return null;
}

function hitTestObject(obj, wx, wy) {
  const b = getBounds(obj);
  return wx >= b.x && wx <= b.x+b.w && wy >= b.y && wy <= b.y+b.h;
}

function findObjectAt(wx, wy) {
  for (let i = state.objects.length-1; i >= 0; i--)
    if (hitTestObject(state.objects[i], wx, wy)) return i;
  return null;
}

// ── Undo ──────────────────────────────────────────────────────────────────────

function snapshot() {
  state.undoStack.push(JSON.stringify(state.objects.map(serializeObj)));
  if (state.undoStack.length > 60) state.undoStack.shift();
}

function undo() {
  if (!state.undoStack.length) return;
  state.objects = JSON.parse(state.undoStack.pop()).map(deserializeObj);
  state.selected = null; state.selectedSet.clear();
  render(); saveSession();
}

// ── Session ───────────────────────────────────────────────────────────────────

const SESSION_KEY = 'canvas_session';

function serializeObj(obj) {
  if (obj.type === 'image') return { ...obj, imgEl: undefined };
  return { ...obj };
}

function deserializeObj(data) {
  if (data.type === 'image') {
    const obj = { ...data };
    obj.imgEl = new Image();
    obj.imgEl.onload = () => render();
    obj.imgEl.src = obj.dataURL;
    return obj;
  }
  return { ...data };
}

function saveSession() {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(state.objects.map(serializeObj))); }
  catch { /* storage full */ }
}
const saveDebounced = debounce(saveSession, 1000);

function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || !data.length) return false;
    state.objects = data.map(deserializeObj);
    return true;
  } catch { return false; }
}

// ── Add image ─────────────────────────────────────────────────────────────────

function addImage(dataURL, cx, cy) {
  const img = new Image();
  img.onload = () => {
    const maxW = mainCanvas.width  * 0.7 / state.zoom;
    const maxH = mainCanvas.height * 0.7 / state.zoom;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxW) { h = h*maxW/w; w = maxW; }
    if (h > maxH) { w = w*maxH/h; h = maxH; }
    const x = (cx ?? state.vx + mainCanvas.width/state.zoom/2) - w/2;
    const y = (cy ?? state.vy + mainCanvas.height/state.zoom/2) - h/2;
    snapshot();
    state.objects.push({ type:'image', x, y, w, h, dataURL, imgEl:img });
    state.selected = state.objects.length - 1;
    state.selectedSet = new Set([state.selected]);
    render(); saveDebounced();
  };
  img.src = dataURL;
}

function dataURLFromFile(file, cb) {
  const r = new FileReader();
  r.onload = (e) => cb(e.target.result);
  r.readAsDataURL(file);
}

// ── Mouse events ──────────────────────────────────────────────────────────────

mainCanvas.addEventListener('mousedown', onMouseDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);
mainCanvas.addEventListener('dblclick', onDblClick);

function onMouseDown(e) {
  if (e.button === 1 || (state.spaceDown && e.button === 0)) { startPan(e); return; }
  if (e.button !== 0) return;

  // Commit any active text edit if clicking outside input
  if (state.editingTextIndex !== null && e.target !== textInput) {
    commitTextEdit();
  }

  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

  if (state.tool === 'select') {
    handleSelectMouseDown(e, wx, wy);
    return;
  }
  if (state.tool === 'pen' || state.tool === 'eraser') {
    snapshot();
    state.currentStroke = {
      type: state.tool, points: [{x:wx,y:wy}], color: state.color, size: state.size
    };
    state.dragging = true;
    return;
  }
  if (state.tool === 'text') {
    handleTextMouseDown(wx, wy);
    return;
  }
  if (['line','arrow','rect','ellipse'].includes(state.tool)) {
    snapshot();
    state.drawStart = { wx, wy };
    state.currentShape = makeShape(wx, wy, wx, wy);
    state.dragging = true;
  }
}

function handleSelectMouseDown(e, wx, wy) {
  // 1. Check resize handle on single selection
  if (state.selected !== null && state.selectedSet.size <= 1) {
    const obj = state.objects[state.selected];
    const handle = hitTestHandle(obj, wx, wy);
    if (handle) {
      snapshot();
      state.resizeHandle    = handle;
      state.resizeDragStart = { wx, wy };
      const b = getBounds(obj);
      state.resizeObjStart  = { ...b, ...obj,
        points: obj.points ? obj.points.map(p=>({...p})) : undefined };
      state.resizeAspect    = b.h ? b.w / b.h : 1;
      state.spaceWhileResizing = false;
      state.dragging = true;
      return;
    }
  }

  // 2. Hit an object
  const idx = findObjectAt(wx, wy);
  if (idx !== null) {
    // Shift-click: toggle in selectedSet
    if (e.shiftKey) {
      if (state.selectedSet.has(idx)) {
        state.selectedSet.delete(idx);
        state.selected = [...state.selectedSet].pop() ?? null;
      } else {
        state.selectedSet.add(idx);
        state.selected = idx;
      }
      render(); return;
    }

    // If Alt held: duplicate before moving
    if (state.altDown) {
      snapshot();
      const clones = [...(state.selectedSet.has(idx) ? state.selectedSet : [idx])]
        .map(i => deepCloneObj(state.objects[i]));
      const cloneIndices = clones.map((cl, j) => {
        state.objects.push(cl);
        return state.objects.length - 1;
      });
      state.selectedSet = new Set(cloneIndices);
      state.selected    = cloneIndices[cloneIndices.length - 1];
    } else if (!state.selectedSet.has(idx)) {
      state.selectedSet = new Set([idx]);
      state.selected    = idx;
    }

    // Start group/single move
    snapshot();
    state.resizeHandle    = 'move';
    state.resizeDragStart = { wx, wy };
    // Snapshot positions of all selected objects
    state.resizeObjStart  = [...state.selectedSet].map(i => ({
      idx: i,
      snap: { ...state.objects[i],
        points: state.objects[i].points ? state.objects[i].points.map(p=>({...p})) : undefined }
    }));
    state.dragging = true;
    render(); return;
  }

  // 3. Drag empty space → start marquee
  if (!e.shiftKey) {
    state.selected = null;
    state.selectedSet.clear();
  }
  state.marqueeStart = { wx, wy };
  state.marqueeRect  = { x: wx, y: wy, w: 0, h: 0 };
  state.dragging = true;
  render();
}

function handleTextMouseDown(wx, wy) {
  // Create a new empty text object, immediately enter edit mode
  const fontSize = Math.max(14, state.size * 2.5);
  snapshot();
  const obj = { type:'text', x:wx, y:wy, text:'', color:state.color, fontSize,
                w:200, h:fontSize*1.3 };
  state.objects.push(obj);
  state.selected    = state.objects.length - 1;
  state.selectedSet = new Set([state.selected]);
  showTextInputForObj(state.selected);
  render();
}

function onMouseMove(e) {
  if (state.panning) {
    const dx = (e.clientX - state.panStart.x) / state.zoom;
    const dy = (e.clientY - state.panStart.y) / state.zoom;
    state.vx = state.panStart.vx - dx; state.vy = state.panStart.vy - dy;
    state.panStart.x = e.clientX; state.panStart.y = e.clientY;
    state.panStart.vx = state.vx; state.panStart.vy = state.vy;
    render(); return;
  }

  updateCursor(e);

  if (!state.dragging) return;

  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

  // Marquee
  if (state.marqueeRect && !state.resizeHandle) {
    state.marqueeRect = {
      x: Math.min(wx, state.marqueeStart.wx),
      y: Math.min(wy, state.marqueeStart.wy),
      w: Math.abs(wx - state.marqueeStart.wx),
      h: Math.abs(wy - state.marqueeStart.wy),
    };
    render(); return;
  }

  // Resize / move
  if (state.resizeHandle) {
    if (state.resizeHandle === 'move') {
      applyGroupMove(wx, wy);
    } else {
      applySingleResize(wx, wy);
    }
    // Reposition text input if editing
    if (state.editingTextIndex !== null) repositionTextInput();
    render(); return;
  }

  // Stroke
  if (state.currentStroke) {
    state.currentStroke.points.push({ x: wx, y: wy });
    render(); return;
  }

  // Shape
  if (state.currentShape && state.drawStart) {
    let x2 = wx, y2 = wy;
    if (e.shiftKey) {
      // Constrain to square / 45°
      const dxs = x2 - state.drawStart.wx, dys = y2 - state.drawStart.wy;
      if (['rect','ellipse'].includes(state.tool)) {
        const s = Math.max(Math.abs(dxs), Math.abs(dys));
        x2 = state.drawStart.wx + Math.sign(dxs) * s;
        y2 = state.drawStart.wy + Math.sign(dys) * s;
      } else {
        // Snap line to 45° increments
        const angle = Math.round(Math.atan2(dys, dxs) / (Math.PI/4)) * (Math.PI/4);
        const len   = Math.hypot(dxs, dys);
        x2 = state.drawStart.wx + Math.cos(angle) * len;
        y2 = state.drawStart.wy + Math.sin(angle) * len;
      }
    }
    state.currentShape = makeShape(state.drawStart.wx, state.drawStart.wy, x2, y2);
    render();
  }
}

function onMouseUp(e) {
  if (state.panning) { stopPan(); return; }
  if (!state.dragging) return;
  state.dragging = false;

  // Finish marquee
  if (state.marqueeRect && !state.resizeHandle) {
    finishMarquee();
    marqueeDiv.style.display = 'none';
    state.marqueeRect  = null;
    state.marqueeStart = null;
    render(); return;
  }

  // Finish resize / move
  if (state.resizeHandle) {
    state.resizeHandle    = null;
    state.resizeDragStart = null;
    state.resizeObjStart  = null;
    state.resizeAspect    = null;
    saveDebounced(); return;
  }

  // Finish stroke
  if (state.currentStroke) {
    if (state.currentStroke.points.length > 0) {
      state.objects.push(state.currentStroke);
      saveDebounced();
    }
    state.currentStroke = null;
    render(); return;
  }

  // Finish shape
  if (state.currentShape) {
    const sh = state.currentShape;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const finalShape = makeShape(state.drawStart.wx, state.drawStart.wy, wx, wy);
    const degenerate = sh.type === 'line'
      ? Math.hypot(sh.x2-sh.x1, sh.y2-sh.y1) < 2
      : Math.abs(sh.w) < 2 || Math.abs(sh.h) < 2;
    if (!degenerate) {
      state.objects.push(finalShape);
      state.selected    = state.objects.length - 1;
      state.selectedSet = new Set([state.selected]);
      saveDebounced();
    } else {
      state.undoStack.pop(); // revert the snapshot from mousedown
    }
    state.currentShape = null;
    state.drawStart    = null;
    render();
  }
}

function onDblClick(e) {
  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
  const idx = findObjectAt(wx, wy);
  if (idx !== null && state.objects[idx].type === 'text') {
    state.selected    = idx;
    state.selectedSet = new Set([idx]);
    showTextInputForObj(idx);
    render();
  }
}

// ── Marquee finish ────────────────────────────────────────────────────────────

function finishMarquee() {
  const r = state.marqueeRect;
  if (!r || r.w < 3 || r.h < 3) return;
  const hits = [];
  for (let i = 0; i < state.objects.length; i++) {
    const b = getBounds(state.objects[i]);
    if (b.x + b.w >= r.x && b.x <= r.x+r.w && b.y + b.h >= r.y && b.y <= r.y+r.h)
      hits.push(i);
  }
  if (hits.length) {
    state.selectedSet = new Set(hits);
    state.selected    = hits[hits.length - 1];
  }
}

// ── Shape factory ─────────────────────────────────────────────────────────────

function makeShape(x1, y1, x2, y2) {
  if (state.tool === 'line')   return { type:'line', x1,y1,x2,y2, color:state.color, size:state.size, arrow:false };
  if (state.tool === 'arrow')  return { type:'line', x1,y1,x2,y2, color:state.color, size:state.size, arrow:true };
  if (state.tool === 'rect')   return { type:'rect', x:x1,y:y1,w:x2-x1,h:y2-y1, color:state.color, size:state.size, filled:state.filled };
  if (state.tool === 'ellipse')return { type:'ellipse', x:x1,y:y1,w:x2-x1,h:y2-y1, color:state.color, size:state.size, filled:state.filled };
}

// ── Resize ────────────────────────────────────────────────────────────────────

function applyGroupMove(wx, wy) {
  // resizeObjStart is an array of {idx, snap}
  const snaps = state.resizeObjStart;
  const dx = wx - state.resizeDragStart.wx;
  const dy = wy - state.resizeDragStart.wy;
  for (const { idx, snap } of snaps) {
    const obj = state.objects[idx];
    moveObj(obj, snap, dx, dy);
  }
}

function moveObj(obj, snap, dx, dy) {
  if (obj.type === 'line') {
    obj.x1 = snap.x1+dx; obj.y1 = snap.y1+dy;
    obj.x2 = snap.x2+dx; obj.y2 = snap.y2+dy;
  } else if (obj.type === 'pen' || obj.type === 'eraser') {
    if (snap.points) obj.points = snap.points.map(p => ({x:p.x+dx, y:p.y+dy}));
  } else {
    obj.x = snap.x+dx; obj.y = snap.y+dy;
  }
}

function applySingleResize(wx, wy) {
  const handle = state.resizeHandle;
  const obj    = state.objects[state.selected];
  const snap   = state.resizeObjStart;
  let dx = wx - state.resizeDragStart.wx;
  let dy = wy - state.resizeDragStart.wy;

  // Space while resizing → move the entire object instead
  if (state.spaceDown) {
    moveObj(obj, { x: snap.x, y: snap.y, x1: snap.x1, y1: snap.y1,
                   x2: snap.x2, y2: snap.y2, points: snap.points }, dx, dy);
    return;
  }

  if (!['image','rect','ellipse','text'].includes(obj.type)) return;

  const r = { x: snap.x, y: snap.y, w: snap.w, h: snap.h };
  if (handle.includes('e')) r.w = snap.w + dx;
  if (handle.includes('s')) r.h = snap.h + dy;
  if (handle.includes('w')) { r.x = snap.x + dx; r.w = snap.w - dx; }
  if (handle.includes('n')) { r.y = snap.y + dy; r.h = snap.h - dy; }

  // Shift: proportional resize (corner handles only)
  if (state.shiftDown && handle.length === 2) {
    const aspect = state.resizeAspect || 1;
    if (Math.abs(r.w / snap.w) > Math.abs(r.h / snap.h)) {
      // Width changed more — drive height from width
      const newH = r.w / aspect;
      if (handle.includes('n')) r.y = snap.y + snap.h - newH;
      r.h = newH;
    } else {
      const newW = r.h * aspect;
      if (handle.includes('w')) r.x = snap.x + snap.w - newW;
      r.w = newW;
    }
  }

  if (Math.abs(r.w) < 8) r.w = 8 * Math.sign(r.w || 1);
  if (Math.abs(r.h) < 8) r.h = 8 * Math.sign(r.h || 1);

  obj.x = r.x; obj.y = r.y; obj.w = r.w; obj.h = r.h;
  if (obj.type === 'text') obj.fontSize = Math.max(8, Math.abs(r.h) * 0.75);
}

// ── Pan / zoom ────────────────────────────────────────────────────────────────

function startPan(e) {
  state.panning = true;
  state.panStart = { x:e.clientX, y:e.clientY, vx:state.vx, vy:state.vy };
  mainCanvas.style.cursor = 'grabbing';
}
function stopPan() {
  state.panning = false;
  updateCursor({});
}

mainCanvas.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) {
    state.vx += e.deltaX / state.zoom;
    state.vy += e.deltaY / state.zoom;
    render(); return;
  }
  e.preventDefault();
  const r  = mainCanvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const wx = mx/state.zoom + state.vx, wy = my/state.zoom + state.vy;
  state.zoom = Math.max(0.05, Math.min(20, state.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
  state.vx = wx - mx/state.zoom;
  state.vy = wy - my/state.zoom;
  updateZoomLabel(); render();
}, { passive:false });

function updateZoomLabel() {
  zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
}

zoomLabel.addEventListener('click', () => {
  state.zoom = 1; state.vx = 0; state.vy = 0;
  updateZoomLabel(); render();
});

function fitAll() {
  if (!state.objects.length) return;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const obj of state.objects) {
    const b = getBounds(obj);
    minX=Math.min(minX,b.x); minY=Math.min(minY,b.y);
    maxX=Math.max(maxX,b.x+b.w); maxY=Math.max(maxY,b.y+b.h);
  }
  const pad = 60;
  const fitW = mainCanvas.width  / (maxX-minX+pad*2);
  const fitH = mainCanvas.height / (maxY-minY+pad*2);
  state.zoom = Math.min(fitW, fitH, 5);
  state.vx   = minX - pad;
  state.vy   = minY - pad;
  updateZoomLabel(); render();
}

// ── Cursor ────────────────────────────────────────────────────────────────────

function updateCursor(e) {
  if (state.panning) return;
  if (state.spaceDown) { mainCanvas.style.cursor = 'grab'; return; }

  if (state.tool === 'select') {
    const { x: wx, y: wy } = e.clientX != null ? screenToWorld(e.clientX, e.clientY) : { x:0, y:0 };
    // Check handles on selected
    if (state.selected !== null && state.selectedSet.size <= 1) {
      const handle = hitTestHandle(state.objects[state.selected], wx, wy);
      if (handle) { mainCanvas.style.cursor = HANDLE_CURSOR[handle]; return; }
    }
    // Over an object → move
    if (findObjectAt(wx, wy) !== null) { mainCanvas.style.cursor = 'move'; return; }
    mainCanvas.style.cursor = 'default';
    return;
  }

  const map = { pen:'crosshair', line:'crosshair', arrow:'crosshair',
                rect:'crosshair', ellipse:'crosshair', text:'text', eraser:'cell' };
  mainCanvas.style.cursor = map[state.tool] || 'default';
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (e.target === textInput) {
    // Handle text input keys inline
    if (e.key === 'Enter') { commitTextEdit(); e.preventDefault(); }
    if (e.key === 'Escape') { cancelTextEdit(); e.preventDefault(); }
    return;
  }

  if (e.key === ' ') { state.spaceDown = true; updateCursor({}); e.preventDefault(); return; }
  if (e.key === 'Alt' || e.key === 'Option') { state.altDown = true; return; }
  if (e.key === 'Shift') { state.shiftDown = true; return; }

  if ((e.ctrlKey || e.metaKey)) {
    if (e.key === 'z') { undo(); e.preventDefault(); return; }
    if (e.key === '0') { state.zoom=1; state.vx=0; state.vy=0; updateZoomLabel(); render(); e.preventDefault(); return; }
    if (e.key === 'c') { copyToClipboard(e); e.preventDefault(); return; }
  }

  const toolMap = { v:'select', p:'pen', l:'line', a:'arrow', r:'rect', e:'ellipse', t:'text', x:'eraser' };
  if (!e.ctrlKey && !e.metaKey && toolMap[e.key.toLowerCase()]) {
    setTool(toolMap[e.key.toLowerCase()]); return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  if (e.key === 'Escape') { state.selected=null; state.selectedSet.clear(); marqueeDiv.style.display='none'; state.marqueeRect=null; render(); }
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ')   { state.spaceDown = false; updateCursor({}); }
  if (e.key === 'Alt' || e.key === 'Option') state.altDown = false;
  if (e.key === 'Shift') state.shiftDown = false;
});

// ── Tools ─────────────────────────────────────────────────────────────────────

function setTool(name) {
  state.tool = name;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tool === name));
  // Commit text edit if switching away from text tool
  if (name !== 'text' && state.editingTextIndex !== null) commitTextEdit();
  updateCursor({});
}
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn =>
  btn.addEventListener('click', () => setTool(btn.dataset.tool)));

// ── Style controls ────────────────────────────────────────────────────────────

colorPicker.addEventListener('input', () => {
  state.color = colorPicker.value;
  // Live-update text being edited
  if (state.editingTextIndex !== null) {
    state.objects[state.editingTextIndex].color = state.color;
    textInput.style.color = state.color;
    render();
  }
});
sizeSlider.addEventListener('input', () => {
  state.size = +sizeSlider.value;
  sizeLabelEl.textContent = state.size;
});

let fillFilled = false;
fillToggle.addEventListener('click', () => {
  fillFilled = !fillFilled;
  state.filled = fillFilled;
  fillToggle.classList.toggle('toggled', fillFilled);
  const icon = document.getElementById('fill-icon');
  if (fillFilled) {
    icon.setAttribute('fill', 'currentColor');
    icon.removeAttribute('stroke');
  } else {
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
  }
});

// ── Text tool ─────────────────────────────────────────────────────────────────

function showTextInputForObj(idx) {
  const obj = state.objects[idx];
  repositionTextInputToObj(obj);
  textInput.style.color    = obj.color;
  textInput.style.fontSize = (obj.fontSize * state.zoom) + 'px';
  textInput.value          = obj.text || '';
  textInput.classList.remove('hidden');
  state.editingTextIndex = idx;
  setTimeout(() => { textInput.focus(); }, 0);
}

function repositionTextInputToObj(obj) {
  if (!obj) return;
  const sx = wx2sx(obj.x);
  const sy = wy2sy(obj.y);
  textInput.style.left     = sx + 'px';
  textInput.style.top      = (sy + TOOLBAR_H) + 'px';
  textInput.style.fontSize = (obj.fontSize * state.zoom) + 'px';
  textInput.style.minWidth = Math.max(80, obj.w * state.zoom) + 'px';
}

function repositionTextInput() {
  if (state.editingTextIndex !== null) {
    const obj = state.objects[state.editingTextIndex];
    if (obj) repositionTextInputToObj(obj);
  }
}

textInput.addEventListener('input', () => {
  // Live-update the object's text so it renders behind
  if (state.editingTextIndex !== null) {
    const obj = state.objects[state.editingTextIndex];
    if (obj) {
      obj.text = textInput.value;
      // Update bounds width
      ctx.font = `${obj.fontSize}px system-ui, -apple-system, sans-serif`;
      obj.w = Math.max(20, ctx.measureText(obj.text || 'M').width + 4);
      render();
    }
  }
});

textInput.addEventListener('blur', () => {
  commitTextEdit();
});

function commitTextEdit() {
  if (state.editingTextIndex === null) return;
  const idx = state.editingTextIndex;
  const obj = state.objects[idx];
  state.editingTextIndex = null;
  textInput.classList.add('hidden');

  if (obj) {
    const text = textInput.value.trim();
    if (text) {
      obj.text = text;
      ctx.font = `${obj.fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'top';
      obj.w = ctx.measureText(text).width + 4;
      obj.h = obj.fontSize * 1.3;
    } else {
      // Empty text → remove the object
      state.objects.splice(idx, 1);
      if (state.selected === idx) { state.selected = null; state.selectedSet.clear(); }
    }
  }
  saveDebounced(); render();
}

function cancelTextEdit() {
  if (state.editingTextIndex === null) return;
  const idx = state.editingTextIndex;
  state.editingTextIndex = null;
  textInput.classList.add('hidden');
  // Remove the text object (was just created, Escape = cancel)
  const obj = state.objects[idx];
  if (obj && !obj.text) {
    state.objects.splice(idx, 1);
    state.selected = null; state.selectedSet.clear();
  }
  render();
}

// ── Action buttons ────────────────────────────────────────────────────────────

document.getElementById('btn-paste').addEventListener('click', () => {
  navigator.clipboard.read().then(items => {
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) {
        item.getType(type).then(blob => {
          dataURLFromFile(blob, (dataURL) => addImage(dataURL));
        });
        return;
      }
    }
  }).catch(() => {
    // Fallback: focus and trigger paste event
    mainCanvas.focus();
  });
});

document.getElementById('btn-file').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  for (const file of fileInput.files) {
    if (!file.type.startsWith('image/')) continue;
    dataURLFromFile(file, (url) => addImage(url));
  }
  fileInput.value = '';
});

document.getElementById('btn-tab').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'captureTab' }, (res) => {
    if (res?.dataURL) addImage(res.dataURL);
    else if (res?.error) alert('Tab capture failed: ' + res.error);
  });
});

document.getElementById('btn-region').addEventListener('click', startRegionCapture);
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-delete').addEventListener('click', deleteSelected);

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear all objects?')) return;
  snapshot(); state.objects=[]; state.selected=null; state.selectedSet.clear();
  render(); saveDebounced();
});

document.getElementById('btn-copy').addEventListener('click', () => copyToClipboard());
document.getElementById('btn-export').addEventListener('click', exportPNG);
document.getElementById('btn-fit').addEventListener('click', fitAll);

function deleteSelected() {
  if (!state.selectedSet.size) return;
  snapshot();
  const toRemove = [...state.selectedSet].sort((a,b)=>b-a);
  for (const idx of toRemove) state.objects.splice(idx, 1);
  state.selected=null; state.selectedSet.clear();
  render(); saveDebounced();
}

// ── Clone helper ──────────────────────────────────────────────────────────────

function deepCloneObj(obj) {
  if (obj.type === 'image') {
    const cl = { ...obj };
    cl.imgEl = new Image();
    cl.imgEl.onload = () => render();
    cl.imgEl.src = obj.dataURL;
    return cl;
  }
  if (obj.points) return { ...obj, points: obj.points.map(p=>({...p})) };
  return { ...obj };
}

// ── Paste from clipboard ──────────────────────────────────────────────────────

window.addEventListener('paste', (e) => {
  if (e.target === textInput) return;
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) {
      dataURLFromFile(item.getAsFile(), (url) => addImage(url));
    }
  }
});

// ── Drag & drop ───────────────────────────────────────────────────────────────

mainCanvas.addEventListener('dragover', (e) => e.preventDefault());
mainCanvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
  for (const file of e.dataTransfer.files) {
    if (!file.type.startsWith('image/')) continue;
    const cx=wx, cy=wy;
    dataURLFromFile(file, (url) => addImage(url, cx, cy));
  }
});

// ── Screen region capture ─────────────────────────────────────────────────────

function startRegionCapture() {
  chrome.runtime.sendMessage({ action: 'captureRegion' }, async (res) => {
    if (!res || res.error) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { mandatory: { chromeMediaSource:'desktop', chromeMediaSourceId:res.streamId,
                              minWidth:1, maxWidth:9999, minHeight:1, maxHeight:9999 } },
        audio: false,
      });
    } catch (err) { console.error(err); return; }

    const video = document.createElement('video');
    video.srcObject = stream; video.muted = true;

    video.onloadedmetadata = () => {
      video.play().then(() => {
        const processFrame = () => {
          const vw = video.videoWidth, vh = video.videoHeight;
          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = vw; srcCanvas.height = vh;
          srcCanvas.getContext('2d').drawImage(video, 0, 0);
          stream.getTracks().forEach(t => t.stop());

          regionCanvas.width  = window.innerWidth;
          regionCanvas.height = window.innerHeight;
          const scale = Math.max(regionCanvas.width/vw, regionCanvas.height/vh);
          const dw=vw*scale, dh=vh*scale;
          const dx=(regionCanvas.width-dw)/2, dy=(regionCanvas.height-dh)/2;

          regionCtx.drawImage(srcCanvas, 0, 0, vw, vh, dx, dy, dw, dh);
          regionCtx.fillStyle = 'rgba(0,0,0,0.45)';
          regionCtx.fillRect(0, 0, regionCanvas.width, regionCanvas.height);

          regionCanvas._captureFrame = { srcCanvas, dx, dy, dw, dh, vw, vh };
          showRegionOverlay();
        };
        video.requestVideoFrameCallback ? video.requestVideoFrameCallback(processFrame) : setTimeout(processFrame, 150);
      });
    };
  });
}

let regionDrag = { active:false, x0:0, y0:0 };

function showRegionOverlay() { regionOverlay.classList.remove('hidden'); regionSel.style.display='none'; regionDrag={active:false}; }
function hideRegionOverlay() { regionOverlay.classList.add('hidden'); }

regionOverlay.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  regionDrag = { active:true, x0:e.clientX, y0:e.clientY };
  Object.assign(regionSel.style, { left:e.clientX+'px', top:e.clientY+'px', width:'0', height:'0', display:'block' });
});
regionOverlay.addEventListener('mousemove', (e) => {
  if (!regionDrag.active) return;
  Object.assign(regionSel.style, {
    left:   Math.min(e.clientX,regionDrag.x0)+'px',
    top:    Math.min(e.clientY,regionDrag.y0)+'px',
    width:  Math.abs(e.clientX-regionDrag.x0)+'px',
    height: Math.abs(e.clientY-regionDrag.y0)+'px',
  });
});
regionOverlay.addEventListener('mouseup', (e) => {
  if (!regionDrag.active) return;
  regionDrag.active = false;
  const rx=Math.min(e.clientX,regionDrag.x0), ry=Math.min(e.clientY,regionDrag.y0);
  const rw=Math.abs(e.clientX-regionDrag.x0), rh=Math.abs(e.clientY-regionDrag.y0);
  hideRegionOverlay();
  if (rw<5||rh<5) return;
  const f=regionCanvas._captureFrame;
  const scaleX=f.vw/f.dw, scaleY=f.vh/f.dh;
  const srcX=Math.round((rx-f.dx)*scaleX), srcY=Math.round((ry-f.dy)*scaleY);
  const srcW=Math.round(rw*scaleX),        srcH=Math.round(rh*scaleY);
  const crop=document.createElement('canvas');
  crop.width=Math.max(1,srcW); crop.height=Math.max(1,srcH);
  crop.getContext('2d').drawImage(f.srcCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  addImage(crop.toDataURL('image/png'));
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !regionOverlay.classList.contains('hidden')) hideRegionOverlay();
});

// ── Composite helper ──────────────────────────────────────────────────────────

function compositeObjects(objs, bg) {
  if (!objs.length) return null;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const obj of objs) {
    const b=getBounds(obj);
    minX=Math.min(minX,b.x); minY=Math.min(minY,b.y);
    maxX=Math.max(maxX,b.x+b.w); maxY=Math.max(maxY,b.y+b.h);
  }
  const PAD=16, W=maxX-minX+PAD*2, H=maxY-minY+PAD*2;
  const exp=document.createElement('canvas');
  exp.width=Math.max(1,W); exp.height=Math.max(1,H);
  const ec=exp.getContext('2d');
  if (bg) { ec.fillStyle=bg; ec.fillRect(0,0,W,H); }
  ec.save(); ec.translate(-minX+PAD,-minY+PAD);
  for (const obj of objs) drawObject(ec, obj);
  ec.restore();
  return exp;
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────

function copyToClipboard(e) {
  let objs = state.objects;

  // Cmd+C with selection → copy selected only
  if (e && state.selectedSet.size > 0) {
    objs = [...state.selectedSet].map(i => state.objects[i]).filter(Boolean);
  } else if (e && state.marqueeRect) {
    // Copy marquee region as raster
    copyMarqueeRegion(); return;
  }

  if (!objs.length) return;
  const exp = compositeObjects(objs, null);
  if (!exp) return;
  exp.toBlob(blob => {
    navigator.clipboard.write([new ClipboardItem({'image/png': blob})])
      .then(() => showToast('Copied to clipboard'))
      .catch(err => console.error('Copy failed:', err));
  }, 'image/png');
}

function copyMarqueeRegion() {
  const r = state.marqueeRect;
  if (!r) return;
  const exp = compositeObjects(state.objects, null);
  if (!exp) return;
  // Crop to marquee region
  // (objects were rendered offset by PAD=16 and min bounds; just re-composite bounded)
  let minX=Infinity, minY=Infinity;
  for (const obj of state.objects) { const b=getBounds(obj); minX=Math.min(minX,b.x); minY=Math.min(minY,b.y); }
  const PAD=16;
  const ox=r.x-minX+PAD, oy=r.y-minY+PAD;
  const crop=document.createElement('canvas');
  crop.width=Math.max(1,r.w); crop.height=Math.max(1,r.h);
  crop.getContext('2d').drawImage(exp, ox, oy, r.w, r.h, 0, 0, r.w, r.h);
  crop.toBlob(blob => {
    navigator.clipboard.write([new ClipboardItem({'image/png': blob})])
      .then(() => showToast('Region copied'))
      .catch(err => console.error(err));
  }, 'image/png');
}

function showToast(msg) {
  copyToast.textContent = msg;
  copyToast.classList.remove('hidden', 'fading');
  setTimeout(() => { copyToast.classList.add('fading'); }, 1500);
  setTimeout(() => { copyToast.classList.add('hidden'); copyToast.classList.remove('fading'); }, 1900);
}

// ── Export PNG ────────────────────────────────────────────────────────────────

function exportPNG() {
  if (!state.objects.length) { alert('Nothing to export.'); return; }
  const exp = compositeObjects(state.objects, null); // transparent bg
  if (!exp) return;
  const a = document.createElement('a');
  a.href     = exp.toDataURL('image/png');
  a.download = 'snipboard-' + Date.now() + '.png';
  a.click();
}

// ── Session UI ────────────────────────────────────────────────────────────────

function initSession() {
  if (loadSession()) { sessionModal.classList.remove('hidden'); }
  else startFresh();
}

document.getElementById('session-continue').addEventListener('click', () => {
  sessionModal.classList.add('hidden'); render();
});
document.getElementById('session-clear').addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY); startFresh(); sessionModal.classList.add('hidden');
});

function startFresh() {
  state.objects=[]; state.selected=null; state.selectedSet.clear(); state.undoStack=[];
  render();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// Page size = initial viewport
state.pageW = Math.round(mainCanvas.width  / state.zoom);
state.pageH = Math.round(mainCanvas.height / state.zoom);

initSession();
setTool('select');
