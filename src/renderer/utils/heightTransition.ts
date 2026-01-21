/**
 * 高度过渡动画工具函数
 * 提供统一的过渡动画效果处理
 */

export interface TransitionConfig {
  duration?: number
  blurAmount?: number
  scaleAmount?: number
  translateY?: number
}

/**
 * 默认过渡配置
 */
const defaultConfig: Required<TransitionConfig> = {
  duration: 300,
  blurAmount: 20,
  scaleAmount: 0.95,
  translateY: 20,
}

/**
 * 创建过渡动画钩子函数
 * @param config 过渡配置
 * @returns 过渡钩子函数对象
 */
export function createHeightTransition(config: TransitionConfig = {}) {
  const finalConfig = { ...defaultConfig, ...config }
  const { duration, blurAmount, scaleAmount, translateY } = finalConfig

  return {
    onBeforeEnter(el: Element) {
      const element = el as HTMLElement
      element.style.height = '0px'
      element.style.overflow = 'hidden'
      element.style.filter = `blur(${blurAmount}px)`
      element.style.transform = `scale(${scaleAmount}) translateY(${translateY}px)`
      element.style.opacity = '0'
    },

    onEnter(el: Element, done: () => void) {
      const element = el as HTMLElement
      const targetHeight = element.scrollHeight

      // 强制重排
      void element.offsetHeight

      // 设置过渡动画
      element.style.height = `${targetHeight}px`
      element.style.filter = 'blur(0px)'
      element.style.transform = 'scale(1) translateY(0px)'
      element.style.opacity = '1'

      // 动画完成后调用done
      setTimeout(done, duration)
    },

    onAfterEnter(el: Element) {
      const element = el as HTMLElement
      element.style.height = ''
      element.style.overflow = ''
      element.style.filter = ''
      element.style.opacity = ''
      element.style.transition = ''
    },

    onBeforeLeave(el: Element) {
      const element = el as HTMLElement
      element.style.height = `${element.scrollHeight}px`
      element.style.overflow = 'hidden'
      element.style.filter = 'blur(0px)'
      element.style.transform = 'scale(1) translateY(0px)'
      element.style.opacity = '1'

      // 强制重排
      void element.offsetHeight
    },

    onLeave(el: Element, done: () => void) {
      const element = el as HTMLElement

      // 设置过渡动画
      element.style.height = '0px'
      element.style.filter = `blur(${blurAmount}px)`
      element.style.transform = `scale(${scaleAmount}) translateY(${translateY}px)`
      element.style.opacity = '0'

      // 动画完成后调用done
      setTimeout(done, duration)
    },

    onAfterLeave(el: Element) {
      const element = el as HTMLElement
      element.style.height = ''
      element.style.overflow = ''
      element.style.filter = ''
      element.style.opacity = ''
      element.style.transition = ''
    },
  }
}

/**
 * 预定义的过渡效果
 */
export const transitionEffects = {
  // 默认模糊缩放效果
  blurScale: createHeightTransition(),

  // 轻微模糊效果
  subtleBlur: createHeightTransition({
    blurAmount: 5,
    scaleAmount: 0.95,
    translateY: 20,
  }),

  // 强烈模糊效果
  strongBlur: createHeightTransition({
    blurAmount: 15,
    scaleAmount: 0.8,
    translateY: 80,
  }),

  // 纯高度动画（无模糊和缩放）
  heightOnly: createHeightTransition({
    blurAmount: 0,
    scaleAmount: 1,
    translateY: 0,
  }),
}

export type TransitionEffect = ReturnType<typeof createHeightTransition>
