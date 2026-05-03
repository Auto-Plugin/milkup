import type { FontConfig, FontSizeConfig } from "@/types/font";
import type { ImagePasteMethod, ShortcutKeyMap } from "@/core";
import { useStorage } from "@vueuse/core";
import { readonly, watch } from "vue";

import { defaultFontConfig, defaultFontSizeConfig } from "@/config/fonts";
import { setNestedProperty } from "@/renderer/utils/tool";

interface AppConfig extends Record<string, any> {
  font: {
    family: FontConfig;
    size: FontSizeConfig;
  };
  image: {
    pasteMethod: ImagePasteMethod;
    localPath: string;
  };
  other: {
    editorPadding: string;
    autoSave: boolean;
  };
  mermaid: {
    defaultDisplayMode: "code" | "mixed" | "diagram";
  };
  shortcuts: ShortcutKeyMap;
  workspace: {
    sortBy: "name" | "mtime";
    startupPath: string;
    autoExpandSidebar: boolean;
  };
}

const defaultConfig: AppConfig = {
  font: {
    family: defaultFontConfig,
    size: defaultFontSizeConfig,
  },
  image: {
    pasteMethod: "local",
    localPath: "/assets",
  },
  other: {
    editorPadding: "120px",
    autoSave: false,
  },
  mermaid: {
    defaultDisplayMode: "diagram",
  },
  shortcuts: {},
  workspace: {
    sortBy: "name",
    startupPath: "",
    autoExpandSidebar: false,
  },
};

function mergeAppConfig(partial?: Partial<AppConfig>): AppConfig {
  return {
    ...defaultConfig,
    ...partial,
    font: {
      ...defaultConfig.font,
      ...partial?.font,
    },
    image: {
      ...defaultConfig.image,
      ...partial?.image,
    },
    other: {
      ...defaultConfig.other,
      ...partial?.other,
    },
    mermaid: {
      ...defaultConfig.mermaid,
      ...partial?.mermaid,
    },
    shortcuts: partial?.shortcuts || defaultConfig.shortcuts,
    workspace: {
      ...defaultConfig.workspace,
      ...partial?.workspace,
    },
  };
}

function getLegacyImageConfig(): AppConfig["image"] {
  const pasteMethod = localStorage.getItem("pasteMethod");
  const localPath = localStorage.getItem("localImagePath");

  return {
    pasteMethod:
      pasteMethod === "local" || pasteMethod === "base64" || pasteMethod === "remote"
        ? pasteMethod
        : defaultConfig.image.pasteMethod,
    localPath: localPath || defaultConfig.image.localPath,
  };
}

const config = useStorage<AppConfig>("milkup-config", defaultConfig, localStorage, {
  serializer: {
    read: (value: string) => {
      try {
        const parsed = JSON.parse(value) as Partial<AppConfig>;
        const merged = mergeAppConfig(parsed);

        return {
          ...merged,
          image: {
            ...getLegacyImageConfig(),
            ...merged.image,
          },
        };
      } catch {
        return mergeAppConfig({
          image: getLegacyImageConfig(),
        });
      }
    },
    write: (value: AppConfig) => JSON.stringify(value),
  },
});

export function useConfig() {
  return {
    config,

    getConf: <K extends keyof AppConfig>(key: K) => readonly(config.value[key]),

    setConf: <K extends keyof AppConfig>(key: K, value: AppConfig[K] | string, pathValue?: any) => {
      if (typeof value === "string" && pathValue !== undefined) {
        config.value = {
          ...config.value,
          [key]: setNestedProperty(config.value[key], value, pathValue),
        };
      } else {
        config.value = { ...config.value, [key]: value as AppConfig[K] };
      }
    },

    watchConf: <K extends keyof AppConfig>(key: K, callback: (value: AppConfig[K]) => void) => {
      return watch(() => config.value[key], callback, { deep: true });
    },
  };
}
