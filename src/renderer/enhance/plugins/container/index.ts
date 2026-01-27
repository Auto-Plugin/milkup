import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { MarkdownNode } from "@milkdown/transformer";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { $inputRule, $node, $remark } from "@milkdown/kit/utils";
import directive from "remark-directive";
import container from "remark-flexible-containers";

// TODO 样式统一
import "./style/constainer.css";

// TODO details 容器自定义 dom 结构
// TODO 大小写问题

export const remarkFlexibleContainers = $remark("remarkBlockContainers", () => container);
export const remarkDirective = $remark("remarkDirective", () => directive);

declare module "unist" {
  interface Data {
    hProperties?: Record<string, any>;
    directiveLabel?: string;
  }
}

// vuepress 风格语法支持
export const remarkContainerNode = $node("containerDirective", (_) => ({
  content: "containerTitle containerContent",
  group: "block",
  attrs: {
    type: {
      default: "default",
    },
    title: {
      default: "",
    },
    classList: {
      default: [],
    },
    attributes: {
      default: {},
    },
  },
  parseDOM: [
    {
      tag: "div.milkdown-container",
      getAttrs: (node: HTMLElement) => {
        return {
          type: node.dataset.type,
          title: node.dataset.title,
          classList: node.classList,
          attributes: node.getAttributeNames().reduce(
            (acc, name) => {
              if (["data-type", "data-title", "class"].includes(name)) {
                return acc;
              }
              acc[name] = node.getAttribute(name);
              return acc;
            },
            {} as Record<string, string | null>
          ),
        };
      },
    },
  ],
  toDOM: (node) => {
    return [
      "div",
      {
        "data-type": node.attrs.type,
        "data-title": node.attrs.title,
        class: ["milkdown-container", ...node.attrs.classList].join(" "),
        // TODO 安全问题（这里可以设置各种属性）
        ...node.attrs.attributes,
      },
      0,
    ];
  },
  parseMarkdown: {
    match: (node) => {
      return node.type === "container" || node.type === "containerDirective";
    },
    runner: (state, node, proseType) => {
      const titleNode = createTitleNode(node);
      const contentNode = createContentNode(node);
      node.children = [titleNode, contentNode];

      // 先解析出容器类型暂存，防止解析类名时把 class 属性删除导致无法解析
      const containerType = parseContainerType(node);
      const classList = parseClassList(node);
      if (node.type === "containerDirective") {
        // 兼容 remark-directive，将容器类型添加到容器class中.
        // remark-flexible-containers 已添加了容器类型，所以这里不再添加
        classList.push(containerType);
      }
      state.openNode(proseType, {
        type: containerType,
        title: (titleNode.attrs as { title: string }).title,
        classList,
        // 其余属性直接添加到元素属性中
        attributes: {
          ...(node.attributes as Record<string, unknown>),
          ...node.data?.hProperties,
        },
      });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => {
      return node.type.name === "container" || node.type.name === "containerDirective";
    },
    runner: (state, node) => {
      state.openNode("containerDirective", undefined, {
        name: `${node.attrs.type}[${node.attrs.title}]`,
        attributes: node.attrs.attributes,
      });
      state.next(node.content);
      state.closeNode();
    },
  },
}));

export const remarkContainerTitleNode = $node("containerTitle", (__) => ({
  content: "inline*",
  attrs: {
    title: {
      default: "",
    },
  },
  parseDOM: [{ tag: "div.milkdown-container-title" }],
  toDOM: (node) => [
    "div",
    { class: "milkdown-container-title", "data-title": node.attrs.title },
    0,
  ],
  parseMarkdown: {
    match: (node) => {
      return node.type === "containerTitle";
    },
    runner: (state, node, proseType) => {
      state.openNode(proseType, {
        title: (node.attrs as { title: string }).title,
      });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => {
      return node.type.name === "containerTitle";
    },
    runner: (_, __) => {
      // console.log('标题 to Markdown 被调用')
    },
  },
}));

export const remarkContainerContentNode = $node("containerContent", (_) => ({
  content: "block+",
  parseDOM: [{ tag: "div.milkdown-container-content" }],
  toDOM: () => ["div", { class: "milkdown-container-content" }, 0],
  parseMarkdown: {
    match: (node) => {
      return node.type === "containerContent";
    },
    runner: (state, node, proseType) => {
      state.openNode(proseType);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => {
      return node.type.name === "containerContent";
    },
    runner: (state, node) => {
      state.next(node.content);
    },
  },
}));

export const remarkContainerInputRule = $inputRule((ctx) => {
  const containerMatch: RegExp = /^:::([\w-]*)(?:\s*\[([^\]]*)\])?(?:\s*\{([^}]*)\})?\r?\n$/m;
  return new InputRule(containerMatch, (state, match, start, end) => {
    const { tr } = state;
    const attrs = parseInputRuleInfo(match);
    attrs.classList.push(attrs.type);
    tr.replaceWith(
      start,
      end,
      remarkContainerNode
        .type(ctx)
        .create(attrs, [
          remarkContainerTitleNode
            .type(ctx)
            .create({ title: attrs.title }, [state.schema.text(attrs.title)]),
          remarkContainerContentNode.type(ctx).create({}, [state.schema.node("paragraph")]),
        ])
    );
    return tr;
  });
});

function parseInputRuleInfo(match: RegExpMatchArray) {
  const [_, type, title, attributes] = match;
  const info: {
    type: string;
    title: string;
    classList: string[];
    attributes: Record<string, string>;
  } = {
    type,
    title,
    classList: [],
    attributes: {},
  };
  if (!type || type.trim().length === 0) {
    info.type = "default";
  }
  if (!title || title.trim().length === 0) {
    info.title = "default";
  }
  if (attributes) {
    attributes.split(" ").forEach((attribute) => {
      if (attribute && attribute.trim().length > 0) {
        if (attribute.startsWith("#")) {
          info.attributes.id = attribute.substring(1);
        } else if (attribute.startsWith(".")) {
          info.classList.push(attribute.substring(1));
        } else if (attribute.includes("=")) {
          const key = attribute.split("=")[0];
          let value = attribute.split("=")[1];
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1);
          }
          if (value.startsWith("'") && value.endsWith("'")) {
            value = value.substring(1, value.length - 1);
          }
          if (key === "class") {
            info.classList.push(value);
          } else {
            info.attributes[key] = value;
          }
        } else {
          info.attributes[attribute] = attribute;
        }
      }
    });
  }
  return info;
}

/**
 * 创建容器标题节点
 * @param node
 */
function createTitleNode(node: MarkdownNode): MarkdownNode {
  const titleNode = node.children?.find((child) => {
    return (
      child.data?.directiveLabel ||
      child.data?.hProperties?.className?.includes("remark-container-title")
    );
  });
  let children = titleNode?.children;
  if (!children) {
    children = [
      {
        type: "text",
        value: parseContainerType(node),
      },
    ];
  }
  return {
    type: "containerTitle",
    children,
    attrs: {
      title: titleNode?.children?.[0].value ?? parseContainerType(node),
    },
  };
}

/**
 * 创建容器内容节点
 * @param node
 */
function createContentNode(node: MarkdownNode): MarkdownNode {
  return {
    type: "containerContent",
    children: node.children?.filter((child) => {
      return (
        !child.data?.directiveLabel &&
        !child.data?.hProperties?.className?.includes("remark-container-title")
      );
    }),
  };
}

/**
 * 解析节点上的容器类型
 * @param node
 */
function parseContainerType(node: MarkdownNode): string {
  if (node.name) {
    // 兼容 remark-directive
    return node.name as string;
  }
  if (node.data?.hProperties?.className?.length > 1) {
    // 兼容 remark-flexible-containers
    const type = node.data?.hProperties?.className[1] as string;
    return type.trim().length > 0 ? type : "default";
  }
  return "default";
}

/**
 * 解析节点上的自定义类名属性
 * @param node
 */
function parseClassList(node: MarkdownNode): string[] {
  const classList = [];
  if (node.data?.hProperties?.className) {
    classList.push(...node.data?.hProperties.className);
    delete node.data?.hProperties.className;
  }
  if (node.data?.hProperties?.class) {
    classList.push(node.data?.hProperties.class);
    delete node.data?.hProperties.class;
  }
  const attributes = node.attributes as Record<string, string>;
  if (attributes?.class) {
    classList.push(attributes.class);
    delete attributes.class;
  }
  return classList;
}

export default [
  remarkFlexibleContainers,
  remarkDirective,
  remarkContainerNode,
  remarkContainerTitleNode,
  remarkContainerContentNode,
  remarkContainerInputRule,
] as MilkdownPlugin[];
