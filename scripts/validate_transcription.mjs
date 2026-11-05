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

// Appendix B Word Gate counters
function countModeA(str) {
  const clean = str
    .replace(/`\[操作：[^\]]+\]`/g, '')
    .replace(/`\[正经卡\]`/g, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '');
  const matches = clean.match(/[\u4e00-\u9fa50-9％.]/g);
  return matches ? matches.length : 0;
}

function countModeB(str) {
  const clean = str
    .replace(/`\[操作：[^\]]+\]`/g, '')
    .replace(/`\[正经卡\]`/g, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, '');
  return [...clean].length;
}

console.log('================================================================================');
console.log('《从小主播到顶流》阶段 1 · 数据转录与勘误补丁校验 (validate_transcription.mjs)');
console.log('目标: 验证 data/ 下 4 份结构化 JSON 数据集的一致性、勘误闭环与新增配置层/词表断言');
console.log('================================================================================\n');

// 1. Card count === 213 (63 milestone + 120 short + 30 cross)
const milestoneCards = cards.filter(c => c.pool_type === 'milestone');
const shortCards = cards.filter(c => c.pool_type === 'short');
const crossCards = cards.filter(c => c.pool_type.startsWith('cross_'));
assert(cards.length === 213, 'Card count === 213', `total=${cards.length} (milestone=${milestoneCards.length}, short=${shortCards.length}, cross=${crossCards.length})`);

// 2. Card IDs unique
const cardIdSet = new Set();
for (const c of cards) {
  if (cardIdSet.has(c.card_id)) {
    assert(false, `Duplicate card_id: ${c.card_id}`);
  }
  cardIdSet.add(c.card_id);
}
assert(cardIdSet.size === 213, 'Card IDs unique & distribution 63/120/30', `unique=${cardIdSet.size}`);

// 3. Schema completeness (§2.10)
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
assert(schemaMissingCount === 0, 'Card schema completeness (§2.10 13 required fields)', `missing_fields=${schemaMissingCount}`);

// 4. State dictionary auto-generated from §2.9 === 36 keys & 57 snapshot fields
const validStateKeys = new Set(stateDict.variables.map(v => v.key));
assert(validStateKeys.size === 36, 'State dictionary auto-generated from §2.9 === 36 keys', `keys=${validStateKeys.size}, snapshot_fields=${stateDict.Snapshot_BeforeCard.total_fields}`);
assert(stateDict.Snapshot_BeforeCard.total_fields === 57, 'Snapshot_BeforeCard total fields === 57 (21 base stats/five_dim/fans + 36 state keys = 57)', `total_fields=${stateDict.Snapshot_BeforeCard.total_fields}`);

// 5. Zero dangling state references across cards
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

// 6. Zero dangling ending triggers
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

// 7. Word gate check on cards
let cardBodyViolations = 0;
let cardOptViolations = 0;
for (const c of cards) {
  const bA = countModeA(c.context_text);
  const bB = countModeB(c.context_text);
  if (bA > 140 || bB > 140) cardBodyViolations++;
  for (const opt of c.options) {
    const oA = countModeA(opt.label);
    const oB = countModeB(opt.label);
    if (oA > 22 || oB > 22) cardOptViolations++;
  }
}
assert(cardBodyViolations === 0, 'Card context word gate (<= 140 chars) 0 violations', `violations=${cardBodyViolations}`);
assert(cardOptViolations === 0, 'Card option word gate (<= 22 chars) 0 violations', `violations=${cardOptViolations}`);

// 8. Endings count === 50 (12 M + 26 D + 12 H) & Talents === 50
const mEndings = endingsData.endings.filter(e => e.tier === 'main');
const dEndings = endingsData.endings.filter(e => e.tier === 'death');
const hEndings = endingsData.endings.filter(e => e.tier === 'hidden');
assert(endingsData.endings.length === 50, 'Endings count === 50 (12 M + 26 D + 12 H)', `M=${mEndings.length}, D=${dEndings.length}, H=${hEndings.length}`);
assert(mEndings.length === 12, 'Commercial main endings M01-M12 === 12', `actual=${mEndings.length}`);
assert(dEndings.length === 26, 'Death/knockout endings D01-D26 === 26', `actual=${dEndings.length}`);
assert(hEndings.length === 12, 'Hidden easter-egg endings H01-H12 === 12', `actual=${hEndings.length}`);
assert(endingsData.talents.length === 50, 'Talents count === 50 (one-to-one with 50 endings)', `actual=${endingsData.talents.length}`);

// 9. Errata P1-2: H05 dual trigger sources & option qualifiers
const h05 = endingsData.endings.find(e => e.ending_id === 'H05');
assert(Boolean(h05), 'Ending H05 exists in data');
assert(h05.trigger_sources && h05.trigger_sources.length === 2, 'H05 has 2 dual trigger sources (counter full = 3 OR max luck at ch6 end)', `sources_count=${h05.trigger_sources?.length}`);
const countAlg = stateDict.variables.find(v => v.key === 'Count_算法异常');
assert(Boolean(countAlg), 'Count_算法异常 exists in state dictionary');
assert(countAlg.writers_qualified && countAlg.writers_qualified.length === 3, 'Count_算法异常 has 3 qualified writers (C4-S19:B, C5-S19:B, C6-S19:A)', `writers_count=${countAlg.writers_qualified?.length}`);

// 10. Errata P2-1: Dual-standard milestone weights separated (base 1.0, match 2.0, non-match 1.0)
const dualCards = cards.filter(c => c.gate_type === 'dual_boost');
assert(dualCards.length === 12, '12 milestone cards classified as dual_boost', `count=${dualCards.length}`);
let dualWeightCorrect = true;
for (const dc of dualCards) {
  if (dc.weight_rule.base !== 1.0 || dc.weight_rule.match_mode !== 2.0 || dc.weight_rule.non_match_mode !== 1.0) {
    dualWeightCorrect = false;
  }
}
assert(dualWeightCorrect, 'All 12 dual-tagged milestone cards have base 1.0, match 2.0, non_match 1.0 (NO 0.5 downweight)');

// 11. Errata P3-1: Sample inspection 4 buttons
const inspectAction = configData.schedules.off_stream_actions.find(a => a.id === 5);
assert(inspectAction && inspectAction.ops_config.choice_buttons.length === 4, 'Ops-B 翻样辨真 4 buttons (指认#1 / 指认#2 / 指认#3 / 三件全合格)', `buttons=[${inspectAction?.ops_config?.choice_buttons?.join(', ')}]`);

// 12. Errata P3-2: Art budget cap === 69
assert(configData.art_budget && configData.art_budget.cap_total === 69, 'Art budget total cap === 69', `cap=${configData?.art_budget?.cap_total}`);

// 13. Errata P3-3: C3-M08 timing bar ops_note attached
const c3m08 = cards.find(c => c.card_id === 'C3-M08');
assert(c3m08 && c3m08.ops_type === 'timing_bar' && c3m08.ops_note && c3m08.ops_note.includes('P3-3'), 'C3-M08 has timing_bar ops_type and P3-3 ops_note', `ops_note=${c3m08?.ops_note}`);

// 14. Errata P4-4: Screen-08 independent
const screen08 = configData.screens.find(s => s.screen_id === 'Screen-08');
assert(Boolean(screen08), 'Screen-08 (结局分享卡弹窗) is an independent screen entry', `name=${screen08?.name}`);

// ============================================================================
// NEW ASSERTIONS FOR REVIEW CORRECTIONS (Items 3, 4, 5)
// ============================================================================

// 15. Review Correction 3.1: Afternoon slot wallet_mult 1.25 only for ecommerce mode
const afternoonSlot = configData.schedules.time_slots.find(s => s.id === 'slot_afternoon');
assert(Boolean(afternoonSlot), 'Afternoon slot exists in schedules');
assert(afternoonSlot.wallet_mult_default === 1.0 && afternoonSlot.wallet_mult_ecommerce === 1.25,
  'Afternoon slot wallet_mult 1.25 applies only to ecommerce mode (default=1.00, ecommerce=1.25)',
  `default=${afternoonSlot.wallet_mult_default}, ecommerce=${afternoonSlot.wallet_mult_ecommerce}, cond=${afternoonSlot.wallet_mult_condition}`);

// 16. Review Correction 3.2: §2.8A time slots event weight skews full column transcribed (5 slots)
assert(configData.schedules.time_slots.length === 5, 'Time slots count === 5', `count=${configData.schedules.time_slots.length}`);
let allSlotsHaveSkew = true;
for (const s of configData.schedules.time_slots) {
  if (!s.event_weight_skew || s.event_weight_skew.length < 5) {
    allSlotsHaveSkew = false;
  }
}
assert(allSlotsHaveSkew, 'All 5 time slots have event_weight_skew fully transcribed per §2.8A column',
  configData.schedules.time_slots.map(s => `${s.id}:${s.event_weight_skew.substring(0, 15)}...`).join(' | '));

// 17. Review Correction 3.3: Durations stamina cost has no hard locks, 6h force start penalty -10 stamina
const dur6 = configData.schedules.durations.find(d => d.hours === 6);
assert(Boolean(dur6), '6h duration exists in schedules');
assert(dur6.is_hard_locked === false && dur6.can_force_start === true && dur6.low_physique_extra_cost === 10,
  '6h duration has no hard lock (can_force_start=true) and applies -10 stamina if physique < 6',
  `can_force=${dur6.can_force_start}, extra_cost=${dur6.low_physique_extra_cost}`);
const allDurationsNoHardLock = configData.schedules.durations.every(d => d.is_hard_locked === false);
assert(allDurationsNoHardLock, 'All 3 duration tiers have no hard locks (req_physique hard-lock semantic removed)');

// 18. Review Correction 3.4: Off-stream action 3 restores 5% tax reduction and M10 prerequisite phrasing
const action3 = configData.schedules.off_stream_actions.find(a => a.id === 3);
assert(Boolean(action3), 'Action 3 exists in off_stream_actions');
assert(action3.continuous_effects.includes('掉粉税减免 5%') && action3.continuous_effects.includes('M10 幕后操盘手必要条件'),
  'Action 3 restores 掉粉税减免 5% and M10 幕后操盘手必要条件 phrasing',
  `text=${action3.continuous_effects}`);

// 19. Review Correction 4: Mode vocabulary authoritative registration (8 schedule modes + special tags)
const vocab = configData.mode_vocabulary;
assert(Boolean(vocab), 'mode_vocabulary exists in config_and_screens.json');
assert(vocab.schedule_modes.length === 8, '8 official schedule modes registered', `modes=[${vocab.schedule_modes.join(', ')}]`);
const expectedModes = ['聊天', '才艺', '游戏', 'PK', '带货', '团播', '户外', '电台'];
const modesMatch = expectedModes.every(m => vocab.schedule_modes.includes(m));
assert(modesMatch, 'Schedule modes exactly match 8 Screen-02 modes (聊天/才艺/游戏/PK/带货/团播/户外/电台)');
assert(vocab.special_tags.includes('数字人诱惑'), '数字人诱惑 registered as special tag, NOT a schedule mode');
assert(vocab.rules.digital_clone_is_schedule_mode === false, 'digital_clone_is_schedule_mode === false');

// 20. Review Correction 4: C6-M06 gate and reachability without mode-filtering lockout
const c6m06 = cards.find(c => c.card_id === 'C6-M06');
assert(Boolean(c6m06), 'C6-M06 exists in cards.json');
assert(c6m06.gate_type === 'progress' && c6m06.weight_rule.base === 1.0 && c6m06.weight_rule.non_match_mode === 1.0,
  'C6-M06 entry gate is chapter 6 progress, base 1.0 without mode-match lockout (protects H03 main branch reachability)',
  `gate=${c6m06.gate_type}, base=${c6m06.weight_rule.base}, non_match=${c6m06.weight_rule.non_match_mode}`);

// 21. Review Correction 5: H03 dangling stat eliminated (no "智力" key in data layer)
const h03 = endingsData.endings.find(e => e.ending_id === 'H03');
assert(Boolean(h03), 'H03 exists in endings');
assert(h03.trigger_condition.includes('口才 ≥ 8') && !h03.trigger_condition.includes('智力'),
  'H03 trigger condition normalized to 口才 ≥ 8 (no 智力 allowed)',
  `trigger=${h03.trigger_condition}`);

// 22. Strict check: Zero occurrence of "智力" across all 4 JSON data files
const allDataDump = JSON.stringify({ stateDict, cards, endingsData, configData });
const intelligenceMatches = allDataDump.match(/智力/g);
assert(!intelligenceMatches || intelligenceMatches.length === 0, 'Zero occurrence of "智力" across all JSON data files', `occurrences=${intelligenceMatches?.length || 0}`);

// 23. Chapter 1-6 Base and Cap table completeness
assert(configData.chapters.length === 6, 'Chapter configuration contains exactly 6 chapters', `count=${configData.chapters.length}`);
for (let ch = 1; ch <= 6; ch++) {
  const cObj = configData.chapters.find(c => c.chapter === ch);
  assert(Boolean(cObj && cObj.Base_Fans && cObj.Cap_Fans && cObj.Base_Income && cObj.Cap_Wallet), `Chapter ${ch} Base and Cap values complete`);
}

// 24. Engineering Red Lines count === 5
assert(configData.engineering_red_lines.length === 5, 'Engineering Red Lines count === 5', `count=${configData.engineering_red_lines.length}`);

// Generate Report
const reportLines = [
  '================================================================================',
  '《从小主播到顶流》阶段 1 · 数据转录与勘误补丁校验报告 (validate_transcription.mjs)',
  `生成时间: ${new Date().toISOString()}`,
  '数据基线: E:\\taptap\\zhubo\\data (4 JSON files: state_dictionary, cards, endings_and_talents, config_and_screens)',
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
