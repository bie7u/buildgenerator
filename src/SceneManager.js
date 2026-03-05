import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = '2d';  // '2d' or '3d'

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2c2c2c);

    // 2D Orthographic Camera (top-down, looking at XZ plane)
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const aspect = w / h;
    const half = 15;
    this.camera2d = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 1000);
    this.camera2d.position.set(0, 50, 0);
    this.camera2d.lookAt(0, 0, 0);
    this.camera2d.up.set(0, 0, -1);

    // 3D Perspective Camera
    this.camera3d = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
    this.camera3d.position.set(20, 15, 25);
    this.camera3d.lookAt(0, 0, 0);

    // Orbit Controls for 3D
    this.orbitControls = new OrbitControls(this.camera3d, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.enabled = false;

    // Lighting
    this._setupLighting();

    // Building group (populated by generator)
    this.buildingGroup = new THREE.Group();
    this.scene.add(this.buildingGroup);

    // 2D editing group (populated by editor)
    this.editGroup = new THREE.Group();
    this.scene.add(this.editGroup);

    // Grid group (populated by GridSystem)
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);

    // Resize
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(30, 50, 30);
    dirLight.castShadow = true;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    this.scene.add(dirLight);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556677, 0.4);
    this.scene.add(hemi);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === '3d') {
      this.scene.background = new THREE.Color(0x1a1a2e);
      this.orbitControls.enabled = true;
      this.buildingGroup.visible = true;
      this.editGroup.visible = false;
      this.gridGroup.visible = false;
    } else {
      this.scene.background = new THREE.Color(0x2c2c2c);
      this.orbitControls.enabled = false;
      this.buildingGroup.visible = false;
      this.editGroup.visible = true;
      this.gridGroup.visible = true;
    }
  }

  get currentCamera() {
    return this.mode === '2d' ? this.camera2d : this.camera3d;
  }

  onResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;

    this.renderer.setSize(w, h, false);
    const aspect = w / h;

    // Update 2D camera
    const half = 15 / this.camera2d.zoom;
    this.camera2d.left = -half * aspect;
    this.camera2d.right = half * aspect;
    this.camera2d.top = half;
    this.camera2d.bottom = -half;
    this.camera2d.updateProjectionMatrix();

    // Update 3D camera
    this.camera3d.aspect = aspect;
    this.camera3d.updateProjectionMatrix();
  }

  render() {
    if (this.mode === '3d') this.orbitControls.update();
    this.renderer.render(this.scene, this.currentCamera);
  }

  /** Start animation loop */
  startLoop() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.render();
    };
    loop();
  }

  /** Get world position from mouse event, projected onto Y=0 plane */
  getWorldPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ndc = new THREE.Vector2(
      (x / rect.width) * 2 - 1,
      -(y / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera2d);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);
    return new THREE.Vector2(target.x, target.z);
  }

  /** Zoom 2D camera */
  zoom2d(delta) {
    this.camera2d.zoom = Math.max(0.1, Math.min(10, this.camera2d.zoom * (1 - delta * 0.001)));
    this.camera2d.updateProjectionMatrix();
    this.onResize();
  }

  /** Pan 2D camera */
  pan2d(dx, dy) {
    const rect = this.canvas.getBoundingClientRect();
    const half = 15 / this.camera2d.zoom;
    const worldPerPx = (half * 2) / rect.height;
    this.camera2d.position.x -= dx * worldPerPx;
    this.camera2d.position.z += dy * worldPerPx;
    this.camera2d.lookAt(this.camera2d.position.x, 0, this.camera2d.position.z);
  }
}
