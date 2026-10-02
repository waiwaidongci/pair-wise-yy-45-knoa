import { http, HttpResponse } from 'msw'
import { seedSamples } from './seed'
import type {
  Annotation,
  Checkpoint,
  ConflictInfo,
  PartKey,
  Reconfirmation,
  RevisionChange,
  Sample,
} from './types'
import {
  addEvent,
  craftStalePartKeys,
  diffStaleCrafts,
  isCraftStale,
  partName,
  regeneratePassMarks,
  snapshotStaleCraftIds,
  sourceAnnotationVersions,
  sourceSpecVersions,
} from '../features/dependencyChain'

let samples = structuredClone(seedSamples)

const checkpointKey = 'garment-sampling-checkpoints-v1'

const loadCheckpoints = (): Record<string, Checkpoint> => {
  try {
    return JSON.parse(localStorage.getItem(checkpointKey) ?? '{}')
  } catch {
    return {}
  }
}
const saveCheckpoints = (map: Record<string, Checkpoint>) => localStorage.setItem(checkpointKey, JSON.stringify(map))

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
const now = () => new Date().toLocaleString('zh-CN', { hour12: false })

function applySpecChange(sample: Sample, change: Extract<RevisionChange, { kind: 'spec' }>) {
  const measurement = sample.measurements[change.round].find((m) => m.key === change.partKey)
  if (!measurement) return
  // 规格源升版：三轮的该部位源版本统一推进（结论按第三轮判定）
  ;(['第一轮', '第二轮', '第三轮'] as const).forEach((round) => {
    const target = sample.measurements[round].find((m) => m.key === change.partKey)
    if (target) {
      if (round === change.round) target.spec = change.newSpec
      target.sourceVersion += 1
    }
  })
}

function applyAnnotationChange(sample: Sample, change: Extract<RevisionChange, { kind: 'annotation' }>) {
  const annotation = sample.annotations.find((a) => a.id === change.annotationId)
  if (!annotation) return
  annotation.status = '已解决'
  annotation.sourceVersion += 1
  annotation.decidedAt = now()
  annotation.decidedBy = '当前用户'
  annotation.resolution = change.resolution
}

type SubmitBody = {
  batchId: string
  author: string
  baseVersion: number
  changes: RevisionChange[]
  /** 恢复提交时携带，从断点继续 */
  resumeCompleted?: Array<'spec' | 'annotation'>
  /** 演示用：模拟"另一个人先提交了同一套修订" */
  simulateConcurrent?: boolean
  /** 演示用：写入到 passMarks 阶段时失败，留下断点 */
  injectFailure?: boolean
}

function describeChange(change: RevisionChange): string {
  if (change.kind === 'spec') {
    return `${partName(change.partKey)} 规格 ${change.oldSpec} → ${change.newSpec}`
  }
  return `${partName(change.partKey)} 批注关闭：${change.resolution}`
}

/** 先提交者的"同一套修订"：与后提交者撞同一部位，并额外附带一个不冲突部位 */
function competingRevisionFor(sample: Sample, changes: RevisionChange[]): RevisionChange[] {
  const specChange = changes.find((c): c is Extract<RevisionChange, { kind: 'spec' }> => c.kind === 'spec')
  const conflict: RevisionChange[] = specChange
    ? [{
        kind: 'spec',
        partKey: specChange.partKey,
        round: specChange.round,
        oldSpec: specChange.oldSpec,
        newSpec: specChange.newSpec + (specChange.newSpec >= specChange.oldSpec ? 1 : -1),
        note: '先提交版本采用了不同的调整方向。',
      }]
    : changes.map((change) =>
        change.kind === 'annotation'
          ? { ...change, resolution: `${change.resolution}（另一提交者已先行关闭）` }
          : change,
      )
  const ownParts = new Set(changes.map((c) => c.partKey))
  const extraPart = (['length', 'sleeve', 'hem', 'waist'] as PartKey[]).find((key) => !ownParts.has(key))
  if (extraPart && specChange) {
    const m = sample.measurements['第三轮'].find((item) => item.key === extraPart)
    if (m) {
      conflict.push({
        kind: 'spec', partKey: extraPart, round: '第三轮',
        oldSpec: m.spec, newSpec: m.spec + 1, note: '先提交者附带的修订（与你的选择不冲突）。',
      })
    }
  }
  return conflict
}

function commitRevision(sample: Sample, body: SubmitBody, at: string, author: string, note: string, revisionId: string) {
  const beforeStale = snapshotStaleCraftIds(sample)
  const affectedParts = new Set<PartKey>()

  body.changes.forEach((change) => {
    if (change.kind === 'spec') {
      const fromVersion = sourceSpecVersions(sample)[change.partKey] ?? 1
      applySpecChange(sample, change)
      affectedParts.add(change.partKey)
      addEvent(sample, {
        at, type: 'spec-change', partKey: change.partKey,
        title: `${partName(change.partKey)}规格变更（v${fromVersion} → v${fromVersion + 1}）`,
        detail: describeChange(change), owner: author,
      }, () => newId('CE'))
    } else {
      applyAnnotationChange(sample, change)
      affectedParts.add(change.partKey)
      addEvent(sample, {
        at, type: 'annotation', partKey: change.partKey,
        title: `${partName(change.partKey)}批注已关闭`,
        detail: change.resolution, owner: author,
      }, () => newId('CE'))
    }
  })

  // 一处改动只让相关工艺要求失效：比对改动前后的失效集合
  const { newStale } = diffStaleCrafts(beforeStale, sample)
  // 回写工艺状态字段（有效/待重算），保持与版本推导一致
  sample.crafts.forEach((craft) => {
    craft.status = isCraftStale(craft, sample) ? '待重算' : '有效'
  })
  newStale.forEach((craft) => {
    const keys = craftStalePartKeys(craft, sample).map(partName).join('、')
    addEvent(sample, {
      at, type: 'craft-invalidated', craftId: craft.id,
      title: `工艺「${craft.name}」已失效待重算`,
      detail: `依赖部位 ${keys} 的源版本已推进，旧工艺结论不得继续用于开裁。`,
      owner: '系统 / 依赖链',
    }, () => newId('CE'))
  })

  // 样衣结论（通过标记）按受影响部位（尺寸或批注）幂等重算
  const { regeneratedMarks } = regeneratePassMarks(sample, [...affectedParts], at, () => newId('PM'))
  regeneratedMarks.forEach((mark) => {
    addEvent(sample, {
      at, type: 'pass-regenerated', partKey: mark.partKey,
      title: `${partName(mark.partKey)}样衣结论已重算：${mark.result}`,
      detail: `按规格 v${mark.basisSpecVersion} 与最新实测重算，旧通过标记已作废。`,
      owner: '系统 / 依赖链',
    }, () => newId('CE'))
  })

  sample.revision += 1
  sample.revisions.unshift({
    id: revisionId, at, author,
    baseVersion: body.baseVersion,
    note,
    changes: body.changes,
  })
  addEvent(sample, {
    at, type: 'revision-committed',
    title: `修订 ${revisionId} 已提交`,
    detail: `${body.changes.length} 项改动，涉及 ${new Set(body.changes.map((c) => c.partKey)).size} 个部位；未受影响部分继续沿用。`,
    owner: author, revisionId,
  }, () => newId('CE'))
}

export const handlers = [
  http.get('*/api/samples', () => HttpResponse.json(samples)),

  /** 刷新后水合：用本地持久化的依赖链状态对齐 MSW 内存库，保证链版本/断点连续 */
  http.post('*/api/state/hydrate', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { samples?: Sample[] } | null
    if (body && Array.isArray(body.samples) && body.samples.length > 0) {
      samples = body.samples
    }
    return HttpResponse.json({ ok: true })
  }),
  http.get('*/api/samples/:id', ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    return sample ? HttpResponse.json(sample) : new HttpResponse(null, { status: 404 })
  }),

  /** 修订提交：乐观锁（先提交留下）+ 断点（写入失败保留已选部位，恢复重做不重复生成通过标记） */
  http.post('*/api/samples/:id/revisions', async ({ params, request }) => {
    const body = (await request.json()) as SubmitBody
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    const at = now()

    // 恢复提交：失败发生在落库前（work 副本被丢弃），因此从断点重做全部阶段；
    // 通过标记按版本幂等生成，重做不会产生重复标记。
    if (body.resumeCompleted) {
      const checkpoints = loadCheckpoints()
      const checkpoint = checkpoints[body.batchId]
      if (!checkpoint) {
        return HttpResponse.json({ sample, resumed: false }, { status: 200 })
      }
      const revisionId = newId('RV')
      commitRevision(
        sample,
        { ...body, baseVersion: checkpoint.baseVersion, changes: checkpoint.changes },
        at,
        checkpoint.author,
        `从断点恢复提交（${checkpoint.batchId}，失败于 ${checkpoint.failedAt}）。`,
        revisionId,
      )
      addEvent(sample, {
        at, type: 'checkpoint-resumed',
        title: '断点恢复完成',
        detail: '已选部位改动自断点继续重做：spec/annotation 未重复落库，通过标记按版本幂等生成、未重复。',
        owner: checkpoint.author, revisionId,
      }, () => newId('CE'))
      delete checkpoints[body.batchId]
      saveCheckpoints(checkpoints)
      return HttpResponse.json(sample, { status: 201 })
    }

    // 乐观锁：两个人提交同一套修订时，先提交的版本留下
    if (sample.revision !== body.baseVersion || body.simulateConcurrent) {
      if (body.simulateConcurrent) {
        // 演示：把"另一个人"的修订真实落库（先提交者留下）
        const winnerChanges = competingRevisionFor(sample, body.changes)
        const winnerBody: SubmitBody = {
          batchId: newId('BATCH'), author: '周研（另一工位）', baseVersion: body.baseVersion,
          changes: winnerChanges,
        }
        commitRevision(sample, winnerBody, at, winnerBody.author, '模拟并发：另一工位先一步提交同部位修订。', newId('RV'))
      }
      const conflict: ConflictInfo = {
        currentRevision: sample.revision,
        winner: {
          author: sample.revisions[0]?.author ?? '另一提交者',
          at: sample.revisions[0]?.at ?? at,
          note: sample.revisions[0]?.note ?? '',
        },
        conflictChanges: body.changes
          .filter((change) => {
            const theirs = sample.revisions[0]?.changes.find((c) => c.partKey === change.partKey && c.kind === change.kind)
            return Boolean(theirs)
          })
          .map((change) => {
            const theirs = sample.revisions[0]!.changes.find((c) => c.partKey === change.partKey && c.kind === change.kind)!
            return {
              partKey: change.partKey,
              kind: change.kind,
              yours: describeChange(change),
              theirs: describeChange(theirs),
            }
          }),
      }
      addEvent(sample, {
        at, type: 'revision-conflict',
        title: '修订提交冲突（后提交被拒绝）',
        detail: `${body.author} 基于 v${body.baseVersion} 的提交被保留在本地；当前最新为 v${sample.revision}，可查看差异后合并重提。`,
        owner: body.author,
      }, () => newId('CE'))
      return HttpResponse.json({ conflict }, { status: 409 })
    }

    // 正常流水线：spec → annotation → passMarks，可在 passMarks 阶段注入失败
    const work = structuredClone(sample)
    const completed: Array<'spec' | 'annotation'> = []
    let checkpoint: Checkpoint | null = null
    let failure: string | null = null

    try {
      body.changes.forEach((change) => {
        if (change.kind === 'spec') {
          applySpecChange(work, change)
          completed.push('spec')
        }
      })
      body.changes.forEach((change) => {
        if (change.kind === 'annotation') {
          applyAnnotationChange(work, change)
          completed.push('annotation')
        }
      })
      if (body.injectFailure) {
        throw new Error('写入样衣结论（通过标记）时网络中断')
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : '写入失败'
    }

    if (failure) {
      // 写入失败：保留已选部位为断点，spec/annotation 不落库，恢复时从断点重做
      checkpoint = {
        batchId: body.batchId,
        sampleId: sample.id,
        author: body.author,
        baseVersion: body.baseVersion,
        changes: body.changes,
        completed,
        failedAt: at,
        error: failure,
      }
      const map = loadCheckpoints()
      map[body.batchId] = checkpoint
      saveCheckpoints(map)
      return HttpResponse.json({ error: failure, checkpoint }, { status: 500 })
    }

    commitRevision(sample, body, at, body.author, body.changes.map(describeChange).join('；'), newId('RV'))
    return HttpResponse.json(sample, { status: 201 })
  }),

  http.get('*/api/checkpoints', () => HttpResponse.json(loadCheckpoints())),

  /** 责任人再确认：继续沿用（按当前源版本背书）或已更新（basis 推进） */
  http.put('*/api/samples/:id/crafts/:craftId/reconfirm', async ({ params, request }) => {
    const body = (await request.json()) as Reconfirmation
    const sample = samples.find((item) => item.id === params.id)
    const craft = sample?.crafts.find((item) => item.id === params.craftId)
    if (!sample || !craft) return new HttpResponse(null, { status: 404 })
    const specV = sourceSpecVersions(sample)
    const annoV = sourceAnnotationVersions(sample)
    const seenSpec: Reconfirmation['seenSpecVersion'] = {}
    const seenAnno: Reconfirmation['seenAnnotationVersion'] = {}
    craft.dependsOn.forEach((key) => {
      if (specV[key] !== undefined) seenSpec[key] = specV[key]
      if (annoV[key] !== undefined) seenAnno[key] = annoV[key]
    })
    const reconfirmation: Reconfirmation = {
      ...body,
      seenSpecVersion: body.result === '继续沿用' ? seenSpec : undefined,
      seenAnnotationVersion: body.result === '继续沿用' ? seenAnno : undefined,
    }
    craft.reconfirmations.unshift(reconfirmation)
    if (body.result === '已更新') {
      craft.basisSpecVersion = { ...craft.basisSpecVersion, ...seenSpec }
      craft.basisAnnotationVersion = { ...craft.basisAnnotationVersion, ...seenAnno }
    }
    craft.status = '有效'
    addEvent(sample, {
      at: body.at, type: 'craft-reconfirmed', craftId: craft.id,
      title: `工艺「${craft.name}」责任人再确认：${body.result}`,
      detail: body.note, owner: body.by,
    }, () => newId('CE'))
    return HttpResponse.json(sample)
  }),

  http.post('*/api/samples/:id/annotations', async ({ params, request }) => {
    const body = (await request.json()) as { x: number; y: number; part: string; content: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    sample.annotations.push({ id: `AN-${Date.now()}`, author: '当前用户', status: '待处理', sourceVersion: 1, ...body } as Annotation)
    return HttpResponse.json(sample, { status: 201 })
  }),
  http.post('*/api/samples/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { content: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    sample.comments.push({ id: `CM-${Date.now()}`, author: '当前用户', content: body.content, date: '刚刚' })
    return HttpResponse.json(sample, { status: 201 })
  }),
]
