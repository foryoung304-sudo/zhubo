/**
 * 阶段 3 · 26 触发卡定向探针 (scripts/probe_trigger_cards.mjs)
 * 
 * 依据: Orange 扫后修复轮裁定
 * 目标: 对扫表未曾进手的 26 个结局触发卡逐张定向探针（直接发到手里，验结局能不能落）。
 * 结论分类:
 *   - PASS: 卡片直发进手后，能真实落成目标结局 (isDead / isCleared / triggeredEnding)
 *   - CARRY_GATED: 前置为跨局继承 (H09/H11/H12)，单局初始态结构性锁死
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameState } from './engine/gameState.mjs';
import { CardEngine } from './engine/cardEngine.mjs';
import { StageSettlement } from './engine/stageSettlement.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');

const configData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config_and_screens.json'), 'utf8'));
const stateDict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state_dictionary.json'), 'utf8'));
const endingsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'endings_and_talents.json'), 'utf8'));
const cardsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cards.json'), 'utf8'));

const cardEngine = new CardEngine(configData);
const stageSettlement = new StageSettlement(configData);

function findCard(id) {
  const c = cardsData.find(x => x.card_id === id);
  if (!c) throw new Error(`Card not found: ${id}`);
  return c;
}

const probeCases = [
  // 1. M01: C6-M10 (终局扳机)
  {
    targetEnding: 'M01',
    cardId: 'C6-M10',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 6;
      st.fiveDim.fans = 10000000;
      st.fiveDim.rep = 90;
      st.variables['Tag_清白账本'] = 1;
    },
    postAction: (st) => { stageSettlement.settleChapter(st); }
  },
  // 2. M02: C5-M07 (带货供应链全身而退)
  {
    targetEnding: 'M02',
    cardId: 'C5-M07',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 5;
      st.selectedSchedule.mode = '带货';
      st.variables['Count_验货命中'] = 1; // 满足 check_expr: Count_验货命中 >= 1
      st.variables['Flag_选品减伤'] = 1;
    },
    postAction: (st) => {
      st.currentChapter = 6;
      st.fiveDim.fans = 10000000;
      st.selectedSchedule.mode = '带货';
      stageSettlement.settleChapter(st);
    }
  },
  // 3. M07: C3-M08 (团播自证)
  {
    targetEnding: 'M07',
    cardId: 'C3-M08',
    optKey: 'B',
    setup: (st) => {
      st.currentChapter = 3;
      st.attributes['才艺'] = 8;
    },
    postAction: (st) => {
      st.currentChapter = 6;
      st.fiveDim.fans = 10000000;
      stageSettlement.settleChapter(st);
    }
  },
  // 4. M09: C1-M04 (夜航船老粉)
  {
    targetEnding: 'M09',
    cardId: 'C1-M04',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 1;
    },
    postAction: (st) => {
      st.currentChapter = 6;
      st.fiveDim.fans = 10000000;
      stageSettlement.settleChapter(st);
    }
  },
  // 5. M10: X-ATTR-10 (退居幕后金牌操盘手)
  {
    targetEnding: 'M10',
    cardId: 'X-ATTR-10',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 6;
      st.attributes['颜值'] = 3;
      st.attributes['情商'] = 8;
      st.attributes['口才'] = 8;
    },
    postAction: (st) => {
      // X-ATTR-10 A sets triggeredEnding = M10 in chapter 6
    }
  },
  // 6. D09: C6-M06 (AI数字人 50% 封号分支)
  {
    targetEnding: 'D09',
    cardId: 'C6-M06',
    optKey: 'A',
    timingResult: { digitalCloneRoll: 0.2 },
    setup: (st) => {
      st.currentChapter = 6;
      st.variables['Flag_数字人线开放'] = 1;
    }
  },
  // 7. D12: C5-M07 (选品暴雷赔付破产)
  {
    targetEnding: 'D12',
    cardId: 'C5-M07',
    optKey: 'B',
    setup: (st) => {
      st.currentChapter = 5;
    }
  },
  // 8. D15: C5-M10 (八点抢发小作文且留档<2)
  {
    targetEnding: 'D15',
    cardId: 'C5-M10',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 5;
      st.variables['Count_复盘留档'] = 0;
    }
  },
  // 9. D16: C5-M10 (小作文且留档>=2但素材>=3)
  {
    targetEnding: 'D16',
    cardId: 'C5-M10',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 5;
      st.variables['Count_复盘留档'] = 2;
      st.variables['Count_偷拍素材'] = 3;
    }
  },
  // 10. D17: C5-M04 (怒怼粉丝掉粉暴毙)
  {
    targetEnding: 'D17',
    cardId: 'C5-M04',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 5;
    }
  },
  // 11. D19: C5-M10 (小作文且无账号协议)
  {
    targetEnding: 'D19',
    cardId: 'C5-M10',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 5;
      st.variables['Count_复盘留档'] = 2;
      st.variables['Count_偷拍素材'] = 0;
      st.variables['Flag_账号协议'] = 0;
    }
  },
  // 12. D22: X-EGG-01 (熬夜猝死)
  {
    targetEnding: 'D22',
    cardId: 'X-EGG-01',
    optKey: 'B',
    setup: (st) => {
      st.currentChapter = 3;
      st.fiveDim.stamina = 10;
    }
  },
  // 13. D23: X-EGG-02 (倒霉透顶)
  {
    targetEnding: 'D23',
    cardId: 'X-EGG-02',
    optKey: 'B',
    setup: (st) => {
      st.currentChapter = 3;
      st.attributes['运气'] = 2;
    }
  },
  // 14. D24: X-EGG-03 (平台跑路破产)
  {
    targetEnding: 'D24',
    cardId: 'X-EGG-03',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 4;
    }
  },
  // 15. D25: X-EGG-04 (线下真实)
  {
    targetEnding: 'D25',
    cardId: 'X-EGG-04',
    optKey: 'B',
    setup: (st) => {
      st.currentChapter = 4;
      st.variables['Count_黑粉不对线'] = 2;
    }
  },
  // 16. D26: X-EGG-05 (李鬼封杀)
  {
    targetEnding: 'D26',
    cardId: 'X-EGG-05',
    optKey: 'B',
    setup: (st) => {
      st.currentChapter = 4;
      st.variables['Flag_放任切片号'] = 1;
    }
  },
  // 17. H01: X-EGG-04 (黑粉头子是真爱)
  {
    targetEnding: 'H01',
    cardId: 'X-EGG-04',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 4;
      st.variables['Count_黑粉不对线'] = 3;
      st.attributes['情商'] = 8;
    }
  },
  // 18. H02: C6-M08 (星际巡航的港湾)
  {
    targetEnding: 'H02',
    cardId: 'C6-M08',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 6;
      st.variables['Flag_榜一恋爱'] = 1;
    }
  },
  // 19. H03: C6-M06 (AI数字人 50% 觉醒分支)
  {
    targetEnding: 'H03',
    cardId: 'C6-M06',
    optKey: 'A',
    timingResult: { digitalCloneRoll: 0.8 },
    setup: (st) => {
      st.currentChapter = 6;
      st.variables['Flag_数字人线开放'] = 1;
    }
  },
  // 20. H05: C6-S19 (冲出楚门直播间)
  {
    targetEnding: 'H05',
    cardId: 'C6-S19',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 6;
      st.variables['Count_算法异常'] = 3;
      st.attributes['运气'] = 10;
    }
  },
  // 21. H07: C1-M10 (零人观看的桃花源)
  {
    targetEnding: 'H07',
    cardId: 'C1-M10',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 1;
    },
    postAction: (st) => {
      st.currentChapter = 6;
      st.fiveDim.fans = 2000;
      st.fiveDim.rep = 95;
      stageSettlement.settleChapter(st);
    }
  },
  // 22. H08: C6-M09 (夜航船的万里守候)
  {
    targetEnding: 'H08',
    cardId: 'C6-M09',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 6;
      st.variables['Flag_老粉'] = 1;
      st.variables['Qualified_H08'] = 1;
      st.cardHistory.push('C6-M09');
    },
    postAction: (st) => {
      st.fiveDim.fans = 10000000;
      stageSettlement.settleChapter(st);
    }
  },
  // 23. H09: X-EGG-07 (跨局存档量 3 前世天赋)
  {
    targetEnding: 'H09',
    cardId: 'X-EGG-07',
    optKey: 'A',
    isCarryLocked: true,
    setup: (st) => {
      st.currentChapter = 6;
    }
  },
  // 24. H10: C4-S16 (宇宙尽头是编制)
  {
    targetEnding: 'H10',
    cardId: 'C4-S16',
    optKey: 'A',
    setup: (st) => {
      st.currentChapter = 4;
      st.variables['Count_考编'] = 2; // option A adds 1 -> reaches 3
    }
  },
  // 25. H11: X-EGG-08 (跨局存档量 30 结局)
  {
    targetEnding: 'H11',
    cardId: 'X-EGG-08',
    optKey: 'A',
    isCarryLocked: true,
    setup: (st) => {
      st.currentChapter = 6;
    }
  },
  // 26. H12: X-EGG-09 (跨局存档量 12 主结局通关)
  {
    targetEnding: 'H12',
    cardId: 'X-EGG-09',
    optKey: 'A',
    isCarryLocked: true,
    setup: (st) => {
      st.currentChapter = 6;
    }
  }
];

console.log('================================================================================');
console.log('阶段 3 · 26 触发卡定向探针实测 (scripts/probe_trigger_cards.mjs)');
console.log('口径: 直发进手，执行指定选项，验证结局能否真实落成');
console.log('================================================================================\n');

let passCount = 0;
let carryCount = 0;
let failCount = 0;

for (const tc of probeCases) {
  if (tc.isCarryLocked) {
    console.log(`[CARRY_LOCKED] ${tc.targetEnding} ← ${tc.cardId}: 结构性锁定于单局口径 (需跨局存档量)`);
    carryCount++;
    continue;
  }

  const st = new GameState(configData, stateDict, endingsData);
  if (tc.setup) tc.setup(st);
  const card = findCard(tc.cardId);

  // Directly select option
  cardEngine.selectOption(card, tc.optKey, st, tc.timingResult || {});
  if (tc.postAction) {
    tc.postAction(st);
  }

  const actualEnding = st.triggeredEnding;
  const isOk = (actualEnding === tc.targetEnding) && (st.isDead || st.isCleared);

  if (isOk) {
    console.log(`[PASS] ${tc.targetEnding} ← ${tc.cardId}:${tc.optKey} (actual=${actualEnding}, isDead=${st.isDead}, isCleared=${st.isCleared})`);
    passCount++;
  } else {
    console.log(`[FAIL] ${tc.targetEnding} ← ${tc.cardId}:${tc.optKey} (expected=${tc.targetEnding}, actual=${actualEnding}, isDead=${st.isDead}, isCleared=${st.isCleared})`);
    failCount++;
  }
}

console.log('\n--------------------------------------------------------------------------------');
console.log(`探针总计: ${probeCases.length} 个 | 真实落成 PASS: ${passCount} | 跨局存档锁 CARRY_LOCKED: ${carryCount} | 失败 FAIL: ${failCount}`);
console.log('--------------------------------------------------------------------------------');

if (failCount > 0) {
  process.exit(1);
}
