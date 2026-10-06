// Ports of the non-callback helpers from src/battle_anim_mons.c and src/battle_anim.c (decomp names).
// Sprite callbacks/tasks that live in those files are ported in cb/*.js.
import {
  S, gSprites, gTasks, gBattleAnimArgs, gBattlerSpriteIds, gOamMatrices, gPlttBufferUnfaded, gPlttBufferFaded,
  DestroySprite, DestroyTask, FreeSpriteOamMatrix, SetGpuReg, REG_OFFSET_BLDCNT, REG_OFFSET_BLDALPHA, Sin, Cos, ArcTan2,
  GetBattlerSpriteCoord, GetBattlerSpriteCoord2, GetBattlerSide, GetAnimBattlerSpriteId, IsBattlerSpriteVisible, IsDoubleBattle,
  GetBattlerAtPosition, BATTLE_PARTNER, BATTLER_COORD_X, BATTLER_COORD_Y, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET,
  B_SIDE_PLAYER, B_POSITION_PLAYER_LEFT, B_POSITION_PLAYER_RIGHT, B_POSITION_OPPONENT_LEFT, B_POSITION_OPPONENT_RIGHT,
  ST_OAM_OBJ_BLEND, ST_OAM_OBJ_NORMAL, ST_OAM_AFFINE_DOUBLE, ST_OAM_AFFINE_NORMAL, ST_OAM_OBJ_WINDOW, MAX_SPRITES, SPRITE_NONE,
  CalcCenterToCornerVec, ObjAffineSet, idiv, s16, u16, u8, BG_ANIM_PAL_1, BG_ANIM_PAL_2, SpriteCallbackDummy, GetBattlerSpriteBGPriorityRank,
} from './gba.js';

// ---- battle_anim.c ---------------------------------------------------------------------------------
export function DestroyAnimSprite(sprite) { FreeSpriteOamMatrix(sprite); DestroySprite(sprite); S.gAnimVisualTaskCount--; }
export function DestroyAnimVisualTask(taskId) { DestroyTask(taskId); S.gAnimVisualTaskCount--; }
export function DestroyAnimSoundTask(taskId) { DestroyTask(taskId); S.gAnimSoundTaskCount--; }
export function MoveBattlerSpriteToBG() {}
export function ResetBattleAnimBg() {}
export function RelocateBattleBgPal() {}

// ---- callback-in-data6 ----------------------------------------------------------------------------
export function StoreSpriteCallbackInData6(sprite, callback) { sprite.storedCb = callback; }
export function SetCallbackToStoredInData6(sprite) { sprite.callback = sprite.storedCb || SpriteCallbackDummy; }
export function StorePointerInVars(obj, key, ptr) { obj.ptrs[key] = ptr; }
export function LoadPointerFromVars(obj, key) { return obj.ptrs[key]; }

// ---- circular / linear motion -------------------------------------------------------------------
export function TranslateSpriteInCircle(sprite) {
  if (sprite.data[3]) {
    sprite.x2 = Sin(sprite.data[0], sprite.data[1]); sprite.y2 = Cos(sprite.data[0], sprite.data[1]);
    sprite.data[0] += sprite.data[2];
    if (sprite.data[0] >= 0x100) sprite.data[0] -= 0x100; else if (sprite.data[0] < 0) sprite.data[0] += 0x100;
    sprite.data[3]--;
  } else SetCallbackToStoredInData6(sprite);
}
export function TranslateSpriteInGrowingCircle(sprite) {
  if (sprite.data[3]) {
    sprite.x2 = Sin(sprite.data[0], (sprite.data[5] >> 8) + sprite.data[1]); sprite.y2 = Cos(sprite.data[0], (sprite.data[5] >> 8) + sprite.data[1]);
    sprite.data[0] += sprite.data[2]; sprite.data[5] += sprite.data[4];
    if (sprite.data[0] >= 0x100) sprite.data[0] -= 0x100; else if (sprite.data[0] < 0) sprite.data[0] += 0x100;
    sprite.data[3]--;
  } else SetCallbackToStoredInData6(sprite);
}
export function TranslateSpriteInEllipse(sprite) {
  if (sprite.data[3]) {
    sprite.x2 = Sin(sprite.data[0], sprite.data[1]); sprite.y2 = Cos(sprite.data[0], sprite.data[4]);
    sprite.data[0] += sprite.data[2];
    if (sprite.data[0] >= 0x100) sprite.data[0] -= 0x100; else if (sprite.data[0] < 0) sprite.data[0] += 0x100;
    sprite.data[3]--;
  } else SetCallbackToStoredInData6(sprite);
}
export function WaitAnimForDuration(sprite) { if (sprite.data[0] > 0) --sprite.data[0]; else SetCallbackToStoredInData6(sprite); }
export function ConvertPosDataToTranslateLinearData(sprite) {
  if (sprite.data[1] > sprite.data[2]) sprite.data[0] = -sprite.data[0];
  const xDiff = sprite.data[2] - sprite.data[1];
  const old = sprite.data[0];
  sprite.data[0] = Math.abs(idiv(xDiff, sprite.data[0]));
  sprite.data[2] = idiv(sprite.data[4] - sprite.data[3], sprite.data[0]);
  sprite.data[1] = old;
}
export function TranslateSpriteLinear(sprite) {
  if (sprite.data[0] > 0) { sprite.data[0]--; sprite.x2 += sprite.data[1]; sprite.y2 += sprite.data[2]; }
  else SetCallbackToStoredInData6(sprite);
}
export function AnimPosToTranslateLinear(sprite) { ConvertPosDataToTranslateLinearData(sprite); sprite.callback = TranslateSpriteLinear; sprite.callback(sprite); }
export function TranslateSpriteLinearFixedPoint(sprite) {
  if (sprite.data[0] > 0) { --sprite.data[0]; sprite.data[3] += sprite.data[1]; sprite.data[4] += sprite.data[2]; sprite.x2 = sprite.data[3] >> 8; sprite.y2 = sprite.data[4] >> 8; }
  else SetCallbackToStoredInData6(sprite);
}
export function TranslateSpriteLinearById(sprite) {
  if (sprite.data[0] > 0) { --sprite.data[0]; gSprites[sprite.data[3]].x2 += sprite.data[1]; gSprites[sprite.data[3]].y2 += sprite.data[2]; }
  else SetCallbackToStoredInData6(sprite);
}
export function TranslateSpriteLinearByIdFixedPoint(sprite) {
  if (sprite.data[0] > 0) { --sprite.data[0]; sprite.data[3] += sprite.data[1]; sprite.data[4] += sprite.data[2]; gSprites[sprite.data[5]].x2 = sprite.data[3] >> 8; gSprites[sprite.data[5]].y2 = sprite.data[4] >> 8; }
  else SetCallbackToStoredInData6(sprite);
}
export function TranslateSpriteLinearAndFlicker(sprite) {
  if (sprite.data[0] > 0) {
    --sprite.data[0];
    sprite.x2 = sprite.data[2] >> 8; sprite.data[2] += sprite.data[1];
    sprite.y2 = sprite.data[4] >> 8; sprite.data[4] += sprite.data[3];
    if (sprite.data[5] && sprite.data[0] % sprite.data[5] === 0) sprite.invisible = !sprite.invisible;
  } else SetCallbackToStoredInData6(sprite);
}
export function DestroySpriteAndMatrix(sprite) { FreeSpriteOamMatrix(sprite); DestroyAnimSprite(sprite); }
export function RunStoredCallbackWhenAffineAnimEnds(sprite) { if (sprite.affineAnimEnded) SetCallbackToStoredInData6(sprite); }
export function RunStoredCallbackWhenAnimEnds(sprite) { if (sprite.animEnded) SetCallbackToStoredInData6(sprite); }
export function DestroyAnimSpriteAndDisableBlend(sprite) { SetGpuReg(REG_OFFSET_BLDCNT, 0); SetGpuReg(REG_OFFSET_BLDALPHA, 0); DestroyAnimSprite(sprite); }
export function DestroyAnimVisualTaskAndDisableBlend(taskId) { SetGpuReg(REG_OFFSET_BLDCNT, 0); SetGpuReg(REG_OFFSET_BLDALPHA, 0); DestroyAnimVisualTask(taskId); }
export function SetSpriteCoordsToAnimAttackerCoords(sprite) {
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
}
export function SetAnimSpriteInitialXOffset(sprite, xOffset) {
  const ax = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X), tx = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
  if (ax > tx) sprite.x -= xOffset;
  else if (ax < tx) sprite.x += xOffset;
  else if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.x -= xOffset;
  else sprite.x += xOffset;
}
export function InitAnimLinearTranslation(sprite) {
  const x = sprite.data[2] - sprite.data[1], y = sprite.data[4] - sprite.data[3];
  let xDelta = u16(Math.abs(x) << 8), yDelta = u16(Math.abs(y) << 8);
  xDelta = u16(idiv(xDelta, sprite.data[0])); yDelta = u16(idiv(yDelta, sprite.data[0]));
  xDelta = x < 0 ? xDelta | 1 : xDelta & ~1;
  yDelta = y < 0 ? yDelta | 1 : yDelta & ~1;
  sprite.data[1] = xDelta; sprite.data[2] = yDelta; sprite.data[4] = 0; sprite.data[3] = 0;
}
export function InitAnimArcTranslation(sprite) {
  sprite.data[1] = sprite.x; sprite.data[3] = sprite.y;
  InitAnimLinearTranslation(sprite);
  sprite.data[6] = idiv(0x8000, sprite.data[0]);
  sprite.data[7] = 0;
}
export function AnimTranslateLinear(sprite) {
  if (!sprite.data[0]) return true;
  const v1 = u16(sprite.data[1]), v2 = u16(sprite.data[2]);
  const x = u16(sprite.data[3] + v1), y = u16(sprite.data[4] + v2);
  sprite.x2 = v1 & 1 ? -(x >> 8) : x >> 8;
  sprite.y2 = v2 & 1 ? -(y >> 8) : y >> 8;
  sprite.data[3] = x; sprite.data[4] = y;
  --sprite.data[0];
  return false;
}
export function AnimTranslateLinear_WithFollowup(sprite) { if (AnimTranslateLinear(sprite)) SetCallbackToStoredInData6(sprite); }
export function StartAnimLinearTranslation(sprite) {
  sprite.data[1] = sprite.x; sprite.data[3] = sprite.y;
  InitAnimLinearTranslation(sprite);
  sprite.callback = AnimTranslateLinear_WithFollowup;
  sprite.callback(sprite);
}
export function TranslateAnimHorizontalArc(sprite) {
  if (AnimTranslateLinear(sprite)) return true;
  sprite.data[7] += sprite.data[6];
  sprite.y2 += Sin(u8(sprite.data[7] >> 8), sprite.data[5]);
  return false;
}
export function TranslateAnimVerticalArc(sprite) {
  if (AnimTranslateLinear(sprite)) return true;
  sprite.data[7] += sprite.data[6];
  sprite.x2 += Sin(u8(sprite.data[7] >> 8), sprite.data[5]);
  return false;
}
export function SetSpritePrimaryCoordsFromSecondaryCoords(sprite) { sprite.x += sprite.x2; sprite.y += sprite.y2; sprite.x2 = 0; sprite.y2 = 0; }
export function InitSpritePosToAnimTarget(sprite, respectMonPicOffsets) {
  if (!respectMonPicOffsets) { sprite.x = GetBattlerSpriteCoord2(S.gBattleAnimTarget, BATTLER_COORD_X); sprite.y = GetBattlerSpriteCoord2(S.gBattleAnimTarget, BATTLER_COORD_Y); }
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
}
export function InitSpritePosToAnimAttacker(sprite, respectMonPicOffsets) {
  if (!respectMonPicOffsets) { sprite.x = GetBattlerSpriteCoord2(S.gBattleAnimAttacker, BATTLER_COORD_X); sprite.y = GetBattlerSpriteCoord2(S.gBattleAnimAttacker, BATTLER_COORD_Y); }
  else { sprite.x = GetBattlerSpriteCoord2(S.gBattleAnimAttacker, BATTLER_COORD_X_2); sprite.y = GetBattlerSpriteCoord2(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET); }
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
}
export function InitSpriteDataForLinearTranslation(sprite) {
  const x = s16((sprite.data[2] - sprite.data[1]) << 8), y = s16((sprite.data[4] - sprite.data[3]) << 8);
  sprite.data[1] = idiv(x, sprite.data[0]); sprite.data[2] = idiv(y, sprite.data[0]); sprite.data[4] = 0; sprite.data[3] = 0;
}
export function InitAnimLinearTranslationWithSpeed(sprite) {
  const v1 = Math.abs(sprite.data[2] - sprite.data[1]) << 8;
  sprite.data[0] = idiv(v1, sprite.data[0]);
  InitAnimLinearTranslation(sprite);
}
export function InitAnimLinearTranslationWithSpeedAndPos(sprite) {
  sprite.data[1] = sprite.x; sprite.data[3] = sprite.y;
  InitAnimLinearTranslationWithSpeed(sprite);
  sprite.callback = AnimTranslateLinear_WithFollowup;
  sprite.callback(sprite);
}
function InitAnimFastLinearTranslation(sprite) {
  const xDiff = sprite.data[2] - sprite.data[1], yDiff = sprite.data[4] - sprite.data[3];
  let x2 = u16(Math.abs(xDiff) << 4), y2 = u16(Math.abs(yDiff) << 4);
  x2 = u16(idiv(x2, sprite.data[0])); y2 = u16(idiv(y2, sprite.data[0]));
  x2 = xDiff < 0 ? x2 | 1 : x2 & ~1; y2 = yDiff < 0 ? y2 | 1 : y2 & ~1;
  sprite.data[1] = x2; sprite.data[2] = y2; sprite.data[4] = 0; sprite.data[3] = 0;
}
export function AnimFastTranslateLinear(sprite) {
  if (!sprite.data[0]) return true;
  const v1 = u16(sprite.data[1]), v2 = u16(sprite.data[2]);
  const x = u16(sprite.data[3] + v1), y = u16(sprite.data[4] + v2);
  sprite.x2 = v1 & 1 ? -(x >> 4) : x >> 4;
  sprite.y2 = v2 & 1 ? -(y >> 4) : y >> 4;
  sprite.data[3] = x; sprite.data[4] = y;
  --sprite.data[0];
  return false;
}
export function AnimFastTranslateLinearWaitEnd(sprite) { if (AnimFastTranslateLinear(sprite)) SetCallbackToStoredInData6(sprite); }
export function InitAndRunAnimFastLinearTranslation(sprite) {
  sprite.data[1] = sprite.x; sprite.data[3] = sprite.y;
  InitAnimFastLinearTranslation(sprite);
  sprite.callback = AnimFastTranslateLinearWaitEnd;
  sprite.callback(sprite);
}
export function InitAnimFastLinearTranslationWithSpeed(sprite) {
  const xDiff = Math.abs(sprite.data[2] - sprite.data[1]) << 4;
  sprite.data[0] = idiv(xDiff, sprite.data[0]);
  InitAnimFastLinearTranslation(sprite);
}
export function InitAnimFastLinearTranslationWithSpeedAndPos(sprite) {
  sprite.data[1] = sprite.x; sprite.data[3] = sprite.y;
  InitAnimFastLinearTranslationWithSpeed(sprite);
  sprite.callback = AnimFastTranslateLinearWaitEnd;
  sprite.callback(sprite);
}

// ---- rot/scale --------------------------------------------------------------------------------------
export function SetSpriteRotScale(spriteId, xScale, yScale, rotation) {
  gOamMatrices[gSprites[spriteId].oam.matrixNum] = ObjAffineSet(xScale, yScale, rotation & 0xFFFF);
}
export function PrepareBattlerSpriteForRotScale(spriteId, objMode) {
  const sp = gSprites[spriteId], b = sp.data[0];
  if (IsBattlerSpriteVisible(b)) sp.invisible = false;
  sp.oam.objMode = objMode;
  sp.affineAnimPaused = true;
  sp.oam.affineMode = ST_OAM_AFFINE_DOUBLE;
  CalcCenterToCornerVec(sp);
}
export function ResetSpriteRotScale(spriteId) {
  const sp = gSprites[spriteId];
  SetSpriteRotScale(spriteId, 0x100, 0x100, 0);
  sp.oam.affineMode = ST_OAM_AFFINE_NORMAL; sp.oam.objMode = 0; sp.affineAnimPaused = false;
  CalcCenterToCornerVec(sp);
}
export function SetBattlerSpriteYOffsetFromRotation(spriteId) {
  let c = gOamMatrices[gSprites[spriteId].oam.matrixNum].c;
  if (c < 0) c = -c;
  gSprites[spriteId].y2 = c >> 3;
}
export function TrySetSpriteRotScale(sprite, recalcCenterVector, xScale, yScale, rotation) {
  if (sprite.oam.affineMode & 1) {
    sprite.affineAnimPaused = true;
    if (recalcCenterVector) CalcCenterToCornerVec(sprite);
    gOamMatrices[sprite.oam.matrixNum] = ObjAffineSet(xScale, yScale, rotation & 0xFFFF);
  }
}
export function TryResetSpriteAffineState(sprite) { TrySetSpriteRotScale(sprite, true, 0x100, 0x100, 0); sprite.affineAnimPaused = false; CalcCenterToCornerVec(sprite); }
export function ArcTan2Neg(a, b) { return u16(-ArcTan2(a, b)); }
// "y offset" of a POKéMON picture (empty rows under the feet) from the battler's opaque box
function GetBattlerYDeltaFromSpriteId(spriteId) {
  for (let i = 0; i < 4; i++) if (gBattlerSpriteIds[i] === spriteId) { const box = S.battlers[i]?.box; return box ? Math.max(0, 64 - (box.y + box.h)) : 0; }
  return 64;
}
export function SetBattlerSpriteYOffsetFromYScale(spriteId) {
  const v = 64 - GetBattlerYDeltaFromSpriteId(spriteId) * 2;
  const d = gOamMatrices[gSprites[spriteId].oam.matrixNum].d;
  let v2 = d ? idiv(v << 8, d) : 0;
  if (v2 > 128) v2 = 128;
  gSprites[spriteId].y2 = idiv(v - v2, 2);
}
export function SetBattlerSpriteYOffsetFromOtherYScale(spriteId, otherSpriteId) {
  const v = 64 - GetBattlerYDeltaFromSpriteId(otherSpriteId) * 2;
  const d = gOamMatrices[gSprites[spriteId].oam.matrixNum].d;
  let v2 = d ? idiv(v << 8, d) : 0;
  if (v2 > 128) v2 = 128;
  gSprites[spriteId].y2 = idiv(v - v2, 2);
}
// task-driven affine anims on a battler (cmds = JSON affine anim array, e.g. affineAnimByName('...'))
export function PrepareAffineAnimInTaskData(task, spriteId, affineAnimCmds) {
  task.data[7] = 0; task.data[8] = 0; task.data[9] = 0; task.data[15] = spriteId;
  task.data[10] = 0x100; task.data[11] = 0x100; task.data[12] = 0;
  task.ptrs.affine = affineAnimCmds || [{ end: 1 }];
  PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_NORMAL);
}
export function RunAffineAnimFromTaskData(task) {
  const cmds = task.ptrs.affine || [{ end: 1 }];
  let i = task.data[7], c = cmds[i] || { end: 1 };
  if (c.jump !== undefined) { task.data[7] = c.jump; return true; }
  if (c.loop !== undefined) {
    if (c.loop) {
      if (task.data[9]) { if (!--task.data[9]) { ++task.data[7]; return true; } }
      else task.data[9] = c.loop;
      if (!task.data[7]) return true;
      for (;;) {
        --task.data[7]; i = task.data[7];
        if (cmds[i]?.loop !== undefined) { ++task.data[7]; return true; }
        if (!task.data[7]) return true;
      }
    }
    ++task.data[7];
    return true;
  }
  if (c.end) { gSprites[task.data[15]].y2 = 0; ResetSpriteRotScale(task.data[15]); return false; }
  if (!c.d) { task.data[10] = c.x || 0; task.data[11] = c.y || 0; task.data[12] = c.r || 0; ++task.data[7]; c = cmds[task.data[7]] || { x: 0, y: 0, r: 0, d: 0 }; }
  task.data[10] += c.x || 0; task.data[11] += c.y || 0; task.data[12] += c.r || 0;
  SetSpriteRotScale(task.data[15], task.data[10], task.data[11], task.data[12]);
  SetBattlerSpriteYOffsetFromYScale(task.data[15]);
  if (++task.data[8] >= (c.d || 0)) { task.data[8] = 0; ++task.data[7]; }
  return true;
}
export function BattleAnimHelper_SetSpriteSquashParams(task, spriteId, xs0, ys0, xs1, ys1, duration) {
  task.data[8] = duration; task.data[15] = spriteId; task.data[9] = xs0; task.data[10] = ys0; task.data[13] = xs1; task.data[14] = ys1;
  task.data[11] = idiv(xs1 - xs0, duration); task.data[12] = idiv(ys1 - ys0, duration);
}
export function BattleAnimHelper_RunSpriteSquash(task) {
  if (!task.data[8]) return 0;
  if (--task.data[8] !== 0) { task.data[9] += task.data[11]; task.data[10] += task.data[12]; }
  else { task.data[9] = task.data[13]; task.data[10] = task.data[14]; }
  SetSpriteRotScale(task.data[15], task.data[9], task.data[10], 0);
  if (task.data[8]) SetBattlerSpriteYOffsetFromYScale(task.data[15]); else gSprites[task.data[15]].y2 = 0;
  return task.data[8];
}

// ---- palettes -----------------------------------------------------------------------------------------
export function GetBattlePalettesMask(battleBackground, attacker, target, attackerPartner, targetPartner, anim1, anim2) {
  let sel = 0;
  if (battleBackground) sel = 0xE;
  if (attacker) sel |= 1 << (S.gBattleAnimAttacker + 16);
  if (target) sel |= 1 << (S.gBattleAnimTarget + 16);
  if (attackerPartner && IsBattlerSpriteVisible(BATTLE_PARTNER(S.gBattleAnimAttacker))) sel |= 1 << (BATTLE_PARTNER(S.gBattleAnimAttacker) + 16);
  if (targetPartner && IsBattlerSpriteVisible(BATTLE_PARTNER(S.gBattleAnimTarget))) sel |= 1 << (BATTLE_PARTNER(S.gBattleAnimTarget) + 16);
  if (anim1) sel |= 1 << BG_ANIM_PAL_1;
  if (anim2) sel |= 1 << BG_ANIM_PAL_2;
  return sel >>> 0;
}
export function GetBattleMonSpritePalettesMask(playerLeft, playerRight, foeLeft, foeRight) {
  let sel = 0;
  if (playerLeft && IsBattlerSpriteVisible(GetBattlerAtPosition(B_POSITION_PLAYER_LEFT))) sel |= 1 << (GetBattlerAtPosition(B_POSITION_PLAYER_LEFT) + 16);
  if (playerRight && IsBattlerSpriteVisible(GetBattlerAtPosition(B_POSITION_PLAYER_RIGHT))) sel |= 1 << (GetBattlerAtPosition(B_POSITION_PLAYER_RIGHT) + 16);
  if (foeLeft && IsBattlerSpriteVisible(GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT))) sel |= 1 << (GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT) + 16);
  if (foeRight && IsBattlerSpriteVisible(GetBattlerAtPosition(B_POSITION_OPPONENT_RIGHT))) sel |= 1 << (GetBattlerAtPosition(B_POSITION_OPPONENT_RIGHT) + 16);
  return sel >>> 0;
}
export function GetSpritePalIdxByBattler(b) { return b; }
export function SetGreyscaleOrOriginalPalette(paletteNum, restoreOriginalColor) {
  const o = paletteNum * 16;
  for (let i = 0; i < 16; i++) {
    if (restoreOriginalColor) { gPlttBufferFaded[o + i] = gPlttBufferUnfaded[o + i]; continue; }
    const c = gPlttBufferUnfaded[o + i];
    const avg = idiv((c & 31) + ((c >> 5) & 31) + ((c >> 10) & 31), 3);
    gPlttBufferFaded[o + i] = avg | (avg << 5) | (avg << 10);
  }
}

// ---- sprites / battlers ---------------------------------------------------------------------------------
// gSprites[i] = gSprites[spriteId] (struct copy) keeping the destination's identity.
export function CopySprite(dst, src) {
  const id = dst.id;
  Object.assign(dst, src, { id, data: Int16Array.from(src.data), oam: { ...src.oam }, ptrs: { ...src.ptrs } });
  return dst;
}
export function CloneBattlerSpriteWithBlend(animBattler) {
  const spriteId = GetAnimBattlerSpriteId(animBattler);
  if (spriteId !== SPRITE_NONE) {
    for (let i = 0; i < MAX_SPRITES; i++) {
      if (!gSprites[i].inUse) {
        CopySprite(gSprites[i], gSprites[spriteId]);
        const s = gSprites[i];
        s.monClone = gSprites[spriteId].battler; s.oam.objMode = ST_OAM_OBJ_BLEND; s.invisible = false;
        return i;
      }
    }
  }
  return -1;
}
export function DestroySpriteWithActiveSheet(sprite) { sprite.usingSheet = true; DestroySprite(sprite); }
export function CreateInvisibleSpriteCopy(_battlerId, spriteId, _species) {
  for (let i = 0; i < MAX_SPRITES; i++) if (!gSprites[i].inUse) {
    CopySprite(gSprites[i], gSprites[spriteId]);
    const s = gSprites[i];
    s.monClone = gSprites[spriteId].battler; s.oam.priority = 0; s.oam.objMode = ST_OAM_OBJ_WINDOW; s.callback = SpriteCallbackDummy;
    return i;
  }
  return MAX_SPRITES;
}
export function SetAverageBattlerPositions(battlerId, respectMonPicOffsets, out) {
  const xt = respectMonPicOffsets ? BATTLER_COORD_X_2 : BATTLER_COORD_X, yt = respectMonPicOffsets ? BATTLER_COORD_Y_PIC_OFFSET : BATTLER_COORD_Y;
  const bx = GetBattlerSpriteCoord(battlerId, xt), by = GetBattlerSpriteCoord(battlerId, yt);
  let px = bx, py = by;
  if (IsDoubleBattle()) { px = GetBattlerSpriteCoord(BATTLE_PARTNER(battlerId), xt); py = GetBattlerSpriteCoord(BATTLE_PARTNER(battlerId), yt); }
  out.x = idiv(bx + px, 2); out.y = idiv(by + py, 2);
  return out;
}

// ---- anim BG layers (BG1/BG2) ------------------------------------------------------------------------
// struct BattleAnimBgData: here just which layer and palette; the image is chosen with AnimLoadCompressedBgTilemap.
export function GetBattleAnimBg1Data(out = {}) { return Object.assign(out, { bgId: 1, paletteId: BG_ANIM_PAL_1, tilesOffset: 0x200 }); }
export function GetBattleAnimBgData(out = {}, bgId) { return bgId === 1 ? GetBattleAnimBg1Data(out) : Object.assign(out, { bgId: 2, paletteId: BG_ANIM_PAL_2, tilesOffset: 0x300 }); }
export function GetBattleAnimBgDataByPriorityRank(out = {}) { return GetBattlerSpriteBGPriorityRank(S.gBattleAnimAttacker) === 1 ? GetBattleAnimBg1Data(out) : GetBattleAnimBgData(out, 2); }
// key: an anims.json "bgs" key (BG_*) or "extraBgs" key (tilemap symbol); pass null to clear.
export function SetAnimBgLayer(bgId, key, opts = {}) { S.animBgs[bgId] = key ? { key, alpha: 1, ...opts } : null; }
export function InitBattleAnimBg(bgId) { S.animBgs[bgId] = null; }
export function ClearBattleAnimBg(bgId) { S.animBgs[bgId] = null; }
export function AnimLoadCompressedBgGfx(_bgId, _src, _tilesOffset) {}
export function AnimLoadCompressedBgTilemap(bgId, tilemapKey) { S.animBgs[bgId] = { key: tilemapKey, alpha: 1 }; }
export function AnimLoadCompressedBgTilemapHandleContest(data, tilemapKey) { AnimLoadCompressedBgTilemap(data?.bgId || 1, tilemapKey); }
export function LoadCompressedPalette() {}
export function FillPalette() {}
export function ScanlineEffect_SetParams() {}
export function ScanlineEffect_Stop() {}
export function ScanlineEffect_Clear() {}
