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

    // 3. Fan Composition Drift Calculation (§2.7)
    const attrs = gameState.attributes;
    const mode = gameState.selectedSchedule.mode;

    const weights = {
      '颜粉': (attrs['颜值'] + attrs['才艺']) * (mode === '才艺' || mode === '团播' ? 1.5 : 1.0),
      '声控粉': (attrs['嗓音'] * 2) * (mode === '电台' || mode === '才艺' ? 1.5 : 1.0),
      '技术粉': (attrs['游戏技术'] * 2) * (mode === '游戏' ? 1.5 : 1.0),
      '乐子人': (attrs['口才'] + attrs['运气']) * (mode === 'PK' || mode === '户外' ? 1.5 : 1.0),
      '大哥': (attrs['情商'] + attrs['颜值']) * (mode === 'PK' || mode === '电台' ? 1.5 : 1.0),
      '学生粉': (attrs['游戏技术'] + attrs['口才']) * (mode === '游戏' || mode === '团播' ? 1.5 : 1.0)
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

    // 4. Chapter Gate Check
    const gateTarget = chCfg.fans_gate_to;
    const isPromoted = gameState.fiveDim.fans >= gateTarget;

    // Check Chapter 6 Cleared (盛典加冕)
    if (ch === 6 && isPromoted && !gameState.isDead) {
      gameState.isCleared = true;
      if (!gameState.triggeredEnding) {
        // Determine main ending M01..M12 based on key flags
        if (gameState.variables['Tag_清白账本'] === 1 && gameState.fiveDim.rep >= 80) {
          gameState.triggeredEnding = 'M01'; // 顶流传奇·长青树
        } else if (gameState.variables['Flag_选品减伤'] === 1 && mode === '带货') {
          gameState.triggeredEnding = 'M02'; // 带货巨擘·品质之选
        } else if (gameState.variables['Tag_流派'] === '整活') {
          gameState.triggeredEnding = 'M04'; // 现象级狂欢·娱乐至死
        } else if (gameState.variables['Count_算法异常'] >= 3 && attrs['运气'] === 10) {
          gameState.triggeredEnding = 'H05'; // 冲出楚门直播间
        } else {
          gameState.triggeredEnding = 'M05'; // 盛典加冕·璀璨星光
        }
      }
    }

    return {
      chapter: ch,
      netFansGain,
      netWalletGain,
      totalFans: gameState.fiveDim.fans,
      totalWallet: gameState.fiveDim.wallet,
      fanComposition: newComposition,
      isPromoted,
      isCleared: gameState.isCleared,
      triggeredEnding: gameState.triggeredEnding
    };
  }

  // Advance to next chapter
  advanceChapter(gameState) {
    if (gameState.currentChapter < 6) {
      gameState.currentChapter++;
      gameState.currentCardIndex = 0;
      gameState.actionPoints = 1;
      return gameState.currentChapter;
    }
    return 6;
  }
}
