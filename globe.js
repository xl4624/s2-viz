import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

const GLOBE_RADIUS = 1.0;

// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// Globe - procedurally textured from Natural Earth 110m country GeoJSON.
// We draw ocean + land + country borders to a 2D canvas in equirectangular
// projection, then use it as a THREE texture. Crisp at any zoom and fully
// styleable via COLORS below.
const TEX_W = 4096;
const TEX_H = 2048;
const COLORS = {
  ocean: "#c6d9ea",
  land: "#ffffff",
  border: "#7a92b0",
};
const texCanvas = document.createElement("canvas");
texCanvas.width = TEX_W;
texCanvas.height = TEX_H;
const tctx = texCanvas.getContext("2d");
tctx.fillStyle = COLORS.ocean;
tctx.fillRect(0, 0, TEX_W, TEX_H);

const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
const globeTex = new THREE.CanvasTexture(texCanvas);
// Three.js sphere UV runs opposite to geographic longitude; flip horizontally.
globeTex.wrapS = THREE.RepeatWrapping;
globeTex.repeat.x = -1;
globeTex.offset.x = 1;
globeTex.anisotropy = 8;
const globeMat = new THREE.MeshBasicMaterial({ map: globeTex });
const globe = new THREE.Mesh(globeGeo, globeMat);
scene.add(globe);

// Equirectangular projection: lng in [-180,180], lat in [-90,90] -> pixel coords.
function project(lng, lat) {
  return [((lng + 180) / 360) * TEX_W, ((90 - lat) / 180) * TEX_H];
}

// Draw a polygon ring. Splits at antimeridian crossings.
function drawRing(ctx, ring, { fill, stroke, lineWidth }) {
  const segs = [[]];
  for (let i = 0; i < ring.length; i++) {
    const [lng, lat] = ring[i];
    if (i > 0 && Math.abs(lng - ring[i - 1][0]) > 180) segs.push([]);
    segs[segs.length - 1].push([lng, lat]);
  }
  for (const seg of segs) {
    if (seg.length < 2) continue;
    ctx.beginPath();
    const [sx, sy] = project(seg[0][0], seg[0][1]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < seg.length; i++) {
      const [x, y] = project(seg[i][0], seg[i][1]);
      ctx.lineTo(x, y);
    }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }
}

fetch("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson")
  .then((r) => r.json())
  .then((geo) => {
    // Fill land first.
    for (const feat of geo.features) {
      const g = feat.geometry;
      if (!g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates]
                  : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) {
        for (const ring of poly) drawRing(tctx, ring, { fill: COLORS.land });
      }
    }
    // Strokes on top so they aren't covered by neighbouring fills.
    for (const feat of geo.features) {
      const g = feat.geometry;
      if (!g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates]
                  : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) {
        for (const ring of poly) {
          drawRing(tctx, ring, { stroke: COLORS.border, lineWidth: 1.5 });
        }
      }
    }
    globeTex.needsUpdate = true;
    console.log("Globe texture painted from GeoJSON");
  })
  .catch((err) => console.warn("GeoJSON load failed:", err));

// Grid lines (lat/lng)
const gridMat = new THREE.LineBasicMaterial({ color: 0x333355, transparent: true, opacity: 0.3 });
for (let lat = -80; lat <= 80; lat += 20) {
  const pts = [];
  const r = Math.cos(lat * Math.PI / 180) * GLOBE_RADIUS * 1.001;
  const y = Math.sin(lat * Math.PI / 180) * GLOBE_RADIUS * 1.001;
  for (let lng = 0; lng <= 360; lng += 2) {
    const rad = lng * Math.PI / 180;
    pts.push(new THREE.Vector3(r * Math.cos(rad), y, r * Math.sin(rad)));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  scene.add(new THREE.Line(geo, gridMat));
}
for (let lng = 0; lng < 360; lng += 30) {
  const pts = [];
  const rad = lng * Math.PI / 180;
  for (let lat = -90; lat <= 90; lat += 2) {
    const latr = lat * Math.PI / 180;
    const r = Math.cos(latr) * GLOBE_RADIUS * 1.001;
    const y = Math.sin(latr) * GLOBE_RADIUS * 1.001;
    pts.push(new THREE.Vector3(r * Math.cos(rad), y, r * Math.sin(rad)));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  scene.add(new THREE.Line(geo, gridMat));
}

// S2 cell overlay group
const cellGroup = new THREE.Group();
scene.add(cellGroup);

// Picked cell overlay (separate from coverer results)
const pickGroup = new THREE.Group();
scene.add(pickGroup);

// Selection cap overlay
let selectionMesh = null;

// Camera controls (simple orbit)
let isDragging = false;
let isRightDrag = false;
let prevMouse = { x: 0, y: 0 };
let spherical = { theta: 0, phi: Math.PI / 2, r: 3 };

function updateCamera() {
  const st = Math.sin(spherical.theta), ct = Math.cos(spherical.theta);
  const sp = Math.sin(spherical.phi), cp = Math.cos(spherical.phi);
  camera.position.set(
    spherical.r * sp * ct,
    spherical.r * cp,
    spherical.r * sp * st,
  );
  camera.lookAt(0, 0, 0);
}
updateCamera();

const canvas = renderer.domElement;

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 2 || e.button === 1) {
    isRightDrag = true;
  } else if (e.shiftKey) {
    if (window._s2viz_on_pick) window._s2viz_on_pick(e.clientX, e.clientY);
  } else {
    // Left-button: start a selection. Place the center now.
    isDragging = true;
    if (window._s2viz_on_select_start) {
      window._s2viz_on_select_start(e.clientX, e.clientY);
    }
  }
  prevMouse = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener("mousemove", (e) => {
  if (isRightDrag) {
    const dx = e.clientX - prevMouse.x;
    const dy = e.clientY - prevMouse.y;
    spherical.theta -= dx * 0.005;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - dy * 0.005));
    updateCamera();
    prevMouse = { x: e.clientX, y: e.clientY };
  } else if (isDragging && window._s2viz_on_select_move) {
    window._s2viz_on_select_move(e.clientX, e.clientY);
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (isRightDrag) {
    isRightDrag = false;
  } else if (isDragging) {
    isDragging = false;
    if (window._s2viz_on_select_end) window._s2viz_on_select_end();
  }
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  spherical.r = Math.max(1.2, Math.min(10, spherical.r + e.deltaY * 0.002));
  updateCamera();
}, { passive: false });

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Raycast from screen coords to globe surface, returns [x, y, z] or null
window._s2viz_raycast = function(screenX, screenY) {
  const ndc = new THREE.Vector2(
    (screenX / window.innerWidth) * 2 - 1,
    -(screenY / window.innerHeight) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(globe);
  if (hits.length === 0) return null;
  const p = hits[0].point;
  const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  return [p.x / len, p.y / len, p.z / len];
};

// Clear all S2 cell overlays
window._s2viz_clear_cells = function() {
  while (cellGroup.children.length > 0) {
    const c = cellGroup.children[0];
    cellGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
};

// Add a single S2 cell as a polygon outline on the sphere.
// vertices: flat array [x0,y0,z0, x1,y1,z1, ...] of boundary points on unit sphere
window._s2viz_add_cell = function(vertices, _fillColor, lineColor) {
  const r = GLOBE_RADIUS * 1.002;
  const pts = [];
  for (let i = 0; i < vertices.length; i += 3) {
    pts.push(new THREE.Vector3(vertices[i] * r, vertices[i+1] * r, vertices[i+2] * r));
  }
  if (pts.length > 0) pts.push(pts[0].clone());
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const lineMat = new THREE.LineBasicMaterial({ color: lineColor || 0x44aaff });
  cellGroup.add(new THREE.Line(lineGeo, lineMat));
};

// Clear picked-cell overlay
window._s2viz_clear_pick = function() {
  while (pickGroup.children.length > 0) {
    const c = pickGroup.children[0];
    pickGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
};

// Hide the pick info row (called when the pick is toggled off).
window._s2viz_hide_pick_info = function() {
  document.getElementById("pick-row").style.display = "none";
};

// Draw the picked cell (outlined, raised slightly above covering cells).
window._s2viz_show_pick = function(vertices, lineColor) {
  const r = GLOBE_RADIUS * 1.004;
  const pts = [];
  for (let i = 0; i < vertices.length; i += 3) {
    pts.push(new THREE.Vector3(vertices[i] * r, vertices[i+1] * r, vertices[i+2] * r));
  }
  if (pts.length > 0) pts.push(pts[0].clone());
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const lineMat = new THREE.LineBasicMaterial({ color: lineColor || 0xffcc00 });
  pickGroup.add(new THREE.Line(lineGeo, lineMat));
};

// Update the pick info panel from OCaml.
window._s2viz_set_pick_info = function(token, level, face, lat, lng) {
  document.getElementById("pick-row").style.display = "";
  document.getElementById("pick-token").textContent = token;
  document.getElementById("pick-detail").textContent =
    `level ${level} - face ${face} - ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
};

// Show/update selection cap as a circle on the globe
window._s2viz_show_selection = function(cx, cy, cz, radius) {
  if (selectionMesh) {
    scene.remove(selectionMesh);
    selectionMesh.geometry.dispose();
    selectionMesh.material.dispose();
    selectionMesh = null;
  }
  if (radius <= 0) return;

  // Draw a circle on the sphere at the given center with angular radius
  const center = new THREE.Vector3(cx, cy, cz).normalize();
  const pts = [];
  // Find a perpendicular vector
  const up = Math.abs(center.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(center, up).normalize();
  const v = new THREE.Vector3().crossVectors(center, u).normalize();

  const r = GLOBE_RADIUS * 1.003;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const sinR = Math.sin(radius), cosR = Math.cos(radius);
    const p = new THREE.Vector3()
      .addScaledVector(center, cosR)
      .addScaledVector(u, sinR * Math.cos(angle))
      .addScaledVector(v, sinR * Math.sin(angle))
      .normalize()
      .multiplyScalar(r);
    pts.push(p);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 });
  selectionMesh = new THREE.Line(geo, mat);
  scene.add(selectionMesh);
};

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
