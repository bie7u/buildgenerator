import * as THREE from 'three';
import { WallBevel } from '../models/WallBevel.js';

// ─── Drawing helpers ──────────────────────────────────────────────────────────

/** Radius within which a click is treated as "on" a handle */
const HANDLE_HIT_RADIUS = 12; // pixels
/** Multiplier for the drag handle hit area (larger = easier to grab) */
const HANDLE_HIT_MULTIPLIER = 1.5;
/** Minimum allowed bevel height in metres (shared with BuildingGenerator) */
const MIN_BEVEL_HEIGHT = 0.1;

/**
 * Side Elevation Editor
 *
 * Renders a 2D side-elevation view of a selected external wall segment.
 * Allows dragging the two top corners to define a bevel (sloped top cut).
 *
 * The editor draws to a <canvas> and updates an HTML overlay for labels.
 *
 * Coordinate system:
 *   Elevation X  → along the wall (0 = start vertex, wallLen = end vertex)
 *   Elevation Y  → wall height above floor level
 *
 * Usage:
 *   new SideElevationEditor(sceneManager, app)
 *   editor.show(floorIndex, wallSegmentIndex)
 *   editor.hide()
 */
export class SideElevationEditor {
  constructor(sceneManager, app) {
    this.sm  = sceneManager;
    this.app = app;

    // Currently viewed wall segment
    this.floorIndex   = -1;
    this.wallIndex    = -1;

    // Local canvas for elevation drawing (created dynamically)
    this._canvas      = null;
    this._ctx         = null;
    this._container   = null;
    this._labelContainer = null;
    this._visible     = false;

    // Drag state
    this._dragging    = null; // null | 'start' | 'end'
    this._lastMouseY  = 0;

    // Camera / view transform
    this._scale       = 60;  // pixels per metre
    this._offsetX     = 60;  // left margin in pixels
    this._offsetY     = 40;  // bottom margin in pixels (from canvas bottom)

    this._buildDOM();
  }

  // ── DOM construction ───────────────────────────────────────────────────────

  _buildDOM() {
    // Overlay container (covers the main canvas area)
    const container = document.createElement('div');
    container.id = 'elevation-container';
    container.style.cssText = [
      'position:absolute', 'inset:0', 'display:none',
      'background:#111', 'z-index:10',
      'flex-direction:column',
    ].join(';');

    // Header bar
    const header = document.createElement('div');
    header.id = 'elevation-header';
    header.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px',
      'padding:6px 12px', 'background:#1e1e1e',
      'border-bottom:1px solid #333', 'flex-shrink:0',
    ].join(';');

    const title = document.createElement('span');
    title.id = 'elevation-title';
    title.style.cssText = 'color:#ccc;font-size:12px;font-weight:600;flex:1';
    title.textContent = 'Side Elevation — select a wall segment';

    const hint = document.createElement('span');
    hint.style.cssText = 'color:#666;font-size:11px';
    hint.textContent = 'Drag top handles to set bevel. Right-click to reset.';

    const btnClose = document.createElement('button');
    btnClose.textContent = '✕ Close';
    btnClose.style.cssText = [
      'background:#2a2a2a', 'color:#ccc', 'border:1px solid #444',
      'border-radius:4px', 'padding:4px 10px', 'cursor:pointer',
      'font-size:12px',
    ].join(';');
    btnClose.addEventListener('click', () => this.hide());

    header.appendChild(title);
    header.appendChild(hint);
    header.appendChild(btnClose);

    // Canvas wrapper
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative;flex:1;overflow:hidden';

    const canvas = document.createElement('canvas');
    canvas.id = 'elevation-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    this._canvas = canvas;
    this._ctx    = null; // get on first draw

    const labels = document.createElement('div');
    labels.id = 'elevation-labels';
    labels.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
    this._labelContainer = labels;

    canvasWrap.appendChild(canvas);
    canvasWrap.appendChild(labels);

    container.appendChild(header);
    container.appendChild(canvasWrap);

    // Inject after the main canvas-container
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer && canvasContainer.parentElement) {
      canvasContainer.parentElement.insertBefore(container, canvasContainer.nextSibling);
    } else {
      document.getElementById('main')?.appendChild(container);
    }
    this._container = container;

    // Events
    canvas.addEventListener('mousedown', e => this._onMouseDown(e));
    canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    canvas.addEventListener('mouseup',   () => this._onMouseUp());
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this._resetBevel(); });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this._onWheel(e); }, { passive: false });

    window.addEventListener('resize', () => { if (this._visible) this.redraw(); });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  show(floorIndex, wallIndex) {
    this.floorIndex = floorIndex;
    this.wallIndex  = wallIndex;
    this._container.style.display = 'flex';

    // Reposition the elevation canvas next to the main canvas-container
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) canvasContainer.style.display = 'none';

    this._visible = true;
    this._fitView();
    this.redraw();
    this._updateTitle();
  }

  hide() {
    this._container.style.display = 'none';
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) canvasContainer.style.display = '';
    this._visible = false;
    this._dragging = null;
  }

  get visible() { return this._visible; }

  redraw() {
    if (!this._visible) return;

    const canvas = this._canvas;
    canvas.width  = canvas.offsetWidth  || 800;
    canvas.height = canvas.offsetHeight || 500;

    const ctx = canvas.getContext('2d');
    this._ctx = ctx;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { wallLen, hStart, hEnd } = this._getWallData();
    if (wallLen < 0.01) {
      ctx.fillStyle = '#555';
      ctx.font = '14px sans-serif';
      ctx.fillText('No wall selected or wall too short.', 40, canvas.height / 2);
      return;
    }

    this._drawGrid(ctx, canvas.width, canvas.height, wallLen);
    this._drawWall(ctx, canvas.width, canvas.height, wallLen, hStart, hEnd);
    this._updateLabels(canvas, wallLen, hStart, hEnd);
  }

  // ── Data access ────────────────────────────────────────────────────────────

  _getFloor() {
    const b = this.app.building;
    return b?.floors[this.floorIndex] ?? null;
  }

  _getWallData() {
    const floor = this._getFloor();
    const b     = this.app.building;
    if (!floor || !b) return { wallLen: 0, hStart: 0, hEnd: 0 };

    const contour = b.getFloorContour(this.floorIndex);
    const n = contour.length;
    if (n < 2 || this.wallIndex < 0 || this.wallIndex >= n) return { wallLen: 0, hStart: 0, hEnd: 0 };

    const p1 = contour[this.wallIndex];
    const p2 = contour[(this.wallIndex + 1) % n];
    const wallLen = p1.distanceTo(p2);

    const bevel = floor.wallBevels.find(b => b.wallIndex === this.wallIndex);
    const hStart = bevel ? bevel.heightStart : floor.height;
    const hEnd   = bevel ? bevel.heightEnd   : floor.height;

    return { wallLen, hStart, hEnd };
  }

  _getOrCreateBevel(hStart, hEnd) {
    const floor = this._getFloor();
    if (!floor) return null;
    let bevel = floor.wallBevels.find(b => b.wallIndex === this.wallIndex);
    if (!bevel) {
      bevel = new WallBevel(this.wallIndex, hStart, hEnd);
      floor.wallBevels.push(bevel);
    }
    return bevel;
  }

  _resetBevel() {
    const floor = this._getFloor();
    if (!floor) return;
    floor.wallBevels = floor.wallBevels.filter(b => b.wallIndex !== this.wallIndex);
    this.redraw();
  }

  // ── View / coordinate transforms ───────────────────────────────────────────

  _fitView() {
    const canvas = this._canvas;
    const w = canvas.offsetWidth  || 800;
    const h = canvas.offsetHeight || 500;
    const { wallLen, hStart, hEnd } = this._getWallData();
    if (wallLen < 0.01) return;

    const maxH = Math.max(hStart, hEnd, 0.1);
    const marginFrac = 0.15;
    const scaleX = (w * (1 - 2 * marginFrac)) / wallLen;
    const scaleY = (h * (1 - 2 * marginFrac)) / maxH;
    this._scale   = Math.min(scaleX, scaleY, 200);
    this._offsetX = w * marginFrac;
    this._offsetY = h * (1 - marginFrac);
  }

  /** Convert elevation coords (ex, ey) → canvas pixel coords (px, py). */
  _elev2px(ex, ey) {
    return {
      x: this._offsetX + ex * this._scale,
      y: this._offsetY - ey * this._scale,
    };
  }

  /** Convert canvas pixel (px, py) → elevation coords (ex, ey). */
  _px2elev(px, py) {
    return {
      x: (px - this._offsetX) / this._scale,
      y: (this._offsetY - py) / this._scale,
    };
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  _drawGrid(ctx, cw, ch, wallLen) {
    const floorH = this._getFloor()?.height ?? 2.7;
    const maxH   = Math.max(floorH, 0.1);

    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth   = 1;

    // Horizontal grid lines (height intervals)
    const hStep = this._niceStep(maxH, 8);
    for (let h = 0; h <= maxH * 1.5; h += hStep) {
      const { y } = this._elev2px(0, h);
      if (y < 0) break;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
      ctx.stroke();
      // Label
      ctx.fillStyle = '#444';
      ctx.font = '10px sans-serif';
      ctx.fillText(h.toFixed(1) + 'm', 4, y - 2);
    }

    // Vertical grid lines (wall length intervals)
    const lStep = this._niceStep(wallLen, 10);
    for (let x = 0; x <= wallLen + lStep; x += lStep) {
      if (x > wallLen + 0.01) break;
      const { x: px } = this._elev2px(x, 0);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, ch);
      ctx.stroke();
      ctx.fillStyle = '#444';
      ctx.font = '10px sans-serif';
      const { y: py } = this._elev2px(x, 0);
      ctx.fillText(x.toFixed(1) + 'm', px + 2, Math.min(py + 12, ch - 2));
    }

    // Ground line
    const { y: gy } = this._elev2px(0, 0);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(cw, gy);
    ctx.stroke();
  }

  _drawWall(ctx, cw, ch, wallLen, hStart, hEnd) {
    const tl = this._elev2px(0, hStart);        // top-left
    const tr = this._elev2px(wallLen, hEnd);    // top-right
    const br = this._elev2px(wallLen, 0);       // bottom-right
    const bl = this._elev2px(0, 0);             // bottom-left

    // Wall fill
    ctx.beginPath();
    ctx.moveTo(bl.x, bl.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(tl.x, tl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(80,120,160,0.25)';
    ctx.fill();

    // Wall outline
    ctx.strokeStyle = '#5599cc';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Floor height reference (dashed)
    const floor = this._getFloor();
    if (floor) {
      const fh = floor.height;
      const { y: refY } = this._elev2px(0, fh);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#445566';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, refY);
      ctx.lineTo(cw, refY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#445566';
      ctx.font = '10px sans-serif';
      ctx.fillText('floor height: ' + fh.toFixed(1) + 'm', 4, refY - 2);
    }

    // Drag handles at top-left and top-right
    const isDragStart = this._dragging === 'start';
    const isDragEnd   = this._dragging === 'end';

    this._drawHandle(ctx, tl, isDragStart, 'start');
    this._drawHandle(ctx, tr, isDragEnd,   'end');

    // Slope angle annotation on the top edge
    const angleDeg = Math.atan2(hEnd - hStart, wallLen) * 180 / Math.PI;
    const midX = (tl.x + tr.x) / 2;
    const midY = (tl.y + tr.y) / 2;
    ctx.fillStyle = '#88aacc';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(angleDeg.toFixed(1) + '°', midX + 4, midY - 6);
  }

  _drawHandle(ctx, pos, active) {
    const r = 8;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#ffffff' : '#00ddff';
    ctx.fill();
    ctx.strokeStyle = active ? '#aaddff' : '#0088aa';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _updateLabels(canvas, wallLen, hStart, hEnd) {
    const labels = this._labelContainer;
    if (!labels) return;
    labels.innerHTML = '';

    const addLabel = (ex, ey, text, color = '#00ddff') => {
      const { x, y } = this._elev2px(ex, ey);
      const div = document.createElement('div');
      div.style.cssText = [
        'position:absolute',
        `left:${(x + 10).toFixed(0)}px`,
        `top:${(y - 16).toFixed(0)}px`,
        'background:rgba(0,0,0,0.6)',
        'color:' + color,
        'font-size:11px',
        'padding:2px 5px',
        'border-radius:3px',
        'border:1px solid ' + color,
        'white-space:nowrap',
      ].join(';');
      div.textContent = text;
      labels.appendChild(div);
    };

    addLabel(0,       hStart, hStart.toFixed(2) + ' m');
    addLabel(wallLen, hEnd,   hEnd.toFixed(2)   + ' m');
    addLabel(wallLen / 2, 0,  'L = ' + wallLen.toFixed(2) + ' m', '#aaaaaa');
  }

  _updateTitle() {
    const title = document.getElementById('elevation-title');
    if (!title) return;
    const floor = this._getFloor();
    if (!floor) { title.textContent = 'Side Elevation — no floor'; return; }
    title.textContent =
      `Side Elevation — Floor ${this.floorIndex + 1}, Wall segment ${this.wallIndex + 1}`;
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  _onMouseDown(e) {
    const { wallLen, hStart, hEnd } = this._getWallData();
    if (wallLen < 0.01) return;

    const { x: px, y: py } = this._canvasMousePos(e);
    const tlPx = this._elev2px(0,       hStart);
    const trPx = this._elev2px(wallLen, hEnd);

    const dStart = Math.hypot(px - tlPx.x, py - tlPx.y);
    const dEnd   = Math.hypot(px - trPx.x, py - trPx.y);

    if (dStart < HANDLE_HIT_RADIUS * HANDLE_HIT_MULTIPLIER) {
      this._dragging = 'start';
    } else if (dEnd < HANDLE_HIT_RADIUS * HANDLE_HIT_MULTIPLIER) {
      this._dragging = 'end';
    }
    this._lastMouseY = py;
  }

  _onMouseMove(e) {
    if (!this._dragging) return;
    const { wallLen, hStart, hEnd } = this._getWallData();
    if (wallLen < 0.01) return;

    const { y: py } = this._canvasMousePos(e);
    const { y: ey } = this._px2elev(0, py);
    const newH = Math.max(MIN_BEVEL_HEIGHT, ey);

    let newStart = hStart, newEnd = hEnd;
    if (this._dragging === 'start') newStart = newH;
    else                            newEnd   = newH;

    const bevel = this._getOrCreateBevel(newStart, newEnd);
    if (bevel) {
      bevel.heightStart = newStart;
      bevel.heightEnd   = newEnd;
    }
    this.redraw();
  }

  _onMouseUp() {
    this._dragging = null;
  }

  _onWheel(e) {
    const delta = e.deltaY > 0 ? 0.85 : 1 / 0.85;
    this._scale = Math.max(10, Math.min(300, this._scale * delta));
    this.redraw();
  }

  _canvasMousePos(e) {
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width  / rect.width;
    const scaleY = this._canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  _niceStep(range, maxDivisions) {
    const raw = range / maxDivisions;
    if (raw <= 0) return 0.5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const residual  = raw / magnitude;
    let nice;
    if (residual < 1.5)      nice = 1;
    else if (residual < 3.5) nice = 2;
    else if (residual < 7.5) nice = 5;
    else                     nice = 10;
    return nice * magnitude;
  }
}
