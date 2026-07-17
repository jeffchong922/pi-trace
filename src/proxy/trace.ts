import { type ExtensionAPI, type ExtensionContext, DynamicBorder, getSettingsListTheme } from '@earendil-works/pi-coding-agent'
import { type SettingItem, Container, SettingsList, Text } from "@earendil-works/pi-tui"
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { startServer } from '../server/app'
import { getProviderSettings, updateProvider, updateProviderSettings } from './provider'
import { ServerPersistKey, transformBoolToOnOff, transformOnOffToBool } from './utils'
import { getLoggerDirFromContext } from './logger'
import { ForwardRequestKey, OriginalUrlKey, SessionIdKey, SessionLoggerPathKey, SessionTurnKey } from '../constant/requestFlag'

import type { OnOff } from '../types'

/**
 * 初始化代理追踪功能
 * 1. 启动/连接 Express 代理服务器
 * 2. 注册会话启动回调，显示当前代理状态
 * 3. 在每次「请求发送前」将追踪信息注入到请求 payload 中
 * 4. 注册 /proxy 命令，允许用户通过 TUI 切换代理设置
 */
export async function prepareTrace(pi: ExtensionAPI) {
  let startServerResult: string = process.env[ServerPersistKey] || ''
  let startServerErrorMsg: string = ''
  try {
    // 健康检查：如果已有服务器地址，先尝试连接
    let serverStarted = false
    if (startServerResult) {
      try {
        const res = await fetch(new URL('/health', startServerResult))
        if (res.status === 200) serverStarted = true
      } catch (e) {
        // 连接失败，说明之前的服务器已经不可用
      }
    }
    // 如果服务器未启动或不可用，重新启动
    if (!serverStarted) {
      startServerResult = await startServer()
      // 将运行地址写入环境变量，供其他模块使用
      process.env[ServerPersistKey] = startServerResult
    }
  } catch (e) {
    startServerErrorMsg = (e as Error).message
    delete process.env[ServerPersistKey]
    console.error(e)
  }

  /** 在编辑器下方刷新代理状态信息 */
  const showCurrentProxyStatus = (ctx: ExtensionContext) => {
    const providerSettings = getProviderSettings()
    ctx.ui.setWidget('proxy-widget', [
      `是否使用代理路径: ${providerSettings.useProxy ? '是' : '否'}`,
      `代理是否转发请求: ${providerSettings.proxyForwardRequest ? '是' : '否'}`
    ], { placement: 'belowEditor' })
  }

  // 会话启动时通知用户代理服务器的运行地址
  pi.on('session_start', (event, ctx) => {
    ctx.ui.notify(`当前服务运行地址: ${startServerResult || startServerErrorMsg}`)
    showCurrentProxyStatus(ctx)
  })

  // 在请求发送给大模型之前，注入追踪所需的元信息
  pi.on('before_provider_request', (event, ctx) => {
    const requestPayload: Record<string, unknown> = {
      ...(event.payload || {})
    }

    // 获取日志目录和轮次索引
    const loggerDir = getLoggerDirFromContext(ctx)
    const turnIndex = getTraceTurnIdx(loggerDir)
    updateTraceTurnIdx(loggerDir)  // 递增轮次索引，供下次使用

    const providerSettings = getProviderSettings()
    if (providerSettings.useProxy) {
      // 将追踪信息附加到请求 payload 中
      requestPayload[SessionIdKey] = ctx.sessionManager.getSessionId()
      requestPayload[SessionTurnKey] = String(turnIndex)
      requestPayload[ForwardRequestKey] = transformBoolToOnOff(!!providerSettings.proxyForwardRequest)
      requestPayload[SessionLoggerPathKey] = loggerDir
      if (providerSettings.defaultProvider) {
        const providerInfo = (providerSettings.providers || {})[providerSettings.defaultProvider] || {}
        requestPayload[OriginalUrlKey] = providerInfo.originalUrl
      }
    }

    return requestPayload
  })

  // 注册 /proxy 命令，用户可以通过 TUI 交互式地切换代理设置
  pi.registerCommand('proxy', {
    description: '切换代理设置',
    handler: async (args, ctx) => {
      const providerSettings = getProviderSettings()

      // 当前代理设置（从配置文件中读取）
      const currentProxySettings = {
        useProxy: !!providerSettings.useProxy,
        proxyForwardRequest: !!providerSettings.proxyForwardRequest
      }
      // 用户在 TUI 中修改后的设置
      const changeProxySettings = { ...currentProxySettings }

      type ProxySettingsKey = keyof typeof currentProxySettings

      /** 检查用户是否实际修改了设置 */
      const isChanged = () => {
        let result = false
        Object.keys(currentProxySettings).forEach(key => {
          if (currentProxySettings[key as ProxySettingsKey] !== changeProxySettings[key as ProxySettingsKey]) {
            result = true
          }
        })
        return result
      }

      // 构建设置项列表
      const items: SettingItem[] = [
        { id: "useProxy", label: "是否使用代理路径", currentValue: transformBoolToOnOff(currentProxySettings.useProxy), values: ["on", "off"] },
        { id: "proxyForwardRequest", label: "是否让代理转发请求", currentValue: transformBoolToOnOff(currentProxySettings.proxyForwardRequest), values: ["on", "off"] },
      ];

      // 渲染 TUI 设置界面
      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        const container = new Container();

        // 顶部边框
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

        container.addChild(new Text(theme.fg("accent", theme.bold("代理设置")), 1, 1));

        // 使用 SettingsList 组件展示可切换的设置项
        const settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 15),
          getSettingsListTheme(),
          // 值变更回调：将 TUI 中的 on/off 转换回布尔值
          (id, newValue) => {
            changeProxySettings[(id as ProxySettingsKey)] = transformOnOffToBool(newValue as OnOff)
          },
          () => done(),  // 用户关闭设置面板
        );
        container.addChild(settingsList);

        // 底部边框
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

        return {
          render: (w) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data) => settingsList.handleInput?.(data),
        };
      });

      // 如果设置发生了变化，持久化并立即生效
      if (isChanged()) {
        updateProviderSettings({
          useProxy: changeProxySettings.useProxy,
          proxyForwardRequest: changeProxySettings.proxyForwardRequest,
        })
        showCurrentProxyStatus(ctx)
        // 刷新 provider 配置，使代理设置立即生效
        updateProvider(pi, undefined, ctx)
      }
    }
  })
}

/** 确保目录存在，不存在则递归创建 */
function ensureDirExist(filePath: string) {
  const dirPath = dirname(filePath)
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/** 从 trace-info.json 中读取追踪信息 */
const getTraceInfoContent = (dir: string) => {
  let result: Record<string, unknown> = {}
  try {
    const infoFilePath = resolve(dir, 'trace-info.json')
    const content = readFileSync(infoFilePath, { encoding: 'utf8' })
    result = JSON.parse(content)
  } catch (e) {
    // 文件可能尚不存在，返回空对象
  }
  return result
}

/** 将追踪信息写入 trace-info.json */
const updateTraceInfoContent = (dir: string, data: unknown) => {
  let result: Record<string, unknown> = {}
  const infoFilePath = resolve(dir, 'trace-info.json')
  try {
    ensureDirExist(infoFilePath)
    writeFileSync(infoFilePath, JSON.stringify(data, undefined, 2), { encoding: 'utf8' })
  } catch (e) {
    // 写入失败时静默处理
  }
  return result
}

/** 获取当前会话的下一个轮次索引 */
export const getTraceTurnIdx = (dir: string) => {
  const info = getTraceInfoContent(dir)
  return Number(info.waitToUseTurnIndex || 1)
}

/** 递增轮次索引，每次请求前调用 */
export const updateTraceTurnIdx = (dir: string) => {
  const info = getTraceInfoContent(dir)
  info.waitToUseTurnIndex = (info.waitToUseTurnIndex as number || 1) + 1
  updateTraceInfoContent(dir, info)
}
