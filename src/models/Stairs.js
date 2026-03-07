import * as THREE from 'three';

export class Stairs {
  constructor(position, width = 1.2, runLength = 3.0, direction = 'north') {
    this.position = position.clone();  // THREE.Vector2 bottom-left corner in XZ
    this.width = width;
    this.runLength = runLength;
    this.direction = direction;  // 'north' | 'south' | 'east' | 'west'
  }

  toJSON() {
    return {
      position: { x: this.position.x, y: this.position.y },
      width: this.width,
      runLength: this.runLength,
      direction: this.direction
    };
  }

  static fromJSON(d) {
    return new Stairs(new THREE.Vector2(d.position.x, d.position.y), d.width, d.runLength, d.direction);
  }
}
