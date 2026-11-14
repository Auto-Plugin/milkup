# P5 输出验收：中文离线文档

这一页验证中文、标点“引号”、组合字符 é 和 emoji 👩🏽‍💻。导出应保留这段内容、标题层级及段落间距。唯一正文标记：P5-ORIGINAL-BODY。

## 表格与长行

| 项目 | 中文说明                               |   数值 |
| ---- | -------------------------------------- | -----: |
| 排版 | 中文不会变成方框                       | 123.45 |
| 安全 | `<script>alert(1)</script>` 是普通文本 |      0 |
| 图片 | 离线打开仍可辨认蓝色方块和白色 L       |      1 |

## 代码与引用

```typescript
const message = '中文代码 P5-CODE-MARKER'
const lessThan = 1 < 2 && 3 > 2
console.log(message, lessThan)
```

> 引用内容：导出不得修改 Markdown 原文，取消或错误也不得替换原文。

- 第一项：整篇文档
- 第二项：所选内容
- 第三项：离线资源

## 本地与缺失图片

![离线蓝底白色 L](assets/logo-fixture.png)

![缺失图片应有提示](missing-local-image.png)

![远程图片不能自动联网](https://example.invalid/p5-never-fetch.png)

## 公式

行内公式 $E = mc^2$ 与独立公式：

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## 图表

```mermaid
flowchart LR
  A[中文输入] --> B[冻结内容]
  B --> C[HTML / PDF / 打印]
```

## 脚注

输出会保留脚注引用与对应解释。[^p5]

[^p5]: 脚注正文 P5-FOOTNOTE-MARKER；检查编号、回链与可读性。

## 尾部

P5-END-MARKER：此行应出现在整篇输出中，不应出现在仅第一行选区的输出中。
