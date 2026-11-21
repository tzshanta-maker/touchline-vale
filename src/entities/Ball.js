import * as THREE from 'three';
import { BALL, PITCH } from '../config.js';
import { makeBallTexture } from '../world/Textures.js';

const POST_R = 0.08;

export class Ball {
  constructor(scene) {
    this.pos = new THREE.Vector3(0, BALL.radius, 0);
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3(0, 0, 0);
    this.owner = null;
    this.lastTouch = null;
    this.lastKicker = null;
    this.kickLock = 0;
    this.events = [];
    this.grounded = true;
    this.spinAxis = new THREE.Vector3(1, 0, 0);
    this.spinSpeed = 0;
    this.rollAngle = 0;
    this.stuckTimer = 0;

    const tex = makeBallTexture();
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 22, 16),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.02 })
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL.radius * 1.5, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    // A soft ring that highlights the ball while it is loose
    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(BALL.radius * 1.9, BALL.radius * 2.6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false })
    );
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = 0.045;
    scene.add(this.halo);
  }

  get speed() {
    return this.vel.length();
  }

  get planarSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, BALL.radius, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.owner = null;
    this.lastTouch = null;
    this.lastKicker = null;
    this.kickLock = 0;
    this.grounded = true;
    this.spinSpeed = 0;
    this.stuckTimer = 0;
    this.events.length = 0;
    this.syncMesh(1);
  }

  /**
   * Kick the ball.
   * @param {THREE.Vector3} dir normalised (y used for lift)
   * @param {number} power  m/s
   * @param {object} opts { lift, spin, by }
   */
  kick(dir, power, { lift = 0, by = null } = {}) {
    const d = dir.clone();
    d.y = 0;
    if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
    d.normalize();
    this.vel.set(d.x * power, lift, d.z * power);
    if (this.vel.length() > BALL.maxSpeed) this.vel.setLength(BALL.maxSpeed);
    this.owner = null;
    this.lastTouch = by;
    this.lastKicker = by;
    this.kickLock = 0.22;
    this.prevPos.copy(this.pos);
    this.stuckTimer = 0;
    this.throwIn = false; // any kick ends the throw-in exemption window
    this.spinSpeed = power * 0.55;
    this.spinAxis.set(d.z, 0, -d.x).normalize();
  }

  /** Remove any owner (used for restarts). */
  release() {
    this.owner = null;
  }

  /** Keep the ball at the dribbler's feet. */
  followOwner(dt, player) {
    const fwd = player.forward(new THREE.Vector3());
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const lead = BALL.radius + 0.34 + Math.min(0.34, speed * 0.045);
    const target = new THREE.Vector3(
      player.pos.x + fwd.x * lead,
      BALL.radius + (player.charging ? 0 : 0.02),
      player.pos.z + fwd.z * lead
    );
    // smooth blend so the ball looks nudged rather than glued
    const k = 1 - Math.exp(-22 * dt);
    this.prevPos.copy(this.pos);
    this.pos.lerp(target, k);
    this.vel.set(player.vel.x, 0, player.vel.z);
    this.grounded = true;
    this.spinSpeed = Math.hypot(this.vel.x, this.vel.z) / BALL.radius;
    this.spinAxis.set(this.vel.z, 0, -this.vel.x).normalize();
  }

  update(dt) {
    this.prevPos.copy(this.pos);
    this.kickLock = Math.max(0, this.kickLock - dt);
    this.events.length = 0;

    if (this.owner) {
      this.followOwner(dt, this.owner);
      this.syncMesh(1);
      return this.events;
    }

    // --- integrate ---
    this.vel.y -= BALL.gravity * dt;

    // quadratic air drag
    const sp = this.vel.length();
    if (sp > 0.01) {
      const drag = 0.0075 * sp;
      this.vel.multiplyScalar(Math.max(0, 1 - drag * dt));
    }

    this.pos.addScaledVector(this.vel, dt);

    // --- ground ---
    if (this.pos.y <= BALL.radius) {
      this.pos.y = BALL.radius;
      if (this.vel.y < -0.9) {
        this.vel.y = -this.vel.y * BALL.bounce;
        this.vel.x *= BALL.bounceGrip;
        this.vel.z *= BALL.bounceGrip;
        this.events.push({ type: 'bounce', power: Math.abs(this.vel.y) });
      } else {
        this.vel.y = 0;
      }
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // --- rolling resistance ---
    if (this.grounded) {
      const planar = Math.hypot(this.vel.x, this.vel.z);
      if (planar > 0.02) {
        const decel = (0.85 + planar * 0.24) * dt;
        const factor = Math.max(0, (planar - decel) / planar);
        this.vel.x *= factor;
        this.vel.z *= factor;
        this.spinSpeed = planar / BALL.radius;
        this.spinAxis.set(this.vel.z, 0, -this.vel.x).normalize();
      } else {
        this.vel.x = 0;
        this.vel.z = 0;
        this.spinSpeed = 0;
      }
    } else {
      this.spinSpeed *= 0.995;
    }

    this.collideBounds();
    this.collidePosts();

    // roll the mesh
    if (this.spinSpeed > 0.001) {
      this.rollAngle += this.spinSpeed * dt;
    }

    // anti-stuck: nudge a motionless ball back into play if outside the lines
    const outside =
      Math.abs(this.pos.x) > PITCH.halfW + 2 || Math.abs(this.pos.z) > PITCH.halfL + 2;
    if (outside && this.planarSpeed < 0.4) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.7) {
        this.vel.set(-Math.sign(this.pos.x || 1) * 6, 1.5, -Math.sign(this.pos.z || 1) * 6);
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }

    this.syncMesh(1);
    return this.events;
  }

  collideBounds() {
    const r = BALL.radius;
    const halfW = PITCH.halfW;
    const halfL = PITCH.halfL;
    const mouthHalf = PITCH.goalWidth / 2 - r * 0.15;

    // Side lines: the ball is out of play once it has fully crossed the line,
    // so play stops for a throw-in (see Game.onTouchline).
    if (Math.abs(this.pos.x) > halfW - r) {
      const nearGoal = Math.abs(this.pos.z) > halfL - 0.4;
      const fullyOver = Math.abs(this.pos.x) > halfW + r;
      if (fullyOver) {
        this.events.push({ type: 'touchline', side: Math.sign(this.pos.x) });
      } else if (nearGoal) {
        // corner region: still in play until it is fully over
        this.events.push({ type: 'touchline', side: Math.sign(this.pos.x) });
      }
    }

    // Goal lines
    const zSign = Math.sign(this.pos.z) || 1;
    if (Math.abs(this.pos.z) > halfL - r) {
      const inMouth = Math.abs(this.pos.x) < mouthHalf && this.pos.y < PITCH.goalHeight - r * 0.5;
      if (inMouth) {
        // Ball is inside the goal: stop it in the netting
        const netZ = halfL + PITCH.goalDepth;
        if (Math.abs(this.pos.z) > netZ - r) {
          this.pos.z = zSign * (netZ - r);
          this.vel.z = -this.vel.z * 0.22;
          this.vel.x *= 0.5;
          this.vel.y *= 0.35;
        }
        if (Math.abs(this.pos.z) > halfL + r * 1.2) {
          this.events.push({ type: 'goal', side: zSign > 0 ? 'home' : 'away' });
        }
      } else if (Math.abs(this.pos.z) > halfL) {
        this.events.push({ type: 'goalline' });
        // keep it just off the line but let the game restart play
        this.pos.z = zSign * Math.min(Math.abs(this.pos.z), halfL + 1.2);
      }
    }

    // Very high ball: keep it inside the stadium
    if (this.pos.y > 26) {
      this.pos.y = 26;
      this.vel.y = -Math.abs(this.vel.y) * 0.4;
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -halfW - 6, halfW + 6);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -halfL - PITCH.goalDepth - 0.4, halfL + PITCH.goalDepth + 0.4);
  }

  collidePosts() {
    const r = BALL.radius;
    const halfW = PITCH.goalWidth / 2;
    for (const side of [-1, 1]) {
      const gz = side * PITCH.halfL;
      // vertical posts
      for (const sx of [-1, 1]) {
        const px = sx * halfW;
        if (this.pos.y < PITCH.goalHeight + 0.2) {
          const dx = this.pos.x - px;
          const dz = this.pos.z - gz;
          const d = Math.hypot(dx, dz);
          const minD = r + POST_R;
          if (d < minD && d > 1e-4) {
            const nx = dx / d;
            const nz = dz / d;
            this.pos.x = px + nx * minD;
            this.pos.z = gz + nz * minD;
            const vn = this.vel.x * nx + this.vel.z * nz;
            if (vn < 0) {
              this.vel.x -= 2 * vn * nx * 0.86;
              this.vel.z -= 2 * vn * nz * 0.86;
              this.events.push({ type: 'post' });
            }
          }
        }
      }
      // crossbar
      const dz = this.pos.z - gz;
      if (Math.abs(this.pos.x) < halfW + r && Math.abs(dz) < r + POST_R) {
        const dy = this.pos.y - PITCH.goalHeight;
        if (Math.abs(dy) < r + POST_R) {
          const ny = Math.sign(dy) || 1;
          this.pos.y = PITCH.goalHeight + ny * (r + POST_R);
          if (Math.sign(this.vel.y) !== ny) this.vel.y *= -0.7;
          this.vel.z *= 0.5;
          this.events.push({ type: 'post' });
        }
      }
    }
  }

  syncMesh(alpha) {
    const x = this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha;
    const y = this.prevPos.y + (this.pos.y - this.prevPos.y) * alpha;
    const z = this.prevPos.z + (this.pos.z - this.prevPos.z) * alpha;
    this.mesh.position.set(x, y, z);
    if (this.spinSpeed > 0.001) {
      const q = new THREE.Quaternion().setFromAxisAngle(this.spinAxis, this.rollAngle);
      this.mesh.quaternion.copy(q);
    }
    this.shadow.position.set(x, 0.022, z);
    const h = Math.max(0, y - BALL.radius);
    const s = THREE.MathUtils.clamp(1 - h * 0.03, 0.45, 1);
    this.shadow.scale.setScalar(s);
    this.shadow.material.opacity = 0.3 * s;
    this.halo.position.set(x, 0.045, z);
    const loose = !this.owner;
    this.halo.visible = loose;
    if (loose) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.004);
      // a faint, steady ring so the ball stays readable without looking like a flare
      this.halo.material.opacity = 0.07 + pulse * 0.05;
    }
  }
}
