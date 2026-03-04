/**
 * 从 SVG 生成多尺寸 ICO 和 ICNS 图标
 * 用法: node scripts/generate-icons.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 图标配置
const ICONS = [
  {
    svg: join(ROOT, "src/renderer/public/logo.svg"),
    output: join(ROOT, "src/assets/icons/milkup"),
    // 裁剪掉阴影区域，只保留内容
    viewBox: "3 3 32 32",
  },
];

// ICO 包含的尺寸
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// ICNS 类型映射
const ICNS_ENTRIES = [
  { size: 16, type: "icp4" },
  { size: 32, type: "icp5" },
  { size: 64, type: "icp6" },
  { size: 128, type: "ic07" },
  { size: 256, type: "ic08" },
  { size: 512, type: "ic09" },
  { size: 1024, type: "ic10" },
];

/**
 * 预处理 SVG：移除阴影滤镜、调整 viewBox
 */
function prepareSvg(svgPath, viewBox) {
  let svg = readFileSync(svgPath, "utf-8");
  // 移除 drop shadow 滤镜定义
  svg = svg.replace(/<defs>[\s\S]*?<\/defs>/g, "");
  // 移除元素上的 filter 引用
  svg = svg.replace(/\s*filter="[^"]*"/g, "");
  // 替换 viewBox
  if (viewBox) {
    svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  }
  return Buffer.from(svg);
}

/**
 * 使用 sharp 将 SVG 渲染为指定尺寸的 PNG
 */
async function renderPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: 300 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/**
 * 将多个 PNG 打包为 ICO 格式
 */
function packIco(pngBuffers) {
  const count = pngBuffers.length;

  // ICO 头部: 6 字节
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = ICO
  header.writeUInt16LE(count, 4); // image count

  // 目录条目: 每个 16 字节
  const dirEntries = Buffer.alloc(count * 16);
  let dataOffset = 6 + count * 16;

  for (let i = 0; i < count; i++) {
    const { png, size } = pngBuffers[i];
    const offset = i * 16;

    dirEntries.writeUInt8(size >= 256 ? 0 : size, offset); // width (0 = 256)
    dirEntries.writeUInt8(size >= 256 ? 0 : size, offset + 1); // height
    dirEntries.writeUInt8(0, offset + 2); // color palette
    dirEntries.writeUInt8(0, offset + 3); // reserved
    dirEntries.writeUInt16LE(1, offset + 4); // color planes
    dirEntries.writeUInt16LE(32, offset + 6); // bits per pixel
    dirEntries.writeUInt32LE(png.length, offset + 8); // data size
    dirEntries.writeUInt32LE(dataOffset, offset + 12); // data offset

    dataOffset += png.length;
  }

  // 拼接所有数据
  return Buffer.concat([
    header,
    dirEntries,
    ...pngBuffers.map((b) => b.png),
  ]);
}

/**
 * 将多个 PNG 打包为 ICNS 格式
 */
function packIcns(pngEntries) {
  // 计算总大小
  let totalSize = 8; // 'icns' magic + file size
  for (const entry of pngEntries) {
    totalSize += 8 + entry.png.length; // type(4) + size(4) + data
  }

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // 写入文件头
  buf.write("icns", offset);
  offset += 4;
  buf.writeUInt32BE(totalSize, offset);
  offset += 4;

  // 写入每个图标条目
  for (const entry of pngEntries) {
    buf.write(entry.type, offset);
    offset += 4;
    buf.writeUInt32BE(8 + entry.png.length, offset);
    offset += 4;
    entry.png.copy(buf, offset);
    offset += entry.png.length;
  }

  return buf;
}

async function main() {
  for (const icon of ICONS) {
    console.log(`\x1b[36m生成图标: ${icon.output}\x1b[0m`);

    const svgBuffer = prepareSvg(icon.svg, icon.viewBox);

    // 收集所有需要的尺寸（去重）
    const allSizes = [
      ...new Set([...ICO_SIZES, ...ICNS_ENTRIES.map((e) => e.size)]),
    ].sort((a, b) => a - b);

    // 并行生成所有尺寸的 PNG
    const pngMap = {};
    await Promise.all(
      allSizes.map(async (size) => {
        pngMap[size] = await renderPng(svgBuffer, size);
        console.log(`  PNG ${size}x${size} ✓`);
      }),
    );

    // 打包 ICO
    const icoData = packIco(
      ICO_SIZES.map((size) => ({ size, png: pngMap[size] })),
    );
    writeFileSync(`${icon.output}.ico`, icoData);
    console.log(`  \x1b[32mICO ✓\x1b[0m (${ICO_SIZES.join(", ")})`);

    // 打包 ICNS
    const icnsData = packIcns(
      ICNS_ENTRIES.map((e) => ({ type: e.type, png: pngMap[e.size] })),
    );
    writeFileSync(`${icon.output}.icns`, icnsData);
    console.log(
      `  \x1b[32mICNS ✓\x1b[0m (${ICNS_ENTRIES.map((e) => e.size).join(", ")})`,
    );
  }

  console.log(`\n\x1b[32m图标生成完成\x1b[0m`);
}

main().catch((err) => {
  console.error("\x1b[31m图标生成失败:\x1b[0m", err);
  process.exit(1);
});
