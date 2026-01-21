// 随机uuid
export function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/**
 * 根据路径设置嵌套属性
 * @param obj 目标对象
 * @param path 属性路径，如 xxx.xxxx'
 * @param value 要设置的值
 * @returns 新的对象
 */
export function setNestedProperty<T extends Record<string, any>>(
  obj: T,
  path: string,
  value: any,
): T {
  const keys = path.split('.')
  const result = { ...obj }
  let current: any = result

  // 遍历到倒数第二层
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {}
    } else {
      current[key] = { ...current[key] }
    }
    current = current[key]
  }

  // 设置最后一层的值
  const lastKey = keys[keys.length - 1]
  current[lastKey] = value

  return result
}
