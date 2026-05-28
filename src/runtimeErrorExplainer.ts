import { getLocale } from './i18n';

export type RuntimeErrorKind =
  | 'missingRuntimeDll'
  | 'stackOverflow'
  | 'accessViolation'
  | 'integerDivideByZero'
  | 'floatingPointException'
  | 'illegalInstruction'
  | 'abort'
  | 'heapCorruption'
  | 'segmentationFault'
  | 'killed'
  | 'programNotFound'
  | 'permissionDenied'
  | 'runnerInternalError'
  | 'unknown';

export interface RuntimeErrorExplanation {
  kind: RuntimeErrorKind;
  englishName: string;
  englishDescription: string;
  chineseDescription?: string;
  englishCauses: string[];
  chineseCauses?: string[];
  englishSuggestions: string[];
  chineseSuggestions?: string[];
  rawCode?: string;
  rawExitCode?: number;
  rawSignal?: string | null;
}

export interface RuntimeErrorSummary {
  kind: RuntimeErrorKind;
  englishName: string;
  rawCode?: string;
  rawExitCode?: number;
  rawSignal?: string | null;
}

type RuntimeErrorInput = {
  exitCode?: number | null;
  signal?: string | null;
  stderr?: string;
  spawnError?: string;
  runnerError?: string;
  platform?: NodeJS.Platform;
};

type RuntimeErrorTemplate = Omit<RuntimeErrorExplanation, 'rawCode' | 'rawExitCode' | 'rawSignal'>;

const windowsExitCodeMap = new Map<number, RuntimeErrorTemplate>([
  [0xC0000135, {
    kind: 'missingRuntimeDll',
    englishName: 'Missing runtime DLL',
    englishDescription: 'The program failed to start, probably because a runtime DLL is missing.',
    chineseDescription: '程序启动失败，通常是缺少运行时 DLL，例如 MinGW 的 libstdc++-6.dll、libgcc_s_seh-1.dll 或 libwinpthread-1.dll。',
    englishCauses: ['Missing MinGW runtime DLL', 'Compiler bin directory is not in PATH', 'The executable was built with dynamic runtime libraries'],
    chineseCauses: ['缺少 MinGW 运行时 DLL', '编译器 bin 目录未加入 PATH', '可执行文件依赖动态运行时库'],
    englishSuggestions: ['Add the MinGW bin directory to PATH', 'Rebuild with static linking', 'Put the missing DLL next to the executable'],
    chineseSuggestions: ['将 MinGW bin 目录加入 PATH', '使用静态链接参数重新编译', '将缺失 DLL 放到可执行文件同目录']
  }],
  [0xC00000FD, {
    kind: 'stackOverflow',
    englishName: 'Stack overflow',
    englishDescription: 'The program terminated with a stack overflow exception.',
    chineseDescription: '程序发生栈溢出，可能是递归层数过深、局部数组过大，或存在无限递归。',
    englishCauses: ['Deep recursion', 'Large local arrays', 'Large objects allocated on the stack', 'Infinite recursion'],
    chineseCauses: ['递归层数过深', '局部数组过大', '在栈上创建过大的对象', '无限递归'],
    englishSuggestions: ['Rewrite recursion iteratively', 'Move large arrays to global/static storage', 'Adjust OI Judge stack size settings', 'Check for infinite recursion'],
    chineseSuggestions: ['改为非递归写法', '将大数组改为全局或 static', '调整 OI Judge 栈空间设置', '检查是否存在无限递归']
  }],
  [0xC0000005, {
    kind: 'accessViolation',
    englishName: 'Access violation',
    englishDescription: 'The program tried to read or write invalid memory.',
    chineseDescription: '程序访问了非法内存，常见于数组越界、空指针访问或指针失效。',
    englishCauses: ['Array out of bounds', 'Null pointer access', 'Accessing freed memory', 'Invalid pointer or iterator'],
    chineseCauses: ['数组越界', '访问空指针', '访问已释放内存', '指针或迭代器失效'],
    englishSuggestions: ['Check array index bounds', 'Check whether pointers are null', 'Check vector/string access bounds', 'Reproduce with a smaller case and debug'],
    chineseSuggestions: ['检查数组下标范围', '检查指针是否为空', '检查 vector / string 访问是否越界', '用较小样例复现并调试']
  }],
  [0xC0000094, {
    kind: 'integerDivideByZero',
    englishName: 'Integer divide by zero',
    englishDescription: 'The program performed integer division or modulo by zero.',
    chineseDescription: '程序进行了整数除零或对 0 取模。',
    englishCauses: ['Divisor is zero', 'Modulo by zero', 'Uninitialized value used as divisor'],
    chineseCauses: ['除数为 0', '取模时模数为 0', '未初始化变量被用作除数'],
    englishSuggestions: ['Check division and modulo expressions', 'Check input edge cases', 'Check initialization values'],
    chineseSuggestions: ['检查除法和取模表达式', '检查输入边界', '检查初始化值']
  }],
  [0xC000008E, {
    kind: 'floatingPointException',
    englishName: 'Floating point exception',
    englishDescription: 'The program encountered an invalid floating point operation.',
    chineseDescription: '程序发生浮点异常，可能是非法浮点运算或数学函数参数不合法。',
    englishCauses: ['Invalid floating point operation', 'Invalid math function argument', 'Floating point overflow or invalid result'],
    chineseCauses: ['非法浮点运算', '数学函数参数不合法', '浮点溢出或产生非法结果'],
    englishSuggestions: ['Check floating point division', 'Check sqrt/log/acos parameter ranges', 'Check input edge cases'],
    chineseSuggestions: ['检查浮点除法', '检查 sqrt / log / acos 等函数参数范围', '检查输入边界']
  }],
  [0xC000001D, {
    kind: 'illegalInstruction',
    englishName: 'Illegal instruction',
    englishDescription: 'The program executed an instruction unsupported by the current CPU or an invalid instruction.',
    chineseDescription: '程序执行了非法指令，可能是编译参数使用了当前 CPU 不支持的指令集，或严重内存错误导致执行流异常。',
    englishCauses: ['Unsupported CPU instruction set', 'Incompatible compiler optimization flags', 'Corrupted control flow caused by memory errors'],
    chineseCauses: ['使用了当前 CPU 不支持的指令集', '编译参数包含不兼容的优化选项', '内存错误导致程序执行流异常'],
    englishSuggestions: ['Check compiler flags such as -march or -mavx', 'Avoid CPU-specific optimization flags', 'Check for severe memory out-of-bounds writes'],
    chineseSuggestions: ['检查 -march / -mavx 等编译参数', '避免使用特定 CPU 指令集优化', '检查严重内存越界']
  }],
  [0xC0000409, {
    kind: 'heapCorruption',
    englishName: 'Stack buffer overrun',
    englishDescription: 'The program triggered a stack buffer overrun or security check failure.',
    chineseDescription: '程序触发了栈缓冲区溢出或安全检查失败，常见于写爆局部数组或内存破坏。',
    englishCauses: ['Stack buffer overrun', 'Local array out-of-bounds write', 'Memory corruption', 'Unsafe buffer operation'],
    chineseCauses: ['栈缓冲区溢出', '局部数组写越界', '内存破坏', '不安全的缓冲区操作'],
    englishSuggestions: ['Check local arrays and string operations', 'Check memcpy/strcpy/scanf usage', 'Reproduce with a smaller case'],
    chineseSuggestions: ['检查局部数组和字符串操作', '检查 memcpy / strcpy / scanf 等调用', '尝试缩小样例定位越界位置']
  }],
  [0xC0000374, {
    kind: 'heapCorruption',
    englishName: 'Heap corruption',
    englishDescription: 'The program corrupted heap memory.',
    chineseDescription: '程序破坏了堆内存，常见于动态数组越界、重复释放或错误释放。',
    englishCauses: ['Heap out-of-bounds write', 'Invalid delete/free', 'Double free', 'Corrupted dynamic memory'],
    chineseCauses: ['堆数组越界写入', '错误 delete / free', '重复释放', '动态内存被破坏'],
    englishSuggestions: ['Check dynamically allocated array bounds', 'Check delete/free usage', 'Check vector/pointer access'],
    chineseSuggestions: ['检查动态分配数组边界', '检查 delete / free 使用', '检查 vector / pointer 是否越界']
  }],
  [0xC000013A, {
    kind: 'killed',
    englishName: 'Program interrupted',
    englishDescription: 'The program was interrupted or externally terminated.',
    chineseDescription: '程序被外部中断或终止。',
    englishCauses: ['User interruption', 'External process termination', 'Runtime environment terminated the process'],
    chineseCauses: ['用户中断', '外部进程终止', '运行环境终止进程'],
    englishSuggestions: ['Run again to check whether it is reproducible', 'Check whether the process was killed externally'],
    chineseSuggestions: ['重新运行确认是否稳定复现', '检查是否被外部工具终止']
  }]
]);

const signalMap = new Map<string, RuntimeErrorTemplate>([
  ['SIGSEGV', {
    kind: 'segmentationFault',
    englishName: 'Segmentation fault',
    englishDescription: 'The program accessed invalid memory.',
    chineseDescription: '程序访问了非法内存，常见于数组越界或空指针访问。',
    englishCauses: ['Array out of bounds', 'Null pointer access', 'Invalid pointer or iterator'],
    chineseCauses: ['数组越界', '访问空指针', '指针或迭代器失效'],
    englishSuggestions: ['Check array index bounds', 'Check whether pointers are null', 'Reproduce with a smaller case and debug'],
    chineseSuggestions: ['检查数组下标范围', '检查指针是否为空', '用较小样例复现并调试']
  }],
  ['SIGFPE', {
    kind: 'floatingPointException',
    englishName: 'Floating point exception',
    englishDescription: 'The program encountered an arithmetic exception.',
    chineseDescription: '程序发生算术异常，常见于整数除零或取模 0。',
    englishCauses: ['Division by zero', 'Modulo by zero', 'Invalid arithmetic operation'],
    chineseCauses: ['除数为 0', '对 0 取模', '非法算术运算'],
    englishSuggestions: ['Check division and modulo expressions', 'Check input edge cases'],
    chineseSuggestions: ['检查除法和取模表达式', '检查输入边界']
  }],
  ['SIGABRT', {
    kind: 'abort',
    englishName: 'Aborted',
    englishDescription: 'The program called abort() or failed an assertion.',
    chineseDescription: '程序主动终止，可能是 assert 失败、调用 abort()，或运行库检测到严重错误。',
    englishCauses: ['Assertion failed', 'abort() was called', 'Runtime library detected a fatal error'],
    chineseCauses: ['assert 失败', '调用了 abort()', '运行库检测到严重错误'],
    englishSuggestions: ['Check assertions', 'Open stderr', 'Reproduce with a smaller case and debug'],
    chineseSuggestions: ['检查 assert 条件', '查看 stderr', '用较小样例复现并调试']
  }],
  ['SIGILL', {
    kind: 'illegalInstruction',
    englishName: 'Illegal instruction',
    englishDescription: 'The program executed an invalid instruction.',
    chineseDescription: '程序执行了非法指令。',
    englishCauses: ['Invalid instruction', 'Unsupported CPU instruction set', 'Corrupted control flow caused by memory errors'],
    chineseCauses: ['非法指令', '使用了当前 CPU 不支持的指令集', '内存错误导致程序执行流异常'],
    englishSuggestions: ['Check compiler flags such as -march or -mavx', 'Avoid CPU-specific optimization flags'],
    chineseSuggestions: ['检查 -march / -mavx 等编译参数', '避免使用特定 CPU 指令集优化']
  }],
  ['SIGBUS', {
    kind: 'accessViolation',
    englishName: 'Bus error',
    englishDescription: 'The program triggered a bus error.',
    chineseDescription: '程序触发了总线错误，通常与非法内存访问有关。',
    englishCauses: ['Invalid memory access', 'Unaligned or invalid address access'],
    chineseCauses: ['非法内存访问', '访问未对齐或非法地址'],
    englishSuggestions: ['Check pointer and array access', 'Reproduce with a smaller case and debug'],
    chineseSuggestions: ['检查指针和数组访问', '用较小样例复现并调试']
  }],
  ['SIGKILL', {
    kind: 'killed',
    englishName: 'Killed',
    englishDescription: 'The program was forcefully killed.',
    chineseDescription: '程序被强制终止。',
    englishCauses: ['External process termination', 'Runtime environment killed the process'],
    chineseCauses: ['外部进程终止', '运行环境强制终止进程'],
    englishSuggestions: ['Run again to check whether it is reproducible', 'Check whether the process was killed externally'],
    chineseSuggestions: ['重新运行确认是否稳定复现', '检查是否被外部工具终止']
  }]
]);

export function explainRuntimeError(input: RuntimeErrorInput): RuntimeErrorExplanation | undefined {
  const spawnError = input.spawnError ?? '';
  const runnerError = input.runnerError ?? '';
  const errorText = `${spawnError}\n${runnerError}`;
  if (spawnError) {
    if (/\bENOENT\b/iu.test(errorText)) {
      return withRaw(programNotFoundTemplate, input);
    }
    if (/\b(?:EACCES|EPERM)\b/iu.test(errorText)) {
      return withRaw(permissionDeniedTemplate, input);
    }
  }
  if (runnerError) {
    return withRaw(runnerInternalErrorTemplate, input);
  }

  if (typeof input.exitCode === 'number' && input.exitCode !== 0) {
    const template = windowsExitCodeMap.get(input.exitCode >>> 0) ?? unknownTemplate;
    return withRaw(template, input);
  }
  if (input.signal) {
    const template = signalMap.get(input.signal) ?? unknownTemplate;
    return withRaw(template, input);
  }
  return undefined;
}

export function toRuntimeErrorSummary(explanation: RuntimeErrorExplanation): RuntimeErrorSummary {
  return {
    kind: explanation.kind,
    englishName: explanation.englishName,
    rawCode: explanation.rawCode,
    rawExitCode: explanation.rawExitCode,
    rawSignal: explanation.rawSignal
  };
}

export function renderRuntimeErrorExplanation(
  explanation: RuntimeErrorExplanation,
  options: { includeHeading?: boolean; stderrEmpty?: boolean } = {}
): string {
  const lines: string[] = [];
  if (options.includeHeading ?? true) {
    lines.push(`Runtime Error: ${explanation.englishName}`);
  }
  if (explanation.rawExitCode !== undefined) {
    lines.push(`Exit code: ${explanation.rawExitCode} (${explanation.rawCode})`);
  } else if (explanation.rawSignal) {
    lines.push(`Signal: ${explanation.rawSignal}`);
  }

  if (getLocale() === 'zh') {
    lines.push('', '中文说明：', explanation.chineseDescription ?? explanation.englishDescription);
    lines.push('', '可能原因：', ...combineCauses(explanation));
    lines.push('', '建议：', ...(explanation.chineseSuggestions ?? explanation.englishSuggestions).map((item) => `- ${item}`));
  } else {
    lines.push('', 'Description:', explanation.englishDescription);
    lines.push('', 'Possible causes:', ...explanation.englishCauses.map((item) => `- ${item}`));
    lines.push('', 'Suggestions:', ...explanation.englishSuggestions.map((item) => `- ${item}`));
  }

  if (options.stderrEmpty) {
    lines.push('', getLocale() === 'zh'
      ? 'stderr 为空，但进程返回了异常退出码。'
      : 'stderr is empty, but the process returned an abnormal exit code.');
  }

  return lines.join('\n');
}

function combineCauses(explanation: RuntimeErrorExplanation): string[] {
  return explanation.englishCauses.map((cause, index) => {
    const chinese = explanation.chineseCauses?.[index];
    return chinese ? `- ${cause} / ${chinese}` : `- ${cause}`;
  });
}

function withRaw(template: RuntimeErrorTemplate, input: RuntimeErrorInput): RuntimeErrorExplanation {
  return {
    ...template,
    rawExitCode: typeof input.exitCode === 'number' ? input.exitCode : undefined,
    rawCode: typeof input.exitCode === 'number' ? toHexCode(input.exitCode) : undefined,
    rawSignal: input.signal ?? null
  };
}

function toHexCode(code: number): string {
  return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

const programNotFoundTemplate: RuntimeErrorTemplate = {
  kind: 'programNotFound',
  englishName: 'Program not found',
  englishDescription: 'OI Judge failed to start the executable file.',
  chineseDescription: 'OI Judge 无法启动可执行文件，可能是 exe 文件不存在或路径错误。',
  englishCauses: ['Executable file does not exist', 'Compilation failed but runner still tried to execute', 'Invalid executable path'],
  chineseCauses: ['可执行文件不存在', '编译失败后仍尝试运行', '可执行文件路径错误'],
  englishSuggestions: ['Rebuild the program', 'Check compiler output path', 'Check the selected program'],
  chineseSuggestions: ['重新编译程序', '检查编译输出路径', '检查选择的评测程序']
};

const permissionDeniedTemplate: RuntimeErrorTemplate = {
  kind: 'permissionDenied',
  englishName: 'Permission denied',
  englishDescription: 'OI Judge does not have permission to run the executable file.',
  chineseDescription: 'OI Judge 没有权限运行该可执行文件，或文件被系统/安全软件阻止。',
  englishCauses: ['Executable permission is missing', 'The file is blocked by the system or security software'],
  chineseCauses: ['缺少可执行权限', '文件被系统或安全软件阻止'],
  englishSuggestions: ['Check file permissions', 'Check whether security software blocked the executable'],
  chineseSuggestions: ['检查文件权限', '检查安全软件是否阻止运行']
};

const runnerInternalErrorTemplate: RuntimeErrorTemplate = {
  kind: 'runnerInternalError',
  englishName: 'Runner internal error',
  englishDescription: 'OI Judge encountered an internal runner error. This may not be a program error.',
  chineseDescription: 'OI Judge 运行器发生内部错误，这不一定是用户程序错误。',
  englishCauses: ['Runner process failed', 'Pipe or process management error'],
  chineseCauses: ['运行器进程失败', '管道或进程管理错误'],
  englishSuggestions: ['See Output Channel and stderr', 'Run again to check whether it is reproducible'],
  chineseSuggestions: ['请查看 Output Channel 和 stderr', '重新运行确认是否稳定复现']
};

const unknownTemplate: RuntimeErrorTemplate = {
  kind: 'unknown',
  englishName: 'Unknown runtime error',
  englishDescription: 'The program terminated abnormally, but OI Judge could not classify the runtime error.',
  chineseDescription: '程序异常退出，但 OI Judge 无法识别具体运行错误类型。',
  englishCauses: ['Unknown abnormal termination', 'Platform-specific runtime error'],
  chineseCauses: ['未知异常退出', '平台相关运行错误'],
  englishSuggestions: ['See Output Channel and stderr', 'Reproduce with a smaller case and debug'],
  chineseSuggestions: ['请查看 Output Channel 和 stderr', '用较小样例复现并调试']
};
