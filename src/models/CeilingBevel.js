/**
 * Defines a sloped (bevelled) ceiling panel for one external wall segment on a floor.
 *
 * The ceiling bevel spans from offsetStart to offsetEnd along the wall,
 * creating a sloped ceiling surface that extends `depth` metres into the room.
 *
 * At the outer wall face the ceiling height varies linearly from
 * heightStart (at offsetStart) to heightEnd (at offsetEnd).
 * At `depth` metres inward the ceiling is at the full floor height.
 *
 * Cross-section seen from the side (floorH = 2.7, hStart = 1.8, hEnd = 1.8):
 *
 *   floorH ────────────────────────────
 *          |        ╲           ╱      |
 *          |  ────────╲───────╱────    |
 *          |  hStart            hEnd   |
 *          |                          |
 *   0      ────────────────────────────
 *               offStart    offEnd
 *
 * Fields:
 *   wallIndex    – index of the wall segment in the floor contour
 *   heightStart  – ceiling height at offsetStart (metres from floor base)
 *   heightEnd    – ceiling height at offsetEnd
 *   offsetStart  – metres from wall start where the bevel begins (default 0)
 *   offsetEnd    – metres from wall start where the bevel ends (null = wall end)
 *   depth        – how far into the room the sloped ceiling extends (metres, default 2.0)
 */
export class CeilingBevel {
  /**
   * @param {number}      wallIndex
   * @param {number}      heightStart
   * @param {number}      heightEnd
   * @param {number}      [offsetStart=0]
   * @param {number|null} [offsetEnd=null]   null means "use the full wall length"
   * @param {number}      [depth=2.0]
   */
  constructor(wallIndex, heightStart, heightEnd, offsetStart = 0, offsetEnd = null, depth = 2.0) {
    this.wallIndex   = wallIndex;
    this.heightStart = heightStart;
    this.heightEnd   = heightEnd;
    this.offsetStart = offsetStart;
    this.offsetEnd   = offsetEnd;   // null = wall end
    this.depth       = depth;
  }

  toJSON() {
    return {
      wallIndex:   this.wallIndex,
      heightStart: this.heightStart,
      heightEnd:   this.heightEnd,
      offsetStart: this.offsetStart,
      offsetEnd:   this.offsetEnd,
      depth:       this.depth,
    };
  }

  static fromJSON(data) {
    return new CeilingBevel(
      data.wallIndex,
      data.heightStart,
      data.heightEnd,
      data.offsetStart ?? 0,
      data.offsetEnd   ?? null,
      data.depth       ?? 2.0,
    );
  }
}
