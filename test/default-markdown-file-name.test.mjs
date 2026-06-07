import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultMarkdownFileName } from "../src/main/defaultMarkdownFileName.ts";

test("createDefaultMarkdownFileName: 优先使用第一个标题", () => {
  assert.equal(createDefaultMarkdownFileName("正文\n\n# 第一标题\n\n## 第二标题"), "第一标题.md");
});

test("createDefaultMarkdownFileName: 无标题时使用前 15 个字符", () => {
  assert.equal(
    createDefaultMarkdownFileName("这是一段没有标题的正文内容，后面还有更多文字"),
    "这是一段没有标题的正文内容，后.md"
  );
});

test("createDefaultMarkdownFileName: 清理文件名非法字符", () => {
  assert.equal(createDefaultMarkdownFileName("# a/b:c*?"), "a b c.md");
});
