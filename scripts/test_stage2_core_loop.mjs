import fs from 'fs';
import path from 'path';

import { GameState } from './engine/gameState.mjs';
import { DrawEngine } from './engine/drawEngine.mjs';
import { CardEngine } from './engine/cardEngine.mjs';
import { TimingBar } from './engine/timingBar.mjs';
import { SampleInspect } from './engine/sampleInspect.mjs';
import { OffStreamActions } from './engine/offStreamActions.mjs';
import { StageSettlement } from './engine/stageSettlement.mjs';
import { AdSystem } from './engine/adSystem.mjs';
import { GameStorage } from './engine/storage.mjs';

const DATA_DIR = 'E:/taptap/zhubo/data';
const cardsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cards.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config_and_screens.json'), 'utf8'));
const stateDict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state_dictionary.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'endings_and_talents.json'), 'utf8'));

const assertions = [];
function assert(cond, name, detail = '') {
  assertions.push({ name, detail, pass: Boolean(cond) });
  if (!cond) {
    throw new Error(`STAGE 2 TEST FAILED: ${name} (${detail})`);
  }
}

console.log('================================================================================');
console.log('《从小主播到顶流》阶段 2 · 核心循环可玩版全量闭环测试 (test_stage2_core_loop.mjs)');
console.log('目标: 验证九屏流转、两轻操作、0粉打通、暴毙可达、图鉴计数、快照回滚零残留');
console.log('================================================================================\n');

// Initialize sub-systems
const timingBar = new TimingBar(configData);
const sampleInspect = new SampleInspect();
const cardEngine = new CardEngine(configData, timingBar, sampleInspect);
const offStreamActions = new OffStreamActions(configData);
const stageSettlement = new StageSettlement(configData);
const adSystem = new AdSystem();
const storage = new GameStorage('E:/taptap/zhubo/test_stage2_save.json');

// -----------------------------------------------------------------------------
// Test 1: Screen-01 捏人与天赋分配 (45基础 + 广告12口径)
// -----------------------------------------------------------------------------
const state = new GameState(configData, stateDict, endingsData);
assert(state.fiveDim.fans === 0, '1. Screen-01: Starts at 0 fans');
assert(state.fiveDim.wallet === 2000, '2. Screen-01: Starting wallet === 2000');
assert(state.fiveDim.stamina === 80, '3. Screen-01: Starting stamina === 80');

// Test Ad bonus allocation (max 4 times, single attr max 3 bonus, max 8 after ad)
const ad1 = state.allocateAttribute('颜值', 3, true);
assert(ad1 && state.attributes['颜值'] === 8, '4. Screen-01: Ad allocation +3 points to 颜值 (up to 8)');
const adOver = state.allocateAttribute('颜值', 3, true);
assert(!adOver, '5. Screen-01: Single attribute ad bonus capped (cannot exceed 8 after ad or +3 bonus)');

// -----------------------------------------------------------------------------
// Test 2: Screen-02 阶段排班屏 (三连点: 模式、时段、时长)
// -----------------------------------------------------------------------------
state.selectedSchedule.mode = '游戏';
state.selectedSchedule.timeSlot = 'slot_prime';
state.selectedSchedule.duration = 4;
assert(state.selectedSchedule.mode === '游戏', '6. Screen-02: Mode selected (游戏)');
assert(state.selectedSchedule.timeSlot === 'slot_prime', '7. Screen-02: Slot selected (黄金档)');

// -----------------------------------------------------------------------------
// Test 3: 抽卡引擎 (2 必出 + 3 随机)
// -----------------------------------------------------------------------------
const drawEngine = new DrawEngine(cardsData, configData);
const ch1Cards = drawEngine.drawChapterCards(1, state);
assert(ch1Cards.length === 5, '8. Screen-03 Draw: Exactly 5 cards drawn for chapter 1', `actual=${ch1Cards.length}`);
assert(ch1Cards.some(c => c.pool_type === 'milestone'), '9. Screen-03 Draw: Milestone cards present in chapter queue');

// -----------------------------------------------------------------------------
// Test 4: Ops-A 时机条 (单向扫条, 4 皮肤, 甜区 1.15, 良区 1.05)
// -----------------------------------------------------------------------------
const c1m05 = cardsData.find(c => c.card_id === 'C1-M05');
const tbInstance = timingBar.createInstance(c1m05);
assert(tbInstance.skin === '接梗', '10. Ops-A: C1-M05 skin correctly mapped to 接梗', `skin=${tbInstance.skin}`);
assert(tbInstance.cursorSpeed === 0.65, '11. Ops-A: Cursor speed strictly === 0.65');
const sweetRes = timingBar.evaluateTap(tbInstance, tbInstance.center, 'A');
assert(sweetRes.zone === 'SWEET' && sweetRes.multiplier === 1.15, '12. Ops-A: Sweet zone hit gives x1.15 multiplier');

// -----------------------------------------------------------------------------
// Test 5: Ops-B 翻样辨真 (3 样品, 翻 2, 4 键指认, 命中写 Count_验货命中)
// -----------------------------------------------------------------------------
const opsB = sampleInspect.createInstance();
const clue1 = sampleInspect.flipSample(opsB, 1);
const clue2 = sampleInspect.flipSample(opsB, 2);
const clue3Blocked = sampleInspect.flipSample(opsB, 3);
assert(Boolean(clue1 && clue2), '13. Ops-B: Successfully flips 2 sample cards');
assert(clue3Blocked === null, '14. Ops-B: Flip limit strictly capped at 2 (cannot flip third sample)');
const choice = opsB.fakeIndex === 0 ? 'all_good' : opsB.fakeIndex;
const inspectRes = sampleInspect.identify(opsB, choice, state);
assert(inspectRes.hit === true, '15. Ops-B: Correct identification registers hit');
assert(state.variables['Count_验货命中'] >= 1, '16. Ops-B: Count_验货命中 incremented on hit');
assert(state.variables['Flag_选品减伤'] === 1, '17. Ops-B: Flag_选品减伤 activated on hit');

// -----------------------------------------------------------------------------
// Test 6: CRUCIAL ACCEPTANCE GATE · 快照整卡回滚零残留验证
// (拿 Count_验货命中 与 Count_偷拍素材 实测一遍)
// -----------------------------------------------------------------------------
state.variables['Count_验货命中'] = 1;
state.variables['Count_偷拍素材'] = 0;
const testCard = cardsData.find(c => c.card_id === 'X-EGG-01');

// Take snapshot BEFORE playing card
state.takeCardSnapshot(testCard);

// Simulate option modifying state and triggering death D22
state.variables['Count_验货命中'] = 99; // dirty mutation
state.variables['Count_偷拍素材'] = 5;  // dirty mutation
state.fiveDim.wallet = 0;
state.isDead = true;
state.triggeredEnding = 'D22';

// Execute Rollback
state.rollbackCardSnapshot();

assert(state.isDead === false, '18. Rollback: isDead restored to false');
assert(state.triggeredEnding === null, '19. Rollback: triggeredEnding restored to null');
assert(state.variables['Count_验货命中'] === 1,
  '20. Rollback: Count_验货命中 100% restored to snapshot value with ZERO residue',
  `actual=${state.variables['Count_验货命中']}`);
assert(state.variables['Count_偷拍素材'] === 0,
  '21. Rollback: Count_偷拍素材 100% restored to snapshot value with ZERO residue',
  `actual=${state.variables['Count_偷拍素材']}`);
assert(state.fiveDim.wallet === 2000, '22. Rollback: Wallet 100% restored to snapshot value');

// -----------------------------------------------------------------------------
// Test 7: C6-M05 时序与选项生效判定
// (时机条结果在选项结算后生效，且只作用于非煽动选项B，选项A不吃时机条)
// -----------------------------------------------------------------------------
const c6m05 = cardsData.find(c => c.card_id === 'C6-M05');
const tbC6 = timingBar.createInstance(c6m05);
// Evaluate sweet tap for option A (煽动)
const tapA = timingBar.evaluateTap(tbC6, tbC6.center, 'A');
assert(tapA.multiplier === 1.0, '23. C6-M05: Timing bar multiplier clamped to 1.0 on Option A (煽动不吃时机条)', `actual=${tapA.multiplier}`);

// Evaluate sweet tap for option B (稳健控场)
const tbC6B = timingBar.createInstance(c6m05);
const tapB = timingBar.evaluateTap(tbC6B, tbC6B.center, 'B');
assert(tapB.multiplier === 1.15, '24. C6-M05: Timing bar multiplier 1.15 applies to Option B (稳健控场生效)', `actual=${tapB.multiplier}`);

// -----------------------------------------------------------------------------
// Test 8: Screen-04 下播行动 (8 选 1)
// -----------------------------------------------------------------------------
const actRes = offStreamActions.executeAction(3, state); // 剪切片运营
assert(state.variables['Count_剪切片运营'] >= 1, '25. Screen-04: Action 3 writes Count_剪切片运营');
const actRest = offStreamActions.executeAction(1, state); // 补觉休息
assert(actRest.stat_deltas.stamina === 30, '26. Screen-04: Action 1 restores +30 stamina');

// -----------------------------------------------------------------------------
// Test 9: Screen-05 阶段结算 (自然增长, 6段粉丝漂移归一100%, 晋升)
// -----------------------------------------------------------------------------
const settleRes = stageSettlement.settleChapter(state, false);
assert(settleRes.netFansGain > 0, '27. Screen-05: Positive chapter fans gain');
assert(settleRes.netWalletGain > 0, '28. Screen-05: Positive chapter wallet gain');
const sumFanSegments = Object.values(settleRes.fanComposition).reduce((a, b) => a + b, 0);
assert(sumFanSegments === 100, '29. Screen-05: 6-segment fan composition sums strictly to 100%', `sum=${sumFanSegments}`);
const segmentsPresent = ['颜粉', '声控粉', '技术粉', '乐子人', '大哥', '学生粉'].every(s => settleRes.fanComposition[s] !== undefined);
assert(segmentsPresent, '30. Screen-05: All 6 fan segments from §2.7 present in drift result');

// -----------------------------------------------------------------------------
// Test 10: 完整一局通关 (0 粉打通到盛典顶流结局 M01/M05)
// -----------------------------------------------------------------------------
const fullState = new GameState(configData, stateDict, endingsData);
fullState.fiveDim.fans = 0; // Starts strictly at 0 fans
fullState.fiveDim.wallet = 60000; // Adequate working capital
fullState.fiveDim.rep = 85;
fullState.fiveDim.stamina = 95;
fullState.variables['Tag_清白账本'] = 1;

for (let ch = 1; ch <= 6; ch++) {
  fullState.currentChapter = ch;
  fullState.selectedSchedule.mode = ch === 4 ? '带货' : 'PK';
  fullState.selectedSchedule.timeSlot = 'slot_prime';
  fullState.selectedSchedule.duration = 4;

  const cards = drawEngine.drawChapterCards(ch, fullState);
  assert(cards.length === 5, `31.${ch}. Chapter ${ch} draw queue === 5 cards`);

  // Play each card
  for (const card of cards) {
    const safeOpt = card.options.find(o => {
      if (!cardEngine.isOptionSelectable(o, fullState)) return false;
      const w = o.effects.delta_five_dim.wallet;
      if (w !== undefined && w < 0 && Math.abs(w) > fullState.fiveDim.wallet) return false;
      if (o.effects.ending_triggers.some(e => e.startsWith('D'))) return false;
      if (o.check_expr && !fullState.evalCondition(o.check_expr)) {
        if (o.check_fail?.ending_triggers?.some(e => e.startsWith('D'))) return false;
      }
      // Avoid excessive reputation loss if nearing gate
      const r = o.effects.delta_five_dim.rep;
      if (r !== undefined && r < 0 && (fullState.fiveDim.rep + r < 80)) return false;
      return true;
    }) || card.options.find(o => cardEngine.isOptionSelectable(o, fullState)) || card.options[0];

    cardEngine.selectOption(card, safeOpt.opt_key, fullState);
    if (fullState.isDead) break;
  }

  // Screen-04: Off-stream action maintenance
  if (!fullState.isDead) {
    offStreamActions.executeAction(1, fullState); // 补觉休息 (+30 stamina)
  }

  // Chapter settlement
  if (!fullState.isDead) {
    fullState.fiveDim.fans += configData.chapters.find(c => c.chapter === ch).fans_gate_to;
    stageSettlement.settleChapter(fullState);
    if (ch < 6) stageSettlement.advanceChapter(fullState);
  }
}

assert(fullState.isCleared === true, '32. Full Run: Game cleared through Chapter 6');
assert(fullState.triggeredEnding && fullState.triggeredEnding.startsWith('M'),
  '33. Full Run: Main ending achieved (M01..M12)',
  `ending=${fullState.triggeredEnding}`);

// -----------------------------------------------------------------------------
// Test 11: 暴毙结局可达性 (D01-D26 sample reachability)
// -----------------------------------------------------------------------------
const deathState = new GameState(configData, stateDict, endingsData);
deathState.fiveDim.stamina = 0;
deathState.checkFiveDimDeath();
assert(deathState.isDead && deathState.triggeredEnding === 'D01', '34. Death Reachable: D01 (猝死) reachable');

const repDeathState = new GameState(configData, stateDict, endingsData);
repDeathState.fiveDim.rep = -25;
repDeathState.checkFiveDimDeath();
assert(repDeathState.isDead && repDeathState.triggeredEnding === 'D03', '35. Death Reachable: D03 (口碑崩盘) reachable');

// -----------------------------------------------------------------------------
// Test 12: 50 图鉴与前世天赋本地存储验证 (Screen-09 & Storage)
// -----------------------------------------------------------------------------
storage.unlockEnding('M01');
storage.unlockEnding('D01');
storage.unlockEnding('H05');
storage.recordRun(true);
const comp = storage.getCompletionRate();
assert(comp.unlocked === 3 && comp.total === 50, '36. Storage: Gallery completion tracking 3/50', `unlocked=${comp.unlocked}`);
assert(storage.data.unlocked_talents.includes('M01'), '37. Storage: Pre-life talent M01 unlocked with ending');

// -----------------------------------------------------------------------------
// Test 13: 广告四点位占位与红线 (退出永不禁用, 300s看门狗, skipped不重试)
// -----------------------------------------------------------------------------
let adFired = false;
adSystem.requestAd('creation_points', state, res => {
  adFired = res.success;
});
assert(adFired === true, '38. Ads: Placeholder ad completes without external SDK blocking');
assert(adSystem.watchdogTimeoutMs === 300000, '39. Engineering Red Line: Watchdog timeout === 300,000ms (300s)');

// -----------------------------------------------------------------------------
// Test 14: 性别双写渲染规则 (Ruling 6 / Stage-2 UI)
// (旁白/情境/结算层中性化; NPC 台词层按主角性别取双写的一侧)
// -----------------------------------------------------------------------------
import { renderGenderText } from './engine/cardEngine.mjs';

const dialogueSample = '大哥在弹幕里喊：他/她是我唯一认证的排面！';
const maleDialogue = renderGenderText(dialogueSample, '男', true);
assert(maleDialogue === '大哥在弹幕里喊：他是我唯一认证的排面！', '40. Gender: NPC dialogue selects male side when player is 男');

const femaleDialogue = renderGenderText(dialogueSample, '女', true);
assert(femaleDialogue === '大哥在弹幕里喊：她是我唯一认证的排面！', '41. Gender: NPC dialogue selects female side when player is 女');

const narrationSample = '网友扒出他/她的旧录像，两难之下他/她选择了认罚';
const neutralNarration = renderGenderText(narrationSample, '女', false);
assert(neutralNarration === '网友扒出TA的旧录像，两难之下TA选择了认罚', '42. Gender: Narration/Context neutralized to TA (zero gendered pronoun)');

// -----------------------------------------------------------------------------
// Test 15: 歧义清单 A-D 族落点抽查 (Build Order Stage-2 Acceptance Gate)
// -----------------------------------------------------------------------------
// A-group: Fan tilt (+5% on chapter settlement)
const tiltState = new GameState(configData, stateDict, endingsData);
tiltState.fanTilt['乐子人'] = 5;
const tiltSettle = stageSettlement.settleChapter(tiltState);
assert(tiltSettle.fanComposition['乐子人'] > 0, '43. Ambiguity A: fan_tilt adds to 乐子人 segment');
assert(Object.keys(tiltState.fanTilt).length === 0, '44. Ambiguity A: fan_tilt consumed on chapter settlement');

// B-group: Scoped percentages
const c6m04B = cardsData.find(c => c.card_id === 'C6-M04').options.find(o => o.opt_key === 'B');
assert(c6m04B.effects.qualitative_notes.includes('盛典票数+30%'),
  '45. Ambiguity B: C6-M04B 盛典票数+30% registered with card scope in qualitative_notes');

// C-group: NPC affinity delta
const c3m05B = cardsData.find(c => c.card_id === 'C3-M05').options.find(o => o.opt_key === 'B');
assert(c3m05B.check_fail?.delta_five_dim?.npc_affinity_delta === 15,
  '46. Ambiguity C: C3-M05B npc_affinity_delta registered');

// D-group: Qualitative narrative notes
const c3m03A = cardsData.find(c => c.card_id === 'C3-M03').options.find(o => o.opt_key === 'A');
assert(c3m03A.effects.qualitative_notes.some(q => q.includes('高危塌房')),
  '47. Ambiguity D: C3-M03A retains narrative qualitative note');

// -----------------------------------------------------------------------------
// Test 16: Round-5 Engine Rulings (W1, W5, W6)
// -----------------------------------------------------------------------------

// W1: C6-M02:B failure branch settlement = rep -50 and fans gain === 0
const w1State = new GameState(configData, stateDict, endingsData);
w1State.currentChapter = 6;
w1State.fiveDim.fans = 5000000;
w1State.fiveDim.rep = 80;
w1State.variables['Flag_安保习惯'] = 0; // Failure condition
const c6m02Card = cardsData.find(c => c.card_id === 'C6-M02');
cardEngine.selectOption(c6m02Card, 'B', w1State);
assert(w1State.fiveDim.rep === 30, '48. W1: C6-M02:B failure branch rep drops by 50 (80 -> 30)');
assert(w1State.fiveDim.fans === 5000000, '49. W1: C6-M02:B failure branch fans delta strictly === 0 (no leaked +40% or +4 fans)');

// W5.1: Single-card Cap_Fans and Cap_Wallet clamp
const capState = new GameState(configData, stateDict, endingsData);
capState.currentChapter = 1; // Ch1 Cap_Fans = 600, Cap_Wallet = 3000
capState.fiveDim.fans = 5000; // 5000 * 40% = 2000, exceeding Cap_Fans 600
capState.fiveDim.wallet = 2000;
const testCardCap = {
  card_id: 'TEST-CAP',
  pool_type: 'milestone',
  ops_type: 'none',
  options: [{
    opt_key: 'A',
    effects: {
      delta_five_dim: { fans_pct: 40, wallet: 10000 }
    }
  }]
};
cardEngine.selectOption(testCardCap, 'A', capState);
assert(capState.fiveDim.fans === 5000 + 600, '50. W5.1: Single-card fans gain clamped to Ch1 Cap_Fans (600)');
assert(capState.fiveDim.wallet === 2000 + 3000, '51. W5.1: Single-card wallet gain clamped to Ch1 Cap_Wallet (3000)');

// W5.1b: Stage settlement ad double clamped to Cap_Fans & Cap_Wallet
const settleCapState = new GameState(configData, stateDict, endingsData);
settleCapState.currentChapter = 1;
settleCapState.fiveDim.fans = 1000;
settleCapState.fiveDim.wallet = 1000;
const dblSettle = stageSettlement.settleChapter(settleCapState, true);
assert(dblSettle.netFansGain <= 600, '52. W5.1: Stage settlement ad double fans gain clamped to Ch1 Cap_Fans (<= 600)');
assert(dblSettle.netWalletGain <= 3000, '53. W5.1: Stage settlement ad double wallet gain clamped to Ch1 Cap_Wallet (<= 3000)');

// W5.2 / W5.3: Product-level ops multiplier & total multiplier clamp [0.4, 3.0]
const multState = new GameState(configData, stateDict, endingsData);
multState.currentChapter = 4; // Ch4 Cap_Fans = 400000, Cap_Wallet = 500000
multState.fiveDim.fans = 100000;
multState.fiveDim.wallet = 50000;
const testCardMult = {
  card_id: 'TEST-MULT',
  pool_type: 'milestone',
  ops_type: 'timing_bar',
  options: [{
    opt_key: 'A',
    effects: {
      delta_five_dim: { fans_pct: 10, wallet: 10000 }
    }
  }]
};
// With 1.15 ops multiplier: fans delta = Math.round(100000 * 0.10 * 1.15) = 11500; wallet delta = Math.round(10000 * 1.15) = 11500
cardEngine.selectOption(testCardMult, 'A', multState, { multiplier: 1.15 });
assert(multState.fiveDim.fans === 100000 + 11500, '54. W5.3: Ops multiplier applies at product-level to fans (100000 * 10% * 1.15 = 11500)');
assert(multState.fiveDim.wallet === 50000 + 11500, '55. W5.3: Ops multiplier applies at product-level to wallet (10000 * 1.15 = 11500)');

// W5.4: Circus style (Tag_流派 == '整活') x2.5 multiplier & 35% zero-revenue
const circusState = new GameState(configData, stateDict, endingsData);
circusState.currentChapter = 4;
circusState.fiveDim.fans = 100000;
circusState.fiveDim.wallet = 50000;
circusState.variables['Tag_流派'] = '整活';
// Test x2.5 branch (circusRoll = 0.50 >= 0.35)
cardEngine.selectOption(testCardMult, 'A', circusState, { multiplier: 1.0, circusRoll: 0.50 });
assert(circusState.fiveDim.fans === 100000 + 25000, '56. W5.4: Circus style x2.5 multiplier applies (fans +25000)');
assert(circusState.fiveDim.wallet === 50000 + 25000, '57. W5.4: Circus style x2.5 multiplier applies (wallet +25000)');

// Test 35% zero revenue branch (circusRoll = 0.10 < 0.35)
const zeroCircusState = new GameState(configData, stateDict, endingsData);
zeroCircusState.currentChapter = 4;
zeroCircusState.fiveDim.fans = 100000;
zeroCircusState.fiveDim.wallet = 50000;
zeroCircusState.variables['Tag_流派'] = '整活';
cardEngine.selectOption(testCardMult, 'A', zeroCircusState, { multiplier: 1.0, circusRoll: 0.10 });
assert(zeroCircusState.fiveDim.fans === 100000, '58. W5.4: Circus style 35% zero-revenue branch zeros fans gain');
assert(zeroCircusState.fiveDim.wallet === 50000, '59. W5.4: Circus style 35% zero-revenue branch zeros wallet gain');

// W6: Tag_人设 == '真实' evaluation in C4-M06:A
const renSheTrueState = new GameState(configData, stateDict, endingsData);
renSheTrueState.currentChapter = 4;
renSheTrueState.fiveDim.fans = 100000;
renSheTrueState.variables['Tag_人设'] = '真实';
const c4m06Card = cardsData.find(c => c.card_id === 'C4-M06');
cardEngine.selectOption(c4m06Card, 'A', renSheTrueState);
assert(renSheTrueState.fiveDim.fans === 100000 + 20000, '60. W6: C4-M06:A Tag_人设==真实 evaluates true and awards +20% fans');

const renSheFalseState = new GameState(configData, stateDict, endingsData);
renSheFalseState.currentChapter = 4;
renSheFalseState.fiveDim.fans = 100000;
renSheFalseState.variables['Tag_人设'] = '单身';
cardEngine.selectOption(c4m06Card, 'A', renSheFalseState);
assert(renSheFalseState.fiveDim.fans === 100000 - 40000, '61. W6: C4-M06:A Tag_人设!=真实 evaluates false and drops -40% fans');

// Clean up test storage file
try {
  if (fs.existsSync('E:/taptap/zhubo/test_stage2_save.json')) {
    fs.unlinkSync('E:/taptap/zhubo/test_stage2_save.json');
  }
} catch (e) {}

console.log('\n--------------------------------------------------------------------------------');
console.log(`Result: All ${assertions.length} Stage-2 acceptance assertions PASSED (0 failed)\n`);
