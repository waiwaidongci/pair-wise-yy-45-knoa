import type {
  Annotation,
  ChainEvent,
  CraftItem,
  Measurement,
  PartKey,
  PassMark,
  Sample,
} from '../api/types'

export const partNames: Record<PartKey, string> = {
  chest: '胸围',
  waist: '腰围',
  hem: '下摆围',
  length: '后衣长',
  shoulder: '肩宽',
  sleeve: '袖长',
  collar: '领口',
  placket: '门襟',
  waistline: '腰节',
}

export const partOptions = Object.entries(partNames).map(([key, name]) => ({ key: key as PartKey, name }))

export function partName(key: PartKey) {
  return partNames[key] ?? key
}

/** 以第三轮为当前规格；批注按 partKey 聚合（同部位多条取最高版本） */
export function sourceSpecVersions(sample: Sample): Partial<Record<PartKey, number>> {
  const map: Partial<Record<PartKey, number>> = {}
  sample.measurements['第三轮'].forEach((m) => {
    map[m.key] = m.sourceVersion
  })
  return map
}

export function sourceAnnotationVersions(sample: Sample): Partial<Record<PartKey, number>> {
  const map: Partial<Record<PartKey, number>> = {}
  sample.annotations.forEach((a) => {
    if (!a.partKey) return
    map[a.partKey] = Math.max(map[a.partKey] ?? 0, a.sourceVersion)
  })
  return map
}

export function craftStalePartKeys(craft: CraftItem, sample: Sample): PartKey[] {
  const specV = sourceSpecVersions(sample)
  const annoV = sourceAnnotationVersions(sample)
  // 责任人再确认时所见版本可替代原始 basis（"继续沿用"同样消除过期警告）
  const seenSpec = craft.reconfirmations[0]?.seenSpecVersion
  const seenAnno = craft.reconfirmations[0]?.seenAnnotationVersion
  return craft.dependsOn.filter((key) => {
    const specBasis = seenSpec?.[key] ?? craft.basisSpecVersion[key] ?? 0
    const annoBasis = seenAnno?.[key] ?? craft.basisAnnotationVersion[key]
    const specStale = specV[key] !== undefined && specV[key] !== specBasis
    const annoStale = annoV[key] !== undefined && annoBasis !== undefined && annoV[key] !== annoBasis
    return specStale || annoStale
  })
}

export function isCraftStale(craft: CraftItem, sample: Sample) {
  return craftStalePartKeys(craft, sample).length > 0
}

export function staleCrafts(sample: Sample) {
  return sample.crafts.filter((craft) => isCraftStale(craft, sample))
}

export function annotationVersionFor(sample: Sample, key: PartKey) {
  return sourceAnnotationVersions(sample)[key]
}

export function passMarkFor(sample: Sample, key: PartKey): PassMark | undefined {
  return sample.passMarks.find((mark) => mark.partKey === key)
}

export function isPassMarkStale(mark: PassMark | undefined, sample: Sample, key: PartKey) {
  const currentSpec = sample.measurements['第三轮'].find((m) => m.key === key)?.sourceVersion ?? 1
  if (!mark) return false
  if (mark.basisSpecVersion !== currentSpec) return true
  // 部位存在批注源时，标记必须记录并匹配当前批注版本（含"从无到有"的新批注）
  const annoV = annotationVersionFor(sample, key)
  if (annoV !== undefined && mark.basisAnnotationVersion !== annoV) return true
  return false
}

export function stalePartKeys(sample: Sample): PartKey[] {
  const keys = new Set<PartKey>()
  staleCrafts(sample).forEach((craft) => craftStalePartKeys(craft, sample).forEach((key) => keys.add(key)))
  sample.measurements['第三轮'].forEach((m) => {
    if (isPassMarkStale(passMarkFor(sample, m.key), sample, m.key)) keys.add(m.key)
  })
  return [...keys]
}

export function hasStale(sample: Sample) {
  return stalePartKeys(sample).length > 0
}

/** 样衣结论重算：按最新实测值判定，只重算指定部位；同版本不重复生成（幂等） */
export function regeneratePassMarks(sample: Sample, partKeys: PartKey[], at: string, id: () => string) {
  const specV = sourceSpecVersions(sample)
  const annoV = sourceAnnotationVersions(sample)
  const touched: PassMark[] = []
  const regeneratedMarks: PassMark[] = []
  partKeys.forEach((key) => {
    const m = sample.measurements['第三轮'].find((item) => item.key === key)
    if (!m) return
    const basisSpec = specV[key] ?? 1
    const basisAnno = annoV[key]
    const existing = passMarkFor(sample, key)
    // 已按当前版本（规格 + 批注）生成过的通过标记不重复生成
    if (
      existing &&
      existing.basisSpecVersion === basisSpec &&
      (basisAnno === undefined ? existing.basisAnnotationVersion === undefined : existing.basisAnnotationVersion === basisAnno)
    ) {
      touched.push(existing)
      return
    }
    const result: PassMark['result'] = Math.abs(m.actual - m.spec) <= m.tolerance ? '通过' : '不通过'
    const mark: PassMark = {
      id: id(),
      partKey: key,
      result,
      basisSpecVersion: basisSpec,
      basisAnnotationVersion: annoV[key],
      judgedAt: at,
    }
    if (existing) {
      sample.passMarks = sample.passMarks.map((item) => (item.partKey === key ? mark : item))
    } else {
      sample.passMarks.push(mark)
    }
    regeneratedMarks.push(mark)
    touched.push(mark)
  })
  return { touched, regeneratedMarks }
}

export type StaleDiff = {
  before: Set<string>
  after: Set<string>
  newStale: CraftItem[]
}

export function snapshotStaleCraftIds(sample: Sample) {
  return new Set(staleCrafts(sample).map((craft) => craft.id))
}

export function diffStaleCrafts(before: Set<string>, sample: Sample): StaleDiff {
  const after = snapshotStaleCraftIds(sample)
  const newStale = sample.crafts.filter((craft) => after.has(craft.id) && !before.has(craft.id))
  return { before, after, newStale }
}

export function addEvent(sample: Sample, event: Omit<ChainEvent, 'id'> & { id?: string }, id: () => string) {
  const full: ChainEvent = { id: event.id ?? id(), ...event }
  sample.chainEvents.unshift(full)
  return full
}

export function measurementByKey(measurements: Measurement[], key: PartKey) {
  return measurements.find((m) => m.key === key)
}

export function annotationsForPart(annotations: Annotation[], key: PartKey) {
  return annotations.filter((a) => a.partKey === key)
}
