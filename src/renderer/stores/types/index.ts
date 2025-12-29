import type { Font, FontConfig, FontSizeConfig } from '@/types/font'
import type { Theme, ThemeName } from '@/types/theme'

// ==================== Config Store ====================
export interface ConfigStore {
  lang: string
  /** 拼写检查 */
  spellcheck: boolean
  /** 字体配置 */
  font: {
    family: FontConfig
    size: FontSizeConfig
  }
  /** 编辑器配置 */
  editor: {
    padding: string
  }
}

// ==================== Upload Store ====================
export type RequestMethod = 'post' | 'put'
export type BodyType = 'multipart/form-data' | 'application/json' | 'application/x-www-form-urlencoded'

export interface UploadStore {
  /** 上传地址 */
  url: string
  /** 请求方法 */
  method: RequestMethod
  /** 请求头 */
  headers: Record<string, string>
  /** Body 类型 */
  bodyType: BodyType
  /** 文件字段名 */
  fileField: string
  /** 响应中图片 URL 的路径 */
  responseUrlPath: string
  /** 额外的 Body 参数 */
  extraBody: Record<string, unknown>
}

// ==================== Image Store ====================
export type PasteMethod = 'local' | 'base64' | 'remote'

export interface ImageStore {
  /** 粘贴方式 */
  pasteMethod: PasteMethod
  /** 本地图片保存路径 */
  localPath: string
}

// ==================== Theme Store ====================
export interface ThemeStore {
  /** 当前主题名称 */
  current: ThemeName
  /** 自定义主题列表 */
  customThemes: Theme[]
  /** 正在编辑的主题名称 */
  editingTheme: ThemeName | null
}

// ==================== Update Store ====================
export interface UpdateInfo {
  version: string
  url: string
  releaseNotes?: string
  [key: string]: unknown
}

export interface UpdateStore {
  /** 更新信息 */
  info: UpdateInfo | null
  /** 忽略的版本号 */
  ignoredVersion: string
}

// ==================== 导出类型工具 ====================
export type { Font, FontConfig, FontSizeConfig, Theme, ThemeName }
