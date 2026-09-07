import { createServer } from '../src/index';
import fs from 'node:fs';
import path from 'node:path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runAllTests() {
  console.log('🧪 Starting Reverse Logger Test Suite...\n');

  const testDbDir = path.join(process.cwd(), '.test-dbs');
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
  }

  // --- Test Suite 1: Core API & Response Schema ---
  {
    console.log('1. Testing Core API & Response Schema...');
    const dbPath = path.join(testDbDir, 'test1.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const port = 5101;
    const server = createServer({ port, maxLogs: 100, dbPath });
    await server.listen(port);

    const postRes = await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'info',
        message: 'System started',
        args: ['System started', { env: 'production' }],
        url: 'http://app.local/home',
        sessionId: 'sess_123',
      }),
    });
    assert(postRes.status === 200, 'POST /api/logs status should be 200');

    const getRes = await fetch(`http://127.0.0.1:${port}/api/logs`);
    assert(getRes.status === 200, 'GET /api/logs status should be 200');

    const data = await getRes.json();
    assert(Array.isArray(data.logs), 'data.logs should be an array');
    assert(typeof data.total === 'number', 'data.total should be a number');
    assert(data.limit === 20, 'data.limit should default to 20');
    assert(data.offset === 0, 'data.offset should default to 0');
    assert(data.logs.length === 1, 'data.logs should contain 1 record');
    assert(data.logs[0].sessionId === 'sess_123', 'sessionId should be preserved');
    assert(typeof data.logs[0].timestamp === 'string', 'timestamp should be ISO string');

    await server.close();
    console.log('   ✓ Core API & Schema OK');
  }

  // --- Test Suite 2: Search, Level, URL & Combined Filters ---
  {
    console.log('2. Testing Search, Level, URL & Combined Filters...');
    const dbPath = path.join(testDbDir, 'test2.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const port = 5102;
    const server = createServer({ port, maxLogs: 100, dbPath });
    await server.listen(port);

    // Seed test logs
    await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'error', args: ['Database failure'], url: 'http://example.com/db' }),
    });
    await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'warn', args: ['Auth token expiring'], url: 'http://example.com/auth' }),
    });
    await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'error', args: ['Auth failed password'], url: 'http://example.com/auth' }),
    });

    // Level filter
    const levelRes = await fetch(`http://127.0.0.1:${port}/api/logs?level=error`);
    const levelData = await levelRes.json();
    assert(levelData.total === 2, `Expected 2 error logs, got ${levelData.total}`);

    // Search filter
    const searchRes = await fetch(`http://127.0.0.1:${port}/api/logs?search=Database`);
    const searchData = await searchRes.json();
    assert(searchData.total === 1, `Expected 1 search match, got ${searchData.total}`);

    // URL filter
    const urlRes = await fetch(`http://127.0.0.1:${port}/api/logs?url=auth`);
    const urlData = await urlRes.json();
    assert(urlData.total === 2, `Expected 2 URL matches for auth, got ${urlData.total}`);

    // Combined filter
    const combinedRes = await fetch(`http://127.0.0.1:${port}/api/logs?q=auth&level=error&url=example.com`);
    const combinedData = await combinedRes.json();
    assert(combinedData.total === 1, `Expected 1 log matching combined filter, got ${combinedData.total}`);
    assert(combinedData.logs[0].args[0].includes('Auth failed'), 'Combined filter matched wrong entry');

    await server.close();
    console.log('   ✓ Search, Level, URL & Combined Filters OK');
  }

  // --- Test Suite 3: Pagination & Time Ranges ---
  {
    console.log('3. Testing Pagination & ISO Time Ranges...');
    const dbPath = path.join(testDbDir, 'test3.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const port = 5103;
    const server = createServer({ port, maxLogs: 100, dbPath });
    await server.listen(port);

    const t1 = new Date('2026-01-01T10:00:00.000Z').toISOString();
    const t2 = new Date('2026-01-01T12:00:00.000Z').toISOString();
    const t3 = new Date('2026-01-01T14:00:00.000Z').toISOString();

    await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: t1, level: 'info', args: ['Event 1'] }),
    });
    await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: t2, level: 'info', args: ['Event 2'] }),
    });
    await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: t3, level: 'info', args: ['Event 3'] }),
    });

    // Pagination limit & offset
    const pageRes = await fetch(`http://127.0.0.1:${port}/api/logs?limit=2&offset=1`);
    const pageData = await pageRes.json();
    assert(pageData.logs.length === 2, `Expected limit 2 logs, got ${pageData.logs.length}`);
    assert(pageData.total === 3, `Expected total 3 logs, got ${pageData.total}`);
    assert(pageData.offset === 1, `Expected offset 1, got ${pageData.offset}`);

    // Time range filtering from/to
    const rangeRes = await fetch(`http://127.0.0.1:${port}/api/logs?from=2026-01-01T11:00:00.000Z&to=2026-01-01T13:00:00.000Z`);
    const rangeData = await rangeRes.json();
    assert(rangeData.total === 1, `Expected 1 log in time range, got ${rangeData.total}`);
    assert(rangeData.logs[0].args[0] === 'Event 2', 'Time range matched wrong event');

    await server.close();
    console.log('   ✓ Pagination & Time Ranges OK');
  }

  // --- Test Suite 4: Token Authentication ---
  {
    console.log('4. Testing Optional Token Authentication...');
    const dbPath = path.join(testDbDir, 'test4.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const port = 5104;
    const token = 'secret_token_123';
    const server = createServer({ port, token, dbPath });
    await server.listen(port);

    // Public endpoint: script should succeed without token
    const scriptRes = await fetch(`http://127.0.0.1:${port}/script/client.js`);
    assert(scriptRes.status === 200, 'GET /script/client.js should remain public');

    // API without token: should fail with 401
    const unauthGet = await fetch(`http://127.0.0.1:${port}/api/logs`);
    assert(unauthGet.status === 401, `Unauthenticated GET /api/logs should return 401, got ${unauthGet.status}`);

    const unauthPost = await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'info', args: ['test'] }),
    });
    assert(unauthPost.status === 401, `Unauthenticated POST /api/logs should return 401, got ${unauthPost.status}`);

    // API with Bearer token: should succeed
    const authPost = await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ level: 'info', args: ['authenticated log'] }),
    });
    assert(authPost.status === 200, `Bearer authenticated POST should return 200, got ${authPost.status}`);

    // API with URL query token: should succeed
    const queryGet = await fetch(`http://127.0.0.1:${port}/api/logs?token=${token}`);
    assert(queryGet.status === 200, `Query token GET should return 200, got ${queryGet.status}`);
    const queryData = await queryGet.json();
    assert(queryData.total === 1, 'Should return 1 authenticated log');

    await server.close();
    console.log('   ✓ Optional Token Authentication OK');
  }

  // --- Test Suite 5: CORS Preflight & Headers ---
  {
    console.log('5. Testing CORS Preflight & Headers...');
    const dbPath = path.join(testDbDir, 'test5.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const port = 5105;
    const server = createServer({ port, dbPath });
    await server.listen(port);

    const optionsRes = await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://another-domain.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    assert(optionsRes.status === 200 || optionsRes.status === 204, 'CORS OPTIONS should succeed');
    const allowOrigin = optionsRes.headers.get('access-control-allow-origin');
    assert(allowOrigin !== null, 'Access-Control-Allow-Origin header should be present');

    await server.close();
    console.log('   ✓ CORS Preflight & Headers OK');
  }

  // --- Test Suite 6: Database Retention Limit ---
  {
    console.log('6. Testing Database Retention Limit (--max-logs)...');
    const dbPath = path.join(testDbDir, 'test6.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const port = 5106;
    const server = createServer({ port, maxLogs: 5, dbPath });
    await server.listen(port);

    for (let i = 1; i <= 10; i++) {
      await fetch(`http://127.0.0.1:${port}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'info', args: [`Message #${i}`] }),
      });
    }

    const res = await fetch(`http://127.0.0.1:${port}/api/logs?limit=50`);
    const data = await res.json();
    assert(data.total === 5, `Expected total logs truncated to 5, got ${data.total}`);

    await server.close();
    console.log('   ✓ Database Retention Limit OK');
  }

  // --- Test Suite 7: Malformed Payload Handling ---
  {
    console.log('7. Testing Malformed Payload Handling...');
    const dbPath = path.join(testDbDir, 'test7.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const port = 5107;
    const server = createServer({ port, dbPath });
    await server.listen(port);

    const badRes = await fetch(`http://127.0.0.1:${port}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json-body',
    });

    assert(badRes.status === 400, `Malformed JSON should return 400 Bad Request, got ${badRes.status}`);

    await server.close();
    console.log('   ✓ Malformed Payload Handling OK');
  }

  // Clean test databases
  try {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log('\n🎉 ALL 7 TEST SUITES PASSED CLEANLY!\n');
}

runAllTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
