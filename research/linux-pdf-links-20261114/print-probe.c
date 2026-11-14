#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdio.h>
#include <unistd.h>

static int outcome = 1;
static gboolean print_failed = FALSE;
static const char *destination;
static const char *maps_path;
static gboolean expired(gpointer unused) {
    (void)unused; fprintf(stderr, "BOUNDED_PRINT_TIMEOUT\n"); gtk_main_quit(); return G_SOURCE_REMOVE;
}
static void failed(WebKitPrintOperation *op, GError *error, gpointer unused) {
    (void)op; (void)unused; print_failed = TRUE; fprintf(stderr, "PRINT_FAILED: %s\n", error->message);
}
static void finished(WebKitPrintOperation *op, gpointer unused) {
    (void)op; (void)unused;
    if (!print_failed && g_file_test(destination, G_FILE_TEST_IS_REGULAR)) outcome = 0;
    gtk_main_quit();
}
static void terminated(WebKitWebView *view, WebKitWebProcessTerminationReason reason, gpointer unused) {
    (void)view; (void)unused; fprintf(stderr, "WEB_PROCESS_TERMINATED: %d\n", reason); gtk_main_quit();
}
static void loaded(WebKitWebView *view, WebKitLoadEvent event, gpointer unused) {
    (void)unused; if (event != WEBKIT_LOAD_FINISHED) return;
    gchar *maps = NULL; gsize length = 0;
    if (!g_file_get_contents("/proc/self/maps", &maps, &length, NULL) ||
        !g_file_set_contents(maps_path, maps, (gssize)length, NULL)) { gtk_main_quit(); g_free(maps); return; }
    g_free(maps);
    WebKitPrintOperation *op = webkit_print_operation_new(view);
    GtkPrintSettings *settings = gtk_print_settings_new();
    gchar *uri = g_filename_to_uri(destination, NULL, NULL);
    gtk_print_settings_set_printer(settings, "Print to File");
    gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_FILE_FORMAT, "pdf");
    gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, uri);
    webkit_print_operation_set_print_settings(op, settings);
    GtkPageSetup *page = gtk_page_setup_new();
    GtkPaperSize *paper = gtk_paper_size_new(GTK_PAPER_NAME_A4);
    gtk_page_setup_set_paper_size(page, paper);
    gtk_page_setup_set_top_margin(page, 0, GTK_UNIT_MM);
    gtk_page_setup_set_bottom_margin(page, 0, GTK_UNIT_MM);
    gtk_page_setup_set_left_margin(page, 0, GTK_UNIT_MM);
    gtk_page_setup_set_right_margin(page, 0, GTK_UNIT_MM);
    webkit_print_operation_set_page_setup(op, page);
    g_signal_connect(op, "failed", G_CALLBACK(failed), NULL);
    g_signal_connect(op, "finished", G_CALLBACK(finished), NULL);
    webkit_print_operation_print(op);
    g_free(uri); gtk_paper_size_free(paper); g_object_unref(page); g_object_unref(settings);
}
int main(int argc, char **argv) {
    if (argc != 4 || getuid() == 0 || g_getenv("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS")) return 2;
    destination = argv[2]; maps_path = argv[3];
    if (g_file_test(destination, G_FILE_TEST_EXISTS) || !g_path_is_absolute(destination)) return 3;
    gchar *html = NULL;
    if (!g_file_get_contents(argv[1], &html, NULL, NULL) || !gtk_init_check(&argc, &argv)) return 4;
    WebKitWebContext *context = webkit_web_context_new_ephemeral();
    webkit_web_context_set_sandbox_enabled(context, TRUE);
    if (!webkit_web_context_get_sandbox_enabled(context)) return 5;
    GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    GtkWidget *view = webkit_web_view_new_with_context(context);
    webkit_settings_set_enable_javascript(webkit_web_view_get_settings(WEBKIT_WEB_VIEW(view)), FALSE);
    gtk_container_add(GTK_CONTAINER(window), view); gtk_window_set_default_size(GTK_WINDOW(window), 800, 900);
    g_signal_connect(view, "load-changed", G_CALLBACK(loaded), NULL);
    g_signal_connect(view, "web-process-terminated", G_CALLBACK(terminated), NULL);
    gtk_widget_show_all(window); g_timeout_add_seconds(45, expired, NULL);
    printf("SANDBOX_ENABLED pid=%d\n", getpid()); fflush(stdout);
    webkit_web_view_load_html(WEBKIT_WEB_VIEW(view), html, "https://example.invalid/");
    gtk_main(); gtk_widget_destroy(window); g_object_unref(context); g_free(html); return outcome;
}
