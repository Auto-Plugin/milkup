import type { EnhanceBlockEditFeatureConfig, EnhanceCrepeFeatureConfig } from '@renderer/enhance/crepe/types'
import { CrepeFeature } from '@milkdown/crepe'
import autolog from 'autolog.js'

export const enhanceBlockEditConfig: EnhanceBlockEditFeatureConfig = {
  textGroup: {
    label: '文本',
    text: {
      label: '文本',
      abbr: ['text', 'wb', 'wenben'],
    },
    h1: {
      label: '一级标题',
      abbr: ['h1', 'yjbt', 'bt1', 'yijibiaoti'],
    },
    h2: {
      label: '二级标题',
      abbr: ['h2', 'ejbt', 'bt2', 'erjibiaoti'],
    },
    h3: {
      label: '三级标题',
      abbr: ['h3', 'sjbt', 'bt3', 'sanjibiaoti'],
    },
    h4: {
      label: '四级标题',
      abbr: ['h4', 'sjbt', 'bt4', 'sijibiaoti'],
    },
    h5: {
      label: '五级标题',
      abbr: ['h5', 'wjbt', 'bt5', 'wujibiaoti'],
    },
    h6: {
      label: '六级标题',
      abbr: ['h6', 'ljbt', 'bt6', 'liujibiaoti'],
    },
    quote: {
      label: '引用',
      abbr: ['quote', 'yy', 'yinyong'],
    },
    divider: {
      label: '分割线',
      abbr: ['divider', 'fgx', 'dd', 'fengexian'],
    },
  },
  listGroup: {
    label: '列表',
    bulletList: {
      label: '无序列表',
      abbr: ['bullet-list', 'lb', 'wxlb', 'wuxuliebiao'],
    },
    orderedList: {
      label: '有序列表',
      abbr: ['ordered-list', 'lb', 'yxlb', 'youxuliebiao'],
    },
    taskList: {
      label: '任务列表',
      abbr: ['task-list', 'lb', 'rwlb', 'renwuliebiao'],
    },
  },
  advancedGroup: {
    label: '高级',
    image: {
      label: '图片',
      abbr: ['image', 'tp', 'photo', 'tupian'],
    },
    codeBlock: {
      label: '代码块',
      abbr: ['code-block', 'dmk', 'code', 'daimakuai'],
    },
    table: {
      label: '表格',
      abbr: ['table', 'tb', 'bg', 'biaoge'],
    },
    math: {
      label: '公式',
      abbr: ['math', 'gs', 'gongshi'],
    },
  },
}

export const enhanceConfig: EnhanceCrepeFeatureConfig = {
  [CrepeFeature.CodeMirror]: {
    searchPlaceholder: '搜索语言',
    noResultText: '暂无匹配',
    copyText: '复制',
    onCopy: (_) => {
      autolog.log('复制成功', 'success')
    },
  },
  [CrepeFeature.LinkTooltip]: {
    onCopyLink: (_) => {
      autolog.log('复制成功', 'success')
    },
  },
  [CrepeFeature.Placeholder]: {
    text: '开始写点什么吧...',
    mode: 'doc',
  },
  [CrepeFeature.BlockEdit]: enhanceBlockEditConfig,
}
