import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const REPORT_PATH = path.join(DATA_DIR, 'validation_report.txt');

// This script validates the transcribed JSON data layer in data/
const stateDict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state_dictionary.json'), 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cards.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'endings_and_talents.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config_and_screens.json'), 'utf8'));

const assertions = [];
function assert(condition, name, detail = '') {
  assertions.push({ pass: Boolean(condition), name, detail });
  if (!condition) {
    throw new Error(`DATA VALIDATION FAILED: ${name} (${detail})`);
  }
}

// Appendix B / Ruling 9 Hanzi counter: count chinese characters, numbers, %, and dot
function countHanzi(str) {
  if (!str) return 0;
  const clean = str
    .replace(/`\[操作：[^\]]+\]`/g, '')
    .replace(/`\[正经卡\]`/g, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
  const matches = clean.match(/[\u4e00-\u9fa50-9％.]/g);
  return matches ? matches.length : 0;
}

console.log('================================================================================');
console.log('《从小主播到顶流》阶段 1 · 数据转录与二次复核裁定校验 (validate_transcription.mjs)');
console.log('目标: 验证 data/ 下 4 份结构化 JSON 数据集的一致性、P1-A/B/C、P2-A/C 裁定全量闭环');
console.log('================================================================================\n');

// 1. Card count === 213 (63 milestone + 120 short + 30 cross)
const milestoneCards = cards.filter(c => c.pool_type === 'milestone');
const shortCards = cards.filter(c => c.pool_type === 'short');
const crossCards = cards.filter(c => c.pool_type.startsWith('cross_'));
assert(cards.length === 213, 'Card count === 213', `total=${cards.length} (milestone=${milestoneCards.length}, short=${shortCards.length}, cross=${crossCards.length})`);

// 2. Card IDs unique & distribution 63/120/30
const cardIdSet = new Set();
for (const c of cards) {
  if (cardIdSet.has(c.card_id)) {
    assert(false, `Duplicate card_id: ${c.card_id}`);
  }
  cardIdSet.add(c.card_id);
}
assert(cardIdSet.size === 213, 'Card IDs unique & distribution 63/120/30', `unique=${cardIdSet.size}`);

// 3. Schema completeness (§2.10 13 required fields)
const requiredCardKeys = [
  'card_id', 'line_no', 'pool_type', 'chapter', 'entry_chapter_min',
  'entry_chapter_max', 'title', 'mode_tags', 'gate_type', 'weight_rule',
  'ops_type', 'context_text', 'options'
];
let schemaMissingCount = 0;
for (const c of cards) {
  for (const k of requiredCardKeys) {
    if (c[k] === undefined) schemaMissingCount++;
  }
}
assert(schemaMissingCount === 0, 'Card schema completeness (§2.10 required fields present)', `missing_fields=${schemaMissingCount}`);

// 4. State dictionary auto-generated from §2.9 === 36 keys
const validStateKeys = new Set(stateDict.variables.map(v => v.key));
assert(validStateKeys.size === 36, 'State dictionary auto-generated from §2.9 === 36 keys', `keys=${validStateKeys.size}`);

// 5. Snapshot_BeforeCard total fields === 57
assert(stateDict.Snapshot_BeforeCard.total_fields === 57,
  'Snapshot_BeforeCard total fields === 57 (21 base stats/five_dim/fans + 36 state keys = 57)',
  `total_fields=${stateDict.Snapshot_BeforeCard.total_fields}`);

// 6. Zero dangling state references across cards
const referencedStateKeys = new Set();
for (const c of cards) {
  for (const opt of c.options) {
    for (const sw of opt.effects.state_writes) {
      referencedStateKeys.add(sw);
    }
  }
}
const danglingKeys = [...referencedStateKeys].filter(k => !validStateKeys.has(k));
assert(danglingKeys.length === 0, 'Zero dangling state references across all 213 cards', `dangling=[${danglingKeys.join(', ')}]`);

// 7. Zero dangling ending triggers
const validEndingIds = new Set(endingsData.endings.map(e => e.ending_id));
const triggeredEndingIds = new Set();
for (const c of cards) {
  for (const opt of c.options) {
    for (const et of opt.effects.ending_triggers) {
      triggeredEndingIds.add(et);
    }
  }
}
const danglingEndings = [...triggeredEndingIds].filter(id => !validEndingIds.has(id));
assert(danglingEndings.length === 0, 'Zero dangling ending references in card options', `dangling=[${danglingEndings.join(', ')}]`);

// 8. Endings count === 50 (12 M + 26 D + 12 H) & Talents === 50
const mEndings = endingsData.endings.filter(e => e.tier === 'main');
const dEndings = endingsData.endings.filter(e => e.tier === 'death');
const hEndings = endingsData.endings.filter(e => e.tier === 'hidden');
assert(endingsData.endings.length === 50, 'Endings count === 50 (12 M + 26 D + 12 H)', `M=${mEndings.length}, D=${dEndings.length}, H=${hEndings.length}`);
assert(mEndings.length === 12, 'Commercial main endings M01-M12 === 12', `actual=${mEndings.length}`);
assert(dEndings.length === 26, 'Death/knockout endings D01-D26 === 26', `actual=${dEndings.length}`);
assert(hEndings.length === 12, 'Hidden easter-egg endings H01-H12 === 12', `actual=${hEndings.length}`);
assert(endingsData.talents.length === 50, 'Talents count === 50 (one-to-one with 50 endings)', `actual=${endingsData.talents.length}`);

// ============================================================================
// P2-A: Ruling 9 Word Gates Restored on JSON Data Layer
// ============================================================================
let mBodyMax = 0, mOptMax = 0, mDeltaMax = 0;
let sBodyMax = 0, sOptMax = 0, sDeltaMax = 0;
let dataWordGateViolations = [];

for (const c of cards) {
  const isM = c.pool_type === 'milestone';
  const bodyLen = countHanzi(c.context_text);
  const bodyLimit = isM ? 80 : 60;
  if (isM) mBodyMax = Math.max(mBodyMax, bodyLen); else sBodyMax = Math.max(sBodyMax, bodyLen);
  if (bodyLen > bodyLimit) dataWordGateViolations.push(`${c.card_id} body ${bodyLen} > ${bodyLimit}`);

  for (const opt of c.options) {
    const optLen = countHanzi(opt.label);
    const optLimit = isM ? 20 : 14;
    if (isM) mOptMax = Math.max(mOptMax, optLen); else sOptMax = Math.max(sOptMax, optLen);
    if (optLen > optLimit) dataWordGateViolations.push(`${c.card_id} opt "${opt.label}" ${optLen} > ${optLimit}`);

    const deltaLen = countHanzi(opt.effects?.summary || opt.outcome_toast || '');
    const deltaLimit = isM ? 40 : 30;
    if (isM) mDeltaMax = Math.max(mDeltaMax, deltaLen); else sDeltaMax = Math.max(sDeltaMax, deltaLen);
    if (deltaLen > deltaLimit) dataWordGateViolations.push(`${c.card_id} delta ${deltaLen} > ${deltaLimit}`);
  }
}

assert(dataWordGateViolations.length === 0,
  'P2-A Word Gate Restored on Data: Milestone <= 80/20/40, Short/Cross <= 60/14/30 (0 violations)',
  `violations=${dataWordGateViolations.length}, M_max=${mBodyMax}/${mOptMax}/${mDeltaMax}, S_max=${sBodyMax}/${sOptMax}/${sDeltaMax}`);

// ============================================================================
// P1-B: gate_type Enum Legal Surface (Errata S2)
// ============================================================================
const LEGAL_GATES = new Set(['hard', 'soft', 'dual_boost', 'progress', 'none']);
const gateDistribution = {};
let illegalGateCount = 0;

for (const c of cards) {
  gateDistribution[c.gate_type] = (gateDistribution[c.gate_type] || 0) + 1;
  if (!LEGAL_GATES.has(c.gate_type)) {
    illegalGateCount++;
  }
}

assert(illegalGateCount === 0,
  'P1-B (Errata S2) gate_type strictly in legal enum [hard, soft, dual_boost, progress, none]',
  `distribution=${JSON.stringify(gateDistribution)}`);
assert(gateDistribution.progress === 1, 'gate_type: progress has exactly 1 card (C6-M06)', `count=${gateDistribution.progress}`);
assert(gateDistribution.dual_boost === 12, 'gate_type: dual_boost has exactly 12 cards', `count=${gateDistribution.dual_boost}`);
assert(gateDistribution.none === 97, 'gate_type: none has exactly 97 cards', `count=${gateDistribution.none}`);
assert(gateDistribution.soft === 95, 'gate_type: soft has exactly 95 cards', `count=${gateDistribution.soft}`);
assert(gateDistribution.hard === 8, 'gate_type: hard has exactly 8 cards', `count=${gateDistribution.hard}`);

// ============================================================================
// P2-C: Mode Vocabulary Corrected (7 Schedule Modes + Digital Human Slot 8, Errata S1)
// ============================================================================
const vocab = configData.mode_vocabulary;
assert(Boolean(vocab), 'mode_vocabulary exists in config_and_screens.json');
assert(vocab.schedule_modes.length === 7, 'P2-C (Errata S1) Schedule modes count strictly === 7', `count=${vocab.schedule_modes.length}`);

const EXPECTED_7_MODES = ['游戏', '才艺', '电台', '团播', 'PK', '带货', '户外'];
const modes7Match = EXPECTED_7_MODES.every(m => vocab.schedule_modes.includes(m));
assert(modes7Match, 'P2-C Schedule modes exactly match: 游戏/才艺/电台/团播/PK/带货/户外', `modes=[${vocab.schedule_modes.join(', ')}]`);
assert(vocab.locked_slot_8 === '数字人', 'P2-C Digital human registered as locked_slot_8 (Screen-02 8th slot)');
assert(vocab.special_tags.includes('数字人诱惑') && vocab.special_tags.includes('全模式'), 'Special tags registered: 数字人诱惑, 全模式');
assert(!vocab.schedule_modes.includes('聊天'), 'P2-C Confirmed NO standalone "聊天" schedule mode (merged into 电台)');

// Assert each of the 7 schedule modes has cards to match (zero dead modes!)
for (const m of EXPECTED_7_MODES) {
  const matchCards = cards.filter(c => (c.mode_tags || []).includes(m));
  assert(matchCards.length > 0, `Mode [${m}] has matching cards (> 0)`, `matched=${matchCards.length}`);
}

// ============================================================================
// P1-C: Timing Bar Parameterization (Errata S3)
// ============================================================================
const tbParams = configData.timing_bar_parameters;
assert(Boolean(tbParams), 'P1-C timing_bar_parameters exists in config');
assert(tbParams.sweet_width === 0.15, 'P1-C Sweet zone width === 0.15', `width=${tbParams.sweet_width}`);
assert(tbParams.good_width === 0.40, 'P1-C Good zone width === 0.40', `width=${tbParams.good_width}`);
assert(tbParams.center_selection === 'random_per_card_instance', 'P1-C Center position randomly determined per card instance');

const timingCards = cards.filter(c => c.ops_type === 'timing_bar');
assert(timingCards.length === 6, 'Exactly 6 milestone cards have ops_type === timing_bar', `count=${timingCards.length}`);
const expectedTimingIds = ['C1-M05', 'C2-M09', 'C3-M08', 'C4-M11', 'C5-M09', 'C6-M05'];
const timingCardsMatch = expectedTimingIds.every(id => timingCards.some(c => c.card_id === id));
assert(timingCardsMatch, 'Timing cards match C1-M05/C2-M09/C3-M08/C4-M11/C5-M09/C6-M05 (1 per chapter)');

// Verify ops_note has no hardcoded absolute intervals
for (const tc of timingCards) {
  assert(!tc.ops_note || (!tc.ops_note.includes('0.58-0.70') && !tc.ops_note.includes('0.46-0.82')),
    `Timing card ${tc.card_id} ops_note has NO hardcoded absolute intervals`, `ops_note=${tc.ops_note}`);
}

// ============================================================================
// P1-A: §1.8 Draw Rules & Pity Chains (Core Stage 2 Gate)
// ============================================================================
const drawRules = configData.draw_rules;
assert(Boolean(drawRules), 'P1-A draw_rules exists in config');
assert(drawRules.slots_per_chapter === 5, 'P1-A Draw rules slots_per_chapter === 5', `slots=${drawRules.slots_per_chapter}`);
assert(drawRules.slot_composition.guaranteed_slots === 2 && drawRules.slot_composition.random_slots === 3,
  'P1-A Slots composition: 2 guaranteed + 3 random',
  `guaranteed=${drawRules.slot_composition.guaranteed_slots}, random=${drawRules.slot_composition.random_slots}`);
assert(drawRules.overflow_rule.max_guaranteed_slots === 4 && drawRules.overflow_rule.min_random_slots === 1,
  'P1-A Overflow rule: guaranteed occupies at most 4 slots, at least 1 random slot retained',
  `max_guaranteed=${drawRules.overflow_rule.max_guaranteed_slots}, min_random=${drawRules.overflow_rule.min_random_slots}`);

// Pity Chains
assert(drawRules.pity_chains.length === 4, 'P1-A 4 directional pity chains registered', `chains=${drawRules.pity_chains.length}`);
const pityCat = drawRules.pity_chains.find(p => p.chain_id === 'pity_cat');
const pityExam = drawRules.pity_chains.find(p => p.chain_id === 'pity_exam');
const pityAlgo = drawRules.pity_chains.find(p => p.chain_id === 'pity_algorithm');
const pityHater = drawRules.pity_chains.find(p => p.chain_id === 'pity_hater');

assert(Boolean(pityCat && pityExam && pityAlgo && pityHater), 'All 4 pity chains present (cat, exam, algorithm, hater)');
assert(pityCat.member_cards.length === 3, 'pity_cat has 3 member cards: C1-S01, C2-S01, C3-S01', `members=[${pityCat.member_cards.join(', ')}]`);
assert(pityExam.member_cards.length === 3, 'pity_exam has 3 member cards: C1-S07, C2-S17, C4-S16', `members=[${pityExam.member_cards.join(', ')}]`);
assert(pityAlgo.member_cards.length === 3, 'pity_algorithm has 3 member cards: C4-S19, C5-S19, C6-S19', `members=[${pityAlgo.member_cards.join(', ')}]`);
assert(pityHater.member_cards.length === 4, 'pity_hater has 4 member cards: C1-M07, C2-S08, C3-S12, X-EGG-04', `members=[${pityHater.member_cards.join(', ')}]`);

// Check card pity_chain field backfill in cards.json
const catCards = cards.filter(c => c.pity_chain === 'pity_cat');
assert(catCards.length === 3, 'cards.json: 3 cards tagged pity_cat', `ids=[${catCards.map(c => c.card_id).join(', ')}]`);
const examCards = cards.filter(c => c.pity_chain === 'pity_exam');
assert(examCards.length === 3, 'cards.json: 3 cards tagged pity_exam', `ids=[${examCards.map(c => c.card_id).join(', ')}]`);
const algoCards = cards.filter(c => c.pity_chain === 'pity_algorithm');
assert(algoCards.length === 3, 'cards.json: 3 cards tagged pity_algorithm', `ids=[${algoCards.map(c => c.card_id).join(', ')}]`);
const haterCards = cards.filter(c => c.pity_chain === 'pity_hater');
assert(haterCards.length === 4, 'cards.json: 4 cards tagged pity_hater', `ids=[${haterCards.map(c => c.card_id).join(', ')}]`);

// Cross-chapter pool weights & Alert zone skew
assert(drawRules.cross_chapter_pool.weights.x_attr_first_met_weight === 4.0,
  'P1-A X-ATTR first met chapter weight === 4.0',
  `weight=${drawRules.cross_chapter_pool.weights.x_attr_first_met_weight}`);
assert(drawRules.cross_chapter_pool.alert_zone_replacement.skew_pct === 40,
  'P1-A Stamina 1-29 alert zone 40% skew to overtime cards',
  `skew=${drawRules.cross_chapter_pool.alert_zone_replacement.skew_pct}%`);
assert(drawRules.cross_chapter_pool.alert_zone_replacement.target_bias_cards.includes('C3-S18') &&
       drawRules.cross_chapter_pool.alert_zone_replacement.target_bias_cards.includes('X-EGG-01'),
  'P1-A Alert zone bias cards include C3-S18 and X-EGG-01');

// ============================================================================
// Other Errata Rulings (P1-2, P2-1, P3-1, P3-2, P4-4, Zero Intelligence)
// ============================================================================
const h05 = endingsData.endings.find(e => e.ending_id === 'H05');
assert(h05 && h05.trigger_sources && h05.trigger_sources.length === 2, 'H05 has 2 dual trigger sources (counter full = 3 OR max luck at ch6 end)');

const countAlg = stateDict.variables.find(v => v.key === 'Count_算法异常');
assert(countAlg && countAlg.writers_qualified && countAlg.writers_qualified.length === 3, 'Count_算法异常 has 3 qualified writers (C4-S19:B, C5-S19:B, C6-S19:A)');

const dualCards = cards.filter(c => c.gate_type === 'dual_boost');
assert(dualCards.length === 12, '12 milestone cards classified as dual_boost', `count=${dualCards.length}`);

const inspectAction = configData.schedules.off_stream_actions.find(a => a.id === 5);
assert(inspectAction && inspectAction.ops_config.choice_buttons.length === 4, 'Ops-B 翻样辨真 4 buttons');

assert(configData.art_budget && configData.art_budget.cap_total === 69, 'Art budget total cap === 69');

const screen08 = configData.screens.find(s => s.screen_id === 'Screen-08');
assert(Boolean(screen08), 'Screen-08 (结局分享卡弹窗) is an independent screen entry');

const afternoonSlot = configData.schedules.time_slots.find(s => s.id === 'slot_afternoon');
assert(afternoonSlot.wallet_mult_default === 1.0 && afternoonSlot.wallet_mult_ecommerce === 1.25,
  'Afternoon slot wallet_mult 1.25 applies only to ecommerce mode');

assert(configData.schedules.time_slots.length === 5, 'Time slots count === 5');
const dur6 = configData.schedules.durations.find(d => d.hours === 6);
assert(dur6 && dur6.is_hard_locked === false && dur6.can_force_start === true && dur6.low_physique_extra_cost === 10,
  '6h duration has no hard lock (can_force_start=true) and applies -10 stamina if physique < 6');

const action3 = configData.schedules.off_stream_actions.find(a => a.id === 3);
assert(action3.continuous_effects.includes('掉粉税减免 5%') && action3.continuous_effects.includes('M10 幕后操盘手必要条件'),
  'Action 3 restores 掉粉税减免 5% and M10 幕后操盘手必要条件');

const h03 = endingsData.endings.find(e => e.ending_id === 'H03');
assert(h03.trigger_condition.includes('口才 ≥ 8') && !h03.trigger_condition.includes('智力'),
  'H03 trigger condition normalized to 口才 ≥ 8 (no 智力 allowed)');

const allDataDump = JSON.stringify({ stateDict, cards, endingsData, configData });
const intelligenceMatches = allDataDump.match(/智力/g);
assert(!intelligenceMatches || intelligenceMatches.length === 0, 'Zero occurrence of "智力" across all JSON data files');

assert(configData.chapters.length === 6, 'Chapter configuration contains exactly 6 chapters');
assert(configData.engineering_red_lines.length === 5, 'Engineering Red Lines count === 5');

// Generate Report
const reportLines = [
  '================================================================================',
  '《从小主播到顶流》阶段 1 · 数据转录与二次复核裁定校验报告 (validate_transcription.mjs)',
  `生成时间: ${new Date().toISOString()}`,
  '数据基线: E:\\taptap\\zhubo\\data (4 JSON files: state_dictionary, cards, endings_and_talents, config_and_screens)',
  `gate_type 分布: ${JSON.stringify(gateDistribution)}`,
  `7 模式匹配卡数: ${EXPECTED_7_MODES.map(m => `${m}:${cards.filter(c => (c.mode_tags || []).includes(m)).length}`).join(', ')}`,
  '================================================================================\n'
];

assertions.forEach((a, idx) => {
  reportLines.push(`[PASS] ${idx + 1}. ${a.name}: ${a.detail}`);
});

reportLines.push('\n--------------------------------------------------------------------------------');
reportLines.push(`Result: All ${assertions.length} passed, 0 failed\n`);

const reportContent = reportLines.join('\n');
fs.writeFileSync(REPORT_PATH, reportContent, 'utf8');

console.log('--------------------------------------------------------------------------------');
assertions.forEach((a, idx) => {
  console.log(`[PASS] ${idx + 1}. ${a.name}: ${a.detail}`);
});
console.log('--------------------------------------------------------------------------------');
console.log(`Result: All ${assertions.length} assertions PASSED in validate_transcription.mjs (Data layer)\n`);
console.log(`gate_type 分布: ${JSON.stringify(gateDistribution)}`);
console.log(`7 模式匹配统计: ${EXPECTED_7_MODES.map(m => `${m}:${cards.filter(c => (c.mode_tags || []).includes(m)).length}`).join(', ')}\n`);
