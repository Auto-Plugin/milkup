// Isolated CI capability control. Never sends keys outside its own foreground window.
#include <windows.h>
#include <msctf.h>
#include <imm.h>
#include <cstdio>
#include <vector>
static unsigned compositionStart=0,compositionEnd=0,compositionUpdates=0;
static WNDPROC prior=nullptr;
static LRESULT CALLBACK Observe(HWND w,UINT m,WPARAM a,LPARAM b){
 if(m==WM_IME_STARTCOMPOSITION)++compositionStart;
 if(m==WM_IME_ENDCOMPOSITION)++compositionEnd;
 if(m==WM_IME_COMPOSITION)++compositionUpdates;
 return CallWindowProcW(prior,w,m,a,b);
}
static void pump(unsigned ms){auto end=GetTickCount64()+ms;MSG msg;while(GetTickCount64()<end){while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageW(&msg);}Sleep(10);}}
static bool key(HWND parent,WORD vk){if(GetForegroundWindow()!=parent)return false;INPUT in[2]={};for(auto& i:in){i.type=INPUT_KEYBOARD;i.ki.wVk=vk;}in[1].ki.dwFlags=KEYEVENTF_KEYUP;return SendInput(2,in,sizeof(INPUT))==2;}
int main(){
 if(!GetEnvironmentVariableW(L"GITHUB_ACTIONS",nullptr,0))return 2;
 setvbuf(stdout,nullptr,_IONBF,0);
 HRESULT co=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);if(FAILED(co))return 3;
 ITfThreadMgr* tm=nullptr;ITfInputProcessorProfiles* profiles=nullptr;ITfInputProcessorProfileMgr* mgr=nullptr;TfClientId cid=0;
 GUID clsid={},profile={};CLSIDFromString(L"{81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E}",&clsid);CLSIDFromString(L"{FA550B04-5AD7-411F-A5AC-CA038EC515D7}",&profile);
 HRESULT hr=CoCreateInstance(CLSID_TF_ThreadMgr,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&tm));printf("threadManager=%08lx\n",(unsigned long)hr);if(FAILED(hr))return 4;
 hr=tm->Activate(&cid);printf("threadActivate=%08lx\n",(unsigned long)hr);
 hr=CoCreateInstance(CLSID_TF_InputProcessorProfiles,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&profiles));printf("profiles=%08lx\n",(unsigned long)hr);if(FAILED(hr))return 5;
 profiles->QueryInterface(IID_PPV_ARGS(&mgr));if(!mgr)return 6;
 LANGID original=0;profiles->GetCurrentLanguage(&original);BOOL enabled=FALSE;
 hr=profiles->IsEnabledLanguageProfile(clsid,0x804,profile,&enabled);printf("originalLanguage=%04x enabledQuery=%08lx enabled=%d\n",original,(unsigned long)hr,enabled);
 if(FAILED(hr))return 7;
 // This process restores the exact per-user profile enablement below; no language
 // capability, security policy, session-wide activation or system default is changed.
 HRESULT enable=enabled?S_OK:profiles->EnableLanguageProfile(clsid,0x804,profile,TRUE);printf("temporaryUserEnable=%08lx\n",(unsigned long)enable);
 WNDCLASSW wc={};wc.lpfnWndProc=DefWindowProcW;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"MilkupPinyinControl";RegisterClassW(&wc);
 HWND window=CreateWindowW(wc.lpszClassName,L"Milkup isolated native Pinyin control",WS_OVERLAPPEDWINDOW|WS_VISIBLE,100,100,700,350,nullptr,nullptr,wc.hInstance,nullptr);
 HWND edit=CreateWindowW(L"EDIT",L"",WS_CHILD|WS_VISIBLE|WS_BORDER|ES_MULTILINE,20,20,620,230,window,nullptr,wc.hInstance,nullptr);
 prior=(WNDPROC)SetWindowLongPtrW(edit,GWLP_WNDPROC,(LONG_PTR)Observe);ShowWindow(window,SW_SHOW);SetForegroundWindow(window);SetFocus(edit);pump(500);
 HRESULT language=profiles->ChangeCurrentLanguage(0x804);printf("changeCurrentLanguage=%08lx\n",(unsigned long)language);
 HRESULT activate=mgr->ActivateProfile(TF_PROFILETYPE_INPUTPROCESSOR,0x804,clsid,profile,nullptr,TF_IPPMF_FORPROCESS);printf("activateForProcess=%08lx\n",(unsigned long)activate);pump(1000);
 bool input=enable==S_OK&&language==S_OK&&activate==S_OK;
 if(input){HIMC im=ImmGetContext(edit);if(im){printf("immOpenBefore=%d\n",ImmGetOpenStatus(im));ImmSetOpenStatus(im,TRUE);ImmReleaseContext(edit,im);}for(char c:std::vector<char>{'Z','H','O','N','G','W','E','N'}){input=key(window,(WORD)c)&&input;pump(120);}pump(500);input=key(window,VK_SPACE)&&input;pump(1000);}
 wchar_t text[256]={};GetWindowTextW(edit,text,256);printf("keysSent=%d compositionStart=%u compositionUpdates=%u compositionEnd=%u textUtf16=",input,compositionStart,compositionUpdates,compositionEnd);for(auto* p=text;*p;++p)printf("%04x ",(unsigned)*p);printf("\n");
 bool composed=input&&wcscmp(text,L"\x4e2d\x6587")==0&&compositionUpdates>0;
 DestroyWindow(window);HRESULT restoreLanguage=profiles->ChangeCurrentLanguage(original);HRESULT restoreEnabled=enabled?S_OK:profiles->EnableLanguageProfile(clsid,0x804,profile,FALSE);BOOL restored=TRUE;HRESULT check=profiles->IsEnabledLanguageProfile(clsid,0x804,profile,&restored);
 printf("restoreLanguage=%08lx restoreEnabled=%08lx enabledCheck=%08lx restoredEnabled=%d\n",(unsigned long)restoreLanguage,(unsigned long)restoreEnabled,(unsigned long)check,restored);
 bool clean=SUCCEEDED(restoreLanguage)&&SUCCEEDED(restoreEnabled)&&SUCCEEDED(check)&&restored==enabled;
 mgr->Release();profiles->Release();tm->Deactivate();tm->Release();CoUninitialize();printf("result=%s productTested=false\n",composed&&clean?"native-control-passed":"native-control-not-established");return composed&&clean?0:1;
}
