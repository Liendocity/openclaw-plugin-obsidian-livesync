/**
 * Basic tests for retry utilities
 */

import { retryWithBackoff, RetryableError, sleep } from '../dist/retry.js';

async function testRetrySuccess() {
  let attempts = 0;
  const result = await retryWithBackoff(async () => {
    attempts++;
    if (attempts < 2) throw new Error('First attempt fails');
    return 'success';
  }, { maxRetries: 2 });

  console.assert(result === 'success', 'Should return success');
  console.assert(attempts === 2, 'Should retry once');
  console.log('✓ testRetrySuccess passed');
}

async function testRetryFailure() {
  let attempts = 0;
  try {
    await retryWithBackoff(async () => {
      attempts++;
      throw new Error('Always fails');
    }, { maxRetries: 1 });
    console.assert(false, 'Should have thrown');
  } catch (err) {
    console.assert(err instanceof RetryableError, 'Should throw RetryableError');
    console.assert(attempts === 2, 'Should have attempted twice');
    console.log('✓ testRetryFailure passed');
  }
}

async function testBackoffDelay() {
  const start = Date.now();
  let attempts = 0;

  try {
    await retryWithBackoff(async () => {
      attempts++;
      throw new Error('Fails');
    }, { 
      maxRetries: 1,
      initialDelayMs: 50,
      backoffMultiplier: 2,
      jitterFraction: 0
    });
  } catch {
    // Expected
  }

  const elapsed = Date.now() - start;
  console.assert(elapsed >= 50, `Should wait at least 50ms, waited ${elapsed}ms`);
  console.log('✓ testBackoffDelay passed');
}

async function runTests() {
  console.log('Running retry tests...');
  try {
    await testRetrySuccess();
    await testRetryFailure();
    await testBackoffDelay();
    console.log('\n✅ All retry tests passed!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
