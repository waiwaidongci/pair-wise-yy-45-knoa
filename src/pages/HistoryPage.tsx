import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import LockOutlineIcon from '@mui/icons-material/LockOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import CloudSyncOutlinedIcon from '@mui/icons-material/CloudSyncOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { dismissJournal, lockReview, unlockReview } from '../features/developmentSlice'
import { partName } from '../domain/dependency'

const EVENT_COLORS: Record<string, string> = {
  提交: '#2d7665',
  失效: '#cf6236',
  重算: '#4a6fa5',
  再确认: '#2d7665',
  冲突: '#b44b2d',
  恢复: '#6b4ea5',
}

export default function HistoryPage() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.development)
  const sample = state.samples.find((item) => item.id === state.selectedId) ?? state.samples[0]
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pendingAnnotations = sample.annotations.filter((item) => item.status === '待处理').length
  const pendingProposals = sample.proposals.filter((item) => item.status === '待决定').length
  const canLock = pendingAnnotations === 0 && pendingProposals === 0

  const failedJournals = Object.values(state.journals).filter((j) => j.sampleId === sample.id && j.status === '失败')
  const conflictEvents = sample.revisionEvents.filter((e) => e.type === '冲突')

  const events = [
    ...sample.revisionEvents.map((item) => ({
      date: item.at,
      title: `${item.type} · ${item.parts.map(partName).join('、') || '全部部位'}`,
      owner: item.owner,
      detail: item.detail,
      status: item.type,
    })),
    ...sample.annotations.map((item) => ({ date: '2026-09-27', title: `${item.part}批注`, owner: item.author, detail: item.content, status: item.status })),
    ...sample.proposals.map((item) => ({ date: '2026-09-27', title: `${item.affectedPart}改版方案`, owner: item.author, detail: item.content, status: item.status })),
    ...state.decisions.map((item) => ({ date: '今天', title: `方案 ${item.proposalId} ${item.decision}`, owner: '品类负责人', detail: item.reason, status: '已记录' })),
    { date: '2026-09-26', title: '第三轮尺寸实测导入', owner: '苏州明裁制衣', detail: '导入 6 个部位实测值，系统发现 2 项超过容差。', status: '已同步' },
    { date: '2026-09-22', title: '第二轮试穿评审', owner: '陈曼', detail: '完成动态试穿记录，肩袖活动量改善。', status: '已归档' },
  ]

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">AUDIT TRAIL / 修订历史</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 审核与锁定</Typography>
          <Typography color="text.secondary">每次尺寸调整、批注、并发冲突与断点恢复均保留时间、责任人与再确认结果。</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined">导出修订记录</Button>
          {state.locked ? (
            <Button variant="outlined" startIcon={<LockOpenOutlinedIcon />} onClick={() => dispatch(unlockReview())}>解锁修订</Button>
          ) : (
            <Button variant="contained" startIcon={<LockOutlineIcon />} onClick={() => setConfirmOpen(true)} disabled={!canLock}>审核锁定</Button>
          )}
        </Stack>
      </Box>

      {!canLock && !state.locked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          审核前需处理 {pendingAnnotations} 项待处理批注和 {pendingProposals} 项待决定改版方案。
        </Alert>
      )}
      {state.locked && <Alert severity="success" sx={{ mb: 1.5 }}>当前轮次已锁定，只能查看历史。解锁后将新增一个修订分支。</Alert>}

      {(failedJournals.length > 0 || conflictEvents.length > 0) && (
        <Box sx={{ mb: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
          {conflictEvents.length > 0 && (
            <Alert severity="warning" icon={<WarningAmberOutlinedIcon />}>
              <Typography fontWeight={800} fontSize={13}>并发冲突记录</Typography>
              {conflictEvents.slice(0, 3).map((e) => (
                <Typography key={e.id} fontSize={12} mt={0.4}>· {e.at} {e.detail}</Typography>
              ))}
            </Alert>
          )}
          {failedJournals.map((journal) => (
            <Alert key={journal.id} severity="error" icon={<CloudSyncOutlinedIcon />} action={
              <Button color="inherit" size="small" onClick={() => dispatch(dismissJournal(journal.id))}>忽略</Button>
            }>
              <Typography fontWeight={800} fontSize={13}>待恢复写入 {journal.id}</Typography>
              <Typography fontSize={12} mt={0.4}>已选 {journal.selectedParts.length} 个部位 · {journal.error}</Typography>
              <Typography fontSize={11} color="text.secondary" mt={0.2}>恢复时从断点续作，通过标记幂等不重复。</Typography>
            </Alert>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 310px' }, gap: 1.5 }}>
        <Box className="panel" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <HistoryOutlinedIcon color="primary" />
            <Typography fontWeight={800}>完整审计时间线</Typography>
          </Stack>
          <Box>
            {events.map((event, index) => (
              <Box key={`${event.title}-${index}`} sx={{ display: 'grid', gridTemplateColumns: '130px 24px 1fr', gap: 1 }}>
                <Typography color="text.secondary" fontSize={11} pt={0.6}>{event.date}</Typography>
                <Box sx={{ position: 'relative', '&:before': { content: '""', position: 'absolute', left: 8, top: 8, bottom: -8, width: 1, bgcolor: '#d5ddd9' }, '&:after': { content: '""', position: 'absolute', left: 4, top: 7, width: 7, height: 7, bgcolor: EVENT_COLORS[event.status] ?? '#25756d', border: '2px solid #fff', borderRadius: '50%', boxShadow: `0 0 0 1px ${EVENT_COLORS[event.status] ?? '#25756d'}` } }} />
                <Box sx={{ pb: 2.2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography fontWeight={800} fontSize={13}>{event.title}</Typography>
                    <Chip size="small" label={event.status} sx={EVENT_COLORS[event.status] ? { color: EVENT_COLORS[event.status], borderColor: EVENT_COLORS[event.status] } : undefined} variant="outlined" />
                  </Stack>
                  <Typography color="text.secondary" fontSize={12} mt={0.5}>{event.detail}</Typography>
                  <Typography color="#8a918d" fontSize={10} mt={0.5}>操作者：{event.owner}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Box className="panel" sx={{ alignSelf: 'start' }}>
          <Box sx={{ p: 1.6, borderBottom: '1px solid #ece9e4' }}>
            <Typography fontWeight={800}>轮次摘要</Typography>
          </Box>
          <Stack spacing={1.5} p={1.6}>
            {(['第一轮', '第二轮', '第三轮'] as const).map((round, index) => {
              const staleMarks = sample.passMarks.filter((pm) => pm.round === round && pm.status === '待重算').length
              const passed = sample.passMarks.filter((pm) => pm.round === round && pm.result === '通过').length
              return (
                <Box key={round} sx={{ p: 1.3, border: '1px solid #e4e1dc', borderRadius: 1, bgcolor: round === state.roundB ? '#edf5f2' : '#fff' }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={800} fontSize={13}>{round}</Typography>
                    <Chip size="small" label={index === 2 ? sample.status : '已归档'} />
                  </Stack>
                  <Typography color="text.secondary" fontSize={11} mt={0.8}>
                    {sample.measurements[round].length} 项实测 · {passed} 项通过
                    {staleMarks > 0 && <Typography component="span" color="#b44b2d"> · {staleMarks} 项待重算</Typography>}
                  </Typography>
                </Box>
              )
            })}
          </Stack>
        </Box>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认锁定 {state.roundB}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={1.5}>锁定后本轮尺寸、批注和采纳方案将变为只读，并生成不可覆盖的审核快照。</Typography>
          <TextField fullWidth label="锁定说明" defaultValue={`确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。`} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button
            variant="contained"
            onClick={() => {
              dispatch(lockReview())
              setConfirmOpen(false)
            }}
          >
            确认锁定
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
