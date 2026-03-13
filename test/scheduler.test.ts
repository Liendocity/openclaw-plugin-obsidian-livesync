/**
 * Tests for sync scheduling
 */

import { SimpleCronParser, SyncScheduler } from '../dist/scheduler.js';

function testCronParseBasic() {
  const parsed = SimpleCronParser.parse('0 0 * * *');
  console.assert(parsed?.minute?.includes(0), 'Should parse minute');
  console.assert(parsed?.hour?.includes(0), 'Should parse hour');
  console.assert(parsed?.dayOfMonth?.length === 31, 'Should parse all days');
  console.log('✓ testCronParseBasic passed');
}

function testCronParseRange() {
  const parsed = SimpleCronParser.parse('0 9-17 * * 1-5');
  console.assert(parsed?.hour?.includes(9), 'Should include start of range');
  console.assert(parsed?.hour?.includes(12), 'Should include middle of range');
  console.assert(parsed?.hour?.includes(17), 'Should include end of range');
  console.log('✓ testCronParseRange passed');
}

function testCronParseStep() {
  const parsed = SimpleCronParser.parse('*/15 * * * *');
  console.assert(parsed?.minute?.includes(0), 'Should include 0');
  console.assert(parsed?.minute?.includes(15), 'Should include 15');
  console.assert(parsed?.minute?.includes(30), 'Should include 30');
  console.assert(parsed?.minute?.includes(45), 'Should include 45');
  console.log('✓ testCronParseStep passed');
}

function testCronMatches() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Test: 0 0 * * * (midnight)
  const matches = SimpleCronParser.matches('0 0 * * *', now);
  console.assert(matches, 'Should match midnight');
  console.log('✓ testCronMatches passed');
}

function testSchedulerAddInterval() {
  const scheduler = new SyncScheduler();
  scheduler.addIntervalSchedule('test-interval', 60000);

  const schedules = scheduler.getSchedules();
  console.assert(schedules.length === 1, 'Should have one schedule');
  console.assert(schedules[0].name === 'test-interval', 'Should have correct name');
  console.assert(schedules[0].intervalMs === 60000, 'Should have correct interval');
  console.log('✓ testSchedulerAddInterval passed');
}

function testSchedulerAddCron() {
  const scheduler = new SyncScheduler();
  scheduler.addCronSchedule('test-cron', '0 0 * * *');

  const schedules = scheduler.getSchedules();
  console.assert(schedules.length === 1, 'Should have one schedule');
  console.assert(schedules[0].type === 'cron', 'Should be cron type');
  console.log('✓ testSchedulerAddCron passed');
}

function testSchedulerInvalidCron() {
  const scheduler = new SyncScheduler();
  let threw = false;

  try {
    scheduler.addCronSchedule('bad-cron', 'invalid cron');
  } catch {
    threw = true;
  }

  console.assert(threw, 'Should throw on invalid cron');
  console.log('✓ testSchedulerInvalidCron passed');
}

function testSchedulerSetEnabled() {
  const scheduler = new SyncScheduler();
  scheduler.addIntervalSchedule('test', 1000);
  scheduler.setEnabled('test', false);

  const schedule = scheduler.getStatus('test');
  console.assert(schedule?.enabled === false, 'Should be disabled');
  console.log('✓ testSchedulerSetEnabled passed');
}

function runTests() {
  console.log('Running scheduler tests...');
  try {
    testCronParseBasic();
    testCronParseRange();
    testCronParseStep();
    testCronMatches();
    testSchedulerAddInterval();
    testSchedulerAddCron();
    testSchedulerInvalidCron();
    testSchedulerSetEnabled();
    console.log('\n✅ All scheduler tests passed!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
