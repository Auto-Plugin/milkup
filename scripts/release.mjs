import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const current = pkg.version;

const [major, minor, patch] = current.split(".").map(Number);

const choices = [
  { label: `patch  ${major}.${minor}.${patch + 1}`, version: `${major}.${minor}.${patch + 1}` },
  { label: `minor  ${major}.${minor + 1}.0`, version: `${major}.${minor + 1}.0` },
  { label: `major  ${major + 1}.0.0`, version: `${major + 1}.0.0` },
  { label: `keep   ${current}`, version: current },
];

function select(choices) {
  return new Promise((resolve) => {
    let idx = 0;
    const totalLines = choices.length + 1; // 标题行 + 选项行

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const render = (init) => {
      if (!init) {
        // 光标上移到输出起始位置
        process.stdout.write(`\x1b[${totalLines}A`);
      }
      // 标题行：清除当前行后输出
      process.stdout.write(`\x1b[2K\x1b[36m当前版本: ${current}\x1b[0m  选择新版本:\n`);
      // 选项行
      for (let i = 0; i < choices.length; i++) {
        const arrow = i === idx ? "\x1b[32m> " : "  ";
        const reset = i === idx ? "\x1b[0m" : "";
        process.stdout.write(`\x1b[2K${arrow}${choices[i].label}${reset}\n`);
      }
    };

    render(true);

    process.stdin.on("data", (key) => {
      if (key === "\x1b[A" || key === "k") {
        idx = (idx - 1 + choices.length) % choices.length;
        render(false);
      } else if (key === "\x1b[B" || key === "j") {
        idx = (idx + 1) % choices.length;
        render(false);
      } else if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(choices[idx]);
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.exit(0);
      }
    });
  });
}

const chosen = await select(choices);
const version = chosen.version;
const tag = `v${version}`;

// 更新 package.json
if (version !== current) {
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  console.log(`\n\x1b[32m已更新 package.json version: ${current} -> ${version}\x1b[0m`);

  // 提交版本变更并推送到 main
  execSync("git add package.json", { stdio: "inherit" });
  execSync(`git commit -m "chore: v${version}"`, { stdio: "inherit" });
  console.log(`\x1b[36m推送到 main ...\x1b[0m`);
  execSync("git push origin main", { stdio: "inherit" });
} else {
  console.log(`\n\x1b[33m保持当前版本 ${current}\x1b[0m`);
}

// 创建 tag 并推送
console.log(`\n\x1b[36m创建 tag ${tag} ...\x1b[0m`);
execSync(`git tag ${tag}`, { stdio: "inherit" });

console.log(`\x1b[36m推送 tag ${tag} ...\x1b[0m`);
execSync(`git push origin ${tag}`, { stdio: "inherit" });

console.log(`\n\x1b[32m发布完成: ${tag}\x1b[0m`);
