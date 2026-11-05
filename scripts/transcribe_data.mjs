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
      entry.consumers_qualified = [
        { ending_id: 'H05', trigger_mode: 'immediate_on_full_3', expr: 'Count_算法异常 == 3' },
        { ending_id: 'H05', trigger_mode: 'chapter_6_end_settlement', expr: '运气 == 10 && chapter_6_cleared' }
      ];
    }

    variables.push(entry);
  }

  // Build Snapshot_BeforeCard field list auto-generated from §2.9 table body keys
  const autoSnapshotStateKeys = variables.map(v => v.key);
  const fixedBaseFields = [
    '颜值', '嗓音', '才艺', '游戏技术', '口才', '情商', '体力', '心态', '运气',
    'Fans', 'Heat', 'Wallet', 'Rep', 'Stamina', 'Hater_Pct',
    'Fans_Passerby_Pct', 'Fans_Lover_Pct', 'Fans_Iron_Pct',
    'Fans_Troll_Pct', 'Fans_Pro_Pct', 'Fans_Rich_Pct'
  ];
  const allSnapshotFields = [...fixedBaseFields, ...autoSnapshotStateKeys];

  return {
    schema_version: 'v0.2-transcribed',
    total_keys: variables.length,
    counts: {
      Flag: variables.filter(v => v.category === 'Flag').length,
      Count: variables.filter(v => v.category === 'Count').length,
      Tag: variables.filter(v => v.category === 'Tag').length,
      Param: variables.filter(v => v.category === 'Param').length,
      Total: variables.filter(v => v.category === 'Total').length
    },
    variables,
    Snapshot_BeforeCard: {
      source: 'Auto-generated from §2.9 table body keys (Errata P1-1)',
      total_fields: allSnapshotFields.length,
      base_stats_count: fixedBaseFields.length,
      state_dictionary_keys_count: autoSnapshotStateKeys.length,
      fields: allSnapshotFields
    }
  };
}

// ============================================================================
// 2. Parse 213 Cards with Errata P2-1, P3-1, P3-3, P4-1~P4-4, Second Review P1-A, P1-B, P1-C, P2-C
// ============================================================================
const DUAL_TAG_MILESTONE_IDS = new Set([
  'C1-M03', 'C1-M04', 'C2-M03', 'C2-M05',
  'C3-M03', 'C3-M05', 'C4-M03', 'C4-M04', 'C4-M05',
  'C5-M03', 'C5-M04', 'C5-M05'
]);

// Second review rulings: 7 official schedule modes + Digital human slot 8
const SCHEDULE_MODES_7 = new Set(['游戏', '才艺', '电台', '团播', 'PK', '带货', '户外']);

// P1-A Pity Chains mapping (4 chains + trigger cards)
const PITY_CHAIN_MAP = {
  // 1. 猫上镜线: C1-S01 -> C2-S01 -> C3-S01
  'C1-S01': { chain: 'pity_cat', is_guaranteed: false, note: '猫上镜线起点卡，选A/B推进计数' },
  'C2-S01': { chain: 'pity_cat', is_guaranteed: true, note: '猫上镜线第2块拼图，满足前置定向保底' },
  'C3-S01': { chain: 'pity_cat', is_guaranteed: true, note: '猫上镜线第3块拼图，满足前置定向保底' },

  // 2. 考编上岸线: C1-S07 -> C2-S17 -> C4-S16
  'C1-S07': { chain: 'pity_exam', is_guaranteed: false, note: '考编上岸线起点卡，选A推进计数' },
  'C2-S17': { chain: 'pity_exam', is_guaranteed: true, note: '考编上岸线第2块拼图，满足前置定向保底' },
  'C4-S16': { chain: 'pity_exam', is_guaranteed: true, note: '考编上岸线第3块拼图，满足前置定向保底' },

  // 3. 算法觉醒线: C4-S19 -> C5-S19 -> C6-S19
  'C4-S19': { chain: 'pity_algorithm', is_guaranteed: true, note: '算法觉醒线第1块拼图，运气=10定向保底' },
  'C5-S19': { chain: 'pity_algorithm', is_guaranteed: true, note: '算法觉醒线第2块拼图，运气=10定向保底' },
  'C6-S19': { chain: 'pity_algorithm', is_guaranteed: true, note: '算法觉醒线第3块拼图，运气=10定向保底' },

  // 4. 黑粉不对线: C1-M07 -> C2-S08/C3-S12 -> X-EGG-04
  'C1-M07': { chain: 'pity_hater', is_guaranteed: false, note: '黑粉不对线起点卡，选B推进计数' },
  'C2-S08': { chain: 'pity_hater', is_guaranteed: true, note: '黑粉挑刺短卡，温和请教推进计数' },
  'C3-S12': { chain: 'pity_hater', is_guaranteed: true, note: '黑粉挑刺短卡，温和请教推进计数' },
  'X-EGG-04': { chain: 'pity_hater', is_guaranteed: true, note: '黑粉不对线终极彩蛋扳机卡，达标定向保底必出' },

  // 5. 跨章前置扳机必出保底卡 (X-EGG)
  'X-EGG-03': { chain: 'pity_trigger', is_guaranteed: true, note: '签极光直播后后续必出保底卡' },
  'X-EGG-05': { chain: 'pity_trigger', is_guaranteed: true, note: '放任切片号后后续必出保底卡' },
  'X-EGG-08': { chain: 'pity_trigger', is_guaranteed: true, note: '解锁≥30结局后必出保底卡' },
  'X-EGG-09': { chain: 'pity_trigger', is_guaranteed: true, note: '通关全部12主结局后终章必出仪式卡' }
};

function extractModeTags(cell) {
  const tags = [];
  const matches = cell.matchAll(/\[([^\]]+)\]/g);
  for (const m of matches) {
    const rawTag = m[1].trim();
    if (!rawTag.startsWith('操作：') && rawTag !== '正经卡') {
      tags.push(rawTag);
    }
  }
  return tags.length > 0 ? tags : ['全模式'];
}

function extractOpsType(modeCell, contextCell) {
  if (modeCell.includes('[操作：时机条]') || contextCell.includes('[操作：时机条]')) {
    return 'timing_bar';
  }
  if (modeCell.includes('[操作：翻样辨真]') || contextCell.includes('[操作：翻样辨真]')) {
    return 'sample_inspect';
  }
  return 'none';
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

    // P1-B: Determine gate_type from legal enum: ['hard', 'soft', 'dual_boost', 'progress', 'none']
    let gateType = 'soft';
    let weightRule = { base: 1.0, match_mode: 1.0, non_match_mode: 1.0, specific_modes: [] };
    const hasAllMode = modeTags.includes('全模式');
    const specificModes = modeTags.filter(t => t !== '全模式');

    if (id === 'C6-M06') {
      // S2: progress gate type (chapter/progress gate, base 1.0, no mode lockout)
      gateType = 'progress';
      weightRule = {
        base: 1.0,
        match_mode: 1.0,
        non_match_mode: 1.0,
        specific_modes: []
      };
    } else if (isMilestone) {
      if (DUAL_TAG_MILESTONE_IDS.has(id)) {
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
        gateType = 'none';
        weightRule = { base: 1.0, match_mode: 1.0, non_match_mode: 1.0, specific_modes: [] };
      }
    } else {
      // Short cards and cross-chapter cards
      if (id === 'X-MODE-09') {
        gateType = 'soft';
        weightRule = {
          base: 1.0,
          match_mode: 3.0,
          non_match_mode: 0.5,
          specific_modes: specificModes
        };
      } else if (specificModes.length > 0) {
        gateType = 'soft';
        weightRule = {
          base: 1.0,
          match_mode: 3.0,
          non_match_mode: 0.5,
          specific_modes: specificModes
        };
      } else {
        gateType = 'none';
        weightRule = { base: 1.0, match_mode: 1.0, non_match_mode: 1.0, specific_modes: [] };
      }
    }

    // P1-C (Errata S3): Parameterized timing bar ops_note (no fixed absolute intervals)
    let opsNote = null;
    if (id === 'C3-M08') {
      opsNote = 'P3-3/S3: 挂载【轻操作：时机条】（参数化甜区宽0.15/良区宽0.40，中心实例随机），结果在选项结算后生效';
    } else if (id === 'C6-M05') {
      opsNote = 'P3-3/S3: 挂载【轻操作：时机条】（参数化甜区宽0.15/良区宽0.40，中心实例随机），结果在选项结算后生效且只作用于非煽动选项（选项B稳健控场生效，选项A煽动不吃时机条）';
    } else if (opsType === 'timing_bar') {
      opsNote = 'S3: 挂载【轻操作：时机条】（参数化甜区宽0.15/良区宽0.40，中心实例随机），结果在选项结算后生效';
    }

    // P1-A: Backfill pity_chain & is_pity_guaranteed
    const pityInfo = PITY_CHAIN_MAP[id];
    const isPityGuaranteed = pityInfo ? pityInfo.is_guaranteed : false;
    const pityChain = pityInfo ? pityInfo.chain : null;

    // Parse options A/B/C
    const rawOptLines = optCell.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
    const options = [];

    // Errata P4-3 abbreviations expansion
    let outcomeExpanded = outcomeCell
      .replace(/立退/g, '立即触发退网结局')
      .replace(/下章可触/g, '下一阶段可触发');

    // Extract state writes, endings, next cards from outcome
    const normalizedOutcome = normalizeEndingIds(outcomeExpanded);

    // Parse option blocks
    for (let optIdx = 0; optIdx < rawOptLines.length; optIdx++) {
      const optLine = rawOptLines[optIdx];
      const optKeyMatch = optLine.match(/^\*\*([A-C])\.\*\*\s*(.*)$/);
      const optKey = optKeyMatch ? optKeyMatch[1] : String.fromCharCode(65 + optIdx);
      const rawLabel = optKeyMatch ? optKeyMatch[2] : optLine;
      const cleanLabel = stripMd(rawLabel).replace(/^[「『"]|[」』"]$/g, '');

      // Check requirement expression like (需 颜值>=8)
      let reqExpr = null;
      const reqMatch = cleanLabel.match(/（需\s*([^）]+)）/);
      if (reqMatch) {
        reqExpr = reqMatch[1].trim();
      }

      // Find state writes for this specific option
      const stateWrites = [];
      const endingTriggers = [];
      const nextCards = [];

      // Extract ending references (M01-M12, D01-D26, H01-H12)
      const endingMatches = normalizedOutcome.matchAll(/\b([MDH]\d{2})\b/g);
      for (const em of endingMatches) {
        if (!endingTriggers.includes(em[1])) {
          endingTriggers.push(em[1]);
        }
      }

      // Extract next card triggers like C4-M02, X-EGG-09
      const nextCardMatches = normalizedOutcome.matchAll(/\b([A-Z0-9]+-[A-Z0-9]+)\b/g);
      for (const cm of nextCardMatches) {
        if (cm[1] !== id && !nextCards.includes(cm[1])) {
          nextCards.push(cm[1]);
        }
      }

      // Extract state variables mentioned
      const stateMatches = normalizedOutcome.matchAll(/\b((?:Flag_|Count_|Tag_|Param_)[A-Za-z0-9_\u4e00-\u9fa5]+)\b/g);
      for (const sm of stateMatches) {
        if (!stateWrites.includes(sm[1])) {
          stateWrites.push(sm[1]);
        }
      }

      // Specialized errata for C4-S19:B, C5-S19:B, C6-S19:A
      if ((id === 'C4-S19' && optKey === 'B') ||
          (id === 'C5-S19' && optKey === 'B') ||
          (id === 'C6-S19' && optKey === 'A')) {
        if (!stateWrites.includes('Count_算法异常')) {
          stateWrites.push('Count_算法异常');
        }
      }

      options.push({
        opt_key: optKey,
        label: cleanLabel,
        raw_label: rawLabel,
        req_expr: reqExpr,
        effects: {
          summary: extractOptSummary(normalizedOutcome, optKey),
          state_writes: stateWrites,
          ending_triggers: endingTriggers,
          next_cards: nextCards
        },
        outcome_toast: stripMd(outcomeExpanded)
      });
    }

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
      prereq_expr: id === 'C6-M06' ? 'chapter == 6 && Flag_数字人线开放 == 1' : null,
      is_pity_guaranteed: isPityGuaranteed,
      pity_chain: pityChain,
      is_serious: isSerious,
      ops_type: opsType,
      ops_note: opsNote,
      has_art: false,
      context_text: stripMd(contextCell),
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

function extractOptSummary(outcomeText, optKey) {
  const parts = outcomeText.split(/[；;]/);
  for (const p of parts) {
    if (p.includes(`${optKey}.`) || p.includes(`${optKey}：`) || p.includes(`${optKey} `) || p.startsWith(optKey)) {
      return stripMd(p);
    }
  }
  return stripMd(parts[0] || outcomeText);
}

// ============================================================================
// 3. Parse 50 Endings and 50 Talents (Errata P1-2, P4-1, P4-2, Review correction 5)
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

    // Review corrections item 5: H03 dangling stat fix (口才 ≥ 8, no 智力)
    if (id === 'H03') {
      triggerText = triggerText
        .replace(/智力\/口才\s*≥\s*8/g, '口才 ≥ 8')
        .replace(/智力\s*≥\s*8/g, '口才 ≥ 8');
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
      aliases: originalName && originalName !== canonicalName ? [originalName] : [],
      trigger_condition: triggerText,
      trigger_sources: triggerSourcesStructured,
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
// 4. Parse Config, Chapters, Attributes, Screens, Schedules, Draw Rules & Timing Bar Parameters
// ============================================================================
function buildConfigAndScreens() {
  return {
    schema_version: 'v0.2-transcribed',
    errata_rulings_applied: [
      'P2-1: 12张双标标志性卡基线1.0、匹配×2.0、未匹配不降权(1.0)；短卡/跨章软门控维持匹配×3.0、未匹配×0.5',
      'P3-1: 翻样辨真为翻任意2件 + 四键指认（指认#1掺假 / 指认#2掺假 / 指认#3掺假 / 三件全合格）',
      'P3-2: 全本美术总盘69张封顶（NPC 36 + 底板模板 6 + 结局 27 = 69）',
      'P4-1: §2.6 属性表全部结局ID补零（M08 / M02 / M10 / H01 黑粉头子是真爱 / H05 冲出楚门直播间 / H06）',
      'P4-4: Screen-08（结局分享卡弹窗）独立成行，具备独立输入与输出定义',
      'S1: 模式权威词表更正为 7 个常规排班模式 + 数字人锁定第 8 槽位',
      'S2: gate_type 枚举扩展登记 progress 与 none',
      'S3: 时机条分区参数化（甜区宽 0.15、良区宽 0.40、中心每卡实例随机）'
    ],
    review_corrections_applied: [
      'P1-A: §1.8 保底链补转录（draw_rules 槽位 2+3、四条保底链、跨章池 4.0 与 40% 倾斜全入库）',
      'P1-B: gate_type 枚举扩展登记 progress 与 none',
      'P1-C: 时机条分区删除两套固定区间，统一参数化入库',
      'P2-A: 字数门绊线复位为裁定 9 原口径（80/20/40 与 60/14/30）',
      'P2-C: 词表更正为 7 个常规排班模式 + 数字人锁定第 8 槽位'
    ],
    mode_vocabulary: {
      schedule_modes: [
        '游戏',
        '才艺',
        '电台',
        '团播',
        'PK',
        '带货',
        '户外'
      ],
      locked_slot_8: '数字人',
      special_tags: [
        '数字人诱惑',
        '全模式'
      ],
      rules: {
        schedule_modes_count: 7,
        locked_slot_8_description: '数字人为第 8 槽位锁定槽，后期诱惑解锁，不进常规排班池（Screen-02「8 选 1」即 7 常规 + 1 锁定槽）',
        radio_note: '正本行名「聊天唠嗑 / 情感电台」，卡面标签统一用「电台」，「聊天」不作独立模式',
        digital_clone_rule: '「数字人诱惑」属特殊标签、非排班模式。C6-M06 门控改落：第六章 + 数字人线开放后入池（章节/进度门控，base 1、不做模式匹配），保住 H03 主分支。'
      }
    },
    draw_rules: {
      slots_per_chapter: 5,
      slot_composition: {
        guaranteed_slots: 2,
        random_slots: 3,
        description: '槽位 1–2 为主线与前置必出位，槽位 3–5 为短卡与跨章随机位'
      },
      overflow_rule: {
        max_guaranteed_slots: 4,
        min_random_slots: 1,
        description: '若当章待必出卡超过 2 张，顺延占用随机位，最多占满 4 槽，至少留 1 槽给随机短卡调节节奏'
      },
      underflow_rule: {
        fill_with_milestone: true,
        description: '若当章无待必出链卡，从当章未抽过的标志性单卡池中按模式权重补齐 2 张标志性卡'
      },
      pity_chains: [
        {
          chain_id: 'pity_cat',
          name: '猫上镜线',
          state_key: 'Count_猫上镜',
          target_ending: 'H04',
          member_cards: ['C1-S01', 'C2-S01', 'C3-S01'],
          locked_slot: 3,
          advance_condition: '首张 C1-S01 选 A/B 推进计数，后续卡在对应章节（Ch2, Ch3）自动升格为「定向保底必出」，锁定槽位 3'
        },
        {
          chain_id: 'pity_exam',
          name: '考编上岸线',
          state_key: 'Count_考编',
          target_ending: 'H10',
          member_cards: ['C1-S07', 'C2-S17', 'C4-S16'],
          locked_slot: 3,
          advance_condition: '首张 C1-S07 选 A 推进计数，后续卡在对应章节（Ch2, Ch4）自动升格为「定向保底必出」，锁定槽位 3'
        },
        {
          chain_id: 'pity_algorithm',
          name: '算法觉醒线',
          state_key: 'Count_算法异常',
          target_ending: 'H05',
          member_cards: ['C4-S19', 'C5-S19', 'C6-S19'],
          locked_slot: 3,
          advance_condition: '开局 运气 = 10，C4-S19 选 B、C5-S19 选 B、C6-S19 选 A 各 +1，在对应目标章节升格定向保底'
        },
        {
          chain_id: 'pity_hater',
          name: '黑粉不对线',
          state_key: 'Count_黑粉不对线',
          target_ending: 'H01',
          member_cards: ['C1-M07', 'C2-S08', 'C3-S12', 'X-EGG-04'],
          locked_slot: 3,
          advance_condition: 'C1-M07 选 B +1，后续黑粉短卡选温和请教各 +1，Count_黑粉不对线 ≥ 3 且 情商 ≥ 7 时，X-EGG-04 升格必出'
        }
      ],
      cross_chapter_pool: {
        entry_timings: {
          'X-MODE': { chapter_min: 2, chapter_max: 6 },
          'X-ATTR': { chapter_min: 2, chapter_max: 6 },
          'X-EGG-01_to_05': { chapter_min: 3, chapter_max: 6 },
          'X-EGG-06_to_10': { chapter_min: 4, chapter_max: 6 }
        },
        weights: {
          base_short: 1.0,
          mode_match_boost: 3.0,
          mode_mismatch_penalty: 0.5,
          x_attr_first_met_weight: 4.0,
          x_egg_prereq_met_behavior: '升格为必出保底'
        },
        alert_zone_replacement: {
          stamina_range: [1, 29],
          skew_pct: 40,
          target_bias_cards: ['C3-S18', 'X-EGG-01'],
          description: '当 状态 ∈ [1, 29] 时，随机位中 40% 权重强制倾斜至熬夜翻车卡（C3-S18、X-EGG-01 等）'
        }
      }
    },
    timing_bar_parameters: {
      sweet_width: 0.15,
      good_width: 0.40,
      cursor_speed: 0.85,
      center_selection: 'random_per_card_instance',
      center_range: [0.20, 0.80],
      multipliers: {
        sweet: 1.15,
        good: 1.05,
        normal: 1.00
      },
      applicable_cards: ['C1-M05', 'C2-M09', 'C3-M08', 'C4-M11', 'C5-M09', 'C6-M05'],
      ruling: 'Errata S3: 甜区宽 0.15、良区宽 0.40，中心点每卡实例在良区范围内随机，六张卡共用此参数，删除固定绝对区间'
    },
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
        {
          id: 'slot_morning',
          name: '清晨场 (06–09点)',
          target_audience: '通勤上班族、早起大爷',
          competition: '竞争低、推流门槛极低',
          fans_mult: 0.85,
          wallet_mult: 0.70,
          wallet_mult_default: 0.70,
          wallet_mult_ecommerce: 0.70,
          stamina_mult: 0.8,
          event_weight_skew: '电台/唠嗑主场；大爷大妈破圈短卡权重 up'
        },
        {
          id: 'slot_noon',
          name: '午间场 (11–14点)',
          target_audience: '学生午休、职场摸鱼党',
          competition: '竞争中等、短平快',
          fans_mult: 1.10,
          wallet_mult: 0.85,
          wallet_mult_default: 0.85,
          wallet_mult_ecommerce: 0.85,
          stamina_mult: 1.0,
          event_weight_skew: '游戏/整活切片出圈率 +30%；乐子人事件权重 up'
        },
        {
          id: 'slot_afternoon',
          name: '下午场 (14–18点)',
          target_audience: '全职妈妈、中老年盘',
          competition: '全天竞争最低',
          fans_mult: 0.90,
          wallet_mult: 1.00,
          wallet_mult_default: 1.00,
          wallet_mult_ecommerce: 1.25,
          wallet_mult_condition: '仅带货模式生效',
          stamina_mult: 0.9,
          event_weight_skew: '带货家居/食品转化率 +35%；才艺与游戏盘极弱'
        },
        {
          id: 'slot_prime',
          name: '黄金档 (19–23点)',
          target_audience: '全民流量峰值',
          competition: '竞争最惨烈、推流门槛最高',
          fans_mult: 1.40,
          wallet_mult: 1.40,
          wallet_mult_default: 1.40,
          wallet_mult_ecommerce: 1.40,
          stamina_mult: 1.3,
          event_weight_skew: 'PK 主场、大哥出没、盛典冲榜；同行竞争与被锤事件高发'
        },
        {
          id: 'slot_late',
          name: '深夜档 (23–02点)',
          target_audience: '夜猫子、情绪消费盘',
          competition: '门槛中、留存时长极高',
          fans_mult: 1.15,
          wallet_mult: 1.50,
          wallet_mult_default: 1.50,
          wallet_mult_ecommerce: 1.50,
          stamina_mult: 2.0,
          event_weight_skew: '电台王炸时段；榜一私信、感情线、私生越界（私C2）与熬夜翻车权重 up'
        }
      ],
      durations: [
        {
          hours: 2,
          name: '2 小时（短播养生档）',
          fans_mult: 0.8,
          base_stamina_cost: 10,
          recommended_physique: 1,
          can_force_start: true,
          is_hard_locked: false,
          note: '无体力门槛'
        },
        {
          hours: 4,
          name: '4 小时（标准主力档）',
          fans_mult: 1.0,
          base_stamina_cost: 20,
          recommended_physique: 4,
          can_force_start: true,
          is_hard_locked: false,
          note: '推荐体力 ≥ 4'
        },
        {
          hours: 6,
          name: '6 小时（铁人爆肝档）',
          fans_mult: 1.2,
          base_stamina_cost: 35,
          recommended_physique: 6,
          can_force_start: true,
          is_hard_locked: false,
          low_physique_extra_cost: 10,
          penalty_condition: '体力 < 6 强开额外追加 -10 状态',
          all_attendance_check: '连续 4 章选 6 小时触发公会全勤奖或 H06 全勤之神判定'
        }
      ],
      off_stream_actions: [
        {
          id: 1,
          name: '补觉休息',
          immediate_effects: '状态 +30',
          continuous_effects: '清除「熬夜透支」Debuff，防止下一章落入 <30 警戒翻车区',
          effects: '状态 +30，清除熬夜透支 Debuff'
        },
        {
          id: 2,
          name: '专心练功',
          immediate_effects: '才艺/技术/口才三选一 +1（单局单项上限+2），状态 -5',
          continuous_effects: '下阶段若排对应模式的班，模式乘区额外 +0.15',
          effects: '才艺/技术/口才三选一 +1（单局单项上限+2），状态 -5，下阶段对应模式乘区 +0.15'
        },
        {
          id: 3,
          name: '剪切片、运营账号',
          immediate_effects: '热度 +15%，状态 -5',
          continuous_effects: '下一阶段「切片出圈」判定次数 +1，老粉粘性提升（掉粉税减免 5%）；累计 ≥3 次为 M10 幕后操盘手必要条件',
          effects: '热度 +15%，状态 -5；下一阶段「切片出圈」判定次数 +1，老粉粘性提升（掉粉税减免 5%）；累计 ≥3 次为 M10 幕后操盘手必要条件'
        },
        {
          id: 4,
          name: '粉丝群运营/回私信',
          immediate_effects: '口碑 +5，状态 -5',
          continuous_effects: '高等级「星牌」忠诚度 +15%，榜一大哥好感度 +10（降低一切脱粉回踩痛感）',
          effects: '口碑 +5，状态 -5，高等级「星牌」忠诚度 +15%，大哥好感 +10'
        },
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
          immediate_effects: '下一场带货转化率 +20%，触发【翻样辨真】轻操作',
          continuous_effects: '三件样品扣放翻2件，指认命中则 Count_验货命中 +1（同步置 Flag_选品减伤=1），累加至 C5-M07 减伤/反诉判线',
          effects: '下一场带货转化率 +20%，触发【翻样辨真】（翻任意2件 + 四键指认），命中则 Count_验货命中 +1（同步置 Flag_选品减伤=1）'
        },
        {
          id: 6,
          name: '看回放复盘、整理素材留档',
          immediate_effects: 'Count_复盘留档 +1（每累计 2 次留档，心态 +1）',
          continuous_effects: '【唯一反杀源】保存原始录屏与未剪辑工程文件，第五章高潮「被锤事件（事19）」中解锁完整证据链绝地反杀选项的唯一来源',
          effects: 'Count_复盘留档 +1（每累计 2 次留档，心态 +1），唯一反杀源（第五章被锤事件绝地反杀唯一来源）'
        },
        {
          id: 7,
          name: '约会 / 社交',
          immediate_effects: '状态 +10（甜段），推进当前对象好感',
          continuous_effects: '按当前结识恋爱对象进入甜段互动；若处于保密期则触发 1 次被狗仔偷拍判定',
          effects: '状态 +10，推进恋爱对象好感；保密期触发狗仔偷拍判定'
        },
        {
          id: 8,
          name: '接私活',
          immediate_effects: '钱包 +当章基准×0.4，状态 -20',
          continuous_effects: '快速补充现金流救急；但签约公会状态下有 40% 概率触发公会违约警告',
          effects: '钱包 +当章基准×0.4，状态 -20（签约公会状态下 40% 概率触发公会违约警告）'
        }
      ]
    },
    screens: [
      { screen_id: 'Screen-01', name: '开局捏人与前世天赋屏', inputs: '9项属性±分配（基础45点，单项1-10）；看激励广告+3点（最多4次+12点，单项≤3且加后≤8）；前世天赋勾选（1-3枚，H11扩至4枚）；沿用上局配点与正式开播键', outputs: '实时显示剩余点数、广告次数(4/4)、粉丝吸引倾向标签；初始化状态字典进入 Screen-02' },
      { screen_id: 'Screen-02', name: '阶段排班屏（三连点）', inputs: '三连点（<10秒）：选直播模式（7常规+1锁定槽数字人）+ 选开播时段（5选1）+ 选开播时长（3选1：2h/4h/6h）', outputs: '预览预计状态消耗、自然涨粉乘区、高发事件标签；生成本章5张事件卡队列进入 Screen-03' },
      { screen_id: 'Screen-03', name: '事件卡主界面（纯文字卡默认）', inputs: '阅读情境文本（标志性≤80字，短卡≤60字）；点选2-3个选项之一；结算后可点「重选一次（看广告）」（单局限1次，与暴毙复活共享额度）', outputs: '顶部常驻五维栏与章节进度；播放一句结算吐槽Toast、跳动五维数字；5卡走完进 Screen-04' },
      { screen_id: 'Ops-A', parent_screen: 'Screen-03', name: '轻操作一：时机条', inputs: '挂载于6张直播标志性卡（单次≤5秒）：光标单向扫过横条，点击「停」按钮（或降级三连点节奏）', outputs: '甜区×1.15 / 良区×1.05 / 普通×1.0（参数化甜区宽0.15/良区宽0.40，中心实例随机），并入所在卡结算并受单卡 Cap 夹逼' },
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
  snapshot_fields: stateDict.Snapshot_BeforeCard.total_fields,
  cards_total: cards.length,
  endings_total: endingsAndTalents.counts.total_endings,
  talents_total: endingsAndTalents.counts.total_talents,
  screens_total: configAndScreens.screens.length,
  schedule_modes: configAndScreens.mode_vocabulary.schedule_modes.length,
  pity_chains: configAndScreens.draw_rules.pity_chains.length,
  timing_bar_parameters: configAndScreens.timing_bar_parameters.sweet_width
}, null, 2));
