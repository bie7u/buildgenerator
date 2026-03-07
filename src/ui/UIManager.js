import { WindowElement } from '../models/WindowElement.js';
import { Door } from '../models/Door.js';
import { Balcony } from '../models/Balcony.js';
import { Elevator } from '../models/Elevator.js';
import { Stairs } from '../models/Stairs.js';
import { Wall } from '../models/Wall.js';
import { FloorHole } from '../models/FloorHole.js';
import { BuildingConnection } from '../models/BuildingConnection.js';
import * as THREE from 'three';

// Max position difference (metres) used when matching an element on another
// floor as a copy of the currently-selected element.
const COPY_TOLERANCE_M = 0.05;

export class UIManager {
  constructor(app) {
    this.app = app;
    this._bindToolbar();
    this._bindTools();
    this._bindBuildingSettings();
    this._bindQuickActions();
    this._bindShapeType();
    this._bindConnections();
    this._updateBuildingSelector();
    this._updateFloorSelector();
    this.updateBuildingInfo();
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  _bindToolbar() {
    const app = this.app;

    document.getElementById('btn-2d').addEventListener('click', () => {
      app.setMode('2d');
    });

    document.getElementById('btn-3d').addEventListener('click', () => {
      app.setMode('3d');
    });

    document.getElementById('building-select').addEventListener('change', e => {
      const idx = parseInt(e.target.value, 10);
      app.switchBuilding(idx);
    });

    document.getElementById('btn-add-building').addEventListener('click', () => {
      app.addBuilding();
    });

    document.getElementById('btn-remove-building').addEventListener('click', () => {
      app.removeBuilding();
    });

    document.getElementById('floor-select').addEventListener('change', e => {
      const idx = parseInt(e.target.value, 10);
      app.currentFloorIndex = idx;
      app.editor.setFloor(idx);
      this._updateFloorHeightInput();
    });

    document.getElementById('btn-add-floor').addEventListener('click', () => {
      app.building.addFloor();
      this._updateFloorSelector();
      this.updateBuildingInfo();
    });

    document.getElementById('btn-remove-floor').addEventListener('click', () => {
      app.building.removeFloor();
      const maxIdx = app.building.floors.length - 1;
      if (app.currentFloorIndex > maxIdx) {
        app.currentFloorIndex = maxIdx;
        app.editor.setFloor(maxIdx);
      }
      this._updateFloorSelector();
      this.updateBuildingInfo();
    });

    document.getElementById('btn-generate').addEventListener('click', () => {
      app.generate3D();
    });

    document.getElementById('btn-export').addEventListener('click', () => {
      app.exportGLTF();
    });
  }

  // ── Tool buttons ──────────────────────────────────────────────────────────
  _bindTools() {
    const toolMap = {
      'select':         'select',
      'move':           'move',
      'draw-contour':   'draw-contour',
      'draw-wall':      'draw-wall',
      'add-window':     'add-window',
      'add-door':       'add-door',
      'add-balcony':    'add-balcony',
      'add-elevator':   'add-elevator',
      'add-stairs':     'add-stairs',
      'add-floor-hole': 'add-floor-hole',
    };

    const hintMap = {
      'select':         'Click to select elements. Drag vertices or elements to reposition.',
      'move':           'Click and drag any element to move it. Wall elements snap to the nearest wall.',
      'draw-contour':   'Floor 0: draws building base contour. Floor 1+: draws this floor\'s custom contour. Double-click or click near first point to close.',
      'draw-wall':      'Click to place wall start, click again for end.',
      'add-window':     'Click on an outer wall segment to add a window.',
      'add-door':       'Click on an outer wall segment to add a door.',
      'add-balcony':    'Click on an outer wall segment to add a balcony.',
      'add-elevator':   'Click anywhere inside the building to place an elevator shaft.',
      'add-stairs':     'Click anywhere inside the building to place a staircase.',
      'add-floor-hole': 'Click to add polygon points. Click near the first point or double-click to close.',
    };

    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool');
        this.app.editor.setTool(tool);
        this.setActiveToolButton(tool);
        document.getElementById('status-mode').textContent = `Mode: ${btn.textContent.trim()}`;
        document.getElementById('status-hint').textContent = hintMap[tool] || '';
      });
    });
  }

  // ── Building settings ─────────────────────────────────────────────────────
  _bindBuildingSettings() {
    const app = this.app;

    document.getElementById('wall-thickness').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0) {
        app.building.wallThickness = v;
      }
    });

    document.getElementById('floor-height').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0) {
        const floor = app.building.getFloor(app.currentFloorIndex);
        if (floor) floor.height = v;
      }
    });

    document.getElementById('show-grid').addEventListener('change', e => {
      app.grid.setVisible(e.target.checked);
    });

    document.getElementById('ghost-fill').addEventListener('change', e => {
      app.editor.ghostFill = e.target.checked;
      app.editor.redraw();
    });

    document.getElementById('independent-floors').addEventListener('change', e => {
      // Independent floor mode: future feature hook
    });
  }

  /** Sync building-scoped settings inputs to the active building. */
  _updateBuildingSettingsInputs() {
    const b = this.app.building;
    document.getElementById('wall-thickness').value = b.wallThickness;
    this._updateFloorHeightInput();
  }

  // ── Quick actions ─────────────────────────────────────────────────────────
  _bindQuickActions() {
    const app = this.app;

    document.getElementById('btn-clear-floor').addEventListener('click', () => {
      const floor = app.building.getFloor(app.currentFloorIndex);
      if (floor) {
        floor.internalWalls = [];
        floor.windows = [];
        floor.doors = [];
        floor.balconies = [];
        floor.elevator = null;
        floor.stairs = null;
        floor.floorHoles = [];
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      }
    });

    document.getElementById('btn-clear-contour').addEventListener('click', () => {
      const floor = app.building.getFloor(app.currentFloorIndex);
      if (app.currentFloorIndex > 0 && floor && floor.contour) {
        // Clear only the floor-level override
        floor.contour = null;
      } else {
        // Clear the building base contour
        app.building.contour = [];
      }
      app.editor.redraw();
      this.updateBuildingInfo();
    });

    document.getElementById('btn-reset-floor-contour').addEventListener('click', () => {
      const floor = app.building.getFloor(app.currentFloorIndex);
      if (floor && floor.contour) {
        floor.contour = null;
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      }
    });

    document.getElementById('btn-reset-all').addEventListener('click', () => {
      // Reset ALL buildings
      for (const b of app.buildings) {
        b.contour = [];
        for (const floor of b.floors) {
          floor.contour = null;
          floor.internalWalls = [];
          floor.windows = [];
          floor.doors = [];
          floor.balconies = [];
          floor.elevator = null;
          floor.stairs = null;
          floor.floorHoles = [];
        }
      }
      app.editor.selectedElement = null;
      this.clearProperties();
      app.editor.redraw();
      this.updateBuildingInfo();
    });
  }

  // ── Shape type quick-generator ────────────────────────────────────────────
  /**
   * Pre-defined footprint templates.
   * All coordinates are centred around origin in XZ plane (THREE.Vector2 y = Z).
   * Scale: 1 unit = 1 metre.  Points are listed CW so normalizeContourWinding
   * will flip them to CCW automatically before generation.
   */
  _shapeContours() {
    const W = 10, D = 8;     // overall bounding box: 10 m wide × 8 m deep
    const hw = W / 2, hd = D / 2;
    const t = W / 3;         // arm thickness for compound shapes

    return {
      'rect': [
        { x: -hw, y: -hd }, { x:  hw, y: -hd },
        { x:  hw, y:  hd }, { x: -hw, y:  hd },
      ],
      // L-shape: full square minus top-right quadrant
      'l-shape': [
        { x: -hw, y: -hd }, { x:  hw, y: -hd },
        { x:  hw, y:   0 }, { x:   0, y:   0 },
        { x:   0, y:  hd }, { x: -hw, y:  hd },
      ],
      // T-shape: horizontal bar on top, vertical stem below
      't-shape': [
        { x: -hw, y: -hd   }, { x:  hw, y: -hd   },
        { x:  hw, y: -hd+t }, { x:  t/2, y: -hd+t },
        { x:  t/2, y:  hd  }, { x: -t/2, y:  hd  },
        { x: -t/2, y: -hd+t }, { x: -hw, y: -hd+t },
      ],
      // U-shape: open at the top
      'u-shape': [
        { x: -hw, y: -hd }, { x:  hw, y: -hd },
        { x:  hw, y:  hd }, { x:  hw-t, y:  hd },
        { x:  hw-t, y: -hd+t }, { x: -hw+t, y: -hd+t },
        { x: -hw+t, y:  hd }, { x: -hw, y:  hd },
      ],
    };
  }

  _bindShapeType() {
    const app = this.app;
    const contours = this._shapeContours();

    document.querySelectorAll('.shape-btn[data-shape]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-shape');
        const pts = contours[key];
        if (!pts) return;

        // Confirm replacement if contour already exists
        const existing = app.building.getFloorContour(app.currentFloorIndex);
        if (existing.length >= 3) {
          if (!confirm('Replace the current contour with the selected shape?')) return;
        }

        const newContour = pts.map(p => new THREE.Vector2(p.x, p.y));

        if (app.currentFloorIndex === 0) {
          app.building.contour = newContour;
        } else {
          const floor = app.building.getFloor(app.currentFloorIndex);
          if (floor) floor.contour = newContour;
        }

        app.building.normalizeAllContourWindings();
        app.editor.selectedElement = null;
        app.editor.redraw();
        this.updateBuildingInfo();
      });
    });
  }

  // ── Connections ───────────────────────────────────────────────────────────
  _bindConnections() {
    const app = this.app;

    document.getElementById('btn-add-connection').addEventListener('click', () => {
      this._populateConnectionBuildingSelects();
      document.getElementById('connection-form').style.display = '';
      document.getElementById('btn-add-connection').style.display = 'none';
    });

    document.getElementById('btn-conn-cancel').addEventListener('click', () => {
      document.getElementById('connection-form').style.display = 'none';
      document.getElementById('btn-add-connection').style.display = '';
    });

    document.getElementById('btn-conn-confirm').addEventListener('click', () => {
      const fromIdx = parseInt(document.getElementById('conn-from').value, 10);
      const toIdx   = parseInt(document.getElementById('conn-to').value,   10);
      if (fromIdx === toIdx) {
        alert('Cannot connect a building to itself — please select two different buildings.');
        return;
      }
      const type  = document.getElementById('conn-type').value;
      const label = document.getElementById('conn-label').value.trim();

      app.connections.push(new BuildingConnection(fromIdx, toIdx, type, label));

      document.getElementById('connection-form').style.display = 'none';
      document.getElementById('btn-add-connection').style.display = '';
      document.getElementById('conn-label').value = '';

      this._renderConnectionsList();
    });
  }

  _populateConnectionBuildingSelects() {
    const app = this.app;
    for (const id of ['conn-from', 'conn-to']) {
      const sel = document.getElementById(id);
      sel.innerHTML = '';
      for (let i = 0; i < app.buildings.length; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Building ${i + 1}`;
        sel.appendChild(opt);
      }
    }
    // Default: from = current, to = next (if exists)
    document.getElementById('conn-from').value = app.currentBuildingIndex;
    const toDefault = app.currentBuildingIndex === 0 ? 1 : 0;
    document.getElementById('conn-to').value = Math.min(toDefault, app.buildings.length - 1);
  }

  /** Re-render the flat list of existing connections. */
  _renderConnectionsList() {
    const app = this.app;
    const list = document.getElementById('connections-list');
    list.innerHTML = '';

    if (app.connections.length === 0) {
      list.innerHTML = '<p class="hint-text">No connections yet.</p>';
      return;
    }

    app.connections.forEach((conn, idx) => {
      const item = document.createElement('div');
      item.className = 'conn-item';

      const badge = document.createElement('span');
      badge.className = `conn-type-badge conn-type-${conn.type}`;
      badge.textContent = conn.type;

      const info = document.createElement('div');
      info.className = 'conn-item-info';

      const title = document.createElement('div');
      title.className = 'conn-item-title';
      title.textContent = conn.label || `B${conn.buildingIndexA + 1} ↔ B${conn.buildingIndexB + 1}`;

      const meta = document.createElement('div');
      meta.className = 'conn-item-meta';
      meta.textContent = `Building ${conn.buildingIndexA + 1} ↔ Building ${conn.buildingIndexB + 1}`;
      if (conn.label) meta.textContent += ` · ${conn.type}`;

      info.appendChild(title);
      info.appendChild(meta);

      const del = document.createElement('button');
      del.className = 'conn-delete-btn';
      del.textContent = '✕';
      del.title = 'Remove connection';
      del.addEventListener('click', () => {
        // Use object identity to find the correct index at deletion time,
        // so stale closures never remove the wrong connection.
        const currentIdx = app.connections.indexOf(conn);
        if (currentIdx !== -1) app.connections.splice(currentIdx, 1);
        this._renderConnectionsList();
      });

      item.appendChild(badge);
      item.appendChild(info);
      item.appendChild(del);
      list.appendChild(item);
    });
  }

  // ── Building selector ─────────────────────────────────────────────────────
  _updateBuildingSelector() {
    const sel = document.getElementById('building-select');
    sel.innerHTML = '';
    for (let i = 0; i < this.app.buildings.length; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Building ${i + 1}`;
      sel.appendChild(opt);
    }
    sel.value = this.app.currentBuildingIndex;

    // Keep connections panel in sync (building labels may have changed)
    this._renderConnectionsList();

    // Hide add-connection button if there's only one building
    const addBtn = document.getElementById('btn-add-connection');
    if (addBtn) {
      addBtn.style.display = this.app.buildings.length > 1 ? '' : 'none';
    }
  }

  // ── Floor selector ────────────────────────────────────────────────────────
  /** Returns the display label for a floor option (shared formatting helper). */
  _floorLabel(floor, index) {
    const marker = (floor.contour && floor.contour.length >= 3) ? ' ★' : '';
    return `Floor ${index + 1}  (${floor.height.toFixed(1)}m)${marker}`;
  }

  _updateFloorSelector() {
    const sel = document.getElementById('floor-select');
    const prevIdx = parseInt(sel.value, 10) || 0;
    sel.innerHTML = '';
    const floors = this.app.building.floors;
    for (let i = 0; i < floors.length; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = this._floorLabel(floors[i], i);
      sel.appendChild(opt);
    }
    const clampedIdx = Math.min(prevIdx, floors.length - 1);
    sel.value = clampedIdx;
    this.app.currentFloorIndex = clampedIdx;
    this.app.editor && this.app.editor.setFloor(clampedIdx);
    this._updateFloorHeightInput();
  }

  _updateFloorHeightInput() {
    const floor = this.app.building.getFloor(this.app.currentFloorIndex);
    if (floor) {
      document.getElementById('floor-height').value = floor.height.toFixed(1);
    }
  }

  // ── Properties panel ──────────────────────────────────────────────────────
  showProperties(element) {
    const container = document.getElementById('properties-content');
    container.innerHTML = '';

    const app = this.app;

    if (element instanceof WindowElement) {
      container.innerHTML = `<div class="prop-type-badge">Window</div>`;
      container.appendChild(this._makePropGroup([
        { label: 'Wall index', key: 'wallIndex', type: 'number', min: 0, step: 1, readonly: true },
        { label: 'Offset (m)', key: 'offsetAlongWall', type: 'number', min: 0, step: 0.1 },
        { label: 'Width (m)', key: 'width', type: 'number', min: 0.3, step: 0.1 },
        { label: 'Height (m)', key: 'height', type: 'number', min: 0.3, step: 0.1 },
        { label: 'Sill height (m)', key: 'sillHeight', type: 'number', min: 0, step: 0.1 },
      ], element, () => app.editor.redraw()));
      container.appendChild(this._makeFloorCopySection(
        floor => floor.windows.some(w =>
          w.wallIndex === element.wallIndex &&
          Math.abs(w.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M),
        floor => {
          if (!floor.windows.some(w =>
              w.wallIndex === element.wallIndex &&
              Math.abs(w.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M)) {
            floor.windows.push(new WindowElement(
              element.wallIndex, element.offsetAlongWall,
              element.width, element.height, element.sillHeight));
          }
        },
        floor => {
          floor.windows = floor.windows.filter(w =>
            !(w.wallIndex === element.wallIndex &&
              Math.abs(w.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M));
        }
      ));
      this._addDeleteButton(container, () => {
        const floor = app.building.getFloor(app.currentFloorIndex);
        if (floor) floor.windows = floor.windows.filter(e => e !== element);
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      });

    } else if (element instanceof Door) {
      container.innerHTML = `<div class="prop-type-badge">Door</div>`;
      container.appendChild(this._makePropGroup([
        { label: 'Wall index', key: 'wallIndex', type: 'number', min: 0, step: 1, readonly: true },
        { label: 'Offset (m)', key: 'offsetAlongWall', type: 'number', min: 0, step: 0.1 },
        { label: 'Width (m)', key: 'width', type: 'number', min: 0.5, step: 0.1 },
        { label: 'Height (m)', key: 'height', type: 'number', min: 1.8, step: 0.1 },
      ], element, () => app.editor.redraw()));
      container.appendChild(this._makeSelectRow('Opening dir', 'openingDirection',
        ['in', 'out'], element, () => app.editor.redraw()));
      container.appendChild(this._makeFloorCopySection(
        floor => floor.doors.some(d =>
          d.wallIndex === element.wallIndex &&
          Math.abs(d.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M),
        floor => {
          if (!floor.doors.some(d =>
              d.wallIndex === element.wallIndex &&
              Math.abs(d.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M)) {
            floor.doors.push(new Door(
              element.wallIndex, element.offsetAlongWall,
              element.width, element.height, element.openingDirection));
          }
        },
        floor => {
          floor.doors = floor.doors.filter(d =>
            !(d.wallIndex === element.wallIndex &&
              Math.abs(d.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M));
        }
      ));
      this._addDeleteButton(container, () => {
        const floor = app.building.getFloor(app.currentFloorIndex);
        if (floor) floor.doors = floor.doors.filter(e => e !== element);
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      });

    } else if (element instanceof Balcony) {
      container.innerHTML = `<div class="prop-type-badge">Balcony</div>`;
      container.appendChild(this._makePropGroup([
        { label: 'Wall index', key: 'wallIndex', type: 'number', min: 0, step: 1, readonly: true },
        { label: 'Offset (m)', key: 'offsetAlongWall', type: 'number', min: 0, step: 0.1 },
        { label: 'Width (m)', key: 'width', type: 'number', min: 0.5, step: 0.1 },
        { label: 'Depth (m)', key: 'depth', type: 'number', min: 0.5, step: 0.1 },
      ], element, () => app.editor.redraw()));
      container.appendChild(this._makeFloorCopySection(
        floor => floor.balconies.some(b =>
          b.wallIndex === element.wallIndex &&
          Math.abs(b.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M),
        floor => {
          if (!floor.balconies.some(b =>
              b.wallIndex === element.wallIndex &&
              Math.abs(b.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M)) {
            floor.balconies.push(new Balcony(
              element.wallIndex, element.offsetAlongWall,
              element.width, element.depth));
          }
        },
        floor => {
          floor.balconies = floor.balconies.filter(b =>
            !(b.wallIndex === element.wallIndex &&
              Math.abs(b.offsetAlongWall - element.offsetAlongWall) <= COPY_TOLERANCE_M));
        }
      ));
      this._addDeleteButton(container, () => {
        const floor = app.building.getFloor(app.currentFloorIndex);
        if (floor) floor.balconies = floor.balconies.filter(e => e !== element);
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      });

    } else if (element instanceof Elevator) {
      container.innerHTML = `<div class="prop-type-badge">Elevator</div>`;
      container.appendChild(this._makePropGroup([
        { label: 'Width (m)', key: 'width', type: 'number', min: 0.8, step: 0.1 },
        { label: 'Depth (m)', key: 'depth', type: 'number', min: 0.8, step: 0.1 },
      ], element, () => app.editor.redraw()));
      container.appendChild(this._makeFloorCopySection(
        floor => floor.elevator &&
          floor.elevator.position.distanceTo(element.position) <= COPY_TOLERANCE_M,
        floor => {
          floor.elevator = new Elevator(element.position, element.width, element.depth);
        },
        floor => {
          floor.elevator = null;
        }
      ));
      this._addDeleteButton(container, () => {
        const floor = app.building.getFloor(app.currentFloorIndex);
        if (floor) floor.elevator = null;
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      });

    } else if (element instanceof Stairs) {
      container.innerHTML = `<div class="prop-type-badge">Stairs</div>`;
      container.appendChild(this._makePropGroup([
        { label: 'Width (m)', key: 'width', type: 'number', min: 0.8, step: 0.1 },
        { label: 'Run length (m)', key: 'runLength', type: 'number', min: 1.0, step: 0.1 },
      ], element, () => app.editor.redraw()));
      container.appendChild(this._makeSelectRow('Direction', 'direction',
        ['north', 'south', 'east', 'west'], element, () => app.editor.redraw()));
      container.appendChild(this._makeFloorCopySection(
        floor => floor.stairs &&
          floor.stairs.position.distanceTo(element.position) <= COPY_TOLERANCE_M,
        floor => {
          floor.stairs = new Stairs(
            element.position, element.width, element.runLength, element.direction);
        },
        floor => {
          floor.stairs = null;
        }
      ));
      this._addDeleteButton(container, () => {
        const floor = app.building.getFloor(app.currentFloorIndex);
        if (floor) floor.stairs = null;
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      });

    } else if (element instanceof Wall) {
      container.innerHTML = `<div class="prop-type-badge">Internal Wall</div>`;
      container.appendChild(this._makePropGroup([
        { label: 'Thickness (m)', key: 'thickness', type: 'number', min: 0.05, step: 0.05 },
      ], element, () => app.editor.redraw()));
      container.appendChild(this._makeFloorCopySection(
        floor => floor.internalWalls.some(w =>
          w.start.distanceTo(element.start) <= COPY_TOLERANCE_M &&
          w.end.distanceTo(element.end) <= COPY_TOLERANCE_M),
        floor => {
          if (!floor.internalWalls.some(w =>
              w.start.distanceTo(element.start) <= COPY_TOLERANCE_M &&
              w.end.distanceTo(element.end) <= COPY_TOLERANCE_M)) {
            floor.internalWalls.push(new Wall(element.start, element.end, element.thickness));
          }
        },
        floor => {
          floor.internalWalls = floor.internalWalls.filter(w =>
            !(w.start.distanceTo(element.start) <= COPY_TOLERANCE_M &&
              w.end.distanceTo(element.end) <= COPY_TOLERANCE_M));
        }
      ));
      this._addDeleteButton(container, () => {
        const floor = app.building.getFloor(app.currentFloorIndex);
        if (floor) floor.internalWalls = floor.internalWalls.filter(e => e !== element);
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      });

    } else if (element instanceof FloorHole) {
      container.innerHTML = `<div class="prop-type-badge">Floor Hole</div>`;
      const info = document.createElement('p');
      info.className = 'hint-text';
      info.textContent = `Polygon with ${element.points.length} vertices`;
      container.appendChild(info);
      container.appendChild(this._makeFloorCopySection(
        floor => floor.floorHoles.some(h =>
          h.points.length === element.points.length &&
          h.points.every((p, i) => p.distanceTo(element.points[i]) <= COPY_TOLERANCE_M)),
        floor => {
          if (!floor.floorHoles.some(h =>
              h.points.length === element.points.length &&
              h.points.every((p, i) => p.distanceTo(element.points[i]) <= COPY_TOLERANCE_M))) {
            floor.floorHoles.push(new FloorHole(element.points));
          }
        },
        floor => {
          floor.floorHoles = floor.floorHoles.filter(h =>
            !(h.points.length === element.points.length &&
              h.points.every((p, i) => p.distanceTo(element.points[i]) <= COPY_TOLERANCE_M)));
        }
      ));
      this._addDeleteButton(container, () => {
        const floor = app.building.getFloor(app.currentFloorIndex);
        if (floor) floor.floorHoles = floor.floorHoles.filter(e => e !== element);
        app.editor.selectedElement = null;
        this.clearProperties();
        app.editor.redraw();
        this.updateBuildingInfo();
      });

    } else {
      this.clearProperties();
    }
  }

  /**
   * Generic "Copy to floors" section.
   * @param {(floor: Floor) => boolean} matchFn  - Is the element already on that floor?
   * @param {(floor: Floor) => void}    copyFn   - Copy element to that floor.
   * @param {(floor: Floor) => void}    removeFn - Remove element from that floor.
   */
  _makeFloorCopySection(matchFn, copyFn, removeFn) {
    const app = this.app;
    const floors = app.building.floors;

    if (floors.length <= 1) return document.createDocumentFragment();

    const section = document.createElement('div');
    section.className = 'prop-group';

    const header = document.createElement('div');
    header.style.cssText = 'font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;margin-top:4px;';
    header.textContent = 'Copy to floors';
    section.appendChild(header);

    for (let i = 0; i < floors.length; i++) {
      if (i === app.currentFloorIndex) continue;

      const row = document.createElement('div');
      row.className = 'prop-row';
      row.style.gap = '6px';

      const cbId = `copy-floor-cb-${i}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = cbId;
      cb.style.cursor = 'pointer';
      cb.checked = matchFn(floors[i]);

      const lbl = document.createElement('label');
      lbl.htmlFor = cbId;
      lbl.textContent = `Floor ${i + 1}  (${floors[i].height.toFixed(1)}m)`;
      lbl.style.cssText = 'cursor:pointer;flex:1;';

      cb.addEventListener('change', () => {
        const targetFloor = app.building.floors[i];
        if (cb.checked) {
          copyFn(targetFloor);
        } else {
          removeFn(targetFloor);
        }
        app.editor.redraw();
        app.ui.updateBuildingInfo();
      });

      row.appendChild(cb);
      row.appendChild(lbl);
      section.appendChild(row);
    }

    return section;
  }

  _makePropGroup(fields, element, onChange) {
    const group = document.createElement('div');
    group.className = 'prop-group';
    for (const field of fields) {
      const row = document.createElement('div');
      row.className = 'prop-row';
      const label = document.createElement('label');
      label.textContent = field.label;
      const input = document.createElement('input');
      input.type = field.type || 'number';
      input.className = 'prop-input';
      input.value = element[field.key];
      if (field.min !== undefined) input.min = field.min;
      if (field.step !== undefined) input.step = field.step;
      if (field.readonly) input.readOnly = true;
      input.addEventListener('input', e => {
        const v = field.type === 'number' ? parseFloat(e.target.value) : e.target.value;
        if (field.type === 'number' && isNaN(v)) return;
        element[field.key] = v;
        onChange && onChange();
        this.updateBuildingInfo();
      });
      row.appendChild(label);
      row.appendChild(input);
      group.appendChild(row);
    }
    return group;
  }

  _makeSelectRow(label, key, options, element, onChange) {
    const row = document.createElement('div');
    row.className = 'prop-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'prop-input';
    sel.style.width = '80px';
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (element[key] === opt) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', e => {
      element[key] = e.target.value;
      onChange && onChange();
    });
    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  _addDeleteButton(container, onDelete) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.textContent = 'Delete Element';
    btn.style.marginTop = '10px';
    btn.style.background = '#4a1a1a';
    btn.style.borderColor = '#6a2a2a';
    btn.style.color = '#ff8888';
    btn.addEventListener('click', onDelete);
    container.appendChild(btn);
  }

  clearProperties() {
    document.getElementById('properties-content').innerHTML =
      '<p class="hint-text">Select an element to view and edit its properties.</p>';
  }

  // ── Status bar ────────────────────────────────────────────────────────────
  updateStatusBar(posText) {
    document.getElementById('status-position').textContent = posText;
  }

  showStatusHint(text) {
    document.getElementById('status-hint').textContent = text;
  }

  // ── Active tool button ────────────────────────────────────────────────────
  setActiveToolButton(tool) {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === tool);
    });
  }

  // ── Building info ─────────────────────────────────────────────────────────
  updateBuildingInfo() {
    const b = this.app.building;
    const fi = this.app.currentFloorIndex;
    const floor = b.getFloor(fi);
    const hasFloorOverride = floor && floor.contour && floor.contour.length >= 3;

    document.getElementById('info-buildings').textContent = this.app.buildings.length;
    document.getElementById('info-floors').textContent = b.floors.length;
    // Show the effective contour point count for the current floor
    const effectiveContour = b.getFloorContour(fi);
    document.getElementById('info-contour').textContent =
      effectiveContour.length + (hasFloorOverride ? ' ★' : '');
    document.getElementById('info-walls').textContent = floor ? floor.internalWalls.length : 0;
    document.getElementById('info-windows').textContent = floor ? floor.windows.length : 0;
    document.getElementById('info-doors').textContent = floor ? floor.doors.length : 0;

    // Show/hide the "Reset floor contour" button
    const resetBtn = document.getElementById('btn-reset-floor-contour');
    if (resetBtn) {
      resetBtn.style.display = (hasFloorOverride && fi > 0) ? '' : 'none';
    }

    // Also refresh floor selector text (heights may have changed)
    const sel = document.getElementById('floor-select');
    const currentVal = sel.value;
    const floors = b.floors;
    sel.innerHTML = '';
    for (let i = 0; i < floors.length; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = this._floorLabel(floors[i], i);
      sel.appendChild(opt);
    }
    sel.value = currentVal;
  }
}
