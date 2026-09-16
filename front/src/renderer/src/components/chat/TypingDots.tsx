/**
 * 打字动画（三个跳动的小圆点）。
 *
 * 对应原页面 skeleton 里的 <span class="typing"><span class="dot"/>…</span>。
 */
function TypingDots(): React.JSX.Element {
  return (
    <span className="typing" aria-label="正在处理">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </span>
  )
}

export default TypingDots
