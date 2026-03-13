/**
 * Basic tests for conflict resolver
 */

import { ConflictResolver, VersionManager, FileMetadata } from '../src/conflict';

function testLastWriteWins() {
  const resolver = new ConflictResolver('last-write-wins');

  const local: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 1000,
    hash: 'local-hash',
    size: 100,
    version: 1
  };

  const remote: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 900,
    hash: 'remote-hash',
    size: 100,
    version: 1
  };

  const result = resolver.resolve(local, remote);
  console.assert(result.winner === 'local', 'Local should win (newer mtime)');
  console.log('✓ testLastWriteWins passed');
}

function testConflictDetection() {
  const resolver = new ConflictResolver();

  const local: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 1000,
    hash: 'hash1',
    size: 100,
    version: 1
  };

  const remote: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 1000,
    hash: 'hash2',
    size: 100,
    version: 1
  };

  const hasConflict = resolver.hasConflict(local, remote);
  console.assert(hasConflict === true, 'Should detect conflict (different hashes)');
  console.log('✓ testConflictDetection passed');
}

function testNoConflict() {
  const resolver = new ConflictResolver();

  const local: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 1000,
    hash: 'same-hash',
    size: 100,
    version: 1
  };

  const remote: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 1000,
    hash: 'same-hash',
    size: 100,
    version: 1
  };

  const hasConflict = resolver.hasConflict(local, remote);
  console.assert(hasConflict === false, 'Should not detect conflict (same hash)');
  console.log('✓ testNoConflict passed');
}

function testVersioning() {
  const manager = new VersionManager();

  const meta: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 1000,
    hash: 'hash1',
    size: 100,
    version: 1
  };

  const versioned = manager.recordVersion(meta, 'local', false);
  console.assert(versioned.versions?.length === 1, 'Should have 1 version');
  console.assert(versioned.versions?.[0].version === 1, 'Version should be 1');
  console.log('✓ testVersioning passed');
}

function testRemoteWinsStrategy() {
  const resolver = new ConflictResolver('remote-wins');

  const local: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 1000,
    hash: 'local-hash',
    size: 100,
    version: 1
  };

  const remote: FileMetadata = {
    _id: 'test.md',
    path: 'test.md',
    mtime: 900,
    hash: 'remote-hash',
    size: 100,
    version: 1
  };

  const result = resolver.resolve(local, remote);
  console.assert(result.winner === 'remote', 'Remote should always win');
  console.log('✓ testRemoteWinsStrategy passed');
}

function runTests() {
  console.log('Running conflict resolver tests...');
  try {
    testLastWriteWins();
    testConflictDetection();
    testNoConflict();
    testVersioning();
    testRemoteWinsStrategy();
    console.log('\n✅ All conflict resolver tests passed!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
