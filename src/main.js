import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Building } from './models/Building.js';
import { SceneManager } from './SceneManager.js';
import { GridSystem } from './GridSystem.js';
import { FloorPlanEditor } from './editors/FloorPlanEditor.js';
import { SideElevationEditor } from './editors/SideElevationEditor.js';
import { BuildingGenerator } from './generators/BuildingGenerator.js';
import { UIManager } from './ui/UIManager.js';

// Application state object
const app = {
  buildings: [new Building()],
  currentBuildingIndex: 0,
  currentFloorIndex: 0,
  mode: '2d',
  sceneManager: null,
  grid: null,
  editor: null,
  elevationEditor: null,
  generator: null,
  ui: null,

  // Currently selected wall segment for the elevation editor
  elevationFloorIndex: 0,
  elevationWallIndex: 0,

  /** Currently active building */
  get building() {
    return this.buildings[this.currentBuildingIndex];
  },

  setMode(mode) {
    this.mode = mode;

    // Elevation view is independent — it shows/hides its own panel
    const is2d  = (mode === '2d');
    const is3d  = (mode === '3d');
    const isElev = (mode === 'elevation');

    this.sceneManager.setMode(is3d ? '3d' : '2d');

    document.getElementById('btn-2d').classList.toggle('active', is2d);
    document.getElementById('btn-3d').classList.toggle('active', is3d);
    document.getElementById('btn-elevation')?.classList.toggle('active', isElev);

    if (isElev) {
      // Hide floor-plan canvas, show elevation panel
      this.editor._hideDimEdit();
      const lc = document.getElementById('canvas-labels');
      if (lc) lc.innerHTML = '';
      this.elevationEditor.show(this.elevationFloorIndex, this.elevationWallIndex);
    } else {
      // Make sure elevation is hidden
      if (this.elevationEditor?.visible) this.elevationEditor.hide();

      if (is2d) {
        this.editor.redraw();
      } else {
        this.editor._hideDimEdit();
        const lc = document.getElementById('canvas-labels');
        if (lc) lc.innerHTML = '';
      }
    }
  },

  /** Open the elevation editor for the given floor + wall segment. */
  openElevation(floorIndex, wallIndex) {
    this.elevationFloorIndex = floorIndex;
    this.elevationWallIndex  = wallIndex;
    this.setMode('elevation');
  },

  addBuilding() {
    this.buildings.push(new Building());
    this.currentBuildingIndex = this.buildings.length - 1;
    this.currentFloorIndex = 0;
    if (this.editor) this.editor.resetState();
    if (this.ui) {
      this.ui._updateBuildingSelector();
      this.ui._updateFloorSelector();
      this.ui.updateBuildingInfo();
    }
  },

  removeBuilding() {
    if (this.buildings.length <= 1) return;
    this.buildings.splice(this.currentBuildingIndex, 1);
    this.currentBuildingIndex = Math.min(this.currentBuildingIndex, this.buildings.length - 1);
    this.currentFloorIndex = 0;
    if (this.editor) {
      this.editor.resetState();  // already calls redraw()
    }
    if (this.ui) {
      this.ui._updateBuildingSelector();
      this.ui._updateFloorSelector();
      this.ui._updateBuildingSettingsInputs();
      this.ui.updateBuildingInfo();
    }
  },

  switchBuilding(index) {
    this.currentBuildingIndex = index;
    this.currentFloorIndex = Math.min(
      this.currentFloorIndex,
      this.building.floors.length - 1
    );
    if (this.editor) {
      this.editor.resetState();
    }
    if (this.ui) {
      this.ui._updateFloorSelector();
      this.ui._updateBuildingSettingsInputs();
      this.ui.updateBuildingInfo();
    }
  },

  generate3D() {
    const hasValid = this.buildings.some(b => b.contour.length >= 3);
    if (!hasValid) {
      document.getElementById('status-hint').textContent =
        'Draw a floor contour first (at least 3 points).';
      return;
    }
    for (const b of this.buildings) {
      if (b.contour.length >= 3) b.normalizeAllContourWindings();
    }
    this.generator.generateAll(this.buildings);
    this.setMode('3d');
    document.getElementById('status-hint').textContent =
      'Use mouse to orbit, scroll to zoom, right-drag to pan.';
  },

  exportGLTF() {
    const exporter = new GLTFExporter();
    exporter.parse(
      this.sceneManager.buildingGroup,
      (gltf) => {
        const blob = new Blob([JSON.stringify(gltf)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'building.gltf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      (err) => console.error('GLTF export error:', err),
      { binary: false }
    );
  }
};

// Bootstrap
function init() {
  const canvas = document.getElementById('canvas');

  app.sceneManager = new SceneManager(canvas);
  app.grid = new GridSystem(null, app.sceneManager.gridGroup);
  app.editor = new FloorPlanEditor(app.sceneManager, app);
  app.elevationEditor = new SideElevationEditor(app.sceneManager, app);
  app.generator = new BuildingGenerator(app.sceneManager);
  app.ui = new UIManager(app);

  app.sceneManager.startLoop();

  // Toolbar: elevation button
  const btnElev = document.getElementById('btn-elevation');
  if (btnElev) {
    btnElev.addEventListener('click', () => {
      if (app.mode === 'elevation') {
        app.setMode('2d');
      } else {
        app.setMode('elevation');
      }
    });
  }

  // Initial status
  document.getElementById('status-hint').textContent =
    'Select "Draw Contour" to start drawing the building outline.';
  document.getElementById('status-mode').textContent = 'Mode: Select';
}

init();

// Expose for browser console debugging
window.app = app;
