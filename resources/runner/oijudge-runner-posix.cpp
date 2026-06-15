#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

struct Options {
  std::string exe;
  std::string cwd;
  std::string stdinPath;
  std::string stdoutPath;
  std::string stderrPath;
  std::string fileOutputPath;
  std::vector<std::string> args;
  uint64_t timeLimitMs = 1000;
  uint64_t hardKillLimitMs = 1000;
  uint64_t outputLimitBytes = 0;
  uint64_t memoryLimitMiB = 0;
};

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
          const char* hex = "0123456789abcdef";
          out << "\\u00" << hex[(ch >> 4) & 0x0f] << hex[ch & 0x0f];
        } else {
          out << ch;
        }
    }
  }
  return out.str();
}

static bool parseU64(const std::string& value, uint64_t& out) {
  try {
    size_t used = 0;
    out = std::stoull(value, &used);
    return used == value.size();
  } catch (...) {
    return false;
  }
}

static bool parseOptions(int argc, char** argv, Options& options, std::string& error) {
  for (int index = 1; index < argc; index += 1) {
    std::string key = argv[index];
    auto next = [&]() -> std::string {
      if (index + 1 >= argc) {
        error = "Missing value for " + key;
        return "";
      }
      index += 1;
      return argv[index];
    };
    if (key == "--exe") options.exe = next();
    else if (key == "--cwd") options.cwd = next();
    else if (key == "--stdin") options.stdinPath = next();
    else if (key == "--stdout") options.stdoutPath = next();
    else if (key == "--stderr") options.stderrPath = next();
    else if (key == "--file-output") options.fileOutputPath = next();
    else if (key == "--time-limit-ms") { if (!parseU64(next(), options.timeLimitMs)) error = "Invalid --time-limit-ms"; options.hardKillLimitMs = options.timeLimitMs; }
    else if (key == "--hard-kill-limit-ms") { if (!parseU64(next(), options.hardKillLimitMs)) error = "Invalid --hard-kill-limit-ms"; }
    else if (key == "--output-limit-bytes") { if (!parseU64(next(), options.outputLimitBytes)) error = "Invalid --output-limit-bytes"; }
    else if (key == "--memory-limit-mib") { if (!parseU64(next(), options.memoryLimitMiB)) error = "Invalid --memory-limit-mib"; }
    else if (key == "--arg") options.args.push_back(next());
    else { error = "Unknown argument: " + key; return false; }
    if (!error.empty()) return false;
  }
  if (options.exe.empty() || options.cwd.empty() || options.stdinPath.empty() || options.stdoutPath.empty() || options.stderrPath.empty()) {
    error = "Missing required runner arguments";
    return false;
  }
  if (options.hardKillLimitMs < options.timeLimitMs) options.hardKillLimitMs = options.timeLimitMs;
  return true;
}

static uint64_t fileSizeBytes(const std::string& path) {
  if (path.empty()) return 0;
  struct stat st;
  return stat(path.c_str(), &st) == 0 && st.st_size > 0 ? static_cast<uint64_t>(st.st_size) : 0;
}

static void truncateFileToLimit(const std::string& path, uint64_t limitBytes) {
  if (!path.empty() && limitBytes > 0) {
    int ignored = truncate(path.c_str(), static_cast<off_t>(limitBytes));
    (void)ignored;
  }
}

static uint64_t nowMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

static void printErrorJson(const std::string& message) {
  std::cout << "{\"exitCode\":null,\"timedOut\":false,\"memoryExceeded\":false,\"timeMs\":0,\"memoryBytes\":null,\"message\":\""
            << jsonEscape(message) << "\"}\n";
}

int main(int argc, char** argv) {
  Options options;
  std::string error;
  if (!parseOptions(argc, argv, options, error)) {
    printErrorJson(error);
    return 2;
  }

  int errorPipe[2];
  if (pipe(errorPipe) != 0) {
    printErrorJson(std::string("pipe failed: ") + std::strerror(errno));
    return 4;
  }
  fcntl(errorPipe[0], F_SETFD, FD_CLOEXEC);
  fcntl(errorPipe[1], F_SETFD, FD_CLOEXEC);

  uint64_t start = nowMs();
  pid_t pid = fork();
  if (pid < 0) {
    close(errorPipe[0]);
    close(errorPipe[1]);
    printErrorJson(std::string("fork failed: ") + std::strerror(errno));
    return 4;
  }

  if (pid == 0) {
    close(errorPipe[0]);
    int inFd = open(options.stdinPath.c_str(), O_RDONLY);
    int outFd = open(options.stdoutPath.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0666);
    int errFd = open(options.stderrPath.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0666);
    if (inFd < 0 || outFd < 0 || errFd < 0) {
      const char code = 125;
      ssize_t ignored = write(errorPipe[1], &code, 1);
      (void)ignored;
      _exit(125);
    }
    if (chdir(options.cwd.c_str()) != 0) {
      const char code = 126;
      ssize_t ignored = write(errorPipe[1], &code, 1);
      (void)ignored;
      _exit(126);
    }
    dup2(inFd, STDIN_FILENO);
    dup2(outFd, STDOUT_FILENO);
    dup2(errFd, STDERR_FILENO);
    close(inFd); close(outFd); close(errFd);
    if (options.memoryLimitMiB > 0) {
      struct rlimit limit;
      limit.rlim_cur = limit.rlim_max = static_cast<rlim_t>(options.memoryLimitMiB * 1024ULL * 1024ULL);
      setrlimit(RLIMIT_AS, &limit);
    }
    std::vector<char*> execArgs;
    execArgs.push_back(const_cast<char*>(options.exe.c_str()));
    for (auto& arg : options.args) execArgs.push_back(const_cast<char*>(arg.c_str()));
    execArgs.push_back(nullptr);
    execv(options.exe.c_str(), execArgs.data());
    execvp(options.exe.c_str(), execArgs.data());
    const char code = 127;
    ssize_t ignored = write(errorPipe[1], &code, 1);
    (void)ignored;
    _exit(127);
  }

  close(errorPipe[1]);
  int flags = fcntl(errorPipe[0], F_GETFL, 0);
  fcntl(errorPipe[0], F_SETFL, flags | O_NONBLOCK);

  int status = 0;
  struct rusage usage;
  std::memset(&usage, 0, sizeof(usage));
  bool exited = false;
  bool killedByTimeout = false;
  bool outputLimitExceeded = false;
  uint64_t outputBytes = 0;

  while (!exited) {
    char setupCode = 0;
    ssize_t setupRead = read(errorPipe[0], &setupCode, 1);
    if (setupRead > 0) {
      wait4(pid, &status, 0, &usage);
      close(errorPipe[0]);
      printErrorJson(setupCode == 125 ? "Failed to open stdio files" : setupCode == 126 ? "Failed to change working directory" : "Failed to execute child process");
      return setupCode;
    }
    pid_t waited = wait4(pid, &status, WNOHANG, &usage);
    if (waited == pid) { exited = true; break; }
    if (waited < 0) { printErrorJson(std::string("waitpid failed: ") + std::strerror(errno)); return 5; }
    if (options.outputLimitBytes > 0) {
      outputBytes = std::max(fileSizeBytes(options.stdoutPath), fileSizeBytes(options.fileOutputPath));
      if (outputBytes > options.outputLimitBytes) {
        outputLimitExceeded = true;
        kill(pid, SIGKILL);
        wait4(pid, &status, 0, &usage);
        truncateFileToLimit(options.stdoutPath, options.outputLimitBytes);
        truncateFileToLimit(options.fileOutputPath, options.outputLimitBytes);
        exited = true;
        break;
      }
    }
    if (nowMs() - start >= options.hardKillLimitMs) {
      killedByTimeout = true;
      kill(pid, SIGKILL);
      wait4(pid, &status, 0, &usage);
      exited = true;
      break;
    }
    usleep(10 * 1000);
  }

  close(errorPipe[0]);

  uint64_t actualTimeMs = nowMs() - start;
  uint64_t timeMs = killedByTimeout ? options.hardKillLimitMs : actualTimeMs;
  if (options.outputLimitBytes > 0 && outputBytes == 0) outputBytes = std::max(fileSizeBytes(options.stdoutPath), fileSizeBytes(options.fileOutputPath));
  bool timedOut = !outputLimitExceeded && (killedByTimeout || actualTimeMs > options.timeLimitMs);
  uint64_t memoryBytes = static_cast<uint64_t>(usage.ru_maxrss) * 1024ULL;

  std::cout << "{";
  if (killedByTimeout || outputLimitExceeded || !WIFEXITED(status)) std::cout << "\"exitCode\":null";
  else std::cout << "\"exitCode\":" << WEXITSTATUS(status);
  std::cout << ",\"timedOut\":" << (timedOut ? "true" : "false");
  std::cout << ",\"killedByTimeout\":" << (killedByTimeout ? "true" : "false");
  std::cout << ",\"hardKillLimitMs\":" << options.hardKillLimitMs;
  std::cout << ",\"outputLimitExceeded\":" << (outputLimitExceeded ? "true" : "false");
  std::cout << ",\"outputBytes\":" << outputBytes;
  if (options.outputLimitBytes > 0) std::cout << ",\"outputLimitBytes\":" << options.outputLimitBytes;
  else std::cout << ",\"outputLimitBytes\":null";
  std::cout << ",\"memoryExceeded\":false";
  std::cout << ",\"timeMs\":" << timeMs;
  if (memoryBytes > 0) std::cout << ",\"memoryBytes\":" << memoryBytes;
  else std::cout << ",\"memoryBytes\":null";
  std::cout << ",\"message\":\"" << (outputLimitExceeded ? "Output Limit Exceeded" : timedOut ? "Time Limit Exceeded" : "") << "\"";
  std::cout << "}\n";
  return 0;
}
