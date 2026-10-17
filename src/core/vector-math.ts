/**
 * VectorMath - 向量数学工具模块
 *
 * 统一 VectorIndex 和 DuplicateManager 中重复的向量运算逻辑。
 * 维度不匹配策略：fail-fast（抛错），避免静默截断导致语义漂移。
 */

/**
 * 归一化向量（L2 范数）
 *
 * 零向量直接返回原数组。
 */
export function normalizeVector(vector: number[]): number[] {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm === 0) {
        return vector;
    }

    const normalized = new Array<number>(vector.length);
    for (let i = 0; i < vector.length; i++) {
        normalized[i] = vector[i] / norm;
    }
    return normalized;
}

/**
 * 向量点积
 *
 * 维度不匹配时抛错（fail-fast），不做静默截断。
 */
export function dotProduct(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`向量维度不匹配: ${a.length} vs ${b.length}`);
    }

    let product = 0;
    for (let i = 0; i < a.length; i++) {
        product += a[i] * b[i];
    }
    return product;
}
