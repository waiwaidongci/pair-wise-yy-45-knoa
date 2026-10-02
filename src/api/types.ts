export type Round = '第一轮' | '第二轮' | '第三轮'

export type Measurement = {
  key: string
  name: string
  spec: number
  actual: number
  tolerance: number
}

export type Annotation = {
  id: string
  x: number
  y: number
  part: string
  /** 归属部位 key，用于依赖链匹配 */
  partKey: string
  content: string
  author: string
  status: '待处理' | '已解决'
}

export type RevisionProposal = {
  id: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: '待决定' | '已采纳' | '未采纳'
}

/** 工艺要求：挂在一个或多个部位上，部位尺寸/批注变更后只有依赖它的要求会失效 */
export type CraftRequirement = {
  id: string
  /** 依赖的部位 key 列表 */
  parts: string[]
  content: string
  /** 责任人（需再确认） */
  owner: string
  status: '有效' | '待重算'
  /** 依赖部位指纹的快照，用于判定是否过期 */
  basedOn: string
  confirmedAt: string | null
  /** 再确认结论 */
  reconfirmNote: string
}

/** 通过标记：每个部位每个轮次一条，幂等 upsert，不重复生成 */
export type PassMark = {
  id: string
  part: string
  round: Round
  result: '通过' | '不通过'
  owner: string
  status: '有效' | '待重算'
  basedOn: string
  confirmedAt: string
}

export type RevisionEvent = {
  id: string
  at: string
  type: '提交' | '失效' | '重算' | '再确认' | '冲突' | '恢复'
  parts: string[]
  detail: string
  owner: string
}

export type ConflictInfo = {
  at: string
  winner: string
  winnerOwner: string
  baseVersion: number
  currentVersion: number
  changedParts: Array<{ part: string; before: string; after: string }>
}

export type JournalStep = {
  key: string
  label: string
  status: 'done' | 'pending'
}

export type WriteJournal = {
  id: string
  sampleId: string
  selectedParts: string[]
  baseVersion: number
  /** 原始修订请求体，断点续作时用于补做未完成的尺寸变更 */
  body: RevisionRequestBody
  steps: JournalStep[]
  status: '进行中' | '失败' | '完成'
  error: string
  updatedAt: string
}

export type RevisionRequestBody = {
  baseVersion: number
  selectedParts: string[]
  changes: { measurements: Array<{ round: Round; part: string; actual: number }> }
  note: string
}

export type RevisionResult =
  | { ok: true; sample: Sample; version: number; journalId: string }
  | { ok: false; reason: 'conflict'; conflict: ConflictInfo }
  | { ok: false; reason: 'write_failed'; journal: WriteJournal }

export type Sample = {
  id: string
  styleCode: string
  styleName: string
  category: string
  developmentSeason: string
  supplier: string
  dueDate: string
  owner: string
  status: '开发中' | '待审核' | '已锁定'
  /** 资料版本号：乐观并发控制的基准 */
  version: number
  fabric: string
  colorway: string
  craftRequirements: CraftRequirement[]
  measurements: Record<Round, Measurement[]>
  annotations: Annotation[]
  proposals: RevisionProposal[]
  attachments: Array<{ name: string; type: string; owner: string }>
  comments: Array<{ id: string; author: string; content: string; date: string }>
  passMarks: PassMark[]
  revisionEvents: RevisionEvent[]
}
