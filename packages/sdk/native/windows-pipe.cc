// Copyright 2026 Yonder contributors. Apache-2.0.
// Windows owner-only listener. Connected streams are owned by Node, not this addon.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <aclapi.h>
#include <process.h>
#include <node_api.h>
#include <uv.h>
#include <atomic>
#include <memory>
#include <string>
#include <vector>

struct Listener {
  std::wstring name;
  PSECURITY_DESCRIPTOR sd = nullptr;
  HANDLE pending = INVALID_HANDLE_VALUE;
  HANDLE cancel = nullptr;
  std::atomic<bool> closed{false};
  bool accepting = false; // Main-thread only.
  void dispose() {
    if (pending != INVALID_HANDLE_VALUE) CloseHandle(pending);
    pending = INVALID_HANDLE_VALUE;
    if (cancel) CloseHandle(cancel);
    cancel = nullptr;
    if (sd) LocalFree(sd);
    sd = nullptr;
  }
  void close() {
    if (!closed.exchange(true)) {
      if (cancel) SetEvent(cancel);
      if (!accepting) dispose();
    }
  }
  ~Listener() { dispose(); }
  HANDLE instance(bool first) {
    SECURITY_ATTRIBUTES sa{sizeof(sa), sd, FALSE};
    return CreateNamedPipeW(name.c_str(),
      PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED |
        (first ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0),
      PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
      PIPE_UNLIMITED_INSTANCES, 65536, 65536, 0, &sa);
  }
};
using SharedListener = std::shared_ptr<Listener>;

static napi_value failure(napi_env env, const char* action, DWORD code) {
  std::string text = std::string(action) + ": Win32 error " + std::to_string(code);
  napi_throw_error(env, nullptr, text.c_str());
  return nullptr;
}
static napi_value apiFailure(napi_env env) {
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  if (!pending) napi_throw_error(env, nullptr, "Native IPC API operation failed");
  return nullptr;
}
static SharedListener argument(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value value; void* data = nullptr;
  if (napi_get_cb_info(env, info, &count, &value, nullptr, nullptr) != napi_ok || count != 1 ||
      napi_unwrap(env, value, &data) != napi_ok || !data) {
    napi_throw_type_error(env, nullptr, "Expected listener object");
    return {};
  }
  return *static_cast<SharedListener*>(data);
}
static napi_value create(napi_env env, napi_callback_info info) {
  size_t count = 1, size = 0; napi_value value;
  if (napi_get_cb_info(env, info, &count, &value, nullptr, nullptr) != napi_ok) return apiFailure(env);
  if (count != 1 || napi_get_value_string_utf16(env, value, nullptr, 0, &size) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Expected pipe name"); return nullptr;
  }
  std::vector<char16_t> name(size + 1);
  if (napi_get_value_string_utf16(env, value, name.data(), name.size(), &size) != napi_ok) return apiFailure(env);
  auto listener = std::make_shared<Listener>();
  listener->name.assign(reinterpret_cast<wchar_t*>(name.data()), size);
  if (listener->name.rfind(L"\\\\.\\pipe\\", 0) != 0 || listener->name.find(L'\0') != std::wstring::npos) {
    napi_throw_type_error(env, nullptr, "Expected local named pipe path"); return nullptr;
  }
  HANDLE token = nullptr; DWORD bytes = 0;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return failure(env, "OpenProcessToken", GetLastError());
  GetTokenInformation(token, TokenUser, nullptr, 0, &bytes);
  std::vector<unsigned char> user(bytes);
  if (!GetTokenInformation(token, TokenUser, user.data(), bytes, &bytes)) {
    DWORD error = GetLastError(); CloseHandle(token); return failure(env, "TokenUser", error);
  }
  CloseHandle(token);
  LPWSTR sid = nullptr;
  if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid, &sid))
    return failure(env, "ConvertSid", GetLastError());
  std::wstring sddl = L"D:P(A;;GA;;;SY)(A;;GA;;;" + std::wstring(sid) + L")";
  LocalFree(sid);
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &listener->sd, nullptr))
    return failure(env, "SecurityDescriptor", GetLastError());
  listener->cancel = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!listener->cancel) return failure(env, "CreateEvent", GetLastError());
  listener->pending = listener->instance(true);
  if (listener->pending == INVALID_HANDLE_VALUE) return failure(env, "CreateNamedPipe", GetLastError());
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) return apiFailure(env);
  auto* holder = new SharedListener(listener);
  if (napi_wrap(env, result, holder, [](napi_env, void* data, void*) {
        auto* holder = static_cast<SharedListener*>(data);
        (*holder)->close();
        delete holder;
      }, nullptr, nullptr) != napi_ok) {
    delete holder; return apiFailure(env);
  }
  return result;
}

struct Accept {
  SharedListener listener;
  napi_threadsafe_function delivery = nullptr;
  napi_ref pin = nullptr;
  napi_deferred deferred = nullptr;
  HANDLE thread = nullptr;
  HANDLE accepted = INVALID_HANDLE_VALUE;
  DWORD error = 0;
  bool cleanupHook = false;
  bool envClosing = false;
  bool delivered = false;
};
static void execute(Accept* work) {
  auto& listener = work->listener;
  OVERLAPPED overlapped{};
  overlapped.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!overlapped.hEvent) { work->error = GetLastError(); return; }
  DWORD error;
  do {
    if (listener->closed) { CloseHandle(overlapped.hEvent); work->error = ERROR_OPERATION_ABORTED; return; }
    BOOL connected = ConnectNamedPipe(listener->pending, &overlapped);
    error = connected ? ERROR_SUCCESS : GetLastError();
    // A client may disconnect before accept is armed; recycle only that instance.
    if (error == ERROR_NO_DATA) DisconnectNamedPipe(listener->pending);
  } while (error == ERROR_NO_DATA);
  if (error == ERROR_IO_PENDING) {
    HANDLE events[] = {listener->cancel, overlapped.hEvent};
    DWORD wait = WaitForMultipleObjects(2, events, FALSE, INFINITE);
    if (wait != WAIT_OBJECT_0 + 1) {
      CancelIoEx(listener->pending, &overlapped);
      DWORD ignored;
      GetOverlappedResult(listener->pending, &overlapped, &ignored, TRUE);
      error = ERROR_OPERATION_ABORTED;
    } else {
      DWORD ignored;
      error = GetOverlappedResult(listener->pending, &overlapped, &ignored, FALSE) ? ERROR_SUCCESS : GetLastError();
    }
  }
  CloseHandle(overlapped.hEvent);
  if (error != ERROR_SUCCESS && error != ERROR_PIPE_CONNECTED) { work->error = error; return; }
  HANDLE next = listener->instance(false);
  if (next == INVALID_HANDLE_VALUE) { work->error = GetLastError(); return; }
  work->accepted = listener->pending;
  listener->pending = next;
}
static void cleanup(void* data) {
  auto* work = static_cast<Accept*>(data);
  work->envClosing = true;
  work->cleanupHook = false; // The hook is currently being run by Node.
  work->listener->close();
  // The worker never blocks on the JS thread: its TSFN queue is unbounded and nonblocking.
  if (work->thread) WaitForSingleObject(work->thread, INFINITE);
}
static void removeHook(napi_env env, Accept* work) {
  if (work->cleanupHook) {
    napi_remove_env_cleanup_hook(env, cleanup, work);
    work->cleanupHook = false;
  }
}
static void reject(napi_env env, Accept* work) {
  napi_value text, error;
  std::string message = "accept: Win32 error " + std::to_string(work->error);
  if (napi_create_string_utf8(env, message.c_str(), NAPI_AUTO_LENGTH, &text) == napi_ok &&
      napi_create_error(env, nullptr, text, &error) == napi_ok)
    napi_reject_deferred(env, work->deferred, error);
}
static void closeFd(int fd) {
  uv_fs_t request;
  uv_fs_close(nullptr, &request, fd, nullptr);
  uv_fs_req_cleanup(&request);
}
static int transferFd(Accept* work) {
  int fd = uv_open_osfhandle(work->accepted);
  if (fd < 0) return fd;
  work->accepted = INVALID_HANDLE_VALUE;
  // Node treats 0..2 specially (duplicates the handle and writes through stdio).
  // Hold vacant low slots until a normal fd is allocated, then restore them.
  std::vector<int> low;
  while (fd >= 0 && fd <= 2) {
    low.push_back(fd);
    HANDLE duplicate;
    if (!DuplicateHandle(GetCurrentProcess(), uv_get_osfhandle(fd), GetCurrentProcess(),
        &duplicate, 0, FALSE, DUPLICATE_SAME_ACCESS)) { fd = -1; break; }
    fd = uv_open_osfhandle(duplicate);
    if (fd < 0) CloseHandle(duplicate);
  }
  for (int reserved : low) closeFd(reserved);
  return fd;
}
static void complete(napi_env env, napi_value, void*, void* data) {
  // Node can drain an aborted queue AFTER the TSFN finalizer freed its data.
  // Undelivered native resources belong exclusively to finalize().
  if (!env) return;
  auto* work = static_cast<Accept*>(data);
  auto& listener = work->listener;
  listener->accepting = false;
  work->delivered = true;
  if (!env || work->envClosing || listener->closed) work->error = ERROR_OPERATION_ABORTED;
  if (env) removeHook(env, work);
  int fd = -1;
  napi_value value;
  if (!work->error) {
    // Node's exported conversion uses Node's CRT table, not the addon's CRT.
    fd = transferFd(work);
    if (fd < 0) work->error = ERROR_INVALID_HANDLE;
    else {
      work->accepted = INVALID_HANDLE_VALUE;
      if (napi_create_int32(env, fd, &value) != napi_ok || napi_resolve_deferred(env, work->deferred, value) != napi_ok) {
        closeFd(fd);
        work->error = ERROR_NOT_ENOUGH_MEMORY;
      }
    }
  }
  if (work->error) {
    if (work->accepted != INVALID_HANDLE_VALUE) CloseHandle(work->accepted);
    work->accepted = INVALID_HANDLE_VALUE;
    listener->close();
    listener->dispose();
    if (env && !work->envClosing) reject(env, work);
  }
}
static void finalize(napi_env env, void* data, void*) {
  auto* work = static_cast<Accept*>(data);
  if (work->thread) {
    WaitForSingleObject(work->thread, INFINITE);
    CloseHandle(work->thread);
  }
  if (!work->delivered) {
    work->listener->accepting = false;
    work->listener->close();
    work->listener->dispose();
    if (work->accepted != INVALID_HANDLE_VALUE) CloseHandle(work->accepted);
    if (env && !work->envClosing) {
      if (!work->error) work->error = ERROR_OPERATION_ABORTED;
      reject(env, work);
    }
  }
  if (env) {
    removeHook(env, work);
    if (work->pin) napi_delete_reference(env, work->pin);
  }
  delete work;
}
static unsigned __stdcall acceptThread(void* data) {
  auto* work = static_cast<Accept*>(data);
  auto delivery = work->delivery;
  execute(work);
  napi_status status = napi_call_threadsafe_function(delivery, work, napi_tsfn_nonblocking);
  // napi_closing already revokes this thread's right to use the TSFN, including release.
  if (status != napi_closing) napi_release_threadsafe_function(delivery, napi_tsfn_release);
  return 0;
}
static napi_value accept(napi_env env, napi_callback_info info) {
  auto listener = argument(env, info);
  if (!listener) return nullptr;
  if (listener->closed || listener->accepting) {
    napi_throw_error(env, nullptr, "Listener closed or accept already pending"); return nullptr;
  }
  size_t count = 1; napi_value object;
  if (napi_get_cb_info(env, info, &count, &object, nullptr, nullptr) != napi_ok) return apiFailure(env);
  auto* work = new Accept;
  work->listener = listener;
  napi_value promise, name;
  if (napi_create_promise(env, &work->deferred, &promise) != napi_ok ||
      napi_create_reference(env, object, 1, &work->pin) != napi_ok ||
      napi_create_string_utf8(env, "owner-only-pipe-accept", NAPI_AUTO_LENGTH, &name) != napi_ok) {
    if (work->pin) napi_delete_reference(env, work->pin);
    delete work; return apiFailure(env);
  }
  if (napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1,
      work, finalize, nullptr, complete, &work->delivery) != napi_ok) {
    napi_delete_reference(env, work->pin); delete work; return apiFailure(env);
  }
  if (napi_add_env_cleanup_hook(env, cleanup, work) != napi_ok) {
    work->error = ERROR_NOT_ENOUGH_MEMORY;
    napi_release_threadsafe_function(work->delivery, napi_tsfn_abort);
    return promise;
  }
  work->cleanupHook = true;
  listener->accepting = true;
  uintptr_t thread = _beginthreadex(nullptr, 0, acceptThread, work, 0, nullptr);
  if (!thread) {
    removeHook(env, work);
    work->error = ERROR_NOT_ENOUGH_MEMORY;
    napi_release_threadsafe_function(work->delivery, napi_tsfn_abort);
    return promise;
  }
  work->thread = reinterpret_cast<HANDLE>(thread);
  return promise;
}
static napi_value close(napi_env env, napi_callback_info info) {
  auto listener = argument(env, info);
  if (!listener) return nullptr;
  listener->close();
  napi_value result;
  if (napi_get_undefined(env, &result) != napi_ok) return apiFailure(env);
  return result;
}
// Read actual kernel-object DACL before accept starts; diagnostic API, no ACL mutation.
static napi_value describe(napi_env env, napi_callback_info info) {
  auto listener = argument(env, info);
  if (!listener) return nullptr;
  if (listener->accepting || listener->closed) { napi_throw_error(env, nullptr, "Describe requires idle listener"); return nullptr; }
  PSECURITY_DESCRIPTOR sd = nullptr;
  DWORD error = GetSecurityInfo(listener->pending, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION,
    nullptr, nullptr, nullptr, nullptr, &sd);
  if (error) return failure(env, "GetSecurityInfo", error);
  LPWSTR text = nullptr;
  if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, SDDL_REVISION_1, DACL_SECURITY_INFORMATION, &text, nullptr)) {
    error = GetLastError(); LocalFree(sd); return failure(env, "DescribeSecurity", error);
  }
  napi_value result;
  napi_status status = napi_create_string_utf16(env, reinterpret_cast<char16_t*>(text), NAPI_AUTO_LENGTH, &result);
  LocalFree(text); LocalFree(sd);
  return status == napi_ok ? result : apiFailure(env);
}
static napi_value handleCount(napi_env env, napi_callback_info) {
  DWORD count;
  if (!GetProcessHandleCount(GetCurrentProcess(), &count)) return failure(env, "GetProcessHandleCount", GetLastError());
  napi_value result;
  return napi_create_uint32(env, count, &result) == napi_ok ? result : apiFailure(env);
}
NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
    {"create", nullptr, create, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"accept", nullptr, accept, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"close", nullptr, close, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"describe", nullptr, describe, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"handleCount", nullptr, handleCount, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  if (napi_define_properties(env, exports, 5, properties) != napi_ok) return apiFailure(env);
  return exports;
}
