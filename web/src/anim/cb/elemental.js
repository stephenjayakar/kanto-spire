// Elemental move callbacks (electric / fire / water / ice / ground / rock / flying), ported from
// src/battle_anim_{electric,fire,water,ice,ground,rock,flying}.c. Names follow the decomp.
import {
  S, gSprites, gTasks, gBattleAnimArgs, gBattlerSpriteIds, gPlttBufferFaded, T, register,
  CreateSprite, DestroySprite, CreateTask, DestroyTask, StartSpriteAnim, AnimateSprite,
  GetBattlerSide, GetBattlerSpriteCoord, GetBattlerSpriteCoord2, GetBattlerAtPosition, GetAnimBattlerSpriteId,
  IsBattlerSpriteVisible, IsDoubleBattle, IndexOfSpritePaletteTag, GetBattlerSpriteSubpriority, GetBattlerYCoordWithElevation,
  GetBattlerSpriteBGPriorityRank, FreeSpriteOamMatrix, gSineTable, ANIM_ATTACKER, Random, Sin, Cos, SetGpuReg, idiv, u8, u16,
  B_SIDE_PLAYER, B_SIDE_OPPONENT, B_POSITION_PLAYER_RIGHT, B_POSITION_OPPONENT_RIGHT, BATTLE_PARTNER,
  BATTLER_COORD_X, BATTLER_COORD_Y, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET, SPRITE_NONE,
  REG_OFFSET_BLDCNT, REG_OFFSET_BLDALPHA, BLDALPHA_BLEND, BLDCNT_TGT1_BG1,
} from '../gba.js';
import {
  DestroyAnimSprite, DestroyAnimVisualTask, InitSpritePosToAnimAttacker, InitSpritePosToAnimTarget,
  InitAnimLinearTranslation, AnimTranslateLinear, StartAnimLinearTranslation, StoreSpriteCallbackInData6,
  WaitAnimForDuration, DestroySpriteAndMatrix, TranslateSpriteInEllipse, RunStoredCallbackWhenAffineAnimEnds,
  SetAverageBattlerPositions, InitBattleAnimBg, AnimLoadCompressedBgTilemap,
  TranslateSpriteInGrowingCircle, TranslateSpriteLinear, TranslateSpriteLinearFixedPoint, SetAnimSpriteInitialXOffset,
  RunStoredCallbackWhenAnimEnds, InitAnimArcTranslation, TranslateAnimHorizontalArc, AnimFastTranslateLinear,
  InitAnimFastLinearTranslationWithSpeed, InitAnimFastLinearTranslationWithSpeedAndPos,
} from '../helpers.js';

const MAX_BATTLERS_COUNT = 4;
const BLDCNT_EFFECT_BLEND = 1 << 6, BLDCNT_TGT2_ALL = 0x3F00;

// ---- private helpers (battle_anim_mons.c functions not in helpers.js) ------------------------------
// oam.matrixNum = ST_OAM_HFLIP / ST_OAM_VFLIP on a non-affine sprite (until the next ANIMCMD frame)
function setOamFlip(sprite, h, v) { sprite.flipH = !!h; sprite.flipV = !!v; }

// battle_anim_mons.c AnimTravelDiagonally
function AnimTravelDiagonally(sprite) {
  let r4, coordType, battlerId;
  if (!gBattleAnimArgs[6]) { r4 = true; coordType = BATTLER_COORD_Y_PIC_OFFSET; }
  else { r4 = false; coordType = BATTLER_COORD_Y; }
  if (!gBattleAnimArgs[5]) { InitSpritePosToAnimAttacker(sprite, r4); battlerId = S.gBattleAnimAttacker; }
  else { InitSpritePosToAnimTarget(sprite, r4); battlerId = S.gBattleAnimTarget; }
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  InitSpritePosToAnimTarget(sprite, r4);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(battlerId, BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(battlerId, coordType) + gBattleAnimArgs[3];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// ================================ battle_anim_electric.c =========================================
function AnimThunderboltOrb_Step(sprite) {
  if (--sprite.data[5] === -1) {
    sprite.invisible = !sprite.invisible;
    sprite.data[5] = sprite.data[4];
  }
  if (sprite.data[3]-- <= 0) DestroyAnimSprite(sprite);
}

function AnimThunderboltOrb(sprite) {
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  sprite.data[3] = gBattleAnimArgs[0];
  sprite.data[4] = gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[3];
  sprite.callback = AnimThunderboltOrb_Step;
}

function AnimSparkElectricityFlashing(sprite) {
  sprite.data[0] = gBattleAnimArgs[3];
  const battler = gBattleAnimArgs[7] & 0x8000 ? S.gBattleAnimTarget : S.gBattleAnimAttacker;
  if (GetBattlerSide(battler) === B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  sprite.x = GetBattlerSpriteCoord(battler, BATTLER_COORD_X_2) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord(battler, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
  sprite.data[4] = gBattleAnimArgs[7] & 0x7FFF;
  sprite.data[5] = gBattleAnimArgs[2];
  sprite.data[6] = gBattleAnimArgs[5];
  sprite.data[7] = gBattleAnimArgs[4];
  sprite.oam.tileNum += gBattleAnimArgs[6] * 4;
  sprite.callback = AnimSparkElectricityFlashing_Step;
  sprite.callback(sprite);
}

function AnimSparkElectricityFlashing_Step(sprite) {
  sprite.x2 = Sin(sprite.data[7], sprite.data[5]);
  sprite.y2 = Cos(sprite.data[7], sprite.data[5]);
  sprite.data[7] = (sprite.data[7] + sprite.data[6]) & 0xFF;
  if (sprite.data[7] % sprite.data[4] === 0) sprite.invisible = !sprite.invisible;
  if (sprite.data[0]-- <= 0) DestroyAnimSprite(sprite);
}

// Electricity arcs around the target. Used for Paralysis and various electric move hits
function AnimElectricity(sprite) {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.oam.tileNum += gBattleAnimArgs[3] * 4;
  if (gBattleAnimArgs[3] === 1) setOamFlip(sprite, 1, 0); // oam.matrixNum = ST_OAM_HFLIP
  else if (gBattleAnimArgs[3] === 2) setOamFlip(sprite, 0, 1); // ST_OAM_VFLIP
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// The vertical falling thunder bolt used in Thunder Wave/Shock/Bolt
function AnimTask_ElectricBolt(taskId) {
  gTasks[taskId].data[0] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X) + gBattleAnimArgs[0];
  gTasks[taskId].data[1] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y) + gBattleAnimArgs[1];
  gTasks[taskId].data[2] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ElectricBolt_Step;
}

function AnimTask_ElectricBolt_Step(taskId) {
  let r8, r2, r12;
  let spriteId = 0, r7 = 0;
  const sp = u8(gTasks[taskId].data[2]);
  const x = gTasks[taskId].data[0];
  const y = gTasks[taskId].data[1];
  const tpl = T('sElectricBoltSegmentSpriteTemplate');

  if (!gTasks[taskId].data[2]) { r8 = 0; r2 = 1; r12 = 16; }
  else { r12 = 16; r8 = 8; r2 = 4; }
  switch (gTasks[taskId].data[10]) {
    case 0: r12 *= 1; spriteId = CreateSprite(tpl, x, y + r12, 2); ++r7; break;
    case 2: r12 *= 2; r8 += r2; spriteId = CreateSprite(tpl, x, y + r12, 2); ++r7; break;
    case 4: r12 *= 3; r8 += r2 * 2; spriteId = CreateSprite(tpl, x, y + r12, 2); ++r7; break;
    case 6: r12 *= 4; r8 += r2 * 3; spriteId = CreateSprite(tpl, x, y + r12, 2); ++r7; break;
    case 8: r12 *= 5; spriteId = CreateSprite(tpl, x, y + r12, 2); ++r7; break;
    case 10: DestroyAnimVisualTask(taskId); return;
  }
  if (r7) {
    gSprites[spriteId].oam.tileNum += r8;
    gSprites[spriteId].data[0] = sp;
    gSprites[spriteId].callback(gSprites[spriteId]);
  }
  ++gTasks[taskId].data[10];
}

function AnimElectricBoltSegment(sprite) {
  // SPRITE_SHAPE/SIZE(8x16) or (16x16). centerToCornerVec stays at the template's 8x8 (-4,-4), so the
  // bigger image's top-left is still at (x-4, y-4): the renderer centres on (x, y), hence the x2/y2 shift.
  if (!sprite.data[0]) { sprite.oam.w = 8; sprite.oam.h = 16; }
  else { sprite.oam.w = 16; sprite.oam.h = 16; }
  sprite.x2 = (sprite.oam.w - 8) >> 1; sprite.y2 = (sprite.oam.h - 8) >> 1;
  if (++sprite.data[1] === 15) DestroySprite(sprite);
}

// The horizontal bands of electricity used in Thunder Wave
function AnimThunderWave(sprite) {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  const spriteId = CreateSprite(T('gThunderWaveSpriteTemplate'), sprite.x + 32, sprite.y, sprite.subpriority);
  gSprites[spriteId].oam.tileNum += 8;
  ++S.gAnimVisualTaskCount;
  gSprites[spriteId].callback = AnimThunderWave_Step;
  sprite.callback = AnimThunderWave_Step;
}

function AnimThunderWave_Step(sprite) {
  if (++sprite.data[0] === 3) {
    sprite.data[0] = 0;
    sprite.invisible = !sprite.invisible;
  }
  if (++sprite.data[1] === 51) DestroyAnimSprite(sprite);
}

// ================================ battle_anim_fire.c =============================================
function AnimEmberFlare(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) === GetBattlerSide(S.gBattleAnimTarget)
    && (S.gBattleAnimAttacker === GetBattlerAtPosition(B_POSITION_PLAYER_RIGHT)
      || S.gBattleAnimAttacker === GetBattlerAtPosition(B_POSITION_OPPONENT_RIGHT)))
    gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.callback = AnimTravelDiagonally;
  sprite.callback(sprite);
}

// ================================ battle_anim_water.c ============================================
// For animating undulating beam attacks (e.g. Flamethrower, Hydro Pump, Signal Beam)
function AnimToTargetInSinWave(sprite) {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = 30;
  sprite.data[1] = sprite.x;
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[3] = sprite.y;
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  sprite.data[5] = idiv(0xD200, sprite.data[0]);
  sprite.data[7] = gBattleAnimArgs[3];
  const retArg = u16(gBattleAnimArgs[7]);
  if (gBattleAnimArgs[7] > 127) {
    sprite.data[6] = (retArg - 127) * 256;
    sprite.data[7] = -sprite.data[7];
  } else {
    sprite.data[6] = retArg * 256;
  }
  sprite.callback = AnimToTargetInSinWave_Step;
  sprite.callback(sprite);
}

function AnimToTargetInSinWave_Step(sprite) {
  if (AnimTranslateLinear(sprite)) DestroyAnimSprite(sprite);
  sprite.y2 += Sin(sprite.data[6] >> 8, sprite.data[7]);
  if ((sprite.data[6] + sprite.data[5]) >> 8 > 127) {
    sprite.data[6] = 0;
    sprite.data[7] = -sprite.data[7];
  } else {
    sprite.data[6] += sprite.data[5];
  }
}

// NOTE: relies on gBattleAnimArgs[7] surviving later createsprite commands (C only overwrites the args
// a command passes), which the interpreter must honour for Flamethrower's wave phase to advance.
function AnimTask_StartSinAnimTimer(taskId) {
  gTasks[taskId].data[0] = gBattleAnimArgs[0];
  gBattleAnimArgs[7] = 0;
  gTasks[taskId].func = AnimTask_RunSinAnimTimer;
}

function AnimTask_RunSinAnimTimer(taskId) {
  gBattleAnimArgs[7] = (gBattleAnimArgs[7] + 3) & 0xFF;
  if (--gTasks[taskId].data[0] === 0) DestroyAnimVisualTask(taskId);
}

// Water droplet appears and drips down. Used by Water Gun on impact
function AnimWaterGunDroplet(sprite) {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[4] = sprite.y + gBattleAnimArgs[4];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// SURF: BG1 shows the wave tilemap (pre-rendered in anims.json "extraBgs"), scrolled diagonally, and a
// scanline effect writes BLDALPHA per line so the wave is only visible in rows [data4, data5) of the
// screen with alpha data[1]&0x1F (rows outside get 0x1000 = invisible). We write the band's value to
// BLDALPHA (the renderer blends BG1 by it) and publish the rows as S.animBgs[1].clipY0/clipY1 (GBA screen
// rows; the renderer may clip the layer to them). The palette cycling of colours 1-7 is skipped.

function AnimTask_CreateSurfWave(taskId) {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  // tilemap + gBattleAnimBgImage_Surf + gBattleAnimBgPalette_Surf (arg0 != 0: gBattleAnimBgPalette_MuddyWater)
  let key = GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_OPPONENT ? 'gBattleAnimBgTilemap_SurfOpponent' : 'gBattleAnimBgTilemap_SurfPlayer';
  if (gBattleAnimArgs[0] !== 0) key += ':gBattleAnimBgPalette_MuddyWater';
  AnimLoadCompressedBgTilemap(1, key);
  Object.assign(S.animBgs[1], { clipY0: 0, clipY1: 0 });

  const taskId2 = CreateTask(AnimTask_SurfWaveScanlineEffect, gTasks[taskId].priority + 1);
  gTasks[taskId].data[15] = taskId2;
  gTasks[taskId2].data[0] = 0;
  gTasks[taskId2].data[1] = 0x1000;
  gTasks[taskId2].data[2] = 0x1000;
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_OPPONENT) {
    S.gBattle_BG1_X = u16(-224);
    S.gBattle_BG1_Y = 256;
    gTasks[taskId].data[0] = 2;
    gTasks[taskId].data[1] = -1;
    gTasks[taskId2].data[3] = 1;
  } else {
    S.gBattle_BG1_X = 0;
    S.gBattle_BG1_Y = u16(-48);
    gTasks[taskId].data[0] = -2;
    gTasks[taskId].data[1] = 1;
    gTasks[taskId2].data[3] = 0;
  }
  if (gTasks[taskId2].data[3] === 0) {
    gTasks[taskId2].data[4] = 48;
    gTasks[taskId2].data[5] = 112;
  } else {
    gTasks[taskId2].data[4] = 0;
    gTasks[taskId2].data[5] = 0;
  }
  gTasks[taskId].data[6] = 1;
  gTasks[taskId].func = AnimTask_CreateSurfWave_Step1;
}

function AnimTask_CreateSurfWave_Step1(taskId) {
  const t = gTasks[taskId], t2 = gTasks[t.data[15]];
  S.gBattle_BG1_X = u16(S.gBattle_BG1_X + t.data[0]);
  S.gBattle_BG1_Y = u16(S.gBattle_BG1_Y + t.data[1]);
  t.data[2] += t.data[1];
  if (++t.data[5] === 4) {
    // (rotates BG palette colours 1-7 of the wave: skipped, the layer is a pre-rendered PNG)
    t.data[5] = 0;
  }
  if (++t.data[6] > 1) {
    t.data[6] = 0;
    if (++t.data[3] < 14) {
      t2.data[1] = (t.data[3]) | ((16 - t.data[3]) << 8);
      t.data[4]++;
    }
    if (t.data[3] > 54) {
      t.data[4]--;
      t2.data[1] = (t.data[4]) | ((16 - t.data[4]) << 8);
    }
  }
  if (!(t2.data[1] & 0x1F)) {
    t.data[0] = t2.data[1] & 0x1F;
    t.func = AnimTask_CreateSurfWave_Step2;
  }
}

function AnimTask_CreateSurfWave_Step2(taskId) {
  const t = gTasks[taskId];
  if (t.data[0] === 0) {
    InitBattleAnimBg(1);
    InitBattleAnimBg(2);
    t.data[0]++;
  } else {
    S.gBattle_BG1_X = 0;
    S.gBattle_BG1_Y = 0;
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0));
    gTasks[t.data[15]].data[15] = -1;
    DestroyAnimVisualTask(taskId);
  }
}

// Scanline BLDALPHA: rows [data4, data5) get data[1], the others data[2] (0x1000: EVA 0).
function surfPublishBand(task) {
  SetGpuReg(REG_OFFSET_BLDALPHA, task.data[1]);
  const bg = S.animBgs?.[1];
  if (!bg) return;
  bg.clipY0 = task.data[4];
  bg.clipY1 = task.data[5];
}

function AnimTask_SurfWaveScanlineEffect(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      surfPublishBand(task);
      task.data[0]++;
      break;
    case 1:
      if (task.data[3] === 0) {
        if (--task.data[4] <= 0) {
          task.data[4] = 0;
          task.data[0]++;
        }
      } else if (++task.data[5] > 111) {
        task.data[0]++;
      }
      surfPublishBand(task);
      break;
    case 2:
      surfPublishBand(task);
      if (task.data[15] === -1) {
        // ScanlineEffect_Stop()
        DestroyTask(taskId);
      }
      break;
  }
}

// ================================ battle_anim_ice.c ==============================================
function AnimIceBeamParticle(sprite) {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.data[2] -= gBattleAnimArgs[2];
  else sprite.data[2] += gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  sprite.data[0] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = StartAnimLinearTranslation;
}

function AnimIceEffectParticle(sprite) {
  if (gBattleAnimArgs[2] === 0) {
    InitSpritePosToAnimTarget(sprite, true);
  } else {
    SetAverageBattlerPositions(S.gBattleAnimTarget, 1, sprite); // writes sprite.x / sprite.y
    if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  StoreSpriteCallbackInData6(sprite, AnimFlickerIceEffectParticle);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
}

function AnimFlickerIceEffectParticle(sprite) {
  sprite.invisible = !sprite.invisible;
  if (++sprite.data[0] === 20) DestroySpriteAndMatrix(sprite);
}

// ================================ battle_anim_ground.c ===========================================
function AnimDirtScatter(sprite) {
  InitSpritePosToAnimAttacker(sprite, 1);
  const targetXPos = u8(GetBattlerSpriteCoord2(S.gBattleAnimTarget, BATTLER_COORD_X_2));
  const targetYPos = u8(GetBattlerSpriteCoord2(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET));
  let xOffset = Random() & 0x1F;
  let yOffset = Random() & 0x1F;
  if (xOffset > 16) xOffset = 16 - xOffset;
  if (yOffset > 16) yOffset = 16 - yOffset;
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = targetXPos + xOffset;
  sprite.data[4] = targetYPos + yOffset;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}

// tState data[0], tDelay data[1], tTimer data[2], tMaxTime data[3], tbattlerSpriteIds(i) data[9+i],
// tNumBattlers / tInitialX data[13], tHorizOffset data[14], tInitHorizOffset data[15]
function AnimTask_HorizontalShake(taskId) {
  const task = gTasks[taskId];
  if (gBattleAnimArgs[1] !== 0) task.data[14] = task.data[15] = gBattleAnimArgs[1] + 3;
  else task.data[14] = task.data[15] = idiv(S.gAnimMovePower, 10) + 3;
  task.data[3] = gBattleAnimArgs[2];
  switch (gBattleAnimArgs[0]) {
    case MAX_BATTLERS_COUNT + 1: // Shake terrain
      task.data[13] = S.gBattle_BG3_X;
      task.func = AnimTask_ShakeTerrain;
      break;
    case MAX_BATTLERS_COUNT: // Shake all battlers
      task.data[13] = 0;
      for (let i = 0; i < MAX_BATTLERS_COUNT; i++) {
        if (IsBattlerSpriteVisible(i)) {
          task.data[9 + task.data[13]] = gBattlerSpriteIds[i];
          task.data[13]++;
        }
      }
      task.func = AnimTask_ShakeBattlers;
      break;
    default: // Shake specific battler
      task.data[9] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
      if (task.data[9] === SPRITE_NONE) {
        DestroyAnimVisualTask(taskId);
      } else {
        task.data[13] = 1;
        task.func = AnimTask_ShakeBattlers;
      }
      break;
  }
}

function AnimTask_ShakeTerrain(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      if (++task.data[1] > 1) {
        task.data[1] = 0;
        if ((task.data[2] & 1) === 0) S.gBattle_BG3_X = task.data[13] + task.data[15];
        else S.gBattle_BG3_X = task.data[13] - task.data[15];
        if (++task.data[2] === task.data[3]) {
          task.data[2] = 0;
          task.data[14]--;
          task.data[0]++;
        }
      }
      break;
    case 1:
      if (++task.data[1] > 1) {
        task.data[1] = 0;
        if ((task.data[2] & 1) === 0) S.gBattle_BG3_X = task.data[13] + task.data[14];
        else S.gBattle_BG3_X = task.data[13] - task.data[14];
        if (++task.data[2] === 4) {
          task.data[2] = 0;
          if (--task.data[14] === 0) task.data[0]++;
        }
      }
      break;
    case 2:
      S.gBattle_BG3_X = task.data[13];
      DestroyAnimVisualTask(taskId);
      break;
  }
}

function AnimTask_ShakeBattlers(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      if (++task.data[1] > 1) {
        task.data[1] = 0;
        SetBattlersXOffsetForShake(task);
        if (++task.data[2] === task.data[3]) {
          task.data[2] = 0;
          task.data[14]--;
          task.data[0]++;
        }
      }
      break;
    case 1:
      if (++task.data[1] > 1) {
        task.data[1] = 0;
        SetBattlersXOffsetForShake(task);
        if (++task.data[2] === 4) {
          task.data[2] = 0;
          if (--task.data[14] === 0) task.data[0]++;
        }
      }
      break;
    case 2:
      for (let i = 0; i < task.data[13]; i++) gSprites[task.data[9 + i]].x2 = 0;
      DestroyAnimVisualTask(taskId);
      break;
  }
}

function SetBattlersXOffsetForShake(task) {
  let xOffset;
  if ((task.data[2] & 1) === 0) xOffset = idiv(task.data[14], 2) + (task.data[14] & 1);
  else xOffset = -idiv(task.data[14], 2);
  for (let i = 0; i < task.data[13]; i++) gSprites[task.data[9 + i]].x2 = xOffset;
}

// ================================ battle_anim_rock.c =============================================
function AnimFallingRock(sprite) {
  if (gBattleAnimArgs[3] !== 0) SetAverageBattlerPositions(S.gBattleAnimTarget, 0, sprite);
  sprite.x += gBattleAnimArgs[0];
  sprite.y += 14;
  StartSpriteAnim(sprite, gBattleAnimArgs[1]);
  AnimateSprite(sprite);
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  sprite.data[2] = 4;
  sprite.data[3] = 16;
  sprite.data[4] = -70;
  sprite.data[5] = gBattleAnimArgs[2];
  StoreSpriteCallbackInData6(sprite, AnimFallingRock_Step);
  sprite.callback = TranslateSpriteInEllipse;
  sprite.callback(sprite);
}

function AnimFallingRock_Step(sprite) {
  sprite.x += sprite.data[5];
  sprite.data[0] = 192;
  sprite.data[1] = sprite.data[5];
  sprite.data[2] = 4;
  sprite.data[3] = 32;
  sprite.data[4] = -24;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteInEllipse;
  sprite.callback(sprite);
}

// ================================ battle_anim_flying.c ===========================================
function AnimEllipticalGust(sprite) {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.y += 20;
  sprite.data[1] = 191;
  sprite.callback = AnimEllipticalGust_Step;
  sprite.callback(sprite);
}

function AnimEllipticalGust_Step(sprite) {
  sprite.x2 = Sin(sprite.data[1], 32);
  sprite.y2 = Cos(sprite.data[1], 8);
  sprite.data[1] += 5;
  sprite.data[1] &= 0xFF;
  if (++sprite.data[0] === 71) DestroyAnimSprite(sprite);
}

// Animates the palette on the gust tornado to make it look like its spinning
function AnimTask_AnimateGustTornadoPalette(taskId) {
  gTasks[taskId].data[0] = gBattleAnimArgs[1];
  gTasks[taskId].data[1] = gBattleAnimArgs[0];
  gTasks[taskId].data[2] = IndexOfSpritePaletteTag('ANIM_TAG_GUST');
  gTasks[taskId].func = AnimTask_AnimateGustTornadoPalette_Step;
}

function AnimTask_AnimateGustTornadoPalette_Step(taskId) {
  if (gTasks[taskId].data[10]++ === gTasks[taskId].data[1]) {
    gTasks[taskId].data[10] = 0;
    const data2 = u8(gTasks[taskId].data[2]);
    const base = 256 + data2 * 16; // OBJ_PLTT_ID(data2)
    const temp = gPlttBufferFaded[base + 8];
    let i = 7;
    do {
      gPlttBufferFaded[base + 1 + i] = gPlttBufferFaded[base + i];
    } while (--i > 0);
    gPlttBufferFaded[base + 1] = temp;
  }
  if (--gTasks[taskId].data[0] === 0) DestroyAnimVisualTask(taskId);
}

// Launches a water droplet away from the specified battler. Used by Astonish and Dive
function AnimSprayWaterDroplet(sprite) {
  const v1 = 0x1FF & Random();
  const v2 = 0x7F & Random();
  sprite.data[0] = v1 % 2 ? 736 + v1 : 736 - v1;
  sprite.data[1] = v2 % 2 ? 896 + v2 : 896 - v2;
  sprite.data[2] = gBattleAnimArgs[0];
  if (sprite.data[2]) setOamFlip(sprite, 1, 0); // oam.matrixNum = ST_OAM_HFLIP
  if (gBattleAnimArgs[1] === 0) {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y) + 32;
  } else {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y) + 32;
  }
  sprite.callback = AnimSprayWaterDroplet_Step;
}

function AnimSprayWaterDroplet_Step(sprite) {
  if (sprite.data[2] === 0) {
    sprite.x2 += sprite.data[0] >> 8;
    sprite.y2 -= sprite.data[1] >> 8;
  } else {
    sprite.x2 -= sprite.data[0] >> 8;
    sprite.y2 -= sprite.data[1] >> 8;
  }
  sprite.data[1] -= 32;
  if (sprite.data[0] < 0) sprite.data[0] = 0;
  if (++sprite.data[3] === 31) DestroyAnimSprite(sprite);
}

// ================================ extra moves (stretch list) =====================================
const DISPLAY_WIDTH = 240, DISPLAY_HEIGHT = 160;

// sprite.c CreateInvisibleSpriteWithCallback (gDummySpriteTemplate, invisible)
function CreateInvisibleSpriteWithCallback(callback) {
  const id = CreateSprite({ w: 8, h: 8, callbackFn: callback }, DISPLAY_WIDTH + 64, DISPLAY_HEIGHT, 14);
  gSprites[id].invisible = true;
  return id;
}

// ---- fire (FIRE_PUNCH, FIRE_BLAST, FLAME_WHEEL) ----
const sShakeDirsPattern0 = [-1, -1, 0, 1, 1, 0, 0, -1, -1, 1, 1, 0, 0, -1, 0, 1];
const sShakeDirsPattern1 = [-1, 0, 1, 0, -1, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, 1];

function AnimFireSpiralInward(sprite) {
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = 0x3C;
  sprite.data[2] = 0x9;
  sprite.data[3] = 0x1E;
  sprite.data[4] = 0xFE00;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteInGrowingCircle;
  sprite.callback(sprite);
}

function AnimFireSpread(sprite) {
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[2] = gBattleAnimArgs[3];
  sprite.callback = TranslateSpriteLinearFixedPoint;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

function AnimFireRing(sprite) {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[7] = gBattleAnimArgs[2];
  sprite.data[0] = 0;
  sprite.callback = AnimFireRing_Step1;
}
function AnimFireRing_Step1(sprite) {
  UpdateFireRingCircleOffset(sprite);
  if (++sprite.data[0] === 0x12) {
    sprite.data[0] = 0x19;
    sprite.data[1] = sprite.x;
    sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
    sprite.data[3] = sprite.y;
    sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
    InitAnimLinearTranslation(sprite);
    sprite.callback = AnimFireRing_Step2;
  }
}
function AnimFireRing_Step2(sprite) {
  if (AnimTranslateLinear(sprite)) {
    sprite.data[0] = 0;
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
    sprite.x2 = sprite.y2 = 0;
    sprite.callback = AnimFireRing_Step3;
    sprite.callback(sprite);
  } else {
    sprite.x2 += Sin(sprite.data[7], 28);
    sprite.y2 += Cos(sprite.data[7], 28);
    sprite.data[7] = (sprite.data[7] + 20) & 0xFF;
  }
}
function AnimFireRing_Step3(sprite) {
  UpdateFireRingCircleOffset(sprite);
  if (++sprite.data[0] === 0x1F) DestroyAnimSprite(sprite);
}
function UpdateFireRingCircleOffset(sprite) {
  sprite.x2 = Sin(sprite.data[7], 28);
  sprite.y2 = Cos(sprite.data[7], 28);
  sprite.data[7] = (sprite.data[7] + 20) & 0xFF;
}

function AnimFireCross(sprite) {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteLinear;
}

function AnimFireSpiralOutward(sprite) {
  InitSpritePosToAnimAttacker(sprite, 1);
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.invisible = true;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, AnimFireSpiralOutward_Step1);
}
function AnimFireSpiralOutward_Step1(sprite) {
  sprite.invisible = false;
  sprite.data[0] = sprite.data[1];
  sprite.data[1] = 0;
  sprite.callback = AnimFireSpiralOutward_Step2;
  sprite.callback(sprite);
}
function AnimFireSpiralOutward_Step2(sprite) {
  sprite.x2 = Sin(sprite.data[1], sprite.data[2] >> 8);
  sprite.y2 = Cos(sprite.data[1], sprite.data[2] >> 8);
  sprite.data[1] = (sprite.data[1] + 10) & 0xFF;
  sprite.data[2] += 0xD0;
  if (--sprite.data[0] === -1) DestroyAnimSprite(sprite);
}

// tShakeNum data[0], tMaxShakes data[1], tShakeOffset data[2], tVertical data[3], tPatternId data[4]
function AnimTask_ShakeTargetInPattern(taskId) {
  const t = gTasks[taskId];
  if (t.data[0] === 0) {
    t.data[1] = gBattleAnimArgs[0];
    t.data[2] = gBattleAnimArgs[1];
    t.data[3] = gBattleAnimArgs[2];
    t.data[4] = gBattleAnimArgs[3];
  }
  t.data[0]++;
  const spriteId = gBattlerSpriteIds[S.gBattleAnimTarget];
  const dir = t.data[4] === 0 ? sShakeDirsPattern0[t.data[0] % 10] : sShakeDirsPattern1[t.data[0] % 10];
  if (t.data[3] === 1) gSprites[spriteId].y2 = Math.abs(gBattleAnimArgs[1] * dir);
  else gSprites[spriteId].x2 = gBattleAnimArgs[1] * dir;
  if (t.data[0] === t.data[1]) {
    gSprites[spriteId].x2 = 0;
    gSprites[spriteId].y2 = 0;
    DestroyAnimVisualTask(taskId);
  }
}

// ---- electric (THUNDER) ----
function AnimLightning(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.callback = AnimLightning_Step;
}
function AnimLightning_Step(sprite) {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

// ---- flying ----
function AnimGustToTarget(sprite) {
  InitSpritePosToAnimAttacker(sprite, true);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = sprite.x;
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[3] = sprite.y;
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  InitAnimLinearTranslation(sprite);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  StoreSpriteCallbackInData6(sprite, AnimGustToTarget_Step);
}
function AnimGustToTarget_Step(sprite) {
  if (AnimTranslateLinear(sprite)) DestroyAnimSprite(sprite);
}

// ---- ice (ICE_PUNCH, BLIZZARD, POWDER_SNOW) ----
function AnimIcePunchSwirlingParticle(sprite) {
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = 60;
  sprite.data[2] = 9;
  sprite.data[3] = 30;
  sprite.data[4] = -512;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteInGrowingCircle;
  sprite.callback(sprite);
}

function offscreen(sprite) {
  return sprite.x + sprite.x2 > DISPLAY_WIDTH + 16 || sprite.x + sprite.x2 < -16
    || sprite.y + sprite.y2 > DISPLAY_HEIGHT || sprite.y + sprite.y2 < -16;
}
// SetAverageBattlerPositions(gBattleAnimTarget, 1, &sprite->data[2], &sprite->data[4])
function setAverageIntoData24(sprite) {
  const p = SetAverageBattlerPositions(S.gBattleAnimTarget, 1, {});
  sprite.data[2] = p.x; sprite.data[4] = p.y;
}

function AnimSwirlingSnowball(sprite) {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  if (!gBattleAnimArgs[5]) {
    sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
    sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  } else {
    setAverageIntoData24(sprite);
  }
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.data[2] -= gBattleAnimArgs[2];
  else sprite.data[2] += gBattleAnimArgs[2];
  const tempDataHolder = Int16Array.from(sprite.data);
  InitAnimFastLinearTranslationWithSpeed(sprite);
  sprite.data[1] ^= 1;
  sprite.data[2] ^= 1;
  for (let guard = 0; guard < 4096; guard++) {
    sprite.data[0] = 1;
    AnimFastTranslateLinear(sprite);
    if (offscreen(sprite)) break;
  }
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.x2 = sprite.y2 = 0;
  sprite.data.set(tempDataHolder);
  sprite.callback = InitAnimFastLinearTranslationWithSpeedAndPos;
  StoreSpriteCallbackInData6(sprite, AnimSwirlingSnowball_Step1);
}
function AnimSwirlingSnowball_Step1(sprite) {
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.y2 = 0;
  sprite.x2 = 0;
  sprite.data[0] = 128;
  const tempVar = GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER ? 20 : -20;
  sprite.data[3] = Sin(sprite.data[0], tempVar);
  sprite.data[4] = Cos(sprite.data[0], 0xF);
  sprite.data[5] = 0;
  sprite.callback = AnimSwirlingSnowball_Step2;
  sprite.callback(sprite);
}
function AnimSwirlingSnowball_Step2(sprite) {
  const tempVar = GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER ? 20 : -20;
  if (sprite.data[5] <= 31) {
    sprite.x2 = Sin(sprite.data[0], tempVar) - sprite.data[3];
    sprite.y2 = Cos(sprite.data[0], 15) - sprite.data[4];
    sprite.data[0] = (sprite.data[0] + 16) & 0xFF;
    sprite.data[5] += 1;
  } else {
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.x2 = sprite.y2 = 0;
    sprite.data[3] = sprite.data[4] = 0;
    sprite.callback = AnimSwirlingSnowball_End;
  }
}
function AnimSwirlingSnowball_End(sprite) {
  sprite.data[0] = 1;
  AnimFastTranslateLinear(sprite);
  if (((sprite.x + sprite.x2 + 16) >>> 0) > 272 || sprite.y + sprite.y2 > 256 || sprite.y + sprite.y2 < -16)
    DestroyAnimSprite(sprite);
}

function AnimMoveParticleBeyondTarget(sprite) {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  if (!gBattleAnimArgs[7]) {
    sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
    sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  } else {
    setAverageIntoData24(sprite);
  }
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.data[2] -= gBattleAnimArgs[2];
  else sprite.data[2] += gBattleAnimArgs[2];
  sprite.data[4] += gBattleAnimArgs[3];
  InitAnimFastLinearTranslationWithSpeed(sprite);
  const tempDataHolder = Int16Array.from(sprite.data);
  sprite.data[1] ^= 1;
  sprite.data[2] ^= 1;
  for (let guard = 0; guard < 4096; guard++) {
    sprite.data[0] = 1;
    AnimFastTranslateLinear(sprite);
    if (offscreen(sprite)) break;
  }
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.y2 = 0;
  sprite.x2 = 0;
  sprite.data.set(tempDataHolder);
  sprite.data[5] = gBattleAnimArgs[5];
  sprite.data[6] = gBattleAnimArgs[6];
  sprite.callback = AnimWiggleParticleTowardsTarget;
}
function AnimWiggleParticleTowardsTarget(sprite) {
  AnimFastTranslateLinear(sprite);
  if (sprite.data[0] === 0) sprite.data[0] = 1;
  sprite.y2 += Sin(sprite.data[7], sprite.data[5]);
  sprite.data[7] = (sprite.data[7] + sprite.data[6]) & 0xFF;
  if (sprite.data[0] === 1 && offscreen(sprite)) DestroyAnimSprite(sprite);
}

// ---- rock (ROCK_TOMB) ----
function AnimRockTomb(sprite) {
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  sprite.x2 = gBattleAnimArgs[0];
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.data[3] -= gBattleAnimArgs[2];
  sprite.data[0] = 3;
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimRockTomb_Step;
  sprite.invisible = true;
}
function AnimRockTomb_Step(sprite) {
  sprite.invisible = false;
  if (sprite.data[3] !== 0) {
    sprite.y2 = sprite.data[2] + sprite.data[3];
    sprite.data[3] += sprite.data[0];
    ++sprite.data[0];
    if (sprite.data[3] > 0) sprite.data[3] = 0;
  } else if (--sprite.data[1] === 0) {
    DestroyAnimSprite(sprite);
  }
}

// ---- ground (DIG, MUD_SLAP) ----
// DIG hides the attacker by moving its BG copy (monbg) and cutting it off with a BGxHOFS scanline effect.
// Here the POKéMON is a sprite: we move it with y2 instead of the BG offset and skip the cut-off.
function AnimTask_DigDownMovement(taskId) {
  const task = gTasks[taskId];
  task.func = gBattleAnimArgs[0] === 0 ? AnimTask_DigBounceMovement : AnimTask_DigDisappear;
  task.func(taskId);
}
function AnimTask_DigBounceMovement(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0: {
      task.data[10] = GetAnimBattlerSpriteId(ANIM_ATTACKER);
      task.data[11] = GetBattlerSpriteBGPriorityRank(S.gBattleAnimAttacker);
      const var0 = u8(GetBattlerYCoordWithElevation(S.gBattleAnimAttacker));
      task.data[14] = var0 - 32;
      task.data[15] = var0 + 32;
      if (task.data[14] < 0) task.data[14] = 0;
      // (C hides the sprite here; its BG copy is what moves) -- we keep the sprite shown instead
      ++task.data[0];
      break;
    }
    case 1:
      // SetDigScanlineEffect(task->data[11], task->data[14], task->data[15]) (skipped)
      ++task.data[0];
      break;
    case 2:
      task.data[2] = (task.data[2] + 6) & 0x7F;
      if (++task.data[4] > 2) {
        task.data[4] = 0;
        ++task.data[3];
      }
      task.data[5] = task.data[3] + (gSineTable[task.data[2]] >> 4);
      gSprites[task.data[10]].y2 = task.data[5]; // C: gBattle_BGx_Y = data[13] - data[5]
      if (task.data[5] > 63) {
        gSprites[task.data[10]].y2 = 0;
        gSprites[task.data[10]].invisible = true;
        ++task.data[0];
      }
      break;
    case 3:
      ++task.data[0];
      break;
    case 4:
      DestroyAnimVisualTask(taskId);
      gSprites[task.data[10]].invisible = true;
      break;
  }
}
function AnimTask_DigDisappear(taskId) {
  const spriteId = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  gSprites[spriteId].invisible = true;
  gSprites[spriteId].x2 = 0;
  gSprites[spriteId].y2 = 0;
  DestroyAnimVisualTask(taskId);
}
function AnimTask_DigUpMovement(taskId) {
  const task = gTasks[taskId];
  task.func = gBattleAnimArgs[0] === 0 ? AnimTask_DigSetVisibleUnderground : AnimTask_DigRiseUpFromHole;
  task.func(taskId);
}
function AnimTask_DigSetVisibleUnderground(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      task.data[10] = GetAnimBattlerSpriteId(ANIM_ATTACKER);
      gSprites[task.data[10]].invisible = false;
      gSprites[task.data[10]].x2 = 0;
      gSprites[task.data[10]].y2 = DISPLAY_HEIGHT - gSprites[task.data[10]].y;
      ++task.data[0];
      break;
    case 1:
      DestroyAnimVisualTask(taskId);
  }
}
function AnimTask_DigRiseUpFromHole(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      task.data[10] = GetAnimBattlerSpriteId(ANIM_ATTACKER);
      ++task.data[0];
      break;
    case 1:
      ++task.data[0]; // SetDigScanlineEffect (skipped)
      break;
    case 2:
      gSprites[task.data[10]].y2 = 96;
      ++task.data[0];
      break;
    case 3:
      gSprites[task.data[10]].y2 -= 8;
      if (gSprites[task.data[10]].y2 === 0) ++task.data[0];
      break;
    case 4:
      DestroyAnimVisualTask(taskId);
      break;
  }
}

function AnimDirtPlumeParticle(sprite) {
  const battler = gBattleAnimArgs[0] === 0 ? S.gBattleAnimAttacker : S.gBattleAnimTarget;
  let xOffset = 24;
  if (gBattleAnimArgs[1] === 1) {
    xOffset *= -1;
    gBattleAnimArgs[2] *= -1;
  }
  sprite.x = GetBattlerSpriteCoord(battler, BATTLER_COORD_X_2) + xOffset;
  sprite.y = GetBattlerYCoordWithElevation(battler) + 30;
  sprite.data[0] = gBattleAnimArgs[5];
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[4] = sprite.y + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[4];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimDirtPlumeParticle_Step;
}
function AnimDirtPlumeParticle_Step(sprite) {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

function AnimDigDirtMound(sprite) {
  const battler = gBattleAnimArgs[0] === 0 ? S.gBattleAnimAttacker : S.gBattleAnimTarget;
  sprite.x = GetBattlerSpriteCoord(battler, BATTLER_COORD_X) - 16 + (gBattleAnimArgs[1] * 32);
  sprite.y = GetBattlerYCoordWithElevation(battler) + 32;
  sprite.oam.tileNum += gBattleAnimArgs[1] * 8;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = WaitAnimForDuration;
}

// ---- water (BUBBLE, BUBBLE_BEAM, WATER_PULSE) ----
function AnimWaterBubbleProjectile(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2) - gBattleAnimArgs[0];
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
    sprite.animPaused = true;
  } else {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2) + gBattleAnimArgs[0];
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
    sprite.animPaused = true;
  }
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[6];
  sprite.data[1] = sprite.x;
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[3] = sprite.y;
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  const spriteId = CreateInvisibleSpriteWithCallback(() => {});
  sprite.data[5] = spriteId;
  sprite.x -= Sin(u8(gBattleAnimArgs[4]), gBattleAnimArgs[2]);
  sprite.y -= Cos(u8(gBattleAnimArgs[4]), gBattleAnimArgs[3]);
  gSprites[spriteId].data[0] = gBattleAnimArgs[2];
  gSprites[spriteId].data[1] = gBattleAnimArgs[3];
  gSprites[spriteId].data[2] = gBattleAnimArgs[5];
  gSprites[spriteId].data[3] = u8(gBattleAnimArgs[4]) * 256;
  gSprites[spriteId].data[4] = gBattleAnimArgs[6];
  sprite.callback = AnimWaterBubbleProjectile_Step1;
  sprite.callback(sprite);
}
function AnimWaterBubbleProjectile_Step1(sprite) {
  const otherSpriteId = u8(sprite.data[5]);
  let timer = u8(gSprites[otherSpriteId].data[4]);
  const trigIndex = u16(gSprites[otherSpriteId].data[3]);
  sprite.data[0] = 1;
  AnimTranslateLinear(sprite);
  sprite.x2 += Sin(trigIndex >> 8, gSprites[otherSpriteId].data[0]);
  sprite.y2 += Cos(trigIndex >> 8, gSprites[otherSpriteId].data[1]);
  gSprites[otherSpriteId].data[3] = trigIndex + gSprites[otherSpriteId].data[2];
  timer = u8(timer - 1);
  if (timer !== 0) {
    gSprites[otherSpriteId].data[4] = timer;
  } else {
    sprite.callback = AnimWaterBubbleProjectile_Step2;
    DestroySprite(gSprites[otherSpriteId]);
  }
}
function AnimWaterBubbleProjectile_Step2(sprite) {
  sprite.animPaused = false;
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, AnimWaterBubbleProjectile_Step3);
}
function AnimWaterBubbleProjectile_Step3(sprite) {
  sprite.data[0] = 10;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}

function AnimWaterPulseBubble(sprite) {
  sprite.x = gBattleAnimArgs[0];
  sprite.y = gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  sprite.data[3] = gBattleAnimArgs[5];
  sprite.callback = AnimWaterPulseBubble_Step;
}
function AnimWaterPulseBubble_Step(sprite) {
  sprite.data[4] -= sprite.data[0];
  sprite.y2 = idiv(sprite.data[4], 10);
  sprite.data[5] = (sprite.data[5] + sprite.data[1]) & 0xFF;
  sprite.x2 = Sin(sprite.data[5], sprite.data[2]);
  if (--sprite.data[3] === 0) DestroyAnimSprite(sprite);
}
function AnimWaterPulseRingBubble(sprite) {
  sprite.data[3] += sprite.data[1];
  sprite.data[4] += sprite.data[2];
  sprite.x2 = sprite.data[3] >> 7;
  sprite.y2 = sprite.data[4] >> 7;
  if (--sprite.data[0] === 0) {
    FreeSpriteOamMatrix(sprite);
    DestroySprite(sprite);
  }
}
function AnimWaterPulseRing(sprite) {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[1] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[3] = gBattleAnimArgs[2];
  sprite.data[4] = gBattleAnimArgs[3];
  sprite.callback = AnimWaterPulseRing_Step;
}
function AnimWaterPulseRing_Step(sprite) {
  const xDiff = sprite.data[1] - sprite.x;
  const yDiff = sprite.data[2] - sprite.y;
  sprite.x2 = idiv(sprite.data[0] * xDiff, sprite.data[3]);
  sprite.y2 = idiv(sprite.data[0] * yDiff, sprite.data[3]);
  if (++sprite.data[5] === sprite.data[4]) {
    sprite.data[5] = 0;
    CreateWaterPulseRingBubbles(sprite, xDiff, yDiff);
  }
  if (sprite.data[3] === sprite.data[0]) DestroyAnimSprite(sprite);
  sprite.data[0]++;
}
function CreateWaterPulseRingBubbles(sprite, xDiff, yDiff) {
  const something = idiv(sprite.data[0], 2);
  const combinedX = sprite.x + sprite.x2;
  const combinedY = sprite.y + sprite.y2;
  const somethingRandomY = ((yDiff + (Random() % 10) - 5) << 16) >> 16;
  const somethingRandomX = ((-xDiff + (Random() % 10) - 5) << 16) >> 16;
  const tpl = T('gWaterPulseRingBubbleSpriteTemplate');
  let spriteId = CreateSprite(tpl, combinedX, combinedY + something, 130);
  gSprites[spriteId].data[0] = 20;
  gSprites[spriteId].data[1] = somethingRandomY;
  gSprites[spriteId].subpriority = GetBattlerSpriteSubpriority(S.gBattleAnimAttacker) - 1;
  gSprites[spriteId].data[2] = somethingRandomX < 0 ? -somethingRandomX : somethingRandomX;
  spriteId = CreateSprite(tpl, combinedX, combinedY - something, 130);
  gSprites[spriteId].data[0] = 20;
  gSprites[spriteId].data[1] = somethingRandomY;
  gSprites[spriteId].subpriority = GetBattlerSpriteSubpriority(S.gBattleAnimAttacker) - 1;
  gSprites[spriteId].data[2] = somethingRandomX > 0 ? -somethingRandomX : somethingRandomX;
}

register({
  AnimThunderboltOrb, AnimSparkElectricityFlashing, AnimElectricity, AnimTask_ElectricBolt, AnimElectricBoltSegment,
  AnimThunderWave, AnimEmberFlare, AnimToTargetInSinWave, AnimTask_StartSinAnimTimer, AnimWaterGunDroplet,
  AnimTask_CreateSurfWave, AnimIceBeamParticle, AnimIceEffectParticle, AnimDirtScatter, AnimTask_HorizontalShake,
  AnimFallingRock, AnimEllipticalGust, AnimTask_AnimateGustTornadoPalette, AnimSprayWaterDroplet,
  AnimFireSpiralInward, AnimFireSpread, AnimFireRing, AnimFireCross, AnimFireSpiralOutward, AnimTask_ShakeTargetInPattern,
  AnimLightning, AnimGustToTarget, AnimIcePunchSwirlingParticle, AnimSwirlingSnowball, AnimMoveParticleBeyondTarget,
  AnimRockTomb, AnimTask_DigDownMovement, AnimTask_DigUpMovement, AnimDirtPlumeParticle, AnimDigDirtMound,
  AnimWaterBubbleProjectile, AnimWaterPulseBubble, AnimWaterPulseRing, AnimWaterPulseRingBubble,
});
