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
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { reconfirmCraft, selectSample } from '../features/developmentSlice'
import { partName } from '../domain/dependency'

export default function StylesPage() {
  const dispatch = useAppDispatch()
  const { samples, selectedId } = useAppSelector((state) => state.development)
  const selected = samples.find((item) => item.id === selectedId) ?? samples[0]
  const [reconfirmId, setReconfirmId] = useState<string | null>(null)
  const [reconfirmNote, setReconfirmNote] = useState('')

  const staleCraft = selected.craftRequirements.filter((cr) => cr.status === '待重算')
  const staleOwners = Array.from(new Set(staleCraft.map((cr) => cr.owner)))

  const submitReconfirm = () => {
    if (!reconfirmId || !reconfirmNote.trim()) return
    dispatch(reconfirmCraft({ sampleId: selected.id, craftId: reconfirmId, note: reconfirmNote.trim() }))
    setReconfirmId(null)
    setReconfirmNote('')
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">STYLE FILES / 款式档案</Typography>
          <Typography component="h1" fontWeight={800}>规格、物料与样品轮次</Typography>
          <Typography color="text.secondary">款式档案是批注、尺寸修订和审核记录的单一来源；工艺要求按部位依赖联动，过期项自动标红。</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddPhotoAlternateOutlinedIcon />}>新建款式档案</Button>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '260px minmax(0,1fr)' }, gap: 1.5 }}>
        <Box className="panel" sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 1.5, borderBottom: '1px solid #ece9e4' }}>
            <TextField select size="small" fullWidth label="开发季节" defaultValue="2026 秋冬">
              <MenuItem value="2026 秋冬">2026 秋冬</MenuItem>
              <MenuItem value="2027 春夏">2027 春夏</MenuItem>
            </TextField>
          </Box>
          {samples.map((sample) => {
            const stale = sample.craftRequirements.filter((cr) => cr.status === '待重算').length
            return (
              <Button
                key={sample.id}
                onClick={() => dispatch(selectSample(sample.id))}
                sx={{
                  display: 'block',
                  width: '100%',
                  p: 1.5,
                  borderRadius: 0,
                  textAlign: 'left',
                  textTransform: 'none',
                  borderBottom: '1px solid #efede9',
                  bgcolor: sample.id === selected.id ? '#edf4f1' : 'transparent',
                  boxShadow: sample.id === selected.id ? 'inset 3px 0 #2d7b72' : 'none',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={800} fontSize={13}>{sample.styleCode}</Typography>
                  {stale > 0 && <Chip size="small" color="warning" icon={<WarningAmberOutlinedIcon />} label={`${stale} 项待重算`} />}
                </Stack>
                <Typography fontSize={13} mt={0.3}>{sample.styleName}</Typography>
                <Stack direction="row" spacing={0.6} mt={0.8}>
                  <Chip size="small" label={sample.owner} />
                  <Chip size="small" label={sample.status} color={sample.status === '待审核' ? 'warning' : 'default'} />
                </Stack>
              </Button>
            )
          })}
        </Box>

        <Box className="panel">
          <Box sx={{ p: 2, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
            <Box>
              <Typography color="text.secondary" fontSize={11}>{selected.id} · {selected.developmentSeason} · v{selected.version}</Typography>
              <Typography fontSize={22} fontWeight={850} mt={0.5}>{selected.styleName}</Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={selected.category} />
              <Chip label={selected.status} color={selected.status === '已锁定' ? 'success' : 'warning'} />
            </Stack>
          </Box>

          {staleCraft.length > 0 && (
            <Alert severity="warning" icon={<WarningAmberOutlinedIcon />} sx={{ m: 2, mb: 0 }}>
              <Typography fontWeight={800} fontSize={13}>有 {staleCraft.length} 项工艺要求因部位尺寸/批注变更而过期，需责任人再确认</Typography>
              <Typography fontSize={12} mt={0.4}>
                待重算工艺：{staleCraft.map((cr) => cr.id).join('、')} · 责任人：{staleOwners.join('、')}
              </Typography>
            </Alert>
          )}

          <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Box>
              <Typography fontWeight={800} mb={1}>开发信息</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 1, fontSize: 13 }}>
                <Typography color="text.secondary">供应商</Typography><Typography>{selected.supplier}</Typography>
                <Typography color="text.secondary">负责人</Typography><Typography>{selected.owner}</Typography>
                <Typography color="text.secondary">面辅料</Typography><Typography>{selected.fabric}</Typography>
                <Typography color="text.secondary">色卡</Typography><Typography>{selected.colorway}</Typography>
                <Typography color="text.secondary">计划交样</Typography><Typography>{selected.dueDate}</Typography>
              </Box>
            </Box>
            <Box>
              <Typography fontWeight={800} mb={1}>
                工艺要求
                {staleCraft.length > 0 && <Chip size="small" color="warning" label={`${staleCraft.length} 项待重算`} sx={{ ml: 1 }} />}
              </Typography>
              <Stack spacing={0.8}>
                {selected.craftRequirements.map((item, index) => {
                  const stale = item.status === '待重算'
                  return (
                    <Box
                      key={item.id}
                      sx={{
                        display: 'flex',
                        gap: 1,
                        alignItems: 'flex-start',
                        p: 1,
                        bgcolor: stale ? '#fff4ef' : '#f7f6f3',
                        border: stale ? '1px solid #e8a87c' : '1px solid transparent',
                        borderRadius: 1,
                      }}
                    >
                      <Chip size="small" label={`工艺 ${index + 1}`} color={stale ? 'warning' : 'default'} />
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center">
                          <Typography fontSize={12}>{item.content}</Typography>
                          {stale ? (
                            <Chip size="small" color="warning" icon={<WarningAmberOutlinedIcon />} label="待重算" />
                          ) : (
                            <Chip size="small" color="success" icon={<CheckCircleOutlineIcon />} label="有效" />
                          )}
                        </Stack>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" mt={0.5}>
                          {item.parts.map((p) => (
                            <Chip key={p} size="small" variant="outlined" label={partName(p)} sx={{ fontSize: 10, height: 20 }} />
                          ))}
                          <Typography color="text.secondary" fontSize={10} alignSelf="center">责任人：{item.owner}</Typography>
                        </Stack>
                        {stale ? (
                          <Button size="small" variant="outlined" color="warning" sx={{ mt: 0.6 }} onClick={() => { setReconfirmId(item.id); setReconfirmNote('') }}>
                            责任人再确认
                          </Button>
                        ) : (
                          <Typography color="text.secondary" fontSize={10} mt={0.4}>
                            已再确认：{item.confirmedAt} · {item.reconfirmNote}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  )
                })}
              </Stack>
            </Box>
          </Box>
          <Divider />
          <Box sx={{ p: 2 }}>
            <Typography fontWeight={800} mb={1.2}>样衣轮次与附件</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3,1fr)' }, gap: 1 }}>
              {(['第一轮', '第二轮', '第三轮'] as const).map((round) => {
                const staleMarks = selected.passMarks.filter((pm) => pm.round === round && pm.status === '待重算').length
                return (
                  <Box key={round} sx={{ p: 1.5, border: '1px solid #e3e0db', borderRadius: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography fontWeight={800} fontSize={13}>{round}</Typography>
                      {staleMarks > 0 && <Chip size="small" color="warning" label={`${staleMarks} 标记待重算`} />}
                    </Stack>
                    <Typography color="text.secondary" fontSize={11} mt={0.5}>
                      {selected.measurements[round].length} 项实测 · {round === '第三轮' ? '当前评测' : '历史记录'}
                    </Typography>
                    <Button size="small" sx={{ mt: 1 }}>查看实测</Button>
                  </Box>
                )
              })}
            </Box>
            <Stack direction="row" gap={1} flexWrap="wrap" mt={1.5}>
              {selected.attachments.map((file) => (
                <Button key={file.name} variant="outlined" size="small" startIcon={<DescriptionOutlinedIcon />}>{file.name}</Button>
              ))}
            </Stack>
          </Box>
        </Box>
      </Box>

      <Dialog open={Boolean(reconfirmId)} onClose={() => setReconfirmId(null)} fullWidth maxWidth="sm">
        <DialogTitle>工艺要求再确认</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" fontSize={12} mb={1.5}>
            部位尺寸/批注已变更，依赖该部位的工艺要求需责任人确认是否继续沿用或调整。
          </Typography>
          <TextField
            autoFocus
            multiline
            minRows={3}
            fullWidth
            label="再确认结论（必填）"
            placeholder="例如：肩袖数据变化在容差内，工艺要求继续沿用；或需调整袖窿吃势。"
            value={reconfirmNote}
            onChange={(event) => setReconfirmNote(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReconfirmId(null)}>取消</Button>
          <Button variant="contained" disabled={!reconfirmNote.trim()} onClick={submitReconfirm}>确认并标记有效</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
