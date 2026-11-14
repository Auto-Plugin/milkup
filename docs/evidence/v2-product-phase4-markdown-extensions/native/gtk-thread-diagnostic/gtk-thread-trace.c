#define _GNU_SOURCE
#include <dlfcn.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <fcntl.h>
#include <time.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Diagnostic-only forwarding interposition. At most two calls per symbol/TID,
 * 64 distinct symbol/TID slots, 128 lines/process. No loop-by-loop output. */
struct slot { long tid; unsigned key, count; };
static struct slot slots[64];
static atomic_flag lock = ATOMIC_FLAG_INIT;
static int logfd=-1;
static _Thread_local unsigned thread_counts[6];
__attribute__((constructor)) static void trace_init(void) {
  const char *path=getenv("MILKUP_GTK_THREAD_TRACE"),*app=getenv("MILKUP_GTK_TRACE_APP");
  char executable[4096];ssize_t size=readlink("/proc/self/exe",executable,sizeof(executable)-1);
  if(size<0||!app||!*app)return;
  executable[size]=0;
  if(path&&*path&&strcmp(executable,app)==0) logfd=open(path,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);
}
static void note(unsigned key,const char *name,void *caller) {
  if(logfd<0 || key>=6 || thread_counts[key]>=2) return;
  thread_counts[key]++;
  if(atomic_flag_test_and_set_explicit(&lock,memory_order_acquire)) return;
  long tid=syscall(SYS_gettid); unsigned i;
  for(i=0;i<64;i++) if((slots[i].tid==tid&&slots[i].key==key)||slots[i].tid==0) break;
  if(i==64 || slots[i].count>=2){atomic_flag_clear_explicit(&lock,memory_order_release);return;}
  slots[i].tid=tid;slots[i].key=key;slots[i].count++;
  struct timespec ts;clock_gettime(CLOCK_MONOTONIC,&ts);Dl_info info={0};dladdr(caller,&info);
  char line[1400];int n=snprintf(line,sizeof(line),"pid=%ld tid=%ld mono=%lld.%09ld symbol=%s occurrence=%u caller=%p module=%s offset=0x%lx caller_symbol=%s\n",(long)getpid(),tid,(long long)ts.tv_sec,ts.tv_nsec,name,slots[i].count,caller,info.dli_fname?info.dli_fname:"?",info.dli_fbase?(unsigned long)((uintptr_t)caller-(uintptr_t)info.dli_fbase):0,info.dli_sname?info.dli_sname:"?");
  if(n>0) (void)write(logfd,line,(size_t)n<sizeof(line)?(size_t)n:sizeof(line)-1);
  atomic_flag_clear_explicit(&lock,memory_order_release);
}
static void *symbol(void **cache,const char *name){void *p=__atomic_load_n(cache,__ATOMIC_ACQUIRE);if(!p){p=dlsym(RTLD_NEXT,name);if(!p){const char msg[]="GTK trace: missing RTLD_NEXT symbol; diagnostic aborted\n";write(2,msg,sizeof(msg)-1);_exit(126);}__atomic_store_n(cache,p,__ATOMIC_RELEASE);}return p;}
int gtk_init_check(int *argc,char ***argv){static void *p;int(*fn)(int*,char***)=symbol(&p,"gtk_init_check");note(1,"gtk_init_check",__builtin_return_address(0));return fn(argc,argv);}
int gtk_main_iteration(void){static void *p;int(*fn)(void)=symbol(&p,"gtk_main_iteration");note(2,"gtk_main_iteration",__builtin_return_address(0));return fn();}
int gtk_main_iteration_do(int blocking){static void *p;int(*fn)(int)=symbol(&p,"gtk_main_iteration_do");note(3,"gtk_main_iteration_do",__builtin_return_address(0));return fn(blocking);}
void g_main_loop_run(void *loop){static void *p;void(*fn)(void*)=symbol(&p,"g_main_loop_run");note(4,"g_main_loop_run",__builtin_return_address(0));fn(loop);}
void *gtk_file_chooser_native_new(const char *title,void *parent,int action,const char *accept,const char *cancel){static void *p;void*(*fn)(const char*,void*,int,const char*,const char*)=symbol(&p,"gtk_file_chooser_native_new");note(5,"gtk_file_chooser_native_new",__builtin_return_address(0));return fn(title,parent,action,accept,cancel);}
