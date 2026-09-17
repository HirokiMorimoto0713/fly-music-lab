// Derived from NeLy-EPFL/flygym wasm/shared/scene.js, Apache-2.0.
// See NOTICE.md for revision and changes.
import * as THREE from "three";

export function buildMeshes(model, meta) {
  const group = new THREE.Group();
  const items = [];
  const rgbaList = meta.geom_rgba || [];
  for (let g = 0; g < model.ngeom; g++) {
    const geometry = geometryForGeom(model, g, model.geom_type[g]);
    if (!geometry) continue; // planes/hfields handled separately
    const rgba = rgbaList[g] || [0.7, 0.7, 0.7, 1.0];
    const baseOpacity = rgba.length > 3 ? rgba[3] : 1.0;
    const color = new THREE.Color().setRGB(
      rgba[0],
      rgba[1],
      rgba[2],
      THREE.SRGBColorSpace,
    );
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: baseOpacity < 1,
      opacity: baseOpacity,
      depthWrite: baseOpacity >= 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.userData = {
      kind: "mesh",
      g,
      name: model.geom(g).name,
      bodyId: model.geom_bodyid[g],
    };
    group.add(mesh);
    items.push({ mesh, g, bodyId: model.geom_bodyid[g], baseOpacity });
  }
  group.userData.items = items;
  return group;
}

export function geometryForGeom(model, g, type) {
  // mjGEOM_PLANE=0, HFIELD=1, SPHERE=2, CAPSULE=3, ELLIPSOID=4, CYLINDER=5,
  // BOX=6, MESH=7.
  const s = (k) => model.geom_size[g * 3 + k];
  if (model.geom_dataid[g] >= 0)
    return meshGeometry(model, model.geom_dataid[g]);
  switch (type) {
    case 2:
      return new THREE.SphereGeometry(s(0), 16, 12);
    case 3: {
      const geo = new THREE.CapsuleGeometry(s(0), 2 * s(1), 6, 12);
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case 4: {
      const geo = new THREE.SphereGeometry(1, 16, 12);
      geo.scale(s(0), s(1), s(2));
      return geo;
    }
    case 5: {
      const geo = new THREE.CylinderGeometry(s(0), s(0), 2 * s(1), 16);
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case 6:
      return new THREE.BoxGeometry(2 * s(0), 2 * s(1), 2 * s(2));
    default:
      return null; // plane / hfield
  }
}

export function meshGeometry(model, dataid) {
  const va = model.mesh_vertadr[dataid],
    vn = model.mesh_vertnum[dataid];
  const fa = model.mesh_faceadr[dataid],
    fn = model.mesh_facenum[dataid];
  const allVerts = model.mesh_vert,
    allFaces = model.mesh_face;
  const verts = new Float32Array(vn * 3);
  for (let i = 0; i < vn * 3; i++) verts[i] = allVerts[va * 3 + i];
  const index = new Uint32Array(fn * 3);
  for (let i = 0; i < fn * 3; i++) index[i] = allFaces[fa * 3 + i];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  return geo;
}

// Read the solved geom frames (data.geom_xpos / geom_xmat) into the Three.js
// meshes built by buildMeshes(). Meshes use manual matrices (matrixAutoUpdate
// off), so we write the world transform straight in.
const _m4 = new THREE.Matrix4();
export function syncMeshes(meshGroup, data) {
  const gx = data.geom_xpos,
    gm = data.geom_xmat;
  for (const { mesh, g } of meshGroup.userData.items) {
    _m4.set(
      gm[9 * g + 0],
      gm[9 * g + 1],
      gm[9 * g + 2],
      gx[3 * g + 0],
      gm[9 * g + 3],
      gm[9 * g + 4],
      gm[9 * g + 5],
      gx[3 * g + 1],
      gm[9 * g + 6],
      gm[9 * g + 7],
      gm[9 * g + 8],
      gx[3 * g + 2],
      0,
      0,
      0,
      1,
    );
    mesh.matrix.copy(_m4);
  }
}
