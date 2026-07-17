import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Request } from 'express'
import { ForwardRequestKey, OriginalUrlKey, SessionIdKey, SessionLoggerPathKey, SessionTurnKey } from '../constant/requestFlag'
import type { OnOff } from '../types'

/**
 * 从请求中提取追踪相关信息
 * 解析请求 body 中的自定义字段（由 before_provider_request 钩子注入），
 * 移除这些内部字段，返回干净的转发请求体
 *
 * @param request Express 请求对象
 * @returns 解析后的请求元信息
 */
export function getRequestInfo(request: Request) {
  const payload = {
    ...(request.body || {})
  }
  // 提取各个追踪字段
  const forwardRequest = (payload[ForwardRequestKey] || 'off') as OnOff
  const originalUrl = payload[OriginalUrlKey] || ''
  const sessionId = payload[SessionIdKey] || generateShortUID()
  const turnIndex = payload[SessionTurnKey] || ''
  let loggerDir = payload[SessionLoggerPathKey] || ''
  if (!!loggerDir) {
    // 日志存储到 request 子目录下
    loggerDir = resolve(loggerDir, 'request')
    ensureDirExist(loggerDir)
  }

  // 删除内部字段，避免传递给上游 API
  delete payload[ForwardRequestKey]
  delete payload[SessionIdKey]
  delete payload[SessionTurnKey]
  delete payload[SessionLoggerPathKey]
  delete payload[OriginalUrlKey]

  return {
    loggerDir,                                       // 请求日志存放目录
    sessionId,                                       // 会话 ID
    originalUrl,                                     // 原始 API 地址
    forwardRequest: forwardRequest === 'on',          // 是否需要转发请求
    turnIndex: !!turnIndex ? Number(turnIndex) : null, // 对话轮次索引
    forwardBody: payload,                            // 清理后的请求体（用于转发）
  }
}

/**
 * 生成一个短唯一标识符
 * 用于在没有显式传入会话 ID 时自动生成
 *
 * @param length 标识符长度，默认 12 位
 * @returns 随机字符串
 */
function generateShortUID(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/** 确保目录存在，不存在则递归创建 */
function ensureDirExist(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
