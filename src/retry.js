/**
 * Retry utilities with exponential backoff
 */
export class RetryableError extends Error {
    retryCount;
    lastError;
    constructor(message, retryCount, lastError) {
        super(message);
        this.retryCount = retryCount;
        this.lastError = lastError;
        this.name = 'RetryableError';
    }
}
/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry configuration
 * @returns Result of successful function call
 */
export async function retryWithBackoff(fn, options = {}) {
    const { maxRetries = 3, initialDelayMs = 100, maxDelayMs = 10000, backoffMultiplier = 2, jitterFraction = 0.1 } = options;
    let lastError = null;
    let delay = initialDelayMs;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            // Don't retry on last attempt
            if (attempt === maxRetries) {
                throw new RetryableError(`Failed after ${maxRetries + 1} attempts`, maxRetries, lastError);
            }
            // Add jitter to prevent thundering herd
            const jitter = delay * jitterFraction * Math.random();
            const waitTime = Math.min(delay + jitter, maxDelayMs);
            console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed. ` +
                `Waiting ${Math.round(waitTime)}ms. Error: ${lastError.message}`);
            await sleep(waitTime);
            delay = Math.min(delay * backoffMultiplier, maxDelayMs);
        }
    }
    // This should never be reached, but TypeScript needs it
    throw lastError || new Error('Unknown error');
}
/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Retry-safe PouchDB operations
 */
export async function safeDbPut(db, doc, retries = 3) {
    return retryWithBackoff(() => db.put(doc), { maxRetries: retries });
}
export async function safeDbGet(db, id, retries = 3) {
    return retryWithBackoff(() => db.get(id), { maxRetries: retries });
}
export async function safeDbAllDocs(db, options, retries = 3) {
    return retryWithBackoff(() => db.allDocs(options), { maxRetries: retries });
}
//# sourceMappingURL=retry.js.map