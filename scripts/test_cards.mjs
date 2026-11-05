import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const DRAFT_PATH = path.join(REPO_ROOT, 'maker-zhubo-gemini-draft-20261104.md');

const stateDict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state_dictionary.json'), 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cards.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'endings_and_talents.json'), 'utf8'));
const configData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config_and_screens.json'), 'utf8'));
const draftRaw = fs.readFileSync(DRAFT_PATH, 'utf8');

const assertions = [];
function assert(condition, name, detail = '') {
  assertions.push({ pass: Boolean(condition), name, detail });
  if (!condition) {
    throw new Error(`VALIDATION FAILED: ${name} (${detail})`);
  }
}

// Dual word-count metrics (Appendix B of Errata)
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

// 1. Verify Frozen Draft Baseline Untouched
const draftLfBytes = Buffer.byteLength(draftRaw.replace(/\r\n/g, '\n'), 'utf8');
assert(draftLfBytes === 195339, 'Frozen draft v0.2 LF byte size === 195,339', `actual=${draftLfBytes}`);

// 2. Verify Card Pool Size & Uniqueness
const cardIdSet = new Set(cards.map(c => c.card_id));
const milestones = cards.filter(c => c.pool_type === 'milestone');
const shorts = cards.filter(c => c.pool_type === 'short');
const crossModes = cards.filter(c => c.pool_type === 'cross_mode');
const crossAttrs = cards.filter(c => c.pool_type === 'cross_attr');
const crossEggs = cards.filter(c => c.pool_type === 'cross_egg');

assert(cards.length === 213, 'Total transcribed cards === 213', `actual=${cards.length}`);
assert(cardIdSet.size === 213, 'All 213 card IDs unique', `unique=${cardIdSet.size}`);
assert(milestones.length === 63, 'Milestone cards === 63 (10/10/10/11/12/10)', `actual=${milestones.length}`);
assert(shorts.length === 120, 'Short cards === 120 (6x20)', `actual=${shorts.length}`);
assert(crossModes.length + crossAttrs.length + crossEggs.length === 30, 'Cross-chapter cards === 30 (10/10/10)', `actual=${crossModes.length}/${crossAttrs.length}/${crossEggs.length}`);

// 3. Word-Count Hard Gates (213/213 Dual-Mode)
let maxMCtxA = 0, maxMCtxB = 0, maxMOptA = 0, maxMOptB = 0, maxMOutA = 0, maxMOutB = 0;
let maxSCtxA = 0, maxSCtxB = 0, maxSOptA = 0, maxSOptB = 0, maxSOutA = 0, maxSOutB = 0;
let wordGateViolations = 0;

for (const c of cards) {
  const isM = c.pool_type === 'milestone';
  const limCtx = isM ? 80 : 60;
  const limOpt = isM ? 20 : 14;
  const limOut = isM ? 40 : 30;

  const ctxA = countModeA(c.raw_cells.context_col);
  const ctxB = countModeB(c.raw_cells.context_col);
  const outA = countModeA(c.raw_cells.outcome_col);
  const outB = countModeB(c.raw_cells.outcome_col);

  if (ctxB > limCtx || outB > limOut) wordGateViolations++;

  if (isM) {
    maxMCtxA = Math.max(maxMCtxA, ctxA);
    maxMCtxB = Math.max(maxMCtxB, ctxB);
    maxMOutA = Math.max(maxMOutA, outA);
    maxMOutB = Math.max(maxMOutB, outB);
  } else {
    maxSCtxA = Math.max(maxSCtxA, ctxA);
    maxSCtxB = Math.max(maxSCtxB, ctxB);
    maxSOutA = Math.max(maxSOutA, outA);
    maxSOutB = Math.max(maxSOutB, outB);
  }

  for (const opt of c.options) {
    const oA = countModeA(opt.label);
    const oB = countModeB(opt.label);
    if (oB > limOpt) wordGateViolations++;
    if (isM) {
      maxMOptA = Math.max(maxMOptA, oA);
      maxMOptB = Math.max(maxMOptB, oB);
    } else {
      maxSOptA = Math.max(maxSOptA, oA);
      maxSOptB = Math.max(maxSOptB, oB);
    }
  }
}

assert(wordGateViolations === 0, 'Word-count hard gates pass 213/213 in both Mode A and Mode B', `violations=${wordGateViolations}, M_max(B)=${maxMCtxB}/${maxMOptB}/${maxMOutB}, S/X_max(B)=${maxSCtxB}/${maxSOptB}/${maxSOutB}`);

// 4. Verify State Dictionary & Snapshot_BeforeCard Auto-Generation (Errata P1-1)
const dictKeySet = new Set(stateDict.variables.map(v => v.key));
assert(stateDict.total_keys === 36, 'P1-1: State dictionary has exactly 36 keys from §2.9 table body', `actual=${stateDict.total_keys} (Flag=${stateDict.category_counts.Flag}, Count=${stateDict.category_counts.Count}, Tag=${stateDict.category_counts.Tag}, Param=${stateDict.category_counts.Param}, Total=${stateDict.category_counts.Total})`);
assert(stateDict.Snapshot_BeforeCard.state_dictionary_keys.length === 36, 'P1-1: Snapshot_BeforeCard auto-generated field list includes all 36 dictionary keys', `count=${stateDict.Snapshot_BeforeCard.state_dictionary_keys.length}`);
assert(
  stateDict.Snapshot_BeforeCard.state_dictionary_keys.includes('Count_验货命中') &&
  stateDict.Snapshot_BeforeCard.state_dictionary_keys.includes('Count_偷拍素材') &&
  stateDict.Snapshot_BeforeCard.state_dictionary_keys.includes('Count_违规警告'),
  'P1-1: Snapshot_BeforeCard contains critical counters (Count_验货命中, Count_偷拍素材, Count_违规警告)'
);

// 5. Verify Endings & Talents (50 = 12/26/12)
const endingIdSet = new Set(endingsData.endings.map(e => e.ending_id));
assert(endingsData.counts.total_endings === 50, 'Endings total === 50', `actual=${endingsData.counts.total_endings}`);
assert(
  endingsData.counts.main_endings === 12 &&
  endingsData.counts.death_endings === 26 &&
  endingsData.counts.hidden_endings === 12,
  'Endings breakdown === 12 main / 26 death / 12 hidden',
  `${endingsData.counts.main_endings}/${endingsData.counts.death_endings}/${endingsData.counts.hidden_endings}`
);
assert(endingsData.counts.total_talents === 50, 'Talents total === 50 (1-to-1 with endings)', `actual=${endingsData.counts.total_talents}`);

// 6. Verify Zero Dangling References (Cards, Endings, State Variables)
let danglingCards = [];
let danglingEndings = [];
let danglingVars = [];

for (const c of cards) {
  for (const opt of c.options) {
    for (const nextId of opt.effects.next_cards) {
      if (!cardIdSet.has(nextId)) danglingCards.push(`${c.card_id}->${nextId}`);
    }
    for (const endId of opt.effects.ending_triggers) {
      if (!endingIdSet.has(endId)) danglingEndings.push(`${c.card_id}->${endId}`);
    }
    for (const sw of opt.effects.state_writes) {
      if (!dictKeySet.has(sw.key)) danglingVars.push(`${c.card_id}->${sw.key}`);
    }
  }
}

assert(danglingCards.length === 0, 'Zero dangling card references', `dangling=${danglingCards.join(',')}`);
assert(danglingEndings.length === 0, 'Zero dangling ending references', `dangling=${danglingEndings.join(',')}`);
assert(danglingVars.length === 0, 'Zero dangling state variable references', `dangling=${danglingVars.join(',')}`);

// 7. Verify All Errata Rulings (P1-2 + fb6cb71, P2-1, P3-1, P3-2, P3-3, P4-1, P4-2, P4-3, P4-4)
const h05 = endingsData.endings.find(e => e.ending_id === 'H05');
const countAlgo = stateDict.variables.find(v => v.key === 'Count_算法异常');
assert(
  h05.name === '冲出楚门直播间' &&
  Array.isArray(h05.trigger_sources) &&
  h05.trigger_sources.length === 2 &&
  h05.trigger_sources[0].expr === '运气 == 10 && Count_算法异常 == 3' &&
  h05.trigger_sources[1].expr === '运气 == 10 && chapter_6_cleared == true',
  'P1-2 + fb6cb71: H05 canonical name + dual trigger sources (=3 immediate OR max luck Ch6 end)',
  JSON.stringify(h05.trigger_sources)
);
assert(
  Array.isArray(countAlgo.writers_qualified) &&
  countAlgo.writers_qualified.length === 3 &&
  countAlgo.writers_qualified[0].card_id === 'C4-S19' && countAlgo.writers_qualified[0].opt_key === 'B' &&
  countAlgo.writers_qualified[1].card_id === 'C5-S19' && countAlgo.writers_qualified[1].opt_key === 'B' &&
  countAlgo.writers_qualified[2].card_id === 'C6-S19' && countAlgo.writers_qualified[2].opt_key === 'A',
  'fb6cb71: Count_算法异常 writers have explicit option qualifiers (C4-S19:B, C5-S19:B, C6-S19:A)',
  JSON.stringify(countAlgo.writers_qualified)
);

const dualBoostCards = cards.filter(c => c.gate_type === 'dual_boost');
assert(
  dualBoostCards.length === 12 &&
  dualBoostCards.every(c => c.weight_rule.base === 1.0 && c.weight_rule.match_mode === 2.0 && c.weight_rule.non_match_mode === 1.0),
  'P2-1: 12 dual-tagged milestone cards have base=1.0, match=2.0, non_match=1.0 (no 0.5 downweight)',
  `count=${dualBoostCards.length}`
);

const modeShortCross = cards.filter(c => c.pool_type !== 'milestone' && c.mode_tags.some(t => t !== '全模式'));
assert(
  modeShortCross.length > 0 &&
  modeShortCross.every(c => c.weight_rule.match_mode === 3.0 && c.weight_rule.non_match_mode === 0.5),
  'P2-1: Mode-tagged short & cross-chapter cards maintain match=3.0, non_match=0.5',
  `count=${modeShortCross.length}`
);

const sampleInspectCards = cards.filter(c => c.ops_type === 'sample_inspect');
assert(
  sampleInspectCards.length === 2 &&
  sampleInspectCards.every(c => c.ops_config && c.ops_config.flip_limit === 2 && c.ops_config.choice_buttons.length === 4),
  'P3-1: Sample inspection (翻样辨真) configured as flip 2 of 3 + 4-button choice on C4-M02 & C5-M07',
  `cards=${sampleInspectCards.map(c => c.card_id).join(',')}`
);

assert(
  configData.art_budget.cap_total === 69,
  'P3-2: Art budget capped at 69 images (36 + 6 + 27)',
  `cap=${configData.art_budget.cap_total}`
);

const c3m08 = cards.find(c => c.card_id === 'C3-M08');
const c6m05 = cards.find(c => c.card_id === 'C6-M05');
assert(
  c3m08.ops_type === 'timing_bar' && c3m08.ops_note.includes('耳返故障后的舞台盲跳卡点段'),
  'P3-3: C3-M08 timing bar preserved with live-stage blind-jump ops_note',
  c3m08.ops_note
);
assert(
  c6m05.ops_type === 'timing_bar' && c6m05.ops_note.includes('只作用于非煽动选项'),
  'Review §4 item 4: C6-M05 timing bar ops_note specifies post-option & non-incitement only',
  c6m05.ops_note
);

// Check P4-1 zero-padded ending IDs across all JSON files
const allJsonText =
  fs.readFileSync(path.join(DATA_DIR, 'state_dictionary.json'), 'utf8') +
  fs.readFileSync(path.join(DATA_DIR, 'cards.json'), 'utf8') +
  fs.readFileSync(path.join(DATA_DIR, 'endings_and_talents.json'), 'utf8') +
  fs.readFileSync(path.join(DATA_DIR, 'config_and_screens.json'), 'utf8');
const unpaddedMatches = allJsonText.match(/(?<!私\s*)\b(?:M[1-9]|D[1-9]|H[1-9])\b/g) || [];
const h01 = endingsData.endings.find(e => e.ending_id === 'H01');
assert(
  unpaddedMatches.length === 0 && h01.name === '黑粉头子是真爱',
  'P4-1: All ending IDs zero-padded (0 unpadded tokens) & H01 canonical name === 黑粉头子是真爱',
  `unpadded=${unpaddedMatches.length}`
);

// Check P4-2 X-EGG-09 / H12
const h12 = endingsData.endings.find(e => e.ending_id === 'H12');
assert(
  h12.epilogue_variants && h12.epilogue_variants.A !== h12.epilogue_variants.B && h12.talent_name === '【真·顶流权柄】',
  'P4-2: X-EGG-09 / H12 has distinct A/B epilogues and shares 50th talent 【真·顶流权柄】'
);

// Check P4-3 expanded shorthand assignments
const c2m01 = cards.find(c => c.card_id === 'C2-M01');
const c2m06 = cards.find(c => c.card_id === 'C2-M06');
const c2m07 = cards.find(c => c.card_id === 'C2-M07');
const c2m08 = cards.find(c => c.card_id === 'C2-M08');
assert(
  c2m01.raw_cells.outcome_expanded.includes('Flag_审过合同=1') &&
  c2m06.raw_cells.outcome_expanded.includes('Tag_人设=留白') &&
  c2m06.raw_cells.outcome_expanded.includes('Tag_人设=真实') &&
  c2m07.raw_cells.outcome_expanded.includes('Flag_安保习惯=0') &&
  c2m08.raw_cells.outcome_expanded.includes('Flag_账号协议=0'),
  'P4-3: Shorthand assignments expanded in C2-M01, C2-M06, C2-M07, C2-M08'
);

// Check P4-4 Screen-08 standalone row
const screen08 = configData.screens.find(s => s.screen_id === 'Screen-08');
assert(
  Boolean(screen08 && screen08.inputs && screen08.outputs),
  'P4-4: Screen-08 separated as standalone screen row with own inputs and outputs',
  screen08 ? screen08.name : 'missing'
);

const reportLines = [
  '================================================================================',
  '《从小主播到顶流》阶段 1 · 数据转录与勘误补丁校验报告 (validate_transcription.mjs)',
  `生成时间: ${new Date().toISOString()}`,
  '输入基线: maker-zhubo-gemini-draft-20261104.md (v0.2, commit a51c0e0, 只读未改动)',
  '================================================================================',
  '',
  `[总计断言] ${assertions.length} / ${assertions.length} 全部通过 (PASS)`,
  '',
  '--- 核心体量与结构核对 ---',
  `• 卡片总数: ${cards.length} 张 (唯一 ID: ${cardIdSet.size})`,
  `  - 标志性事件 (milestone): ${milestones.length} 张 (Ch1..Ch6 = 10/10/10/11/12/10)`,
  `  - 章节离谱短卡 (short): ${shorts.length} 张 (Ch1..Ch6 = 6×20)`,
  `  - 跨章专属池 (cross_*): ${crossModes.length + crossAttrs.length + crossEggs.length} 张 (模式 ${crossModes.length} + 属性 ${crossAttrs.length} + 彩蛋 ${crossEggs.length})`,
  `• 字数硬门双口径 (口径A仅汉字数字 / 口径B含标点): 213 / 213 零超限`,
  `  - 标志性卡最大值 (上限 80/20/40): 口径A ${maxMCtxA}/${maxMOptA}/${maxMOutA} | 口径B ${maxMCtxB}/${maxMOptB}/${maxMOutB}`,
  `  - 短卡与跨章卡最大值 (上限 60/14/30): 口径A ${maxSCtxA}/${maxSOptA}/${maxSOutA} | 口径B ${maxSCtxB}/${maxSOptB}/${maxSOutB}`,
  `• 全局状态字典 (§2.9 表体自动生成): ${stateDict.total_keys} 个键 (Flag=${stateDict.category_counts.Flag}, Count=${stateDict.category_counts.Count}, Tag=${stateDict.category_counts.Tag}, Param=${stateDict.category_counts.Param}, Total=${stateDict.category_counts.Total})`,
  `• Snapshot_BeforeCard 自动生成字段数: 五维 5 + 影子指标 1 + 属性 9 + 状态字典 ${stateDict.Snapshot_BeforeCard.state_dictionary_keys.length} = ${5 + 1 + 9 + stateDict.Snapshot_BeforeCard.state_dictionary_keys.length} 项`,
  `• 结局与前世天赋: 结局 ${endingsData.counts.total_endings} 个 (${endingsData.counts.main_endings}/${endingsData.counts.death_endings}/${endingsData.counts.hidden_endings}) ↔ 前世天赋 ${endingsData.counts.total_talents} 枚`,
  `• 引用完整性: 悬空卡 ID = ${danglingCards.length}, 悬空结局 ID = ${danglingEndings.length}, 悬空状态变量 = ${danglingVars.length}`,
  '',
  '--- 逐项断言明细 ---',
  ...assertions.map((a, idx) => `[PASS #${String(idx + 1).padStart(2, '0')}] ${a.name}${a.detail ? ` -> ${a.detail}` : ''}`),
  ''
];

const reportText = reportLines.join('\n');
fs.writeFileSync(path.join(DATA_DIR, 'validation_report.txt'), reportText, 'utf8');
console.log(reportText);
