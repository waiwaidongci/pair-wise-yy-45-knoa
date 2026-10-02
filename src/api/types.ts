export type PartKey =
  | 'chest'
  | 'waist'
  | 'hem'
  | 'length'
  | 'shoulder'
  | 'sleeve'
  | 'collar'
  | 'placket'
  | 'waistline'

export type Measurement = {
  key: PartKey
  name: string
  spec: number
  actual: number
  tolerance: number
  /** 该部位规格（源）当前版本；规格/批注每提交一次修订 +1 */
  sourceVersion: number
}

export type AnnotationStatus = '待处理' | '已解决'

export type Annotation = {
  id: string
  x: number
  y: number
  part: string
  partKey?: PartKey
  content: string
  author: string
  status: AnnotationStatus
  sourceVersion: number
  decidedAt?: string
  decidedBy?: string
  resolution?: string
}

export type RevisionProposal = {
  id: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: '待决定' | '已采纳' | '未采纳'
}

/** 责任人对已失效工艺/结论的再确认结果 */
export type Reconfirmation = {
  at: string
  by: string
  result: '继续沿用' | '已更新'
  note: string
  /** 确认时该工艺所依赖部位的源版本（"沿用"即责任人为此版本差异背书） */
  seenSpecVersion?: Partial<Record<PartKey, number>>
  seenAnnotationVersion?: Partial<Record<PartKey, number>>
}

/** 工艺要求（依赖链中间层）：记录依据的源版本，源版本推进后变为待重算 */
export type CraftItem = {
  id: string
  name: string
  dependsOn: PartKey[]
  owner: string
  ownerRole: string
  basis: string
  /** 依据的尺寸规格版本：partKey -> sourceVersion */
  basisSpecVersion: Partial<Record<PartKey, number>>
  /** 依据的批注版本：partKey -> sourceVersion */
  basisAnnotationVersion: Partial<Record<PartKey, number>>
  status: '有效' | '待重算'
  reconfirmations: Reconfirmation[]
}

/** 样衣结论（依赖链末端）：逐部位的通过标记，只与本部位规格版本绑定 */
export type PassMark = {
  id: string
  partKey: PartKey
  result: '通过' | '不通过'
  basisSpecVersion: number
  /** 依据的最新批注版本（如有） */
  basisAnnotationVersion?: number
  judgedAt: string
}

export type ChainEventType =
  | 'spec-change'
  | 'annotation'
  | 'craft-invalidated'
  | 'craft-reconfirmed'
  | 'pass-regenerated'
  | 'revision-committed'
  | 'revision-conflict'
  | 'checkpoint-resumed'

export type ChainEvent = {
  id: string
  at: string
  type: ChainEventType
  title: string
  detail: string
  owner: string
  partKey?: PartKey
  craftId?: string
  revisionId?: string
}

export type RevisionChange = {
  kind: 'spec'
  partKey: PartKey
  round: '第一轮' | '第二轮' | '第三轮'
  oldSpec: number
  newSpec: number
  note: string
} | {
  kind: 'annotation'
  partKey: PartKey
  annotationId: string
  action: 'resolve'
  resolution: string
  note: string
}

export type RevisionRecord = {
  id: string
  at: string
  author: string
  note: string
  baseVersion: number
  changes: RevisionChange[]
}

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
  fabric: string
  colorway: string
  /** 依赖链修订版本（乐观锁） */
  revision: number
  measurements: Record<'第一轮' | '第二轮' | '第三轮', Measurement[]>
  annotations: Annotation[]
  crafts: CraftItem[]
  passMarks: PassMark[]
  chainEvents: ChainEvent[]
  revisions: RevisionRecord[]
  proposals: RevisionProposal[]
  attachments: Array<{ name: string; type: string; owner: string }>
  comments: Array<{ id: string; author: string; content: string; date: string }>
}

/** 提交修订时的断点：写库失败后保留，恢复时从断点重做 */
export type Checkpoint = {
  batchId: string
  sampleId: string
  author: string
  baseVersion: number
  changes: RevisionChange[]
  /** 已完成阶段：spec 成功、annotation 失败时，恢复只重做 annotation 与 passMarks */
  completed: Array<'spec' | 'annotation'>
  failedAt: string
  error: string
}

/** 409 冲突载荷：先提交版本留下，后提交者看到被改部位与差异 */
export type ConflictInfo = {
  currentRevision: number
  winner: { author: string; at: string; note: string }
  conflictChanges: Array<{
    partKey: PartKey
    kind: RevisionChange['kind']
    yours: string
    theirs: string
  }>
}
