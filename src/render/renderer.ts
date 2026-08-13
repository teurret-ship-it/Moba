import * as THREE from 'three';
import { PLAYER_RADIUS } from '../sim/constants.ts';
import { OBJECTIVE_RADIUS } from '../sim/objective.ts';
import type { RenderState } from '../client/interpolation.ts';
import { createArena, type ArenaObjects } from './arena.ts';
import { FxSystem } from './fx.ts';
import type { ClassId } from '../sim/classes.ts';
import type { Obstacle } from '../sim/terrain.ts';
import {
  getCharacterTexture,
  getGlowTexture,
  getFacingTexture,
  getPickupTexture,
  getSelfRingTexture,
  getShadowTexture,
  PLAYER_COLORS,
} from './textures.ts';

/**
 * Warstwa renderu (sekcja 4: Render + GameView).
 *
 * Renderer nie zna symulacji. Dostaje `RenderState` — wynik interpolacji —
 * i pozycję własnej postaci z predykcji. Nie podejmuje żadnych decyzji
 * o rozgrywce. To jest ta granica, dzięki której w Fazie 1 nie trzeba
 * ruszać niczego w tym pliku.
 *
 * Konwencja osi: świat symulacji jest 2D (x, y). W scenie 3D mapujemy
 * world.x → three.x oraz world.y → -three.z. Wysokość (three.y) jest
 * wyłącznie kosmetyczna — symulacja jej nie zna.
 */

/** Rozmiar sylwetki na klasę — czytelny sygnał „z kim mam do czynienia". */
const CLASS_SIZE: Record<ClassId, number> = {
  lowca: 2.5,
  kolos: 3.3,
  widmo: 2.2,
  kuglarz: 2.4,
};

const CAMERA_HEIGHT = 33;
const CAMERA_DISTANCE = 25;
/** Wygładzanie kamery: 1/s. Wyżej = sztywniej, niżej = bujanie. */
const CAMERA_LERP = 7;

interface PlayerVisual {
  root: THREE.Group;
  body: THREE.Sprite;
  shadow: THREE.Mesh;
  facing: THREE.Mesh;
  selfRing: THREE.Mesh;
  shield: THREE.Sprite;
  hpBg: THREE.Sprite;
  hpFill: THREE.Sprite;
  /** Wygaszanie po zniknięciu z widoku (ukrycie / wyjście z AoI). */
  fade: number;
}

export class ArenaRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fx = new FxSystem();

  private arena: ArenaObjects;
  private players = new Map<number, PlayerVisual>();
  private pickupPool: THREE.Sprite[] = [];
  private decoyPool: Array<{ sprite: THREE.Sprite; marker: THREE.Mesh }> = [];
  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private shakeAmount = 0;
  private elapsed = 0;
  private readonly projectionScratch = new THREE.Vector3();
  private objectiveGroup: THREE.Group | null = null;
  private objectiveRing!: THREE.Mesh;
  private objectiveFill!: THREE.Mesh;
  private objectiveBeam!: THREE.Sprite;
  private objectivePulse = 0;
  /** Zatrzymanie klatki po mocnym trafieniu — sekundy pozostałego bezruchu. */
  private hitStop = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
    });
    // Sekcja 4: budżet FPS na średnim Androidzie. Pixel ratio ponad 2
    // kosztuje ~40% wydajności i nie jest widoczne na małym ekranie.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b0e15, 1);

    this.scene.fog = new THREE.Fog(0x0b0e15, 46, 78);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 220);
    this.camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    this.arena = createArena();
    this.scene.add(this.arena.group);
    this.scene.add(this.fx.group);
    this.buildObjective();

    this.resize();
  }

  /** Bryły Rdzenia — tworzone raz, pokazywane i chowane wg stanu. */
  private buildObjective(): void {
    const group = new THREE.Group();
    group.visible = false;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(OBJECTIVE_RADIUS - 0.35, OBJECTIVE_RADIUS, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffc75a,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    group.add(ring);

    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(OBJECTIVE_RADIUS - 0.4, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffc75a,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.07;
    group.add(fill);

    // Słup światła: Rdzeń musi być widoczny zza przeszkód, bo jest
    // informacją globalną — inaczej „umówione starcie" gubi połowę stawki.
    const beam = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xffc75a,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.scale.set(3.4, 16, 1);
    beam.position.y = 7;
    group.add(beam);

    this.scene.add(group);
    this.objectiveGroup = group;
    this.objectiveRing = ring;
    this.objectiveFill = fill;
    this.objectiveBeam = beam;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Rzut punktu świata na piksele ekranu.
   *
   * Liczby obrażeń rysujemy w DOM, nie w WebGL: tekst w scenie wymagałby
   * atlasu czcionek i osobnej ścieżki renderu, a na telefonie kosztuje
   * więcej niż warstwa, którą przeglądarka i tak kompozytuje na GPU.
   * Zwraca `null`, gdy punkt jest za kamerą.
   */
  project(x: number, y: number, height = 2): { sx: number; sy: number } | null {
    this.projectionScratch.set(x, height, -y);
    this.projectionScratch.project(this.camera);
    if (this.projectionScratch.z > 1) return null;
    return {
      sx: (this.projectionScratch.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-this.projectionScratch.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  /** Budowa terenu — wołane przy starcie meczu, gdy zmienia się ziarno. */
  setTerrain(obstacles: readonly Obstacle[]): void {
    this.arena.setTerrain(obstacles);
  }

  /** Wstrząs kamery — używany przy trafieniu gracza lokalnego. */
  shake(amount: number): void {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + amount);
  }

  /**
   * Krótkie zatrzymanie obrazu po mocnym ciosie.
   *
   * Kilkadziesiąt milisekund bezruchu sprawia, że trafienie „waży". To jest
   * ten sam trik, co w bijatykach — i na małym ekranie działa lepiej niż
   * jakikolwiek efekt cząsteczkowy, bo nie wymaga patrzenia w konkretne
   * miejsce.
   */
  freeze(seconds: number): void {
    this.hitStop = Math.min(0.12, Math.max(this.hitStop, seconds));
  }

  render(
    state: RenderState,
    self: { x: number; y: number; facing: number } | null,
    selfId: number,
    dt: number,
  ): void {
    // Zatrzymanie klatki: świat stoi, ale render leci dalej, więc obraz
    // się nie zacina — po prostu nic się nie rusza.
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt = 0;
    }

    this.elapsed += dt;

    this.arena.setZone(
      state.zone.x,
      state.zone.y,
      state.zone.radius,
      state.zone.nextRadius,
      this.elapsed,
    );

    this.syncObjective(state, dt);
    this.syncDecoys(state, selfId);
    this.syncPlayers(state, self, selfId, dt);
    this.syncPickups(state);
    this.fx.update(dt);
    this.updateCamera(state, self, dt);

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Rdzeń: pierścień na ziemi, słup światła i wypełnienie postępu.
   *
   * Kolor niesie stan, bo tekstu na ziemi nikt nie przeczyta w biegu:
   * bursztyn = wolny, biały = ktoś przejmuje, czerwony = spór.
   */
  private syncObjective(state: RenderState, dt: number): void {
    const o = state.objective;
    if (!this.objectiveGroup) return;

    this.objectiveGroup.visible = o.active;
    if (!o.active) return;

    this.objectiveGroup.position.set(o.x, 0, -o.y);
    this.objectivePulse += dt;

    const frac = Math.max(0, Math.min(1, o.progress / (4.5 * 20)));
    const color = o.contested ? 0xff6b6b : o.holderId >= 0 ? 0xffffff : 0xffc75a;

    (this.objectiveRing.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.objectiveBeam.material as THREE.SpriteMaterial).color.setHex(color);

    // Wypełnienie rośnie od środka — czytelne kątem oka, bez patrzenia
    // na pasek u góry ekranu.
    this.objectiveFill.scale.setScalar(Math.max(0.001, frac));
    (this.objectiveFill.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.objectiveFill.material as THREE.MeshBasicMaterial).opacity = 0.28 + frac * 0.3;

    const pulse = 1 + Math.sin(this.objectivePulse * 4) * 0.06;
    this.objectiveRing.scale.setScalar(pulse);
    this.objectiveBeam.material.opacity = 0.35 + Math.sin(this.objectivePulse * 3) * 0.12;
  }

  /**
   * Zwody rysowane tak samo jak postacie — ten sam kształt, ten sam kolor.
   *
   * Odróżnia je tylko lekkie migotanie i brak paska zdrowia nad głową.
   * Gdyby były wyraźnie oznaczone, przestałyby być zmyłką; gdyby były
   * identyczne co do piksela, gracz nie miałby żadnej szansy — a chodzi
   * o to, żeby dało się je rozpoznać dopiero po chwili obserwacji.
   */
  private syncDecoys(state: RenderState, selfId: number): void {
    for (let i = 0; i < state.decoys.length; i++) {
      const d = state.decoys[i]!;
      let entry = this.decoyPool[i];
      if (!entry) {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ transparent: true, depthWrite: false }),
        );
        // Znacznik pod WŁASNĄ kopią. Zamiana teleportuje dokładnie tutaj,
        // więc właściciel musi wiedzieć, gdzie wyląduje — bez tego używa
        // umiejętności na ślepo. Przeciwnik znacznika nie dostaje, więc
        // zmyłka pozostaje zmyłką.
        const marker = new THREE.Mesh(
          new THREE.RingGeometry(1.0, 1.25, 20),
          new THREE.MeshBasicMaterial({
            color: 0x9fe6ff,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.y = 0.12;
        marker.visible = false;
        this.scene.add(sprite);
        this.scene.add(marker);
        entry = { sprite, marker };
        this.decoyPool.push(entry);
      }
      const sprite = entry.sprite;
      const mat = sprite.material as THREE.SpriteMaterial;
      const tex = getCharacterTexture(d.colorIndex, d.classId);
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      const size = CLASS_SIZE[d.classId] ?? 2.5;
      sprite.scale.set(size, size, 1);
      sprite.position.set(d.x, size / 2, -d.y);
      // Migotanie zdradza kopię dopiero temu, kto się jej przygląda.
      mat.opacity = 0.86 + Math.sin(this.elapsed * 9 + d.id) * 0.1;
      sprite.visible = true;

      const isOwn = d.ownerId === selfId;
      entry.marker.visible = isOwn;
      if (isOwn) {
        entry.marker.position.set(d.x, 0.12, -d.y);
        const pulse = 1 + Math.sin(this.elapsed * 5) * 0.08;
        entry.marker.scale.setScalar(pulse);
      }
    }
    for (let i = state.decoys.length; i < this.decoyPool.length; i++) {
      this.decoyPool[i]!.sprite.visible = false;
      this.decoyPool[i]!.marker.visible = false;
    }
  }

  private syncPlayers(
    state: RenderState,
    self: { x: number; y: number; facing: number } | null,
    selfId: number,
    dt: number,
  ): void {
    const seen = new Set<number>();

    for (const p of state.players) {
      seen.add(p.id);
      const visual = this.getPlayerVisual(p.id, p.colorIndex, p.classId);

      // Własna postać jest rysowana z predykcji, nie z interpolacji —
      // inaczej reaguje z opóźnieniem 100 ms i na telefonie to widać.
      const useSelf = self !== null && p.id === selfId;
      const x = useSelf ? self.x : p.x;
      const y = useSelf ? self.y : p.y;
      const facing = useSelf ? self.facing : p.facing;

      visual.root.position.set(x, 0, -y);
      visual.root.visible = true;
      visual.fade = Math.min(1, visual.fade + dt * 8);

      // Ukrycie: własna postać jest półprzezroczysta (informacja zwrotna),
      // cudze w ogóle nie docierają w snapshocie.
      const targetOpacity = p.stealthed ? 0.42 : 1;
      const bodyMat = visual.body.material as THREE.SpriteMaterial;
      bodyMat.opacity = targetOpacity * visual.fade;

      // Kolor korpusu sygnalizuje buffy — bez czytania ikon.
      if (p.damageBuffed) bodyMat.color.setHex(0xffc9a0);
      else if (p.speedBuffed) bodyMat.color.setHex(0xa9e8ff);
      else bodyMat.color.setHex(0xffffff);

      // Krótki błysk przy trafieniu odczytujemy z HP w kolejnych klatkach
      // — pełne trafienia obsługuje FxSystem, tu wystarczy pasek.
      visual.facing.rotation.z = -facing;
      visual.selfRing.visible = useSelf;

      visual.shield.visible = p.shieldHp > 0;
      if (visual.shield.visible) {
        const pulse = 1 + Math.sin(this.elapsed * 8) * 0.05;
        visual.shield.scale.setScalar(pulse);
        (visual.shield.material as THREE.SpriteMaterial).opacity =
          0.35 + 0.4 * Math.min(1, p.shieldHp / 55);
      }

      const hpFrac = Math.max(0, Math.min(1, p.hp / p.maxHp));
      visual.hpBg.visible = !useSelf && p.alive;
      visual.hpFill.visible = !useSelf && p.alive;
      if (visual.hpFill.visible) {
        const width = 2.2;
        visual.hpFill.scale.set(width * hpFrac, 0.26, 1);
        visual.hpFill.position.x = -(width * (1 - hpFrac)) / 2;
        (visual.hpFill.material as THREE.SpriteMaterial).color.setHex(
          hpFrac > 0.5 ? 0x7ed77e : hpFrac > 0.25 ? 0xe8d36a : 0xe07a6a,
        );
      }

      // Skok: lekkie „przysiadnięcie" sprite'a, żeby ruch był czytelny
      // także wtedy, gdy postać jest za krawędzią ekranu.
      // Kolos jest wyraźnie większy, Widmo mniejsze — sylwetka musi
      // czytać klasę z odległości, zanim zobaczysz pasek HP.
      const size = CLASS_SIZE[p.classId] ?? 2.5;
      const squash = p.dashing ? 0.82 : 1;
      visual.body.scale.set(size * squash, size / squash, 1);
      visual.body.position.y = (size / 2) / squash;

      const bob = Math.sin(this.elapsed * 6 + p.id) * 0.05;
      visual.body.position.y += bob;
    }

    // Postacie, których nie ma w tym snapshocie: wygaś zamiast usuwać.
    // Nagłe zniknięcie przy wejściu w ukrycie wygląda jak błąd renderu.
    for (const [id, visual] of this.players) {
      if (seen.has(id)) continue;
      visual.fade = Math.max(0, visual.fade - dt * 6);
      (visual.body.material as THREE.SpriteMaterial).opacity = visual.fade;
      (visual.shadow.material as THREE.MeshBasicMaterial).opacity = visual.fade * 0.6;
      visual.hpBg.visible = false;
      visual.hpFill.visible = false;
      visual.selfRing.visible = false;
      visual.shield.visible = false;
      if (visual.fade <= 0.001) visual.root.visible = false;
    }
  }

  private getPlayerVisual(id: number, colorIndex: number, classId: ClassId): PlayerVisual {
    const existing = this.players.get(id);
    if (existing) {
      (existing.shadow.material as THREE.MeshBasicMaterial).opacity = 0.6 * existing.fade;
      return existing;
    }

    const root = new THREE.Group();

    const body = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getCharacterTexture(colorIndex, classId),
        transparent: true,
        depthWrite: false,
      }),
    );
    body.scale.set(2.5, 2.5, 1);
    body.position.y = 1.25;
    root.add(body);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(PLAYER_RADIUS * 1.15, 20),
      new THREE.MeshBasicMaterial({
        map: getShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.08;
    root.add(shadow);

    const facing = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({
        map: getFacingTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      }),
    );
    facing.rotation.x = -Math.PI / 2;
    facing.position.y = 0.1;
    root.add(facing);

    const selfRing = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 3.0),
      new THREE.MeshBasicMaterial({
        map: getSelfRingTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      }),
    );
    selfRing.rotation.x = -Math.PI / 2;
    selfRing.position.y = 0.12;
    selfRing.visible = false;
    root.add(selfRing);

    // Tarcza Kolosa — bańka wokół sylwetki, widoczna dla wszystkich,
    // bo przeciwnik musi wiedzieć, że teraz nie warto go bić.
    const shield = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0x8fd4ff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    shield.scale.setScalar(4.2);
    shield.position.y = 1.3;
    shield.visible = false;
    root.add(shield);

    const hpBg = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x11141c, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    hpBg.scale.set(2.35, 0.34, 1);
    hpBg.position.y = 3.0;
    root.add(hpBg);

    const hpFill = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x7ed77e, transparent: true, depthWrite: false }),
    );
    hpFill.scale.set(2.2, 0.26, 1);
    hpFill.position.y = 3.0;
    root.add(hpFill);

    this.scene.add(root);
    const visual: PlayerVisual = {
      root,
      body,
      shadow,
      facing,
      selfRing,
      shield,
      hpBg,
      hpFill,
      fade: 0,
    };
    this.players.set(id, visual);
    return visual;
  }

  private syncPickups(state: RenderState): void {
    for (let i = 0; i < state.pickups.length; i++) {
      const item = state.pickups[i]!;
      let sprite = this.pickupPool[i];
      if (!sprite) {
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ transparent: true, depthWrite: false }),
        );
        this.scene.add(sprite);
        this.pickupPool.push(sprite);
      }
      const mat = sprite.material as THREE.SpriteMaterial;
      const tex = getPickupTexture(item.kind);
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      // Pulsowanie i unoszenie — drop musi się „zgłaszać" peryferyjnie.
      const pulse = 1 + Math.sin(this.elapsed * 3.4 + item.id) * 0.09;
      sprite.scale.setScalar(2.1 * pulse);
      sprite.position.set(item.x, 1.0 + Math.sin(this.elapsed * 2.2 + item.id) * 0.14, -item.y);
      sprite.visible = true;
    }
    for (let i = state.pickups.length; i < this.pickupPool.length; i++) {
      this.pickupPool[i]!.visible = false;
    }
  }

  private updateCamera(
    state: RenderState,
    self: { x: number; y: number } | null,
    dt: number,
  ): void {
    // Kamera podąża za graczem; po śmierci — za środkiem strefy, żeby
    // obserwowanie końcówki miało sens.
    const tx = self ? self.x : state.zone.x;
    const ty = self ? self.y : state.zone.y;

    const k = 1 - Math.exp(-CAMERA_LERP * dt);
    this.cameraTarget.x += (tx - this.cameraTarget.x) * k;
    this.cameraTarget.z += (-ty - this.cameraTarget.z) * k;

    let shakeX = 0;
    let shakeZ = 0;
    if (this.shakeAmount > 0.001) {
      shakeX = (Math.random() * 2 - 1) * this.shakeAmount;
      shakeZ = (Math.random() * 2 - 1) * this.shakeAmount;
      this.shakeAmount *= Math.exp(-9 * dt);
    } else {
      this.shakeAmount = 0;
    }

    this.camera.position.set(
      this.cameraTarget.x + shakeX,
      CAMERA_HEIGHT,
      this.cameraTarget.z + CAMERA_DISTANCE + shakeZ,
    );
    this.camera.lookAt(this.cameraTarget.x, 0, this.cameraTarget.z);
  }

  /** Kolor slotu — HUD używa go do killfeeda, żeby zgadzał się z areną. */
  static colorFor(colorIndex: number): string {
    return PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!;
  }

  reset(): void {
    for (const visual of this.players.values()) {
      this.scene.remove(visual.root);
      (visual.body.material as THREE.SpriteMaterial).dispose();
      visual.shadow.geometry.dispose();
      (visual.shadow.material as THREE.Material).dispose();
      visual.facing.geometry.dispose();
      (visual.facing.material as THREE.Material).dispose();
      visual.selfRing.geometry.dispose();
      (visual.selfRing.material as THREE.Material).dispose();
      (visual.shield.material as THREE.Material).dispose();
      (visual.hpBg.material as THREE.Material).dispose();
      (visual.hpFill.material as THREE.Material).dispose();
    }
    this.players.clear();
    this.cameraTarget.set(0, 0, 0);
    this.shakeAmount = 0;
  }

  dispose(): void {
    this.reset();
    for (const sprite of this.pickupPool) {
      this.scene.remove(sprite);
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const entry of this.decoyPool) {
      this.scene.remove(entry.sprite);
      this.scene.remove(entry.marker);
      (entry.sprite.material as THREE.SpriteMaterial).dispose();
      entry.marker.geometry.dispose();
      (entry.marker.material as THREE.Material).dispose();
    }
    this.pickupPool = [];
    this.decoyPool = [];
    this.fx.dispose();
    this.arena.dispose();
    this.renderer.dispose();
  }
}
