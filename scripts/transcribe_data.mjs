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
  if (!str) return '';
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

  // Errata S5 (Round-4 Ruling V5): Add Flag_数字人线开放 (36 -> 37 keys)
  if (!variables.some(v => v.key === 'Flag_数字人线开放')) {
    variables.push({
      line_no: 0,
      key: 'Flag_数字人线开放',
      category: 'Flag',
      type: 'Boolean',
      initial_value: 0,
      range_or_cap: '0 | 1',
      writers_text: 'X-MODE-09 与数字人线相关卡既定结算',
      consumers_text: 'C6-M06 前置表达式、H03 主分支'
    });
  }

  const autoSnapshotStateKeys = variables.map(v => v.key);
  // Round-4 Ruling V4: §2.7 Fan composition 6 segments replacing previous English placeholder names
  const fixedBaseFields = [
    '颜值', '嗓音', '才艺', '游戏技术', '口才', '情商', '体力', '心态', '运气',
    'Fans', 'Heat', 'Wallet', 'Rep', 'Stamina', 'Hater_Pct',
    'Fans_颜粉_Pct', 'Fans_声控粉_Pct', 'Fans_技术粉_Pct',
    'Fans_乐子人_Pct', 'Fans_大哥_Pct', 'Fans_学生粉_Pct'
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
// 2. Parse 213 Cards with Stage 1.5 Machine-Readable Completion (F1, F2, F3, F4, F5, F7)
// ============================================================================
const DUAL_TAG_MILESTONE_IDS = new Set([
  'C1-M03', 'C1-M04', 'C2-M03', 'C2-M05',
  'C3-M03', 'C3-M05', 'C4-M03', 'C4-M04', 'C4-M05',
  'C5-M03', 'C5-M04', 'C5-M05'
]);

// Second review rulings: 7 official schedule modes + Digital human slot 8
const SCHEDULE_MODES_7 = new Set(['游戏', '才艺', '电台', '团播', 'PK', '带货', '户外']);

// P1-A & F5 Pity Chains mapping (4 chains + trigger cards)
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

// Map of card-level prereqs (F1)
const CARD_PREREQS = {
  'C2-M02': "has_encountered('C2-M01')",
  'C2-M03': 'Flag_科技人设 == 1',
  'C4-M01': "mode == '带货'",
  'C4-M02': "C4-M01 == 'A'",
  'C5-M01': "C4-M01 == 'A' || C4-M02 == 'A'",
  'C5-M02': "C5-M01 == 'B'",
  'C5-M03': 'Flag_签公会 == 1',
  'C5-M04': 'Flag_劣迹对象 == 1 || Count_偷拍素材 == 3',
  'C5-M05': "C5-M04 == 'B' || C5-M04 == 'C'",
  'C5-M07': "has_encountered('C4-M02')",
  'C5-M08': 'Flag_卖惨人设 == 1 || Flag_造假剧本 == 1',
  'C5-M10': "Flag_劣迹对象 == 1 || Count_偷拍素材 == 3 || has_encountered('C4-M06')",
  'C6-M02': 'Flag_安保习惯 == 1',
  'C6-M03': '整活流 || 失控值高',
  'C6-M06': 'chapter == 6 && Flag_数字人线开放 == 1',
  'C6-M07': 'Flag_税务合规 == 1 || Flag_税务隐患 == 1',
  'C6-M08': "Flag_榜一恋爱 == 1 || has_encountered('C4-M06')",
  'C6-M09': 'Flag_老粉 == 1',
  'C6-M10': 'chapter == 6',
  'C2-S01': 'Count_猫上镜 >= 1',
  'C3-S01': 'Count_猫上镜 >= 2',
  'C2-S17': 'Count_考编 >= 1',
  'C4-S16': 'Count_考编 >= 2',
  'C4-S19': '运气 == 10',
  'C5-S19': '运气 == 10 && Count_算法异常 >= 1',
  'C6-S19': '运气 == 10 && Count_算法异常 >= 2',
  'C2-S08': 'Count_黑粉不对线 >= 1',
  'C3-S12': 'Count_黑粉不对线 >= 2',
  'X-ATTR-01': '颜值 >= 8',
  'X-ATTR-02': '嗓音 >= 8',
  'X-ATTR-03': '才艺 >= 8',
  'X-ATTR-04': '游戏技术 >= 8',
  'X-ATTR-05': '口才 >= 8',
  'X-ATTR-06': '情商 >= 8',
  'X-ATTR-07': '体力 >= 8',
  'X-ATTR-08': '心态 >= 8',
  'X-ATTR-09': '运气 >= 9',
  'X-ATTR-10': '颜值 <= 3 && 口才 >= 7',
  'X-EGG-01': '状态 <= 15',
  'X-EGG-02': '运气 <= 3',
  'X-EGG-03': "has_encountered('C4-M03') && C4-M03 == 'A'",
  'X-EGG-04': 'Count_黑粉不对线 >= 1',
  'X-EGG-05': 'Flag_放任切片号 == 1',
  'X-EGG-06': '钱包 >= 1000000',
  'X-EGG-07': 'equipped_talents_count >= 3',
  'X-EGG-08': 'total_endings_unlocked >= 30',
  'X-EGG-09': 'cleared_main_endings_count == 12'
};

// Map of option-level req_expr (S4 / Round-4 Ruling V3: 纯可选门，不满足不可选)
const OPTION_REQS = {
  'C3-M08:B': '才艺 >= 7',
  'C4-M08:C': '口才 >= 7',
  'C5-M12:C': 'Count_前任律师函 >= 1',
  'C6-M07:A': 'Flag_税务合规 == 1',
  'C6-M07:B': 'Flag_税务隐患 == 1',
  'C6-M08:A': 'Flag_榜一恋爱 == 1',
  'C6-M08:B': 'Flag_榜一恋爱 == 1',
  'C6-S19:A': '运气 == 10',
  'X-MODE-03:A': '才艺 >= 6 || 嗓音 >= 6',
  'X-EGG-04:A': 'Count_黑粉不对线 >= 3 && 情商 >= 7'
};

// Map of option checks (S4 / Round-4 Ruling V2/V3: 成败/生死检定走 check_expr + check_fail 与 effects_conditional)
const OPTION_CHECKS = {
  'C2-M03:A': {
    check_expr: '嗓音 >= 7',
    check_fail: { delta_five_dim: { fans_pct: -20 } },
    description: '嗓音 < 7 掉粉 20%，嗓音 >= 7 无损'
  },
  'C3-M03:B': {
    check_expr: '游戏技术 >= 8',
    check_fail: { delta_five_dim: { fans_pct: -10 } },
    description: '游戏技术 >= 8 免掉粉锁 M08'
  },
  'C3-M05:B': {
    check_expr: '情商 >= 6',
    check_fail: { delta_five_dim: { rep: 10, npc_affinity_delta: 15 } },
    description: '情商 >= 6 翻倍'
  },
  'C4-M06:A': {
    check_expr: "Tag_人设 == '真实'",
    effects_conditional: {
      if: "Tag_人设 == '真实'",
      then: { delta_five_dim: { fans_pct: 20 }, description: '真实人设官宣涨粉 20%' },
      else: { delta_five_dim: { fans_pct: -40 }, description: '非真实人设塌房掉粉 40%' }
    }
  },
  'C5-M02:A': {
    check_expr: 'Count_复盘留档 >= 2',
    effects_conditional: {
      if: 'Count_复盘留档 >= 2',
      then: {
        delta_five_dim: { fans_pct: 40, rep: 35 },
        description: '通过支：完整证据链绝地反击，涨粉 40%、口碑 +35'
      },
      else: {
        delta_five_dim: { fans_pct: 20, rep: 17 },
        description: '否则支（半血）：增量减半取整，涨粉 20%、口碑 +17'
      }
    }
  },
  'C5-M03:A': {
    check_expr: 'Flag_审过合同 == 1',
    check_fail: { ending_triggers: ['D13'] },
    description: '若审过合同胜诉自由身，否则违约金五百万进 D13'
  },
  'C5-M07:A': {
    check_expr: 'Count_验货命中 >= 1',
    check_fail: { ending_triggers: ['D12'] },
    description: 'Count_验货命中 >= 2 全身而退锁 M02，>= 1 伤减半，0 进 D12'
  },
  'C5-M08:A': {
    check_expr: '口碑 >= 80',
    check_fail: { ending_triggers: ['D20', 'D21'] },
    description: '若口碑 >= 80 扣粉 50% 存活，否则进 D20/D21'
  },
  'C5-M09:A': {
    check_expr: '心态 >= 7',
    check_fail: { delta_five_dim: { stamina: -30, rep: -10 } },
    description: '心态 >= 7 逆袭，否则状态 -30、口碑 -10'
  },
  'C6-M02:B': {
    check_expr: 'Flag_安保习惯 == 1',
    effects_conditional: {
      if: 'Flag_安保习惯 == 1',
      then: { delta_five_dim: { fans_pct: 40 }, description: '通过支：安保得力现场有序，涨粉 40%' },
      else: { delta_five_dim: { rep: -50 }, description: '否则支：安保缺失现场失控，口碑 -50' }
    }
  },
  'X-EGG-01:A': {
    check_expr: '运气 >= 3',
    check_fail: { ending_triggers: ['D22'] },
    description: '运气 >= 3 顺势自嘲，运气 <= 2 直通暴毙 D22'
  },
  'X-EGG-02:A': {
    check_expr: '运气 > 3',
    check_fail: { ending_triggers: ['D23'] },
    description: '运气 > 3 险过热度 +15%，否则直通暴毙 D23'
  },
  'X-EGG-05:A': {
    check_expr: '口碑 >= 85',
    check_fail: { ending_triggers: ['D26'] },
    description: '若口碑 >= 85 险保号，否则进 D26'
  }
};

// Timing card skins (F4: assigned by in-card action, not mode tag)
const TIMING_BAR_SKINS = {
  'C1-M05': '接梗', // 弹幕/路人整活学狗叫，幽默接梗
  'C2-M09': 'PK',   // 连麦PK过界惩罚狠活
  'C3-M08': '高光', // 团播C位被关耳返盲跳舞台高光
  'C4-M11': '憋单', // 超级福袋极限憋单度把握
  'C5-M09': '高光', // 误播共享文档浴火逆袭神级企划高光归来
  'C6-M05': 'PK'    // 盛典决战冲榜夜PK对决
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

function splitOptionOutcomes(outCol, options, cardId) {
  const result = {};
  options.forEach(o => result[o.opt_key] = '');

  // Special card overrides for outcome splitting
  if (cardId === 'C3-M04') {
    result['A'] = '起手0/3：保0/3状态-5';
    result['B'] = '热+25%记`Count_偷拍素材+1`';
    return result;
  }
  if (cardId === 'C5-M04') {
    result['A'] = '掉粉60%直通暴毙D17';
    result['B'] = '进入C5-M05道歉质量判定';
    result['C'] = '进入C5-M05道歉质量判定';
    return result;
  }
  if (cardId === 'C5-M10') {
    result['A'] = 'A或`Flag_账号协议=0`触发D15/D16/D19';
    result['B'] = '有协议选B保号口碑+15';
    return result;
  }
  if (cardId === 'C6-M08') {
    result['A'] = '进主结局（`Flag_榜一恋爱=1`进H02）';
    result['B'] = '进主结局（`Flag_榜一恋爱=1`进H02）';
    result['C'] = '直通主结局M05';
    return result;
  }
  if (cardId === 'X-ATTR-10') {
    result['A'] = '锁M10前置（分成+）';
    result['B'] = '锁M10前置（热+25%）';
    return result;
  }
  if (cardId === 'X-EGG-09') {
    result['A'] = '达H12星海真神，全属性+1';
    result['B'] = '达H12万界旅人，口碑90';
    return result;
  }
  if (cardId === 'C6-M07') {
    result['A'] = '若`Flag_税务合规=1`选A零损口碑+30';
    result['B'] = '若隐患选B扣钱包70%保号';
    return result;
  }
  if (cardId === 'C5-M08') {
    result['A'] = '若口碑≥80扣粉50%存活，否则进D20/D21';
    result['B'] = '直通D20/D21';
    return result;
  }

  // Pattern 1: flavor（A.../B...）
  const parenMatch = outCol.match(/^(.*)[（(]([A-C][^）)]+)[）)]$/);
  if (parenMatch) {
    const inside = parenMatch[2];
    const parts = inside.split(/(?=[/；;][A-C][.、:：\s]|\/[A-C])/);
    parts.forEach(p => {
      const cleanP = p.replace(/^[/；;\s]+/, '');
      const kMatch = cleanP.match(/^([A-C])[.、:：\s]?(.*)$/);
      if (kMatch && result[kMatch[1]] !== undefined) {
        result[kMatch[1]] = kMatch[2].trim();
      }
    });
    options.forEach(o => {
      if (!result[o.opt_key]) result[o.opt_key] = parenMatch[2].trim();
    });
    return result;
  }

  // Pattern 2: A...；B...；C...
  const parts = outCol.split(/(?=[；;][A-C][.、:：\s]|[；;]\s*[A-C][^\w]|(?<=[；;])\s*[A-C]|^[A-C][.、:：\s]|^[A-C][^\w])/);
  let matchedAny = false;
  parts.forEach(p => {
    const cleanP = p.replace(/^[；;\s]+/, '');
    const kMatch = cleanP.match(/^([A-C])[.、:：\s]?(.*)$/);
    if (kMatch && result[kMatch[1]] !== undefined) {
      result[kMatch[1]] = kMatch[2].trim();
      matchedAny = true;
    }
  });

  if (!matchedAny) {
    options.forEach(o => result[o.opt_key] = outCol);
  }
  return result;
}

function parseDeltas(text, cardId, optKey) {
  const five_dim = {};
  const attrs = {};
  const qualitative = [];

  // F2 Special case: X-EGG-09
  if (cardId === 'X-EGG-09') {
    if (optKey === 'A') {
      const allAttrs = ['颜值', '嗓音', '才艺', '游戏技术', '口才', '情商', '体力', '心态', '运气'];
      allAttrs.forEach(a => attrs[a] = 1);
      return { five_dim, attrs, qualitative };
    } else if (optKey === 'B') {
      five_dim.rep = 30;
      five_dim.rep_target = 90;
      return { five_dim, attrs, qualitative };
    }
  }

  // Fans
  const fansPct = text.match(/(?:粉|涨粉)\+([0-9.]+)%/);
  if (fansPct) five_dim.fans_pct = Number(fansPct[1]);
  const fansPctMinus = text.match(/(?:掉粉|掉|扣粉|粉-)-?([0-9.]+)%/);
  if (fansPctMinus && !fansPct) five_dim.fans_pct = -Number(fansPctMinus[1]);
  const fansPlus = text.match(/粉\+([0-9]+)(?!%)/);
  if (fansPlus) five_dim.fans = Number(fansPlus[1]);

  // Heat
  const heatPctPlus = text.match(/(?:热|热度)\+([0-9.]+)%/);
  if (heatPctPlus) five_dim.heat_pct = Number(heatPctPlus[1]);
  const heatPctMinus = text.match(/(?:热|热度)-([0-9.]+)%/);
  if (heatPctMinus) five_dim.heat_pct = -Number(heatPctMinus[1]);
  if (text.includes('热度清零')) five_dim.heat_target = 0;

  // Wallet (Round-4 Ruling V1: 万 -> * 10000, 千 -> * 1000, 修复正则回溯导致的个位数值)
  const walletPlusWan = text.match(/钱包\+([0-9.]+)万/);
  if (walletPlusWan) five_dim.wallet = Math.round(Number(walletPlusWan[1]) * 10000);
  const walletMinusWan = text.match(/钱包-([0-9.]+)万/);
  if (walletMinusWan) five_dim.wallet = -Math.round(Number(walletMinusWan[1]) * 10000);

  const walletPlusQian = text.match(/(?:钱包|抵债|赢PK钱包)\+([0-9.]+)千/);
  if (walletPlusQian) five_dim.wallet = Math.round(Number(walletPlusQian[1]) * 1000);
  const walletMinusQian = text.match(/钱包-([0-9.]+)千/);
  if (walletMinusQian) five_dim.wallet = -Math.round(Number(walletMinusQian[1]) * 1000);

  const walletPctPlus = text.match(/钱包\+([0-9.]+)%/);
  if (walletPctPlus) five_dim.wallet_pct = Number(walletPctPlus[1]);
  const walletPctMinus = text.match(/(?:钱包-|扣钱包)([0-9.]+)%/);
  if (walletPctMinus) five_dim.wallet_pct = -Number(walletPctMinus[1]);

  if (five_dim.wallet === undefined && !walletPctPlus && !walletPctMinus) {
    const walletPlus = text.match(/钱包\+([0-9]+)(?![0-9.万千%])/);
    if (walletPlus) five_dim.wallet = Number(walletPlus[1]);
    const walletMinus = text.match(/钱包-([0-9]+)(?![0-9.万千%])/);
    if (walletMinus) five_dim.wallet = -Number(walletMinus[1]);
  }

  // Rep
  const repPlus = text.match(/口碑\+([0-9]+)/);
  if (repPlus) five_dim.rep = Number(repPlus[1]);
  const repMinus = text.match(/口碑-([0-9]+)/);
  if (repMinus) five_dim.rep = -Number(repMinus[1]);

  // Stamina
  const staPlus = text.match(/状态\+([0-9]+)/);
  if (staPlus) five_dim.stamina = Number(staPlus[1]);
  const staMinus = text.match(/状态-([0-9]+)/);
  if (staMinus) five_dim.stamina = -Number(staMinus[1]);

  // Hater
  const haterPlus = text.match(/黑粉(?:浓度)?\+([0-9.]+)%/);
  if (haterPlus) five_dim.hater_pct = Number(haterPlus[1]);

  // Attributes
  const attrList = ['颜值', '嗓音', '才艺', '游戏技术', '口才', '情商', '体力', '心态', '运气'];
  attrList.forEach(a => {
    const p = text.match(new RegExp(a + '\\+([0-9]+)'));
    if (p) attrs[a] = Number(p[1]);
    const m = text.match(new RegExp(a + '-([0-9]+)'));
    if (m) attrs[a] = -Number(m[1]);
  });

  if (text.includes('全属性+1')) {
    attrList.forEach(a => attrs[a] = 1);
  }

  // Qualitative checks (Ambiguity List candidates)
  if (text.includes('乐子人+') || text.includes('乐子+')) qualitative.push('乐子人+');
  if (text.includes('颜粉+')) qualitative.push('颜粉+');
  if (text.includes('技术+')) qualitative.push('技术+');
  if (text.includes('留存++')) qualitative.push('留存++');
  if (text.includes('分成+')) qualitative.push('分成+');
  if (text.includes('增切片反噬权重')) qualitative.push('增切片反噬权重');
  if (text.includes('失老粉')) qualitative.push('失老粉');
  if (text.includes('逆袭')) qualitative.push('逆袭');
  if (text.includes('高危塌房')) qualitative.push('高危塌房');
  if (text.includes('乘区×2.5')) qualitative.push('乘区×2.5，35%率收益清零');
  if (text.includes('好感-20')) qualitative.push('好感-20');
  if (text.includes('好感+15')) qualitative.push('好感+15');
  if (text.includes('好感+10')) qualitative.push('好感+10');
  if (text.includes('盛典票数+30%')) qualitative.push('盛典票数+30%');
  if (text.includes('黑转粉+25%')) qualitative.push('黑转粉+25%');
  if (text.includes('获秘方')) qualitative.push('获秘方');
  if (text.includes('忠诚+20%')) qualitative.push('忠诚+20%');

  // Round-4 Ruling V2: C6-M02B 失败支的口碑 -50 移入 else、不得与通过支并列
  if (cardId === 'C6-M02' && optKey === 'B') {
    delete five_dim.rep;
  }

  return { five_dim, attrs, qualitative };
}

function parseStateWrites(summaryText, fullOutcomeText, cardId, optKey) {
  const writes = [];

  const matches = summaryText.matchAll(/`?((?:Flag_|Count_|Tag_|Param_)[A-Za-z0-9_\u4e00-\u9fa5]+)`?(?:\s*([=+=]+)\s*([0-9A-Za-z_\u4e00-\u9fa5]+))?/g);
  for (const m of matches) {
    const key = m[1];
    const op = m[2];
    const val = m[3];
    let writeExpr;
    if (op && val) {
      writeExpr = `${key} ${op} ${val}`;
    } else if (key.startsWith('Count_')) {
      writeExpr = `${key} += 1`;
    } else if (key.startsWith('Flag_')) {
      writeExpr = `${key} = 1`;
    } else if (key === 'Tag_人设') {
      if (optKey === 'A') writeExpr = 'Tag_人设 = 单身';
      else if (optKey === 'B') writeExpr = 'Tag_人设 = 留白';
      else writeExpr = 'Tag_人设 = 真实';
    } else {
      writeExpr = `${key} = 1`;
    }
    if (!writes.includes(writeExpr)) writes.push(writeExpr);
  }

  // Specialized mappings from table/rulings
  if (cardId === 'C4-S19' && optKey === 'B' && !writes.some(w => w.includes('Count_算法异常'))) writes.push('Count_算法异常 += 1');
  if (cardId === 'C5-S19' && optKey === 'B' && !writes.some(w => w.includes('Count_算法异常'))) writes.push('Count_算法异常 += 1');
  if (cardId === 'C6-S19' && optKey === 'A' && !writes.some(w => w.includes('Count_算法异常'))) writes.push('Count_算法异常 += 1');

  if (cardId === 'C1-M07' && optKey === 'B' && !writes.some(w => w.includes('Count_黑粉不对线'))) writes.push('Count_黑粉不对线 += 1');
  if (cardId === 'C2-S08' && optKey === 'B' && !writes.some(w => w.includes('Count_黑粉不对线'))) writes.push('Count_黑粉不对线 += 1');
  if (cardId === 'C3-S12' && optKey === 'B' && !writes.some(w => w.includes('Count_黑粉不对线'))) writes.push('Count_黑粉不对线 += 1');

  if (cardId === 'C1-S01' && !writes.some(w => w.includes('Count_猫上镜'))) writes.push('Count_猫上镜 += 1');
  if (cardId === 'C2-S01' && !writes.some(w => w.includes('Count_猫上镜'))) writes.push('Count_猫上镜 += 1');
  if (cardId === 'C3-S01' && !writes.some(w => w.includes('Count_猫上镜'))) writes.push('Count_猫上镜 += 1');

  if (cardId === 'C1-S07' && optKey === 'A' && !writes.some(w => w.includes('Count_考编'))) writes.push('Count_考编 += 1');
  if (cardId === 'C2-S17' && optKey === 'A' && !writes.some(w => w.includes('Count_考编'))) writes.push('Count_考编 += 1');
  if (cardId === 'C4-S16' && optKey === 'A' && !writes.some(w => w.includes('Count_考编'))) writes.push('Count_考编 += 1');

  if (cardId === 'C4-M02' && optKey === 'B') {
    if (!writes.some(w => w.includes('Count_验货命中'))) writes.push('Count_验货命中 += 1');
    if (!writes.some(w => w.includes('Flag_选品减伤'))) writes.push('Flag_选品减伤 = 1');
  }
  if (cardId === 'C5-M07' && optKey === 'A') {
    if (!writes.some(w => w.includes('Count_验货命中'))) writes.push('Count_验货命中 += 1');
  }

  // Round-4 Ruling V5 (Errata S5): Flag_数字人线开放 written by X-MODE-09
  if (cardId === 'X-MODE-09' && optKey === 'B') {
    if (!writes.some(w => w.includes('Flag_数字人线开放'))) writes.push('Flag_数字人线开放 = 1');
  }

  return writes;
}

function parseEndingTriggers(summaryText, cardId, optKey) {
  const endings = [];
  const normalized = normalizeEndingIds(summaryText);
  const matches = normalized.matchAll(/\b([MDH]\d{2})\b/g);
  for (const m of matches) {
    if (!endings.includes(m[1])) endings.push(m[1]);
  }
  return endings;
}

function parseNextCards(summaryText, cardId, optKey) {
  const cards = [];
  const matches = summaryText.matchAll(/\b([A-Z0-9]+-[A-Z0-9]+)\b/g);
  for (const m of matches) {
    if (m[1] !== cardId && !cards.includes(m[1])) cards.push(m[1]);
  }
  return cards;
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

    // P1-C (Errata S3): Parameterized timing bar ops_note
    let opsNote = null;
    if (id === 'C3-M08') {
      opsNote = 'P3-3/S3: 挂载【轻操作：时机条】（参数化甜区宽0.15/良区宽0.40，中心实例随机），结果在选项结算后生效';
    } else if (id === 'C6-M05') {
      opsNote = 'P3-3/S3: 挂载【轻操作：时机条】（参数化甜区宽0.15/良区宽0.40，中心实例随机），结果在选项结算后生效且只作用于非煽动选项（选项B稳健控场生效，选项A煽动不吃时机条）';
    } else if (opsType === 'timing_bar') {
      opsNote = 'S3: 挂载【轻操作：时机条】（参数化甜区宽0.15/良区宽0.40，中心实例随机），结果在选项结算后生效';
    }

    // F4: Timing bar ops_skin
    const opsSkin = TIMING_BAR_SKINS[id] || null;

    // P1-A & F5: Backfill pity_chain & is_pity_guaranteed
    const pityInfo = PITY_CHAIN_MAP[id];
    const isPityGuaranteed = pityInfo ? pityInfo.is_guaranteed : false;
    const pityChain = pityInfo ? pityInfo.chain : null;

    // F1: Backfill prereq_expr
    const prereqExpr = CARD_PREREQS[id] || null;

    // Parse options A/B/C
    const rawOptLines = optCell.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
    const tempOptions = rawOptLines.map((optLine, optIdx) => {
      const optKeyMatch = optLine.match(/^\*\*([A-C])\.\*\*\s*(.*)$/);
      const optKey = optKeyMatch ? optKeyMatch[1] : String.fromCharCode(65 + optIdx);
      const rawLabel = optKeyMatch ? optKeyMatch[2] : optLine;
      const cleanLabel = stripMd(rawLabel).replace(/^[「『"]|[」』"]$/g, '');
      return { opt_key: optKey, raw_label: rawLabel, label: cleanLabel };
    });

    // Errata P4-3 abbreviations expansion
    let outcomeExpanded = outcomeCell
      .replace(/立退/g, '立即触发退网结局')
      .replace(/下章可触/g, '下一阶段可触发');

    const splitOutcomes = splitOptionOutcomes(outcomeExpanded, tempOptions, id);
    const options = [];

    for (let optIdx = 0; optIdx < tempOptions.length; optIdx++) {
      const optItem = tempOptions[optIdx];
      const optKey = optItem.opt_key;
      const optKeyCompound = `${id}:${optKey}`;
      const optSummary = splitOutcomes[optKey] || '';

      // F1: Option requirement expression
      const reqExpr = OPTION_REQS[optKeyCompound] || null;

      // F1: Parse numeric deltas and qualitative notes
      const deltas = parseDeltas(optSummary, id, optKey);

      // F1: Parse state writes
      const stateWrites = parseStateWrites(optSummary, outcomeExpanded, id, optKey);

      // S4 / Round-4 Ruling V2 & V3: check_expr, check_fail, effects_conditional
      const checkInfo = OPTION_CHECKS[optKeyCompound] || null;
      const checkExpr = checkInfo ? (checkInfo.check_expr || null) : null;
      const checkFail = checkInfo ? (checkInfo.check_fail || null) : null;
      const effectsConditional = checkInfo ? (checkInfo.effects_conditional || null) : null;

      // F1: Parse ending triggers (failure endings in check_fail belong to check_fail branch)
      let endingTriggers = parseEndingTriggers(optSummary, id, optKey);
      if (checkFail && Array.isArray(checkFail.ending_triggers)) {
        endingTriggers = endingTriggers.filter(et => !checkFail.ending_triggers.includes(et));
      }

      // F1: Parse next cards
      const nextCards = parseNextCards(optSummary, id, optKey);

      // Concise toast copy
      let outcomeToast = stripMd(optSummary);
      if (!outcomeToast) outcomeToast = stripMd(outcomeExpanded);

      const effectsObj = {
        summary: stripMd(optSummary),
        delta_five_dim: deltas.five_dim,
        delta_attrs: deltas.attrs,
        state_writes: stateWrites,
        ending_triggers: endingTriggers,
        next_cards: nextCards,
        qualitative_notes: deltas.qualitative
      };
      if (effectsConditional) {
        effectsObj.effects_conditional = effectsConditional;
      }

      options.push({
        opt_key: optKey,
        label: optItem.label,
        raw_label: optItem.raw_label,
        req_expr: reqExpr,
        check_expr: checkExpr,
        check_fail: checkFail,
        effects: effectsObj,
        outcome_toast: outcomeToast
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
      prereq_expr: prereqExpr,
      is_pity_guaranteed: isPityGuaranteed,
      pity_chain: pityChain,
      is_serious: isSerious,
      ops_type: opsType,
      ops_note: opsNote,
      ops_skin: opsSkin,
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

// ============================================================================
// 3. Parse 50 Endings and 50 Talents (F2: H12 branch_variants & distinct summaries)
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

    // Errata P1-2: H05 dual sources
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

    // Review corrections item 5: H03 dangling stat fix
    if (id === 'H03') {
      triggerText = triggerText
        .replace(/智力\/口才\s*≥\s*8/g, '口才 ≥ 8')
        .replace(/智力\s*≥\s*8/g, '口才 ≥ 8');
    }

    const talentParts = talentCol.split(/<br\s*\/?>/i);
    const talentName = stripMd(talentParts[0]);
    let talentEffect = normalizeEndingIds(stripMd(talentParts.slice(1).join(' ')));

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

    // F2: H12 branch_variants (A/B two distinct settlement copies & talent effect follows branches)
    if (id === 'H12') {
      endingEntry.branch_variants = {
        A: {
          branch: 'A',
          name: '星海真神',
          summary: '【星海真神】你推开星空大门加冕星海真神，全星播十二条主线宇宙为你共鸣，全属性永久升华。',
          life_quote: '「百世浮沉皆入图鉴，你推开星空大门，加冕为星海唯一的创世真神。」',
          talent_effect: '分支 A【星海真神】开局全属性 +1（且单项不超过 10、总池不超过 57）'
        },
        B: {
          branch: 'B',
          name: '万界旅人',
          summary: '【万界旅人】你回头向所有平行时空的自己举杯致意，笑着走入下一场人间烟火，初始口碑直达90。',
          life_quote: '「走遍万界依然热爱人间，敬每一个曾拼尽全力的平行自己。」',
          talent_effect: '分支 B【万界旅人】初始口碑直接提升至 90，老粉初始粘性与星牌留存顶格'
        }
      };
      endingEntry.talent_effect = '分支 A【星海真神】开局全属性 +1；分支 B【万界旅人】初始口碑直接提升至 90（随通关分支继承对应前世天赋加成）';
      talentEffect = endingEntry.talent_effect;
      endingEntry.errata_note = 'F2/P4-2: A/B 挂载 branch_variants，天赋文案随分支走，共用第 50 枚天赋【真·顶流权柄】';
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
// 4. Build Config, Screens, Draw Rules, Timing Params, Structured Actions (F1, F3, F5, F7)
// ============================================================================
function buildConfigAndScreens() {
  return {
    schema_version: 'v0.2-transcribed',
    errata_rulings_applied: [
      'P1-1: 状态字典与快照字段由 §2.9 表身自动生成（36 键 / 57 字段）',
      'P1-2: H05 触发双来源（Count_算法异常=3 即时 或 运气满值打通第六章六章末结算），Count_算法异常写入方限定 C4-S19:B / C5-S19:B / C6-S19:A',
      'P2-1: 12张双标标志性卡基线1.0、匹配×2.0、未匹配不降权(1.0)；短卡/跨章软门控维持匹配×3.0、未匹配×0.5',
      'P3-1: 翻样辨真为翻任意2件 + 四键指认（指认#1掺假 / 指认#2掺假 / 指认#3掺假 / 三件全合格）',
      'P3-2: 全本美术总盘69张封顶（NPC 36 + 底板模板 6 + 结局 27 = 69）',
      'P3-3: C3-M08 挂载 ops_note（轻操作时机条参数化）',
      'P4-1: 全部结局ID补零（M01..M12 / D01..D26 / H01..H12），H01 规范名称为 黑粉头子是真爱',
      'P4-2: X-EGG-09 / H12 独立 A/B 分支文案与 branch_variants，共用第 50 枚天赋',
      'P4-3: 缩写全展开（立退 -> 立即触发退网结局，下章可触 -> 下一阶段可触发）',
      'P4-4: Screen-08（结局分享卡弹窗）独立成行，具备独立输入与输出定义',
      'S1: 模式权威词表更正为 7 个常规排班模式 + 数字人锁定第 8 槽位',
      'S2: gate_type 枚举扩展登记 progress 与 none',
      'S3: 时机条分区参数化（甜区宽 0.15、良区宽 0.40、中心每卡实例随机）',
      'F1: 阶段 1.5 机器可读补全（prereq_expr、req_expr、结构化 effects、8/8 下播行动结构化）',
      'F2: X-EGG-09 拆 A/B 文案与 effects，H12 挂载 branch_variants',
      'F3: 时机条参数补全（5秒上限、三连点兜底开关、cursor_speed 改回 0.65）',
      'F4: 时机条四换皮按卡内动作分配（接梗/憋单/PK/高光，六卡全落 ops_skin）',
      'F5: pity_trigger 登记进 draw_rules.trigger_upgrade',
      'F6: 校验断言只增不减纪律与 errata_rulings_applied 全名单恢复',
      'F7: 模式匹配语义定为 contains 成员关系，电竞作为游戏别名登记'
    ],
    review_corrections_applied: [
      'P1-A: §1.8 保底链补转录（draw_rules 槽位 2+3、四条保底链、跨章池 4.0 与 40% 倾斜全入库）',
      'P1-B: gate_type 枚举扩展登记 progress 与 none',
      'P1-C: 时机条分区删除两套固定区间，统一参数化入库',
      'P2-A: 字数门绊线复位为裁定 9 原口径（80/20/40 与 60/14/30）',
      'P2-C: 词表更正为 7 个常规排班模式 + 数字人锁定第 8 槽位',
      'F1: 阶段 1.5 补全机器可执行字段（47 张 prereq_expr、23 项 req_expr、317 选项五维结构化、55 处 state_writes、8 项行动结构化）',
      'F2: X-EGG-09 与 H12 双分支结构化落地',
      'F3: 时机条参数挂载 5 秒超时与三连点兜底开关，cursor_speed 复位 0.65',
      'F4: 六张时机条卡按卡内剧情动作全量挂载 ops_skin',
      'F5: pity_trigger 登记至 draw_rules.trigger_upgrade',
      'F7: 模式词表登记 contains 成员关系语义与电竞别名'
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
      tag_aliases: {
        '电竞': '游戏'
      },
      matching_semantics: 'contains_membership (按标签成员关系匹配，复合标签命中任一模式即算命中)',
      rules: {
        schedule_modes_count: 7,
        locked_slot_8_description: '数字人为第 8 槽位锁定槽，后期诱惑解锁，不进常规排班池（Screen-02「8 选 1」即 7 常规 + 1 锁定槽）',
        radio_note: '正本行名「聊天唠嗑 / 情感电台」，卡面标签统一用「电台」，「聊天」不作独立模式',
        alias_note: 'F7: 「电竞」作「游戏」别名登记，抽取器按标签成员关系判定',
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
      trigger_upgrade: [
        {
          card_id: 'X-EGG-03',
          prereq: "has_encountered('C4-M03') && C4-M03 == 'A' (签过极光直播)",
          target_ending: 'D24',
          upgrade_to: 'guaranteed_slot',
          description: '第四章选过签约极光直播，后续极光跑路卡必出保底'
        },
        {
          card_id: 'X-EGG-05',
          prereq: 'Flag_放任切片号 == 1',
          target_ending: 'D26',
          upgrade_to: 'guaranteed_slot',
          description: '放任高仿切片号不管，后续真假美猴王卡必出保底'
        },
        {
          card_id: 'X-EGG-08',
          prereq: 'total_endings_unlocked >= 30',
          target_ending: 'H11',
          upgrade_to: 'guaranteed_slot',
          description: '累计解锁结局数达到 30 个，后续时光机老麦克风必出保底'
        },
        {
          card_id: 'X-EGG-09',
          prereq: 'cleared_main_endings_count == 12',
          target_ending: 'H12',
          upgrade_to: 'guaranteed_slot',
          description: '通关全部 12 主结局后终章必出仪式卡'
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
      cursor_speed: 0.65,
      cursor_speed_source: 'spike/spike_stage0.lua:14',
      sweep_direction: 'unidirectional',
      sweet_window_seconds: 0.23,
      max_duration_seconds: 5.0,
      triple_tap_fallback: false,
      center_selection: 'random_per_card_instance',
      center_range: [0.20, 0.80],
      multipliers: {
        sweet: 1.15,
        good: 1.05,
        normal: 1.00
      },
      applicable_cards: ['C1-M05', 'C2-M09', 'C3-M08', 'C4-M11', 'C5-M09', 'C6-M05'],
      skins: {
        'C1-M05': '接梗',
        'C2-M09': 'PK',
        'C3-M08': '高光',
        'C4-M11': '憋单',
        'C5-M09': '高光',
        'C6-M05': 'PK'
      },
      ruling: 'F3/F4/S3/V8: 甜区宽0.15、良区宽0.40，单向扫条甜区窗口约0.23秒，5秒超时上限，三连点兜底开关默认关，cursor_speed=0.65源自spike_stage0.lua:14'
    },
    skin_set: {
      canonical_names: ['接梗', '憋单放福袋', '最后一波拉票', '关键操作'],
      data_mapping: {
        '接梗': '接梗',
        '憋单': '憋单放福袋',
        'PK': '最后一波拉票',
        '高光': '关键操作'
      }
    },
    fan_composition: {
      segments: ['颜粉', '声控粉', '技术粉', '乐子人', '大哥', '学生粉'],
      exclusive_pool_threshold_pct: 35,
      normalize_sum_pct: 100,
      revenue_modifier_range: [0.6, 1.8],
      description: '正本 §2.7 粉丝构成 6 类阶段结算矩阵'
    },
    global_rules: {
      total_multiplier_clamp: [0.4, 3.0],
      circus_style: {
        multiplier: 2.5,
        zero_revenue_rate: 0.35,
        description: '整活流乘区 ×2.5，35% 概率收益清零'
      },
      commercial_multiplier: {
        sources_stack_rule: 'take_highest_no_stack',
        rep_max_cap: 1.5,
        description: '商务乘区两来源取最高不叠加，口碑侧上限 1.5'
      }
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
      Rep: { initial: 60, min: -100, max: 100, death_threshold: -20, death_ending: 'D03', sponsor_mult_cap: 1.5, sponsor_mult_threshold: 80 },
      Stamina: { initial: 80, min: 0, max: 100, death_ending_on_zero: 'D01', alert_zone_threshold: 30, alert_skew_pct: 0.40, high_status_highlight_threshold: 85 }
    },
    attributes_config: {
      base_points_total: 45,
      ad_bonus_points_max: 12,
      total_starting_pool_cap: 57,
      single_attribute_min: 1,
      single_attribute_base_max: 10,
      single_attribute_ad_bonus_cap: 3,
      single_attribute_after_ad_max: 8,
      in_game_growth_cap_per_attribute: 2,
      attributes: [
        '颜值', '嗓音', '才艺', '游戏技术', '口才', '情商', '体力', '心态', '运气'
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
          stamina_mult: 0.80,
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
          stamina_mult: 1.00,
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
          stamina_mult: 0.90,
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
          stamina_mult: 1.30,
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
          stamina_mult: 2.00,
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
          cost: { stamina: 0 },
          stat_deltas: { stamina: 30 },
          attr_deltas: {},
          state_writes: [],
          buffs: { clear_debuff: '熬夜透支', prevent_alert_zone: true },
          risk: null,
          immediate_effects: '状态 +30',
          continuous_effects: '清除「熬夜透支」Debuff，防止下一章落入 <30 警戒翻车区',
          effects: '状态 +30，清除熬夜透支 Debuff'
        },
        {
          id: 2,
          name: '专心练功',
          cost: { stamina: -5 },
          stat_deltas: { stamina: -5 },
          attr_deltas: { select_one: ['才艺', '游戏技术', '口才'], delta: 1, cap_per_game: 2 },
          state_writes: [],
          buffs: { next_mode_mult_bonus: 0.15 },
          risk: null,
          immediate_effects: '才艺/技术/口才三选一 +1（单局单项上限+2），状态 -5',
          continuous_effects: '下阶段若排对应模式的班，模式乘区额外 +0.15',
          effects: '才艺/技术/口才三选一 +1（单局单项上限+2），状态 -5，下阶段对应模式乘区 +0.15'
        },
        {
          id: 3,
          name: '剪切片、运营账号',
          cost: { stamina: -5 },
          stat_deltas: { heat_pct: 15, stamina: -5 },
          attr_deltas: {},
          state_writes: ['Count_剪切片运营 += 1'],
          buffs: { clip_outbreak_checks: 1, hater_tax_reduction: 0.05, m10_req_counter: 1 },
          risk: null,
          immediate_effects: '热度 +15%，状态 -5',
          continuous_effects: '下一阶段「切片出圈」判定次数 +1，老粉粘性提升（掉粉税减免 5%）；累计 ≥3 次为 M10 幕后操盘手必要条件',
          effects: '热度 +15%，状态 -5；下一阶段「切片出圈」判定次数 +1，老粉粘性提升（掉粉税减免 5%）；累计 ≥3 次为 M10 幕后操盘手必要条件'
        },
        {
          id: 4,
          name: '粉丝群运营/回私信',
          cost: { stamina: -5 },
          stat_deltas: { rep: 5, stamina: -5 },
          attr_deltas: {},
          state_writes: [],
          buffs: { star_card_loyalty_pct: 15, top_fan_favor: 10 },
          risk: null,
          immediate_effects: '口碑 +5，状态 -5',
          continuous_effects: '高等级「星牌」忠诚度 +15%，榜一大哥好感度 +10（降低一切脱粉回踩痛感）',
          effects: '口碑 +5，状态 -5，高等级「星牌」忠诚度 +15%，大哥好感 +10'
        },
        {
          id: 5,
          name: '选品与商务对接',
          cost: { stamina: 0 },
          stat_deltas: {},
          attr_deltas: {},
          state_writes: ['Count_验货命中 += 1', 'Flag_选品减伤 = 1'],
          buffs: { next_ecommerce_conversion_pct: 20 },
          risk: null,
          ops_type: 'sample_inspect',
          ops_config: {
            total_samples: 3,
            flip_limit: 2,
            choice_buttons: [
              '指认 #1 掺假',
              '指认 #2 掺假',
              '指认 #3 掺假',
              '三件全合格'
            ],
            hit_effect: 'Count_验货命中 +1; Flag_选品减伤 = 1'
          },
          immediate_effects: '下一场带货转化率 +20%，触发【翻样辨真】轻操作',
          continuous_effects: '三件样品扣放翻2件，指认命中则 Count_验货命中 +1（同步置 Flag_选品减伤=1），累加至 C5-M07 减伤/反诉判线',
          effects: '下一场带货转化率 +20%，触发【翻样辨真】（翻任意2件 + 四键指认），命中则 Count_验货命中 +1（同步置 Flag_选品减伤=1）'
        },
        {
          id: 6,
          name: '看回放复盘、整理素材留档',
          cost: { stamina: 0 },
          stat_deltas: {},
          attr_deltas: { mindset_per_2_counts: 1 },
          state_writes: ['Count_复盘留档 += 1'],
          buffs: { unique_counterattack_source: 'C5-M02' },
          risk: null,
          immediate_effects: 'Count_复盘留档 +1（每累计 2 次留档，心态 +1）',
          continuous_effects: '【唯一反杀源】保存原始录屏与未剪辑工程文件，第五章高潮「被锤事件（事19）」中解锁完整证据链绝地反杀选项的唯一来源',
          effects: 'Count_复盘留档 +1（每累计 2 次留档，心态 +1），唯一反杀源（第五章被锤事件绝地反杀唯一来源）'
        },
        {
          id: 7,
          name: '约会 / 社交',
          cost: { stamina: 0 },
          stat_deltas: { stamina: 10 },
          attr_deltas: {},
          state_writes: [],
          buffs: { advance_love_favor: 1 },
          risk: { condition: 'is_secret_period', trigger: 'Count_偷拍素材 += 1', description: '处于保密期则触发 1 次被狗仔偷拍判定' },
          immediate_effects: '状态 +10（甜段），推进当前对象好感',
          continuous_effects: '按当前结识恋爱对象进入甜段互动；若处于保密期则触发 1 次被狗仔偷拍判定',
          effects: '状态 +10，推进恋爱对象好感；保密期触发狗仔偷拍判定'
        },
        {
          id: 8,
          name: '接私活',
          cost: { stamina: -20 },
          stat_deltas: { stamina: -20, wallet_chapter_base_mult: 0.4 },
          attr_deltas: {},
          state_writes: [],
          buffs: null,
          risk: { condition: 'Flag_签公会 == 1', chance: 0.4, warning: '触发公会违约警告' },
          immediate_effects: '钱包 +当章基准×0.4，状态 -20',
          continuous_effects: '快速补充现金流救急；但签约公会状态下有 40% 概率触发公会违约警告',
          effects: '钱包 +当章基准×0.4，状态 -20（签约公会状态下 40% 概率触发公会违约警告）'
        }
      ]
    },
    screens: [
      { screen_id: 'Screen-01', name: '捏人与前置属性分配屏', inputs: '45点基础总点自由分配至9条属性（1-10）；可选看激励视频广告（广告点位1，每看1条+3点，最多4条封顶+12点，单项广告上限+3且吃满不超过8）', outputs: '生成玩家9维初始属性（总和45-57）；进入第一章开播' },
      { screen_id: 'Screen-02', name: '直播排班配置屏（8 选 1）', inputs: '1.选择开播模式（7常规排班 + 1后期数字人锁定槽）；2.选择开播时段（清晨/午间/下午/黄金/深夜）；3.选择时长（2h/4h/6h）', outputs: '计算推流乘区、钱包变现乘区、状态消耗；决定本场事件池模式门控与抽取权重' },
      { screen_id: 'Screen-03', name: '直播主界面（事件卡连续交互）', inputs: '每场开播抽取2-4张事件卡（单章5张）；每卡阅读正文与两难，在2-3个选项中点击其一', outputs: '展示卡面文案与NPC差分；若点选暴毙选项进入 Screen-06，若完成整场进 Screen-04' },
      { screen_id: 'Ops-A', parent_screen: 'Screen-03', name: '轻操作一：时机条点停', inputs: '每章至多1张标志性卡挂载；光标在时机条往复扫动（速度0.65，5秒超时上限），玩家点击屏幕完成点停判定', outputs: '甜区×1.15 / 良区×1.05 / 普通×1.0（参数化甜区宽0.15/良区宽0.40，中心实例随机），并入所在卡结算并受单卡 Cap 夹逼' },
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
  status: 'STAGE_1_5_TRANSCRIPTION_COMPLETE',
  state_dictionary_keys: stateDict.total_keys,
  snapshot_fields: stateDict.Snapshot_BeforeCard.total_fields,
  cards_total: cards.length,
  endings_total: endingsAndTalents.counts.total_endings,
  talents_total: endingsAndTalents.counts.total_talents,
  screens_total: configAndScreens.screens.length,
  schedule_modes: configAndScreens.mode_vocabulary.schedule_modes.length,
  pity_chains: configAndScreens.draw_rules.pity_chains.length,
  trigger_upgrade_cards: configAndScreens.draw_rules.trigger_upgrade.length,
  timing_bar_parameters: configAndScreens.timing_bar_parameters.sweet_width,
  cursor_speed: configAndScreens.timing_bar_parameters.cursor_speed,
  max_duration_seconds: configAndScreens.timing_bar_parameters.max_duration_seconds,
  triple_tap_fallback: configAndScreens.timing_bar_parameters.triple_tap_fallback,
  off_stream_actions_count: configAndScreens.schedules.off_stream_actions.length,
  h12_branch_variants_present: !!endingsAndTalents.endings.find(e => e.ending_id === 'H12').branch_variants
}, null, 2));
