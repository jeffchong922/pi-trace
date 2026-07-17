import { type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { persistEvent } from './logger'
import { registerProvider } from './provider'
import { prepareTrace } from './trace'

/**
 * pi-code-agent 扩展入口函数
 * 在扩展加载时自动调用，完成以下初始化：
 * 1. 注册会话启动回调，在编辑区下方显示当前会话 ID
 * 2. 初始化代理服务器和请求追踪功能
 * 3. 注册大模型供应商管理
 * 4. 启动事件持久化记录
 */
export default async function (pi: ExtensionAPI) {

  // 会话启动时在编辑器下方显示当前会话 ID
  pi.on('session_start', async (event, ctx) => {
    ctx.ui.setWidget('session-info-widget', [
      `当前会话: ${ctx.sessionManager.getSessionId()}`
    ], { placement: 'belowEditor' })
  })

  // 依次初始化追踪、供应商注册、事件持久化
  await prepareTrace(pi)
  registerProvider(pi)
  persistEvent(pi)
}
