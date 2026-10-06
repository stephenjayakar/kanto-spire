// Callback batch d: Fly/Dive balls, small bubbles, swirling fog / poison gas, Spark / Shock Wave,
// Acid, rock fragments / raised rocks. Ported from src/battle_anim_{flying,water,ice,electric,poison,rock}.c.
import {
  S, gSprites, gTasks, gBattleAnimArgs, gOamMatrices, gSineTable, gBattlerPositions, T, register,
  CreateSprite, DestroySprite, StartSpriteAnim, StartSpriteAffineAnim, AnimateSprite, FreeOamMatrix,
  GetBattlerSide, GetBattlerSpriteCoord, GetAnimBattlerSpriteId, GetBattlerSpriteBGPriority, GetBattlerSpriteSubpriority,
  IsBattlerSpriteVisible, IsDoubleBattle, BATTLE_PARTNER, PlaySE12WithPanning, BattleAnimAdjustPanning,
  ANIM_ATTACKER, ANIM_TARGET, ANIM_ATK_PARTNER, ANIM_DEF_PARTNER, B_SIDE_PLAYER, MAX_SPRITES,
  BATTLER_COORD_X, BATTLER_COORD_Y, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET,
  ST_OAM_AFFINE_ON_MASK, ST_OAM_AFFINE_OFF, SOUND_PAN_ATTACKER, SOUND_PAN_TARGET, Random, Sin, Cos, idiv, u16,
} from '../gba.js';
import {
  DestroyAnimSprite, DestroyAnimVisualTask, InitSpritePosToAnimAttacker, InitSpritePosToAnimTarget,
  InitAnimLinearTranslation, AnimTranslateLinear, StartAnimLinearTranslation, StoreSpriteCallbackInData6,
  DestroySpriteAndMatrix, SetAverageBattlerPositions, InitAnimArcTranslation, TranslateAnimHorizontalArc,
  InitSpriteDataForLinearTranslation, TranslateSpriteLinearFixedPoint, TrySetSpriteRotScale, TryResetSpriteAffineState,
  InitAnimLinearTranslationWithSpeed, RunStoredCallbackWhenAnimEnds,
} from '../helpers.js';

const DISPLAY_WIDTH = 240, DISPLAY_HEIGHT = 160, BIT_SIDE = 1;
const GET_BATTLER_SIDE2 = (b) => gBattlerPositions[b] & BIT_SIDE;
// SetAverageBattlerPositions(battler, respect, &x, &y) -> writes sprite.x / sprite.y
function setAvgPos(battler, respect, sprite) { const o = SetAverageBattlerPositions(battler, respect, {}); sprite.x = o.x; sprite.y = o.y; }

// battle_anim_flying.c DestroyAnimSpriteAfterTimer (core.js has it privately)
function DestroyAnimSpriteAfterTimer(sprite) {
  if (sprite.data[0]-- <= 0) {
    if (sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK) { FreeOamMatrix(sprite.oam.matrixNum); sprite.oam.affineMode = ST_OAM_AFFINE_OFF; }
    DestroySprite(sprite);
    --S.gAnimVisualTaskCount;
  }
}

// ---- battle_anim_flying.c ------------------------------------------------------------------------
function AnimFlyBallUp(sprite) {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimFlyBallUp_Step;
  gSprites[GetAnimBattlerSpriteId(ANIM_ATTACKER)].invisible = true;
}
function AnimFlyBallUp_Step(sprite) {
  if (sprite.data[0] > 0) --sprite.data[0];
  else { sprite.data[2] += sprite.data[1]; sprite.y2 -= sprite.data[2] >> 8; }
  if (sprite.y + sprite.y2 < -32) DestroyAnimSprite(sprite);
}
function AnimFlyBallAttack(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    sprite.x = DISPLAY_WIDTH + 32; sprite.y = -32;
    StartSpriteAffineAnim(sprite, 1);
  } else { sprite.x = -32; sprite.y = -32; }
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = sprite.x;
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[3] = sprite.y;
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  sprite.callback = AnimFlyBallAttack_Step;
}
function AnimFlyBallAttack_Step(sprite) {
  sprite.data[0] = 1;
  AnimTranslateLinear(sprite);
  if ((u16(sprite.data[3]) >> 8) > 200) { sprite.x += sprite.x2; sprite.x2 = 0; sprite.data[3] &= 0xFF; }
  if (sprite.x + sprite.x2 < -32 || sprite.x + sprite.x2 > DISPLAY_WIDTH + 32 || sprite.y + sprite.y2 > DISPLAY_HEIGHT) {
    gSprites[GetAnimBattlerSpriteId(ANIM_ATTACKER)].invisible = false;
    DestroyAnimSprite(sprite);
  }
}
function AnimDiveBall(sprite) {
  InitSpritePosToAnimAttacker(sprite, 1);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimDiveBall_Step1;
  gSprites[GetAnimBattlerSpriteId(ANIM_ATTACKER)].invisible = true;
}
function AnimDiveBall_Step1(sprite) {
  if (sprite.data[0] > 0) --sprite.data[0];
  else if (sprite.y + sprite.y2 > -32) { sprite.data[2] += sprite.data[1]; sprite.y2 -= sprite.data[2] >> 8; }
  else {
    sprite.invisible = true;
    if (sprite.data[3]++ > 20) sprite.callback = AnimDiveBall_Step2;
  }
}
function AnimDiveBall_Step2(sprite) {
  sprite.y2 += sprite.data[2] >> 8;
  if (sprite.y + sprite.y2 > -32) sprite.invisible = false;
  if (sprite.y2 > 0) DestroyAnimSprite(sprite);
}
function AnimDiveWaterSplash(sprite) {
  switch (sprite.data[0]) {
    case 0:
      if (!gBattleAnimArgs[0]) {
        sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X);
        sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y);
      } else {
        sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
        sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y);
      }
      sprite.data[1] = 512;
      TrySetSpriteRotScale(sprite, 0, 256, sprite.data[1], 0);
      ++sprite.data[0];
      break;
    case 1: {
      if (sprite.data[2] <= 11) sprite.data[1] -= 40;
      else sprite.data[1] += 40;
      ++sprite.data[2];
      TrySetSpriteRotScale(sprite, 0, 256, sprite.data[1], 0);
      const d = gOamMatrices[sprite.oam.matrixNum].d;
      let t2 = idiv(15616, d) + 1;
      if (t2 > 128) t2 = 128;
      t2 = idiv(64 - t2, 2);
      sprite.y2 = t2;
      if (sprite.data[2] === 24) { TryResetSpriteAffineState(sprite); DestroyAnimSprite(sprite); }
      break;
    }
  }
}

// ---- battle_anim_water.c -------------------------------------------------------------------------
function AnimSmallBubblePair(sprite) {
  if (gBattleAnimArgs[3] !== ANIM_ATTACKER) InitSpritePosToAnimTarget(sprite, true);
  else InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[7] = gBattleAnimArgs[2];
  sprite.callback = AnimSmallBubblePair_Step;
}
function AnimSmallBubblePair_Step(sprite) {
  sprite.data[0] = (sprite.data[0] + 11) & 0xFF;
  sprite.x2 = Sin(sprite.data[0], 4);
  sprite.data[1] += 48;
  sprite.y2 = -(sprite.data[1] >> 8);
  if (sprite.data[7]-- === 0) DestroyAnimSprite(sprite);
}
function AnimSmallDriftingBubbles(sprite) {
  sprite.oam.tileNum += 8;
  InitSpritePosToAnimTarget(sprite, true);
  const randData = (Random() & 0xFF) | 256;
  let randData2 = Random() & 0x1FF;
  if (randData2 > 255) randData2 = 256 - randData2;
  sprite.data[1] = randData;
  sprite.data[2] = randData2;
  sprite.callback = AnimSmallDriftingBubbles_Step;
}
function AnimSmallDriftingBubbles_Step(sprite) {
  sprite.data[3] += sprite.data[1];
  sprite.data[4] += sprite.data[2];
  if (sprite.data[1] & 1) sprite.x2 = -(sprite.data[3] >> 8);
  else sprite.x2 = sprite.data[3] >> 8;
  sprite.y2 = sprite.data[4] >> 8;
  if (++sprite.data[0] === 21) DestroyAnimSprite(sprite);
}

// ---- battle_anim_ice.c ---------------------------------------------------------------------------
function AnimWaveFromCenterOfTarget(sprite) {
  if (sprite.data[0] === 0) {
    if (gBattleAnimArgs[2] === 0) InitSpritePosToAnimTarget(sprite, false);
    else {
      setAvgPos(S.gBattleAnimTarget, 0, sprite);
      if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
      sprite.x += gBattleAnimArgs[0];
      sprite.y += gBattleAnimArgs[1];
    }
    ++sprite.data[0];
  } else if (sprite.animEnded) DestroyAnimSprite(sprite);
}
function InitSwirlingFogAnim(sprite) {
  let battler;
  if (gBattleAnimArgs[4] === 0) {
    if (gBattleAnimArgs[5] === 0) InitSpritePosToAnimAttacker(sprite, false);
    else {
      setAvgPos(S.gBattleAnimAttacker, 0, sprite);
      if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.x -= gBattleAnimArgs[0];
      else sprite.x += gBattleAnimArgs[0];
      sprite.y += gBattleAnimArgs[1];
    }
    battler = S.gBattleAnimAttacker;
  } else {
    if (gBattleAnimArgs[5] === 0) InitSpritePosToAnimTarget(sprite, false);
    else {
      setAvgPos(S.gBattleAnimTarget, 0, sprite);
      if (GetBattlerSide(S.gBattleAnimTarget) !== B_SIDE_PLAYER) sprite.x -= gBattleAnimArgs[0];
      else sprite.x += gBattleAnimArgs[0];
      sprite.y += gBattleAnimArgs[1];
    }
    battler = S.gBattleAnimTarget;
  }
  sprite.data[7] = battler;
  sprite.data[6] = gBattleAnimArgs[5] === 0 || !IsDoubleBattle() ? 0x20 : 0x40;
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) sprite.y += 8;
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[1] = sprite.x;
  sprite.data[2] = sprite.x;
  sprite.data[3] = sprite.y;
  sprite.data[4] = sprite.y + gBattleAnimArgs[2];
  InitAnimLinearTranslation(sprite);
  sprite.data[5] = 64;
  sprite.callback = AnimSwirlingFogAnim;
  sprite.callback(sprite);
}
function AnimSwirlingFogAnim(sprite) {
  if (!AnimTranslateLinear(sprite)) {
    sprite.x2 += Sin(sprite.data[5], sprite.data[6]);
    sprite.y2 += Cos(sprite.data[5], -6);
    if (u16(sprite.data[5] - 64) <= 0x7F) sprite.oam.priority = GetBattlerSpriteBGPriority(sprite.data[7]);
    else sprite.oam.priority = (GetBattlerSpriteBGPriority(sprite.data[7]) + 1) & 3;
    sprite.data[5] = (sprite.data[5] + 3) & 0xFF;
  } else DestroyAnimSprite(sprite);
}
function InitPoisonGasCloudAnim(sprite) {
  sprite.data[0] = gBattleAnimArgs[0];
  if (GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2) < GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2))
    sprite.data[7] = 0x8000;
  if ((gBattlerPositions[S.gBattleAnimTarget] & BIT_SIDE) === B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
    if ((sprite.data[7] & 0x8000) && (gBattlerPositions[S.gBattleAnimAttacker] & BIT_SIDE) === B_SIDE_PLAYER)
      sprite.subpriority = gSprites[GetAnimBattlerSpriteId(ANIM_TARGET)].subpriority + 1;
    sprite.data[6] = 1;
  }
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  if (gBattleAnimArgs[7]) {
    sprite.data[1] = sprite.x + gBattleAnimArgs[1];
    sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[3];
    sprite.data[3] = sprite.y + gBattleAnimArgs[2];
    sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[4];
  } else {
    sprite.data[1] = sprite.x + gBattleAnimArgs[1];
    sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X) + gBattleAnimArgs[3];
    sprite.data[3] = sprite.y + gBattleAnimArgs[2];
    sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y) + gBattleAnimArgs[4];
  }
  sprite.data[7] |= GetBattlerSpriteBGPriority(S.gBattleAnimTarget) << 8;
  InitAnimLinearTranslation(sprite);
  sprite.callback = MovePoisonGasCloud;
}
function MovePoisonGasCloud(sprite) {
  let value;
  switch (sprite.data[7] & 0xFF) {
    case 0:
      AnimTranslateLinear(sprite);
      value = gSineTable[sprite.data[5]];
      sprite.x2 += value >> 4;
      if (sprite.data[6]) sprite.data[5] = (sprite.data[5] - 8) & 0xFF;
      else sprite.data[5] = (sprite.data[5] + 8) & 0xFF;
      if (sprite.data[0] <= 0) {
        sprite.data[0] = 80;
        sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
        sprite.data[1] = sprite.x;
        sprite.data[2] = sprite.x;
        sprite.y += sprite.y2;
        sprite.data[3] = sprite.y;
        sprite.data[4] = sprite.y + 29;
        ++sprite.data[7];
        sprite.data[5] = GET_BATTLER_SIDE2(S.gBattleAnimTarget) !== B_SIDE_PLAYER ? 204 : 80;
        sprite.y2 = 0;
        value = gSineTable[sprite.data[5]];
        sprite.x2 = value >> 3;
        sprite.data[5] = (sprite.data[5] + 2) & 0xFF;
        InitAnimLinearTranslation(sprite);
      }
      break;
    case 1: {
      AnimTranslateLinear(sprite);
      value = gSineTable[sprite.data[5]];
      sprite.x2 += value >> 3;
      sprite.y2 += (gSineTable[sprite.data[5] + 0x40] * -3) >> 8;
      const var0 = u16(sprite.data[5] - 0x40);
      if (var0 <= 0x7F) sprite.oam.priority = (sprite.data[7] >> 8) & 3;
      else sprite.oam.priority = ((sprite.data[7] >> 8) + 1) & 3;
      sprite.data[5] = (sprite.data[5] + 4) & 0xFF;
      if (sprite.data[0] <= 0) {
        sprite.data[0] = 0x300;
        sprite.x += sprite.x2; sprite.data[1] = sprite.x;
        sprite.y += sprite.y2; sprite.data[3] = sprite.y;
        sprite.data[4] = sprite.y + 4;
        sprite.data[2] = GET_BATTLER_SIDE2(S.gBattleAnimTarget) !== B_SIDE_PLAYER ? 0x100 : -0x10;
        ++sprite.data[7];
        sprite.x2 = sprite.y2 = 0;
        InitAnimLinearTranslationWithSpeed(sprite);
      }
      break;
    }
    case 2:
      if (AnimTranslateLinear(sprite)) {
        if (sprite.oam.affineMode & 1) { FreeOamMatrix(sprite.oam.matrixNum); sprite.oam.affineMode = ST_OAM_AFFINE_OFF; }
        DestroySprite(sprite);
        --S.gAnimVisualTaskCount;
      }
      break;
  }
}

// ---- battle_anim_electric.c ----------------------------------------------------------------------
function AnimSparkElectricity(sprite) {
  let battler;
  switch (gBattleAnimArgs[4]) {
    case ANIM_ATTACKER: battler = S.gBattleAnimAttacker; break;
    case ANIM_ATK_PARTNER:
      battler = !IsBattlerSpriteVisible(BATTLE_PARTNER(S.gBattleAnimAttacker)) ? S.gBattleAnimAttacker : BATTLE_PARTNER(S.gBattleAnimAttacker);
      break;
    case ANIM_DEF_PARTNER:
      battler = IsBattlerSpriteVisible(BATTLE_PARTNER(S.gBattleAnimAttacker)) ? BATTLE_PARTNER(S.gBattleAnimTarget) : S.gBattleAnimTarget;
      break;
    case ANIM_TARGET: default: battler = S.gBattleAnimTarget; break;
  }
  if (gBattleAnimArgs[5] === 0) {
    sprite.x = GetBattlerSpriteCoord(battler, BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(battler, BATTLER_COORD_Y);
  } else {
    sprite.x = GetBattlerSpriteCoord(battler, BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(battler, BATTLER_COORD_Y_PIC_OFFSET);
  }
  sprite.x2 = (gSineTable[gBattleAnimArgs[0]] * gBattleAnimArgs[1]) >> 8;
  sprite.y2 = (gSineTable[gBattleAnimArgs[0] + 64] * gBattleAnimArgs[1]) >> 8;
  if (gBattleAnimArgs[6] & 1) sprite.oam.priority = (GetBattlerSpriteBGPriority(battler) + 1) & 3;
  const sineVal = gSineTable[gBattleAnimArgs[2]], cosVal = gSineTable[gBattleAnimArgs[2] + 64];
  gOamMatrices[sprite.oam.matrixNum] = { a: cosVal, b: sineVal, c: -sineVal, d: cosVal };
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.callback = DestroyAnimSpriteAfterTimer;
}

const sElectricChargingParticleCoordOffsets = [
  [58, -60], [-56, -36], [8, -56], [-16, 56], [58, -10], [-58, 10], [48, -18], [-8, 56],
  [16, -56], [-58, -42], [58, 30], [-48, 40], [12, -48], [48, -12], [-56, 18], [48, 48],
];
function AnimTask_ElectricChargingParticles(taskId) {
  const task = gTasks[taskId];
  if (!gBattleAnimArgs[0]) {
    task.data[14] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
    task.data[15] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  } else {
    task.data[14] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
    task.data[15] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  }
  task.data[6] = gBattleAnimArgs[1];
  task.data[7] = 0; task.data[8] = 0; task.data[9] = 0; task.data[10] = 0;
  task.data[11] = gBattleAnimArgs[3];
  task.data[12] = 0;
  task.data[13] = gBattleAnimArgs[2];
  task.func = AnimTask_ElectricChargingParticles_Step;
}
function AnimTask_ElectricChargingParticles_Step(taskId) {
  const task = gTasks[taskId];
  if (task.data[6]) {
    if (++task.data[12] > task.data[13]) {
      task.data[12] = 0;
      const spriteId = CreateSprite(T('gElectricChargingParticlesSpriteTemplate'), task.data[14], task.data[15], 2);
      if (spriteId !== MAX_SPRITES) {
        const sprite = gSprites[spriteId];
        sprite.x += sElectricChargingParticleCoordOffsets[task.data[9]][0];
        sprite.y += sElectricChargingParticleCoordOffsets[task.data[9]][1];
        sprite.data[0] = 40 - task.data[8] * 5;
        sprite.data[1] = sprite.x;
        sprite.data[2] = task.data[14];
        sprite.data[3] = sprite.y;
        sprite.data[4] = task.data[15];
        sprite.data[5] = taskId;
        InitAnimLinearTranslation(sprite);
        StoreSpriteCallbackInData6(sprite, AnimElectricChargingParticles);
        sprite.callback = RunStoredCallbackWhenAnimEnds;
        if (++task.data[9] > 15) task.data[9] = 0;
        if (++task.data[10] >= task.data[11]) {
          task.data[10] = 0;
          if (task.data[8] <= 5) ++task.data[8];
        }
        ++task.data[7];
        --task.data[6];
      }
    }
  } else if (task.data[7] === 0) DestroyAnimVisualTask(taskId);
}
function AnimElectricChargingParticles_Step(sprite) {
  if (AnimTranslateLinear(sprite)) { --gTasks[sprite.data[5]].data[7]; DestroySprite(sprite); }
}
function AnimElectricChargingParticles(sprite) {
  StartSpriteAnim(sprite, 1);
  sprite.callback = AnimElectricChargingParticles_Step;
}
function AnimGrowingShockWaveOrb(sprite) {
  switch (sprite.data[0]) {
    case 0:
      sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
      sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
      StartSpriteAffineAnim(sprite, 2);
      ++sprite.data[0];
      break;
    case 1:
      if (sprite.affineAnimEnded) DestroySpriteAndMatrix(sprite);
      break;
  }
}
function AnimTask_ShockWaveProgressingBolt(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      task.data[6] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
      task.data[7] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
      task.data[8] = 4;
      task.data[10] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
      task.data[9] = idiv(task.data[10] - task.data[6], 5);
      task.data[4] = 7;
      task.data[5] = -1;
      task.data[11] = 12;
      task.data[12] = BattleAnimAdjustPanning(SOUND_PAN_ATTACKER);
      task.data[13] = BattleAnimAdjustPanning(SOUND_PAN_TARGET);
      task.data[14] = task.data[12];
      task.data[15] = idiv(task.data[13] - task.data[12], 3);
      ++task.data[0];
      break;
    case 1:
      if (++task.data[1] > 0) {
        task.data[1] = 0;
        if (CreateShockWaveBoltSprite(task, taskId)) {
          if (task.data[2] === 5) task.data[0] = 3;
          else ++task.data[0];
        }
      }
      if (task.data[11]) --task.data[11];
      break;
    case 2:
      if (task.data[11]) --task.data[11];
      if (++task.data[1] > 4) {
        task.data[1] = 0;
        if (task.data[2] & 1) { task.data[7] = 4; task.data[8] = 68; task.data[4] = 0; task.data[5] = 1; }
        else { task.data[7] = 68; task.data[8] = 4; task.data[4] = 7; task.data[5] = -1; }
        task.data[0] = task.data[11] ? 4 : 1;
      }
      break;
    case 3:
      if (task.data[3] === 0) DestroyAnimVisualTask(taskId);
      break;
    case 4:
      if (task.data[11]) --task.data[11];
      else task.data[0] = 1;
      break;
  }
}
function CreateShockWaveBoltSprite(task, taskId) {
  const spriteId = CreateSprite(T('sShockWaveProgressingBoltSpriteTemplate'), task.data[6], task.data[7], 35);
  if (spriteId !== MAX_SPRITES) {
    gSprites[spriteId].oam.tileNum += task.data[4];
    task.data[4] += task.data[5];
    if (task.data[4] < 0) task.data[4] = 7;
    if (task.data[4] > 7) task.data[4] = 0;
    gSprites[spriteId].data[6] = taskId;
    gSprites[spriteId].data[7] = 3;
    ++task.data[3];
  }
  if (task.data[4] === 0 && task.data[5] > 0) {
    task.data[14] += task.data[15];
    PlaySE12WithPanning('SE_M_THUNDERBOLT', task.data[14]);
  }
  if ((task.data[5] < 0 && task.data[7] <= task.data[8]) || (task.data[5] > 0 && task.data[7] >= task.data[8])) {
    ++task.data[2];
    task.data[6] += task.data[9];
    return true;
  }
  task.data[7] += task.data[5] * 8;
  return false;
}
// Just runs timer for sprite. See AnimTask_ShockWaveProgressingBolt
function AnimShockWaveProgressingBolt(sprite) {
  if (++sprite.data[0] > 12) { --gTasks[sprite.data[6]].data[sprite.data[7]]; DestroySprite(sprite); }
}
function AnimTask_ShockWaveLightning(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      task.data[15] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y) + 32;
      task.data[14] = task.data[15];
      while (task.data[14] > 16) task.data[14] -= 32;
      task.data[13] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
      task.data[12] = GetBattlerSpriteSubpriority(S.gBattleAnimTarget) - 2;
      ++task.data[0];
      break;
    case 1:
      if (++task.data[1] > 1) {
        task.data[1] = 0;
        if (CreateShockWaveLightningSprite(task, taskId)) ++task.data[0];
      }
      break;
    case 2:
      if (task.data[10] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
}
function CreateShockWaveLightningSprite(task, taskId) {
  const spriteId = CreateSprite(T('gLightningSpriteTemplate'), task.data[13], task.data[14], task.data[12]);
  if (spriteId !== MAX_SPRITES) {
    gSprites[spriteId].callback = AnimShockWaveLightning;
    gSprites[spriteId].data[6] = taskId;
    gSprites[spriteId].data[7] = 10;
    ++task.data[10];
  }
  if (task.data[14] >= task.data[15]) return true;
  task.data[14] += 32;
  return false;
}
function AnimShockWaveLightning(sprite) {
  if (sprite.animEnded) { --gTasks[sprite.data[6]].data[sprite.data[7]]; DestroySprite(sprite); }
}

// ---- battle_anim_poison.c ------------------------------------------------------------------------
function AnimAcidPoisonBubble(sprite) {
  if (!gBattleAnimArgs[3]) StartSpriteAnim(sprite, 2);
  InitSpritePosToAnimAttacker(sprite, 1);
  const l = SetAverageBattlerPositions(S.gBattleAnimTarget, 1, {});
  if (GetBattlerSide(S.gBattleAnimAttacker)) gBattleAnimArgs[4] = -gBattleAnimArgs[4];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = l.x + gBattleAnimArgs[4];
  sprite.data[4] = l.y + gBattleAnimArgs[5];
  sprite.data[5] = -30;
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimAcidPoisonBubble_Step;
}
function AnimAcidPoisonBubble_Step(sprite) {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}
function AnimAcidPoisonDroplet(sprite) {
  setAvgPos(S.gBattleAnimTarget, true, sprite);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[4] = sprite.y + sprite.data[0];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// ---- battle_anim_rock.c --------------------------------------------------------------------------
// Animates the rock particles that are shown on the impact for Rock Blast / Rock Smash
function AnimRockFragment(sprite) {
  StartSpriteAnim(sprite, gBattleAnimArgs[5]);
  AnimateSprite(sprite);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = sprite.x;
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[3] = sprite.y;
  sprite.data[4] = sprite.y + gBattleAnimArgs[3];
  InitSpriteDataForLinearTranslation(sprite);
  sprite.data[3] = 0;
  sprite.data[4] = 0;
  sprite.callback = TranslateSpriteLinearFixedPoint;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}
// Animates the rising rocks in Ancient Power.
function AnimRaiseSprite(sprite) {
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  InitSpritePosToAnimAttacker(sprite, 0);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[2] = sprite.x;
  sprite.data[4] = sprite.y + gBattleAnimArgs[2];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

register({
  AnimFlyBallUp, AnimFlyBallAttack, AnimDiveBall, AnimDiveWaterSplash,
  AnimSmallBubblePair, AnimSmallDriftingBubbles,
  InitSwirlingFogAnim, AnimWaveFromCenterOfTarget, InitPoisonGasCloudAnim,
  AnimSparkElectricity, AnimGrowingShockWaveOrb, AnimTask_ElectricChargingParticles, AnimTask_ShockWaveProgressingBolt,
  AnimTask_ShockWaveLightning, AnimShockWaveProgressingBolt,
  AnimAcidPoisonBubble, AnimAcidPoisonDroplet,
  AnimRockFragment, AnimRaiseSprite,
});
