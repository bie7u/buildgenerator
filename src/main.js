import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Building } from './models/Building.js';
import { SceneManager } from './SceneManager.js';
import { GridSystem } from './GridSystem.js';
import { FloorPlanEditor } from './editors/FloorPlanEditor.js';
import { BuildingGenerator } from './generators/BuildingGenerator.js';
import { UIManager } from './ui/UIManager.js';

// Application state object
const app = {
  building: new Building(),
  currentFloorIndex: 0,
  mode: '2d',
  sceneManager: null,
  grid: null,
  editor: null,
  generator: null,
  ui: null,

  setMode(mode) {
    this.mode = mode;
    this.sceneManager.setMode(mode);
    document.getElementById('btn-2d').classList.toggle('active', mode === '2d');
    document.getElementById('btn-3d').classList.toggle('active', mode === '3d');
    if (mode === '2d') {
      this.editor.redraw();
    }
  },

  generate3D() {
    if (this.building.contour.length < 3) {
      document.getElementById('status-hint').textContent =
        'Draw a floor contour first (at least 3 points).';
      return;
    }
    this.building.normalizeContourWinding();
    this.generator.generate(this.building);
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
  app.editor = new FloorPlanEditor(app.sceneManager, app.building, app);
  app.generator = new BuildingGenerator(app.sceneManager);
  app.ui = new UIManager(app);

  app.sceneManager.startLoop();

  // Initial status
  document.getElementById('status-hint').textContent =
    'Select "Draw Contour" to start drawing the building outline.';
  document.getElementById('status-mode').textContent = 'Mode: Select';
}

init();

// Expose for browser console debugging
window.app = app;
