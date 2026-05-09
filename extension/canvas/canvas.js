// SnipBoard — canvas.js
'use strict';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  objects: [],      // all canvas objects
  undoStack: [],    // snapshots for undo
  selected: null,   // index into objects[]
  tool: 'select',
  color: '#f38ba8',
  size: 4,
  filled: false,
  arrowTip: false,
  vx: 0, vy: 0,    // viewport offset (world coords of top-left corner)
  zoom: 1,
  dragging: false,
  panning: false,
  spaceDown: false,
  panStart: null,
  drawStart: null,
  currentStroke: null,  // live pen stroke points
  currentShape: null,   // live shape preview
  resizeHandle: null,   // 'nw','n','ne','e','se','s','sw','w' or 'move'
  resizeDragStart: null,
  resizeObjStart: null,
};

// ── Elements ─────────────────────────────────────────────────────────────────

const mainCanvas = document.getElementById('main-canvas');
const ctx = mainCanvas.getContext('2d');
const regionOverlay = document.getElementById('region-overlay');
const regionCanvas = document.getElementById('region-canvas');
const regionCtx = regionCanvas.getContext('2d');
const regionSelection = document.getElementById('region-selection');
const textInput = document.getElementById('text-input');
const sessionModal = document.getElementById('session-modal');
const zoomLabel = document.getElementById('zoom-label');
const colorPicker = document.getElementById('color-picker');
const sizeSlider = document.getElementById('size-slider');
const sizeLabel = document.getElementById('size-label');
const fileInput = document.getElementById('file-input');
const fillToggle = document.getElementById('fill-toggle');
const arrowToggle = document.getElementById('arrow-toggle');

// ── Resize canvas to window ───────────────────────────────────────────────────

function resizeCanvas() {
  const TOOLBAR_H = 48;
  mainCanvas.width = window.innerWidth;
  mainCanvas.height = window.innerHeight - TOOLBAR_H;
  render();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Coordinate transforms ─────────────────────────────────────────────────────

function screenToWorld(sx, sy) {
  return {
    x: (sx - mainCanvas.getBoundingClientRect().left) / state.zoom + state.vx,
    y: (sy - mainCanvas.getBoundingClientRect().top) / state.zoom + state.vy,
  };
}

function worldToScreen(wx, wy) {
  const r = mainCanvas.getBoundingClientRect();
  return {
    x: (wx - state.vx) * state.zoom + r.left,
    y: (wy - state.vy) * state.zoom + r.top,
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

const HANDLE_SIZE = 6;
const HANDLE_DIRS = ['nw','n','ne','e','se','s','sw','w'];

function render() {
  ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

  // Grid dots
  drawGrid();

  ctx.save();
  ctx.scale(state.zoom, state.zoom);
  ctx.translate(-state.vx, -state.vy);

  // Draw all objects
  for (let i = 0; i < state.objects.length; i++) {
    drawObject(ctx, state.objects[i]);
  }

  // Draw in-progress pen stroke
  if (state.currentStroke) {
    applyStrokeStyle(ctx, state.currentStroke);
    ctx.beginPath();
    const pts = state.currentStroke.points;
    if (pts.length > 0) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }

  // Draw in-progress shape
  if (state.currentShape) drawObject(ctx, state.currentShape);

  ctx.restore();

  // Draw selection handles (in screen space to keep handle size constant)
  if (state.selected !== null && state.objects[state.selected]) {
    const obj = state.objects[state.selected];
    if (obj.type === 'image' || obj.type === 'text' || obj.type === 'rect' || obj.type === 'ellipse') {
      drawSelectionHandles(obj);
    } else {
      drawObjectHighlight(obj);
    }
  }
}

function drawGrid() {
  const step = 40 * state.zoom;
  const ox = ((-state.vx * state.zoom) % step + step) % step;
  const oy = ((-state.vy * state.zoom) % step + step) % step;
  ctx.fillStyle = '#313244';
  for (let x = ox; x < mainCanvas.width; x += step) {
    for (let y = oy; y < mainCanvas.height; y += step) {
      ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
    }
  }
}

function applyStrokeStyle(c, obj) {
  c.strokeStyle = obj.color;
  c.lineWidth = obj.size;
  c.lineCap = 'round';
  c.lineJoin = 'round';
}

function drawObject(c, obj) {
  c.save();
  switch (obj.type) {
    case 'image': {
      if (obj.imgEl && obj.imgEl.complete) {
        c.drawImage(obj.imgEl, obj.x, obj.y, obj.w, obj.h);
      }
      break;
    }
    case 'pen': {
      applyStrokeStyle(c, obj);
      c.beginPath();
      const pts = obj.points;
      if (pts.length === 1) {
        c.arc(pts[0].x, pts[0].y, obj.size / 2, 0, Math.PI * 2);
        c.fillStyle = obj.color;
        c.fill();
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
      const x = Math.min(obj.x, obj.x + obj.w);
      const y = Math.min(obj.y, obj.y + obj.h);
      const w = Math.abs(obj.w);
      const h = Math.abs(obj.h);
      applyStrokeStyle(c, obj);
      if (obj.filled) {
        c.fillStyle = obj.color;
        c.fillRect(x, y, w, h);
      } else {
        c.strokeRect(x, y, w, h);
      }
      break;
    }
    case 'ellipse': {
      const cx = obj.x + obj.w / 2;
      const cy = obj.y + obj.h / 2;
      applyStrokeStyle(c, obj);
      c.beginPath();
      c.ellipse(cx, cy, Math.abs(obj.w / 2), Math.abs(obj.h / 2), 0, 0, Math.PI * 2);
      if (obj.filled) { c.fillStyle = obj.color; c.fill(); }
      else c.stroke();
      break;
    }
    case 'text': {
      c.font = `${obj.fontSize}px system-ui, sans-serif`;
      c.fillStyle = obj.color;
      c.fillText(obj.text, obj.x, obj.y + obj.fontSize);
      break;
    }
    case 'eraser': {
      c.globalCompositeOperation = 'destination-out';
      applyStrokeStyle(c, obj);
      c.strokeStyle = 'rgba(0,0,0,1)';
      c.lineWidth = obj.size;
      c.beginPath();
      const pts = obj.points;
      if (pts.length === 1) {
        c.arc(pts[0].x, pts[0].y, obj.size / 2, 0, Math.PI * 2);
        c.fill();
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
  const dx = obj.x2 - obj.x1;
  const dy = obj.y2 - obj.y1;
  const angle = Math.atan2(dy, dx);
  const len = Math.max(obj.size * 4, 12);
  c.save();
  c.strokeStyle = obj.color;
  c.lineWidth = obj.size;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(obj.x2, obj.y2);
  c.lineTo(obj.x2 - len * Math.cos(angle - Math.PI / 6), obj.y2 - len * Math.sin(angle - Math.PI / 6));
  c.moveTo(obj.x2, obj.y2);
  c.lineTo(obj.x2 - len * Math.cos(angle + Math.PI / 6), obj.y2 - len * Math.sin(angle + Math.PI / 6));
  c.stroke();
  c.restore();
}

function getBounds(obj) {
  switch (obj.type) {
    case 'image': return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    case 'rect': return { x: Math.min(obj.x, obj.x+obj.w), y: Math.min(obj.y, obj.y+obj.h), w: Math.abs(obj.w), h: Math.abs(obj.h) };
    case 'ellipse': return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
    case 'text': {
      ctx.save();
      ctx.font = `${obj.fontSize}px system-ui, sans-serif`;
      const m = ctx.measureText(obj.text);
      ctx.restore();
      return { x: obj.x, y: obj.y, w: m.width, h: obj.fontSize * 1.4 };
    }
    case 'line': return {
      x: Math.min(obj.x1, obj.x2), y: Math.min(obj.y1, obj.y2),
      w: Math.abs(obj.x2-obj.x1)||20, h: Math.abs(obj.y2-obj.y1)||20
    };
    case 'pen': case 'eraser': {
      const xs = obj.points.map(p=>p.x), ys = obj.points.map(p=>p.y);
      const minX=Math.min(...xs), minY=Math.min(...ys);
      return { x: minX, y: minY, w: Math.max(...xs)-minX||20, h: Math.max(...ys)-minY||20 };
    }
    default: return { x: 0, y: 0, w: 0, h: 0 };
  }
}

function handlePositions(b) {
  const { x, y, w, h } = b;
  return {
    nw: { x, y }, n: { x: x+w/2, y }, ne: { x: x+w, y },
    e:  { x: x+w, y: y+h/2 },
    se: { x: x+w, y: y+h }, s: { x: x+w/2, y: y+h }, sw: { x, y: y+h },
    w:  { x, y: y+h/2 },
  };
}

function drawSelectionHandles(obj) {
  const b = getBounds(obj);
  const s2w = (wx, wy) => ({
    x: (wx - state.vx) * state.zoom,
    y: (wy - state.vy) * state.zoom,
  });

  const sx = (wx) => (wx - state.vx) * state.zoom;
  const sy = (wy) => (wy - state.vy) * state.zoom;

  ctx.save();
  ctx.strokeStyle = '#89b4fa';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(sx(b.x)-1, sy(b.y)-1, b.w*state.zoom+2, b.h*state.zoom+2);
  ctx.setLineDash([]);

  const handles = handlePositions(b);
  ctx.fillStyle = '#89b4fa';
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1.5;
  for (const pos of Object.values(handles)) {
    const px = sx(pos.x), py = sy(pos.y);
    ctx.beginPath();
    ctx.arc(px, py, HANDLE_SIZE, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawObjectHighlight(obj) {
  const b = getBounds(obj);
  const sx = (wx) => (wx - state.vx) * state.zoom;
  const sy = (wy) => (wy - state.vy) * state.zoom;
  ctx.save();
  ctx.strokeStyle = '#89b4fa';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(sx(b.x)-4, sy(b.y)-4, b.w*state.zoom+8, b.h*state.zoom+8);
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Hit testing ───────────────────────────────────────────────────────────────

function hitTestHandle(obj, wx, wy) {
  if (!['image','text','rect','ellipse'].includes(obj.type)) return null;
  const b = getBounds(obj);
  const handles = handlePositions(b);
  const threshold = (HANDLE_SIZE + 4) / state.zoom;
  for (const [dir, pos] of Object.entries(handles)) {
    const dx = wx - pos.x, dy = wy - pos.y;
    if (Math.sqrt(dx*dx + dy*dy) <= threshold) return dir;
  }
  return null;
}

function hitTestObject(obj, wx, wy) {
  const b = getBounds(obj);
  const pad = Math.max(6, obj.size || 0) / 2;
  return wx >= b.x - pad && wx <= b.x + b.w + pad &&
         wy >= b.y - pad && wy <= b.y + b.h + pad;
}

function findObjectAt(wx, wy) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    if (hitTestObject(state.objects[i], wx, wy)) return i;
  }
  return null;
}

// ── Undo ──────────────────────────────────────────────────────────────────────

function snapshot() {
  state.undoStack.push(JSON.stringify(state.objects.map(serializeObj)));
  if (state.undoStack.length > 60) state.undoStack.shift();
}

function undo() {
  if (!state.undoStack.length) return;
  const prev = state.undoStack.pop();
  state.objects = JSON.parse(prev).map(deserializeObj);
  state.selected = null;
  render();
  saveSession();
}

// ── Session persistence ───────────────────────────────────────────────────────

const SESSION_KEY = 'canvas_session';

function serializeObj(obj) {
  if (obj.type === 'image') {
    return { ...obj, imgEl: undefined };
  }
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
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.objects.map(serializeObj)));
  } catch (e) {
    // storage full — silently ignore
  }
}

const saveDebounced = debounce(saveSession, 1000);

function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return false;
    state.objects = data.map(deserializeObj);
    return true;
  } catch { return false; }
}

// ── Add image to canvas ───────────────────────────────────────────────────────

function addImage(dataURL, cx, cy) {
  const img = new Image();
  img.onload = () => {
    const maxW = mainCanvas.width * 0.6 / state.zoom;
    const maxH = mainCanvas.height * 0.6 / state.zoom;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxW) { h = h * maxW / w; w = maxW; }
    if (h > maxH) { w = w * maxH / h; h = maxH; }
    const x = (cx ?? state.vx + mainCanvas.width / state.zoom / 2) - w / 2;
    const y = (cy ?? state.vy + mainCanvas.height / state.zoom / 2) - h / 2;
    snapshot();
    state.objects.push({ type: 'image', x, y, w, h, dataURL, imgEl: img });
    state.selected = state.objects.length - 1;
    render();
    saveDebounced();
  };
  img.src = dataURL;
}

function dataURLFromFile(file, cb) {
  const reader = new FileReader();
  reader.onload = (e) => cb(e.target.result);
  reader.readAsDataURL(file);
}

// ── Mouse events ──────────────────────────────────────────────────────────────

mainCanvas.addEventListener('mousedown', onMouseDown);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);

function onMouseDown(e) {
  if (e.button === 1) { startPan(e); return; }
  if (state.spaceDown && e.button === 0) { startPan(e); return; }
  if (e.button !== 0) return;

  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

  if (state.tool === 'select') {
    // Check handles first
    if (state.selected !== null) {
      const obj = state.objects[state.selected];
      const handle = hitTestHandle(obj, wx, wy);
      if (handle) {
        snapshot();
        state.resizeHandle = handle;
        state.resizeDragStart = { wx, wy };
        const b = getBounds(obj);
        state.resizeObjStart = { ...b, ...obj };
        state.dragging = true;
        return;
      }
    }
    // Check object click
    const idx = findObjectAt(wx, wy);
    if (idx !== null) {
      state.selected = idx;
      snapshot();
      state.resizeHandle = 'move';
      state.resizeDragStart = { wx, wy };
      state.resizeObjStart = { ...state.objects[idx] };
      state.dragging = true;
    } else {
      state.selected = null;
    }
    render();
    return;
  }

  if (state.tool === 'eraser') {
    snapshot();
    state.currentStroke = { type: 'eraser', points: [{ x: wx, y: wy }], color: '#000', size: state.size };
    state.dragging = true;
    return;
  }

  if (state.tool === 'pen') {
    snapshot();
    state.currentStroke = { type: 'pen', points: [{ x: wx, y: wy }], color: state.color, size: state.size };
    state.dragging = true;
    return;
  }

  if (state.tool === 'text') {
    showTextInput(wx, wy, e.clientX, e.clientY);
    return;
  }

  // Shape tools
  if (['line','rect','ellipse'].includes(state.tool)) {
    snapshot();
    state.drawStart = { wx, wy };
    state.currentShape = makeShape(wx, wy, wx, wy);
    state.dragging = true;
  }
}

function onMouseMove(e) {
  if (state.panning) {
    const dx = (e.clientX - state.panStart.x) / state.zoom;
    const dy = (e.clientY - state.panStart.y) / state.zoom;
    state.vx = state.panStart.vx - dx;
    state.vy = state.panStart.vy - dy;
    state.panStart.x = e.clientX;
    state.panStart.y = e.clientY;
    state.panStart.vx = state.vx;
    state.panStart.vy = state.vy;
    render();
    return;
  }

  if (!state.dragging) {
    updateCursor(e);
    return;
  }

  const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

  if (state.resizeHandle) {
    applyResize(wx, wy);
    render();
    return;
  }

  if (state.currentStroke) {
    state.currentStroke.points.push({ x: wx, y: wy });
    render();
    return;
  }

  if (state.currentShape && state.drawStart) {
    state.currentShape = makeShape(state.drawStart.wx, state.drawStart.wy, wx, wy);
    render();
  }
}

function onMouseUp(e) {
  if (state.panning) { stopPan(); return; }
  if (!state.dragging) return;
  state.dragging = false;

  if (state.resizeHandle) {
    state.resizeHandle = null;
    state.resizeDragStart = null;
    state.resizeObjStart = null;
    saveDebounced();
    return;
  }

  if (state.currentStroke) {
    state.objects.push(state.currentStroke);
    state.currentStroke = null;
    render();
    saveDebounced();
    return;
  }

  if (state.currentShape) {
    const shape = state.currentShape;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    state.currentShape = makeShape(state.drawStart.wx, state.drawStart.wy, wx, wy);
    // Don't add degenerate shapes
    const isDegenerate = shape.type === 'line'
      ? Math.hypot(shape.x2-shape.x1, shape.y2-shape.y1) < 3
      : Math.abs(shape.w) < 3 || Math.abs(shape.h) < 3;
    if (!isDegenerate) {
      state.objects.push(state.currentShape);
      state.selected = state.objects.length - 1;
    }
    state.currentShape = null;
    state.drawStart = null;
    render();
    saveDebounced();
  }
}

function makeShape(x1, y1, x2, y2) {
  if (state.tool === 'line') {
    return { type: 'line', x1, y1, x2, y2, color: state.color, size: state.size, arrow: state.arrowTip };
  }
  if (state.tool === 'rect') {
    return { type: 'rect', x: x1, y: y1, w: x2-x1, h: y2-y1, color: state.color, size: state.size, filled: state.filled };
  }
  if (state.tool === 'ellipse') {
    return { type: 'ellipse', x: x1, y: y1, w: x2-x1, h: y2-y1, color: state.color, size: state.size, filled: state.filled };
  }
}

function applyResize(wx, wy) {
  const handle = state.resizeHandle;
  const obj = state.objects[state.selected];
  const start = state.resizeObjStart;
  const dx = wx - state.resizeDragStart.wx;
  const dy = wy - state.resizeDragStart.wy;

  if (handle === 'move') {
    if (obj.type === 'line') {
      obj.x1 = start.x1 + dx; obj.y1 = start.y1 + dy;
      obj.x2 = start.x2 + dx; obj.y2 = start.y2 + dy;
    } else if (obj.type === 'pen' || obj.type === 'eraser') {
      obj.points = start.points ? start.points.map(p => ({ x: p.x + dx, y: p.y + dy })) : obj.points;
    } else {
      obj.x = (start.x ?? start.x1) + dx;
      obj.y = (start.y ?? start.y1) + dy;
    }
    return;
  }

  // Resize for box-like objects
  if (!['image','rect','ellipse','text'].includes(obj.type)) return;
  const r = { x: start.x, y: start.y, w: start.w, h: start.h };

  if (handle.includes('e')) r.w = start.w + dx;
  if (handle.includes('s')) r.h = start.h + dy;
  if (handle.includes('w')) { r.x = start.x + dx; r.w = start.w - dx; }
  if (handle.includes('n')) { r.y = start.y + dy; r.h = start.h - dy; }

  // Minimum size
  if (Math.abs(r.w) < 10) r.w = 10 * Math.sign(r.w || 1);
  if (Math.abs(r.h) < 10) r.h = 10 * Math.sign(r.h || 1);

  obj.x = r.x; obj.y = r.y; obj.w = r.w; obj.h = r.h;
  if (obj.type === 'text') obj.fontSize = Math.max(8, Math.abs(r.h) * 0.7);
}

function startPan(e) {
  state.panning = true;
  state.panStart = { x: e.clientX, y: e.clientY, vx: state.vx, vy: state.vy };
  mainCanvas.style.cursor = 'grabbing';
}

function stopPan() {
  state.panning = false;
  mainCanvas.style.cursor = '';
  updateCursor({ clientX: 0, clientY: 0 });
}

function updateCursor(e) {
  if (state.spaceDown) { mainCanvas.style.cursor = 'grab'; return; }
  const cursors = {
    select: 'default', pen: 'crosshair', line: 'crosshair',
    rect: 'crosshair', ellipse: 'crosshair', text: 'text', eraser: 'cell',
  };
  mainCanvas.style.cursor = cursors[state.tool] || 'default';
}

// ── Zoom ──────────────────────────────────────────────────────────────────────

mainCanvas.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) {
    // Pan with scroll
    state.vx += e.deltaX / state.zoom;
    state.vy += e.deltaY / state.zoom;
    render();
    return;
  }
  e.preventDefault();
  const rect = mainCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const worldX = mx / state.zoom + state.vx;
  const worldY = my / state.zoom + state.vy;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  state.zoom = Math.max(0.1, Math.min(10, state.zoom * factor));
  state.vx = worldX - mx / state.zoom;
  state.vy = worldY - my / state.zoom;
  zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
  render();
}, { passive: false });

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (e.target === textInput) return;
  if (e.key === ' ') { state.spaceDown = true; mainCanvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { undo(); return; }
    if (e.key === '0') { state.zoom = 1; state.vx = 0; state.vy = 0; zoomLabel.textContent = '100%'; render(); return; }
    return;
  }
  const toolMap = { v: 'select', p: 'pen', l: 'line', r: 'rect', e: 'ellipse', t: 'text', x: 'eraser' };
  if (toolMap[e.key.toLowerCase()]) {
    setTool(toolMap[e.key.toLowerCase()]);
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected !== null) {
    deleteSelected();
  }
  if (e.key === 'Escape') {
    state.selected = null;
    render();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ') { state.spaceDown = false; updateCursor(e); }
});

// ── Tool selection ────────────────────────────────────────────────────────────

function setTool(name) {
  state.tool = name;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === name);
  });
  updateCursor({});
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

// ── Style controls ────────────────────────────────────────────────────────────

colorPicker.addEventListener('input', () => { state.color = colorPicker.value; });
sizeSlider.addEventListener('input', () => {
  state.size = +sizeSlider.value;
  sizeLabel.textContent = state.size;
});

fillToggle.addEventListener('click', () => {
  state.filled = !state.filled;
  fillToggle.classList.toggle('toggled', state.filled);
  fillToggle.textContent = state.filled ? '◼' : '◻';
});

arrowToggle.addEventListener('click', () => {
  state.arrowTip = !state.arrowTip;
  arrowToggle.classList.toggle('toggled', state.arrowTip);
});

// ── Text tool ─────────────────────────────────────────────────────────────────

function showTextInput(wx, wy, clientX, clientY) {
  const TOOLBAR_H = 48;
  textInput.style.left = clientX + 'px';
  textInput.style.top = (clientY) + 'px';
  textInput.style.fontSize = Math.max(12, state.size * 2) + 'px';
  textInput.style.color = state.color;
  textInput.classList.remove('hidden');
  textInput.value = '';
  textInput.focus();
  textInput._wx = wx;
  textInput._wy = wy;
  textInput._fontSize = Math.max(12, state.size * 2);
}

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') {
    const text = textInput.value.trim();
    if (text && e.key === 'Enter') {
      snapshot();
      state.objects.push({
        type: 'text', x: textInput._wx, y: textInput._wy,
        text, color: state.color, fontSize: textInput._fontSize,
        w: 200, h: textInput._fontSize * 1.4,
      });
      state.selected = state.objects.length - 1;
      saveDebounced();
      render();
    }
    textInput.classList.add('hidden');
    textInput.blur();
  }
});

// ── Action buttons ────────────────────────────────────────────────────────────

document.getElementById('btn-paste').addEventListener('click', () => {
  mainCanvas.focus();
  document.execCommand('paste'); // triggers the paste event
});

document.getElementById('btn-file').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  for (const file of fileInput.files) {
    if (!file.type.startsWith('image/')) continue;
    dataURLFromFile(file, (dataURL) => addImage(dataURL));
  }
  fileInput.value = '';
});

document.getElementById('btn-tab').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'captureTab' }, (res) => {
    if (res && res.dataURL) addImage(res.dataURL);
    else alert('Could not capture tab: ' + (res?.error || 'unknown error'));
  });
});

document.getElementById('btn-region').addEventListener('click', startRegionCapture);

document.getElementById('btn-undo').addEventListener('click', undo);

document.getElementById('btn-delete').addEventListener('click', deleteSelected);

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear all objects?')) return;
  snapshot();
  state.objects = [];
  state.selected = null;
  render();
  saveDebounced();
});

document.getElementById('btn-export').addEventListener('click', exportPNG);

function deleteSelected() {
  if (state.selected === null) return;
  snapshot();
  state.objects.splice(state.selected, 1);
  state.selected = null;
  render();
  saveDebounced();
}

// ── Paste from clipboard ──────────────────────────────────────────────────────

window.addEventListener('paste', (e) => {
  if (e.target === textInput) return;
  const items = e.clipboardData.items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      dataURLFromFile(blob, (dataURL) => addImage(dataURL));
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
    const cx = wx, cy = wy;
    dataURLFromFile(file, (dataURL) => addImage(dataURL, cx, cy));
  }
  // Also handle dragged images from web pages
  const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (url && url.startsWith('data:image')) addImage(url, wx, wy);
});

// ── Screen region capture ─────────────────────────────────────────────────────

function startRegionCapture() {
  chrome.runtime.sendMessage({ action: 'captureRegion' }, async (res) => {
    if (!res || res.error) return; // user cancelled

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: res.streamId,
            minWidth: 1, maxWidth: 9999,
            minHeight: 1, maxHeight: 9999,
          }
        },
        audio: false,
      });
    } catch (err) {
      console.error('getUserMedia failed:', err);
      return;
    }

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;

    video.onloadedmetadata = () => {
      video.play().then(() => {
        const processFrame = () => {
          const vw = video.videoWidth, vh = video.videoHeight;

          // Capture undimmed frame to a source canvas for later cropping
          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = vw;
          srcCanvas.height = vh;
          srcCanvas.getContext('2d').drawImage(video, 0, 0);

          stream.getTracks().forEach(t => t.stop());

          // Draw scaled + dimmed version onto the overlay canvas
          regionCanvas.width = window.innerWidth;
          regionCanvas.height = window.innerHeight;

          const scale = Math.max(regionCanvas.width / vw, regionCanvas.height / vh);
          const dw = vw * scale, dh = vh * scale;
          const dx = (regionCanvas.width - dw) / 2;
          const dy = (regionCanvas.height - dh) / 2;

          regionCtx.drawImage(srcCanvas, 0, 0, vw, vh, dx, dy, dw, dh);
          regionCtx.fillStyle = 'rgba(0,0,0,0.45)';
          regionCtx.fillRect(0, 0, regionCanvas.width, regionCanvas.height);

          regionCanvas._captureFrame = { srcCanvas, dx, dy, dw, dh, vw, vh };
          showRegionOverlay();
        };

        if (video.requestVideoFrameCallback) {
          video.requestVideoFrameCallback(processFrame);
        } else {
          setTimeout(processFrame, 150);
        }
      });
    };
  });
}

let regionDrag = { active: false, x0: 0, y0: 0 };

function showRegionOverlay() {
  regionOverlay.classList.remove('hidden');
  regionSelection.style.display = 'none';
  regionDrag = { active: false };
}

function hideRegionOverlay() {
  regionOverlay.classList.add('hidden');
}

regionOverlay.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  regionDrag.active = true;
  regionDrag.x0 = e.clientX;
  regionDrag.y0 = e.clientY;
  regionSelection.style.left = e.clientX + 'px';
  regionSelection.style.top = e.clientY + 'px';
  regionSelection.style.width = '0';
  regionSelection.style.height = '0';
  regionSelection.style.display = 'block';
});

regionOverlay.addEventListener('mousemove', (e) => {
  if (!regionDrag.active) return;
  const x = Math.min(e.clientX, regionDrag.x0);
  const y = Math.min(e.clientY, regionDrag.y0);
  const w = Math.abs(e.clientX - regionDrag.x0);
  const h = Math.abs(e.clientY - regionDrag.y0);
  regionSelection.style.left = x + 'px';
  regionSelection.style.top = y + 'px';
  regionSelection.style.width = w + 'px';
  regionSelection.style.height = h + 'px';
});

regionOverlay.addEventListener('mouseup', (e) => {
  if (!regionDrag.active) return;
  regionDrag.active = false;

  const rx = Math.min(e.clientX, regionDrag.x0);
  const ry = Math.min(e.clientY, regionDrag.y0);
  const rw = Math.abs(e.clientX - regionDrag.x0);
  const rh = Math.abs(e.clientY - regionDrag.y0);

  hideRegionOverlay();

  if (rw < 5 || rh < 5) return; // too small

  // Map screen rect → video source rect
  const f = regionCanvas._captureFrame;
  const scaleX = f.vw / f.dw;
  const scaleY = f.vh / f.dh;
  const srcX = Math.round((rx - f.dx) * scaleX);
  const srcY = Math.round((ry - f.dy) * scaleY);
  const srcW = Math.round(rw * scaleX);
  const srcH = Math.round(rh * scaleY);

  // Crop from the undimmed source canvas
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.max(1, srcW);
  cropCanvas.height = Math.max(1, srcH);
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.drawImage(f.srcCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  addImage(cropCanvas.toDataURL('image/png'));
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !regionOverlay.classList.contains('hidden')) {
    hideRegionOverlay();
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

function exportPNG() {
  if (state.objects.length === 0) { alert('Nothing to export.'); return; }

  // Compute bounding box of all content
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of state.objects) {
    const b = getBounds(obj);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }

  const PAD = 20;
  const W = maxX - minX + PAD * 2;
  const H = maxY - minY + PAD * 2;

  const exp = document.createElement('canvas');
  exp.width = W;
  exp.height = H;
  const ec = exp.getContext('2d');
  ec.fillStyle = '#1e1e2e';
  ec.fillRect(0, 0, W, H);

  ec.save();
  ec.translate(-minX + PAD, -minY + PAD);
  for (const obj of state.objects) drawObject(ec, obj);
  ec.restore();

  const a = document.createElement('a');
  a.href = exp.toDataURL('image/png');
  a.download = 'snipboard-' + Date.now() + '.png';
  a.click();
}

// ── Session UI ────────────────────────────────────────────────────────────────

function initSession() {
  const hasSession = loadSession();
  if (hasSession) {
    sessionModal.classList.remove('hidden');
  } else {
    startFresh();
  }
}

document.getElementById('session-continue').addEventListener('click', () => {
  sessionModal.classList.add('hidden');
  render();
});

document.getElementById('session-clear').addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  startFresh();
  sessionModal.classList.add('hidden');
});

function startFresh() {
  state.objects = [];
  state.selected = null;
  state.undoStack = [];
  render();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Boot ──────────────────────────────────────────────────────────────────────

initSession();
setTool('select');
