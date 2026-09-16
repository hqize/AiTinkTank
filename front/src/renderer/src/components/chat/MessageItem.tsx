/**
 * 单条消息气泡。
 *
 * 一个气泡里可能出现：打字动画 / 错误说明 / 答案正文+图片 / 阶段进度面板，
 * 组合方式对齐 chat.js 的 addBotMsgSkeleton + renderProgress + finalizeBotAnswer。
 */
import AnswerContent from './AnswerContent'
import ProgressPanel from './ProgressPanel'
import TypingDots from './TypingDots'
import { useChatStore } from '../../stores/chatStore'
import type { ChatMessage } from '../../stores/chatStore'

interface MessageItemProps {
  message: ChatMessage
}

function MessageItem({ message }: MessageItemProps): React.JSX.Element {
  // 只订阅 action（引用恒定），不会因为消息列表变化而额外重渲染
  const setProgressOpen = useChatStore((state) => state.setProgressOpen)

  const isUser = message.role === 'user'
  const hasAnswer = message.text.trim().length > 0

  return (
    <div className={`msg ${isUser ? 'user' : 'bot'}`}>
      {!isUser && <div className="avatar bot">智能客服</div>}

      <div className="msg-body">
        <div className="bubble">
          {message.waiting && <TypingDots />}

          {message.error ? (
            <div className="answer-error">{message.error}</div>
          ) : (
            (hasAnswer || !isUser) && (
              <AnswerContent
                text={message.text}
                images={message.images}
                // 还在等第一批增量时不要提前显示"未返回答案"
                placeholder={message.waiting ? '' : undefined}
              />
            )
          )}

          {message.progress && (
            <ProgressPanel
              progress={message.progress}
              open={message.progressOpen}
              onToggle={(open) => setProgressOpen(message.id, open)}
            />
          )}
        </div>

        <div className="meta">{message.hint ?? message.time}</div>
      </div>

      {isUser && <div className="avatar">我</div>}
    </div>
  )
}

export default MessageItem
