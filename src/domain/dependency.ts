import type { CraftRequirement, Measurement, PassMark, Round, Sample } from '../api/types'

export const ROUNDS: Round[] = ['第一轮', '第二轮', '第三轮']

export const PART_NAMES: Record<string, string> = {
  chest: '胸围',
  waist: '腰围',
  hem: '下摆围',
  length: '后衣长',
  shoulder: '肩宽',
  sleeve: '袖长',
}

export function partName(part: string): string {
  return PART_NAMES[part] ?? part
}

/** 轻量稳定哈希，用于生成部位/资料指纹 */
export function hash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 部位指纹：该部位在所有轮次的尺寸 + 该部位批注内容的组合 */
export function partFingerprint(sample: Sample, part: string): string {
  const meas = ROUNDS.flatMap((round) =>
    sample.measurements[round]
      .filter((m) => m.key === part)
      .map((m) => `${round}:${m.actual}:${m.spec}:${m.tolerance}`),
  )
  const ann = sample.annotations
    .filter((a) => a.partKey === part || a.part === part)
    .map((a) => `${a.content}:${a.status}`)
  return hash([...meas, ...ann].join('|'))
}

/** 全部部位的指纹快照 */
export function allPartFingerprints(sample: Sample): Record<string, string> {
  const parts = new Set<string>()
  ROUNDS.forEach((round) => sample.measurements[round].forEach((m) => parts.add(m.key)))
  sample.annotations.forEach((a) => parts.add(a.partKey))
  const out: Record<string, string> = {}
  parts.forEach((part) => {
    out[part] = partFingerprint(sample, part)
  })
  return out
}

/** 工艺要求的依赖指纹：所依赖部位指纹的组合 */
export function craftBasedOn(sample: Sample, parts: string[]): string {
  return parts.map((part) => `${part}:${partFingerprint(sample, part)}`).join(',')
}

/** 判定尺寸是否达标 */
export function passResult(m: Measurement): '通过' | '不通过' {
  return Math.abs(m.actual - m.spec) <= m.tolerance ? '通过' : '不通过'
}

/**
 * 失效重算：只把依赖部位指纹发生变化的工艺要求标记为「待重算」，
 * 未受影响的部分保持「有效」继续沿用。
 * 返回被失效的工艺要求 id 列表。
 */
export function refreshCraftRequirements(sample: Sample): string[] {
  const invalidated: string[] = []
  sample.craftRequirements.forEach((cr) => {
    const current = craftBasedOn(sample, cr.parts)
    if (cr.basedOn !== current) {
      cr.status = '待重算'
      invalidated.push(cr.id)
    }
  })
  return invalidated
}

/** 失效重算：只把依赖部位尺寸指纹发生变化的通过标记标记为「待重算」 */
export function refreshPassMarks(sample: Sample, round?: Round): string[] {
  const invalidated: string[] = []
  sample.passMarks.forEach((pm) => {
    if (round && pm.round !== round) return
    const m = sample.measurements[pm.round].find((x) => x.key === pm.part)
    if (!m) return
    const fp = hash(`${pm.round}:${m.actual}:${m.spec}:${m.tolerance}`)
    if (pm.basedOn !== fp) {
      pm.status = '待重算'
      invalidated.push(pm.id)
    }
  })
  return invalidated
}

/** 责任人再确认工艺要求：更新依赖指纹并记录结论 */
export function reconfirmCraft(sample: Sample, craftId: string, note: string, owner: string): CraftRequirement | null {
  const cr = sample.craftRequirements.find((c) => c.id === craftId)
  if (!cr) return null
  cr.status = '有效'
  cr.basedOn = craftBasedOn(sample, cr.parts)
  cr.confirmedAt = new Date().toLocaleString('zh-CN')
  cr.reconfirmNote = note
  sample.revisionEvents.unshift({
    id: `EV-${Date.now()}-${craftId}`,
    at: cr.confirmedAt,
    type: '再确认',
    parts: cr.parts,
    detail: `工艺要求 ${cr.id} 经 ${owner} 再确认，结论：${note}`,
    owner,
  })
  return cr
}

/**
 * 重算通过标记（幂等 upsert）：按 部位+轮次 定位，已存在则更新、不存在才新建，
 * 重试恢复时不会重复生成通过标记。
 */
export function recalcPassMark(sample: Sample, part: string, round: Round, owner: string): PassMark {
  const m = sample.measurements[round].find((x) => x.key === part)
  const now = new Date().toLocaleString('zh-CN')
  if (!m) {
    const existing = sample.passMarks.find((x) => x.part === part && x.round === round)
    if (existing) return existing
    const mark: PassMark = {
      id: `PM-${Date.now()}-${part}-${round}`,
      part,
      round,
      result: '不通过',
      owner,
      status: '待重算',
      basedOn: '',
      confirmedAt: now,
    }
    sample.passMarks.push(mark)
    return mark
  }
  const fp = hash(`${round}:${m.actual}:${m.spec}:${m.tolerance}`)
  let mark = sample.passMarks.find((x) => x.part === part && x.round === round)
  if (mark) {
    mark.result = passResult(m)
    mark.status = '有效'
    mark.basedOn = fp
    mark.confirmedAt = now
    mark.owner = owner
  } else {
    mark = {
      id: `PM-${Date.now()}-${part}-${round}`,
      part,
      round,
      result: passResult(m),
      owner,
      status: '有效',
      basedOn: fp,
      confirmedAt: now,
    }
    sample.passMarks.push(mark)
  }
  return mark
}

/** 批量重算指定部位的通过标记，返回受影响标记数 */
export function recalcPassMarksForParts(sample: Sample, parts: string[], owner: string): number {
  let count = 0
  parts.forEach((part) => {
    ROUNDS.forEach((round) => {
      recalcPassMark(sample, part, round, owner)
      count += 1
    })
  })
  return count
}

/** 对比两个部位指纹快照，返回发生变化的部位及前后值 */
export function diffFingerprints(
  before: Record<string, string>,
  after: Record<string, string>,
  parts: string[],
): Array<{ part: string; before: string; after: string }> {
  return parts
    .filter((part) => before[part] !== after[part])
    .map((part) => ({ part, before: before[part] ?? '', after: after[part] ?? '' }))
}
