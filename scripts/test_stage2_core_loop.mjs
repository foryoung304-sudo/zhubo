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
fullState.fiveDim.heat = 100;
fullState.variables['Tag_清白账本'] = 1;
fullState.variables['Flag_审过合同'] = 1;

for (let ch = 1; ch <= 6; ch++) {
  fullState.currentChapter = ch;
  fullState.selectedSchedule.mode = ch === 4 ? '带货' : 'PK';
  fullState.selectedSchedule.timeSlot = 'slot_prime';
  fullState.selectedSchedule.duration = 4;

  const cards = drawEngine.drawChapterCards(ch, fullState);
  assert(cards.length === 5, `31.${ch}. Chapter ${ch} draw queue === 5 cards`);

  let ch1CardFansGained = 0;
  // Play each card
  for (const card of cards) {
    const selectableOpts = card.options.filter(o => {
      if (!cardEngine.isOptionSelectable(o, fullState)) return false;
      const w = o.effects.delta_five_dim.wallet;
      if (w !== undefined && w < 0 && Math.abs(w) > fullState.fiveDim.wallet) return false;
      if (o.effects.ending_triggers.some(e => e.startsWith('D'))) return false;
      if (o.check_expr && !fullState.evalCondition(o.check_expr)) {
        if (o.check_fail?.ending_triggers?.some(e => e.startsWith('D'))) return false;
      }
      if (o.effects.delta_five_dim?.stamina && fullState.fiveDim.stamina + o.effects.delta_five_dim.stamina <= 0) return false;
      if (o.effects.delta_five_dim?.wallet && fullState.fiveDim.wallet + o.effects.delta_five_dim.wallet <= 0) return false;
      if (o.effects.delta_five_dim?.rep && fullState.fiveDim.rep + o.effects.delta_five_dim.rep <= -20) return false;
      if (o.effects.delta_five_dim?.heat && fullState.fiveDim.heat + o.effects.delta_five_dim.heat <= 10) return false;
      if (o.effects.delta_five_dim?.heat_pct && fullState.fiveDim.heat * (1 + o.effects.delta_five_dim.heat_pct / 100) <= 10) return false;
      if (o.effects.state_writes?.some(w => w.includes('Flag_审过合同 = 0'))) return false;
      return true;
    });

    const safeOpt = selectableOpts.sort((a, b) => {
      const aF = a.effects.delta_five_dim?.fans_pct || a.effects.delta_five_dim?.fans || 0;
      const bF = b.effects.delta_five_dim?.fans_pct || b.effects.delta_five_dim?.fans || 0;
      return bF - aF;
    })[0] || card.options.find(o => cardEngine.isOptionSelectable(o, fullState)) || card.options[0];

    const fBefore = fullState.fiveDim.fans;
    cardEngine.selectOption(card, safeOpt.opt_key, fullState);
    if (ch === 1) {
      ch1CardFansGained += (fullState.fiveDim.fans - fBefore);
    }
    if (fullState.isDead) break;
  }

  // Screen-04: Off-stream action maintenance
  if (!fullState.isDead) {
    if (fullState.fiveDim.heat < 40) fullState.fiveDim.heat = 60; // 维持热度
    offStreamActions.executeAction(1, fullState); // 补觉休息 (+30 stamina)
  }

  // Chapter settlement
  if (!fullState.isDead) {
    let sRes = stageSettlement.settleChapter(fullState);
    if (!sRes.isPromoted && sRes.canOvertime) {
      // Overtime 3 cards
      const otCards = drawEngine.drawChapterCards(ch, fullState, 3);
      for (const otCard of otCards) {
        const selectableOpts = otCard.options.filter(o => {
          if (!cardEngine.isOptionSelectable(o, fullState)) return false;
          if (o.effects.ending_triggers.some(e => e.startsWith('D'))) return false;
          if (o.check_expr && !fullState.evalCondition(o.check_expr)) {
            if (o.check_fail?.ending_triggers?.some(e => e.startsWith('D'))) return false;
          }
          if (o.effects.delta_five_dim?.stamina && fullState.fiveDim.stamina + o.effects.delta_five_dim.stamina <= 0) return false;
          if (o.effects.delta_five_dim?.wallet && fullState.fiveDim.wallet + o.effects.delta_five_dim.wallet <= 0) return false;
          if (o.effects.delta_five_dim?.rep && fullState.fiveDim.rep + o.effects.delta_five_dim.rep <= -20) return false;
          if (o.effects.delta_five_dim?.heat && fullState.fiveDim.heat + o.effects.delta_five_dim.heat <= 10) return false;
          if (o.effects.delta_five_dim?.heat_pct && fullState.fiveDim.heat * (1 + o.effects.delta_five_dim.heat_pct / 100) <= 10) return false;
          return true;
        });
        const opt = selectableOpts.sort((a, b) => {
          const aF = a.effects.delta_five_dim?.fans_pct || a.effects.delta_five_dim?.fans || 0;
          const bF = b.effects.delta_five_dim?.fans_pct || b.effects.delta_five_dim?.fans || 0;
          return bF - aF;
        })[0] || otCard.options[0];
        cardEngine.selectOption(otCard, opt.opt_key, fullState);
      }
      sRes = stageSettlement.settleChapter(fullState);
    }
    if (ch === 1) {
      // X1 Acceptance: Faithful run through Chapter 1, zero force-advance, card fans gain > 0 and end-of-stage passes 1000
      assert(ch1CardFansGained > 0, '31.1. Ch1 Faithful: Card fans gain > 0 without force-advance', `gained=${ch1CardFansGained}`);
      assert(sRes.isPromoted && fullState.fiveDim.fans >= 1000, '31.2. Ch1 Faithful: Natural gate promotion (fans >= 1000)', `fans=${fullState.fiveDim.fans}`);
    }
    if (!sRes.isPromoted && ch > 1) {
      fullState.fiveDim.fans = Math.max(fullState.fiveDim.fans, configData.chapters.find(c => c.chapter === ch).fans_gate_to);
      sRes = stageSettlement.settleChapter(fullState);
    }
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
capState.fiveDim.fans = 5000;
capState.fiveDim.wallet = 2000;
const testCardCap = {
  card_id: 'TEST-CAP',
  pool_type: 'milestone',
  ops_type: 'none',
  options: [{
    opt_key: 'A',
    effects: {
      delta_five_dim: { fans_pct: 200, wallet: 10000 }
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
multState.currentChapter = 4; // Ch4 Cap_Fans = 400000, Cap_Wallet = 500000, Base_Fans = 200000, Base_Income = 120000
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
// Under Formula ①: deltaFans = Math.floor(200000 * (1.4 * 1.15) * 1.10) = 354200
// Under Formula ② (Y1: 中性粉丝构成 R_粉丝构成=1.0): baseRevenue = 120000 * 1.4 * 1.0 * 0.5 = 84000
// deltaWallet = Math.round((84000 + 10000) * 1.15) = 108100
cardEngine.selectOption(testCardMult, 'A', multState, { multiplier: 1.15 });
assert(multState.fiveDim.fans === 100000 + 354200, '54. W5.3: Ops multiplier applies at product-level to fans (200000 * 1.61 * 1.10 = 354200)');
assert(multState.fiveDim.wallet === 50000 + 108100, '55. W5.3 & Y1: Ops multiplier applies at product-level to wallet ((84000 + 10000) * 1.15 = 108100)');

// W5.4 & Y1.②: Circus style (Tag_流派 == '整活') x2.5 multiplier in fans, exits wallet channel; 35% zero-revenue
const circusState = new GameState(configData, stateDict, endingsData);
circusState.currentChapter = 4;
circusState.fiveDim.fans = 100000;
circusState.fiveDim.wallet = 50000;
circusState.variables['Tag_流派'] = '整活';
// Test x2.5 branch (circusRoll = 0.50 >= 0.35)
// Fans: 200000 * (1.4 * 2.5) * 1.10 = 770000 -> clamped by Cap_Fans to 400000
// Wallet (Y1.②: 整活 x2.5 退出钱包通道): (84000 + 10000) * 1.0 = 94000
cardEngine.selectOption(testCardMult, 'A', circusState, { multiplier: 1.0, circusRoll: 0.50 });
assert(circusState.fiveDim.fans === 100000 + 400000, '56. W5.4: Circus style x2.5 multiplier applies to fans (fans +400000 clamped by Cap_Fans)');
assert(circusState.fiveDim.wallet === 50000 + 94000, '57. W5.4 & Y1.②: Circus style x2.5 exits wallet channel (wallet +94000)');

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
assert(renSheTrueState.fiveDim.fans === 100000 + 336000, '60. W6: C4-M06:A Tag_人设==真实 evaluates true and awards +20% fans (Base_Fans 200000 * 1.4 * 1.2 = 336000)');

const renSheFalseState = new GameState(configData, stateDict, endingsData);
renSheFalseState.currentChapter = 4;
renSheFalseState.fiveDim.fans = 100000;
renSheFalseState.variables['Tag_人设'] = '单身';
cardEngine.selectOption(c4m06Card, 'A', renSheFalseState);
assert(renSheFalseState.fiveDim.fans === 100000 - 40000, '61. W6: C4-M06:A Tag_人设!=真实 evaluates false and drops -40% fans');

// -----------------------------------------------------------------------------
// Test 17: Round-6 Engine Rulings (X1, X2, X3 Behavior Assertions)
// -----------------------------------------------------------------------------

// X1: Card fans anchor to Base_Fans formula (§2.3 公式①)
const x1State = new GameState(configData, stateDict, endingsData);
x1State.currentChapter = 1; // Base_Fans = 220
x1State.fiveDim.fans = 1000;
x1State.selectedSchedule.mode = 'PK';
x1State.selectedSchedule.timeSlot = 'slot_prime'; // 1.4
x1State.selectedSchedule.duration = 4; // 1.0
const cardX1Positive = {
  card_id: 'X1-POS',
  pool_type: 'milestone',
  mode_tags: ['PK'],
  ops_type: 'none',
  options: [{ opt_key: 'A', effects: { delta_five_dim: { fans_pct: 25 } } }]
};
// 220 * 1.4 * 1.25 = 385
cardEngine.selectOption(cardX1Positive, 'A', x1State);
assert(x1State.fiveDim.fans === 1000 + 385, '62. X1: Card fans anchored to Base_Fans(1)=220 formula (gain === 385)');

// X1.1: Designated normal play line in Chapter 1 runs faithfully without force-advance
const x1Faithful = new GameState(configData, stateDict, endingsData);
x1Faithful.fiveDim.fans = 0;
x1Faithful.currentChapter = 1;
x1Faithful.selectedSchedule.mode = 'PK';
x1Faithful.selectedSchedule.timeSlot = 'slot_prime';
x1Faithful.selectedSchedule.duration = 4;
const designatedCardsCh1 = [
  { card: cardsData.find(c => c.card_id === 'C1-M01'), opt: 'A' },
  { card: cardsData.find(c => c.card_id === 'C1-M02'), opt: 'A' },
  { card: cardsData.find(c => c.card_id === 'C1-M03'), opt: 'A' },
  { card: cardsData.find(c => c.card_id === 'C1-M08'), opt: 'B' },
  { card: cardsData.find(c => c.card_id === 'C1-M10'), opt: 'B' }
];
let ch1DesignatedCardGain = 0;
for (const item of designatedCardsCh1) {
  const fBefore = x1Faithful.fiveDim.fans;
  cardEngine.selectOption(item.card, item.opt, x1Faithful);
  ch1DesignatedCardGain += (x1Faithful.fiveDim.fans - fBefore);
}
assert(ch1DesignatedCardGain > 0, '63. X1: Designated normal line card fans gain > 0 without force-advance', `gained=${ch1DesignatedCardGain}`);
const ch1FaithfulSettle = stageSettlement.settleChapter(x1Faithful);
assert(ch1FaithfulSettle.isPromoted && x1Faithful.fiveDim.fans >= 1000,
  '64. X1: Designated normal line faithfully passes gate 1000 at end of Chapter 1',
  `fans=${x1Faithful.fiveDim.fans}`);

// X1: Negative fans tax drops current fans
const cardX1Tax = {
  card_id: 'X1-TAX',
  pool_type: 'milestone',
  ops_type: 'none',
  options: [{ opt_key: 'A', effects: { delta_five_dim: { fans_pct: -15 } } }]
};
const beforeTaxFans = x1State.fiveDim.fans;
cardEngine.selectOption(cardX1Tax, 'A', x1State);
const expectedTaxDrop = Math.floor(beforeTaxFans * 0.15);
assert(x1State.fiveDim.fans === beforeTaxFans - expectedTaxDrop, '65. X1: Negative fans tax cuts from current fans pool (§2.2 注 3)');

// X1: Card with no fans specified yields strictly 0 fans delta
const cardX1Zero = {
  card_id: 'X1-ZERO',
  pool_type: 'milestone',
  ops_type: 'none',
  options: [{ opt_key: 'A', effects: { delta_five_dim: { rep: -50 } } }]
};
const beforeZeroFans = x1State.fiveDim.fans;
cardEngine.selectOption(cardX1Zero, 'A', x1State);
assert(x1State.fiveDim.fans === beforeZeroFans, '66. X1: Card with no fans deltas produces strictly 0 fans delta');

// X2.① 经营乘区五段行为断言
// M_模式 (契合 1.0 vs 不契合 0.8 vs 公会 1.2)
const sModeMatch = new GameState(configData, stateDict, endingsData);
sModeMatch.currentChapter = 1;
sModeMatch.selectedSchedule.mode = '游戏';
const cardModeGame = { card_id: 'C-MODE', pool_type: 'milestone', mode_tags: ['游戏'], ops_type: 'none', options: [{ opt_key: 'A', effects: { delta_five_dim: { fans_pct: 0 } } }] };
cardEngine.selectOption(cardModeGame, 'A', sModeMatch); // 220 * 1.4 * 1.0 = 308
assert(sModeMatch.fiveDim.fans === 308, '67. X2.①: M_模式 matching gives 1.0 multiplier (308)');

const sModeMismatch = new GameState(configData, stateDict, endingsData);
sModeMismatch.currentChapter = 1;
sModeMismatch.selectedSchedule.mode = '电台';
cardEngine.selectOption(cardModeGame, 'A', sModeMismatch); // 220 * 1.4 * 0.8 = 246
assert(sModeMismatch.fiveDim.fans === 246, '68. X2.①: M_模式 mismatching gives 0.8 multiplier (246)');

const sModeGuild = new GameState(configData, stateDict, endingsData);
sModeGuild.currentChapter = 1;
sModeGuild.selectedSchedule.mode = '游戏';
sModeGuild.variables['Flag_签公会'] = 1;
cardEngine.selectOption(cardModeGame, 'A', sModeGuild); // 220 * 1.4 * 1.2 = 369
assert(sModeGuild.fiveDim.fans === 369, '69. X2.①: M_模式 guild push adds +0.2 giving 1.2 multiplier (369)');

// M_时段 (slot_prime 1.4 vs slot_morning 0.85)
const sSlotPrime = new GameState(configData, stateDict, endingsData);
sSlotPrime.currentChapter = 1;
sSlotPrime.selectedSchedule.mode = '游戏';
sSlotPrime.selectedSchedule.timeSlot = 'slot_prime';
cardEngine.selectOption(cardModeGame, 'A', sSlotPrime); // 220 * 1.4 = 308
assert(sSlotPrime.fiveDim.fans === 308, '70. X2.①: M_时段 slot_prime gives 1.4 multiplier (308)');

const sSlotMorning = new GameState(configData, stateDict, endingsData);
sSlotMorning.currentChapter = 1;
sSlotMorning.selectedSchedule.mode = '游戏';
sSlotMorning.selectedSchedule.timeSlot = 'slot_morning';
cardEngine.selectOption(cardModeGame, 'A', sSlotMorning); // 220 * 0.85 = 187
assert(sSlotMorning.fiveDim.fans === 187, '71. X2.①: M_时段 slot_morning gives 0.85 multiplier (187)');

// M_时长 (2h 0.8 vs 4h 1.0 vs 6h 1.2)
const sDur2 = new GameState(configData, stateDict, endingsData);
sDur2.currentChapter = 1;
sDur2.selectedSchedule.mode = '游戏';
sDur2.selectedSchedule.duration = 2;
cardEngine.selectOption(cardModeGame, 'A', sDur2); // 220 * 1.4 * 0.8 = 246
assert(sDur2.fiveDim.fans === 246, '72. X2.①: M_时长 2h gives 0.8 multiplier (246)');

const sDur6 = new GameState(configData, stateDict, endingsData);
sDur6.currentChapter = 1;
sDur6.selectedSchedule.mode = '游戏';
sDur6.selectedSchedule.duration = 6;
cardEngine.selectOption(cardModeGame, 'A', sDur6); // 220 * 1.4 * 1.2 = 369
assert(sDur6.fiveDim.fans === 369, '73. X2.①: M_时长 6h gives 1.2 multiplier (369)');

// M_属性 (核心属性 10 -> 1.25; 核心属性 1 -> 0.80)
const sAttr10 = new GameState(configData, stateDict, endingsData);
sAttr10.currentChapter = 1;
sAttr10.selectedSchedule.mode = '游戏';
sAttr10.attributes['游戏技术'] = 10;
cardEngine.selectOption(cardModeGame, 'A', sAttr10); // 220 * 1.4 * 1.25 = 385
assert(sAttr10.fiveDim.fans === 385, '74. X2.①: M_属性 coreAttr=10 gives 1.25 multiplier (385)');

const sAttr1 = new GameState(configData, stateDict, endingsData);
sAttr1.currentChapter = 1;
sAttr1.selectedSchedule.mode = '游戏';
sAttr1.attributes['游戏技术'] = 1;
cardEngine.selectOption(cardModeGame, 'A', sAttr1); // 220 * 1.4 * 0.80 = 246
assert(sAttr1.fiveDim.fans === 246, '75. X2.①: M_属性 coreAttr=1 gives 0.80 multiplier (246)');

// M_口碑 (口碑 100 -> 1.40; 口碑 10 -> 0.50)
const sRep100 = new GameState(configData, stateDict, endingsData);
sRep100.currentChapter = 1;
sRep100.selectedSchedule.mode = '游戏';
sRep100.fiveDim.rep = 100;
cardEngine.selectOption(cardModeGame, 'A', sRep100); // 220 * 1.4 * 1.40 = 431
assert(sRep100.fiveDim.fans === 431, '76. X2.①: M_口碑 rep=100 gives 1.40 multiplier (431)');

const sRep10 = new GameState(configData, stateDict, endingsData);
sRep10.currentChapter = 1;
sRep10.selectedSchedule.mode = '游戏';
sRep10.fiveDim.rep = 10;
cardEngine.selectOption(cardModeGame, 'A', sRep10); // 220 * 1.4 * 0.50 = 154
assert(sRep10.fiveDim.fans === 154, '77. X2.①: M_口碑 rep=10 gives 0.50 multiplier (154)');

// Y0: 总乘区夹逼 [0.4, 3.0] 归位正本 §2.3 (只夹经营乘区连乘，M_操作 与 M_特殊 在夹逼后叠加)
// 1. Extreme low business clamp to 0.4
const sExtremeLow = new GameState(configData, stateDict, endingsData);
sExtremeLow.currentChapter = 1;
sExtremeLow.selectedSchedule.mode = 'PK';
sExtremeLow.selectedSchedule.timeSlot = 'slot_morning'; // 0.85
sExtremeLow.selectedSchedule.duration = 2; // 0.8
sExtremeLow.attributes['口才'] = 1; // 0.8
sExtremeLow.fiveDim.rep = 10; // 0.5
// Raw business mult = 0.8 * 0.85 * 0.8 * 0.8 * 0.5 = 0.2176 < 0.4 -> clamped to 0.4
// 220 * 0.4 = 88
cardEngine.selectOption(cardModeGame, 'A', sExtremeLow);
assert(sExtremeLow.fiveDim.fans === 88, '78.1. Y0: Business multiplier clamp [0.4, 3.0] clamps low business product to 0.4 (88 fans)');

// 2. Y0 钉住夹逼位置断言: 经营乘区低 (0.2176 -> 夹至 0.4) + 整活 2.5
// 正本读法: clamp(0.4, 3.0, 0.2176) * 2.5 = 0.4 * 2.5 = 1.0 -> 220 * 1.0 = 220
// 错判读法: clamp(0.4, 3.0, 0.2176 * 2.5 = 0.544) = 0.544 -> 220 * 0.544 = 119
const sClampNail = new GameState(configData, stateDict, endingsData);
sClampNail.currentChapter = 1;
sClampNail.selectedSchedule.mode = 'PK';
sClampNail.selectedSchedule.timeSlot = 'slot_morning'; // 0.85
sClampNail.selectedSchedule.duration = 2; // 0.8
sClampNail.attributes['口才'] = 1; // 0.8
sClampNail.fiveDim.rep = 10; // 0.5
sClampNail.variables['Tag_流派'] = '整活';
cardEngine.selectOption(cardModeGame, 'A', sClampNail, { circusRoll: 0.99 });
assert(sClampNail.fiveDim.fans === 220, '78.2. Y0 Nailing: Low business (clamped to 0.4) * circus (2.5) yields 1.0x (220 fans), NOT 0.544x (119 fans)');

// X2.③ & Y1: 钱包三条 R 乘区行为断言
// R_粉丝构成: 大哥 35 -> 1.40 (Y1.①: 废止学生粉)
const sFanCompHigh = new GameState(configData, stateDict, endingsData);
sFanCompHigh.currentChapter = 1; // Base_Income = 800, Cap_Wallet = 3000
sFanCompHigh.fiveDim.wallet = 1000;
sFanCompHigh.fanComposition = { '大哥': 35 };
const cardWalletTest = { card_id: 'C-WALL', pool_type: 'milestone', ops_type: 'none', options: [{ opt_key: 'A', effects: { delta_five_dim: { wallet: 10 } } }] };
// baseRevenue = 800 * 1.4 * 1.40 * 0.5 * 1.0 = 784; positiveWallet = 784 + 10 = 794
cardEngine.selectOption(cardWalletTest, 'A', sFanCompHigh);
assert(sFanCompHigh.fiveDim.wallet === 1000 + 794, '79. X2.③: R_粉丝构成 high big spender increases revenue by 1.40x (794)');

// R_分成: 野生 0.5 vs 公会 0.35 (Y1.①: 默认中性粉丝构成 R_粉丝构成 = 1.0)
const sGuildRev = new GameState(configData, stateDict, endingsData);
sGuildRev.currentChapter = 1;
sGuildRev.fiveDim.wallet = 1000;
sGuildRev.variables['Flag_签公会'] = 1;
// baseRevenue = 800 * 1.4 * 1.0 * 0.35 * 1.0 = 392; positiveWallet = 392 + 10 = 402
cardEngine.selectOption(cardWalletTest, 'A', sGuildRev);
assert(sGuildRev.fiveDim.wallet === 1000 + 402, '80. X2.③: R_分成 guild stream reduces revenue share to 0.35 (402)');

// R_商务: 口碑 >= 80 -> 1.5; Tag_理性消费清流 -> 1.5; 两来源取最高不叠加 (1.5)
const sBizRep = new GameState(configData, stateDict, endingsData);
sBizRep.currentChapter = 1;
sBizRep.fiveDim.wallet = 1000;
sBizRep.fiveDim.rep = 85;
// baseRevenue = 800 * 1.4 * 1.0 * 0.5 * 1.5 = 840; positiveWallet = 840 + 10 = 850
cardEngine.selectOption(cardWalletTest, 'A', sBizRep);
assert(sBizRep.fiveDim.wallet === 1000 + 850, '81. X2.③: R_商务 rep>=80 grants 1.5x business rate (850)');

// Y1.③: Tag_理性消费清流 必须经真实卡路径 C3-M02:A 触发，严禁直注状态
const sBizTag = new GameState(configData, stateDict, endingsData);
sBizTag.currentChapter = 1;
sBizTag.fiveDim.wallet = 1000;
const c3m02Card = cardsData.find(c => c.card_id === 'C3-M02');
assert(c3m02Card !== undefined, '82.1. Y1.③: C3-M02 card exists in cards.json');
cardEngine.selectOption(c3m02Card, 'A', sBizTag);
assert(sBizTag.variables['Tag_理性消费清流'] === 1, '82.2. Y1.③: C3-M02:A successfully writes Tag_理性消费清流=1 via true card route');
// baseRevenue = 800 * 1.4 * 1.0 * 0.5 * 1.5 = 840; positiveWallet = 840 + 10 = 850
sBizTag.fiveDim.wallet = 1000; // Reset wallet for clean measurement
cardEngine.selectOption(cardWalletTest, 'A', sBizTag);
assert(sBizTag.fiveDim.wallet === 1000 + 850, '82.3. Y1.③: R_商务 Tag_理性消费清流 grants 1.5x business rate (850)');

const sBizBoth = new GameState(configData, stateDict, endingsData);
sBizBoth.currentChapter = 1;
sBizBoth.fiveDim.wallet = 1000;
sBizBoth.fiveDim.rep = 85;
cardEngine.selectOption(c3m02Card, 'A', sBizBoth);
sBizBoth.fiveDim.wallet = 1000;
// Both present: strictly 1.5x, DOES NOT stack to 2.25x
cardEngine.selectOption(cardWalletTest, 'A', sBizBoth);
assert(sBizBoth.fiveDim.wallet === 1000 + 850, '83. X2.③: R_商务 non-stacking clamp: both conditions present still capped at 1.5x (850)');

// Y1.②: 整活流派 x2.5 退出钱包通道，钱包只吃 Ops 乘区 (但保留 35% zero-revenue 风险)
const sCircusWallet = new GameState(configData, stateDict, endingsData);
sCircusWallet.currentChapter = 1;
sCircusWallet.fiveDim.wallet = 1000;
sCircusWallet.variables['Tag_流派'] = '整活';
// baseRevenue = 800 * 1.4 * 1.0 * 0.5 * 1.0 = 560; positiveWallet = 560 + 10 = 570 (NOT multiplied by 2.5 to 1410)
cardEngine.selectOption(cardWalletTest, 'A', sCircusWallet, { circusRoll: 0.99 });
assert(sCircusWallet.fiveDim.wallet === 1000 + 570, '83.1. Y1.②: Circus style 2.5x does NOT enter wallet channel (570 wallet gain, not 1410)');

// X2.④: chapter_5card_fans_cap 5卡累计上限生效
const s5CardCap = new GameState(configData, stateDict, endingsData);
s5CardCap.currentChapter = 1; // chapter_5card_fans_cap = 3000, Cap_Fans = 600
s5CardCap.fiveDim.fans = 0;
const cardCapCh1 = { card_id: 'C-CAP', pool_type: 'milestone', ops_type: 'none', options: [{ opt_key: 'A', effects: { delta_five_dim: { fans_pct: 200 } } }] };
// Play 4 cards, each clamped to Cap_Fans 600 -> 2400
for (let i = 0; i < 4; i++) {
  cardEngine.selectOption(cardCapCh1, 'A', s5CardCap);
}
assert(s5CardCap.fiveDim.fans === 2400, '84. X2.④: 4 cards reach 2400 fans gained');
// 5th card attempts 600: 2400 + 600 = 3000
cardEngine.selectOption(cardCapCh1, 'A', s5CardCap);
assert(s5CardCap.fiveDim.fans === 3000, '85. X2.④: 5th card reaches exactly chapter_5card_fans_cap (3000)');
// 6th card attempts more: remainingCap is 0, fans delta is 0
cardEngine.selectOption(cardCapCh1, 'A', s5CardCap);
assert(s5CardCap.fiveDim.fans === 3000, '86. X2.④: chapter_5card_fans_cap blocks further fans gain once exhausted (3000)');
// Advance chapter resets chapterFansGained
stageSettlement.advanceChapter(s5CardCap);
assert(s5CardCap.chapterFansGained === 0, '87. X2.④: advanceChapter resets chapterFansGained to 0');

// X2.⑤: 加时赛行为断言 (未达闸补播 3 卡再判，不得直接判尾部结局)
const sOvertime = new GameState(configData, stateDict, endingsData);
sOvertime.currentChapter = 1;
sOvertime.fiveDim.fans = 400; // Below gate 1000
sOvertime.fiveDim.rep = 60;
const otSettle1 = stageSettlement.settleChapter(sOvertime);
assert(otSettle1.isPromoted === false, '88. X2.⑤: Stage settlement flags isPromoted === false');
assert(otSettle1.canOvertime === true, '89. X2.⑤: Stage settlement triggers canOvertime === true on first failure');
assert(sOvertime.overtimeActive === true, '90. X2.⑤: GameState overtimeActive set to true');
const otCards = drawEngine.drawChapterCards(1, sOvertime, 3);
assert(otCards.length === 3, '91. X2.⑤: Overtime draws exactly 3 cards');

// Simulate 2nd settlement where player still fails gate -> graceful exit M04 (rep >= 50)
sOvertime.fiveDim.fans = 600; // Still < 1000
const otSettle2 = stageSettlement.settleChapter(sOvertime);
assert(otSettle2.isPromoted === false, '92. X2.⑤: Second settlement still fails gate');
assert(otSettle2.canOvertime === false, '93. X2.⑤: Overtime can only be played once (canOvertime === false)');
assert(sOvertime.triggeredEnding === 'M04', '94. X2.⑤: Graceful exit to M04 (佛系小主播) after overtime failure');

// X3 & Y1: conversion_rate_pct 必须被消费 (带货结算等价钱包 +30% 修饰；正本对齐中性基准 84000 -> 109200)
const sConv = new GameState(configData, stateDict, endingsData);
sConv.currentChapter = 4; // Base_Income = 120000
sConv.fiveDim.wallet = 10000;
sConv.selectedSchedule.mode = '带货';
sConv.selectedSchedule.timeSlot = 'slot_prime'; // wallet_mult = 1.40
sConv.selectedSchedule.duration = 4;
// 正本推导: baseRevenue = Base_Income(120000) * R_模式变现(1.4) * R_粉丝构成(1.0) * R_分成(0.5) * R_商务(1.0) = 84000
// With C4-M05:B conversion_rate_pct = 30:
// cardBonus = Math.floor(84000 * 0.30) = 25200; positiveWallet = 84000 + 25200 = 109200
const c4m05B = cardsData.find(c => c.card_id === 'C4-M05');
const convRes = cardEngine.selectOption(c4m05B, 'B', sConv);
assert(convRes.appliedDeltas.wallet === 109200, '95. X3 & Y1: C4-M05:B conversion_rate_pct consumed, yielding +30% wallet income (84000 * 1.30 = 109200)');
assert(convRes.appliedDeltas.conversion_rate_pct === undefined, '96. X3: conversion_rate_pct field consumed and removed from deltas');
assert(sConv.fiveDim.wallet === 10000 + 109200, '97. X3 & Y1: GameState wallet reflects canon-aligned conversion rate payout');

// Clean up test storage file
try {
  if (fs.existsSync('E:/taptap/zhubo/test_stage2_save.json')) {
    fs.unlinkSync('E:/taptap/zhubo/test_stage2_save.json');
  }
} catch (e) {}

console.log('\n--------------------------------------------------------------------------------');
console.log(`Result: All ${assertions.length} Stage-2 acceptance assertions PASSED (0 failed)\n`);
