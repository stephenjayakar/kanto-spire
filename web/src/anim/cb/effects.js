// Effects / status / bug / dark / poison / fight callbacks, ported from pokefirered
// (src/battle_anim_bug.c, battle_anim_dark.c, battle_anim_effects_1/2/3.c, battle_anim_fight.c, battle_anim_poison.c).
import {
  S, gSprites, gTasks, gBattleAnimArgs, gBattlerSpriteIds, gPlttBufferUnfaded, gPlttBufferFaded,
  ANIM_ATTACKER, ANIM_TARGET, B_SIDE_PLAYER, B_SIDE_OPPONENT, B_POSITION_PLAYER_LEFT, B_POSITION_OPPONENT_LEFT,
  BATTLER_COORD_X, BATTLER_COORD_Y, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET, FALSE, TRUE, MAX_SPRITES,
  RGB, RGB_BLACK, RGB_WHITE, Sin, Cos, Random, u16, idiv,
  CreateSprite, DestroySprite, DestroyTask, StartSpriteAnim, StartSpriteAffineAnim, BlendPalette,
  GetBattlerSide, GetBattlerPosition, GetBattlerSpriteCoord, GetBattlerSpriteCoord2, GetAnimBattlerSpriteId,
  GetBattlerSpriteSubpriority, T, affineAnimByName, register,
  SetGpuReg, SetGpuRegBits, ClearGpuRegBits, REG_OFFSET_BLDCNT, REG_OFFSET_BLDALPHA, REG_OFFSET_DISPCNT, BLDALPHA_BLEND,
  BLDCNT_TGT1_BG1, BLDCNT_TGT1_BG2, BLDCNT_TGT2_ALL, BLDCNT_EFFECT_BLEND, ST_OAM_OBJ_BLEND, ST_OAM_AFFINE_OFF, ST_OAM_AFFINE_NORMAL,
  GetBattlerSpriteBGPriorityRank, GetBattlerSpriteBGPriority, GetBattlerSpriteCoordAttr, BATTLER_COORD_ATTR_WIDTH, BATTLER_COORD_ATTR_HEIGHT,
  IndexOfSpritePaletteTag, AllocSpritePalette, FreeSpritePaletteByTag, gSineTable, PlaySE, PlaySE12WithPanning,
  AllocOamMatrix, FreeOamMatrix, InitSpriteAffineAnim,
} from '../gba.js';
import {
  DestroyAnimSprite, DestroyAnimVisualTask, InitSpritePosToAnimAttacker, InitSpritePosToAnimTarget,
  StartAnimLinearTranslation, StoreSpriteCallbackInData6, RunStoredCallbackWhenAnimEnds, RunStoredCallbackWhenAffineAnimEnds,
  InitAnimArcTranslation, TranslateAnimHorizontalArc, InitAnimFastLinearTranslationWithSpeed, AnimFastTranslateLinear,
  ArcTan2Neg, TrySetSpriteRotScale, PrepareAffineAnimInTaskData, RunAffineAnimFromTaskData, DestroySpriteAndMatrix,
  SetAnimSpriteInitialXOffset, SetSpriteCoordsToAnimAttackerCoords, SetAverageBattlerPositions,
  InitAnimLinearTranslationWithSpeed, AnimTranslateLinear, InitSpriteDataForLinearTranslation, TranslateSpriteLinearFixedPoint,
  WaitAnimForDuration, DestroyAnimSpriteAndDisableBlend, CloneBattlerSpriteWithBlend, DestroySpriteWithActiveSheet,
  PrepareBattlerSpriteForRotScale, SetSpriteRotScale, ResetSpriteRotScale,
} from '../helpers.js';

const DISPCNT_BG1_ON = 1 << 9, DISPCNT_BG2_ON = 1 << 10;
const ARG_RET_ID = 7;

// ---- private helper (battle_anim_mons.c AnimTravelDiagonally), not exported by helpers.js -------------------------------
function AnimTravelDiagonally(sprite) {
  let r4, battlerId, coordType;
  if (!gBattleAnimArgs[6]) { r4 = TRUE; coordType = BATTLER_COORD_Y_PIC_OFFSET; }
  else { r4 = FALSE; coordType = BATTLER_COORD_Y; }
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

// ---- battle_anim_bug.c ---------------------------------------------------------------------------
function AnimLeechLifeNeedle(sprite) {
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  }
  sprite.x = GetBattlerSpriteCoord2(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord2(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

function AnimTranslateStinger(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    gBattleAnimArgs[2] = -gBattleAnimArgs[2];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  if (GetBattlerSide(S.gBattleAnimAttacker) === GetBattlerSide(S.gBattleAnimTarget)) {
    if (GetBattlerPosition(S.gBattleAnimTarget) === B_POSITION_PLAYER_LEFT
      || GetBattlerPosition(S.gBattleAnimTarget) === B_POSITION_OPPONENT_LEFT) {
      gBattleAnimArgs[2] = -gBattleAnimArgs[2];
      gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    }
  }
  InitSpritePosToAnimAttacker(sprite, 1);
  const lVarX = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  const lVarY = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  let rot = ArcTan2Neg(lVarX - sprite.x, lVarY - sprite.y);
  rot = u16(rot + 0xC000);
  TrySetSpriteRotScale(sprite, FALSE, 0x100, 0x100, rot);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = lVarX;
  sprite.data[4] = lVarY;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// ---- battle_anim_dark.c --------------------------------------------------------------------------
function AnimBite(sprite) {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[2]);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[1] = gBattleAnimArgs[4];
  sprite.data[2] = gBattleAnimArgs[5];
  sprite.callback = AnimBite_Step1;
}
function AnimBite_Step1(sprite) {
  sprite.data[4] += sprite.data[0];
  sprite.data[5] += sprite.data[1];
  sprite.x2 = sprite.data[4] >> 8;
  sprite.y2 = sprite.data[5] >> 8;
  if (++sprite.data[3] === sprite.data[2]) sprite.callback = AnimBite_Step2;
}
function AnimBite_Step2(sprite) {
  sprite.data[4] -= sprite.data[0];
  sprite.data[5] -= sprite.data[1];
  sprite.x2 = sprite.data[4] >> 8;
  sprite.y2 = sprite.data[5] >> 8;
  if (--sprite.data[3] === 0) DestroySpriteAndMatrix(sprite);
}

function AnimClawSlash(sprite) {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  StartSpriteAnim(sprite, gBattleAnimArgs[2]);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// APPROXIMATION: the game draws gMetalShine (a diagonal light band on BG1) through an OBJ window cut
// to the attacker's shape, and greyscales the mon's palette. Here: a base tint (silver, or the custom
// colour of arg1/arg2 as in C) plus a white flash that sweeps up and down twice, on the same timeline
// (two 32-frame passes, palette restored at the 2nd, task ends at the 3rd).
// arg0: if true won't change battler's palette back; arg1: use custom color; arg2: custom color
function MetallicShineBlend(task, shine) {
  const palOffset = task.data[4];
  const baseCoeff = task.data[2] ? 11 : 5;
  const baseColor = task.data[2] ? u16(task.data[3]) : RGB(22, 22, 25);
  if (shine > baseCoeff) BlendPalette(palOffset, 16, shine, RGB_WHITE);
  else BlendPalette(palOffset, 16, baseCoeff, baseColor);
}
function AnimTask_MetallicShine(taskId) {
  const spriteId = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  const paletteNum = 16 + gSprites[spriteId].oam.paletteNum;
  const task = gTasks[taskId];
  task.data[1] = gBattleAnimArgs[0];
  task.data[2] = gBattleAnimArgs[1];
  task.data[3] = gBattleAnimArgs[2];
  task.data[4] = paletteNum * 16;
  MetallicShineBlend(task, 0);
  task.func = AnimTask_MetallicShine_Step;
}
function AnimTask_MetallicShine_Step(taskId) {
  const task = gTasks[taskId];
  task.data[10] += 4;
  if (task.data[11] < 2) MetallicShineBlend(task, Sin(task.data[10], 12));
  if (task.data[10] === 128) {
    task.data[10] = 0;
    task.data[11]++;
    if (task.data[11] === 2) {
      if (task.data[1] === 0) BlendPalette(task.data[4], 16, 0, RGB_BLACK);
    } else if (task.data[11] === 3) {
      DestroyAnimVisualTask(taskId);
    }
  }
}

// ---- battle_anim_effects_1.c ---------------------------------------------------------------------
function AnimMovePowderParticle(sprite) {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  if (GetBattlerSide(S.gBattleAnimAttacker)) sprite.data[3] = -gBattleAnimArgs[4];
  else sprite.data[3] = gBattleAnimArgs[4];
  sprite.data[4] = gBattleAnimArgs[5];
  sprite.callback = AnimMovePowderParticle_Step;
}
function AnimMovePowderParticle_Step(sprite) {
  if (sprite.data[0] > 0) {
    sprite.data[0]--;
    sprite.y2 = sprite.data[2] >> 8;
    sprite.data[2] += sprite.data[1];
    sprite.x2 = Sin(sprite.data[5], sprite.data[3]);
    sprite.data[5] = (sprite.data[5] + sprite.data[4]) & 0xFF;
  } else {
    DestroyAnimSprite(sprite);
  }
}

function AnimAbsorptionOrb(sprite) {
  InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[5] = gBattleAnimArgs[2];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimAbsorptionOrb_Step;
}
function AnimAbsorptionOrb_Step(sprite) {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

function AnimHyperBeamOrb(sprite) {
  const animNum = u16(Random());
  StartSpriteAnim(sprite, animNum % 8);
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.x -= 20;
  else sprite.x += 20;
  const speed = u16(Random());
  sprite.data[0] = (speed & 31) + 64;
  sprite.data[1] = sprite.x;
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[3] = sprite.y;
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimFastLinearTranslationWithSpeed(sprite);
  sprite.data[5] = Random() & 0xFF;
  sprite.data[6] = sprite.subpriority;
  sprite.callback = AnimHyperBeamOrb_Step;
  sprite.callback(sprite);
}
function AnimHyperBeamOrb_Step(sprite) {
  if (AnimFastTranslateLinear(sprite)) {
    DestroyAnimSprite(sprite);
  } else {
    sprite.y2 += Cos(sprite.data[5], 12);
    if (sprite.data[5] < 0x7F) sprite.subpriority = sprite.data[6];
    else sprite.subpriority = sprite.data[6] + 1;
    sprite.data[5] += 24;
    sprite.data[5] &= 0xFF;
  }
}

function AnimWhipHit_WaitEnd(sprite) {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}
function AnimWhipHit(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER) StartSpriteAnim(sprite, 1);
  sprite.callback = AnimWhipHit_WaitEnd;
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
}

// ---- battle_anim_effects_2.c ---------------------------------------------------------------------
function AnimSwordsDanceBlade(sprite) {
  InitSpritePosToAnimAttacker(sprite, FALSE);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  StoreSpriteCallbackInData6(sprite, AnimSwordsDanceBlade_Step);
}
function AnimSwordsDanceBlade_Step(sprite) {
  sprite.data[0] = 6;
  sprite.data[2] = sprite.x;
  sprite.data[4] = sprite.y - 32;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

function AnimTask_StretchTargetUp(taskId) {
  const spriteId = GetAnimBattlerSpriteId(ANIM_TARGET);
  if (++gTasks[taskId].data[0] === 1) {
    PrepareAffineAnimInTaskData(gTasks[taskId], GetAnimBattlerSpriteId(ANIM_TARGET), affineAnimByName('sAffineAnims_StretchBattlerUp'));
    gSprites[spriteId].x2 = 4;
  } else {
    gSprites[spriteId].x2 = -gSprites[spriteId].x2;
    if (!RunAffineAnimFromTaskData(gTasks[taskId])) {
      gSprites[spriteId].x2 = 0;
      gSprites[spriteId].y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  }
}

// ---- battle_anim_effects_3.c ---------------------------------------------------------------------
// APPROXIMATION: the C step rotates colours 1..11 of the battle BG palette (GetBattleBgPaletteNum) every
// 4 frames to cycle BG_PSYCHIC's colours. Our BG palettes are virtual tint palettes (entry 0 = black,
// 1 = white), so rotating them would produce a bogus tint; the BG image itself is shown by fadetobg.
// We keep the task alive with the same lifetime (until gBattleAnimArgs[7] == 0xFFFF) and do nothing.
function AnimTask_SetPsychicBackground(taskId) {
  gTasks[taskId].func = SetPsychicBackground_Step;
  S.gAnimVisualTaskCount--;
}
function SetPsychicBackground_Step(taskId) {
  if (++gTasks[taskId].data[5] === 4) gTasks[taskId].data[5] = 0;
  if (u16(gBattleAnimArgs[7]) === 0xFFFF) DestroyTask(taskId);
}

function AnimLeer(sprite) {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// AnimTask_SquishAndSweatDroplets task data
const IDX_ACTIVE_SPRITES = 2;
// tState data[0], tTimer data[1], tActiveSprites data[2], tNumSquishes data[3], tBaseX data[4], tBaseY data[5],
// tSubpriority data[6], data[7]-data[15] used by PrepareAffineAnimInTaskData, tBattlerSpriteId data[15]
// arg 0: battler; arg 1: num squishes
function AnimTask_SquishAndSweatDroplets(taskId) {
  let battler;
  const task = gTasks[taskId];
  if (!gBattleAnimArgs[1]) { DestroyAnimVisualTask(taskId); return; }
  task.data[0] = 0;
  task.data[1] = 0;
  task.data[2] = 0;
  task.data[3] = gBattleAnimArgs[1];
  if (gBattleAnimArgs[0] === ANIM_ATTACKER) battler = S.gBattleAnimAttacker;
  else battler = S.gBattleAnimTarget;
  task.data[4] = GetBattlerSpriteCoord(battler, BATTLER_COORD_X);
  task.data[5] = GetBattlerSpriteCoord(battler, BATTLER_COORD_Y);
  task.data[6] = GetBattlerSpriteSubpriority(battler);
  task.data[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  PrepareAffineAnimInTaskData(task, task.data[15], affineAnimByName('sFacadeSquishAffineAnimCmds'));
  task.func = AnimTask_SquishAndSweatDroplets_Step;
}
function AnimTask_SquishAndSweatDroplets_Step(taskId) {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      task.data[1]++;
      if (task.data[1] === 6) CreateSweatDroplets(taskId, TRUE);
      if (task.data[1] === 18) CreateSweatDroplets(taskId, FALSE);
      if (!RunAffineAnimFromTaskData(task)) {
        if (--task.data[3] === 0) {
          task.data[0]++;
        } else {
          task.data[1] = 0;
          PrepareAffineAnimInTaskData(task, task.data[15], affineAnimByName('sFacadeSquishAffineAnimCmds'));
        }
      }
      break;
    case 1:
      if (task.data[2] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
}
function CreateSweatDroplets(taskId, lowerDroplets) {
  const task = gTasks[taskId];
  let xOffset, yOffset;
  if (!lowerDroplets) { xOffset = 18; yOffset = -20; }
  else { xOffset = 30; yOffset = 20; }
  const xCoords = [task.data[4] - xOffset, task.data[4] - xOffset - 4, task.data[4] + xOffset, task.data[4] + xOffset + 4];
  const yCoords = [task.data[5] + yOffset, task.data[5] + yOffset + 6];
  for (let i = 0; i < 4; i++) {
    const spriteId = CreateSprite(T('gFacadeSweatDropSpriteTemplate'), xCoords[i], yCoords[i & 1], task.data[6] - 5);
    if (spriteId !== MAX_SPRITES) {
      gSprites[spriteId].data[0] = 0;
      gSprites[spriteId].data[1] = i < 2 ? -2 : 2;
      gSprites[spriteId].data[2] = -1;
      gSprites[spriteId].data[3] = taskId;
      gSprites[spriteId].data[4] = IDX_ACTIVE_SPRITES;
      task.data[2]++;
    }
  }
}
function AnimFacadeSweatDrop(sprite) {
  sprite.x += sprite.data[1];
  sprite.y += sprite.data[2];
  if (++sprite.data[0] > 6) {
    gTasks[sprite.data[3]].data[sprite.data[4]]--;
    DestroySprite(sprite);
  }
}

const sFacadeBlendColors = [
  RGB(28, 25, 1), RGB(28, 21, 5), RGB(27, 18, 8), RGB(27, 14, 11), RGB(26, 10, 15), RGB(26, 7, 18),
  RGB(25, 3, 21), RGB(25, 0, 25), RGB(25, 0, 23), RGB(25, 0, 20), RGB(25, 0, 16), RGB(25, 0, 13),
  RGB(26, 0, 10), RGB(26, 0, 6), RGB(26, 0, 3), RGB(27, 0, 0), RGB(27, 1, 0), RGB(27, 5, 0),
  RGB(27, 9, 0), RGB(27, 12, 0), RGB(28, 16, 0), RGB(28, 19, 0), RGB(28, 23, 0), RGB(29, 27, 0),
];
// arg 0: battler; arg 1: duration
function AnimTask_FacadeColorBlend(taskId) {
  gTasks[taskId].data[0] = 0;
  gTasks[taskId].data[1] = gBattleAnimArgs[1];
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  gTasks[taskId].data[2] = 256 + gSprites[spriteId].oam.paletteNum * 16; // OBJ_PLTT_ID
  gTasks[taskId].func = AnimTask_FacadeColorBlend_Step;
}
function AnimTask_FacadeColorBlend_Step(taskId) {
  if (gTasks[taskId].data[1]) {
    BlendPalette(gTasks[taskId].data[2], 16, 8, sFacadeBlendColors[gTasks[taskId].data[0]]);
    if (++gTasks[taskId].data[0] > 23) gTasks[taskId].data[0] = 0;
    gTasks[taskId].data[1]--;
  } else {
    BlendPalette(gTasks[taskId].data[2], 16, 0, RGB_BLACK);
    DestroyAnimVisualTask(taskId);
  }
}

// arg 0: initial x pixel offset; arg 1: initial y pixel offset; arg 2: direction (0 up, 1 down, 2 horizontal)
function AnimRoarNoiseLine(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_OPPONENT) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y) + gBattleAnimArgs[1];
  if (gBattleAnimArgs[2] === 0) {
    sprite.data[0] = 0x280;
    sprite.data[1] = -0x280;
  } else if (gBattleAnimArgs[2] === 1) {
    sprite.vFlip = TRUE;
    sprite.data[0] = 0x280;
    sprite.data[1] = 0x280;
  } else {
    StartSpriteAnim(sprite, 1);
    sprite.data[0] = 0x280;
  }
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    sprite.data[0] = -sprite.data[0];
    sprite.hFlip = TRUE;
  }
  sprite.callback = AnimRoarNoiseLine_Step;
}
function AnimRoarNoiseLine_Step(sprite) {
  sprite.data[6] += sprite.data[0];
  sprite.data[7] += sprite.data[1];
  sprite.x2 = sprite.data[6] >> 8;
  sprite.y2 = sprite.data[7] >> 8;
  if (++sprite.data[5] === 14) DestroyAnimSprite(sprite);
}

// ---- battle_anim_fight.c -------------------------------------------------------------------------
function AnimSlideHandOrFootToTarget(sprite) {
  if (gBattleAnimArgs[7] === 1 && GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  StartSpriteAnim(sprite, gBattleAnimArgs[6]);
  gBattleAnimArgs[6] = 0;
  AnimTravelDiagonally(sprite);
}

// ---- battle_anim_poison.c ------------------------------------------------------------------------
// arg 0: initial x pixel offset; arg 1: initial y pixel offset; arg 2: 0 = single-target, 1 = multi-target
function AnimBubbleEffect(sprite) {
  if (!gBattleAnimArgs[2]) {
    InitSpritePosToAnimTarget(sprite, TRUE);
  } else {
    SetAverageBattlerPositions(S.gBattleAnimTarget, TRUE, sprite); // writes sprite.x / sprite.y
    if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  sprite.callback = AnimBubbleEffect_Step;
}
function AnimBubbleEffect_Step(sprite) {
  sprite.data[0] = (sprite.data[0] + 0xB) & 0xFF;
  sprite.x2 = Sin(sprite.data[0], 4);
  sprite.data[1] += 0x30;
  sprite.y2 = -(sprite.data[1] >> 8);
  if (sprite.affineAnimEnded) DestroyAnimSprite(sprite);
}

// ==== second tier ===================================================================================

// ---- battle_anim_poison.c ------------------------------------------------------------------------
function AnimSludgeProjectile(sprite) {
  if (!gBattleAnimArgs[3]) StartSpriteAnim(sprite, 2);
  InitSpritePosToAnimAttacker(sprite, 1);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[5] = -30;
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimSludgeProjectile_Step;
}
function AnimSludgeProjectile_Step(sprite) {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

function AnimSludgeBombHitParticle(sprite) {
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = sprite.x;
  sprite.data[2] = sprite.x + gBattleAnimArgs[0];
  sprite.data[3] = sprite.y;
  sprite.data[4] = sprite.y + gBattleAnimArgs[1];
  InitSpriteDataForLinearTranslation(sprite);
  sprite.data[5] = idiv(sprite.data[1], gBattleAnimArgs[2]);
  sprite.data[6] = idiv(sprite.data[2], gBattleAnimArgs[2]);
  sprite.callback = AnimSludgeBombHitParticle_Step;
}
function AnimSludgeBombHitParticle_Step(sprite) {
  TranslateSpriteLinearFixedPoint(sprite);
  sprite.data[1] -= sprite.data[5];
  sprite.data[2] -= sprite.data[6];
  if (!sprite.data[0]) DestroyAnimSprite(sprite);
}

// ---- battle_anim_bug.c ---------------------------------------------------------------------------
function AnimTranslateWebThread(sprite) {
  InitSpritePosToAnimAttacker(sprite, TRUE);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  if (!gBattleAnimArgs[4]) {
    sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
    sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  } else {
    const p = SetAverageBattlerPositions(S.gBattleAnimTarget, 1, {});
    sprite.data[2] = p.x; sprite.data[4] = p.y;
  }
  InitAnimLinearTranslationWithSpeed(sprite);
  sprite.data[5] = gBattleAnimArgs[3];
  sprite.callback = AnimTranslateWebThread_Step;
}
function AnimTranslateWebThread_Step(sprite) {
  if (AnimTranslateLinear(sprite)) { DestroyAnimSprite(sprite); return; }
  sprite.x2 += Sin(sprite.data[6], sprite.data[5]);
  sprite.data[6] = (sprite.data[6] + 13) & 0xFF;
}

function AnimStringWrap(sprite) {
  SetAverageBattlerPositions(S.gBattleAnimTarget, 0, sprite);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) sprite.y += 8;
  sprite.callback = AnimStringWrap_Step;
}
function AnimStringWrap_Step(sprite) {
  if (++sprite.data[0] === 3) { sprite.data[0] = 0; sprite.invisible = !sprite.invisible; }
  if (++sprite.data[1] === 51) DestroyAnimSprite(sprite);
}

// ---- battle_anim_dark.c (Faint Attack) -------------------------------------------------------------
function AnimTask_AttackerFadeToInvisible(taskId) {
  gTasks[taskId].data[0] = gBattleAnimArgs[0];
  const battler = S.gBattleAnimAttacker;
  gTasks[taskId].data[1] = 16;
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 0));
  if (GetBattlerSpriteBGPriorityRank(battler) === 1) SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
  else SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG2);
  gTasks[taskId].func = AnimTask_AttackerFadeToInvisible_Step;
}
function AnimTask_AttackerFadeToInvisible_Step(taskId) {
  let blendA = (gTasks[taskId].data[1] >> 8) & 0xFF;
  let blendB = gTasks[taskId].data[1] & 0xFF;
  if (gTasks[taskId].data[2] === (gTasks[taskId].data[0] & 0xFF)) {
    blendA = (blendA + 1) & 0xFF;
    blendB = (blendB - 1) & 0xFF;
    gTasks[taskId].data[1] = BLDALPHA_BLEND(blendB, blendA);
    SetGpuReg(REG_OFFSET_BLDALPHA, gTasks[taskId].data[1]);
    gTasks[taskId].data[2] = 0;
    if (blendA === 16) {
      gSprites[gBattlerSpriteIds[S.gBattleAnimAttacker]].invisible = TRUE;
      DestroyAnimVisualTask(taskId);
    }
  } else {
    ++gTasks[taskId].data[2];
  }
}
function AnimTask_AttackerFadeFromInvisible(taskId) {
  gTasks[taskId].data[0] = gBattleAnimArgs[0];
  gTasks[taskId].data[1] = BLDALPHA_BLEND(0, 16);
  gTasks[taskId].func = AnimTask_AttackerFadeFromInvisible_Step;
  SetGpuReg(REG_OFFSET_BLDALPHA, gTasks[taskId].data[1]);
}
function AnimTask_AttackerFadeFromInvisible_Step(taskId) {
  let blendA = (gTasks[taskId].data[1] >> 8) & 0xFF;
  let blendB = gTasks[taskId].data[1] & 0xFF;
  if (gTasks[taskId].data[2] === (gTasks[taskId].data[0] & 0xFF)) {
    blendA = (blendA - 1) & 0xFF;
    blendB = (blendB + 1) & 0xFF;
    gTasks[taskId].data[1] = (blendA << 8) | blendB;
    SetGpuReg(REG_OFFSET_BLDALPHA, gTasks[taskId].data[1]);
    gTasks[taskId].data[2] = 0;
    if (blendA === 0) {
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      DestroyAnimVisualTask(taskId);
    }
  } else {
    ++gTasks[taskId].data[2];
  }
}
function AnimTask_InitAttackerFadeFromInvisible(taskId) {
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  if (GetBattlerSpriteBGPriorityRank(S.gBattleAnimAttacker) === 1) SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
  else SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG2);
  DestroyAnimVisualTask(taskId);
}

// ---- battle_anim_effects_1.c ---------------------------------------------------------------------
function AnimCuttingSlice(sprite) {
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y);
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) sprite.y += 8;
  sprite.callback = AnimSlice_Step;
  if (gBattleAnimArgs[2] === 0) {
    sprite.x += gBattleAnimArgs[0];
  } else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.hFlip = TRUE;
  }
  sprite.y += gBattleAnimArgs[1];
  sprite.data[1] -= 0x400;
  sprite.data[2] += 0x400;
  sprite.data[5] = gBattleAnimArgs[2];
  if (sprite.data[5] === 1) sprite.data[1] = -sprite.data[1];
}
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

// Palette cycling of ANIM_TAG_PROTECT is ported literally (it's a real OBJ palette).
function AnimProtect(sprite) {
  sprite.x = GetBattlerSpriteCoord2(S.gBattleAnimAttacker, BATTLER_COORD_X) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord2(S.gBattleAnimAttacker, BATTLER_COORD_Y) + gBattleAnimArgs[1];
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER) sprite.oam.priority = GetBattlerSpriteBGPriority(S.gBattleAnimAttacker) + 1;
  else sprite.oam.priority = GetBattlerSpriteBGPriority(S.gBattleAnimAttacker);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = 256 + IndexOfSpritePaletteTag('ANIM_TAG_PROTECT') * 16; // OBJ_PLTT_ID
  sprite.data[7] = 16;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - sprite.data[7], sprite.data[7]));
  sprite.callback = AnimProtect_Step;
}
function AnimProtect_Step(sprite) {
  sprite.data[5] += 96;
  sprite.x2 = -(sprite.data[5] >> 8);
  if (++sprite.data[1] > 1) {
    sprite.data[1] = 0;
    const savedPal = gPlttBufferFaded[sprite.data[2] + 1];
    let i = 0;
    while (i < 6) {
      const id = sprite.data[2] + ++i;
      gPlttBufferFaded[id] = gPlttBufferFaded[id + 1];
    }
    gPlttBufferFaded[sprite.data[2] + 7] = savedPal;
  }
  if (sprite.data[7] > 6 && sprite.data[0] > 0 && ++sprite.data[6] > 1) {
    sprite.data[6] = 0;
    sprite.data[7] -= 1;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - sprite.data[7], sprite.data[7]));
  }
  if (sprite.data[0] > 0) {
    sprite.data[0] -= 1;
  } else if (++sprite.data[6] > 1) {
    sprite.data[6] = 0;
    sprite.data[7]++;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - sprite.data[7], sprite.data[7]));
    if (sprite.data[7] === 16) {
      sprite.invisible = TRUE;
      sprite.callback = DestroyAnimSpriteAndDisableBlend;
    }
  }
}

function AnimSleepLetterZ(sprite) {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER) {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[3] = 1;
  } else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[3] = 0xFFFF; // s16 -1
    StartSpriteAffineAnim(sprite, 1);
  }
  sprite.callback = AnimSleepLetterZ_Step;
}
function AnimSleepLetterZ_Step(sprite) {
  sprite.y2 = -idiv(sprite.data[0], 0x28);
  sprite.x2 = idiv(sprite.data[4], 10);
  sprite.data[4] += sprite.data[3] * 2;
  sprite.data[0] += sprite.data[1];
  if (++sprite.data[1] > 60) DestroySpriteAndMatrix(sprite);
}

function AnimPowerAbsorptionOrb(sprite) {
  InitSpritePosToAnimAttacker(sprite, TRUE);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}

function AnimTask_DoubleTeam(taskId) {
  const task = gTasks[taskId];
  task.data[0] = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  task.data[1] = AllocSpritePalette('ANIM_TAG_BENT_SPOON');
  const r3 = 256 + task.data[1] * 16;                              // OBJ_PLTT_ID
  const r4 = 256 + gSprites[task.data[0]].oam.paletteNum * 16;     // OBJ_PLTT_ID2
  // C copies entries 1..15; entry 0 is copied too so the renderer's virtual-palette tint reads back cleanly.
  for (let i = 0; i < 16; i++) gPlttBufferUnfaded[r3 + i] = gPlttBufferUnfaded[r4 + i];
  BlendPalette(r3, 16, 11, RGB_BLACK);
  task.data[3] = 0;
  let i = 0, obj;
  while (i < 2 && (obj = CloneBattlerSpriteWithBlend(0)) >= 0) {
    gSprites[obj].oam.paletteNum = task.data[1];
    gSprites[obj].data[0] = 0;
    gSprites[obj].data[1] = i << 7;
    gSprites[obj].data[2] = taskId;
    gSprites[obj].callback = AnimDoubleTeam;
    task.data[3]++;
    i++;
  }
  task.func = AnimTask_DoubleTeam_Step;
  if (GetBattlerSpriteBGPriorityRank(S.gBattleAnimAttacker) === 1) ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG1_ON);
  else ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG2_ON);
}
function AnimTask_DoubleTeam_Step(taskId) {
  const task = gTasks[taskId];
  if (!task.data[3]) {
    if (GetBattlerSpriteBGPriorityRank(S.gBattleAnimAttacker) === 1) SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG1_ON);
    else SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG2_ON);
    FreeSpritePaletteByTag('ANIM_TAG_BENT_SPOON');
    DestroyAnimVisualTask(taskId);
  }
}
function AnimDoubleTeam(sprite) {
  if (++sprite.data[3] > 1) { sprite.data[3] = 0; sprite.data[0]++; }
  if (sprite.data[0] > 64) {
    gTasks[sprite.data[2]].data[3]--;
    DestroySpriteWithActiveSheet(sprite);
  } else {
    sprite.data[4] = idiv(gSineTable[sprite.data[0]], 6);
    sprite.data[5] = idiv(gSineTable[sprite.data[0]], 13);
    sprite.data[1] = (sprite.data[1] + sprite.data[5]) & 0xFF;
    sprite.x2 = Sin(sprite.data[1], sprite.data[4]);
  }
}

// ---- battle_anim_effects_2.c (Fury Cutter) ---------------------------------------------------------
function AnimTask_IsFuryCutterHitRight(taskId) {
  gBattleAnimArgs[ARG_RET_ID] = S.gAnimDisableStructPtr.furyCutterCounter & 1;
  DestroyAnimVisualTask(taskId);
}
function AnimTask_GetFuryCutterHitCount(taskId) {
  gBattleAnimArgs[ARG_RET_ID] = S.gAnimDisableStructPtr.furyCutterCounter;
  DestroyAnimVisualTask(taskId);
}

// ---- battle_anim_ghost.c -------------------------------------------------------------------------
function AnimConfuseRayBallBounce(sprite) {
  InitSpritePosToAnimAttacker(sprite, 1);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = sprite.x;
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[3] = sprite.y;
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslationWithSpeed(sprite);
  sprite.callback = AnimConfuseRayBallBounce_Step1;
  sprite.data[6] = 16;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, sprite.data[6]);
}
function AnimConfuseRayBallBounce_Step1(sprite) {
  UpdateConfuseRayBallBlend(sprite);
  if (AnimTranslateLinear(sprite)) { sprite.callback = AnimConfuseRayBallBounce_Step2; return; }
  sprite.x2 += Sin(sprite.data[5], 10);
  sprite.y2 += Cos(sprite.data[5], 15);
  const r2 = sprite.data[5];
  sprite.data[5] = (sprite.data[5] + 5) & 0xFF;
  const r0 = sprite.data[5];
  if (r2 !== 0 && r2 <= 196) return;
  if (r0 <= 0) return;
  PlaySE12WithPanning('SE_M_CONFUSE_RAY', S.gAnimCustomPanning);
}
function AnimConfuseRayBallBounce_Step2(sprite) {
  sprite.data[0] = 1;
  AnimTranslateLinear(sprite);
  sprite.x2 += Sin(sprite.data[5], 10);
  sprite.y2 += Cos(sprite.data[5], 15);
  const r2 = sprite.data[5];
  sprite.data[5] = (sprite.data[5] + 5) & 0xFF;
  const r0 = sprite.data[5];
  if ((r2 === 0 || r2 > 196) && r0 > 0) PlaySE('SE_M_CONFUSE_RAY');
  if (sprite.data[6] === 0) {
    sprite.invisible = TRUE;
    sprite.callback = DestroyAnimSpriteAndDisableBlend;
  } else {
    UpdateConfuseRayBallBlend(sprite);
  }
}
function UpdateConfuseRayBallBlend(sprite) {
  if (sprite.data[6] > 0xFF) {
    if (++sprite.data[6] === 0x10d) sprite.data[6] = 0;
    return;
  }
  const r0 = sprite.data[7];
  ++sprite.data[7];
  if ((r0 & 0xFF) === 0) {
    sprite.data[7] &= 0xff00;
    if ((sprite.data[7] & 0x100) !== 0) ++sprite.data[6];
    else --sprite.data[6];
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[6], 16 - sprite.data[6]));
    if (sprite.data[6] === 0 || sprite.data[6] === 16) sprite.data[7] ^= 0x100;
    if (sprite.data[6] === 0) sprite.data[6] = 0x100;
  }
}
function AnimConfuseRayBallSpiral(sprite) {
  InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.callback = AnimConfuseRayBallSpiral_Step;
  sprite.callback(sprite);
}
function AnimConfuseRayBallSpiral_Step(sprite) {
  sprite.x2 = Sin(sprite.data[0], 32);
  sprite.y2 = Cos(sprite.data[0], 8);
  const temp1 = u16(sprite.data[0] - 65);
  if (temp1 <= 130) sprite.oam.priority = 2;
  else sprite.oam.priority = 1;
  sprite.data[0] = (sprite.data[0] + 19) & 0xFF;
  sprite.data[2] += 80;
  sprite.y2 += sprite.data[2] >> 8;
  sprite.data[7] += 1;
  if (sprite.data[7] === 61) DestroyAnimSprite(sprite);
}

function AnimTask_NightShadeClone(taskId) {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0x10));
  const spriteId = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_BLEND);
  SetSpriteRotScale(spriteId, 128, 128, 0);
  gSprites[spriteId].invisible = FALSE;
  gTasks[taskId].data[0] = 128;
  gTasks[taskId].data[1] = gBattleAnimArgs[0];
  gTasks[taskId].data[2] = 0;
  gTasks[taskId].data[3] = 16;
  gTasks[taskId].func = AnimTask_NightShadeClone_Step1;
}
function AnimTask_NightShadeClone_Step1(taskId) {
  gTasks[taskId].data[10] += 1;
  if (gTasks[taskId].data[10] === 3) {
    gTasks[taskId].data[10] = 0;
    gTasks[taskId].data[2] += 1;
    gTasks[taskId].data[3] -= 1;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(gTasks[taskId].data[2], gTasks[taskId].data[3]));
    if (gTasks[taskId].data[2] !== 9) return;
    gTasks[taskId].func = AnimTask_NightShadeClone_Step2;
  }
}
function AnimTask_NightShadeClone_Step2(taskId) {
  if (gTasks[taskId].data[1] > 0) { gTasks[taskId].data[1] -= 1; return; }
  const spriteId = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  gTasks[taskId].data[0] += 8;
  if (gTasks[taskId].data[0] <= 0xFF) {
    SetSpriteRotScale(spriteId, gTasks[taskId].data[0], gTasks[taskId].data[0], 0);
  } else {
    ResetSpriteRotScale(spriteId);
    DestroyAnimVisualTask(taskId);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  }
}

function AnimShadowBall(sprite) {
  const oldPosX = sprite.x, oldPosY = sprite.y;
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[0];
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.data[3] = gBattleAnimArgs[2];
  sprite.data[4] = sprite.x << 4;
  sprite.data[5] = sprite.y << 4;
  sprite.data[6] = idiv((oldPosX - sprite.x) << 4, gBattleAnimArgs[0] << 1);
  sprite.data[7] = idiv((oldPosY - sprite.y) << 4, gBattleAnimArgs[0] << 1);
  sprite.callback = AnimShadowBall_Step;
}
function AnimShadowBall_Step(sprite) {
  switch (sprite.data[0]) {
    case 0:
      sprite.data[4] += sprite.data[6];
      sprite.data[5] += sprite.data[7];
      sprite.x = sprite.data[4] >> 4;
      sprite.y = sprite.data[5] >> 4;
      sprite.data[1] -= 1;
      if (sprite.data[1] > 0) break;
      sprite.data[0] += 1;
      break;
    case 1:
      sprite.data[2] -= 1;
      if (sprite.data[2] > 0) break;
      sprite.data[1] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
      sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
      sprite.data[4] = sprite.x << 4;
      sprite.data[5] = sprite.y << 4;
      sprite.data[6] = idiv((sprite.data[1] - sprite.x) << 4, sprite.data[3]);
      sprite.data[7] = idiv((sprite.data[2] - sprite.y) << 4, sprite.data[3]);
      sprite.data[0] += 1;
      break;
    case 2:
      sprite.data[4] += sprite.data[6];
      sprite.data[5] += sprite.data[7];
      sprite.x = sprite.data[4] >> 4;
      sprite.y = sprite.data[5] >> 4;
      sprite.data[3] -= 1;
      if (sprite.data[3] > 0) break;
      sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
      sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
      sprite.data[0] += 1;
      break;
    case 3:
      DestroySpriteAndMatrix(sprite);
      break;
  }
}

function AnimLick(sprite) {
  InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.callback = AnimLick_Step;
}
function AnimLick_Step(sprite) {
  let r5 = FALSE, r6 = FALSE;
  if (sprite.animEnded) {
    if (!sprite.invisible) sprite.invisible = TRUE;
    switch (sprite.data[0]) {
      default: r6 = TRUE; break;
      case 0: if (sprite.data[1] === 2) r5 = TRUE; break;
      case 1: if (sprite.data[1] === 4) r5 = TRUE; break;
    }
    if (r5) {
      sprite.invisible = !sprite.invisible;
      ++sprite.data[2];
      sprite.data[1] = 0;
      if (sprite.data[2] === 5) { sprite.data[2] = 0; ++sprite.data[0]; }
    } else if (r6) {
      DestroyAnimSprite(sprite);
    } else {
      ++sprite.data[1];
    }
  }
}

// ---- battle_anim_dragon.c ------------------------------------------------------------------------
function StartDragonFireTranslation(sprite) {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    sprite.x -= gBattleAnimArgs[1]; // sic (decomp uses arg 1 here)
    sprite.y += gBattleAnimArgs[1];
    sprite.data[2] -= gBattleAnimArgs[2];
    sprite.data[4] += gBattleAnimArgs[3];
  } else {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[2] += gBattleAnimArgs[2];
    sprite.data[4] += gBattleAnimArgs[3];
    StartSpriteAnim(sprite, 1);
  }
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}
function AnimDragonRageFirePlume(sprite) {
  if (gBattleAnimArgs[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y);
  } else {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y);
  }
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[1]);
  sprite.y += gBattleAnimArgs[2];
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}
function AnimDragonFireToTarget(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) StartSpriteAffineAnim(sprite, 1);
  StartDragonFireTranslation(sprite);
}

// ---- battle_anim_psychic.c (Amnesia) ----------------------------------------------------------------
function AnimQuestionMark(sprite) {
  let x = idiv(GetBattlerSpriteCoordAttr(S.gBattleAnimAttacker, BATTLER_COORD_ATTR_WIDTH), 2);
  const y = idiv(GetBattlerSpriteCoordAttr(S.gBattleAnimAttacker, BATTLER_COORD_ATTR_HEIGHT), -2);
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_OPPONENT) x = -x;
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2) + x;
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET) + y;
  if (sprite.y < 16) sprite.y = 16;
  StoreSpriteCallbackInData6(sprite, AnimQuestionMark_Step1);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
}
function AnimQuestionMark_Step1(sprite) {
  sprite.oam.affineMode = ST_OAM_AFFINE_NORMAL;
  sprite.affineAnims = [affineAnimByName('sAffineAnim_QuestionMark') || [{ end: 1 }]]; // sAffineAnims_QuestionMark
  sprite.data[0] = 0;
  const m = AllocOamMatrix(); // C's InitSpriteAffineAnim allocates the matrix; gba.js's doesn't
  sprite.oam.matrixNum = m === 0xFF ? 31 : m;
  InitSpriteAffineAnim(sprite);
  sprite.callback = AnimQuestionMark_Step2;
}
function AnimQuestionMark_Step2(sprite) {
  switch (sprite.data[0]) {
    case 0:
      if (sprite.affineAnimEnded) {
        FreeOamMatrix(sprite.oam.matrixNum);
        sprite.oam.affineMode = ST_OAM_AFFINE_OFF;
        sprite.data[1] = 18;
        ++sprite.data[0];
      }
      break;
    case 1:
      if (--sprite.data[1] === -1) DestroyAnimSprite(sprite);
      break;
  }
}

register({
  AnimLeechLifeNeedle, AnimTranslateStinger, AnimBite, AnimClawSlash, AnimTask_MetallicShine, AnimMovePowderParticle,
  AnimAbsorptionOrb, AnimHyperBeamOrb, AnimWhipHit, AnimSwordsDanceBlade, AnimTask_StretchTargetUp,
  AnimTask_SetPsychicBackground, AnimLeer, AnimTask_SquishAndSweatDroplets, AnimFacadeSweatDrop, AnimTask_FacadeColorBlend,
  AnimRoarNoiseLine, AnimSlideHandOrFootToTarget, AnimBubbleEffect,
  // second tier
  AnimSludgeProjectile, AnimSludgeBombHitParticle, AnimTranslateWebThread, AnimStringWrap,
  AnimTask_AttackerFadeToInvisible, AnimTask_AttackerFadeFromInvisible, AnimTask_InitAttackerFadeFromInvisible,
  AnimCuttingSlice, AnimProtect, AnimSleepLetterZ, AnimTask_DoubleTeam, AnimPowerAbsorptionOrb,
  AnimTask_IsFuryCutterHitRight, AnimTask_GetFuryCutterHitCount,
  AnimConfuseRayBallBounce, AnimConfuseRayBallSpiral, AnimTask_NightShadeClone, AnimShadowBall, AnimLick,
  AnimDragonRageFirePlume, AnimDragonFireToTarget, AnimQuestionMark,
});
