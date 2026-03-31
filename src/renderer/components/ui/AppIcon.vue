<script setup lang="ts">
import { computed, useAttrs } from "vue";
import type { FunctionalComponent } from "vue";
import type { LucideProps } from "lucide-vue-next";
import {
  ChevronRight,
  CircleAlert,
  CircleCheckBig,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileCode,
  FileInput,
  FileOutput,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Github,
  Keyboard,
  Languages,
  ListTree,
  Minus,
  Palette,
  RefreshCw,
  Settings2,
  Sparkles,
  Square,
  SquarePen,
  SquareSquare,
  Type,
  WandSparkles,
  X,
  Plus,
} from "lucide-vue-next";

const iconMap = {
  "arrow-right": ChevronRight,
  "check-circle": CircleCheckBig,
  "circle-check": CircleCheckBig,
  close: X,
  "config-props": Settings2,
  document: FileText,
  "document-copy": Copy,
  download: Download,
  edit: SquarePen,
  fanyi: Languages,
  "folder-copy": Folder,
  "folder-opened": FolderOpen,
  github: Github,
  html: FileCode,
  input: FileInput,
  link: ExternalLink,
  "List-outlined": ListTree,
  markdown: FileCode,
  max: Square,
  min: Minus,
  normal: SquareSquare,
  pdf: FileArchive,
  plus: Plus,
  refresh: RefreshCw,
  script: Sparkles,
  type: Type,
  waiguan: Palette,
  "warning-outline": CircleAlert,
  "word-file": FileType,
  "export-file": FileOutput,
  "shortcut-key": Keyboard,
  "magic-wand": WandSparkles,
  "image-config": FileOutput,
} satisfies Record<string, FunctionalComponent<LucideProps>>;

type AppIconName = keyof typeof iconMap;

const props = withDefaults(
  defineProps<{
    name: AppIconName;
    size?: number | string;
    strokeWidth?: number | string;
  }>(),
  {
    size: "1em",
    strokeWidth: 1.8,
  }
);

const attrs = useAttrs();
const iconComponent = computed(() => iconMap[props.name]);
</script>

<template>
  <component :is="iconComponent" v-bind="attrs" :size="size" :stroke-width="strokeWidth" />
</template>
