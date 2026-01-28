import { InputRule, inputRules } from "@milkdown/prose/inputrules";
import { Plugin } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

// 匹配Markdown图片语法的正则：![alt](src)
// 允许 src 中包含空格
const wrappingImageRegex = /!\[([^\]]*)\]\(([^)]+)\)$/;

export const laxImageInputRule = $prose((_ctx) => {
  return inputRules({
    rules: [
      new InputRule(wrappingImageRegex, (state, match, start, end) => {
        console.log("[Debug] laxImageInputRule triggered", match);
        const [_, alt, src] = match;
        const { tr } = state;

        if (!src) return null;

        // 将 src 中的空格替换为 %20，确保 Milkdown 能正确解析
        const encodedSrc = src.replace(/ /g, "%20");
        console.log("[Debug] Encoded src:", encodedSrc);

        // 创建图片节点
        const node = state.schema.nodes.image.create({
          src: encodedSrc,
          alt,
        });

        tr.replaceWith(start, end, node);
        return tr;
      }),
    ],
  });
});

export const laxImagePastePlugin = $prose((_ctx) => {
  return new Plugin({
    props: {
      handlePaste: (view, event, _slice) => {
        console.log("[Debug] handlePaste triggered");
        const text = event.clipboardData?.getData("text/plain");
        if (!text) {
          console.log("[Debug] No text/plain data in clipboard");
          return false;
        }

        console.log("[Debug] handlePaste text:", text);

        // 放宽正则：使用 g 标志匹配所有
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

        // 检查是否有匹配项，并且这些匹配项中是否存在带空格的路径
        let match;
        let hasMatch = false;

        // 我们需要决定是否拦截。如果全是图片且包含带空格的，就拦截。
        // 为了简单起见，只要文本看起来主要是图片语法，我们就尝试接管。
        // 或者，由于我们只想修复空格问题，我们检测是否存在带空格的图片语法。

        if (imageRegex.test(text)) {
          // 重置正则索引
          imageRegex.lastIndex = 0;

          // 构建新的内容插入
          // 注意：这里我们只能处理纯文本插入。如果不完全匹配（例如包含其他文字），简单的替换可能不够。
          // 但如果用户粘贴的是纯图片语法，我们可以直接构造节点。

          // 简单策略：如果整个粘贴内容就是一张图片，且带空格，我们接管。
          const singleImageRegex = /^!\[([^\]]*)\]\(([^)]+)\)$/;
          const singleMatch = text.trim().match(singleImageRegex);

          if (singleMatch) {
            const [_, alt, src] = singleMatch;
            if (src && src.includes(" ")) {
              console.log("[Debug] Intercepting single image paste with space:", src);
              const encodedSrc = src.replace(/ /g, "%20");
              const node = view.state.schema.nodes.image.create({
                src: encodedSrc,
                alt,
              });
              const tr = view.state.tr.replaceSelectionWith(node);
              view.dispatch(tr);
              return true;
            }
            // 如果不带空格，也可以接管以确保一致性，或者放行
            console.log(
              "[Debug] Single image paste without space, letting default handler work (or intercepting for consistency)"
            );
            // 这里我们也接管，防止其他插件处理不当
            const encodedSrc = src.replace(/ /g, "%20");
            const node = view.state.schema.nodes.image.create({
              src: encodedSrc,
              alt,
            });
            const tr = view.state.tr.replaceSelectionWith(node);
            view.dispatch(tr);
            return true;
          }
        }

        console.log("[Debug] Not intercepted by laxImagePastePlugin");
        return false;
      },
    },
  });
});
