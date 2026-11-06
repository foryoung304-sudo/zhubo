export class StageSettlement {
  constructor(config) {
    this.config = config;
    this.chapters = config.chapters;
    this.timeSlots = config.schedules.time_slots;
    this.durations = config.schedules.durations;
    this.fanConfig = config.fan_composition || {
      segments: ['颜粉', '声控粉', '技术粉', '乐子人', '大哥', '学生粉'],
      exclusive_pool_threshold_pct: 35,
      normalize_sum_pct: 100
    };
  }

  settleChapter(gameState, adDoubleUsed = false) {
    const ch = gameState.currentChapter;
    const chCfg = this.chapters.find(c => c.chapter === ch);
    const slot = this.timeSlots.find(s => s.id === gameState.selectedSchedule.timeSlot) || this.timeSlots[0];
    const duration = this.durations.find(d => d.hours === gameState.selectedSchedule.duration) || this.durations[1];

    // 1. Natural Heat Decay: -15%, min 15
    const decay = Math.max(15, Math.floor(gameState.fiveDim.heat * 0.15));
    gameState.fiveDim.heat = Math.max(0, gameState.fiveDim.heat - decay);

    // 2. Base fans & wallet growth
    let fansMult = (slot.fans_mult || 1.0) * (duration.fans_mult || 1.0);
    let walletMult = slot.wallet_mult || 1.0;

    // Afternoon slot special rule: 1.25 only for 带货 mode
    if (slot.id === 'slot_afternoon' && gameState.selectedSchedule.mode === '带货') {
      walletMult = slot.wallet_mult_ecommerce || 1.25;
    } else if (slot.id === 'slot_afternoon') {
      walletMult = slot.wallet_mult_default || 1.00;
    }

    if (adDoubleUsed && gameState.adUsage.settlementDouble < 2) {
      fansMult *= 2.0;
      walletMult *= 2.0;
      gameState.adUsage.settlementDouble++;
    }

    let netFansGain = Math.round((chCfg.Base_Fans || 1000) * fansMult);
    if (gameState.variables && gameState.variables['Flag_零粉快乐'] === 1) {
      netFansGain = 0; // H07: 关掉所有推流通道，零粉快乐不享受系统公域涨粉
    }
    let netWalletGain = Math.round((chCfg.Base_Income || 1000) * walletMult);

    // W5.1: 广告翻倍同受 Cap 夹逼 (§2.4 Item 6 / §2.2)
    if (chCfg.Cap_Fans !== undefined && chCfg.Cap_Fans !== null) {
      netFansGain = Math.min(chCfg.Cap_Fans, netFansGain);
    }
    if (chCfg.Cap_Wallet !== undefined && chCfg.Cap_Wallet !== null) {
      netWalletGain = Math.min(chCfg.Cap_Wallet, netWalletGain);
    }

    gameState.fiveDim.fans += netFansGain;
    gameState.fiveDim.wallet += netWalletGain;

    // 3. Fan Composition Drift Calculation (§2.7 & Z4 漂移输入补全)
    const attrs = gameState.attributes;
    const mode = gameState.selectedSchedule.mode;
    const slotId = gameState.selectedSchedule.timeSlot;
    const isCircus = gameState.variables && gameState.variables['Tag_流派'] === '整活';

    // 模式亲和 (×1.5) 与 时段亲和 (×1.5)
    const m_yan = (mode === '才艺' || mode === '团播') ? 1.5 : 1.0;
    const s_yan = (slotId === 'slot_prime') ? 1.5 : 1.0;

    const m_sheng = (mode === '电台' || mode === '才艺') ? 1.5 : 1.0;
    const s_sheng = (slotId === 'slot_morning' || slotId === 'slot_late') ? 1.5 : 1.0;

    const m_ji = (mode === '游戏') ? 1.5 : 1.0;
    const s_ji = (slotId === 'slot_noon' || slotId === 'slot_prime') ? 1.5 : 1.0;

    const m_le = (mode === 'PK' || mode === '户外' || isCircus) ? 1.5 : 1.0;
    const s_le = (slotId === 'slot_noon') ? 1.5 : 1.0;

    const m_da = (mode === 'PK' || mode === '电台') ? 1.5 : 1.0;
    const s_da = (slotId === 'slot_prime' || slotId === 'slot_late') ? 1.5 : 1.0;

    const m_xue = (mode === '游戏' || mode === '团播') ? 1.5 : 1.0;
    const s_xue = (slotId === 'slot_noon' || slotId === 'slot_weekend') ? 1.5 : 1.0;

    const weights = {
      '颜粉': (attrs['颜值'] + attrs['才艺']) * m_yan * s_yan,
      '声控粉': (attrs['嗓音'] * 2) * m_sheng * s_sheng,
      '技术粉': (attrs['游戏技术'] * 2) * m_ji * s_ji,
      '乐子人': (attrs['口才'] + attrs['运气']) * m_le * s_le,
      '大哥': (attrs['情商'] + attrs['颜值'] + attrs['才艺']) * m_da * s_da,
      '学生粉': (attrs['游戏技术'] + attrs['口才']) * m_xue * s_xue
    };

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    let sumPct = 0;
    const newComposition = {};
    const segments = this.fanConfig.segments;

    segments.forEach((seg, idx) => {
      if (idx === segments.length - 1) {
        newComposition[seg] = Math.max(0, 100 - sumPct);
      } else {
        const pct = Math.round((weights[seg] / totalWeight) * 100);
        newComposition[seg] = pct;
        sumPct += pct;
      }
    });

    // Ambiguity A Ruling: Fan Tilt (+5% to tilted segments on next stage settlement)
    if (gameState.fanTilt && Object.keys(gameState.fanTilt).length > 0) {
      for (const [seg, tiltPoints] of Object.entries(gameState.fanTilt)) {
        if (newComposition[seg] !== undefined) {
          newComposition[seg] += tiltPoints;
        }
      }
      const curSum = Object.values(newComposition).reduce((a, b) => a + b, 0);
      if (curSum > 0 && curSum !== 100) {
        let runSum = 0;
        segments.forEach((seg, idx) => {
          if (idx === segments.length - 1) {
            newComposition[seg] = Math.max(0, 100 - runSum);
          } else {
            const reNorm = Math.round((newComposition[seg] / curSum) * 100);
            newComposition[seg] = reNorm;
            runSum += reNorm;
          }
        });
      }
      gameState.fanTilt = {}; // Consumed on settlement
    }

    gameState.fanComposition = newComposition;

    // 4. Chapter Gate Check & §2.2 注 1 Overtime Mechanism (X2.⑤)
    const gateTarget = chCfg.fans_gate_to;
    const isPromoted = gameState.fiveDim.fans >= gateTarget;
    gameState.overtimePlayed = gameState.overtimePlayed || {};

    let canOvertime = false;
    // Special Hidden Ending H07 check in chapter 6 (零人观看的桃花源: 粉丝 < 10,000 且 口碑 >= 90)
    const isH07Eligible = (ch === 6 &&
      (gameState.variables['Qualified_H07'] === 1 || gameState.variables['Flag_零粉快乐'] === 1) &&
      gameState.fiveDim.fans < 10000 && gameState.fiveDim.rep >= 90);

    if (isH07Eligible && !gameState.isDead) {
      gameState.isCleared = true;
      gameState.triggeredEnding = 'H07';
      canOvertime = false;
      gameState.overtimeActive = false;
    } else if (!isPromoted && !gameState.isDead) {
      if (!gameState.overtimePlayed[ch]) {
        // First time failing gate: can play overtime (3 cards)
        canOvertime = true;
        gameState.overtimeActive = true;
        gameState.overtimePlayed[ch] = true;
      } else {
        // Already played overtime and still failed gate: graceful exit (M04 / M12)
        gameState.isCleared = false;
        if (!gameState.triggeredEnding) {
          if (gameState.fiveDim.rep >= 50) {
            gameState.triggeredEnding = 'M04'; // 佛系小主播 (口碑良好)
          } else {
            gameState.triggeredEnding = 'M12'; // 正常上班 (泯然众人)
          }
        }
      }
    } else if (isPromoted) {
      gameState.overtimeActive = false;
    }

    // Check Chapter 6 Cleared (盛典加冕)
    if (ch === 6 && (isPromoted || gameState.isCleared) && !gameState.isDead) {
      gameState.isCleared = true;
      if (!gameState.triggeredEnding) {
        // 1. Qualified Hidden Endings
        if ((gameState.variables['Qualified_H07'] === 1 || gameState.variables['Flag_零粉快乐'] === 1) &&
            gameState.fiveDim.fans < 10000 && gameState.fiveDim.rep >= 90) {
          gameState.triggeredEnding = 'H07'; // 零人观看的桃花源
        } else if (gameState.variables['Qualified_H04'] === 1 || (gameState.variables['Count_猫上镜'] || 0) >= 3) {
          gameState.triggeredEnding = 'H04'; // 全星播最贵铲屎官
        } else if (gameState.variables['Qualified_H10'] === 1 || (gameState.variables['Count_考编'] || 0) >= 3) {
          gameState.triggeredEnding = 'H10'; // 宇宙尽头是编制
        } else if (gameState.variables['Count_算法异常'] >= 3 && attrs['运气'] === 10) {
          gameState.triggeredEnding = 'H05'; // 冲出楚门直播间
        } else if (gameState.variables['Qualified_H08'] === 1 && gameState.cardHistory && gameState.cardHistory.includes('C6-M09')) {
          gameState.triggeredEnding = 'H08'; // 夜航船的万里守候 (需完成终章必出卡 C6-M09 选 A)
        } else if (gameState.variables['Qualified_H01'] === 1 || ((gameState.variables['Count_黑粉不对线'] || 0) >= 3 && (attrs['情商'] || 0) >= 7)) {
          gameState.triggeredEnding = 'H01'; // 黑粉头子是真爱
        // 2. Qualified Main Endings
        } else if ((gameState.variables['Qualified_M03'] === 1 || (gameState.variables['Flag_野生主播'] === 1 && (attrs['情商'] || 0) >= 8)) && gameState.fiveDim.wallet >= 3000000) {
          gameState.triggeredEnding = 'M03'; // 屠龙者终成老板
        } else if (gameState.variables['Qualified_M07'] === 1 || (mode === '团播' && (attrs['才艺'] || 0) >= 8 && gameState.variables['Flag_公款雷'] !== 1)) {
          gameState.triggeredEnding = 'M07'; // 滚烫的中央聚光灯
        } else if (gameState.variables['Qualified_M08'] === 1 || (mode === '游戏' && (attrs['游戏技术'] || 0) >= 8)) {
          gameState.triggeredEnding = 'M08'; // 官方认证·人形外挂
        } else if (gameState.variables['Qualified_M09'] === 1 || (mode === '户外' && gameState.fiveDim.stamina >= 75)) {
          gameState.triggeredEnding = 'M09'; // 把直播间搬进山海
        // 3. Existing Main Endings Checks
        } else if (gameState.variables['Tag_清白账本'] === 1 && gameState.fiveDim.rep >= 80) {
          gameState.triggeredEnding = 'M01'; // 顶流传奇·长青树
        } else if (gameState.variables['Flag_选品减伤'] === 1 && mode === '带货') {
          gameState.triggeredEnding = 'M02'; // 带货巨擘·品质之选
        } else if (gameState.variables['Tag_流派'] === '整活') {
          gameState.triggeredEnding = 'M04'; // 现象级狂欢·娱乐至死
        } else {
          gameState.triggeredEnding = 'M05'; // 盛典加冕·璀璨星光
        }
      }
    }

    // Z2: 练功 buff 仅在紧接的下一阶段内生效，该阶段结算时无论用未用一律清零 (§2.8C & Z2)
    if (gameState.practiceBuff && gameState.practiceBuff.targetChapter <= ch) {
      gameState.practiceBuff = null;
    }

    return {
      chapter: ch,
      netFansGain,
      netWalletGain,
      totalFans: gameState.fiveDim.fans,
      totalWallet: gameState.fiveDim.wallet,
      fanComposition: newComposition,
      isPromoted,
      canOvertime,
      isCleared: gameState.isCleared,
      triggeredEnding: gameState.triggeredEnding
    };
  }

  // Advance to next chapter
  advanceChapter(gameState) {
    if (gameState.practiceBuff && gameState.practiceBuff.targetChapter <= gameState.currentChapter) {
      gameState.practiceBuff = null;
    }
    if (gameState.currentChapter < 6) {
      gameState.currentChapter++;
      gameState.currentCardIndex = 0;
      gameState.actionPoints = 1;
      gameState.chapterFansGained = 0; // X2.④: 重置当章 5 卡累计涨粉统计
      gameState.overtimeActive = false;
      return gameState.currentChapter;
    }
    return 6;
  }
}
