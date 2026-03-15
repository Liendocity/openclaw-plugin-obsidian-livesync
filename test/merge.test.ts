/**
 * Tests for intelligent merge strategies
 */

import { ThreeWayMerger, JsonMerger, MarkdownMerger } from '../dist/merge.js';

function testThreeWayMergeNoConflict() {
  const base = 'line1\nline2\nline3';
  const local = 'line1\nline2-modified\nline3';
  const remote = 'line1\nline2\nline3-modified';

  const result = ThreeWayMerger.merge(base, local, remote);
  if (result.conflicts) throw new Error('Should merge without conflicts');
  if (!result.merged.includes('line2-modified')) throw new Error('Should include local change');
  if (!result.merged.includes('line3-modified')) throw new Error('Should include remote change');
  console.log('✓ testThreeWayMergeNoConflict passed');
}

function testThreeWayMergeWithConflict() {
  const base = 'line1\nline2\nline3';
  const local = 'line1\nline2-local\nline3';
  const remote = 'line1\nline2-remote\nline3';

  const result = ThreeWayMerger.merge(base, local, remote);
  console.assert(result.conflicts, 'Should detect conflict');
  console.assert(result.merged.includes('LOCAL'), 'Should include conflict markers');
  console.log('✓ testThreeWayMergeWithConflict passed');
}

function testThreeWayMergeOnlyLocalChanged() {
  const base = 'line1\nline2\nline3';
  const local = 'line1\nline2-changed\nline3';
  const remote = 'line1\nline2\nline3';

  const result = ThreeWayMerger.merge(base, local, remote);
  console.assert(!result.conflicts, 'Should not conflict when only local changed');
  console.assert(result.merged === local, 'Should use local version');
  console.log('✓ testThreeWayMergeOnlyLocalChanged passed');
}

function testJsonMerge() {
  const local = { a: 1, b: 2, list: ['x', 'y'] };
  const remote = { a: 1, b: 3, list: ['x', 'z'] };

  // 2-way merge should have 1 conflict (on 'b')
  const result = JsonMerger.merge(local, remote, { preferRemote: false });
  if (result.conflicts.length !== 1) throw new Error('Should have 1 conflict in 2-way merge');
  if (result.merged.b !== 2) throw new Error('Should prefer local on conflict (preferRemote=false)');
  if (!Array.isArray(result.merged.list)) throw new Error('Should preserve arrays');
  console.log('✓ testJsonMerge passed');
}

function testMarkdownMerge() {
  const base = '---\ntitle: Doc\n---\n\nContent here';
  const local = '---\ntitle: Doc\n---\n\nContent here modified';
  const remote = '---\ntitle: Doc Updated\n---\n\nContent here';

  const result = MarkdownMerger.merge(local, remote, base);
  console.assert(result.merged.includes('title:'), 'Should preserve frontmatter');
  console.assert(result.merged.includes('Content'), 'Should preserve content');
  console.log('✓ testMarkdownMerge passed');
}

function testJsonMergePreferRemote() {
  const local = { x: 1 };
  const remote = { x: 2 };

  const result = JsonMerger.merge(local, remote, { preferRemote: true });
  console.assert(result.merged.x === 2, 'Should prefer remote when preferRemote=true');
  console.log('✓ testJsonMergePreferRemote passed');
}

function runTests() {
  console.log('Running merge strategy tests...');
  try {
    testThreeWayMergeNoConflict();
    testThreeWayMergeWithConflict();
    testThreeWayMergeOnlyLocalChanged();
    testJsonMerge();
    testMarkdownMerge();
    testJsonMergePreferRemote();
    console.log('\n✅ All merge strategy tests passed!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
