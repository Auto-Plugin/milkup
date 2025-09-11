import type { CrepeFeature } from '@milkdown/crepe'
// 类型扩展
import type { CrepeFeatureConfig } from '@milkdown/crepe/lib/types/feature'
import type { BlockEditFeatureConfig } from '@milkdown/crepe/lib/types/feature/block-edit'
import type { SlashMenuItem } from '@milkdown/crepe/lib/types/feature/block-edit/menu/utils'
import type { DeepPartial } from '@milkdown/crepe/lib/types/utils'

export type EnhanceBlockEditFeatureConfig = BlockEditFeatureConfig & DeepPartial<{
  textGroup: {
    text: {
      abbr: string[]
    }
    h1: {
      abbr: string[]
    }
    h2: {
      abbr: string[]
    }
    h3: {
      abbr: string[]
    }
    h4: {
      abbr: string[]
    }
    h5: {
      abbr: string[]
    }
    h6: {
      abbr: string[]
    }
    quote: {
      abbr: string[]
    }
    divider: {
      abbr: string[]
    }
  }

  listGroup: {
    bulletList: {
      abbr: string[]
    }
    orderedList: {
      abbr: string[]
    }
    taskList: {
      abbr: string[]
    }
  }

  advancedGroup: {
    image: {
      abbr: string[]
    }
    codeBlock: {
      abbr: string[]
    }
    table: {
      abbr: string[]
    }
    math: {
      abbr: string[]
    }
  }
}>

export interface EnhanceCrepeFeatureConfig extends CrepeFeatureConfig {
  [CrepeFeature.BlockEdit]: EnhanceBlockEditFeatureConfig
}

export type EnhanceSlashMenuItem = SlashMenuItem & DeepPartial<{
  abbr: string[]
}>
