/**
 * 自定义请求常量，用于在代理请求中传递额外信息
 * 这些键会被附加到请求 payload 中，以 JSON body 形式传递
 */

/** 是否开启请求转发；值为 OnOff 类型 */
export const ForwardRequestKey = 'jeff-forward-request'
/** 当前会话的唯一标识 ID */
export const SessionIdKey = 'jeff-session-id'
/** 会话日志存放路径 */
export const SessionLoggerPathKey = 'jeff-session-logger-path'
/** 当前会话的对话轮次索引 */
export const SessionTurnKey = 'jeff-session-turn'
/** 大模型供应商的原始 API 地址，供代理回源请求时使用 */
export const OriginalUrlKey = 'jeff-request-original-rul'
