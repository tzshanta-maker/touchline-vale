import * as THREE from 'three';
import { PITCH, PLAYER } from '../config.js';
import { formationWorld, roleBounds } from '../entities/teams.js';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();

const clamp = THREE.MathUtils.clamp;

/**
 * Simple but believable team brain. Handles positioning, pressing, marking,
 * passing, shooting, and dribbling for every non-human player on a team.
 */
export class TeamAI {
  constructor(game, team) {
    this.game = game;
    this.team = team;
    this.decisionTimers = new Map();
    this.actionCooldowns = new Map();
    this.markTargets = new Map();
    this.markTimer = 0;
    this.pressers = [];
    this.stuckTimers = new Map();
    this.lastPositions = new Map();
  }

  get difficulty() {
    return this.team.difficulty;
  }

  update(dt) {
    const game = this.game;
    if (game.state !== 'play' && game.state !== 'celebrate') {
      for (const p of this.team.players) p.stopMoving();
      return;
    }
    const ball = game.ball;
    const owner = ball.owner;
    const weOwn = owner && owner.team === this.team;
    const theyOwn = owner && owner.team !== this.team;

    this.markTimer -= dt;
    if (this.markTimer <= 0) {
      this.markTimer = 0.5;
      this._assignMarks();
    }

    // Rank our players by closeness to the ball (interception point). When the
    // opposition has the ball the nearest defender or midfielder presses — a
    // striker does not abandon the front line to chase into his own half, which
    // is what turned the block into a swarm.
    const chasePoint = game.ballInterceptPoint(this.team);
    const ranked = this.team.players
      .filter((p) => !p.isGK)
      .map((p) => ({ p, d: p.pos.distanceTo(chasePoint) }))
      .sort((a, b) => a.d - b.d);
    let chaser = ranked[0]?.p;
    if (theyOwn) {
      const outlet = ranked.find((r) => r.p.line !== 'fwd');
      const lead = ranked[0];
      // only a forward presses if he is already right on top of the ball
      if (lead && lead.p.line === 'fwd' && outlet && lead.d > 10) chaser = outlet.p;
    }
    const support = ranked.find((r) => r.p !== chaser)?.p;

    for (const player of this.team.players) {
      if (player.isGK) {
        this._updateGK(player, dt);
        continue;
      }
      if (player === game.controlled && this.team.isHuman) {
        // Human-controlled player: still allow auto actions when the AI passes to them? No.
        continue;
      }
      if (game.state === 'celebrate') {
        this._celebrate(player);
        continue;
      }
      // Kick-off: until the ball has been played, only the defending team holds
      // its marks — the kicking team is free to use the ball straight away.
      if (game.kickoffGuard > 0 && player.kickoffAnchor && this.team !== game.kickoffTeam) {
        this._holdKickoffMark(player);
        continue;
      }
      // Our own kick-off: the taker stands over the ball and squares it to his
      // partner (Game.updateKickoffRoutine) instead of dribbling out of the D.
      if (game.kickoffRoutine > 0 && player === game.kickoffTaker) {
        player.stopMoving();
        continue;
      }
      const timerKey = player.id;
      let t = (this.decisionTimers.get(timerKey) ?? 0) - dt;
      if (t <= 0) {
        t = 0.18 + Math.random() * 0.16;
        this._decide(player, { chaser, support, weOwn, theyOwn });
      }
      this.decisionTimers.set(timerKey, t);
      this._move(player, { chaser, support, weOwn, theyOwn });
    }
  }

  _celebrate(p) {
    const game = this.game;
    const scorer = game.lastScorer;
    const dir = this.team.direction;
    if (this.team === game.lastScoringTeam) {
      const target = tmp.set(p.pos.x * 0.4, 0, dir * (PITCH.halfL - 6));
      if (scorer === p) {
        target.set(p.pos.x + Math.sin(game.time * 4) * 2, 0, p.pos.z + dir * 3);
        p.moveToward(target, { sprint: true, stopDistance: 1.2, arrive: 1 });
        p.facing += dtSafe(game.dt) * 3;
      } else {
        p.moveToward(target, { sprint: false, stopDistance: 3, arrive: 4 });
      }
    } else {
      // dejected walk back
      const own = game.ownGoal(this.team);
      tmp.set(p.pos.x * 0.6, 0, own.z * 0.55);
      if (p.pos.distanceTo(tmp) > 4) p.moveToward(tmp, { stopDistance: 2, arrive: 4 });
      else p.stopMoving();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Decisions: only kicks / tackles, run ~5x per second per player    */
  /* ---------------------------------------------------------------- */
  _decide(p, ctx) {
    const game = this.game;
    const ball = game.ball;
    const { chaser, weOwn, theyOwn } = ctx;
    if (p.stunTimer > 0) return;

    if (ball.owner === p) {
      this._onBall(p);
      return;
    }

    if (theyOwn && ball.owner && !ball.owner.isGK) {
      const d = p.pos.distanceTo(ball.owner.pos);
      const skill = this.team.isHuman ? this.difficulty.tackleChance : this.difficulty.tackleChance;
      if (d < PLAYER.tackleRange && p.tackleCooldown <= 0) {
        // defenders commit to a challenge when they are the closest
        const isPresser = chaser === p || p.pos.distanceTo(ball.pos) < 4.5;
        if (isPresser && Math.random() < skill * 0.75) {
          game.aiTackle(p, ball.owner);
        }
      }
    }

    // Intercept / clear a loose ball that is near
    if (!ball.owner && chaser === p) {
      const d = p.pos.distanceTo(ball.pos);
      if (d < 2.6 && ball.pos.y > 1.2 && ball.speed < 26) {
        // header / volley away if it's high
        if (p.role !== 'ST' || Math.random() < 0.5) {
          game.clearBall(p, 0.6);
        }
      }
    }
  }

  _onBall(p) {
    const game = this.game;
    const ball = game.ball;
    const dir = this.team.direction;
    const goal = game.attackGoal(this.team);
    const dGoal = p.pos.distanceTo(goal);
    const pressure = game.nearestOpponentDistance(p);
    const rand = Math.random();

    // Shooting chance rises sharply inside the box
    const atkZ = p.pos.z * dir;
    let shootChance = 0;
    // Only shoot from believable positions: the attacking third, not from the corner flag
    if (atkZ > PITCH.halfL * 0.32 && Math.abs(p.pos.x) < 27) {
      if (dGoal < 11) shootChance = 0.85;
      else if (dGoal < 17) shootChance = 0.52;
      else if (dGoal < 23) shootChance = 0.26;
      else if (dGoal < 28) shootChance = 0.09;
      // narrow the angle -> much less likely to pull the trigger
      shootChance *= clamp(1 - Math.abs(p.pos.x) / 30, 0.15, 1);
      if (p.line === 'fwd') shootChance *= 1.3;
      if (pressure < 2.5) shootChance *= 1.2;
      if (atkZ > PITCH.halfL * 0.7) shootChance *= 1.25;
    }
    if (rand < shootChance) {
      const hunger = p.stats ? (p.stats.shooting - 60) / 120 : 0;
      game.aiShoot(
        p,
        THREE.MathUtils.clamp(0.55 + Math.random() * 0.35 + (dGoal < 14 ? 0.1 : 0) + hunger, 0.4, 1)
      );
      return;
    }

    // Under pressure or deep in our own third: look for a pass
    const mustPass = pressure < 2.1 || (p.pos.z * dir < -PITCH.halfL * 0.55 && pressure < 4);
    if (mustPass || rand < 0.30 + this.difficulty.press * 0.1) {
      const pass = game.bestPassOption(p, {
        risk: this.difficulty.passError * (p.statMods?.pass ?? 1),
      });
      if (pass) {
        const through = pass.through && Math.random() < 0.7;
        game.aiPass(p, pass.target, { through, power: pass.power });
        return;
      }
    }

    // Otherwise dribble forward with a bit of evasion
    if (pressure < 3.4) {
      const opp = game.nearestOpponent(p);
      if (opp) {
        const dx = p.pos.x - opp.pos.x;
        const lateral = (Math.sign(dx) || 1) * 6;
        p.aiTarget.set(
          clamp(p.pos.x + lateral * 0.6, -PITCH.halfW + 3, PITCH.halfW - 3),
          0,
          p.pos.z + dir * 9
        );
      } else {
        p.aiTarget.set(clamp(p.pos.x * 0.9, -PITCH.halfW + 4, PITCH.halfW - 4), 0, p.pos.z + dir * 8);
      }
      p.aiTarget.z = clamp(p.aiTarget.z, -PITCH.halfL + 3, PITCH.halfL - 2);
      p.aiMode = 'dribble';
      return;
    }
    p.aiMode = 'dribble';
    p.aiTarget.set(clamp(p.pos.x, -PITCH.halfW + 4, PITCH.halfW - 4), 0, p.pos.z + dir * 6);
  }

  /* ---------------------------------------------------------------- */
  /* Movement                                                        */
  /* ---------------------------------------------------------------- */
  _move(p, ctx) {
    const game = this.game;
    const ball = game.ball;
    const dir = this.team.direction;
    const { chaser, support, weOwn, theyOwn } = ctx;

    if (p.claimTimer > 0) {
      p.stopMoving();
      return;
    }

    if (ball.owner === p) {
      const target = p.aiTarget.lengthSq() > 0 ? p.aiTarget : tmp.set(p.pos.x, 0, p.pos.z + dir * 5);
      const sprint = p.stamina > 55 && game.nearestOpponentDistance(p) > 3;
      p.moveToward(target, { sprint, stopDistance: 0.6, arrive: 1.4 });
      p.moveScale = 1;
      return;
    }

    // Loose ball and we are the closest: go get it
    if (!ball.owner && chaser === p) {
      const ip = game.ballInterceptPoint(this.team, 0);
      p.moveToward(ip, { sprint: p.stamina > 12, stopDistance: 0.25, arrive: 1.4 });
      return;
    }

    if (weOwn) {
      this._attackingShape(p, { support });
    } else if (theyOwn || !ball.owner) {
      this._defensiveShape(p, { chaser, support });
    }
  }

  /** Stand on the kick-off mark: no pressing, no chasing, just the shape. */
  _holdKickoffMark(p) {
    const a = p.kickoffAnchor;
    p.moveToward(a, { stopDistance: 0.4, arrive: 2.5 });
  }

  /**
   * The team block, in the attacking frame (positive z = toward the goal we
   * attack). Lines come from the ball's position, and every player is then
   * placed relative to his own formation slot, so the shape stays recognisable
   * instead of collapsing onto the ball.
   */
  _block() {
    const ball = this.game.ball;
    const dir = this.team.direction;
    const halfL = PITCH.halfL;
    const owner = ball.owner;
    const weOwn = !!owner && owner.team === this.team;
    const ballAtkZ = ball.pos.z * dir;

    // Back line: 20 m behind the ball, never in our own box, never past halfway.
    const defZ = clamp(ballAtkZ - 20, -halfL + 12, halfL * 0.28);
    // Midfield sits between the back line and the ball.
    const midZ = clamp(ballAtkZ - 11, defZ + 9, halfL * 0.66);
    // Forwards push ahead of the ball when we have it, and stay high otherwise.
    const fwdZ = weOwn
      ? clamp(ballAtkZ + 8, defZ + 22, halfL - 8)
      : clamp(ballAtkZ + 3, defZ + 20, halfL - 10);

    // The whole block slides toward the ball's side, but only a third of the way.
    const latShift = clamp(ball.pos.x * (weOwn ? 0.32 : 0.24), -9, 9);
    // Compact when defending, full width in possession.
    const width = weOwn ? 0.98 : 0.82;

    return { dir, weOwn, ballAtkZ, defZ, midZ, fwdZ, latShift, width };
  }

  /** World-space holding position for a player, derived from his slot. */
  _shapeTarget(p, block, out = tmp3) {
    const { dir, width, latShift } = block;
    formationWorld(p.slot, dir, this.team.mirror, out);
    const lineZ = p.line === 'def' ? block.defZ : p.line === 'mid' ? block.midZ : block.fwdZ;
    // Small depth stagger inside a line so four/five at the back is not a ruler.
    const stagger = (p.slot.z - 0.5) * 5;
    out.x = out.x * width + latShift;
    out.z = dir * (lineZ + stagger);
    out.x = clamp(out.x, -PITCH.halfW + 2.5, PITCH.halfW - 2.5);
    out.z = clamp(out.z, -PITCH.halfL + 4, PITCH.halfL - 4);
    return out;
  }

  _attackingShape(p, { support }) {
    const game = this.game;
    const ball = game.ball;
    const dir = this.team.direction;
    const block = this._block();
    const target = this._shapeTarget(p, block, tmp);
    const ballAtkZ = block.ballAtkZ;
    const inFinalThird = ballAtkZ > PITCH.halfL * 0.3;

    if (p.line === 'fwd') {
      // Forwards run the line between the full backs and the centre backs, but
      // hold their own channel rather than drifting to wherever the ball is.
      if (p.wide) {
        // stay wide, only tuck in a little when the ball is deep in the box
        target.x = p.slot.x * PITCH.halfW * (0.9 + (inFinalThird ? -0.16 : 0)) * this.team.mirror;
        target.x += block.latShift * 0.5;
      } else {
        // central striker: near-post / far-post runs around the ball's side
        target.x = clamp(ball.pos.x * 0.3 + Math.sin(game.time * 0.55 + p.number) * 5, -13, 13);
      }
      target.z = dir * clamp(ballAtkZ + (p.wide ? 7 : 10), block.defZ + 20, PITCH.halfL - 7);
    } else if (p.line === 'mid') {
      // Midfield holds its line. The one nearest the ball offers a passing
      // option a few metres off it; everyone else keeps the shape.
      if (support === p) {
        const side = Math.sign(p.slot.x || 1);
        target.x = clamp(ball.pos.x + side * 9, -PITCH.halfW + 4, PITCH.halfW - 4);
        target.z = dir * clamp(ballAtkZ - 4, block.defZ + 8, PITCH.halfL * 0.7);
      } else {
        target.z = dir * clamp(block.midZ + (p.slot.z - 0.5) * 6, block.defZ + 6, PITCH.halfL * 0.7);
      }
    } else {
      // Defenders: hold the back line, creep up with the ball, and only join in
      // down the flank if that is already their channel.
      target.z = dir * clamp(block.defZ + (p.slot.z - 0.5) * 4, -PITCH.halfL + 8, PITCH.halfL * 0.3);
      if (p.wide) {
        const wideSide = Math.sign(p.slot.x) || 1;
        const ballSameSide = Math.sign(ball.pos.x) === wideSide * Math.sign(this.team.mirror) && ballAtkZ > PITCH.halfL * 0.3;
        if (ballSameSide) target.z = dir * clamp(block.defZ + 10, -PITCH.halfL + 8, PITCH.halfL * 0.45);
      }
    }

    target.x = clamp(target.x, -PITCH.halfW + 2.5, PITCH.halfW - 2.5);
    target.z = clamp(target.z, -PITCH.halfL + 4, PITCH.halfL - 4);

    const dist = p.pos.distanceTo(target);
    const sprint = dist > 10 && p.stamina > 35 && this.difficulty.supportRuns > 0.6;
    p.moveToward(target, { sprint, stopDistance: 1.4, arrive: 5 });
  }

  _defensiveShape(p, { chaser }) {
    const game = this.game;
    const ball = game.ball;
    const target = tmp.set(0, 0, 0);

    // Primary presser chases the ball carrier (chosen in update()).
    if (chaser === p) {
      const chase = game.ballInterceptPoint(this.team, 0.15);
      p.moveToward(chase, { sprint: p.stamina > 8, stopDistance: 0.4, arrive: 2.2 });
      return;
    }

    const block = this._block();
    this._shapeTarget(p, block, target);

    // Defenders may pick up a runner, but only one who is actually in their
    // zone — man-marking from midfield is what pulled the block apart.
    const mark = p.line === 'def' ? this.markTargets.get(p.id) : null;
    if (mark && mark.pos.distanceTo(ball.pos) < 34 && p.pos.distanceTo(mark.pos) < 16) {
      const own = game.ownGoal(this.team);
      const dx = own.x - mark.pos.x;
      const dz = own.z - mark.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      const goalSide = clamp(2.4 - this.difficulty.press * 0.8, 1.3, 3);
      const mx = mark.pos.x + (dx / dl) * goalSide;
      const mz = mark.pos.z + (dz / dl) * goalSide;
      target.x = target.x * 0.35 + mx * 0.65;
      target.z = target.z * 0.35 + mz * 0.65;
    }

    // A forward tracks back with play but stays ahead of the midfield line: he
    // is the out-ball, not a fifth defender.
    if (p.line === 'fwd') {
      target.z = target.z * 0.92 + ball.pos.z * 0.08;
      target.x = target.x * 0.92 + ball.pos.x * 0.08;
      const ahead = block.midZ + 7;
      if (target.z * block.dir < ahead) target.z = block.dir * ahead;
    }

    target.x = clamp(target.x, -PITCH.halfW + 2.5, PITCH.halfW - 2.5);
    target.z = clamp(target.z, -PITCH.halfL + 4, PITCH.halfL - 4);
    const far = p.pos.distanceTo(target);
    p.moveToward(target, {
      sprint: p.stamina > 55 && far > 14,
      stopDistance: 1.0,
      arrive: 4,
    });
  }

  _assignMarks() {
    const game = this.game;
    const opp = game.opponentOf(this.team);
    // Only the back line picks up runners; midfielders stay zonal so the block
    // keeps its shape instead of chasing individual players.
    const myDefenders = this.team.players.filter((p) => !p.isGK && p.line === 'def');
    const theirAttackers = opp.players.filter((p) => !p.isGK && p.role !== 'GK');
    const assigned = new Set();
    this.markTargets.clear();

    // Goal-side defenders mark the closest dangerous opponent
    for (const d of myDefenders) {
      let best = null;
      let bestScore = Infinity;
      for (const o of theirAttackers) {
        if (assigned.has(o.id)) continue;
        const dist = d.pos.distanceTo(o.pos);
        if (dist > 16) continue;
        const dz = o.pos.z * this.team.direction; // how advanced they are
        const score = dist - dz * 0.25 + (o.line === 'fwd' ? -4 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      }
      if (best) {
        assigned.add(best.id);
        this.markTargets.set(d.id, best);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Goalkeeper                                                       */
  /* ---------------------------------------------------------------- */
  _updateGK(p, dt) {
    const game = this.game;
    p.failSaveTimer = Math.max(0, (p.failSaveTimer || 0) - dt);
    const ball = game.ball;
    const dir = this.team.direction;
    const own = game.ownGoal(this.team);
    const goalSign = Math.sign(own.z) || 1;
    const toBallX = ball.pos.x - p.pos.x;
    const toBallZ = ball.pos.z - p.pos.z;

    // --- holding the ball: pause, then distribute ---
    if (p.claimTimer > 0) {
      p.stopMoving();
      p.facing = Math.atan2(toBallX, toBallZ);
      if (p.claimTimer < 0.55 && !p.hasReleased) {
        p.hasReleased = true;
        game.gkDistribute(p);
      }
      return;
    }
    p.hasReleased = false;

    // --- 1. shot stopping: where will the ball cross our goal line? ---
    if (!ball.owner && Math.abs(ball.vel.z) > 1.5) {
      const timeToLine = (own.z - ball.pos.z) / ball.vel.z;
      if (timeToLine > 0.02 && timeToLine < 1.5) {
        const crossX = ball.pos.x + ball.vel.x * timeToLine;
        const crossY =
          ball.pos.y + ball.vel.y * timeToLine - 0.5 * 9.81 * timeToLine * timeToLine;
        const onTarget =
          Math.abs(crossX) < PITCH.goalWidth / 2 + 2.4 &&
          crossY < PITCH.goalHeight + 1.8 &&
          crossY > -0.8;
        if (onTarget) {
          // The human team's keeper stays sharp. The AI keeper is deliberately
          // beatable: he mis-reads the shot (gkError metres of spread), covers
          // less of the mouth (reduced reach) and does not get to everything
          // (gkSave is his save chance when he is in position).
          const aiKeeper = !this.team.isHuman;
          const hands = p.statMods?.gk ?? 1;
          const reach = this.difficulty.gkReach * hands * (aiKeeper ? 0.78 : 1.1);
          const sigma = aiKeeper
            ? this.difficulty.gkError * 1.6
            : (2.3 - this.difficulty.press) * 3.1;
          const moveX = clamp(
            crossX + (Math.random() - 0.5) * sigma,
            -PITCH.goalWidth / 2 - 0.5,
            PITCH.goalWidth / 2 + 0.5
          );
          const lineZ = own.z - goalSign * 0.85;
          p.moveToward(tmp.set(moveX, 0, lineZ), { sprint: true, stopDistance: 0.05, arrive: 1.0 });
          p.facing = Math.atan2(toBallX, toBallZ);
          if (p.diveTimer <= 0 && p.pos.distanceTo(ball.pos) < reach + (aiKeeper ? 1.6 : 2.4)) {
            p.diveTimer = 0.55;
            p.diveDir = Math.sign(crossX - p.pos.x) || 1;
          }
          // --- save resolution (probabilistic so keepers can be beaten) ---
          if (p.failSaveTimer > 0) return;
          const gap = Math.hypot(ball.pos.x - p.pos.x, (ball.pos.y - 1.05) * 0.8);
          const close = p.pos.distanceTo(ball.pos) < reach + 1.6;
          const distLine = Math.abs(own.z - ball.pos.z);
          if (gap < reach * (aiKeeper ? 1.0 : 1.15) && close && distLine < 9) {
            // closer to the keeper's body = far more likely to be saved
            const gapNorm = clamp(gap / Math.max(0.6, reach), 0, 1.4);
            let chance = aiKeeper
              ? clamp(this.difficulty.gkSave - gapNorm * 0.45, 0.04, 0.85)
              : clamp(0.7 - gapNorm * 0.62, 0.05, 0.72);
            // fast shots and awkward heights are harder
            chance *= 1 - clamp((ball.planarSpeed - 18) / 40, 0, aiKeeper ? 0.45 : 0.32);
            if (ball.pos.y > PITCH.goalHeight - 0.35) chance *= 0.75;
            if (Math.random() < chance) {
              game.gkSave(p, { fromShot: true });
            } else {
              p.failSaveTimer = aiKeeper ? 1.0 : 0.7;
            }
          }
          return;
        }
      }
    }

    // --- 2. smother a loose ball inside the box ---
    const distGoal = Math.abs(ball.pos.z - own.z);
    const inBox = distGoal < PITCH.penaltyDepth + 1 && Math.abs(ball.pos.x) < PITCH.penaltyWidth / 2;
    const ours = ball.owner && ball.owner.team === this.team;
    if (!ours && inBox && ball.pos.y < 2.4 && distGoal < 13) {
      const ip = ball.owner ? ball.owner.pos : game.ballInterceptPoint(this.team, 0.08);
      const canWin = !ball.owner || p.pos.distanceTo(ball.pos) < ball.owner.pos.distanceTo(ball.pos) + 2.5;
      if (canWin) {
        p.moveToward(ip, { sprint: true, stopDistance: 0.15, arrive: 2 });
        p.facing = Math.atan2(toBallX, toBallZ);
        if (p.diveTimer <= 0 && p.pos.distanceTo(ball.pos) < 1.6 && Math.random() < (this.team.isHuman ? 0.3 : 0.2)) {
          p.diveTimer = 0.5;
          p.diveDir = Math.sign(ball.pos.x - p.pos.x) || 1;
        }
        return;
      }
    }

    // --- 3. default positioning: arc across the goal mouth, ball-side ---
    const lateral = clamp(
      ball.pos.x * 0.45,
      -PITCH.goalWidth / 2 - 1.2,
      PITCH.goalWidth / 2 + 1.2
    );
    const depth = clamp(1.4 + Math.abs(ball.pos.z - own.z) * 0.035, 1.2, 3.6);
    p.moveToward(tmp.set(lateral, 0, own.z - goalSign * depth), {
      sprint: true,
      stopDistance: 0.3,
      arrive: 2.5,
    });
    p.facing = Math.atan2(toBallX, toBallZ);
    void dir;
  }
}

function dtSafe(dt) {
  return Math.min(dt, 0.05);
}
