// Native keys for one already-owned Milkup window. No Unicode injection, remote
// memory writes, global language/default changes, or session-wide TSF activation.
#include <windows.h>
#include <msctf.h>
#include <cstdio>
#include <cwchar>
#include <stdexcept>
#include <string>
static void need(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
static void pump(DWORD ms){auto end=GetTickCount64()+ms;MSG msg;while(GetTickCount64()<end){while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageW(&msg);}Sleep(10);}}
struct Owner {DWORD pid;HANDLE process;HWND window=nullptr;};
static BOOL CALLBACK findWindow(HWND w,LPARAM v){auto& o=*(Owner*)v;DWORD pid=0;GetWindowThreadProcessId(w,&pid);if(pid==o.pid&&IsWindowVisible(w)&&GetWindow(w,GW_OWNER)==nullptr){if(o.window){o.window=(HWND)(INT_PTR)-1;return FALSE;}o.window=w;}return TRUE;}
static void owned(Owner& o){need(WaitForSingleObject(o.process,0)==WAIT_TIMEOUT,"Owned process exited");DWORD pid=0;GetWindowThreadProcessId(o.window,&pid);need(pid==o.pid&&IsWindow(o.window),"Owned window identity changed");}
static void press(Owner& o,WORD vk,bool shift=false){owned(o);need(GetForegroundWindow()==o.window,"Refusing input to another foreground window");INPUT in[4]={};unsigned n=0;auto add=[&](WORD k,bool up){in[n].type=INPUT_KEYBOARD;in[n].ki.wVk=k;in[n].ki.dwFlags=up?KEYEVENTF_KEYUP:0;++n;};if(shift)add(VK_SHIFT,false);add(vk,false);add(vk,true);if(shift)add(VK_SHIFT,true);need(SendInput(n,in,sizeof(INPUT))==n,"SendInput incomplete");pump(140);}
int wmain(int argc,wchar_t** argv){
 setvbuf(stdout,nullptr,_IONBF,0);if(argc!=4||!GetEnvironmentVariableW(L"GITHUB_ACTIONS",nullptr,0))return 2;
 wchar_t* end=nullptr;unsigned long parsed=wcstoul(argv[1],&end,10);if(!parsed||!end||*end)return 2;DWORD pid=(DWORD)parsed;unsigned long long expectedTicks=_wcstoui64(argv[2],&end,10);if(!expectedTicks||!end||*end)return 2;
 Owner owner{pid,OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid)};
 if(!owner.process)return 3;
 ITfThreadMgr* tm=nullptr;ITfInputProcessorProfiles* profiles=nullptr;ITfInputProcessorProfileMgr* mgr=nullptr;
 GUID clsid={},profile={};BOOL originalEnabled=FALSE;bool enableObserved=false,co=false,active=false;LANGID originalLanguage=0;HKL targetOld=nullptr;DWORD targetThread=0;bool switched=false;int result=1;
 try {
  FILETIME creation,exit,kernel,user;need(GetProcessTimes(owner.process,&creation,&exit,&kernel,&user),"Process birth unavailable");ULARGE_INTEGER birth{};birth.LowPart=creation.dwLowDateTime;birth.HighPart=creation.dwHighDateTime;need(birth.QuadPart+504911232000000000ULL==expectedTicks,"Process birth mismatch");
  wchar_t image[32768];DWORD count=32768;need(QueryFullProcessImageNameW(owner.process,0,image,&count),"Process image unavailable");need(CompareStringOrdinal(image,-1,argv[3],-1,TRUE)==CSTR_EQUAL,"Exact process image mismatch");
  EnumWindows(findWindow,(LPARAM)&owner);need(owner.window&&owner.window!=(HWND)(INT_PTR)-1,"One visible owned top-level window required");owned(owner);SetForegroundWindow(owner.window);pump(200);need(GetForegroundWindow()==owner.window,"Owned foreground required");
  targetThread=GetWindowThreadProcessId(owner.window,nullptr);targetOld=GetKeyboardLayout(targetThread);need(targetOld!=nullptr,"Original target layout required");
  need(!(GetKeyState(VK_CONTROL)&0x8000)&&!(GetKeyState(VK_MENU)&0x8000)&&!(GetKeyState(VK_SHIFT)&0x8000)&&!(GetKeyState(VK_CAPITAL)&1),"Neutral physical keyboard state required");
  need(SUCCEEDED(CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED)),"COM initialization failed");co=true;
  need(SUCCEEDED(CoCreateInstance(CLSID_TF_ThreadMgr,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&tm))),"TSF unavailable");TfClientId id=0;need(SUCCEEDED(tm->Activate(&id)),"TSF activation failed");active=true;
  need(SUCCEEDED(CoCreateInstance(CLSID_TF_InputProcessorProfiles,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&profiles))),"TSF profiles unavailable");need(SUCCEEDED(profiles->QueryInterface(IID_PPV_ARGS(&mgr))),"TSF profile manager unavailable");
  CLSIDFromString(L"{81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E}",&clsid);CLSIDFromString(L"{FA550B04-5AD7-411F-A5AC-CA038EC515D7}",&profile);
  need(SUCCEEDED(profiles->GetCurrentLanguage(&originalLanguage)),"Original language unavailable");need(SUCCEEDED(profiles->IsEnabledLanguageProfile(clsid,0x804,profile,&originalEnabled)),"Original profile enablement unavailable");enableObserved=true;
  need(originalEnabled||SUCCEEDED(profiles->EnableLanguageProfile(clsid,0x804,profile,TRUE)),"Temporary owned-user profile enablement failed");
  need(SUCCEEDED(profiles->ChangeCurrentLanguage(0x804)),"Helper language activation failed");need(mgr->ActivateProfile(TF_PROFILETYPE_INPUTPROCESSOR,0x804,clsid,profile,nullptr,TF_IPPMF_FORPROCESS)==S_OK,"Helper Pinyin activation failed");pump(300);
  HKL chinese=GetKeyboardLayout(0);need(LOWORD((ULONG_PTR)chinese)==0x804,"Chinese layout was not established");DWORD_PTR response=0;owned(owner);switched=true;
  need(SendMessageTimeoutW(owner.window,WM_INPUTLANGCHANGEREQUEST,0,(LPARAM)chinese,SMTO_ABORTIFHUNG,3000,&response)!=0,"Target language request failed");pump(500);
  printf("targetPid=%lu targetThread=%lu originalHkl=%p requestedHkl=%p observedHkl=%p\n",pid,targetThread,targetOld,chinese,GetKeyboardLayout(targetThread));
  need(LOWORD((ULONG_PTR)GetKeyboardLayout(targetThread))==0x804,"Owned target did not activate Chinese");
  for(wchar_t c:std::wstring(L"ZHONGWEN"))press(owner,(WORD)c);pump(500);press(owner,VK_SPACE);pump(500);
  press(owner,VK_OEM_COMMA);press(owner,VK_OEM_PERIOD);press(owner,VK_OEM_2,true);press(owner,'1',true);press(owner,VK_OEM_1,true);press(owner,VK_OEM_1);pump(500);
  printf("physicalPinyinAndPunctuationSent=true expectedUtf16=4e2d,6587,ff0c,3002,ff1f,ff01,ff1a,ff1b\n");result=0;
 } catch(const std::exception& e){printf("failure=%s win32=%lu\n",e.what(),GetLastError());}
 if(switched){DWORD_PTR response=0;try{owned(owner);need(SendMessageTimeoutW(owner.window,WM_INPUTLANGCHANGEREQUEST,0,(LPARAM)targetOld,SMTO_ABORTIFHUNG,3000,&response)!=0,"Target language restoration failed");pump(300);need(GetKeyboardLayout(targetThread)==targetOld,"Target layout restoration unconfirmed");printf("targetLayoutRestored=true\n");}catch(const std::exception& e){printf("cleanupFailure=%s\n",e.what());result=1;}}
 if(profiles&&enableObserved){HRESULT language=profiles->ChangeCurrentLanguage(originalLanguage);HRESULT enable=originalEnabled?S_OK:profiles->EnableLanguageProfile(clsid,0x804,profile,FALSE);BOOL now=TRUE;HRESULT checked=profiles->IsEnabledLanguageProfile(clsid,0x804,profile,&now);bool restored=SUCCEEDED(language)&&SUCCEEDED(enable)&&SUCCEEDED(checked)&&now==originalEnabled;printf("ownedUserProfileRestored=%s\n",restored?"true":"false");if(!restored)result=1;}
 if(mgr)mgr->Release();if(profiles)profiles->Release();if(tm){if(active)tm->Deactivate();tm->Release();}if(co)CoUninitialize();CloseHandle(owner.process);printf("nativeInputExit=%d productTextAcceptance=required-separately\n",result);return result;
}
