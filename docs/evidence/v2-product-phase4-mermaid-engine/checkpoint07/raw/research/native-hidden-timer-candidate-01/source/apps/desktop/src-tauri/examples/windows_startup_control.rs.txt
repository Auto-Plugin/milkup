// Diagnostic control only: same locked Tauri runtime, no editor or plugins.
fn main() {
    eprintln!("control: main entered");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "app.milkup.startup-control".into();
    tauri::Builder::default()
        .setup(|app| {
            eprintln!("control: setup entered");
            tauri::WebviewWindowBuilder::new(
                app,
                "startup-control",
                tauri::WebviewUrl::External("about:blank".parse()?),
            )
            .title("milkup minimal Tauri startup control")
            .inner_size(640.0, 400.0)
            .visible(true)
            .build()?;
            eprintln!("control: webview window built");
            Ok(())
        })
        .on_page_load(|_, payload| {
            eprintln!("control: page {:?} {}", payload.event(), payload.url())
        })
        .run(context)
        .expect("minimal Tauri startup control failed");
}
