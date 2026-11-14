#include <gtk/gtk.h>
#include <sys/vfs.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static GMainLoop *loop;
static GtkFileChooserNative *chooser;
static gboolean finish(gpointer ignored) {
  (void)ignored;
  printf("lifecycle_hide mono=%" G_GINT64_FORMAT "\n",g_get_monotonic_time());fflush(stdout);
  gtk_native_dialog_hide(GTK_NATIVE_DIALOG(chooser));g_main_loop_quit(loop);return G_SOURCE_REMOVE;
}
static void diagnostics(const char *stage,const char *maps_dir) {
  struct statfs data;errno=0;int code=statfs("/",&data);
  printf("%s statfs result=%d errno=%d message=%s\n",stage,code,errno,strerror(errno));
  GFile *file=g_file_new_for_path("/");GError *error=NULL;
  GFileInfo *info=g_file_query_filesystem_info(file,"filesystem::free,filesystem::type",NULL,&error);
  printf("%s gio_filesystem success=%d error=%s\n",stage,info!=NULL,error?error->message:"none");
  if(info){g_object_unref(info);}
  g_clear_error(&error);g_object_unref(file);
  GdkPixbuf *image=gdk_pixbuf_new_from_file("/usr/share/icons/Adwaita/scalable/status/image-missing.svg",&error);
  printf("%s svg_decode success=%d error=%s\n",stage,image!=NULL,error?error->message:"none");
  if(image){g_object_unref(image);}
  g_clear_error(&error);
  gchar *maps=NULL;gsize size=0;
  if(g_file_get_contents("/proc/self/maps",&maps,&size,&error)){
    gchar *dest=g_strdup_printf("%s/%s.maps",maps_dir,stage);g_file_set_contents(dest,maps,size,NULL);g_free(dest);g_free(maps);
  } else {printf("%s self_maps error=%s\n",stage,error?error->message:"unknown");g_clear_error(&error);}
  fflush(stdout);
}
int main(int argc,char **argv){
  if(argc!=3){fprintf(stderr,"usage: chooser archive maps-directory\n");return 2;}
  char *archive=g_strdup(argv[1]),*dir=g_strdup(argv[2]);
  diagnostics("before_gtk",dir);
  if(!gtk_init_check(&argc,&argv)){fprintf(stderr,"gtk init failed\n");return 3;}
  printf("single_main_thread pid=%ld mono=%" G_GINT64_FORMAT "\n",(long)getpid(),g_get_monotonic_time());
  for(int i=1;i<=3;i++){
    char title[64];snprintf(title,sizeof(title),"Independent chooser %d",i);
    chooser=gtk_file_chooser_native_new(title,NULL,GTK_FILE_CHOOSER_ACTION_OPEN,"Open","Cancel");
    gchar *folder=g_path_get_dirname(archive);gtk_file_chooser_set_current_folder(GTK_FILE_CHOOSER(chooser),folder);g_free(folder);
    gtk_file_chooser_select_filename(GTK_FILE_CHOOSER(chooser),archive);
    loop=g_main_loop_new(NULL,FALSE);printf("lifecycle_show index=%d mono=%" G_GINT64_FORMAT "\n",i,g_get_monotonic_time());fflush(stdout);
    gtk_native_dialog_show(GTK_NATIVE_DIALOG(chooser));g_timeout_add(3000,finish,NULL);g_main_loop_run(loop);
    g_object_unref(chooser);g_main_loop_unref(loop);char stage[32];snprintf(stage,sizeof(stage),"after_%d",i);diagnostics(stage,dir);
  }
  g_free(archive);g_free(dir);puts("DONE 3 bounded C-show/C-hide cycles; no acceptance claim");return 0;
}
