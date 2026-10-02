import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import ResumeOutlinedIcon from '@mui/icons-material/PlayCircleOutlineOutlined'
import MergeOutlinedIcon from '@mui/icons-material/MergeOutlined'
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined'
import type { ConflictInfo, PartKey, RevisionChange, Sample } from '../api/types'
import { partName, partOptions, sourceAnnotationVersions, sourceSpecVersions } from './dependencyChain'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import {
  applyServerSample,
  clearCheckpoint,
  clearStaged,
  rebaseStaged,
  setCheckpoint,
  stageChange,
  unstageChange,
} from './developmentSlice'
import { samplingApi } from '../app/api'

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'conflict'; conflict: ConflictInfo }
  | { phase: 'failed'; error: string; batchId: string; completed: Array<'spec' | 'annotation'> }
  | { phase: 'resuming' }
  | { phase: 'done'; revisionId?: string }

function changeLabel(change: RevisionChange): string {
  if (change.kind === 'spec') {
    return `${partName(change.partKey)} 规格 ${change.oldSpec} → ${change.newSpec} cm`
  }
  return `${partName(change.partKey)} 批注关闭`
}

export default function RevisionPanel({ sample }: { sample: Sample }) {
  const dispatch = useAppDispatch()
  const staged = useAppSelector((s) => s.development.staged[sample.id])
  const savedCheckpoint = useAppSelector((s) => {
    const all = s.development.checkpoints
    return Object.values(all).find((cp) => cp.sampleId === sample.id)
  })

  const [author, setAuthor] = useState('沈岚')
  const [specOpen, setSpecOpen] = useState(false)
  const [annoOpen, setAnnoOpen] = useState(false)
  const [simulateConcurrent, setSimulateConcurrent] = useState(false)
  const [injectFailure, setInjectFailure] = useState(false)
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: 'idle' })

  // 规格新决定表单
  const [specPart, setSpecPart] = useState<PartKey>('chest')
  const [specNew, setSpecNew] = useState<string>('')
  const [specNote, setSpecNote] = useState('')

  // 批注新决定表单
  const openAnnotations = sample.annotations.filter((a) => a.status === '待处理')
  const [annoId, setAnnoId] = useState('')
  const [annoResolution, setAnnoResolution] = useState('')

  const activeCheckpoint = submitState.phase === 'failed'
    ? { batchId: submitState.batchId, completed: submitState.completed }
    : savedCheckpoint
      ? { batchId: savedCheckpoint.batchId, completed: savedCheckpoint.completed }
      : null

  const specV = useMemo(() => sourceSpecVersions(sample), [sample])
  const annoV = useMemo(() => sourceAnnotationVersions(sample), [sample])

  const currentMeasurement = sample.measurements['第三轮'].find((m) => m.key === specPart)

  const addSpecChange = () => {
    if (!currentMeasurement) return
    const value = Number(specNew)
    if (!Number.isFinite(value) || value === currentMeasurement.spec) return
    const change: RevisionChange = {
      kind: 'spec',
      partKey: specPart,
      round: '第三轮',
      oldSpec: currentMeasurement.spec,
      newSpec: value,
      note: specNote || '部位尺寸新决定',
    }
    dispatch(stageChange({ sampleId: sample.id, change }))
    setSpecOpen(false)
    setSpecNew('')
    setSpecNote('')
  }

  const addAnnotationChange = () => {
    const annotation = sample.annotations.find((a) => a.id === annoId)
    if (!annotation || !annotation.partKey || !annoResolution.trim()) return
    const change: RevisionChange = {
      kind: 'annotation',
      partKey: annotation.partKey,
      annotationId: annotation.id,
      action: 'resolve',
      resolution: annoResolution,
      note: '批注新决定',
    }
    dispatch(stageChange({ sampleId: sample.id, change }))
    setAnnoOpen(false)
    setAnnoId('')
    setAnnoResolution('')
  }

  // 冲突差异：把后提交者被拒的改动与先提交版本逐部位对比
  const conflictRows = submitState.phase === 'conflict'
    ? submitState.conflict.conflictChanges
    : []

  const runSubmit = async (changes: RevisionChange[], baseVersion: number, options: { concurrent: boolean; fail: boolean; resume?: Array<'spec' | 'annotation'>; batchId?: string }) => {
    const batchId = options.batchId ?? `BATCH-${Date.now().toString(36)}`
    setSubmitState(options.resume ? { phase: 'resuming' } : { phase: 'submitting' })
    try {
      const payload = options.resume
        ? {
            sampleId: sample.id, batchId, author, baseVersion, changes,
            resumeCompleted: options.resume,
          }
        : {
            sampleId: sample.id, batchId, author, baseVersion, changes,
            simulateConcurrent: options.concurrent, injectFailure: options.fail,
          }
      // 直接走 fetch 以便读取 409/500 的 JSON 错误体
      const res = await fetch(`/api/samples/${sample.id}/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (res.status === 201 || res.status === 200) {
        dispatch(applyServerSample(json as Sample))
        dispatch(clearStaged(sample.id))
        dispatch(clearCheckpoint(batchId))
        setSubmitState({ phase: 'done' })
        // 刷新 RTK Query 缓存
        dispatch(samplingApi.util.invalidateTags([{ type: 'Sample', id: sample.id }, 'Samples']))
        return
      }
      if (res.status === 409) {
        // 先提交者的改动已经落库：同步最新样衣，但保留本地已选部位
        const fresh = await fetch(`/api/samples/${sample.id}`).then((r) => r.json()) as Sample
        dispatch(applyServerSample(fresh))
        dispatch(rebaseStaged({ sampleId: sample.id, baseVersion: fresh.revision }))
        setSubmitState({ phase: 'conflict', conflict: json.conflict as ConflictInfo })
        return
      }
      if (res.status >= 500) {
        const cp = json.checkpoint
        if (cp) {
          dispatch(setCheckpoint(cp))
        }
        setSubmitState({
          phase: 'failed',
          error: json.error ?? '写入失败',
          batchId: cp?.batchId ?? batchId,
          completed: cp?.completed ?? [],
        })
        return
      }
    } catch (error) {
      setSubmitState({ phase: 'failed', error: error instanceof Error ? error.message : '网络错误', batchId, completed: [] })
    }
  }

  const submit = () => {
    if (!staged || staged.changes.length === 0) return
    void runSubmit(staged.changes, staged.baseVersion, { concurrent: simulateConcurrent, fail: injectFailure })
  }

  // 冲突后合并重提：冲突部位默认采用先提交版本（去掉本地改动），非冲突改动保留
  const [mergeChoice, setMergeChoice] = useState<Record<string, 'keepMine' | 'takeTheirs'>>({})
  const mergeAndSubmit = () => {
    if (submitState.phase !== 'conflict' || !staged) return
    const conflictKeys = new Set(conflictRows.map((row) => `${row.kind}:${row.partKey}`))
    const retained = staged.changes.filter((change) => {
      const key = `${change.kind}:${change.partKey}`
      if (!conflictKeys.has(key)) return true
      return mergeChoice[key] === 'keepMine'
    })
    if (retained.length === 0) {
      dispatch(clearStaged(sample.id))
      setSubmitState({ phase: 'done' })
      return
    }
    dispatch(clearStaged(sample.id))
    retained.forEach((change) => dispatch(stageChange({ sampleId: sample.id, change })))
    void runSubmit(retained, submitState.conflict.currentRevision, { concurrent: false, fail: false })
  }

  const resume = () => {
    if (!activeCheckpoint) return
    const changes = savedCheckpoint?.changes ?? staged?.changes ?? []
    const baseVersion = savedCheckpoint?.baseVersion ?? staged?.baseVersion ?? sample.revision
    if (changes.length === 0) return
    void runSubmit(changes, baseVersion, {
      concurrent: false, fail: false,
      resume: activeCheckpoint.completed,
      batchId: activeCheckpoint.batchId,
    })
  }

  // 恢复场景下暂存可能来自持久化（刷新页面后），用断点中的 changes
  const resumeChanges = savedCheckpoint?.changes ?? staged?.changes ?? []
  const steps = [
    { key: 'select', label: '选择部位' },
    { key: 'submit', label: '写入尺寸/批注' },
    { key: 'pass', label: '重算通过标记' },
    { key: 'done', label: '完成' },
  ]
  const activeStep =
    submitState.phase === 'submitting' ? 1
      : submitState.phase === 'failed' ? 2
      : submitState.phase === 'resuming' ? 2
      : submitState.phase === 'done' ? 3
      : 0

  return (
    <Box className="panel">
      <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <LinkOutlinedIcon color="primary" />
          <Typography fontWeight={800}>部位修订依赖链 · 提交</Typography>
          <Chip size="small" variant="outlined" label={`链版本 v${sample.revision}`} />
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={() => { setAnnoId(openAnnotations[0]?.id ?? ''); setAnnoOpen(true) }} disabled={openAnnotations.length === 0}>
            批注新决定（{openAnnotations.length}）
          </Button>
          <Button size="small" variant="outlined" onClick={() => { setSpecPart('chest'); setSpecOpen(true) }}>
            尺寸新决定
          </Button>
        </Stack>
      </Box>

      <Box sx={{ p: 2 }}>
        <Typography fontSize={12} color="text.secondary" mb={1}>
          链方向：尺寸/批注源（部位版本）→ 工艺要求（依赖部位）→ 样衣结论（逐部位通过标记）。一处改动只让相关下游失效重算，未受影响部分继续沿用。
        </Typography>

        {/* 当前各部位源版本 */}
        <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap mb={1.5}>
          {partOptions.map(({ key, name }) => {
            const hasAnno = annoV[key] !== undefined
            return (
              <Tooltip key={key} title={`规格源 v${specV[key] ?? 1}${hasAnno ? ` · 批注源 v${annoV[key]}` : ''}`}>
                <Chip size="small" variant="outlined" label={`${name} v${specV[key] ?? 1}${hasAnno ? `+批${annoV[key]}` : ''}`} />
              </Tooltip>
            )
          })}
        </Stack>

        <Divider sx={{ mb: 1.5 }} />

        {/* 已选部位（暂存，失败/冲突/刷新后保留） */}
        <Typography fontWeight={800} fontSize={12.5} mb={0.8}>
          本次修订已选部位（{staged?.changes.length ?? 0}）<Typography component="span" color="text.secondary" fontWeight={400} fontSize={11}>　基于 v{staged?.baseVersion ?? sample.revision}</Typography>
        </Typography>
        {(!staged || staged.changes.length === 0) ? (
          <Box sx={{ p: 1.4, border: '1px dashed #d3cfc8', borderRadius: 1, fontSize: 12, color: '#8a837d' }}>
            尚未选择部位。点击右上角"尺寸新决定/批注新决定"，把改动挂到依赖链上。
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f6f5f2' }}>
                <TableCell>类型</TableCell>
                <TableCell>部位与差异</TableCell>
                <TableCell>说明</TableCell>
                <TableCell width={48} />
              </TableRow>
            </TableHead>
            <TableBody>
              {staged.changes.map((change) => (
                <TableRow key={`${change.kind}-${change.partKey}`}>
                  <TableCell>
                    <Chip size="small" label={change.kind === 'spec' ? '尺寸' : '批注'} color={change.kind === 'spec' ? 'primary' : 'secondary'} variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ fontSize: 12.5, fontWeight: 700 }}>{changeLabel(change)}</TableCell>
                  <TableCell sx={{ fontSize: 11.5, color: 'text.secondary' }}>{change.note}</TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => dispatch(unstageChange({ sampleId: sample.id, change }))}>
                      <DeleteOutlineOutlinedIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* 提交控制：演示开关 + 流水线状态 */}
        <Box sx={{ mt: 1.6, p: 1.4, bgcolor: '#f7f6f3', borderRadius: 1 }}>
          <Stepper activeStep={activeStep} sx={{ mb: 1.2 }}>
            {steps.map((step) => (
              <Step key={step.key}><StepLabel><Typography fontSize={11}>{step.label}</Typography></StepLabel></Step>
            ))}
          </Stepper>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <FormControlLabel
              control={<Switch size="small" checked={simulateConcurrent} onChange={(e) => setSimulateConcurrent(e.target.checked)} />}
              label={<Typography fontSize={12}>模拟两人同交（另一工位先提交）</Typography>}
            />
            <FormControlLabel
              control={<Switch size="small" checked={injectFailure} onChange={(e) => setInjectFailure(e.target.checked)} />}
              label={<Typography fontSize={12}>模拟写入失败（留下断点）</Typography>}
            />
            <TextField size="small" sx={{ ml: 'auto', width: 130 }} label="提交人" value={author} onChange={(e) => setAuthor(e.target.value)} />
            <Button variant="contained" startIcon={<SendOutlinedIcon />} disabled={!staged || staged.changes.length === 0} onClick={submit}>
              提交修订
            </Button>
          </Stack>
        </Box>

        {submitState.phase === 'conflict' && (
          <Alert severity="error" sx={{ mt: 1.5 }} action={
            <Button color="inherit" size="small" startIcon={<MergeOutlinedIcon />} onClick={mergeAndSubmit}>按选择合并后重提</Button>
          }>
            <Typography fontWeight={800} fontSize={12.5}>提交被拒绝：{submitState.conflict.winner.author} 已先提交（{submitState.conflict.winner.at}），链版本推进至 v{submitState.conflict.currentRevision}</Typography>
            <Typography fontSize={11.5} mt={0.5}>{submitState.conflict.winner.note}</Typography>
            <Table size="small" sx={{ mt: 0.8 }}>
              <TableHead>
                <TableRow><TableCell>被改部位</TableCell><TableCell>你的版本（未写入）</TableCell><TableCell>先提交版本（已留下）</TableCell><TableCell>重提时</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {conflictRows.map((row) => {
                  const key = `${row.kind}:${row.partKey}`
                  const choice = mergeChoice[key] ?? 'takeTheirs'
                  return (
                    <TableRow key={key}>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>{partName(row.partKey)}</TableCell>
                      <TableCell sx={{ fontSize: 11.5, color: '#b44b2d' }}>{row.yours}</TableCell>
                      <TableCell sx={{ fontSize: 11.5, color: '#2d7665' }}>{row.theirs}</TableCell>
                      <TableCell>
                        <TextField
                          select size="small" value={choice}
                          onChange={(e) => setMergeChoice((cur) => ({ ...cur, [key]: e.target.value as 'keepMine' | 'takeTheirs' }))}
                        >
                          <MenuItem value="takeTheirs">采用先提交</MenuItem>
                          <MenuItem value="keepMine">保留我的再提</MenuItem>
                        </TextField>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Typography fontSize={11} color="text.secondary" mt={0.6}>
              未冲突的已选部位会原样保留，基于 v{submitState.conflict.currentRevision} 重新提交；通过标记按版本幂等生成，不会重复。
            </Typography>
          </Alert>
        )}

        {submitState.phase === 'failed' && (
          <Alert severity="error" sx={{ mt: 1.5 }} action={
            <Button color="inherit" size="small" variant="contained" startIcon={<ResumeOutlinedIcon />} onClick={resume}>
              从断点重做
            </Button>
          }>
            <Typography fontWeight={800} fontSize={12.5}>写入失败：{submitState.error}</Typography>
            <Typography fontSize={11.5} mt={0.5}>
              已选 {resumeChanges.length} 个部位保留为断点 {submitState.batchId}（已完成阶段：
              {submitState.completed.length ? submitState.completed.join('、') : '无'}）。
              恢复时仅重做未完成阶段，规格/批注改动与通过标记都不会重复执行或重复生成。
            </Typography>
          </Alert>
        )}

        {savedCheckpoint && submitState.phase !== 'failed' && (
          <Alert severity="warning" sx={{ mt: 1.5 }} action={
            <Button color="inherit" size="small" variant="contained" startIcon={<ResumeOutlinedIcon />} onClick={resume}>
              恢复断点 {savedCheckpoint.batchId.slice(-6)}
            </Button>
          }>
            <Typography fontWeight={800} fontSize={12.5}>存在上次写入失败的断点（{savedCheckpoint.failedAt}）</Typography>
            <Typography fontSize={11.5} mt={0.3}>{savedCheckpoint.error}；已选部位已恢复：{savedCheckpoint.changes.map(changeLabel).join('、')}</Typography>
          </Alert>
        )}

        {submitState.phase === 'resuming' && (
          <Alert severity="info" sx={{ mt: 1.5 }}>正在从断点重做未完成阶段……</Alert>
        )}
        {submitState.phase === 'done' && (
          <Alert
            severity="success" sx={{ mt: 1.5 }}
            action={<Button color="inherit" size="small" onClick={() => setSubmitState({ phase: 'idle' })}>知道了</Button>}
          >
            修订已提交：相关工艺已按依赖部位失效、通过标记按新规格重算（幂等），未受影响部分继续沿用。
          </Alert>
        )}
      </Box>

      {/* 尺寸新决定 */}
      <Dialog open={specOpen} onClose={() => setSpecOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>尺寸新决定（挂到依赖链）</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={0.6}>
            <TextField select size="small" label="部位" value={specPart} onChange={(e) => {
              const key = e.target.value as PartKey
              setSpecPart(key)
              setSpecNew(String(sample.measurements['第三轮'].find((m) => m.key === key)?.spec ?? ''))
            }}>
              {partOptions.map(({ key, name }) => <MenuItem key={key} value={key}>{name}</MenuItem>)}
            </TextField>
            {currentMeasurement && (
              <TextField
                size="small" type="number" label="新规格值（cm）"
                defaultValue={currentMeasurement.spec}
                value={specNew || String(currentMeasurement.spec)}
                onChange={(e) => setSpecNew(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start">{currentMeasurement.spec} →</InputAdornment> }}
                helperText={`当前源版本 v${currentMeasurement.sourceVersion}，提交后升到 v${currentMeasurement.sourceVersion + 1}`}
              />
            )}
            <TextField size="small" label="决定依据/备注" value={specNote} onChange={(e) => setSpecNote(e.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSpecOpen(false)}>取消</Button>
          <Button variant="contained" onClick={addSpecChange}>加入已选部位</Button>
        </DialogActions>
      </Dialog>

      {/* 批注新决定 */}
      <Dialog open={annoOpen} onClose={() => setAnnoOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>批注新决定（关闭并升版）</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={0.6}>
            {openAnnotations.length === 0 ? (
              <Typography fontSize={13} color="text.secondary">没有待处理批注。</Typography>
            ) : (
              <>
                <TextField select size="small" label="待处理批注" value={annoId} onChange={(e) => setAnnoId(e.target.value)}>
                  {openAnnotations.map((a) => (
                    <MenuItem key={a.id} value={a.id}>{a.part} · {a.content.slice(0, 18)}…</MenuItem>
                  ))}
                </TextField>
                <TextField multiline minRows={2} size="small" label="处理结论" value={annoResolution} onChange={(e) => setAnnoResolution(e.target.value)} />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnoOpen(false)}>取消</Button>
          <Button variant="contained" disabled={!annoId || !annoResolution.trim()} onClick={addAnnotationChange}>加入已选部位</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
