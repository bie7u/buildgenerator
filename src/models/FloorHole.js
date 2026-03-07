import * as THREE from 'three';

export class FloorHole {
  /**
   * @param {THREE.Vector2[]} points – polygon vertices in world XZ (Vector2.y = world Z)
   */
  constructor(points) {
    this.points = points.map(p => p.clone());
  }

  /** Centroid of the polygon (computed, read-only). */
  get position() {
    const n = this.points.length;
    if (n === 0) return new THREE.Vector2();
    const cx = this.points.reduce((s, p) => s + p.x, 0) / n;
    const cy = this.points.reduce((s, p) => s + p.y, 0) / n;
    return new THREE.Vector2(cx, cy);
  }

  /** Approximate selection radius (distance from centroid to farthest vertex). */
  get radius() {
    const c = this.position;
    return Math.max(...this.points.map(p => p.distanceTo(c)));
  }

  /** Translate all polygon points by (dx, dy). */
  translate(dx, dy) {
    for (const p of this.points) {
      p.x += dx;
      p.y += dy;
    }
  }

  toJSON() {
    return { points: this.points.map(p => ({ x: p.x, y: p.y })) };
  }

  static fromJSON(d) {
    // Support legacy rectangle format (position + width + depth)
    if (d.position && d.width !== undefined) {
      const hw = d.width / 2, hd = d.depth / 2;
      const cx = d.position.x, cy = d.position.y;
      return new FloorHole([
        new THREE.Vector2(cx - hw, cy - hd),
        new THREE.Vector2(cx + hw, cy - hd),
        new THREE.Vector2(cx + hw, cy + hd),
        new THREE.Vector2(cx - hw, cy + hd),
      ]);
    }
    return new FloorHole(d.points.map(p => new THREE.Vector2(p.x, p.y)));
  }
}
