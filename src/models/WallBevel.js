/**
 * Defines a sloped (bevelled) top cut for one external wall segment on a floor.
 *
 * The bevel covers the wall from `offsetStart` to `offsetEnd` (metres along the wall).
 * Outside that range the wall stands at the full floor height.
 *
 * Cross-section seen from the side (offsetStart=2, offsetEnd=6, wallLen=9):
 *
 *   ___________           ___________
 *  |           |         |           |
 *  |           |\       /|           |
 *  |           | \_____/ |           |
 *  |___________|_________|___________|
 *  0           2         6           9
 *
 * Fields:
 *   wallIndex    – index of the wall segment in the floor contour
 *   heightStart  – wall height at offsetStart (metres)
 *   heightEnd    – wall height at offsetEnd   (metres)
 *   offsetStart  – metres from wall start where the bevel begins (default 0 = wall start)
 *   offsetEnd    – metres from wall start where the bevel ends   (default null = wall end)
 */
export class WallBevel {
  /**
   * @param {number}      wallIndex
   * @param {number}      heightStart
   * @param {number}      heightEnd
   * @param {number}      [offsetStart=0]
   * @param {number|null} [offsetEnd=null]  null means "use the full wall length"
   */
  constructor(wallIndex, heightStart, heightEnd, offsetStart = 0, offsetEnd = null) {
    this.wallIndex   = wallIndex;
    this.heightStart = heightStart;
    this.heightEnd   = heightEnd;
    this.offsetStart = offsetStart;
    this.offsetEnd   = offsetEnd;   // null = wall end
  }

  toJSON() {
    return {
      wallIndex:   this.wallIndex,
      heightStart: this.heightStart,
      heightEnd:   this.heightEnd,
      offsetStart: this.offsetStart,
      offsetEnd:   this.offsetEnd,
    };
  }

  static fromJSON(data) {
    return new WallBevel(
      data.wallIndex,
      data.heightStart,
      data.heightEnd,
      data.offsetStart ?? 0,
      data.offsetEnd   ?? null,
    );
  }
}

