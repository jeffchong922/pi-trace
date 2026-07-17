import express from 'express'
import { getRequestInfo } from '../utils'
import RequestLogInfo from '../RequestLogInfo'

/** 流式响应中的 choices 数组结构 */
type ResponseChoices = Array<{
  index: number;
  delta?: {
    role: string | undefined;
    content: string | null;
    reasoning_content: string | null;
    tool_calls: Array<{
      id: string | null;
      index: number;
      type: string | undefined;
      function: {
        name: string | null;
        arguments: string | null;
      } | null;
    }> | null;
  }
}>

/** 复原后的完整 choice 数据（聚合了流式 delta 片段） */
type ChoiceValue = {
  role: string;
  content: string;
  reasoning_content: string;
  functionList: Array<{
    id: string
    type: string
    functionName: string
    functionArgs: string
  }> | null
}

/**
 * OpenAI 兼容 API 代理路由器
 * 核心功能：
 * - 接收来自 pi 扩展的请求（已经过代理中间层处理）
 * - 将请求转发到真实的大模型 API（如 DeepSeek）
 * - 以 SSE（Server-Sent Events）流式方式回传响应
 * - 聚合流式 delta 片段，记录完整的请求和响应日志
 */
export const openaiRouter = express.Router({
  caseSensitive: true,
  strict: true,
})

/**
 * POST /chat/completions
 * 代理处理聊天补全请求
 */
openaiRouter.post('/chat/completions', async (request, response) => {
  // 解析请求中的追踪信息
  const { forwardRequest, forwardBody, originalUrl } = getRequestInfo(request)
  // 创建请求日志记录器，并立即保存初始请求信息
  const requestLogInfo = new RequestLogInfo(request)
  requestLogInfo.save()

  let responseStatus = 500
  let responseHeaders: Headers | null = null
  let responseData = null

  // 如果需要转发请求且原始 URL 有效，则进行代理转发
  if (forwardRequest && !!originalUrl) {
    // 设置 SSE 流式响应头
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('Access-Control-Allow-Origin', '*')

    // 复制客户端请求头，过滤掉不需要转发的 headers
    const requestHeaders = new Headers()
    Object.keys(request.headers).forEach(key => {
      const excludeHeaders = ['host', 'connection', 'content-length']
      if (excludeHeaders.includes(key)) return

      const headersValues = request.headers[key]
      if (!headersValues) return
      if (Array.isArray(headersValues)) {
        headersValues.forEach(value => {
          requestHeaders.append(key, value)
        })
      } else {
        requestHeaders.set(key, headersValues)
      }
    })

    try {
      // 向原始 API 发起请求
      const res = await fetch(new URL('/chat/completions', originalUrl), {
        method: 'post',
        headers: requestHeaders,
        body: JSON.stringify(forwardBody)
      })

      // 如果上游返回错误状态，抛出异常
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`DeepSeek API error: ${response.status} ${errorText}`);
      }

      responseStatus = res.status
      responseHeaders = res.headers

      // 获取流式读取器
      const reader = res.body!.getReader()

      // 用于聚合流式 delta 片段，key 为 choice 的 index
      const choiceMap = new Map<number, ChoiceValue>()
      const decoder = new TextDecoder()
      let buffer = ''  // 缓冲区，用于处理不完整的 SSE 数据行

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // 将上游数据直接透传给客户端
          response.write(value)

          // 解析 SSE 数据流，聚合每个 choice 的完整内容
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          // 最后一行可能是不完整的数据，保留到下次循环
          buffer = lines[lines.length - 1] || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            // SSE 结束标记
            if (trimmed === 'data: [DONE]') {
              continue
            }
            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.substring(String('data: ').length)
              try {
                const parsed = JSON.parse(jsonStr)
                // 保存最后一条有效数据作为响应快照
                responseData = parsed
                if (!!parsed.choices) {
                  // 遍历 choices，聚合 delta 内容
                  (parsed.choices as ResponseChoices).forEach((choice) => {
                    const index = choice.index
                    // 初始化或获取已有的聚合数据
                    const currentData = choiceMap.get(index) || {
                      role: 'assistant',
                      content: '',
                      reasoning_content: '',
                      functionList: null
                    }
                    if (!!choice.delta) {
                      // 聚合角色
                      if (!!choice.delta.role) {
                        currentData.role = choice.delta.role
                      }
                      // 聚合文本内容（追加）
                      if (!!choice.delta.content) {
                        currentData.content += choice.delta.content
                      }
                      // 聚合推理内容（追加）
                      if (!!choice.delta.reasoning_content) {
                        currentData.reasoning_content += choice.delta.reasoning_content
                      }
                      // 聚合工具调用信息
                      if (!!choice.delta.tool_calls) {
                        choice.delta.tool_calls.forEach(item => {
                          const toolIndex = item.index
                          if (typeof toolIndex !== 'number') return
                          currentData.functionList = currentData.functionList || []
                          const functionInfo = currentData.functionList[toolIndex] || {
                            id: '',
                            type: 'function',
                            functionName: '',
                            functionArgs: ''
                          }

                          // 工具调用的各字段可能在不同 delta 中分开发送
                          if (!!item.id) {
                            functionInfo.id = item.id
                          }
                          if (!!item.type) {
                            functionInfo.type = item.type
                          }
                          if (!!item.function) {
                            if (!!item.function.name) {
                              functionInfo.functionName += item.function.name
                            }
                            if (!!item.function.arguments) {
                              functionInfo.functionArgs += item.function.arguments
                            }
                          }

                          currentData.functionList[toolIndex] = functionInfo
                        })
                      }
                    }
                    choiceMap.set(index, currentData)
                  })
                }
              } catch (e) {
                // JSON 解析失败时忽略，可能是不完整的 chunk
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      response.end()

      // 将聚合后的完整内容回填到 responseData 中
      // 这样日志文件中记录的是完整的响应内容，而非流式片段
      if (!!responseData && !!responseData.choices) {
        (responseData.choices as ResponseChoices).forEach(item => {
          const result = choiceMap.get(item.index)
          if (!!result && !!item.delta) {
            item.delta.content = result.content
            item.delta.reasoning_content = result.reasoning_content
            item.delta.role = result.role
            if (!!result.functionList) {
              item.delta.tool_calls = result.functionList.map((f, index) => ({
                id: f.id,
                index: index,
                type: f.type,
                function: {
                  name: f.functionName,
                  arguments: f.functionArgs
                }
              }))
            }
          }
        })
      }
    } catch (error) {
      console.error('Error:', error);
      // 发生错误时也通过 SSE 格式告知客户端
      response.write(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
    }
  } else {
    // 不转发时返回 401
    response.status(401).send('')
  }

  // 记录响应信息，并再次保存日志（此时包含响应数据）
  requestLogInfo.setResponseData({
    status: responseStatus,
    headers: responseHeaders,
    body: responseData,
  })
  requestLogInfo.save()
})
