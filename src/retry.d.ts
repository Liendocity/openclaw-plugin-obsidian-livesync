/**
 * Retry utilities with exponential backoff
 */
export interface RetryOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitterFraction?: number;
}
export declare class RetryableError extends Error {
    retryCount: number;
    lastError: Error;
    constructor(message: string, retryCount: number, lastError: Error);
}
/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry configuration
 * @returns Result of successful function call
 */
export declare function retryWithBackoff<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
/**
 * Sleep for a given number of milliseconds
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Retry-safe PouchDB operations
 */
export declare function safeDbPut(db: any, doc: any, retries?: number): Promise<any>;
export declare function safeDbGet(db: any, id: string, retries?: number): Promise<any>;
export declare function safeDbAllDocs(db: any, options?: any, retries?: number): Promise<any>;
//# sourceMappingURL=retry.d.ts.map