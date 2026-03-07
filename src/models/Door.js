export class Door {
  constructor(wallIndex, offsetAlongWall, width = 0.9, height = 2.1, openingDirection = 'in') {
    this.wallIndex = wallIndex;
    this.offsetAlongWall = offsetAlongWall;
    this.width = width;
    this.height = height;
    this.openingDirection = openingDirection;
  }

  toJSON() {
    return {
      wallIndex: this.wallIndex,
      offsetAlongWall: this.offsetAlongWall,
      width: this.width,
      height: this.height,
      openingDirection: this.openingDirection
    };
  }

  static fromJSON(d) {
    return new Door(d.wallIndex, d.offsetAlongWall, d.width, d.height, d.openingDirection);
  }
}
