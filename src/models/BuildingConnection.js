/**
 * Represents a physical connection (corridor, bridge, stairwell, etc.)
 * between two buildings in the scene.
 *
 * Fields:
 *   buildingIndexA – index of the first building in app.buildings[]
 *   buildingIndexB – index of the second building in app.buildings[]
 *   type           – connection type: 'corridor' | 'bridge' | 'stairs' | 'passage'
 *   label          – optional user-supplied description
 */
export class BuildingConnection {
  constructor(buildingIndexA, buildingIndexB, type = 'corridor', label = '') {
    this.buildingIndexA = buildingIndexA;
    this.buildingIndexB = buildingIndexB;
    this.type  = type;
    this.label = label;
  }

  toJSON() {
    return {
      buildingIndexA: this.buildingIndexA,
      buildingIndexB: this.buildingIndexB,
      type:  this.type,
      label: this.label,
    };
  }

  static fromJSON(data) {
    return new BuildingConnection(
      data.buildingIndexA,
      data.buildingIndexB,
      data.type  ?? 'corridor',
      data.label ?? '',
    );
  }
}
