export class SampleInspect {
  constructor() {
    this.totalSamples = 3;
    this.maxFlips = 2;
  }

  // Create an Ops-B instance
  createInstance() {
    // 0: all good, 1: sample #1 fake, 2: sample #2 fake, 3: sample #3 fake
    const fakeIndex = Math.floor(Math.random() * 4); // 0, 1, 2, or 3
    const samples = [
      { id: 1, isFake: fakeIndex === 1, clue: fakeIndex === 1 ? '气味刺鼻，重金属检测指示条变色' : '气味清淡温和，各项理化指标达标' },
      { id: 2, isFake: fakeIndex === 2, clue: fakeIndex === 2 ? '膏体分层析出，批号防伪涂层无法刮开' : '质地均匀细腻，防伪码查验为正品' },
      { id: 3, isFake: fakeIndex === 3, clue: fakeIndex === 3 ? '包装简陋，无正规生产许可证与执行标准' : '三证齐全，具备第三方SGS质检报告' }
    ];

    return {
      samples,
      fakeIndex, // 0 = all good, 1..3 = fake sample id
      flippedCount: 0,
      flippedSampleIds: [],
      isResolved: false,
      isHit: false
    };
  }

  // Player flips a sample
  flipSample(instance, sampleId) {
    if (instance.flippedCount >= this.maxFlips) return null;
    if (instance.flippedSampleIds.includes(sampleId)) return null;

    instance.flippedSampleIds.push(sampleId);
    instance.flippedCount++;
    const s = instance.samples.find(x => x.id === sampleId);
    return s ? s.clue : null;
  }

  // Player chooses one of the 4 buttons: 1, 2, 3, or 'all_good'
  identify(instance, choice, gameState) {
    instance.isResolved = true;
    let hit = false;
    if (choice === 'all_good' && instance.fakeIndex === 0) {
      hit = true;
    } else if (choice === instance.fakeIndex) {
      hit = true;
    }

    instance.isHit = hit;
    if (hit) {
      gameState.applyStateWrite('Count_验货命中 += 1');
      gameState.applyStateWrite('Flag_选品减伤 = 1');
    }

    return {
      hit,
      fakeIndex: instance.fakeIndex,
      countHits: gameState.variables['Count_验货命中'],
      flagReducedDamage: gameState.variables['Flag_选品减伤']
    };
  }
}
