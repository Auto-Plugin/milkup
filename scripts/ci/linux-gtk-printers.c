#include <gtk/gtk.h>
#include <gtk/gtkunixprint.h>
#include <stdio.h>
static unsigned count=0;
static gboolean found(GtkPrinter *printer,gpointer unused){
 (void)unused;
 const char *name=gtk_printer_get_name(printer);
 char *encoded=g_base64_encode((const guchar *)name,strlen(name));
 printf("{\"nameBase64\":\"%s\",\"virtual\":%s,\"active\":%s,\"default\":%s,\"acceptsPdf\":%s}\n",encoded,gtk_printer_is_virtual(printer)?"true":"false",gtk_printer_is_active(printer)?"true":"false",gtk_printer_is_default(printer)?"true":"false",gtk_printer_accepts_pdf(printer)?"true":"false");
 g_free(encoded);count++;return FALSE;
}
int main(int argc,char **argv){
 if(!gtk_init_check(&argc,&argv)){fprintf(stderr,"GTK display unavailable\n");return 2;}
 gtk_enumerate_printers(found,NULL,NULL,TRUE);
 printf("{\"enumerationComplete\":true,\"count\":%u,\"jobsSubmitted\":0}\n",count);return 0;
}
