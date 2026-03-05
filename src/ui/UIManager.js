import { WindowElement } from '../models/WindowElement.js';
import { Door } from '../models/Door.js';
import { Balcony } from '../models/Balcony.js';
import { Elevator } from '../models/Elevator.js';
import { Stairs } from '../models/Stairs.js';
import { Wall } from '../models/Wall.js';
import { FloorHole } from '../models/FloorHole.js';

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
      'select':         'Click to select elements. Drag vertices to move.',
      'draw-contour':   'Click to add points. Click near first point or double-click to close.',
      'draw-wall':      'Click to place wall start, click again for end.',
      'add-window':     'Click on an outer wall segment to add a window.',
      'add-door':       'Click on an outer wall segment to add a door.',
      'add-balcony':    'Click on an outer wall segment to add a balcony.',
      'add-elevator':   'Click anywhere inside the building to place an elevator shaft.',
      'add-stairs':     'Click anywhere inside the building to place a staircase.',
      'add-floor-hole': 'Click anywhere inside the building to place a floor opening.',
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
      app.building.contour = [];
      app.editor.redraw();
      this.updateBuildingInfo();
    });

    document.getElementById('btn-reset-all').addEventListener('click', () => {
      app.building.contour = [];
      for (const floor of app.building.floors) {
        floor.internalWalls = [];
        floor.windows = [];
        floor.doors = [];
        floor.balconies = [];
        floor.elevator = null;
        floor.stairs = null;
        floor.floorHoles = [];
      }
      app.editor.selectedElement = null;
      this.clearProperties();
      app.editor.redraw();
      this.updateBuildingInfo();
    });
  }

  // ── Floor selector ────────────────────────────────────────────────────────
  /** Returns the display label for a floor option (shared formatting helper). */
  _floorLabel(floor, index) {
    return `Floor ${index + 1}  (${floor.height.toFixed(1)}m)`;
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
      container.appendChild(this._makePropGroup([
        { label: 'Width (m)', key: 'width', type: 'number', min: 0.3, step: 0.1 },
        { label: 'Depth (m)', key: 'depth', type: 'number', min: 0.3, step: 0.1 },
      ], element, () => app.editor.redraw()));
      container.appendChild(this._makeFloorCopySection(
        floor => floor.floorHoles.some(h =>
          h.position.distanceTo(element.position) <= COPY_TOLERANCE_M),
        floor => {
          if (!floor.floorHoles.some(h =>
              h.position.distanceTo(element.position) <= COPY_TOLERANCE_M)) {
            floor.floorHoles.push(new FloorHole(element.position, element.width, element.depth));
          }
        },
        floor => {
          floor.floorHoles = floor.floorHoles.filter(h =>
            !(h.position.distanceTo(element.position) <= COPY_TOLERANCE_M));
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
    const floor = b.getFloor(this.app.currentFloorIndex);
    document.getElementById('info-floors').textContent = b.floors.length;
    document.getElementById('info-contour').textContent = b.contour.length;
    document.getElementById('info-walls').textContent = floor ? floor.internalWalls.length : 0;
    document.getElementById('info-windows').textContent = floor ? floor.windows.length : 0;
    document.getElementById('info-doors').textContent = floor ? floor.doors.length : 0;

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
