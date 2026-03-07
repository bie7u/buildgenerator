import * as THREE from 'three';

export class GridSystem {
  constructor(scene, gridGroup) {
    this.gridGroup = gridGroup;
    this.visible = true;
    this._build();
  }

  _build() {
    while (this.gridGroup.children.length) this.gridGroup.remove(this.gridGroup.children[0]);

    // Major grid (10m × 10m)
    const majorGrid = new THREE.GridHelper(200, 20, 0x444444, 0x333333);
    majorGrid.rotation.x = 0;
    majorGrid.position.y = 0.001;
    this.gridGroup.add(majorGrid);

    // Minor grid (1m × 1m)
    const minorGrid = new THREE.GridHelper(200, 200, 0x2e2e2e, 0x2e2e2e);
    minorGrid.position.y = 0.0005;
    this.gridGroup.add(minorGrid);

    // Axes (X = red, Z = green)
    const axesMat = new THREE.LineBasicMaterial({ vertexColors: true });
    const pts = [
      new THREE.Vector3(-100, 0.002, 0), new THREE.Vector3(100, 0.002, 0),
      new THREE.Vector3(0, 0.002, -100), new THREE.Vector3(0, 0.002, 100)
    ];
    const cols = [
      new THREE.Color(0.4, 0.1, 0.1), new THREE.Color(0.8, 0.2, 0.2),
      new THREE.Color(0.1, 0.4, 0.1), new THREE.Color(0.2, 0.8, 0.2)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array(cols.flatMap(c => [c.r, c.g, c.b])), 3
    ));
    this.gridGroup.add(new THREE.Line(geo, axesMat));
  }

  setVisible(v) {
    this.visible = v;
    this.gridGroup.visible = v;
  }

  /** Snap a Vector2 to 0.1m grid */
  static snap(v) {
    return new THREE.Vector2(
      Math.round(v.x * 10) / 10,
      Math.round(v.y * 10) / 10
    );
  }
}
