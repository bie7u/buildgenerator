/**
 * Defines a sloped (bevelled) top cut for one external wall segment on a floor.
 *
 * The wall runs from vertex `wallIndex` to vertex `(wallIndex+1) % n`.
 * In the side elevation the wall is a trapezoid:
 *   bottom left  = (0, 0)
 *   bottom right = (wallLen, 0)
 *   top left     = (0, heightStart)
 *   top right    = (wallLen, heightEnd)
 *
 * Heights are in metres and must be > 0.
 */
export class WallBevel {
  /**
   * @param {number} wallIndex      – index of the wall segment in the floor contour
   * @param {number} heightStart    – wall height at the start vertex (left in elevation)
   * @param {number} heightEnd      – wall height at the end vertex (right in elevation)
   */
  constructor(wallIndex, heightStart, heightEnd) {
    this.wallIndex   = wallIndex;
    this.heightStart = heightStart;
    this.heightEnd   = heightEnd;
  }

  toJSON() {
    return {
      wallIndex:   this.wallIndex,
      heightStart: this.heightStart,
      heightEnd:   this.heightEnd,
    };
  }

  static fromJSON(data) {
    return new WallBevel(data.wallIndex, data.heightStart, data.heightEnd);
  }
}
