import * as THREE from 'three';
import { Wall } from './Wall.js';
import { WindowElement } from './WindowElement.js';
import { Door } from './Door.js';
import { Balcony } from './Balcony.js';
import { Elevator } from './Elevator.js';
import { Stairs } from './Stairs.js';
import { FloorHole } from './FloorHole.js';
import { WallBevel } from './WallBevel.js';

export class Floor {
  constructor(index, height = 2.7) {
    this.index = index;
    this.height = height;
    this.contour = null;       // THREE.Vector2[] | null — per-floor override; null = use building base
    this.internalWalls = [];   // Wall[]
    this.windows = [];         // WindowElement[]
    this.doors = [];           // Door[]
    this.balconies = [];       // Balcony[]
    this.elevator = null;      // Elevator | null
    this.stairs = null;        // Stairs | null
    this.floorHoles = [];      // FloorHole[]
    this.wallBevels = [];      // WallBevel[] — per-segment slope overrides
  }

  toJSON() {
    return {
      index: this.index,
      height: this.height,
      contour: this.contour ? this.contour.map(p => ({ x: p.x, y: p.y })) : null,
      internalWalls: this.internalWalls.map(w => w.toJSON()),
      windows: this.windows.map(w => w.toJSON()),
      doors: this.doors.map(d => d.toJSON()),
      balconies: this.balconies.map(b => b.toJSON()),
      elevator: this.elevator ? this.elevator.toJSON() : null,
      stairs: this.stairs ? this.stairs.toJSON() : null,
      floorHoles: this.floorHoles.map(h => h.toJSON()),
      wallBevels: this.wallBevels.map(b => b.toJSON()),
    };
  }

  static fromJSON(data, index) {
    const f = new Floor(index, data.height);
    if (data.contour && data.contour.length >= 3) {
      f.contour = data.contour.map(p => new THREE.Vector2(p.x, p.y));
    }
    f.internalWalls = (data.internalWalls || []).map(w => Wall.fromJSON(w));
    f.windows = (data.windows || []).map(w => WindowElement.fromJSON(w));
    f.doors = (data.doors || []).map(d => Door.fromJSON(d));
    f.balconies = (data.balconies || []).map(b => Balcony.fromJSON(b));
    f.elevator = data.elevator ? Elevator.fromJSON(data.elevator) : null;
    f.stairs = data.stairs ? Stairs.fromJSON(data.stairs) : null;
    f.floorHoles = (data.floorHoles || []).map(h => FloorHole.fromJSON(h));
    f.wallBevels = (data.wallBevels || []).map(b => WallBevel.fromJSON(b));
    return f;
  }
}
