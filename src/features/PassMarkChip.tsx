import { Chip, Tooltip } from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import HourglassBottomOutlinedIcon from '@mui/icons-material/HourglassBottomOutlined'
import type { PartKey, Sample } from '../api/types'
import { isPassMarkStale, passMarkFor } from '../features/dependencyChain'

/** 样衣结论（通过标记）：展示判定结果及其依据的规格版本，过期时提示重算 */
export default function PassMarkChip({ sample, partKey }: { sample: Sample; partKey: PartKey }) {
  const mark = passMarkFor(sample, partKey)
  const stale = isPassMarkStale(mark, sample, partKey)
  const currentVersion = sample.measurements['第三轮'].find((m) => m.key === partKey)?.sourceVersion ?? 1

  if (!mark) {
    return <Chip size="small" variant="outlined" label="未判定" />
  }

  if (stale) {
    return (
      <Tooltip title={`旧结论「${mark.result}」依据 v${mark.basisSpecVersion}，当前为 v${currentVersion}，提交修订后自动重算`}>
        <Chip
          size="small" color="warning" variant="outlined"
          icon={<HourglassBottomOutlinedIcon />}
          label={`${mark.result} · 已过期(v${mark.basisSpecVersion})`}
        />
      </Tooltip>
    )
  }

  return (
    <Tooltip title={`依据规格 v${mark.basisSpecVersion} · ${mark.judgedAt}`}>
      <Chip
        size="small"
        icon={mark.result === '通过' ? <CheckCircleOutlineIcon /> : <CancelOutlinedIcon />}
        label={`${mark.result}(v${mark.basisSpecVersion})`}
        color={mark.result === '通过' ? 'success' : 'error'}
      />
    </Tooltip>
  )
}
