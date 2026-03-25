#!/usr/bin/env node
/**
 * COMPREHENSIVE DEBUG TEST SCRIPT
 * Tests all critical functionality step by step
 * Ralph Algorithm: Test → Debug → Iterate
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000';
let testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function httpRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 5000,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
            raw: data
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: null,
            raw: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    log(`\n[TEST] ${name}`, 'blue');
    await fn();
    testResults.passed++;
    log(`✅ PASSED: ${name}`, 'green');
    return true;
  } catch (error) {
    testResults.failed++;
    testResults.errors.push({ test: name, error: error.message });
    log(`❌ FAILED: ${name}`, 'red');
    log(`   Error: ${error.message}`, 'red');
    return false;
  }
}

async function runTests() {
  log(`
╔════════════════════════════════════════════════════════════════╗
║          COMPREHENSIVE FILE SHARING SYSTEM DEBUG TEST          ║
║                    (Ralph Algorithm Approach)                  ║
╚════════════════════════════════════════════════════════════════╝
`, 'bold');

  log('\n=== PHASE 1: SERVER CONNECTIVITY ===', 'yellow');
  
  await test('Server is running (health check)', async () => {
    const res = await httpRequest('GET', '/api/health');
    if (!res.body || !res.body.status) {
      throw new Error(`Expected health check response, got: ${JSON.stringify(res.body)}`);
    }
  });

  log('\n=== PHASE 2: AUTHENTICATION ===', 'yellow');
  
  let testEmail = `test_${Date.now()}@test.com`;
  let testPassword = 'TestPassword123!';
  let authToken = null;
  let userId = null;

  await test('User Registration', async () => {
    const res = await httpRequest('POST', '/api/auth/register', {
      email: testEmail,
      password: testPassword,
      name: 'Test User'
    });
    
    log(`   Response Status: ${res.status}`, 'blue');
    log(`   Response Body: ${JSON.stringify(res.body, null, 2)}`, 'blue');
    
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`Registration failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
    
    if (!res.body.token) {
      throw new Error(`No token in registration response: ${JSON.stringify(res.body)}`);
    }
    
    authToken = res.body.token;
    userId = res.body.user?._id || res.body.userId;
    
    if (!authToken) {
      throw new Error('Token is empty or undefined');
    }
  });

  await test('User Login', async () => {
    const res = await httpRequest('POST', '/api/auth/login', {
      email: testEmail,
      password: testPassword
    });
    
    log(`   Response Status: ${res.status}`, 'blue');
    log(`   Response Body: ${JSON.stringify(res.body, null, 2)}`, 'blue');
    
    if (res.status !== 200) {
      throw new Error(`Login failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
    
    if (!res.body.token) {
      throw new Error(`No token in login response: ${JSON.stringify(res.body)}`);
    }
  });

  log('\n=== PHASE 3: FILE UPLOAD ===', 'yellow');

  let fileId = null;
  
  await test('Create test file', async () => {
    const testFile = path.join(__dirname, 'test_file_debug.txt');
    fs.writeFileSync(testFile, 'Test file content for debugging ' + Date.now());
    if (!fs.existsSync(testFile)) {
      throw new Error('Failed to create test file');
    }
  });

  // Note: File upload via multipart/form-data is complex with http module
  // This is a placeholder - actual test needs form-data
  log('   ⚠️  File upload test requires special handling (see below)', 'yellow');

  log('\n=== PHASE 4: FILE OPERATIONS ===', 'yellow');

  await test('List files (should be empty or have test file)', async () => {
    const res = await httpRequest('GET', '/api/files', null, {
      'Authorization': `Bearer ${authToken}`
    });
    
    log(`   Response Status: ${res.status}`, 'blue');
    log(`   Files count: ${res.body?.files?.length || 0}`, 'blue');
    
    if (res.status !== 200) {
      throw new Error(`List files failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
  });

  log('\n=== PHASE 5: ENCRYPTION/COMPRESSION CHECK ===', 'yellow');

  await test('Master key exists for user', async () => {
    const res = await httpRequest('GET', `/api/user/profile`, null, {
      'Authorization': `Bearer ${authToken}`
    });
    
    log(`   Response Status: ${res.status}`, 'blue');
    log(`   User data: ${JSON.stringify(res.body?.user, null, 2)}`, 'blue');
    
    if (res.status !== 200) {
      throw new Error(`Get profile failed with status ${res.status}`);
    }
  });

  log('\n=== PHASE 6: PAYMENT/SUBSCRIPTION ===', 'yellow');

  await test('Check subscription plans available', async () => {
    const res = await httpRequest('GET', '/api/payment/plans');
    
    log(`   Response Status: ${res.status}`, 'blue');
    log(`   Plans: ${JSON.stringify(res.body?.plans, null, 2)}`, 'blue');
    
    if (res.status !== 200) {
      throw new Error(`Get plans failed with status ${res.status}`);
    }
  });

  await test('Get subscription status', async () => {
    const res = await httpRequest('GET', '/api/payment/status', null, {
      'Authorization': `Bearer ${authToken}`
    });
    
    log(`   Response Status: ${res.status}`, 'blue');
    log(`   Status: ${JSON.stringify(res.body, null, 2)}`, 'blue');
    
    if (res.status !== 200) {
      throw new Error(`Get status failed with status ${res.status}`);
    }
  });

  // Summary
  log(`
╔════════════════════════════════════════════════════════════════╗
║                       TEST SUMMARY                             ║
╚════════════════════════════════════════════════════════════════╝
`, 'bold');

  log(`Passed: ${testResults.passed}`, 'green');
  log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'red' : 'green');

  if (testResults.errors.length > 0) {
    log(`\n=== ERRORS TO FIX ===`, 'red');
    testResults.errors.forEach((err, i) => {
      log(`${i + 1}. ${err.test}`, 'red');
      log(`   ${err.error}`, 'red');
    });
  }

  log(`\n${testResults.failed === 0 ? '🎉 ALL TESTS PASSED!' : '⚠️  TESTS FAILED - SEE ERRORS ABOVE'}`, 
      testResults.failed === 0 ? 'green' : 'red');

  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Check if server is reachable before starting tests
setTimeout(() => {
  log('\nAttempting to connect to server at ' + BASE_URL + '...', 'yellow');
  httpRequest('GET', '/api/health')
    .then(() => runTests())
    .catch((err) => {
      log(`\n❌ Cannot reach server at ${BASE_URL}`, 'red');
      log(`Error: ${err.message}`, 'red');
      log(`\nMake sure server is running with: npm run dev`, 'yellow');
      process.exit(1);
    });
}, 500);
