// SnipBoard — canvas.js v3
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOOLBAR_H  = 48;
const HANDLE_R   = 5;
const HANDLE_HIT = 10;
const ACCENT     = '#d4a373';
const ROT_HANDLE_DIST = 22; // px above bounding box for rotate handle (screen)

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  objects: [],
  undoStack: [],

  // Selection
  selected: null,
  selectedSet: new Set(),

  // Marquee
  marqueeStart: null,
  marqueeRect: null,

  // Text editing
  editingTextIndex: null,

  // Tool & style
  tool:   'select',
  color:  '#ff0000',
  size:   4,
  filled: false,

  // Background
  bgColor: '#1a1917',       // '' = transparent
  bgTransparent: false,

  // Viewport
  vx: 0, vy: 0, zoom: 1,

  // Drag
  dragging:       false,
  panning:        false,
  panStart:       null,
  drawStart:      null,
  currentStroke:  null,
  currentShape:   null,
  resizeHandle:   null,
  resizeDragStart: null,
  resizeObjStart:  null,
  resizeAspect:    null,
  spaceAnchor:     null,

  // Rotation drag
  rotating:        false,
  rotateStart:     null,   // {angle, wx, wy}
  rotateObjStart:  null,   // snapshot(s) for rotation

  // Snip tool state
  snipStart: null,
  snipRect:  null,

  // Zoom tool state
  zoomStart: null,
  zoomRect:  null,

  // Modifiers
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
const snipOverlay   = document.getElementById('snip-overlay');
const ctxMenu       = document.getElementById('context-menu');
const bgColorPicker = document.getElementById('bg-color-picker');
const bgTransBtn    = document.getElementById('btn-bg-transparent');

// ── Canvas resize ──────────────────────────────────────────────────────────

function resizeCanvas() {
  mainCanvas.width  = window.innerWidth;
  mainCanvas.height = window.innerHeight - TOOLBAR_H;
  repositionTextInput();
  render();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Coordinate transforms ─────────────────────────────────────────────────

function screenToWorld(sx, sy) {
  const r = mainCanvas.getBoundingClientRect();
  return { x: (sx - r.left) / state.zoom + state.vx, y: (sy - r.top) / state.zoom + state.vy };
}

const wx2sx = (wx) => (wx - state.vx) * state.zoom;
const wy2sy = (wy) => (wy - state.vy) * state.zoom;

// ── Render ────────────────────────────────────────────────────────────────

function render() {
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

  // Background
  if (!state.bgTransparent) {
    ctx.fillStyle = state.bgColor || '#1a1917';
    ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
  }
  drawGrid();

  ctx.save();
  ctx.scale(state.zoom, state.zoom);
  ctx.translate(-state.vx, -state.vy);

  for (let i = 0; i < state.objects.length; i++) {
    drawObject(ctx, state.objects[i]);
  }

  if (state.currentStroke) drawLiveStroke();
  if (state.currentShape)  drawObject(ctx, state.currentShape);

  ctx.restore();

  drawSelectionDecorations();

  if (state.marqueeRect) drawMarqueeRect();

  if (state.snipRect) drawSnipRect();
  if (state.zoomRect) drawZoomRect();
}

function drawGrid() {
  const step = 20 * state.zoom; // finer grid than before
  const ox = ((-state.vx * state.zoom) % step + step) % step;
  const oy = ((-state.vy * state.zoom) % step + step) % step;

  if (state.bgTransparent) {
    // Checkerboard for transparent bg
    const cs = 10;
    for (let x = 0; x < mainCanvas.width; x += cs) {
      for (let y = 0; y < mainCanvas.height; y += cs) {
        ctx.fillStyle = ((Math.floor(x/cs) + Math.floor(y/cs)) % 2 === 0)
          ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
        ctx.fillRect(x, y, cs, cs);
      }
    }
    return;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.045)';
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
  const rot = obj.rotation || 0;
  if (rot) {
    const b  = getBoundsNoRotation(obj);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    c.translate(cx, cy);
    c.rotate(rot);
    c.translate(-cx, -cy);
  }
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

// ── Snip overlay ──────────────────────────────────────────────────────────

function drawSnipRect() {
  const r = state.snipRect;
  if (!r) return;
  const sx = wx2sx(r.x), sy = wy2sy(r.y);
  const sw = r.w * state.zoom, sh = r.h * state.zoom;
  const x = Math.min(sx, sx + sw), y = Math.min(sy, sy + sh);
  const w = Math.abs(sw), h = Math.abs(sh);

  // Dim outside
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, mainCanvas.width, y);
  ctx.fillRect(0, y + h, mainCanvas.width, mainCanvas.height - y - h);
  ctx.fillRect(0, y, x, h);
  ctx.fillRect(x + w, y, mainCanvas.width - x - w, h);
  // Bright border
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawZoomRect() {
  const r = state.zoomRect;
  if (!r) return;
  const sx = wx2sx(r.x), sy = wy2sy(r.y);
  const sw = r.w * state.zoom, sh = r.h * state.zoom;
  const x = Math.min(sx, sx+sw), y = Math.min(sy, sy+sh);
  const w = Math.abs(sw), h = Math.abs(sh);
  ctx.save();
  ctx.strokeStyle = '#88ccff';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = 'rgba(100,180,255,0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

function applyZoomToRect(r) {
  const pad = 20;
  const fitW = mainCanvas.width  / (r.w + pad * 2);
  const fitH = mainCanvas.height / (r.h + pad * 2);
  state.zoom = Math.max(0.05, Math.min(20, Math.min(fitW, fitH)));
  state.vx   = r.x - pad;
  state.vy   = r.y - pad;
  updateZoomLabel();
}

// ── Bounds / handles ──────────────────────────────────────────────────────

function getBoundsNoRotation(obj) {
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

function getBounds(obj) {
  const b   = getBoundsNoRotation(obj);
  const rot = obj.rotation || 0;
  if (!rot) return b;
  // Return AABB of the rotated rect
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  const hw = b.w/2, hh = b.h/2;
  const cos = Math.abs(Math.cos(rot)), sin = Math.abs(Math.sin(rot));
  const rw = hw*cos + hh*sin, rh = hw*sin + hh*cos;
  return { x: cx-rw, y: cy-rh, w: rw*2, h: rh*2 };
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

function rotateHandlePos(b) {
  // A single handle above the bounding box center
  return { x: b.x + b.w/2, y: b.y - ROT_HANDLE_DIST / state.zoom };
}

const HANDLE_CURSOR = {
  nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize',
  n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize', move:'move'
};

// ── Selection decorations ─────────────────────────────────────────────────

function drawSelectionDecorations() {
  const showRotate = state.altDown;

  if (state.selectedSet.size > 1) {
    const groupB = groupBounds();
    if (groupB) {
      ctx.save();
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
      ctx.strokeRect(wx2sx(groupB.x)-2, wy2sy(groupB.y)-2, groupB.w*state.zoom+4, groupB.h*state.zoom+4);
      ctx.setLineDash([]);

      if (showRotate) {
        drawRotateHandle(groupB);
      } else {
        drawResizeHandlesForBounds(groupB);
      }
      ctx.restore();
    }
    return;
  }

  if (state.selected !== null && state.objects[state.selected]) {
    const obj = state.objects[state.selected];
    const needsHandles = ['image','text','rect','ellipse'].includes(obj.type);
    const b = getBoundsNoRotation(obj);
    const rot = obj.rotation || 0;

    ctx.save();

    // Draw dashed selection border (rotated)
    if (rot) {
      const cx = b.x + b.w/2, cy = b.y + b.h/2;
      ctx.translate(wx2sx(cx), wy2sy(cy));
      ctx.rotate(rot);
      ctx.translate(-wx2sx(cx), -wy2sy(cy));
    }

    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
    ctx.strokeRect(wx2sx(b.x)-1, wy2sy(b.y)-1, b.w*state.zoom+2, b.h*state.zoom+2);
    ctx.setLineDash([]);

    ctx.restore();
    ctx.save();

    if (needsHandles) {
      const displayB = rot ? getBounds(obj) : b;
      if (showRotate) {
        drawRotateHandle(displayB);
      } else {
        drawResizeHandlesForBounds(displayB);
      }
    }
    ctx.restore();
  }
}

function drawResizeHandlesForBounds(b) {
  const handles = handlePositions(b);
  ctx.fillStyle = ACCENT; ctx.strokeStyle = '#1a1917'; ctx.lineWidth = 1.5;
  for (const pos of Object.values(handles)) {
    ctx.beginPath();
    ctx.arc(wx2sx(pos.x), wy2sy(pos.y), HANDLE_R, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
  }
}

function drawRotateHandle(b) {
  const rp = rotateHandlePos(b);
  const sx = wx2sx(rp.x), sy = wy2sy(rp.y);
  const cx = wx2sx(b.x + b.w/2), cy = wy2sy(b.y);

  // Line from center-top to rotate handle
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.setLineDash([3,2]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(sx, sy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Rotate circle
  ctx.fillStyle = ACCENT; ctx.strokeStyle = '#1a1917'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(sx, sy, HANDLE_R + 1, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // Rotation arrow icon inside
  ctx.strokeStyle = '#1a1917'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(sx, sy, 3.5, -Math.PI*0.7, Math.PI*0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + 3.5*Math.cos(Math.PI*0.7) - 2, sy + 3.5*Math.sin(Math.PI*0.7));
  ctx.lineTo(sx + 3.5*Math.cos(Math.PI*0.7), sy + 3.5*Math.sin(Math.PI*0.7));
  ctx.lineTo(sx + 3.5*Math.cos(Math.PI*0.7), sy + 3.5*Math.sin(Math.PI*0.7) - 2);
  ctx.stroke();
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

// ── Hit testing ───────────────────────────────────────────────────────────

function hitTestRotateHandle(b, wx, wy) {
  const rp = rotateHandlePos(b);
  const threshold = (HANDLE_R + 4) / state.zoom;
  return Math.hypot(wx - rp.x, wy - rp.y) <= threshold;
}

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

// ── Undo ──────────────────────────────────────────────────────────────────

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

// ── Session ───────────────────────────────────────────────────────────────

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

// ── Add image ─────────────────────────────────────────────────────────────

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

// ── Mouse events ──────────────────────────────────────────────────────────

mainCanvas.addEventListener('mousedown', onMouseDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);
mainCanvas.addEventListener('dblclick', onDblClick);
mainCanvas.addEventListener('contextmenu', onContextMenu);

function onMouseDown(e) {
  hideContextMenu();
  if (e.button === 1 || (state.spaceDown && e.button === 0)) { startPan(e); return; }
  if (e.button !== 0) return;

  if (state.editingTextIndex !== null && e.target !== textInput) commitTextEdit();

  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

  if (state.tool === 'snip') {
    state.snipStart = { wx, wy };
    state.snipRect  = { x: wx, y: wy, w: 0, h: 0 };
    state.dragging  = true;
    return;
  }

  if (state.tool === 'zoom') {
    state.zoomStart = { wx, wy };
    state.zoomRect  = { x: wx, y: wy, w: 0, h: 0 };
    state.dragging  = true;
    return;
  }

  if (state.tool === 'select') {
    handleSelectMouseDown(e, wx, wy);
    return;
  }
  if (state.tool === 'pen' || state.tool === 'eraser') {
    snapshot();
    state.currentStroke = { type: state.tool, points: [{x:wx,y:wy}], color: state.color, size: state.size };
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
  // Check rotate handle on single or multi selection
  if (state.altDown && state.selectedSet.size > 0) {
    const b = state.selectedSet.size > 1 ? groupBounds() : getBounds(state.objects[state.selected]);
    if (b && hitTestRotateHandle(b, wx, wy)) {
      snapshot();
      const cx = b.x + b.w/2, cy = b.y + b.h/2;
      state.rotating = true;
      state.rotateStart = {
        angle: Math.atan2(wy - cy, wx - cx),
        cx, cy,
      };
      // Snapshot each selected object for rotation
      state.rotateObjStart = [...state.selectedSet].map(i => {
        const obj = state.objects[i];
        const b = getBounds(obj); // AABB accounting for existing rotation
        const ocx = b.x + b.w/2, ocy = b.y + b.h/2;
        const base = { idx: i, rotation: obj.rotation || 0, startX: ocx, startY: ocy };
        // store extra per-type snapshot data
        if (obj.type === 'line') Object.assign(base, { x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 });
        else if (obj.type === 'pen' || obj.type === 'eraser') base.points = obj.points.map(p => ({...p}));
        else Object.assign(base, { w: b.w, h: b.h });
        return base;
      });
      state.dragging = true;
      return;
    }
  }

  // Check resize handles (single or multi-select group), not while alt
  if (!state.altDown && state.selectedSet.size > 0) {
    const isMulti = state.selectedSet.size > 1;
    const b = isMulti ? groupBounds() : (state.selected !== null ? getBoundsNoRotation(state.objects[state.selected]) : null);
    if (b) {
      const threshold = HANDLE_HIT / state.zoom;
      let handle = null;
      for (const [dir, pos] of Object.entries(handlePositions(b))) {
        if (Math.hypot(wx - pos.x, wy - pos.y) <= threshold) { handle = dir; break; }
      }
      if (handle) {
        snapshot();
        state.resizeHandle    = handle;
        state.resizeDragStart = { wx, wy };
        if (isMulti) {
          // Store group bounds + per-object snapshots for proportional scale
          state.resizeObjStart = {
            groupB: { ...b },
            objs: [...state.selectedSet].map(i => {
              const obj = state.objects[i];
              const ob  = getBoundsNoRotation(obj);
              return { idx: i, ob, snap: { ...obj, points: obj.points ? obj.points.map(p=>({...p})) : undefined } };
            }),
          };
          state.resizeAspect = b.h ? b.w / b.h : 1;
        } else {
          const obj = state.objects[state.selected];
          const ob  = getBoundsNoRotation(obj);
          state.resizeObjStart = { ...ob, ...obj, points: obj.points ? obj.points.map(p=>({...p})) : undefined };
          state.resizeAspect   = ob.h ? ob.w / ob.h : 1;
        }
        state.dragging = true;
        return;
      }
    }
  }

  const idx = findObjectAt(wx, wy);
  if (idx !== null) {
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

    if (state.altDown) {
      snapshot();
      const clones = [...(state.selectedSet.has(idx) ? state.selectedSet : [idx])]
        .map(i => deepCloneObj(state.objects[i]));
      const cloneIndices = clones.map(cl => {
        state.objects.push(cl);
        return state.objects.length - 1;
      });
      state.selectedSet = new Set(cloneIndices);
      state.selected    = cloneIndices[cloneIndices.length - 1];
    } else if (!state.selectedSet.has(idx)) {
      state.selectedSet = new Set([idx]);
      state.selected    = idx;
    }

    snapshot();
    state.resizeHandle    = 'move';
    state.resizeDragStart = { wx, wy };
    state.resizeObjStart  = [...state.selectedSet].map(i => ({
      idx: i,
      snap: { ...state.objects[i],
        points: state.objects[i].points ? state.objects[i].points.map(p=>({...p})) : undefined }
    }));
    state.dragging = true;
    syncControlsToSelection();
    render(); return;
  }

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
  const fontSize = Math.max(14, state.size * 2.5);
  snapshot();
  const obj = { type:'text', x:wx, y:wy, text:'', color:state.color, fontSize, w:200, h:fontSize*1.3 };
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

  // Snip drag
  if (state.snipRect && state.snipStart) {
    state.snipRect = {
      x: Math.min(wx, state.snipStart.wx),
      y: Math.min(wy, state.snipStart.wy),
      w: Math.abs(wx - state.snipStart.wx),
      h: Math.abs(wy - state.snipStart.wy),
    };
    render(); return;
  }

  // Zoom drag
  if (state.zoomRect && state.zoomStart) {
    state.zoomRect = {
      x: Math.min(wx, state.zoomStart.wx),
      y: Math.min(wy, state.zoomStart.wy),
      w: Math.abs(wx - state.zoomStart.wx),
      h: Math.abs(wy - state.zoomStart.wy),
    };
    render(); return;
  }

  // Marquee
  if (state.marqueeRect && !state.resizeHandle && !state.rotating) {
    state.marqueeRect = {
      x: Math.min(wx, state.marqueeStart.wx),
      y: Math.min(wy, state.marqueeStart.wy),
      w: Math.abs(wx - state.marqueeStart.wx),
      h: Math.abs(wy - state.marqueeStart.wy),
    };
    render(); return;
  }

  // Rotation
  if (state.rotating) {
    applyRotation(wx, wy, e.metaKey || e.ctrlKey);
    render(); return;
  }

  // Resize / move
  if (state.resizeHandle) {
    if (state.resizeHandle === 'move') {
      applyGroupMove(wx, wy);
    } else if (state.resizeObjStart?.groupB) {
      applyGroupResize(wx, wy);
    } else {
      applySingleResize(wx, wy);
    }
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
      const dxs = x2 - state.drawStart.wx, dys = y2 - state.drawStart.wy;
      if (['rect','ellipse'].includes(state.tool)) {
        const s = Math.max(Math.abs(dxs), Math.abs(dys));
        x2 = state.drawStart.wx + Math.sign(dxs) * s;
        y2 = state.drawStart.wy + Math.sign(dys) * s;
      } else {
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

function applyRotation(wx, wy, snap) {
  const { cx, cy, angle: startAngle } = state.rotateStart;
  let delta = Math.atan2(wy - cy, wx - cx) - startAngle;
  if (snap) {
    const SNAP = Math.PI / 12; // 15°
    delta = Math.round(delta / SNAP) * SNAP;
  }

  for (const objSnap of state.rotateObjStart) {
    const { idx, rotation: startRot, startX, startY } = objSnap;
    const obj = state.objects[idx];
    obj.rotation = startRot + delta;

    if (state.rotateObjStart.length > 1) {
      // Orbit the object's snapshot position around group center
      const dx = startX - cx, dy = startY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        const baseAngle = Math.atan2(dy, dx);
        const newAngle = baseAngle + delta;
        const newCx = cx + Math.cos(newAngle) * dist;
        const newCy = cy + Math.sin(newAngle) * dist;
        if (obj.type === 'line') {
          const ldx = objSnap.x2 - objSnap.x1, ldy = objSnap.y2 - objSnap.y1;
          obj.x1 = newCx - ldx/2; obj.y1 = newCy - ldy/2;
          obj.x2 = newCx + ldx/2; obj.y2 = newCy + ldy/2;
        } else if (obj.type === 'pen' || obj.type === 'eraser') {
          if (objSnap.points) {
            const cos = Math.cos(delta), sin = Math.sin(delta);
            obj.points = objSnap.points.map(p => {
              const pdx = p.x - cx, pdy = p.y - cy;
              return { x: cx + pdx*cos - pdy*sin, y: cy + pdx*sin + pdy*cos };
            });
          }
        } else {
          obj.x = newCx - objSnap.w/2;
          obj.y = newCy - objSnap.h/2;
        }
      }
    }
  }
}

function onMouseUp(e) {
  if (state.panning) { stopPan(); return; }
  if (!state.dragging) return;
  state.dragging = false;

  // Finish snip
  if (state.snipRect && state.snipStart) {
    const r = state.snipRect;
    state.snipStart = null;
    if (r.w > 5 && r.h > 5) {
      showSnipOverlay(r);
    } else {
      state.snipRect = null;
      render();
    }
    return;
  }

  // Finish zoom
  if (state.zoomRect && state.zoomStart) {
    const r = state.zoomRect;
    state.zoomStart = null;
    state.zoomRect  = null;
    if (r.w > 5 && r.h > 5) {
      applyZoomToRect(r);
    }
    render();
    return;
  }

  // Finish marquee
  if (state.marqueeRect && !state.resizeHandle && !state.rotating) {
    finishMarquee();
    marqueeDiv.style.display = 'none';
    state.marqueeRect  = null;
    state.marqueeStart = null;
    render(); return;
  }

  // Finish rotation
  if (state.rotating) {
    state.rotating       = false;
    state.rotateStart    = null;
    state.rotateObjStart = null;
    saveDebounced(); return;
  }

  // Finish resize / move
  if (state.resizeHandle) {
    state.resizeHandle    = null;
    state.resizeDragStart = null;
    state.resizeObjStart  = null;
    state.resizeAspect    = null;
    state.spaceAnchor     = null;
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
    let { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    if (e.shiftKey) {
      const dxs = wx - state.drawStart.wx, dys = wy - state.drawStart.wy;
      if (sh.type !== 'line') {
        const s = Math.max(Math.abs(dxs), Math.abs(dys));
        wx = state.drawStart.wx + Math.sign(dxs) * s;
        wy = state.drawStart.wy + Math.sign(dys) * s;
      } else {
        const angle = Math.round(Math.atan2(dys, dxs) / (Math.PI/4)) * (Math.PI/4);
        const len = Math.hypot(dxs, dys);
        wx = state.drawStart.wx + Math.cos(angle) * len;
        wy = state.drawStart.wy + Math.sin(angle) * len;
      }
    }
    const finalShape = makeShape(state.drawStart.wx, state.drawStart.wy, wx, wy);
    const degenerate = sh.type === 'line'
      ? Math.hypot(sh.x2-sh.x1, sh.y2-sh.y1) < 2
      : Math.abs(sh.w) < 2 || Math.abs(sh.h) < 2;
    if (!degenerate) {
      state.objects.push(finalShape);
      state.selected    = state.objects.length - 1;
      state.selectedSet = new Set([state.selected]);
      setTool('select');
      syncControlsToSelection();
      saveDebounced();
    } else {
      state.undoStack.pop();
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
    syncControlsToSelection();
    showTextInputForObj(idx);
    render();
  }
}

// ── Right-click context menu ───────────────────────────────────────────────

function onContextMenu(e) {
  e.preventDefault();
  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
  const idx = findObjectAt(wx, wy);
  if (idx === null) { hideContextMenu(); return; }

  if (!state.selectedSet.has(idx)) {
    state.selectedSet = new Set([idx]);
    state.selected    = idx;
    render();
  }

  showContextMenu(e.clientX, e.clientY, idx);
}

function showContextMenu(sx, sy) {
  ctxMenu.style.left = sx + 'px';
  ctxMenu.style.top  = sy + 'px';
  ctxMenu.classList.remove('hidden');
}

function hideContextMenu() {
  ctxMenu.classList.add('hidden');
}

ctxMenu.addEventListener('click', (e) => {
  const action = e.target.closest('[data-order]')?.dataset.order;
  if (!action) return;
  e.stopPropagation();
  hideContextMenu();
  applyZOrder(action);
});

window.addEventListener('mousedown', (e) => {
  if (e.button === 2) return; // right-click handled by contextmenu event
  if (!ctxMenu.classList.contains('hidden') && !ctxMenu.contains(e.target)) hideContextMenu();
});

function applyZOrder(action) {
  if (state.selectedSet.size === 0) return;
  snapshot();
  const indices = [...state.selectedSet].sort((a,b) => a-b);

  if (action === 'front') {
    const objs = indices.map(i => state.objects[i]);
    for (let i = indices.length-1; i >= 0; i--) state.objects.splice(indices[i], 1);
    state.objects.push(...objs);
    const newBase = state.objects.length - indices.length;
    state.selectedSet = new Set(indices.map((_, j) => newBase + j));
    state.selected    = state.objects.length - 1;
  } else if (action === 'back') {
    const objs = indices.map(i => state.objects[i]);
    for (let i = indices.length-1; i >= 0; i--) state.objects.splice(indices[i], 1);
    state.objects.unshift(...objs);
    state.selectedSet = new Set(indices.map((_, j) => j));
    state.selected    = 0;
  } else if (action === 'forward') {
    // Move each up by one, highest first
    for (let i = indices.length-1; i >= 0; i--) {
      const idx = indices[i];
      if (idx < state.objects.length - 1 && !indices.includes(idx + 1)) {
        const tmp = state.objects[idx]; state.objects[idx] = state.objects[idx+1]; state.objects[idx+1] = tmp;
        indices[i] = idx + 1;
      }
    }
    state.selectedSet = new Set(indices);
    state.selected    = indices[indices.length - 1];
  } else if (action === 'backward') {
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (idx > 0 && !indices.includes(idx - 1)) {
        const tmp = state.objects[idx]; state.objects[idx] = state.objects[idx-1]; state.objects[idx-1] = tmp;
        indices[i] = idx - 1;
      }
    }
    state.selectedSet = new Set(indices);
    state.selected    = indices[0];
  }

  render(); saveDebounced();
}

// ── Snip overlay UI ───────────────────────────────────────────────────────

let _snipRect = null;

function showSnipOverlay(r) {
  _snipRect = { ...r };
  const sx = wx2sx(r.x), sy = wy2sy(r.y);
  const sw = r.w * state.zoom, sh = r.h * state.zoom;
  const x = Math.min(sx, sx + sw), y = Math.min(sy, sy + sh);
  const w = Math.abs(sw), h = Math.abs(sh);

  snipOverlay.style.left   = x + 'px';
  snipOverlay.style.top    = (y + TOOLBAR_H) + 'px';
  snipOverlay.style.width  = w + 'px';
  snipOverlay.style.height = h + 'px';
  snipOverlay.classList.remove('hidden');
}

function hideSnipOverlay() {
  snipOverlay.classList.add('hidden');
  state.snipRect = null;
  _snipRect = null;
  render();
}

document.getElementById('snip-copy').addEventListener('click', () => {
  if (!_snipRect) return;
  const r = _snipRect;
  // Crop directly from the main canvas (WYSIWYG)
  const tmp = document.createElement('canvas');
  const sx = wx2sx(r.x), sy = wy2sy(r.y);
  const sw = r.w * state.zoom, sh = r.h * state.zoom;
  tmp.width  = Math.max(1, Math.round(Math.abs(sw)));
  tmp.height = Math.max(1, Math.round(Math.abs(sh)));
  const tc = tmp.getContext('2d');
  tc.drawImage(mainCanvas, Math.min(sx, sx+sw), Math.min(sy, sy+sh), Math.abs(sw), Math.abs(sh), 0, 0, tmp.width, tmp.height);

  tmp.toBlob(blob => {
    navigator.clipboard.write([new ClipboardItem({'image/png': blob})])
      .then(() => showToast('Snip copied'))
      .catch(err => console.error(err));
  }, 'image/png');
  hideSnipOverlay();
});

document.getElementById('snip-cancel').addEventListener('click', hideSnipOverlay);

// ── Marquee finish ────────────────────────────────────────────────────────

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
    syncControlsToSelection();
  }
}

// ── Shape factory ─────────────────────────────────────────────────────────

function makeShape(x1, y1, x2, y2) {
  if (state.tool === 'line')   return { type:'line', x1,y1,x2,y2, color:state.color, size:state.size, arrow:false };
  if (state.tool === 'arrow')  return { type:'line', x1,y1,x2,y2, color:state.color, size:state.size, arrow:true };
  if (state.tool === 'rect')   return { type:'rect', x:x1,y:y1,w:x2-x1,h:y2-y1, color:state.color, size:state.size, filled:state.filled };
  if (state.tool === 'ellipse')return { type:'ellipse', x:x1,y:y1,w:x2-x1,h:y2-y1, color:state.color, size:state.size, filled:state.filled };
}

// ── Resize ────────────────────────────────────────────────────────────────

function applyGroupMove(wx, wy) {
  const snaps = state.resizeObjStart;
  const dx = wx - state.resizeDragStart.wx;
  const dy = wy - state.resizeDragStart.wy;
  for (const { idx, snap } of snaps) {
    moveObj(state.objects[idx], snap, dx, dy);
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

function applyGroupResize(wx, wy) {
  const handle  = state.resizeHandle;
  const { groupB, objs } = state.resizeObjStart;
  let dx = wx - state.resizeDragStart.wx;
  let dy = wy - state.resizeDragStart.wy;

  // Compute new group rect
  const r = { x: groupB.x, y: groupB.y, w: groupB.w, h: groupB.h };
  if (handle.includes('e')) r.w = groupB.w + dx;
  if (handle.includes('s')) r.h = groupB.h + dy;
  if (handle.includes('w')) { r.x = groupB.x + dx; r.w = groupB.w - dx; }
  if (handle.includes('n')) { r.y = groupB.y + dy; r.h = groupB.h - dy; }

  // Shift: lock aspect ratio on corner handles
  if (state.shiftDown && handle.length === 2) {
    const aspect = state.resizeAspect || 1;
    if (Math.abs(r.w / groupB.w) > Math.abs(r.h / groupB.h)) {
      const newH = r.w / aspect;
      if (handle.includes('n')) r.y = groupB.y + groupB.h - newH;
      r.h = newH;
    } else {
      const newW = r.h * aspect;
      if (handle.includes('w')) r.x = groupB.x + groupB.w - newW;
      r.w = newW;
    }
  }

  if (Math.abs(r.w) < 4) r.w = 4 * Math.sign(r.w || 1);
  if (Math.abs(r.h) < 4) r.h = 4 * Math.sign(r.h || 1);

  const scaleX = r.w / groupB.w;
  const scaleY = r.h / groupB.h;

  for (const { idx, ob, snap } of objs) {
    const obj = state.objects[idx];

    if (obj.type === 'line') {
      obj.x1 = r.x + (snap.x1 - groupB.x) * scaleX;
      obj.y1 = r.y + (snap.y1 - groupB.y) * scaleY;
      obj.x2 = r.x + (snap.x2 - groupB.x) * scaleX;
      obj.y2 = r.y + (snap.y2 - groupB.y) * scaleY;
    } else if (obj.type === 'pen' || obj.type === 'eraser') {
      if (snap.points) {
        obj.points = snap.points.map(p => ({
          x: r.x + (p.x - groupB.x) * scaleX,
          y: r.y + (p.y - groupB.y) * scaleY,
        }));
      }
    } else {
      // Use bounding box origin (ob.x/y) for position scaling — consistent with groupB which is also from getBounds
      obj.x = r.x + (ob.x - groupB.x) * scaleX;
      obj.y = r.y + (ob.y - groupB.y) * scaleY;
      obj.w = ob.w * scaleX;
      obj.h = ob.h * scaleY;
      if (obj.type === 'text') obj.fontSize = Math.max(6, Math.abs(obj.h) * 0.75);
    }
  }
}

function applySingleResize(wx, wy) {
  const handle = state.resizeHandle;
  const obj    = state.objects[state.selected];

  if (state.spaceDown) {
    if (!state.spaceAnchor) {
      state.spaceAnchor = {
        wx, wy,
        snap: { ...obj, points: obj.points ? obj.points.map(p=>({...p})) : undefined }
      };
    }
    const dx = wx - state.spaceAnchor.wx;
    const dy = wy - state.spaceAnchor.wy;
    moveObj(obj, state.spaceAnchor.snap, dx, dy);
    return;
  }

  if (state.spaceAnchor) {
    const b = getBoundsNoRotation(obj);
    state.resizeDragStart = { wx, wy };
    state.resizeObjStart  = { ...b, ...obj, points: obj.points ? obj.points.map(p=>({...p})) : undefined };
    state.resizeAspect    = b.h ? b.w / b.h : 1;
    state.spaceAnchor     = null;
  }

  if (!['image','rect','ellipse','text'].includes(obj.type)) return;

  const snap = state.resizeObjStart;
  let dx = wx - state.resizeDragStart.wx;
  let dy = wy - state.resizeDragStart.wy;

  const r = { x: snap.x, y: snap.y, w: snap.w, h: snap.h };
  if (handle.includes('e')) r.w = snap.w + dx;
  if (handle.includes('s')) r.h = snap.h + dy;
  if (handle.includes('w')) { r.x = snap.x + dx; r.w = snap.w - dx; }
  if (handle.includes('n')) { r.y = snap.y + dy; r.h = snap.h - dy; }

  if (state.shiftDown && handle.length === 2) {
    const aspect = state.resizeAspect || 1;
    if (Math.abs(r.w / snap.w) > Math.abs(r.h / snap.h)) {
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

// ── Pan / zoom ────────────────────────────────────────────────────────────

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

  // Continuous scaling: use actual delta magnitude so touchpad pinch is smooth.
  // deltaMode 0 = pixels (touchpad), 1 = lines, 2 = pages.
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 32;
  if (e.deltaMode === 2) dy *= 400;
  const factor = Math.pow(0.999, dy); // ~10% per 100px, smooth for any delta
  state.zoom = Math.max(0.05, Math.min(20, state.zoom * factor));

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

// ── Cursor ────────────────────────────────────────────────────────────────

function updateCursor(e) {
  if (state.panning) return;
  if (state.spaceDown) { mainCanvas.style.cursor = 'grab'; return; }

  if (state.tool === 'snip' || state.tool === 'zoom') { mainCanvas.style.cursor = 'crosshair'; return; }

  if (state.tool === 'select') {
    const { x: wx, y: wy } = e.clientX != null ? screenToWorld(e.clientX, e.clientY) : { x:0, y:0 };

    if (state.altDown && state.selectedSet.size > 0) {
      // Check rotate handle
      const b = state.selectedSet.size > 1 ? groupBounds() : (state.selected !== null ? getBounds(state.objects[state.selected]) : null);
      if (b && hitTestRotateHandle(b, wx, wy)) {
        mainCanvas.style.cursor = 'grab';
        return;
      }
      mainCanvas.style.cursor = 'crosshair'; // alt held but not on handle → indicate alt mode
      return;
    }

    // Check resize handles for single or multi selection
    if (state.selectedSet.size > 0) {
      const b = state.selectedSet.size > 1 ? groupBounds() : (state.selected !== null ? getBoundsNoRotation(state.objects[state.selected]) : null);
      if (b) {
        const threshold = HANDLE_HIT / state.zoom;
        for (const [dir, pos] of Object.entries(handlePositions(b))) {
          if (Math.hypot(wx - pos.x, wy - pos.y) <= threshold) {
            mainCanvas.style.cursor = HANDLE_CURSOR[dir]; return;
          }
        }
      }
    }
    if (findObjectAt(wx, wy) !== null) { mainCanvas.style.cursor = 'move'; return; }
    mainCanvas.style.cursor = 'default';
    return;
  }

  const map = { pen:'crosshair', line:'crosshair', arrow:'crosshair',
                rect:'crosshair', ellipse:'crosshair', text:'text', eraser:'cell', zoom:'crosshair' };
  mainCanvas.style.cursor = map[state.tool] || 'default';
}

// ── Keyboard ──────────────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (e.target === textInput) {
    if (e.key === 'Enter') { commitTextEdit(); e.preventDefault(); }
    if (e.key === 'Escape') { cancelTextEdit(); e.preventDefault(); }
    return;
  }

  if (e.key === ' ') { state.spaceDown = true; updateCursor({}); e.preventDefault(); return; }
  if (e.key === 'Alt' || e.key === 'Option') { state.altDown = true; updateCursor({}); render(); return; }
  if (e.key === 'Shift') { state.shiftDown = true; return; }

  if ((e.ctrlKey || e.metaKey)) {
    if (e.key === 'z') { undo(); e.preventDefault(); return; }
    if (e.key === '0') { state.zoom=1; state.vx=0; state.vy=0; updateZoomLabel(); render(); e.preventDefault(); return; }
    if (e.key === 'c') { copyToClipboard(e); e.preventDefault(); return; }
    if (e.key === 'a') {
      e.preventDefault();
      if (state.objects.length) {
        state.selectedSet = new Set(state.objects.map((_,i) => i));
        state.selected    = state.objects.length - 1;
        syncControlsToSelection();
        render();
      }
      return;
    }
  }

  const toolMap = { v:'select', p:'pen', l:'line', a:'arrow', r:'rect', e:'ellipse', t:'text', x:'eraser', s:'snip', z:'zoom' };
  if (!e.ctrlKey && !e.metaKey && toolMap[e.key.toLowerCase()]) {
    setTool(toolMap[e.key.toLowerCase()]); return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  if (e.key === 'Escape') {
    if (!snipOverlay.classList.contains('hidden')) { hideSnipOverlay(); return; }
    state.selected=null; state.selectedSet.clear();
    marqueeDiv.style.display='none'; state.marqueeRect=null;
    render();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ')   { state.spaceDown = false; updateCursor({}); }
  if (e.key === 'Alt' || e.key === 'Option') { state.altDown = false; updateCursor({}); render(); }
  if (e.key === 'Shift') state.shiftDown = false;
});

// ── Tools ─────────────────────────────────────────────────────────────────

function setTool(name) {
  // Cancel snip if switching away
  if (state.tool === 'snip' && name !== 'snip') {
    hideSnipOverlay();
    state.snipRect = null; state.snipStart = null;
    render();
  }
  // Cancel zoom drag if switching away
  if (state.tool === 'zoom' && name !== 'zoom') {
    state.zoomRect = null; state.zoomStart = null;
    render();
  }
  state.tool = name;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tool === name));
  if (name !== 'text' && state.editingTextIndex !== null) commitTextEdit();
  updateCursor({});
}
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn =>
  btn.addEventListener('click', () => setTool(btn.dataset.tool)));

// ── Style controls ────────────────────────────────────────────────────────

colorPicker.addEventListener('input', () => {
  state.color = colorPicker.value;
  if (state.selectedSet.size > 0) {
    for (const idx of state.selectedSet) {
      const obj = state.objects[idx];
      if (obj) {
        obj.color = state.color;
        if (state.editingTextIndex === idx) textInput.style.color = state.color;
      }
    }
    render(); saveDebounced();
    return;
  }
  if (state.editingTextIndex !== null) {
    state.objects[state.editingTextIndex].color = state.color;
    textInput.style.color = state.color;
    render();
  }
});

sizeSlider.addEventListener('input', () => {
  state.size = +sizeSlider.value;
  sizeLabelEl.textContent = state.size;
  if (state.selectedSet.size > 0) {
    for (const idx of state.selectedSet) {
      const obj = state.objects[idx];
      if (!obj) continue;
      if (obj.type === 'text') {
        obj.fontSize = Math.max(8, state.size * 2.5);
        obj.h = obj.fontSize * 1.3;
      } else if (obj.type !== 'image') {
        obj.size = state.size;
      }
    }
    render(); saveDebounced();
  }
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
  if (state.selectedSet.size > 0) {
    for (const idx of state.selectedSet) {
      const obj = state.objects[idx];
      if (obj && (obj.type === 'rect' || obj.type === 'ellipse')) obj.filled = state.filled;
    }
    render(); saveDebounced();
  }
});

// ── Background controls ───────────────────────────────────────────────────

bgColorPicker.addEventListener('input', () => {
  state.bgColor = bgColorPicker.value;
  state.bgTransparent = false;
  bgTransBtn.classList.remove('active');
  render();
});

bgTransBtn.addEventListener('click', () => {
  state.bgTransparent = !state.bgTransparent;
  bgTransBtn.classList.toggle('active', state.bgTransparent);
  render();
});

// ── Text tool ─────────────────────────────────────────────────────────────

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
  if (state.editingTextIndex !== null) {
    const obj = state.objects[state.editingTextIndex];
    if (obj) {
      obj.text = textInput.value;
      ctx.font = `${obj.fontSize}px system-ui, -apple-system, sans-serif`;
      obj.w = Math.max(20, ctx.measureText(obj.text || 'M').width + 4);
      render();
    }
  }
});

textInput.addEventListener('blur', () => { commitTextEdit(); });

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
  const obj = state.objects[idx];
  if (obj && !obj.text) {
    state.objects.splice(idx, 1);
    state.selected = null; state.selectedSet.clear();
  }
  render();
}

// ── Action buttons ────────────────────────────────────────────────────────

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
  }).catch(() => { mainCanvas.focus(); });
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

function syncControlsToSelection() {
  if (state.selected === null || !state.objects[state.selected]) return;
  const obj = state.objects[state.selected];
  if (obj.color) { colorPicker.value = obj.color; state.color = obj.color; }
  if (obj.type === 'text') {
    const sz = Math.max(1, Math.min(40, Math.round(obj.fontSize / 2.5)));
    sizeSlider.value = sz; sizeLabelEl.textContent = sz; state.size = sz;
  } else if (obj.size !== undefined) {
    const sz = Math.max(1, Math.min(40, obj.size));
    sizeSlider.value = sz; sizeLabelEl.textContent = sz; state.size = sz;
  }
  if (obj.filled !== undefined) {
    fillFilled = obj.filled; state.filled = obj.filled;
    fillToggle.classList.toggle('toggled', obj.filled);
    const icon = document.getElementById('fill-icon');
    if (obj.filled) { icon.setAttribute('fill', 'currentColor'); icon.removeAttribute('stroke'); }
    else { icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); }
  }
}

function deleteSelected() {
  if (!state.selectedSet.size) return;
  snapshot();
  const toRemove = [...state.selectedSet].sort((a,b)=>b-a);
  for (const idx of toRemove) state.objects.splice(idx, 1);
  state.selected=null; state.selectedSet.clear();
  render(); saveDebounced();
}

// ── Clone helper ──────────────────────────────────────────────────────────

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

// ── Paste from clipboard ──────────────────────────────────────────────────

window.addEventListener('paste', (e) => {
  if (e.target === textInput) return;
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) {
      dataURLFromFile(item.getAsFile(), (url) => addImage(url));
    }
  }
});

// ── Drag & drop ───────────────────────────────────────────────────────────

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

// ── Screen region capture ─────────────────────────────────────────────────

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

// ── Composite helper ──────────────────────────────────────────────────────

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

// ── Copy to clipboard ─────────────────────────────────────────────────────

function copyToClipboard(e) {
  let objs = state.objects;

  if (e && state.selectedSet.size > 0) {
    objs = [...state.selectedSet].map(i => state.objects[i]).filter(Boolean);
  } else if (e && state.marqueeRect) {
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

// ── Export PNG ────────────────────────────────────────────────────────────

function exportPNG() {
  if (!state.objects.length) { alert('Nothing to export.'); return; }
  const bg = state.bgTransparent ? null : (state.bgColor || '#1a1917');
  const exp = compositeObjects(state.objects, bg);
  if (!exp) return;
  const a = document.createElement('a');
  a.href     = exp.toDataURL('image/png');
  a.download = 'snipboard-' + Date.now() + '.png';
  a.click();
}

// ── Session UI ────────────────────────────────────────────────────────────

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

// ── Utilities ─────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Boot ──────────────────────────────────────────────────────────────────

initSession();
setTool('select');
