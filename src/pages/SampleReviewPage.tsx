import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined'
import PhotoCameraBackOutlinedIcon from '@mui/icons-material/PhotoCameraBackOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import CloudSyncOutlinedIcon from '@mui/icons-material/CloudSyncOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import {
  addAnnotation,
  conflictDetected,
  decideProposal,
  dismissConflict,
  dismissJournal,
  journalUpdated,
  recalcPassMarks,
  revisionApplied,
  saveDraft,
  setRounds,
  toggleAnnotation,
  writeFailed,
} from '../features/developmentSlice'
import { useRetryRevisionMutation, useSubmitRevisionMutation } from '../app/api'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import type { ConflictInfo, RevisionResult, WriteJournal } from '../api/types'
import { PART_NAMES, partName } from '../domain/dependency'

const rounds = ['第一轮', '第二轮', '第三轮'] as const
const FAIL_STEPS = [
  { value: 'measurements', label: '应用部位尺寸变更' },
  { value: 'invalidate', label: '失效相关工艺要求与通过标记' },
  { value: 'passmarks', label: '重算通过标记（幂等）' },
  { value: 'finalize', label: '提交版本并记录履历' },
]

export default function SampleReviewPage() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.development)
  const sample = state.samples.find((item) => item.id === state.selectedId) ?? state.samples[0]
  const [submitRevision, { isLoading: submitting }] = useSubmitRevisionMutation()
  const [retryRevision, { isLoading: retrying }] = useRetryRevisionMutation()

  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [decisionDialog, setDecisionDialog] = useState<string | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [annotationDraft, setAnnotationDraft] = useState({ x: 50, y: 42, part: '版型', partKey: 'chest', content: '' })
  const imageRef = useRef<HTMLDivElement>(null)

  const [revisionOpen, setRevisionOpen] = useState(false)
  const [selectedParts, setSelectedParts] = useState<string[]>([])
  const [partValues, setPartValues] = useState<Record<string, number>>({})
  const [simulateCollaborator, setSimulateCollaborator] = useState(false)
  const [injectFailure, setInjectFailure] = useState('')

  const comparison = useMemo(() => {
    const a = sample.measurements[state.roundA]
    const b = sample.measurements[state.roundB]
    return a.map((item, index) => ({
      ...item,
      previous: item.actual,
      current: b[index].actual,
      delta: b[index].actual - item.actual,
      inTolerance: Math.abs(b[index].actual - b[index].spec) <= b[index].tolerance,
    }))
  }, [sample, state.roundA, state.roundB])

  const staleCraft = sample.craftRequirements.filter((cr) => cr.status === '待重算')
  const staleMarks = sample.passMarks.filter((pm) => pm.status === '待重算')
  const failedJournals = Object.values(state.journals).filter((j) => j.sampleId === sample.id && j.status === '失败')

  const openRevision = () => {
    const values: Record<string, number> = {}
    sample.measurements[state.roundB].forEach((m) => {
      values[m.key] = m.actual
    })
    setPartValues(values)
    setSelectedParts([])
    setSimulateCollaborator(false)
    setInjectFailure('')
    setRevisionOpen(true)
  }

  const handleImageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (state.locked) return
    const rect = imageRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnnotationDraft((current) => ({
      ...current,
      x: Math.round(((event.clientX - rect.left) / rect.width) * 100),
      y: Math.round(((event.clientY - rect.top) / rect.height) * 100),
    }))
    setAnnotationOpen(true)
  }

  const submitDecision = (decision: '已采纳' | '未采纳') => {
    if (!decisionDialog || !decisionReason.trim()) return
    dispatch(decideProposal({ proposalId: decisionDialog, decision, reason: decisionReason, decidedAt: new Date().toLocaleString('zh-CN') }))
    setDecisionDialog(null)
    setDecisionReason('')
  }

  const handleSubmitRevision = async () => {
    if (selectedParts.length === 0) return
    const body = {
      baseVersion: sample.version,
      selectedParts,
      changes: {
        measurements: selectedParts.map((part) => ({ round: state.roundB as '第一轮' | '第二轮' | '第三轮', part, actual: partValues[part] })),
      },
      note: '',
    }
    const res = await submitRevision({ sampleId: sample.id, body, simulateCollaborator, injectFailure: injectFailure || undefined })
    const data = res.data
    if (data?.ok) {
      dispatch(revisionApplied(data.sample))
      setRevisionOpen(false)
    } else if (res.error) {
      const err = (res.error as FetchBaseQueryError).data as RevisionResult | undefined
      if (err && !err.ok) {
        if (err.reason === 'conflict') {
          dispatch(conflictDetected(err.conflict))
          setRevisionOpen(false)
        } else if (err.reason === 'write_failed') {
          dispatch(writeFailed(err.journal))
          setRevisionOpen(false)
        }
      }
    }
  }

  const handleRetry = async (journal: WriteJournal) => {
    const res = await retryRevision({ sampleId: sample.id, journalId: journal.id })
    const data = res.data
    if (data?.ok) {
      dispatch(revisionApplied(data.sample))
    } else if (res.error) {
      const err = (res.error as FetchBaseQueryError).data as RevisionResult | undefined
      if (err && !err.ok && err.reason === 'write_failed' && err.journal) dispatch(journalUpdated(err.journal))
    }
  }

  const togglePart = (part: string) => {
    setSelectedParts((current) => (current.includes(part) ? current.filter((p) => p !== part) : [...current, part]))
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">SAMPLE REVIEW / 样品评审</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 轮次对比</Typography>
          <Typography color="text.secondary">尺寸差异超过容差自动高亮；部位变更按依赖链只失效相关工艺要求与通过标记。</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<PhotoCameraBackOutlinedIcon />}>上传样衣照片</Button>
          <Button variant="outlined" startIcon={<CloudSyncOutlinedIcon />} onClick={openRevision} disabled={state.locked}>
            发起修订
          </Button>
          <Button variant="contained" disabled={state.locked} onClick={() => dispatch(saveDraft({ sampleId: sample.id, notes: '评审草稿已保存' }))}>保存当前草稿</Button>
        </Stack>
      </Box>

      {state.locked && <Alert severity="success" sx={{ mb: 1.5 }}>该轮次已审核锁定。解锁后才能新增批注或采纳方案。</Alert>}
      {sample.annotations.some((item) => item.status === '待处理') && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          当前仍有 {sample.annotations.filter((item) => item.status === '待处理').length} 项待处理批注，审核锁定前必须逐项关闭。
        </Alert>
      )}
      {staleCraft.length > 0 && (
        <Alert severity="warning" icon={<WarningAmberOutlinedIcon />} sx={{ mb: 1.5 }}>
          <Typography fontWeight={800} fontSize={13}>{staleCraft.length} 项工艺要求依赖部位已变更，待责任人再确认：{staleCraft.map((cr) => `${cr.id}（${cr.owner}）`).join('、')}</Typography>
        </Alert>
      )}
      {staleMarks.length > 0 && (
        <Alert severity="info" icon={<WarningAmberOutlinedIcon />} sx={{ mb: 1.5 }} action={
          <Button color="inherit" size="small" onClick={() => dispatch(recalcPassMarks({ sampleId: sample.id }))}>重算全部待重算标记</Button>
        }>
          <Typography fontWeight={800} fontSize={13}>{staleMarks.length} 项通过标记因部位变更过期，需重算确认；未受影响部位继续沿用原标记。</Typography>
        </Alert>
      )}

      {failedJournals.map((journal) => (
        <Alert
          key={journal.id}
          severity="error"
          sx={{ mb: 1.5 }}
          action={
            <Stack direction="row" spacing={1}>
              <Button color="inherit" size="small" onClick={() => handleRetry(journal)} disabled={retrying}>从断点恢复</Button>
              <Button color="inherit" size="small" onClick={() => dispatch(dismissJournal(journal.id))}>放弃</Button>
            </Stack>
          }
        >
          <Typography fontWeight={800} fontSize={13}>写入失败（{journal.id}）：已保留 {journal.selectedParts.length} 个已选部位，恢复时从断点续作、不重复生成通过标记。</Typography>
          <Stack direction="row" spacing={0.5} mt={0.6} flexWrap="wrap">
            {journal.steps.map((step) => (
              <Chip key={step.key} size="small" label={`${step.label}：${step.status === 'done' ? '已完成' : '待续作'}`} color={step.status === 'done' ? 'success' : 'default'} variant={step.status === 'done' ? 'filled' : 'outlined'} />
            ))}
          </Stack>
          <Typography fontSize={11} mt={0.4}>{journal.error}</Typography>
        </Alert>
      ))}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.15fr) minmax(340px,.85fr)' }, gap: 1.5 }}>
        <Box className="panel">
          <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography fontWeight={800}>尺寸实测差异</Typography>
            <Stack direction="row" spacing={1}>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>基准轮次</InputLabel>
                <Select label="基准轮次" value={state.roundA} onChange={(event) => dispatch(setRounds({ a: event.target.value as typeof state.roundA }))}>
                  {rounds.map((round) => <MenuItem key={round} value={round}>{round}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>对比轮次</InputLabel>
                <Select label="对比轮次" value={state.roundB} onChange={(event) => dispatch(setRounds({ b: event.target.value as typeof state.roundB }))}>
                  {rounds.map((round) => <MenuItem key={round} value={round}>{round}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: '#f6f5f2' }}>
                  <TableCell>部位</TableCell>
                  <TableCell>规格</TableCell>
                  <TableCell>±容差</TableCell>
                  <TableCell>{state.roundA}</TableCell>
                  <TableCell>{state.roundB}</TableCell>
                  <TableCell>变化</TableCell>
                  <TableCell>判定</TableCell>
                  <TableCell>通过标记</TableCell>
                  <TableCell>依赖工艺</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {comparison.map((item) => {
                  const mark = sample.passMarks.find((pm) => pm.part === item.key && pm.round === state.roundB)
                  const dependentCraft = sample.craftRequirements.filter((cr) => cr.parts.includes(item.key))
                  const markStale = mark?.status === '待重算'
                  return (
                    <TableRow key={item.key} sx={{ bgcolor: markStale ? '#fff4ef' : item.inTolerance ? 'transparent' : '#fff4ef' }}>
                      <TableCell sx={{ fontWeight: 750 }}>{item.name}</TableCell>
                      <TableCell>{item.spec} cm</TableCell>
                      <TableCell>±{item.tolerance}</TableCell>
                      <TableCell>{item.previous.toFixed(1)}</TableCell>
                      <TableCell sx={{ fontWeight: 800, color: item.inTolerance ? '#2d7665' : '#b44b2d' }}>{item.current.toFixed(1)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={`${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)}`} color={Math.abs(item.delta) > 0.5 ? 'warning' : 'default'} />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" icon={item.inTolerance ? <CheckCircleOutlineIcon /> : <CancelOutlinedIcon />} label={item.inTolerance ? '达标' : '超差'} color={item.inTolerance ? 'success' : 'error'} />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {mark && (
                            <Chip
                              size="small"
                              label={`${mark.result} · ${mark.status === '待重算' ? '待重算' : '有效'}`}
                              color={mark.status === '待重算' ? 'warning' : mark.result === '通过' ? 'success' : 'error'}
                              variant={mark.status === '待重算' ? 'filled' : 'outlined'}
                            />
                          )}
                          {markStale && (
                            <Button size="small" onClick={() => dispatch(recalcPassMarks({ sampleId: sample.id, part: item.key }))}>重算</Button>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.3} flexWrap="wrap">
                          {dependentCraft.map((cr) => (
                            <Tooltip key={cr.id} title={`${cr.id} · ${cr.owner} · ${cr.status}`}>
                              <Chip size="small" variant="outlined" label={cr.id} color={cr.status === '待重算' ? 'warning' : 'default'} sx={{ fontSize: 10, height: 20 }} />
                            </Tooltip>
                          ))}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
          <Box sx={{ p: 1.5, borderTop: '1px solid #ece9e4' }}>
            <TextField
              multiline
              minRows={2}
              fullWidth
              size="small"
              label="轮次评审草稿"
              defaultValue={state.draftNotes[sample.id] ?? '第二轮肩袖活动量已改善；建议采纳肩线内收方案，第三轮复核举臂舒适度。'}
              onBlur={(event) => dispatch(saveDraft({ sampleId: sample.id, notes: event.target.value }))}
            />
          </Box>
        </Box>

        <Box className="panel">
          <Box sx={{ px: 1.8, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between' }}>
            <Typography fontWeight={800}>样衣部位批注 · {state.roundB}</Typography>
            <Button size="small" startIcon={<AddLocationAltOutlinedIcon />} disabled={state.locked} onClick={() => setAnnotationOpen(true)}>添加批注</Button>
          </Box>
          <Box
            ref={imageRef}
            onClick={handleImageClick}
            sx={{
              position: 'relative',
              height: 420,
              m: 1.5,
              overflow: 'hidden',
              cursor: state.locked ? 'default' : 'crosshair',
              borderRadius: 1.5,
              background: 'linear-gradient(180deg,#dfe5e4 0%,#cbd4d1 100%)',
              backgroundImage: 'linear-gradient(180deg,#dce4e2 0%,#c7d2cf 100%), repeating-linear-gradient(90deg,transparent 0 39px,rgba(255,255,255,.18) 40px)',
            }}
          >
            <Box sx={{ position: 'absolute', left: '50%', top: 32, transform: 'translateX(-50%)', width: 170, height: 55, border: '3px solid #526a65', borderRadius: '50% 50% 22% 22%', bgcolor: '#657d77' }} />
            <Box sx={{ position: 'absolute', left: '50%', top: 80, transform: 'translateX(-50%)', width: 210, height: 230, border: '3px solid #526a65', borderRadius: '38px 38px 22px 22px', bgcolor: '#718983' }}>
              <Box sx={{ position: 'absolute', left: 50, top: 72, width: 110, height: 76, border: '1px dashed rgba(255,255,255,.6)', borderRadius: 2 }} />
              <Box sx={{ position: 'absolute', left: 35, top: 30, right: 35, borderTop: '2px solid rgba(255,255,255,.45)' }} />
              <Box sx={{ position: 'absolute', left: 38, top: 148, width: 34, height: 48, border: '2px solid #455c57', borderRadius: 1 }} />
              <Box sx={{ position: 'absolute', right: 38, top: 148, width: 34, height: 48, border: '2px solid #455c57', borderRadius: 1 }} />
            </Box>
            <Box sx={{ position: 'absolute', left: 50, top: 96, width: 52, height: 200, border: '3px solid #526a65', borderRadius: '25px 8px 12px 25px', bgcolor: '#657d77', transform: 'rotate(7deg)' }} />
            <Box sx={{ position: 'absolute', right: 50, top: 96, width: 52, height: 200, border: '3px solid #526a65', borderRadius: '8px 25px 25px 12px', bgcolor: '#657d77', transform: 'rotate(-7deg)' }} />
            {sample.annotations.map((annotation) => (
              <Tooltip key={annotation.id} title={`${annotation.part}：${annotation.content}`}>
                <Box
                  onClick={(event) => {
                    event.stopPropagation()
                    dispatch(toggleAnnotation(state.activeAnnotation === annotation.id ? null : annotation.id))
                  }}
                  sx={{
                    position: 'absolute',
                    left: `${annotation.x}%`,
                    top: `${annotation.y}%`,
                    width: 24,
                    height: 24,
                    display: 'grid',
                    placeItems: 'center',
                    transform: 'translate(-50%,-50%)',
                    borderRadius: '50%',
                    color: '#fff',
                    bgcolor: annotation.status === '待处理' ? '#cf6236' : '#397c69',
                    border: '3px solid rgba(255,255,255,.9)',
                    boxShadow: '0 3px 10px rgba(0,0,0,.25)',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {annotation.id.slice(-2)}
                </Box>
              </Tooltip>
            ))}
            <Chip label="点击样衣任意部位添加批注" size="small" sx={{ position: 'absolute', left: 12, bottom: 12, bgcolor: 'rgba(255,255,255,.9)' }} />
          </Box>
          <Stack spacing={1} sx={{ px: 1.5, pb: 1.5 }}>
            {sample.annotations.map((annotation) => (
              <Box key={annotation.id} sx={{ p: 1.2, borderLeft: `3px solid ${annotation.status === '待处理' ? '#cf6236' : '#397c69'}`, bgcolor: '#f8f7f4', borderRadius: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={800} fontSize={12}>{annotation.part} · {annotation.author}</Typography>
                  <Button size="small" onClick={() => dispatch(toggleAnnotation(annotation.id))}>查看</Button>
                </Stack>
                <Typography color="text.secondary" fontSize={11} mt={0.4}>{annotation.content}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>

      <Box className="panel" sx={{ mt: 1.5 }}>
        <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4' }}>
          <Typography fontWeight={800}>替代修改方案与采纳决定</Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 1.5, p: 1.5 }}>
          {sample.proposals.map((proposal) => (
            <Box key={proposal.id} sx={{ p: 1.5, border: '1px solid #e2dfda', borderRadius: 1.2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={800}>{proposal.affectedPart} · {proposal.role}</Typography>
                <Chip size="small" label={proposal.status} color={proposal.status === '已采纳' ? 'success' : proposal.status === '未采纳' ? 'default' : 'warning'} />
              </Stack>
              <Typography fontSize={13} mt={1}>{proposal.content}</Typography>
              <Typography color="text.secondary" fontSize={11} mt={0.7}>提交人：{proposal.author}</Typography>
              {proposal.status === '待决定' && (
                <Button size="small" variant="outlined" sx={{ mt: 1.2 }} onClick={() => setDecisionDialog(proposal.id)} disabled={state.locked}>
                  作出决定
                </Button>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      {/* 部位批注 */}
      <Dialog open={annotationOpen} onClose={() => setAnnotationOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>添加部位批注</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <TextField label="详细部位" value={annotationDraft.part} onChange={(event) => setAnnotationDraft({ ...annotationDraft, part: event.target.value })} />
            <FormControl size="small" fullWidth>
              <InputLabel>归属部位（依赖链）</InputLabel>
              <Select
                label="归属部位（依赖链）"
                value={annotationDraft.partKey}
                onChange={(event) => setAnnotationDraft({ ...annotationDraft, partKey: event.target.value })}
              >
                {Object.entries(PART_NAMES).map(([key, name]) => (
                  <MenuItem key={key} value={key}>{name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField multiline minRows={3} label="批注内容" value={annotationDraft.content} onChange={(event) => setAnnotationDraft({ ...annotationDraft, content: event.target.value })} />
            <Typography color="text.secondary" fontSize={12}>批注锚点：{annotationDraft.x}% / {annotationDraft.y}% · 轮次 {state.roundB}</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnotationOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!annotationDraft.part.trim() || !annotationDraft.content.trim()}
            onClick={() => {
              dispatch(addAnnotation({ sampleId: sample.id, annotation: annotationDraft }))
              setAnnotationDraft({ x: 50, y: 42, part: '版型', partKey: 'chest', content: '' })
              setAnnotationOpen(false)
            }}
          >
            添加并标记待处理
          </Button>
        </DialogActions>
      </Dialog>

      {/* 发起修订：选择部位、编辑新值、并发/故障模拟 */}
      <Dialog open={revisionOpen} onClose={() => setRevisionOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>发起部位修订</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <Typography color="text.secondary" fontSize={12}>
              资料版本 v{sample.version} · 选择本次修订涉及的部位并填写 {state.roundB} 实测新值。提交后按依赖链只失效相关工艺要求与通过标记。
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              {sample.measurements[state.roundB].map((m) => (
                <Box key={m.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Checkbox size="small" checked={selectedParts.includes(m.key)} onChange={() => togglePart(m.key)} />
                  <Typography fontSize={13} sx={{ flex: 1 }}>{m.name}</Typography>
                  <TextField
                    size="small"
                    type="number"
                    sx={{ width: 86 }}
                    value={partValues[m.key] ?? m.actual}
                    disabled={!selectedParts.includes(m.key)}
                    onChange={(event) => setPartValues((v) => ({ ...v, [m.key]: Number(event.target.value) }))}
                  />
                </Box>
              ))}
            </Box>
            <FormControlLabel
              control={<Checkbox checked={simulateCollaborator} onChange={(event) => setSimulateCollaborator(event.target.checked)} />}
              label="模拟协作者同时提交同一套修订（先提交版本留下，后提交看差异）"
            />
            <FormControl size="small" fullWidth>
              <InputLabel>模拟写入失败步骤（断点续作演示）</InputLabel>
              <Select label="模拟写入失败步骤（断点续作演示）" value={injectFailure} onChange={(event) => setInjectFailure(event.target.value)}>
                <MenuItem value="">不模拟失败</MenuItem>
                {FAIL_STEPS.map((step) => (
                  <MenuItem key={step.value} value={step.value}>{step.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevisionOpen(false)}>取消</Button>
          <Button variant="contained" disabled={selectedParts.length === 0 || submitting} onClick={handleSubmitRevision}>
            {submitting ? '提交中…' : '提交修订'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 并发冲突：后提交者看到被改部位与差异 */}
      <ConflictDialog
        conflict={state.conflict}
        onClose={() => dispatch(dismissConflict())}
        onRebase={() => {
          const c = state.conflict
          dispatch(dismissConflict())
          if (c) {
            // 基于最新版本重新提交：保留已选部位，版本号已在服务端更新
            setRevisionOpen(true)
          }
        }}
      />

      <Dialog open={Boolean(decisionDialog)} onClose={() => setDecisionDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>填写采纳决定说明</DialogTitle>
        <DialogContent>
          <TextField autoFocus multiline minRows={3} fullWidth label="决定理由（必填）" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={!decisionReason.trim()} startIcon={<CancelOutlinedIcon />} onClick={() => submitDecision('未采纳')}>不采纳</Button>
          <Button variant="contained" disabled={!decisionReason.trim()} startIcon={<CheckCircleOutlineIcon />} onClick={() => submitDecision('已采纳')}>采纳方案</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function ConflictDialog({ conflict, onClose, onRebase }: { conflict: ConflictInfo | null; onClose: () => void; onRebase: () => void }) {
  return (
    <Dialog open={Boolean(conflict)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <WarningAmberOutlinedIcon color="warning" />
          <Typography fontWeight={800}>修订冲突：已有更新版本先提交</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" fontSize={13} mb={1.5}>
          {conflict?.winner}（{conflict?.winnerOwner}）已先提交同一套修订并留下版本 v{conflict?.currentVersion}。您的基准版本 v{conflict?.baseVersion} 已过期，以下部位已被修改：
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>部位</TableCell>
              <TableCell>您的基准指纹</TableCell>
              <TableCell>当前版本指纹</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {conflict?.changedParts.map((c) => (
              <TableRow key={c.part}>
                <TableCell sx={{ fontWeight: 700 }}>{partName(c.part)}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{c.before || '—'}</TableCell>
                <TableCell sx={{ color: '#b44b2d', fontWeight: 700 }}>{c.after}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="contained" onClick={onRebase}>基于最新版本重新提交</Button>
      </DialogActions>
    </Dialog>
  )
}
