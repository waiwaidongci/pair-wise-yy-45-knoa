import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { seedSamples } from '../api/seed'
import type { Annotation, ConflictInfo, Sample, WriteJournal } from '../api/types'
import { recalcPassMark, recalcPassMarksForParts, reconfirmCraft as reconfirmCraftDomain, refreshCraftRequirements, refreshPassMarks } from '../domain/dependency'

type Decision = { proposalId: string; decision: '已采纳' | '未采纳'; reason: string; decidedAt: string }

type DevelopmentState = {
  samples: Sample[]
  selectedId: string
  roundA: '第一轮' | '第二轮' | '第三轮'
  roundB: '第一轮' | '第二轮' | '第三轮'
  decisions: Decision[]
  draftNotes: Record<string, string>
  locked: boolean
  activeAnnotation: string | null
  /** 并发冲突：后提交者看到的被改部位与差异 */
  conflict: ConflictInfo | null
  /** 写入失败的日志，按 journalId 保存，用于断点续作 */
  journals: Record<string, WriteJournal>
}

const storageKey = 'garment-sampling-draft-v2'
const saved = localStorage.getItem(storageKey)

const initialState: DevelopmentState = saved
  ? JSON.parse(saved)
  : {
      samples: structuredClone(seedSamples),
      selectedId: seedSamples[0].id,
      roundA: '第二轮',
      roundB: '第三轮',
      decisions: [],
      draftNotes: {},
      locked: false,
      activeAnnotation: null,
      conflict: null,
      journals: {},
    }

const slice = createSlice({
  name: 'development',
  initialState,
  reducers: {
    selectSample(state, action: PayloadAction<string>) {
      state.selectedId = action.payload
      state.activeAnnotation = null
    },
    setRounds(state, action: PayloadAction<{ a?: DevelopmentState['roundA']; b?: DevelopmentState['roundB'] }>) {
      if (action.payload.a) state.roundA = action.payload.a
      if (action.payload.b) state.roundB = action.payload.b
    },
    decideProposal(state, action: PayloadAction<Decision>) {
      const sample = state.samples.find((item) => item.id === state.selectedId)
      if (!sample || state.locked) return
      state.decisions.push(action.payload)
      const proposal = sample.proposals.find((item) => item.id === action.payload.proposalId)
      if (proposal) proposal.status = action.payload.decision
    },
    saveDraft(state, action: PayloadAction<{ sampleId: string; notes: string }>) {
      state.draftNotes[action.payload.sampleId] = action.payload.notes
    },
    toggleAnnotation(state, action: PayloadAction<string | null>) {
      state.activeAnnotation = action.payload
    },
    resolveAnnotation(state, action: PayloadAction<{ sampleId: string; annotationId: string }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      const annotation = sample?.annotations.find((item) => item.id === action.payload.annotationId)
      if (annotation) {
        annotation.status = annotation.status === '待处理' ? '已解决' : '待处理'
        // 批注状态变化也会改变部位指纹，触发依赖链失效重算
        if (sample) refreshCraftRequirements(sample)
      }
    },
    addAnnotation(state, action: PayloadAction<{ sampleId: string; annotation: Omit<Annotation, 'id' | 'author' | 'status'> }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      if (!sample || state.locked) return
      sample.annotations.push({
        id: `AN-${Date.now()}`,
        author: '当前用户',
        status: '待处理',
        ...action.payload.annotation,
      })
      refreshCraftRequirements(sample)
      sample.revisionEvents.unshift({
        id: `EV-${Date.now()}-ann`,
        at: new Date().toLocaleString('zh-CN'),
        type: '失效',
        parts: [action.payload.annotation.partKey],
        detail: `新增「${action.payload.annotation.part}」批注，依赖该部位的工艺要求已标记待重算。`,
        owner: '当前用户',
      })
    },
    lockReview(state) {
      const sample = state.samples.find((item) => item.id === state.selectedId)
      if (!sample) return
      sample.status = '已锁定'
      sample.proposals.forEach((proposal) => {
        if (proposal.status === '待决定') proposal.status = '未采纳'
      })
      state.locked = true
    },
    unlockReview(state) {
      const sample = state.samples.find((item) => item.id === state.selectedId)
      if (sample) sample.status = '待审核'
      state.locked = false
    },

    // —— 依赖链与并发/恢复 ——

    /** 修订提交成功：用服务端版本替换本地样例，并清理冲突与已完成日志 */
    revisionApplied(state, action: PayloadAction<Sample>) {
      const index = state.samples.findIndex((item) => item.id === action.payload.id)
      if (index >= 0) state.samples[index] = action.payload
      state.conflict = null
      Object.values(state.journals).forEach((j) => {
        if (j.sampleId === action.payload.id && j.status === '完成') delete state.journals[j.id]
      })
    },
    conflictDetected(state, action: PayloadAction<ConflictInfo>) {
      state.conflict = action.payload
      // 后提交者承认服务端最新版本，本地版本号同步到当前，便于基于最新版本重新提交
      const sample = state.samples.find((item) => item.id === state.selectedId)
      if (sample) sample.version = action.payload.currentVersion
    },
    dismissConflict(state) {
      state.conflict = null
    },
    writeFailed(state, action: PayloadAction<WriteJournal>) {
      state.journals[action.payload.id] = action.payload
    },
    journalUpdated(state, action: PayloadAction<WriteJournal>) {
      state.journals[action.payload.id] = action.payload
    },
    dismissJournal(state, action: PayloadAction<string>) {
      delete state.journals[action.payload]
    },
    /** 责任人再确认工艺要求 */
    reconfirmCraft(state, action: PayloadAction<{ sampleId: string; craftId: string; note: string }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      if (!sample) return
      reconfirmCraftDomain(sample, action.payload.craftId, action.payload.note, sample.owner)
    },
    /** 重算通过标记：可指定部位，否则重算所有待重算项 */
    recalcPassMarks(state, action: PayloadAction<{ sampleId: string; part?: string }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      if (!sample) return
      if (action.payload.part) {
        ;(['第一轮', '第二轮', '第三轮'] as const).forEach((round) => recalcPassMark(sample, action.payload.part!, round, sample.owner))
      } else {
        const stale = sample.passMarks.filter((pm) => pm.status === '待重算')
        const parts = Array.from(new Set(stale.map((pm) => pm.part)))
        recalcPassMarksForParts(sample, parts, sample.owner)
      }
      sample.revisionEvents.unshift({
        id: `EV-${Date.now()}-pm`,
        at: new Date().toLocaleString('zh-CN'),
        type: '重算',
        parts: action.payload.part ? [action.payload.part] : Array.from(new Set(sample.passMarks.filter((pm) => pm.status === '有效').map((pm) => pm.part))),
        detail: action.payload.part
          ? `已重算「${action.payload.part}」通过标记，未受影响部位继续沿用原标记。`
          : '已按依赖链重算所有待重算通过标记，未受影响部位继续沿用。',
        owner: sample.owner,
      })
    },
    /** 部位尺寸变更后手动触发依赖链失效重算（用于本地预演） */
    invalidateDependents(state, action: PayloadAction<{ sampleId: string }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      if (!sample) return
      const craftIds = refreshCraftRequirements(sample)
      const markIds = refreshPassMarks(sample)
      if (craftIds.length || markIds.length) {
        sample.revisionEvents.unshift({
          id: `EV-${Date.now()}-inv`,
          at: new Date().toLocaleString('zh-CN'),
          type: '失效',
          parts: Array.from(new Set([...craftIds, ...markIds])),
          detail: `依赖链失效重算：${craftIds.length} 项工艺要求、${markIds.length} 项通过标记已标记待重算，未受影响部分继续有效。`,
          owner: sample.owner,
        })
      }
    },
  },
})

export const {
  selectSample,
  setRounds,
  decideProposal,
  saveDraft,
  toggleAnnotation,
  resolveAnnotation,
  addAnnotation,
  lockReview,
  unlockReview,
  revisionApplied,
  conflictDetected,
  dismissConflict,
  writeFailed,
  journalUpdated,
  dismissJournal,
  reconfirmCraft,
  recalcPassMarks,
  invalidateDependents,
} = slice.actions
export const developmentReducer = slice.reducer
