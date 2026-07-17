import express from 'express'
import { openaiRouter } from './router/openai'

/**
 * 启动 Express 代理服务器
 * 监听一个随机可用端口，返回服务器运行地址（http://localhost:PORT）
 *
 * 路由说明：
 * - GET  /health               健康检查端点
 * - POST /openai-completions   代理转发 OpenAI 兼容 API 请求
 * - 其他路由返回 500 错误
 *
 * @returns Promise，resolve 为服务器完整 URL
 */
export function startServer() {
  return new Promise<string>((resolve, reject) => {
    const app = express()
    // 解析 JSON 请求体
    app.use(express.json({ limit: '100mb' }))

    // 健康检查端点
    app.get('/health', (request, response) => {
      response.status(200).json("Health Check")
    })

    // OpenAI 兼容 API 代理路由
    app.use('/openai-completions', openaiRouter)

    // 未知路由返回 500
    app.use((request, response) => {
      response.status(500)
      response.json('Error Route')
    })

    // 监听随机端口（port: 0）
    const server = app.listen(0, (error) => {
      if (error) {
        server.close()
        reject(error)
        return
      }
      const addressInfo = server.address()
      if (!addressInfo || typeof addressInfo === 'string') {
        server.close()
        reject(new Error('Cant not get the port'))
        return
      }

      // 返回完整的服务器地址
      resolve(`http://localhost:${addressInfo.port}`)
    })
  })
}
