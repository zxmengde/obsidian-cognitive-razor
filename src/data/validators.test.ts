/**
 * 数据验证器属性测试
 * **Feature: cognitive-razor, Property 3: Stub 笔记元数据完整性**
 * **验证需求：1.5**
 */

import * as fc from 'fast-check';
import {
  validateCRFrontmatter,
  validateTaskRecord,
  validateDuplicatePair,
  generateUUID,
  generateTimestamp,
  isValidUUID,
  isValidISO8601,
} from './validators';
import {
  arbUUID,
  arbISOTimestamp,
  arbCRType,
  arbNoteState,
  arbTaskType,
  arbTaskState,
  arbSimilarity,
  arbNonEmptyString,
} from '../test-utils';
import { CRFrontmatter, TaskRecord, DuplicatePair } from '../types';

// ============================================================================
// Fast-check Arbitraries for Data Models
// ============================================================================

/**
 * 生成有效的 CRFrontmatter
 */
const arbCRFrontmatter = (): fc.Arbitrary<CRFrontmatter> =>
  fc.record({
    uid: arbUUID(),
    type: arbCRType(),
    status: arbNoteState(),
    created: arbISOTimestamp(),
    updated: arbISOTimestamp(),
    aliases: fc.option(fc.array(arbNonEmptyString(), { minLength: 0, maxLength: 10 }), { nil: undefined }),
    tags: fc.option(fc.array(arbNonEmptyString(), { minLength: 0, maxLength: 10 }), { nil: undefined }),
    parentUid: fc.option(arbUUID(), { nil: undefined }),
    parentType: fc.option(arbCRType(), { nil: undefined }),
    sourceUids: fc.option(fc.array(arbUUID(), { minLength: 0, maxLength: 5 }), { nil: undefined }),
    version: fc.option(fc.string(), { nil: undefined }),
  });

/**
 * 生成有效的 TaskRecord
 */
const arbTaskRecord = (): fc.Arbitrary<TaskRecord> =>
  fc.record({
    id: arbUUID(),
    nodeId: arbUUID(),
    taskType: arbTaskType(),
    state: arbTaskState(),
    providerRef: fc.option(arbNonEmptyString(), { nil: undefined }),
    promptRef: fc.option(arbNonEmptyString(), { nil: undefined }),
    attempt: fc.nat({ max: 10 }),
    maxAttempts: fc.integer({ min: 1, max: 10 }),
    payload: fc.dictionary(arbNonEmptyString(), fc.anything()),
    result: fc.option(fc.dictionary(arbNonEmptyString(), fc.anything()), { nil: undefined }),
    undoPointer: fc.option(arbUUID(), { nil: undefined }),
    lockKey: fc.option(arbNonEmptyString(), { nil: undefined }),
    created: arbISOTimestamp(),
    updated: arbISOTimestamp(),
    startedAt: fc.option(arbISOTimestamp(), { nil: undefined }),
    completedAt: fc.option(arbISOTimestamp(), { nil: undefined }),
    errors: fc.option(
      fc.array(
        fc.record({
          code: arbNonEmptyString(),
          message: arbNonEmptyString(),
          timestamp: arbISOTimestamp(),
          attempt: fc.nat({ max: 10 }),
        }),
        { minLength: 0, maxLength: 5 }
      ),
      { nil: undefined }
    ),
  });

/**
 * 生成有效的 DuplicatePair
 */
const arbDuplicatePair = (): fc.Arbitrary<DuplicatePair> =>
  fc.record({
    id: arbUUID(),
    noteA: fc.record({
      nodeId: arbUUID(),
      name: arbNonEmptyString(),
      path: arbNonEmptyString(),
    }),
    noteB: fc.record({
      nodeId: arbUUID(),
      name: arbNonEmptyString(),
      path: arbNonEmptyString(),
    }),
    type: arbCRType(),
    similarity: arbSimilarity(),
    detectedAt: arbISOTimestamp(),
    status: fc.constantFrom("pending", "merging", "merged", "dismissed"),
  });

// ============================================================================
// Property Tests: Round Trip Serialization
// ============================================================================

describe('CRFrontmatter 序列化 Round Trip', () => {
  // **Feature: cognitive-razor, Property 3: Stub 笔记元数据完整性**
  test('属性测试：序列化后反序列化应保持数据完整性', async () => {
    await fc.assert(
      fc.asyncProperty(arbCRFrontmatter(), async (original) => {
        // 序列化
        const serialized = JSON.stringify(original);
        
        // 反序列化
        const deserialized = JSON.parse(serialized);
        
        // 验证
        const validationResult = validateCRFrontmatter(deserialized);
        
        // 断言验证成功
        expect(validationResult.ok).toBe(true);
        
        if (validationResult.ok) {
          const validated = validationResult.value;
          
          // 验证必填字段
          expect(validated.uid).toBe(original.uid);
          expect(validated.type).toBe(original.type);
          expect(validated.status).toBe(original.status);
          expect(validated.created).toBe(original.created);
          expect(validated.updated).toBe(original.updated);
          
          // 验证可选字段
          expect(validated.aliases).toEqual(original.aliases);
          expect(validated.tags).toEqual(original.tags);
          expect(validated.parentUid).toBe(original.parentUid);
          expect(validated.parentType).toBe(original.parentType);
          expect(validated.sourceUids).toEqual(original.sourceUids);
          expect(validated.version).toBe(original.version);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('属性测试：所有生成的 Frontmatter 都包含必填字段', async () => {
    await fc.assert(
      fc.asyncProperty(arbCRFrontmatter(), async (fm) => {
        // 验证必填字段存在
        expect(fm.uid).toBeDefined();
        expect(fm.type).toBeDefined();
        expect(fm.status).toBeDefined();
        expect(fm.created).toBeDefined();
        expect(fm.updated).toBeDefined();
        
        // 验证 UUID 格式
        expect(isValidUUID(fm.uid)).toBe(true);
        
        // 验证时间戳格式
        expect(isValidISO8601(fm.created)).toBe(true);
        expect(isValidISO8601(fm.updated)).toBe(true);
        
        // 如果有 parentUid，验证其格式
        if (fm.parentUid) {
          expect(isValidUUID(fm.parentUid)).toBe(true);
        }
        
        // 如果有 sourceUids，验证每个 UUID 格式
        if (fm.sourceUids) {
          fm.sourceUids.forEach(uid => {
            expect(isValidUUID(uid)).toBe(true);
          });
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('TaskRecord 序列化 Round Trip', () => {
  test('属性测试：序列化后反序列化应保持数据完整性', async () => {
    await fc.assert(
      fc.asyncProperty(arbTaskRecord(), async (original) => {
        // 序列化
        const serialized = JSON.stringify(original);
        
        // 反序列化
        const deserialized = JSON.parse(serialized);
        
        // 验证
        const validationResult = validateTaskRecord(deserialized);
        
        // 断言验证成功
        expect(validationResult.ok).toBe(true);
        
        if (validationResult.ok) {
          const validated = validationResult.value;
          
          // 验证必填字段
          expect(validated.id).toBe(original.id);
          expect(validated.nodeId).toBe(original.nodeId);
          expect(validated.taskType).toBe(original.taskType);
          expect(validated.state).toBe(original.state);
          expect(validated.attempt).toBe(original.attempt);
          expect(validated.maxAttempts).toBe(original.maxAttempts);
          expect(validated.created).toBe(original.created);
          expect(validated.updated).toBe(original.updated);
          
          // 验证可选字段
          expect(validated.providerRef).toBe(original.providerRef);
          expect(validated.promptRef).toBe(original.promptRef);
          expect(validated.undoPointer).toBe(original.undoPointer);
          expect(validated.lockKey).toBe(original.lockKey);
          expect(validated.startedAt).toBe(original.startedAt);
          expect(validated.completedAt).toBe(original.completedAt);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('属性测试：所有生成的 TaskRecord 都包含必填字段', async () => {
    await fc.assert(
      fc.asyncProperty(arbTaskRecord(), async (task) => {
        // 验证必填字段存在
        expect(task.id).toBeDefined();
        expect(task.nodeId).toBeDefined();
        expect(task.taskType).toBeDefined();
        expect(task.state).toBeDefined();
        expect(task.attempt).toBeDefined();
        expect(task.maxAttempts).toBeDefined();
        expect(task.payload).toBeDefined();
        expect(task.created).toBeDefined();
        expect(task.updated).toBeDefined();
        
        // 验证 UUID 格式
        expect(isValidUUID(task.id)).toBe(true);
        expect(isValidUUID(task.nodeId)).toBe(true);
        
        // 验证时间戳格式
        expect(isValidISO8601(task.created)).toBe(true);
        expect(isValidISO8601(task.updated)).toBe(true);
        
        // 验证数值范围
        expect(task.attempt).toBeGreaterThanOrEqual(0);
        expect(task.maxAttempts).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('DuplicatePair 序列化 Round Trip', () => {
  test('属性测试：序列化后反序列化应保持数据完整性', async () => {
    await fc.assert(
      fc.asyncProperty(arbDuplicatePair(), async (original) => {
        // 序列化
        const serialized = JSON.stringify(original);
        
        // 反序列化
        const deserialized = JSON.parse(serialized);
        
        // 验证
        const validationResult = validateDuplicatePair(deserialized);
        
        // 断言验证成功
        expect(validationResult.ok).toBe(true);
        
        if (validationResult.ok) {
          const validated = validationResult.value;
          
          // 验证必填字段
          expect(validated.id).toBe(original.id);
          expect(validated.noteA.nodeId).toBe(original.noteA.nodeId);
          expect(validated.noteA.name).toBe(original.noteA.name);
          expect(validated.noteA.path).toBe(original.noteA.path);
          expect(validated.noteB.nodeId).toBe(original.noteB.nodeId);
          expect(validated.noteB.name).toBe(original.noteB.name);
          expect(validated.noteB.path).toBe(original.noteB.path);
          expect(validated.type).toBe(original.type);
          expect(validated.similarity).toBe(original.similarity);
          expect(validated.detectedAt).toBe(original.detectedAt);
          expect(validated.status).toBe(original.status);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('属性测试：所有生成的 DuplicatePair 都包含必填字段', async () => {
    await fc.assert(
      fc.asyncProperty(arbDuplicatePair(), async (pair) => {
        // 验证必填字段存在
        expect(pair.id).toBeDefined();
        expect(pair.noteA).toBeDefined();
        expect(pair.noteB).toBeDefined();
        expect(pair.type).toBeDefined();
        expect(pair.similarity).toBeDefined();
        expect(pair.detectedAt).toBeDefined();
        expect(pair.status).toBeDefined();
        
        // 验证 UUID 格式
        expect(isValidUUID(pair.id)).toBe(true);
        expect(isValidUUID(pair.noteA.nodeId)).toBe(true);
        expect(isValidUUID(pair.noteB.nodeId)).toBe(true);
        
        // 验证时间戳格式
        expect(isValidISO8601(pair.detectedAt)).toBe(true);
        
        // 验证相似度范围
        expect(pair.similarity).toBeGreaterThanOrEqual(0);
        expect(pair.similarity).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Unit Tests: Helper Functions
// ============================================================================

describe('UUID 生成和验证', () => {
  test('generateUUID() 生成有效的 UUID v4', () => {
    for (let i = 0; i < 10; i++) {
      const uuid = generateUUID();
      expect(isValidUUID(uuid)).toBe(true);
    }
  });

  test('生成的 UUID 是唯一的', () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUUID());
    }
    expect(uuids.size).toBe(100);
  });
});

describe('时间戳生成和验证', () => {
  test('generateTimestamp() 生成有效的 ISO 8601 时间戳', () => {
    for (let i = 0; i < 10; i++) {
      const timestamp = generateTimestamp();
      expect(isValidISO8601(timestamp)).toBe(true);
    }
  });

  test('生成的时间戳是递增的', async () => {
    const ts1 = generateTimestamp();
    await new Promise(resolve => setTimeout(resolve, 10));
    const ts2 = generateTimestamp();
    
    expect(new Date(ts2).getTime()).toBeGreaterThan(new Date(ts1).getTime());
  });
});

// ============================================================================
// Unit Tests: URL Validation
// ============================================================================

import { validateUrl } from './validators';

describe('URL 验证', () => {
  describe('有效的 URL', () => {
    test('接受标准的 HTTPS URL', () => {
      expect(validateUrl('https://api.openai.com/v1')).toBeNull();
      expect(validateUrl('https://example.com')).toBeNull();
      expect(validateUrl('https://sub.example.com')).toBeNull();
    });

    test('接受标准的 HTTP URL', () => {
      expect(validateUrl('http://localhost:8080')).toBeNull();
      expect(validateUrl('http://example.com')).toBeNull();
    });

    test('接受带端口的 URL', () => {
      expect(validateUrl('https://example.com:443')).toBeNull();
      expect(validateUrl('http://localhost:3000')).toBeNull();
    });

    test('接受带路径的 URL', () => {
      expect(validateUrl('https://api.example.com/v1/chat')).toBeNull();
      expect(validateUrl('http://example.com/path/to/resource')).toBeNull();
    });

    test('接受带查询参数的 URL', () => {
      expect(validateUrl('https://example.com?key=value')).toBeNull();
      expect(validateUrl('https://example.com/path?foo=bar&baz=qux')).toBeNull();
    });

    test('正确处理前后空格', () => {
      expect(validateUrl('  https://example.com  ')).toBeNull();
      expect(validateUrl('\thttps://example.com\n')).toBeNull();
    });
  });

  describe('无效的 URL', () => {
    test('拒绝空字符串', () => {
      const result = validateUrl('');
      expect(result).not.toBeNull();
      expect(result).toContain('不能为空');
    });

    test('拒绝仅包含空格的字符串', () => {
      const result = validateUrl('   ');
      expect(result).not.toBeNull();
      expect(result).toContain('不能为空');
    });

    test('拒绝不以 http:// 或 https:// 开头的字符串', () => {
      expect(validateUrl('example.com')).not.toBeNull();
      expect(validateUrl('www.example.com')).not.toBeNull();
      expect(validateUrl('ftp://example.com')).not.toBeNull();
    });

    test('拒绝缺少主机名的 URL', () => {
      expect(validateUrl('https://')).not.toBeNull();
      expect(validateUrl('http://')).not.toBeNull();
    });

    test('拒绝使用非 HTTP/HTTPS 协议的 URL', () => {
      expect(validateUrl('ftp://example.com')).not.toBeNull();
      expect(validateUrl('file:///path/to/file')).not.toBeNull();
      expect(validateUrl('ws://example.com')).not.toBeNull();
    });

    test('拒绝格式错误的 URL', () => {
      expect(validateUrl('https://exam ple.com')).not.toBeNull();
      expect(validateUrl('https://<invalid>')).not.toBeNull();
    });
  });

  describe('错误消息', () => {
    test('空 URL 返回友好的错误消息', () => {
      const result = validateUrl('');
      expect(result).toBe('URL 不能为空');
    });

    test('缺少协议返回友好的错误消息', () => {
      const result = validateUrl('example.com');
      expect(result).toContain('必须以 http:// 或 https:// 开头');
    });

    test('无效格式返回友好的错误消息', () => {
      const result = validateUrl('https://exam ple.com');
      expect(result).toBe('无效的 URL 格式');
    });
  });
});
