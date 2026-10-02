import { useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined'
import type { CraftItem, Reconfirmation, Sample } from '../api/types'
import { craftStalePartKeys, partName, sourceAnnotationVersions, sourceSpecVersions } from '../features/dependencyChain'
import { useReconfirmCraftMutation } from '../app/api'
import { useAppDispatch } from '../app/hooks'
import { applyServerSample } from './developmentSlice'

/** 责任人再确认弹窗：继续沿用（按当前源版本背书）或标记已更新（basis 推进） */
export function ReconfirmDialog({
  sample,
  craft,
  open,
  onClose,
}: {
  sample: Sample
  craft: CraftItem
  open: boolean
  onClose: () => void
}) {
  const dispatch = useAppDispatch()
  const [reconfirm, { isLoading }] = useReconfirmCraftMutation()
  const [result, setResult] = useState<Reconfirmation['result']>('继续沿用')
  const [by, setBy] = useState(craft.owner)
  const [note, setNote] = useState('')

  const staleKeys = craftStalePartKeys(craft, sample)
  const specV = sourceSpecVersions(sample)
  const annoV = sourceAnnotationVersions(sample)

  const submit = async () => {
    if (!note.trim()) return
    const payload: Reconfirmation = {
      at: new Date().toLocaleString('zh-CN', { hour12: false }),
      by,
      result,
      note,
    }
    const updated = await reconfirm({ sampleId: sample.id, craftId: craft.id, reconfirmation: payload }).unwrap()
    dispatch(applyServerSample(updated))
    setNote('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>工艺「{craft.name}」责任人再确认</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} pt={0.6}>
          <Box sx={{ p: 1.2, bgcolor: staleKeys.length ? '#fff7ef' : '#f4f8f6', borderRadius: 1, fontSize: 12, color: staleKeys.length ? '#8a5a2e' : '#3f6b58' }}>
            {staleKeys.length === 0
              ? `该工艺依赖的所有部位均为最新源版本（${craft.dependsOn.map((key) => `${partName(key)} v${specV[key] ?? 1}`).join('、')}），可直接复核再确认。`
              : <>
                  {staleKeys.map((key) => {
                    const basis = craft.reconfirmations[0]?.seenSpecVersion?.[key] ?? craft.basisSpecVersion[key] ?? 1
                    return `${partName(key)} v${basis} → 当前 v${specV[key]}`
                  }).join('；')}
                  {staleKeys.some((key) => annoV[key] !== undefined) && '（批注版本同样已更新）'}。
                  请责任人核对后给出结论；选择"继续沿用"表示当前差异不影响开裁。
                </>}
          </Box>
          <TextField select size="small" label="再确认结果" value={result} onChange={(e) => setResult(e.target.value as Reconfirmation['result'])}>
            <MenuItem value="继续沿用">继续沿用（差异不影响开裁，我为此版本背书）</MenuItem>
            <MenuItem value="已更新">已更新（已按最新源版本重算工艺资料）</MenuItem>
          </TextField>
          <TextField size="small" label="责任人" value={by} onChange={(e) => setBy(e.target.value)} />
          <TextField
            multiline minRows={2} size="small" label="确认说明"
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="例如：胸围收 2cm 不影响袋口定位，贴袋工艺按 v2 复核后继续沿用。"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={!note.trim() || isLoading} startIcon={<VerifiedOutlinedIcon />} onClick={submit}>
          提交再确认
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** 单个工艺的依赖状态卡：版本依据、过期部位、责任人再确认历史 */
export function CraftDependencyCard({ craft, sample, onReconfirm }: { craft: CraftItem; sample: Sample; onReconfirm: (craft: CraftItem) => void }) {
  const staleKeys = craftStalePartKeys(craft, sample)
  const stale = staleKeys.length > 0
  const specV = sourceSpecVersions(sample)
  const annoV = sourceAnnotationVersions(sample)
  const last = craft.reconfirmations[0]

  return (
    <Box sx={{
      p: 1.3,
      border: `1px solid ${stale ? '#e3b489' : '#e2dfda'}`,
      borderLeft: `4px solid ${stale ? '#cf6236' : '#397c69'}`,
      borderRadius: 1.2,
      bgcolor: stale ? '#fff9f3' : 'transparent',
    }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Typography fontWeight={800} fontSize={13}>{craft.name}</Typography>
        <Chip
          size="small"
          color={stale ? 'warning' : 'success'}
          icon={stale ? <ReplayOutlinedIcon /> : <VerifiedOutlinedIcon />}
          label={stale ? `待重算 · ${staleKeys.length} 部位源已更新` : '有效'}
        />
      </Stack>
      <Typography color="text.secondary" fontSize={11.5} mt={0.8}>{craft.basis}</Typography>
      <Stack direction="row" spacing={0.6} mt={0.8} flexWrap="wrap" useFlexGap>
        {craft.dependsOn.map((key) => {
          const basis = craft.reconfirmations[0]?.seenSpecVersion?.[key] ?? craft.basisSpecVersion[key]
          const specStale = specV[key] !== undefined && specV[key] !== basis
          return (
            <Chip
              key={key}
              size="small"
              variant={specStale ? 'filled' : 'outlined'}
              color={specStale ? 'warning' : 'default'}
              label={`${partName(key)} v${specV[key] ?? 1}${specStale ? `（旧据 v${basis ?? 1}）` : ''}`}
            />
          )
        })}
        {craft.dependsOn.some((key) => annoV[key] !== undefined) && (
          <Chip size="small" variant="outlined" label="含批注源" />
        )}
      </Stack>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mt={1} spacing={1} flexWrap="wrap" useFlexGap>
        <Typography color="#8a918d" fontSize={10.5}>
          责任人：{craft.owner}（{craft.ownerRole}）
          {last && ` · 最近再确认 ${last.at}：${last.result}`}
        </Typography>
        <Button size="small" variant={stale ? 'contained' : 'outlined'} onClick={() => onReconfirm(craft)}>
          {stale ? '立即再确认' : '复核结论'}
        </Button>
      </Stack>
    </Box>
  )
}

export default function CraftReconfirmPanel({ sample }: { sample: Sample }) {
  const [target, setTarget] = useState<CraftItem | null>(null)

  return (
    <Box>
      <Stack spacing={1}>
        {sample.crafts.map((craft) => (
          <CraftDependencyCard key={craft.id} craft={craft} sample={sample} onReconfirm={setTarget} />
        ))}
      </Stack>
      {target && (
        <ReconfirmDialog
          sample={sample}
          craft={target}
          open={Boolean(target)}
          onClose={() => setTarget(null)}
        />
      )}
    </Box>
  )
}
