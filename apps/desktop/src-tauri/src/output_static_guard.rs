//! Reject active browsing contexts before the native browser sees the document.
//! This is an additional static-output boundary, not a general HTML sanitizer.
use html5ever::tokenizer::{
    BufferQueue, Token, TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts,
};
use std::cell::Cell;

#[derive(Default)]
struct StaticTokens {
    forbidden: Cell<bool>,
}
impl TokenSink for StaticTokens {
    type Handle = ();
    fn process_token(&self, token: Token, _: u64) -> TokenSinkResult<()> {
        match token {
            Token::TagToken(tag) => {
                // These tags do not occur in the controlled static serializer.
                // In particular, cancelling iframe navigation was too late to
                // prevent connection setup in the real WebView2 negative test.
                if matches!(
                    tag.name.as_ref(),
                    "iframe"
                        | "frame"
                        | "frameset"
                        | "object"
                        | "embed"
                        | "portal"
                        | "fencedframe"
                        | "link"
                        | "base"
                ) || tag.attrs.iter().any(|a| a.name.local.as_ref() == "srcdoc")
                    || (tag.name.as_ref() == "meta"
                        && tag.attrs.iter().any(|a| {
                            a.name.local.as_ref() == "http-equiv"
                                && a.value.trim().eq_ignore_ascii_case("refresh")
                        }))
                {
                    self.forbidden.set(true);
                }
            }
            // Do not pass malformed input to a different parser and assume both
            // engines will repair it identically. The serializer emits valid HTML.
            // Comments are not emitted by the serializer. Reject them too: a
            // tokenizer without tree-builder raw-text context could otherwise
            // hide </style><iframe> inside a comment the browser sees as CSS.
            Token::ParseError(_) | Token::NullCharacterToken | Token::CommentToken(_) => {
                self.forbidden.set(true)
            }
            _ => {}
        }
        TokenSinkResult::Continue
    }
}

pub(super) fn validate(html: &str) -> Result<(), String> {
    let input = BufferQueue::default();
    input.push_back(html.into());
    let tokenizer = Tokenizer::new(StaticTokens::default(), TokenizerOpts::default());
    let _ = tokenizer.feed(&input);
    tokenizer.end();
    if !input.is_empty() || tokenizer.sink.forbidden.get() {
        Err("Static output rejects active browsing contexts or malformed HTML before browser launch".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_nested_contexts_prefetch_and_ambiguous_markup() {
        for html in [
            "<iframe src='https://example.invalid'>",
            "<IFRAME\nSRC='x'>",
            "<template><iframe srcdoc='x'></iframe></template>",
            "<object data='x'>",
            "<embed src='x'>",
            "<frameset><frame src='x'></frameset>",
            "<link rel='preconnect' href='x'>",
            "<meta HTTP-EQUIV='r&#101;fresh' content='0;url=x'>",
            "<base href='x'>",
            "<iframe\0 src='x'>",
            "<img src='unterminated>",
            "<style><!--</style><iframe src='x'>-->",
            "<script><!--</script><iframe src='x'>-->",
            "<![CDATA[<iframe src='x'>]]>",
        ] {
            assert!(validate(html).is_err(), "{html}");
        }
    }
    #[test]
    fn keeps_static_text_styles_svg_math_and_escaped_source() {
        assert!(validate("<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><style>@page{size:Letter landscape}body{color:#222}</style></head><body><h1>中文😀</h1><pre>&lt;iframe src='example'&gt;</pre><svg xmlns='http://www.w3.org/2000/svg'><text x='1'>图</text></svg><math><mi>x</mi></math><img src='data:image/png;base64,AAAA'><a href='https://example.invalid'>link</a></body></html>").is_ok());
    }
}
