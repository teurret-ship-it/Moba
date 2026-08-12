import * as THREE from 'three';
import { ARENA_RADIUS } from '../sim/constants.ts';
import { getGroundTexture } from './textures.ts';

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

  return {
    group,
    setZone(x, y, radius, nextRadius, timeSeconds) {
      zoneUniforms.uCenter.value.set(x, y);
      zoneUniforms.uRadius.value = radius;
      zoneUniforms.uNextRadius.value = nextRadius;
      zoneUniforms.uTime.value = timeSeconds;
    },
    dispose() {
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      rim.geometry.dispose();
      (rim.material as THREE.Material).dispose();
      zone.geometry.dispose();
      zoneMaterial.dispose();
    },
  };
}
