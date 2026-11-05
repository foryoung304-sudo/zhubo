import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DRAFT_PATH = path.join(REPO_ROOT, 'maker-zhubo-gemini-draft-20261104.md');
const DATA_DIR = path.join(REPO_ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const draftText = fs.readFileSync(DRAFT_PATH, 'utf8');
const lines = draftText.split(/\r?\n/);

// Helper: strip markdown formatting for clean text while keeping semantics
function stripMd(str) {
  return str
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

// Helper: normalize unpadded ending IDs (Errata P4-1), excluding Drama Library v2 "私 D1..D4"
function normalizeEndingIds(str) {
  if (!str) return str;
  return str
    .replace(/\bM([1-9])\b/g, 'M0$1')
    .replace(/(?<!私\s*)\bD([1-9])\b/g, 'D0$1')
    .replace(/\bH([1-9])\b/g, 'H0$1')
    .replace(/H01\s*和黑粉头子成真朋友/g, 'H01 黑粉头子是真爱')
    .replace(/H05\s*算法觉醒/g, 'H05 冲出楚门直播间');
}

// ============================================================================
// 1. Auto-generate State Dictionary & Snapshot_BeforeCard from §2.9 table body (Errata P1-1)
// ============================================================================
function parseStateDictionary() {
  const variables = [];
  let inSec29 = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('### 2.9 ')) {
      inSec29 = true;
      continue;
    }
    if (inSec29 && line.startsWith('### 2.10')) {
      break;
    }
    if (!inSec29 || !line.startsWith('|')) continue;

    const cols = line.split('|').slice(1, -1).map(c => c.trim());
    if (cols.length < 6) continue;
    // Match table body rows starting with backticked variable name
    const keyMatch = cols[0].match(/`((?:Flag_|Count_|Tag_|Param_|Total_)[A-Za-z0-9_\u4e00-\u9fa5]+)`/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const prefix = key.startsWith('Flag_')
      ? 'Flag'
      : key.startsWith('Count_')
      ? 'Count'
      : key.startsWith('Tag_')
      ? 'Tag'
      : key.startsWith('Param_')
      ? 'Param'
      : 'Total';

    const rawType = stripMd(cols[1]);
    const rawInit = stripMd(cols[2]);
    const rawRange = stripMd(cols[3]);
    let writers = normalizeEndingIds(stripMd(cols[4]));
    let consumers = normalizeEndingIds(stripMd(cols[5]));

    let initVal = rawInit;
    if (/^\d+$/.test(rawInit)) initVal = Number(rawInit);
    else if (rawInit === '¥0') initVal = 0;

    const entry = {
      line_no: i + 1,
      key,
      category: prefix,
      type: rawType,
      initial_value: initVal,
      range_or_cap: rawRange,
      writers_text: writers,
      consumers_text: consumers
    };

    // Errata P1-2 (ec7ea5e) + Addendum (fb6cb71): Count_算法异常 option qualifiers & dual H05 trigger
    if (key === 'Count_算法异常') {
      entry.writers_text = '运气 = 10 时仅 C4-S19 选 B、C5-S19 选 B、C6-S19 选 A 时各 +1（定向保底）';
      entry.writers_qualified = [
        { card_id: 'C4-S19', opt_key: 'B', delta: 1, req_expr: '运气 == 10' },
        { card_id: 'C5-S19', opt_key: 'B', delta: 1, req_expr: '运气 == 10' },
        { card_id: 'C6-S19', opt_key: 'A', delta: 1, req_expr: '运气 == 10' }
      ];
      entry.consumers_text = '累计达 = 3 满格即时触发，或（运气 = 10 满值且打通第六章）于第六章章末结算触发，解锁彩蛋结局 H05 冲出楚门直播间';
      entry.errata_applied = ['P1-2 (ec7ea5e: threshold = 3)', 'Addendum (fb6cb71: dual trigger + option qualifiers C4-S19:B / C5-S19:B / C6-S19:A)'];
    }

    variables.push(entry);
  }

  const byCategory = {
    Flag: variables.filter(v => v.category === 'Flag').map(v => v.key),
    Count: variables.filter(v => v.category === 'Count').map(v => v.key),
    Tag: variables.filter(v => v.category === 'Tag').map(v => v.key),
    Param: variables.filter(v => v.category === 'Param').map(v => v.key),
    Total: variables.filter(v => v.category === 'Total').map(v => v.key)
  };

  // Auto-generate Snapshot_BeforeCard field list from §2.9 table body (Errata P1-1)
  const snapshotBeforeCard = {
    description: '整卡快照回滚字段清单（由 §2.9 表体自动生成，严禁手抄数字 · 勘误 P1-1）',
    five_dimensions: ['Fans', 'Heat', 'Wallet', 'Rep', 'Stamina'],
    shadow_indicators: ['Hater_Pct'],
    protagonist_attributes: ['颜值', '嗓音', '才艺', '游戏技术', '口才', '情商', '体力', '心态', '运气'],
    state_dictionary_keys_count: variables.length,
    state_dictionary_keys: variables.map(v => v.key)
  };

  return {
    schema_version: 'v0.2-transcribed',
    source_section: 'maker-zhubo-gemini-draft-20261104.md §2.9 (auto-generated from table body)',
    errata_rulings: ['P1-1: 36 keys auto-generated from §2.9 table body', 'P1-2 + fb6cb71: Count_算法异常 option qualifiers & H05 dual trigger'],
    total_keys: variables.length,
    category_counts: {
      Flag: byCategory.Flag.length,
      Count: byCategory.Count.length,
      Tag: byCategory.Tag.length,
      Param: byCategory.Param.length,
      Total: byCategory.Total.length
    },
    keys_by_category: byCategory,
    Snapshot_BeforeCard: snapshotBeforeCard,
    variables
  };
}

// ============================================================================
// 2. Parse all 213 Cards into §2.10 Schema (with Errata P2-1, P3-1, P3-3, P4-1, P4-3, fb6cb71)
// ============================================================================
const DUAL_TAG_MILESTONE_IDS = new Set([
  'C2-M04', 'C2-M07', 'C2-M08', 'C3-M07',
  'C4-M04', 'C4-M07', 'C4-M09', 'C5-M03',
  'C5-M06', 'C6-M02', 'C6-M03', 'C6-M05'
]);

const PITY_GUARANTEED_MILESTONES = new Set([
  'C1-M01', 'C1-M02', 'C1-M03', 'C1-M04', 'C1-M07', 'C1-M10',
  'C2-M01', 'C2-M02', 'C2-M03', 'C2-M04', 'C2-M06', 'C2-M07', 'C2-M08', 'C2-M10',
  'C3-M01', 'C3-M02', 'C3-M03', 'C3-M04', 'C3-M06', 'C3-M08', 'C3-M09', 'C3-M10',
  'C4-M01', 'C4-M02', 'C4-M03', 'C4-M05', 'C4-M06', 'C4-M07', 'C4-M08',
  'C5-M01', 'C5-M02', 'C5-M03', 'C5-M04', 'C5-M05', 'C5-M07', 'C5-M08', 'C5-M10', 'C5-M12',
  'C6-M02', 'C6-M03', 'C6-M05', 'C6-M07', 'C6-M08', 'C6-M09', 'C6-M10'
]);

const COUNTER_PITY_CARDS = {
  'C1-S01': { chain: 'Count_猫上镜', step: '1/3', WriteOpt: ['A', 'B'] },
  'C2-S01': { chain: 'Count_猫上镜', step: '2/3', WriteOpt: ['A', 'B'] },
  'C3-S01': { chain: 'Count_猫上镜', step: '3/3', WriteOpt: ['A', 'B'] },
  'C1-S07': { chain: 'Count_考编', step: '1/3', WriteOpt: ['A'] },
  'C2-S17': { chain: 'Count_考编', step: '2/3', WriteOpt: ['A'] },
  'C4-S16': { chain: 'Count_考编', step: '3/3', WriteOpt: ['A'] },
  'C4-S19': { chain: 'Count_算法异常', step: '1/3', WriteOpt: ['B'], req: '运气 == 10' },
  'C5-S19': { chain: 'Count_算法异常', step: '2/3', WriteOpt: ['B'], req: '运气 == 10' },
  'C6-S19': { chain: 'Count_算法异常', step: '3/3', WriteOpt: ['A'], req: '运气 == 10' },
  'C1-M07': { chain: 'Count_黑粉不对线', step: '1/3', WriteOpt: ['B'] },
  'C2-S08': { chain: 'Count_黑粉不对线', step: '2/3', WriteOpt: ['B'] },
  'C3-S12': { chain: 'Count_黑粉不对线', step: '3/3', WriteOpt: ['B'] },
  'X-EGG-04': { chain: 'Count_黑粉不对线', step: 'finale', WriteOpt: ['A'] }
};

const ART_MILESTONE_CARDS = new Set([
  'C1-M01', 'C1-M02', 'C1-M04', 'C1-M07',
  'C2-M01', 'C2-M02', 'C2-M03', 'C2-M05',
  'C3-M01', 'C3-M02', 'C3-M05', 'C3-M06',
  'C4-M01', 'C4-M02', 'C4-M05', 'C4-M07', 'C4-M08', 'C4-M09', 'C4-M10',
  'C5-M01', 'C5-M02', 'C5-M03', 'C5-M04', 'C5-M05', 'C5-M07', 'C5-M08', 'C5-M10', 'C5-M11', 'C5-M12',
  'C6-M01', 'C6-M02', 'C6-M04', 'C6-M05', 'C6-M08', 'C6-M09', 'C6-M10'
]);

function extractModeTags(modeCell) {
  const tags = [];
  const re = /`\[([^\]]+)\]`/g;
  let m;
  while ((m = re.exec(modeCell)) !== null) {
    const val = m[1].trim();
    if (!val.startsWith('操作：')) {
      tags.push(val);
    }
  }
  return tags;
}

function extractOpsType(modeCell, contextCell) {
  const combined = `${modeCell} ${contextCell}`;
  if (combined.includes('[操作：时机条]')) return 'timing_bar';
  if (combined.includes('[操作：翻样辨真]')) return 'sample_inspect';
  return 'none';
}

function expandShorthandOutcome(cardId, outcomeRaw) {
  let text = normalizeEndingIds(outcomeRaw);
  // Errata P4-3: expand shorthand variable assignments
  if (cardId === 'C2-M01') {
    text = text.replace(/记`=1`/, '记`Flag_审过合同=1`');
  } else if (cardId === 'C2-M06') {
    text = text
      .replace(/B记`=留白`/, 'B记`Tag_人设=留白`')
      .replace(/C记`=真实`/, 'C记`Tag_人设=真实`');
  } else if (cardId === 'C2-M07') {
    text = text.replace(/记`=0`/, '记`Flag_安保习惯=0`');
  } else if (cardId === 'C2-M08') {
    text = text.replace(/记`=0`/, '记`Flag_账号协议=0`');
  } else if (cardId === 'C6-S19') {
    // Errata fb6cb71: clarify that Option A writes Count_算法异常+1 and triggers H05 at 3/3
    text = 'A记`Count_算法异常+1`满3进H05；B口碑+10';
  }
  return text;
}

function parseOptionSegments(cardId, optColRaw, outcomeExpanded) {
  const optParts = optColRaw.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
  const options = [];

  for (const part of optParts) {
    const m = part.match(/^\*\*([A-C])\.\*\*\s*(.+)$/);
    if (!m) continue;
    const optKey = m[1];
    let label = m[2].trim();
    // Strip surrounding quotes 「...」 for clean label while preserving raw
    const cleanLabel = label.replace(/^「|」$/g, '').trim();

    let reqExpr = null;
    if (cardId === 'C6-S19' && optKey === 'A') {
      reqExpr = '运气 == 10';
    } else if (cardId === 'C5-M02' && optKey === 'A') {
      reqExpr = 'Count_复盘留档 >= 2';
    } else if (cardId === 'C5-M09' && optKey === 'A') {
      reqExpr = '心态 >= 7';
    } else if (cardId === 'C3-M08' && optKey === 'B') {
      reqExpr = '才艺 >= 7';
    } else if (cardId === 'C5-M12' && optKey === 'C') {
      reqExpr = 'Count_前任律师函 >= 1';
    } else if (cardId === 'X-MODE-03' && optKey === 'A') {
      reqExpr = '才艺 >= 6 || 嗓音 >= 6';
    } else if (cardId === 'X-EGG-04' && optKey === 'A') {
      reqExpr = 'Count_黑粉不对线 >= 3 && 情商 >= 7';
    }

    // Extract option-specific effect slice from outcomeExpanded
    const effectsObj = extractStructuredEffects(cardId, optKey, outcomeExpanded);

    options.push({
      opt_key: optKey,
      label: cleanLabel,
      raw_label: label,
      req_expr: reqExpr,
      effects: effectsObj,
      outcome_toast: stripMd(outcomeExpanded)
    });
  }
  return options;
}

function extractStructuredEffects(cardId, optKey, outcomeExpanded) {
  // Preserve separation around backticked identifiers before stripping markdown
  const spaced = outcomeExpanded.replace(/`((?:Flag_|Count_|Tag_|Param_)[A-Za-z0-9_\u4e00-\u9fa5]+(?:\s*[+=]\s*[^`]+)?)`/g, ' $1 ');
  const clean = stripMd(spaced).replace(/\s+/g, ' ').trim();
  // Extract segment for optKey (e.g., A..., B..., C...)
  let slice = clean;
  // Split by ； or /
  const clauses = clean.split(/[；/（）()]/).map(s => s.trim()).filter(Boolean);
  const matchingClauses = clauses.filter(c => {
    if (c.startsWith(optKey) && !/^[A-C]\/[A-C]/.test(c)) return true;
    if (c.startsWith('A/B') && (optKey === 'A' || optKey === 'B')) return true;
    if (c.startsWith('B/C') && (optKey === 'B' || optKey === 'C')) return true;
    if (c.startsWith('均达')) return true;
    return false;
  });
  if (matchingClauses.length > 0) {
    slice = matchingClauses.join('；');
  }

  const stateWrites = [];
  const varMatches = slice.matchAll(/((?:Flag_|Count_|Tag_|Param_)[A-Za-z0-9_\u4e00-\u9fa5]+)(?:\s*([+=])\s*([^\s；，,）)]+))?/g);
  for (const vm of varMatches) {
    const varName = vm[1];
    const opSym = vm[2] || '=';
    const rawVal = vm[3] !== undefined ? vm[3] : '1';
    stateWrites.push({
      key: varName,
      op: opSym === '+' ? 'add' : 'set',
      value: /^\d+$/.test(rawVal) ? Number(rawVal) : rawVal
    });
  }

  // Special handling for Errata fb6cb71 on Count_算法异常 writers:
  // C4-S19: only B writes +1; C5-S19: only B writes +1; C6-S19: only A writes +1
  if (cardId === 'C4-S19' || cardId === 'C5-S19') {
    stateWrites.length = 0;
    if (optKey === 'B') {
      stateWrites.push({ key: 'Count_算法异常', op: 'add', value: 1, req_expr: '运气 == 10' });
    }
  } else if (cardId === 'C6-S19') {
    stateWrites.length = 0;
    if (optKey === 'A') {
      stateWrites.push({ key: 'Count_算法异常', op: 'add', value: 1, req_expr: '运气 == 10' });
    }
  } else if (cardId === 'C3-S01' || cardId === 'C1-S01' || cardId === 'C2-S01') {
    // Cat chain
    if (cardId === 'C3-S01' && stateWrites.length === 0) {
      stateWrites.push({ key: 'Count_猫上镜', op: 'add', value: 1 });
    }
  }

  // Extract referenced endings in this option slice
  const endingTriggers = [];
  const endRe = /\b(M0[1-9]|M1[0-2]|D0[1-9]|D1[0-9]|D2[0-6]|H0[1-9]|H1[0-2])\b/g;
  let em;
  while ((em = endRe.exec(slice)) !== null) {
    if (!endingTriggers.includes(em[1])) endingTriggers.push(em[1]);
  }

  // Extract next-card links
  const nextCards = [];
  const cardRe = /\b(C[1-6]-[MS]\d{2}|X-(?:MODE|ATTR|EGG)-\d{2})\b/g;
  let cm;
  while ((cm = cardRe.exec(slice)) !== null) {
    if (cm[1] !== cardId && !nextCards.includes(cm[1])) nextCards.push(cm[1]);
  }

  // Errata P4-2: X-EGG-09 distinct epilogue & effect per option, shared talent
  let epilogueVariant = null;
  let grantedTalent = null;
  if (cardId === 'X-EGG-09') {
    grantedTalent = '【真·顶流权柄】';
    epilogueVariant = optKey === 'A'
      ? '星海真神：推开星空大门加冕星海真神（全属性+1）'
      : '万界旅人：回头向所有平行自己举杯致意（初始口碑提升至90）';
  }

  return {
    summary: slice,
    state_writes: stateWrites,
    ending_triggers: endingTriggers,
    next_cards: nextCards,
    ...(epilogueVariant ? { epilogue_variant: epilogueVariant, granted_talent: grantedTalent } : {})
  };
}

function parseCards() {
  const cards = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const cols = line.split('|').slice(1, -1).map(c => c.trim());
    if (cols.length < 5) continue;

    const id = cols[0];
    const isMilestone = /^C([1-6])-M\d{2}$/.test(id);
    const isShort = /^C([1-6])-S\d{2}$/.test(id);
    const isCrossMode = /^X-MODE-\d{2}$/.test(id);
    const isCrossAttr = /^X-ATTR-\d{2}$/.test(id);
    const isCrossEgg = /^X-EGG-\d{2}$/.test(id);

    if (!isMilestone && !isShort && !isCrossMode && !isCrossAttr && !isCrossEgg) continue;

    let poolType, chapter, entryMin, entryMax;
    let title, prototypeRef = null, modeCell, contextCell, optCell, outcomeCell;

    if (isMilestone) {
      poolType = 'milestone';
      chapter = Number(id.match(/^C([1-6])/)[1]);
      entryMin = chapter;
      entryMax = chapter;
      const titleParts = cols[1].split(/<br\s*\/?>/i);
      title = stripMd(titleParts[0]);
      if (titleParts[1]) {
        prototypeRef = stripMd(titleParts[1]).replace(/^（|）$/g, '').replace(/^原型：/, '').trim();
      }
      modeCell = cols[2];
      contextCell = cols[3];
      optCell = cols[4];
      outcomeCell = cols[5];
    } else {
      chapter = isShort ? Number(id.match(/^C([1-6])/)[1]) : null;
      if (isShort) {
        poolType = 'short';
        entryMin = chapter;
        entryMax = chapter;
      } else if (isCrossMode) {
        poolType = 'cross_mode';
        entryMin = 2;
        entryMax = 6;
      } else if (isCrossAttr) {
        poolType = 'cross_attr';
        entryMin = 2;
        entryMax = 6;
      } else {
        poolType = 'cross_egg';
        const eggNum = Number(id.slice(-2));
        entryMin = eggNum <= 5 ? 3 : 4;
        entryMax = 6;
      }
      modeCell = cols[1];
      contextCell = cols[2];
      optCell = cols[3];
      outcomeCell = cols[4];

      // Extract bold title prefix if present, else first clause
      const boldMatch = contextCell.match(/^\*\*([^*]+)\*\*：/);
      if (boldMatch) {
        title = boldMatch[1].trim();
      } else {
        const cleanCtx = stripMd(contextCell);
        title = cleanCtx.split(/[，。！？：（(]/)[0].slice(0, 18);
      }
    }

    const modeTags = extractModeTags(modeCell);
    const opsType = extractOpsType(modeCell, contextCell);
    const isSerious = id === 'C4-M09' || id === 'C4-M10' || id === 'C5-M11';

    // Determine gate_type and weight_rule per Errata P2-1
    let gateType = 'soft';
    let weightRule = { base: 1.0, match_mode: 1.0, non_match_mode: 1.0 };
    const hasAllMode = modeTags.includes('全模式');
    const specificModes = modeTags.filter(t => t !== '全模式');

    if (isMilestone) {
      if (DUAL_TAG_MILESTONE_IDS.has(id) || (hasAllMode && specificModes.length > 0)) {
        gateType = 'dual_boost';
        // Errata P2-1: 12 dual-tagged milestone cards have base 1.0, match_mode 2.0, NO 0.5 downweight
        weightRule = {
          base: 1.0,
          match_mode: 2.0,
          non_match_mode: 1.0,
          specific_modes: specificModes
        };
      } else if (!hasAllMode && specificModes.length > 0) {
        gateType = 'hard';
        weightRule = {
          base: 1.0,
          match_mode: 1.0,
          non_match_mode: 0.0,
          specific_modes: specificModes
        };
      } else {
        gateType = 'soft';
        weightRule = { base: 1.0, match_mode: 1.0, non_match_mode: 1.0 };
      }
    } else {
      // Short or Cross-chapter cards: Errata P2-1 maintains 3.0 match / 0.5 non-match for mode-tagged short/cross cards
      gateType = 'soft';
      if (specificModes.length > 0) {
        weightRule = {
          base: 1.0,
          match_mode: 3.0,
          non_match_mode: 0.5,
          specific_modes: specificModes
        };
      } else {
        weightRule = {
          base: 1.0,
          match_mode: 1.0,
          non_match_mode: 1.0
        };
      }
      if (isCrossAttr) {
        weightRule.first_qualify_chapter_boost = 4.0;
      }
    }

    // Extract prereq_expr
    let prereqExpr = null;
    const gateInCtx = contextCell.match(/（门控：([^）]+)）/);
    if (gateInCtx) {
      prereqExpr = stripMd(gateInCtx[1]);
    } else if (isCrossAttr || isCrossEgg) {
      const modeParts = modeCell.split(/<br\s*\/?>/i).slice(1);
      if (modeParts.length > 0) {
        prereqExpr = normalizeEndingIds(stripMd(modeParts.join(' ')));
      }
    } else if (id === 'C4-S19' || id === 'C5-S19' || id === 'C6-S19') {
      prereqExpr = '运气 == 10';
    }

    // Determine ops_note (Errata P3-1, P3-3, Review §4)
    let opsNote = null;
    let opsConfig = null;
    if (id === 'C3-M08') {
      opsNote = '开火时点为耳返故障后的舞台盲跳卡点段（直播进行时）';
    } else if (id === 'C6-M05') {
      opsNote = '时机条结果在选项结算后生效，且只作用于非煽动选项（选项B）';
    } else if (opsType === 'timing_bar') {
      opsNote = '直播进行时光标单向扫过横条（≤5秒），甜区×1.15 / 良区×1.05 / 普通×1.0，并入单卡Cap夹逼';
    } else if (opsType === 'sample_inspect') {
      opsNote = '桌面扣放3件样品文字卡，先翻开任意2件看线索，再四键指认（指认#1掺假 / 指认#2掺假 / 指认#3掺假 / 三件全合格），命中记 Count_验货命中+1（P3-1）';
      opsConfig = {
        total_samples: 3,
        flip_limit: 2,
        choice_buttons: ['指认 #1 掺假', '指认 #2 掺假', '指认 #3 掺假', '三件全合格'],
        hit_effect: 'Count_验货命中 +1; Flag_选品减伤 = 1'
      };
    }

    const cleanContext = stripMd(
      contextCell
        .replace(/`\[操作：[^\]]+\]`\s*/g, '')
        .replace(/`\[正经卡\]`\s*/g, '')
    );

    const outcomeExpanded = expandShorthandOutcome(id, outcomeCell);
    const options = parseOptionSegments(id, optCell, outcomeExpanded);

    const isPityGuaranteed =
      PITY_GUARANTEED_MILESTONES.has(id) ||
      Boolean(COUNTER_PITY_CARDS[id]) ||
      ['X-EGG-03', 'X-EGG-05', 'X-EGG-08', 'X-EGG-09'].includes(id);

    cards.push({
      card_id: id,
      line_no: i + 1,
      pool_type: poolType,
      chapter,
      entry_chapter_min: entryMin,
      entry_chapter_max: entryMax,
      title,
      prototype_ref: prototypeRef,
      mode_tags: modeTags,
      gate_type: gateType,
      weight_rule: weightRule,
      prereq_expr: prereqExpr,
      is_pity_guaranteed: isPityGuaranteed,
      pity_chain: COUNTER_PITY_CARDS[id] || null,
      is_serious: isSerious,
      ops_type: opsType,
      ops_note: opsNote,
      ...(opsConfig ? { ops_config: opsConfig } : {}),
      has_art: ART_MILESTONE_CARDS.has(id),
      context_text: cleanContext,
      raw_cells: {
        mode_col: modeCell,
        context_col: contextCell,
        options_col: optCell,
        outcome_col: outcomeCell,
        outcome_expanded: outcomeExpanded
      },
      options
    });
  }

  return cards;
}

// ============================================================================
// 3. Parse all 50 Endings & 50 Past-Life Talents (§4.1–§4.3, Errata P1-2, P4-1, P4-2, fb6cb71)
// ============================================================================
function parseEndingsAndTalents() {
  const endings = [];
  const talents = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const cols = line.split('|').slice(1, -1).map(c => c.trim());
    if (cols.length < 8) continue;

    const idMatch = cols[0].match(/^\*\*(M\d{2}|D\d{2}|H\d{2})\*\*$/);
    if (!idMatch) continue;

    const id = idMatch[1];
    const tier = id.startsWith('M') ? 'main' : id.startsWith('D') ? 'death' : 'hidden';

    let subCategory = null;
    let nameCol, triggerCol, copyCol, quoteCol, rarityCol, hintCol, talentCol;

    if (tier === 'death') {
      subCategory = stripMd(cols[1]);
      nameCol = cols[2];
      triggerCol = cols[3];
      copyCol = cols[4];
      quoteCol = cols[5];
      rarityCol = cols[6];
      hintCol = cols[7];
      talentCol = cols[8];
    } else {
      nameCol = cols[1];
      triggerCol = cols[2];
      copyCol = cols[3];
      quoteCol = cols[4];
      rarityCol = cols[5];
      hintCol = cols[6];
      talentCol = cols[7];
    }

    const nameParts = nameCol.split(/<br\s*\/?>/i);
    const canonicalName = stripMd(nameParts[0]);
    const originalName = nameParts[1]
      ? stripMd(nameParts[1]).replace(/^\*\(|\)\*$/g, '').replace(/^（|）$/g, '').trim()
      : null;

    let triggerText = normalizeEndingIds(stripMd(triggerCol));
    let triggerSourcesStructured = null;

    // Errata P1-2 (ec7ea5e) + Addendum (fb6cb71): H05 threshold = 3 AND second trigger source restored
    if (id === 'H05') {
      triggerText = '开局 运气 = 10（基础满点）且 Count_算法异常 = 3（C4-S19选B / C5-S19选B / C6-S19选A 满格即时触发），或（运气 = 10 满值且打通第六章）于第六章章末结算触发';
      triggerSourcesStructured = [
        {
          source_id: 'H05_SRC_1_COUNTER_FULL_IMMEDIATE',
          expr: '运气 == 10 && Count_算法异常 == 3',
          timing: 'immediate_on_counter_3_of_3',
          required_choices: ['C4-S19:B', 'C5-S19:B', 'C6-S19:A']
        },
        {
          source_id: 'H05_SRC_2_CH6_CLEAR_WITH_MAX_LUCK',
          expr: '运气 == 10 && chapter_6_cleared == true',
          timing: 'chapter_6_end_settlement'
        }
      ];
    }

    const talentParts = talentCol.split(/<br\s*\/?>/i);
    const talentName = stripMd(talentParts[0]);
    const talentEffect = normalizeEndingIds(stripMd(talentParts.slice(1).join(' ')));

    const endingEntry = {
      ending_id: id,
      line_no: i + 1,
      tier,
      sub_category: subCategory,
      name: canonicalName,
      original_name: originalName,
      aliases: originalName ? [originalName] : [],
      trigger_condition: triggerText,
      ...(triggerSourcesStructured ? { trigger_sources: triggerSourcesStructured } : {}),
      settlement_copy: stripMd(copyCol),
      life_quote: stripMd(quoteCol),
      rarity: stripMd(rarityCol),
      silhouette_hint: stripMd(hintCol),
      talent_id: `TALENT_${id}`,
      talent_name: talentName,
      talent_effect: talentEffect
    };

    // Errata P4-2: X-EGG-09 / H12 distinct epilogue per option, shared 50th talent
    if (id === 'H12') {
      endingEntry.epilogue_variants = {
        A: '【星海真神】你推开星空大门加冕星海真神，全星播十二条主线宇宙为你共鸣（全属性+1）。',
        B: '【万界旅人】你回头向所有平行时空的自己举杯致意，笑着走入下一场人间烟火（初始口碑直达90）。'
      };
      endingEntry.errata_note = 'P4-2: A/B选项结语不同，共用第50枚天赋【真·顶流权柄】，维持50结局一一对应50枚天赋对称性';
    }

    endings.push(endingEntry);
    talents.push({
      talent_id: `TALENT_${id}`,
      ending_id: id,
      ending_name: canonicalName,
      name: talentName,
      effect_text: talentEffect,
      respects_57_pool_cap: true,
      respects_10_stat_cap: true
    });
  }

  return {
    schema_version: 'v0.2-transcribed',
    counts: {
      total_endings: endings.length,
      main_endings: endings.filter(e => e.tier === 'main').length,
      death_endings: endings.filter(e => e.tier === 'death').length,
      hidden_endings: endings.filter(e => e.tier === 'hidden').length,
      total_talents: talents.length
    },
    carry_rules: {
      default_slots: 3,
      h11_expanded_slots: 4,
      same_stat_bonus_cap: 3,
      five_dim_init_bonus_cap_pct: 15,
      total_pool_hard_cap: 57,
      single_stat_hard_cap: 10
    },
    endings,
    talents
  };
}

// ============================================================================
// 4. Parse Config, Chapters, Attributes, Screens (with Screen-08 split per P4-4 & Art 69 cap per P3-2)
// ============================================================================
function buildConfigAndScreens() {
  return {
    schema_version: 'v0.2-transcribed',
    errata_rulings_applied: [
      'P2-1: 12张双标标志性卡基线1.0、匹配×2.0、未匹配不降权(1.0)；短卡/跨章软门控维持匹配×3.0、未匹配×0.5',
      'P3-1: 翻样辨真为翻任意2件 + 四键指认（指认#1掺假 / 指认#2掺假 / 指认#3掺假 / 三件全合格）',
      'P3-2: 全本美术总盘69张封顶（NPC 36 + 底板模板 6 + 结局 27 = 69）',
      'P4-1: §2.6 属性表全部结局ID补零（M08 / M02 / M10 / H01 黑粉头子是真爱 / H05 冲出楚门直播间 / H06）',
      'P4-4: Screen-08（结局分享卡弹窗）独立成行，具备独立输入与输出定义'
    ],
    chapters: [
      { chapter: 1, name: '0 粉开播', fans_gate_from: 0, fans_gate_to: 1000, net_fans_req: 1000, cards_per_chapter: 5, Base_Fans: 220, Cap_Fans: 600, chapter_5card_fans_cap: 3000, Base_Income: 800, Cap_Wallet: 3000 },
      { chapter: 2, name: '千粉小成', fans_gate_from: 1000, fans_gate_to: 10000, net_fans_req: 9000, cards_per_chapter: 5, Base_Fans: 2000, Cap_Fans: 5000, chapter_5card_fans_cap: 25000, Base_Income: 4000, Cap_Wallet: 15000 },
      { chapter: 3, name: '万粉新秀', fans_gate_from: 10000, fans_gate_to: 100000, net_fans_req: 90000, cards_per_chapter: 5, Base_Fans: 20000, Cap_Fans: 45000, chapter_5card_fans_cap: 225000, Base_Income: 20000, Cap_Wallet: 80000 },
      { chapter: 4, name: '十万粉达人', fans_gate_from: 100000, fans_gate_to: 1000000, net_fans_req: 900000, cards_per_chapter: 5, Base_Fans: 200000, Cap_Fans: 400000, chapter_5card_fans_cap: 2000000, Base_Income: 120000, Cap_Wallet: 500000 },
      { chapter: 5, name: '百万粉头部', fans_gate_from: 1000000, fans_gate_to: 5000000, net_fans_req: 4000000, cards_per_chapter: 5, Base_Fans: 900000, Cap_Fans: 2000000, chapter_5card_fans_cap: 10000000, Base_Income: 500000, Cap_Wallet: 2000000 },
      { chapter: 6, name: '顶流之夜', fans_gate_from: 5000000, fans_gate_to: 10000000, net_fans_req: 5000000, cards_per_chapter: 5, Base_Fans: 1100000, Cap_Fans: 5000000, chapter_5card_fans_cap: 25000000, Base_Income: 1200000, Cap_Wallet: 5000000 }
    ],
    five_dimensions: {
      Fans: { initial: 0, min: 0, max: 10000000, chapter_never_regresses: true },
      Heat: { initial: 100, min: 0, max: 10000, stage_decay_pct: 0.15, stage_decay_floor_min: 15, rounding: 'Math.floor', death_ending_on_zero: 'D04' },
      Wallet: { initial: 2000, min: 0, max: 99999999, normal_zero_death: 'D02', Indemnity_negative_deaths: { fake_goods: 'D12', contract_lawsuit: 'D13' } },
      Rep: { initial: 60, min: -100, max: 100, death_threshold: -20, death_ending: 'D03', sponsor_mult_cap: 1.5, m01_req: 85, m04_req: 80 },
      Stamina: { initial: 80, min: 0, max: 100, max_with_talent_or_stat10: 110, alert_zone_max: 29, alert_zone_replace_prob: 0.4, death_ending_on_zero: 'D01' },
      Hater_Pct: { initial: 5, min: 0, max: 100, death_ending_at_100: 'D05', mentality_save_threshold: 8 }
    },
    attributes_config: {
      base_pool: 45,
      ad_bonus_per_watch: 3,
      ad_max_watches: 4,
      ad_bonus_total_cap: 12,
      total_pool_cap: 57,
      ad_per_stat_cap: 3,
      ad_post_add_stat_cap: 8,
      stat_min: 1,
      stat_max: 10,
      practice_gain_cap_per_stat: 2,
      attributes: [
        { key: '颜值', thresholds: [{ expr: '颜值 >= 8', unlocks: ['X-ATTR-01'] }, { expr: '颜值 <= 3 && 口才 >= 7', unlocks: ['X-ATTR-10'] }, { expr: '颜值 <= 4 && 情商 >= 7 && 口才 >= 7', unlocks: ['M10'] }] },
        { key: '嗓音', thresholds: [{ expr: '嗓音 >= 6', unlocks: ['X-MODE-03:A'] }, { expr: '嗓音 >= 7', unlocks: ['C2-M03:A_no_loss'] }, { expr: '嗓音 >= 8', unlocks: ['X-ATTR-02', 'M06'] }] },
        { key: '才艺', thresholds: [{ expr: '才艺 >= 6', unlocks: ['X-MODE-03:A'] }, { expr: '才艺 >= 7', unlocks: ['C3-M08:B'] }, { expr: '才艺 >= 8', unlocks: ['X-ATTR-03', 'M07'] }] },
        { key: '游戏技术', thresholds: [{ expr: '游戏技术 >= 8', unlocks: ['C3-M03:B_no_loss', 'X-ATTR-04', 'M08'] }] },
        { key: '口才', thresholds: [{ expr: '口才 >= 7', unlocks: ['带货转化+25%', 'PK嘴仗免败'] }, { expr: '口才 >= 8', unlocks: ['X-ATTR-05', 'M02', 'M10'] }] },
        { key: '情商', thresholds: [{ expr: '情商 >= 6', unlocks: ['C3-M05:B_double'] }, { expr: '情商 >= 7 && Count_黑粉不对线 >= 3', unlocks: ['H01'] }, { expr: '情商 >= 8', unlocks: ['X-ATTR-06'] }] },
        { key: '体力', thresholds: [{ expr: '体力 >= 6', unlocks: ['6h档免额外-10惩罚'] }, { expr: '体力 >= 8', unlocks: ['深夜档消耗1.3x', 'X-ATTR-07', 'H06'] }] },
        { key: '心态', thresholds: [{ expr: '心态 >= 7', unlocks: ['C5-M09:A'] }, { expr: '心态 >= 8', unlocks: ['X-ATTR-08', 'D05_save'] }] },
        { key: '运气', thresholds: [{ expr: '运气 <= 2', unlocks: ['D22_high_risk'] }, { expr: '运气 <= 3', unlocks: ['X-EGG-02', 'D23'] }, { expr: '运气 >= 9', unlocks: ['X-ATTR-09'] }, { expr: '运气 == 10', unlocks: ['C4-S19', 'C5-S19', 'C6-S19', 'H05'] }] }
      ]
    },
    schedules: {
      time_slots: [
        { id: 'slot_morning', name: '清晨场 (06–09点)', fans_mult: 0.85, wallet_mult: 0.70, stamina_mult: 0.8 },
        { id: 'slot_noon', name: '午间场 (11–14点)', fans_mult: 1.10, wallet_mult: 0.85, stamina_mult: 1.0 },
        { id: 'slot_afternoon', name: '下午场 (14–18点)', fans_mult: 0.90, wallet_mult: 1.25, stamina_mult: 0.9 },
        { id: 'slot_prime', name: '黄金档 (19–23点)', fans_mult: 1.40, wallet_mult: 1.40, stamina_mult: 1.3 },
        { id: 'slot_late', name: '深夜档 (23–02点)', fans_mult: 1.15, wallet_mult: 1.50, stamina_mult: 2.0 }
      ],
      durations: [
        { hours: 2, name: '2 小时（短播养生档）', fans_mult: 0.8, base_stamina_cost: 10, req_physique: 1 },
        { hours: 4, name: '4 小时（标准主力档）', fans_mult: 1.0, base_stamina_cost: 20, req_physique: 4 },
        { hours: 6, name: '6 小时（铁人爆肝档）', fans_mult: 1.2, base_stamina_cost: 35, req_physique: 6, low_physique_extra_cost: 10 }
      ],
      off_stream_actions: [
        { id: 1, name: '补觉休息', effects: '状态 +30，清除熬夜透支 Debuff' },
        { id: 2, name: '专心练功', effects: '才艺/技术/口才三选一 +1（单局单项上限+2），状态 -5，下阶段对应模式乘区 +0.15' },
        { id: 3, name: '剪切片、运营账号', effects: '热度 +15%，状态 -5，切片出圈判定+1，累计≥3次解锁 M10' },
        { id: 4, name: '粉丝群运营/回私信', effects: '口碑 +5，状态 -5，星牌忠诚度 +15%，大哥好感 +10' },
        {
          id: 5,
          name: '选品与商务对接',
          ops_type: 'sample_inspect',
          ops_config: {
            total_samples: 3,
            flip_limit: 2,
            choice_buttons: ['指认 #1 掺假', '指认 #2 掺假', '指认 #3 掺假', '三件全合格'],
            hit_effect: 'Count_验货命中 +1; Flag_选品减伤 = 1'
          },
          effects: '下一场带货转化率 +20%，触发【翻样辨真】（翻任意2件 + 四键指认），命中则 Count_验货命中 +1（同步置 Flag_选品减伤=1）'
        },
        { id: 6, name: '看回放复盘、整理素材留档', effects: 'Count_复盘留档 +1（每累计2次留档，心态 +1），唯一反杀源（C5-M02 选 A 需 ≥2）' },
        { id: 7, name: '约会 / 社交', effects: '状态 +10，推进恋爱对象好感；保密期触发狗仔偷拍判定' },
        { id: 8, name: '接私活', effects: '钱包 +当章基准×0.4，状态 -20（签公会40%率违约警告）' }
      ]
    },
    screens: [
      { screen_id: 'Screen-01', name: '开局捏人与前世天赋屏', inputs: '9项属性±分配（基础45点，单项1-10）；看激励广告+3点（最多4次+12点，单项≤3且加后≤8）；前世天赋勾选（1-3枚，H11扩至4枚）；沿用上局配点与正式开播键', outputs: '实时显示剩余点数、广告次数(4/4)、粉丝吸引倾向标签；初始化状态字典进入 Screen-02' },
      { screen_id: 'Screen-02', name: '阶段排班屏（三连点）', inputs: '三连点（<10秒）：选直播模式（8选1）+ 选开播时段（5选1）+ 选开播时长（3选1：2h/4h/6h）', outputs: '预览预计状态消耗、自然涨粉乘区、高发事件标签；生成本章5张事件卡队列进入 Screen-03' },
      { screen_id: 'Screen-03', name: '事件卡主界面（纯文字卡默认）', inputs: '阅读情境文本（≤80/≤60字）；点选2-3个选项之一；结算后可点「重选一次（看广告）」（单局限1次，与暴毙复活共享额度）', outputs: '顶部常驻五维栏与章节进度；播放一句结算吐槽Toast、跳动五维数字；5卡走完进 Screen-04' },
      { screen_id: 'Ops-A', parent_screen: 'Screen-03', name: '轻操作一：时机条', inputs: '挂载于6张直播标志性卡（单次≤5秒）：光标单向扫过横条，点击「停」按钮（或降级三连点节奏）', outputs: '甜区×1.15 / 良区×1.05 / 普通×1.0，并入所在卡结算并受单卡 Cap 夹逼' },
      { screen_id: 'Screen-04', name: '下播行动屏（8 选 1）', inputs: '每章1-2个行动点，在8项下播行动中点选；第3-6章附买推流券与高端SPA商店入口', outputs: '即时结算状态/属性/计数累加；选「5.选品」弹出 Ops-B 翻样辨真；耗尽行动点进 Screen-05' },
      { screen_id: 'Ops-B', parent_screen: 'Screen-04 / C4-M02 / C5-M07', name: '轻操作二：翻样辨真', inputs: '桌面扣放3件样品文字卡，先点击翻开任意2件看文字线索，再在4个指认按钮中四选一（指认#1掺假 / 指认#2掺假 / 指认#3掺假 / 三件全合格）', outputs: '指认命中写入 Count_验货命中 +1（同步激活 Flag_选品减伤=1）；选错无直接惩罚' },
      { screen_id: 'Screen-05', name: '阶段（章末）结算屏', inputs: '查看本章总涨粉/净收入/粉丝6类构成漂移；可选点「阶段结算双倍（看广告）」（单局限2次）；未达标可进加时赛（+3卡）或达标晋升下一章', outputs: '滚动展示跨槛横幅、更新6类粉丝占比与黑粉浓度；第6章结算后进 Screen-07' },
      { screen_id: 'Screen-06', name: '中途暴毙结算页', inputs: '1.「暴毙复活：回到上一张卡重选（看广告）」（并入广告点位2，单局限1次）；2.「认命收下结局→进图鉴」；3.「再来一局」置顶按钮', outputs: '展示暴毙结局名、稀有度、搞笑文案、人生评语及【因果回放条】；点暴毙复活执行 Snapshot_BeforeCard 整卡快照回滚' },
      { screen_id: 'Screen-07', name: '终局加冕结算页', inputs: '1. 查看 M01–M12 主结局或 H01–H12 彩蛋详情与新解锁天赋；2.「番外视角解锁（看广告）」（广告点位3）；3.「生成结局分享卡」按钮（打开 Screen-08）；4. 置顶「再来一局」按钮（含沿用上局配点勾选）', outputs: '写入本地持久化图鉴与天赋存档，展示本局关键选择回放，支持打开 Screen-08 或 Screen-09' },
      { screen_id: 'Screen-08', name: '结局分享卡弹窗（独立成行 · 勘误 P4-4）', inputs: '1. 在分享卡预览弹窗中切换「显示/隐藏五维雷达图」或「显示/隐藏因果回放标签」；2. 点击「保存截图 / 晒图分享」按钮；3. 点击「关闭返回结算页」按钮（永不禁用）', outputs: '独立渲染单张高传播度分享卡片（结局大标题 + 稀有度印章 + 一句人生评语 + 五维最终雷达图 + 埋雷/封神关键选择回放），导出静态图片或触发截图引导后返回 Screen-06 / Screen-07' },
      { screen_id: 'Screen-09', name: '50 格结局图鉴与天赋陈列室', inputs: '按「主结局(12) / 中途暴毙(26) / 隐藏彩蛋(12)」三页签浏览50格图鉴；点击已解锁格看详情与天赋，点击未解锁剪影看单句线索；内置10/25/50成就墙切换', outputs: '顶部显示总收集进度 X/50 与稀有度分色统计（普通蓝/稀有紫/传说金），达成 10/25/50 结局时点亮内置成就墙勋章横幅' }
    ],
    art_budget: {
      cap_total: 69,
      ruling: 'P3-2: 追认 69 张为全本总盘封顶（超出 69 须店主另批）',
      breakdown: {
        npc_portraits_and_diffs: 36,
        ui_and_scene_templates: 6,
        ending_illustrations: 27
      }
    },
    engineering_red_lines: [
      '1. 退出按钮永不禁用',
      '2. 会话看门狗约 300 秒防无回调死等',
      '3. 进度用墙钟不用 SDK 回调',
      '4. skipped 绝不自动重试',
      '5. 改广告代码必跑回归'
    ]
  };
}

const stateDict = parseStateDictionary();
const cards = parseCards();
const endingsAndTalents = parseEndingsAndTalents();
const configAndScreens = buildConfigAndScreens();

fs.writeFileSync(path.join(DATA_DIR, 'state_dictionary.json'), JSON.stringify(stateDict, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'cards.json'), JSON.stringify(cards, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'endings_and_talents.json'), JSON.stringify(endingsAndTalents, null, 2), 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'config_and_screens.json'), JSON.stringify(configAndScreens, null, 2), 'utf8');

console.log(JSON.stringify({
  status: 'TRANSCRIPTION_COMPLETE',
  state_dictionary_keys: stateDict.total_keys,
  snapshot_fields: stateDict.Snapshot_BeforeCard.state_dictionary_keys_count,
  cards_total: cards.length,
  endings_total: endingsAndTalents.counts.total_endings,
  talents_total: endingsAndTalents.counts.total_talents,
  screens_total: configAndScreens.screens.length
}, null, 2));
