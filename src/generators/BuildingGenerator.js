import * as THREE from 'three';

// Stair geometry constants (all in metres)
const MAX_TREAD_DEPTH_M = 0.30;   // maximum depth of a single stair tread
const RISER_HEIGHT_M    = 0.17;   // nominal riser height used to compute step count

// Wall geometry constants
const MIN_WALL_HEIGHT           = 0.01;  // minimum allowed wall/bevel height (metres)
const OPENING_BOUNDARY_TOLERANCE = 0.05; // min clearance between an opening edge and wall end

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

      // Ceiling slab — cut holes defined on this floor
      this._addSlab(floorContour, floorBaseY + floor.height, floor.floorHoles, group);
    }
  }

  // ── Floor slabs ───────────────────────────────────────────────────────────
  _addSlab(contour, yTop, floorHoles, group) {
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

      // Resolve bevel parameters
      const bevel = floor.wallBevels.find(b => b.wallIndex === i);
      const hStart   = bevel ? Math.max(MIN_WALL_HEIGHT, bevel.heightStart)  : floorH;
      const hEnd     = bevel ? Math.max(MIN_WALL_HEIGHT, bevel.heightEnd)    : floorH;
      const offStart = bevel ? Math.max(0, bevel.offsetStart)                : 0;
      const offEnd   = bevel
        ? Math.min(wallLen, bevel.offsetEnd !== null ? bevel.offsetEnd : wallLen)
        : wallLen;

      // Build wall cross-section shape in local XY (X = along wall, Y = up).
      // The bevel "notch" only spans from offStart to offEnd;
      // outside that region the wall stands at full floorH.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(wallLen, 0);
      shape.lineTo(wallLen, floorH);
      if (bevel && offEnd < wallLen - 0.001) shape.lineTo(offEnd, floorH);
      if (bevel) {
        shape.lineTo(offEnd,   hEnd);
        shape.lineTo(offStart, hStart);
      }
      if (bevel && offStart > 0.001) shape.lineTo(offStart, floorH);
      shape.lineTo(0, floorH);
      shape.closePath();

      // Collect holes from windows/doors (clamp to local bevel height)
      shape.holes = this._getWallHolesForBevel(
        floor, i, hStart, hEnd, offStart, offEnd, wallLen, floorH
      );

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
    }
  }

  /** Get wall opening holes, clamped to the local top height at each x position. */
  _getWallHolesForBevel(floor, wallIndex, hStart, hEnd, offStart, offEnd, wallLen, floorH) {
    const holes = [];

    // Height of the wall top at a given x position
    const maxYAtX = (x) => {
      if (x <= offStart || x >= offEnd) return floorH;
      const t = (x - offStart) / (offEnd - offStart);
      return hStart + t * (hEnd - hStart);
    };

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
