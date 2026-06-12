export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  userId?: number;
  command?: string;
  provider?: string;
  result?: 'success' | 'failure' | 'pending';
  message: string;
  error?: {
    message: string;
    stack?: string;
  };
}

export class Logger {
  private static log(
    level: LogEntry['level'],
    message: string,
    context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message'>>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    };
    // Emit standard JSON string representation to be parsed by log routers
    console.log(JSON.stringify(entry));
  }

  public static info(
    message: string,
    context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message'>>,
  ): void {
    this.log('INFO', message, context);
  }

  public static warn(
    message: string,
    context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message'>>,
  ): void {
    this.log('WARN', message, context);
  }

  public static error(
    message: string,
    err?: unknown,
    context?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message' | 'error'>>,
  ): void {
    const errorDetails =
      err instanceof Error
        ? { message: err.message, stack: err.stack }
        : err !== null && err !== undefined
          ? { message: typeof err === 'string' ? err : JSON.stringify(err) }
          : undefined;

    this.log('ERROR', message, {
      ...context,
      error: errorDetails,
    });
  }
}
