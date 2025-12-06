/**
 * FileStorage 属性测试
 * **Feature: cognitive-razor, Property 17: 本地存储约束**
 * **验证需求：9.1**
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStorage } from './file-storage';
import { arbNonEmptyString } from '../test-utils';

// ============================================================================
// 测试辅助函数
// ============================================================================

/**
 * 创建临时测试目录
 */
function createTempDir(): string {
  const tempDir = path.join(os.tmpdir(), `cr-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
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
 * 生成安全的文件路径（不包含特殊字符）
 */
const arbSafeFilePath = (): fc.Arbitrary<string> =>
  fc.tuple(
    fc.array(fc.stringMatching(/^[a-zA-Z0-9_-]+$/), { minLength: 1, maxLength: 3 }),
    fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
    fc.constantFrom('.json', '.txt', '.md')
  ).map(([dirs, filename, ext]) => {
    return [...dirs, filename + ext].join('/');
  });

/**
 * 生成测试数据（JSON 兼容）
 * 注意：不包含 undefined，因为 JSON 不支持 undefined
 */
const arbTestData = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))),
    fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)))
  );

// ============================================================================
// Property Tests: 本地存储约束
// ============================================================================

describe('FileStorage 本地存储约束', () => {
  let tempDir: string;
  let storage: FileStorage;

  beforeEach(() => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  // **Feature: cognitive-razor, Property 17: 本地存储约束**
  test('属性测试：所有写入操作都在数据目录内', async () => {
    await fc.assert(
      fc.asyncProperty(arbSafeFilePath(), arbNonEmptyString(), async (filePath, content) => {
        // 写入文件
        const writeResult = await storage.writeFile(filePath, content);
        
        if (writeResult.ok) {
          // 验证文件存在于数据目录内
          const fullPath = path.join(tempDir, filePath);
          expect(fs.existsSync(fullPath)).toBe(true);
          
          // 验证文件路径在数据目录内
          const normalizedFullPath = path.normalize(fullPath);
          const normalizedDataDir = path.normalize(tempDir);
          expect(normalizedFullPath.startsWith(normalizedDataDir)).toBe(true);
          
          // 清理
          await storage.deleteFile(filePath);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('属性测试：所有 JSON 写入操作都在数据目录内', async () => {
    await fc.assert(
      fc.asyncProperty(arbSafeFilePath(), arbTestData(), async (filePath, data) => {
        // 确保文件路径以 .json 结尾
        const jsonPath = filePath.endsWith('.json') ? filePath : filePath.replace(/\.[^.]+$/, '.json');
        
        // 写入 JSON
        const writeResult = await storage.writeJSON(jsonPath, data);
        
        if (writeResult.ok) {
          // 验证文件存在于数据目录内
          const fullPath = path.join(tempDir, jsonPath);
          expect(fs.existsSync(fullPath)).toBe(true);
          
          // 验证文件路径在数据目录内
          const normalizedFullPath = path.normalize(fullPath);
          const normalizedDataDir = path.normalize(tempDir);
          expect(normalizedFullPath.startsWith(normalizedDataDir)).toBe(true);
          
          // 清理
          await storage.deleteFile(jsonPath);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('属性测试：getDataDir() 返回配置的数据目录', () => {
    expect(storage.getDataDir()).toBe(tempDir);
  });
});

// ============================================================================
// Property Tests: 原子写入
// ============================================================================

describe('FileStorage 原子写入', () => {
  let tempDir: string;
  let storage: FileStorage;

  beforeEach(() => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test('属性测试：写入后读取应返回相同内容', async () => {
    await fc.assert(
      fc.asyncProperty(arbSafeFilePath(), arbNonEmptyString(), async (filePath, content) => {
        // 写入
        const writeResult = await storage.writeFile(filePath, content);
        expect(writeResult.ok).toBe(true);
        
        // 读取
        const readResult = await storage.readFile(filePath);
        expect(readResult.ok).toBe(true);
        
        if (readResult.ok) {
          expect(readResult.value).toBe(content);
        }
        
        // 清理
        await storage.deleteFile(filePath);
      }),
      { numRuns: 100 }
    );
  });

  test('属性测试：JSON 写入后读取应返回相同数据', async () => {
    await fc.assert(
      fc.asyncProperty(arbSafeFilePath(), arbTestData(), async (filePath, data) => {
        // 确保文件路径以 .json 结尾
        const jsonPath = filePath.endsWith('.json') ? filePath : filePath.replace(/\.[^.]+$/, '.json');
        
        // 写入
        const writeResult = await storage.writeJSON(jsonPath, data);
        expect(writeResult.ok).toBe(true);
        
        // 读取
        const readResult = await storage.readJSON(jsonPath);
        expect(readResult.ok).toBe(true);
        
        if (readResult.ok) {
          expect(readResult.value).toEqual(data);
        }
        
        // 清理
        await storage.deleteFile(jsonPath);
      }),
      { numRuns: 100 }
    );
  });

  test('属性测试：覆盖写入应替换原内容', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSafeFilePath(),
        arbNonEmptyString(),
        arbNonEmptyString(),
        async (filePath, content1, content2) => {
          // 第一次写入
          const write1Result = await storage.writeFile(filePath, content1);
          expect(write1Result.ok).toBe(true);
          
          // 第二次写入
          const write2Result = await storage.writeFile(filePath, content2);
          expect(write2Result.ok).toBe(true);
          
          // 读取
          const readResult = await storage.readFile(filePath);
          expect(readResult.ok).toBe(true);
          
          if (readResult.ok) {
            // 应该是第二次写入的内容
            expect(readResult.value).toBe(content2);
          }
          
          // 清理
          await storage.deleteFile(filePath);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property Tests: 文件操作
// ============================================================================

describe('FileStorage 文件操作', () => {
  let tempDir: string;
  let storage: FileStorage;

  beforeEach(() => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test('属性测试：复制文件后两个文件内容相同', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSafeFilePath(),
        arbSafeFilePath(),
        arbNonEmptyString(),
        async (sourcePath, destPath, content) => {
          // 跳过相同路径
          if (sourcePath === destPath) {
            return;
          }
          
          // 写入源文件
          const writeResult = await storage.writeFile(sourcePath, content);
          expect(writeResult.ok).toBe(true);
          
          // 复制文件
          const copyResult = await storage.copyFile(sourcePath, destPath);
          expect(copyResult.ok).toBe(true);
          
          // 读取两个文件
          const readSourceResult = await storage.readFile(sourcePath);
          const readDestResult = await storage.readFile(destPath);
          
          expect(readSourceResult.ok).toBe(true);
          expect(readDestResult.ok).toBe(true);
          
          if (readSourceResult.ok && readDestResult.ok) {
            expect(readSourceResult.value).toBe(readDestResult.value);
            expect(readDestResult.value).toBe(content);
          }
          
          // 清理
          await storage.deleteFile(sourcePath);
          await storage.deleteFile(destPath);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('属性测试：移动文件后源文件不存在，目标文件存在', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSafeFilePath(),
        arbSafeFilePath(),
        arbNonEmptyString(),
        async (sourcePath, destPath, content) => {
          // 跳过相同路径
          if (sourcePath === destPath) {
            return;
          }
          
          // 写入源文件
          const writeResult = await storage.writeFile(sourcePath, content);
          expect(writeResult.ok).toBe(true);
          
          // 移动文件
          const moveResult = await storage.moveFile(sourcePath, destPath);
          expect(moveResult.ok).toBe(true);
          
          // 验证源文件不存在
          const sourceExists = await storage.exists(sourcePath);
          expect(sourceExists).toBe(false);
          
          // 验证目标文件存在且内容正确
          const destExists = await storage.exists(destPath);
          expect(destExists).toBe(true);
          
          const readResult = await storage.readFile(destPath);
          expect(readResult.ok).toBe(true);
          
          if (readResult.ok) {
            expect(readResult.value).toBe(content);
          }
          
          // 清理
          await storage.deleteFile(destPath);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('属性测试：删除文件后文件不存在', async () => {
    await fc.assert(
      fc.asyncProperty(arbSafeFilePath(), arbNonEmptyString(), async (filePath, content) => {
        // 写入文件
        const writeResult = await storage.writeFile(filePath, content);
        expect(writeResult.ok).toBe(true);
        
        // 验证文件存在
        const existsBefore = await storage.exists(filePath);
        expect(existsBefore).toBe(true);
        
        // 删除文件
        const deleteResult = await storage.deleteFile(filePath);
        expect(deleteResult.ok).toBe(true);
        
        // 验证文件不存在
        const existsAfter = await storage.exists(filePath);
        expect(existsAfter).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Unit Tests: 错误处理
// ============================================================================

describe('FileStorage 错误处理', () => {
  let tempDir: string;
  let storage: FileStorage;

  beforeEach(() => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test('读取不存在的文件应返回错误', async () => {
    const result = await storage.readFile('non-existent.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  test('删除不存在的文件应返回错误', async () => {
    const result = await storage.deleteFile('non-existent.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  test('复制不存在的文件应返回错误', async () => {
    const result = await storage.copyFile('non-existent.txt', 'dest.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  test('移动不存在的文件应返回错误', async () => {
    const result = await storage.moveFile('non-existent.txt', 'dest.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  test('读取无效 JSON 应返回错误', async () => {
    const filePath = 'invalid.json';
    await storage.writeFile(filePath, 'not valid json');
    
    const result = await storage.readJSON(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('JSON_PARSE_ERROR');
    }
    
    await storage.deleteFile(filePath);
  });
});
