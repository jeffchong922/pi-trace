import { type ExtensionAPI, type ExtensionContext, DynamicBorder } from '@earendil-works/pi-coding-agent'
import { type Model, type Api } from '@earendil-works/pi-ai'
import { type SelectItem, Container, SelectList, Text } from "@earendil-works/pi-tui"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from 'node:path'
import { getProjectPiDir, isProjectPiDirExist, makeProjectPiDir } from './pi'
import { ServerPersistKey } from './utils'

/** 单个供应商的配置信息 */
type ProviderInfo = Partial<{
  name: string                // 供应商显示名称
  originalUrl: string         // 原始 API 地址（在被代理替换之前保存的地址）
  proxyUrl: string            // 代理转发的目标地址
  apiKey: string              // API 密钥
  defaultModel: string        // 默认使用的大模型 ID
  defaultModelApi: string     // 默认模型的 API 路径
}>

/** 所有供应商的记录映射，key 为供应商标识 */
type ProviderRecord = Record<string, ProviderInfo>

/** provider.json 的完整配置结构 */
type ProviderSettings = Partial<{
  defaultProvider: string      // 当前默认供应商
  useProxy: boolean            // 是否使用代理路径
  proxyForwardRequest: boolean // 代理是否转发请求
  providers: ProviderRecord    // 供应商配置记录
}>

/** 配置文件名称 */
const providerFileName = 'provider.json'

/**
 * 注册大模型供应商管理功能
 * - 监听会话启动事件，根据当前模型自动更新供应商配置
 * - 监听模型选择事件，持久化默认模型
 * - 注册 /provider 命令，允许用户通过 TUI 选择供应商
 */
export function registerProvider(pi: ExtensionAPI) {
  // 会话启动时，根据当前使用的模型自动更新供应商配置
  pi.on('session_start', (event, ctx) => {
    const providerKey = ctx.model ? ctx.model.provider : ''
    updateProvider(pi, providerKey, ctx)
  })

  // 当用户手动选择模型后，更新 provider.json 中的默认模型
  pi.on('model_select', (event) => {
    // 只有手动选择时才触发更新（source !== 'set' 表示用户主动操作）
    if (event.source !== 'set') return
    const providerSettings = getProviderSettings()
    const providerRecord = providerSettings.providers || {}
    const selectProvider = providerRecord[event.model.provider] || {}
    updateProviderSettings({
      defaultProvider: event.model.provider,
      providers: {
        ...providerRecord,
        [event.model.provider]: {
          ...selectProvider,
          defaultModel: event.model.id
        }
      }
    })
  })

  // 注册 /provider 命令：通过 TUI 交互式选择大模型供应商
  pi.registerCommand('provider', {
    description: '选择大模型供应商',
    handler: async (args, ctx) => {
      const availableProvideIds = new Set<string>()

      // 从配置文件中收集已知供应商
      const providerRecord = getProviderRecord()
      Object.keys(providerRecord).forEach(key => {
        availableProvideIds.add(key)
      })
      // 从模型注册表中收集当前可用的供应商
      ctx.modelRegistry.getAvailable().forEach(model => {
        availableProvideIds.add(model.provider)
      })

      // 渲染供应商选择 TUI 界面
      const result = await ctx.ui.custom<string | null>((tui, theme, keybindings, done) => {
        const items: SelectItem[] = []
        availableProvideIds.forEach(id => {
          items.push({ value: id, label: (providerRecord[id] || {}).name || id })
        })

        const container = new Container()
        // 顶部边框
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

        container.addChild(new Text(theme.fg("accent", theme.bold("选择大模型")), 1, 1));

        // 带主题的 SelectList 组件
        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
          description: (t) => theme.fg("muted", t),
          scrollInfo: (t) => theme.fg("dim", t),
          noMatch: (t) => theme.fg("warning", t),
        });
        selectList.onSelect = (item) => done(item.value);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);
        // 操作提示
        container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
        // 底部边框
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        return {
          render: (w) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data) => { selectList.handleInput(data); tui.requestRender(); }
        }
      })

      // 用户选择了供应商后，立即更新配置
      if (result) {
        updateProvider(pi, result, ctx)
      }
    }
  })
}

/**
 * 核心函数：更新供应商配置并使其立即生效
 * - 保存原始 baseUrl
 * - 计算代理 URL
 * - 重新注册 provider 并切换模型
 *
 * @param pi ExtensionAPI 实例
 * @param key 供应商标识（可选，默认使用配置中的 defaultProvider）
 * @param ctx 扩展上下文（可选，用于获取可用模型列表）
 */
export function updateProvider(pi: ExtensionAPI, key?: string, ctx?: ExtensionContext) {
  const providerSettings = getProviderSettings()
  const usedProviderKey = key || providerSettings.defaultProvider

  if (!usedProviderKey || usedProviderKey === 'unknown') return

  const providerRecord = providerSettings.providers || {}
  const providerInfo = { ...(providerRecord[usedProviderKey] || {}) }

  let finalUseModel: Model<Api> | null = null
  // 如果有上下文，从可用模型中匹配当前 provider 的模型
  const updateFinalUseModalAndProviderInfo = () => {
    if (!!ctx) {
      const defaultModel = providerInfo.defaultModel
      const availableModelList = ctx.modelRegistry.getAvailable()
      for (const model of availableModelList) {
        if (model.provider !== usedProviderKey) continue
        // 优先取第一个匹配的模型
        if (!finalUseModel) finalUseModel = model
        // 如果有保存的默认模型，优先使用它
        if (!!defaultModel && defaultModel === model.id) {
          finalUseModel = model
          break
        }
      }

      if (!!finalUseModel) {
        const innerServerUrl = process.env[ServerPersistKey] || ''
        // 如果当前模型还没有被代理过，保存原始 baseUrl
        if (
          !(!!innerServerUrl && finalUseModel.baseUrl.startsWith(innerServerUrl))
          && !(!!providerInfo.proxyUrl && finalUseModel.baseUrl.startsWith(providerInfo.proxyUrl))
        ) {
          providerInfo.originalUrl = finalUseModel.baseUrl
        }
        providerInfo.defaultModel = finalUseModel.id
        providerInfo.defaultModelApi = finalUseModel.api
      }
    }
  }
  // 如果是在 auth.json 注册的，那么这里可以获取到
  updateFinalUseModalAndProviderInfo()

  // 计算代理 URL：优先使用配置中的 proxyUrl，其次使用环境变量中的服务器地址
  let proxyUrl = providerInfo.proxyUrl || process.env[ServerPersistKey]
  if (!!proxyUrl && !providerInfo.proxyUrl) {
    // 如果是内部服务器地址，拼接 API 路径
    proxyUrl = (new URL(providerInfo.defaultModelApi || '/openai-completions', proxyUrl)).href
  }

  // 如果启用了代理，使用代理 URL，否则使用 undefined
  const baseUrl = providerSettings.useProxy ? proxyUrl : undefined

  // 注销旧的 provider，重新注册新的（更新 baseUrl 和 apiKey）
  pi.unregisterProvider(usedProviderKey)
  pi.registerProvider(usedProviderKey, {
    baseUrl: baseUrl || undefined,
    apiKey: providerInfo.apiKey || undefined,
  })

  // 切换模型到匹配的模型（使用新的 baseUrl）
  const updateModel = () => {
    if (!finalUseModel) return
    const model = finalUseModel as Model<Api>
    pi.setModel({
      ...model,
      baseUrl: baseUrl ? baseUrl : model.baseUrl
    })
  }
  if (!!finalUseModel) {
    updateModel()
  } else {
    // 通过 /provider 并且 根据额 provider.json 注册的，需要重新获取 model
    updateFinalUseModalAndProviderInfo()
    updateModel()
  }

  // 持久化更新后的配置到 provider.json
  updateProviderSettings({
    ...providerSettings,
    defaultProvider: usedProviderKey,
    providers: {
      ...providerRecord,
      [usedProviderKey]: providerInfo
    }
  })
}

/**
 * 从 .pi/provider.json 中读取供应商配置
 * @returns 配置对象，如果文件不存在或读取失败则返回空对象
 */
export function getProviderSettings() {
  let result: ProviderSettings = {}
  if (!isProjectPiDirExist()) return result
  try {
    const content = JSON.parse(readFileSync(resolve(getProjectPiDir(), providerFileName), {
      encoding: 'utf8'
    }))
    result = content as ProviderSettings
  } catch (e) {
    // 读取失败可能是因为文件尚未创建，返回空配置
  }
  return result
}

/**
 * 更新/持久化供应商配置到 .pi/provider.json
 * 会将新数据与现有配置合并
 */
export function updateProviderSettings(data: ProviderSettings) {
  if (!isProjectPiDirExist()) {
    makeProjectPiDir()
  }
  const currentSettings = getProviderSettings()
  writeFileSync(resolve(getProjectPiDir(), providerFileName), JSON.stringify(Object.assign({}, currentSettings, data), undefined, 2), { encoding: 'utf8' })
}

/** 获取供应商记录映射（从配置中提取 providers 字段） */
function getProviderRecord() {
  return getProviderSettings().providers || {}
}
