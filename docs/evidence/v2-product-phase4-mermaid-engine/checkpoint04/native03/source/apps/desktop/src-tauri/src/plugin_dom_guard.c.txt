/* Deny every WebProcess resource except the three immutable native snapshots. */
#include <webkit2/webkit-web-extension.h>
#include <string.h>
static gboolean request_guard(WebKitWebPage *page, WebKitURIRequest *request,
                              WebKitURIResponse *redirect, gpointer data) {
    const char *uri = webkit_uri_request_get_uri(request);
    (void)page;
    gboolean denied = redirect || !(uri && (!strcmp(uri, "milkup-dom://job/index.html") ||
                    !strcmp(uri, "milkup-dom://job/bootstrap.js") ||
                    !strcmp(uri, "milkup-dom://job/module.js")));
    static gboolean reported = FALSE;
    if (denied && !reported) {
        reported = TRUE;
        WebKitUserMessage *message = webkit_user_message_new("milkup-dom-native-guard-deny-v1", NULL);
        webkit_web_extension_send_message_to_context(WEBKIT_WEB_EXTENSION(data), message, NULL, NULL, NULL);
    }
    return denied;
}
static void page_created(WebKitWebExtension *extension, WebKitWebPage *page, gpointer data) {
    (void)data;
    g_signal_connect(page, "send-request", G_CALLBACK(request_guard), extension);
    WebKitUserMessage *ready = webkit_user_message_new("milkup-dom-native-guard-ready-v1", NULL);
    webkit_web_extension_send_message_to_context(extension, ready, NULL, NULL, NULL);
}
G_MODULE_EXPORT void webkit_web_extension_initialize(WebKitWebExtension *extension) {
    g_signal_connect(extension, "page-created", G_CALLBACK(page_created), NULL);
}
