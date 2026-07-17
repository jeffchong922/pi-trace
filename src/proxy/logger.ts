import { type ExtensionAPI, type ExtensionHandler, type ExtensionContext } from '@earendil-works/pi-coding-agent'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** 通用事件类型，包含事件名 */
type CommonEvent = {
  type: string
}

/**
 * 持久化所有 pi 框架产生的事件到文件系统中
 * 通过遍历 eventNames 列表，为每个事件注册回调，
 * 在回调中将事件数据写入到对应的事件日志文件中
 *
 * @param pi ExtensionAPI 实例
 */
export function persistEvent(pi: ExtensionAPI) {
  // 需要监听并持久化的所有事件名列表
  const eventNames = [
    'session_start',          // 会话启动
    'resources_discover',     // 资源发现

    'input',                  // 用户输入
    'before_agent_start',     // agent 启动前
    'agent_start',            // agent 启动
    'message_start',          // 消息开始
    // 'message_update',      // 消息更新 — 流式传输时会触发非常多次，暂不记录
    'message_end',            // 消息结束

    'turn_start',             // 对话轮次开始
    'context',                // 上下文信息
    'before_provider_headers', // 请求头准备前
    'before_provider_request', // 请求发送前
    'after_provider_response', // 收到响应后

    'tool_execution_start',   // 工具调用开始
    'tool_call',              // 工具调用
    'tool_execution_update',  // 工具调用更新
    'tool_result',            // 工具返回结果
    'tool_execution_end',     // 工具调用结束

    'turn_end',               // 对话轮次结束

    'agent_end',              // agent 结束
    'agent_settled',          // agent 稳定/就绪

    'session_before_switch',  // 会话切换前
    'session_before_fork',    // 会话分叉前
    'session_info_changed',   // 会话信息变更
    'session_compact',        // 会话压缩

    'session_before_tree',    // 生成会话树前
    'session_tree',           // 会话树

    'session_shutdown',       // 会话关闭

    'thinking_level_select',  // 选择思考层级
    'model_select',           // 选择模型
  ] as const
  eventNames.forEach(name => {
    const callback: ExtensionHandler<CommonEvent> = (event, ctx) => {
      // 每个事件都会记录到 summary.txt（汇总）中
      appendSummary(ctx, event, formatJSON(event))
    }
    pi.on(name as any, callback)
  })
}

/**
 * 根据上下文获取日志目录路径
 * 目录格式为：项目根目录/.traces/<会话ID>
 */
export function getLoggerDirFromContext(ctx: ExtensionContext) {
  return resolve(ctx.cwd, '.traces', ctx.sessionManager.getSessionId())
}

/** 生成分割线文本，用于在日志文件中分隔不同事件 */
function createSlashTextFromEvent(event: CommonEvent, desc?: string) {
  desc = desc || 'event'
  return `[${event.type}]: ${desc}`
}

/** 确保文件所在的目录存在，不存在则递归创建 */
function ensureDirExist(filePath: string) {
  const dirPath = dirname(filePath)
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/** 向指定文件追加内容，并添加分割线标记 */
function appendContent(filePath: string, data: string, slashText: string = 'slash') {
  if (!filePath) return
  ensureDirExist(filePath)
  appendFileSync(filePath, `\n\n----------------${slashText}----------------\n\n` + data, {
    encoding: 'utf8',
  })
}

/**
 * 向指定日志目录追加事件数据
 * 每个事件类型会写入到独立的文件中，例如 tool_call.txt、turn_start.txt
 *
 * @param logDir 日志目录路径或 ExtensionContext 对象
 * @param event 事件对象
 * @param data 要写入的数据
 * @param desc 事件描述（可选）
 */
export function appendEvent(logDir: string | ExtensionContext, event: CommonEvent, data: string, desc?: string) {
  if (typeof logDir !== 'string') {
    logDir = getLoggerDirFromContext(logDir)
  }

  appendContent(resolve(logDir, `${event.type}.txt`), data, createSlashTextFromEvent(event, desc))
}

/**
 * 向 summary.txt 汇总文件追加事件摘要
 * 所有事件都会汇总到同一个文件中，方便整体查看
 */
function appendSummary(logDir: string | ExtensionContext, event: CommonEvent, data: string) {
  if (typeof logDir !== 'string') {
    logDir = getLoggerDirFromContext(logDir)
  }

  appendContent(resolve(logDir, 'summary.txt'), data, createSlashTextFromEvent(event))
}

/**
 * 将任意数据格式化为易读的 JSON 字符串（带缩进）
 * @param data 任意数据
 * @returns 格式化后的 JSON 字符串
 */
export function formatJSON(data: unknown) {
  return JSON.stringify(data, undefined, 2)
}
