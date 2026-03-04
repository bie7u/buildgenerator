export class Balcony {
  constructor(wallIndex, offsetAlongWall, width = 2.0, depth = 1.2) {
    this.wallIndex = wallIndex;
    this.offsetAlongWall = offsetAlongWall;
    this.width = width;
    this.depth = depth;
  }

  toJSON() {
    return {
      wallIndex: this.wallIndex,
      offsetAlongWall: this.offsetAlongWall,
      width: this.width,
      depth: this.depth
    };
  }

  static fromJSON(d) {
    return new Balcony(d.wallIndex, d.offsetAlongWall, d.width, d.depth);
  }
}
