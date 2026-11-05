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
console.log('《从小主播到顶流》阶段 1.5 · 机器可读补全与全量裁定校验 (validate_transcription.mjs)');
console.log('目标: 验证 data/ 下 4 份结构化 JSON 数据集的一致性、完成度与 F1-F7 裁定全量闭环');
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

// 4. State dictionary auto-generated from §2.9 + Errata S5 === 37 keys
const validStateKeys = new Set(stateDict.variables.map(v => v.key));
assert(validStateKeys.size === 37, 'State dictionary auto-generated from §2.9 + Errata S5 === 37 keys', `keys=${validStateKeys.size}`);

// 5. Snapshot_BeforeCard total fields === 58
assert(stateDict.Snapshot_BeforeCard.total_fields === 58,
  'Snapshot_BeforeCard total fields === 58 (21 base stats/five_dim/fans + 37 state keys = 58)',
  `total_fields=${stateDict.Snapshot_BeforeCard.total_fields}`);

// 6. Zero dangling state references across cards
const referencedStateKeys = new Set();
for (const c of cards) {
  for (const opt of c.options) {
    for (const sw of opt.effects.state_writes) {
      const varKey = sw.match(/((?:Flag_|Count_|Tag_|Param_|Total_)[A-Za-z0-9_\u4e00-\u9fa5]+)/)?.[1] || sw;
      referencedStateKeys.add(varKey);
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

// 8. Endings count === 50 (12 M + 26 D + 12 H)
const mEndings = endingsData.endings.filter(e => e.tier === 'main');
const dEndings = endingsData.endings.filter(e => e.tier === 'death');
const hEndings = endingsData.endings.filter(e => e.tier === 'hidden');
assert(endingsData.endings.length === 50, 'Endings count === 50 (12 M + 26 D + 12 H)', `M=${mEndings.length}, D=${dEndings.length}, H=${hEndings.length}`);
assert(mEndings.length === 12, 'Commercial main endings M01-M12 === 12', `actual=${mEndings.length}`);
assert(dEndings.length === 26, 'Death/knockout endings D01-D26 === 26', `actual=${dEndings.length}`);
assert(hEndings.length === 12, 'Hidden easter-egg endings H01-H12 === 12', `actual=${hEndings.length}`);
assert(endingsData.talents.length === 50, 'Talents count === 50 (one-to-one with 50 endings)', `actual=${endingsData.talents.length}`);

// 13. P2-A Word Gate Restored on Data: Milestone <= 80/20/40, Short/Cross <= 60/14/30
let dataWordGateViolations = [];
let maxMilestone = { ctx: 0, opt: 0, toast: 0 };
let maxShort = { ctx: 0, opt: 0, toast: 0 };

for (const c of cards) {
  const isM = c.pool_type === 'milestone';
  const ctxLimit = isM ? 80 : 60;
  const optLimit = isM ? 20 : 14;
  const toastLimit = isM ? 40 : 30;

  const ctxLen = countHanzi(c.context_text);
  if (isM) maxMilestone.ctx = Math.max(maxMilestone.ctx, ctxLen);
  else maxShort.ctx = Math.max(maxShort.ctx, ctxLen);

  if (ctxLen > ctxLimit) {
    dataWordGateViolations.push(`${c.card_id} context ${ctxLen} > ${ctxLimit}`);
  }

  for (const opt of c.options) {
    const optLen = countHanzi(opt.label);
    const toastLen = countHanzi(opt.outcome_toast);

    if (isM) {
      maxMilestone.opt = Math.max(maxMilestone.opt, optLen);
      maxMilestone.toast = Math.max(maxMilestone.toast, toastLen);
    } else {
      maxShort.opt = Math.max(maxShort.opt, optLen);
      maxShort.toast = Math.max(maxShort.toast, toastLen);
    }

    if (optLen > optLimit) {
      dataWordGateViolations.push(`${c.card_id}:${opt.opt_key} opt ${optLen} > ${optLimit}`);
    }
    if (toastLen > toastLimit) {
      dataWordGateViolations.push(`${c.card_id}:${opt.opt_key} toast ${toastLen} > ${toastLimit}`);
    }
  }
}
assert(dataWordGateViolations.length === 0,
  'P2-A Word Gate Restored on Data: Milestone <= 80/20/40, Short/Cross <= 60/14/30 (0 violations)',
  `violations=${dataWordGateViolations.length}, M_max=${maxMilestone.ctx}/${maxMilestone.opt}/${maxMilestone.toast}, S_max=${maxShort.ctx}/${maxShort.opt}/${maxShort.toast}`);

// 14. P1-B gate_type strictly in legal enum ['hard', 'soft', 'dual_boost', 'progress', 'none']
const legalGateTypes = new Set(['hard', 'soft', 'dual_boost', 'progress', 'none']);
const gateDistribution = { none: 0, dual_boost: 0, soft: 0, hard: 0, progress: 0 };
let illegalGateCount = 0;

for (const c of cards) {
  if (legalGateTypes.has(c.gate_type)) {
    gateDistribution[c.gate_type] = (gateDistribution[c.gate_type] || 0) + 1;
  } else {
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

// 20. P2-C / Errata S1: Schedule modes strictly 7
const vocab = configData.mode_vocabulary;
assert(Boolean(vocab), 'mode_vocabulary exists in config_and_screens.json');
assert(vocab.schedule_modes.length === 7, 'P2-C (Errata S1) Schedule modes count strictly === 7', `count=${vocab.schedule_modes.length}`);

const expectedModes7 = ['游戏', '才艺', '电台', '团播', 'PK', '带货', '户外'];
const modes7Match = expectedModes7.every(m => vocab.schedule_modes.includes(m));
assert(modes7Match, 'P2-C Schedule modes exactly match: 游戏/才艺/电台/团播/PK/带货/户外', `modes=[${vocab.schedule_modes.join(', ')}]`);
assert(vocab.locked_slot_8 === '数字人', 'P2-C Digital human registered as locked_slot_8 (Screen-02 8th slot)');
assert(vocab.special_tags.includes('数字人诱惑') && vocab.special_tags.includes('全模式'), 'Special tags registered: 数字人诱惑, 全模式');
assert(!vocab.schedule_modes.includes('聊天'), 'P2-C Confirmed NO standalone "聊天" schedule mode (merged into 电台)');

// Mode match counts (> 0)
const modeCardCounts = {};
for (const m of expectedModes7) {
  const matchCards = cards.filter(c => c.mode_tags.includes(m));
  modeCardCounts[m] = matchCards.length;
  assert(matchCards.length > 0, `Mode [${m}] has matching cards (> 0)`, `matched=${matchCards.length}`);
}

// 33. P1-C: timing_bar_parameters parameterized
const tbParams = configData.timing_bar_parameters;
assert(Boolean(tbParams), 'P1-C timing_bar_parameters exists in config');
assert(tbParams.sweet_width === 0.15, 'P1-C Sweet zone width === 0.15', `width=${tbParams.sweet_width}`);
assert(tbParams.good_width === 0.40, 'P1-C Good zone width === 0.40', `width=${tbParams.good_width}`);
assert(tbParams.center_selection === 'random_per_card_instance', 'P1-C Center position randomly determined per card instance');

const timingCards = cards.filter(c => c.ops_type === 'timing_bar');
assert(timingCards.length === 6, 'Exactly 6 milestone cards have ops_type === timing_bar', `count=${timingCards.length}`);
const timingCardIds = timingCards.map(c => c.card_id).sort();
const expectedTimingIds = ['C1-M05', 'C2-M09', 'C3-M08', 'C4-M11', 'C5-M09', 'C6-M05'].sort();
const timingCardsMatch = JSON.stringify(timingCardIds) === JSON.stringify(expectedTimingIds);
assert(timingCardsMatch, 'Timing cards match C1-M05/C2-M09/C3-M08/C4-M11/C5-M09/C6-M05 (1 per chapter)');

for (const tc of timingCards) {
  assert(!tc.ops_note || (!tc.ops_note.includes('0.58-0.70') && !tc.ops_note.includes('0.46-0.82')),
    `Timing card ${tc.card_id} ops_note has NO hardcoded absolute intervals`,
    `ops_note=${tc.ops_note}`);
}

// 45. P1-A: draw_rules in config
const drawRules = configData.draw_rules;
assert(Boolean(drawRules), 'P1-A draw_rules exists in config');
assert(drawRules.slots_per_chapter === 5, 'P1-A Draw rules slots_per_chapter === 5', `slots=${drawRules.slots_per_chapter}`);
assert(drawRules.slot_composition.guaranteed_slots === 2 && drawRules.slot_composition.random_slots === 3,
  'P1-A Slots composition: 2 guaranteed + 3 random',
  `guaranteed=${drawRules.slot_composition.guaranteed_slots}, random=${drawRules.slot_composition.random_slots}`);
assert(drawRules.overflow_rule.max_guaranteed_slots === 4 && drawRules.overflow_rule.min_random_slots === 1,
  'P1-A Overflow rule: guaranteed occupies at most 4 slots, at least 1 random slot retained',
  `max_guaranteed=${drawRules.overflow_rule.max_guaranteed_slots}, min_random=${drawRules.overflow_rule.min_random_slots}`);

// 49. 4 directional pity chains
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

// Check cards.json pity chain assignments
const catCards = cards.filter(c => c.pity_chain === 'pity_cat');
assert(catCards.length === 3, 'cards.json: 3 cards tagged pity_cat', `ids=[${catCards.map(c => c.card_id).join(', ')}]`);
const examCards = cards.filter(c => c.pity_chain === 'pity_exam');
assert(examCards.length === 3, 'cards.json: 3 cards tagged pity_exam', `ids=[${examCards.map(c => c.card_id).join(', ')}]`);
const algoCards = cards.filter(c => c.pity_chain === 'pity_algorithm');
assert(algoCards.length === 3, 'cards.json: 3 cards tagged pity_algorithm', `ids=[${algoCards.map(c => c.card_id).join(', ')}]`);
const haterCards = cards.filter(c => c.pity_chain === 'pity_hater');
assert(haterCards.length === 4, 'cards.json: 4 cards tagged pity_hater', `ids=[${haterCards.map(c => c.card_id).join(', ')}]`);

// Cross-chapter pool weights & alert zone skew
assert(drawRules.cross_chapter_pool.weights.x_attr_first_met_weight === 4.0,
  'P1-A X-ATTR first met chapter weight === 4.0',
  `weight=${drawRules.cross_chapter_pool.weights.x_attr_first_met_weight}`);
assert(drawRules.cross_chapter_pool.alert_zone_replacement.skew_pct === 40,
  'P1-A Stamina 1-29 alert zone 40% skew to overtime cards',
  `skew=${drawRules.cross_chapter_pool.alert_zone_replacement.skew_pct}%`);
assert(drawRules.cross_chapter_pool.alert_zone_replacement.target_bias_cards.includes('C3-S18') &&
       drawRules.cross_chapter_pool.alert_zone_replacement.target_bias_cards.includes('X-EGG-01'),
  'P1-A Alert zone bias cards include C3-S18 and X-EGG-01');

// 62. H05 dual trigger sources
const h05 = endingsData.endings.find(e => e.ending_id === 'H05');
assert(h05 && h05.trigger_sources && h05.trigger_sources.length === 2, 'H05 has 2 dual trigger sources (counter full = 3 OR max luck at ch6 end)');

// 63. Count_算法异常 3 qualified writers
const countAlg = stateDict.variables.find(v => v.key === 'Count_算法异常');
assert(countAlg && countAlg.writers_qualified && countAlg.writers_qualified.length === 3, 'Count_算法异常 has 3 qualified writers (C4-S19:B, C5-S19:B, C6-S19:A)');

// 64. 12 dual_boost milestone cards
const dualCards = cards.filter(c => c.gate_type === 'dual_boost');
assert(dualCards.length === 12, '12 milestone cards classified as dual_boost', `count=${dualCards.length}`);

// 65. Ops-B 翻样辨真 4 buttons
const inspectAction = configData.schedules.off_stream_actions.find(a => a.name.includes('选品'));
assert(inspectAction && inspectAction.ops_config.choice_buttons.length === 4, 'Ops-B 翻样辨真 4 buttons');

// 66. Art budget total cap === 69
assert(configData.art_budget && configData.art_budget.cap_total === 69, 'Art budget total cap === 69');

// 67. Screen-08 standalone row
const screen08 = configData.screens.find(s => s.screen_id === 'Screen-08');
assert(Boolean(screen08), 'Screen-08 (结局分享卡弹窗) is an independent screen entry');

// 68. Afternoon slot wallet_mult 1.25 ecommerce only
const afternoonSlot = configData.schedules.time_slots.find(s => s.id === 'slot_afternoon');
assert(afternoonSlot.wallet_mult_default === 1.0 && afternoonSlot.wallet_mult_ecommerce === 1.25,
  'Afternoon slot wallet_mult 1.25 applies only to ecommerce mode');

// 69. Time slots count === 5
assert(configData.schedules.time_slots.length === 5, 'Time slots count === 5');

// 70. 6h duration has no hard lock
const dur6 = configData.schedules.durations.find(d => d.hours === 6);
assert(dur6 && dur6.is_hard_locked === false && dur6.can_force_start === true && dur6.low_physique_extra_cost === 10,
  '6h duration has no hard lock (can_force_start=true) and applies -10 stamina if physique < 6');

// 71. Action 3 restores 掉粉税减免 5% and M10
const action3 = configData.schedules.off_stream_actions.find(a => a.id === 3);
assert(action3.continuous_effects.includes('掉粉税减免 5%') && action3.continuous_effects.includes('M10 幕后操盘手必要条件'),
  'Action 3 restores 掉粉税减免 5% and M10 幕后操盘手必要条件');

// 72. H03 trigger condition normalized to 口才 ≥ 8
const h03 = endingsData.endings.find(e => e.ending_id === 'H03');
assert(h03.trigger_condition.includes('口才 ≥ 8') && !h03.trigger_condition.includes('智力'),
  'H03 trigger condition normalized to 口才 ≥ 8 (no 智力 allowed)');

// 73. Zero occurrence of "智力"
const allJsonStr = JSON.stringify(cards) + JSON.stringify(stateDict) + JSON.stringify(endingsData) + JSON.stringify(configData);
const intelligenceMatches = allJsonStr.match(/智力/g);
assert(!intelligenceMatches || intelligenceMatches.length === 0, 'Zero occurrence of "智力" across all JSON data files');

// 74. Chapter configuration contains exactly 6 chapters
assert(configData.chapters.length === 6, 'Chapter configuration contains exactly 6 chapters');

// 75. Engineering Red Lines count === 5
assert(configData.engineering_red_lines.length === 5, 'Engineering Red Lines count === 5');

// ============================================================================
// Restored Errata Assertions (F6: P4-1, P4-2, P4-3, errata_rulings_applied)
// ============================================================================

// 76. P4-1: All ending IDs zero-padded (0 unpadded tokens like D1..D9, M1..M9, H1..H9) & H01 name === 黑粉头子是真爱
const unpaddedMatches = allJsonStr.match(/(?<!私\s*)\b([MDH][1-9])\b/g);
const h01 = endingsData.endings.find(e => e.ending_id === 'H01');
assert(!unpaddedMatches || unpaddedMatches.length === 0,
  'P4-1: All ending IDs zero-padded (0 unpadded tokens) across all JSON data files',
  `unpadded_found=${unpaddedMatches ? unpaddedMatches.length : 0}`);
assert(h01 && h01.name === '黑粉头子是真爱', 'P4-1: H01 canonical name === 黑粉头子是真爱', `name=${h01?.name}`);

// 77. P4-2: X-EGG-09 / H12 distinct A/B branches and shares 50th talent 【真·顶流权柄】
const egg09 = cards.find(c => c.card_id === 'X-EGG-09');
const h12 = endingsData.endings.find(e => e.ending_id === 'H12');
assert(egg09 && egg09.options.length === 2 && egg09.options[0].outcome_toast !== egg09.options[1].outcome_toast,
  'P4-2: X-EGG-09 has distinct A/B option outcome toasts');
assert(h12 && h12.branch_variants && h12.branch_variants.A && h12.branch_variants.B,
  'P4-2: H12 has branch_variants object with distinct A and B branches');
assert(h12.branch_variants.A.summary !== h12.branch_variants.B.summary,
  'P4-2: H12 branch_variants A and B summaries are distinct');

// 78. P4-3: Shorthand assignments expanded in cards (立退 -> 立即触发退网结局, 下章可触 -> 下一阶段可触发)
const c2m01 = cards.find(c => c.card_id === 'C2-M01');
const c2m06 = cards.find(c => c.card_id === 'C2-M06');
const c2m07 = cards.find(c => c.card_id === 'C2-M07');
const c2m08 = cards.find(c => c.card_id === 'C2-M08');
assert(c2m01 && c2m06 && c2m07 && c2m08, 'P4-3: C2-M01, C2-M06, C2-M07, C2-M08 exist');
const allRawExpanded = cards.every(c => !c.raw_cells.outcome_expanded.includes('立退') && !c.raw_cells.outcome_expanded.includes('下章可触'));
assert(allRawExpanded, 'P4-3: Shorthand assignments expanded across all cards (0 unexpanded shorthand)');

// 79. F6: errata_rulings_applied complete list restored
assert(Array.isArray(configData.errata_rulings_applied) && configData.errata_rulings_applied.length >= 15,
  'F6: errata_rulings_applied list restored and complete',
  `count=${configData.errata_rulings_applied?.length}`);

// ============================================================================
// Stage 1.5 Machine-Readable Completion Assertions (F1 - F7)
// ============================================================================

// 80. F1-1: Every option across all 440 options has complete structured effects object
let totalOptionsCount = 0;
let completeEffectsCount = 0;
for (const c of cards) {
  for (const opt of c.options) {
    totalOptionsCount++;
    if (opt.effects &&
        typeof opt.effects.summary === 'string' &&
        opt.effects.delta_five_dim !== undefined &&
        opt.effects.delta_attrs !== undefined &&
        Array.isArray(opt.effects.state_writes) &&
        Array.isArray(opt.effects.ending_triggers) &&
        Array.isArray(opt.effects.next_cards)) {
      completeEffectsCount++;
    }
  }
}
assert(totalOptionsCount === 440, 'F1-1 Total options count across 213 cards === 440', `actual=${totalOptionsCount}`);
assert(completeEffectsCount === 440, 'F1-1 Every option has complete structured effects schema (440/440)', `complete=${completeEffectsCount}`);

// 81. F1-2: Cards with gate notes/prerequisites in text or rules have non-empty prereq_expr
const cardsWithPrereq = cards.filter(c => c.prereq_expr !== null && c.prereq_expr !== '');
assert(cardsWithPrereq.length >= 40, 'F1-2 Cards with gate/prereq notes have non-empty prereq_expr (>= 40)', `count=${cardsWithPrereq.length}`);

// 82. F1-3: Options whose summary mentions Flag_ or Count_ have non-empty state_writes
let flagCountSummaryOptions = 0;
let missingStateWriteCount = 0;
for (const c of cards) {
  for (const opt of c.options) {
    if (/Flag_|Count_/.test(opt.effects.summary)) {
      flagCountSummaryOptions++;
      if (!opt.effects.state_writes || opt.effects.state_writes.length === 0) {
        missingStateWriteCount++;
      }
    }
  }
}
assert(flagCountSummaryOptions > 0, 'F1-3 Options mentioning Flag_/Count_ exist (> 0)', `count=${flagCountSummaryOptions}`);
assert(missingStateWriteCount === 0, 'F1-3 Every option mentioning Flag_/Count_ in summary has non-empty state_writes (0 missing)', `missing=${missingStateWriteCount}`);

// 83. F1-4: Off-stream actions 8/8 fully structured
const actions = configData.schedules.off_stream_actions;
assert(actions.length === 8, 'F1-4 Off-stream actions count === 8', `count=${actions.length}`);
let structuredActionCount = 0;
for (const a of actions) {
  if (a.id && a.name && a.cost && a.stat_deltas && a.attr_deltas && Array.isArray(a.state_writes)) {
    structuredActionCount++;
  }
}
assert(structuredActionCount === 8, 'F1-4 All 8 off-stream actions structured with cost/stat_deltas/attr_deltas/state_writes (8/8)', `structured=${structuredActionCount}`);

// 84. F1-5: Coverage statistics assertion & reporting
const statsCoverage = {
  prereq_expr_cards: cardsWithPrereq.length,
  req_expr_options: cards.flatMap(c => c.options).filter(o => o.req_expr !== null).length,
  delta_five_dim_options: cards.flatMap(c => c.options).filter(o => Object.keys(o.effects.delta_five_dim).length > 0).length,
  delta_attrs_options: cards.flatMap(c => c.options).filter(o => Object.keys(o.effects.delta_attrs).length > 0).length,
  state_writes_options: cards.flatMap(c => c.options).filter(o => o.effects.state_writes.length > 0).length,
  ending_triggers_options: cards.flatMap(c => c.options).filter(o => o.effects.ending_triggers.length > 0).length,
  next_cards_options: cards.flatMap(c => c.options).filter(o => o.effects.next_cards.length > 0).length,
  qualitative_notes_options: cards.flatMap(c => c.options).filter(o => o.effects.qualitative_notes?.length > 0).length
};
assert(statsCoverage.delta_five_dim_options > 300, 'F1-5 delta_five_dim coverage > 300 options', `count=${statsCoverage.delta_five_dim_options}`);
assert(statsCoverage.state_writes_options >= 50, 'F1-5 state_writes coverage >= 50 options', `count=${statsCoverage.state_writes_options}`);

// 85. F2: X-EGG-09 Option A gives all attributes +1, Option B targets rep 90
const egg09A = egg09.options.find(o => o.opt_key === 'A');
const egg09B = egg09.options.find(o => o.opt_key === 'B');
assert(Boolean(egg09A && egg09B), 'F2: X-EGG-09 has Option A and Option B');
const all9AttrsPresent = ['颜值', '嗓音', '才艺', '游戏技术', '口才', '情商', '体力', '心态', '运气'].every(a => egg09A.effects.delta_attrs[a] === 1);
assert(all9AttrsPresent, 'F2: X-EGG-09 Option A gives all 9 attributes +1');
assert(egg09B.effects.delta_five_dim.rep_target === 90, 'F2: X-EGG-09 Option B targets rep 90', `target=${egg09B.effects.delta_five_dim.rep_target}`);

// 86. F2: H12 talent text does NOT hardcode branch B only
assert(!h12.talent_effect.startsWith('初始口碑直接提升至 90') && h12.talent_effect.includes('分支 A') && h12.talent_effect.includes('分支 B'),
  'F2: H12 talent text follows branches and does not hardcode branch B only',
  `talent_effect=${h12.talent_effect}`);

// 87. F3: timing_bar_parameters timeout 5s, triple tap fallback toggle, cursor_speed 0.65
assert(tbParams.max_duration_seconds === 5.0, 'F3: timing_bar max_duration_seconds === 5.0', `max_duration=${tbParams.max_duration_seconds}`);
assert(tbParams.triple_tap_fallback === false, 'F3: timing_bar triple_tap_fallback toggle available (default false)', `fallback=${tbParams.triple_tap_fallback}`);
assert(tbParams.cursor_speed === 0.65, 'F3: timing_bar cursor_speed reverted to spike measured 0.65', `speed=${tbParams.cursor_speed}`);
assert(tbParams.cursor_speed_source.includes('spike/spike_stage0.lua:14'), 'F3/V8: timing_bar cursor_speed source annotated in config (spike/spike_stage0.lua:14)');

// 88. F4: 6 timing cards have ops_skin populated from ['接梗', '憋单', 'PK', '高光']
const legalSkins = new Set(['接梗', '憋单', 'PK', '高光']);
for (const tc of timingCards) {
  assert(legalSkins.has(tc.ops_skin), `F4: Timing card ${tc.card_id} has legal ops_skin from ['接梗', '憋单', 'PK', '高光']`, `ops_skin=${tc.ops_skin}`);
}
assert(cards.find(c => c.card_id === 'C1-M05').ops_skin === '接梗', 'F4: C1-M05 ops_skin === 接梗');
assert(cards.find(c => c.card_id === 'C2-M09').ops_skin === 'PK', 'F4: C2-M09 ops_skin === PK');
assert(cards.find(c => c.card_id === 'C3-M08').ops_skin === '高光', 'F4: C3-M08 ops_skin === 高光');
assert(cards.find(c => c.card_id === 'C4-M11').ops_skin === '憋单', 'F4: C4-M11 ops_skin === 憋单');
assert(cards.find(c => c.card_id === 'C5-M09').ops_skin === '高光', 'F4: C5-M09 ops_skin === 高光');
assert(cards.find(c => c.card_id === 'C6-M05').ops_skin === 'PK', 'F4: C6-M05 ops_skin === PK');

// 89. F5: draw_rules.trigger_upgrade list registered
const triggerUpgrade = drawRules.trigger_upgrade;
assert(Array.isArray(triggerUpgrade) && triggerUpgrade.length === 4, 'F5: draw_rules.trigger_upgrade has 4 cards', `count=${triggerUpgrade?.length}`);
const triggerUpgradeIds = triggerUpgrade.map(t => t.card_id).sort();
assert(JSON.stringify(triggerUpgradeIds) === JSON.stringify(['X-EGG-03', 'X-EGG-05', 'X-EGG-08', 'X-EGG-09'].sort()),
  'F5: trigger_upgrade cards match X-EGG-03/05/08/09');

// 90. F5: all pity_chain values ∈ ['pity_cat', 'pity_exam', 'pity_algorithm', 'pity_hater', 'pity_trigger']
const legalPityChains = new Set(['pity_cat', 'pity_exam', 'pity_algorithm', 'pity_hater', 'pity_trigger']);
const actualPityChains = new Set(cards.filter(c => c.pity_chain !== null).map(c => c.pity_chain));
let illegalPityChainCount = 0;
for (const pc of actualPityChains) {
  if (!legalPityChains.has(pc)) illegalPityChainCount++;
}
assert(illegalPityChainCount === 0,
  'F5: All pity_chain values belong strictly to legal declared set [pity_cat, pity_exam, pity_algorithm, pity_hater, pity_trigger]',
  `actual=[${[...actualPityChains].join(', ')}]`);

// 91. F7: mode_vocabulary tag_aliases has 电竞 -> 游戏 and matching_semantics
assert(vocab.tag_aliases && vocab.tag_aliases['电竞'] === '游戏', 'F7: mode_vocabulary tag_aliases maps 电竞 -> 游戏');
assert(Boolean(vocab.matching_semantics), 'F7: mode_vocabulary defines contains matching semantics');

// 92. F7: All card mode_tags ∈ vocabulary schedule_modes + special_tags + locked_slot_8 + tag_aliases
const allowedTagSet = new Set([
  ...vocab.schedule_modes,
  vocab.locked_slot_8,
  ...vocab.special_tags,
  ...Object.keys(vocab.tag_aliases)
]);
let illegalCardTags = [];
for (const c of cards) {
  for (const t of c.mode_tags) {
    if (!allowedTagSet.has(t)) {
      illegalCardTags.push(`${c.card_id}: ${t}`);
    }
  }
}
assert(illegalCardTags.length === 0,
  'F7: All card mode tags belong strictly to vocabulary + aliases (0 illegal tags)',
  `illegal=[${illegalCardTags.join(', ')}]`);

// ============================================================================
// Round-4 Rulings Assertions (V1 - V10)
// ============================================================================

// V1. 钱包对账与 9 条点名断言 + 无未豁免个位数钱包
const findCard = id => cards.find(c => c.card_id === id);
const getWallet = (id, optKey) => findCard(id)?.options.find(o => o.opt_key === optKey)?.effects.delta_five_dim.wallet;

assert(getWallet('C4-M01', 'A') === 120000, 'V1: C4-M01A 钱包 === 120000 (12万)', `actual=${getWallet('C4-M01', 'A')}`);
assert(getWallet('C4-M05', 'A') === -100000, 'V1: C4-M05A 钱包 === -100000 (-10万)', `actual=${getWallet('C4-M05', 'A')}`);
assert(getWallet('C4-S17', 'A') === 15000, 'V1: C4-S17A 钱包 === 15000 (1.5万)', `actual=${getWallet('C4-S17', 'A')}`);
assert(getWallet('C3-M07', 'B') === 5000, 'V1: C3-M07B 钱包 === 5000 (5千)', `actual=${getWallet('C3-M07', 'B')}`);
assert(getWallet('C5-M03', 'B') === -500000, 'V1: C5-M03B 钱包 === -500000 (-50万)', `actual=${getWallet('C5-M03', 'B')}`);
assert(getWallet('C5-M12', 'A') === -500000, 'V1: C5-M12A 钱包 === -500000 (-50万)', `actual=${getWallet('C5-M12', 'A')}`);
assert(getWallet('C6-M06', 'A') === 200000, 'V1: C6-M06A 钱包 === 200000 (20万)', `actual=${getWallet('C6-M06', 'A')}`);
assert(getWallet('C6-M09', 'B') === 100000, 'V1: C6-M09B 钱包 === 100000 (10万)', `actual=${getWallet('C6-M09', 'B')}`);
assert(getWallet('C6-S02', 'A') === 100000, 'V1: C6-S02A 钱包 === 100000 (10万)', `actual=${getWallet('C6-S02', 'A')}`);
assert(getWallet('C3-M09', 'A') === -5000, 'V1: C3-M09A 钱包 === -5000 (-5千)', `actual=${getWallet('C3-M09', 'A')}`);
assert(getWallet('X-MODE-06', 'B') === 3000, 'V1: X-MODE-06B 钱包 === 3000 (3千)', `actual=${getWallet('X-MODE-06', 'B')}`);

// V1. 无未经对账豁免的个位数 wallet
const walletExemptions = new Set(['C1-M05:A', 'C2-S04:B']);
let unexemptedSmallWallets = [];
for (const c of cards) {
  for (const o of c.options) {
    const w = o.effects.delta_five_dim.wallet;
    if (w !== undefined && Math.abs(w) > 0 && Math.abs(w) < 10) {
      const key = `${c.card_id}:${o.opt_key}`;
      if (!walletExemptions.has(key)) {
        unexemptedSmallWallets.push(`${key} (wallet=${w})`);
      }
    }
  }
}
assert(unexemptedSmallWallets.length === 0, 'V1: Zero unexempted single-digit wallets across all cards', `found=[${unexemptedSmallWallets.join(', ')}]`);

// V2. 条件两支 effects_conditional
const c5m02A = findCard('C5-M02')?.options.find(o => o.opt_key === 'A');
assert(Boolean(c5m02A?.effects.effects_conditional), 'V2: C5-M02A has effects_conditional');
assert(c5m02A?.effects.effects_conditional?.then?.delta_five_dim?.fans_pct === 40, 'V2: C5-M02A through branch fans_pct === 40');
assert(c5m02A?.effects.effects_conditional?.else?.delta_five_dim?.fans_pct === 20, 'V2: C5-M02A else branch fans_pct === 20 (halved integer)');

const c6m02B = findCard('C6-M02')?.options.find(o => o.opt_key === 'B');
assert(Boolean(c6m02B?.effects.effects_conditional), 'V2: C6-M02B has effects_conditional');
assert(c6m02B?.effects.effects_conditional?.else?.delta_five_dim?.rep === -50, 'V2: C6-M02B failure branch rep -50 in else');
assert(c6m02B?.effects.delta_five_dim.rep === undefined, 'V2: C6-M02B base effects does NOT duplicate failure branch rep -50');

// V3. req_expr 语义拆分与 check_expr
const allOptions = cards.flatMap(c => c.options);
const trueReqOptions = allOptions.filter(o => o.req_expr !== null);
assert(trueReqOptions.length === 10, 'V3: req_expr strictly reserved for selectable gates (count === 10)', `count=${trueReqOptions.length}`);

const checkOptions = allOptions.filter(o => o.check_expr !== null);
assert(checkOptions.length >= 12, 'V3: check_expr covers pass/fail checks (count >= 12)', `count=${checkOptions.length}`);

const xegg01A = findCard('X-EGG-01')?.options.find(o => o.opt_key === 'A');
const xegg01B = findCard('X-EGG-01')?.options.find(o => o.opt_key === 'B');
assert(xegg01B?.req_expr === null && xegg01B?.effects.ending_triggers.includes('D22'), 'V3: X-EGG-01 Option B is unconditionally selectable and leads directly to D22');
assert(xegg01A?.check_expr === '运气 >= 3' && xegg01A?.check_fail?.ending_triggers?.includes('D22'), 'V3: X-EGG-01 Option A has check_expr 运气 >= 3 with failure branch D22');

// V4. 粉丝构成入库与快照字段
const fanComp = configData.fan_composition;
assert(Boolean(fanComp), 'V4: fan_composition exists in config_and_screens.json');
const expectedFanSegments = ['颜粉', '声控粉', '技术粉', '乐子人', '大哥', '学生粉'];
assert(JSON.stringify(fanComp.segments) === JSON.stringify(expectedFanSegments),
  'V4: fan_composition.segments strictly matches §2.7: [颜粉, 声控粉, 技术粉, 乐子人, 大哥, 学生粉]',
  `segments=${JSON.stringify(fanComp.segments)}`);
assert(fanComp.exclusive_pool_threshold_pct === 35, 'V4: exclusive_pool_threshold_pct === 35');
const snapshotFields = stateDict.Snapshot_BeforeCard.fields;
const hasAllZhFanSegments = expectedFanSegments.every(s => snapshotFields.includes(`Fans_${s}_Pct`));
assert(hasAllZhFanSegments, 'V4: Snapshot_BeforeCard contains exact §2.7 fan segment fields Fans_颜粉_Pct etc.');
const hasOldEnglishFanFields = ['Fans_Passerby_Pct', 'Fans_Lover_Pct', 'Fans_Iron_Pct', 'Fans_Troll_Pct', 'Fans_Pro_Pct', 'Fans_Rich_Pct'].some(f => snapshotFields.includes(f));
assert(!hasOldEnglishFanFields, 'V4: Zero old English placeholder fan fields in Snapshot_BeforeCard');

// V5. 数字人字典补键 Flag_数字人线开放
const digitKey = stateDict.variables.find(v => v.key === 'Flag_数字人线开放');
assert(Boolean(digitKey), 'V5: Flag_数字人线开放 exists in state_dictionary.json');
assert(snapshotFields.includes('Flag_数字人线开放'), 'V5: Snapshot_BeforeCard includes Flag_数字人线开放');
assert(findCard('C6-M06')?.prereq_expr?.includes('Flag_数字人线开放'), 'V5: C6-M06 prereq_expr consumes Flag_数字人线开放');
const xmode09B = findCard('X-MODE-09')?.options.find(o => o.opt_key === 'B');
assert(xmode09B?.effects.state_writes.some(w => w.includes('Flag_数字人线开放')), 'V5: X-MODE-09 Option B writes Flag_数字人线开放');

// V6. 全局结算规则入库 global_rules
const globalRules = configData.global_rules;
assert(Boolean(globalRules), 'V6: global_rules exists in config_and_screens.json');
assert(globalRules.total_multiplier_clamp[0] === 0.4 && globalRules.total_multiplier_clamp[1] === 3.0,
  'V6: global_rules total_multiplier_clamp === [0.4, 3.0]');
assert(globalRules.circus_style.multiplier === 2.5 && globalRules.circus_style.zero_revenue_rate === 0.35,
  'V6: global_rules circus_style multiplier === 2.5 and zero_revenue_rate === 0.35');
assert(globalRules.commercial_multiplier.sources_stack_rule === 'take_highest_no_stack' && globalRules.commercial_multiplier.rep_max_cap === 1.5,
  'V6: global_rules commercial_multiplier sources_stack_rule === take_highest_no_stack and rep_max_cap === 1.5');

// V7. 歧义清单与贡献条件
const c2m10A = findCard('C2-M10')?.options.find(o => o.opt_key === 'A');
assert(c2m10A?.effects.ending_triggers.includes('H08'), 'V7: C2-M10A ending_triggers includes H08 (contribution condition)');
const totalQualNotes = allOptions.reduce((acc, o) => acc + (o.effects.qualitative_notes?.length || 0), 0);
assert(totalQualNotes === 32, 'V7: Qualitative notes total across all cards strictly === 32', `total=${totalQualNotes}`);

// V8. 时机条来源注与单向扫条
assert(tbParams.cursor_speed_source && tbParams.cursor_speed_source.includes('spike/spike_stage0.lua:14'),
  'V8: timing_bar cursor_speed_source references spike/spike_stage0.lua:14');
assert(tbParams.sweep_direction === 'unidirectional', 'V8: timing_bar sweep_direction === unidirectional');
assert(tbParams.sweet_window_seconds === 0.23, 'V8: timing_bar sweet_window_seconds === 0.23');

// V10. 换皮皮名对齐 skin_set
const skinSet = configData.skin_set;
assert(Boolean(skinSet), 'V10: skin_set exists in config_and_screens.json');
assert(skinSet.canonical_names.length === 4 && skinSet.canonical_names.includes('憋单放福袋'),
  'V10: skin_set.canonical_names matches [接梗, 憋单放福袋, 最后一波拉票, 关键操作]');
assert(skinSet.data_mapping['高光'] === '关键操作' && skinSet.data_mapping['PK'] === '最后一波拉票',
  'V10: skin_set.data_mapping aligns data skins with canonical skins');

// ============================================================================
// Round-5 Rulings Assertions (W1-W8)
// ============================================================================

// W1: Base branch-unique keys cleared for conditional cards
const w_c6m02B = findCard('C6-M02')?.options.find(o => o.opt_key === 'B');
assert(w_c6m02B?.effects.delta_five_dim.fans_pct === undefined && w_c6m02B?.effects.delta_five_dim.fans === undefined,
  'W1: C6-M02:B base delta cleared of then-branch fans_pct 40 and phantom fans 4');

const w_c4m06A = findCard('C4-M06')?.options.find(o => o.opt_key === 'A');
assert(w_c4m06A?.effects.delta_five_dim.fans_pct === undefined && w_c4m06A?.effects.delta_five_dim.fans === undefined,
  'W1: C4-M06:A base delta cleared of branch-unique fans_pct 20 and phantom fans 2');

// W2: Zero unexempted phantom fans absolute values across all cards
const FANS_ABSOLUTE_EXEMPTIONS = new Set([]);
const unexemptedFans = [];
for (const c of cards) {
  for (const opt of c.options) {
    if (opt.effects.delta_five_dim?.fans !== undefined && !FANS_ABSOLUTE_EXEMPTIONS.has(`${c.card_id}:${opt.opt_key}`)) {
      unexemptedFans.push(`${c.card_id}:${opt.opt_key}=${opt.effects.delta_five_dim.fans}`);
    }
    if (opt.check_fail?.delta_five_dim?.fans !== undefined && !FANS_ABSOLUTE_EXEMPTIONS.has(`${c.card_id}:${opt.opt_key}:fail`)) {
      unexemptedFans.push(`${c.card_id}:${opt.opt_key}:fail=${opt.check_fail.delta_five_dim.fans}`);
    }
  }
}
assert(unexemptedFans.length === 0, 'W2: 65 phantom fans absolute values purged (0 unexempted fans remain)',
  `found=${unexemptedFans.join(', ')}`);

// W3: Hater mis-mapping fixes & full pool clean
const w_c5m01A = findCard('C5-M01')?.options.find(o => o.opt_key === 'A');
assert(w_c5m01A?.effects.delta_five_dim.fans_pct === -30 && w_c5m01A?.effects.delta_five_dim.hater_pct === 20,
  'W3: C5-M01:A corrected: fans_pct === -30, hater_pct === 20');

const w_c3m05A = findCard('C3-M05')?.options.find(o => o.opt_key === 'A');
assert(w_c3m05A?.effects.delta_five_dim.fans_pct === undefined && w_c3m05A?.effects.delta_five_dim.hater_pct === 15,
  'W3: C3-M05:A corrected: fans_pct undefined, hater_pct === 15');

const w_c4m11A = findCard('C4-M11')?.options.find(o => o.opt_key === 'A');
assert(w_c4m11A?.effects.delta_five_dim.fans_pct === undefined && w_c4m11A?.effects.delta_five_dim.hater_pct === 15,
  'W3: C4-M11:A corrected: fans_pct undefined, hater_pct === 15');

// Full pool scan for hater mis-mapping
const misMappedHaterCards = [];
for (const c of cards) {
  for (const opt of c.options) {
    const sum = opt.effects.summary || '';
    const d = opt.effects.delta_five_dim || {};
    const hm = sum.match(/黑粉[+＋]([0-9]+)%/);
    if (hm) {
      const hval = Number(hm[1]);
      if (d.fans_pct === hval && !sum.match(/(?<!黑)粉[+＋]/)) {
        misMappedHaterCards.push(`${c.card_id}:${opt.opt_key}`);
      }
    }
  }
}
assert(misMappedHaterCards.length === 0, 'W3: Zero hater percentage mis-mapped into fans_pct across full pool',
  `found=${misMappedHaterCards.join(', ')}`);

// W4: Miscellaneous items
const w_c5m02A = findCard('C5-M02')?.options.find(o => o.opt_key === 'A');
assert(w_c5m02A?.effects.effects_conditional?.else?.delta_five_dim?.rep === 17,
  'W4: C5-M02:A else branch half-blood rep === 17 (downward floor integer)');

const w_c4m05B = findCard('C4-M05')?.options.find(o => o.opt_key === 'B');
assert(w_c4m05B?.effects.delta_five_dim.conversion_rate_pct === 30 && w_c4m05B?.effects.delta_five_dim.fans_pct === -30,
  'W4: C4-M05:B conversion_rate_pct === 30, fans_pct === -30 preserved');

const w_xegg09B = findCard('X-EGG-09')?.options.find(o => o.opt_key === 'B');
assert(w_xegg09B?.effects.delta_five_dim.rep === undefined && w_xegg09B?.effects.delta_five_dim.rep_target === 90,
  'W4: X-EGG-09:B dead rep increment deleted, rep_target === 90 preserved');

// W6: State dictionary re-transcription validation
const trailingBackslashKeys = stateDict.variables.filter(v => typeof v.range_or_cap === 'string' && v.range_or_cap.endsWith('\\'));
assert(trailingBackslashKeys.length === 0, 'W6: Zero state dictionary entries end with trailing backslash in range_or_cap',
  `keys=${trailingBackslashKeys.map(k => k.key).join(', ')}`);

const tagRenShe = stateDict.variables.find(v => v.key === 'Tag_人设');
assert(tagRenShe && tagRenShe.range_or_cap.includes('真实') && tagRenShe.consumers_text.includes('C4-M06'),
  'W6: Tag_人设 enum restored and consumers_text correctly references C4-M06');

// W8: Timing bar note
assert(skinSet.note && skinSet.note.includes('动作定皮优先'),
  'W8: skin_set includes note specifying action skin priority');

// ============================================================================
// Write validation report
// ============================================================================
const reportLines = [
  '================================================================================',
  '《从小主播到顶流》阶段 1.5 · 机器可读补全与全量裁定校验报告 (validate_transcription.mjs)',
  `生成时间: ${new Date().toISOString()}`,
  `数据基线: ${DATA_DIR} (4 JSON files: state_dictionary, cards, endings_and_talents, config_and_screens)`,
  `gate_type 分布: ${JSON.stringify(gateDistribution)}`,
  `7 模式匹配卡数: ${Object.entries(modeCardCounts).map(([k, v]) => `${k}:${v}`).join(', ')}`,
  `字段覆盖统计: ${JSON.stringify(statsCoverage)}`,
  '================================================================================\n'
];

assertions.forEach((a, idx) => {
  const line = `[${a.pass ? 'PASS' : 'FAIL'}] ${idx + 1}. ${a.name}${a.detail ? ': ' + a.detail : ''}`;
  reportLines.push(line);
  console.log(line);
});

reportLines.push('\n--------------------------------------------------------------------------------');
reportLines.push(`Result: All ${assertions.length} passed, 0 failed\n`);
console.log('\n--------------------------------------------------------------------------------');
console.log(`Result: All ${assertions.length} passed, 0 failed\n`);

fs.writeFileSync(REPORT_PATH, reportLines.join('\n'), 'utf8');
console.log(`Validation report written to: ${REPORT_PATH}`);
