/**
 * 设置入口按钮。
 *
 * 对话页与导入页的顶部都要有它，所以抽成一个共用组件，
 * 免得两处各写一份（以及两处各写一份标题文案）。
 */
import { useUiStore } from '../stores/uiStore'

interface SettingsButtonProps {
  /** 紧凑模式：只显示齿轮图标 */
  compact?: boolean
}

function SettingsButton({ compact }: SettingsButtonProps): React.JSX.Element {
  const openSettings = useUiStore((state) => state.openSettings)

  return (
    <button
      type="button"
      className={compact ? 'btn btn-icon' : 'btn btn-soft'}
      title="设置后端地址"
      aria-label="设置"
      onClick={openSettings}
    >
      ⚙️{compact ? '' : ' 设置'}
    </button>
  )
}

export default SettingsButton
