import * as THREE from 'three';
import { PITCH } from '../config.js';
import { makePitchTexture, makeNetTexture, makeCrowdTexture, makeBallTexture } from './Textures.js';

/**
 * Builds the stadium: pitch surface, goals with nets, ad boards, stands and sky.
 * Everything is procedurally generated — no external assets.
 */
export class Stadium {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this._buildSky();
    this._buildLights();
    this._buildPitch();
    this._buildGoals();
    this._buildSurroundings();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f6bb5) },
        bottom: { value: new THREE.Color(0xbfd8ea) },
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vH = normalize(wp.xyz).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 bottom;
        varying float vH;
        void main() {
          float t = clamp(vH * 1.6 + 0.25, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottom, top, t), 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0x9dbfd8, 170, 330);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x2f4a2a, 1.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(48, 78, 34);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    const s = 82;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sun = sun;

    const fill = new THREE.DirectionalLight(0xbdd7ff, 0.35);
    fill.position.set(-60, 40, -50);
    this.scene.add(fill);
  }

  _buildPitch() {
    const tex = makePitchTexture();
    tex.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    const w = PITCH.width + PITCH.margin * 2;
    const l = PITCH.length + PITCH.margin * 2;
    const geo = new THREE.PlaneGeometry(w, l);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.94,
      metalness: 0.0,
    });
    const pitch = new THREE.Mesh(geo, mat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.group.add(pitch);

    // Ground beyond the run-off
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 320),
      new THREE.MeshStandardMaterial({ color: 0x0d2a17, roughness: 1 })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    this.group.add(outer);
  }

  _buildGoals() {
    const postMat = new THREE.MeshStandardMaterial({
      color: 0xf7f9ff,
      roughness: 0.35,
      metalness: 0.2,
    });
    const netTex = makeNetTexture();
    const netMat = new THREE.MeshStandardMaterial({
      map: netTex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      roughness: 1,
      depthWrite: false,
      alphaTest: 0.18,
    });
    const r = 0.075;
    const halfW = PITCH.goalWidth / 2;
    const h = PITCH.goalHeight;
    const d = PITCH.goalDepth;

    this.goals = [];
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const zPosts = side * PITCH.halfL;
      const postGeo = new THREE.CylinderGeometry(r, r, h, 10);
      const left = new THREE.Mesh(postGeo, postMat);
      left.position.set(-halfW, h / 2, 0);
      const right = new THREE.Mesh(postGeo, postMat);
      right.position.set(halfW, h / 2, 0);
      const barGeo = new THREE.CylinderGeometry(r, r, PITCH.goalWidth + r * 2, 10);
      const bar = new THREE.Mesh(barGeo, postMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, h, 0);
      [left, right, bar].forEach((m) => {
        m.castShadow = true;
        g.add(m);
      });

      // Net panels: back, top, two sides (bent slightly outward for a nicer silhouette)
      const back = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.goalWidth, h), netMat.clone());
      back.material.map = netTex.clone();
      back.material.map.repeat.set(PITCH.goalWidth / 1.1, h / 1.1);
      back.material.map.needsUpdate = true;
      back.position.set(0, h / 2, -side * d);
      g.add(back);

      const top = new THREE.Mesh(new THREE.PlaneGeometry(PITCH.goalWidth, d), netMat.clone());
      top.material.map = netTex.clone();
      top.material.map.repeat.set(PITCH.goalWidth / 1.1, d / 1.1);
      top.material.map.needsUpdate = true;
      top.rotation.x = Math.PI / 2;
      top.position.set(0, h, -side * d / 2);
      g.add(top);

      for (const s of [-1, 1]) {
        const sidePanel = new THREE.Mesh(new THREE.PlaneGeometry(d, h), netMat.clone());
        sidePanel.material.map = netTex.clone();
        sidePanel.material.map.repeat.set(d / 1.1, h / 1.1);
        sidePanel.material.map.needsUpdate = true;
        sidePanel.rotation.y = Math.PI / 2;
        sidePanel.position.set(s * halfW, h / 2, -side * d / 2);
        g.add(sidePanel);
      }

      g.position.z = zPosts;
      this.group.add(g);
      this.goals.push(g);
    }
  }

  _buildSurroundings() {
    // Advertising boards (generic, unbranded colour blocks)
    const boardTex = makeBoardTexture();
    const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.7 });
    const boardH = 0.95;
    const inset = PITCH.margin - 2.4;
    const boards = [
      { w: PITCH.width + inset * 2, h: boardH, d: 0.35, x: 0, z: PITCH.halfL + inset },
      { w: PITCH.width + inset * 2, h: boardH, d: 0.35, x: 0, z: -(PITCH.halfL + inset) },
      { w: 0.35, h: boardH, d: PITCH.length + inset * 2, x: PITCH.halfW + inset, z: 0 },
      { w: 0.35, h: boardH, d: PITCH.length + inset * 2, x: -(PITCH.halfW + inset), z: 0 },
    ];
    for (const b of boards) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), boardMat);
      m.position.set(b.x, b.h / 2, b.z);
      m.castShadow = false;
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Stands: raked tiers of seating with crowd texture + concrete risers.
    // Built from merged geometry so the whole bowl is only a few draw calls.
    const crowdTex = makeCrowdTexture();
    crowdTex.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    const standMat = new THREE.MeshStandardMaterial({
      map: crowdTex,
      emissiveMap: crowdTex,
      emissive: 0xffffff,
      emissiveIntensity: 0.62,
      roughness: 0.95,
      color: 0xaab4c6,
      side: THREE.DoubleSide,
    });
    const riserMat = new THREE.MeshStandardMaterial({ color: 0x303a4a, roughness: 0.9 });
    const concMat = new THREE.MeshStandardMaterial({ color: 0x3a4453, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a2130, roughness: 0.8, metalness: 0.25 });

    const seatGeoms = [];
    const riserGeoms = [];
    const roofGeoms = [];
    const colGeoms = [];

    for (const side of [0, 1, 2, 3]) {
      // 0: +z end, 1: -z end, 2: +x side, 3: -x side
      const along = side < 2 ? PITCH.width + 32 : PITCH.length + 26;
      const dist = side < 2 ? PITCH.halfL + PITCH.margin + 3 : PITCH.halfW + PITCH.margin + 3;
      const rotY = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
      const tiers = 15;
      const rise = 1.15;
      const run = 1.5;
      const baseY = 1.1;
      const rake = Math.atan2(rise, run);
      const depth = tiers * run;
      const rakeH = Math.hypot(depth, tiers * rise);
      const R = new THREE.Matrix4().makeRotationY(rotY);
      const place = (geo, local) => {
        geo.applyMatrix4(new THREE.Matrix4().copy(R).multiply(local));
      };

      // --- one continuous raked seating deck per stand (keeps the crowd in scale) ---
      const seat = new THREE.PlaneGeometry(along, rakeH, 1, 1);
      {
        const uv = seat.attributes.uv;
        // ~22 m of real-world seating per texture tile keeps spectators in scale
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * (along / 22), uv.getY(i) * Math.max(0.6, rakeH / 24));
        }
        uv.needsUpdate = true;
      }
      const seatM = new THREE.Matrix4().makeRotationX(-Math.PI / 2 + rake);
      seatM.setPosition(0, baseY + (tiers * rise) / 2 + 0.2, dist + depth / 2);
      place(seat, seatM);
      seatGeoms.push(seat);

      // --- front wall + back wall of the stand ---
      const frontWall = new THREE.BoxGeometry(along, baseY + 1.2, 1.2);
      place(frontWall, new THREE.Matrix4().makeTranslation(0, (baseY + 1.2) / 2, dist + 0.4));
      riserGeoms.push(frontWall);

      // vertical strips between tiers, drawn as thin bars above the deck
      for (let i = 1; i < tiers; i += 2) {
        const bar = new THREE.BoxGeometry(along, 0.1, 0.34);
        place(
          bar,
          new THREE.Matrix4().makeTranslation(
            0,
            baseY + i * rise + 0.1,
            dist + i * run
          )
        );
        colGeoms.push(bar);
      }

      // --- roof slab (kept high and shallow so it never hides the crowd) ---
      const deckTop = baseY + tiers * rise;
      const roofY = deckTop + 9.5;
      const roof = new THREE.BoxGeometry(along + 10, 0.7, depth + 6);
      place(roof, new THREE.Matrix4().makeTranslation(0, roofY, dist + depth * 0.5));
      roofGeoms.push(roof);
      for (let k = -1; k <= 1; k++) {
        if (k === 0) continue;
        const col = new THREE.BoxGeometry(1.2, roofY, 1.2);
        place(col, new THREE.Matrix4().makeTranslation(k * (along / 2 + 2), roofY / 2, dist + depth + 2.5));
        colGeoms.push(col);
      }
      // back wall behind the top row
      const backWall = new THREE.BoxGeometry(along, 6, 1);
      place(backWall, new THREE.Matrix4().makeTranslation(0, deckTop + 1.5, dist + depth + 1.2));
      riserGeoms.push(backWall);
    }

    const mergeGeoms = (geoms) => {
      const merged = new THREE.BufferGeometry();
      let vCount = 0;
      let iCount = 0;
      for (const g of geoms) {
        vCount += g.attributes.position.count;
        iCount += g.index ? g.index.count : g.attributes.position.count;
      }
      const pos = new Float32Array(vCount * 3);
      const nor = new Float32Array(vCount * 3);
      const uv = new Float32Array(vCount * 2);
      const idx = new Uint32Array(iCount);
      let vo = 0;
      let io = 0;
      for (const g of geoms) {
        const p = g.attributes.position.array;
        const n = g.attributes.normal.array;
        const u = g.attributes.uv.array;
        pos.set(p, vo * 3);
        nor.set(n, vo * 3);
        uv.set(u, vo * 2);
        const count = g.attributes.position.count;
        if (g.index) {
          const gi = g.index.array;
          for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
          io += gi.length;
        } else {
          for (let k = 0; k < count; k++) idx[io + k] = vo + k;
          io += count;
        }
        vo += count;
        g.dispose();
      }
      merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      merged.setIndex(new THREE.BufferAttribute(idx, 1));
      return merged;
    };

    const seats = new THREE.Mesh(mergeGeoms(seatGeoms), standMat);
    seats.receiveShadow = false;
    this.group.add(seats);

    const risers = new THREE.Mesh(mergeGeoms(riserGeoms), riserMat);
    this.group.add(risers);

    const cols = new THREE.Mesh(mergeGeoms(colGeoms), concMat);
    this.group.add(cols);

    const roofs = new THREE.Mesh(mergeGeoms(roofGeoms), roofMat);
    roofs.castShadow = true;
    this.group.add(roofs);

    // Floodlight pylons
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x3a4356, roughness: 0.6, metalness: 0.4 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff8e6 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = sx * (PITCH.halfW + 24);
        const pz = sz * (PITCH.halfL + 20);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 34, 8), pylonMat);
        pole.position.set(px, 17, pz);
        this.group.add(pole);
        const rig = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 0.7), pylonMat);
        rig.position.set(px, 34, pz);
        this.group.add(rig);
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 2; j++) {
            const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.9, 0.16), lampMat);
            lamp.position.set(px - 3.6 + i * 1.45, 33.2 + j * 1.3, pz + sz * 0.5);
            lamp.rotation.y = sz > 0 ? Math.PI : 0;
            this.group.add(lamp);
          }
        }
      }
    }
  }
}

function makeBoardTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d');
  const cols = ['#101826', '#1f5dd8', '#ffd23f', '#101826', '#d92b3a', '#101826', '#20a06a'];
  const seg = c.width / cols.length;
  cols.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(i * seg, 0, seg, c.height);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fillRect(i * seg + 8, 12, seg - 16, 6);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(i * seg + 8, 28, seg * 0.55, 8);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.needsUpdate = true;
  return tex;
}

export { makeBallTexture };
