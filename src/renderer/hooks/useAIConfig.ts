import { useStorage } from "@vueuse/core";
import { computed } from "vue";

export type AIProvider = "openai" | "anthropic" | "gemini" | "ollama" | "custom";

export interface AIConfig {
  enabled: boolean;
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  debounceWait: number;
}

const defaultAIConfig: AIConfig = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-3.5-turbo",
  temperature: 0.7,
  debounceWait: 2000,
};

// Default URLs for providers
export const providerDefaultUrls: Record<AIProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  ollama: "http://localhost:11434",
  custom: "",
};

const config = useStorage<AIConfig>("milkup-ai-config", defaultAIConfig, localStorage, {
  mergeDefaults: true,
});

export function useAIConfig() {
  const isEnabled = computed(() => config.value.enabled);

  const updateConfig = (updates: Partial<AIConfig>) => {
    config.value = { ...config.value, ...updates };
  };

  const resetToDefault = () => {
    config.value = { ...defaultAIConfig };
  };

  return {
    config,
    isEnabled,
    updateConfig,
    resetToDefault,
    providerDefaultUrls,
  };
}
