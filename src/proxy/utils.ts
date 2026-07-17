import type { OnOff } from "../types"

/** 环境变量键名，用于在进程间传递代理服务器的运行地址 */
export const ServerPersistKey = 'ProxyProviderTraceServer'

/**
 * 将布尔值转换为 OnOff 字符串类型
 * @param bool 布尔值
 * @returns 'on' 或 'off'
 */
export const transformBoolToOnOff = (bool: boolean): OnOff => {
  return bool ? 'on' : 'off'
}

/**
 * 将 OnOff 字符串类型转换为布尔值
 * @param v OnOff 类型的值
 * @returns true 或 false
 */
export const transformOnOffToBool = (v: OnOff) => {
  return v === 'on' ? true : false
}
