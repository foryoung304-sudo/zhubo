export class TimingBar {
  constructor(config) {
    this.params = config.timing_bar_parameters;
    this.skins = config.skin_set || {
      canonical_names: ['接梗', '憋单放福袋', '最后一波拉票', '关键操作'],
      data_mapping: { '接梗': '接梗', '憋单': '憋单放福袋', 'PK': '最后一波拉票', '高光': '关键操作' }
    };
  }

  // Create an instance for a card
  createInstance(card) {
    const sweetWidth = this.params.sweet_width || 0.15;
    const goodWidth = this.params.good_width || 0.40;
    const cursorSpeed = this.params.cursor_speed || 0.65;
    const maxDuration = this.params.max_duration_seconds || 5.0;

    // Center randomly determined per card instance in [0.25, 0.75]
    const center = 0.25 + Math.random() * 0.50;

    const sweetStart = center - sweetWidth / 2;
    const sweetEnd = center + sweetWidth / 2;
    const goodStart = center - goodWidth / 2;
    const goodEnd = center + goodWidth / 2;

    const rawSkin = card.ops_skin || '接梗';
    const canonicalSkin = this.skins.data_mapping[rawSkin] || rawSkin;

    return {
      cardId: card.card_id,
      skin: canonicalSkin,
      cursorSpeed,
      cursorPos: 0.0,
      center,
      sweetStart,
      sweetEnd,
      goodStart,
      goodEnd,
      maxDuration,
      isResolved: false,
      resultZone: 'NORMAL',
      multiplier: 1.0,
      elapsedTime: 0
    };
  }

  // Evaluate tap position
  evaluateTap(instance, tapPosition, chosenOptionKey = 'A') {
    instance.isResolved = true;
    instance.cursorPos = tapPosition;

    if (tapPosition >= instance.sweetStart && tapPosition <= instance.sweetEnd) {
      instance.resultZone = 'SWEET';
      instance.multiplier = 1.15;
    } else if (tapPosition >= instance.goodStart && tapPosition <= instance.goodEnd) {
      instance.resultZone = 'GOOD';
      instance.multiplier = 1.05;
    } else {
      instance.resultZone = 'NORMAL';
      instance.multiplier = 1.00;
    }

    // Special ruling for C6-M05: Timing bar multiplier only applies to Option B
    if (instance.cardId === 'C6-M05') {
      if (chosenOptionKey === 'A') {
        instance.multiplier = 1.00; // Option A (煽动) does not receive timing bar boost
      }
    }

    return {
      zone: instance.resultZone,
      multiplier: instance.multiplier,
      skin: instance.skin
    };
  }
}
