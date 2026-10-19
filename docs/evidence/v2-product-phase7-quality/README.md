# P7 品质证据

对应[阶段报告](../../v2-product-phase7-quality-2026-10-19.md)与[验收清单](../../v2-product-phase7-quality-checklist.md)。M01保存原始失败、修复后检查、生产输入哈希、原生测量及实际截图；不包含可执行程序、安装包、用户profile或Runtime。

大Markdown合成夹具及大型原生samples.json采用确定性无损gzip；原始名称、字节数/SHA和归档字节数/SHA均记录在M01 manifest，不能把压缩文件SHA当作原始数据SHA。JSON不重排、不重写，校验会解压恢复其原字节再比对。原图未重绘，contact sheet只帮助定位，不能代替原PNG审查。

在仓库根目录运行：

```sh
python3 -B docs/evidence/v2-product-phase7-quality/milestone01/archive-tools/verify.py \
  docs/evidence/v2-product-phase7-quality/milestone01
```

此校验核对归档文件及gzip解压后的原始字节数与哈希，不把哈希视为平台验收。Linux WebKit/X11、Chromium浏览器与模拟组件测试分别记录；Windows/macOS GUI、系统DPI、真实系统IME及屏幕阅读器未由这些证据证明。
