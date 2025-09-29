import type { EnhanceBlockEditFeatureConfig, EnhanceCrepeFeatureConfig } from '@renderer/enhance/crepe/types'
import { autocompletion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { CrepeFeature } from '@milkdown/crepe'
import autotoast from 'autotoast.js'

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

export const chinesePhrases = {
  // @codemirror/view
  'Control character': '控制字符',
  // @codemirror/commands
  'Selection deleted': '选择已删除',
  // @codemirror/language
  'Folded lines': '已折叠行',
  'Unfolded lines': '已展开行',
  'to': '到',
  'folded code': '已折叠代码',
  'unfold': '展开',
  'Fold line': '折叠行',
  'Unfold line': '展开行',
  // @codemirror/search
  'Go to line': '跳转到行',
  'go': '确定',
  'Find': '查找',
  'Replace': '替换为',
  'next': '下一个',
  'previous': '上一个',
  'all': '全部',
  'match case': '区分大小写',
  'by word': '全字匹配',
  'replace': '替换',
  'replace all': '替换全部',
  'close': '关闭',
  'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 个匹配项',
  'replaced match on line $': '在第 $ 行替换匹配项',
  'on line': '在行',
  // @codemirror/autocomplete
  'Completions': '自动补全',
  // @codemirror/lint
  'Diagnostics': '诊断信息',
  'No diagnostics': '无诊断信息',
  'Regexp': '正则',
  'regexp': '正则',
}

export const enhanceConfig: EnhanceCrepeFeatureConfig = {
  [CrepeFeature.CodeMirror]: {
    extensions: [
      EditorState.phrases.of(chinesePhrases),
      autocompletion(),
    ],
    searchPlaceholder: '搜索语言',
    noResultText: '暂无匹配',
    copyText: '复制',
    onCopy: (_) => {
      autotoast.show('复制成功', 'success')
    },
  },
  [CrepeFeature.LinkTooltip]: {
    onCopyLink: (_) => {
      autotoast.show('复制成功', 'success')
    },
  },
  [CrepeFeature.Placeholder]: {
    text: '开始写点什么吧...',
    mode: 'doc',
  },
  [CrepeFeature.BlockEdit]: enhanceBlockEditConfig,
}
