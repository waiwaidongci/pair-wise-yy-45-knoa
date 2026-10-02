import { Alert, Box, Chip, Stack, Typography } from '@mui/material'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import type { PartKey, Sample } from '../api/types'
import { craftStalePartKeys, isPassMarkStale, partName, passMarkFor, staleCrafts } from '../features/dependencyChain'

/** 统一的"哪里过期"提示：列出过期部位、受影响工艺与通过标记 */
export default function StaleBanner({ sample, compact = false }: { sample: Sample; compact?: boolean }) {
  const crafts = staleCrafts(sample)
  const staleMarkParts = sample.measurements['第三轮']
    .filter((m) => isPassMarkStale(passMarkFor(sample, m.key), sample, m.key))
    .map((m) => m.key)

  if (crafts.length === 0 && staleMarkParts.length === 0) {
    return (
      <Alert severity="success" sx={{ mb: compact ? 1 : 1.5 }} icon={<WarningAmberOutlinedIcon fontSize="inherit" />}>
        依赖链全部为最新：尺寸/批注源与工艺要求、样衣结论版本一致，可按当前资料开裁。
      </Alert>
    )
  }

  const partSet = new Set<string>()
  crafts.forEach((craft) => craftStalePartKeys(craft, sample).forEach((key) => partSet.add(key)))
  staleMarkParts.forEach((key) => partSet.add(key))

  return (
    <Alert severity="warning" sx={{ mb: compact ? 1 : 1.5, alignItems: 'center' }}>
      <Stack spacing={0.6}>
        <Typography fontWeight={750} fontSize={13}>
          {partSet.size} 个部位的源资料已变更，下游结论过期，工厂不得按旧资料开裁
        </Typography>
        <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
          {[...partSet].map((key) => (
            <Chip key={key} size="small" color="warning" variant="outlined" label={partName(key as PartKey)} />
          ))}
        </Stack>
        {!compact && (
          <Box fontSize={12} color="text.secondary">
            {crafts.length > 0 && (
              <div>待重算工艺：{crafts.map((craft) => `「${craft.name}」(${craft.owner})`).join('、')}</div>
            )}
            {staleMarkParts.length > 0 && (
              <div>待重算通过标记：{staleMarkParts.map((key) => partName(key)).join('、')}（提交修订后系统按新规格幂等重算）</div>
            )}
          </Box>
        )}
      </Stack>
    </Alert>
  )
}
