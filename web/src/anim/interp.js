// FireRed battle animation script interpreter (src/battle_anim.c), over the JSON scripts from
// tools/extract_anims.py. One step() = one GBA frame: script commands, then AnimateSprites,
// palette fade and RunTasks, in the order the game runs them (CB1 then CB2).
import {
  S, DATA, gBattleAnimArgs, gSprites, gTasks, CB, T, CreateSpriteAndAnimate, CreateTask, DestroyTask, RunTasks, AnimateSprites,
  UpdatePaletteFade, GetBattlerSpriteCoord, GetBattlerSpriteSubpriority, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET,
  LoadSpritePaletteByTag, FreeSpritePaletteByTag, SetGpuReg, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, BLDALPHA_BLEND, PlaySE,
  GetBattlerSide, B_SIDE_PLAYER, gSprites as SPR, gBattlerSpriteIds, BATTLE_PARTNER, gPaletteFade, BlendPalettes, RGB_BLACK,
} from './gba.js';

export const SCRIPT_MAX_FRAMES = 60 * 12;

// Which callbacks a script needs (following call/goto/branches), for "can this move play?" checks.
export function scriptNeeds(json, cmds, seen = new Set(), out = { sprites: new Set(), tasks: new Set(), sound: new Set(), labels: new Set(), bgs: new Set() }) {
  for (const c of cmds || []) {
    const op = c[0];
    if (op === 'createsprite') { const t = json.templates[c[1]]; out.sprites.add(t?.callback || '?' + c[1]); }
    else if (op === 'createvisualtask') out.tasks.add(c[1]);
    else if (op === 'createsoundtask') out.sound.add(c[1]);
    else if (op === 'fadetobg' || op === 'changebg') out.bgs.add(c[1]);
    else if (op === 'fadetobgfromset') { out.bgs.add(c[1]); out.bgs.add(c[2]); }
    const labels = op === 'call' || op === 'goto' ? [c[1]] : op === 'choosetwoturnanim' ? [c[1], c[2]] : op === 'jumpifmoveturn' || op === 'jumpargeq' ? [c[c.length - 1]] : op === 'jumpifcontest' ? [] : [];
    for (const l of labels) if (!seen.has(l)) { seen.add(l); out.labels.add(l); scriptNeeds(json, json.labels[l], seen, out); }
  }
  return out;
}
// Callbacks a move needs that aren't ported yet ([] = fully playable).
export function missingFor(json, cmds) {
  const n = scriptNeeds(json, cmds);
  const miss = [];
  for (const k of n.sprites) if (k !== 'SpriteCallbackDummy' && !CB[k]) miss.push(k);
  for (const k of n.tasks) if (!CB[k]) miss.push(k);
  return miss; // sound tasks are optional (silently skipped)
}

// Sound tasks: generic stand-ins that just play the SE they are given (pan/pitch ignored).
function soundTaskFallback(name, args) {
  for (const a of args) { const n = DATA.json?.seNames?.[a & 0xFFFF]; if (n && n.startsWith('SE_')) { PlaySE(n); return; } }
}

export class AnimScript {
  constructor(cmds, { labels }) {
    this.labels = labels;
    this.cmds = cmds; this.pc = 0; this.ret = null;
    this.wait = 0; this.active = true; this.waiting = false; // waiting = WaitAnimFrameCount mode
    this.frames = 0; this.bgFadeState = 0; this.loadedTags = new Set(); this.missing = new Set();
    this.endWait = 0;
  }
  jump(label) { this.cmds = this.labels[label] || [['end']]; this.pc = 0; }

  // gAnimScriptCallback for one frame
  runScriptFrame() {
    if (!this.active) return;
    // WaitAnimFrameCount: count down, then one idle frame before commands run again (as in the game)
    if (this.waiting) {
      if (this.wait <= 0) { this.waiting = false; this.wait = 0; }
      else this.wait--;
      return;
    }
    let guard = 0;
    this.wait = 0;
    do { this.cmd(); if (++guard > 5000) throw new Error('anim script loop'); } while (this.wait === 0 && this.active && !this.waiting);
  }

  cmd() {
    const c = this.cmds[this.pc] || ['end'];
    const op = c[0];
    const next = () => { this.pc++; };
    switch (op) {
      case 'loadspritegfx': this.loadedTags.add(c[1]); LoadSpritePaletteByTag(c[1]); next(); this.wait = 1; this.waiting = true; break;
      case 'unloadspritegfx': this.loadedTags.delete(c[1]); FreeSpritePaletteByTag(c[1]); next(); break;
      case 'createsprite': {
        next();
        const args = c[4] || [];
        for (let i = 0; i < args.length; i++) gBattleAnimArgs[i] = args[i];
        let v = c[3] & 0x7F; v = v >= 64 ? v - 64 : -v;
        let sub = GetBattlerSpriteSubpriority(c[2] ? S.gBattleAnimTarget : S.gBattleAnimAttacker) + v;
        if (sub < 3) sub = 3;
        let tpl;
        try { tpl = T(c[1]); } catch { this.missing.add(c[1]); break; }
        if (tpl.callback && tpl.callback !== 'SpriteCallbackDummy' && !CB[tpl.callback]) { this.missing.add(tpl.callback); break; }
        S.gAnimVisualTaskCount++; // (the C code counts after creating; callbacks that destroy themselves at once decrement it)
        const id = CreateSpriteAndAnimate(tpl, GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2), GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET), sub);
        if (id >= 64) S.gAnimVisualTaskCount--;
        break;
      }
      case 'createvisualtask': {
        next();
        const fn = CB[c[1]];
        const args = c[3] || [];
        for (let i = 0; i < args.length; i++) gBattleAnimArgs[i] = args[i];
        if (!fn) { this.missing.add(c[1]); break; }
        const id = CreateTask(fn, c[2]);
        S.gAnimVisualTaskCount++;
        fn(id);
        break;
      }
      case 'createsoundtask': {
        next();
        const fn = CB[c[1]];
        const args = c[2] || [];
        for (let i = 0; i < args.length; i++) gBattleAnimArgs[i] = args[i];
        if (!fn) { soundTaskFallback(c[1], args); break; }
        const id = CreateTask(fn, 10);
        S.gAnimSoundTaskCount++;
        fn(id);
        break;
      }
      case 'delay': next(); this.wait = c[1] || -1; this.waiting = true; break;
      case 'waitforvisualfinish': if (S.gAnimVisualTaskCount <= 0) { S.gAnimVisualTaskCount = 0; next(); this.wait = 0; } else this.wait = 1; break;
      case 'nop': case 'nop2': next(); break;
      case 'end':
        if (S.gAnimVisualTaskCount > 0 || S.gAnimSoundTaskCount > 0 || this.bgFadeState) { this.wait = 1; return; }
        this.active = false;
        break;
      case 'playse': next(); PlaySE(c[1]); break;
      case 'playsewithpan': next(); PlaySE(c[1]); break;
      case 'panse': case 'panse_adjustnone': case 'panse_adjustall': next(); PlaySE(c[1]); break;
      case 'loopsewithpan': {
        next();
        const [se, , wait, times] = c.slice(1);
        const id = CreateTask(taskLoopSE, 1); const t = gTasks[id];
        t.ptrs.se = se; t.data[0] = wait; t.data[1] = times; t.data[2] = wait; // play now, then every `wait` frames
        S.gAnimSoundTaskCount++;
        taskLoopSE(id);
        break;
      }
      case 'waitplaysewithpan': { next(); const id = CreateTask(taskWaitSE, 1); gTasks[id].ptrs.se = c[1]; gTasks[id].data[0] = c[3]; S.gAnimSoundTaskCount++; break; }
      case 'setpan': case 'waitsound': case 'stopsound': next(); break;
      case 'monbg': case 'monbg_static': case 'clearmonbg': case 'clearmonbg_static': next(); break;
      case 'setalpha': next(); SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(c[1], c[2])); SetGpuReg(REG_OFFSET_BLDCNT, 0x3F40); break;
      case 'setbldcnt': next(); SetGpuReg(REG_OFFSET_BLDCNT, c[1]); break;
      case 'blendoff': next(); SetGpuReg(REG_OFFSET_BLDCNT, 0); SetGpuReg(REG_OFFSET_BLDALPHA, 0); break;
      case 'call': this.ret = { cmds: this.cmds, pc: this.pc + 1 }; this.jump(c[1]); break;
      case 'return': if (this.ret) { this.cmds = this.ret.cmds; this.pc = this.ret.pc; this.ret = null; } else this.active = false; break;
      case 'goto': this.jump(c[1]); break;
      case 'setarg': next(); gBattleAnimArgs[c[1]] = c[2]; break;
      case 'choosetwoturnanim': this.jump(S.gAnimMoveTurn & 1 ? c[2] : c[1]); break;
      case 'jumpifmoveturn': if (S.gAnimMoveTurn === c[1]) this.jump(c[2]); else next(); break;
      case 'jumpargeq': if (gBattleAnimArgs[c[1]] === c[2]) this.jump(c[3]); else next(); break;
      case 'jumpifcontest': next(); break;
      case 'fadetobg': next(); this.startBgFade(c[1]); break;
      case 'fadetobgfromset': next(); this.startBgFade(GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER ? c[2] : c[1]); break;
      case 'restorebg': next(); this.startBgFade(-1); break;
      case 'waitbgfadeout': if (this.bgFadeState === 2 || this.bgFadeState === 0) { next(); this.wait = 0; } else this.wait = 1; break;
      case 'waitbgfadein': if (this.bgFadeState === 0) { next(); this.wait = 0; } else this.wait = 1; break;
      case 'changebg': next(); S.moveBg = bgKey(c[1]); break;
      case 'splitbgprio': case 'splitbgprio_all': case 'splitbgprio_foes': case 'teamattack_moveback': case 'teamattack_movefwd': next(); break;
      case 'invisible': { next(); const s = SPR[gBattlerSpriteIds[animBattler(c[1])]]; if (s?.isMon) s.invisible = true; break; }
      case 'visible': { next(); const s = SPR[gBattlerSpriteIds[animBattler(c[1])]]; if (s?.isMon) s.invisible = false; break; }
      default: next(); break;
    }
  }

  // Task_FadeToBg: the battle background fades to black, swaps to the move's BG (or back), fades in.
  startBgFade(bgId) {
    this.bgFadeState = 1;
    const id = CreateTask(taskFadeToBg, 5);
    gTasks[id].data[1] = bgId;
    gTasks[id].ptrs.script = this;
  }
}

function animBattler(b) { return b === 0 ? S.gBattleAnimAttacker : b === 1 ? S.gBattleAnimTarget : b === 2 ? BATTLE_PARTNER(S.gBattleAnimAttacker) : BATTLE_PARTNER(S.gBattleAnimTarget); }
export function bgKey(id) { if (typeof id === 'string') return id; for (const [k, v] of Object.entries(DATA.json?.bgs || {})) if (v.id === id) return k; return null; }

// Same frame timing as FireRed: BeginHardwarePaletteFade(0xE8, 0, ...) moves BLDY one step per frame, takes one more
// frame to finish, and Task_FadeToBg advances on the frame after that (the move BG loads while the screen is black).
function taskFadeToBg(taskId) {
  const t = gTasks[taskId], sc = t.ptrs.script;
  switch (t.data[0]) {
    case 0: t.data[2] = 16; t.data[3] = 0; t.data[0] = 1; break; // fade the battle BG to black
    case 1: if (hwFadeStep(t)) { t.data[0] = 2; sc.bgFadeState = 2; } break;
    case 2: // swap to the move's BG (or back to the terrain), then fade it in
      S.moveBg = t.data[1] === -1 ? null : bgKey(t.data[1]); S.gBattle_BG3_X = 0; S.gBattle_BG3_Y = 0;
      t.data[2] = 0; t.data[3] = 0; t.data[0] = 3; break;
    case 3: if (hwFadeStep(t)) { DestroyTask(taskId); sc.bgFadeState = 0; } break;
  }
}
// One frame of the hardware fade toward data[2]; data[3] marks the finishing frame. Returns true once the fade is over.
function hwFadeStep(t) {
  if (S.bgBlack !== t.data[2]) { S.bgBlack += S.bgBlack < t.data[2] ? 1 : -1; return false; }
  if (!t.data[3]) { t.data[3] = 1; return false; }
  return true;
}
function taskLoopSE(taskId) {
  const t = gTasks[taskId];
  if (t.data[2]++ >= t.data[0]) {
    t.data[2] = 1; PlaySE(t.ptrs.se);
    if (--t.data[1] <= 0) { DestroyTask(taskId); S.gAnimSoundTaskCount--; }
  }
}
function taskWaitSE(taskId) {
  const t = gTasks[taskId];
  if (t.data[0]-- <= 0) { PlaySE(t.ptrs.se); DestroyTask(taskId); S.gAnimSoundTaskCount--; }
}

// One GBA frame of the whole system.
export function stepFrame(script) {
  script.runScriptFrame();
  AnimateSprites();
  UpdatePaletteFade();
  RunTasks();
  S.frame++;
  script.frames++;
}
