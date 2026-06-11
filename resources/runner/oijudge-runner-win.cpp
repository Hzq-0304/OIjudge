#include <windows.h>
#include <psapi.h>
#include <shellapi.h>

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

struct Options {
  std::wstring exe;
  std::wstring cwd;
  std::wstring stdinPath;
  std::wstring stdoutPath;
  std::wstring stderrPath;
  std::wstring fileOutputPath;
  std::vector<std::wstring> args;
  DWORD timeLimitMs = 1000;
  DWORD hardKillLimitMs = 1000;
  uint64_t outputLimitBytes = 0;
  uint64_t memoryLimitMiB = 0;
};

struct Handle {
  HANDLE value = nullptr;
  Handle() = default;
  explicit Handle(HANDLE handle) : value(handle) {}
  ~Handle() {
    if (value && value != INVALID_HANDLE_VALUE) {
      CloseHandle(value);
    }
  }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  HANDLE get() const { return value; }
  HANDLE release() {
    HANDLE handle = value;
    value = nullptr;
    return handle;
  }
};

static std::wstring utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return L"";
  }
  int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
  std::wstring result(size, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), &result[0], size);
  return result;
}

static std::string wideToUtf8(const std::wstring& value) {
  if (value.empty()) {
    return "";
  }
  int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), &result[0], size, nullptr, nullptr);
  return result;
}

static std::wstring quoteArg(const std::wstring& arg) {
  if (arg.empty()) {
    return L"\"\"";
  }
  bool needsQuote = false;
  for (wchar_t ch : arg) {
    if (ch == L' ' || ch == L'\t' || ch == L'"') {
      needsQuote = true;
      break;
    }
  }
  if (!needsQuote) {
    return arg;
  }

  std::wstring result = L"\"";
  size_t backslashes = 0;
  for (wchar_t ch : arg) {
    if (ch == L'\\') {
      backslashes += 1;
      continue;
    }
    if (ch == L'"') {
      result.append(backslashes * 2 + 1, L'\\');
      result.push_back(ch);
      backslashes = 0;
      continue;
    }
    result.append(backslashes, L'\\');
    backslashes = 0;
    result.push_back(ch);
  }
  result.append(backslashes * 2, L'\\');
  result.push_back(L'"');
  return result;
}

static std::wstring buildCommandLine(const Options& options) {
  std::wstring command = quoteArg(options.exe);
  for (const auto& arg : options.args) {
    command.push_back(L' ');
    command += quoteArg(arg);
  }
  return command;
}

static std::string jsonEscape(const std::string& value) {
  std::ostringstream out;
  for (unsigned char ch : value) {
    switch (ch) {
      case '\\': out << "\\\\"; break;
      case '"': out << "\\\""; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (ch < 0x20) {
          out << "\\u";
          const char* hex = "0123456789abcdef";
          out << "00" << hex[(ch >> 4) & 0x0f] << hex[ch & 0x0f];
        } else {
          out << ch;
        }
    }
  }
  return out.str();
}

static bool parseOptions(int argc, wchar_t** argv, Options& options, std::string& error) {
  for (int index = 1; index < argc; index += 1) {
    std::wstring key = argv[index];
    auto next = [&]() -> std::wstring {
      if (index + 1 >= argc) {
        error = "Missing value for " + wideToUtf8(key);
        return L"";
      }
      index += 1;
      return argv[index];
    };
    if (key == L"--exe") {
      options.exe = next();
    } else if (key == L"--cwd") {
      options.cwd = next();
    } else if (key == L"--stdin") {
      options.stdinPath = next();
    } else if (key == L"--stdout") {
      options.stdoutPath = next();
    } else if (key == L"--stderr") {
      options.stderrPath = next();
    } else if (key == L"--file-output") {
      options.fileOutputPath = next();
    } else if (key == L"--time-limit-ms") {
      options.timeLimitMs = static_cast<DWORD>(std::stoul(next()));
      options.hardKillLimitMs = options.timeLimitMs;
    } else if (key == L"--hard-kill-limit-ms") {
      options.hardKillLimitMs = static_cast<DWORD>(std::stoul(next()));
    } else if (key == L"--output-limit-bytes") {
      options.outputLimitBytes = static_cast<uint64_t>(std::stoull(next()));
    } else if (key == L"--memory-limit-mib") {
      options.memoryLimitMiB = static_cast<uint64_t>(std::stoull(next()));
    } else if (key == L"--arg") {
      options.args.push_back(next());
    } else {
      error = "Unknown argument: " + wideToUtf8(key);
      return false;
    }
    if (!error.empty()) {
      return false;
    }
  }
  if (options.exe.empty() || options.cwd.empty() || options.stdinPath.empty() || options.stdoutPath.empty() || options.stderrPath.empty()) {
    error = "Missing required runner arguments";
    return false;
  }
  if (options.hardKillLimitMs < options.timeLimitMs) {
    options.hardKillLimitMs = options.timeLimitMs;
  }
  return true;
}

static uint64_t queryProcessMemoryBytes(HANDLE process, HANDLE job) {
  uint64_t memory = 0;

  PROCESS_MEMORY_COUNTERS_EX counters;
  ZeroMemory(&counters, sizeof(counters));
  counters.cb = sizeof(counters);
  if (GetProcessMemoryInfo(process, reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&counters), sizeof(counters))) {
    // PeakWorkingSetSize is close to common OJ memory displays; PrivateUsage catches committed private allocations.
    memory = std::max<uint64_t>(memory, static_cast<uint64_t>(counters.PeakWorkingSetSize));
    memory = std::max<uint64_t>(memory, static_cast<uint64_t>(counters.PrivateUsage));
  }

  if (job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info;
    ZeroMemory(&info, sizeof(info));
    if (QueryInformationJobObject(job, JobObjectExtendedLimitInformation, &info, sizeof(info), nullptr)) {
      memory = std::max<uint64_t>(memory, static_cast<uint64_t>(info.PeakProcessMemoryUsed));
      memory = std::max<uint64_t>(memory, static_cast<uint64_t>(info.PeakJobMemoryUsed));
    }
  }

  return memory;
}

static uint64_t fileSizeBytes(const std::wstring& path) {
  if (path.empty()) {
    return 0;
  }
  WIN32_FILE_ATTRIBUTE_DATA data;
  if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data)) {
    return 0;
  }
  ULARGE_INTEGER size;
  size.HighPart = data.nFileSizeHigh;
  size.LowPart = data.nFileSizeLow;
  return size.QuadPart;
}

static void truncateFileToLimit(const std::wstring& path, uint64_t limitBytes) {
  if (path.empty() || limitBytes == 0) {
    return;
  }
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return;
  }
  LARGE_INTEGER position;
  position.QuadPart = static_cast<LONGLONG>(limitBytes);
  if (SetFilePointerEx(file, position, nullptr, FILE_BEGIN)) {
    SetEndOfFile(file);
  }
  CloseHandle(file);
}

static double elapsedMs(const LARGE_INTEGER& frequency, const LARGE_INTEGER& start, const LARGE_INTEGER& end) {
  return static_cast<double>(end.QuadPart - start.QuadPart) * 1000.0 / static_cast<double>(frequency.QuadPart);
}

int main(int argc, char** argv) {
  SetConsoleOutputCP(CP_UTF8);

  Options options;
  std::string error;
  int wideArgc = 0;
  wchar_t** wideArgv = CommandLineToArgvW(GetCommandLineW(), &wideArgc);
  if (!wideArgv) {
    std::cout << "{\"exitCode\":null,\"timedOut\":false,\"memoryExceeded\":false,\"timeMs\":0,\"memoryBytes\":null,\"message\":\"Failed to parse command line\"}\n";
    return 2;
  }

  bool parsed = parseOptions(wideArgc, wideArgv, options, error);
  LocalFree(wideArgv);
  if (!parsed) {
    std::cout << "{\"exitCode\":null,\"timedOut\":false,\"memoryExceeded\":false,\"timeMs\":0,\"memoryBytes\":null,\"message\":\""
              << jsonEscape(error) << "\"}\n";
    return 2;
  }

  SECURITY_ATTRIBUTES inheritAttrs;
  ZeroMemory(&inheritAttrs, sizeof(inheritAttrs));
  inheritAttrs.nLength = sizeof(inheritAttrs);
  inheritAttrs.bInheritHandle = TRUE;

  Handle stdinFile(CreateFileW(options.stdinPath.c_str(), GENERIC_READ, FILE_SHARE_READ, &inheritAttrs, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
  Handle stdoutFile(CreateFileW(options.stdoutPath.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &inheritAttrs, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
  Handle stderrFile(CreateFileW(options.stderrPath.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &inheritAttrs, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
  if (stdinFile.get() == INVALID_HANDLE_VALUE || stdoutFile.get() == INVALID_HANDLE_VALUE || stderrFile.get() == INVALID_HANDLE_VALUE) {
    std::cout << "{\"exitCode\":null,\"timedOut\":false,\"memoryExceeded\":false,\"timeMs\":0,\"memoryBytes\":null,\"message\":\"Failed to open stdio files\"}\n";
    return 3;
  }

  STARTUPINFOW startup;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = stdinFile.get();
  startup.hStdOutput = stdoutFile.get();
  startup.hStdError = stderrFile.get();

  PROCESS_INFORMATION processInfo;
  ZeroMemory(&processInfo, sizeof(processInfo));
  std::wstring commandLine = buildCommandLine(options);

  LARGE_INTEGER frequency;
  LARGE_INTEGER start;
  QueryPerformanceFrequency(&frequency);
  QueryPerformanceCounter(&start);

  BOOL created = CreateProcessW(
    nullptr,
    &commandLine[0],
    nullptr,
    nullptr,
    TRUE,
    CREATE_NO_WINDOW,
    nullptr,
    options.cwd.c_str(),
    &startup,
    &processInfo
  );
  if (!created) {
    std::ostringstream message;
    message << "CreateProcess failed: " << GetLastError();
    std::cout << "{\"exitCode\":null,\"timedOut\":false,\"memoryExceeded\":false,\"timeMs\":0,\"memoryBytes\":null,\"message\":\""
              << jsonEscape(message.str()) << "\"}\n";
    return 4;
  }

  Handle process(processInfo.hProcess);
  Handle thread(processInfo.hThread);
  Handle job(CreateJobObjectW(nullptr, nullptr));
  if (job.get()) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
    ZeroMemory(&limits, sizeof(limits));
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    AssignProcessToJobObject(job.get(), process.get());
  }

  DWORD wait = WAIT_TIMEOUT;
  bool killedByTimeout = false;
  bool outputLimitExceeded = false;
  uint64_t outputBytes = 0;
  const DWORD pollMs = 10;
  DWORD waitedMs = 0;
  while (true) {
    DWORD sliceMs = waitedMs >= options.hardKillLimitMs
      ? 0
      : std::min<DWORD>(pollMs, options.hardKillLimitMs - waitedMs);
    wait = WaitForSingleObject(process.get(), sliceMs);
    if (wait != WAIT_TIMEOUT) {
      break;
    }
    waitedMs += sliceMs;
    if (options.outputLimitBytes > 0) {
      uint64_t stdoutBytes = fileSizeBytes(options.stdoutPath);
      uint64_t fileOutBytes = fileSizeBytes(options.fileOutputPath);
      outputBytes = std::max(stdoutBytes, fileOutBytes);
      if (outputBytes > options.outputLimitBytes) {
        outputLimitExceeded = true;
        TerminateJobObject(job.get(), 2);
        TerminateProcess(process.get(), 2);
        WaitForSingleObject(process.get(), INFINITE);
        truncateFileToLimit(options.stdoutPath, options.outputLimitBytes);
        truncateFileToLimit(options.fileOutputPath, options.outputLimitBytes);
        break;
      }
    }
    if (waitedMs >= options.hardKillLimitMs) {
      killedByTimeout = true;
      break;
    }
  }
  if (killedByTimeout) {
    TerminateJobObject(job.get(), 1);
    TerminateProcess(process.get(), 1);
    WaitForSingleObject(process.get(), INFINITE);
  }

  LARGE_INTEGER end;
  QueryPerformanceCounter(&end);

  DWORD exitCode = 0;
  GetExitCodeProcess(process.get(), &exitCode);
  uint64_t memoryBytes = queryProcessMemoryBytes(process.get(), job.get());
  uint64_t actualTimeMs = static_cast<uint64_t>(elapsedMs(frequency, start, end) + 0.999);
  uint64_t timeMs = killedByTimeout ? static_cast<uint64_t>(options.hardKillLimitMs) : actualTimeMs;
  if (options.outputLimitBytes > 0 && outputBytes == 0) {
    outputBytes = std::max(fileSizeBytes(options.stdoutPath), fileSizeBytes(options.fileOutputPath));
  }
  bool timedOut = !outputLimitExceeded && (killedByTimeout || actualTimeMs > static_cast<uint64_t>(options.timeLimitMs));

  std::cout << "{";
  if (killedByTimeout || outputLimitExceeded) {
    std::cout << "\"exitCode\":null";
  } else {
    std::cout << "\"exitCode\":" << static_cast<uint64_t>(exitCode);
  }
  std::cout << ",\"timedOut\":" << (timedOut ? "true" : "false");
  std::cout << ",\"killedByTimeout\":" << (killedByTimeout ? "true" : "false");
  std::cout << ",\"hardKillLimitMs\":" << static_cast<uint64_t>(options.hardKillLimitMs);
  std::cout << ",\"outputLimitExceeded\":" << (outputLimitExceeded ? "true" : "false");
  std::cout << ",\"outputBytes\":" << outputBytes;
  if (options.outputLimitBytes > 0) {
    std::cout << ",\"outputLimitBytes\":" << options.outputLimitBytes;
  } else {
    std::cout << ",\"outputLimitBytes\":null";
  }
  std::cout << ",\"memoryExceeded\":false";
  std::cout << ",\"timeMs\":" << timeMs;
  if (memoryBytes > 0) {
    std::cout << ",\"memoryBytes\":" << memoryBytes;
  } else {
    std::cout << ",\"memoryBytes\":null";
  }
  std::cout << ",\"message\":\"" << (outputLimitExceeded ? "Output Limit Exceeded" : timedOut ? "Time Limit Exceeded" : "") << "\"";
  std::cout << "}\n";
  return 0;
}
