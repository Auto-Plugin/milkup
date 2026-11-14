#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdio.h>
static int outcome = 1;
static gboolean deadline(gpointer unused) {
  (void)unused; fprintf(stderr,"PRECONDITION_FAILED: sandboxed WebKit navigation timeout\n"); gtk_main_quit(); return G_SOURCE_REMOVE;
}
static void failed(WebKitWebView *view, WebKitWebProcessTerminationReason reason, gpointer unused) {
  (void)view;(void)unused;fprintf(stderr,"PRECONDITION_FAILED: WebKit web process terminated reason=%d\n",reason);gtk_main_quit();
}
static void loaded(WebKitWebView *view, WebKitLoadEvent event, gpointer unused) {
  (void)unused;if(event!=WEBKIT_LOAD_FINISHED)return;
  printf("WEBKIT_SANDBOX_NAVIGATION_PASSED sandbox=%d uri=%s\n",webkit_web_context_get_sandbox_enabled(webkit_web_view_get_context(view)),webkit_web_view_get_uri(view));fflush(stdout);outcome=0;gtk_main_quit();
}
int main(int argc,char **argv) {
  if(!gtk_init_check(&argc,&argv)){fprintf(stderr,"PRECONDITION_FAILED: GTK display unavailable\n");return 2;}
  WebKitWebContext *context=webkit_web_context_new_ephemeral();
  webkit_web_context_set_sandbox_enabled(context,TRUE);
  if(!webkit_web_context_get_sandbox_enabled(context)){fprintf(stderr,"PRECONDITION_FAILED: sandbox not enabled\n");return 3;}
  GtkWidget *window=gtk_window_new(GTK_WINDOW_TOPLEVEL);
  GtkWidget *view=webkit_web_view_new_with_context(context);
  webkit_settings_set_enable_javascript(webkit_web_view_get_settings(WEBKIT_WEB_VIEW(view)),FALSE);
  gtk_container_add(GTK_CONTAINER(window),view);gtk_window_set_default_size(GTK_WINDOW(window),640,480);
  g_signal_connect(view,"web-process-terminated",G_CALLBACK(failed),NULL);
  g_signal_connect(view,"load-changed",G_CALLBACK(loaded),NULL);
  gtk_widget_show_all(window);
  g_timeout_add_seconds(30,deadline,NULL);
  webkit_web_view_load_html(WEBKIT_WEB_VIEW(view),"<!doctype html><meta charset=utf-8><h1>MILKUP_LINUX_SANDBOX_PREFLIGHT</h1><p>Only a generated local fixture.</p>","about:blank");
  gtk_main();gtk_widget_destroy(window);g_object_unref(context);return outcome;
}
