const path = "C:\\Users\\99523\\Downloads\\GIF 2025-7-18 17-29-00.gif";
// 注意：在 JS 字符串中，反斜杠本身需要转义。用户输入的路径包含反斜杠。
const markdown = `![GIF 2025-7-18 17-29-00](${path})`;
const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;

console.log("Testing Markdown String:", markdown);

const replaced = markdown.replace(regex, (match, alt, src) => {
  console.log("Match found!");
  console.log("Alt:", alt);
  console.log("Src:", src);
  if (src.includes(" ")) {
    const newSrc = src.replace(/ /g, "%20");
    console.log("Replacing with:", newSrc);
    return `![${alt}](${newSrc})`;
  }
  return match;
});

console.log("Result:", replaced);

// 测试 Input Rule 正则
const inputRuleRegex = /!\[([^\]]*)\]\(([^)]+)\)$/;
console.log("Testing Input Rule match...");
const match = inputRuleRegex.exec(markdown);
console.log("Input Rule Match:", match ? "YES" : "NO");
if (match) {
  console.log("Captured Src:", match[2]);
}
