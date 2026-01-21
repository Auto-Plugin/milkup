/**
 * 惯性滚动系统,灵感源自Unity中的SmoothDamp算法
 * 提供平滑的滚动动画和惯性滚动效果
 */

interface InertiaScrollConfig {
  smoothTime: number
  maxSpeed: number
  velocityMultiplier: number
}

interface ScrollState {
  currentPosition: number
  targetPosition: number
  velocity: number
  isAnimating: boolean
  animationId: number | null
  lastTime: number
}

const DEFAULT_CONFIG: InertiaScrollConfig = {
  smoothTime: 0.15, // 默认平滑时间（秒）
  maxSpeed: 2000, // 默认最大速度限制
  velocityMultiplier: 0.3, // 速度到距离的转换系数
}

const ANIMATION_THRESHOLDS = {
  distance: 0.1, // 距离阈值
  velocity: 0.01, // 速度阈值
  closeDistance: 0.7, // 接近目标的距离阈值
} as const

export class InertiaScroll {
  private container: HTMLElement
  private config: InertiaScrollConfig
  private state: ScrollState

  constructor(container: HTMLElement, config: Partial<InertiaScrollConfig> = {}) {
    this.container = container
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.state = {
      currentPosition: container.scrollLeft,
      targetPosition: container.scrollLeft,
      velocity: 0,
      isAnimating: false,
      animationId: null,
      lastTime: 0,
    }
  }

  /**
   * 设置滚动目标位置
   */
  setTarget(target: number): void {
    this.state.targetPosition = this.clampPosition(target)
    this.startAnimation()
  }

  /**
   * 滚动到指定位置
   * @param target 目标位置
   * @param immediate 是否立即定位（不使用动画）
   */
  scrollTo(target: number, immediate: boolean = false): void {
    if (immediate) {
      this.setPositionImmediate(target)
    } else {
      this.setTarget(target)
    }
  }

  /**
   * 添加速度（用于惯性滚动）
   */
  addVelocity(velocity: number): void {
    this.state.velocity += velocity
    this.calculateTargetFromVelocity()
    this.startAnimation()
  }

  /**
   * 销毁实例，清理资源
   */
  destroy(): void {
    this.stopAnimation()
  }

  /**
   * 限制位置在有效范围内
   */
  private clampPosition(position: number): number {
    return Math.max(0, Math.min(position, this.getMaxScroll()))
  }

  /**
   * 获取最大滚动距离
   */
  private getMaxScroll(): number {
    return this.container.scrollWidth - this.container.clientWidth
  }

  /**
   * 基于当前速度计算目标位置
   */
  private calculateTargetFromVelocity(): void {
    const velocityMagnitude = Math.abs(this.state.velocity)
    const estimatedDistance = velocityMagnitude * this.config.velocityMultiplier

    if (this.state.velocity > 0) {
      // 向右滚动
      this.state.targetPosition = Math.min(
        this.state.currentPosition + estimatedDistance,
        this.getMaxScroll(),
      )
    } else {
      // 向左滚动
      this.state.targetPosition = Math.max(
        this.state.currentPosition - estimatedDistance,
        0,
      )
    }
  }

  /**
   * 立即设置位置（不使用动画）
   */
  private setPositionImmediate(target: number): void {
    this.state.currentPosition = this.clampPosition(target)
    this.state.targetPosition = this.state.currentPosition
    this.state.velocity = 0
    this.container.scrollLeft = this.state.currentPosition
    this.stopAnimation()
  }

  /**
   * 开始动画循环
   */
  private startAnimation(): void {
    if (this.state.isAnimating)
      return

    this.state.isAnimating = true
    this.state.lastTime = performance.now()
    this.animate()
  }

  /**
   * 停止动画
   */
  private stopAnimation(): void {
    this.state.isAnimating = false
    this.state.velocity = 0
    if (this.state.animationId) {
      cancelAnimationFrame(this.state.animationId)
      this.state.animationId = null
    }
  }

  /**
   * 动画循环
   */
  private animate(): void {
    if (!this.state.isAnimating)
      return

    const currentTime = performance.now()
    const deltaTime = (currentTime - this.state.lastTime) / 1000
    this.state.lastTime = currentTime

    // 更新位置
    this.updatePosition(deltaTime)

    // 应用位置到DOM
    this.container.scrollLeft = this.state.currentPosition

    // 检查是否需要继续动画
    if (this.shouldContinueAnimation()) {
      this.state.animationId = requestAnimationFrame(() => this.animate())
    } else {
      this.stopAnimation()
    }
  }

  /**
   * 更新位置（使用SmoothDamp算法）
   */
  private updatePosition(deltaTime: number): void {
    this.state.currentPosition = this.smoothDamp(
      this.state.currentPosition,
      this.state.targetPosition,
      this.state.velocity,
      this.config.smoothTime,
      this.config.maxSpeed,
      deltaTime,
    )
  }

  /**
   * 检查是否应该继续动画
   */
  private shouldContinueAnimation(): boolean {
    const distanceToTarget = Math.abs(this.state.currentPosition - this.state.targetPosition)

    // 如果距离目标太远，继续动画
    if (distanceToTarget > ANIMATION_THRESHOLDS.distance) {
      return true
    }

    // 如果有明显速度，继续动画
    if (Math.abs(this.state.velocity) > ANIMATION_THRESHOLDS.velocity) {
      return true
    }

    return false
  }

  /**
   * Unity SmoothDamp算法实现
   * 基于 Game Programming Gems 4 Chapter 1.10
   */
  private smoothDamp(
    current: number,
    target: number,
    currentVelocity: number,
    smoothTime: number,
    maxSpeed: number,
    deltaTime: number,
  ): number {
    smoothTime = Math.max(0.0001, smoothTime)
    const omega = 2 / smoothTime

    const x = omega * deltaTime
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)

    let change = current - target
    const originalTo = target

    // 限制最大速度
    const maxChange = maxSpeed * smoothTime
    change = Math.max(-maxChange, Math.min(maxChange, change))
    target = current - change

    const temp = (currentVelocity + omega * change) * deltaTime
    this.state.velocity = (currentVelocity - omega * temp) * exp
    let output = target + (change + temp) * exp

    // 防止超调
    if ((originalTo - current > 0.0) === (output > originalTo)) {
      output = originalTo
      this.state.velocity = 0
    }

    // 接近目标时直接停止
    const distanceToTarget = Math.abs(output - originalTo)
    if (distanceToTarget < ANIMATION_THRESHOLDS.closeDistance) {
      output = originalTo
      this.state.velocity = 0
    }

    // 边界检查
    return this.clampPosition(output)
  }

  /**
   * 处理鼠标滚轮事件，转换为惯性滚动
   */
  handleWheel(event: WheelEvent): void {
    event.preventDefault()

    const scrollVelocity = event.deltaY // 调整滚动敏感度
    this.addVelocity(scrollVelocity)
  }
}

/**
 * 创建惯性滚动实例
 */
export function createInertiaScroll(
  container: HTMLElement,
  config?: Partial<InertiaScrollConfig>,
): InertiaScroll {
  return new InertiaScroll(container, config)
}
