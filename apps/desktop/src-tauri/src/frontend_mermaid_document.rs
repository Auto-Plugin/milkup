// Only immutable reviewed frontend bytes are served. No filesystem path,
// user document, plugin input, or request body influences this response.
pub const HTML: &[u8] = include_bytes!("../../src/frontend-mermaid/frame.html");
pub const FRAME_URI: &str = "http://milkup-mermaid.localhost/renderer.html";

pub fn allowed_request(method: &str, uri: &str) -> bool {
    method == "GET" && uri == "milkup-mermaid://localhost/renderer.html"
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_document_only() {
        assert!(allowed_request("GET", "milkup-mermaid://localhost/renderer.html"));
        for uri in ["milkup-mermaid://localhost/renderer.html?source=secret", "milkup-mermaid://other/renderer.html", "milkup-mermaid://localhost/../renderer.html", "milkup-mermaid://localhost/anything"] {
            assert!(!allowed_request("GET", uri));
        }
        assert!(!allowed_request("POST", "milkup-mermaid://localhost/renderer.html"));
        let html = std::str::from_utf8(HTML).unwrap();
        assert!(html.contains("Content-Security-Policy"));
        assert!(html.contains("script-src 'sha256-"));
        assert!(!html.contains("'unsafe-eval'"));
        assert!(html.contains("connect-src 'none'"));
    }
}
