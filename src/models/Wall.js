import * as THREE from 'three';

export class Wall {
  constructor(start, end, thickness = 0.15) {
    this.start = start.clone();   // THREE.Vector2 (x, z)
    this.end = end.clone();       // THREE.Vector2 (x, z)
    this.thickness = thickness;
  }

  get length() { return this.start.distanceTo(this.end); }

  toJSON() {
    return {
      start: { x: this.start.x, y: this.start.y },
      end: { x: this.end.x, y: this.end.y },
      thickness: this.thickness
    };
  }

  static fromJSON(d) {
    return new Wall(
      new THREE.Vector2(d.start.x, d.start.y),
      new THREE.Vector2(d.end.x, d.end.y),
      d.thickness
    );
  }
}
