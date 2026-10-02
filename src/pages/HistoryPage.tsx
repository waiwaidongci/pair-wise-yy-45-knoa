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
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { lockReview, unlockReview } from '../features/developmentSlice'
import StaleBanner from '../features/StaleBanner'
import type { ChainEventType } from '../api/types'
import {
  craftStalePartKeys,
  isPassMarkStale,
  partName,
  passMarkFor,
  staleCrafts,
} from '../features/dependencyChain'

const eventMeta: Record<ChainEventType, { label: string; color: 'default' | 'warning' | 'success' | 'error' | 'info' | 'primary' | 'secondary'; dot: string }> = {
  'spec-change': { label: '尺寸源变更', color: 'primary', dot: '#1d6d65' },
  annotation: { label: '批注新决定', color: 'secondary', dot: '#b65e35' },
  'craft-invalidated': { label: '工艺失效', color: 'warning', dot: '#cf6236' },
  'craft-reconfirmed': { label: '责任人再确认', color: 'success', dot: '#397c69' },
  'pass-regenerated': { label: '结论重算', color: 'info', dot: '#3f7099' },
  'revision-committed': { label: '修订提交', color: 'default', dot: '#5d6b67' },
  'revision-conflict': { label: '并发冲突', color: 'error', dot: '#b43d2d' },
  'checkpoint-resumed': { label: '断点恢复', color: 'success', dot: '#43856a' },
}

export default function HistoryPage() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.development)
  const sample = state.samples.find((item) => item.id === state.selectedId) ?? state.samples[0]
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pendingAnnotations = sample.annotations.filter((item) => item.status === '待处理').length
  const pendingProposals = sample.proposals.filter((item) => item.status === '待决定').length
  const staleCraftList = staleCrafts(sample)
  const staleMarks = sample.measurements['第三轮'].filter((m) => isPassMarkStale(passMarkFor(sample, m.key), sample, m.key))
  const canLock = pendingAnnotations === 0 && pendingProposals === 0 && staleCraftList.length === 0 && staleMarks.length === 0

  type TimelineEvent = {
    id: string
    at: string
    title: string
    detail: string
    owner: string
    type?: ChainEventType
    craftId?: string
    partKey?: import('../api/types').PartKey
  }

  const chainEvents: TimelineEvent[] = sample.chainEvents.map((event) => ({
    id: event.id,
    at: event.at,
    title: event.title,
    detail: event.detail,
    owner: event.owner,
    type: event.type,
    craftId: event.craftId,
    partKey: event.partKey,
  }))

  const baselineEvents: TimelineEvent[] = [
    { id: 'BL-2', at: '2026-09-26 09:30', title: '第三轮尺寸实测导入', detail: '导入 8 个部位实测值，系统发现 2 项超过容差。', owner: '苏州明裁制衣' },
    { id: 'BL-1', at: '2026-09-22 15:00', title: '第二轮试穿评审', detail: '完成动态试穿记录，肩袖活动量改善。', owner: '陈曼' },
  ]

  const events: TimelineEvent[] = [...chainEvents, ...baselineEvents]

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">AUDIT TRAIL / 修订历史</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 审核与锁定</Typography>
          <Typography color="text.secondary">依赖链每次传播（失效、重算、再确认、冲突与断点恢复）均保留时间、部位与责任人。</Typography>
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

      <StaleBanner sample={sample} />

      {!canLock && !state.locked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          审核前需处理 {pendingAnnotations} 项待处理批注、{pendingProposals} 项待决定改版方案
          {staleCraftList.length > 0 && `、${staleCraftList.length} 项过期待重算工艺`}
          {staleMarks.length > 0 && `、${staleMarks.length} 个部位过期通过标记`}。
        </Alert>
      )}
      {state.locked && <Alert severity="success" sx={{ mb: 1.5 }}>当前轮次已锁定，只能查看历史。解锁后将新增一个修订分支。</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 330px' }, gap: 1.5 }}>
        <Box className="panel" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <HistoryOutlinedIcon color="primary" />
            <Typography fontWeight={800}>依赖链审计时间线</Typography>
            <Chip size="small" variant="outlined" label={`链版本 v${sample.revision}`} />
          </Stack>
          <Box>
            {events.map((event) => {
              const meta = event.type ? eventMeta[event.type] : null
              return (
                <Box key={event.id} sx={{ display: 'grid', gridTemplateColumns: '118px 24px 1fr', gap: 1 }}>
                  <Typography color="text.secondary" fontSize={11} pt={0.6} sx={{ fontFamily: 'monospace' }}>{event.at}</Typography>
                  <Box sx={{
                    position: 'relative',
                    '&:before': { content: '""', position: 'absolute', left: 8, top: 8, bottom: -8, width: 1, bgcolor: '#d5ddd9' },
                    '&:after': {
                      content: '""', position: 'absolute', left: 4, top: 7, width: 7, height: 7,
                      bgcolor: meta?.dot ?? '#8fa39e', border: '2px solid #fff', borderRadius: '50%',
                      boxShadow: `0 0 0 1px ${meta?.dot ?? '#8fa39e'}`,
                    },
                  }} />
                  <Box sx={{ pb: 2.2 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography fontWeight={800} fontSize={13}>{event.title}</Typography>
                      {meta && <Chip size="small" label={meta.label} color={meta.color} />}
                      {event.partKey && <Chip size="small" variant="outlined" label={partName(event.partKey)} />}
                    </Stack>
                    <Typography color="text.secondary" fontSize={12} mt={0.5}>{event.detail}</Typography>
                    <Typography color="#8a918d" fontSize={10} mt={0.5}>责任人/操作者：{event.owner}</Typography>
                  </Box>
                </Box>
              )
            })}
          </Box>

          {/* 责任人再确认结果 */}
          {sample.crafts.some((c) => c.reconfirmations.length > 0) && (
            <Box sx={{ mt: 1, p: 1.4, bgcolor: '#f4f8f6', borderRadius: 1 }}>
              <Typography fontWeight={800} fontSize={12.5} mb={1}>责任人再确认结果汇总</Typography>
              <Stack spacing={1}>
                {sample.crafts.flatMap((craft) => craft.reconfirmations.map((rc) => (
                  <Box key={`${craft.id}-${rc.at}`} sx={{ fontSize: 11.5 }}>
                    <Chip size="small" color={rc.result === '已更新' ? 'success' : 'default'} label={rc.result} sx={{ mr: 0.8, height: 20 }} />
                    <Typography component="span" fontWeight={700}>「{craft.name}」</Typography>
                    <Typography component="span" color="text.secondary"> {rc.by} · {rc.at} — {rc.note}</Typography>
                  </Box>
                )))}
              </Stack>
            </Box>
          )}
        </Box>

        <Box className="panel" sx={{ alignSelf: 'start' }}>
          <Box sx={{ p: 1.6, borderBottom: '1px solid #ece9e4' }}>
            <Typography fontWeight={800}>过期与再确认摘要</Typography>
          </Box>
          <Stack spacing={1.3} p={1.6}>
            {staleCraftList.length === 0 && staleMarks.length === 0 && (
              <Alert severity="success" sx={{ py: 0.5 }}>无过期项，全部依据最新源版本。</Alert>
            )}
            {staleCraftList.map((craft) => (
              <Box key={craft.id} sx={{ p: 1.2, border: '1px solid #e3b489', borderRadius: 1, bgcolor: '#fff9f3' }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography fontWeight={800} fontSize={12.5}>{craft.name}</Typography>
                  <Chip size="small" color="warning" label="待重算" />
                </Stack>
                <Typography fontSize={11} color="text.secondary" mt={0.6}>
                  过期部位：{craftStalePartKeys(craft, sample).map(partName).join('、')}
                </Typography>
                <Typography fontSize={10.5} color="#8a918d" mt={0.4}>责任人：{craft.owner}（{craft.ownerRole}）</Typography>
              </Box>
            ))}
            {staleMarks.map((m) => {
              const mark = passMarkFor(sample, m.key)
              return (
                <Box key={m.key} sx={{ p: 1.2, border: '1px solid #e3b489', borderRadius: 1, bgcolor: '#fff9f3' }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={800} fontSize={12.5}>{m.name} 通过标记</Typography>
                    <Chip size="small" color="warning" label="待重算" />
                  </Stack>
                  <Typography fontSize={11} color="text.secondary" mt={0.6}>
                    旧结论「{mark?.result}」依据 v{mark?.basisSpecVersion}，当前源 v{m.sourceVersion}
                  </Typography>
                </Box>
              )
            })}

            <Box sx={{ borderTop: '1px solid #ece9e4', pt: 1.3 }}>
              <Typography fontWeight={800} fontSize={12.5} mb={1}>最近修订批次</Typography>
              {sample.revisions.length === 0 && <Typography fontSize={11.5} color="text.secondary">暂无修订提交。</Typography>}
              <Stack spacing={1}>
                {sample.revisions.slice(0, 4).map((rev) => (
                  <Box key={rev.id} sx={{ p: 1.1, border: '1px solid #e4e1dc', borderRadius: 1 }}>
                    <Typography fontWeight={750} fontSize={11.5}>{rev.id} · {rev.author} · {rev.at}</Typography>
                    <Typography fontSize={10.5} color="text.secondary" mt={0.3}>
                      v{rev.baseVersion} → v{rev.baseVersion + 1} · {rev.changes.length} 项改动
                    </Typography>
                    <Typography fontSize={10.5} mt={0.3}>{rev.note}</Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认锁定 {state.roundB}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={1.5}>锁定前系统已确认：无过期工艺与通过标记，所有依据均为最新源版本。锁定后生成本轮不可覆盖的审核快照。</Typography>
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
