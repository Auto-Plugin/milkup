export enum PlatformType {
  Windows = 'win32',
  MacOS = 'darwin',
  Linux = 'linux',
  Unknown = 'unknown',
}

export function getPlatform(): PlatformType {
  if (typeof process === 'undefined' || !process.platform)
    return PlatformType.Unknown

  switch (process.platform) {
    case 'win32':
      return PlatformType.Windows
    case 'darwin':
      return PlatformType.MacOS
    case 'linux':
      return PlatformType.Linux
    default:
      return PlatformType.Unknown
  }
}

export function isWindows(): boolean {
  return getPlatform() === PlatformType.Windows
}

export function isMac(): boolean {
  return getPlatform() === PlatformType.MacOS
}

export function isLinux(): boolean {
  return getPlatform() === PlatformType.Linux
}
