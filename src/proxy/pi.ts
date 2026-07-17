import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 获取项目根目录下的 .pi 配置目录路径
 * .pi 目录用于存放 provider.json 等项目级配置
 */
export function getProjectPiDir() {
  return resolve(process.cwd(), '.pi')
}

/** 检查 .pi 目录是否存在 */
export function isProjectPiDirExist() {
  return existsSync(getProjectPiDir())
}

/** 创建 .pi 目录（递归创建，确保所有父目录存在） */
export function makeProjectPiDir() {
  mkdirSync(getProjectPiDir(), { recursive: true })
}
