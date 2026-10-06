// Callback batch A, ported from pokefirered (src/battle_anim_effects_1.c, battle_anim_bug.c, battle_anim_dragon.c):
// Needle Arm, Endure/Focus Energy, Razor/Magical Leaf, Leech Seed, Leaf Blade, Twister, Air Cutter (slice), Constrict,
// Solar Beam, Pin Missile/Icicle Spear, Outrage.
import {
  S, gSprites, gTasks, gBattleAnimArgs, ANIM_TARGET, B_SIDE_PLAYER, B_SIDE_OPPONENT,
  BATTLER_COORD_X, BATTLER_COORD_Y, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET,
  BATTLER_COORD_ATTR_WIDTH, BATTLER_COORD_ATTR_HEIGHT, FALSE, TRUE, MAX_SPRITES,
  RGB, Sin, Cos, u8, u16, idiv,
  CreateSprite, CreateSpriteAndAnimate, DestroySprite, StartSpriteAnim, StartSpriteAffineAnim, BlendPalette,
  GetBattlerSide, GetBattlerSpriteCoord, GetBattlerSpriteCoordAttr, GetAnimBattlerSpriteId, GetBattlerSpriteSubpriority,
  GetBattlerSpriteBGPriority, IsBattlerSpriteVisible, IsDoubleBattle, IsContest, BATTLE_PARTNER,
  IndexOfSpritePaletteTag, T, register,
} from '../gba.js';
import {
  DestroyAnimSprite, DestroyAnimVisualTask, InitSpritePosToAnimAttacker, InitSpritePosToAnimTarget,
  StartAnimLinearTranslation, StoreSpriteCallbackInData6, InitAnimLinearTranslation, AnimTranslateLinear,
  InitAnimArcTranslation, TranslateAnimHorizontalArc, WaitAnimForDuration, ArcTan2Neg, TrySetSpriteRotScale,
  DestroySpriteAndMatrix, SetAverageBattlerPositions, TranslateSpriteLinearAndFlicker,
} from '../helpers.js';

const DISPLAY_WIDTH = 240, DISPLAY_HEIGHT = 160;
const OBJ_PLTT_ID = (n) => 256 + n * 16;

// ---- battle_anim_effects_1.c: Solar Beam ----------------------------------------------------------------
// arg 0/1: initial x/y offset, arg 2: duration, arg 3: sprite anim number
function AnimSolarBeamBigOrb(sprite) {
  InitSpritePosToAnimAttacker(sprite, TRUE);
  StartSpriteAnim(sprite, gBattleAnimArgs[3]);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// The small orb "circles" the big orbs. arg 0/1: offset, arg 2: duration, arg 3: initial wave offset
function AnimSolarBeamSmallOrb(sprite) {
  InitSpritePosToAnimAttacker(sprite, TRUE);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = sprite.x;
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[3] = sprite.y;
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  sprite.data[5] = gBattleAnimArgs[3];
  sprite.callback = AnimSolarBeamSmallOrb_Step;
  sprite.callback(sprite);
}

function AnimSolarBeamSmallOrb_Step(sprite) {
  if (AnimTranslateLinear(sprite)) {
    DestroySprite(sprite);
  } else {
    if (sprite.data[5] > 0x7F) sprite.subpriority = GetBattlerSpriteSubpriority(S.gBattleAnimTarget) + 1;
    else sprite.subpriority = GetBattlerSpriteSubpriority(S.gBattleAnimTarget) + 6;
    sprite.x2 += Sin(sprite.data[5], 5);
    sprite.y2 += Cos(sprite.data[5], 14);
    sprite.data[5] = (sprite.data[5] + 15) & 0xFF;
  }
}

// Creates 15 small secondary orbs, 7 frames apart. No args.
function AnimTask_CreateSmallSolarBeamOrbs(taskId) {
  if (--gTasks[taskId].data[0] === -1) {
    gTasks[taskId].data[1]++;
    gTasks[taskId].data[0] = 6;
    gBattleAnimArgs[0] = 15;
    gBattleAnimArgs[1] = 0;
    gBattleAnimArgs[2] = 80;
    gBattleAnimArgs[3] = 0;
    CreateSpriteAndAnimate(T('gSolarBeamSmallOrbSpriteTemplate'), 0, 0, GetBattlerSpriteSubpriority(S.gBattleAnimTarget) + 1);
  }
  if (gTasks[taskId].data[1] === 15) DestroyAnimVisualTask(taskId);
}

// ---- Leech Seed -------------------------------------------------------------------------------------------
// arg 0/1: initial offset, arg 2/3: target offset, arg 4: duration, arg 5: wave amplitude
function AnimLeechSeed(sprite) {
  InitSpritePosToAnimAttacker(sprite, TRUE);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y) + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimLeechSeed_Step;
}

function AnimLeechSeed_Step(sprite) {
  if (TranslateAnimHorizontalArc(sprite)) {
    sprite.invisible = TRUE;
    sprite.data[0] = 10;
    sprite.callback = WaitAnimForDuration;
    StoreSpriteCallbackInData6(sprite, AnimLeechSeedSprouts);
  }
}

function AnimLeechSeedSprouts(sprite) {
  sprite.invisible = FALSE;
  StartSpriteAnim(sprite, 1);
  sprite.data[0] = 60;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// ---- Razor Leaf / Magical Leaf ----------------------------------------------------------------------------
// Shoots a leaf upward, then floats it downward while swaying. arg 0/1: upward x/y delta per frame, arg 2: duration
function AnimRazorLeafParticle(sprite) {
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[2] = gBattleAnimArgs[2];
  sprite.callback = AnimRazorLeafParticle_Step1;
}

function AnimRazorLeafParticle_Step1(sprite) {
  if (!sprite.data[2]) {
    if (sprite.data[1] & 1) {
      sprite.data[0] = 0x80; sprite.data[1] = 0; sprite.data[2] = 0;
    } else {
      sprite.data[0] = 0; sprite.data[1] = 0; sprite.data[2] = 0;
    }
    sprite.callback = AnimRazorLeafParticle_Step2;
  } else {
    sprite.data[2]--;
    sprite.x += sprite.data[0];
    sprite.y += sprite.data[1];
  }
}

function AnimRazorLeafParticle_Step2(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker)) sprite.x2 = -Sin(sprite.data[0], 25);
  else sprite.x2 = Sin(sprite.data[0], 25);
  sprite.data[0] += 2;
  sprite.data[0] &= 0xFF;
  sprite.data[1]++;
  if (!(sprite.data[1] & 1)) sprite.y2++;
  if (sprite.data[1] > 80) DestroyAnimSprite(sprite);
}

// Linear move with a single-cycle sine wave on y. arg 0/1: initial offset, arg 2/3: target offset,
// arg 4: duration, arg 5: wave amplitude, arg 6: target between double battle opponents
function AnimTranslateLinearSingleSineWave(sprite) {
  InitSpritePosToAnimAttacker(sprite, TRUE);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  if (!gBattleAnimArgs[6]) {
    sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[2];
    sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  } else {
    const p = SetAverageBattlerPositions(S.gBattleAnimTarget, TRUE, {});
    sprite.data[2] = p.x + gBattleAnimArgs[2];
    sprite.data[4] = p.y + gBattleAnimArgs[3];
  }
  sprite.data[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  if (GetBattlerSide(S.gBattleAnimAttacker) === GetBattlerSide(S.gBattleAnimTarget)) sprite.data[0] = 1;
  else sprite.data[0] = 0;
  sprite.oam.affineParam = 0;
  sprite.callback = AnimTranslateLinearSingleSineWave_Step;
}

function AnimTranslateLinearSingleSineWave_Step(sprite) {
  let destroy = FALSE;
  const a = sprite.data[0];
  const b = sprite.data[7];
  sprite.data[0] = 1;
  TranslateAnimHorizontalArc(sprite);
  const r0 = sprite.data[7];
  sprite.data[0] = a;
  if (!sprite.oam.affineParam) sprite.oam.affineParam = 0;
  if (b > 200 && r0 < 56 && sprite.oam.affineParam === 0) sprite.oam.affineParam++;
  if (sprite.oam.affineParam !== 0 && sprite.data[0] !== 0) {
    sprite.invisible = !sprite.invisible;
    sprite.oam.affineParam = u16(sprite.oam.affineParam + 1);
    if (sprite.oam.affineParam === 30) destroy = TRUE;
  }
  if (sprite.x + sprite.x2 > DISPLAY_WIDTH + 16
    || sprite.x + sprite.x2 < -16
    || sprite.y + sprite.y2 > DISPLAY_HEIGHT
    || sprite.y + sprite.y2 < -16)
    destroy = TRUE;
  if (destroy) DestroyAnimSprite(sprite);
}

const sMagicalLeafBlendColors = [
  RGB(31, 0, 0), RGB(31, 19, 0), RGB(31, 31, 0), RGB(0, 31, 0), RGB(5, 14, 31), RGB(22, 10, 31), RGB(22, 21, 31),
];

function AnimTask_CycleMagicalLeafPal(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      task.data[8] = OBJ_PLTT_ID(IndexOfSpritePaletteTag('ANIM_TAG_LEAF'));
      task.data[12] = OBJ_PLTT_ID(IndexOfSpritePaletteTag('ANIM_TAG_RAZOR_LEAF'));
      task.data[0]++;
      break;
    case 1:
      if (++task.data[9] >= 0) {
        task.data[9] = 0;
        BlendPalette(task.data[8], 16, task.data[10], sMagicalLeafBlendColors[task.data[11]]);
        BlendPalette(task.data[12], 16, task.data[10], sMagicalLeafBlendColors[task.data[11]]);
        if (++task.data[10] === 17) {
          task.data[10] = 0;
          if (++task.data[11] === 7) task.data[11] = 0;
        }
      }
      break;
  }
  if (gBattleAnimArgs[7] === -1) DestroyAnimVisualTask(taskId);
}

// ---- Twister ---------------------------------------------------------------------------------------------
// arg 0: duration, arg 1: total y delta, arg 2: wave period, arg 3: wave amplitude, arg 4: speedup frame
function AnimMoveTwisterParticle(sprite) {
  if (!IsContest() && IsDoubleBattle() === TRUE) {
    const p = SetAverageBattlerPositions(S.gBattleAnimTarget, 1, {});
    sprite.x = p.x; sprite.y = p.y;
  }
  sprite.y += 32;
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[2] = gBattleAnimArgs[2];
  sprite.data[3] = gBattleAnimArgs[3];
  sprite.data[4] = gBattleAnimArgs[4];
  sprite.callback = AnimMoveTwisterParticle_Step;
}

function AnimMoveTwisterParticle_Step(sprite) {
  if (sprite.data[1] === 0xFF) {
    sprite.y -= 2;
  } else if (sprite.data[1] > 0) {
    sprite.y -= 2;
    sprite.data[1] -= 2;
  }
  sprite.data[5] += sprite.data[2];
  if (sprite.data[0] < sprite.data[4]) sprite.data[5] += sprite.data[2];
  sprite.data[5] &= 0xFF;
  sprite.x2 = Cos(sprite.data[5], sprite.data[3]);
  sprite.y2 = Sin(sprite.data[5], 5);
  if (sprite.data[5] < 0x80) sprite.oam.priority = GetBattlerSpriteBGPriority(S.gBattleAnimTarget) - 1;
  else sprite.oam.priority = GetBattlerSpriteBGPriority(S.gBattleAnimTarget) + 1;
  if (--sprite.data[0] === 0) DestroyAnimSprite(sprite);
}

// ---- Constrict -------------------------------------------------------------------------------------------
// arg 0/1: initial offset, arg 2: affine anim num, arg 3: num squeezes
function AnimConstrictBinding(sprite) {
  InitSpritePosToAnimTarget(sprite, FALSE);
  sprite.affineAnimPaused = TRUE;
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[2]);
  sprite.data[6] = gBattleAnimArgs[2];
  sprite.data[7] = gBattleAnimArgs[3];
  sprite.callback = AnimConstrictBinding_Step1;
}

function AnimConstrictBinding_Step1(sprite) {
  if (u16(gBattleAnimArgs[7]) === 0xFFFF) {
    sprite.affineAnimPaused = FALSE;
    GetAnimBattlerSpriteId(ANIM_TARGET);
    sprite.data[0] = 0x100;
    sprite.callback = AnimConstrictBinding_Step2;
  }
}

function AnimConstrictBinding_Step2(sprite) {
  GetAnimBattlerSpriteId(ANIM_TARGET);
  if (!sprite.data[2]) sprite.data[0] += 11;
  else sprite.data[0] -= 11;
  if (++sprite.data[1] === 6) {
    sprite.data[1] = 0;
    sprite.data[2] ^= 1;
  }
  if (sprite.affineAnimEnded) {
    if (--sprite.data[7] > 0) StartSpriteAffineAnim(sprite, sprite.data[6]);
    else DestroyAnimSprite(sprite);
  }
}

// ---- Leaf Blade ------------------------------------------------------------------------------------------
function LeafBladeGetPosFactor(sprite) {
  let v = 8;
  if (sprite.data[4] < sprite.y) v = -v;
  return v;
}

function AnimTask_LeafBlade(taskId) {
  const task = gTasks[taskId];
  task.data[4] = GetBattlerSpriteSubpriority(S.gBattleAnimTarget) - 1;
  task.data[6] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  task.data[7] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  task.data[10] = GetBattlerSpriteCoordAttr(S.gBattleAnimTarget, BATTLER_COORD_ATTR_WIDTH);
  task.data[11] = GetBattlerSpriteCoordAttr(S.gBattleAnimTarget, BATTLER_COORD_ATTR_HEIGHT);
  task.data[5] = (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_OPPONENT) ? 1 : -1;
  task.data[9] = 56 - (task.data[5] * 64);
  task.data[8] = task.data[7] - task.data[9] + task.data[6];
  task.data[2] = CreateSprite(T('gLeafBladeSpriteTemplate'), task.data[8], task.data[9], task.data[4]);
  if (task.data[2] === MAX_SPRITES) { DestroyAnimVisualTask(taskId); return; }
  const s = gSprites[task.data[2]];
  s.data[0] = 10;
  s.data[1] = task.data[8];
  s.data[2] = task.data[6] - (idiv(task.data[10], 2) + 10) * task.data[5];
  s.data[3] = task.data[9];
  s.data[4] = task.data[7] + (idiv(task.data[11], 2) + 10) * task.data[5];
  s.data[5] = LeafBladeGetPosFactor(s);
  InitAnimArcTranslation(s);
  task.func = AnimTask_LeafBlade_Step;
}

// Re-aims the blade sprite at (x, y) for the next 10-frame arc (the repeated "case N" setup blocks in C).
function leafBladeRetarget(task, sprite, x, y, animNum) {
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.x2 = 0;
  sprite.y2 = 0;
  sprite.data[0] = 10;
  sprite.data[1] = sprite.x;
  sprite.data[2] = x;
  sprite.data[3] = sprite.y;
  sprite.data[4] = y;
  sprite.data[5] = LeafBladeGetPosFactor(sprite);
  task.data[3] = animNum;
  sprite.subpriority = task.data[4];
  StartSpriteAnim(sprite, task.data[3]);
  InitAnimArcTranslation(sprite);
  task.data[0]++;
}

function AnimTask_LeafBlade_Step(taskId) {
  const task = gTasks[taskId];
  const sprite = gSprites[task.data[2]];
  const a = task.data[0];
  const hw = idiv(task.data[10], 2) + 10, hh = idiv(task.data[11], 2) + 10;
  switch (a) {
    case 0: case 2: case 4: case 6: case 8: case 10:
      AnimTask_LeafBlade_Step2(task, taskId);
      if (TranslateAnimHorizontalArc(sprite)) {
        task.data[15] = a + 1;
        task.data[0] = 0xFF;
      }
      break;
    case 1:
      task.data[4] += 2;
      leafBladeRetarget(task, sprite, task.data[6], task.data[7], a);
      break;
    case 3:
      leafBladeRetarget(task, sprite, task.data[6] - hw * task.data[5], task.data[7] - hh * task.data[5], 2);
      break;
    case 5:
      task.data[4] -= 2;
      leafBladeRetarget(task, sprite, task.data[6] + hw * task.data[5], task.data[7] + hh * task.data[5], 3);
      break;
    case 7:
      task.data[4] += 2;
      leafBladeRetarget(task, sprite, task.data[6], task.data[7], 4);
      break;
    case 9:
      leafBladeRetarget(task, sprite, task.data[6] - hw * task.data[5], task.data[7] + hh * task.data[5], 5);
      break;
    case 11:
      task.data[4] -= 2;
      leafBladeRetarget(task, sprite, task.data[8], task.data[9], 6);
      break;
    case 12:
      AnimTask_LeafBlade_Step2(task, taskId);
      if (TranslateAnimHorizontalArc(sprite)) {
        DestroySprite(sprite);
        task.data[0]++;
      }
      break;
    case 13:
      if (task.data[12] === 0) DestroyAnimVisualTask(taskId);
      break;
    case 0xFF:
      if (++task.data[1] > 5) {
        task.data[1] = 0;
        task.data[0] = task.data[15];
      }
      break;
  }
}

// Leaves a flickering trail copy of the blade every frame.
function AnimTask_LeafBlade_Step2(task, taskId) {
  task.data[14]++;
  if (task.data[14] > 0) {
    task.data[14] = 0;
    const src = gSprites[task.data[2]];
    const spriteX = src.x + src.x2;
    const spriteY = src.y + src.y2;
    const spriteId = CreateSprite(T('gLeafBladeSpriteTemplate'), spriteX, spriteY, task.data[4]);
    if (spriteId !== MAX_SPRITES) {
      const s = gSprites[spriteId];
      s.data[6] = taskId;
      s.data[7] = 12;
      gTasks[taskId].data[12]++;
      s.data[0] = task.data[13] & 1;
      gTasks[taskId].data[13]++;
      StartSpriteAnim(s, task.data[3]);
      s.subpriority = task.data[4];
      s.callback = AnimTask_LeafBlade_Step2_Callback;
    }
  }
}

function AnimTask_LeafBlade_Step2_Callback(sprite) {
  sprite.data[0]++;
  if (sprite.data[0] > 1) {
    sprite.data[0] = 0;
    sprite.invisible = !sprite.invisible;
    sprite.data[1]++;
    if (sprite.data[1] > 8) {
      gTasks[sprite.data[6]].data[sprite.data[7]]--;
      DestroySprite(sprite);
    }
  }
}

// ---- Needle Arm ------------------------------------------------------------------------------------------
// arg 0: battler (0 attacker, else target), arg 1: direction (0 inward, else outward), arg 2/3: x/y offset, arg 4: duration
function AnimNeedleArmSpike(sprite) {
  if (gBattleAnimArgs[4] === 0) {
    DestroyAnimSprite(sprite);
    return;
  }
  let a, b;
  if (gBattleAnimArgs[0] === 0) {
    a = u8(GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2));
    b = u8(GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET));
  } else {
    a = u8(GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2));
    b = u8(GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET));
  }
  sprite.data[0] = gBattleAnimArgs[4];
  if (gBattleAnimArgs[1] === 0) {
    sprite.x = gBattleAnimArgs[2] + a;
    sprite.y = gBattleAnimArgs[3] + b;
    sprite.data[5] = a;
    sprite.data[6] = b;
  } else {
    sprite.x = a;
    sprite.y = b;
    sprite.data[5] = gBattleAnimArgs[2] + a;
    sprite.data[6] = gBattleAnimArgs[3] + b;
  }
  const x = u16(sprite.x);
  sprite.data[1] = x * 16;
  const y = u16(sprite.y);
  sprite.data[2] = y * 16;
  sprite.data[3] = idiv((sprite.data[5] - sprite.x) * 16, gBattleAnimArgs[4]);
  sprite.data[4] = idiv((sprite.data[6] - sprite.y) * 16, gBattleAnimArgs[4]);
  const c = ArcTan2Neg(sprite.data[5] - x, sprite.data[6] - y);
  TrySetSpriteRotScale(sprite, 0, 0x100, 0x100, c);
  sprite.callback = AnimNeedleArmSpike_Step;
}

function AnimNeedleArmSpike_Step(sprite) {
  if (sprite.data[0]) {
    sprite.data[1] += sprite.data[3];
    sprite.data[2] += sprite.data[4];
    sprite.x = sprite.data[1] >> 4;
    sprite.y = sprite.data[2] >> 4;
    sprite.data[0]--;
  } else {
    DestroySpriteAndMatrix(sprite);
  }
}

// ---- Air Cutter ------------------------------------------------------------------------------------------
// arg 0/1: offset, arg 2: slice direction (0 right-to-left, 1 left-to-right), arg 3: target (0 target, 1 partner, 2 both)
function AnimAirCutterSlice(sprite) {
  let a, b;
  switch (gBattleAnimArgs[3]) {
    case 1:
      a = u8(GetBattlerSpriteCoord(BATTLE_PARTNER(S.gBattleAnimTarget), BATTLER_COORD_X));
      b = u8(GetBattlerSpriteCoord(BATTLE_PARTNER(S.gBattleAnimTarget), BATTLER_COORD_Y));
      break;
    case 2:
      a = u8(GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X));
      b = u8(GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y));
      if (IsBattlerSpriteVisible(BATTLE_PARTNER(S.gBattleAnimTarget))) {
        a = u8(idiv(GetBattlerSpriteCoord(BATTLE_PARTNER(S.gBattleAnimTarget), BATTLER_COORD_X) + a, 2));
        b = u8(idiv(GetBattlerSpriteCoord(BATTLE_PARTNER(S.gBattleAnimTarget), BATTLER_COORD_Y) + b, 2));
      }
      break;
    case 0:
    default:
      a = u8(GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X));
      b = u8(GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y));
      break;
  }
  sprite.x = a;
  sprite.y = b;
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) sprite.y += 8;
  sprite.callback = AnimSlice_Step;
  if (gBattleAnimArgs[2] === 0) {
    sprite.x += gBattleAnimArgs[0];
  } else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.hFlip = 1;
  }
  sprite.y += gBattleAnimArgs[1];
  sprite.data[1] -= 0x400;
  sprite.data[2] += 0x400;
  sprite.data[5] = gBattleAnimArgs[2];
  if (sprite.data[5] === 1) sprite.data[1] = -sprite.data[1];
}

// static in battle_anim_effects_1.c (also private in effects.js; duplicated here since cb files don't export)
function AnimSlice_Step(sprite) {
  sprite.data[3] += sprite.data[1];
  sprite.data[4] += sprite.data[2];
  if (sprite.data[5] === 0) sprite.data[1] += 0x18;
  else sprite.data[1] -= 0x18;
  sprite.data[2] -= 0x18;
  sprite.x2 = sprite.data[3] >> 8;
  sprite.y2 = sprite.data[4] >> 8;
  sprite.data[0]++;
  if (sprite.data[0] === 20) {
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
    sprite.data[0] = 3;
    sprite.callback = WaitAnimForDuration;
  }
}

// ---- Endure / Focus Energy -------------------------------------------------------------------------------
// arg 0: battler (0 attacker), arg 1/2: offset, arg 3: frames between extra 1px rises
function AnimEndureEnergy(sprite) {
  if (gBattleAnimArgs[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X) + gBattleAnimArgs[1];
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y) + gBattleAnimArgs[2];
  } else {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X) + gBattleAnimArgs[1];
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y) + gBattleAnimArgs[2];
  }
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimEndureEnergy_Step;
}

function AnimEndureEnergy_Step(sprite) {
  if (++sprite.data[0] > sprite.data[1]) {
    sprite.data[0] = 0;
    sprite.y--;
  }
  sprite.y -= sprite.data[0];
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

// ---- battle_anim_bug.c: Pin Missile / Icicle Spear --------------------------------------------------------
// arg 0/1: initial offset, arg 2/3: target offset, arg 4: duration, arg 5: wave amplitude
function AnimMissileArc(sprite) {
  InitSpritePosToAnimAttacker(sprite, 1);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimMissileArc_Step;
  sprite.invisible = TRUE;
}

function AnimMissileArc_Step(sprite) {
  sprite.invisible = FALSE;
  if (TranslateAnimHorizontalArc(sprite)) {
    DestroyAnimSprite(sprite);
  } else {
    // Peek one step ahead to aim the missile along its path, then restore the translation state.
    const tempData = Int16Array.from(sprite.data);
    const x1 = u16(sprite.x), y1 = u16(sprite.y);
    let x2 = sprite.x2, y2 = sprite.y2;
    x2 = (x2 + x1) << 16 >> 16;
    y2 = (y2 + y1) << 16 >> 16;
    if (!TranslateAnimHorizontalArc(sprite)) {
      let rotation = ArcTan2Neg(sprite.x + sprite.x2 - x2, sprite.y + sprite.y2 - y2);
      rotation = u16(rotation + 0xC000);
      TrySetSpriteRotScale(sprite, FALSE, 0x100, 0x100, rotation);
      sprite.data.set(tempData);
    }
    // As in C, x2/y2 stay at the peeked position (recomputed from the restored data next frame).
  }
}

// ---- battle_anim_dragon.c: Outrage -----------------------------------------------------------------------
// arg 0/1: offset, arg 2: duration, arg 3/4: x/y velocity (8.8), arg 5: flicker period
function AnimOutrageFlame(sprite) {
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    sprite.x -= gBattleAnimArgs[0];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
    gBattleAnimArgs[4] = -gBattleAnimArgs[4];
  } else {
    sprite.x += gBattleAnimArgs[0];
  }
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[3] = gBattleAnimArgs[4];
  sprite.data[5] = gBattleAnimArgs[5];
  sprite.invisible = TRUE;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteLinearAndFlicker;
}

register({
  AnimSolarBeamBigOrb, AnimSolarBeamSmallOrb, AnimTask_CreateSmallSolarBeamOrbs,
  AnimLeechSeed, AnimRazorLeafParticle, AnimTranslateLinearSingleSineWave, AnimTask_CycleMagicalLeafPal,
  AnimMoveTwisterParticle, AnimConstrictBinding, AnimTask_LeafBlade, AnimNeedleArmSpike, AnimAirCutterSlice,
  AnimEndureEnergy, AnimMissileArc, AnimOutrageFlame,
});
