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
export type NumericVector = ReadonlyArray<number> | Float64Array | Float32Array;

export function normalizeVector(vector: NumericVector): number[] {
    let scale = 0;
    for (let i = 0; i < vector.length; i++) {
        scale = Math.max(scale, Math.abs(vector[i]));
    }
    if (scale === 0) return Array.isArray(vector) ? vector : Array.from(vector);

    // 先缩放再平方，避免有限嵌入分量的平方溢出或下溢。
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
        norm += (vector[i] / scale) ** 2;
    }
    norm = Math.sqrt(norm);

    const normalized = new Array<number>(vector.length);
    for (let i = 0; i < vector.length; i++) {
        normalized[i] = (vector[i] / scale) / norm;
    }
    return normalized;
}

/**
 * 向量点积
 *
 * 维度不匹配时抛错（fail-fast），不做静默截断。
 */
export function dotProduct(a: NumericVector, b: NumericVector): number {
    const len = a.length;
    if (len !== b.length) {
        throw new Error(`向量维度不匹配: ${len} vs ${b.length}`);
    }

    // 4 路累加展开打破单累加器浮点 FMA 依赖链，提升大向量点积吞吐。
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let i = 0;
    const limit = len - 3;
    for (; i < limit; i += 4) {
        s0 += a[i] * b[i];
        s1 += a[i + 1] * b[i + 1];
        s2 += a[i + 2] * b[i + 2];
        s3 += a[i + 3] * b[i + 3];
    }
    let product = (s0 + s1) + (s2 + s3);
    for (; i < len; i++) {
        product += a[i] * b[i];
    }
    return product;
}
