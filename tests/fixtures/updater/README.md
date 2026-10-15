# 更新校验夹具来源

`apps/desktop/src-tauri/src/updates_tests.rs` 使用 minisign-verify 0.2.5 的公开 `verify_prehashed` 测试向量：正文为 `test`，公钥与签名来自该包的 `src/lib.rs`。原作者为 Frank Denis，MIT 许可证随本目录保存。

这些向量只在 `#[cfg(test)]` 中编译。测试使用本机临时 HTTP 服务调用真正的 Tauri `Update::download` 验签，再对正文、签名、公钥分别篡改验证拒绝路径。没有私钥，也没有生成或配置发布签名密钥。生产请求强制 HTTPS，默认发布渠道为空；本机 HTTP 仅在 Rust 调试测试中使用，不加入生产配置。

来源：[minisign-verify 0.2.5](https://docs.rs/crate/minisign-verify/0.2.5/source/src/lib.rs)。
