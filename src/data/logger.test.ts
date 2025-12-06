/**
 * Logger 组件测试
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger, LogLevel } from './logger';
import { FileStorage } from './file-storage';

// ============================================================================
// 测试辅助函数
// ============================================================================

/**
 * 创建临时测试目录
 */
function createTempDir(): string {
  const tempDir = path.join(os.tmpdir(), `cr-logger-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/**
 * 清理临时目录
 */
function cleanupTempDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * 等待一段时间
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('Logger 基础功能', () => {
  let tempDir: string;
  let storage: FileStorage;
  let logger: Logger;

  beforeEach(() => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
    logger = new Logger({
      storage,
      logFilePath: 'test.log',
      minLevel: 'debug',
    });
  });

  afterEach(() => {
    logger.destroy();
    cleanupTempDir(tempDir);
  });

  test('记录 debug 日志', async () => {
    logger.debug('Debug message');
    await sleep(1100); // 等待刷新

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('[DEBUG]');
      expect(result.value).toContain('Debug message');
    }
  });

  test('记录 info 日志', async () => {
    logger.info('Info message');
    await sleep(1100);

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('[INFO]');
      expect(result.value).toContain('Info message');
    }
  });

  test('记录 warn 日志', async () => {
    logger.warn('Warning message');
    await sleep(1100);

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('[WARN]');
      expect(result.value).toContain('Warning message');
    }
  });

  test('记录 error 日志（立即刷新）', async () => {
    logger.error('Error message');
    await sleep(100); // error 立即刷新，只需短暂等待

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('[ERROR]');
      expect(result.value).toContain('Error message');
    }
  });

  test('记录带上下文的日志', async () => {
    logger.info('Message with context', { userId: '123', action: 'test' });
    await sleep(1100);

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('Message with context');
      expect(result.value).toContain('userId');
      expect(result.value).toContain('123');
    }
  });
});

describe('Logger 日志级别过滤', () => {
  let tempDir: string;
  let storage: FileStorage;
  let logger: Logger;

  beforeEach(() => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
  });

  afterEach(() => {
    if (logger) {
      logger.destroy();
    }
    cleanupTempDir(tempDir);
  });

  test('minLevel=info 时不记录 debug 日志', async () => {
    logger = new Logger({
      storage,
      logFilePath: 'test.log',
      minLevel: 'info',
    });

    logger.debug('Debug message');
    logger.info('Info message');
    await sleep(1100);

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toContain('[DEBUG]');
      expect(result.value).toContain('[INFO]');
    }
  });

  test('minLevel=warn 时只记录 warn 和 error', async () => {
    logger = new Logger({
      storage,
      logFilePath: 'test.log',
      minLevel: 'warn',
    });

    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');
    await sleep(1100);

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toContain('[DEBUG]');
      expect(result.value).not.toContain('[INFO]');
      expect(result.value).toContain('[WARN]');
      expect(result.value).toContain('[ERROR]');
    }
  });

  test('minLevel=error 时只记录 error', async () => {
    logger = new Logger({
      storage,
      logFilePath: 'test.log',
      minLevel: 'error',
    });

    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');
    await sleep(100);

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toContain('[DEBUG]');
      expect(result.value).not.toContain('[INFO]');
      expect(result.value).not.toContain('[WARN]');
      expect(result.value).toContain('[ERROR]');
    }
  });

  test('动态修改日志级别', async () => {
    logger = new Logger({
      storage,
      logFilePath: 'test.log',
      minLevel: 'debug',
    });

    logger.debug('Debug 1');
    await sleep(1100);

    // 修改为 info
    logger.setMinLevel('info');
    expect(logger.getMinLevel()).toBe('info');

    logger.debug('Debug 2');
    logger.info('Info 1');
    await sleep(1100);

    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('Debug 1');
      expect(result.value).not.toContain('Debug 2');
      expect(result.value).toContain('Info 1');
    }
  });
});

describe('Logger 循环日志', () => {
  let tempDir: string;
  let storage: FileStorage;
  let logger: Logger;

  beforeEach(() => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
  });

  afterEach(() => {
    if (logger) {
      logger.destroy();
    }
    cleanupTempDir(tempDir);
  });

  test('日志文件超过大小限制时自动截断', async () => {
    // 设置很小的大小限制
    logger = new Logger({
      storage,
      logFilePath: 'test.log',
      minLevel: 'debug',
      maxSize: 500, // 500 字节
    });

    // 写入大量日志
    for (let i = 0; i < 50; i++) {
      logger.info(`Log message ${i}`);
    }
    await sleep(1100);

    // 检查文件大小
    const sizeResult = await logger.getSize();
    expect(sizeResult.ok).toBe(true);
    if (sizeResult.ok) {
      expect(sizeResult.value).toBeLessThanOrEqual(500);
    }

    // 检查内容（应该只保留最新的日志）
    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('Log message 49'); // 最新的应该在
      expect(result.value).not.toContain('Log message 0'); // 最旧的应该被删除
    }
  });

  test('默认大小限制为 1MB', async () => {
    logger = new Logger({
      storage,
      logFilePath: 'test.log',
      minLevel: 'debug',
    });

    // 写入一些日志
    for (let i = 0; i < 10; i++) {
      logger.info(`Log message ${i}`);
    }
    await sleep(1100);

    // 文件应该远小于 1MB
    const sizeResult = await logger.getSize();
    expect(sizeResult.ok).toBe(true);
    if (sizeResult.ok) {
      expect(sizeResult.value).toBeLessThan(1024 * 1024);
    }
  });
});

describe('Logger 工具方法', () => {
  let tempDir: string;
  let storage: FileStorage;
  let logger: Logger;

  beforeEach(() => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
    logger = new Logger({
      storage,
      logFilePath: 'test.log',
      minLevel: 'debug',
    });
  });

  afterEach(() => {
    logger.destroy();
    cleanupTempDir(tempDir);
  });

  test('clear() 清空日志文件', async () => {
    logger.info('Message 1');
    logger.info('Message 2');
    await sleep(1100);

    // 清空
    const clearResult = await logger.clear();
    expect(clearResult.ok).toBe(true);

    // 验证文件为空
    const result = await logger.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('');
    }
  });

  test('readLastLines() 读取最后 N 行', async () => {
    for (let i = 0; i < 10; i++) {
      logger.info(`Message ${i}`);
    }
    await sleep(1100);

    const result = await logger.readLastLines(3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(3);
      expect(result.value[2]).toContain('Message 9');
      expect(result.value[1]).toContain('Message 8');
      expect(result.value[0]).toContain('Message 7');
    }
  });

  test('getSize() 获取日志文件大小', async () => {
    logger.info('Test message');
    await sleep(1100);

    const result = await logger.getSize();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeGreaterThan(0);
    }
  });
});
