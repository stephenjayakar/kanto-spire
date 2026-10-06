// Callback batch C: fighting-move hands/feet, Brick Break wall, Red X, Teleport, punch traces, misc tasks.
// Ported from pokefirered src/battle_anim_fight.c, battle_anim_psychic.c, battle_anim_utility_funcs.c,
// battle_anim_mons.c, battle_anim_dark.c, battle_anim_sound_tasks.c, battle_anim_rock.c (AnimRockFragment).
import {
  S, CB, gSprites, gTasks, gBattleAnimArgs, gBattlerSpriteIds, gBattlerPositions, gPlttBufferUnfaded, gPlttBufferFaded,
  ANIM_ATTACKER, ANIM_TARGET, ANIM_ATK_PARTNER, ANIM_DEF_PARTNER, B_SIDE_PLAYER,
  B_POSITION_PLAYER_LEFT, B_POSITION_PLAYER_RIGHT, B_POSITION_OPPONENT_LEFT, B_POSITION_OPPONENT_RIGHT,
  BATTLER_COORD_X, BATTLER_COORD_Y, BATTLER_COORD_X_2, BATTLER_COORD_Y_PIC_OFFSET,
  BATTLER_COORD_ATTR_WIDTH, BATTLER_COORD_ATTR_HEIGHT, MAX_SPRITES, SPRITE_NONE, TRUE, FALSE,
  Sin, Random, idiv, imod, s8, u8, u16,
  CreateSprite, DestroySprite, DestroyTask, StartSpriteAnim, StartSpriteAffineAnim, AnimateSprite, BlendPalette,
  FreeOamMatrix, SpriteCallbackDummy, AllocSpritePalette, FreeSpritePaletteByTag,
  GetBattlerSide, GetBattlerPosition, GetBattlerAtPosition, GetBattlerSpriteCoord, GetBattlerSpriteCoordAttr,
  GetAnimBattlerSpriteId, GetBattlerSpriteSubpriority, IsBattlerSpriteVisible, BATTLE_PARTNER,
  BattleAnimAdjustPanning, CalculatePanIncrement, KeepPanInRange, T, affineAnimByName, register,
} from '../gba.js';
import {
  DestroyAnimSprite, DestroyAnimVisualTask, InitSpritePosToAnimAttacker, InitSpritePosToAnimTarget,
  InitAnimLinearTranslation, AnimTranslateLinear, StartAnimLinearTranslation, StoreSpriteCallbackInData6,
  WaitAnimForDuration, RunStoredCallbackWhenAnimEnds, PrepareAffineAnimInTaskData, RunAffineAnimFromTaskData,
  ResetSpriteRotScale, CloneBattlerSpriteWithBlend, DestroySpriteWithActiveSheet, SetGreyscaleOrOriginalPalette,
  InitSpriteDataForLinearTranslation, TranslateSpriteLinearFixedPoint, DestroySpriteAndMatrix,
} from '../helpers.js';

const DISPLAY_WIDTH = 240;
const BIT_SIDE = 1;

// ---- battle_anim_fight.c ------------------------------------------------------------------------------
// AnimSlideHandOrFootToTarget is ported (and registered) in effects.js; look it up lazily from the registry.
function AnimJumpKick(sprite) {
  // IsContest() branch dropped
  CB.AnimSlideHandOrFootToTarget(sprite);
}

function AnimFistOrFootRandomPos(sprite) {
  let battler;
  if (gBattleAnimArgs[0] === 0) battler = S.gBattleAnimAttacker;
  else battler = S.gBattleAnimTarget;

  if (gBattleAnimArgs[2] < 0) gBattleAnimArgs[2] = Random() % 5;
  StartSpriteAnim(sprite, gBattleAnimArgs[2]);
  sprite.x = GetBattlerSpriteCoord(battler, BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(battler, BATTLER_COORD_Y_PIC_OFFSET);
  const xMod = idiv(GetBattlerSpriteCoordAttr(battler, BATTLER_COORD_ATTR_WIDTH), 2);
  const yMod = idiv(GetBattlerSpriteCoordAttr(battler, BATTLER_COORD_ATTR_HEIGHT), 4);
  let x = imod(Random(), xMod);
  let y = imod(Random(), yMod);
  if (Random() & 1) x *= -1;
  if (Random() & 1) y *= -1;
  if ((gBattlerPositions[battler] & BIT_SIDE) === B_SIDE_PLAYER) y = (((y + 0xFFF0) << 16) >> 16);
  sprite.x += x;
  sprite.y += y;
  sprite.data[0] = gBattleAnimArgs[1];
  sprite.data[7] = CreateSprite(T('gBasicHitSplatSpriteTemplate'), sprite.x, sprite.y, sprite.subpriority + 1);
  if (sprite.data[7] !== MAX_SPRITES) {
    StartSpriteAffineAnim(gSprites[sprite.data[7]], 0);
    gSprites[sprite.data[7]].callback = SpriteCallbackDummy;
  }
  sprite.callback = AnimFistOrFootRandomPos_Step;
}

function AnimFistOrFootRandomPos_Step(sprite) {
  if (sprite.data[0] === 0) {
    if (sprite.data[7] !== MAX_SPRITES) {
      FreeOamMatrix(gSprites[sprite.data[7]].oam.matrixNum);
      DestroySprite(gSprites[sprite.data[7]]);
    }
    DestroyAnimSprite(sprite);
  } else {
    --sprite.data[0];
  }
}

function AnimCrossChopHand(sprite) {
  InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.data[0] = 30;
  if (gBattleAnimArgs[2] === 0) {
    sprite.data[2] = sprite.x - 20;
  } else {
    sprite.data[2] = sprite.x + 20;
    sprite.hFlip = 1;
  }
  sprite.data[4] = sprite.y - 20;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, AnimCrossChopHand_Step);
}

function AnimCrossChopHand_Step(sprite) {
  if (++sprite.data[5] === 11) {
    sprite.data[2] = sprite.x - sprite.x2;
    sprite.data[4] = sprite.y - sprite.y2;
    sprite.data[0] = 8;
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.y2 = 0;
    sprite.x2 = 0;
    sprite.callback = StartAnimLinearTranslation;
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  }
}

// Rolling Kick / Low Kick
function AnimSlidingKick(sprite) {
  if (BATTLE_PARTNER(S.gBattleAnimAttacker) === S.gBattleAnimTarget && GetBattlerPosition(S.gBattleAnimTarget) < B_POSITION_PLAYER_RIGHT)
    gBattleAnimArgs[0] *= -1;
  InitSpritePosToAnimTarget(sprite, TRUE);
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[1] = sprite.x;
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[3] = sprite.y;
  sprite.data[4] = sprite.y;
  InitAnimLinearTranslation(sprite);
  sprite.data[5] = gBattleAnimArgs[5];
  sprite.data[6] = gBattleAnimArgs[4];
  sprite.data[7] = 0;
  sprite.callback = AnimSlidingKick_Step;
}

function AnimSlidingKick_Step(sprite) {
  if (!AnimTranslateLinear(sprite)) {
    sprite.y2 += Sin(sprite.data[7] >> 8, sprite.data[5]);
    sprite.data[7] += sprite.data[6];
  } else {
    DestroyAnimSprite(sprite);
  }
}

// MOVE_STOMP's foot that slides downward. arg0/1: initial offset, arg2: initial wait
function AnimStompFoot(sprite) {
  InitSpritePosToAnimTarget(sprite, TRUE);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = AnimStompFootStep;
}

function AnimStompFootStep(sprite) {
  if (--sprite.data[0] === -1) {
    sprite.data[0] = 6;
    sprite.data[2] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
    sprite.data[4] = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
    sprite.callback = StartAnimLinearTranslation;
    StoreSpriteCallbackInData6(sprite, AnimStompFootEnd);
  }
}

function AnimStompFootEnd(sprite) {
  sprite.data[0] = 15;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// The wall that appears when Brick Break is going to shatter the target's defensive wall
function AnimBrickBreakWall(sprite) {
  if (gBattleAnimArgs[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y);
  } else {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y);
  }
  sprite.x += gBattleAnimArgs[1];
  sprite.y += gBattleAnimArgs[2];
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  sprite.data[3] = 0;
  sprite.callback = AnimBrickBreakWall_Step;
}

function AnimBrickBreakWall_Step(sprite) {
  switch (sprite.data[0]) {
    case 0:
      if (--sprite.data[1] === 0) {
        if (sprite.data[2] === 0) DestroyAnimSprite(sprite);
        else ++sprite.data[0];
      }
      break;
    case 1:
      if (++sprite.data[1] > 1) {
        sprite.data[1] = 0;
        ++sprite.data[3];
        if (sprite.data[3] & 1) sprite.x2 = 2;
        else sprite.x2 = -2;
      }
      if (--sprite.data[2] === 0) DestroyAnimSprite(sprite);
      break;
  }
}

// Piece of shattered defensive wall flies off
function AnimBrickBreakWallShard(sprite) {
  if (gBattleAnimArgs[0] === ANIM_ATTACKER) {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X) + gBattleAnimArgs[2];
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y) + gBattleAnimArgs[3];
  } else {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X) + gBattleAnimArgs[2];
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y) + gBattleAnimArgs[3];
  }
  sprite.oam.tileNum += gBattleAnimArgs[1] * 16;
  sprite.data[0] = 0;
  switch (gBattleAnimArgs[1]) {
    case 0: sprite.data[6] = -3; sprite.data[7] = -3; break;
    case 1: sprite.data[6] = 3; sprite.data[7] = -3; break;
    case 2: sprite.data[6] = -3; sprite.data[7] = 3; break;
    case 3: sprite.data[6] = 3; sprite.data[7] = 3; break;
    default: DestroyAnimSprite(sprite); return;
  }
  sprite.callback = AnimBrickBreakWallShard_Step;
}

function AnimBrickBreakWallShard_Step(sprite) {
  sprite.x += sprite.data[6];
  sprite.y += sprite.data[7];
  if (++sprite.data[0] > 40) DestroyAnimSprite(sprite);
}

function AnimArmThrustHit_Step(sprite) {
  if (sprite.data[0] === sprite.data[4]) DestroyAnimSprite(sprite);
  ++sprite.data[0];
}

function AnimArmThrustHit(sprite) {
  sprite.x = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(S.gBattleAnimTarget, BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[0];
  sprite.data[3] = gBattleAnimArgs[1];
  sprite.data[4] = gBattleAnimArgs[2];
  let turn = u8(S.gAnimMoveTurn);
  if (GetBattlerSide(S.gBattleAnimTarget) === B_SIDE_PLAYER) turn = u8(turn + 1);
  if (turn & 1) {
    sprite.data[2] = -sprite.data[2];
    ++sprite.data[1];
  }
  StartSpriteAnim(sprite, sprite.data[1]);
  sprite.x2 = sprite.data[2];
  sprite.y2 = sprite.data[3];
  sprite.callback = AnimArmThrustHit_Step;
}

function AnimRevengeScratch(sprite) {
  if (gBattleAnimArgs[2] === ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, 0);
  else InitSpritePosToAnimTarget(sprite, FALSE);
  // IsContest() -> anim 2 dropped
  if (GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER) StartSpriteAnim(sprite, 1);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// ---- battle_anim_rock.c (Rock Smash fragments) ------------------------------------------------------
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

// ---- battle_anim_psychic.c ----------------------------------------------------------------------------
function AnimTask_Teleport(taskId) {
  const task = gTasks[taskId];
  const spriteId = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  task.data[0] = spriteId;
  task.data[1] = 0;
  task.data[2] = 0;
  task.data[3] = GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER ? 4 : 8;
  PrepareAffineAnimInTaskData(task, task.data[0], affineAnimByName('sAffineAnim_Teleport'));
  task.func = AnimTask_Teleport_Step;
}

function AnimTask_Teleport_Step(taskId) {
  const task = gTasks[taskId];
  switch (task.data[1]) {
    case 0:
      RunAffineAnimFromTaskData(task);
      if (++task.data[2] > 19) ++task.data[1];
      break;
    case 1:
      if (task.data[3] !== 0) {
        gSprites[task.data[0]].y2 -= 8;
        --task.data[3];
      } else {
        gSprites[task.data[0]].invisible = TRUE;
        gSprites[task.data[0]].x = DISPLAY_WIDTH + 32;
        ResetSpriteRotScale(task.data[0]);
        DestroyAnimVisualTask(taskId);
      }
      break;
  }
}

function AnimRedX_Step(sprite) {
  if (sprite.data[1] > sprite.data[0] - 10) sprite.invisible = !!(sprite.data[1] & 1);
  if (sprite.data[1] === sprite.data[0]) DestroyAnimSprite(sprite);
  ++sprite.data[1];
}

function AnimRedX(sprite) {
  if (gBattleAnimArgs[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(S.gBattleAnimAttacker, BATTLER_COORD_Y_PIC_OFFSET);
  }
  sprite.data[0] = gBattleAnimArgs[1];
  sprite.callback = AnimRedX_Step;
}

// ---- battle_anim_utility_funcs.c ----------------------------------------------------------------------
// gBattleSpritesDataPtr->battlerData[b].invisible has no engine equivalent; kept on S.battlers[b].battlerDataInvisible.
function battlerData(b) { return S.battlers?.[b] || (S._battlerDataFallback ||= [{}, {}, {}, {}])[b]; }

function AnimTask_SetAttackerInvisibleWaitForSignal(taskId) {
  const bd = battlerData(S.gBattleAnimAttacker);
  gTasks[taskId].data[0] = bd.battlerDataInvisible ? 1 : 0;
  bd.battlerDataInvisible = 1;
  gTasks[taskId].func = AnimTask_WaitAndRestoreVisibility;
  --S.gAnimVisualTaskCount;
}

function AnimTask_WaitAndRestoreVisibility(taskId) {
  if (gBattleAnimArgs[7] === 0x1000) {
    battlerData(S.gBattleAnimAttacker).battlerDataInvisible = u8(gTasks[taskId].data[0]) & 1;
    DestroyTask(taskId);
  }
}

// ---- battle_anim_mons.c: AnimTask_AttackerPunchWithTrace ---------------------------------------------
// task: tBattlerSpriteId data[0], tMoveSpeed [1], tState [2], tCounter [3], tPaletteNum [4], tNumTracesActive [5], tPriority [6]
// trace sprite: sActiveTime data[0], sTaskId [1], sSpriteId [2]
function AnimTask_AttackerPunchWithTrace(taskId) {
  const task = gTasks[taskId];
  task.data[0] = GetAnimBattlerSpriteId(ANIM_ATTACKER);
  task.data[1] = GetBattlerSide(S.gBattleAnimAttacker) !== B_SIDE_PLAYER ? -8 : 8;
  task.data[2] = 0;
  task.data[3] = 0;
  gSprites[task.data[0]].x2 -= task.data[0];
  task.data[4] = AllocSpritePalette('ANIM_TAG_BENT_SPOON');
  task.data[5] = 0;

  const dest = 256 + task.data[4] * 16;
  const src = 256 + (gSprites[task.data[0]].oam.paletteNum & 15) * 16;

  task.data[6] = GetBattlerSpriteSubpriority(S.gBattleAnimAttacker);
  if (task.data[6] === 20 || task.data[6] === 40) task.data[6] = 2;
  else task.data[6] = 3;

  // C copies to Faded only; BlendPalette here reads Unfaded, so copy both (virtual battler palette -> trace slot).
  for (let i = 0; i < 16; i++) { gPlttBufferFaded[dest + i] = gPlttBufferUnfaded[src + i]; gPlttBufferUnfaded[dest + i] = gPlttBufferUnfaded[src + i]; }
  BlendPalette(dest, 16, gBattleAnimArgs[1], gBattleAnimArgs[0]);
  task.func = AnimTask_AttackerPunchWithTrace_Step;
}

function AnimTask_AttackerPunchWithTrace_Step(taskId) {
  const task = gTasks[taskId];
  switch (task.data[2]) {
    case 0:
      CreateBattlerTrace(task, taskId);
      gSprites[task.data[0]].x2 += task.data[1];
      if (++task.data[3] === 5) {
        task.data[3]--;
        task.data[2]++;
      }
      break;
    case 1:
      CreateBattlerTrace(task, taskId);
      gSprites[task.data[0]].x2 -= task.data[1];
      if (--task.data[3] === 0) {
        gSprites[task.data[0]].x2 = 0;
        task.data[2]++;
      }
      break;
    case 2:
      if (task.data[5] === 0) {
        FreeSpritePaletteByTag('ANIM_TAG_BENT_SPOON');
        DestroyAnimVisualTask(taskId);
      }
      break;
  }
}

function CreateBattlerTrace(task, taskId) {
  const spriteId = CloneBattlerSpriteWithBlend(0);
  if (spriteId >= 0) {
    const s = gSprites[spriteId];
    s.oam.priority = task.data[6];
    s.oam.paletteNum = task.data[4];
    s.data[0] = 8;
    s.data[1] = taskId;
    s.data[2] = spriteId;
    s.x2 = gSprites[task.data[0]].x2;
    s.callback = AnimBattlerTrace;
    task.data[5]++;
  }
}

function AnimBattlerTrace(sprite) {
  if (--sprite.data[0] === 0) {
    gTasks[sprite.data[1]].data[5]--;
    DestroySpriteWithActiveSheet(sprite);
  }
}

// ---- battle_anim_dark.c -------------------------------------------------------------------------------
// arg0: which battler, arg1: 0 grayscale, 1 original.
// Note: battler palettes are virtual tints, so greyscale has no visible effect (desaturation can't be expressed).
function AnimTask_SetGrayscaleOrOriginalPal(taskId) {
  let spriteId, battler, calcSpriteId = FALSE, position = B_POSITION_PLAYER_LEFT;
  switch (gBattleAnimArgs[0]) {
    case ANIM_ATTACKER: case ANIM_TARGET: case ANIM_ATK_PARTNER: case ANIM_DEF_PARTNER:
      spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]); break;
    case 4: position = B_POSITION_PLAYER_LEFT; calcSpriteId = TRUE; break;
    case 5: position = B_POSITION_PLAYER_RIGHT; calcSpriteId = TRUE; break;
    case 6: position = B_POSITION_OPPONENT_LEFT; calcSpriteId = TRUE; break;
    case 7: position = B_POSITION_OPPONENT_RIGHT; calcSpriteId = TRUE; break;
    default: spriteId = SPRITE_NONE; break;
  }
  if (calcSpriteId) {
    battler = GetBattlerAtPosition(position);
    if (IsBattlerSpriteVisible(battler)) spriteId = gBattlerSpriteIds[battler];
    else spriteId = SPRITE_NONE;
  }
  if (spriteId !== SPRITE_NONE && spriteId !== undefined) SetGreyscaleOrOriginalPalette(gSprites[spriteId].oam.paletteNum + 16, gBattleAnimArgs[1]);
  DestroyAnimVisualTask(taskId);
}

// ---- battle_anim_sound_tasks.c ------------------------------------------------------------------------
// Adjusts panning and assigns it to gAnimCustomPanning. Doesn't play sound (Confuse Ray, Will-O-Wisp).
function SoundTask_AdjustPanningVar(taskId) {
  let targetPan = s8(gBattleAnimArgs[1]);
  let panIncrement = s8(gBattleAnimArgs[2]);
  const r9 = u16(gBattleAnimArgs[3]);
  const sourcePan = s8(BattleAnimAdjustPanning(gBattleAnimArgs[0]));
  targetPan = s8(BattleAnimAdjustPanning(targetPan));
  panIncrement = s8(CalculatePanIncrement(sourcePan, targetPan, panIncrement));
  const t = gTasks[taskId];
  t.data[1] = sourcePan;
  t.data[2] = targetPan;
  t.data[3] = panIncrement;
  t.data[5] = r9;
  t.data[10] = 0;
  t.data[11] = sourcePan;
  t.func = SoundTask_AdjustPanningVar_Step;
  t.func(taskId);
}

function SoundTask_AdjustPanningVar_Step(taskId) {
  const t = gTasks[taskId];
  const panIncrement = u16(t.data[3]);
  if (t.data[10]++ === t.data[5]) {
    t.data[10] = 0;
    const oldPan = u16(t.data[11]);
    t.data[11] = panIncrement + oldPan;
    t.data[11] = KeepPanInRange(t.data[11], oldPan);
  }
  S.gAnimCustomPanning = t.data[11];
  if (t.data[11] === t.data[2]) DestroyAnimVisualTask(taskId);
}

register({
  AnimFistOrFootRandomPos, AnimSlidingKick, AnimRevengeScratch, AnimBrickBreakWall, AnimBrickBreakWallShard,
  AnimStompFoot, AnimCrossChopHand, AnimJumpKick, AnimArmThrustHit, AnimRockFragment,
  AnimRedX, AnimTask_Teleport, AnimTask_SetAttackerInvisibleWaitForSignal, AnimTask_AttackerPunchWithTrace,
  AnimTask_SetGrayscaleOrOriginalPal, SoundTask_AdjustPanningVar,
});
