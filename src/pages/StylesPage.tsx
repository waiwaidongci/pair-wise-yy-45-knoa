import { Box, Button, Chip, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material'
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { selectSample } from '../features/developmentSlice'
import StaleBanner from '../features/StaleBanner'
import CraftReconfirmPanel from '../features/CraftReconfirmPanel'
import { staleCrafts } from '../features/dependencyChain'

export default function StylesPage() {
  const dispatch = useAppDispatch()
  const { samples, selectedId } = useAppSelector((state) => state.development)
  const selected = samples.find((item) => item.id === selectedId) ?? samples[0]
  const staleCount = staleCrafts(selected).length

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">STYLE FILES / 款式档案</Typography>
          <Typography component="h1" fontWeight={800}>规格、物料与样品轮次</Typography>
          <Typography color="text.secondary">款式档案是批注、尺寸修订和审核记录的单一来源；链版本变化会沿依赖链向下传播。</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddPhotoAlternateOutlinedIcon />}>新建款式档案</Button>
      </Box>

      <StaleBanner sample={selected} />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '260px minmax(0,1fr)' }, gap: 1.5 }}>
        <Box className="panel" sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 1.5, borderBottom: '1px solid #ece9e4' }}>
            <TextField select size="small" fullWidth label="开发季节" defaultValue="2026 秋冬">
              <MenuItem value="2026 秋冬">2026 秋冬</MenuItem>
              <MenuItem value="2027 春夏">2027 春夏</MenuItem>
            </TextField>
          </Box>
          {samples.map((sample) => (
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
              <Typography fontWeight={800} fontSize={13}>{sample.styleCode}</Typography>
              <Typography fontSize={13} mt={0.3}>{sample.styleName}</Typography>
              <Stack direction="row" spacing={0.6} mt={0.8} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={sample.owner} />
                <Chip size="small" label={sample.status} color={sample.status === '待审核' ? 'warning' : 'default'} />
                {staleCrafts(sample).length > 0 && (
                  <Chip size="small" color="warning" label={`${staleCrafts(sample).length} 项工艺过期`} />
                )}
              </Stack>
            </Button>
          ))}
        </Box>

        <Box className="panel">
          <Box sx={{ p: 2, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
            <Box>
              <Typography color="text.secondary" fontSize={11}>{selected.id} · {selected.developmentSeason}</Typography>
              <Typography fontSize={22} fontWeight={850} mt={0.5}>{selected.styleName}</Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={selected.category} />
              <Chip label={`链版本 v${selected.revision}`} variant="outlined" />
              <Chip label={selected.status} color={selected.status === '已锁定' ? 'success' : 'warning'} />
            </Stack>
          </Box>
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
              <Typography fontWeight={800} mb={1}>样衣轮次与附件</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3,1fr)' }, gap: 1 }}>
                {(['第一轮', '第二轮', '第三轮'] as const).map((round) => (
                  <Box key={round} sx={{ p: 1.3, border: '1px solid #e3e0db', borderRadius: 1 }}>
                    <Typography fontWeight={800} fontSize={13}>{round}</Typography>
                    <Typography color="text.secondary" fontSize={11} mt={0.5}>
                      {selected.measurements[round].length} 项实测 · {round === '第三轮' ? '当前评测' : '历史记录'}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Stack direction="row" gap={1} flexWrap="wrap" mt={1.2}>
                {selected.attachments.map((file) => (
                  <Button key={file.name} variant="outlined" size="small" startIcon={<DescriptionOutlinedIcon />}>{file.name}</Button>
                ))}
              </Stack>
            </Box>
          </Box>

          <Divider />

          <Box sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.2}>
              <Typography fontWeight={800}>工艺要求依赖链（{selected.crafts.length} 项{staleCount > 0 ? ` · ${staleCount} 项过期待重算` : ' · 全部有效'}）</Typography>
              <Typography fontSize={11} color="text.secondary">源（尺寸/批注）→ 工艺依据版本 → 责任人再确认</Typography>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.2 }}>
              <CraftReconfirmPanel sample={selected} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
