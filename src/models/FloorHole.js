import * as THREE from 'three';

export class FloorHole {
  constructor(position, width = 1.0, depth = 1.0) {
    this.position = position.clone();  // THREE.Vector2 center in XZ
    this.width = width;
    this.depth = depth;
  }

  toJSON() {
    return {
      position: { x: this.position.x, y: this.position.y },
      width: this.width,
      depth: this.depth
    };
  }

  static fromJSON(d) {
    return new FloorHole(
      new THREE.Vector2(d.position.x, d.position.y),
      d.width,
      d.depth
    );
  }
}
