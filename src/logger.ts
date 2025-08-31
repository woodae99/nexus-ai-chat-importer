// logger.ts
enum LogLevel {
    INFO,
    WARN,
    ERROR,
}

export class Logger {
    private logToConsole(level: LogLevel, message: string, details?: any) {
        const prefix = `[Nexus AI Chat Importer] [${LogLevel[level]}]`;
        if (details !== undefined) {
            try {
                const extra = typeof details === 'string' ? details : JSON.stringify(details);
                console.log(`${prefix} ${message}\n> ${extra}`);
                return;
            } catch (_) {}
        }
        console.log(`${prefix} ${message}`);
    }

    info(message: string, details?: any) { this.logToConsole(LogLevel.INFO, message, details); }

    warn(message: string, details?: any) { this.logToConsole(LogLevel.WARN, message, details); }

    error(message: string, details?: any) { this.logToConsole(LogLevel.ERROR, message, details); }
}
