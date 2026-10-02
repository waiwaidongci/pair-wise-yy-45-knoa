import type { Annotation, CraftItem, Measurement, PartKey, PassMark, Sample } from './types'

type Round = '第一轮' | '第二轮' | '第三轮'

type SeedPart = {
  key: PartKey
  name: string
  spec: number
  actual: number
  tolerance: number
  sourceVersion?: number
}

const rounds: Round[] = ['第一轮', '第二轮', '第三轮']

function buildMeasurements(
  parts: SeedPart[],
  drift: Record<Round, number>,
  actualScale: Record<Round, number>,
): Sample['measurements'] {
  const result = {} as Sample['measurements']
  rounds.forEach((round) => {
    result[round] = parts.map((p) => {
      const roundActual = round === '第三轮' ? p.actual : p.actual + drift[round] * actualScale[round]
      return {
        key: p.key,
        name: p.name,
        spec: p.spec,
        actual: Math.round(roundActual * 10) / 10,
        tolerance: p.tolerance,
        sourceVersion: p.sourceVersion ?? 1,
      } satisfies Measurement
    })
  })
  return result
}

const parts18: SeedPart[] = [
  { key: 'chest', name: '胸围', spec: 106, actual: 106.3, tolerance: 1.5, sourceVersion: 2 },
  { key: 'waist', name: '腰围', spec: 94, actual: 94.2, tolerance: 1.5 },
  { key: 'hem', name: '下摆围', spec: 112, actual: 112.4, tolerance: 2 },
  { key: 'length', name: '后衣长', spec: 72, actual: 71.9, tolerance: 1 },
  { key: 'shoulder', name: '肩宽', spec: 48, actual: 48.2, tolerance: 1 },
  { key: 'sleeve', name: '袖长', spec: 61, actual: 60.9, tolerance: 1 },
  { key: 'collar', name: '领口', spec: 40, actual: 40.3, tolerance: 1 },
  { key: 'waistline', name: '腰节', spec: 38, actual: 38.1, tolerance: 1 },
]

const parts21: SeedPart[] = [
  { key: 'chest', name: '胸围', spec: 100, actual: 100.4, tolerance: 1.5 },
  { key: 'waist', name: '腰围', spec: 86, actual: 86.3, tolerance: 1.5 },
  { key: 'hem', name: '下摆围', spec: 104, actual: 104.2, tolerance: 2 },
  { key: 'length', name: '后衣长', spec: 84, actual: 83.8, tolerance: 1 },
  { key: 'shoulder', name: '肩宽', spec: 44, actual: 44.1, tolerance: 1 },
  { key: 'sleeve', name: '袖长', spec: 58, actual: 57.9, tolerance: 1 },
  { key: 'placket', name: '门襟', spec: 70, actual: 70.6, tolerance: 1 },
]

function initialPassMarks(parts: SeedPart[], at: string, staleChest?: boolean): PassMark[] {
  // 部位已有关闭/待处理批注时，通过标记记录所依据的批注源版本；批注再决定即失效
  const annotationBasis: Partial<Record<string, number>> = {
    collar: 2,
    waistline: 1,
    placket: 1,
  }
  return parts.map((p, index) => {
    const version = p.sourceVersion ?? 1
    const basis = staleChest && p.key === 'chest' ? version - 1 : version
    const pass = Math.abs(p.actual - p.spec) <= p.tolerance
    return {
      id: `PM-${index + 1}`,
      partKey: p.key,
      result: pass ? '通过' : '不通过',
      basisSpecVersion: basis,
      basisAnnotationVersion: annotationBasis[p.key],
      judgedAt: at,
    }
  })
}

const crafts18: CraftItem[] = [
  {
    id: 'CR-01',
    name: '斜向立体贴袋',
    dependsOn: ['chest', 'waist'],
    owner: '苏州明裁工艺组',
    ownerRole: '工厂工艺',
    basis: '袋口定位于胸围线下 4cm，按胸围 108 制版；胸腰差决定袋口外撇量。',
    // 胸围源已升至 v2，此处仍停留在 v1 —— 工艺过期
    basisSpecVersion: { chest: 1, waist: 1 },
    basisAnnotationVersion: {},
    status: '待重算',
    reconfirmations: [],
  },
  {
    id: 'CR-02',
    name: '双针压线 0.6cm',
    dependsOn: ['hem'],
    owner: '苏州明裁工艺组',
    ownerRole: '工厂工艺',
    basis: '下摆双针间距 0.6cm，下摆围 112，起收针位对齐侧缝。',
    basisSpecVersion: { hem: 1 },
    basisAnnotationVersion: {},
    status: '有效',
    reconfirmations: [],
  },
  {
    id: 'CR-03',
    name: '袖口暗扣',
    dependsOn: ['sleeve'],
    owner: '周研',
    ownerRole: '版师',
    basis: '袖口暗扣距袖衩 2.5cm，袖长 61 时扣位居中。',
    basisSpecVersion: { sleeve: 1 },
    basisAnnotationVersion: {},
    status: '有效',
    reconfirmations: [],
  },
  {
    id: 'CR-04',
    name: '领底衬与领尖收窄',
    dependsOn: ['collar'],
    owner: '陈曼',
    ownerRole: '产品',
    basis: '依据领口批注：领尖收窄 0.8cm 并增加领底衬。',
    basisSpecVersion: { collar: 1 },
    basisAnnotationVersion: { collar: 2 },
    status: '有效',
    reconfirmations: [
      {
        at: '09-27 18:10',
        by: '陈曼 / 产品',
        result: '继续沿用',
        note: '批注关闭后已与工厂核对领衬工艺，结论继续有效。',
      },
    ],
  },
  {
    id: 'CR-05',
    name: '抽绳孔位回落 1.5cm',
    dependsOn: ['waistline'],
    owner: '周研',
    ownerRole: '版师',
    basis: '腰节批注已解决：抽绳孔位按回落 1.5cm 定位。',
    basisSpecVersion: { waistline: 1 },
    basisAnnotationVersion: { waistline: 1 },
    status: '有效',
    reconfirmations: [],
  },
]

const crafts21: CraftItem[] = [
  {
    id: 'CR-11',
    name: '隐形门襟',
    dependsOn: ['placket'],
    owner: '宁波原野工艺组',
    ownerRole: '工厂工艺',
    basis: '门襟净长 70，压线居中；质检批注提出模板定位复核。',
    basisSpecVersion: { placket: 1 },
    basisAnnotationVersion: { placket: 1 },
    status: '有效',
    reconfirmations: [],
  },
  {
    id: 'CR-12',
    name: '后背防风片',
    dependsOn: ['shoulder', 'length'],
    owner: '宁波原野工艺组',
    ownerRole: '工厂工艺',
    basis: '防风片自肩线起 22cm，肩宽 44、衣长 84 时覆盖肩胛骨。',
    basisSpecVersion: { shoulder: 1, length: 1 },
    basisAnnotationVersion: {},
    status: '有效',
    reconfirmations: [],
  },
  {
    id: 'CR-13',
    name: '可拆腰带',
    dependsOn: ['waist'],
    owner: '陈曼',
    ownerRole: '产品',
    basis: '腰带长度按腰围 86 + 叠搭量 24cm。',
    basisSpecVersion: { waist: 1 },
    basisAnnotationVersion: {},
    status: '有效',
    reconfirmations: [],
  },
]

const annotations18: Annotation[] = [
  {
    id: 'AN-01', x: 64, y: 24, part: '领口', partKey: 'collar',
    content: '领尖略外翘，收窄 0.8cm 并增加领底衬。',
    author: '陈曼 / 产品', status: '已解决', sourceVersion: 2,
    decidedAt: '09-27 17:40', decidedBy: '陈曼 / 产品', resolution: '已采纳，领尖收窄并入 CR-04。',
  },
  {
    id: 'AN-02', x: 42, y: 51, part: '腰节', partKey: 'waistline',
    content: '抽绳孔位比设计稿高 1.5cm，需要回落。',
    author: '周研 / 版师', status: '已解决', sourceVersion: 1,
    decidedAt: '09-26 11:20', decidedBy: '周研 / 版师', resolution: '模板已回落 1.5cm。',
  },
]

const annotations21: Annotation[] = [
  {
    id: 'AN-11', x: 54, y: 40, part: '门襟', partKey: 'placket',
    content: '门襟压线偏移，检查模板定位。',
    author: '顾恺 / 质检', status: '待处理', sourceVersion: 1,
  },
]

export const seedSamples: Sample[] = [
  {
    id: 'SMP-26018',
    styleCode: 'WR-26AW-018',
    styleName: '海盐弧线工装外套',
    category: '女装 / 外套',
    developmentSeason: '2026 秋冬',
    supplier: '苏州明裁制衣',
    dueDate: '2026-10-12',
    owner: '沈岚',
    status: '待审核',
    fabric: '三防棉锦 / 军绿色',
    colorway: '苔绿 18-0322 TCX',
    revision: 2,
    measurements: buildMeasurements(parts18, { 第一轮: 2.6, 第二轮: 0.8, 第三轮: 0 }, { 第一轮: 1, 第二轮: 1, 第三轮: 1 }),
    annotations: annotations18,
    crafts: crafts18,
    passMarks: initialPassMarks(parts18, '09-28 09:15', true),
    chainEvents: [
      {
        id: 'CE-04', at: '09-30 14:22', type: 'spec-change', partKey: 'chest',
        title: '胸围规格变更（v1 → v2）',
        detail: '第三轮胸围规格 108 → 106，依据试穿宽松量反馈。',
        owner: '沈岚 / 产品开发',
      },
      {
        id: 'CE-03', at: '09-30 14:22', type: 'craft-invalidated', partKey: 'chest', craftId: 'CR-01',
        title: '工艺「斜向立体贴袋」已失效待重算',
        detail: '该工艺依据胸围 v1，源已升级为 v2，工厂不得按旧资料开裁。',
        owner: '系统 / 依赖链',
      },
      {
        id: 'CE-02', at: '09-27 17:40', type: 'annotation', partKey: 'collar',
        title: '领口批注已关闭',
        detail: '领尖收窄 0.8cm 并增加领底衬，已转入工艺 CR-04。',
        owner: '陈曼 / 产品',
      },
      {
        id: 'CE-01', at: '09-26 11:20', type: 'annotation', partKey: 'waistline',
        title: '腰节批注已关闭',
        detail: '抽绳孔位回落 1.5cm，模板更新完成。',
        owner: '周研 / 版师',
      },
    ],
    revisions: [
      {
        id: 'RV-R1', at: '09-30 14:22', author: '沈岚', baseVersion: 1,
        note: '试穿反馈胸围偏松，规格收至 106。',
        changes: [
          { kind: 'spec', partKey: 'chest', round: '第三轮', oldSpec: 108, newSpec: 106, note: '宽松量回收 2cm。' },
        ],
      },
    ],
    proposals: [
      { id: 'RV-01', author: '周研', role: '版师', content: '前片肩线内收 0.6cm，袖窿同步下落 0.3cm。', affectedPart: '肩袖', status: '待决定' },
      { id: 'RV-02', author: '沈岚', role: '产品开发', content: '维持袖长，仅调整袖山吃势，避免改变视觉比例。', affectedPart: '袖山', status: '待决定' },
    ],
    attachments: [
      { name: '第二轮正面.jpg', type: '样衣照片', owner: '沈岚' },
      { name: '尺寸实测_0926.xlsx', type: '尺寸表', owner: '苏州明裁' },
      { name: '试穿记录_试穿员B.pdf', type: '试穿记录', owner: '陈曼' },
    ],
    comments: [
      { id: 'CM-01', author: '陈曼', content: '袖窿活动量比第一轮改善，但抬手仍会带动前片。', date: '09-27 15:20' },
      { id: 'CM-02', author: '周研', content: '建议先采纳肩线修正方案，第三轮再确认动态舒适度。', date: '09-27 17:05' },
    ],
  },
  {
    id: 'SMP-26021',
    styleCode: 'WR-26AW-021',
    styleName: '岩灰轻量风衣',
    category: '女装 / 风衣',
    developmentSeason: '2026 秋冬',
    supplier: '宁波原野服饰',
    dueDate: '2026-10-18',
    owner: '陈曼',
    status: '开发中',
    fabric: '高密尼龙 / 岩灰',
    colorway: '雾岩灰 17-4402 TCX',
    revision: 1,
    measurements: buildMeasurements(parts21, { 第一轮: 1.4, 第二轮: 0.4, 第三轮: 0 }, { 第一轮: 1, 第二轮: 1, 第三轮: 1 }),
    annotations: annotations21,
    crafts: crafts21,
    passMarks: initialPassMarks(parts21, '09-29 10:05'),
    chainEvents: [
      {
        id: 'CE-11', at: '09-28 16:30', type: 'annotation', partKey: 'placket',
        title: '门襟批注待处理',
        detail: '门襟压线偏移，检查模板定位；相关工艺 CR-11 需关注。',
        owner: '顾恺 / 质检',
      },
    ],
    revisions: [],
    proposals: [
      { id: 'RV-11', author: '宁波原野', role: '供应商', content: '门襟增加定位钻眼，压线稳定性可控制在 ±0.2cm。', affectedPart: '门襟', status: '待决定' },
    ],
    attachments: [{ name: '第一轮背片.jpg', type: '样衣照片', owner: '陈曼' }],
    comments: [],
  },
]
