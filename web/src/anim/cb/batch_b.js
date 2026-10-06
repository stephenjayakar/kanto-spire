// Callback batch B, ported from pokefirered src/battle_anim_effects_2.c, battle_anim_effects_3.c and
// battle_anim_smokescreen.c (BULLET_SEED, RAGE, FAKE_OUT, WITHDRAW, THRASH, AIR_CUTTER, HYPER_FANG, HOWL, STOCKPILE,
// SWEET_SCENT, DEFENSE_CURL, SMOKESCREEN, ODOR_SLEUTH, YAWN).
import {
  S, DATA, gSprites, gTasks, gBattleAnimArgs, gBattlerSpriteIds, ANIM_ATTACKER, ANIM_TARGET,
  B_SIDE_PLAYER, B_SIDE_OPPONENT, BATTLER_COORD_X, BATTLER_COORD_Y, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET,
  ST_OAM_OBJ_NORMAL, TRUE, FALSE, RGB_WHITE, Sin, Cos, Random, idiv, s16, u16,
  CreateSprite, DestroySprite, StartSpriteAnim, StartSpriteAffineAnim, AnimateSprite, BlendPalettes,
  GetBattlerSide, GetBattlerSpriteCoord, GetAnimBattlerSpriteId, GetBattlerSpriteSubpriority, IsBattlerSpriteVisible,
  IsDoubleBattle, BATTLE_PARTNER, GetSpriteTileStartByTag, FreeSpriteTilesByTag, FreeSpritePaletteByTag,
  SpriteCallbackDummy, PlaySE12WithPanning, BattleAnimAdjustPanning, SOUND_PAN_TARGET,
  SetGpuReg, REG_OFFSET_WIN0H, REG_OFFSET_WIN0V, REG_OFFSET_WININ, REG_OFFSET_WINOUT, REG_OFFSET_BLDCNT, REG_OFFSET_BLDY,
  T, affineAnimByName, register,
} from '../gba.js';
import {
  DestroyAnimSprite, DestroyAnimVisualTask, InitSpritePosToAnimAttacker, StartAnimLinearTranslation,
  StoreSpriteCallbackInData6, RunStoredCallbackWhenAffineAnimEnds, DestroySpriteAndMatrix,
  PrepareBattlerSpriteForRotScale, SetSpriteRotScale, ResetSpriteRotScale, SetBattlerSpriteYOffsetFromRotation,
  PrepareAffineAnimInTaskData, RunAffineAnimFromTaskData, SetAverageBattlerPositions, SetSpriteCoordsToAnimAttackerCoords,
  CloneBattlerSpriteWithBlend, DestroySpriteWithActiveSheet, GetBattlePalettesMask,
} from '../helpers.js';

const DISPLAY_WIDTH = 240, DISPLAY_HEIGHT = 160;
const BLDCNT_TGT1_BG3 = 1 << 3, BLDCNT_EFFECT_LIGHTEN = 2 << 6, BLDCNT_EFFECT_DARKEN = 3 << 6;
const WININ_WIN0_BG_ALL = 0xF, WININ_WIN0_OBJ = 1 << 4, WININ_WIN0_CLR = 1 << 5;
const WININ_WIN1_BG_ALL = 0xF << 8, WININ_WIN1_OBJ = 1 << 12, WININ_WIN1_CLR = 1 << 13;
const WINOUT_WIN01_BG_ALL = 0xF, WINOUT_WIN01_OBJ = 1 << 4, WINOUT_WIN01_CLR = 1 << 5;
const WINOUT_WINOBJ_BG_ALL = 0xF << 8, WINOUT_WINOBJ_OBJ = 1 << 12, WINOUT_WINOBJ_CLR = 1 << 13;

// math_util.c
function Q_8_8_mul(x, y) { return s16(idiv(s16(x) * s16(y), 256)); }
function Q_8_8_inv(y) { return s16(idiv(0x10000, s16(y))); }

// sprite.c CreateInvisibleSpriteWithCallback (gDummySpriteTemplate, invisible)
function CreateInvisibleSpriteWithCallback(callback) {
  const id = CreateSprite({ w: 8, h: 8, callbackFn: callback }, DISPLAY_WIDTH + 64, DISPLAY_HEIGHT, 14);
  gSprites[id].invisible = true;
  return id;
}

// ================================ battle_anim_effects_2.c =======================================

// Rotates the attacking mon sprite downwards and then back upwards to its original position.
function AnimTask_Withdraw(taskId) {
  PrepareBattlerSpriteForRotScale(gBattlerSpriteIds[S.gBattleAnimAttacker], ST_OAM_OBJ_NORMAL);
  gTasks[taskId].func = AnimTask_Withdraw_Step;
}
function AnimTask_Withdraw_Step(taskId) {
  const spriteId = gBattlerSpriteIds[S.gBattleAnimAttacker];
  const t = gTasks[taskId].data;
  let rotation;
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER) rotation = s16(-t[0]);
  else rotation = t[0];
  SetSpriteRotScale(spriteId, 0x100, 0x100, rotation);
  if (t[1] === 0) {
    t[0] += 0xB0;
    gSprites[spriteId].y2++;
  } else if (t[1] === 1) {
    if (++t[3] === 30) t[1] = 2;
    return;
  } else {
    t[0] -= 0xB0;
    gSprites[spriteId].y2--;
  }
  SetBattlerSpriteYOffsetFromRotation(spriteId);
  if (t[0] === 0xF20 || t[0] === 0) {
    if (t[1] === 2) {
      ResetSpriteRotScale(spriteId);
      DestroyAnimVisualTask(taskId);
    } else {
      t[1]++;
    }
  }
}

// ---- AIR_CUTTER projectile ----
function AnimAirWaveProjectile_Step2(sprite) {
  if (sprite.data[0]-- <= 0) {
    gTasks[sprite.data[7]].data[1]--;
    DestroySprite(sprite);
  }
}
function AnimAirWaveProjectile_Step1(sprite) {
  const task = gTasks[sprite.data[7]];
  if (sprite.data[0] > task.data[5]) {
    sprite.data[5] += sprite.data[3];
    sprite.data[6] += sprite.data[4];
  } else {
    sprite.data[5] -= sprite.data[3];
    sprite.data[6] -= sprite.data[4];
  }
  sprite.data[1] += sprite.data[5];
  sprite.data[2] += sprite.data[6];
  if (1 & task.data[7]) sprite.x2 = -(u16(sprite.data[1]) >> 8);
  else sprite.x2 = u16(sprite.data[1]) >> 8;
  if (1 & task.data[8]) sprite.y2 = -(u16(sprite.data[2]) >> 8);
  else sprite.y2 = u16(sprite.data[2]) >> 8;
  if (sprite.data[0]-- <= 0) {
    sprite.data[0] = 30;
    sprite.callback = AnimAirWaveProjectile_Step2;
  }
}
function AnimAirWaveProjectile(sprite) {
  const task = gTasks[sprite.data[7]];
  sprite.data[1] += (-2 & task.data[7]);
  sprite.data[2] += (-2 & task.data[8]);
  if (1 & task.data[7]) sprite.x2 = -(u16(sprite.data[1]) >> 8);
  else sprite.x2 = u16(sprite.data[1]) >> 8;
  if (1 & task.data[8]) sprite.y2 = -(u16(sprite.data[2]) >> 8);
  else sprite.y2 = u16(sprite.data[2]) >> 8;
  if (sprite.data[0]-- <= 0) {
    sprite.data[0] = 8;
    task.data[5] = 4;
    const a = Q_8_8_inv(0x1000);
    let b, c;
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.y2 = 0;
    sprite.x2 = 0;
    if (task.data[11] >= sprite.x) b = s16((task.data[11] - sprite.x) << 8);
    else b = s16((sprite.x - task.data[11]) << 8);
    if (task.data[12] >= sprite.y) c = s16((task.data[12] - sprite.y) << 8);
    else c = s16((sprite.y - task.data[12]) << 8);
    sprite.data[2] = 0;
    sprite.data[1] = 0;
    sprite.data[6] = 0;
    sprite.data[5] = 0;
    sprite.data[3] = Q_8_8_mul(Q_8_8_mul(b, a), Q_8_8_inv(0x1C0));
    sprite.data[4] = Q_8_8_mul(Q_8_8_mul(c, a), Q_8_8_inv(0x1C0));
    sprite.callback = AnimAirWaveProjectile_Step1;
  }
}
function AirCutterProjectile_Step2(taskId) {
  if (gTasks[taskId].data[1] === 0) DestroyAnimVisualTask(taskId);
}
function AirCutterProjectile_Step1(taskId) {
  const t = gTasks[taskId].data;
  if (t[0]-- <= 0) {
    const spriteId = CreateSprite(T('gAirWaveProjectileSpriteTemplate'), t[9], t[10], t[2] - t[1]);
    const sprite = gSprites[spriteId];
    switch (t[4]) {
      case 1: sprite.hFlip = true; sprite.vFlip = true; sprite.flipH = true; sprite.flipV = true; break; // matrixNum |= HFLIP|VFLIP
      case 2: sprite.hFlip = true; sprite.flipH = true; break;
    }
    sprite.data[0] = t[5] - t[6];
    sprite.data[7] = taskId;
    t[t[1] + 13] = spriteId;
    t[0] = t[3];
    t[1]++;
    PlaySE12WithPanning('SE_M_BLIZZARD2', BattleAnimAdjustPanning(-SOUND_PAN_TARGET));
    if (t[1] > 2) gTasks[taskId].func = AirCutterProjectile_Step2;
  }
}
function AnimTask_AirCutterProjectile(taskId) {
  const t = gTasks[taskId].data;
  let targetX = 0, targetY = 0, xDiff, yDiff;
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) {
    t[4] = 1;
    gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    if (gBattleAnimArgs[2] & 1) gBattleAnimArgs[2] &= ~1;
    else gBattleAnimArgs[2] |= 1;
  }
  const attackerX = t[9] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X);
  const attackerY = t[10] = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y);
  if (IsDoubleBattle() && IsBattlerSpriteVisible(BATTLE_PARTNER(S.gBattleAnimTarget))) {
    const out = {};
    SetAverageBattlerPositions(S.gBattleAnimTarget, 0, out);
    targetX = out.x ?? GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
    targetY = out.y ?? GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y);
  } else {
    targetX = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
    targetY = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y);
  }
  targetX = t[11] = targetX + gBattleAnimArgs[0];
  targetY = t[12] = targetY + gBattleAnimArgs[1];
  targetX = t[11]; targetY = t[12];
  if (targetX >= attackerX) xDiff = targetX - attackerX;
  else xDiff = attackerX - targetX;
  t[5] = Q_8_8_mul(xDiff, Q_8_8_inv(gBattleAnimArgs[2] & ~1));
  t[6] = Q_8_8_mul(t[5], 0x80);
  t[7] = gBattleAnimArgs[2];
  if (targetY >= attackerY) {
    yDiff = targetY - attackerY;
    t[8] = Q_8_8_mul(yDiff, Q_8_8_inv(t[5])) & ~1;
  } else {
    yDiff = attackerY - targetY;
    t[8] = Q_8_8_mul(yDiff, Q_8_8_inv(t[5])) | 1;
  }
  t[3] = gBattleAnimArgs[3];
  if (gBattleAnimArgs[4] & 0x80) gBattleAnimArgs[4] ^= 0x80;
  if (gBattleAnimArgs[4] >= 64) t[2] = u16(GetBattlerSpriteSubpriority(S.gBattleAnimTarget) + (gBattleAnimArgs[4] - 64));
  else t[2] = u16(GetBattlerSpriteSubpriority(S.gBattleAnimTarget) - gBattleAnimArgs[4]);
  if (t[2] < 3) t[2] = 3;
  gTasks[taskId].func = AirCutterProjectile_Step1;
}

// ---- BULLET_SEED ----
function AnimBulletSeed(sprite) {
  InitSpritePosToAnimAttacker(sprite, TRUE);
  sprite.data[0] = 20;
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = StartAnimLinearTranslation;
  sprite.affineAnimPaused = TRUE;
  StoreSpriteCallbackInData6(sprite, AnimBulletSeed_Step1);
}
function AnimBulletSeed_Step1(sprite) {
  PlaySE12WithPanning('SE_M_HORN_ATTACK', BattleAnimAdjustPanning(SOUND_PAN_TARGET));
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.y2 = 0;
  sprite.x2 = 0;
  for (let i = 0; i < 8; i++) sprite.data[i] = 0; // ptr = &data[7]; ptr[i - 7] = 0
  let rand = Random();
  sprite.data[6] = 0xFFF4 - (rand & 7);
  rand = Random();
  sprite.data[7] = (rand % 0xA0) + 0xA0;
  sprite.callback = AnimBulletSeed_Step2;
  sprite.affineAnimPaused = FALSE;
}
function AnimBulletSeed_Step2(sprite) {
  sprite.data[0] += sprite.data[7];
  sprite.x2 = sprite.data[0] >> 8;
  if (sprite.data[7] & 1) sprite.x2 = -sprite.x2;
  sprite.y2 = Sin(sprite.data[1], sprite.data[6]);
  sprite.data[1] += 8;
  if (sprite.data[1] > 126) {
    sprite.data[1] = 0;
    sprite.data[2] = idiv(sprite.data[2], 2);
    if (++sprite.data[3] === 1) DestroyAnimSprite(sprite);
  }
}

// Animates an "angry" mark above a mon's head.
function AnimAngerMark(sprite) {
  const battler = !gBattleAnimArgs[0] ? S.gBattleAnimAttacker : S.gBattleAnimTarget;
  if (GetBattlerSide(battler) === B_SIDE_OPPONENT) gBattleAnimArgs[1] *= -1;
  sprite.x = GetBattlerSpriteCoord(battler, BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(battler, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  if (sprite.y < 8) sprite.y = 8;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
}

// ---- THRASH ----
function AnimTask_ThrashMoveMonHorizontal(taskId) {
  const task = gTasks[taskId];
  const spriteId = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  task.data[0] = spriteId;
  task.data[1] = 0;
  PrepareAffineAnimInTaskData(task, spriteId, affineAnimByName('sThrashMoveMonAffineAnimCmds'));
  task.func = AnimTask_ThrashMoveMonHorizontal_Step;
}
function AnimTask_ThrashMoveMonHorizontal_Step(taskId) {
  if (!RunAffineAnimFromTaskData(gTasks[taskId])) DestroyAnimVisualTask(taskId);
}
function AnimTask_ThrashMoveMonVertical(taskId) {
  const task = gTasks[taskId];
  task.data[0] = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  task.data[1] = 0;
  task.data[2] = 4;
  task.data[3] = 7;
  task.data[4] = 3;
  task.data[5] = gSprites[task.data[0]].x;
  task.data[6] = gSprites[task.data[0]].y;
  task.data[7] = 0;
  task.data[8] = 0;
  task.data[9] = 2;
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_OPPONENT) task.data[2] *= -1;
  task.func = AnimTask_ThrashMoveMonVertical_Step;
}
function AnimTask_ThrashMoveMonVertical_Step(taskId) {
  const task = gTasks[taskId];
  const sp = gSprites[task.data[0]];
  if (++task.data[7] > 2) {
    task.data[7] = 0;
    task.data[8]++;
    if (task.data[8] & 1) sp.y += task.data[9];
    else sp.y -= task.data[9];
  }
  switch (task.data[1]) {
    case 0:
      sp.x += task.data[2];
      if (--task.data[3] === 0) { task.data[3] = 14; task.data[1] = 1; }
      break;
    case 1:
      sp.x -= task.data[2];
      if (--task.data[3] === 0) { task.data[3] = 7; task.data[1] = 2; }
      break;
    case 2:
      sp.x += task.data[2];
      if (--task.data[3] === 0) {
        if (--task.data[4] !== 0) {
          task.data[3] = 7;
          task.data[1] = 0;
        } else {
          if ((task.data[8] & 1) !== 0) sp.y -= task.data[9];
          DestroyAnimVisualTask(taskId);
        }
      }
      break;
  }
}

// ---- FAKE_OUT ----
// Approximation: the shrinking WIN0 (background darkened outside it via BLDY) is drawn as a full-screen
// background darkening (S.bgBlack) that grows as the window closes.
function AnimTask_FakeOut(taskId) {
  const win0h = DISPLAY_WIDTH, win0v = 0;
  S.gBattle_WIN0H = win0h;
  S.gBattle_WIN0V = DISPLAY_HEIGHT;
  SetGpuReg(REG_OFFSET_WIN0H, S.gBattle_WIN0H);
  SetGpuReg(REG_OFFSET_WIN0V, S.gBattle_WIN0V);
  SetGpuReg(REG_OFFSET_WININ, WININ_WIN1_CLR | WININ_WIN1_OBJ | WININ_WIN1_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_BG_ALL);
  SetGpuReg(REG_OFFSET_WINOUT, WININ_WIN1_CLR | WININ_WIN1_OBJ | WININ_WIN1_BG_ALL | WININ_WIN0_CLR | WININ_WIN0_OBJ | WININ_WIN0_BG_ALL);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG3 | BLDCNT_EFFECT_DARKEN);
  SetGpuReg(REG_OFFSET_BLDY, 16);
  gTasks[taskId].data[0] = win0v;
  gTasks[taskId].data[1] = win0h;
  gTasks[taskId].func = AnimTask_FakeOut_Step1;
}
function AnimTask_FakeOut_Step1(taskId) {
  const t = gTasks[taskId].data;
  t[0] += 13;
  t[1] -= 13;
  if (t[0] >= t[1]) {
    S.gBattle_WIN0H = 0;
    S.bgBlack = 16;
    gTasks[taskId].func = AnimTask_FakeOut_Step2;
  } else {
    S.gBattle_WIN0H = t[1] | (t[0] << 8);
    S.bgBlack = Math.round(16 * (1 - (t[1] - t[0]) / DISPLAY_WIDTH));
  }
}
function AnimTask_FakeOut_Step2(taskId) {
  const t = gTasks[taskId].data;
  if (++t[10] === 5) {
    t[11] = 0x88;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG3 | BLDCNT_EFFECT_LIGHTEN);
    S.bgBlack = 0;
    BlendPalettes(GetBattlePalettesMask(TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE), 16, RGB_WHITE);
  } else if (t[10] > 4) {
    S.gBattle_WIN0H = 0;
    S.gBattle_WIN0V = 0;
    S.bgBlack = 0;
    SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ | WININ_WIN1_CLR);
    SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDY, 0);
    DestroyAnimVisualTask(taskId);
  }
}

// ================================ battle_anim_effects_3.c =======================================

function AnimBlackSmoke(sprite) {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  if (!gBattleAnimArgs[3]) sprite.data[0] = gBattleAnimArgs[2];
  else sprite.data[0] = -gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[4];
  sprite.callback = AnimBlackSmoke_Step;
}
function AnimBlackSmoke_Step(sprite) {
  if (sprite.data[1] > 0) {
    sprite.x2 = sprite.data[2] >> 8;
    sprite.data[2] += sprite.data[0];
    sprite.invisible = !sprite.invisible;
    sprite.data[1]--;
  } else {
    DestroyAnimSprite(sprite);
  }
}

function AnimTask_SmokescreenImpact(taskId) {
  SmokescreenImpact(
    GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + 8,
    GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + 8,
    FALSE);
  DestroyAnimVisualTask(taskId);
}

function AnimFang(sprite) {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

function AnimTask_DefenseCurlDeformMon(taskId) {
  switch (gTasks[taskId].data[0]) {
    case 0:
      PrepareAffineAnimInTaskData(gTasks[taskId], GetAnimBattlerSpriteId(ANIM_ATTACKER), affineAnimByName('DefenseCurlDeformMonAffineAnimCmds'));
      gTasks[taskId].data[0]++;
      break;
    case 1:
      if (!RunAffineAnimFromTaskData(gTasks[taskId])) DestroyAnimVisualTask(taskId);
      break;
  }
}

function AnimTask_StockpileDeformMon(taskId) {
  if (!gTasks[taskId].data[0]) {
    PrepareAffineAnimInTaskData(gTasks[taskId], GetAnimBattlerSpriteId(ANIM_ATTACKER), affineAnimByName('sStockpileDeformMonAffineAnimCmds'));
    gTasks[taskId].data[0]++;
  } else if (!RunAffineAnimFromTaskData(gTasks[taskId])) {
    DestroyAnimVisualTask(taskId);
  }
}

// Floats a petal across the screen towards the target mon's side.
function AnimSweetScentPetal(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER) {
    sprite.x = 0;
    sprite.y = gBattleAnimArgs[0];
  } else {
    sprite.x = DISPLAY_WIDTH;
    sprite.y = gBattleAnimArgs[0] - 30;
  }
  sprite.data[2] = gBattleAnimArgs[2];
  StartSpriteAnim(sprite, gBattleAnimArgs[1]);
  sprite.callback = AnimSweetScentPetal_Step;
}
function AnimSweetScentPetal_Step(sprite) {
  sprite.data[0] += 3;
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER) {
    sprite.x += 5;
    sprite.y -= 1;
    if (sprite.x > DISPLAY_WIDTH) { DestroyAnimSprite(sprite); return; }
    sprite.y2 = Sin(sprite.data[0] & 0xFF, 16);
  } else {
    sprite.x -= 5;
    sprite.y += 1;
    if (sprite.x < 0) { DestroyAnimSprite(sprite); return; }
    sprite.y2 = Cos(sprite.data[0] & 0xFF, 16);
  }
}

// Runs an affine animation that makes it look like the mon is inhaling deeply.
function AnimTask_DeepInhale(taskId) {
  const task = gTasks[taskId];
  task.data[0] = 0;
  task.data[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  PrepareAffineAnimInTaskData(task, task.data[15], affineAnimByName('sDeepInhaleAffineAnimCmds'));
  task.func = AnimTask_DeepInhale_Step;
}
function AnimTask_DeepInhale_Step(taskId) {
  const task = gTasks[taskId];
  let var0 = u16(task.data[0]);
  task.data[0]++;
  var0 = u16(var0 - 20);
  if (var0 < 23) {
    if (++task.data[1] > 1) {
      task.data[1] = 0;
      task.data[2]++;
      gSprites[task.data[15]].x2 = (task.data[2] & 1) ? 1 : -1;
    }
  } else {
    gSprites[task.data[15]].x2 = 0;
  }
  if (!RunAffineAnimFromTaskData(task)) DestroyAnimVisualTask(taskId);
}

// ---- YAWN ----
function InitYawnCloudPosition(sprite, startX, startY, destX, destY, duration) {
  sprite.x = startX;
  sprite.y = startY;
  sprite.data[4] = startX << 4;
  sprite.data[5] = startY << 4;
  sprite.data[6] = idiv((destX - startX) << 4, duration);
  sprite.data[7] = idiv((destY - startY) << 4, duration);
}
function UpdateYawnCloudPosition(sprite) {
  sprite.data[4] += sprite.data[6];
  sprite.data[5] += sprite.data[7];
  sprite.x = sprite.data[4] >> 4;
  sprite.y = sprite.data[5] >> 4;
}
function AnimYawnCloud(sprite) {
  const destX = sprite.x, destY = sprite.y;
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[0]);
  InitYawnCloudPosition(sprite, sprite.x, sprite.y, destX, destY, 64);
  sprite.data[0] = 0;
  sprite.callback = AnimYawnCloud_Step;
}
function AnimYawnCloud_Step(sprite) {
  sprite.data[0]++;
  const index = (sprite.data[0] * 8) & 0xFF;
  UpdateYawnCloudPosition(sprite);
  sprite.y2 = Sin(index, 8);
  if (sprite.data[0] > 58) {
    if (++sprite.data[1] > 1) {
      sprite.data[1] = 0;
      sprite.data[2]++;
      sprite.invisible = !!(sprite.data[2] & 1);
      if (sprite.data[2] > 3) DestroySpriteAndMatrix(sprite);
    }
  }
}

// ---- ODOR_SLEUTH ----
// gBattleSpritesDataPtr->battlerData[target].invisible (semi-invulnerable) -> the target sprite's invisible flag.
const targetHidden = () => !!gSprites[gBattlerSpriteIds[S.gBattleAnimTarget]].invisible;
function AnimTask_OdorSleuthMovement(taskId) {
  const spriteId1 = CloneBattlerSpriteWithBlend(ANIM_TARGET);
  if (spriteId1 < 0) { DestroyAnimVisualTask(taskId); return; }
  const spriteId2 = CloneBattlerSpriteWithBlend(ANIM_TARGET);
  if (spriteId2 < 0) {
    DestroySpriteWithActiveSheet(gSprites[spriteId1]);
    DestroyAnimVisualTask(taskId);
    return;
  }
  const s1 = gSprites[spriteId1], s2 = gSprites[spriteId2];
  s2.x2 += 24;
  s1.x2 -= 24;
  s2.data[0] = 0; s1.data[0] = 0;
  s2.data[1] = 0; s1.data[1] = 0;
  s2.data[2] = 0; s1.data[2] = 0;
  s2.data[3] = 16; s1.data[3] = -16;
  s2.data[4] = 0; s1.data[4] = 128;
  s2.data[5] = 24; s1.data[5] = 24;
  s2.data[6] = taskId; s1.data[6] = taskId;
  s2.data[7] = 0; s1.data[7] = 0;
  gTasks[taskId].data[0] = 2;
  if (!targetHidden()) { s2.invisible = false; s1.invisible = true; }
  else { s2.invisible = true; s1.invisible = true; }
  s2.oam.objMode = ST_OAM_OBJ_NORMAL;
  s1.oam.objMode = ST_OAM_OBJ_NORMAL;
  s2.callback = MoveOdorSleuthClone;
  s1.callback = MoveOdorSleuthClone;
  gTasks[taskId].func = AnimTask_OdorSleuthMovementWaitFinish;
}
function AnimTask_OdorSleuthMovementWaitFinish(taskId) {
  if (gTasks[taskId].data[0] === 0) DestroyAnimVisualTask(taskId);
}
function MoveOdorSleuthClone(sprite) {
  if (++sprite.data[1] > 1) {
    sprite.data[1] = 0;
    if (!targetHidden()) sprite.invisible = !sprite.invisible;
  }
  sprite.data[4] = sprite.data[4] + sprite.data[3];
  sprite.data[4] &= 0xFF;
  sprite.x2 = Cos(sprite.data[4], sprite.data[5]);
  switch (sprite.data[0]) {
    case 0:
      if (++sprite.data[2] === 60) { sprite.data[2] = 0; sprite.data[0]++; }
      break;
    case 1:
      if (++sprite.data[2] > 0) {
        sprite.data[2] = 0;
        sprite.data[5] -= 2;
        if (sprite.data[5] < 0) {
          gTasks[sprite.data[6]].data[sprite.data[7]]--;
          DestroySpriteWithActiveSheet(sprite);
        }
      }
      break;
  }
}

// ================================ battle_anim_smokescreen.c =====================================
// gSmokescreenImpactTiles/Palette are not part of anims.json (not an ANIM_TAG), so the 12 4bpp tiles
// (graphics/battle_anims/sprites/smokescreen_impact.png) and its palette are embedded here and appended to
// DATA.tiles as a synthetic tag the first time the effect runs.
const TAG_SMOKESCREEN = 'TAG_SMOKESCREEN';
const SMOKESCREEN_TILES_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAYAYFZlYFVVVQAAAAAAAABgAAAAUAAAAFYAAABWAABgVQAAYFUAAABWVlVVVVVVVVVVVVZmVWVlZlVWZmBVZQYGVWZgAFVmBgAAAAAAAAAAYAAAAGYAAABWAGBmVQBmVVYAVmVVYFVVZQAAAABmBgAAVVUGAFVVZWZVZWVWVVZmZlVlZgZWZmYAYFVVZWBWVWZgZVZmAGZlZQBmVmYAYGZmAABmZgBgZgBmZmYABgZmAGZgBgAGBgAAZgYAAGYAAAAAAAAAAAAAAAAAAAAAAABgAAAAVgAAYFUAYAZWAFZmZgBVZQZgVWUAYGUAAFZVZgBlZQYGZWZgAGYAAAAGAAAAAAAAAAAAAABgVmYAVmYGAFZlAABWZQAAYAYAAGBgAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SMOKESCREEN_PAL = ['#629431', '#3962c5', '#000000', '#000000', '#000000', '#a49c6a', '#c5c594', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000'];
function b64bytes(s) {
  if (typeof atob === 'function') { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  return new Uint8Array(Buffer.from(s, 'base64'));
}
function ensureSmokescreenGfx() {
  const j = DATA.json;
  if (!j || j.tags[TAG_SMOKESCREEN]) return;
  const add = b64bytes(SMOKESCREEN_TILES_B64);
  const old = DATA.tiles || new Uint8Array(0);
  const merged = new Uint8Array(old.length + add.length);
  merged.set(old, 0); merged.set(add, old.length);
  DATA.tiles = merged;
  j.tags[TAG_SMOKESCREEN] = { id: 55019, tiles: [old.length, 12], imgW: 2, pal: TAG_SMOKESCREEN };
  j.palettes[TAG_SMOKESCREEN] = SMOKESCREEN_PAL;
}
let sSmokescreenImpactSpriteTemplate = null;
function smokescreenTemplate() {
  if (!sSmokescreenImpactSpriteTemplate) {
    const anims = ['sAnim_SmokescreenImpact_0', 'sAnim_SmokescreenImpact_1', 'sAnim_SmokescreenImpact_2', 'sAnim_SmokescreenImpact_3']
      .map(n => DATA.json.anims?.[n] || [{ end: 1 }]);
    sSmokescreenImpactSpriteTemplate = {
      tileTag: TAG_SMOKESCREEN, paletteTag: TAG_SMOKESCREEN, w: 16, h: 16, affine: 0, objMode: 0, priority: 1,
      anims, affineAnims: 'gDummySpriteAffineAnimTable', callbackFn: SpriteCB_SmokescreenImpact,
    };
  }
  return sSmokescreenImpactSpriteTemplate;
}
// #define sActiveSprites data[0], sPersist data[1], sMainSpriteId data[0]
function SmokescreenImpact(x, y, persist) {
  ensureSmokescreenGfx();
  void GetSpriteTileStartByTag(TAG_SMOKESCREEN);
  const tpl = smokescreenTemplate();
  const mainSpriteId = CreateInvisibleSpriteWithCallback(SpriteCB_SmokescreenImpactMain);
  const mainSprite = gSprites[mainSpriteId];
  mainSprite.data[1] = persist;
  const pos = [[x - 16, y - 16], [x, y - 16], [x - 16, y], [x, y]];
  for (let k = 0; k < 4; k++) {
    const id = CreateSprite(tpl, pos[k][0], pos[k][1], 2);
    gSprites[id].data[0] = mainSpriteId;
    mainSprite.data[0]++;
    if (k) StartSpriteAnim(gSprites[id], k);
    AnimateSprite(gSprites[id]);
  }
  return mainSpriteId;
}
function SpriteCB_SmokescreenImpactMain(sprite) {
  if (sprite.data[0] === 0) {
    FreeSpriteTilesByTag(TAG_SMOKESCREEN);
    FreeSpritePaletteByTag(TAG_SMOKESCREEN);
    if (!sprite.data[1]) DestroySprite(sprite);
    else sprite.callback = SpriteCallbackDummy;
  }
}
function SpriteCB_SmokescreenImpact(sprite) {
  if (sprite.animEnded) {
    gSprites[sprite.data[0]].data[0]--;
    DestroySprite(sprite);
  }
}

register({
  AnimTask_Withdraw, AnimTask_AirCutterProjectile, AnimAirWaveProjectile, AnimBulletSeed, AnimAngerMark,
  AnimTask_ThrashMoveMonHorizontal, AnimTask_ThrashMoveMonVertical, AnimTask_FakeOut,
  AnimBlackSmoke, AnimTask_SmokescreenImpact, AnimFang, AnimTask_DefenseCurlDeformMon, AnimTask_StockpileDeformMon,
  AnimSweetScentPetal, AnimTask_DeepInhale, AnimYawnCloud, AnimTask_OdorSleuthMovement,
});
