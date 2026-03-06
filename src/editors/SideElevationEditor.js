import * as THREE from 'three';
import { WallBevel } from '../models/WallBevel.js';
import { CeilingBevel } from '../models/CeilingBevel.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Radius within which a click is treated as "on" a handle */
const HANDLE_HIT_RADIUS = 12; // pixels
/** Multiplier for the drag handle hit area */
const HANDLE_HIT_MULTIPLIER = 1.5;
/** Minimum allowed bevel height in metres */
const MIN_BEVEL_HEIGHT = 0.1;
/** Minimum allowed width of a bevel region in metres */
const MIN_BEVEL_WIDTH = 0.1;
/** Distance in metres within which an offset handle snaps to the wall end */
const SNAP_TO_END_THRESHOLD = 0.05;

/** Arrow buttons */
const ARROW_LEFT  = '\u25c4';
const ARROW_RIGHT = '\u25ba';

/**
 * Side Elevation Editor
 *
 * 2D canvas view for one external wall segment, showing ALL wall bevels and
 * ceiling bevels simultaneously.
 *
 * Header controls:
 *   Floor select | Wall ◀ N/total ▶ | [↕ Wall] [~ Ceiling] mode | Bevel ◀ N/total ▶ | [+Add] [−Del] | [✕ Close]
 *
 * Wall bevel handles (blue region, below ceiling):
 *   cyan handles  ↕  at bevel top corners     → drag to change wall height
 *   orange handles ↔  on the floor line        → drag to move bevel boundary
 *
 * Ceiling bevel handles (teal region, below flat ceiling):
 *   cyan handles  ↕  at the lower ceiling edge → drag to change ceiling height
 *   orange handles ↔  at the flat ceiling line  → drag to move bevel boundary
 */
export class SideElevationEditor {
  constructor(sceneManager, app) {
    this.sm  = sceneManager;
    this.app = app;

    // Currently viewed wall segment
    this.floorIndex  = 0;
    this.wallIndex   = 0;

    // Active editing mode: 'wall' = wall bevels, 'ceiling' = ceiling bevels
    this._mode = 'wall';

    // Independent active-bevel indices for each mode
    this._activeBevelIdx        = 0;   // wall mode
    this._activeCeilingBevelIdx = 0;   // ceiling mode

    // Canvas / DOM refs
    this._canvas         = null;
    this._ctx            = null;
    this._container      = null;
    this._labelContainer = null;
    this._floorSelect    = null;
    this._wallLabel      = null;
    this._bevelLabel     = null;
    this._modeWallBtn    = null;
    this._modeCeilingBtn = null;
    this._depthLbl       = null;
    this._depthInput     = null;
    this._visible        = false;

    // Active drag handle: null | 'heightStart' | 'heightEnd' | 'offsetStart' | 'offsetEnd'
    this._dragging = null;

    // View transform
    this._scale   = 60;
    this._offsetX = 70;
    this._offsetY = 40;

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

    // ── Header ───────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px', 'flex-wrap:wrap',
      'padding:6px 12px', 'background:#1e1e1e',
      'border-bottom:1px solid #333', 'flex-shrink:0',
    ].join(';');

    // Title
    const title = document.createElement('span');
    title.id = 'elevation-title';
    title.style.cssText = 'color:#ccc;font-size:12px;font-weight:600;min-width:100px';
    title.textContent = 'Side Elevation';

    // Floor select
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
      this._activeBevelIdx        = 0;
      this._activeCeilingBevelIdx = 0;
      this._updateWallLabel();
      this._updateBevelLabel();
      this._fitView();
      this.redraw();
      this._updateTitle();
    });
    this._floorSelect = floorSel;

    // Wall nav
    const wallLbl  = this._makeLabel('Wall:');
    const wallPrev = this._makeBtn(ARROW_LEFT,  () => this._stepWall(-1));
    const wallCnt  = document.createElement('span');
    wallCnt.style.cssText = 'color:#ccc;font-size:11px;font-weight:600;min-width:44px;text-align:center';
    this._wallLabel = wallCnt;
    const wallNext = this._makeBtn(ARROW_RIGHT, () => this._stepWall(1));

    // Separator
    const sep = document.createElement('span');
    sep.style.cssText = 'color:#444;font-size:11px';
    sep.textContent = '|';

    // ── Mode toggle buttons ──────────────────────────────────────────────────
    const modeWall = this._makeBtn('\u2195\u00a0Wall', () => this._setMode('wall'));
    modeWall.title = 'Edit wall bevels (sloped wall tops)';
    this._modeWallBtn = modeWall;

    const modeCeiling = this._makeBtn('\u007e\u00a0Ceiling', () => this._setMode('ceiling'));
    modeCeiling.title = 'Edit ceiling bevels (sloped ceiling panels)';
    this._modeCeilingBtn = modeCeiling;

    // Depth input — visible only in ceiling mode
    const depthLbl = this._makeLabel('Depth (m):');
    depthLbl.style.display = 'none';
    this._depthLbl = depthLbl;

    const depthInput = document.createElement('input');
    depthInput.type = 'number';
    depthInput.min = '0.1';
    depthInput.max = '20';
    depthInput.step = '0.5';
    depthInput.value = '2.0';
    depthInput.title = 'How far the sloped ceiling extends into the room (metres)';
    depthInput.style.cssText = [
      'width:52px', 'background:#2a2a2a', 'color:#ccc',
      'border:1px solid #444', 'border-radius:4px',
      'padding:2px 4px', 'font-size:11px', 'display:none',
    ].join(';');
    depthInput.addEventListener('input', () => {
      const val = parseFloat(depthInput.value);
      if (!isNaN(val) && val > 0) {
        const bevel = this._getActiveBevel();
        if (bevel && this._mode === 'ceiling') bevel.depth = val;
      }
    });
    this._depthInput = depthInput;

    // Separator 2
    const sep2 = document.createElement('span');
    sep2.style.cssText = 'color:#444;font-size:11px';
    sep2.textContent = '|';

    // Bevel nav
    const bevelLbl  = this._makeLabel('Bevel:');
    const bevelPrev = this._makeBtn(ARROW_LEFT,  () => this._stepBevel(-1));
    const bevelCnt  = document.createElement('span');
    bevelCnt.style.cssText = 'color:#ccc;font-size:11px;font-weight:600;min-width:44px;text-align:center';
    this._bevelLabel = bevelCnt;
    const bevelNext = this._makeBtn(ARROW_RIGHT, () => this._stepBevel(1));

    // Add / Delete bevel buttons
    const btnAdd = this._makeBtn('+\u00a0Add', () => this._addNewBevel());
    btnAdd.style.background = '#1a3a1a';
    btnAdd.style.borderColor = '#3a7a3a';
    btnAdd.style.color = '#88ee88';

    const btnDel = this._makeBtn('\u2212\u00a0Del', () => this._deleteActiveBevel());
    btnDel.style.background = '#3a1a1a';
    btnDel.style.borderColor = '#7a3a3a';
    btnDel.style.color = '#ee8888';

    // Hint
    const hint = document.createElement('span');
    hint.style.cssText = 'color:#555;font-size:10px;flex:1';
    hint.textContent = 'Drag cyan \u2195 (height) or orange \u2194 (region). Right-click \u2192 delete.';

    // Close
    const btnClose = this._makeBtn('\u2715\u00a0Close', () => this.app.setMode('2d'));

    header.append(
      title,
      floorLbl, floorSel,
      wallLbl, wallPrev, wallCnt, wallNext,
      sep,
      modeWall, modeCeiling,
      depthLbl, depthInput,
      sep2,
      bevelLbl, bevelPrev, bevelCnt, bevelNext,
      btnAdd, btnDel,
      hint,
      btnClose,
    );

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

    const cc = document.getElementById('canvas-container');
    if (cc?.parentElement) {
      cc.parentElement.insertBefore(container, cc.nextSibling);
    } else {
      document.getElementById('main')?.appendChild(container);
    }
    this._container = container;

    canvas.addEventListener('mousedown',   e => this._onMouseDown(e));
    canvas.addEventListener('mousemove',   e => this._onMouseMove(e));
    canvas.addEventListener('mouseup',      () => this._onMouseUp());
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this._deleteActiveBevel(); });
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
    this.floorIndex             = floorIndex;
    this.wallIndex              = wallIndex;
    this._activeBevelIdx        = 0;
    this._activeCeilingBevelIdx = 0;

    this._populateFloorSelect();
    this._updateWallLabel();
    this._updateBevelLabel();
    this._updateModeButtons();
    this._syncDepthInput();

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

    const base = this._getWallBase();
    if (base.wallLen < 0.01) {
      ctx.fillStyle = '#555';
      ctx.font = '14px sans-serif';
      ctx.fillText('No wall selected or contour not drawn.', 40, canvas.height / 2);
      return;
    }

    this._drawGrid(ctx, canvas.width, canvas.height, base);
    this._drawWall(ctx, canvas.width, canvas.height, base);
    this._updateLabels(base);
  }

  // ── Floor / wall / bevel selectors ─────────────────────────────────────────

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
    this.wallIndex              = (this.wallIndex + delta + count) % count;
    this._activeBevelIdx        = 0;
    this._activeCeilingBevelIdx = 0;
    this._updateWallLabel();
    this._updateBevelLabel();
    this._fitView();
    this.redraw();
    this._updateTitle();
  }

  _updateWallLabel() {
    if (!this._wallLabel) return;
    const count = this._getWallCount();
    this._wallLabel.textContent = count ? (this.wallIndex + 1) + ' / ' + count : '\u2014';
  }

  // ── Mode switching ──────────────────────────────────────────────────────────

  /** Switch between 'wall' and 'ceiling' bevel editing modes. */
  _setMode(mode) {
    if (this._mode === mode) return;
    this._mode = mode;
    this._updateModeButtons();
    this._updateBevelLabel();
    this._syncDepthInput();
    this._updateTitle();
    this.redraw();
  }

  _updateModeButtons() {
    if (!this._modeWallBtn || !this._modeCeilingBtn) return;
    if (this._mode === 'wall') {
      this._modeWallBtn.style.outline    = '2px solid #5588cc';
      this._modeCeilingBtn.style.outline = '';
    } else {
      this._modeWallBtn.style.outline    = '';
      this._modeCeilingBtn.style.outline = '2px solid #22bbaa';
    }
  }

  /** Show/hide depth input and sync its value to the active ceiling bevel. */
  _syncDepthInput() {
    if (!this._depthInput || !this._depthLbl) return;
    const visible = this._mode === 'ceiling';
    this._depthInput.style.display = visible ? '' : 'none';
    this._depthLbl.style.display   = visible ? '' : 'none';
    if (visible) {
      const bevel = this._getActiveBevel();
      this._depthInput.value = bevel ? bevel.depth : 2.0;
    }
  }

  // ── Bevel array helpers (mode-aware) ───────────────────────────────────────

  /**
   * Returns sorted bevels for the current wall in the given mode.
   * Defaults to the current mode.
   */
  _getBevels(mode = this._mode) {
    const floor = this._getFloor();
    if (!floor) return [];
    const arr = mode === 'ceiling' ? (floor.ceilingBevels || []) : floor.wallBevels;
    return arr
      .filter(bv => bv.wallIndex === this.wallIndex)
      .sort((a, b) => a.offsetStart - b.offsetStart);
  }

  /** Sorted wall bevels for the current wall (kept for backward compat). */
  _getBevelsForWall() { return this._getBevels('wall'); }

  _getActiveIdx(mode = this._mode) {
    return mode === 'ceiling' ? this._activeCeilingBevelIdx : this._activeBevelIdx;
  }

  _setActiveIdx(idx, mode = this._mode) {
    if (mode === 'ceiling') this._activeCeilingBevelIdx = idx;
    else this._activeBevelIdx = idx;
  }

  _getActiveBevel() {
    const bevels = this._getBevels();
    const idx    = this._getActiveIdx();
    if (bevels.length === 0 || idx >= bevels.length) return null;
    return bevels[idx];
  }

  _stepBevel(delta) {
    const count = this._getBevels().length;
    if (count === 0) return;
    this._setActiveIdx((this._getActiveIdx() + delta + count) % count);
    this._updateBevelLabel();
    this.redraw();
    this._updateTitle();
  }

  _updateBevelLabel() {
    if (!this._bevelLabel) return;
    const count = this._getBevels().length;
    this._bevelLabel.textContent = count
      ? (this._getActiveIdx() + 1) + ' / ' + count
      : 'none';
    this._syncDepthInput();
  }

  _updateTitle() {
    const el = document.getElementById('elevation-title');
    if (!el) return;
    const nW = this._getBevels('wall').length;
    const nC = this._getBevels('ceiling').length;
    const parts = [];
    if (nW) parts.push(nW + ' wall bevel' + (nW > 1 ? 's' : ''));
    if (nC) parts.push(nC + ' ceiling bevel' + (nC > 1 ? 's' : ''));
    el.textContent = 'Side Elevation \u2014 Floor ' + (this.floorIndex + 1) +
      ', Wall ' + (this.wallIndex + 1) +
      (parts.length ? ' [' + parts.join(', ') + ']' : '');
  }

  // ── Data access ────────────────────────────────────────────────────────────

  _getFloor() {
    return this.app.building?.floors[this.floorIndex] ?? null;
  }

  /** Base wall data (wallLen, floorH) — independent of any bevel. */
  _getWallBase() {
    const floor = this._getFloor();
    const b     = this.app.building;
    const empty = { wallLen: 0, floorH: 0 };
    if (!floor || !b) return empty;
    const contour = b.getFloorContour(this.floorIndex);
    const n = contour.length;
    if (n < 2 || this.wallIndex < 0 || this.wallIndex >= n) return empty;
    const p1 = contour[this.wallIndex];
    const p2 = contour[(this.wallIndex + 1) % n];
    return { wallLen: p1.distanceTo(p2), floorH: floor.height };
  }

  /** Data for the ACTIVE bevel (or defaults if none). */
  _getWallData() {
    const base  = this._getWallBase();
    const bevel = this._getActiveBevel();
    const { wallLen, floorH } = base;

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

    let bevel = this._getActiveBevel();
    if (!bevel) {
      const { wallLen, floorH } = this._getWallBase();
      if (this._mode === 'ceiling') {
        bevel = new CeilingBevel(this.wallIndex, floorH, floorH, 0, null);
        floor.ceilingBevels.push(bevel);
        const sorted = this._getBevels('ceiling');
        this._activeCeilingBevelIdx = sorted.findIndex(bv => bv === bevel);
        if (this._activeCeilingBevelIdx < 0) this._activeCeilingBevelIdx = 0;
      } else {
        bevel = new WallBevel(this.wallIndex, floorH, floorH, 0, null);
        floor.wallBevels.push(bevel);
        const sorted = this._getBevels('wall');
        this._activeBevelIdx = sorted.findIndex(bv => bv === bevel);
        if (this._activeBevelIdx < 0) this._activeBevelIdx = 0;
      }
      this._updateBevelLabel();
      this._updateTitle();
    }
    return bevel;
  }

  // ── Add / Delete bevels ─────────────────────────────────────────────────────

  _addNewBevel() {
    const floor = this._getFloor();
    if (!floor) return;
    const { wallLen, floorH } = this._getWallBase();
    if (wallLen < MIN_BEVEL_WIDTH * 2) return;

    const bevels = this._getBevels();  // mode-aware

    // Find the largest free gap on this wall
    const taken = bevels.map(bv => ({
      s: bv.offsetStart,
      e: bv.offsetEnd !== null ? bv.offsetEnd : wallLen,
    })).sort((a, b) => a.s - b.s);

    const gaps = [];
    let cursor = 0;
    for (const seg of taken) {
      if (seg.s > cursor + MIN_BEVEL_WIDTH) gaps.push({ s: cursor, e: seg.s });
      cursor = Math.max(cursor, seg.e);
    }
    if (cursor < wallLen - MIN_BEVEL_WIDTH) gaps.push({ s: cursor, e: wallLen });
    if (gaps.length === 0) return; // no room

    gaps.sort((a, b) => (b.e - b.s) - (a.e - a.s));
    const { s, e } = gaps[0];
    const gapSize = e - s;

    // Place the bevel in the right-side portion of the gap so there is room
    // on the left for a future second bevel.  If the gap is small, use it all.
    let bevelStart = s;
    const bevelEnd   = e;
    if (gapSize > MIN_BEVEL_WIDTH * 3) {
      bevelStart = s + Math.round(gapSize / 2 * 10) / 10; // round to 0.1 m
    }

    const snapEnd = Math.abs(bevelEnd - wallLen) < SNAP_TO_END_THRESHOLD ? null : bevelEnd;

    let newBevel;
    if (this._mode === 'ceiling') {
      // Ceiling bevel starts at 80 % of floor height (ceiling drops near the wall)
      newBevel = new CeilingBevel(
        this.wallIndex,
        Math.max(MIN_BEVEL_HEIGHT, floorH * 0.8),
        Math.max(MIN_BEVEL_HEIGHT, floorH * 0.8),
        bevelStart,
        snapEnd,
      );
      floor.ceilingBevels.push(newBevel);
      const sorted = this._getBevels('ceiling');
      this._activeCeilingBevelIdx = sorted.findIndex(bv => bv === newBevel);
      if (this._activeCeilingBevelIdx < 0) this._activeCeilingBevelIdx = sorted.length - 1;
    } else {
      newBevel = new WallBevel(
        this.wallIndex,
        Math.max(MIN_BEVEL_HEIGHT, floorH * 0.7),
        Math.max(MIN_BEVEL_HEIGHT, floorH * 0.7),
        bevelStart,
        snapEnd,
      );
      floor.wallBevels.push(newBevel);
      const sorted = this._getBevels('wall');
      this._activeBevelIdx = sorted.findIndex(bv => bv === newBevel);
      if (this._activeBevelIdx < 0) this._activeBevelIdx = sorted.length - 1;
    }

    this._updateBevelLabel();
    this._updateTitle();
    this.redraw();
  }

  _deleteActiveBevel() {
    const floor = this._getFloor();
    if (!floor) return;
    const bevel = this._getActiveBevel();
    if (!bevel) return;

    if (this._mode === 'ceiling') {
      floor.ceilingBevels = floor.ceilingBevels.filter(bv => bv !== bevel);
      const count = this._getBevels('ceiling').length;
      if (this._activeCeilingBevelIdx >= count)
        this._activeCeilingBevelIdx = Math.max(0, count - 1);
    } else {
      floor.wallBevels = floor.wallBevels.filter(bv => bv !== bevel);
      const count = this._getBevels('wall').length;
      if (this._activeBevelIdx >= count)
        this._activeBevelIdx = Math.max(0, count - 1);
    }

    this._updateBevelLabel();
    this._updateTitle();
    this._fitView();
    this.redraw();
  }

  // ── View / coordinate transforms ───────────────────────────────────────────

  _fitView() {
    const canvas = this._canvas;
    const w = canvas.offsetWidth  || 800;
    const h = canvas.offsetHeight || 500;
    const { wallLen, floorH } = this._getWallBase();
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

    const hStep = this._niceStep(floorH * 1.3, 8);
    for (let h = 0; h <= floorH * 1.5; h += hStep) {
      const { y } = this._elev2px(0, h);
      if (y < 0) break;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
      ctx.fillStyle = '#444'; ctx.font = '10px sans-serif';
      ctx.fillText(h.toFixed(1) + 'm', 4, y - 2);
    }

    const lStep = this._niceStep(wallLen, 10);
    for (let x = 0; x <= wallLen + 0.001; x += lStep) {
      if (x > wallLen + 0.001) break;
      const { x: px } = this._elev2px(x, 0);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, ch); ctx.stroke();
      ctx.fillStyle = '#444'; ctx.font = '10px sans-serif';
      const { y: py } = this._elev2px(x, 0);
      ctx.fillText(x.toFixed(1) + 'm', px + 2, Math.min(py + 12, ch - 2));
    }

    const { y: gy } = this._elev2px(0, 0);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
  }

  _drawWall(ctx, cw, ch, { wallLen, floorH }) {
    // ── Full-height background ────────────────────────────────────────────────
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

    // Floor-height reference dashed line
    const { y: refY } = this._elev2px(0, floorH);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#445566'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, refY); ctx.lineTo(cw, refY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#445566'; ctx.font = '10px sans-serif';
    ctx.fillText('floor height: ' + floorH.toFixed(1) + 'm', 4, refY - 3);

    // ── Draw all WALL bevels (always visible, regardless of mode) ─────────────
    const allBevels = this._getBevels('wall');
    allBevels.forEach((bv, idx) => {
      const isActive = this._mode === 'wall' && idx === this._getActiveIdx('wall');
      const offStart = bv.offsetStart;
      const offEnd   = bv.offsetEnd !== null ? bv.offsetEnd : wallLen;
      const hS = bv.heightStart;
      const hE = bv.heightEnd;

      const bOs = this._elev2px(offStart, 0);
      const bOe = this._elev2px(offEnd,   0);
      const bHs = this._elev2px(offStart, hS);
      const bHe = this._elev2px(offEnd,   hE);

      // Bevel fill (trapezoid: floor line → sloped top)
      ctx.beginPath();
      ctx.moveTo(bOs.x, bOs.y); ctx.lineTo(bOe.x, bOe.y);
      ctx.lineTo(bHe.x, bHe.y); ctx.lineTo(bHs.x, bHs.y);
      ctx.closePath();
      ctx.fillStyle = isActive ? 'rgba(80,140,200,0.35)' : 'rgba(80,140,200,0.12)';
      ctx.fill();
      ctx.strokeStyle = isActive ? '#5599cc' : '#3366aa';
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.stroke();

      // Boundary dashed lines
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isActive ? '#88bbdd' : '#446688';
      ctx.lineWidth = 1;
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

      // Slope angle
      const angleDeg = Math.atan2(hE - hS, offEnd - offStart) * 180 / Math.PI;
      const midPx    = this._elev2px((offStart + offEnd) / 2, (hS + hE) / 2);
      ctx.fillStyle = isActive ? '#88aacc' : '#446688';
      ctx.font = (isActive ? 'bold ' : '') + '11px sans-serif';
      ctx.fillText(angleDeg.toFixed(1) + '\u00b0', midPx.x + 4, midPx.y - 6);

      // Handles — only for the active wall bevel (when in wall mode)
      if (isActive) {
        this._drawHandle(ctx, bHs, this._dragging === 'heightStart', 'height');
        this._drawHandle(ctx, bHe, this._dragging === 'heightEnd',   'height');
        this._drawHandle(ctx, bOs, this._dragging === 'offsetStart', 'offset');
        this._drawHandle(ctx, bOe, this._dragging === 'offsetEnd',   'offset');
      }
    });

    // ── Draw all CEILING bevels (always visible, regardless of mode) ──────────
    const allCeilingBevels = this._getBevels('ceiling');
    allCeilingBevels.forEach((cb, idx) => {
      const isActive = this._mode === 'ceiling' && idx === this._getActiveIdx('ceiling');
      const offStart = cb.offsetStart;
      const offEnd   = cb.offsetEnd !== null ? cb.offsetEnd : wallLen;
      const hS = cb.heightStart;
      const hE = cb.heightEnd;

      // Ceiling bevel: trapezoid from the flat ceiling DOWN to hS/hE
      // top-left=(offStart,floorH), top-right=(offEnd,floorH), bot-right=(offEnd,hE), bot-left=(offStart,hS)
      const bTopL = this._elev2px(offStart, floorH);
      const bTopR = this._elev2px(offEnd,   floorH);
      const bBotL = this._elev2px(offStart, hS);
      const bBotR = this._elev2px(offEnd,   hE);

      ctx.beginPath();
      ctx.moveTo(bTopL.x, bTopL.y); ctx.lineTo(bTopR.x, bTopR.y);
      ctx.lineTo(bBotR.x, bBotR.y); ctx.lineTo(bBotL.x, bBotL.y);
      ctx.closePath();
      ctx.fillStyle = isActive ? 'rgba(40,180,140,0.38)' : 'rgba(40,180,140,0.13)';
      ctx.fill();
      ctx.strokeStyle = isActive ? '#22ccaa' : '#116655';
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.stroke();

      // Boundary dashed lines
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isActive ? '#66ddbb' : '#336655';
      ctx.lineWidth = 1;
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

      // Slope angle label (degrees) — relative to horizontal
      const angleDeg = Math.atan2(hE - hS, offEnd - offStart) * 180 / Math.PI;
      const midPx    = this._elev2px((offStart + offEnd) / 2, (hS + hE + floorH * 2) / 4);
      ctx.fillStyle = isActive ? '#66ddbb' : '#336655';
      ctx.font = (isActive ? 'bold ' : '') + '11px sans-serif';
      ctx.fillText(angleDeg.toFixed(1) + '\u00b0', midPx.x + 4, midPx.y - 6);

      // Handles — only for the active ceiling bevel (when in ceiling mode)
      // Cyan handles ↕ at bottom corners (lowered ceiling level)
      // Orange handles ↔ at top corners (full ceiling level)
      if (isActive) {
        this._drawHandle(ctx, bBotL, this._dragging === 'heightStart', 'height');
        this._drawHandle(ctx, bBotR, this._dragging === 'heightEnd',   'height');
        this._drawHandle(ctx, bTopL, this._dragging === 'offsetStart', 'offset');
        this._drawHandle(ctx, bTopR, this._dragging === 'offsetEnd',   'offset');
      }
    });
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

  _updateLabels({ wallLen, floorH }) {
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

    const bevel = this._getActiveBevel();
    if (bevel) {
      const offStart = bevel.offsetStart;
      const offEnd   = bevel.offsetEnd !== null ? bevel.offsetEnd : wallLen;
      // Ceiling bevel: offset handles are at floorH; wall bevel: offset handles are at 0
      const offsetHandleY = this._mode === 'ceiling' ? floorH : 0;
      addLabel(offStart, bevel.heightStart, bevel.heightStart.toFixed(2) + ' m', '#00ddff', false);
      addLabel(offEnd,   bevel.heightEnd,   bevel.heightEnd.toFixed(2)   + ' m', '#00ddff', true);
      if (offStart > 0.01)
        addLabel(offStart, offsetHandleY, offStart.toFixed(2) + ' m \u2192', '#ffaa00', false);
      if (offEnd < wallLen - 0.01)
        addLabel(offEnd, offsetHandleY, '\u2190 ' + offEnd.toFixed(2) + ' m', '#ffaa00', true);
    }
    addLabel(wallLen / 2, 0, 'L = ' + wallLen.toFixed(2) + ' m', '#888888', false);
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const { wallLen, floorH } = this._getWallBase();
    if (wallLen < 0.01) return;

    const { x: px, y: py } = this._canvasMousePos(e);
    const r = HANDLE_HIT_RADIUS * HANDLE_HIT_MULTIPLIER;

    // 1. Check handles of the active bevel first (positions differ per mode)
    const active = this._getActiveBevel();
    if (active) {
      const offStart = active.offsetStart;
      const offEnd   = active.offsetEnd !== null ? active.offsetEnd : wallLen;
      let handles;
      if (this._mode === 'ceiling') {
        // Ceiling mode: orange offset handles at floorH (top), cyan height handles at bevel height
        handles = [
          { name: 'heightStart', pos: this._elev2px(offStart, active.heightStart) },
          { name: 'heightEnd',   pos: this._elev2px(offEnd,   active.heightEnd)   },
          { name: 'offsetStart', pos: this._elev2px(offStart, floorH)             },
          { name: 'offsetEnd',   pos: this._elev2px(offEnd,   floorH)             },
        ];
      } else {
        // Wall mode: orange offset handles at 0 (floor), cyan height handles at bevel height
        handles = [
          { name: 'heightStart', pos: this._elev2px(offStart, active.heightStart) },
          { name: 'heightEnd',   pos: this._elev2px(offEnd,   active.heightEnd)   },
          { name: 'offsetStart', pos: this._elev2px(offStart, 0)                  },
          { name: 'offsetEnd',   pos: this._elev2px(offEnd,   0)                  },
        ];
      }
      for (const h of handles) {
        if (Math.hypot(px - h.pos.x, py - h.pos.y) < r) {
          this._dragging = h.name;
          return;
        }
      }
    }

    // 2. Check if click is inside a bevel region (current mode) → select that bevel
    const ev = this._px2elev(px, py);
    const bevels = this._getBevels();
    for (let idx = 0; idx < bevels.length; idx++) {
      const bv = bevels[idx];
      const oS = bv.offsetStart;
      const oE = bv.offsetEnd !== null ? bv.offsetEnd : wallLen;
      if (ev.x >= oS && ev.x <= oE) {
        const curIdx = this._getActiveIdx();
        if (idx !== curIdx) {
          this._setActiveIdx(idx);
          this._updateBevelLabel();
          this._updateTitle();
          this.redraw();
        }
        return;
      }
    }
  }

  _onMouseMove(e) {
    if (!this._dragging) return;
    const { wallLen, floorH } = this._getWallBase();
    if (wallLen < 0.01) return;

    const { x: px, y: py } = this._canvasMousePos(e);
    const ev = this._px2elev(px, py);

    const bevel = this._getOrCreateBevel();
    if (!bevel) return;

    const offEnd = bevel.offsetEnd !== null ? bevel.offsetEnd : wallLen;

    switch (this._dragging) {
      case 'heightStart':
        if (this._mode === 'ceiling') {
          // Ceiling height must stay between minimum and the full floor height
          bevel.heightStart = Math.max(MIN_BEVEL_HEIGHT, Math.min(floorH, ev.y));
        } else {
          bevel.heightStart = Math.max(MIN_BEVEL_HEIGHT, ev.y);
        }
        break;
      case 'heightEnd':
        if (this._mode === 'ceiling') {
          bevel.heightEnd = Math.max(MIN_BEVEL_HEIGHT, Math.min(floorH, ev.y));
        } else {
          bevel.heightEnd = Math.max(MIN_BEVEL_HEIGHT, ev.y);
        }
        break;
      case 'offsetStart':
        bevel.offsetStart = Math.max(0, Math.min(ev.x, offEnd - MIN_BEVEL_WIDTH));
        break;
      case 'offsetEnd': {
        const newOff = Math.max(bevel.offsetStart + MIN_BEVEL_WIDTH, Math.min(ev.x, wallLen));
        bevel.offsetEnd = Math.abs(newOff - wallLen) < SNAP_TO_END_THRESHOLD ? null : newOff;
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
