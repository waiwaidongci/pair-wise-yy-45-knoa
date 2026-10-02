import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { seedSamples } from '../api/seed'
import type { Checkpoint, RevisionChange, Sample } from '../api/types'

type Decision = { proposalId: string; decision: '已采纳' | '未采纳'; reason: string; decidedAt: string }

type StagedRevision = {
  changes: RevisionChange[]
  /** 提交时基于的依赖链版本，冲突后保留用于合并 */
  baseVersion: number
}

type DevelopmentState = {
  schemaVersion: 3
  samples: Sample[]
  selectedId: string
  roundA: '第一轮' | '第二轮' | '第三轮'
  roundB: '第一轮' | '第二轮' | '第三轮'
  decisions: Decision[]
  draftNotes: Record<string, string>
  locked: boolean
  activeAnnotation: string | null
  /** 每个样衣暂存中的修订（已选部位），写入失败/刷新后仍保留 */
  staged: Record<string, StagedRevision>
  /** 断点：batchId -> checkpoint */
  checkpoints: Record<string, Checkpoint>
}

const storageKey = 'garment-sampling-draft-v3'
const saved = localStorage.getItem(storageKey)

const initialState: DevelopmentState = saved
  ? (() => {
      try {
        const parsed = JSON.parse(saved) as Partial<DevelopmentState>
        if (parsed.schemaVersion !== 3 || !Array.isArray(parsed.samples)) throw new Error('schema mismatch')
        return {
          schemaVersion: 3 as const,
          samples: parsed.samples,
          selectedId: parsed.selectedId ?? seedSamples[0].id,
          roundA: parsed.roundA ?? '第二轮',
          roundB: parsed.roundB ?? '第三轮',
          decisions: parsed.decisions ?? [],
          draftNotes: parsed.draftNotes ?? {},
          locked: parsed.locked ?? false,
          activeAnnotation: null,
          staged: parsed.staged ?? {},
          checkpoints: parsed.checkpoints ?? {},
        }
      } catch {
        localStorage.removeItem(storageKey)
      }
    })() ?? {
      schemaVersion: 3 as const,
      samples: structuredClone(seedSamples),
      selectedId: seedSamples[0].id,
      roundA: '第二轮',
      roundB: '第三轮',
      decisions: [],
      draftNotes: {},
      locked: false,
      activeAnnotation: null,
      staged: {},
      checkpoints: {},
    }
  : {
      schemaVersion: 3 as const,
      samples: structuredClone(seedSamples),
      selectedId: seedSamples[0].id,
      roundA: '第二轮',
      roundB: '第三轮',
      decisions: [],
      draftNotes: {},
      locked: false,
      activeAnnotation: null,
      staged: {},
      checkpoints: {},
    }

function upsertChange(list: RevisionChange[], change: RevisionChange): RevisionChange[] {
  const without = list.filter(
    (item) => !(item.kind === change.kind && item.partKey === change.partKey &&
      ((item.kind === 'spec' && change.kind === 'spec' && item.round === change.round) ||
        (item.kind === 'annotation' && change.kind === 'annotation' &&
          item.annotationId === change.annotationId))),
  )
  return [...without, change]
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
    addAnnotationLocal(state, action: PayloadAction<{ sampleId: string; annotation: Sample['annotations'][number] }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      sample?.annotations.push(action.payload.annotation)
    },
    /** 暂存一个部位修订（已选部位在提交失败、冲突、刷新后保留） */
    stageChange(state, action: PayloadAction<{ sampleId: string; change: RevisionChange }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      if (!sample) return
      const current = state.staged[sample.id] ?? { changes: [], baseVersion: sample.revision }
      state.staged[sample.id] = {
        changes: upsertChange(current.changes, action.payload.change),
        baseVersion: current.baseVersion,
      }
    },
    unstageChange(state, action: PayloadAction<{ sampleId: string; change: RevisionChange }>) {
      const staged = state.staged[action.payload.sampleId]
      if (!staged) return
      const { change } = action.payload
      staged.changes = staged.changes.filter(
        (item) => !(item.kind === change.kind && item.partKey === change.partKey &&
          ((item.kind === 'spec' && change.kind === 'spec' && item.round === change.round) ||
            (item.kind === 'annotation' && change.kind === 'annotation' &&
              item.annotationId === change.annotationId))),
      )
      if (staged.changes.length === 0) delete state.staged[action.payload.sampleId]
    },
    /** 冲突合并后重设基础版本（先提交者版本留下，后提交者按新版本重提） */
    rebaseStaged(state, action: PayloadAction<{ sampleId: string; baseVersion: number }>) {
      const staged = state.staged[action.payload.sampleId]
      if (staged) staged.baseVersion = action.payload.baseVersion
    },
    clearStaged(state, action: PayloadAction<string>) {
      delete state.staged[action.payload]
    },
    setCheckpoint(state, action: PayloadAction<Checkpoint>) {
      state.checkpoints[action.payload.batchId] = action.payload
    },
    clearCheckpoint(state, action: PayloadAction<string>) {
      delete state.checkpoints[action.payload]
    },
    /** 用服务端结果整包替换样衣，保持依赖链为单一事实来源 */
    applyServerSample(state, action: PayloadAction<Sample>) {
      const index = state.samples.findIndex((item) => item.id === action.payload.id)
      if (index >= 0) state.samples[index] = action.payload
      else state.samples.push(action.payload)
      if (state.staged[action.payload.id]?.baseVersion !== undefined && state.staged[action.payload.id].changes.length === 0) {
        delete state.staged[action.payload.id]
      }
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
  },
})

export const {
  selectSample,
  setRounds,
  decideProposal,
  saveDraft,
  toggleAnnotation,
  addAnnotationLocal,
  stageChange,
  unstageChange,
  rebaseStaged,
  clearStaged,
  setCheckpoint,
  clearCheckpoint,
  applyServerSample,
  lockReview,
  unlockReview,
} = slice.actions
export const developmentReducer = slice.reducer
