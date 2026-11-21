import * as THREE from 'three';
import { PLAYER } from '../config.js';

const TAU = Math.PI * 2;

export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function rotateTowards(current, target, maxStep) {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

let nextId = 0;

const DEFAULT_STATS = {
  pace: 70,
  shooting: 70,
  passing: 72,
  dribbling: 70,
  defending: 70,
  physical: 72,
};

export class Player {
  constructor({ team, index, role, number, name, isGK = false, stats = null, overall = null, slot = null, line = null, wide = false }) {
    this.id = nextId++;
    this.team = team;
    this.index = index;
    this.role = role;
    this.number = number;
    this.name = name;
    this.isGK = isGK;
    this.stats = { ...DEFAULT_STATS, ...(stats || {}) };
    this.overall = overall ?? 70;
    this.slot = slot;
    this.line = line || (isGK ? 'gk' : 'mid');
    this.wide = wide;
    this.statMods = Player.deriveMods(this.stats, isGK);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.prevPos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.moveDir = new THREE.Vector3(0, 0, 0);
    this.facing = 0;
    this.prevFacing = 0;
    this.homePos = new THREE.Vector3();
    this.aiTarget = new THREE.Vector3();

    this.stamina = 100;
    this.exhausted = false;
    this.wantsSprint = false;
    this.charging = false;
    this.kickCooldown = 0;
    this.tackleCooldown = 0;
    this.stunTimer = 0;
    this.claimTimer = 0; // GK holding the ball
    this.protectTimer = 0; // brief ball protection after winning possession
    this.contactCooldown = 0; // limits how often a defender can nick the ball
    this.touchCooldown = 0; // first-touch window after cushioning a pass
    this.rouletteTimer = 0; // skill move: 360 spin while keeping the ball
    this.rouletteCooldown = 0;
    this.rouletteSpin = 0;
    this.diveTimer = 0;
    this.saveCooldown = 0;
    this.failSaveTimer = 0;
    this.diveDir = 0;
    this.celebrateTimer = 0;

    this.speedMult = 1;
    this.model = null;
    this.isControlled = false;
    this.aiRole = 'shape';
  }

  get teamId() {
    return this.team.id;
  }

  /**
   * Converts 0-99 attributes into gameplay multipliers.
   * All of them are centred so an average (70) player behaves like before.
   */
  static deriveMods(stats, isGK = false) {
    const s = { ...DEFAULT_STATS, ...stats };
    const norm = (v) => (v - 70) / 30; // -1.2 .. 0.9 for 34..97
    const r2 = (v) => Math.round(v * 1000) / 1000;
    return {
      // raw top speed
      pace: r2(1 + norm(s.pace) * 0.13),
      // how much speed is kept while dribbling
      dribble: r2(1 + norm(s.dribbling) * 0.07),
      // stamina drain multiplier (lower is better)
      stamina: r2(1 - norm(s.physical) * 0.22),
      // passing error multiplier (lower is better)
      pass: r2(1 - norm(s.passing) * 0.35),
      // shooting accuracy multiplier (lower is better)
      shot: r2(1 - norm(s.shooting) * 0.4),
      // shot power multiplier
      shotPower: r2(1 + norm(s.shooting) * 0.11),
      // tackling multiplier
      defend: r2(1 + norm(s.defending) * 0.28),
      // goalkeeper reach multiplier
      gk: r2(1 + norm(isGK ? s.defending : s.defending) * 0.16),
      // how well they keep the ball when challenged
      hold: r2(1 + norm(s.dribbling) * 0.2),
    };
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  get hasBall() {
    return this.team.game.ball.owner === this;
  }

  setPosition(x, z, facing = 0) {
    this.pos.set(x, 0, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.prevFacing = facing;
    if (this.model) {
      this.model.group.position.set(x, 0, z);
      this.model.group.rotation.y = facing;
    }
  }

  resetStamina(value = 100) {
    this.stamina = value;
    this.exhausted = false;
  }

  /** Steer toward a world position; `arrive` slows down near the target. */
  moveToward(target, { sprint = false, stopDistance = 0.35, arrive = 2.6 } = {}) {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < stopDistance) {
      this.moveDir.set(0, 0, 0);
      this.wantsSprint = false;
      return dist;
    }
    this.moveDir.set(dx / dist, 0, dz / dist);
    const slow = dist < arrive ? Math.max(0.25, dist / arrive) : 1;
    this.wantsSprint = sprint && dist > 2.5 && !this.exhausted && slow > 0.9;
    if (slow < 1) this.moveDir.multiplyScalar(1);
    this.moveScale = slow;
    return dist;
  }

  /**
   * Roulette (double-tap sprint): a 360 degree spin that keeps the ball glued
   * to your feet and briefly shields it from challenges.
   */
  startRoulette(duration = 0.62) {
    if (this.rouletteCooldown > 0 || this.rouletteTimer > 0) return false;
    this.rouletteTimer = duration;
    this.rouletteDuration = duration;
    this.rouletteCooldown = duration + 0.45;
    this.rouletteSpin = 0;
    // spin the way the player is already moving, otherwise to the left
    const d = this.moveDir.lengthSq() > 0.01 ? this.moveDir : this.forward(new THREE.Vector3());
    this.rouletteAngle = Math.atan2(d.x, d.z) + Math.PI; // keep curving forward
    this.stamina = Math.max(0, this.stamina - 5);
    return true;
  }

  get isRouletting() {
    return this.rouletteTimer > 0;
  }

  stopMoving() {
    this.moveDir.set(0, 0, 0);
    this.moveScale = 1;
    this.wantsSprint = false;
  }

  update(dt) {
    this.prevPos.copy(this.pos);
    this.prevFacing = this.facing;

    // --- skill move: follow a tight curve while spinning 360 degrees ---
    if (this.rouletteTimer > 0) {
      const t = 1 - this.rouletteTimer / (this.rouletteDuration || 0.62);
      this.rouletteSpin = t * Math.PI * 2;
      // sweep the movement direction around a full circle, faster at the start
      const sweep = t * Math.PI * 2;
      const a = this.rouletteAngle + sweep;
      this.moveDir.set(Math.sin(a), 0, Math.cos(a));
      this.moveScale = 0.85;
      this.wantsSprint = false;
      this.facing = a; // the body turns with the curve -> visible spin on the model
      if (this.hasBall) this.protectTimer = Math.max(this.protectTimer, 0.2);
    }

    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.tackleCooldown = Math.max(0, this.tackleCooldown - dt);
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    this.claimTimer = Math.max(0, this.claimTimer - dt);
    this.diveTimer = Math.max(0, this.diveTimer - dt);
    this.saveCooldown = Math.max(0, this.saveCooldown - dt);
    this.celebrateTimer = Math.max(0, this.celebrateTimer - dt);
    this.protectTimer = Math.max(0, this.protectTimer - dt);
    this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    this.touchCooldown = Math.max(0, this.touchCooldown - dt);
    this.rouletteCooldown = Math.max(0, this.rouletteCooldown - dt);
    this.rouletteTimer = Math.max(0, this.rouletteTimer - dt);

    const dirLen = this.moveDir.length();
    const charging = this.charging && !!this.hasBall;
    const mods = this.statMods;
    let maxSpeed;
    if (this.wantsSprint && !this.exhausted && this.stamina > 0) {
      maxSpeed = PLAYER.sprintSpeed * this.speedMult * mods.pace;
      if (this.hasBall) maxSpeed *= (PLAYER.dribbleSpeedFactor + 0.04) * mods.dribble;
    } else {
      maxSpeed = PLAYER.maxSpeed * this.speedMult * mods.pace;
      if (this.hasBall) maxSpeed *= PLAYER.dribbleSpeedFactor * mods.dribble;
    }
    if (charging) maxSpeed *= PLAYER.chargeSlowFactor;
    if (this.stunTimer > 0) maxSpeed *= 0.25;
    if (this.claimTimer > 0) maxSpeed = 0;
    const scale = this.moveScale ?? 1;
    maxSpeed *= scale;

    const targetVX = dirLen > 0.001 ? (this.moveDir.x / dirLen) * maxSpeed : 0;
    const targetVZ = dirLen > 0.001 ? (this.moveDir.z / dirLen) * maxSpeed : 0;

    const desiredX = targetVX - this.vel.x;
    const desiredZ = targetVZ - this.vel.z;
    const desiredLen = Math.hypot(desiredX, desiredZ);
    const accel = dirLen > 0.001 ? PLAYER.accel : PLAYER.decel;
    const maxDelta = accel * dt;
    if (desiredLen > 1e-5) {
      const k = Math.min(1, maxDelta / desiredLen);
      this.vel.x += desiredX * k;
      this.vel.z += desiredZ * k;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Facing follows movement direction
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (dirLen > 0.001 && speed > 0.15) {
      const targetFacing = Math.atan2(this.vel.x, this.vel.z);
      const turnRate = speed > PLAYER.maxSpeed * 0.75 ? PLAYER.turnRateSprint : PLAYER.turnRate;
      this.facing = rotateTowards(this.facing, targetFacing, turnRate * dt);
    }

    // Stamina
    if (speed > 2.4 && this.wantsSprint && !this.exhausted) {
      this.stamina -= (PLAYER.staminaDrain + speed * 0.35) * this.statMods.stamina * dt;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
      }
    } else {
      this.stamina = Math.min(
        100,
        this.stamina + PLAYER.staminaRegen * (2 - this.statMods.stamina) * dt
      );
      if (this.exhausted && this.stamina > 22) this.exhausted = false;
    }
    this.stamina = Math.max(0, Math.min(100, this.stamina));
    this.moveScale = 1;
  }

  /**
   * Pushes the simulation state onto the 3D model.
   * `alpha` interpolates between the previous and current step (1 = current),
   * `dt` drives the run-cycle animation.
   */
  sync(alpha = 1, showSelection = false, dt = 1 / 60) {
    if (!this.model) return;
    const g = this.model.group;
    if (!g.visible) return; // substitutes waiting on the bench
    const x = this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha;
    const z = this.prevPos.z + (this.pos.z - this.prevPos.z) * alpha;
    g.position.set(x, 0, z);
    g.rotation.y = this.prevFacing + angleDelta(this.prevFacing, this.facing) * alpha;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const lean = THREE.MathUtils.clamp(-angleDelta(this.prevFacing, this.facing) * 6, -1, 1);
    if (this.rouletteTimer > 0) {
      // extra flourish: the torso leans into the spin
      this.model.root.rotation.z = Math.sin(this.rouletteSpin) * 0.22;
    }
    this.model.animate(Math.min(dt, 1 / 20), speed, lean, this.charging && this.hasBall);
    if (this.isControlled !== showSelection) {
      this.isControlled = showSelection;
      this.model.setSelected(showSelection);
    }
    if (this.isGK && this.diveTimer > 0) {
      this.model.root.rotation.z = this.diveDir * (this.diveTimer / 0.55) * 1.15;
      this.model.root.position.y = Math.sin((this.diveTimer / 0.55) * Math.PI) * 0.15;
    } else if (this.model.root.rotation.z !== 0 && !this.charging) {
      this.model.root.rotation.z *= 0.85;
    }
  }
}
