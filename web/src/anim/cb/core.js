// Shared/core battle-anim callbacks, ported from the decomp (pokefirered):
//   src/battle_anim_mon_movement.c (whole file), src/battle_anim_mons.c (sprite callbacks),
//   src/battle_anim_normal.c (palette blends, hit splats, terrain shake), src/battle_anim_utility_funcs.c,
//   src/battle_anim_sound_tasks.c (loop SE / double cry / wait for cry), plus a few move-specific
//   callbacks used by the basic physical moves (battle_anim_effects_1.c, battle_anim_fight.c).
import {
  S, gSprites, gTasks, gBattleAnimArgs, gBattlerSpriteIds, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded,
  register, idiv, u8, s16, Sin, Cos, Random, CreateTask, DestroyTask,
  StartSpriteAnim, StartSpriteAffineAnim, BlendPalette, BlendPalettes, BeginNormalPaletteFade, IndexOfSpritePaletteTag,
  GetBattlerSide, GetBattlerAtPosition, GetBattlerSpriteCoord, GetAnimBattlerSpriteId, IsBattlerSpriteVisible, IsContest,
  GetBattlerSpriteSpecies, SoundHooks, PlaySE12WithPanning, BattleAnimAdjustPanning, CalculatePanIncrement, KeepPanInRange, IsCryPlaying,
  BATTLE_PARTNER, ANIM_ATTACKER, ANIM_TARGET, ANIM_ATK_PARTNER, ANIM_DEF_PARTNER, B_SIDE_PLAYER, B_SIDE_OPPONENT,
  B_POSITION_PLAYER_LEFT, B_POSITION_PLAYER_RIGHT, B_POSITION_OPPONENT_LEFT, B_POSITION_OPPONENT_RIGHT,
  BATTLER_COORD_X, BATTLER_COORD_Y, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET, SOUND_PAN_ATTACKER,
  ST_OAM_OBJ_NORMAL, SPRITE_NONE, TRUE, FALSE, RGB,
} from '../gba.js';
import * as H from '../helpers.js';

const MAX_BATTLERS_COUNT = 4;
const ARG_RET_ID = 7;
const SPECIES_NONE = 0;
// include/constants/sound.h
const CRY_MODE_HIGH_PITCH = 3, CRY_MODE_ROAR_1 = 7, CRY_MODE_ROAR_2 = 8, CRY_MODE_GROWL_1 = 9, CRY_MODE_GROWL_2 = 10;
const DOUBLE_CRY_ROAR = 2, DOUBLE_CRY_GROWL = 255;
const OBJ_PLTT_ID = (n) => 256 + n * 16;

// ---- helpers ---------------------------------------------------------------------------------------
// Coordinator's helpers.js, looked up lazily by C name; a private fallback is used when it lacks one.
const h = (name, fallback) => (...a) => {
  const f = H[name] || fallback;
  if (!f) throw new Error('anim/core: helpers.js lacks ' + name);
  return f(...a);
};
const SetCallbackToStoredInData6 = h('SetCallbackToStoredInData6', (sprite) => { sprite.callback = sprite.storedCb; });
const StoreSpriteCallbackInData6 = h('StoreSpriteCallbackInData6', (sprite, cb) => { sprite.storedCb = cb; });
const DestroyAnimSprite = h('DestroyAnimSprite');
const DestroyAnimVisualTask = h('DestroyAnimVisualTask');
const DestroyAnimSoundTask = h('DestroyAnimSoundTask');
const InitSpritePosToAnimAttacker = h('InitSpritePosToAnimAttacker');
const InitSpritePosToAnimTarget = h('InitSpritePosToAnimTarget');
const StartAnimLinearTranslation = h('StartAnimLinearTranslation');
const InitAnimArcTranslation = h('InitAnimArcTranslation');
const TranslateAnimHorizontalArc = h('TranslateAnimHorizontalArc');
const SetSpriteRotScale = h('SetSpriteRotScale');
const PrepareBattlerSpriteForRotScale = h('PrepareBattlerSpriteForRotScale');
const ResetSpriteRotScale = h('ResetSpriteRotScale');
const SetBattlerSpriteYOffsetFromRotation = h('SetBattlerSpriteYOffsetFromRotation');
const GetBattlePalettesMask = h('GetBattlePalettesMask');
const GetBattleMonSpritePalettesMask = h('GetBattleMonSpritePalettesMask');
const CloneBattlerSpriteWithBlend = h('CloneBattlerSpriteWithBlend');
const DestroySpriteAndMatrix = h('DestroySpriteAndMatrix');
const DestroySpriteWithActiveSheet = h('DestroySpriteWithActiveSheet');
const SetAnimSpriteInitialXOffset = h('SetAnimSpriteInitialXOffset');
const WaitAnimForDuration = h('WaitAnimForDuration', (sprite) => {
  if (sprite.data[0] > 0) sprite.data[0]--; else SetCallbackToStoredInData6(sprite);
});
const RunStoredCallbackWhenAffineAnimEnds = h('RunStoredCallbackWhenAffineAnimEnds', (sprite) => {
  if (sprite.affineAnimEnded) SetCallbackToStoredInData6(sprite);
});
const RunStoredCallbackWhenAnimEnds = h('RunStoredCallbackWhenAnimEnds', (sprite) => {
  if (sprite.animEnded) SetCallbackToStoredInData6(sprite);
});
// battle_anim_mons.c: TranslateSpriteLinearById
const TranslateSpriteLinearById = h('TranslateSpriteLinearById', (sprite) => {
  if (sprite.data[0] > 0) {
    --sprite.data[0];
    gSprites[sprite.data[3]].x2 += sprite.data[1];
    gSprites[sprite.data[3]].y2 += sprite.data[2];
  } else SetCallbackToStoredInData6(sprite);
});
// battle_anim_mons.c: TranslateSpriteLinearByIdFixedPoint
const TranslateSpriteLinearByIdFixedPoint = h('TranslateSpriteLinearByIdFixedPoint', (sprite) => {
  if (sprite.data[0] > 0) {
    --sprite.data[0];
    sprite.data[3] += sprite.data[1];
    sprite.data[4] += sprite.data[2];
    gSprites[sprite.data[5]].x2 = sprite.data[3] >> 8;
    gSprites[sprite.data[5]].y2 = sprite.data[4] >> 8;
  } else SetCallbackToStoredInData6(sprite);
});
// battle_anim_mons.c: InitSpriteDataForLinearTranslation
const InitSpriteDataForLinearTranslation = h('InitSpriteDataForLinearTranslation', (sprite) => {
  const x = s16((sprite.data[2] - sprite.data[1]) << 8);
  const y = s16((sprite.data[4] - sprite.data[3]) << 8);
  sprite.data[1] = idiv(x, sprite.data[0]);
  sprite.data[2] = idiv(y, sprite.data[0]);
  sprite.data[4] = 0;
  sprite.data[3] = 0;
});
// battle_anim_mons.c: DestroyAnimSpriteAfterTimer
const DestroyAnimSpriteAfterTimer = h('DestroyAnimSpriteAfterTimer', (sprite) => {
  if (sprite.data[0]-- <= 0) DestroyAnimSprite(sprite);
});
// battle_anim_normal.c: UnpackSelectedBattlePalettes
const UnpackSelectedBattlePalettes = h('UnpackSelectedBattlePalettes', (selector) => {
  const battleBackground = selector & 1;
  const attacker = (selector >> 1) & 1;
  const target = (selector >> 2) & 1;
  const attackerPartner = (selector >> 3) & 1;
  const targetPartner = (selector >> 4) & 1;
  const anim1 = (selector >> 5) & 1;
  const anim2 = (selector >> 6) & 1;
  return GetBattlePalettesMask(battleBackground, attacker, target, attackerPartner, targetPartner, anim1, anim2);
});
// sound.c PlayCry_ByMode (pan ignored)
function PlayCry_ByMode(species, _pan, mode) { SoundHooks.playCry(species, mode); }

// =====================================================================================================
// battle_anim_mon_movement.c
// =====================================================================================================

// Task to facilitate simple shaking of a pokemon's picture in battle.
// arg 0: anim battler, arg 1: x pixel offset, arg 2: y pixel offset, arg 3: num times to shake, arg 4: frame delay
function AnimTask_ShakeMon(taskId) {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  if (spriteId === SPRITE_NONE) { DestroyAnimVisualTask(taskId); return; }
  gSprites[spriteId].x2 = gBattleAnimArgs[1];
  gSprites[spriteId].y2 = gBattleAnimArgs[2];
  const d = gTasks[taskId].data;
  d[0] = spriteId;
  d[1] = gBattleAnimArgs[3];
  d[2] = gBattleAnimArgs[4];
  d[3] = gBattleAnimArgs[4];
  d[4] = gBattleAnimArgs[1];
  d[5] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ShakeMon_Step;
  gTasks[taskId].func(taskId);
}

function AnimTask_ShakeMon_Step(taskId) {
  const d = gTasks[taskId].data, sp = gSprites[d[0]];
  if (d[3] === 0) {
    sp.x2 = sp.x2 === 0 ? d[4] : 0;
    sp.y2 = sp.y2 === 0 ? d[5] : 0;
    d[3] = d[2];
    if (--d[1] === 0) {
      sp.x2 = 0;
      sp.y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  } else d[3]--;
}

// Shaking alternates between the positive and negative versions of the offsets.
function AnimTask_ShakeMon2(taskId) {
  let abort = FALSE;
  let spriteId, battlerId;
  if (gBattleAnimArgs[0] < MAX_BATTLERS_COUNT) {
    spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
    if (spriteId === SPRITE_NONE) abort = TRUE;
  } else if (gBattleAnimArgs[0] !== 8) {
    switch (gBattleAnimArgs[0]) {
      case 4: battlerId = GetBattlerAtPosition(B_POSITION_PLAYER_LEFT); break;
      case 5: battlerId = GetBattlerAtPosition(B_POSITION_PLAYER_RIGHT); break;
      case 6: battlerId = GetBattlerAtPosition(B_POSITION_OPPONENT_LEFT); break;
      default: battlerId = GetBattlerAtPosition(B_POSITION_OPPONENT_RIGHT); break;
    }
    if (!IsBattlerSpriteVisible(battlerId)) abort = TRUE;
    spriteId = gBattlerSpriteIds[battlerId];
  } else spriteId = gBattlerSpriteIds[S.gBattleAnimAttacker];

  if (abort) { DestroyAnimVisualTask(taskId); return; }

  gSprites[spriteId].x2 = gBattleAnimArgs[1];
  gSprites[spriteId].y2 = gBattleAnimArgs[2];
  const d = gTasks[taskId].data;
  d[0] = spriteId;
  d[1] = gBattleAnimArgs[3];
  d[2] = gBattleAnimArgs[4];
  d[3] = gBattleAnimArgs[4];
  d[4] = gBattleAnimArgs[1];
  d[5] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ShakeMon2Step;
  gTasks[taskId].func(taskId);
}

function AnimTask_ShakeMon2Step(taskId) {
  const d = gTasks[taskId].data, sp = gSprites[d[0]];
  if (d[3] === 0) {
    sp.x2 = sp.x2 === d[4] ? -d[4] : d[4];
    sp.y2 = sp.y2 === d[5] ? -d[5] : d[5];
    d[3] = d[2];
    if (--d[1] === 0) {
      sp.x2 = 0;
      sp.y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  } else d[3]--;
}

// Shakes relative to the current location of the mon's picture.
function AnimTask_ShakeMonInPlace(taskId) {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  if (spriteId === SPRITE_NONE) { DestroyAnimVisualTask(taskId); return; }
  gSprites[spriteId].x2 += gBattleAnimArgs[1];
  gSprites[spriteId].y2 += gBattleAnimArgs[2];
  const d = gTasks[taskId].data;
  d[0] = spriteId;
  d[1] = 0;
  d[2] = gBattleAnimArgs[3];
  d[3] = 0;
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[1] * 2;
  d[6] = gBattleAnimArgs[2] * 2;
  gTasks[taskId].func = AnimTask_ShakeMonInPlace_Step;
  gTasks[taskId].func(taskId);
}

function AnimTask_ShakeMonInPlace_Step(taskId) {
  const d = gTasks[taskId].data, sp = gSprites[d[0]];
  if (d[3] === 0) {
    if (d[1] & 1) { sp.x2 += d[5]; sp.y2 += d[6]; }
    else { sp.x2 -= d[5]; sp.y2 -= d[6]; }
    d[3] = d[4];
    if (++d[1] >= d[2]) {
      if (d[1] & 1) { sp.x2 += idiv(d[5], 2); sp.y2 += idiv(d[6], 2); }
      else { sp.x2 -= idiv(d[5], 2); sp.y2 -= idiv(d[6], 2); }
      DestroyAnimVisualTask(taskId);
    }
  } else d[3]--;
}

// Shakes a mon bg horizontally and moves it downward linearly.
function AnimTask_ShakeAndSinkMon(taskId) {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  gSprites[spriteId].x2 = gBattleAnimArgs[1];
  const d = gTasks[taskId].data;
  d[0] = spriteId;
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  gTasks[taskId].func = AnimTask_ShakeAndSinkMon_Step;
  gTasks[taskId].func(taskId);
}

function AnimTask_ShakeAndSinkMon_Step(taskId) {
  const d = gTasks[taskId].data;
  const spriteId = d[0];
  let x = d[1];
  if (d[2] === d[8]++) {
    d[8] = 0;
    if (gSprites[spriteId].x2 === x) x = -x;
    gSprites[spriteId].x2 += x;
  }
  d[1] = x;
  d[9] += d[3];
  gSprites[spriteId].y2 = d[9] >> 8;
  if (--d[4] === 0) DestroyAnimVisualTask(taskId);
}

// Moves a mon bg picture along an elliptical path that begins and ends at the mon's origin.
// arg 0: battler, arg 1: ellipse width, arg 2: ellipse height, arg 3: num loops, arg 4: speed (0-5)
function AnimTask_TranslateMonElliptical(taskId) {
  let wavePeriod = 1;
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  if (gBattleAnimArgs[4] > 5) gBattleAnimArgs[4] = 5;
  for (let i = 0; i < gBattleAnimArgs[4]; i++) wavePeriod *= 2;
  const d = gTasks[taskId].data;
  d[0] = spriteId;
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = wavePeriod;
  gTasks[taskId].func = AnimTask_TranslateMonElliptical_Step;
  gTasks[taskId].func(taskId);
}

function AnimTask_TranslateMonElliptical_Step(taskId) {
  const d = gTasks[taskId].data;
  const sp = gSprites[d[0]];
  sp.x2 = Sin(d[5], d[1]);
  sp.y2 = -Cos(d[5], d[2]);
  sp.y2 += d[2];
  d[5] += d[4];
  d[5] &= 0xFF;
  if (d[5] === 0) d[3]--;
  if (d[3] === 0) {
    sp.x2 = 0;
    sp.y2 = 0;
    DestroyAnimVisualTask(taskId);
  }
}

// Same, but the path is mirrored if the attacker isn't on the player's side.
function AnimTask_TranslateMonEllipticalRespectSide(taskId) {
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  AnimTask_TranslateMonElliptical(taskId);
}

// Simple horizontal lunge and back. arg 0: duration of one direction, arg 1: x delta per frame
function DoHorizontalLunge(sprite) {
  sprite.invisible = TRUE;
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) sprite.data[1] = -gBattleAnimArgs[1];
  else sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[2] = 0;
  sprite.data[3] = gBattlerSpriteIds[S.gBattleAnimAttacker];
  sprite.data[4] = gBattleAnimArgs[0];
  StoreSpriteCallbackInData6(sprite, ReverseHorizontalLungeDirection);
  sprite.callback = TranslateSpriteLinearById;
}

function ReverseHorizontalLungeDirection(sprite) {
  sprite.data[0] = sprite.data[4];
  sprite.data[1] = -sprite.data[1];
  sprite.callback = TranslateSpriteLinearById;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// Vertical dip and back. arg 0: duration of one direction, arg 1: y delta per frame, arg 2: battler
function DoVerticalDip(sprite) {
  sprite.invisible = TRUE;
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[2]);
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = 0;
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.data[3] = spriteId;
  sprite.data[4] = gBattleAnimArgs[0];
  StoreSpriteCallbackInData6(sprite, ReverseVerticalDipDirection);
  sprite.callback = TranslateSpriteLinearById;
}

function ReverseVerticalDipDirection(sprite) {
  sprite.data[0] = sprite.data[4];
  sprite.data[2] = -sprite.data[2];
  sprite.callback = TranslateSpriteLinearById;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// Linearly slides a mon's picture back to its original position.
// arg 0: 1 = target / 0 = attacker, arg 1: 0 = both axes, 1 = horizontal only, 2 = vertical only, arg 2: duration
function SlideMonToOriginalPos(sprite) {
  const spriteId = gBattleAnimArgs[0] === 0 ? gBattlerSpriteIds[S.gBattleAnimAttacker] : gBattlerSpriteIds[S.gBattleAnimTarget];
  const mon = gSprites[spriteId];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = mon.x + mon.x2;
  sprite.data[2] = mon.x;
  sprite.data[3] = mon.y + mon.y2;
  sprite.data[4] = mon.y;
  InitSpriteDataForLinearTranslation(sprite);
  sprite.data[3] = 0;
  sprite.data[4] = 0;
  sprite.data[5] = mon.x2;
  sprite.data[6] = mon.y2;
  sprite.invisible = TRUE;
  if (gBattleAnimArgs[1] === 1) sprite.data[2] = 0;
  else if (gBattleAnimArgs[1] === 2) sprite.data[1] = 0;
  sprite.data[7] = gBattleAnimArgs[1];
  sprite.data[7] |= spriteId << 8;
  sprite.callback = SlideMonToOriginalPos_Step;
}

function SlideMonToOriginalPos_Step(sprite) {
  const data7 = u8(sprite.data[7]);
  const monSprite = gSprites[(sprite.data[7] >> 8) & 0xFF];
  if (sprite.data[0] === 0) {
    if (data7 === 1 || data7 === 0) monSprite.x2 = 0;
    if (data7 === 2 || data7 === 0) monSprite.y2 = 0;
    DestroyAnimSprite(sprite);
  } else {
    sprite.data[0]--;
    sprite.data[3] += sprite.data[1];
    sprite.data[4] += sprite.data[2];
    monSprite.x2 = (sprite.data[3] >> 8) + sprite.data[5];
    monSprite.y2 = (sprite.data[4] >> 8) + sprite.data[6];
  }
}

// Linearly translates a mon to a target offset (x mirrored for the opponent, y if arg 3 == 1).
// arg 0: 0 = attacker, 1 = target, arg 1/2: target offset, arg 3: mirror y, arg 4: duration
function SlideMonToOffset(sprite) {
  const battlerId = gBattleAnimArgs[0] === 0 ? S.gBattleAnimAttacker : S.gBattleAnimTarget;
  const monSpriteId = gBattlerSpriteIds[battlerId];
  if (GetBattlerSide(battlerId) !== B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    if (gBattleAnimArgs[3] === 1) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  }
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = gSprites[monSpriteId].x;
  sprite.data[2] = gSprites[monSpriteId].x + gBattleAnimArgs[1];
  sprite.data[3] = gSprites[monSpriteId].y;
  sprite.data[4] = gSprites[monSpriteId].y + gBattleAnimArgs[2];
  InitSpriteDataForLinearTranslation(sprite);
  sprite.data[3] = 0;
  sprite.data[4] = 0;
  sprite.data[5] = monSpriteId;
  sprite.invisible = TRUE;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteLinearByIdFixedPoint;
}

function SlideMonToOffsetAndBack(sprite) {
  sprite.invisible = TRUE;
  const battlerId = gBattleAnimArgs[0] === ANIM_ATTACKER ? S.gBattleAnimAttacker : S.gBattleAnimTarget;
  const spriteId = gBattlerSpriteIds[battlerId];
  if (GetBattlerSide(battlerId) !== B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    if (gBattleAnimArgs[3] === 1) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  }
  const mon = gSprites[spriteId];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = mon.x + mon.x2;
  sprite.data[2] = sprite.data[1] + gBattleAnimArgs[1];
  sprite.data[3] = mon.y + mon.y2;
  sprite.data[4] = sprite.data[3] + gBattleAnimArgs[2];
  InitSpriteDataForLinearTranslation(sprite);
  sprite.data[3] = mon.x2 << 8;
  sprite.data[4] = mon.y2 << 8;
  sprite.data[5] = spriteId;
  sprite.data[6] = gBattleAnimArgs[5];
  if (gBattleAnimArgs[5] === 0) StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  else StoreSpriteCallbackInData6(sprite, SlideMonToOffsetAndBack_End);
  sprite.callback = TranslateSpriteLinearByIdFixedPoint;
}

function SlideMonToOffsetAndBack_End(sprite) {
  gSprites[sprite.data[5]].x2 = 0;
  gSprites[sprite.data[5]].y2 = 0;
  DestroyAnimSprite(sprite);
}

// Arc to one position, then lunge to a target x offset (TAKE_DOWN).
function AnimTask_WindUpLunge(taskId) {
  const wavePeriod = idiv(0x8000, gBattleAnimArgs[3]) & 0xFFFF;
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[5] = -gBattleAnimArgs[5];
  }
  const d = gTasks[taskId].data;
  d[0] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  d[1] = idiv(gBattleAnimArgs[1] * 256, gBattleAnimArgs[3]);
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  d[5] = idiv(gBattleAnimArgs[5] * 256, gBattleAnimArgs[6]);
  d[6] = gBattleAnimArgs[6];
  d[7] = wavePeriod;
  gTasks[taskId].func = AnimTask_WindUpLunge_Step1;
}

function AnimTask_WindUpLunge_Step1(taskId) {
  const d = gTasks[taskId].data;
  const spriteId = d[0];
  d[11] += d[1];
  gSprites[spriteId].x2 = d[11] >> 8;
  gSprites[spriteId].y2 = Sin(u8(d[10] >> 8), d[2]);
  d[10] += d[7];
  if (--d[3] === 0) gTasks[taskId].func = AnimTask_WindUpLunge_Step2;
}

function AnimTask_WindUpLunge_Step2(taskId) {
  const d = gTasks[taskId].data;
  if (d[4] > 0) d[4]--;
  else {
    const spriteId = d[0];
    d[12] += d[5];
    gSprites[spriteId].x2 = (d[12] >> 8) + (d[11] >> 8);
    if (--d[6] === 0) DestroyAnimVisualTask(taskId);
  }
}

// To move a mon off-screen when pushed out by Roar/Whirlwind
function AnimTask_SlideOffScreen(taskId) {
  let spriteId;
  switch (gBattleAnimArgs[0]) {
    case ANIM_ATTACKER:
    case ANIM_TARGET:
      spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
      break;
    case ANIM_ATK_PARTNER:
      if (!IsBattlerSpriteVisible(S.gBattleAnimAttacker ^ 2)) { DestroyAnimVisualTask(taskId); return; }
      spriteId = gBattlerSpriteIds[S.gBattleAnimAttacker ^ 2];
      break;
    case ANIM_DEF_PARTNER:
      if (!IsBattlerSpriteVisible(S.gBattleAnimTarget ^ 2)) { DestroyAnimVisualTask(taskId); return; }
      spriteId = gBattlerSpriteIds[S.gBattleAnimTarget ^ 2];
      break;
    default:
      DestroyAnimVisualTask(taskId);
      return;
  }
  gTasks[taskId].data[0] = spriteId;
  if (GetBattlerSide(S.gBattleAnimTarget) !== B_SIDE_PLAYER) gTasks[taskId].data[1] = gBattleAnimArgs[1];
  else gTasks[taskId].data[1] = -gBattleAnimArgs[1];
  gTasks[taskId].func = AnimTask_SlideOffScreen_Step;
}

function AnimTask_SlideOffScreen_Step(taskId) {
  const sp = gSprites[gTasks[taskId].data[0]];
  sp.x2 += gTasks[taskId].data[1];
  if (sp.x2 + sp.x < -32 || sp.x2 + sp.x > 240 + 32) DestroyAnimVisualTask(taskId);
}

// Sways the mon picture back and forth (sine), horizontally or vertically.
// arg 0: 0 = horizontal / 1 = vertical, arg 1: amplitude, arg 2: period, arg 3: num sways, arg 4: 0 = attacker / 1 = target
function AnimTask_SwayMon(taskId) {
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[4]);
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = spriteId;
  d[5] = gBattleAnimArgs[4] === 0 ? S.gBattleAnimAttacker : S.gBattleAnimTarget;
  d[12] = 1;
  gTasks[taskId].func = AnimTask_SwayMon_Step;
}

function AnimTask_SwayMon_Step(taskId) {
  const d = gTasks[taskId].data;
  const spriteId = d[4];
  const sineIndex = (d[10] + d[2]) & 0xFFFF;
  d[10] = sineIndex;
  const waveIndex = sineIndex >> 8;
  const sineValue = Sin(waveIndex, d[1]);
  if (d[0] === 0) gSprites[spriteId].x2 = sineValue;
  else if (GetBattlerSide(d[5]) === B_SIDE_PLAYER) gSprites[spriteId].y2 = Math.abs(sineValue);
  else gSprites[spriteId].y2 = -Math.abs(sineValue);
  if ((waveIndex > 0x7F && d[11] === 0 && d[12] === 1) || (waveIndex < 0x7F && d[11] === 1 && d[12] === 0)) {
    d[11] ^= 1;
    d[12] ^= 1;
    if (--d[3] === 0) {
      gSprites[spriteId].x2 = 0;
      gSprites[spriteId].y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  }
}

// Scales a mon's sprite, then scales back. arg 0/1: x/y scale delta, arg 2: duration, arg 3: battler, arg 4: obj mode
function AnimTask_ScaleMonAndRestore(taskId) {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[3]);
  PrepareBattlerSpriteForRotScale(spriteId, gBattleAnimArgs[4]);
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[2];
  d[4] = spriteId;
  d[10] = 0x100;
  d[11] = 0x100;
  gTasks[taskId].func = AnimTask_ScaleMonAndRestore_Step;
}

function AnimTask_ScaleMonAndRestore_Step(taskId) {
  const d = gTasks[taskId].data;
  d[10] += d[0];
  d[11] += d[1];
  const spriteId = d[4];
  SetSpriteRotScale(spriteId, d[10], d[11], 0);
  if (--d[2] === 0) {
    if (d[3] > 0) {
      d[0] = -d[0];
      d[1] = -d[1];
      d[2] = d[3];
      d[3] = 0;
    } else {
      ResetSpriteRotScale(spriteId);
      DestroyAnimVisualTask(taskId);
    }
  }
}

function AnimTask_RotateMonSpriteToSide(taskId) {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[2]);
  PrepareBattlerSpriteForRotScale(spriteId, 0);
  const d = gTasks[taskId].data;
  d[1] = 0;
  d[2] = gBattleAnimArgs[0];
  if (gBattleAnimArgs[3] !== 1) d[3] = 0;
  else d[3] = gBattleAnimArgs[0] * gBattleAnimArgs[1];
  d[4] = gBattleAnimArgs[1];
  d[5] = spriteId;
  d[6] = gBattleAnimArgs[3];
  if (gBattleAnimArgs[2] === ANIM_ATTACKER) d[7] = GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER ? 1 : 0;
  else d[7] = GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER ? 1 : 0;
  if (d[7] && !IsContest()) {
    d[3] = -d[3];
    d[4] = -d[4];
  }
  gTasks[taskId].func = AnimTask_RotateMonSpriteToSide_Step;
}

// Rotates mon to side and back to original position. For Peck and when a held item activates
function AnimTask_RotateMonToSideAndRestore(taskId) {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[2]);
  PrepareBattlerSpriteForRotScale(spriteId, 0);
  const d = gTasks[taskId].data;
  d[1] = 0;
  d[2] = gBattleAnimArgs[0];
  if (gBattleAnimArgs[2] === ANIM_ATTACKER) {
    if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  } else if (GetBattlerSide(S.gBattleAnimTarget) !== B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  if (gBattleAnimArgs[3] !== 1) d[3] = 0;
  else d[3] = gBattleAnimArgs[0] * gBattleAnimArgs[1];
  d[4] = gBattleAnimArgs[1];
  d[5] = spriteId;
  d[6] = gBattleAnimArgs[3];
  d[7] = 1;
  if (d[7]) {
    d[3] = -d[3];
    d[4] = -d[4];
  }
  gTasks[taskId].func = AnimTask_RotateMonSpriteToSide_Step;
}

function AnimTask_RotateMonSpriteToSide_Step(taskId) {
  const d = gTasks[taskId].data;
  d[3] += d[4];
  SetSpriteRotScale(d[5], 0x100, 0x100, d[3]);
  if (d[7]) SetBattlerSpriteYOffsetFromRotation(d[5]);
  if (++d[1] >= d[2]) {
    switch (d[6]) {
      case 1:
        ResetSpriteRotScale(d[5]);
        // fallthrough
      case 0:
      default:
        DestroyAnimVisualTask(taskId);
        break;
      case 2:
        d[1] = 0;
        d[4] *= -1;
        d[6] = 1;
        break;
    }
  }
}

function AnimTask_ShakeTargetBasedOnMovePowerOrDmg(taskId) {
  const d = gTasks[taskId].data;
  if (gBattleAnimArgs[0] === 0) d[15] = idiv(S.gAnimMovePower, 12);
  else d[15] = idiv(S.gAnimMoveDmg, 12);
  if (d[15] < 1) d[15] = 1;
  if (d[15] > 16) d[15] = 16;
  d[14] = idiv(d[15], 2);
  d[13] = d[14] + (d[15] & 1);
  d[12] = 0;
  d[10] = gBattleAnimArgs[3];
  d[11] = gBattleAnimArgs[4];
  d[7] = GetAnimBattlerSpriteId(ANIM_TARGET);
  d[8] = gSprites[d[7]].x2;
  d[9] = gSprites[d[7]].y2;
  d[0] = 0;
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ShakeTargetBasedOnMovePowerOrDmg_Step;
}

function AnimTask_ShakeTargetBasedOnMovePowerOrDmg_Step(taskId) {
  const d = gTasks[taskId].data, sp = gSprites[d[7]];
  if (++d[0] > d[1]) {
    d[0] = 0;
    d[12] = (d[12] + 1) & 1;
    if (d[10]) sp.x2 = d[12] ? d[8] + d[13] : d[8] - d[14];
    if (d[11]) sp.y2 = d[12] ? d[15] : 0;
    if (!--d[2]) {
      sp.x2 = 0;
      sp.y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  }
}

// =====================================================================================================
// battle_anim_mons.c (sprite callbacks / tasks)
// =====================================================================================================

function AnimSpriteOnMonPos(sprite) {
  if (!sprite.data[0]) {
    const v = !gBattleAnimArgs[3] ? TRUE : FALSE;
    if (!gBattleAnimArgs[2]) InitSpritePosToAnimAttacker(sprite, v);
    else InitSpritePosToAnimTarget(sprite, v);
    ++sprite.data[0];
  } else if (sprite.animEnded || sprite.affineAnimEnded) {
    DestroySpriteAndMatrix(sprite);
  }
}

// Linearly translates a sprite to a target position on the other mon's sprite.
// arg 0/1: initial offset, arg 2/3: target offset, arg 4: duration,
// arg 5: lower 8 bits = location on attacking mon, upper 8 bits = location on target mon
function TranslateAnimSpriteToTargetMonLocation(sprite) {
  const respectMonPicOffsets = !(gBattleAnimArgs[5] & 0xFF00) ? TRUE : FALSE;
  const coordType = !(gBattleAnimArgs[5] & 0xFF) ? BATTLER_COORD_Y_PIC_OFFSET : BATTLER_COORD_Y;
  InitSpritePosToAnimAttacker(sprite, respectMonPicOffsets);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, coordType) + gBattleAnimArgs[3];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

function AnimThrowProjectile(sprite) {
  InitSpritePosToAnimAttacker(sprite, 1);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimThrowProjectile_Step;
}

function AnimThrowProjectile_Step(sprite) {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

function AnimTravelDiagonally(sprite) {
  let r4, coordType, battlerId;
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

// Blends a mon's colors toward a color and back, N times.
// arg 0: battler, arg 1: color, arg 2: target coeff, arg 3: delay, arg 4: number of blends
function AnimTask_BlendMonInAndOut(taskId) {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  if (spriteId === 0xFF) { DestroyAnimVisualTask(taskId); return; }
  // C: OBJ_PLTT_ID(paletteNum) + 1 with 15 entries. Battler palettes are virtual (entry 0 = black,
  // 1 = white are read back as a tint), so blend all 16 entries for mons.
  gTasks[taskId].data[0] = OBJ_PLTT_ID(gSprites[spriteId].oam.paletteNum);
  gTasks[taskId].data[13] = gSprites[spriteId].isMon ? 16 : 15;
  if (!gSprites[spriteId].isMon) gTasks[taskId].data[0]++;
  AnimTask_BlendMonInAndOutSetup(gTasks[taskId]);
}

function AnimTask_BlendPalInAndOutByTag(taskId) {
  const palette = IndexOfSpritePaletteTag(gBattleAnimArgs[0]);
  if (palette === 0xFF) { DestroyAnimVisualTask(taskId); return; }
  gTasks[taskId].data[0] = (palette * 0x10) + 0x101;
  gTasks[taskId].data[13] = 15;
  AnimTask_BlendMonInAndOutSetup(gTasks[taskId]);
}

function AnimTask_BlendMonInAndOutSetup(task) {
  task.data[1] = gBattleAnimArgs[1];
  task.data[2] = 0;
  task.data[3] = gBattleAnimArgs[2];
  task.data[4] = 0;
  task.data[5] = gBattleAnimArgs[3];
  task.data[6] = 0;
  task.data[7] = gBattleAnimArgs[4];
  task.func = AnimTask_BlendMonInAndOut_Step;
}

function AnimTask_BlendMonInAndOut_Step(taskId) {
  const d = gTasks[taskId].data;
  const n = d[13] || 15;
  if (++d[4] >= d[5]) {
    d[4] = 0;
    if (!d[6]) {
      ++d[2];
      BlendPalette(d[0] & 0xFFFF, n, d[2], d[1] & 0xFFFF);
      if (d[2] === d[3]) d[6] = 1;
    } else {
      --d[2];
      BlendPalette(d[0] & 0xFFFF, n, d[2], d[1] & 0xFFFF);
      if (!d[2]) {
        if (--d[7]) {
          d[4] = 0;
          d[6] = 0;
        } else {
          DestroyAnimVisualTask(taskId);
          return;
        }
      }
    }
  }
}

// =====================================================================================================
// battle_anim_normal.c
// =====================================================================================================

function AnimConfusionDuck(sprite) {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    sprite.data[1] = -gBattleAnimArgs[3];
    sprite.data[4] = 1;
  } else {
    sprite.data[1] = gBattleAnimArgs[3];
    sprite.data[4] = 0;
    StartSpriteAnim(sprite, 1);
  }
  sprite.data[3] = gBattleAnimArgs[4];
  sprite.callback = AnimConfusionDuck_Step;
  sprite.callback(sprite);
}

function AnimConfusionDuck_Step(sprite) {
  sprite.x2 = Cos(sprite.data[0], 30);
  sprite.y2 = Sin(sprite.data[0], 10);
  if ((sprite.data[0] & 0xFFFF) < 128) sprite.oam.priority = 1;
  else sprite.oam.priority = 3;
  sprite.data[0] = (sprite.data[0] + sprite.data[1]) & 0xFF;
  if (++sprite.data[2] === sprite.data[3]) DestroyAnimSprite(sprite);
}

// Simple color blend. arg 0: palette selector, arg 1: delay, arg 2: start, arg 3: end, arg 4: color
function AnimSimplePaletteBlend(sprite) {
  const selectedPalettes = UnpackSelectedBattlePalettes(gBattleAnimArgs[0]);
  BeginNormalPaletteFade(selectedPalettes, gBattleAnimArgs[1], gBattleAnimArgs[2], gBattleAnimArgs[3], gBattleAnimArgs[4] & 0xFFFF);
  sprite.invisible = TRUE;
  sprite.callback = AnimSimplePaletteBlend_Step;
}

function AnimSimplePaletteBlend_Step(sprite) {
  if (!gPaletteFade.active) DestroyAnimSprite(sprite);
}

function AnimComplexPaletteBlend(sprite) {
  sprite.data[0] = gBattleAnimArgs[1];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[2] = gBattleAnimArgs[2];
  sprite.data[3] = gBattleAnimArgs[3];
  sprite.data[4] = gBattleAnimArgs[4];
  sprite.data[5] = gBattleAnimArgs[5];
  sprite.data[6] = gBattleAnimArgs[6];
  sprite.data[7] = gBattleAnimArgs[0];
  const selectedPalettes = UnpackSelectedBattlePalettes(sprite.data[7]);
  BlendPalettes(selectedPalettes, gBattleAnimArgs[4], gBattleAnimArgs[3] & 0xFFFF);
  sprite.invisible = TRUE;
  sprite.callback = AnimComplexPaletteBlend_Step1;
}

function AnimComplexPaletteBlend_Step1(sprite) {
  if (sprite.data[0] > 0) { --sprite.data[0]; return; }
  if (gPaletteFade.active) return;
  if (sprite.data[2] === 0) { sprite.callback = AnimComplexPaletteBlend_Step2; return; }
  const selectedPalettes = UnpackSelectedBattlePalettes(sprite.data[7]);
  if (sprite.data[1] & 0x100) BlendPalettes(selectedPalettes, sprite.data[4], sprite.data[3] & 0xFFFF);
  else BlendPalettes(selectedPalettes, sprite.data[6], sprite.data[5] & 0xFFFF);
  sprite.data[1] ^= 0x100;
  sprite.data[0] = sprite.data[1] & 0xFF;
  --sprite.data[2];
}

function AnimComplexPaletteBlend_Step2(sprite) {
  if (!gPaletteFade.active) {
    const selectedPalettes = UnpackSelectedBattlePalettes(sprite.data[7]);
    BlendPalettes(selectedPalettes, 0, 0);
    DestroyAnimSprite(sprite);
  }
}

// Task data for AnimTask_BlendColorCycle / Exclude / ByTag:
// data[0] tPalSelector/tPalTag, [1] tDelay, [2] tNumBlends, [3] tInitialBlendY, [4] tTargetBlendY,
// [5] tBlendColor, [8] tRestoreBlend, [9] tPalSelectorHi, [10] tPalSelectorLo

// Blends mon/screen to designated color or back alternately tNumBlends times
function AnimTask_BlendColorCycle(taskId) {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[5];
  d[8] = FALSE;
  BlendColorCycle(taskId, 0, u8(d[4]));
  gTasks[taskId].func = AnimTask_BlendColorCycleLoop;
}

function BlendColorCycle(taskId, startBlendAmount, targetBlendAmount) {
  const d = gTasks[taskId].data;
  const selectedPalettes = UnpackSelectedBattlePalettes(d[0]);
  BeginNormalPaletteFade(selectedPalettes, d[1], startBlendAmount, targetBlendAmount, d[5] & 0xFFFF);
  d[2]--;
  d[8] ^= 1;
}

// shared loop body for the three BlendColorCycle variants
function blendColorCycleLoop(taskId, cycle) {
  const d = gTasks[taskId].data;
  if (!gPaletteFade.active) {
    if (d[2] > 0) {
      let startBlendAmount, targetBlendAmount;
      if (!d[8]) { startBlendAmount = u8(d[3]); targetBlendAmount = u8(d[4]); }
      else { startBlendAmount = u8(d[4]); targetBlendAmount = u8(d[3]); }
      if (d[2] === 1) targetBlendAmount = 0;
      cycle(taskId, startBlendAmount, targetBlendAmount);
    } else DestroyAnimVisualTask(taskId);
  }
}
function AnimTask_BlendColorCycleLoop(taskId) { blendColorCycleLoop(taskId, BlendColorCycle); }

// Same, but excludes Attacker and Target
function AnimTask_BlendColorCycleExclude(taskId) {
  const d = gTasks[taskId].data;
  let selectedPalettes = 0;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[5];
  d[8] = 0;
  for (let battler = 0; battler < S.gBattlersCount; battler++) {
    if (battler !== S.gBattleAnimAttacker && battler !== S.gBattleAnimTarget) selectedPalettes |= 1 << (battler + 16);
  }
  if (gBattleAnimArgs[0] === 1) selectedPalettes |= 0xE;
  d[9] = selectedPalettes >>> 16;
  d[10] = selectedPalettes & 0xFF;
  BlendColorCycleExclude(taskId, 0, u8(d[4]));
  gTasks[taskId].func = AnimTask_BlendColorCycleExcludeLoop;
}

function BlendColorCycleExclude(taskId, startBlendAmount, targetBlendAmount) {
  const d = gTasks[taskId].data;
  const selectedPalettes = (((d[9] & 0xFFFF) << 16) | (d[10] & 0xFFFF)) >>> 0;
  BeginNormalPaletteFade(selectedPalettes, d[1], startBlendAmount, targetBlendAmount, d[5] & 0xFFFF);
  d[2]--;
  d[8] ^= 1;
}
function AnimTask_BlendColorCycleExcludeLoop(taskId) { blendColorCycleLoop(taskId, BlendColorCycleExclude); }

// Same, but selects palette by ANIM_TAG_*
function AnimTask_BlendColorCycleByTag(taskId) {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[5];
  d[8] = FALSE;
  BlendColorCycleByTag(taskId, 0, u8(d[4]));
  gTasks[taskId].func = AnimTask_BlendColorCycleByTagLoop;
}

function BlendColorCycleByTag(taskId, startBlendAmount, targetBlendAmount) {
  const d = gTasks[taskId].data;
  const paletteIndex = IndexOfSpritePaletteTag(d[0] & 0xFFFF);
  BeginNormalPaletteFade((1 << (paletteIndex + 16)) >>> 0, d[1], startBlendAmount, targetBlendAmount, d[5] & 0xFFFF);
  d[2]--;
  d[8] ^= 1;
}
function AnimTask_BlendColorCycleByTagLoop(taskId) { blendColorCycleLoop(taskId, BlendColorCycleByTag); }

// Flashes the specified anim tag with given color. Used e.g. to flash the particles red in Hyper Beam
function AnimTask_FlashAnimTagWithColor(taskId) {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[1];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[5];
  d[6] = gBattleAnimArgs[6];
  d[7] = gBattleAnimArgs[0];
  const paletteIndex = IndexOfSpritePaletteTag(gBattleAnimArgs[0] & 0xFFFF);
  BeginNormalPaletteFade((1 << (paletteIndex + 16)) >>> 0, 0, gBattleAnimArgs[4], gBattleAnimArgs[4], gBattleAnimArgs[3] & 0xFFFF);
  gTasks[taskId].func = AnimTask_FlashAnimTagWithColor_Step1;
}

function AnimTask_FlashAnimTagWithColor_Step1(taskId) {
  const d = gTasks[taskId].data;
  if (d[0] > 0) { --d[0]; return; }
  if (gPaletteFade.active) return;
  if (d[2] === 0) { gTasks[taskId].func = AnimTask_FlashAnimTagWithColor_Step2; return; }
  const selectedPalettes = (1 << (IndexOfSpritePaletteTag(d[7] & 0xFFFF) + 16)) >>> 0;
  if (d[1] & 0x100) BeginNormalPaletteFade(selectedPalettes, 0, d[4], d[4], d[3] & 0xFFFF);
  else BeginNormalPaletteFade(selectedPalettes, 0, d[6], d[6], d[5] & 0xFFFF);
  d[1] ^= 0x100;
  d[0] = d[1] & 0xFF;
  --d[2];
}

function AnimTask_FlashAnimTagWithColor_Step2(taskId) {
  const d = gTasks[taskId].data;
  if (!gPaletteFade.active) {
    const selectedPalettes = (1 << (IndexOfSpritePaletteTag(d[7] & 0xFFFF) + 16)) >>> 0;
    BeginNormalPaletteFade(selectedPalettes, 0, 0, 0, RGB(0, 0, 0));
    DestroyAnimVisualTask(taskId);
  }
}

// The C code stores a pointer to a u16 global in data[6..7]; here the global's name on S is kept in
// sprite.ptrs.shakeVar.
function AnimShakeMonOrBattleTerrain(sprite) {
  sprite.invisible = TRUE;
  sprite.data[0] = -gBattleAnimArgs[0];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.data[3] = gBattleAnimArgs[2];
  switch (gBattleAnimArgs[3]) {
    case 0: sprite.ptrs.shakeVar = 'gBattle_BG3_X'; break;
    case 1: sprite.ptrs.shakeVar = 'gBattle_BG3_Y'; break;
    case 2: sprite.ptrs.shakeVar = 'gSpriteCoordOffsetX'; break;
    default: sprite.ptrs.shakeVar = 'gSpriteCoordOffsetY'; break;
  }
  sprite.data[4] = S[sprite.ptrs.shakeVar];
  sprite.data[5] = gBattleAnimArgs[3];
  const var0 = (sprite.data[5] - 2) & 0xFFFF;
  if (var0 < 2) AnimShakeMonOrBattleTerrain_UpdateCoordOffsetEnabled();
  sprite.callback = AnimShakeMonOrBattleTerrain_Step;
}

function AnimShakeMonOrBattleTerrain_Step(sprite) {
  const key = sprite.ptrs.shakeVar;
  if (sprite.data[3] > 0) {
    --sprite.data[3];
    if (sprite.data[1] > 0) --sprite.data[1];
    else {
      sprite.data[1] = sprite.data[2];
      S[key] = s16(S[key] + sprite.data[0]);
      sprite.data[0] = -sprite.data[0];
    }
  } else {
    S[key] = sprite.data[4];
    const var0 = (sprite.data[5] - 2) & 0xFFFF;
    if (var0 < 2) for (let i = 0; i < S.gBattlersCount; ++i) gSprites[gBattlerSpriteIds[i]].coordOffsetEnabled = FALSE;
    DestroyAnimSprite(sprite);
  }
}

function AnimShakeMonOrBattleTerrain_UpdateCoordOffsetEnabled() {
  const atk = gSprites[gBattlerSpriteIds[S.gBattleAnimAttacker]], tgt = gSprites[gBattlerSpriteIds[S.gBattleAnimTarget]];
  atk.coordOffsetEnabled = FALSE;
  tgt.coordOffsetEnabled = FALSE;
  if (gBattleAnimArgs[4] === 2) {
    atk.coordOffsetEnabled = TRUE;
    tgt.coordOffsetEnabled = TRUE;
  } else if (gBattleAnimArgs[4] === 0) atk.coordOffsetEnabled = TRUE;
  else tgt.coordOffsetEnabled = TRUE;
}

// Shakes battle terrain. arg0: x offset, arg1: y offset, arg2: number of shakes, arg3: time between shakes
function AnimTask_ShakeBattleTerrain(taskId) {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[8] = gBattleAnimArgs[3];
  S.gBattle_BG3_X = gBattleAnimArgs[0];
  S.gBattle_BG3_Y = gBattleAnimArgs[1];
  gTasks[taskId].func = AnimTask_ShakeBattleTerrain_Step;
  gTasks[taskId].func(taskId);
}

function AnimTask_ShakeBattleTerrain_Step(taskId) {
  const d = gTasks[taskId].data;
  if (d[3] === 0) {
    S.gBattle_BG3_X = S.gBattle_BG3_X === d[0] ? -d[0] : d[0];
    S.gBattle_BG3_Y = S.gBattle_BG3_Y === -d[1] ? 0 : -d[1];
    d[3] = d[8];
    if (--d[2] === 0) {
      S.gBattle_BG3_X = 0;
      S.gBattle_BG3_Y = 0;
      DestroyAnimVisualTask(taskId);
    }
  } else d[3]--;
}

function AnimHitSplatBasic(sprite) {
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[3]);
  if (gBattleAnimArgs[2] === 0) InitSpritePosToAnimAttacker(sprite, TRUE);
  else InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// Same as basic hit splat but takes a length of time to persist for (arg4)
function AnimHitSplatPersistent(sprite) {
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[3]);
  if (gBattleAnimArgs[2] === 0) InitSpritePosToAnimAttacker(sprite, TRUE);
  else InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSpriteAfterTimer);
}

// Paired hit splats whose position is inverted when used by the opponent (Twineedle, Spike Cannon)
function AnimHitSplatHandleInvert(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER && !IsContest()) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  AnimHitSplatBasic(sprite);
}

function AnimHitSplatRandom(sprite) {
  if (gBattleAnimArgs[1] === -1) gBattleAnimArgs[1] = Random() & 3;
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[1]);
  if (gBattleAnimArgs[0] === ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, FALSE);
  else InitSpritePosToAnimTarget(sprite, FALSE);
  sprite.x2 += (Random() % 48) - 24;
  sprite.y2 += (Random() % 24) - 12;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
}

function AnimHitSplatOnMonEdge(sprite) {
  sprite.data[0] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  const mon = gSprites[sprite.data[0]];
  sprite.x = mon.x + mon.x2;
  sprite.y = mon.y + mon.y2;
  sprite.x2 = gBattleAnimArgs[1];
  sprite.y2 = gBattleAnimArgs[2];
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[3]);
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
}

function AnimCrossImpact(sprite) {
  if (gBattleAnimArgs[2] === ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, TRUE);
  else InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.data[0] = gBattleAnimArgs[3];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = WaitAnimForDuration;
}

function AnimFlashingHitSplat(sprite) {
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[3]);
  if (gBattleAnimArgs[2] === ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, TRUE);
  else InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.callback = AnimFlashingHitSplat_Step;
}

function AnimFlashingHitSplat_Step(sprite) {
  sprite.invisible = !sprite.invisible;
  if (sprite.data[0]++ > 12) DestroyAnimSprite(sprite);
}

// =====================================================================================================
// battle_anim_utility_funcs.c
// =====================================================================================================

// gBattleAnimArgs[0] bits 0-6 as UnpackSelectedBattlePalettes, bits 7-10: player left/right, enemy left/right
function AnimTask_BlendBattleAnimPal(taskId) {
  let selectedPalettes = UnpackSelectedBattlePalettes(gBattleAnimArgs[0]);
  selectedPalettes |= GetBattleMonSpritePalettesMask(
    (gBattleAnimArgs[0] >> 7) & 1,
    (gBattleAnimArgs[0] >> 8) & 1,
    (gBattleAnimArgs[0] >> 9) & 1,
    (gBattleAnimArgs[0] >> 10) & 1);
  StartBlendAnimSpriteColor(taskId, selectedPalettes >>> 0);
}

function AnimTask_BlendParticle(taskId) {
  const paletteIndex = IndexOfSpritePaletteTag(gBattleAnimArgs[0] & 0xFFFF);
  StartBlendAnimSpriteColor(taskId, (1 << (paletteIndex + 16)) >>> 0);
}

function StartBlendAnimSpriteColor(taskId, selectedPalettes) {
  const d = gTasks[taskId].data;
  d[0] = selectedPalettes & 0xFFFF;
  d[1] = selectedPalettes >>> 16;
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[2];
  d[4] = gBattleAnimArgs[3];
  d[5] = gBattleAnimArgs[4];
  d[10] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_BlendSpriteColor_Step2;
  gTasks[taskId].func(taskId);
}

function AnimTask_BlendSpriteColor_Step2(taskId) {
  const d = gTasks[taskId].data;
  let singlePaletteMask = 0;
  if (d[9] === d[2]) {
    d[9] = 0;
    // (C: data[0] | data[1] << 16 with s16 data[0] sign-extending; a u16 read matches the intent)
    let selectedPalettes = ((d[0] & 0xFFFF) | ((d[1] & 0xFFFF) << 16)) >>> 0;
    while (selectedPalettes) {
      if (selectedPalettes & 1) BlendPalette(singlePaletteMask, 16, d[10], d[5] & 0xFFFF);
      singlePaletteMask += 0x10;
      selectedPalettes >>>= 1;
    }
    if (d[10] < d[4]) ++d[10];
    else if (d[10] > d[4]) --d[10];
    else DestroyAnimVisualTask(taskId);
  } else ++d[9];
}

// Used to leave blended traces of a mon, usually to imply speed as in Agility or Aerial Ace
function AnimTask_TraceMonBlended(taskId) {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = 0;
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[2];
  d[4] = gBattleAnimArgs[3];
  d[5] = 0;
  gTasks[taskId].func = AnimTask_TraceMonBlended_Step;
}

function AnimTask_TraceMonBlended_Step(taskId) {
  const d = gTasks[taskId].data;
  if (d[4]) {
    if (d[1]) --d[1];
    else {
      d[6] = CloneBattlerSpriteWithBlend(d[0]);
      if (d[6] >= 0) {
        const c = gSprites[d[6]];
        c.oam.priority = d[0] ? 1 : 2;
        c.data[0] = d[3];
        c.data[1] = taskId;
        c.data[2] = 5;
        c.callback = AnimMonTrace;
        ++d[5];
      }
      --d[4];
      d[1] = d[2];
    }
  } else if (d[5] === 0) DestroyAnimVisualTask(taskId);
}

function AnimMonTrace(sprite) {
  if (sprite.data[0]) --sprite.data[0];
  else {
    --gTasks[sprite.data[1]].data[sprite.data[2]];
    DestroySpriteWithActiveSheet(sprite);
  }
}

// ToggleBg3Mode (the battle terrain BG switching to a scrolling map) is not emulated.
function AnimTask_StartSlidingBg(taskId) {
  const newTaskId = CreateTask(AnimTask_UpdateSlidingBg, 5);
  if (gBattleAnimArgs[2] && GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) {
    gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  }
  const d = gTasks[newTaskId].data;
  d[1] = gBattleAnimArgs[0];
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[3];
  ++d[0];
  DestroyAnimVisualTask(taskId);
}

function AnimTask_UpdateSlidingBg(taskId) {
  const d = gTasks[taskId].data;
  d[10] += d[1];
  d[11] += d[2];
  S.gBattle_BG3_X = s16(S.gBattle_BG3_X + (d[10] >> 8));
  S.gBattle_BG3_Y = s16(S.gBattle_BG3_Y + (d[11] >> 8));
  d[10] &= 0xFF;
  d[11] &= 0xFF;
  if (gBattleAnimArgs[7] === d[3]) {
    S.gBattle_BG3_X = 0;
    S.gBattle_BG3_Y = 0;
    DestroyTask(taskId);
  }
}

function AnimTask_IsContest(taskId) {
  gBattleAnimArgs[ARG_RET_ID] = IsContest() ? TRUE : FALSE;
  DestroyAnimVisualTask(taskId);
}

function AnimTask_GetAttackerSide(taskId) {
  gBattleAnimArgs[7] = GetBattlerSide(S.gBattleAnimAttacker);
  DestroyAnimVisualTask(taskId);
}

function AnimTask_GetTargetSide(taskId) {
  gBattleAnimArgs[7] = GetBattlerSide(S.gBattleAnimTarget);
  DestroyAnimVisualTask(taskId);
}

// battle_anim_effects_3.c
function AnimTask_IsTargetPlayerSide(taskId) {
  gBattleAnimArgs[ARG_RET_ID] = GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_OPPONENT ? FALSE : TRUE;
  DestroyAnimVisualTask(taskId);
}

// =====================================================================================================
// battle_anim_sound_tasks.c
// =====================================================================================================

function SoundTask_LoopSEAdjustPanning(taskId) {
  const songId = gBattleAnimArgs[0] & 0xFFFF;
  let targetPan = gBattleAnimArgs[2];
  let panIncrement = gBattleAnimArgs[3];
  const r10 = u8(gBattleAnimArgs[4]);
  const r7 = u8(gBattleAnimArgs[5]);
  const r9 = u8(gBattleAnimArgs[6]);
  const sourcePan = BattleAnimAdjustPanning(gBattleAnimArgs[1]);
  targetPan = BattleAnimAdjustPanning(targetPan);
  panIncrement = CalculatePanIncrement(sourcePan, targetPan, panIncrement);
  const d = gTasks[taskId].data;
  d[0] = songId;
  d[1] = sourcePan;
  d[2] = targetPan;
  d[3] = panIncrement;
  d[4] = r10;
  d[5] = r7;
  d[6] = r9;
  d[10] = 0;
  d[11] = sourcePan;
  d[12] = r9;
  gTasks[taskId].func = SoundTask_LoopSEAdjustPanning_Step;
  gTasks[taskId].func(taskId);
}

function SoundTask_LoopSEAdjustPanning_Step(taskId) {
  const d = gTasks[taskId].data;
  if (d[12]++ === d[6]) {
    d[12] = 0;
    PlaySE12WithPanning(d[0] & 0xFFFF, d[11]);
    if (--d[4] === 0) { DestroyAnimSoundTask(taskId); return; }
  }
  if (d[10]++ === d[5]) {
    d[10] = 0;
    const oldPan = d[11];
    d[11] = d[3] + oldPan;
    d[11] = KeepPanInRange(d[11], oldPan);
  }
}

function animArgBattler(arg) {
  if (arg === ANIM_ATTACKER) return S.gBattleAnimAttacker;
  if (arg === ANIM_TARGET) return S.gBattleAnimTarget;
  if (arg === ANIM_ATK_PARTNER) return BATTLE_PARTNER(S.gBattleAnimAttacker);
  return BATTLE_PARTNER(S.gBattleAnimTarget);
}

// (created with createvisualtask in the scripts, so they end with DestroyAnimVisualTask like the C code)
function SoundTask_PlayCryHighPitch(taskId) {
  const pan = BattleAnimAdjustPanning(SOUND_PAN_ATTACKER);
  const battlerId = animArgBattler(gBattleAnimArgs[0]);
  if ((gBattleAnimArgs[0] === ANIM_TARGET || gBattleAnimArgs[0] === ANIM_DEF_PARTNER) && !IsBattlerSpriteVisible(battlerId)) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const species = GetBattlerSpriteSpecies(battlerId);
  if (species !== SPECIES_NONE) PlayCry_ByMode(species, pan, CRY_MODE_HIGH_PITCH);
  DestroyAnimVisualTask(taskId);
}

function SoundTask_PlayDoubleCry(taskId) {
  const pan = BattleAnimAdjustPanning(SOUND_PAN_ATTACKER);
  const battlerId = animArgBattler(gBattleAnimArgs[0]);
  if ((gBattleAnimArgs[0] === ANIM_TARGET || gBattleAnimArgs[0] === ANIM_DEF_PARTNER) && !IsBattlerSpriteVisible(battlerId)) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const species = GetBattlerSpriteSpecies(battlerId);
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[1];
  d[1] = species;
  d[2] = pan;
  if (species !== SPECIES_NONE) {
    if (gBattleAnimArgs[1] === DOUBLE_CRY_GROWL) PlayCry_ByMode(species, pan, CRY_MODE_GROWL_1);
    else PlayCry_ByMode(species, pan, CRY_MODE_ROAR_1); // DOUBLE_CRY_ROAR
    gTasks[taskId].func = SoundTask_PlayDoubleCry_Step;
  } else DestroyAnimVisualTask(taskId);
}

function SoundTask_PlayDoubleCry_Step(taskId) {
  const d = gTasks[taskId].data;
  const species = d[1] & 0xFFFF, pan = d[2];
  if (d[9] < 2) ++d[9];
  else if (d[0] === DOUBLE_CRY_GROWL) {
    if (!IsCryPlaying()) {
      PlayCry_ByMode(species, pan, CRY_MODE_GROWL_2);
      DestroyAnimVisualTask(taskId);
    }
  } else if (!IsCryPlaying()) {
    PlayCry_ByMode(species, pan, CRY_MODE_ROAR_2);
    DestroyAnimVisualTask(taskId);
  }
}

function SoundTask_WaitForCry(taskId) {
  if (gTasks[taskId].data[9] < 2) ++gTasks[taskId].data[9];
  else if (!IsCryPlaying()) DestroyAnimVisualTask(taskId);
}

// =====================================================================================================
// Move-specific callbacks of the basic physical moves
// =====================================================================================================

// battle_anim_fight.c
// arg 0/1: initial offset, arg 2: duration, arg 3: 0 = attacker / else target, arg 4: anim num
function AnimBasicFistOrFoot(sprite) {
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  if (gBattleAnimArgs[3] === 0) InitSpritePosToAnimAttacker(sprite, 1);
  else InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// Spinning, shrinking kick or punch (MEGA_PUNCH / MEGA_KICK). arg 2: anim num, arg 3: spin duration
function AnimSpinningKickOrPunch(sprite) {
  InitSpritePosToAnimTarget(sprite, TRUE);
  StartSpriteAnim(sprite, gBattleAnimArgs[2]);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, AnimSpinningKickOrPunchFinish);
}

function AnimSpinningKickOrPunchFinish(sprite) {
  StartSpriteAffineAnim(sprite, 0);
  sprite.affineAnimPaused = true;
  sprite.data[0] = 20;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// battle_anim_effects_1.c
function AnimWhipHit(sprite) {
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER) StartSpriteAnim(sprite, 1);
  sprite.callback = AnimWhipHit_WaitEnd;
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
}

function AnimWhipHit_WaitEnd(sprite) {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

// Diagonal slash across the target (CUT, AERIAL_ACE). arg 0/1: offset, arg 2: 0 = right-to-left, 1 = left-to-right
function AnimCuttingSlice(sprite) {
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y);
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) sprite.y += 8;
  sprite.callback = AnimSlice_Step;
  if (gBattleAnimArgs[2] === 0) sprite.x += gBattleAnimArgs[0];
  else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.hFlip = true;
    sprite.flipH = true;
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

// HEADBUTT / HORN_ATTACK: the attacker bows. arg 0: step (0..3)
function AnimBowMon(sprite) {
  sprite.invisible = TRUE;
  sprite.data[0] = 0;
  switch (gBattleAnimArgs[0]) {
    case 0: sprite.callback = AnimBowMon_Step1; break;
    case 1: sprite.callback = AnimBowMon_Step2; break;
    case 2: sprite.callback = AnimBowMon_Step3; break;
    default: sprite.callback = AnimBowMon_Step4; break;
  }
}

function AnimBowMon_Step1(sprite) {
  sprite.data[0] = 6;
  sprite.data[1] = GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER ? 2 : -2;
  sprite.data[2] = 0;
  sprite.data[3] = gBattlerSpriteIds[S.gBattleAnimAttacker];
  StoreSpriteCallbackInData6(sprite, AnimBowMon_Step1_Callback);
  sprite.callback = TranslateSpriteLinearById;
}

function AnimBowMon_Step1_Callback(sprite) {
  if (sprite.data[0] === 0) {
    sprite.data[3] = gBattlerSpriteIds[S.gBattleAnimAttacker];
    PrepareBattlerSpriteForRotScale(sprite.data[3], ST_OAM_OBJ_NORMAL);
    sprite.data[4] = (sprite.data[6] = GetBattlerSide(S.gBattleAnimAttacker)) ? 0x300 : -0x300;
    sprite.data[5] = 0;
  }
  sprite.data[5] += sprite.data[4];
  SetSpriteRotScale(sprite.data[3], 0x100, 0x100, sprite.data[5] & 0xFFFF);
  SetBattlerSpriteYOffsetFromRotation(sprite.data[3]);
  if (++sprite.data[0] > 3) {
    sprite.data[0] = 0;
    sprite.callback = AnimBowMon_Step4;
  }
}

function AnimBowMon_Step2(sprite) {
  sprite.data[0] = 4;
  sprite.data[1] = GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER ? -3 : 3;
  sprite.data[2] = 0;
  sprite.data[3] = gBattlerSpriteIds[S.gBattleAnimAttacker];
  StoreSpriteCallbackInData6(sprite, AnimBowMon_Step4);
  sprite.callback = TranslateSpriteLinearById;
}

function AnimBowMon_Step3(sprite) {
  if (++sprite.data[0] > 8) {
    sprite.data[0] = 0;
    sprite.callback = AnimBowMon_Step3_Callback;
  }
}

function AnimBowMon_Step3_Callback(sprite) {
  if (sprite.data[0] === 0) {
    sprite.data[3] = gBattlerSpriteIds[S.gBattleAnimAttacker];
    sprite.data[6] = GetBattlerSide(S.gBattleAnimAttacker);
    if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) { sprite.data[4] = 0xFC00; sprite.data[5] = 0xC00; }
    else { sprite.data[4] = 0x400; sprite.data[5] = 0xF400; }
  }
  sprite.data[5] += sprite.data[4];
  SetSpriteRotScale(sprite.data[3], 0x100, 0x100, sprite.data[5] & 0xFFFF);
  SetBattlerSpriteYOffsetFromRotation(sprite.data[3]);
  if (++sprite.data[0] > 2) {
    ResetSpriteRotScale(sprite.data[3]);
    sprite.callback = AnimBowMon_Step4;
  }
}

function AnimBowMon_Step4(sprite) {
  DestroyAnimSprite(sprite);
}

// SLASH. arg 0: 0 = attacker / else target, arg 1/2: offset
function AnimSlashSlice(sprite) {
  const b = gBattleAnimArgs[0] === 0 ? S.gBattleAnimAttacker : S.gBattleAnimTarget;
  sprite.x = GetBattlerSpriteCoord(b, BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(b, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  StoreSpriteCallbackInData6(sprite, AnimFalseSwipeSlice_Step3);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
}

function AnimFalseSwipeSlice_Step3(sprite) {
  if (++sprite.data[0] > 1) {
    sprite.data[0] = 0;
    sprite.invisible = !sprite.invisible;
    if (++sprite.data[1] > 8) DestroyAnimSprite(sprite);
  }
}

// HORN_ATTACK / FURY_ATTACK horn. arg 0/1: offset from target, arg 2: duration (2..127)
function AnimHornHit(sprite) {
  if (gBattleAnimArgs[2] < 2) gBattleAnimArgs[2] = 2;
  if (gBattleAnimArgs[2] > 0x7F) gBattleAnimArgs[2] = 0x7F;
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
  sprite.data[6] = sprite.x;
  sprite.data[7] = sprite.y;
  if (GetBattlerSide(S.gBattleAnimAttacker) === B_SIDE_PLAYER) {
    sprite.x -= 40;
    sprite.y += 20;
    sprite.data[2] = sprite.x << 7;
    sprite.data[3] = idiv(0x1400, sprite.data[1]);
    sprite.data[4] = sprite.y << 7;
    sprite.data[5] = idiv(-0xA00, sprite.data[1]);
  } else {
    sprite.x += 40;
    sprite.y -= 20;
    sprite.data[2] = sprite.x << 7;
    sprite.data[3] = idiv(-0x1400, sprite.data[1]);
    sprite.data[4] = sprite.y << 7;
    sprite.data[5] = idiv(0xA00, sprite.data[1]);
    // C: oam.matrixNum = ST_OAM_HFLIP | ST_OAM_VFLIP (flip bits of a non-affine sprite)
    sprite.hFlip = true; sprite.vFlip = true; sprite.flipH = true; sprite.flipV = true;
  }
  sprite.callback = AnimHornHit_Step;
}

function AnimHornHit_Step(sprite) {
  sprite.data[2] += sprite.data[3];
  sprite.data[4] += sprite.data[5];
  sprite.x = sprite.data[2] >> 7;
  sprite.y = sprite.data[4] >> 7;
  if (--sprite.data[1] === 1) {
    sprite.x = sprite.data[6];
    sprite.y = sprite.data[7];
  }
  if (sprite.data[1] === 0) DestroyAnimSprite(sprite);
}

register({
  // battle_anim_mon_movement.c
  AnimTask_ShakeMon, AnimTask_ShakeMon2, AnimTask_ShakeMonInPlace, AnimTask_ShakeAndSinkMon,
  AnimTask_TranslateMonElliptical, AnimTask_TranslateMonEllipticalRespectSide,
  DoHorizontalLunge, DoVerticalDip, SlideMonToOriginalPos, SlideMonToOffset, SlideMonToOffsetAndBack,
  AnimTask_WindUpLunge, AnimTask_SlideOffScreen, AnimTask_SwayMon, AnimTask_ScaleMonAndRestore,
  AnimTask_RotateMonSpriteToSide, AnimTask_RotateMonToSideAndRestore, AnimTask_ShakeTargetBasedOnMovePowerOrDmg,
  // battle_anim_mons.c
  AnimSpriteOnMonPos, TranslateAnimSpriteToTargetMonLocation, AnimThrowProjectile, AnimTravelDiagonally,
  AnimTask_BlendMonInAndOut, AnimTask_BlendPalInAndOutByTag,
  // battle_anim_normal.c
  AnimConfusionDuck, AnimSimplePaletteBlend, AnimComplexPaletteBlend,
  AnimTask_BlendColorCycle, AnimTask_BlendColorCycleExclude, AnimTask_BlendColorCycleByTag, AnimTask_FlashAnimTagWithColor,
  AnimShakeMonOrBattleTerrain, AnimTask_ShakeBattleTerrain,
  AnimHitSplatBasic, AnimHitSplatPersistent, AnimHitSplatHandleInvert, AnimHitSplatRandom, AnimHitSplatOnMonEdge,
  AnimCrossImpact, AnimFlashingHitSplat,
  // battle_anim_utility_funcs.c / effects_3
  AnimTask_BlendBattleAnimPal, AnimTask_BlendParticle, AnimTask_TraceMonBlended, AnimTask_StartSlidingBg,
  AnimTask_IsContest, AnimTask_GetAttackerSide, AnimTask_GetTargetSide, AnimTask_IsTargetPlayerSide,
  // battle_anim_sound_tasks.c
  SoundTask_LoopSEAdjustPanning, SoundTask_PlayCryHighPitch, SoundTask_PlayDoubleCry, SoundTask_WaitForCry,
  // move-specific (battle_anim_fight.c, battle_anim_effects_1.c)
  AnimBasicFistOrFoot, AnimSpinningKickOrPunch, AnimWhipHit, AnimCuttingSlice, AnimBowMon, AnimSlashSlice, AnimHornHit,
});
