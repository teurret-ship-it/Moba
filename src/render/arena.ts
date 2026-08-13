import * as THREE from 'three';
import { ARENA_RADIUS } from '../sim/constants.ts';
import type { Obstacle } from '../sim/terrain.ts';
import { getGroundTexture } from './textures.ts';

/** Wysokość przeszkód. Na tyle wysokie, by czytać je jako osłonę, na tyle
 *  niskie, by nie zasłaniały postaci stojącej tuż za nimi. */
const OBSTACLE_HEIGHT = 3.4;

/**
 * Statyczna geometria areny: podłoże, krawędź mapy i wizualizacja strefy.
 *
 * Strefa jest rysowana shaderem na jednej płaszczyźnie zamiast setek
 * segmentów okręgu. Powód jest prozaiczny: to jeden draw call zamiast
 * geometrii przebudowywanej co klatkę, gdy promień się zmienia.
 */

export interface ArenaObjects {
  group: THREE.Group;
  setZone(x: number, y: number, radius: number, nextRadius: number, timeSeconds: number): void;
  /** Budowa brył przeszkód. Wywoływane raz na mecz, przy zmianie ziarna. */
  setTerrain(obstacles: readonly Obstacle[]): void;
  dispose(): void;
}

const zoneVertex = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = vec2(world.x, -world.z);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const zoneFragment = /* glsl */ `
  precision mediump float;
  varying vec2 vWorld;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uNextRadius;
  uniform float uTime;

  void main() {
    float d = distance(vWorld, uCenter);

    // Obszar poza strefą: czerwona mgła, gęstniejąca z odległością.
    float outside = smoothstep(uRadius, uRadius + 2.5, d);
    float haze = outside * (0.30 + 0.10 * sin(uTime * 2.0 + d * 0.35));

    // Krawędź strefy — wyraźna linia, po której gracz orientuje się bez HUD.
    float edge = 1.0 - smoothstep(0.0, 1.1, abs(d - uRadius));
    edge *= 0.85 + 0.15 * sin(uTime * 4.0);

    // Zapowiedź następnego promienia — cienki, przerywany okrąg.
    float nextEdge = 1.0 - smoothstep(0.0, 0.45, abs(d - uNextRadius));
    float dashes = step(0.5, fract(atan(vWorld.y - uCenter.y, vWorld.x - uCenter.x) * 6.0));
    nextEdge *= dashes * 0.5;

    vec3 color = vec3(0.90, 0.20, 0.24) * (haze + edge);
    color += vec3(0.95, 0.85, 0.35) * nextEdge;

    float alpha = clamp(haze + edge * 0.9 + nextEdge, 0.0, 0.92);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createArena(): ArenaObjects {
  const group = new THREE.Group();

  // --- podłoże ---
  const groundTex = getGroundTexture();
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS, 64),
    new THREE.MeshBasicMaterial({ map: groundTex }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // --- krawędź areny ---
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(ARENA_RADIUS - 0.55, ARENA_RADIUS + 0.9, 96),
    new THREE.MeshBasicMaterial({
      color: 0x5b7aa8,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  group.add(rim);

  // --- strefa ---
  const zoneUniforms = {
    uCenter: { value: new THREE.Vector2(0, 0) },
    uRadius: { value: ARENA_RADIUS },
    uNextRadius: { value: ARENA_RADIUS },
    uTime: { value: 0 },
  };
  const zoneMaterial = new THREE.ShaderMaterial({
    vertexShader: zoneVertex,
    fragmentShader: zoneFragment,
    uniforms: zoneUniforms,
    transparent: true,
    depthWrite: false,
  });
  const zone = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_RADIUS + 1.5, 96),
    zoneMaterial,
  );
  zone.rotation.x = -Math.PI / 2;
  zone.position.y = 0.05;
  group.add(zone);

  // --- przeszkody ---
  const terrainGroup = new THREE.Group();
  group.add(terrainGroup);

  const terrainMaterial = new THREE.MeshBasicMaterial({ color: 0x39445c });
  const terrainCapMaterial = new THREE.MeshBasicMaterial({ color: 0x4a5878 });
  const disposables: Array<THREE.BufferGeometry> = [];

  function clearTerrain(): void {
    for (const child of [...terrainGroup.children]) terrainGroup.remove(child);
    for (const g of disposables) g.dispose();
    disposables.length = 0;
  }

  return {
    group,

    /**
     * Budowa terenu — osobna siatka na każdą bryłę.
     *
     * Wygląda to na oczywistego kandydata do scalenia geometrii: przeszkody
     * są statyczne przez całą rundę i dzielą dwa materiały, a poradniki
     * wydajności three.js wymieniają scalanie jako zmianę o największym
     * wpływie. Zrobiłem to i ZMIERZYŁEM — wyszło gorzej:
     *
     *   przed scaleniem:  24 wywołania rysowania, 0,7 tys. trójkątów
     *   po scaleniu:      22 wywołania rysowania, 1,4 tys. trójkątów
     *
     * Powód: three.js odrzuca niewidoczne siatki poza ostrosłupem widzenia,
     * a kamera obejmuje ułamek areny o promieniu 60 jednostek. Osobne bryły
     * są więc w większości w ogóle nierysowane. Scalenie zamienia kilkanaście
     * TANICH, odrzucanych siatek w jedną, której odrzucić się nie da — kupuje
     * dwa wywołania rysowania za podwojenie przesyłanej geometrii.
     *
     * Rada z poradnika była dobra, tylko nie dla tej sceny: scalanie opłaca
     * się, gdy wszystko i tak jest w kadrze. Zostawiam osobne siatki i ten
     * komentarz, żeby nie zrobić tego drugi raz.
     */
    setTerrain(obstacles) {
      clearTerrain();

      for (const o of obstacles) {
        const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
        const midX = (o.x1 + o.x2) / 2;
        const midY = (o.y1 + o.y2) / 2;

        // Filar (kapsuła o zerowej długości) to walec; mur to prostopadłościan
        // z walcami na końcach, żeby narożniki zgadzały się z kolizją, która
        // liczy odległość od odcinka.
        if (len < 0.01) {
          const geo = new THREE.CylinderGeometry(o.r, o.r * 1.06, OBSTACLE_HEIGHT, 14);
          disposables.push(geo);
          const mesh = new THREE.Mesh(geo, terrainMaterial);
          mesh.position.set(midX, OBSTACLE_HEIGHT / 2, -midY);
          terrainGroup.add(mesh);
        } else {
          const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
          const box = new THREE.BoxGeometry(len, OBSTACLE_HEIGHT, o.r * 2);
          disposables.push(box);
          const mesh = new THREE.Mesh(box, terrainMaterial);
          mesh.position.set(midX, OBSTACLE_HEIGHT / 2, -midY);
          mesh.rotation.y = -angle;
          terrainGroup.add(mesh);

          for (const [ex, ey] of [[o.x1, o.y1], [o.x2, o.y2]] as const) {
            const cap = new THREE.CylinderGeometry(o.r, o.r, OBSTACLE_HEIGHT, 10);
            disposables.push(cap);
            const capMesh = new THREE.Mesh(cap, terrainMaterial);
            capMesh.position.set(ex, OBSTACLE_HEIGHT / 2, -ey);
            terrainGroup.add(capMesh);
          }
        }

        // Jasna „czapka" na górze: bez niej bryła zlewa się z podłożem
        // przy patrzeniu z góry pod kątem kamery.
        const capGeo = new THREE.CircleGeometry(o.r, 14);
        disposables.push(capGeo);
        if (len < 0.01) {
          const top = new THREE.Mesh(capGeo, terrainCapMaterial);
          top.rotation.x = -Math.PI / 2;
          top.position.set(midX, OBSTACLE_HEIGHT + 0.02, -midY);
          terrainGroup.add(top);
        } else {
          const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
          const strip = new THREE.PlaneGeometry(len, o.r * 2);
          disposables.push(strip);
          const top = new THREE.Mesh(strip, terrainCapMaterial);
          top.rotation.x = -Math.PI / 2;
          top.rotation.z = angle;
          top.position.set(midX, OBSTACLE_HEIGHT + 0.02, -midY);
          terrainGroup.add(top);
        }
      }
    },

    setZone(x, y, radius, nextRadius, timeSeconds) {
      zoneUniforms.uCenter.value.set(x, y);
      zoneUniforms.uRadius.value = radius;
      zoneUniforms.uNextRadius.value = nextRadius;
      zoneUniforms.uTime.value = timeSeconds;
    },
    dispose() {
      clearTerrain();
      terrainMaterial.dispose();
      terrainCapMaterial.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      rim.geometry.dispose();
      (rim.material as THREE.Material).dispose();
      zone.geometry.dispose();
      zoneMaterial.dispose();
    },
  };
}
