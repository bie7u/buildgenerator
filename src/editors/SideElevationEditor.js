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

    // Editing mode is always 'ceiling' — WallBevels are shown as read-only
    // background but cannot be created or edited through this UI.
    this._mode = 'ceiling';

    // Active ceiling-bevel index for the current wall
    this._activeCeilingBevelIdx = 0;

    // Canvas / DOM refs
    this._canvas         = null;
    this._ctx            = null;
    this._container      = null;
    this._labelContainer = null;
    this._floorSelect    = null;
    this._wallLabel      = null;
    this._bevelLabel     = null;
    this._modeCeilingBtn = null;
    this._depthLbl       = null;
    this._depthInput     = null;
    this._btnAllWalls    = null;
    this._hintEl         = null;
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
    title.textContent = 'Roof Slope Editor';

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

    // ── Roof Slope mode label ────────────────────────────────────────────────
    // (displayed as a styled non-interactive label, not a button)
    const modeCeiling = document.createElement('span');
    modeCeiling.textContent = '\u2302\u00a0Roof Slope';
    modeCeiling.title = 'Roof Slope — lower the wall top near this edge to create a sloped roof. Click + Add, then drag the cyan handles down.';
    modeCeiling.style.cssText = [
      'color:#22ccaa', 'font-size:11px', 'font-weight:700',
      'border:1px solid #22bbaa', 'border-radius:4px',
      'padding:3px 9px', 'background:#0a1a18',
    ].join(';');
    this._modeCeilingBtn = modeCeiling;

    // Depth input
    const depthLbl = this._makeLabel('Depth (m):');
    this._depthLbl = depthLbl;

    const depthInput = document.createElement('input');
    depthInput.type = 'number';
    depthInput.min = '0.1';
    depthInput.max = '50';
    depthInput.step = '0.5';
    depthInput.value = '2.0';
    depthInput.title = 'How far the sloped surface extends into the room (m). For a full gable roof set this to half the building width.';
    depthInput.style.cssText = [
      'width:52px', 'background:#2a2a2a', 'color:#ccc',
      'border:1px solid #444', 'border-radius:4px',
      'padding:2px 4px', 'font-size:11px',
    ].join(';');
    depthInput.addEventListener('change', () => {
      const val = parseFloat(depthInput.value);
      if (!isNaN(val) && val > 0) {
        const bevel = this._getActiveBevel();
        if (bevel) { bevel.depth = val; this.redraw(); }
      }
    });
    depthInput.addEventListener('input', () => {
      const val = parseFloat(depthInput.value);
      if (!isNaN(val) && val > 0) {
        const bevel = this._getActiveBevel();
        if (bevel) { bevel.depth = val; this.redraw(); }
      }
    });
    this._depthInput = depthInput;

    // "Apply to all walls" button
    const btnAllWalls = this._makeBtn('\u27f3\u00a0All Walls', () => this._applyToAllWalls());
    btnAllWalls.title = 'Copy this roof slope to every wall on this floor (quick hip-roof)';
    btnAllWalls.style.background = '#1a2a3a';
    btnAllWalls.style.borderColor = '#3a6a9a';
    btnAllWalls.style.color = '#88bbee';
    this._btnAllWalls = btnAllWalls;

    // Separator 2
    const sep2 = document.createElement('span');
    sep2.style.cssText = 'color:#444;font-size:11px';
    sep2.textContent = '|';

    // Bevel nav
    const bevelLbl  = this._makeLabel('Slope:');
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
    hint.id = 'elevation-hint';
    hint.style.cssText = 'color:#555;font-size:10px;flex:1';
    hint.textContent = 'Drag cyan \u2195 (height) or orange \u2194 (region). Right-click \u2192 delete.';
    this._hintEl = hint;

    // Close
    const btnClose = this._makeBtn('\u2715\u00a0Close', () => this.app.setMode('2d'));

    header.append(
      title,
      floorLbl, floorSel,
      wallLbl, wallPrev, wallCnt, wallNext,
      sep,
      modeCeiling,
      depthLbl, depthInput,
      btnAllWalls,
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
    this._activeCeilingBevelIdx = 0;

    this._populateFloorSelect();
    this._updateWallLabel();
    this._updateBevelLabel();
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

  // ── Hint and depth sync ────────────────────────────────────────────────────

  /** Update the hint text based on bevel count. */
  _updateHint() {
    if (!this._hintEl) return;
    const n = this._getBevels('ceiling').length;
    if (n === 0) {
      this._hintEl.style.color = '#998844';
      this._hintEl.textContent =
        '\u2302 Click +\u00a0Add to create a roof slope on this wall. ' +
        'Drag cyan \u2195 handles down to lower the wall edge. ' +
        'Depth = how far the slope extends into the room.';
    } else {
      this._hintEl.style.color = '#555';
      this._hintEl.textContent =
        'Cyan \u2195 = wall height at outer edge  |  Orange \u2194 = region boundary  |  ' +
        'Depth input = how far slope extends inward  |  Right-click \u2192 delete.';
    }
  }

  /** Sync depth input value to the active ceiling bevel. */
  _syncDepthInput() {
    if (!this._depthInput) return;
    const bevel = this._getActiveBevel();
    this._depthInput.value = bevel ? bevel.depth : 2.0;
  }

  // ── Bevel array helpers ────────────────────────────────────────────────────

  /**
   * Returns sorted ceiling bevels for the current wall.
   * Pass mode='wall' only for read-only canvas drawing of legacy WallBevels.
   */
  _getBevels(mode = 'ceiling') {
    const floor = this._getFloor();
    if (!floor) return [];
    const arr = mode === 'ceiling' ? (floor.ceilingBevels || []) : (floor.wallBevels || []);
    return arr
      .filter(bv => bv.wallIndex === this.wallIndex)
      .sort((a, b) => a.offsetStart - b.offsetStart);
  }

  _getActiveIdx() {
    return this._activeCeilingBevelIdx;
  }

  _setActiveIdx(idx) {
    this._activeCeilingBevelIdx = idx;
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
    this._updateHint();
  }

  _updateTitle() {
    const el = document.getElementById('elevation-title');
    if (!el) return;
    const nC = this._getBevels('ceiling').length;
    const nW = this._getBevels('wall').length;
    let suffix = '';
    if (nC) suffix += ' [' + nC + ' slope' + (nC > 1 ? 's' : '') + ']';
    if (nW) suffix += ' (' + nW + ' legacy wall bevel' + (nW > 1 ? 's' : '') + ')';
    el.textContent = 'Roof Slope Editor \u2014 Floor ' + (this.floorIndex + 1) +
      ', Wall ' + (this.wallIndex + 1) + suffix;
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
      // Start at 50% of floor height so the slope is immediately visible
      const initH     = Math.max(MIN_BEVEL_HEIGHT, floorH * 0.5);
      const initDepth = Math.min(Math.max(1.0, Math.round(wallLen * 0.4 * 10) / 10), 10.0);
      bevel = new CeilingBevel(this.wallIndex, initH, initH, 0, null, initDepth);
      floor.ceilingBevels.push(bevel);
      const sorted = this._getBevels('ceiling');
      this._activeCeilingBevelIdx = sorted.findIndex(bv => bv === bevel);
      if (this._activeCeilingBevelIdx < 0) this._activeCeilingBevelIdx = 0;
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

    const bevels = this._getBevels();

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

    const snapEnd   = Math.abs(e - wallLen) < SNAP_TO_END_THRESHOLD ? null : e;
    const snapStart = Math.abs(s) < SNAP_TO_END_THRESHOLD ? 0 : s;

    // Default height: 50% of floor height — immediately creates a dramatic, visible slope.
    // Default depth: cover ~40% of wall length, capped at 10 m — enough for a real roof slope.
    const initH     = Math.max(MIN_BEVEL_HEIGHT, Math.round(floorH * 0.5 * 10) / 10);
    const initDepth = Math.min(Math.max(1.0, Math.round(wallLen * 0.4 * 10) / 10), 10.0);
    const newBevel  = new CeilingBevel(
      this.wallIndex,
      initH,
      initH,
      snapStart,
      snapEnd,
      initDepth,
    );
    floor.ceilingBevels.push(newBevel);
    const sorted = this._getBevels('ceiling');
    this._activeCeilingBevelIdx = sorted.findIndex(bv => bv === newBevel);
    if (this._activeCeilingBevelIdx < 0) this._activeCeilingBevelIdx = sorted.length - 1;

    this._updateBevelLabel();
    this._updateTitle();
    this._syncDepthInput();
    this.redraw();
  }

  _deleteActiveBevel() {
    const floor = this._getFloor();
    if (!floor) return;
    const bevel = this._getActiveBevel();
    if (!bevel) return;

    floor.ceilingBevels = floor.ceilingBevels.filter(bv => bv !== bevel);
    const count = this._getBevels('ceiling').length;
    if (this._activeCeilingBevelIdx >= count)
      this._activeCeilingBevelIdx = Math.max(0, count - 1);

    this._updateBevelLabel();
    this._updateTitle();
    this._fitView();
    this.redraw();
  }

  /**
   * Copy the active ceiling bevel's height and depth to ALL walls on this floor
   * that do not already have a ceiling bevel, producing a uniform hip-roof effect.
   */
  _applyToAllWalls() {
    const floor  = this._getFloor();
    const b      = this.app.building;
    if (!floor || !b) return;

    const src = this._getActiveBevel();
    if (!src) return;

    const contour   = b.getFloorContour(this.floorIndex);
    const wallCount = contour.length;
    const hS    = src.heightStart;
    const hE    = src.heightEnd;
    const depth = src.depth;

    let added = 0;
    for (let wi = 0; wi < wallCount; wi++) {
      if (wi === this.wallIndex) continue; // already has this bevel
      // Skip walls that already have any ceiling bevel
      const existing = (floor.ceilingBevels || []).filter(cb => cb.wallIndex === wi);
      if (existing.length > 0) continue;

      const p1 = contour[wi];
      const p2 = contour[(wi + 1) % wallCount];
      const wLen = p1.distanceTo(p2);

      // Use the same height ratios as the source bevel, scaled to the wall's height
      const { floorH } = this._getWallBase();
      const ratio = floorH > 0 ? hS / floorH : 0.5;
      const newH = Math.max(MIN_BEVEL_HEIGHT, Math.min(floorH, Math.round(ratio * floorH * 10) / 10));

      floor.ceilingBevels.push(new CeilingBevel(wi, newH, newH, 0, null, Math.min(depth, wLen / 2)));
      added++;
    }

    if (added > 0) {
      this._updateTitle();
      this.redraw();
      // Brief flash of confirmation in the title
      const el = document.getElementById('elevation-title');
      if (el) {
        const orig = el.textContent;
        el.textContent = '\u2714 Roof slope applied to ' + added + ' wall' + (added > 1 ? 's' : '') + '!';
        el.style.color = '#88ee88';
        setTimeout(() => { el.textContent = orig; el.style.color = ''; }, 2000);
      }
    }
  }



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

    // ── Draw all WALL bevels (read-only reference, dimmed) ─────────────────────
    const allBevels = this._getBevels('wall');
    allBevels.forEach((bv) => {
      // Wall bevels are always shown dimmed (read-only — no longer editable via UI)
      const offStart = bv.offsetStart;
      const offEnd   = bv.offsetEnd !== null ? bv.offsetEnd : wallLen;
      const hS = bv.heightStart;
      const hE = bv.heightEnd;

      const bOs = this._elev2px(offStart, 0);
      const bOe = this._elev2px(offEnd,   0);
      const bHs = this._elev2px(offStart, hS);
      const bHe = this._elev2px(offEnd,   hE);

      // Bevel fill (trapezoid: floor line → sloped top) — always dimmed
      ctx.beginPath();
      ctx.moveTo(bOs.x, bOs.y); ctx.lineTo(bOe.x, bOe.y);
      ctx.lineTo(bHe.x, bHe.y); ctx.lineTo(bHs.x, bHs.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(80,140,200,0.12)';
      ctx.fill();
      ctx.strokeStyle = '#3366aa';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Boundary dashed lines
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#446688';
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

      // Slope angle label (dimmed)
      const angleDeg = Math.atan2(hE - hS, offEnd - offStart) * 180 / Math.PI;
      const midPx    = this._elev2px((offStart + offEnd) / 2, (hS + hE) / 2);
      ctx.fillStyle = '#446688';
      ctx.font = '10px sans-serif';
      ctx.fillText(angleDeg.toFixed(1) + '\u00b0 (legacy)', midPx.x + 4, midPx.y - 6);
    });

    // ── Draw all CEILING bevels ───────────────────────────────────────────────
    const allCeilingBevels = this._getBevels('ceiling');
    allCeilingBevels.forEach((cb, idx) => {
      const isActive = idx === this._getActiveIdx();
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

      // ── Depth indicator: label showing depth on the active bevel trapezoid ──
      // Depth is perpendicular to the wall so it can't be drawn accurately in
      // the 2D side elevation.  Instead, show a text label on the teal region.
      if (isActive) {
        const depthPx = this._elev2px((offStart + offEnd) / 2, floorH);
        ctx.fillStyle = '#22ccaa';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('depth: ' + cb.depth.toFixed(1) + ' m \u21d0 into room', depthPx.x + 4, depthPx.y + 16);
      }

      // Handles — only for the active ceiling bevel (when in ceiling mode)
      // Cyan handles ↕ at bottom corners (lowered wall top height)
      // Orange handles ↔ at top corners (bevel region boundary)
      if (isActive) {
        this._drawHandle(ctx, bBotL, this._dragging === 'heightStart', 'height');
        this._drawHandle(ctx, bBotR, this._dragging === 'heightEnd',   'height');
        this._drawHandle(ctx, bTopL, this._dragging === 'offsetStart', 'offset');
        this._drawHandle(ctx, bTopR, this._dragging === 'offsetEnd',   'offset');
      }
    });

    // ── Empty-state overlay when no slopes exist yet ──────────────────────────
    if (allCeilingBevels.length === 0) {
      const msgX = cw / 2;
      const msgY = ch / 2 - 20;
      ctx.fillStyle = 'rgba(34,204,170,0.13)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#22ccaa';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('\u2302 Roof Slope', msgX, msgY);
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#88ddcc';
      ctx.fillText('Click  + Add  to create a roof slope on this wall.', msgX, msgY + 24);
      ctx.fillStyle = '#556677';
      ctx.font = '11px sans-serif';
      ctx.fillText('Then drag the cyan \u2195 handles DOWN to lower the wall edge.', msgX, msgY + 44);
      ctx.fillText('For a full roof: set Depth \u2248 half the building width, then click \u27f3 All Walls.', msgX, msgY + 60);
      ctx.textAlign = 'left';
    }
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
      // Ceiling bevel: offset handles are at floorH (top edge)
      addLabel(offStart, bevel.heightStart, bevel.heightStart.toFixed(2) + ' m (wall top)', '#00ddff', false);
      addLabel(offEnd,   bevel.heightEnd,   bevel.heightEnd.toFixed(2)   + ' m (wall top)', '#00ddff', true);
      if (offStart > 0.01)
        addLabel(offStart, floorH, offStart.toFixed(2) + ' m \u2192', '#ffaa00', false);
      if (offEnd < wallLen - 0.01)
        addLabel(offEnd, floorH, '\u2190 ' + offEnd.toFixed(2) + ' m', '#ffaa00', true);
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

    // 1. Check handles of the active bevel first
    // Ceiling bevel: orange offset handles at floorH (top), cyan height handles at bevel height
    const active = this._getActiveBevel();
    if (active) {
      const offStart = active.offsetStart;
      const offEnd   = active.offsetEnd !== null ? active.offsetEnd : wallLen;
      const handles = [
        { name: 'heightStart', pos: this._elev2px(offStart, active.heightStart) },
        { name: 'heightEnd',   pos: this._elev2px(offEnd,   active.heightEnd)   },
        { name: 'offsetStart', pos: this._elev2px(offStart, floorH)             },
        { name: 'offsetEnd',   pos: this._elev2px(offEnd,   floorH)             },
      ];
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
        // Ceiling height must stay between minimum and the full floor height
        bevel.heightStart = Math.max(MIN_BEVEL_HEIGHT, Math.min(floorH, ev.y));
        break;
      case 'heightEnd':
        bevel.heightEnd = Math.max(MIN_BEVEL_HEIGHT, Math.min(floorH, ev.y));
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
