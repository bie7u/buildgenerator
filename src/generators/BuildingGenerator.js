import * as THREE from 'three';

// Stair geometry constants (all in metres)
const MAX_TREAD_DEPTH_M = 0.30;   // maximum depth of a single stair tread
const RISER_HEIGHT_M    = 0.17;   // nominal riser height used to compute step count

// Wall geometry constants
const MIN_WALL_HEIGHT           = 0.01;  // minimum allowed wall/bevel height (metres)
const OPENING_BOUNDARY_TOLERANCE = 0.05; // min clearance between an opening edge and wall end
const MIN_BEVEL_SEGMENT_LEN     = 0.001; // minimum bevel length to prevent degenerate geometry

export class BuildingGenerator {
  constructor(sceneManager) {
    this.sm = sceneManager;

    // Materials
    this.wallMat = new THREE.MeshLambertMaterial({ color: 0xe8e8e0 });
    this.slabMat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0 });
    this.internalWallMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
    this.balconyMat = new THREE.MeshLambertMaterial({ color: 0xc0d0e0 });
    this.elevatorMat = new THREE.MeshLambertMaterial({ color: 0x809ab0 });
    this.stairsMat = new THREE.MeshLambertMaterial({ color: 0xb0a090 });
    this.windowMat = new THREE.MeshLambertMaterial({ color: 0x88bbff, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    this.doorFrameMat = new THREE.MeshLambertMaterial({ color: 0x996633 });
    this.railingMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    // Sloped ceiling panels — same tone as slab but double-sided so they are
    // visible from inside the room (looking upward at the sloped surface)
    this.ceilingBevelMat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0, side: THREE.DoubleSide });
  }

  /**
   * Generate 3D geometry for a collection of buildings.
   * Clears previous geometry first.
   */
  generateAll(buildings) {
    const group = this.sm.buildingGroup;
    while (group.children.length) {
      const child = group.children[0];
      this._disposeObject(child);
      group.remove(child);
    }
    for (const building of buildings) {
      if (building.contour.length >= 3) {
        this._generateBuilding(building, group);
      }
    }
  }

  /** @deprecated - use generateAll() */
  generate(building) {
    this.generateAll([building]);
  }

  _generateBuilding(building, group) {
    // Compute floor base Y positions
    let baseY = 0;
    const floorBases = [];
    for (const floor of building.floors) {
      floorBases.push(baseY);
      baseY += floor.height;
    }

    // Ground floor slab (bottom of building) — no floor holes
    this._addSlab(building.getFloorContour(0), 0, null, group);

    for (let fi = 0; fi < building.floors.length; fi++) {
      const floor = building.floors[fi];
      const floorBaseY = floorBases[fi];
      const floorContour = building.getFloorContour(fi);

      this._generateExternalWalls(floorContour, building.wallThickness, floor, floorBaseY, group);
      this._generateInternalWalls(building, floor, floorBaseY, group);
      this._generateWindowPanes(floorContour, floor, floorBaseY, group);
      this._generateBalconies(floorContour, floor, floorBaseY, group);
      this._generateElevator(floor, floorBaseY, group);
      this._generateStairs(floor, floorBaseY, group);

      // Ceiling slab — cut floor holes AND ceiling-bevel regions so the sloped
      // ceiling panel mesh replaces the flat slab in those areas.
      // Note: _computeBevelCuts (for WallBevels) is intentionally NOT called here
      // because WallBevel slab holes are degenerate (outer edge on contour boundary)
      // and would be silently ignored by Earcut, which can confuse diagnostics.
      // WallBevel wall trimming still works via _computeTopProfile; their inner-face
      // fill panels are generated in _generateExternalWalls.
      const ceilingBevelCuts = this._computeCeilingBevelCuts(floorContour, floor);
      this._addSlab(floorContour, floorBaseY + floor.height, floor.floorHoles, group, ceilingBevelCuts);

      // Sloped ceiling panels for every ceiling bevel on this floor
      this._generateCeilingBevelMeshes(floorContour, floor, floorBaseY, group);
    }
  }

  // ── Floor slabs ───────────────────────────────────────────────────────────
  _addSlab(contour, yTop, floorHoles, group, bevelCuts = []) {
    if (contour.length < 3) return;

    // Build the shape in the XY plane.
    // contour.y stores world-Z. rotateX(-PI/2) maps (x, y, z) → (x, z, -y),
    // so we negate contour.y here to cancel that negation and land on the
    // correct world-Z position after rotation.
    const shape = new THREE.Shape();
    shape.moveTo(contour[0].x, -contour[0].y);
    for (let i = 1; i < contour.length; i++) {
      shape.lineTo(contour[i].x, -contour[i].y);
    }
    shape.closePath();

    // Cut floor holes (polygon openings through the slab)
    if (floorHoles && floorHoles.length > 0) {
      for (const hole of floorHoles) {
        if (!hole.points || hole.points.length < 3) continue;
        const pts = hole.points;
        // In shape space: shape.y = -world_z
        const path = new THREE.Path();
        path.moveTo(pts[0].x, -pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          path.lineTo(pts[i].x, -pts[i].y);
        }
        path.closePath();
        shape.holes.push(path);
      }
    }

    // Cut bevel regions — the sloped wall top-face acts as the ceiling there
    for (const cut of bevelCuts) {
      shape.holes.push(cut);
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.slabMat);
    mesh.position.y = yTop;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }

  // ── External walls ────────────────────────────────────────────────────────
  _generateExternalWalls(contour, wallThick, floor, floorBaseY, group) {
    const n = contour.length;
    const floorH = floor.height;

    for (let i = 0; i < n; i++) {
      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];

      const dx = p2.x - p1.x;
      const dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;

      const ndx = dx / wallLen;
      const ndz = dz / wallLen;

      // All bevels for this wall segment, sorted by offsetStart
      const bevels = floor.wallBevels
        .filter(b => b.wallIndex === i)
        .sort((a, b) => a.offsetStart - b.offsetStart);

      // Build the piecewise top-profile for this wall, then cap it to any
      // ceiling bevels on the same segment so the wall automatically follows
      // the ceiling slope without requiring a separate manual wall bevel.
      const rawProfile    = this._computeTopProfile(bevels, wallLen, floorH);
      const ceilingConstr = (floor.ceilingBevels || []).filter(cb => cb.wallIndex === i);
      const topProfile    = ceilingConstr.length > 0
        ? this._capProfileToCeilingBevels(rawProfile, ceilingConstr, wallLen, floorH)
        : rawProfile;

      // Build wall cross-section shape in local XY (X = along wall, Y = up).
      // Bottom edge: left→right. Top edge: traverse profile right→left.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(wallLen, 0);
      for (let j = topProfile.length - 1; j >= 0; j--) {
        shape.lineTo(topProfile[j].x, topProfile[j].h);
      }
      shape.closePath();

      // Collect window/door holes, clamped to the top profile
      shape.holes = this._getWallHoles(floor, i, topProfile, wallLen, floorH);

      const geo = new THREE.ExtrudeGeometry(shape, { depth: wallThick, bevelEnabled: false });

      // Transform: local X → wall direction, local Y → up, local Z → inward normal
      const m = new THREE.Matrix4();
      m.set(
        ndx,  0,  ndz,  p1.x,
        0,    1,  0,    floorBaseY,
        ndz,  0, -ndx,  p1.y,
        0,    0,  0,    1
      );
      geo.applyMatrix4(m);

      const mesh = new THREE.Mesh(geo, this.wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      // ── Fill panels for legacy WallBevel regions ─────────────────────────────
      // When a WallBevel shortens the wall below floorH, the inner wall face
      // has a visible gap from hS to floorH.  Add a vertical quad panel at the
      // inner face to close the room so it is not see-through from inside.
      if (bevels.length > 0) {
        this._generateWallBevelFillPanels(bevels, wallLen, floorH, wallThick, p1, ndx, ndz, floorBaseY, group);
      }
    }
  }

  /**
   * For each WallBevel, create a vertical "fill" panel at the inner wall face
   * (wallThick inward from the outer face) covering the gap from the bevel
   * height up to floorH.  This prevents the room from being see-through above
   * the bevel region when the shortened wall no longer reaches the ceiling.
   */
  _generateWallBevelFillPanels(bevels, wallLen, floorH, wallThick, p1, ndx, ndz, floorBaseY, group) {
    for (const bv of bevels) {
      const oStart   = Math.max(0, Math.min(wallLen, bv.offsetStart));
      const rawOEnd  = bv.offsetEnd !== null ? bv.offsetEnd : wallLen;
      const oEnd     = Math.max(oStart + MIN_BEVEL_SEGMENT_LEN, Math.min(wallLen, rawOEnd));
      const hS       = Math.max(MIN_WALL_HEIGHT, Math.min(floorH, bv.heightStart));
      const hE       = Math.max(MIN_WALL_HEIGHT, Math.min(floorH, bv.heightEnd));

      // Skip if the bevel is already at full height (no gap to fill)
      if (hS >= floorH - MIN_BEVEL_SEGMENT_LEN && hE >= floorH - MIN_BEVEL_SEGMENT_LEN) continue;

      // Transform local wall-space coords to world space using the same wall matrix as
      // _generateExternalWalls:
      //   m = [ ndx  0  ndz  p1.x ]   (ndx,ndz) = wall direction unit vector
      //       [  0   1   0   fBy  ]   local Y → world Y (vertical)
      //       [ ndz  0 -ndx  p1.y ]   local Z → world inward-normal direction
      //       [  0   0   0    1   ]
      // So: world_x = ndx*lx + ndz*lz + p1.x
      //     world_y = ly + floorBaseY
      //     world_z = ndz*lx - ndx*lz + p1.y
      const wpos = (lx, ly, lz) => [
        ndx * lx + ndz * lz + p1.x,
        ly + floorBaseY,
        ndz * lx - ndx * lz + p1.y,
      ];

      // Four corners of the fill panel at z=wallThick:
      //   BL = (oStart, hS, wallThick)  — bottom-left (start, bevel height)
      //   BR = (oEnd,   hE, wallThick)  — bottom-right (end, bevel height)
      //   TR = (oEnd,   floorH, wallThick) — top-right (full height)
      //   TL = (oStart, floorH, wallThick) — top-left
      const [BLx, BLy, BLz] = wpos(oStart, hS,     wallThick);
      const [BRx, BRy, BRz] = wpos(oEnd,   hE,     wallThick);
      const [TRx, TRy, TRz] = wpos(oEnd,   floorH, wallThick);
      const [TLx, TLy, TLz] = wpos(oStart, floorH, wallThick);

      // Two triangles wound CCW when viewed from the room interior (inward-facing)
      const positions = new Float32Array([
        BLx, BLy, BLz,   BRx, BRy, BRz,   TRx, TRy, TRz,
        BLx, BLy, BLz,   TRx, TRy, TRz,   TLx, TLy, TLz,
      ]);

      const fillGeo = new THREE.BufferGeometry();
      fillGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      fillGeo.computeVertexNormals();

      const fillMesh = new THREE.Mesh(fillGeo, this.wallMat);
      fillMesh.castShadow    = true;
      fillMesh.receiveShadow = true;
      group.add(fillMesh);
    }
  }

  /**
   * Compute a piecewise-linear top-profile for a wall with zero or more bevels.
   * Returns an array of { x, h } sorted by x, from x=0 to x=wallLen.
   *
   * The profile contains vertical "snaps" (two consecutive points at the same x)
   * at bevel boundaries so the wall rises instantly back to floorH.
   * Between bevel regions the wall stands at floorH.
   */
  _computeTopProfile(bevels, wallLen, floorH) {
    if (bevels.length === 0) {
      return [{ x: 0, h: floorH }, { x: wallLen, h: floorH }];
    }

    const pts = [];
    let prevEnd = 0; // where the last bevel (or wall start) ended

    for (const bv of bevels) {
      const oStart = Math.max(0, Math.min(wallLen, bv.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, bv.offsetEnd !== null ? bv.offsetEnd : wallLen));
      const hS = Math.max(MIN_WALL_HEIGHT, bv.heightStart);
      const hE = Math.max(MIN_WALL_HEIGHT, bv.heightEnd);

      // Gap between previous end and this bevel start: wall stands at floorH
      if (oStart > prevEnd + 0.001) {
        if (prevEnd > 0.001) {
          // Snap back to floorH right at the end of the previous bevel
          pts.push({ x: prevEnd, h: floorH });
        } else {
          // No previous bevel: start of wall is at full height
          pts.push({ x: 0, h: floorH });
        }
        // Flat section at full height up to this bevel's start
        pts.push({ x: oStart, h: floorH });
      }

      // The bevel segment
      pts.push({ x: oStart, h: hS });
      pts.push({ x: oEnd,   h: hE });
      prevEnd = oEnd;
    }

    // Trailing full-height section after the last bevel (if any)
    if (prevEnd < wallLen - 0.001) {
      pts.push({ x: prevEnd,  h: floorH }); // instant snap back
      pts.push({ x: wallLen,  h: floorH });
    }

    return pts;
  }

  /** Interpolate the wall top-profile height at a given x. */
  _topProfileHeightAt(topProfile, x) {
    for (let i = 0; i < topProfile.length - 1; i++) {
      const a = topProfile[i], b = topProfile[i + 1];
      if (x >= a.x - 0.0001 && x <= b.x + 0.0001) {
        const span = b.x - a.x;
        if (span < 0.0001) return Math.min(a.h, b.h);
        return a.h + (b.h - a.h) * ((x - a.x) / span);
      }
    }
    return topProfile[topProfile.length - 1]?.h ?? 0;
  }

  /**
   * Return the constrained ceiling height at x, taking into account all given
   * ceiling bevels for this wall.  Outside every bevel's range the ceiling is
   * at floorH (unconstrained).  Inside a bevel's range the height is linearly
   * interpolated and clamped to [MIN_WALL_HEIGHT, floorH].  When multiple
   * bevels overlap at x the most restrictive (lowest) value is returned.
   */
  _ceilingHeightAt(ceilingBevels, wallLen, floorH, x) {
    let h = floorH;
    for (const cb of ceilingBevels) {
      const oStart = Math.max(0, Math.min(wallLen, cb.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, cb.offsetEnd !== null ? cb.offsetEnd : wallLen));
      if (x < oStart - 0.0001 || x > oEnd + 0.0001) continue;
      const span = oEnd - oStart;
      const t    = span > 0.0001 ? Math.max(0, Math.min(1, (x - oStart) / span)) : 0;
      const hCeil = Math.max(MIN_WALL_HEIGHT, cb.heightStart + (cb.heightEnd - cb.heightStart) * t);
      h = Math.min(h, hCeil);
    }
    return h;
  }

  /**
   * Given a piecewise top-profile (from _computeTopProfile) and a list of
   * ceiling bevels for the same wall, return a new profile where the wall
   * height is capped to the ceiling bevel height within each bevel's range.
   *
   * Vertical snaps (two consecutive profile points at the same x, one at the
   * previous height and one at the new height) are inserted at bevel boundaries
   * so the wall has a sharp vertical edge at each bevel start and end — matching
   * the same convention used by _computeTopProfile for WallBevels.
   *
   * Without snaps the profile would create a smoothly sloping exterior wall top
   * leading up to the bevel region, which is visually wrong.
   */
  _capProfileToCeilingBevels(topProfile, ceilingBevels, wallLen, floorH) {
    if (ceilingBevels.length === 0) return topProfile;

    // Tolerance for "same position" comparisons in profile point coordinates
    const EPS = 0.0001;

    // Sort ceiling bevels by offsetStart; clamp to wall length
    const sorted = ceilingBevels
      .map(cb => ({
        oS: Math.max(0, Math.min(wallLen, cb.offsetStart)),
        oE: Math.max(0, Math.min(wallLen, cb.offsetEnd !== null ? cb.offsetEnd : wallLen)),
        hS: Math.max(MIN_WALL_HEIGHT, Math.min(floorH, cb.heightStart)),
        hE: Math.max(MIN_WALL_HEIGHT, Math.min(floorH, cb.heightEnd)),
      }))
      .filter(cb => cb.oE > cb.oS + EPS)
      .sort((a, b) => a.oS - b.oS);

    if (sorted.length === 0) return topProfile;

    const result = [];
    let cursor = 0; // x-position covered so far

    for (const cb of sorted) {
      // ── Section before this bevel: copy wall profile at full height ──────────
      if (cb.oS > cursor + EPS) {
        // Emit profile points (from topProfile) in the range (cursor, cb.oS)
        if (result.length === 0) {
          result.push({ x: cursor, h: this._topProfileHeightAt(topProfile, cursor) });
        }
        for (const pt of topProfile) {
          if (pt.x > cursor + EPS && pt.x < cb.oS - EPS) {
            result.push({ x: pt.x, h: pt.h });
          }
        }
        // Arrive at bevel start at the wall profile height (vertical snap 1 of 2)
        result.push({ x: cb.oS, h: this._topProfileHeightAt(topProfile, cb.oS) });
      } else if (result.length === 0) {
        // Bevel starts right at the wall beginning (cursor === 0)
        // No full-height section needed, but make sure cursor is defined
      }

      // ── Vertical snap DOWN into bevel ─────────────────────────────────────────
      result.push({ x: cb.oS, h: cb.hS });

      // ── Bevel region (wall height follows bevel height) ───────────────────────
      result.push({ x: cb.oE, h: cb.hE });

      // ── Vertical snap UP out of bevel ─────────────────────────────────────────
      const hAfter = this._topProfileHeightAt(topProfile, cb.oE);
      result.push({ x: cb.oE, h: hAfter });

      cursor = cb.oE;
    }

    // ── Section after last bevel: copy wall profile ───────────────────────────
    if (cursor < wallLen - EPS) {
      for (const pt of topProfile) {
        if (pt.x > cursor + EPS && pt.x < wallLen - EPS) {
          result.push({ x: pt.x, h: pt.h });
        }
      }
      result.push({ x: wallLen, h: this._topProfileHeightAt(topProfile, wallLen) });
    } else if (result.length === 0 || result[result.length - 1].x < wallLen - EPS) {
      result.push({ x: wallLen, h: this._topProfileHeightAt(topProfile, wallLen) });
    }

    return result;
  }

  /** Get wall opening holes, clamped to the piecewise top profile. */
  _getWallHoles(floor, wallIndex, topProfile, wallLen, floorH) {
    const holes = [];

    const maxYAtX = (x) => this._topProfileHeightAt(topProfile, x);

    for (const win of floor.windows) {
      if (win.wallIndex !== wallIndex) continue;
      const x0 = win.offsetAlongWall;
      const x1 = x0 + win.width;
      const y0 = win.sillHeight;
      const y1 = y0 + win.height;
      if (x0 < OPENING_BOUNDARY_TOLERANCE || x1 > wallLen - OPENING_BOUNDARY_TOLERANCE) continue;
      const topLimit = Math.min(maxYAtX(x0), maxYAtX(x1));
      if (y1 > topLimit - OPENING_BOUNDARY_TOLERANCE) continue;
      const hole = new THREE.Path();
      hole.moveTo(x0, y0);
      hole.lineTo(x1, y0);
      hole.lineTo(x1, y1);
      hole.lineTo(x0, y1);
      hole.closePath();
      holes.push(hole);
    }

    for (const door of floor.doors) {
      if (door.wallIndex !== wallIndex) continue;
      const x0 = door.offsetAlongWall;
      const x1 = x0 + door.width;
      const y1 = door.height;
      if (x0 < OPENING_BOUNDARY_TOLERANCE || x1 > wallLen - OPENING_BOUNDARY_TOLERANCE) continue;
      const topLimit = Math.min(maxYAtX(x0), maxYAtX(x1));
      if (y1 > topLimit - OPENING_BOUNDARY_TOLERANCE) continue;
      const hole = new THREE.Path();
      hole.moveTo(x0, 0.0);
      hole.lineTo(x1, 0.0);
      hole.lineTo(x1, y1);
      hole.lineTo(x0, y1);
      hole.closePath();
      holes.push(hole);
    }

    return holes;
  }

  /**
   * For each bevel on this floor, compute a rectangular hole in the slab
   * shape-space so the sloped wall top-face (already in the extrusion cap)
   * becomes visible as the ceiling in the bevel region.
   *
   * Slab shape-space: shape_x = world_x, shape_y = -world_z
   * Inward normal in world XZ: (ndz, 0, -ndx)  →  shape (ndz, ndx)
   */
  _computeBevelCuts(contour, floor, wallThick) {
    const cuts = [];
    const n = contour.length;

    for (const bevel of floor.wallBevels) {
      const i = bevel.wallIndex;
      if (i >= n) continue;

      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;

      const ndx = dx / wallLen, ndz = dz / wallLen;

      const oStart = Math.max(0, Math.min(wallLen, bevel.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, bevel.offsetEnd !== null ? bevel.offsetEnd : wallLen));

      // Four corners in slab shape-space (outer face → inward by wallThick)
      // A = outer at oStart, B = outer at oEnd, C = inner at oEnd, D = inner at oStart
      const ax = p1.x + oStart * ndx,        ay = -(p1.y + oStart * ndz);
      const bx = p1.x + oEnd   * ndx,        by = -(p1.y + oEnd   * ndz);
      const cx = bx + ndz * wallThick,        cy = by + ndx * wallThick;
      const ddx = ax + ndz * wallThick,       ddy = ay + ndx * wallThick;

      const path = new THREE.Path();
      path.moveTo(ax,  ay);
      path.lineTo(ddx, ddy);  // inward at start
      path.lineTo(cx,  cy);   // inward at end
      path.lineTo(bx,  by);   // outer at end
      path.closePath();
      cuts.push(path);
    }

    return cuts;
  }

  /**
   * For each CeilingBevel on this floor, compute a rectangular hole in the slab
   * shape-space so the sloped ceiling panel mesh replaces the flat slab there.
   *
   * The hole is inset by a tiny epsilon (not wallThick) from the outer wall face
   * so it starts almost exactly where the sloped panel starts.  Using a large
   * inset (wallThick=0.2 m) would leave a wide strip of uncut flat ceiling at
   * the inner wall face, creating a very visible step/ledge on the ceiling.
   *
   * A non-zero inset is still required: a hole whose outer edge exactly
   * coincides with the outer polygon boundary is degenerate and silently
   * ignored by the Earcut triangulator, leaving the flat slab visible.
   *
   * @param {Array}  contour   - floor contour (CCW-on-screen, as normalised by Building)
   * @param {object} floor     - floor object with ceilingBevels[]
   */
  _computeCeilingBevelCuts(contour, floor) {
    // Tiny inset so the hole is strictly inside the outer polygon (not degenerate)
    const HOLE_INSET = 0.002;
    const cuts = [];
    const n = contour.length;

    for (const cb of (floor.ceilingBevels || [])) {
      const i = cb.wallIndex;
      if (i >= n) continue;

      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;

      const ndx = dx / wallLen, ndz = dz / wallLen;

      const oStart = Math.max(0, Math.min(wallLen, cb.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, cb.offsetEnd !== null ? cb.offsetEnd : wallLen));
      const depth  = Math.max(0.1, cb.depth);

      // Hole spans from HOLE_INSET to depth inward from outer wall face.
      // Slab shape-space inward direction: (+ndz, +ndx).
      const innerSpan = depth - HOLE_INSET;
      if (innerSpan <= 0) continue;

      // Outer edge: HOLE_INSET inward from the outer wall face
      const ax = p1.x + oStart * ndx + ndz * HOLE_INSET,   ay = -(p1.y + oStart * ndz) + ndx * HOLE_INSET;
      const bx = p1.x + oEnd   * ndx + ndz * HOLE_INSET,   by = -(p1.y + oEnd   * ndz) + ndx * HOLE_INSET;
      // Inner edge: depth inward from outer face = innerSpan further from ax/bx
      const cx = bx + ndz * innerSpan,   cy = by + ndx * innerSpan;
      const Dx = ax + ndz * innerSpan,   Dy = ay + ndx * innerSpan;

      const path = new THREE.Path();
      path.moveTo(ax, ay);
      path.lineTo(Dx, Dy);  // inward at start
      path.lineTo(cx, cy);  // inward at end
      path.lineTo(bx, by);  // outer at end
      path.closePath();
      cuts.push(path);
    }

    return cuts;
  }

  /**
   * For each CeilingBevel on this floor, create a sloped quad mesh that fills
   * the hole cut by _computeCeilingBevelCuts.
   *
   * The quad spans from the outer wall face (at heights heightStart/heightEnd)
   * to `depth` metres into the room (at full floor height), creating a sloped
   * ceiling that is visible from inside the room when looking upward.
   *
   * The inner edge is placed 1 mm below the flat slab bottom to avoid
   * z-fighting at the flat/sloped transition.
   *
   * Vertex winding: CCW when viewed from below (inside room looking up) so that
   * the face normal points downward and is lit correctly.
   *
   * World-space inward normal from wall direction (ndx, ndz):
   *   Δworld_x = +ndz * depth
   *   Δworld_z = -ndx * depth
   */
  _generateCeilingBevelMeshes(contour, floor, baseY, group) {
    const n = contour.length;
    const floorH = floor.height;

    for (const cb of (floor.ceilingBevels || [])) {
      const i = cb.wallIndex;
      if (i >= n) continue;

      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;

      const ndx = dx / wallLen, ndz = dz / wallLen;

      const oStart = Math.max(0, Math.min(wallLen, cb.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, cb.offsetEnd !== null ? cb.offsetEnd : wallLen));
      const hS     = Math.max(MIN_WALL_HEIGHT, Math.min(floorH, cb.heightStart));
      const hE     = Math.max(MIN_WALL_HEIGHT, Math.min(floorH, cb.heightEnd));
      const depth  = Math.max(0.1, cb.depth);

      // 4 world-space corners of the sloped ceiling panel:
      //   A = outer-start  (at wall face, bevel ceiling height)
      //   B = outer-end
      //   C = inner-end    (depth into room, 1 mm below full floor height to
      //                     avoid z-fighting with the coplanar slab bottom face)
      //   D = inner-start
      const Z_FIGHT_OFFSET = 0.001;
      const Ax = p1.x + oStart * ndx,   Ay = baseY + hS,                       Az = p1.y + oStart * ndz;
      const Bx = p1.x + oEnd   * ndx,   By = baseY + hE,                       Bz = p1.y + oEnd   * ndz;
      const Cx = Bx + ndz * depth,      Cy = baseY + floorH - Z_FIGHT_OFFSET,  Cz = Bz - ndx * depth;
      const Dx = Ax + ndz * depth,      Dy = baseY + floorH - Z_FIGHT_OFFSET,  Dz = Az - ndx * depth;

      // Two triangles, wound CCW when viewed from below (face normal points down,
      // toward the viewer standing inside the room looking up).
      // Triangle 1: A-C-B  (cross-product gives downward normal for a flat panel)
      // Triangle 2: A-D-C
      const positions = new Float32Array([
        Ax, Ay, Az,   Cx, Cy, Cz,   Bx, By, Bz,
        Ax, Ay, Az,   Dx, Dy, Dz,   Cx, Cy, Cz,
      ]);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, this.ceilingBevelMat);
      mesh.castShadow  = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ── Internal walls ────────────────────────────────────────────────────────
  _generateInternalWalls(building, floor, floorBaseY, group) {
    for (const wall of floor.internalWalls) {
      const dx = wall.end.x - wall.start.x;
      const dz = wall.end.y - wall.start.y;
      const wallLen = wall.length;
      if (wallLen < 0.01) continue;

      const angle = Math.atan2(dz, dx);

      const geo = new THREE.BoxGeometry(wallLen, floor.height, wall.thickness);
      const mesh = new THREE.Mesh(geo, this.internalWallMat);

      const mx = (wall.start.x + wall.end.x) / 2;
      const mz = (wall.start.y + wall.end.y) / 2;
      mesh.position.set(mx, floorBaseY + floor.height / 2, mz);
      mesh.rotation.y = -angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ── Window panes ──────────────────────────────────────────────────────────
  _generateWindowPanes(contour, floor, floorBaseY, group) {
    const n = contour.length;

    for (const win of floor.windows) {
      if (win.wallIndex >= n) continue;
      const p1 = contour[win.wallIndex];
      const p2 = contour[(win.wallIndex + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;
      const ndx = dx / wallLen, ndz = dz / wallLen;

      // World position of window center
      const centerOffset = win.offsetAlongWall + win.width / 2;
      const cx = p1.x + ndx * centerOffset;
      const cz = p1.y + ndz * centerOffset;
      const cy = floorBaseY + win.sillHeight + win.height / 2;

      const geo = new THREE.PlaneGeometry(win.width, win.height);
      const mesh = new THREE.Mesh(geo, this.windowMat);
      mesh.position.set(cx, cy, cz);
      const wallAngle = Math.atan2(ndz, ndx);
      mesh.rotation.y = -wallAngle;
      group.add(mesh);
    }
  }

  // ── Balconies ─────────────────────────────────────────────────────────────
  _generateBalconies(contour, floor, floorBaseY, group) {
    const n = contour.length;

    for (const bal of floor.balconies) {
      if (bal.wallIndex >= n) continue;
      const p1 = contour[bal.wallIndex];
      const p2 = contour[(bal.wallIndex + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;
      const ndx = dx / wallLen, ndz = dz / wallLen;

      // Outward normal (left perp for CCW-on-screen): (-ndz, 0, ndx)
      const ox = -ndz, oz = ndx;

      // Center of balcony slab
      const midWall = bal.offsetAlongWall + bal.width / 2;
      const cx = p1.x + ndx * midWall + ox * bal.depth / 2;
      const cz = p1.y + ndz * midWall + oz * bal.depth / 2;
      const cy = floorBaseY; // Floor level

      // Balcony slab
      const slabGeo = new THREE.BoxGeometry(bal.width, 0.12, bal.depth);
      const slab = new THREE.Mesh(slabGeo, this.balconyMat);
      slab.position.set(cx, cy + 0.06, cz);
      const wallAngle = Math.atan2(ndz, ndx);
      slab.rotation.y = -wallAngle;
      slab.castShadow = true;
      slab.receiveShadow = true;
      group.add(slab);

      // Railing posts and top rail
      this._addBalconyRailing(cx, cy, cz, bal.width, bal.depth, wallAngle, group);
    }
  }

  _addBalconyRailing(cx, cy, cz, width, depth, wallAngle, group) {
    const railH = 1.0;
    const postThick = 0.05;
    const railY = cy + railH;

    // Helper to create a post
    const addPost = (lx, lz) => {
      const geo = new THREE.BoxGeometry(postThick, railH, postThick);
      const mesh = new THREE.Mesh(geo, this.railingMat);
      // Rotate local offset
      const cos = Math.cos(-wallAngle), sin = Math.sin(-wallAngle);
      const wx = lx * cos - lz * sin + cx;
      const wz = lx * sin + lz * cos + cz;
      mesh.position.set(wx, cy + railH / 2, wz);
      group.add(mesh);
    };

    const hw = width / 2, hd = depth / 2;
    // Front corners
    addPost(-hw, hd);
    addPost(hw, hd);
    // Side corners
    addPost(-hw, -hd);
    addPost(hw, -hd);

    // Top rail (front)
    const frontRailGeo = new THREE.BoxGeometry(width, postThick, postThick);
    const frontRail = new THREE.Mesh(frontRailGeo, this.railingMat);
    const cos = Math.cos(-wallAngle), sin = Math.sin(-wallAngle);
    const frx = 0 * cos - hd * sin + cx;
    const frz = 0 * sin + hd * cos + cz;
    frontRail.position.set(frx, railY, frz);
    frontRail.rotation.y = -wallAngle;
    group.add(frontRail);

    // Side rails
    for (const side of [-1, 1]) {
      const sideRailGeo = new THREE.BoxGeometry(postThick, postThick, depth);
      const sideRail = new THREE.Mesh(sideRailGeo, this.railingMat);
      const sx = side * hw * cos - 0 * sin + cx;
      const sz = side * hw * sin + 0 * cos + cz;
      sideRail.position.set(sx, railY, sz);
      sideRail.rotation.y = -wallAngle;
      group.add(sideRail);
    }
  }

  // ── Elevator shaft ────────────────────────────────────────────────────────
  _generateElevator(floor, floorBaseY, group) {
    if (!floor.elevator) return;
    const ev = floor.elevator;
    const cx = ev.position.x, cz = ev.position.y;
    const ew = ev.width, ed = ev.depth;
    const h = floor.height + 0.15;
    const t = 0.08; // wall thickness

    // 4 walls of elevator shaft
    const panels = [
      { pos: [cx, floorBaseY + h / 2, cz - ed / 2], size: [ew + t * 2, h, t] },
      { pos: [cx, floorBaseY + h / 2, cz + ed / 2], size: [ew + t * 2, h, t] },
      { pos: [cx - ew / 2, floorBaseY + h / 2, cz], size: [t, h, ed] },
      { pos: [cx + ew / 2, floorBaseY + h / 2, cz], size: [t, h, ed] },
    ];

    for (const p of panels) {
      const geo = new THREE.BoxGeometry(...p.size);
      const mesh = new THREE.Mesh(geo, this.elevatorMat);
      mesh.position.set(...p.pos);
      mesh.castShadow = true;
      group.add(mesh);
    }

    // Bottom and top slabs
    const botGeo = new THREE.BoxGeometry(ew, 0.1, ed);
    const botMesh = new THREE.Mesh(botGeo, this.elevatorMat);
    botMesh.position.set(cx, floorBaseY + 0.05, cz);
    group.add(botMesh);

    const topGeo = new THREE.BoxGeometry(ew, 0.1, ed);
    const topMesh = new THREE.Mesh(topGeo, this.elevatorMat);
    topMesh.position.set(cx, floorBaseY + h, cz);
    group.add(topMesh);
  }

  // ── Stairs ────────────────────────────────────────────────────────────────
  _generateStairs(floor, floorBaseY, group) {
    if (!floor.stairs) return;
    const stairs = floor.stairs;
    const px = stairs.position.x, pz = stairs.position.y;
    const w = stairs.width;
    const runLen = stairs.runLength;
    const floorH = floor.height;

    const numSteps = Math.max(3, Math.round(floorH / RISER_HEIGHT_M));
    const riserH = floorH / numSteps;
    const treadD = Math.min(runLen / numSteps, MAX_TREAD_DEPTH_M);

    const dirMap = {
      north: 0,
      south: Math.PI,
      east: Math.PI / 2,
      west: -Math.PI / 2
    };
    const rotY = dirMap[stairs.direction] || 0;

    for (let i = 0; i < numSteps; i++) {
      const stepH = riserH * (i + 1);
      const stepGeo = new THREE.BoxGeometry(w, stepH, treadD);
      const mesh = new THREE.Mesh(stepGeo, this.stairsMat);

      // Local position: step i is at tread i, centered
      const localX = 0;
      const localY = stepH / 2;
      const localZ = i * treadD + treadD / 2;

      // Apply direction rotation around stairs origin
      const cos = Math.cos(rotY), sin = Math.sin(rotY);
      const wx = localX * cos - localZ * sin + px;
      const wz = localX * sin + localZ * cos + pz;

      mesh.position.set(wx, floorBaseY + localY, wz);
      mesh.rotation.y = rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Side walls of stairwell
    const sideH = floorH;
    const sideLen = treadD * numSteps;
    for (const side of [-1, 1]) {
      const geo = new THREE.BoxGeometry(0.05, sideH * 0.6, sideLen);
      const mesh = new THREE.Mesh(geo, this.railingMat);
      const localX = side * (w / 2 + 0.025);
      const localZ = sideLen / 2;
      const cos = Math.cos(rotY), sin = Math.sin(rotY);
      const wx = localX * cos - localZ * sin + px;
      const wz = localX * sin + localZ * cos + pz;
      mesh.position.set(wx, floorBaseY + sideH * 0.3, wz);
      mesh.rotation.y = rotY;
      group.add(mesh);
    }
  }

  // ── Disposal ──────────────────────────────────────────────────────────────
  _disposeObject(obj) {
    obj.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
  }
}
