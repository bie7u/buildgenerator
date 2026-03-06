import * as THREE from 'three';
import { Floor } from './Floor.js';

export class Building {
  constructor() {
    this.contour = [];           // THREE.Vector2[] - XZ floor plan coordinates
    this.wallThickness = 0.2;    // meters
    this.floors = [new Floor(0, 2.7)];
  }

  addFloor() {
    const last = this.floors[this.floors.length - 1];
    this.floors.push(new Floor(this.floors.length, last ? last.height : 2.7));
  }

  removeFloor() {
    if (this.floors.length > 1) this.floors.pop();
  }

  getFloor(index) {
    return this.floors[index] || null;
  }

  /**
   * Returns the effective contour for a given floor:
   * the floor's own override if set, otherwise the building's base contour.
   */
  getFloorContour(floorIndex) {
    const floor = this.floors[floorIndex];
    if (floor && floor.contour && floor.contour.length >= 3) {
      return floor.contour;
    }
    return this.contour;
  }

  /** Normalize winding of building base contour AND all per-floor overrides. */
  normalizeAllContourWindings() {
    this.normalizeContourWinding();
    for (const floor of this.floors) {
      if (floor.contour && floor.contour.length >= 3) {
        Building._normalizePoints(floor.contour);
      }
    }
  }

  /** In-place CCW-on-screen winding normalization for an arbitrary point array. */
  static _normalizePoints(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y;
      area -= pts[j].x * pts[i].y;
    }
    if (area / 2 > 0) pts.reverse();
  }

  /** Signed area in XZ plane. Negative = CCW-on-screen (what we want). */
  getContourSignedArea() {
    const n = this.contour.length;
    if (n < 3) return 0;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += this.contour[i].x * this.contour[j].y;
      area -= this.contour[j].x * this.contour[i].y;
    }
    return area / 2;
  }

  /** Ensure CCW-on-screen winding (negative signed area) */
  normalizeContourWinding() {
    if (this.getContourSignedArea() > 0) {
      this.contour.reverse();
    }
  }

  getWallLength(segIndex) {
    const n = this.contour.length;
    if (n < 2) return 0;
    const p1 = this.contour[segIndex];
    const p2 = this.contour[(segIndex + 1) % n];
    return p1.distanceTo(p2);
  }

  get numWallSegments() { return this.contour.length; }

  toJSON() {
    return {
      contour: this.contour.map(p => ({ x: p.x, y: p.y })),
      wallThickness: this.wallThickness,
      floors: this.floors.map(f => f.toJSON())
    };
  }

  static fromJSON(data) {
    const b = new Building();
    b.contour = data.contour.map(p => new THREE.Vector2(p.x, p.y));
    b.wallThickness = data.wallThickness;
    b.floors = data.floors.map((fd, i) => Floor.fromJSON(fd, i));
    return b;
  }
}
