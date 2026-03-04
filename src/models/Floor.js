import { Wall } from './Wall.js';
import { WindowElement } from './WindowElement.js';
import { Door } from './Door.js';
import { Balcony } from './Balcony.js';
import { Elevator } from './Elevator.js';
import { Stairs } from './Stairs.js';

export class Floor {
  constructor(index, height = 2.7) {
    this.index = index;
    this.height = height;
    this.internalWalls = [];   // Wall[]
    this.windows = [];         // WindowElement[]
    this.doors = [];           // Door[]
    this.balconies = [];       // Balcony[]
    this.elevator = null;      // Elevator | null
    this.stairs = null;        // Stairs | null
  }

  toJSON() {
    return {
      index: this.index,
      height: this.height,
      internalWalls: this.internalWalls.map(w => w.toJSON()),
      windows: this.windows.map(w => w.toJSON()),
      doors: this.doors.map(d => d.toJSON()),
      balconies: this.balconies.map(b => b.toJSON()),
      elevator: this.elevator ? this.elevator.toJSON() : null,
      stairs: this.stairs ? this.stairs.toJSON() : null,
    };
  }

  static fromJSON(data, index) {
    const f = new Floor(index, data.height);
    f.internalWalls = (data.internalWalls || []).map(w => Wall.fromJSON(w));
    f.windows = (data.windows || []).map(w => WindowElement.fromJSON(w));
    f.doors = (data.doors || []).map(d => Door.fromJSON(d));
    f.balconies = (data.balconies || []).map(b => Balcony.fromJSON(b));
    f.elevator = data.elevator ? Elevator.fromJSON(data.elevator) : null;
    f.stairs = data.stairs ? Stairs.fromJSON(data.stairs) : null;
    return f;
  }
}
