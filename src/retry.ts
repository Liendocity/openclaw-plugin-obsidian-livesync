/**
 * Retry utilities with exponential backoff
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterFraction?: number; // Add randomness (0-1) to avoid thundering herd
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public retryCount: number,
    public lastError: Error
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry configuration
 * @returns Result of successful function call
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    jitterFraction = 0.1
  } = options;

  let lastError: Error | null = null;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        throw new RetryableError(
          `Failed after ${maxRetries + 1} attempts`,
          maxRetries,
          lastError
        );
      }

      // Add jitter to prevent thundering herd
      const jitter = delay * jitterFraction * Math.random();
      const waitTime = Math.min(delay + jitter, maxDelayMs);

      console.log(
        `[Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed. ` +
        `Waiting ${Math.round(waitTime)}ms. Error: ${lastError.message}`
      );

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
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry-safe PouchDB operations
 */
export async function safeDbPut(
  db: any,
  doc: any,
  retries: number = 3
): Promise<any> {
  return retryWithBackoff(
    () => db.put(doc),
    { maxRetries: retries }
  );
}

export async function safeDbGet(
  db: any,
  id: string,
  retries: number = 3
): Promise<any> {
  return retryWithBackoff(
    () => db.get(id),
    { maxRetries: retries }
  );
}

export async function safeDbAllDocs(
  db: any,
  options?: any,
  retries: number = 3
): Promise<any> {
  return retryWithBackoff(
    () => db.allDocs(options),
    { maxRetries: retries }
  );
}
