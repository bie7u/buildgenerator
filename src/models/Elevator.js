import * as THREE from 'three';

export class Elevator {
  constructor(position, width = 1.5, depth = 1.5) {
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
    return new Elevator(new THREE.Vector2(d.position.x, d.position.y), d.width, d.depth);
  }
}
