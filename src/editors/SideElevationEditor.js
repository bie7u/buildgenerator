import * as THREE from 'three';
import { WallBevel } from '../models/WallBevel.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Radius within which a click is treated as "on" a handle */
const HANDLE_HIT_RADIUS = 12; // pixels
/** Multiplier for the drag handle hit area (larger = easier to grab) */
const HANDLE_HIT_MULTIPLIER = 1.5;
/** Minimum allowed bevel height in metres */
const MIN_BEVEL_HEIGHT = 0.1;
/** Minimum allowed width of the bevel region in metres */
const MIN_BEVEL_WIDTH = 0.1;
/** Distance in metres within which an offset handle snaps to the wall end */
const SNAP_TO_END_THRESHOLD = 0.05;

/**
 * Side Elevation Editor
 *
 * 2D canvas view showing one external wall segment from the side.
 * Lets the user define a partial bevel (sloped top cut) by dragging handles.
 *
 * Bevel region: offsetStart … offsetEnd along the wall
 *   - Two offset handles  (orange, on the floor line)   drag horizontally
 *   - Two height handles  (cyan,   on the bevel top)    drag vertically
 *
 * Header contains floor <select> + wall prev/next, so users can switch walls
 * without leaving the elevation view.
 */
export class SideElevationEditor {
  constructor(sceneManager, app) {
    this.sm  = sceneManager;
    this.app = app;

    // Currently viewed wall segment
    this.floorIndex  = 0;
    this.wallIndex   = 0;

    // Canvas / DOM refs
    this._canvas         = null;
    this._ctx            = null;
    this._container      = null;
    this._labelContainer = null;
    this._floorSelect    = null;
    this._wallLabel      = null;
    this._visible        = false;

    // Active drag handle: null | 'heightStart' | 'heightEnd' | 'offsetStart' | 'offsetEnd'
    this._dragging = null;

    // View transform (pixels per metre, and origin offsets in pixels)
    this._scale   = 60;
    this._offsetX = 70;  // left margin px
    this._offsetY = 40;  // bottom margin px (from canvas bottom)

    this._buildDOM();
  }

  // ── DOM construction ───────────────────────────────────────────────────────

  _buildDOM() {
    const container = document.createElement('div');
    container.id = 'elevation-container';
    container.style.cssText = [
      'position:absolute', 'inset:0', 'display:none',
      'background:#111', 'z-index:10', 'flex-direction:column',
    ].join(';');

    // ── Header bar ───────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px', 'flex-wrap:wrap',
      'padding:6px 12px', 'background:#1e1e1e',
      'border-bottom:1px solid #333', 'flex-shrink:0',
    ].join(';');

    // Title
    const title = document.createElement('span');
    title.id = 'elevation-title';
    title.style.cssText = 'color:#ccc;font-size:12px;font-weight:600;min-width:120px';
    title.textContent = 'Side Elevation';

    // Floor label + select
    const floorLbl = this._makeLabel('Floor:');
    const floorSel = document.createElement('select');
    floorSel.style.cssText = [
      'background:#2a2a2a', 'color:#ccc', 'border:1px solid #444',
      'border-radius:4px', 'padding:3px 6px', 'font-size:11px', 'cursor:pointer',
    ].join(';');
    floorSel.addEventListener('change', () => {
      this.floorIndex = parseInt(floorSel.value, 10);
      const maxWall = this._getWallCount() - 1;
      if (this.wallIndex > maxWall) this.wallIndex = Math.max(0, maxWall);
      this._updateWallLabel();
      this._fitView();
      this.redraw();
      this._updateTitle();
    });
    this._floorSelect = floorSel;

    // Wall label + prev / counter / next
    const wallLbl  = this._makeLabel('Wall:');
    const wallPrev = this._makeBtn('◀', () => this._stepWall(-1));
    const wallCnt  = document.createElement('span');
    wallCnt.style.cssText = 'color:#ccc;font-size:11px;font-weight:600;min-width:44px;text-align:center';
    this._wallLabel = wallCnt;
    const wallNext = this._makeBtn('▶', () => this._stepWall(1));

    // Hint
    const hint = document.createElement('span');
    hint.style.cssText = 'color:#555;font-size:10px;flex:1';
    hint.textContent = 'Drag cyan handles ↕ (height) or orange handles ↔ (bevel start/end). Right-click → reset.';

    // Close button – calls app.setMode so app.mode is kept in sync
    const btnClose = this._makeBtn('✕ Close', () => this.app.setMode('2d'));

    header.append(title, floorLbl, floorSel, wallLbl, wallPrev, wallCnt, wallNext, hint, btnClose);

    // ── Canvas area ──────────────────────────────────────────────────────────
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative;flex:1;overflow:hidden';

    const canvas = document.createElement('canvas');
    canvas.id = 'elevation-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    this._canvas = canvas;

    const labels = document.createElement('div');
    labels.id = 'elevation-labels';
    labels.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
    this._labelContainer = labels;

    canvasWrap.append(canvas, labels);
    container.append(header, canvasWrap);

    // Insert after canvas-container in the DOM
    const cc = document.getElementById('canvas-container');
    if (cc?.parentElement) {
      cc.parentElement.insertBefore(container, cc.nextSibling);
    } else {
      document.getElementById('main')?.appendChild(container);
    }
    this._container = container;

    // Canvas event listeners
    canvas.addEventListener('mousedown',    e => this._onMouseDown(e));
    canvas.addEventListener('mousemove',    e => this._onMouseMove(e));
    canvas.addEventListener('mouseup',       () => this._onMouseUp());
    canvas.addEventListener('contextmenu',  e => { e.preventDefault(); this._resetBevel(); });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this._onWheel(e); }, { passive: false });
    window.addEventListener('resize', () => { if (this._visible) this.redraw(); });
  }

  _makeLabel(text) {
    const s = document.createElement('span');
    s.style.cssText = 'color:#888;font-size:11px';
    s.textContent = text;
    return s;
  }

  _makeBtn(text, onclick) {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = [
      'background:#2a2a2a', 'color:#ccc', 'border:1px solid #444',
      'border-radius:4px', 'padding:3px 9px', 'cursor:pointer', 'font-size:11px',
    ].join(';');
    b.addEventListener('click', onclick);
    return b;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  show(floorIndex, wallIndex) {
    this.floorIndex = floorIndex;
    this.wallIndex  = wallIndex;

    this._populateFloorSelect();
    this._updateWallLabel();

    this._container.style.display = 'flex';
    const cc = document.getElementById('canvas-container');
    if (cc) cc.style.display = 'none';

    this._visible = true;
    this._fitView();
    this.redraw();
    this._updateTitle();
  }

  hide() {
    this._container.style.display = 'none';
    const cc = document.getElementById('canvas-container');
    if (cc) cc.style.display = '';
    this._visible  = false;
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

    const d = this._getWallData();
    if (d.wallLen < 0.01) {
      ctx.fillStyle = '#555';
      ctx.font = '14px sans-serif';
      ctx.fillText('No wall selected or contour not drawn.', 40, canvas.height / 2);
      return;
    }

    this._drawGrid(ctx, canvas.width, canvas.height, d);
    this._drawWall(ctx, canvas.width, canvas.height, d);
    this._updateLabels(d);
  }

  // ── Floor / wall selectors ─────────────────────────────────────────────────

  _populateFloorSelect() {
    const sel = this._floorSelect;
    if (!sel) return;
    sel.innerHTML = '';
    const floors = this.app.building?.floors ?? [];
    floors.forEach((fl, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = 'Floor ' + (i + 1) + ' (' + fl.height.toFixed(1) + 'm)';
      if (i === this.floorIndex) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  _getWallCount() {
    const b = this.app.building;
    if (!b) return 0;
    return b.getFloorContour(this.floorIndex).length;
  }

  _stepWall(delta) {
    const count = this._getWallCount();
    if (count === 0) return;
    this.wallIndex = (this.wallIndex + delta + count) % count;
    this._updateWallLabel();
    this._fitView();
    this.redraw();
    this._updateTitle();
  }

  _updateWallLabel() {
    if (!this._wallLabel) return;
    const count = this._getWallCount();
    this._wallLabel.textContent = count ? (this.wallIndex + 1) + ' / ' + count : '—';
  }

  _updateTitle() {
    const el = document.getElementById('elevation-title');
    if (!el) return;
    el.textContent = 'Side Elevation — Floor ' + (this.floorIndex + 1) + ', Wall ' + (this.wallIndex + 1);
  }

  // ── Data access ────────────────────────────────────────────────────────────

  _getFloor() {
    return this.app.building?.floors[this.floorIndex] ?? null;
  }

  /**
   * Returns all data needed for rendering and interaction.
   * All values are resolved (offsetEnd is never null here).
   */
  _getWallData() {
    const floor = this._getFloor();
    const b     = this.app.building;
    const empty = { wallLen: 0, floorH: 0, hStart: 0, hEnd: 0, offStart: 0, offEnd: 0, bevel: null };
    if (!floor || !b) return empty;

    const contour = b.getFloorContour(this.floorIndex);
    const n = contour.length;
    if (n < 2 || this.wallIndex < 0 || this.wallIndex >= n) return empty;

    const p1 = contour[this.wallIndex];
    const p2 = contour[(this.wallIndex + 1) % n];
    const wallLen = p1.distanceTo(p2);
    const floorH  = floor.height;

    const bevel    = floor.wallBevels.find(bv => bv.wallIndex === this.wallIndex) ?? null;
    const hStart   = bevel ? bevel.heightStart  : floorH;
    const hEnd     = bevel ? bevel.heightEnd    : floorH;
    const offStart = bevel ? bevel.offsetStart  : 0;
    const offEnd   = bevel
      ? (bevel.offsetEnd !== null ? bevel.offsetEnd : wallLen)
      : wallLen;

    return { wallLen, floorH, hStart, hEnd, offStart, offEnd, bevel };
  }

  _getOrCreateBevel() {
    const floor = this._getFloor();
    if (!floor) return null;
    let bevel = floor.wallBevels.find(bv => bv.wallIndex === this.wallIndex);
    if (!bevel) {
      const d = this._getWallData();
      bevel = new WallBevel(this.wallIndex, d.floorH, d.floorH, 0, null);
      floor.wallBevels.push(bevel);
    }
    return bevel;
  }

  _resetBevel() {
    const floor = this._getFloor();
    if (!floor) return;
    floor.wallBevels = floor.wallBevels.filter(bv => bv.wallIndex !== this.wallIndex);
    this._fitView();
    this.redraw();
  }

  // ── View / coordinate transforms ───────────────────────────────────────────

  _fitView() {
    const canvas = this._canvas;
    const w = canvas.offsetWidth  || 800;
    const h = canvas.offsetHeight || 500;
    const { wallLen, floorH } = this._getWallData();
    if (wallLen < 0.01) return;

    const marginFrac = 0.14;
    const scaleX = (w * (1 - 2 * marginFrac)) / wallLen;
    const scaleY = (h * (1 - 2 * marginFrac)) / Math.max(floorH, 0.1);
    this._scale   = Math.min(scaleX, scaleY, 200);
    this._offsetX = w * marginFrac;
    this._offsetY = h * (1 - marginFrac);
  }

  _elev2px(ex, ey) {
    return {
      x: this._offsetX + ex * this._scale,
      y: this._offsetY - ey * this._scale,
    };
  }

  _px2elev(px, py) {
    return {
      x: (px - this._offsetX) / this._scale,
      y: (this._offsetY - py) / this._scale,
    };
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  _drawGrid(ctx, cw, ch, { wallLen, floorH }) {
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth   = 1;

    // Horizontal grid lines
    const hStep = this._niceStep(floorH * 1.3, 8);
    for (let h = 0; h <= floorH * 1.5; h += hStep) {
      const { y } = this._elev2px(0, h);
      if (y < 0) break;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
      ctx.fillStyle = '#444'; ctx.font = '10px sans-serif';
      ctx.fillText(h.toFixed(1) + 'm', 4, y - 2);
    }

    // Vertical grid lines
    const lStep = this._niceStep(wallLen, 10);
    for (let x = 0; x <= wallLen + 0.001; x += lStep) {
      if (x > wallLen + 0.001) break;
      const { x: px } = this._elev2px(x, 0);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, ch); ctx.stroke();
      ctx.fillStyle = '#444'; ctx.font = '10px sans-serif';
      const { y: py } = this._elev2px(x, 0);
      ctx.fillText(x.toFixed(1) + 'm', px + 2, Math.min(py + 12, ch - 2));
    }

    // Ground line
    const { y: gy } = this._elev2px(0, 0);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
  }

  _drawWall(ctx, cw, ch, d) {
    const { wallLen, floorH, hStart, hEnd, offStart, offEnd } = d;

    // ── Full-height background ───────────────────────────────────────────────
    const bl = this._elev2px(0,       0);
    const br = this._elev2px(wallLen, 0);
    const tr = this._elev2px(wallLen, floorH);
    const tl = this._elev2px(0,       floorH);

    ctx.beginPath();
    ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y);
    ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(60,80,100,0.18)'; ctx.fill();
    ctx.strokeStyle = '#334455'; ctx.lineWidth = 1; ctx.stroke();

    // Floor-height dashed reference
    const { y: refY } = this._elev2px(0, floorH);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#445566'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, refY); ctx.lineTo(cw, refY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#445566'; ctx.font = '10px sans-serif';
    ctx.fillText('floor height: ' + floorH.toFixed(1) + 'm', 4, refY - 3);

    // ── Bevel region ─────────────────────────────────────────────────────────
    const bOs = this._elev2px(offStart, 0);
    const bOe = this._elev2px(offEnd,   0);
    const bHs = this._elev2px(offStart, hStart);
    const bHe = this._elev2px(offEnd,   hEnd);

    ctx.beginPath();
    ctx.moveTo(bOs.x, bOs.y); ctx.lineTo(bOe.x, bOe.y);
    ctx.lineTo(bHe.x, bHe.y); ctx.lineTo(bHs.x, bHs.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(80,140,200,0.30)'; ctx.fill();
    ctx.strokeStyle = '#5599cc'; ctx.lineWidth = 2; ctx.stroke();

    // Boundary dashed vertical lines
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#88bbdd'; ctx.lineWidth = 1;
    if (offStart > 0.001) {
      const topS = this._elev2px(offStart, floorH);
      const botS = this._elev2px(offStart, 0);
      ctx.beginPath(); ctx.moveTo(topS.x, topS.y); ctx.lineTo(botS.x, botS.y); ctx.stroke();
    }
    if (offEnd < wallLen - 0.001) {
      const topE = this._elev2px(offEnd, floorH);
      const botE = this._elev2px(offEnd, 0);
      ctx.beginPath(); ctx.moveTo(topE.x, topE.y); ctx.lineTo(botE.x, botE.y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Slope angle label
    const angleDeg = Math.atan2(hEnd - hStart, offEnd - offStart) * 180 / Math.PI;
    const midPx    = this._elev2px((offStart + offEnd) / 2, (hStart + hEnd) / 2);
    ctx.fillStyle = '#88aacc'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText(angleDeg.toFixed(1) + '\u00b0', midPx.x + 4, midPx.y - 6);

    // ── Drag handles ─────────────────────────────────────────────────────────
    this._drawHandle(ctx, bHs, this._dragging === 'heightStart', 'height');
    this._drawHandle(ctx, bHe, this._dragging === 'heightEnd',   'height');
    this._drawHandle(ctx, bOs, this._dragging === 'offsetStart', 'offset');
    this._drawHandle(ctx, bOe, this._dragging === 'offsetEnd',   'offset');
  }

  _drawHandle(ctx, pos, active, kind) {
    const r = 8;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    if (kind === 'offset') {
      ctx.fillStyle   = active ? '#ffe066' : '#ffaa00';
      ctx.strokeStyle = active ? '#ffffff'  : '#cc7700';
    } else {
      ctx.fillStyle   = active ? '#ffffff' : '#00ddff';
      ctx.strokeStyle = active ? '#aaddff' : '#0088aa';
    }
    ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
  }

  _updateLabels(d) {
    const labels = this._labelContainer;
    if (!labels) return;
    labels.innerHTML = '';

    const addLabel = (ex, ey, text, color, alignRight) => {
      const { x, y } = this._elev2px(ex, ey);
      const div = document.createElement('div');
      const leftVal = alignRight ? (x - 10) : (x + 10);
      div.style.cssText = [
        'position:absolute',
        'left:' + leftVal.toFixed(0) + 'px',
        'top:'  + (y - 16).toFixed(0) + 'px',
        'background:rgba(0,0,0,0.65)',
        'color:' + color,
        'font-size:11px',
        'padding:2px 5px',
        'border-radius:3px',
        'border:1px solid ' + color,
        'white-space:nowrap',
        alignRight ? 'transform:translateX(-100%)' : '',
      ].join(';');
      div.textContent = text;
      labels.appendChild(div);
    };

    const { wallLen, hStart, hEnd, offStart, offEnd } = d;
    addLabel(offStart, hStart, hStart.toFixed(2) + ' m', '#00ddff', false);
    addLabel(offEnd,   hEnd,   hEnd.toFixed(2)   + ' m', '#00ddff', true);
    if (offStart > 0.01)
      addLabel(offStart, 0, offStart.toFixed(2) + ' m \u2192', '#ffaa00', false);
    if (offEnd < wallLen - 0.01)
      addLabel(offEnd, 0, '\u2190 ' + offEnd.toFixed(2) + ' m', '#ffaa00', true);
    addLabel(wallLen / 2, 0, 'L = ' + wallLen.toFixed(2) + ' m', '#888888', false);
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const d = this._getWallData();
    if (d.wallLen < 0.01) return;

    const { x: px, y: py } = this._canvasMousePos(e);
    const r = HANDLE_HIT_RADIUS * HANDLE_HIT_MULTIPLIER;

    const handles = [
      { name: 'heightStart', pos: this._elev2px(d.offStart, d.hStart) },
      { name: 'heightEnd',   pos: this._elev2px(d.offEnd,   d.hEnd)   },
      { name: 'offsetStart', pos: this._elev2px(d.offStart, 0)        },
      { name: 'offsetEnd',   pos: this._elev2px(d.offEnd,   0)        },
    ];

    for (const h of handles) {
      if (Math.hypot(px - h.pos.x, py - h.pos.y) < r) {
        this._dragging = h.name;
        return;
      }
    }
  }

  _onMouseMove(e) {
    if (!this._dragging) return;
    const d = this._getWallData();
    if (d.wallLen < 0.01) return;

    const { x: px, y: py } = this._canvasMousePos(e);
    const ev = this._px2elev(px, py);

    const bevel = this._getOrCreateBevel();
    if (!bevel) return;

    switch (this._dragging) {
      case 'heightStart':
        bevel.heightStart = Math.max(MIN_BEVEL_HEIGHT, ev.y);
        break;
      case 'heightEnd':
        bevel.heightEnd = Math.max(MIN_BEVEL_HEIGHT, ev.y);
        break;
      case 'offsetStart': {
        const resolvedEnd = d.offEnd;
        bevel.offsetStart = Math.max(0, Math.min(ev.x, resolvedEnd - MIN_BEVEL_WIDTH));
        break;
      }
      case 'offsetEnd': {
        const newOff = Math.max(d.offStart + MIN_BEVEL_WIDTH, Math.min(ev.x, d.wallLen));
        // Snap back to null (full-length) when dragged to the wall end
        bevel.offsetEnd = Math.abs(newOff - d.wallLen) < SNAP_TO_END_THRESHOLD ? null : newOff;
        break;
      }
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
    const rect   = this._canvas.getBoundingClientRect();
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
