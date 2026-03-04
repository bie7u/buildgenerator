# 3D Apartment Building Generator

A modular Three.js web application for designing apartment buildings in 2D floor-plan mode and generating fully accurate procedural 3D models.

## Features

- **2D Floor Plan Editor** — orthographic top-down view with a snap-to-0.1 m grid
- **Draw building contour** — click to place vertices, double-click or click near the first point to close the polygon
- **Vertex editing** — drag vertices to reshape the footprint
- **Per-floor elements** — internal walls, windows, doors, balconies, elevator shafts and staircases, each stored with absolute coordinates
- **Properties panel** — click any element to inspect and edit its parameters (width, height, offset, …); delete individual elements
- **3D generation** — one click converts the floor plan into a dimensionally accurate 3D model:
  - Extruded external walls with window and door holes (Three.js `Shape` + `ExtrudeGeometry`)
  - Internal wall boxes
  - Floor and ceiling slabs
  - Balcony slabs with railings
  - Elevator shaft geometry
  - Procedural stepped stairs
- **View modes** — toggle between 2D editor and 3D perspective preview with `OrbitControls`
- **glTF export** — save the generated model as `.gltf`

## Tech Stack

| Layer | Technology |
|---|---|
| 3D rendering | [Three.js r160](https://threejs.org/) |
| Camera controls | `OrbitControls` (Three.js addons) |
| Export | `GLTFExporter` (Three.js addons) |
| Module system | Native ES Modules via `<script type="importmap">` |
| UI | Plain HTML + CSS (no framework) |
| Units | Metric — 1 unit = 1 metre |

## Getting Started

Because the app uses ES Modules you must serve it over HTTP (not `file://`):

```bash
# Install Three.js (already in package.json)
npm install

# Serve with any static server, e.g.:
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080` (or the port shown) in a modern browser.

## Usage

1. Click **Draw Contour** and click on the canvas to place the building outline vertices.  
   Double-click (or click within 0.5 m of the first point) to close the polygon.
2. Use **Add Wall / Window / Door / Balcony / Elevator / Stairs** tools to populate each floor.  
   Click on an outer wall edge to attach elements; click anywhere inside for elevator / stairs.
3. Switch floors with the **Floor** selector in the toolbar; use **+/−** to add or remove floors.
4. Adjust **Wall Thickness** and **Floor Height** in the Building Settings panel.
5. Click **Generate 3D** to build the model and switch to the perspective view.
6. Orbit with left-drag, zoom with scroll, pan with right-drag.
7. Click **Export glTF** to download `building.gltf`.

## Project Structure

```
index.html                  ← Entry point with importmap
css/style.css               ← Dark UI theme
src/
  main.js                   ← App bootstrap & top-level actions
  SceneManager.js           ← Three.js renderer, cameras, OrbitControls
  GridSystem.js             ← Grid helper + snap utility
  models/
    Building.js             ← Building data class (contour, floors, settings)
    Floor.js                ← Per-floor data class
    Wall.js                 ← Internal wall data class
    WindowElement.js        ← Window data class
    Door.js                 ← Door data class
    Balcony.js              ← Balcony data class
    Elevator.js             ← Elevator shaft data class
    Stairs.js               ← Staircase data class
  editors/
    FloorPlanEditor.js      ← 2D editing: contour drawing, vertex drag, element placement
  generators/
    BuildingGenerator.js    ← Procedural 3D geometry from building data
  ui/
    UIManager.js            ← Toolbar, tool buttons, properties panel
```