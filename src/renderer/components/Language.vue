<script setup lang="ts">
import { computed, ref } from 'vue'

type LanguageCode = 'zh-cn' | 'ja' | 'ko' | 'ru' | 'en' | 'fr'
const languages = [
  { code: 'zh-cn', name: '中文' },
  { code: 'ja', name: '日语' },
  { code: 'ko', name: '韩语' },
  { code: 'ru', name: '俄语' },
  { code: 'en', name: '英语' },
  { code: 'fr', name: '法语' },
]

const selectedLanguage = ref<LanguageCode>(
  (localStorage.getItem('lang') as LanguageCode) || 'zh-cn',
)

// 获取当前选中语言的显示名称
const selectedLanguageName = computed(() => {
  const found = languages.find(lang => lang.code === selectedLanguage.value)
  return found ? found.name : '中文'
})

function selectLanguage(event: Event) {
  const target = event.target as HTMLSelectElement
  const code = target.value as LanguageCode
  selectedLanguage.value = code
  localStorage.setItem('lang', code)
  // 可在此处添加切换语言的逻辑，如调用 i18n
  window.location.reload() // 刷新页面以应用语言更改
}
</script>

<template>
  <div class="language-page">
    <div class="language-card">
      <div class="card-header">
        <div class="icon-wrapper">
          <span class="iconfont icon-language"></span>
        </div>
        <h2>语言设置</h2>
        <p class="subtitle">
          选择您偏好的界面语言
        </p>
      </div>

      <div class="card-content">
        <div class="select-wrapper">
          <select
            :value="selectedLanguage"
            class="language-select"
            @change="selectLanguage"
          >
            <option
              v-for="lang in languages"
              :key="lang.code"
              :value="lang.code"
            >
              {{ lang.name }}
            </option>
          </select>
          <div class="select-icon">
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
        </div>

        <div class="language-info">
          <div class="current-lang">
            <span class="label">当前语言</span>
            <span class="value">{{ selectedLanguageName }}</span>
          </div>
          <div class="lang-code">
            <span class="label">语言代码</span>
            <span class="code">{{ selectedLanguage }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.language-page {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  min-height: 500px;
}

.language-card {
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  width: 100%;
  max-width: 480px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.language-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.12);
}

.card-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 32px 28px;
  text-align: center;
  color: white;
  position: relative;
  overflow: hidden;
}

.card-header::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 50%);
  animation: shimmer 6s infinite;
}

@keyframes shimmer {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
}

.icon-wrapper {
  width: 64px;
  height: 64px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  backdrop-filter: blur(10px);
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.icon-wrapper .iconfont {
  font-size: 28px;
  color: white;
}

.card-header h2 {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.subtitle {
  margin: 0;
  font-size: 14px;
  opacity: 0.9;
  font-weight: 400;
}

.card-content {
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.select-wrapper {
  position: relative;
  width: 100%;
}

.language-select {
  width: 100%;
  padding: 16px 20px;
  padding-right: 50px;
  font-size: 16px;
  font-weight: 500;
  color: #334155;
  background: #fafafa;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  appearance: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  position: relative;
  z-index: 1;
}

.language-select:hover {
  border-color: #667eea;
  background: #ffffff;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.15);
  transform: translateY(-1px);
}

.language-select:focus {
  border-color: #667eea;
  background: #ffffff;
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1), 0 4px 20px rgba(102, 126, 234, 0.15);
  transform: translateY(-1px);
}

.language-select option {
  padding: 12px 16px;
  font-size: 15px;
  font-weight: 500;
  color: #475569;
  background: #ffffff;
}

.language-select option:hover {
  background: #f8fafc;
}

.select-icon {
  position: absolute;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  color: #64748b;
  pointer-events: none;
  transition: all 0.3s ease;
  z-index: 2;
}

.language-select:hover + .select-icon,
.language-select:focus + .select-icon {
  color: #667eea;
  transform: translateY(-50%) scale(1.1);
}

.language-select:focus + .select-icon {
  transform: translateY(-50%) scale(1.1) rotate(180deg);
}

.language-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.current-lang,
.lang-code {
  background: #f8fafc;
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  border: 1px solid #e2e8f0;
  transition: all 0.3s ease;
}

.current-lang:hover,
.lang-code:hover {
  background: #f1f5f9;
  transform: translateY(-2px);
}

.label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.value {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}

.code {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #667eea;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  background: rgba(102, 126, 234, 0.1);
  padding: 4px 8px;
  border-radius: 6px;
  display: inline-block;
}

/* 响应式设计 */
@media (max-width: 640px) {
  .language-page {
    padding: 16px;
    align-items: flex-start;
    padding-top: 40px;
  }

  .language-card {
    max-width: 100%;
    border-radius: 16px;
  }

  .card-header {
    padding: 24px 20px;
  }

  .icon-wrapper {
    width: 56px;
    height: 56px;
    margin-bottom: 12px;
  }

  .icon-wrapper .iconfont {
    font-size: 24px;
  }

  .card-header h2 {
    font-size: 20px;
  }

  .subtitle {
    font-size: 13px;
  }

  .card-content {
    padding: 24px 20px;
    gap: 20px;
  }

  .language-info {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .current-lang,
  .lang-code {
    padding: 12px;
  }
}

/* 暗色主题适配 */
@media (prefers-color-scheme: dark) {
  .language-page {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  }

  .language-card {
    background: #1e293b;
    border-color: rgba(255, 255, 255, 0.1);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  }

  .language-card:hover {
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  }

  .card-header {
    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  }

  .language-select {
    background: #334155;
    border-color: #475569;
    color: #e2e8f0;
  }

  .language-select:hover {
    border-color: #667eea;
    background: #3f4a5f;
    box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
  }

  .language-select:focus {
    border-color: #667eea;
    background: #3f4a5f;
    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.2), 0 4px 20px rgba(102, 126, 234, 0.3);
  }

  .language-select option {
    background: #334155;
    color: #e2e8f0;
  }

  .language-select option:hover {
    background: #3f4a5f;
  }

  .select-icon {
    color: #94a3b8;
  }

  .language-select:hover + .select-icon,
  .language-select:focus + .select-icon {
    color: #a5b4fc;
  }

  .current-lang,
  .lang-code {
    background: #334155;
    border-color: #475569;
  }

  .current-lang:hover,
  .lang-code:hover {
    background: #3f4a5f;
  }

  .label {
    color: #94a3b8;
  }

  .value {
    color: #f1f5f9;
  }

  .code {
    color: #a5b4fc;
    background: rgba(102, 126, 234, 0.2);
  }
}
</style>
