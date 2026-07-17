import { Request } from 'express'
import { resolve } from 'node:path'
import { getRequestInfo } from './utils'
import { writeFileSync } from 'node:fs'

/**
 * 请求日志记录器
 * 负责序列化并持久化每个请求/响应的完整信息到文件系统
 *
 * 使用静态 Map 来跨请求维护每个会话的轮次计数
 */
export default class RequestLogInfo {
  /** 会话 ID -> 当前轮次索引 的映射（静态，跨实例共享） */
  static turnMap = new Map<string, number>

  private requestInfo        // 从请求中解析出的元信息
  private turn: number       // 当前请求的轮次编号
  private responseData: null | { status: number; headers: unknown, body: unknown } = null

  constructor(private request: Request) {
    // 解析请求中的追踪信息
    this.requestInfo = getRequestInfo(request)

    // 确定当前轮次：优先使用请求中传入的 turnIndex，否则从静态 Map 中获取
    this.turn = RequestLogInfo.turnMap.get(this.requestInfo.sessionId) || 1
    if (this.requestInfo.turnIndex) {
      this.turn = this.requestInfo.turnIndex
    }

    // 更新 Map 中的轮次计数（+1 供下次使用）
    RequestLogInfo.turnMap.set(this.requestInfo.sessionId, this.turn + 1)
  }

  /**
   * 将请求和响应信息持久化到磁盘
   * 文件命名格式：{轮次编号（补零2位）}.json
   * 存储路径：{loggerDir}/request/{turn}.json
   */
  save() {
    // 如果没有传入日志路径，则跳过写入
    if (!this.requestInfo.loggerDir) return

    writeFileSync(
      resolve(this.requestInfo.loggerDir, `${String(this.turn).padStart(2, '0')}.json`),
      JSON.stringify(this.getInfo(), undefined, 2)
    )
  }

  /** 设置响应数据，在收到响应后调用 */
  setResponseData(data: typeof this.responseData) {
    this.responseData = data
  }

  /** 组装完整的日志信息对象 */
  private getInfo() {
    return {
      turnIndex: this.turn,
      updateDate: (new Date()).toLocaleString(),
      originalUrl: this.requestInfo.originalUrl,
      request: {
        method: this.request.method,
        path: this.request.path,
        baseUrl: this.request.baseUrl,
        headers: this.request.headers,
        body: this.request.body,
      },
      response: this.responseData
    }
  }
}
