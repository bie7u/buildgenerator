export class WindowElement {
  constructor(wallIndex, offsetAlongWall, width = 1.2, height = 1.2, sillHeight = 0.9) {
    this.wallIndex = wallIndex;
    this.offsetAlongWall = offsetAlongWall;
    this.width = width;
    this.height = height;
    this.sillHeight = sillHeight;
  }

  toJSON() {
    return {
      wallIndex: this.wallIndex,
      offsetAlongWall: this.offsetAlongWall,
      width: this.width,
      height: this.height,
      sillHeight: this.sillHeight
    };
  }

  static fromJSON(d) {
    return new WindowElement(d.wallIndex, d.offsetAlongWall, d.width, d.height, d.sillHeight);
  }
}
