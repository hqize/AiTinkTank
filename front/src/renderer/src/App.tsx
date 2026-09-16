/**
 * 渲染层入口组件。
 *
 * 网页版是两个独立 HTML（chat.html / import.html），
 * 桌面端合并成单窗口双视图，外壳见 components/AppShell.tsx。
 */
import AppShell from './components/AppShell'

function App(): React.JSX.Element {
  return <AppShell />
}

export default App
