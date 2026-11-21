import * as THREE from 'three';
import {
  PITCH,
  BALL,
  PLAYER,
  MATCH,
  TEAMS,
  CAMERA,
  cameraPreset,
  DIFFICULTY,
  FORMATIONS,
  MAX_SUBS,
} from '../config.js';
import { Stadium } from '../world/Stadium.js';
import { PlayerModel } from '../entities/PlayerModel.js';
import { Player } from '../entities/Player.js';
import { Ball } from '../entities/Ball.js';
import { buildSquad, formationWorld, randomFormation, roleLine } from '../entities/teams.js';
import { TeamAI } from '../ai/TeamAI.js';

const clamp = THREE.MathUtils.clamp;
const TAU = Math.PI * 2;

const V = () => new THREE.Vector3();

export class Game {
  constructor({ canvas, input, ui, settings }) {
    this.canvas = canvas;
    this.input = input;
    this.ui = ui;
    this.settings = settings;

    this.state = 'idle';
    this.time = 0;
    this.dt = 0;
    this.paused = false;
    this.running = false;

    this.cameraMode = settings.camera || 'action';
    this._camFwd = new THREE.Vector3(0, 0, -1);
    this.camPos = new THREE.Vector3(0, 26, -36);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camGoalTimer = 0;

    this._initRenderer();
    this._initScene();
    this._initTeams();
    this._initCamera();
    this._bindResize();

    this.lastTime = performance.now() / 1000;
    this.accumulator = 0;
    this.loopFrozen = false; // tests flip this to drive the sim by hand
    this.onHud = null;
    this.onEvent = null;

    /* ---- throw-ins ---- */
    this.throwIn = null; // active throw-in descriptor (see beginThrowIn)
    this.throwInRing = null; // highlight ring around the selected receiver
    this.noOffsideFromThrow = null; // throw-ins can never be offside

    /* ---- defensive assists (sprint auto-tackle, press, second man, GK) ---- */
    this.autoTackleCooldown = 0;
    this.autoTackleCount = 0;
    this.chasing = false;
    this.pressing = false;
    this.secondManTimer = 0;
    this.secondManTarget = null;
    this.gkRushTimer = 0;
  }

  /* ================================================================ */
  /* Setup                                                            */
  /* ================================================================ */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.stadium = new Stadium(this.scene, this.renderer);
    this.ball = new Ball(this.scene);
    this.ball.setOwner = (p) => {
      this.ball.owner = p;
    };
  }

  _initTeams() {
    const homeSquad = buildSquad('home', this.settings.formation);
    const awaySquad = buildSquad('away', randomFormation(this.settings.formation, 7));
    const squads = { home: homeSquad, away: awaySquad };

    const makeTeam = (key, direction, isHuman) => ({
      game: this,
      id: key,
      def: TEAMS[key],
      direction,
      mirror: key === 'home' ? 1 : -1,
      score: 0,
      isHuman,
      difficulty: DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal,
      players: [], // the eleven on the pitch (slot order)
      bench: [], // available substitutes
      subsMade: 0,
      formation: squads[key].formation,
      gk: null,
      possessionTime: 0,
    });

    this.home = makeTeam('home', 1, true);
    this.away = makeTeam('away', -1, false);
    this.teams = [this.home, this.away];

    for (const team of this.teams) {
      const squad = squads[team.id];
      const makePlayer = (desc, isBench) => {
        const player = new Player({
          team,
          index: desc.index,
          role: desc.role,
          number: desc.number,
          name: desc.name,
          isGK: desc.isGK,
          stats: desc.stats,
          overall: desc.overall,
          slot: desc.slot,
          line: desc.line,
          wide: desc.wide,
        });
        player.model = new PlayerModel(team.def, player);
        player.model.group.visible = !isBench;
        this.scene.add(player.model.group);
        return player;
      };
      squad.starters.forEach((desc) => team.players.push(makePlayer(desc, false)));
      squad.bench.forEach((desc) => team.bench.push(makePlayer(desc, true)));
      team.gk = team.players.find((p) => p.isGK) || team.players[0];
      team.ai = new TeamAI(this, team);
    }
    this.humanTeam = this.home;
    this.opponentTeam = this.away;
    this.controlled = null;
    this.lastScorer = null;
    this.lastScoringTeam = null;
    this.score = { home: 0, away: 0 };
    this.celebrateTimer = 0;
    this.freezeTimer = 0;
    this.half = 1;
    this.halfElapsed = 0;
    this.halfSeconds = 60 * this.settings.halfMinutes;
    this.matchSeconds = 0;
    this.addedTime = 0;
    this.kickoffTeam = this.home;
    this.restart = null;
    this.charge = 0;
    this.charging = false;
    this.autoSwitchTimer = 0;
    this.switchCooldown = 0;
    this.lastGoalAt = -99;
    this.stats = { shots: { home: 0, away: 0 }, saves: { home: 0, away: 0 } };
    this.heldInputs = { shoot: false };
    this.restartGrace = 0;
    this.throwTimer = 0;
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, 0.5, 420);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  _bindResize() {
    this._onResize = () => {
      const parent = this.canvas.parentElement || document.body;
      const w = parent.clientWidth || window.innerWidth;
      const h = parent.clientHeight || window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      // widen the FOV on portrait screens so the pitch still fits
      const baseFov = cameraPreset(this.cameraMode).fov;
      this.camera.fov = this.camera.aspect < 1 ? baseFov + 14 : baseFov;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  /* ================================================================ */
  /* Match lifecycle                                                  */
  /* ================================================================ */
  startMatch(settings = this.settings) {
    this.settings = settings;
    this.halfMinutes = settings.halfMinutes;
    this.halfSeconds = 60 * settings.halfMinutes;
    this.half = 1;
    this.halfElapsed = 0;
    this.matchSeconds = 0;
    this.home.score = 0;
    this.away.score = 0;
    this.score.home = 0;
    this.score.away = 0;
    this.home.direction = 1;
    this.home.mirror = 1;
    this.away.direction = -1;
    this.away.mirror = -1;
    this.home.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    this.away.difficulty = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    // Line-ups: the human team uses the chosen formation, the AI rolls one each match
    this.resetSquads();
    this.applyFormation(this.home, settings.formation || '4-3-3');
    const awayFormation = randomFormation(settings.formation, Math.floor(Math.random() * 1e6));
    this.applyFormation(this.away, awayFormation);
    for (const team of this.teams) {
      const speedMult = team.isHuman ? 1 : team.difficulty.speed;
      for (const p of team.players.concat(team.bench)) {
        p.speedMult = speedMult;
        p.resetStamina(100);
      }
    }
    this.stats = { shots: { home: 0, away: 0 }, saves: { home: 0, away: 0 } };
    this.lastScorer = null;
    this.lastScoringTeam = null;
    this.kickoffTeam = this.home;
    this.restart = null;
    this.charge = 0;
    this.charging = false;
    this.resetThrowInState();
    this.autoTackleCooldown = 0;
    this.autoTackleCount = 0;
    this.chasing = false;
    this.pressing = false;
    this.secondManTimer = 0;
    this.secondManTarget = null;
    this.gkRushTimer = 0;
    this.input.clear();
    this.paused = false;
    this.running = true;
    this.state = 'kickoff';
    this.setupKickoff(this.home);
    this.freezeTimer = MATCH.kickoffDelay;
    this.ui?.showHud(true);
    this.ui?.setScore(this.home, this.away);
    this.updateHud(true);
  }

  restartMatch() {
    this.startMatch(this.settings);
  }

  /** Puts the original eleven back on the pitch in slot order. */
  resetSquads() {
    for (const team of this.teams) {
      const all = team.players.concat(team.bench).sort((a, b) => a.index - b.index);
      team.players = all.slice(0, 11);
      team.bench = all.slice(11);
      for (const p of team.players) {
        p.model.group.visible = true;
        p.model.setSelected(false);
        p.stopMoving();
        p.stunTimer = 0;
        p.claimTimer = 0;
      }
      for (const p of team.bench) {
        p.model.group.visible = false;
        p.subbedOut = false;
      }
      for (const p of team.players) p.subbedOut = false;
      team.gk = team.players.find((p) => p.isGK) || team.players[0];
      team.players.forEach((p, i) => (p.slotIndex = i));
      team.subsMade = 0;
    }
  }

  /**
   * Assigns formation slots to the eleven players (index order == slot order).
   * Safe to call between matches or mid-match (takes effect at the next kickoff).
   */
  applyFormation(team, key) {
    const formation = FORMATIONS[key] ? key : '4-3-3';
    const slots = FORMATIONS[formation].slots;
    team.formation = formation;
    team.players.forEach((p, i) => {
      const slot = slots[i];
      if (!slot) return;
      p.role = slot.role;
      p.slot = slot;
      p.line = slot.line;
      p.wide = !!slot.wide;
      p.slotIndex = i;
      p.isGK = slot.role === 'GK';
    });
    team.gk = team.players.find((p) => p.isGK) || team.players[0];
    return formation;
  }

  formationName(team) {
    return FORMATIONS[team.formation]?.label || team.formation;
  }

  /** Auto substitutions: tired legs make way for the bench. */
  handleSubstitutions(force = false) {
    if (this.state === 'idle') return;
    let changed = false;
    for (const team of this.teams) {
      if (team.subsMade >= MAX_SUBS || !team.bench.some((b) => !b.subbedOut)) continue;
      const tired = team.players
        .filter((p) => !p.isGK)
        .sort((a, b) => a.stamina - b.stamina)[0];
      if (!tired) continue;
      const threshold = force ? 55 : 30;
      if (tired.stamina > threshold) continue;
      changed = this.makeSubstitution(team, tired) || changed;
    }
    return changed;
  }

  makeSubstitution(team, outPlayer) {
    if (team.subsMade >= MAX_SUBS) return false;
    const idx = team.players.indexOf(outPlayer);
    if (idx < 0 || outPlayer.isGK) return false;
    if (!team.bench.length) return false;

    // pick the substitute whose natural position fits the vacant role best.
    // Players who have already come off are not eligible to return.
    const familyOf = (role) => roleLine(role);
    let benchIdx = -1;
    let bestFit = -Infinity;
    team.bench.forEach((b, i) => {
      if (b.subbedOut) return;
      const fit = familyOf(b.role) === familyOf(outPlayer.role) ? 2 : b.isGK ? -5 : 0;
      const score = fit - (100 - b.overall) * 0.01;
      if (score > bestFit) {
        bestFit = score;
        benchIdx = i;
      }
    });
    if (benchIdx < 0) return false;
    const incoming = team.bench.splice(benchIdx, 1)[0];

    // inherit the vacated slot and position
    incoming.role = outPlayer.role;
    incoming.slot = outPlayer.slot;
    incoming.line = outPlayer.line;
    incoming.wide = outPlayer.wide;
    incoming.slotIndex = outPlayer.slotIndex;
    incoming.isGK = outPlayer.isGK;
    incoming.setPosition(outPlayer.pos.x, outPlayer.pos.z, outPlayer.facing);
    incoming.prevPos.copy(incoming.pos);
    incoming.resetStamina(100);
    incoming.stunTimer = 0;
    incoming.kickCooldown = 0;
    incoming.tackleCooldown = 0;
    incoming.claimTimer = 0;
    incoming.model.group.visible = true;
    incoming.model.setSelected(false);

    outPlayer.model.group.visible = false;
    outPlayer.model.setSelected(false);
    outPlayer.stopMoving();
    outPlayer.resetStamina(100);
    outPlayer.charging = false;

    if (this.ball.owner === outPlayer) {
      this.ball.owner = incoming;
      this.ball.lastTouch = incoming;
    }
    team.players[idx] = incoming;
    outPlayer.subbedOut = true; // sits on the bench, cannot come back on
    team.bench.push(outPlayer);
    team.subsMade += 1;
    if (team.isHuman && this.controlled === outPlayer) this.setControlled(incoming);
    if (this.lastScorer === outPlayer) this.lastScorer = incoming;

    this.ui?.showSubstitution?.(team, incoming, outPlayer);
    return true;
  }

  /** Difficulty can be changed from the pause menu and takes effect at once. */
  applyDifficulty(key) {
    const d = DIFFICULTY[key] || DIFFICULTY.normal;
    this.settings.difficulty = key;
    this.home.difficulty = d;
    this.away.difficulty = d;
    for (const p of this.away.players) p.speedMult = d.speed;
    for (const p of this.home.players) p.speedMult = 1;
  }

  setPaused(paused) {
    this.paused = paused;
    this.lastTime = performance.now() / 1000;
    this.accumulator = 0;
  }

  /* ================================================================ */
  /* Kickoff & restarts                                               */
  /* ---------------------------------------------------------------- */
  /* The ball is dropped at the centre spot, every player is placed in  */
  /* its own half, and play begins with possession for `team`.          */
  /* ================================================================ */
  /**
   * A real kick-off, the way a football game should stage it:
   *
   *  - the ball sits dead on the centre spot, nobody owns it yet;
   *  - every player is in his own half, in formation;
   *  - nobody except the two kickers may be inside the centre circle;
   *  - opponents cannot touch the ball (or the taker) until the kick is taken,
   *    and they hold their marks at the circle instead of charging in;
   *  - the taker starts beside the ball with a partner behind him for the
   *    short lay-off every real kick-off is built on.
   *
   * `team` is the side that kicks off; `this.kickoffTaker` and
   * `this.kickoffPartner` are the two players inside the circle.
   */
  setupKickoff(team) {
    this.ball.reset(0, 0);
    this.ball.mesh.position.set(0, BALL.radius, 0);
    this.ball.owner = null;

    const circle = PITCH.circleRadius + 0.7; // a stride outside the whitewash
    const dir = team.direction;

    // Who takes it and who drops in behind. Chosen before the loop so the
    // placement below can leave them room inside the circle.
    const taker =
      team.players.find((p) => p.line === 'fwd' && !p.wide) ||
      team.players.find((p) => p.line === 'fwd') ||
      team.players[9];
    const partner =
      team.players.find((p) => p.line === 'mid' && !p.wide && p !== taker) ||
      team.players.find((p) => p.line === 'mid' && p !== taker) ||
      team.players[6];
    this.kickoffTaker = taker;
    this.kickoffPartner = partner;

    for (const t of this.teams) {
      const td = t.direction;
      const facing = td > 0 ? 0 : Math.PI;
      for (const p of t.players) {
        let x;
        let z;
        if (p.isGK) {
          x = 0;
          z = -td * (PITCH.halfL - 2);
        } else {
          const base = formationWorld(p.slot, td, t.mirror, V());
          // Own half, and shallower the further forward the line is: a kick-off
          // starts with everyone behind the ball, not spread over the pitch.
          const depth = p.line === 'def' ? 30 : p.line === 'mid' ? 17 : 8;
          z = -td * Math.min(Math.abs(base.z), depth);
          x = clamp(base.x * 0.9, -PITCH.halfW + 4, PITCH.halfW - 4);
          // Only the two kickers are allowed inside the centre circle.
          if (p !== taker && p !== partner) {
            const r = Math.hypot(x, z);
            if (r < circle) {
              const k = circle / Math.max(0.001, r);
              x *= k;
              z *= k;
            }
          }
        }
        p.setPosition(x, z, facing);
        // Remember every player's kick-off spot: the defending team holds it
        // until the ball has actually been kicked.
        p.kickoffAnchor = new THREE.Vector3(x, 0, z);
        p.resetStamina(100);
        p.kickCooldown = 0;
        p.tackleCooldown = 0;
        p.stunTimer = 0;
        p.claimTimer = 0;
        p.charging = false;
        p.moveDir.set(0, 0, 0);
      }
    }

    // The two kickers: taker on the ball, partner behind and to the side.
    const side = taker.slot.x >= 0 ? 1 : -1;
    taker.setPosition(0, -dir * 0.55, dir > 0 ? 0 : Math.PI);
    partner.setPosition(
      side * 2.2 * (team.mirror || 1),
      -dir * 2.6,
      dir > 0 ? 0 : Math.PI
    );
    taker.kickoffAnchor.set(taker.pos.x, 0, taker.pos.z);
    partner.kickoffAnchor.set(partner.pos.x, 0, partner.pos.z);

    this.kickoffGuard = 0;
    this.kickoffRoutine = 0;
    this.setControlled(
      team.isHuman
        ? taker
        : this.humanTeam.players.find((p) => p.line === 'fwd') || this.humanTeam.players[6]
    );
    this.snapCamera();
  }

  /**
   * The whistle. The ball is handed to the taker but the opponents are told to
   * hold their marks until it has been played, exactly as the law (and every
   * football game) does it. An AI kick-off lays the ball back square to the
   * partner after a beat, instead of running off with it.
   */
  resolveKickoff() {
    this.state = 'play';
    this.ball.owner = this.kickoffTaker;
    this.ball.lastTouch = this.kickoffTaker;
    this.kickoffTaker.kickCooldown = 0.2;
    this.kickoffGuard = 1.6;
    this.kickoffRoutine = this.kickoffTeam.isHuman ? 0 : 0.55;
    if (this.kickoffTeam.isHuman && this.settings.autoSwitch !== false) {
      this.setControlled(this.kickoffTaker);
    }
    this.ui?.sound?.whistle?.(false);
  }

  /**
   * While the guard is up the defending team may not enter the centre circle
   * and cannot win the ball. It clears the moment the taker plays it.
   */
  updateKickoffGuard(dt) {
    if (!(this.kickoffGuard > 0)) return;
    this.kickoffGuard -= dt;
    const taker = this.kickoffTaker;
    const stillHolding =
      this.ball.owner === taker || (this.ball.lastTouch === taker && this.ball.owner === null);
    if (!taker || !stillHolding || this.state !== 'play') {
      this.kickoffGuard = 0;
      return;
    }
    // Push any opponent who has drifted inside the circle back to the edge; the
    // human may run in, but the taker is untouchable until the ball is played.
    const r = PITCH.circleRadius + 0.5;
    for (const t of this.teams) {
      if (t === this.kickoffTeam) continue;
      for (const p of t.players) {
        if (p.isGK || p === this.controlled) continue;
        const x = p.pos.x;
        const z = p.pos.z;
        const d = Math.hypot(x, z);
        if (d < r) {
          const k = r / Math.max(0.001, d);
          p.pos.x = x * k;
          p.pos.z = z * k;
        }
      }
    }
  }

  /** The kick-off lay-off: an AI taker squares it to his partner. */
  updateKickoffRoutine(dt) {
    if (!(this.kickoffRoutine > 0)) return;
    this.kickoffRoutine -= dt;
    if (this.kickoffRoutine > 0 || this.state !== 'play') return;
    this.kickoffRoutine = 0;
    const taker = this.kickoffTaker;
    const partner = this.kickoffPartner;
    if (!taker || !partner || this.ball.owner !== taker) return;
    // Only ever a short square ball backwards into our own half.
    const dz = partner.pos.z - taker.pos.z;
    const dx = partner.pos.x - taker.pos.x;
    if (Math.hypot(dx, dz) > 14) return;
    this.aiPass(taker, partner, { power: 0.8 });
    taker.kickCooldown = PLAYER.kickCooldown;
  }

  beginRestart(type, team, x, z, extra = {}) {
    if (type === 'throwIn') {
      this.beginThrowIn(team, Math.sign(x) || 1, z);
      return;
    }
    this.state = 'restart';
    this.restart = { type, team, x, z, ...extra };
    this.freezeTimer = MATCH.restartFreeze + 0.5;
    this.ball.release();
    this.ball.reset(x, z);
    this.charge = 0;
    this.charging = false;
    // players drift back to their shape during the short freeze
    for (const t of this.teams) {
      for (const p of t.players) {
        if (p.isGK) continue;
        const base = formationWorld(p.slot, t.direction, t.mirror, V());
        const targetZ = clamp(base.z, -PITCH.halfL + 5, PITCH.halfL - 5);
        p.setPosition(base.x, targetZ, t.direction > 0 ? 0 : Math.PI);
      }
    }
    // Place the restarting player next to the ball
    const taker = this._nearestPlayerTo(team, new THREE.Vector3(x, 0, z), true);
    if (taker) {
      const offset = 0.8;
      taker.setPosition(x - Math.sign(x || 1) * (type === 'throwIn' ? 0.9 : 0), 0, z);
      if (type !== 'throwIn') taker.setPosition(x, z + (team.direction > 0 ? -offset : offset));
      taker.facing = Math.atan2(-x, team.direction);
      this.restartTaker = taker;
    }
    if (type === 'goalKick' && team.gk) {
      const gk = team.gk;
      const gx = 0;
      const gz = team.direction > 0 ? -(PITCH.halfL - 5.5) : PITCH.halfL - 5.5;
      gk.setPosition(gx, gz, team.direction > 0 ? 0 : Math.PI);
      this.restartTaker = gk;
    }
    // stoppage in play: a good moment to bring on fresh legs
    this.handleSubstitutions(false);
    this.snapCamera();
  }

  resolveRestart() {
    const r = this.restart;
    if (!r) return;
    const team = r.team;
    let taker = this.restartTaker;
    // a substitute may have replaced the taker in the meantime
    if (taker && !team.players.includes(taker)) taker = null;
    if (!taker) taker = this._nearestPlayerTo(team, new THREE.Vector3(r.x, 0, r.z), true);
    this.ball.reset(r.x, r.z);
    this.state = 'play';
    this.restart = null;
    this.restartGrace = 0.5;
    if (!taker) return;
    this.ball.owner = taker;
    this.ball.lastTouch = taker;
    taker.kickCooldown = 0.1;
    if (taker.isGK) {
      taker.claimTimer = 1.1;
      taker.hasReleased = false;
    }
    if (team.isHuman && this.settings.autoSwitch !== false) this.setControlled(taker);
    this.ui?.flashRestart?.(r.type, team);
  }

  /* ================================================================ */
  /* Main loop                                                        */
  /* ================================================================ */
  start() {
    this.running = true;
    this.lastTime = performance.now() / 1000;
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      this.frame();
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  /**
   * Fixed-timestep loop with catch-up substepping.
   * Keeping the physics step constant means the match runs at real-time speed
   * even on slow machines (up to 4 steps per frame), while never letting a
   * single step get large enough to destabilise collisions.
   */
  frame() {
    this.input?.poll?.(); // sample the gamepad before anything reads input
    this.input?.dispatchFrame?.(); // menus pick up pad edges here (edges still intact)
    // Automated tests freeze the loop and drive update() by hand; keep drawing.
    if (this.loopFrozen) {
      this.dt = 0;
      this.render();
      return;
    }
    const now = performance.now() / 1000;
    let raw = now - this.lastTime;
    this.lastTime = now;
    if (!Number.isFinite(raw) || raw < 0) raw = 0;
    raw = Math.min(raw, 0.25); // ignore huge gaps (tab was hidden, debugger paused…)

    const STEP = 1 / 60;
    const MAX_STEPS = 12; // 0.2 s of catch-up per frame: real-time pace down to ~5 fps
    const live = this.running && this.state !== 'idle' && !this.paused;

    if (live) {
      this.accumulator = (this.accumulator || 0) + raw;
      let steps = 0;
      while (this.accumulator >= STEP && steps < MAX_STEPS) {
        this.dt = STEP;
        this.update(STEP);
        this.input.endFrame(); // input edges are consumed by the first step only
        this.accumulator -= STEP;
        steps += 1;
      }
      if (this.accumulator > STEP * MAX_STEPS) this.accumulator = 0; // drop the backlog
      // no step ran this frame: keep the pending input edges for the next one
    } else {
      this.dt = raw;
      if (this.paused && this.state !== 'idle') this.updatePaused(raw);
      this.input.endFrame();
    }

    this.render();
  }

  updatePaused(dt) {
    // keep the camera gently alive while paused
    this.camera.lookAt(this.camLook);
    this.input.endFrame();
  }

  update(dt) {
    this.time += dt;
    this.updateInputActions();

    if (this.state === 'throwin') {
      this.updateThrowIn(dt);
      this.updateCamera(dt);
      this.updateHud();
      return;
    }

    if (this.state === 'kickoff' || this.state === 'restart' || this.state === 'halftime') {
      this.freezeTimer -= dt;
      for (const t of this.teams) t.ai.update(dt);
      if (this.freezeTimer <= 0) {
        if (this.state === 'kickoff') this.resolveKickoff();
        else if (this.state === 'restart') this.resolveRestart();
        else if (this.state === 'halftime') this.beginSecondHalf();
      }
      this.ball.update(dt);
      this.updateCamera(dt);
      this.updateHud();
      return;
    }

    if (this.state === 'celebrate') {
      this.celebrateTimer -= dt;
      for (const t of this.teams) t.ai.update(dt);
      for (const p of this.allPlayers()) p.update(dt);
      this.ball.update(dt);
      this.updateCamera(dt);
      this.updateHud();
      if (this.celebrateTimer <= 0) {
        if (this.halfElapsed >= this.halfSeconds) this.endHalf();
        else {
          this.state = 'kickoff';
          this.setupKickoff(this.kickoffTeam);
          this.freezeTimer = MATCH.kickoffDelay * 0.8;
          this.ui?.hideGoalBanner?.();
        }
      }
      return;
    }

    if (this.state === 'fulltime') {
      for (const p of this.allPlayers()) p.update(dt);
      this.ball.update(dt);
      this.updateCamera(dt);
      return;
    }

    // ---------------- live play ----------------
    this.halfElapsed += dt;
    this.matchSeconds += dt;

    this.restartGrace = Math.max(0, (this.restartGrace || 0) - dt);
    this.updateKickoffGuard(dt);
    this.updateKickoffRoutine(dt);
    this.updateHuman(dt);
    for (const t of this.teams) t.ai.update(dt);
    for (const p of this.allPlayers()) p.update(dt);

    this.updateSecondMan(dt);
    this.updateGkRush(dt);
    this.resolvePlayerCollisions();
    this.keepPlayersInBounds(dt);

    const events = this.ball.update(dt);
    this.updatePossession(dt);
    this.handleBallEvents(events);
    if (this.state === 'play') this.checkCarriedBallOutOfPlay();
    this.updateAutoSwitch(dt);
    this.updateCamera(dt);
    this.updateHud();

    if (this.ball.owner) {
      this.ball.owner.team.possessionTime += dt;
    }

    if (this.halfElapsed >= this.halfSeconds) {
      this.endHalf();
    }
  }

  allPlayers() {
    return this.home.players.concat(this.away.players);
  }

  endHalf() {
    this.resetThrowInState();
    if (this.half === 1) {
      this.state = 'halftime';
      this.freezeTimer = MATCH.halftimeDelay;
      this.ui?.showHalftime?.(this.score);
      this.ball.release();
    } else {
      this.state = 'fulltime';
      this.ball.release();
      this.ui?.showFullTime?.(this.home, this.away, this.stats);
    }
  }

  beginSecondHalf() {
    this.half = 2;
    this.halfElapsed = 0;
    // half time: freshen up any tired legs
    this.handleSubstitutions(true);
    // swap ends
    for (const t of this.teams) {
      t.direction *= -1;
    }
    this.ui?.hideHalftime?.();
    this.kickoffTeam = this.kickoffTeam === this.home ? this.away : this.home;
    this.state = 'kickoff';
    this.setupKickoff(this.kickoffTeam);
    this.freezeTimer = MATCH.kickoffDelay;
    this.ui?.setHalf?.(2);
  }

  /* ================================================================ */
  /* Input -> controlled player                                       */
  /* ================================================================ */
  updateInputActions() {
    const input = this.input;
    if (this.state !== 'play') return;

    const p = this.controlled;

    // Sprint skill (roulette). Three ways in, all landing on tryRoulette():
    //   * keyboard / controller: double-tap sprint (Shift, RB, RT),
    //   * touch: the pad sends a 'skill' action on a double-tap of SPRINT,
    //     which does not depend on frame timing the way press edges do.
    if (input.wasPressed('sprint')) {
      const now = this.matchSeconds;
      const quick = now - (this.lastSprintTap ?? -9) < 0.35;
      this.lastSprintTap = now;
      if (quick) this.tryRoulette();
    }
    if (input.wasPressed('skill')) this.tryRoulette();

    if (input.wasPressed('switch')) this.switchPlayer(true);
    if (input.wasPressed('pass')) this.humanPass(false);
    if (input.wasPressed('pass_long')) this.humanPass(false, { long: true });
    if (input.wasPressed('pass_loft')) this.humanPass(false, { loft: true });
    if (input.wasPressed('through')) this.humanPass(true);
    if (input.wasPressed('through_loft')) this.humanPass(true, { loft: true });
    if (input.wasPressed('tackle')) this.humanTackle();
    if (input.wasPressed('secondman')) this.callSecondMan();
    if (input.wasPressed('gk_rush')) this.gkRush();
    if (input.wasPressed('press')) this.pressing = true;

    const shooting = input.isDown('shoot');
    if (shooting && p && p.hasBall && !this.charging) {
      this.charging = true;
      this.charge = 0;
    }
    if (this.charging) {
      if (!p || !p.hasBall) {
        this.charging = false;
        this.charge = 0;
      } else if (shooting) {
        this.charge = Math.min(1, this.charge + this.dt / 0.85);
      } else {
        this.performShot(p, this.charge);
        this.charging = false;
        this.charge = 0;
      }
    }
    if (p) p.charging = this.charging;
    if (this.charge > 0) this.ui?.setPower?.(this.charge);
    else this.ui?.setPower?.(0);
  }

  /**
   * Maps the stick (screen space: x right, y up) onto the pitch using where the
   * camera is actually pointing, so "up" always means "away from the camera"
   * whichever view is selected. Behind-the-goal views resolve to exactly the old
   * fixed mapping; the side view would otherwise invert left/right and make the
   * stick feel broken.
   */
  screenToWorld(axis) {
    this.camera.getWorldDirection(this._camFwd);
    this._camFwd.y = 0;
    if (this._camFwd.lengthSq() < 1e-6) {
      const dir = this.humanTeam.direction;
      this._camFwd.set(0, 0, dir);
    }
    this._camFwd.normalize();
    // screen-right = up x forward, i.e. the camera's right-hand side on screen
    const rx = -this._camFwd.z;
    const rz = this._camFwd.x;
    const wx = this._camFwd.x * axis.y + rx * axis.x;
    const wz = this._camFwd.z * axis.y + rz * axis.x;
    return { x: wx, z: wz };
  }

  updateHuman(dt) {
    const p = this.controlled;
    if (!p) return;
    const axis = this.input.axis();
    // screen-space input -> world, using the active camera's heading
    const w = this.screenToWorld(axis);
    const wx = w.x;
    const wz = w.z;
    const len = Math.hypot(wx, wz);
    if (len > 0.02) {
      p.moveDir.set(wx / len, 0, wz / len);
      p.moveScale = Math.min(1, len);
      p.wantsSprint =
        this.input.isDown('sprint') &&
        !p.exhausted &&
        p.stamina > PLAYER.staminaSprintMin &&
        p.moveScale > 0.6;
    } else {
      p.stopMoving();
    }
    if (!p.hasBall) {
      // Slight magnetism toward a loose ball to make collecting it feel good
      const d = p.pos.distanceTo(this.ball.pos);
      if (!this.ball.owner && d < 3.2 && Math.abs(this.ball.pos.y) < 2) {
        const to = V().subVectors(this.ball.pos, p.pos).setY(0).normalize();
        p.moveDir.lerp(to, 0.35).normalize();
      }
    }
    // Sprint-to-chase, auto-tackle and press/contain (desktop, pad and touch)
    this.updateDefensiveAssist(dt, p);
  }

  /**
   * Defensive help for the human player, shared by every input device:
   *  - holding Sprint without the ball chases the carrier and, once in range,
   *    auto-attempts a normal tackle (never while our own team has the ball);
   *  - holding Press keeps the defender jockeying in front of the carrier.
   */
  updateDefensiveAssist(dt, p) {
    this.autoTackleCooldown = Math.max(0, this.autoTackleCooldown - dt);
    const carrier = this.ball.owner;
    const mine = !!carrier && carrier.team === this.humanTeam;
    const hasBall = p.hasBall;

    // own team in possession -> never chase or auto-tackle
    if (mine || hasBall) {
      this.chasing = false;
      this.pressing = false;
      return;
    }

    const sprinting = this.input.isDown('sprint');
    const pressing = this.pressing && this.input.isDown('press');
    const axis = this.input.axis();
    const steering = Math.hypot(axis.x, axis.y) > 0.25;

    if (sprinting) {
      const dest = carrier ? carrier.pos : this.ball.pos;
      const to = V().subVectors(dest, p.pos).setY(0);
      const dist = to.length();
      if (dist > 0.4) {
        to.normalize();
        // assist, don't hijack: partial blend while the player also steers
        p.moveDir.lerp(to, steering ? 0.4 : 0.95).normalize();
        p.moveScale = Math.max(p.moveScale, 0.9);
        p.wantsSprint = !p.exhausted && p.stamina > PLAYER.staminaSprintMin;
      }
      this.chasing = true;

      // context-sensitive auto tackle, with range + cooldown checks
      if (
        carrier &&
        carrier.team !== this.humanTeam &&
        !carrier.isGK &&
        this.autoTackleCooldown <= 0 &&
        p.tackleCooldown <= 0 &&
        p.stunTimer <= 0
      ) {
        const d = p.pos.distanceTo(carrier.pos);
        const toCarrier = V().subVectors(carrier.pos, p.pos).setY(0).normalize();
        const reachDir = p.moveDir.lengthSq() > 0.01 ? V().copy(p.moveDir).setY(0).normalize() : p.forward(V());
        const goalSide = carrier.team.direction * (p.pos.z - carrier.pos.z) >= -3.5; // not chasing from behind the goal
        if (d < PLAYER.tackleRange + 0.45 && reachDir.dot(toCarrier) > 0.05 && goalSide) {
          this.doPlayerTackle(p, carrier, { auto: true });
          this.autoTackleCooldown = 0.95;
          this.autoTackleCount += 1;
          this.ui?.flashAutoTackle?.(p);
        }
      }
      this.pressing = false;
      return;
    }
    this.chasing = false;

    if (pressing) {
      this.pressing = true;
      if (carrier && carrier.team !== this.humanTeam) {
        const to = V().subVectors(carrier.pos, p.pos).setY(0);
        const d = to.length();
        if (d > 1.2) {
          to.normalize();
          p.moveDir.lerp(to, 0.55).normalize();
          p.moveScale = Math.max(p.moveScale, 0.75);
        } else {
          p.stopMoving();
        }
      }
      return;
    }
    this.pressing = false;
  }

  setControlled(player) {
    if (!player) return;
    if (this.controlled === player) return;
    if (this.controlled) this.controlled.model?.setSelected(false);
    this.controlled = player;
    player.model?.setSelected(true);
    this.charge = 0;
    this.charging = false;
  }

  /**
   * The sprint skill: a roulette that keeps the ball glued to your feet while
   * it spins past a challenge. Only fires with the ball at your feet, and the
   * player has his own cooldown so it cannot be spammed.
   */
  tryRoulette() {
    const p = this.controlled;
    if (!p || !p.hasBall) return false;
    // cooldown / already spinning: silently ignored, so a mash never spams a label
    if (!p.startRoulette()) return false;
    this.ui?.flashSkill?.('ROULETTE');
    if (this.settings.sound) this.ui?.sound?.kick?.(0.15);
    return true;
  }

  switchPlayer(cycle = false) {
    const candidates = this.humanTeam.players.filter((p) => !p.isGK || p === this.controlled);
    if (!candidates.length) return;
    const sorted = candidates
      .slice()
      .sort((a, b) => a.pos.distanceTo(this.ball.pos) - b.pos.distanceTo(this.ball.pos));
    let next;
    if (cycle) {
      const idx = sorted.indexOf(this.controlled);
      next = sorted[(idx + 1) % sorted.length];
    } else {
      next = sorted[0];
    }
    this.setControlled(next);
    this.ui?.flashSwitch?.(next);
  }

  updateAutoSwitch(dt) {
    if (this.settings.autoSwitch === false) return;
    if (this.state !== 'play') return;
    const ball = this.ball;
    this.switchCooldown = Math.max(0, (this.switchCooldown || 0) - dt);
    if (this.switchCooldown > 0) return;

    // We won the ball: take control of the player who has it.
    if (ball.owner && ball.owner.team === this.humanTeam) {
      if (ball.owner !== this.controlled && !ball.owner.isGK) {
        this.autoSwitchTimer += dt;
        if (this.autoSwitchTimer > 0.1) {
          this.setControlled(ball.owner);
          this.autoSwitchTimer = 0;
          this.switchCooldown = 0.5;
        }
      }
      return;
    }

    // They have the ball (or it is loose): defend with the closest teammate, so
    // control never sits on a striker 40 m from the play.
    const nearest = this._nearestPlayerTo(this.humanTeam, ball.pos, false);
    if (!nearest) return;
    const current = this.controlled;
    if (!current || current === nearest) return;
    const nearestD = nearest.pos.distanceTo(ball.pos);
    const currentD = current.pos.distanceTo(ball.pos);
    const betterOption = ball.owner ? nearestD + 6 < currentD : nearestD + 4 < currentD;
    if (betterOption && currentD > 5) {
      this.autoSwitchTimer += dt;
      if (this.autoSwitchTimer > 0.45) {
        this.setControlled(nearest);
        this.autoSwitchTimer = 0;
        this.switchCooldown = 1.1;
      }
    } else {
      this.autoSwitchTimer = 0;
    }
  }

  /* Possession & ball contact                                        */
  /* ================================================================ */
  updatePossession(dt) {
    const ball = this.ball;
    if (ball.owner) {
      const owner = ball.owner;
      if (owner.stunTimer > 0) {
        ball.release();
        return;
      }
      if (owner.isGK) return; // keepers are not dispossessed by contact
      if (owner.protectTimer > 0) return; // just won it — brief protection

      // An opponent in close contact can nick the ball, but only occasionally:
      // this keeps possession changes believable instead of pinball.
      for (const opp of this.opponentOf(owner.team).players) {
        if (opp.stunTimer > 0 || opp.isGK || opp.contactCooldown > 0) continue;
        const d = Math.hypot(opp.pos.x - owner.pos.x, opp.pos.z - owner.pos.z);
        if (d > 1.18) continue;
        opp.contactCooldown = 1.05;
        let chance = owner.team.isHuman
          ? 0.34 * opp.team.difficulty.press + 0.14
          : 0.3 + 0.22 * opp.team.difficulty.tackleChance;
        // coming from behind is a foul-ish nudge and rarely wins the ball cleanly
        const fromBehind = (opp.pos.z - owner.pos.z) * owner.team.direction < -0.2;
        if (fromBehind) chance *= 0.6;
        if (Math.random() < chance) {
          this.giveBall(opp, owner);
          owner.stunTimer = 0.22;
          owner.moveDir.set(0, 0, 0);
          return;
        }
      }
      return;
    }

    // Loose ball: find the closest player able to control it
    let best = null;
    let bestD = Infinity;
    for (const p of this.allPlayers()) {
      if (p.stunTimer > 0) continue;
      const dx = p.pos.x - ball.pos.x;
      const dz = p.pos.z - ball.pos.z;
      const d = Math.hypot(dx, dz);
      const canCatch = ball.planarSpeed < BALL.capturableSpeed && ball.pos.y < 1.9;
      // Keepers can only grab what a keeper could realistically reach
      if (p.isGK) {
        if (!this._inOwnBox(p)) continue;
        if (ball.pos.y > 2.35) continue;
        // A shot hitting the keeper's body / gloves. The AI keeper's silhouette
        // is smaller and he does not stop everything that hits him, so a shot
        // into the middle of the goal can still squirm in.
        const blockR = p.team.isHuman ? 0.72 : 0.46;
        if (d < blockR && ball.planarSpeed > 15 && p.saveCooldown <= 0) {
          const holds = p.team.isHuman ? true : Math.random() < p.team.difficulty.gkSave + 0.15;
          if (holds) {
            this.gkSave(p, { fromShot: true });
            return;
          }
        }
        // A struck shot is not a loose ball: only the keeper's save logic
        // decides whether he gets to it, so a shot can beat him.
        if (ball.planarSpeed > 12 && d > 0.4) continue;
        const gkRadius = ball.planarSpeed < 11 ? 1.15 : 0.62;
        if (d < gkRadius && d < bestD) {
          if (ball.kickLock > 0 && ball.lastKicker === p) continue;
          best = p;
          bestD = d;
        }
        continue;
      }
      if (canCatch && d < BALL.trapRadius && d < bestD) {
        if (ball.kickLock > 0 && ball.lastKicker === p) continue;
        best = p;
        bestD = d;
      }
    }
    if (best) {
      this.giveBall(best, ball.lastTouch);
      return;
    }

    // --- first touch -------------------------------------------------------
    // A player meeting a moving ball cushions it into their control instead of
    // letting it ping off their body. A clean trap takes the ball; a poor one
    // leaves it a couple of metres away — but it never just bounces away.
    const contactR = PLAYER.radius + BALL.radius + 0.22;
    if (ball.planarSpeed > 1.5 && ball.pos.y < 2.4) {
      let toucher = null;
      let touchD = Infinity;
      for (const p of this.allPlayers()) {
        if (p.stunTimer > 0 || p.touchCooldown > 0) continue;
        // A keeper does not simply "trap" a struck shot with his body: fast
        // balls are his save logic's job (above), so they can beat him.
        if (p.isGK && ball.planarSpeed > 12) continue;
        const d = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
        if (d > contactR) continue;
        if (ball.kickLock > 0 && ball.lastKicker === p) continue;
        if (d < touchD) {
          toucher = p;
          touchD = d;
        }
      }
      if (toucher) {
        this.firstTouch(toucher);
        return;
      }
    }
  }

  /**
   * First touch / reception. `quality` comes from the receiving player's
   * passing attribute: elite technicians kill the ball dead, weaker players
   * take a heavier touch that stays in play.
   */
  firstTouch(player) {
    const ball = this.ball;
    const speed = ball.planarSpeed;
    const height = ball.pos.y;
    player.touchCooldown = 0.22;
    ball.lastTouch = player;
    ball.lastKicker = player;

    // No time to control a rocket: it clips off the body
    if (speed > 27 || height > 2.1) {
      const dx = ball.pos.x - player.pos.x;
      const dz = ball.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const nx = dx / d;
      const nz = dz / d;
      const vn = ball.vel.x * nx + ball.vel.z * nz;
      if (vn < 0) {
        ball.vel.x -= 2 * vn * nx * 0.6;
        ball.vel.z -= 2 * vn * nz * 0.6;
        ball.pos.x = player.pos.x + nx * (PLAYER.radius + BALL.radius + 0.05);
        ball.pos.z = player.pos.z + nz * (PLAYER.radius + BALL.radius + 0.05);
        ball.kickLock = 0.12;
        this.ui?.flashContact?.();
      }
      return;
    }

    // Body shape: meeting the ball front-on is easier than being hit in the back
    const fwd = player.forward(V());
    const incoming = V().copy(ball.vel).setY(0);
    if (incoming.lengthSq() > 0.01) incoming.normalize();
    const facingBall = -fwd.dot(incoming); // 1 = ball coming straight at the chest
    const control = clamp(1.45 - (player.statMods?.pass ?? 1), 0.35, 1.15);
    const pace = speed < 15 ? 1 : speed < 22 ? 0.82 : 0.6;
    let quality = control * (0.62 + 0.38 * clamp(facingBall, 0, 1)) * pace;
    quality = clamp(player.isGK ? 1 : quality, 0.12, 1);

    if (player.hasBall || Math.random() < quality) {
      // clean trap: kill the pace, take the ball
      ball.vel.set(0, 0, 0);
      ball.pos.y = BALL.radius;
      this.giveBall(player);
      player.touchCooldown = 0.35;
      this.ui?.flashReceive?.(player);
      return;
    }

    // heavy touch: the ball squirts a couple of metres into the player's path
    const angle = player.facing + (Math.random() - 0.5) * 1.1;
    const push = 2.4 + Math.random() * 2.2;
    ball.vel.set(Math.sin(angle) * push, 0.5, Math.cos(angle) * push);
    ball.pos.x = player.pos.x + Math.sin(angle) * (PLAYER.radius + BALL.radius + 0.05);
    ball.pos.z = player.pos.z + Math.cos(angle) * (PLAYER.radius + BALL.radius + 0.05);
    ball.kickLock = 0.18;
    player.stunTimer = Math.max(player.stunTimer, 0.1);
    this.ui?.flashContact?.();
  }

  _inOwnBox(p) {
    const own = this.ownGoal(p.team);
    return (
      Math.abs(p.pos.z - own.z) < PITCH.penaltyDepth + 1 &&
      Math.abs(p.pos.x) < PITCH.penaltyWidth / 2 + 1
    );
  }

  giveBall(player, from = null) {
    const ball = this.ball;
    ball.throwIn = false; // a touch ends the throw-in exemption
    if (player.isGK) {
      // A keeper collecting a fast-moving ball counts as a save
      if (ball.planarSpeed > 9 && !ball.owner) {
        this.stats.saves[player.team.id] += 1;
        this.ui?.flashSave?.(player, true);
      }
      ball.owner = player;
      ball.vel.set(0, 0, 0);
      player.claimTimer = 1.15;
      player.hasReleased = false;
      this.ui?.flashSave?.(player);
      return;
    }
    ball.owner = player;
    ball.vel.set(player.vel.x, 0, player.vel.z);
    ball.grounded = true;
    ball.lastTouch = player;
    player.protectTimer = 0.45;
    void from;
  }

  /* ================================================================ */
  /* Kicking                                                          */
  /* ================================================================ */
  performShot(player, charge) {
    if (player.kickCooldown > 0) return;
    const power = clamp(0.18 + charge * 0.82, 0.18, 1);
    const goal = this.attackGoal(player.team);
    const dist = Math.hypot(goal.x - player.pos.x, goal.z - player.pos.z);
    const mods = player.statMods;
    // striking technique: better shooters hit harder and stray less
    const speed = (15 + power * 17) * mods.shotPower;
    const skillErr = (player.team.isHuman ? 0.5 : player.team.difficulty.shotError * 2.4) * mods.shot;
    const errScale = (0.35 + (1 - power) * 1.2 + dist * 0.018) * skillErr;

    const aimHalf = PITCH.goalWidth / 2 - 0.45;
    const human = player.team.isHuman && this.controlled === player;
    let target;

    if (human) {
      // --- aim assist -----------------------------------------------------
      // You shoot where you are pointing. The closer that is to the goal, the
      // more the assist pulls the strike toward the far corner and tightens
      // the spread; pointing away from goal gives a straight directional hit.
      const aimDir = this.humanAimDir(player);
      const toGoal = V().subVectors(goal, player.pos).setY(0).normalize();
      const align = aimDir.dot(toGoal);
      if (align > -0.2) {
        const gk = this.opponentOf(player.team).players.find((q) => q.isGK);
        const gkX = gk ? gk.pos.x : 0;
        const side = gkX >= 0 ? -1 : 1; // aim away from the keeper
        const cornerX = clamp(side * aimHalf * (0.7 + Math.random() * 0.22), -aimHalf, aimHalf);
        const assist = clamp((align + 0.2) / 1.0, 0, 1);
        const intended = V().set(
          player.pos.x + aimDir.x * 26,
          1.0,
          player.pos.z + aimDir.z * 26
        );
        const aimPoint = V().set(cornerX, 0.5 + Math.random() * 1.3, goal.z);
        target = intended.lerp(aimPoint, clamp(0.6 + assist * 0.35, 0, 0.95));
        const err = errScale * (1 - assist * 0.72);
        target.x = clamp(target.x + randn() * err, -aimHalf - 1.2, aimHalf + 1.2);
        target.y = clamp(target.y + randn() * err * 0.35, 0.25, PITCH.goalHeight - 0.15);
        // a little body turn so the animation matches the strike
        if (align > 0.25) {
          player.facing = Math.atan2(aimDir.x, aimDir.z);
          player.prevFacing = player.facing;
        }
      } else {
        target = V().set(
          player.pos.x + aimDir.x * 24,
          0.75,
          player.pos.z + aimDir.z * 24
        );
        target.x += randn() * errScale * 0.4;
      }
    } else {
      const side = Math.random() > 0.5 ? 1 : -1;
      const aimX = clamp(
        side * aimHalf * (0.62 + Math.random() * 0.42) + randn() * errScale * 0.7,
        -aimHalf,
        aimHalf
      );
      const aimY = clamp(0.4 + Math.random() * 1.6 + randn() * errScale * 0.25, 0.25, PITCH.goalHeight - 0.2);
      target = V().set(aimX, aimY, goal.z);

      // If the shooter is not facing the goal the AI turns to shoot properly
      const fwd = player.forward(V());
      const toGoal = V().subVectors(target, player.pos).setY(0).normalize();
      if (fwd.dot(toGoal) < 0.12) {
        player.facing = Math.atan2(toGoal.x, toGoal.z);
        player.prevFacing = player.facing;
        target.set(aimX, clamp(aimY, 0.3, PITCH.goalHeight - 0.3), goal.z);
      }
    }

    this.launchBall(player, target, speed, { arc: 'shot', err: 0 });
    player.kickCooldown = PLAYER.kickCooldown;
    if (human) player.stamina = Math.max(0, player.stamina - 1.5);
    this.stats.shots[player.team.id] += 1;
    this.ui?.flashShoot?.(power);
    if (this.settings.sound) this.ui?.sound?.kick?.(power);
  }

  /** Direction/power helper computing a ballistic launch toward a point. */
  launchBall(player, target, speed, { arc = 'ground' } = {}) {
    const ball = this.ball;
    const dx = target.x - ball.pos.x;
    const dz = target.z - ball.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const dir = V().set(dx / dist, 0, dz / dist);
    let lift = 0;
    if (arc === 'shot' || arc === 'lob') {
      const t = dist / Math.max(6, speed);
      const dy = (target.y ?? 0.6) - ball.pos.y;
      lift = clamp((dy + 0.5 * BALL.gravity * t * t) / t, -1, arc === 'lob' ? 12 : 8);
    } else {
      lift = Math.min(0.8, dist * 0.008);
    }
    ball.kick(dir, speed, { lift, by: player });
  }

  /**
   * Aim direction in world space from the human's input.
   * Uses the right stick when pushed, otherwise the run direction. Falls back
   * to the player's body orientation when there is no input at all.
   */
  humanAimDir(player, out = V()) {
    const aim = this.input.aim();
    const dir = player.team.direction;
    // screen-space -> world (the camera sits behind our own goal)
    const wx = -dir * aim.x;
    const wz = dir * aim.y;
    const len = Math.hypot(wx, wz);
    if (len < 0.22) {
      // No aim input: use facing, but nudge it toward the attacking goal so a
      // standing player still passes somewhere sensible.
      const fwd = player.forward(V());
      const goal = this.attackGoal(player.team);
      const toGoal = V().subVectors(goal, player.pos).setY(0).normalize();
      return out.copy(fwd).lerp(toGoal, 0.25).setY(0).normalize();
    }
    return out.set(wx / len, 0, wz / len);
  }

  /**
   * Human pass.
   * @param {boolean} through through-ball request
   * @param {object} opts { long, loft } — touch pads can ask for a long or a
   *   lofted/crossed ball without losing the aim assist of a normal pass.
   */
  humanPass(through, { long = false, loft = false } = {}) {
    const p = this.controlled;
    if (!p || !p.hasBall || p.kickCooldown > 0) return;
    const aimDir = this.humanAimDir(p);
    const option = this.bestPassOption(p, { human: true, through, aimDir });
    const wantLoft = loft || long;
    if (!option) {
      // Nobody in the cone: play it into the space you are aiming at.
      const dist = through ? 26 : long ? 30 : 16;
      const target = V().set(
        p.pos.x + aimDir.x * dist,
        wantLoft ? 1.6 : 0.3,
        p.pos.z + aimDir.z * dist
      );
      target.x = clamp(target.x, -PITCH.halfW + 1.5, PITCH.halfW - 1.5);
      target.z = clamp(target.z, -PITCH.halfL + 1.5, PITCH.halfL - 1.5);
      this.launchBall(p, target, through ? 22 : long ? 26 : 17, {
        arc: wantLoft ? 'lob' : 'ground',
      });
      p.kickCooldown = PLAYER.kickCooldown;
      this.pendingReceiver = null;
      this.ui?.flashPass?.(wantLoft ? 'lofted' : 'short');
      if (this.settings.sound) this.ui?.sound?.kick?.(0.25);
      return;
    }
    this.passTo(p, option.target, {
      through: option.through,
      power: option.power * (long ? 1.45 : 1),
      loft: wantLoft,
    });
    this.ui?.flashPass?.(wantLoft ? 'lofted' : 'short');
  }

  aiPass(p, targetPlayer, { through = false, power = 1 } = {}) {
    if (p.kickCooldown > 0) return;
    const err = p.team.difficulty.passError;
    this.passTo(p, targetPlayer, { through, power, error: err * 0.35 });
  }

  passTo(p, target, { through = false, power = 1, error = 0, loft = false } = {}) {
    const ball = this.ball;
    // a good passer finds their man more often
    error *= p.statMods?.pass ?? 1;
    // human passes get aim assist: the weight is tuned so it lands at the
    // receiver's feet even when they are moving, and error is halved
    const assisted = p.team.isHuman && this.controlled === p;
    if (assisted) error *= 0.5;
    const lead = through ? 9 : assisted ? 3.4 : 2.2;
    const dirZ = p.team.direction;
    const aim = V().copy(target.pos);
    if (through) {
      aim.z += dirZ * lead;
      aim.x += target.vel.x * 0.35;
      aim.z += target.vel.z * 0.35;
    } else {
      aim.x += target.vel.x * 0.22;
      aim.z += target.vel.z * 0.22;
    }
    aim.x += (Math.random() - 0.5) * error;
    aim.z += (Math.random() - 0.5) * error * 0.7;
    aim.x = clamp(aim.x, -PITCH.halfW + 1.2, PITCH.halfW - 1.2);
    aim.z = clamp(aim.z, -PITCH.halfL + 1.2, PITCH.halfL - 1.2);

    const dist = Math.hypot(aim.x - ball.pos.x, aim.z - ball.pos.z);
    let speed = clamp(7.5 + dist * 0.72, 8, 27) * clamp(power, 0.5, 1.35);
    if (through) speed = clamp(speed * 1.05, 12, 29);
    const speedWithError = speed * (1 + (Math.random() - 0.5) * error * 0.05);
    this.launchBall(
      p,
      V().set(aim.x, through || loft ? 0.9 : 0.2, aim.z),
      speedWithError,
      { arc: through || loft ? 'lob' : 'ground' }
    );
    if (loft) {
      // a lofted/crossed ball: float it in rather than drilling it
      const dir = V().subVectors(aim, ball.pos).setY(0).normalize();
      ball.vel.set(dir.x * speedWithError * 0.86, clamp(3.2 + dist * 0.1, 3.4, 8.5), dir.z * speedWithError * 0.86);
      this.ui?.flashLoft?.(target);
    }
    // Through balls use a modest arc so they stay playable
    if (through) {
      const dir = V().subVectors(aim, ball.pos).setY(0).normalize();
      ball.vel.set(dir.x * speedWithError, clamp(1.6 + dist * 0.075, 1.8, 6.2), dir.z * speedWithError);
    }
    p.kickCooldown = PLAYER.kickCooldown;
    this.pendingReceiver = target;
    this.ui?.flashPass?.(target);
    if (this.settings.sound) this.ui?.sound?.kick?.(0.28);
  }

  /**
   * Best pass option for a player: open teammates with a clear lane.
   * For the human player the aim direction dominates the scoring, so the pass
   * goes where you are pointing — the assist only picks the best teammate
   * inside that cone and softens the weight of the pass.
   */
  bestPassOption(p, { human = false, through = false, risk = 1, aimDir = null } = {}) {
    const mates = p.team.players.filter((m) => m !== p);
    const fwd = p.forward(V());
    let best = null;
    let bestScore = -Infinity;
    for (const m of mates) {
      const dx = m.pos.x - p.pos.x;
      const dz = m.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      const throughReach = through ? 34 : 52;
      if (dist < 3 || dist > throughReach) continue;
      const dirTo = V().set(dx / dist, 0, dz / dist);
      const align = fwd.dot(dirTo);
      const aimAlign = aimDir ? aimDir.dot(dirTo) : align;
      const forwardGain = (m.pos.z - p.pos.z) * p.team.direction;
      if (human && aimDir) {
        // your cone of intent: ~74 degrees each side, sloppier for long balls
        const cone = through ? 0.35 : 0.28;
        if (aimAlign < cone) continue;
        if (dist > 6 && aimAlign < 0.55 && align < -0.4) continue;
      } else if (human && align < -0.15 && !through) continue;
      // lane clearance
      let lane = 0;
      for (const opp of this.opponentOf(p.team).players) {
        const ox = opp.pos.x - p.pos.x;
        const oz = opp.pos.z - p.pos.z;
        const proj = ox * dirTo.x + oz * dirTo.z;
        if (proj < 0.4 || proj > dist) continue;
        const perp = Math.abs(ox * dirTo.z - oz * dirTo.x);
        if (perp < 2.4) lane += 2.4 - perp;
      }
      // how open is the receiver
      const openness = Math.min(6, this.nearestOpponentDistance(m) * 0.9);
      const goalDist = m.pos.distanceTo(this.attackGoal(p.team));
      let score =
        aimAlign * (human ? 20 : 6) +
        align * 9 +
        forwardGain * 0.35 +
        openness * 1.5 -
        dist * 0.12 -
        lane * 2.6 -
        goalDist * 0.07;
      if (through) score += forwardGain * 0.5 - 2;
      if (m.isGK) score -= 14;
      score += (Math.random() - 0.5) * risk * 1.2;
      if (score > bestScore) {
        bestScore = score;
        best = { target: m, score, dist, lane, aimAlign };
      }
    }
    if (!best || bestScore < -6) return null;
    const dist = best.dist;
    const power = clamp((dist + 8) / 30, 0.65, 1.25);
    // aim assist on weight: a human pass arrives at the receiver's feet
    const autoThrough = !human && dist > 26 && best.lane < 1;
    return { target: best.target, through: through || autoThrough, power };
  }

  humanTackle() {
    const p = this.controlled;
    if (!p) return;
    this.doPlayerTackle(p);
  }

  aiTackle(p, victim) {
    this.doPlayerTackle(p, victim);
  }

  /**
   * Tackle. Works from any angle: the challenge reaches in the direction the
   * player is running (or facing when standing still), so a defender arriving
   * diagonally can still nick the ball instead of being ignored.
   */
  doPlayerTackle(p, victim = this.ball.owner, { auto = false } = {}) {
    if (p.tackleCooldown > 0 || p.stunTimer > 0) return;
    // The kick-off is not a scramble: nobody may win the ball off the taker
    // until he has actually played it.
    if (this.kickoffGuard > 0 && victim && victim === this.kickoffTaker) return;

    // --- where is the challenge going? movement direction wins over facing ---
    const moving = Math.hypot(p.moveDir.x, p.moveDir.z) > 0.05;
    const reachDir = moving
      ? V().copy(p.moveDir).setY(0).normalize()
      : p.forward(V());
    // snap the body round toward the challenge so the model faces the duel
    // an automatic (sprint-assist) tackle never teleports the player: it is a
    // clean challenge on the ball only, so running with sprint stays predictable
    const lunge = (dir, amount) => {
      if (auto) return;
      p.pos.x += dir.x * amount;
      p.pos.z += dir.z * amount;
      p.facing = Math.atan2(dir.x, dir.z);
    };

    p.tackleCooldown = PLAYER.tackleCooldown;
    if (!victim || victim.team === p.team) {
      // slide in on a loose ball
      const d = p.pos.distanceTo(this.ball.pos);
      const toBall = V().subVectors(this.ball.pos, p.pos).setY(0).normalize();
      const inCone = reachDir.dot(toBall) > -0.2;
      if (d < PLAYER.tackleRange + 0.7 && inCone) {
        if (d > PLAYER.radius + BALL.radius + 0.5) lunge(toBall, Math.min(0.55, d - 0.5));
        this.ball.kick(toBall, 12, { lift: 1.5, by: p });
        this.ball.lastTouch = p;
        this.ui?.flashTackle?.(p, true);
      }
      return;
    }

    const toVictim = V().subVectors(victim.pos, p.pos).setY(0).normalize();
    const dist = p.pos.distanceTo(victim.pos);
    const align = reachDir.dot(toVictim); // 1 = dead ahead, -1 = straight behind

    // generous cone: anything from straight ahead to a shoulder behind counts,
    // and a challenge made on the run reaches a little further
    if (align < -0.45) {
      if (!auto) p.stunTimer = 0.2; // wrong side: brief stumble, but not a full whiff
      return;
    }
    const reach = PLAYER.tackleRange + Math.max(0, align) * 0.55 + (moving ? 0.35 : 0);
    if (dist > reach) {
      // lunge toward the ball-carrier so the tackle visibly commits
      if (dist < reach + 1.6) lunge(toVictim, 0.5);
      return;
    }
    // step in so the challenge actually lands on the ball
    if (dist > PLAYER.radius + 0.35) lunge(toVictim, Math.min(0.45, dist - (PLAYER.radius + 0.35)));

    const behind = victim.team.direction * (p.pos.z - victim.pos.z) > 0; // coming from behind
    const angleFactor = 0.62 + 0.38 * clamp(align, 0, 1); // angled challenges still work
    let chance = victim.isGK ? 0 : 0.55 * p.team.difficulty.press * angleFactor;
    if (p.team.isHuman) chance = 0.72 * angleFactor;
    if (behind) chance *= 0.75;
    chance += clamp((reach - dist) * 0.22, 0, 0.22);
    chance *= p.statMods?.defend ?? 1;
    // a skilful dribbler is harder to dispossess
    chance /= Math.max(0.6, victim.statMods?.hold ?? 1);
    chance = clamp(chance, 0.06, 0.95);
    if (Math.random() < chance) {
      this.giveBall(p, victim);
      victim.stunTimer = 0.32;
      victim.moveDir.set(0, 0, 0);
      p.stunTimer = 0.06;
      this.ui?.flashTackle?.(p, true);
      if (this.settings.sound) this.ui?.sound?.thud?.();
    } else {
      if (!auto) {
        p.stunTimer = 0.3;
        p.vel.multiplyScalar(0.25);
      }
      this.ui?.flashTackle?.(p, false);
    }
  }

  clearBall(p, power = 0.6) {
    if (p.kickCooldown > 0) return;
    const dir = p.team.direction;
    const target = V().set(
      clamp(p.pos.x + (Math.random() - 0.5) * 30, -PITCH.halfW + 6, PITCH.halfW - 6),
      1.4,
      p.pos.z + dir * (24 + Math.random() * 14)
    );
    this.launchBall(p, target, 19 + power * 10, { arc: 'lob' });
    p.kickCooldown = PLAYER.kickCooldown;
  }

  aiShoot(p, power01) {
    this.performShot(p, power01);
  }

  /* ================================================================ */
  /* Goalkeepers                                                      */
  /* ================================================================ */
  gkSave(gk, { fromShot = false } = {}) {
    const ball = this.ball;
    if (gk.saveCooldown > 0) return;
    gk.saveCooldown = 0.6;
    const catchable = Math.random() < (fromShot ? 0.5 : 0.8) && ball.planarSpeed < 26;
    this.stats.saves[gk.team.id] += 1;
    if (catchable) {
      ball.release();
      ball.vel.set(0, 0, 0);
      ball.owner = gk;
      ball.lastTouch = gk;
      gk.claimTimer = 1.15;
      gk.hasReleased = false;
      this.ui?.flashSave?.(gk, true);
    } else {
      const own = this.ownGoal(gk.team);
      const away = V().subVectors(ball.pos, own).setY(0);
      if (away.lengthSq() < 0.1) away.set(0, 0, -gk.team.direction);
      away.normalize();
      away.x += (Math.random() - 0.5) * 1.2;
      away.normalize();
      ball.release();
      ball.kick(away, 15 + Math.random() * 6, { lift: 3.4, by: gk });
      this.ui?.flashSave?.(gk, false);
    }
    if (this.settings.sound) this.ui?.sound?.save?.();
  }

  gkDistribute(gk) {
    const ball = this.ball;
    const option = this.bestPassOption(gk, { risk: 0.4 });
    const dir = gk.team.direction;
    if (option && option.dist < 34) {
      ball.owner = null;
      this.passTo(gk, option.target, { through: false, power: 1.1, error: 1.2 });
      gk.claimTimer = 0;
      return;
    }
    // long clearance downfield
    const target = V().set(
      clamp((Math.random() - 0.5) * 34, -PITCH.halfW + 8, PITCH.halfW - 8),
      1.6,
      gk.pos.z + dir * 42
    );
    ball.owner = null;
    this.launchBall(gk, target, 26, { arc: 'lob' });
    gk.claimTimer = 0;
    gk.kickCooldown = 0.5;
  }

  /* ================================================================ */
  /* Ball events                                                      */
  /* ================================================================ */
  handleBallEvents(events) {
    for (const ev of events) {
      if (ev.type === 'goal') {
        this.onGoal(ev.side);
        return;
      }
      if (ev.type === 'touchline') {
        this.onTouchline();
        return;
      }
      if (ev.type === 'goalline') {
        this.onGoalLine();
        return;
      }
    }
  }

  /**
   * A dribbler can carry the ball over the line; treat that like a normal
   * out-of-play situation (or a goal if they walk the ball into the net).
   */
  checkCarriedBallOutOfPlay() {
    const ball = this.ball;
    if (!ball.owner) return;
    if (this.restartGrace > 0) return;
    const b = ball.pos;
    // only count it when the player carrying it is genuinely out of the field of play
    const carrierOut =
      Math.abs(ball.owner.pos.x) > PITCH.halfW + 0.1 || Math.abs(ball.owner.pos.z) > PITCH.halfL + 0.1;
    if (!carrierOut) return;
    const overX = Math.abs(b.x) - PITCH.halfW;
    const overZ = Math.abs(b.z) - PITCH.halfL;
    if (overX <= 0.25 && overZ <= 0.25) return;

    if (overZ > 0.25 && overZ > overX) {
      const zSign = Math.sign(b.z);
      const inMouth = Math.abs(b.x) < PITCH.goalWidth / 2 - BALL.radius;
      if (inMouth) {
        // carried into the net — that still counts
        this.onGoal(zSign > 0 ? 'home' : 'away');
        return;
      }
      this.onGoalLine();
      return;
    }
    this.onTouchline();
  }

  onGoal(side) {
    if (this.state !== 'play') return;
    const scoringTeam = side === 'home' ? this.home : this.away;
    scoringTeam.score += 1;
    this.score[scoringTeam.id] = scoringTeam.score;
    this.lastScoringTeam = scoringTeam;
    const scorer = this.ball.lastTouch && this.ball.lastTouch.team === scoringTeam
      ? this.ball.lastTouch
      : this._nearestPlayerTo(scoringTeam, this.ball.pos, false);
    this.lastScorer = scorer;
    this.kickoffTeam = this.opponentOf(scoringTeam);
    this.state = 'celebrate';
    this.celebrateTimer = MATCH.goalCelebration;
    this.celebrateCamera = 0;
    this.ball.release();
    this.ball.vel.multiplyScalar(0.2);
    for (const p of this.allPlayers()) {
      p.moveDir.set(0, 0, 0);
      p.charging = false;
    }
    this.charging = false;
    this.charge = 0;
    if (scorer) scorer.celebrateTimer = MATCH.goalCelebration;
    this.ui?.setScore(this.home, this.away);
    this.ui?.showGoalBanner?.(scoringTeam, scorer);
    if (this.settings.sound) this.ui?.sound?.goal?.();
    this.onEvent?.('goal', { team: scoringTeam, scorer });
  }

  onTouchline() {
    if (this.state !== 'play') return;
    const last = this.ball.lastTouch;
    const team = last ? this.opponentOf(last.team) : this.away;
    this.beginThrowIn(team, Math.sign(this.ball.pos.x) || 1, this.ball.pos.z);
  }

  onGoalLine() {
    if (this.state !== 'play') return;
    const last = this.ball.lastTouch;
    const zSign = Math.sign(this.ball.pos.z) || 1;
    // Which team defends this goal line?
    const defending = this.home.direction > 0 ? (zSign > 0 ? this.away : this.home) : (zSign > 0 ? this.home : this.away);
    const attacking = this.opponentOf(defending);
    if (last && last.team === defending) {
      // corner for the attacking team
      const cx = Math.sign(this.ball.pos.x || 1) * (PITCH.halfW - 0.5);
      this.beginRestart('corner', attacking, cx, zSign * (PITCH.halfL - 0.5));
    } else {
      // goal kick for the defending team
      const gz = defending.direction > 0 ? -(PITCH.halfL - 5.5) : PITCH.halfL - 5.5;
      this.beginRestart('goalKick', defending, 0, gz);
    }
  }

  /* ================================================================ */
  /* Throw-ins                                                        */
  /* ================================================================ */
  /** Forget any throw-in (used on kick-off, half time and full time). */
  resetThrowInState() {
    this.throwIn = null;
    this.noOffsideFromThrow = null;
    if (this.throwInRing) this.throwInRing.visible = false;
  }

  /** True while the game is waiting for a throw to be taken. */
  throwInActive() {
    return this.state === 'throwin' && !!this.throwIn;
  }

  /** Throw-in descriptor (used by the touch pad for its button labels). */
  throwInState() {
    return this.throwIn;
  }

  /**
   * Stop play for a throw-in on either touchline.
   * The ball is spotted on the line, the nearest outfield player of the
   * throwing team walks over and the eligible receivers are ranked so the
   * player can pick one before throwing.
   */
  beginThrowIn(team, side, z) {
    const s = Math.sign(side) || 1;
    const zc = clamp(z, -PITCH.halfL + 2, PITCH.halfL - 2);
    const lineX = s * (PITCH.halfW + 0.35);

    // outfield taker, closest to where the ball left the pitch
    let taker = null;
    let bestD = Infinity;
    for (const p of team.players) {
      if (p.isGK) continue;
      const d = Math.hypot(p.pos.x - lineX, p.pos.z - zc);
      if (d < bestD) {
        bestD = d;
        taker = p;
      }
    }
    if (!taker) taker = team.players[0];

    // everyone else drifts back into shape so the throw has room
    for (const t of this.teams) {
      for (const p of t.players) {
        if (p.isGK || p === taker) continue;
        const base = formationWorld(p.slot, t.direction, t.mirror, V());
        p.setPosition(base.x, clamp(base.z, -PITCH.halfL + 5, PITCH.halfL - 5), t.direction > 0 ? 0 : Math.PI);
      }
    }

    taker.setPosition(lineX, zc, Math.atan2(-s, 0));
    taker.stopMoving();
    taker.kickCooldown = 0;
    taker.tackleCooldown = 0;

    this.state = 'throwin';
    this.charging = false;
    this.charge = 0;
    this.ball.release();
    this.ball.reset(lineX + s * 0.35, zc);
    this.ball.vel.set(0, 0, 0);
    this.ball.lastTouch = taker;

    this.throwIn = {
      team,
      side: s,
      x: lineX,
      z: zc,
      taker,
      receivers: this._throwInReceivers(team, taker, lineX, zc),
      index: 0,
      timer: team.isHuman ? 18 : 1.8,
      taken: false,
    };
    // a stoppage: a good moment to bring on fresh legs
    this.handleSubstitutions(false);
    this.setControlled(team.isHuman ? taker : this.controlled);
    this.restartGrace = 0.4;
    this.ui?.toast?.('THROW-IN', team.isHuman ? 'default' : 'warn');
    this.ui?.flashRestart?.('throwIn', team);
    this.snapCamera();
  }

  _throwInReceivers(team, taker, lineX, zc) {
    const pool = team.players.filter((p) => p !== taker && !p.isGK);
    const pick = pool
      .map((p) => ({ p, d: Math.hypot(p.pos.x - lineX, p.pos.z - zc) }))
      .filter((e) => e.d < 55)
      .sort((a, b) => a.d - b.d)
      .slice(0, 8)
      .map((e) => e.p);
    if (pick.length) return pick;
    return team.players.filter((p) => !p.isGK && p !== taker).slice(0, 3);
  }

  cycleThrowReceiver(dir = 1) {
    const t = this.throwIn;
    if (!t || !t.receivers.length) return;
    t.index = (t.index + dir + t.receivers.length) % t.receivers.length;
    const rec = t.receivers[t.index];
    this.ui?.toast?.(`RECEIVER · ${rec.name || rec.role || 'TEAMMATE'}`, 'default');
  }

  /** Highlight ring + per-frame throw-in logic. */
  updateThrowIn(dt) {
    const t = this.throwIn;
    if (!t) {
      this.state = 'play';
      return;
    }
    t.timer -= dt;

    // everyone stands still and waits for the throw (receivers make a token run)
    for (const p of this.allPlayers()) {
      if (p === t.taker) continue;
      p.stopMoving();
    }
    const chosen = t.receivers[t.index];
    if (chosen) {
      const to = V().subVectors(t.taker.pos, chosen.pos).setY(0);
      const d = to.length();
      if (d > 14) {
        to.normalize();
        chosen.moveDir.copy(to);
        chosen.moveScale = 0.55;
        chosen.wantsSprint = false;
      }
    }

    // joystick aims the throw; the ring shows the selected receiver
    const ring = this._ensureThrowRing();
    if (ring) {
      if (chosen) {
        ring.visible = true;
        ring.position.set(chosen.pos.x, 0.06, chosen.pos.z);
        ring.material.opacity = 0.45 + Math.sin(this.time * 6) * 0.25;
      } else {
        ring.visible = false;
      }
    }

    const input = this.input;
    if (t.team.isHuman) {
      if (input.wasPressed('throw_receiver') || input.wasPressed('through') || input.wasPressed('switch')) {
        this.cycleThrowReceiver(1);
      }
      if (input.wasPressed('throw') || input.wasPressed('pass')) {
        this.performThrowIn({ long: false });
        return;
      }
      if (input.wasPressed('throw_long') || input.wasPressed('shoot')) {
        this.performThrowIn({ long: true });
        return;
      }
    }
    // the AI (and an idle human) get on with it after a moment
    if (t.timer <= 0) this.performThrowIn({ long: !t.team.isHuman && Math.random() < 0.4 });
  }

  _ensureThrowRing() {
    if (this.throwInRing) return this.throwInRing;
    const geo = new THREE.RingGeometry(0.85, 1.15, 28);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc9ff4a,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    this.scene.add(ring);
    this.throwInRing = ring;
    return ring;
  }

  /**
   * Take the throw. The ball leaves the thrower's hands in a lofted arc toward
   * the aimed direction or the selected receiver, play resumes on landing.
   */
  performThrowIn({ long = false } = {}) {
    const t = this.throwIn;
    if (!t || t.taken) return null;
    const taker = t.taker;
    const ball = this.ball;
    const rec = t.receivers[t.index] || null;

    const aim = this.input.aim();
    const aiming = t.team.isHuman && Math.hypot(aim.x, aim.y) > 0.25;
    let target;
    if (aiming) {
      const dir = this.humanAimDir(taker);
      const dist = long ? 28 : 14;
      target = V().set(taker.pos.x + dir.x * dist, long ? 1.9 : 1.2, taker.pos.z + dir.z * dist);
    } else if (rec) {
      target = V().copy(rec.pos);
      target.y = long ? 1.9 : 1.1;
    } else {
      const inward = -t.side;
      target = V().set(taker.pos.x + inward * (long ? 26 : 12), 1.4, taker.pos.z);
    }
    // the ball must land back inside the field of play
    target.x = clamp(target.x, -PITCH.halfW + 1.2, PITCH.halfW - 1.2);
    target.z = clamp(target.z, -PITCH.halfL + 1.5, PITCH.halfL - 1.5);

    // out of the hands, standing just outside the line
    ball.reset(taker.pos.x - t.side * 0.3, taker.pos.z);
    ball.pos.y = 1.95;
    const dx = target.x - ball.pos.x;
    const dz = target.z - ball.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const speed = clamp(dist * 0.95, 9, long ? 23 : 17);
    const flight = dist / speed;
    const lift = clamp(
      (target.y - ball.pos.y + 0.5 * BALL.gravity * flight * flight) / flight,
      0.4,
      12
    );
    ball.kick(V().set(dx / dist, 0, dz / dist), speed, { lift, by: taker });
    ball.throwIn = true; // cleared on the next touch (see giveBall/updatePossession)
    taker.facing = Math.atan2(dx, dz);
    taker.kickCooldown = PLAYER.kickCooldown;
    taker.stamina = Math.max(0, taker.stamina - 0.6);

    t.taken = true;
    this.throwIn = null;
    this.state = 'play';
    this.restartGrace = 0.4;
    if (this.throwInRing) this.throwInRing.visible = false;
    // Law 15: there is no offside offence directly from a throw-in.
    this.noOffsideFromThrow = { team: t.team, until: this.matchSeconds + 8 };
    if (this.settings.sound) this.ui?.sound?.kick?.(0.3);
    this.ui?.toast?.('THROW TAKEN', 'default');
    return target;
  }

  /**
   * True when this player cannot be offside: straight after a throw-in by their
   * own team. (The sim has no offside phase today — this is the single hook any
   * future offside check must consult so a throw-in can never be penalised.)
   */
  isOffsideExempt(player) {
    const n = this.noOffsideFromThrow;
    if (!n || !player) return false;
    if (this.matchSeconds > n.until) return false;
    if (player.team !== n.team) return false;
    // the exemption lasts until an opponent touches the ball
    const last = this.ball.lastTouch;
    if (last && last.team !== n.team) return false;
    return true;
  }

  /* ================================================================ */
  /* Defensive assists: second man press, keeper rush                 */
  /* ================================================================ */
  callSecondMan() {
    const team = this.humanTeam;
    const carrier = this.ball.owner;
    if (!carrier || carrier.team === team) {
      this.ui?.toast?.('SECOND MAN · NO ONE TO PRESS', 'warn');
      return null;
    }
    let best = null;
    let bestD = Infinity;
    for (const p of team.players) {
      if (p === this.controlled || p.isGK) continue;
      const d = p.pos.distanceTo(carrier.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return null;
    this.secondManTimer = 2.4;
    this.secondManTarget = best;
    this.ui?.toast?.('SECOND MAN PRESS', 'default');
    this.ui?.flashSwitch?.(best);
    return best;
  }

  updateSecondMan(dt) {
    if (this.secondManTimer <= 0 || !this.secondManTarget) return;
    this.secondManTimer -= dt;
    const mate = this.secondManTarget;
    const carrier = this.ball.owner;
    const human = this.humanTeam;
    if (!carrier || carrier.team === human || mate.stunTimer > 0 || !human.players.includes(mate)) {
      this.secondManTimer = 0;
      this.secondManTarget = null;
      return;
    }
    const to = V().subVectors(carrier.pos, mate.pos).setY(0);
    const d = to.length();
    if (d > 0.5) {
      to.normalize();
      mate.moveDir.copy(to);
      mate.moveScale = 1;
      mate.wantsSprint = !mate.exhausted && mate.stamina > PLAYER.staminaSprintMin;
    }
    // the second man also wins the ball if he gets there
    if (d < PLAYER.tackleRange + 0.3 && mate.tackleCooldown <= 0) {
      this.doPlayerTackle(mate, carrier);
      this.secondManTimer = 0;
      this.secondManTarget = null;
    }
  }

  gkRush() {
    const gk = this.humanTeam.gk;
    const carrier = this.ball.owner;
    if (!gk) return null;
    if (carrier && carrier.team === this.humanTeam) {
      this.ui?.toast?.('KEEPER STAYS', 'warn');
      return null;
    }
    this.gkRushTimer = 1.7;
    gk.rushTimer = 1.7;
    this.ui?.toast?.('KEEPER OUT', 'default');
    return gk;
  }

  updateGkRush(dt) {
    if (this.gkRushTimer <= 0) return;
    this.gkRushTimer -= dt;
    const gk = this.humanTeam.gk;
    const ball = this.ball;
    if (!gk) {
      this.gkRushTimer = 0;
      return;
    }
    const to = V().subVectors(ball.pos, gk.pos).setY(0);
    const d = to.length();
    if (d > 0.75) {
      to.normalize();
      gk.moveDir.copy(to);
      gk.moveScale = 1;
      gk.wantsSprint = !gk.exhausted;
      return;
    }
    this.giveBall(gk);
    gk.claimTimer = 1.0;
    gk.hasReleased = false;
    this.gkRushTimer = 0;
    this.ui?.toast?.('KEEPER CLAIMS', 'default');
  }

  /* ================================================================ */
  /* Helpers                                                          */
  /* ================================================================ */
  attackGoal(team) {
    return V().set(0, 0, team.direction * PITCH.halfL);
  }

  ownGoal(team) {
    return V().set(0, 0, -team.direction * PITCH.halfL);
  }

  opponentOf(team) {
    return team === this.home ? this.away : this.home;
  }

  nearestOpponent(p) {
    let best = null;
    let bestD = Infinity;
    for (const o of this.opponentOf(p.team).players) {
      if (o.isGK) continue;
      const d = p.pos.distanceTo(o.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  nearestOpponentDistance(p) {
    let bestD = Infinity;
    for (const o of this.opponentOf(p.team).players) {
      if (o.isGK) continue;
      const d = p.pos.distanceTo(o.pos);
      if (d < bestD) bestD = d;
    }
    return bestD;
  }

  _nearestPlayerTo(team, pos, includeGK = true) {
    let best = null;
    let bestD = Infinity;
    for (const p of team.players) {
      if (!includeGK && p.isGK) continue;
      const d = p.pos.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Where the ball can be met by a player of `team` in `t` seconds. */
  ballInterceptPoint(team, t = null) {
    const ball = this.ball;
    if (ball.owner) return ball.owner.pos.clone();
    const look = t === null ? 0.35 : t;
    const lead = V().copy(ball.pos).addScaledVector(ball.vel, look);
    lead.y = 0;
    lead.x = clamp(lead.x, -PITCH.halfW - 2, PITCH.halfW + 2);
    lead.z = clamp(lead.z, -PITCH.halfL - 2, PITCH.halfL + 2);
    void team;
    return lead;
  }

  resolvePlayerCollisions() {
    const players = this.allPlayers();
    for (let i = 0; i < players.length; i++) {
      const a = players[i];
      for (let j = i + 1; j < players.length; j++) {
        const b = players[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const minD = PLAYER.radius * 2;
        const d2 = dx * dx + dz * dz;
        if (d2 > minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const overlap = (minD - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        a.pos.x -= nx * overlap;
        a.pos.z -= nz * overlap;
        b.pos.x += nx * overlap;
        b.pos.z += nz * overlap;
      }
    }
  }

  keepPlayersInBounds(dt) {
    void dt;
    for (const p of this.allPlayers()) {
      if (!p.isGK) {
        p.pos.x = clamp(p.pos.x, -PITCH.halfW - 2.2, PITCH.halfW + 2.2);
        p.pos.z = clamp(p.pos.z, -PITCH.halfL - 2.2, PITCH.halfL + 2.2);
      } else {
        // keepers stay around their own penalty area / goal line
        const own = this.ownGoal(p.team);
        const behind = Math.sign(own.z); // +1 when our goal is at +z
        const zMin = behind > 0 ? PITCH.halfL - 17 : -PITCH.halfL + 0.35;
        const zMax = behind > 0 ? PITCH.halfL - 0.35 : -PITCH.halfL + 17;
        p.pos.x = clamp(p.pos.x, -PITCH.penaltyWidth / 2 - 2, PITCH.penaltyWidth / 2 + 2);
        p.pos.z = clamp(p.pos.z, zMin, zMax);
      }
    }
  }

  /* ================================================================ */
  /* Camera                                                           */
  /* ================================================================ */
  /**
   * Keeps the camera inside the play bowl. Without this the rig happily backs
   * up past the goal line and ends up inside the stand roof — which shows up as
   * a black slab covering the whole screen when the action reaches your box.
   */
  constrainCamera(pos) {
    const zLimit = PITCH.halfL + PITCH.margin - 6; // in front of the end stand
    const xLimit = PITCH.halfW + PITCH.margin - 6;
    const maxHeight = 30;
    let { x, y, z } = pos;
    if (Math.abs(z) > zLimit) {
      const over = Math.abs(z) - zLimit;
      z = Math.sign(z) * zLimit;
      // pull up instead of backing into the stands, so the framing still works
      y = Math.min(maxHeight, y + over * 0.55);
    }
    if (Math.abs(x) > xLimit) {
      const over = Math.abs(x) - xLimit;
      x = Math.sign(x) * xLimit;
      y = Math.min(maxHeight, y + over * 0.4);
    }
    // never dip inside the goal netting or below the turf
    y = Math.max(6.5, Math.min(maxHeight, y));
    pos.set(x, y, z);
    return pos;
  }

  snapCamera() {
    const preset = cameraPreset(this.cameraMode);
    const focus = this.cameraFocus();
    const dir = this.humanTeam.direction;
    if (preset.side) {
      this.camPos.set(preset.side * (PITCH.halfW + 4), preset.height, focus.z * preset.zFollow);
      this.constrainCamera(this.camPos);
      this.camLook.set(focus.x * preset.lateralLook, 0, focus.z * preset.zFollow + dir * preset.lookAhead);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      return;
    }
    this.camPos.set(
      focus.x * preset.lateralFollow + preset.swing,
      preset.height,
      focus.z - dir * preset.back
    );
    this.constrainCamera(this.camPos);
    this.camLook.copy(focus).setY(1.2);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  cameraFocus() {
    const ball = this.ball;
    const target = V();
    if (this.state === 'celebrate') {
      const s = this.lastScorer;
      if (s) return target.set(s.pos.x * 0.8, 2.2, s.pos.z * 0.92);
      const b = this.ball.pos;
      return target.set(b.x * 0.6, 1.5, b.z * 0.96);
    }
    const c = this.controlled;
    if (c) {
      target.set(
        ball.pos.x * 0.62 + c.pos.x * 0.38,
        1.2,
        ball.pos.z * 0.66 + c.pos.z * 0.34
      );
    } else {
      target.set(ball.pos.x, 1.2, ball.pos.z);
    }
    const dir = this.humanTeam.direction;
    target.x = clamp(target.x, -PITCH.halfW + 4, PITCH.halfW - 4);
    target.z = clamp(target.z, -PITCH.halfL + 6, PITCH.halfL - 6);
    target.z += dir * 2;
    return target;
  }

  updateCamera(dt) {
    const preset = cameraPreset(this.cameraMode);
    const focus = this.cameraFocus();
    const dir = this.humanTeam.direction;

    // --- side view: sit on the touchline and look across the pitch ----------
    if (preset.side) {
      const touchline = preset.side * (PITCH.halfW + 4);
      const desired = V().set(touchline, preset.height, focus.z * preset.zFollow);
      this.constrainCamera(desired);
      const k = 1 - Math.exp(-preset.followLerp * dt);
      this.camPos.lerp(desired, k);
      const lookTarget = V().set(
        focus.x * preset.lateralLook,
        0,
        focus.z * preset.zFollow + dir * preset.lookAhead
      );
      this.camLook.lerp(lookTarget, 1 - Math.exp(-preset.followLerp * 1.3 * dt));
      this.constrainCamera(this.camPos);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      return;
    }

    let height = preset.height;
    let back = preset.back;

    // Never let the controlled player (or the ball) drop behind the camera:
    // pull the rig back until both are comfortably inside the frame.
    const deepest = Math.min(focus.z, this.ball.pos.z);
    const own = this.controlled ? this.controlled.pos.z : deepest;
    const deepestZ = Math.min(deepest, own);
    const wantedBack = (focus.z - deepestZ) + 13;
    back = Math.min(Math.max(back, wantedBack), 46);
    height += (back - preset.back) * 0.28;

    // `swing` pushes the rig to one side and the aim to the other, which gives
    // the tilted, over-the-shoulder look instead of a flat top-down view.
    const swing = preset.swing;
    const desired = V().set(
      focus.x * preset.lateralFollow + swing,
      height,
      focus.z - dir * back
    );
    this.constrainCamera(desired);
    const k = 1 - Math.exp(-preset.followLerp * dt);
    this.camPos.lerp(desired, k);
    const lookTarget = V().set(
      focus.x * preset.lateralLook - swing,
      0,
      focus.z + dir * preset.lookAhead
    );
    this.camLook.lerp(lookTarget, 1 - Math.exp(-preset.followLerp * 1.3 * dt));
    this.constrainCamera(this.camPos);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this._onResize();
  }

  /* ================================================================ */
  /* HUD                                                             */
  /* ================================================================ */
  displayClock() {
    const total = this.half === 2 ? 45 : 0;
    const frac = Math.min(1, this.halfElapsed / this.halfSeconds);
    const minutes = total + frac * 45;
    const m = Math.floor(minutes);
    const s = Math.floor((minutes - m) * 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  updateHud(force = false) {
    if (!this.ui) return;
    const p = this.controlled;
    this.ui.updateHud?.({
      clock: this.displayClock(),
      half: this.half,
      power: this.charge,
      stamina: p ? p.stamina : 0,
      controlled: p,
      possession: this._possessionLabel(),
      foot: this.humanTeam.formation,
      opponentFormation: this.away.formation,
      subs: { home: this.home.subsMade, away: this.away.subsMade },
      force,
    });
  }

  _possessionLabel() {
    const t = this.home.possessionTime;
    const a = this.away.possessionTime;
    const total = t + a;
    if (total < 1) return { home: 50, away: 50 };
    return { home: Math.round((t / total) * 100), away: Math.round((a / total) * 100) };
  }

  /** Pushes every visible player's simulated position onto its 3D model. */
  syncModels(dt = this.dt || 1 / 60) {
    const controlled = this.controlled;
    for (const team of this.teams) {
      for (const p of team.players) {
        p.sync(1, p === controlled, dt);
      }
    }
    if (this.ball) this.ball.syncMesh(1);
  }

  render() {
    // the models must always follow the simulation, including while paused
    this.syncModels(this.paused ? 0 : this.dt || 1 / 60);
    this.stadium.sun.position.set(
      this.camPos.x * 0.4 + 48,
      78,
      this.camPos.z * 0.3 + 34
    );
    this.stadium.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
  }
}

function randn() {
  // Box-Muller-ish, cheap
  return (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
}

export { TAU };
