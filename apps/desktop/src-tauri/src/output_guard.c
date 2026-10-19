/* Static output has one immutable native document and inline image snapshots.
 * This separate guard does not change the plugin DOM guard's allowlist. */
#include <webkit2/webkit-web-extension.h>
#include <string.h>
static gboolean guard(WebKitWebPage *page, WebKitURIRequest *request,
                      WebKitURIResponse *redirect, gpointer data) {
    (void)page; (void)data;
    const char *uri = webkit_uri_request_get_uri(request);
    return redirect || !uri || (strcmp(uri, "milkup-output://job/index.html") &&
        strncmp(uri, "data:image/png;base64,", 22) &&
        strncmp(uri, "data:image/jpeg;base64,", 23) &&
        strncmp(uri, "data:image/webp;base64,", 23) &&
        strncmp(uri, "data:image/svg+xml;base64,", 26));
}
static void created(WebKitWebExtension *extension, WebKitWebPage *page, gpointer data) {
    (void)data;
    g_signal_connect(page, "send-request", G_CALLBACK(guard), extension);
    WebKitUserMessage *message = webkit_user_message_new("milkup-output-guard-ready", NULL);
    webkit_web_extension_send_message_to_context(extension, message, NULL, NULL, NULL);
}
G_MODULE_EXPORT void webkit_web_extension_initialize(WebKitWebExtension *extension) {
    g_signal_connect(extension, "page-created", G_CALLBACK(created), NULL);
}
