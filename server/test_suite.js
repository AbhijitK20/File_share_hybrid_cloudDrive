/**
 * Comprehensive Test Suite for File Sharing System
 * Tests encryption, compression, and access control features
 * 
 * Usage: node test_suite.js
 */

const fs = require('fs');
const path = require('path');

// Import utilities
const encryptionUtils = require('./utils/encryption');
const compressionUtils = require('./utils/compression');
const { logger } = require('./utils/logger');

// Test counters
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Test helper function
 */
function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✅ PASS: ${name}`);
  } catch (error) {
    failedTests++;
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

/**
 * Test helper for async functions
 */
async function asyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ PASS: ${name}`);
  } catch (error) {
    failedTests++;
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function runTests() {
  console.log('\n🧪 RUNNING COMPREHENSIVE TEST SUITE\n');
  console.log('=====================================\n');

  // ==================== ENCRYPTION TESTS ====================
  console.log('📦 ENCRYPTION TESTS\n');

  test('Generate Master Key - validates output structure', () => {
    const result = encryptionUtils.generateMasterKey('testPassword123');
    assert(result.key, 'Key should be generated');
    assert(result.salt, 'Salt should be generated');
    assert(result.keyHash, 'Key hash should be generated');
    assert(result.key.length === 32, 'Key should be 32 bytes');
  });

  test('Generate Master Key with custom salt - replicable results', () => {
    const salt = 'fixed-salt-for-testing';
    const result1 = encryptionUtils.generateMasterKey('testPassword', salt);
    const result2 = encryptionUtils.generateMasterKey('testPassword', salt);
    assert(result1.key.equals(result2.key), 'Same password + salt should produce same key');
  });

  test('Generate File Key - unique per call', () => {
    const masterKey = encryptionUtils.generateMasterKey('test').key;
    const result1 = encryptionUtils.generateFileKey(masterKey);
    const result2 = encryptionUtils.generateFileKey(masterKey);
    assert(result1.fileKey, 'File key should be generated');
    assert(!result1.fileKey.equals(result2.fileKey), 'Different file keys should be generated');
  });

  await asyncTest('Encrypt File - produces encrypted data', async () => {
    const testData = Buffer.from('Hello, World! This is a test file.');
    const fileKey = encryptionUtils.generateFileKey(
      encryptionUtils.generateMasterKey('test').key
    ).fileKey;

    const result = encryptionUtils.encryptFile(testData, fileKey);
    assert(result.encryptedData, 'Encrypted data should be generated');
    assert(result.iv, 'IV should be generated');
    assert(result.authTag, 'Auth tag should be generated');
    assert(!result.encryptedData.equals(testData), 'Encrypted data should differ from original');
  });

  await asyncTest('Decrypt File - recovers original data', async () => {
    const testData = Buffer.from('Secret message for encryption test');
    const { fileKey } = encryptionUtils.generateFileKey(
      encryptionUtils.generateMasterKey('test').key
    );

    const encrypted = encryptionUtils.encryptFile(testData, fileKey);
    const decrypted = encryptionUtils.decryptFile(
      encrypted.encryptedData,
      fileKey,
      encrypted.iv,
      encrypted.authTag
    );

    assert(decrypted.equals(testData), 'Decrypted data should match original');
  });

  test('Encrypt/Decrypt File - tamper detection', () => {
    const testData = Buffer.from('Important data');
    const { fileKey } = encryptionUtils.generateFileKey(
      encryptionUtils.generateMasterKey('test').key
    );

    const encrypted = encryptionUtils.encryptFile(testData, fileKey);
    const tamperedData = Buffer.from(encrypted.encryptedData);
    tamperedData[0] = tamperedData[0] ^ 0xFF; // Flip bits to tamper

    try {
      encryptionUtils.decryptFile(tamperedData, fileKey, encrypted.iv, encrypted.authTag);
      throw new Error('Should have detected tampering');
    } catch (error) {
      assert(
        error.message.includes('Decryption failed'),
        'Should throw decryption error on tampered data'
      );
    }
  });

  // ==================== COMPRESSION TESTS ====================
  console.log('\n📦 COMPRESSION TESTS\n');

  await asyncTest('Compress File (GZIP) - reduces size', async () => {
    const testData = Buffer.alloc(10000, 'a'); // 10KB of repeated data
    const compressed = await compressionUtils.compressGZIP(testData);
    assert(compressed.length < testData.length, 'Compressed should be smaller');
  });

  await asyncTest('Decompress File (GZIP) - recovers original', async () => {
    const testData = Buffer.from('This is test data that needs compression. '.repeat(100));
    const compressed = await compressionUtils.compressGZIP(testData);
    const decompressed = await compressionUtils.decompressGZIP(compressed);
    assert(decompressed.equals(testData), 'Decompressed should match original');
  });

  await asyncTest('Create ZIP Archive - multiple files', async () => {
    const files = [
      { name: 'file1.txt', buffer: Buffer.from('File 1 content') },
      { name: 'file2.txt', buffer: Buffer.from('File 2 content') },
      { name: 'dir/file3.txt', buffer: Buffer.from('File 3 in directory') },
    ];

    const zipBuffer = await compressionUtils.createZIPArchive(files);
    assert(zipBuffer.length > 0, 'ZIP archive should be created');
    assert(zipBuffer[0] === 0x50 && zipBuffer[1] === 0x4b, 'Should be valid ZIP (PK signature)');
  });

  test('Calculate Compression Ratio - accurate metrics', () => {
    const result = compressionUtils.calculateCompressionRatio(1000, 600);
    assert(result.ratio === 40, 'Ratio should be 40%');
    assert(result.savings === 400, 'Savings should be 400 bytes');
    assert(result.formatted.includes('40'), 'Formatted should contain ratio');
  });

  test('Format Bytes - correct conversion', () => {
    assert(compressionUtils.formatBytes(512).includes('Bytes'), 'Should show bytes');
    assert(compressionUtils.formatBytes(1024).includes('KB'), 'Should show KB');
    assert(compressionUtils.formatBytes(1048576).includes('MB'), 'Should show MB');
  });

  // ==================== HMAC TESTS ====================
  console.log('\n🔐 HMAC & INTEGRITY TESTS\n');

  test('Generate HMAC - produces hash', () => {
    const data = Buffer.from('Test data');
    const key = Buffer.from('secret-key');
    const hmac = encryptionUtils.generateHMAC(data, key);
    assert(hmac.length === 64, 'SHA256 HMAC should be 64 hex characters');
  });

  test('Verify HMAC - valid signature', () => {
    const data = Buffer.from('Test data');
    const key = Buffer.from('secret-key');
    const hmac = encryptionUtils.generateHMAC(data, key);
    const isValid = encryptionUtils.verifyHMAC(data, hmac, key);
    assert(isValid === true, 'Valid HMAC should verify');
  });

  test('Verify HMAC - invalid signature detection', () => {
    const data = Buffer.from('Test data');
    const key = Buffer.from('secret-key');
    const hmac = encryptionUtils.generateHMAC(data, key);
    const modifiedData = Buffer.from('Modified data');
    const isValid = encryptionUtils.verifyHMAC(modifiedData, hmac, key);
    assert(isValid === false, 'Invalid HMAC should fail verification');
  });

  // ==================== MASTER KEY STORAGE TESTS ====================
  console.log('\n🔑 MASTER KEY STORAGE TESTS\n');

  test('Encrypt Master Key for Storage - produces encrypted data', () => {
    const masterKey = Buffer.from('16-byte-test-key');
    const encrypted = encryptionUtils.encryptMasterKeyForStorage(masterKey);
    assert(typeof encrypted === 'string', 'Should return string');
    const parsed = JSON.parse(encrypted);
    assert(parsed.encrypted, 'Should contain encrypted data');
    assert(parsed.iv, 'Should contain IV');
    assert(parsed.authTag, 'Should contain auth tag');
  });

  test('Decrypt Master Key from Storage - recovers original', () => {
    const masterKey = Buffer.from('16-byte-test-key-for-storage');
    const encrypted = encryptionUtils.encryptMasterKeyForStorage(masterKey);
    const decrypted = encryptionUtils.decryptMasterKeyFromStorage(encrypted);
    assert(decrypted.equals(masterKey), 'Decrypted master key should match original');
  });

  // ==================== INTEGRATION TESTS ====================
  console.log('\n🔗 INTEGRATION TESTS\n');

  await asyncTest('End-to-End: Compress + Encrypt', async () => {
    const testData = Buffer.from('Important file content. '.repeat(100));
    const { fileKey } = encryptionUtils.generateFileKey(
      encryptionUtils.generateMasterKey('test').key
    );

    // Step 1: Compress
    const compressed = await compressionUtils.compressGZIP(testData);
    assert(compressed.length < testData.length, 'Compression should reduce size');

    // Step 2: Encrypt
    const encrypted = encryptionUtils.encryptFile(compressed, fileKey);
    assert(encrypted.encryptedData.length > 0, 'Encryption should produce data');

    // Step 3: Decrypt
    const decrypted = encryptionUtils.decryptFile(
      encrypted.encryptedData,
      fileKey,
      encrypted.iv,
      encrypted.authTag
    );

    // Step 4: Decompress
    const decompressed = await compressionUtils.decompressGZIP(decrypted);
    assert(decompressed.equals(testData), 'Original data should be recovered');
  });

  // ==================== TEST SUMMARY ====================
  console.log('\n=====================================\n');
  console.log('📊 TEST SUMMARY\n');
  console.log(`Total Tests:  ${totalTests}`);
  console.log(`✅ Passed:    ${passedTests}`);
  console.log(`❌ Failed:    ${failedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%\n`);

  if (failedTests === 0) {
    console.log('🎉 ALL TESTS PASSED! The system is ready.\n');
    process.exit(0);
  } else {
    console.log(`⚠️  ${failedTests} test(s) failed. Please review the errors above.\n`);
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error in test suite:', error);
  process.exit(1);
});
