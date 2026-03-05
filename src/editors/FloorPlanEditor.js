import * as THREE from 'three';
import { GridSystem } from '../GridSystem.js';
import { Wall } from '../models/Wall.js';
import { WindowElement } from '../models/WindowElement.js';
import { Door } from '../models/Door.js';
import { Balcony } from '../models/Balcony.js';
import { Elevator } from '../models/Elevator.js';
import { Stairs } from '../models/Stairs.js';
import { FloorHole } from '../models/FloorHole.js';

// ─── 2D line/shape helpers ─────────────────────────────────────────────────
function makeLine(pts, color, linewidth = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints(
    pts.map(p => new THREE.Vector3(p.x, 0.01, p.y))
  );
  const mat = new THREE.LineBasicMaterial({ color, linewidth });
  return new THREE.Line(geo, mat);
}

function makeLineLoop(pts, color) {
  const closed = [...pts, pts[0]];
  return makeLine(closed, color);
}

function makeCircle(cx, cz, r, color, segments = 16) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0.02, cz + Math.sin(a) * r));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geo, mat);
}

function makeDashedLine(pts, color) {
  const geo = new THREE.BufferGeometry().setFromPoints(
    pts.map(p => new THREE.Vector3(p.x, 0.015, p.y))
  );
  const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.2 });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  return line;
}

function makeFilledRect(cx, cz, w, d, color, yOff = 0.01) {
  const hw = w / 2, hd = d / 2;
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, yOff, cz);
  return mesh;
}

// ──────────────────────────────────────────────────────────────────────────
// Radius (metres) within which a mouse click is treated as "on" a vertex
const SNAP_THRESHOLD = 0.5;

/**
 * Renders the floor contour as a semi-transparent filled shape (ghost fill).
 * The contour is in XZ world space (Vector2.y = world Z), so we negate .y
 * before passing to ShapeGeometry and then rotateX(-PI/2) to land in XZ.
 * Rendered above element fills (y=0.03 > element yOff=0.02) with renderOrder=1
 * so the tint is always visible even over stairs/elevator rectangles.
 */
function makeFilledContour(contour, color, opacity) {
  const shape = new THREE.Shape();
  shape.moveTo(contour[0].x, -contour[0].y);
  for (let i = 1; i < contour.length; i++) {
    shape.lineTo(contour[i].x, -contour[i].y);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  return mesh;
}

export class FloorPlanEditor {
  constructor(sceneManager, building, app) {
    this.sm = sceneManager;
    this.building = building;
    this.app = app;

    this.tool = 'select';
    this.currentFloorIndex = 0;
    this.selectedElement = null;

    // Ghost fill — semi-transparent floor contour overlay (helps placing elements)
    this.ghostFill = true;

    // Draw-contour state
    this._isDrawingContour = false;
    this._previewPoints = [];

    // Draw-wall state
    this._isDrawingWall = false;
    this._wallStart = null;

    // Draw-floor-hole state
    this._isDrawingFloorHole = false;
    this._floorHolePoints = [];

    // Pan state
    this._isPanning = false;
    this._panStart = null;

    // Drag state
    this._isDragging = false;
    this._dragTarget = null;

    // Current hover world position
    this._cursorPos = new THREE.Vector2();

    // Bind canvas events
    const c = this.sm.canvas;
    c.addEventListener('mousedown', e => this.onMouseDown(e));
    c.addEventListener('mousemove', e => this.onMouseMove(e));
    c.addEventListener('mouseup', e => this.onMouseUp(e));
    c.addEventListener('wheel', e => this.onMouseWheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('dblclick', e => this.onDblClick(e));

    this.redraw();
  }

  // ── Tool management ───────────────────────────────────────────────────────
  setTool(tool) {
    this.tool = tool;
    this._isDrawingContour = false;
    this._previewPoints = [];
    this._isDrawingFloorHole = false;
    this._floorHolePoints = [];
    this._isDrawingWall = false;
    this._wallStart = null;
    this._isDragging = false;
    this._dragTarget = null;
    this.selectedElement = null;
    if (this.app.ui) this.app.ui.clearProperties();
    this.redraw();
  }

  setFloor(index) {
    this.currentFloorIndex = index;
    this.selectedElement = null;
    if (this.app.ui) this.app.ui.clearProperties();
    this.redraw();
  }

  get currentFloor() {
    return this.building.getFloor(this.currentFloorIndex);
  }

  // ── Mouse events ──────────────────────────────────────────────────────────
  onMouseDown(e) {
    if (this.app.mode !== '2d') return;

    const pos = this._snapToGrid(this.sm.getWorldPosition(e));

    if (e.button === 2 || e.button === 1) {
      // Right/middle drag = pan
      this._isPanning = true;
      this._panStart = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button !== 0) return;

    switch (this.tool) {
      case 'select':         this._handleSelectDown(pos, e); break;
      case 'move':           this._handleMoveDown(pos); break;
      case 'draw-contour':   this._handleDrawContourDown(pos); break;
      case 'draw-wall':      this._handleDrawWallDown(pos); break;
      case 'add-window':     this._handleAddOpeningDown(pos, 'window'); break;
      case 'add-door':       this._handleAddOpeningDown(pos, 'door'); break;
      case 'add-balcony':    this._handleAddOpeningDown(pos, 'balcony'); break;
      case 'add-elevator':   this._handleAddElevatorDown(pos); break;
      case 'add-stairs':     this._handleAddStairsDown(pos); break;
      case 'add-floor-hole': this._handleAddFloorHoleDown(pos); break;
    }
  }

  onMouseMove(e) {
    if (this.app.mode !== '2d') return;

    const rawPos = this.sm.getWorldPosition(e);
    this._cursorPos.copy(rawPos);
    const pos = this._snapToGrid(rawPos);

    // Update status bar
    this.app.ui.updateStatusBar(
      `X: ${pos.x.toFixed(1)}  Z: ${pos.y.toFixed(1)}`
    );

    if (this._isPanning && this._panStart) {
      const dx = e.clientX - this._panStart.x;
      const dy = e.clientY - this._panStart.y;
      this.sm.pan2d(dx, dy);
      this._panStart = { x: e.clientX, y: e.clientY };
      return;
    }

    if (this._isDragging && this._dragTarget) {
      if (this.tool === 'move') {
        this._handleMoveDragMove(pos);
      } else {
        this._handleDragMove(pos);
      }
      return;
    }

    // Preview for active drawing tools
    if (this.tool === 'draw-contour' && this._previewPoints.length > 0) {
      this.redraw();
      this._drawPreviewContour(pos);
    } else if (this.tool === 'draw-wall' && this._isDrawingWall && this._wallStart) {
      this.redraw();
      this._drawPreviewLine(this._wallStart, pos, 0x8844ff);
    } else if (this.tool === 'add-floor-hole' && this._isDrawingFloorHole && this._floorHolePoints.length > 0) {
      this.redraw();
      this._drawPreviewFloorHole(pos);
    }
  }

  onMouseUp(e) {
    if (e.button === 2 || e.button === 1) {
      this._isPanning = false;
      this._panStart = null;
    }
    if (e.button === 0) {
      this._isDragging = false;
      this._dragTarget = null;
    }
  }

  onMouseWheel(e) {
    if (this.app.mode !== '2d') return;
    e.preventDefault();
    this.sm.zoom2d(e.deltaY);
    this.sm.onResize();
    this.redraw();
  }

  onDblClick(e) {
    if (this.app.mode !== '2d') return;
    if (this.tool === 'draw-contour' && this._previewPoints.length >= 3) {
      this._closeContour();
    }
    if (this.tool === 'add-floor-hole' && this._floorHolePoints.length >= 3) {
      this._closeFloorHole();
    }
  }

  // ── Draw-contour ──────────────────────────────────────────────────────────
  _handleDrawContourDown(pos) {
    if (!this._isDrawingContour) {
      this._isDrawingContour = true;
      this._previewPoints = [];
    }

    // Close if near first point
    if (this._previewPoints.length >= 3) {
      const first = this._previewPoints[0];
      if (pos.distanceTo(first) < SNAP_THRESHOLD) {
        this._closeContour();
        return;
      }
    }

    this._previewPoints.push(pos.clone());
    this.redraw();
    this._drawPreviewContour(pos);
  }

  _closeContour() {
    this.building.contour = this._previewPoints.map(p => p.clone());
    this.building.normalizeContourWinding();
    this._isDrawingContour = false;
    this._previewPoints = [];
    this.app.ui.updateBuildingInfo();
    this.redraw();
  }

  _drawPreviewContour(cursor) {
    const pts = this._previewPoints;
    if (pts.length === 0) return;

    // Drawn points
    if (pts.length >= 2) {
      const line = makeLine(pts, 0xaaaaaa);
      this.sm.editGroup.add(line);
    }

    // Preview to cursor
    const dash = makeDashedLine([pts[pts.length - 1], cursor], 0xffffff);
    this.sm.editGroup.add(dash);

    // Close hint circle at first point
    const fc = makeCircle(pts[0].x, pts[0].y, 0.3, 0x44ff88);
    this.sm.editGroup.add(fc);

    // Dots for each preview point
    for (const p of pts) {
      const dot = makeCircle(p.x, p.y, 0.12, 0xff8800);
      this.sm.editGroup.add(dot);
    }

    // Cursor circle
    const cc = makeCircle(cursor.x, cursor.y, 0.1, 0xffffff);
    this.sm.editGroup.add(cc);
  }

  // ── Draw-wall ─────────────────────────────────────────────────────────────
  _handleDrawWallDown(pos) {
    if (!this._isDrawingWall) {
      this._isDrawingWall = true;
      this._wallStart = pos.clone();
    } else {
      const floor = this.currentFloor;
      if (floor && this._wallStart.distanceTo(pos) > 0.1) {
        const wall = new Wall(this._wallStart, pos, this.building.wallThickness);
        floor.internalWalls.push(wall);
        this.selectedElement = wall;
        this.app.ui.showProperties(wall);
        this.app.ui.updateBuildingInfo();
      }
      this._isDrawingWall = false;
      this._wallStart = null;
      this.redraw();
    }
  }

  // ── Add opening (window / door / balcony) ─────────────────────────────────
  _handleAddOpeningDown(pos, type) {
    const result = this._findNearestWallSegment(pos, 2.0);
    if (!result) {
      this.app.ui.showStatusHint('Click closer to a wall segment');
      return;
    }

    const { wallIndex, offset } = result;
    const wallLen = this.building.getWallLength(wallIndex);
    const floor = this.currentFloor;

    if (type === 'window') {
      const w = new WindowElement(wallIndex, offset, 1.2, 1.2, 0.9);
      // Clamp to wall
      if (offset + w.width > wallLen - 0.1) return;
      floor.windows.push(w);
      this.selectedElement = w;
      this.app.ui.showProperties(w);
    } else if (type === 'door') {
      const d = new Door(wallIndex, offset, 0.9, 2.1, 'in');
      if (offset + d.width > wallLen - 0.1) return;
      floor.doors.push(d);
      this.selectedElement = d;
      this.app.ui.showProperties(d);
    } else if (type === 'balcony') {
      const b = new Balcony(wallIndex, offset, 2.0, 1.2);
      if (offset + b.width > wallLen - 0.1) return;
      floor.balconies.push(b);
      this.selectedElement = b;
      this.app.ui.showProperties(b);
    }

    this.app.ui.updateBuildingInfo();
    this.redraw();
  }

  // ── Add elevator ──────────────────────────────────────────────────────────
  _handleAddElevatorDown(pos) {
    const floor = this.currentFloor;
    if (!floor) return;
    floor.elevator = new Elevator(pos, 1.5, 1.5);
    this.selectedElement = floor.elevator;
    this.app.ui.showProperties(floor.elevator);
    this.app.ui.updateBuildingInfo();
    this.redraw();
  }

  // ── Add stairs ────────────────────────────────────────────────────────────
  _handleAddStairsDown(pos) {
    const floor = this.currentFloor;
    if (!floor) return;
    floor.stairs = new Stairs(pos, 1.2, 3.0, 'north');
    this.selectedElement = floor.stairs;
    this.app.ui.showProperties(floor.stairs);
    this.app.ui.updateBuildingInfo();
    this.redraw();
  }

  // ── Add floor hole (drawn polygon) ───────────────────────────────────────
  _handleAddFloorHoleDown(pos) {
    if (!this._isDrawingFloorHole) {
      this._isDrawingFloorHole = true;
      this._floorHolePoints = [];
    }

    // Close if near first point (≥3 points already placed)
    if (this._floorHolePoints.length >= 3) {
      const first = this._floorHolePoints[0];
      if (pos.distanceTo(first) < SNAP_THRESHOLD) {
        this._closeFloorHole();
        return;
      }
    }

    this._floorHolePoints.push(pos.clone());
    this.redraw();
    this._drawPreviewFloorHole(pos);
  }

  _closeFloorHole() {
    const floor = this.currentFloor;
    if (!floor || this._floorHolePoints.length < 3) return;
    const hole = new FloorHole(this._floorHolePoints.map(p => p.clone()));
    floor.floorHoles.push(hole);
    this.selectedElement = hole;
    this.app.ui.showProperties(hole);
    this.app.ui.updateBuildingInfo();
    this._isDrawingFloorHole = false;
    this._floorHolePoints = [];
    this.redraw();
  }

  _drawPreviewFloorHole(cursor) {
    const pts = this._floorHolePoints;
    if (pts.length === 0) return;

    if (pts.length >= 2) {
      const line = makeLine(pts, 0xff4444);
      this.sm.editGroup.add(line);
    }

    // Dashed preview line to cursor
    const dash = makeDashedLine([pts[pts.length - 1], cursor], 0xff6666);
    this.sm.editGroup.add(dash);

    // Close hint circle at first point
    const fc = makeCircle(pts[0].x, pts[0].y, 0.3, 0xff4444);
    this.sm.editGroup.add(fc);

    // Dots for each placed point
    for (const p of pts) {
      this.sm.editGroup.add(makeCircle(p.x, p.y, 0.12, 0xff6666));
    }

    // Cursor circle
    this.sm.editGroup.add(makeCircle(cursor.x, cursor.y, 0.1, 0xffffff));
  }

  // ── Select / drag ─────────────────────────────────────────────────────────
  _handleSelectDown(pos, e) {
    // Try contour vertices first
    const vIdx = this._findNearestContourVertex(pos, SNAP_THRESHOLD);
    if (vIdx !== -1) {
      this._isDragging = true;
      this._dragTarget = { type: 'contour-vertex', index: vIdx };
      return;
    }

    // Try internal wall endpoints
    const floor = this.currentFloor;
    if (floor) {
      for (let wi = 0; wi < floor.internalWalls.length; wi++) {
        const wall = floor.internalWalls[wi];
        if (pos.distanceTo(wall.start) < SNAP_THRESHOLD) {
          this._isDragging = true;
          this._dragTarget = { type: 'wall-start', wallIndex: wi };
          this.selectedElement = wall;
          this.app.ui.showProperties(wall);
          return;
        }
        if (pos.distanceTo(wall.end) < SNAP_THRESHOLD) {
          this._isDragging = true;
          this._dragTarget = { type: 'wall-end', wallIndex: wi };
          this.selectedElement = wall;
          this.app.ui.showProperties(wall);
          return;
        }
      }

      // Elevator
      if (floor.elevator) {
        const ep = floor.elevator.position;
        if (pos.distanceTo(ep) < 1.0) {
          this._isDragging = true;
          this._dragTarget = { type: 'elevator' };
          this.selectedElement = floor.elevator;
          this.app.ui.showProperties(floor.elevator);
          return;
        }
      }

      // Stairs
      if (floor.stairs) {
        const sp = floor.stairs.position;
        if (pos.distanceTo(sp) < 1.5) {
          this._isDragging = true;
          this._dragTarget = { type: 'stairs' };
          this.selectedElement = floor.stairs;
          this.app.ui.showProperties(floor.stairs);
          return;
        }
      }

      // Windows
      for (const win of floor.windows) {
        const wp = this._getElementWorldPos(win);
        if (wp && pos.distanceTo(wp) < 0.8) {
          this.selectedElement = win;
          this.app.ui.showProperties(win);
          this.redraw();
          return;
        }
      }

      // Doors
      for (const door of floor.doors) {
        const dp = this._getElementWorldPos(door);
        if (dp && pos.distanceTo(dp) < 0.8) {
          this.selectedElement = door;
          this.app.ui.showProperties(door);
          this.redraw();
          return;
        }
      }

      // Balconies
      for (const bal of floor.balconies) {
        const bp = this._getElementWorldPos(bal);
        if (bp && pos.distanceTo(bp) < 1.2) {
          this.selectedElement = bal;
          this.app.ui.showProperties(bal);
          this.redraw();
          return;
        }
      }

      // Floor holes — point-in-polygon test
      for (let hi = 0; hi < floor.floorHoles.length; hi++) {
        const hole = floor.floorHoles[hi];
        if (this._pointInPolygon(pos, hole.points)) {
          this._isDragging = true;
          this._dragTarget = { type: 'floor-hole', holeIndex: hi, lastPos: pos.clone() };
          this.selectedElement = hole;
          this.app.ui.showProperties(hole);
          return;
        }
      }
    }

    // Nothing found → deselect
    this.selectedElement = null;
    this.app.ui.clearProperties();
    this.redraw();
  }

  _handleDragMove(pos) {
    const dt = this._dragTarget;
    const floor = this.currentFloor;

    if (dt.type === 'contour-vertex') {
      this.building.contour[dt.index].copy(pos);
    } else if (dt.type === 'wall-start' && floor) {
      floor.internalWalls[dt.wallIndex].start.copy(pos);
    } else if (dt.type === 'wall-end' && floor) {
      floor.internalWalls[dt.wallIndex].end.copy(pos);
    } else if (dt.type === 'elevator' && floor && floor.elevator) {
      floor.elevator.position.copy(pos);
    } else if (dt.type === 'stairs' && floor && floor.stairs) {
      floor.stairs.position.copy(pos);
    } else if (dt.type === 'floor-hole' && floor && floor.floorHoles[dt.holeIndex]) {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      floor.floorHoles[dt.holeIndex].translate(dx, dy);
      dt.lastPos.copy(pos);
    }
    this.redraw();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  /** Ray-casting point-in-polygon test (2D). */
  _pointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    const px = point.x, py = point.y;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // ── Move tool ─────────────────────────────────────────────────────────────
  _handleMoveDown(pos) {
    const floor = this.currentFloor;
    if (!floor) return;

    // Elevator
    if (floor.elevator) {
      const ev = floor.elevator;
      const hw = ev.width / 2 + 0.2, hd = ev.depth / 2 + 0.2;
      if (Math.abs(pos.x - ev.position.x) <= hw && Math.abs(pos.y - ev.position.y) <= hd) {
        this._isDragging = true;
        this._dragTarget = { type: 'elevator', lastPos: pos.clone() };
        this.selectedElement = ev;
        this.app.ui.showProperties(ev);
        return;
      }
    }

    // Stairs (bounding box check using center)
    if (floor.stairs) {
      const st = floor.stairs;
      const cx = st.position.x + st.width / 2;
      const cz = st.position.y + st.runLength / 2;
      if (Math.abs(pos.x - cx) <= st.width / 2 + 0.3 && Math.abs(pos.y - cz) <= st.runLength / 2 + 0.3) {
        this._isDragging = true;
        this._dragTarget = { type: 'stairs', lastPos: pos.clone() };
        this.selectedElement = st;
        this.app.ui.showProperties(st);
        return;
      }
    }

    // Floor holes
    for (let hi = 0; hi < floor.floorHoles.length; hi++) {
      const hole = floor.floorHoles[hi];
      if (this._pointInPolygon(pos, hole.points)) {
        this._isDragging = true;
        this._dragTarget = { type: 'floor-hole', holeIndex: hi, lastPos: pos.clone() };
        this.selectedElement = hole;
        this.app.ui.showProperties(hole);
        return;
      }
    }

    // Windows
    for (let wi = 0; wi < floor.windows.length; wi++) {
      const win = floor.windows[wi];
      const wp = this._getElementWorldPos(win);
      if (wp && pos.distanceTo(wp) < 0.8) {
        this._isDragging = true;
        this._dragTarget = { type: 'window', elementIndex: wi };
        this.selectedElement = win;
        this.app.ui.showProperties(win);
        return;
      }
    }

    // Doors
    for (let di = 0; di < floor.doors.length; di++) {
      const door = floor.doors[di];
      const dp = this._getElementWorldPos(door);
      if (dp && pos.distanceTo(dp) < 0.8) {
        this._isDragging = true;
        this._dragTarget = { type: 'door', elementIndex: di };
        this.selectedElement = door;
        this.app.ui.showProperties(door);
        return;
      }
    }

    // Balconies
    for (let bi = 0; bi < floor.balconies.length; bi++) {
      const bal = floor.balconies[bi];
      const bp = this._getElementWorldPos(bal);
      if (bp && pos.distanceTo(bp) < 1.2) {
        this._isDragging = true;
        this._dragTarget = { type: 'balcony', elementIndex: bi };
        this.selectedElement = bal;
        this.app.ui.showProperties(bal);
        return;
      }
    }
  }

  _handleMoveDragMove(pos) {
    const dt = this._dragTarget;
    const floor = this.currentFloor;
    if (!floor || !dt) return;

    if (dt.type === 'elevator' && floor.elevator) {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      floor.elevator.position.x += dx;
      floor.elevator.position.y += dy;
      dt.lastPos.copy(pos);
    } else if (dt.type === 'stairs' && floor.stairs) {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      floor.stairs.position.x += dx;
      floor.stairs.position.y += dy;
      dt.lastPos.copy(pos);
    } else if (dt.type === 'floor-hole' && floor.floorHoles[dt.holeIndex]) {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      floor.floorHoles[dt.holeIndex].translate(dx, dy);
      dt.lastPos.copy(pos);
    } else if (dt.type === 'window' && floor.windows[dt.elementIndex]) {
      const result = this._findNearestWallSegment(pos, 4.0);
      if (result) {
        const el = floor.windows[dt.elementIndex];
        el.wallIndex = result.wallIndex;
        el.offsetAlongWall = Math.max(0, result.offset - el.width / 2);
      }
    } else if (dt.type === 'door' && floor.doors[dt.elementIndex]) {
      const result = this._findNearestWallSegment(pos, 4.0);
      if (result) {
        const el = floor.doors[dt.elementIndex];
        el.wallIndex = result.wallIndex;
        el.offsetAlongWall = Math.max(0, result.offset - el.width / 2);
      }
    } else if (dt.type === 'balcony' && floor.balconies[dt.elementIndex]) {
      const result = this._findNearestWallSegment(pos, 4.0);
      if (result) {
        const el = floor.balconies[dt.elementIndex];
        el.wallIndex = result.wallIndex;
        el.offsetAlongWall = Math.max(0, result.offset - el.width / 2);
      }
    }
    this.redraw();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _snapToGrid(v) {
    return GridSystem.snap(v);
  }

  _findNearestContourVertex(pos, radius) {
    let best = -1, bestDist = radius;
    for (let i = 0; i < this.building.contour.length; i++) {
      const d = pos.distanceTo(this.building.contour[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  _findNearestWallSegment(pos, maxDist) {
    const contour = this.building.contour;
    const n = contour.length;
    if (n < 2) return null;

    let bestDist = maxDist;
    let bestWallIndex = -1;
    let bestOffset = 0;

    for (let i = 0; i < n; i++) {
      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];
      const segDir = new THREE.Vector2().subVectors(p2, p1);
      const segLen = segDir.length();
      if (segLen < 0.001) continue;
      const segDirN = segDir.clone().divideScalar(segLen);

      // Project pos onto segment
      const toPos = new THREE.Vector2().subVectors(pos, p1);
      let t = toPos.dot(segDirN);
      t = Math.max(0, Math.min(segLen, t));

      const closest = new THREE.Vector2(
        p1.x + segDirN.x * t,
        p1.y + segDirN.y * t
      );
      const dist = pos.distanceTo(closest);
      if (dist < bestDist) {
        bestDist = dist;
        bestWallIndex = i;
        bestOffset = t;
      }
    }

    if (bestWallIndex === -1) return null;
    return { wallIndex: bestWallIndex, offset: Math.round(bestOffset * 10) / 10 };
  }

  _getWallWorldPositions(wallIndex) {
    const contour = this.building.contour;
    const n = contour.length;
    if (n < 2 || wallIndex >= n) return null;
    const p1 = contour[wallIndex];
    const p2 = contour[(wallIndex + 1) % n];
    return { p1, p2 };
  }

  _getElementWorldPos(el) {
    const wp = this._getWallWorldPositions(el.wallIndex);
    if (!wp) return null;
    const { p1, p2 } = wp;
    const dir = new THREE.Vector2().subVectors(p2, p1).normalize();
    const midOff = el.offsetAlongWall + (el.width || 0) / 2;
    return new THREE.Vector2(p1.x + dir.x * midOff, p1.y + dir.y * midOff);
  }

  // ── Redraw ────────────────────────────────────────────────────────────────
  redraw() {
    // Clear edit group
    while (this.sm.editGroup.children.length) {
      const child = this.sm.editGroup.children[0];
      child.geometry?.dispose();
      child.material?.dispose();
      this.sm.editGroup.remove(child);
    }

    this._drawContourAndVertices();

    const floor = this.currentFloor;
    if (floor) {
      this._drawFloorElements(floor);
    }
  }

  _drawContourAndVertices() {
    const c = this.building.contour;
    if (c.length === 0) return;

    // Ghost fill — semi-transparent floor area overlay
    if (this.ghostFill && c.length >= 3) {
      const fill = makeFilledContour(c, 0xaaccff, 0.18);
      this.sm.editGroup.add(fill);
    }

    // Contour lines
    if (c.length >= 2) {
      const loop = makeLineLoop(c, 0xffcc00);
      this.sm.editGroup.add(loop);
    }

    // Vertices
    for (let i = 0; i < c.length; i++) {
      const isSelected = (
        this._isDragging &&
        this._dragTarget?.type === 'contour-vertex' &&
        this._dragTarget?.index === i
      );
      const color = isSelected ? 0x44aaff : 0xff8800;
      const circle = makeCircle(c[i].x, c[i].y, 0.15, color);
      this.sm.editGroup.add(circle);
    }

    // Wall normal indicators (small tick marks at wall mid-points)
    const n = c.length;
    if (n >= 3) {
      for (let i = 0; i < n; i++) {
        const p1 = c[i], p2 = c[(i + 1) % n];
        const mx = (p1.x + p2.x) / 2, mz = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x, dz = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.001) continue;
        const nx = dz / len, nz = -dx / len; // inward normal (right perp for CCW)
        const tickLen = 0.25;
        const tickPts = [
          new THREE.Vector2(mx, mz),
          new THREE.Vector2(mx + nx * tickLen, mz + nz * tickLen)
        ];
        const tick = makeLine(tickPts, 0x888844);
        this.sm.editGroup.add(tick);
      }
    }
  }

  _drawFloorElements(floor) {
    // Internal walls
    for (const wall of floor.internalWalls) {
      const line = makeLine([wall.start, wall.end], 0x8844ff, 2);
      this.sm.editGroup.add(line);
      // Endpoints
      const isSelStart = (
        this._isDragging && this._dragTarget?.type === 'wall-start' &&
        this._dragTarget?.wallIndex === floor.internalWalls.indexOf(wall)
      );
      const isSelEnd = (
        this._isDragging && this._dragTarget?.type === 'wall-end' &&
        this._dragTarget?.wallIndex === floor.internalWalls.indexOf(wall)
      );
      this.sm.editGroup.add(makeCircle(wall.start.x, wall.start.y, 0.12, isSelStart ? 0x44aaff : 0xaa88ff));
      this.sm.editGroup.add(makeCircle(wall.end.x, wall.end.y, 0.12, isSelEnd ? 0x44aaff : 0xaa88ff));
    }

    // Windows
    for (const win of floor.windows) {
      this._drawOpeningMarker(win, 0x44ffff, 'window');
    }

    // Doors
    for (const door of floor.doors) {
      this._drawOpeningMarker(door, 0xffff44, 'door');
    }

    // Balconies
    for (const bal of floor.balconies) {
      this._drawBalconyMarker(bal);
    }

    // Elevator
    if (floor.elevator) {
      const ev = floor.elevator;
      const rect = makeFilledRect(ev.position.x, ev.position.y, ev.width, ev.depth, 0xff4444, 0.02);
      this.sm.editGroup.add(rect);
      const outline = makeLineLoop([
        new THREE.Vector2(ev.position.x - ev.width / 2, ev.position.y - ev.depth / 2),
        new THREE.Vector2(ev.position.x + ev.width / 2, ev.position.y - ev.depth / 2),
        new THREE.Vector2(ev.position.x + ev.width / 2, ev.position.y + ev.depth / 2),
        new THREE.Vector2(ev.position.x - ev.width / 2, ev.position.y + ev.depth / 2)
      ], 0xff6666);
      this.sm.editGroup.add(outline);
      // X mark
      this.sm.editGroup.add(makeLine([
        new THREE.Vector2(ev.position.x - ev.width / 2, ev.position.y - ev.depth / 2),
        new THREE.Vector2(ev.position.x + ev.width / 2, ev.position.y + ev.depth / 2)
      ], 0xff6666));
      this.sm.editGroup.add(makeLine([
        new THREE.Vector2(ev.position.x + ev.width / 2, ev.position.y - ev.depth / 2),
        new THREE.Vector2(ev.position.x - ev.width / 2, ev.position.y + ev.depth / 2)
      ], 0xff6666));
    }

    // Stairs
    if (floor.stairs) {
      const st = floor.stairs;
      const px = st.position.x, pz = st.position.y;
      const rect = makeFilledRect(px + st.width / 2, pz + st.runLength / 2, st.width, st.runLength, 0xff8844, 0.02);
      this.sm.editGroup.add(rect);
      const outline = makeLineLoop([
        new THREE.Vector2(px, pz),
        new THREE.Vector2(px + st.width, pz),
        new THREE.Vector2(px + st.width, pz + st.runLength),
        new THREE.Vector2(px, pz + st.runLength)
      ], 0xffaa66);
      this.sm.editGroup.add(outline);
      // Stair lines
      const numLines = 5;
      for (let i = 1; i < numLines; i++) {
        const t = (i / numLines) * st.runLength;
        this.sm.editGroup.add(makeLine([
          new THREE.Vector2(px, pz + t),
          new THREE.Vector2(px + st.width, pz + t)
        ], 0xffaa66));
      }
    }

    // Floor holes — polygon outline + filled
    for (const hole of floor.floorHoles) {
      if (!hole.points || hole.points.length < 3) continue;
      // Dark filled polygon
      const fill = makeFilledContour(hole.points, 0x110000, 0.70);
      fill.position.y = 0.02;
      this.sm.editGroup.add(fill);
      // Red outline
      this.sm.editGroup.add(makeLineLoop(hole.points, 0xff4444));
      // Diagonal X through centroid to indicate a void
      const c = hole.position;
      const r = hole.radius * 0.5;
      this.sm.editGroup.add(makeLine([
        new THREE.Vector2(c.x - r, c.y - r),
        new THREE.Vector2(c.x + r, c.y + r)
      ], 0xff4444));
      this.sm.editGroup.add(makeLine([
        new THREE.Vector2(c.x + r, c.y - r),
        new THREE.Vector2(c.x - r, c.y + r)
      ], 0xff4444));
      if (this.selectedElement === hole) {
        this.sm.editGroup.add(makeCircle(c.x, c.y, 0.2, 0x44aaff));
      }
    }
  }

  _drawOpeningMarker(el, color, type) {
    const wp = this._getWallWorldPositions(el.wallIndex);
    if (!wp) return;
    const { p1, p2 } = wp;
    const dir = new THREE.Vector2().subVectors(p2, p1);
    const wallLen = dir.length();
    dir.normalize();

    const startP = new THREE.Vector2(
      p1.x + dir.x * el.offsetAlongWall,
      p1.y + dir.y * el.offsetAlongWall
    );
    const endP = new THREE.Vector2(
      p1.x + dir.x * (el.offsetAlongWall + el.width),
      p1.y + dir.y * (el.offsetAlongWall + el.width)
    );

    // Inward normal (right perp for CCW-on-screen)
    const nx = dir.y, nz = -dir.x;
    const inset = 0.15;
    const startIn = new THREE.Vector2(startP.x + nx * inset, startP.y + nz * inset);
    const endIn = new THREE.Vector2(endP.x + nx * inset, endP.y + nz * inset);

    // Draw colored line along wall edge
    this.sm.editGroup.add(makeLine([startP, endP], color, 2));
    this.sm.editGroup.add(makeLine([startIn, endIn], color));
    // End caps
    this.sm.editGroup.add(makeLine([startP, startIn], color));
    this.sm.editGroup.add(makeLine([endP, endIn], color));

    // Selection highlight
    if (this.selectedElement === el) {
      const midP = new THREE.Vector2((startP.x + endP.x) / 2, (startP.y + endP.y) / 2);
      this.sm.editGroup.add(makeCircle(midP.x, midP.y, 0.2, 0x44aaff));
    }
  }

  _drawBalconyMarker(bal) {
    const wp = this._getWallWorldPositions(bal.wallIndex);
    if (!wp) return;
    const { p1, p2 } = wp;
    const dir = new THREE.Vector2().subVectors(p2, p1).normalize();

    // Outward normal (left perp for CCW-on-screen)
    const ox = -dir.y, oz = dir.x;

    const startP = new THREE.Vector2(
      p1.x + dir.x * bal.offsetAlongWall,
      p1.y + dir.y * bal.offsetAlongWall
    );
    const endP = new THREE.Vector2(
      p1.x + dir.x * (bal.offsetAlongWall + bal.width),
      p1.y + dir.y * (bal.offsetAlongWall + bal.width)
    );

    const startOut = new THREE.Vector2(startP.x + ox * bal.depth, startP.y + oz * bal.depth);
    const endOut = new THREE.Vector2(endP.x + ox * bal.depth, endP.y + oz * bal.depth);

    const corners = [startP, endP, endOut, startOut];
    this.sm.editGroup.add(makeLineLoop(corners, 0x44ff88));
    const cx = (startP.x + endP.x + startOut.x + endOut.x) / 4;
    const cz = (startP.y + endP.y + startOut.y + endOut.y) / 4;
    const fill = makeFilledRect(cx, cz, bal.width, bal.depth, 0x44ff88, 0.018);
    this.sm.editGroup.add(fill);

    if (this.selectedElement === bal) {
      this.sm.editGroup.add(makeCircle(cx, cz, 0.2, 0x44aaff));
    }
  }

  _drawPreviewLine(a, b, color) {
    const dash = makeDashedLine([a, b], color);
    this.sm.editGroup.add(dash);
    this.sm.editGroup.add(makeCircle(b.x, b.y, 0.1, color));
  }
}
