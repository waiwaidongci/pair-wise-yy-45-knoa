import { http, HttpResponse } from 'msw'
import { seedSamples } from './seed'
import type { RevisionRequestBody, RevisionResult, Sample, WriteJournal } from './types'
import {
  allPartFingerprints,
  diffFingerprints,
  recalcPassMarksForParts,
  refreshCraftRequirements,
  refreshPassMarks,
} from '../domain/dependency'

let samples = structuredClone(seedSamples)
const journals = new Map<string, WriteJournal>()

const STEP_DEFS = [
  { key: 'measurements', label: '应用部位尺寸变更' },
  { key: 'invalidate', label: '失效相关工艺要求与通过标记' },
  { key: 'passmarks', label: '重算通过标记（幂等）' },
  { key: 'finalize', label: '提交版本并记录履历' },
] as const

function now() {
  return new Date().toLocaleString('zh-CN')
}

function applyCollaboratorChange(sample: Sample, parts: string[]) {
  // 模拟另一位协作者抢先提交了同一套修订：把选中部位的第三轮实测上调 0.5cm
  parts.forEach((part) => {
    const m = sample.measurements['第三轮'].find((x) => x.key === part)
    if (m) m.actual = Math.round((m.actual + 0.5) * 10) / 10
  })
  sample.version += 1
  sample.revisionEvents.unshift({
    id: `EV-${Date.now()}-col`,
    at: now(),
    type: '冲突',
    parts,
    detail: '协作者抢先提交了同一部位的修订，版本已先行更新。',
    owner: '协作者 · 远程修订',
  })
}

/** 按断点续作：已完成的步骤跳过，从第一个待办步骤继续 */
function runJournal(sample: Sample, journal: WriteJournal, body: RevisionRequestBody, failAt: string | null): RevisionResult {
  for (const step of journal.steps) {
    if (step.status === 'done') continue
    if (failAt === step.key) {
      journal.status = '失败'
      journal.error = `模拟写入失败：步骤「${step.label}」未完成，已保留 ${journal.selectedParts.length} 个已选部位。`
      journal.updatedAt = now()
      return { ok: false, reason: 'write_failed', journal }
    }
    if (step.key === 'measurements') {
      body.changes.measurements.forEach((c) => {
        const m = sample.measurements[c.round]?.find((x) => x.key === c.part)
        if (m) m.actual = c.actual
      })
    } else if (step.key === 'invalidate') {
      refreshCraftRequirements(sample)
      refreshPassMarks(sample)
    } else if (step.key === 'passmarks') {
      recalcPassMarksForParts(sample, journal.selectedParts, '当前用户')
    } else if (step.key === 'finalize') {
      sample.version += 1
      sample.revisionEvents.unshift({
        id: `EV-${Date.now()}-fin`,
        at: now(),
        type: '提交',
        parts: journal.selectedParts,
        detail: `修订已提交至版本 v${sample.version}，${journal.selectedParts.length} 个部位的工艺要求与通过标记已按依赖链失效重算。`,
        owner: '当前用户',
      })
    }
    step.status = 'done'
  }
  journal.status = '完成'
  journal.updatedAt = now()
  return { ok: true, sample: structuredClone(sample), version: sample.version, journalId: journal.id }
}

export const handlers = [
  http.get('/api/samples', () => HttpResponse.json(samples)),
  http.get('/api/samples/:id', ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    return sample ? HttpResponse.json(sample) : new HttpResponse(null, { status: 404 })
  }),
  http.post('/api/samples/:id/annotations', async ({ params, request }) => {
    const body = (await request.json()) as { x: number; y: number; part: string; partKey: string; content: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    sample.annotations.push({ id: `AN-${Date.now()}`, author: '当前用户', status: '待处理', ...body })
    // 批注作为部位来源，加入依赖链失效重算
    refreshCraftRequirements(sample)
    return HttpResponse.json(sample, { status: 201 })
  }),
  http.post('/api/samples/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { content: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    sample.comments.push({ id: `CM-${Date.now()}`, author: '当前用户', content: body.content, date: '刚刚' })
    return HttpResponse.json(sample, { status: 201 })
  }),

  // 提交修订：乐观并发控制，先提交的版本留下，后提交者看到被改部位与差异
  http.post('/api/samples/:id/revisions', async ({ params, request }) => {
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    const body = (await request.json()) as RevisionRequestBody
    const simulateCollaborator = request.headers.get('x-simulate-collaborator') === '1'
    const failAt = request.headers.get('x-inject-failure')

    // 模拟协作者抢先提交：先记录差异前快照，再应用其变更
    if (simulateCollaborator) {
      const before = allPartFingerprints(sample)
      applyCollaboratorChange(sample, body.selectedParts)
      const after = allPartFingerprints(sample)
      const changedParts = diffFingerprints(before, after, body.selectedParts)
      sample.revisionEvents.unshift({
        id: `EV-${Date.now()}-conflict`,
        at: now(),
        type: '冲突',
        parts: body.selectedParts,
        detail: `与协作者的修订冲突：${changedParts.map((c) => c.part).join('、')} 已被先行修改，后提交版本未生效。`,
        owner: '当前用户',
      })
      return HttpResponse.json(
        {
          ok: false,
          reason: 'conflict',
          conflict: {
            at: now(),
            winner: '协作者远程修订',
            winnerOwner: '协作者',
            baseVersion: body.baseVersion,
            currentVersion: sample.version,
            changedParts,
          },
        } satisfies RevisionResult,
        { status: 409 },
      )
    }

    if (body.baseVersion !== sample.version) {
      const current = allPartFingerprints(sample)
      const changedParts = diffFingerprints(
        Object.fromEntries(body.selectedParts.map((p) => [p, ''])),
        current,
        body.selectedParts,
      ).map((c) => ({ ...c, before: c.before || `v${body.baseVersion} 基准` }))
      return HttpResponse.json(
        {
          ok: false,
          reason: 'conflict',
          conflict: {
            at: now(),
            winner: '已有更新的版本',
            winnerOwner: '其他协作者',
            baseVersion: body.baseVersion,
            currentVersion: sample.version,
            changedParts,
          },
        } satisfies RevisionResult,
        { status: 409 },
      )
    }

    const journalId = `J-${Date.now()}`
    const journal: WriteJournal = {
      id: journalId,
      sampleId: sample.id,
      selectedParts: body.selectedParts,
      baseVersion: body.baseVersion,
      body,
      steps: STEP_DEFS.map((s) => ({ ...s, status: 'pending' as const })),
      status: '进行中',
      error: '',
      updatedAt: now(),
    }
    journals.set(journalId, journal)
    const result = runJournal(sample, journal, body, failAt)
    if (!result.ok) {
      return HttpResponse.json(result satisfies RevisionResult, { status: 500 })
    }
    journals.delete(journalId)
    return HttpResponse.json(result satisfies RevisionResult, { status: 200 })
  }),

  // 断点续作：从日志恢复，已完成步骤跳过，通过标记幂等不重复
  http.post('/api/samples/:id/revisions/:journalId/retry', async ({ params, request }) => {
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    const journal = journals.get(params.journalId as string)
    if (!journal || journal.sampleId !== sample.id) {
      return HttpResponse.json({ ok: false, reason: 'write_failed', journal: null }, { status: 404 })
    }
    const body = (await request.json().catch(() => ({}))) as Partial<RevisionRequestBody>
    const failAt = request.headers.get('x-inject-failure')
    // 断点续作使用日志中保存的原始请求体，确保未完成的尺寸变更步骤能补做
    const fullBody: RevisionRequestBody = {
      ...journal.body,
      changes: body.changes ?? journal.body.changes,
      note: body.note ?? journal.body.note,
    }
    const result = runJournal(sample, journal, fullBody, failAt)
    if (!result.ok) {
      return HttpResponse.json(result satisfies RevisionResult, { status: 500 })
    }
    journals.delete(journal.id)
    return HttpResponse.json(result satisfies RevisionResult, { status: 200 })
  }),
]
