import { getPlatform, PlatformType } from '@/shared/utils/platform'

export const isMac = getPlatform() === PlatformType.MacOS
export const isWindows = getPlatform() === PlatformType.Windows
export const isLinux = getPlatform() === PlatformType.Linux
export const isUnknown = getPlatform() === PlatformType.Unknown
