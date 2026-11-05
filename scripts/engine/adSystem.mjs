export class AdSystem {
  constructor() {
    this.watchdogTimeoutMs = 300000; // 300 seconds engineering red line
  }

  // Request watching an ad placeholder
  requestAd(slotType, gameState, callback) {
    // slotType: 'creation_points' | 'revive_or_repick' | 'fan_angle' | 'settlement_double'
    const allowed = this.canWatchAd(slotType, gameState);
    if (!allowed) {
      if (callback) callback({ success: false, reason: 'limit_reached' });
      return false;
    }

    // In Stage 2 placeholder mode, immediately return success or simulated skip
    // Supports 300s watchdog safety
    const timer = setTimeout(() => {
      // Safety watchdog trigger if ever blocked
      if (callback) callback({ success: false, reason: 'watchdog_timeout' });
    }, this.watchdogTimeoutMs);

    // Placeholder mock resolve
    clearTimeout(timer);
    if (slotType === 'creation_points') {
      gameState.adUsage.creationPoints++;
    } else if (slotType === 'revive_or_repick') {
      gameState.adUsage.reviveOrRepick++;
    } else if (slotType === 'fan_angle') {
      gameState.adUsage.fanAngleUnlock++;
    } else if (slotType === 'settlement_double') {
      gameState.adUsage.settlementDouble++;
    }

    if (callback) callback({ success: true, slotType });
    return true;
  }

  canWatchAd(slotType, gameState) {
    if (slotType === 'creation_points') {
      return gameState.adUsage.creationPoints < 4;
    }
    if (slotType === 'revive_or_repick') {
      return gameState.adUsage.reviveOrRepick < 1;
    }
    if (slotType === 'settlement_double') {
      return gameState.adUsage.settlementDouble < 2;
    }
    return true;
  }
}
