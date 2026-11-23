"use client";

import { U1_BED } from "./packing";

/** The three.js scene shared by the 3D viewers: the U1 bed with a 1 cm grid, lights, a camera and orbit controls. */

type Three = typeof import("three");
export type BedScene = {
  THREE: Three;
  camera: import("three").PerspectiveCamera;
  controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
  /** Holds what the viewer draws on the bed. */
  root: import("three").Group;
  render: () => void;
  /** Points the camera at a box from its current direction, close enough to fill the view. */
  frame: (box: import("three").Box3) => void;
  dispose: () => void;
};

const BED_W = U1_BED.maxX - U1_BED.minX;
const BED_D = U1_BED.maxY - U1_BED.minY;

/** Loads three on first use and draws into `el`, keeping a 4:3 canvas as wide as the element. */
export async function createBedScene(el: HTMLElement): Promise<BedScene> {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf3f4f6);
  el.appendChild(renderer.domElement);

  const cx = U1_BED.minX + BED_W / 2;
  const cy = U1_BED.minY + BED_D / 2;
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  camera.up.set(0, 0, 1); // 3MF is Z-up
  camera.position.set(cx, U1_BED.minY - BED_D * 0.55, U1_BED.height * 0.85);
  world.add(camera);
  world.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.4, 0.3, 1); // relative to the camera, so the lit side faces the viewer
  camera.add(sun);

  // The bed and a 1 cm grid.
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(BED_W, BED_D), new THREE.MeshStandardMaterial({ color: 0xe5e7eb }));
  plate.position.set(cx, cy, -0.2);
  world.add(plate);
  const grid = new THREE.GridHelper(BED_W, BED_W / 10, 0x9ca3af, 0xd1d5db);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(cx, cy, 0);
  world.add(grid);

  const root = new THREE.Group();
  world.add(root);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(cx, cy, 20);
  controls.maxDistance = 1500;
  const render = () => renderer.render(world, camera);
  controls.addEventListener("change", render);
  const resize = () => {
    const width = el.clientWidth;
    const height = Math.round(width * 0.75);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  controls.update();
  resize();

  const frame = (box: import("three").Box3) => {
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const direction = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(centre);
    camera.position.copy(centre).addScaledVector(direction, Math.max(size * 1.6, 60));
    controls.update();
  };

  const dispose = () => {
    observer.disconnect();
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { THREE, camera, controls, root, render, frame, dispose };
}
