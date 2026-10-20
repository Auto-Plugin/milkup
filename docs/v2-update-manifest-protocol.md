# 更新清单签名与获取合同

本合同由宿主的固定渠道配置启用。`release/update-channel.json` 仍是空 endpoints / null publicKey，应用仍为 `2.0.0-beta.1`；本轮不配置正式渠道、生成正式密钥、构建或安装升级包。独立更新插件只取得不透明候选 ID、版本说明和状态，不能指定 URL、公钥、渠道策略或待安装字节。

## 线格式与绑定

HTTPS 清单响应是一个仅含两个字段的 JSON envelope：

```json
{
  "payload": "<base64 of exact signed UTF-8 JSON bytes>",
  "signature": "<base64 of the detached minisign signature text>"
}
```

验签通过后才解析 payload，形状如下。示例不是可用发布地址或实际签名：

```json
{
  "schema": 1,
  "product": "milkup-desktop",
  "channel": "beta",
  "release": {
    "version": "2.0.0-beta.2",
    "notes": "版本说明",
    "platforms": {
      "windows-x86_64": {
        "url": "https://example.invalid/package",
        "signature": "<base64 of that package's minisign signature text>"
      }
    }
  }
}
```

envelope 和外层 signed statement 拒绝未知字段；schema、product、channel 必须匹配宿主政策，version 必须是规范 SemVer。使用已安装版本的 SemVer precedence 判断更新，同版本、降级或仅 build metadata 不同不会作为升级；stable 不接受 prerelease。平台由既有 updater 的宿主平台/架构选择规则从**已签名的 platforms**中选择，插件不能覆盖。

清单签名认证“这个版本/渠道对应这个平台的 URL 和包签名”。下载后，用同一个宿主信任根独立验证包字节。宿主保存选中版本、签名、URL、target 的绑定；后续修改任何一项都会失效。安装前再次检查绑定、重新验签，然后才可能进入既有提取/安装路径。

**这证明的是签名发布者声明与下载字节的绑定，不是从安装器内独立提取应用版本。** 签名者仍可能签错元数据。未来发行必须在签署清单前，独立核对源版本、构建输出和安装包内应用版本；该真实构建/安装验收本轮未执行。也没有新增持久化“已见最高版本”或透明日志：只拒绝不高于已安装版本的重放，不宣称解决服务器冻结、签名密钥泄露或应用自动回滚。

## 有界网络与撤销

- 清单状态只接受 200 或既有 204 无更新；包只接受 200。任何重定向都拒绝，不访问 Location。未来 CDN 必须提供最终直达 HTTPS URL，不能依靠客户端跟随跳转。
- 清单累计正文上限 256 KiB，先检查 Content-Length，再逐块检查实际字节，最后才解析 JSON/解码/验签。没有 Content-Length 或 chunked 也受相同限制。版本说明仍受原 128 KiB 上限约束。这个预算不等于包括 HTTP 栈分块及解析对象在内的整个进程 RSS。
- 包正文在追加到缓冲区前受 256 MiB 限制，继续独立验签；不以进度回调作为唯一内存闸门。
- 一次检查的总截止为 20 秒，覆盖多个固定端点的尝试、正文与验签结果等待；单请求也有超时。底层同步解析/验签的执行量由清单字节预算限制，取消不是对同步 CPU 指令的强制抢占。
- 原生宿主先保留不透明 generation，再启动异步检查。插件能力撤销会取消同一 generation，丢弃网络 future；即使取消先于 check 命令执行，后者也不能启动读取。发布候选与取消使用同一个状态锁，迟到成功/失败不能复活候选或清除新请求的取消句柄。
- 取消检查会撤销该 generation 的结果；下载取消保留既有同版本重试语义，并继续使用独立 download epoch 防止旧下载完成污染重试。安装前仍经过文档保存和原生确认流程。

## 验证范围

测试用 [合成向量](../tests/fixtures/updates/signed-manifest.json) 使用公开、确定性的测试材料，不是正式密钥，未写入产品配置。fixture generator 只用于开发时重建这些静态向量；使用执行器已有 Python 工具，没有给应用、插件、Cargo 或 pnpm 增加依赖。测试的 HTTP 名称通过测试客户端解析到临时 loopback listener，不联系真实发布服务，也不放宽生产 HTTPS 配置。

静态合成字节不是可执行安装器。验证覆盖真实 minisign、已签名元数据被修改、错误 key/scope、旧包替换、绑定字段改变、Content-Length/chunked/截断/精确上限、跳转目的地零请求、超时、取消和迟到结果。正式签名发行、真实包内版本、升级中断/首次启动失败/应用回滚及目标系统安装行为仍需独立授权和验收。
