import * as THREE from 'three';
import { makeNumberTexture } from '../world/Textures.js';

/* Shared geometry so 22 players stay cheap to render */
const GEO = {
  torso: new THREE.CapsuleGeometry(0.20, 0.42, 4, 10),
  hip: new THREE.CylinderGeometry(0.19, 0.165, 0.26, 10),
  thigh: new THREE.CapsuleGeometry(0.093, 0.36, 3, 8),
  shin: new THREE.CapsuleGeometry(0.077, 0.36, 3, 8),
  boot: new THREE.BoxGeometry(0.14, 0.085, 0.26),
  upperArm: new THREE.CapsuleGeometry(0.067, 0.26, 3, 8),
  foreArm: new THREE.CapsuleGeometry(0.058, 0.24, 3, 8),
  head: new THREE.SphereGeometry(0.135, 14, 12),
  hair: new THREE.SphereGeometry(0.142, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  neck: new THREE.CylinderGeometry(0.06, 0.07, 0.09, 8),
  number: new THREE.PlaneGeometry(0.36, 0.36),
  ring: new THREE.RingGeometry(0.42, 0.56, 28),
  chevron: new THREE.ConeGeometry(0.16, 0.3, 3),
};

const SKIN = [0xd9a982, 0xb07c52, 0x8a5a36, 0xf0c9a6, 0x6e4326, 0xc99472];
const HAIR = [0x2a1d16, 0x101014, 0x5a3a1e, 0x8c6a3c, 0x1f1a1a];

const matCache = new Map();
function kitMat(color, opts = {}) {
  const key = `${color}-${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    matCache.set(
      key,
      new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02, ...opts })
    );
  }
  return matCache.get(key);
}

export class PlayerModel {
  constructor(team, player) {
    this.group = new THREE.Group();
    this.root = new THREE.Group(); // animated bob/tilt
    this.group.add(this.root);

    const skin = SKIN[(player.number + (team.id === 'away' ? 3 : 0)) % SKIN.length];
    const hair = HAIR[player.number % HAIR.length];

    const jersey = kitMat(team.primary);
    const shortsMat = kitMat(team.shorts);
    const sockMat = kitMat(team.socks);
    const bootMat = kitMat(0x14161d);
    const skinMat = kitMat(skin, { roughness: 0.85 });
    const hairMat = kitMat(hair, { roughness: 0.95 });

    // Torso
    const torso = new THREE.Mesh(GEO.torso, jersey);
    torso.position.y = 1.19;
    torso.castShadow = true;
    this.root.add(torso);

    // Collar / trim
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.028, 6, 14), kitMat(team.secondary));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.46;
    this.root.add(collar);

    // Hips
    const hips = new THREE.Mesh(GEO.hip, shortsMat);
    hips.position.y = 0.9;
    hips.castShadow = true;
    this.root.add(hips);

    // Number on the back
    const numTex = makeNumberTexture(player.number, '#ffffff', '#0d1420');
    const numMesh = new THREE.Mesh(
      GEO.number,
      new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false })
    );
    numMesh.position.set(0, 1.24, -0.205);
    numMesh.rotation.y = Math.PI;
    numMesh.scale.setScalar(0.8);
    this.root.add(numMesh);

    // Head + neck
    const neck = new THREE.Mesh(GEO.neck, skinMat);
    neck.position.y = 1.5;
    this.root.add(neck);
    const head = new THREE.Mesh(GEO.head, skinMat);
    head.position.y = 1.63;
    head.castShadow = true;
    this.root.add(head);
    const cap = new THREE.Mesh(GEO.hair, hairMat);
    cap.position.y = 1.635;
    cap.rotation.x = -0.12;
    this.root.add(cap);

    // Arms (pivot at shoulder)
    this.arms = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.245, 1.4, 0);
      const upper = new THREE.Mesh(GEO.upperArm, jersey);
      upper.position.y = -0.16;
      upper.castShadow = true;
      const fore = new THREE.Mesh(GEO.foreArm, skinMat);
      fore.position.y = -0.46;
      const gloveMat = player.isGK ? kitMat(team.accent, { roughness: 0.6 }) : skinMat;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), gloveMat);
      hand.position.y = -0.62;
      pivot.add(upper, fore, hand);
      pivot.rotation.z = side * 0.16;
      this.root.add(pivot);
      return pivot;
    });

    // Legs (pivot at hip)
    this.legs = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.115, 0.84, 0);
      const thigh = new THREE.Mesh(GEO.thigh, skinMat);
      thigh.position.y = -0.23;
      thigh.castShadow = true;
      const shin = new THREE.Mesh(GEO.shin, sockMat);
      shin.position.y = -0.63;
      shin.castShadow = true;
      const boot = new THREE.Mesh(GEO.boot, bootMat);
      boot.position.set(0, -0.86, 0.06);
      boot.castShadow = true;
      pivot.add(thigh, shin, boot);
      this.root.add(pivot);
      return pivot;
    });

    // Ground marker ring in team colour
    const ringMat = new THREE.MeshBasicMaterial({
      color: team.accent,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(GEO.ring, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.group.add(this.ring);

    // Selection chevron (only visible for the controlled player)
    this.chevron = new THREE.Mesh(
      GEO.chevron,
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95 })
    );
    this.chevron.rotation.x = Math.PI;
    this.chevron.position.y = 2.25;
    this.chevron.visible = false;
    this.group.add(this.chevron);

    this.animPhase = Math.random() * Math.PI * 2;
    this.team = team;
  }

  setSelected(selected) {
    this.chevron.visible = selected;
    this.ring.material.opacity = selected ? 0.95 : 0.3;
    this.ring.material.color.set(selected ? 0xffe066 : this.team.accent);
    this.ring.scale.setScalar(selected ? 1.15 : 1);
  }

  /**
   * @param {number} dt
   * @param {number} speed horizontal speed m/s
   * @param {number} lean lean factor -1..1 (turning)
   * @param {boolean} charging shot charge pose
   */
  animate(dt, speed, lean = 0, charging = false) {
    this.animPhase += dt * (2.2 + speed * 1.55);
    const stride = Math.min(1, speed / 7.6);
    const sin = Math.sin(this.animPhase);
    const cos = Math.cos(this.animPhase);

    this.legs[0].rotation.x = sin * stride * 1.05;
    this.legs[1].rotation.x = -sin * stride * 1.05;
    this.arms[0].rotation.x = -sin * stride * 0.9;
    this.arms[1].rotation.x = sin * stride * 0.9;

    const bob = Math.abs(cos) * stride * 0.055;
    this.root.position.y = bob;
    this.root.rotation.z = lean * 0.12;
    this.root.rotation.x = stride * 0.1 + (charging ? 0.08 : 0);

    if (charging) {
      this.legs[1].rotation.x = -0.55;
      this.arms[0].rotation.x = 0.6;
    }
    if (speed < 0.25) {
      // Idle breathing
      this.root.position.y = Math.sin(this.animPhase * 0.5) * 0.012;
    }
    if (this.chevron.visible) {
      this.chevron.position.y = 2.25 + Math.sin(this.animPhase * 0.8) * 0.07;
      this.chevron.rotation.y += dt * 2.2;
    }
  }
}
