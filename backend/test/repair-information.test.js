const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const createRouter = require('../routes/repair-information');

const note = {
  note_id: 9, repair_id: 7, body: 'Screen replacement required', is_public: 0,
  created_at: '2026-11-13T12:00:00.000Z', updated_at: null,
};

// Requests still go through Express, including JSON parsing and validation.
function database(steps = [], failure = {}) {
  const events = [];
  const calls = [];
  const conn = {
    async beginTransaction() {
      events.push('begin');
      if (failure.begin) throw failure.begin;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      const expected = steps.shift();
      assert.ok(expected, `Unexpected query: ${sql}`);
      assert.match(sql, expected.sql);
      if (expected.params) assert.deepEqual(params, expected.params);
      if (expected.error) throw expected.error;
      return [expected.result];
    },
    async commit() {
      events.push('commit');
      if (failure.commit) throw failure.commit;
    },
    async rollback() {
      events.push('rollback');
      if (failure.rollback) throw failure.rollback;
    },
    release() { events.push('release'); },
  };
  return {
    events, calls,
    async getConnection() {
      events.push('acquire');
      if (failure.acquire) throw failure.acquire;
      return conn;
    },
    query: conn.query,
    verify() { assert.equal(steps.length, 0, 'Expected database queries were not executed'); },
  };
}

async function client(t, db) {
  const app = express();
  const logs = [];
  app.use(createRouter(db, { error: (...args) => logs.push(args) }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return {
    logs,
    async request(method, path, body, raw = false) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { 'Content-Type': 'application/json', Connection: 'close' },
        ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

const lockedRepair = { sql: /SELECT repair_id, diagnosis .* FOR UPDATE$/, params: [7], result: [{ repair_id: 7, diagnosis: null }] };
const history = (type, details) => ({ sql: /^INSERT INTO edit_history .* VALUES \(\?, \?, \?\)$/, params: [7, type, details], result: { affectedRows: 1 } });
const readNote = row => ({ sql: /^SELECT .* FROM note WHERE note_id = \?$/, params: [9], result: [row] });
const committed = ['acquire', 'begin', 'commit', 'release'];
const rolledBack = ['acquire', 'begin', 'rollback', 'release'];

test('create an internal note, persist history, and return canonical database fields', async t => {
  const db = database([
    lockedRepair,
    { sql: /^INSERT INTO note .* VALUES \(\?, \?, \?\)$/, params: [7, note.body, false], result: { insertId: 9 } },
    history('Note', 'Note 9 added'), readNote(note),
  ]);
  const api = await client(t, db);
  const response = await api.request('POST', '/repairs/7/notes', { body: `  ${note.body}  `, is_public: false });
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { ...note, is_public: false });
  assert.deepEqual(db.events, committed);
  db.verify();
});

test('default public visibility matches schema; SQL-looking text stays a parameter', async t => {
  const body = "'; DROP TABLE note; --";
  const db = database([
    lockedRepair,
    { sql: /^INSERT INTO note/, params: [7, body, true], result: { insertId: 9 } },
    history('Note', 'Note 9 added'), readNote({ ...note, body, is_public: 1 }),
  ]);
  const api = await client(t, db);
  const response = await api.request('POST', '/repairs/7/notes', { body });
  assert.equal(response.status, 201);
  assert.equal(response.body.is_public, true);
  assert.ok(db.calls.every(call => !call.sql.includes(body)));
  db.verify();
});

for (const [path, body] of [
  ['/repairs/0/notes', { body: 'x' }], ['/repairs/-1/notes', { body: 'x' }],
  ['/repairs/1abc/notes', { body: 'x' }], ['/repairs/2147483648/notes', { body: 'x' }],
  ['/repairs/7/notes', {}], ['/repairs/7/notes', { body: '  ' }],
  ['/repairs/7/notes', { body: 12 }], ['/repairs/7/notes', { body: 'x', is_public: 'false' }],
  ['/repairs/7/notes', { body: 'x', repair_id: 8 }], ['/repairs/7/notes', []],
  ['/repairs/7/notes', { body: '😀'.repeat(16384) }],
]) {
  test(`invalid note request rejected before database access: ${path} ${JSON.stringify(body).slice(0, 70)}`, async t => {
    const db = database();
    const api = await client(t, db);
    const response = await api.request('POST', path, body);
    assert.equal(response.status, 400);
    assert.deepEqual(db.events, []);
    assert.equal(db.calls.length, 0);
  });
}

test('missing repair returns 404 and inserts nothing', async t => {
  const db = database([{ ...lockedRepair, result: [] }]);
  const api = await client(t, db);
  assert.deepEqual(await api.request('POST', '/repairs/7/notes', { body: 'x' }), {
    status: 404, body: { error: 'Repair not found' },
  });
  assert.deepEqual(db.events, rolledBack);
  db.verify();
});

test('note insert failure rolls back without attempting history', async t => {
  const db = database([lockedRepair, { sql: /^INSERT INTO note/, error: new Error('failure') }]);
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/notes', { body: 'x' })).status, 500);
  assert.deepEqual(db.events, rolledBack);
  db.verify();
});

test('history failure after note insert rolls back, with no success response or private log data', async t => {
  const db = database([
    lockedRepair, { sql: /^INSERT INTO note/, result: { insertId: 9 } },
    { sql: /^INSERT INTO edit_history/, error: new Error('private SQL details') },
  ]);
  const api = await client(t, db);
  assert.deepEqual(await api.request('POST', '/repairs/7/notes', { body: 'private note' }), {
    status: 500, body: { error: 'Could not create note' },
  });
  assert.deepEqual(db.events, rolledBack);
  assert.ok(!JSON.stringify(api.logs).includes('private'));
  db.verify();
});

test('connection acquisition failure is handled without trying release or rollback', async t => {
  const db = database([], { acquire: new Error('offline') });
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/notes', { body: 'x' })).status, 500);
  assert.deepEqual(db.events, ['acquire']);
});

test('begin failure releases acquired connection', async t => {
  const db = database([], { begin: new Error('offline') });
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/notes', { body: 'x' })).status, 500);
  assert.deepEqual(db.events, ['acquire', 'begin', 'release']);
});

test('commit failure attempts rollback and releases connection', async t => {
  const db = database([
    lockedRepair, { sql: /^INSERT INTO note/, result: { insertId: 9 } },
    history('Note', 'Note 9 added'), readNote(note),
  ], { commit: new Error('commit failed') });
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/notes', { body: 'x' })).status, 500);
  assert.deepEqual(db.events, ['acquire', 'begin', 'commit', 'rollback', 'release']);
  db.verify();
});

test('rollback failure still releases connection and returns generic error', async t => {
  const db = database([{ ...lockedRepair, error: new Error('query failed') }], { rollback: new Error('rollback failed') });
  const api = await client(t, db);
  assert.deepEqual(await api.request('POST', '/repairs/7/notes', { body: 'x' }), {
    status: 500, body: { error: 'Could not create note' },
  });
  assert.deepEqual(db.events, rolledBack);
});

test('list notes scopes by repair, orders deterministically, and returns JSON booleans', async t => {
  const db = database([
    { sql: /^SELECT repair_id FROM repair_order WHERE repair_id = \?$/, params: [7], result: [{ repair_id: 7 }] },
    { sql: /FROM note WHERE repair_id = \? ORDER BY created_at ASC, note_id ASC$/, params: [7], result: [note] },
  ]);
  const api = await client(t, db);
  assert.deepEqual(await api.request('GET', '/repairs/7/notes'), { status: 200, body: [{ ...note, is_public: false }] });
  db.verify();
});

test('existing repair with no notes returns an empty array', async t => {
  const db = database([
    { sql: /^SELECT repair_id FROM repair_order/, result: [{ repair_id: 7 }] },
    { sql: /FROM note WHERE repair_id/, result: [] },
  ]);
  const api = await client(t, db);
  assert.deepEqual(await api.request('GET', '/repairs/7/notes'), { status: 200, body: [] });
  db.verify();
});

test('unknown repair note list returns 404', async t => {
  const db = database([{ sql: /^SELECT repair_id FROM repair_order/, result: [] }]);
  const api = await client(t, db);
  assert.equal((await api.request('GET', '/repairs/7/notes')).status, 404);
  db.verify();
});

test('edit note body while preserving visibility and recording history', async t => {
  const db = database([
    { sql: /FROM note WHERE note_id = \? FOR UPDATE$/, params: [9], result: [note] },
    { sql: /^UPDATE note SET body = \?, is_public = \? WHERE note_id = \?$/, params: ['New assessment', false, 9], result: { affectedRows: 1 } },
    history('Note', 'Note 9 updated'), readNote({ ...note, body: 'New assessment', updated_at: '2026-11-13T13:00:00.000Z' }),
  ]);
  const api = await client(t, db);
  const response = await api.request('PATCH', '/notes/9', { body: 'New assessment' });
  assert.equal(response.status, 200);
  assert.equal(response.body.body, 'New assessment');
  assert.equal(response.body.is_public, false);
  assert.equal(response.body.updated_at, '2026-11-13T13:00:00.000Z');
  assert.deepEqual(db.events, committed);
  db.verify();
});

test('edit visibility without replacing note text', async t => {
  const db = database([
    { sql: /FROM note WHERE note_id = \? FOR UPDATE$/, result: [note] },
    { sql: /^UPDATE note/, params: [note.body, true, 9], result: { affectedRows: 1 } },
    history('Note', 'Note 9 updated'), readNote({ ...note, is_public: 1 }),
  ]);
  const api = await client(t, db);
  assert.equal((await api.request('PATCH', '/notes/9', { is_public: true })).body.is_public, true);
  db.verify();
});

test('identical note edit does not change timestamps or create duplicate history', async t => {
  const db = database([{ sql: /FROM note .* FOR UPDATE$/, result: [note] }]);
  const api = await client(t, db);
  assert.equal((await api.request('PATCH', '/notes/9', { body: note.body })).status, 200);
  assert.deepEqual(db.events, committed);
  db.verify();
});

test('unknown note edit returns 404', async t => {
  const db = database([{ sql: /FROM note .* FOR UPDATE$/, result: [] }]);
  const api = await client(t, db);
  assert.equal((await api.request('PATCH', '/notes/9', { body: 'x' })).status, 404);
  assert.deepEqual(db.events, rolledBack);
});

for (const body of [{}, { body: '' }, { is_public: 0 }, { repair_id: 8 }]) {
  test(`invalid note edit: ${JSON.stringify(body)}`, async t => {
    const db = database();
    const api = await client(t, db);
    assert.equal((await api.request('PATCH', '/notes/9', body)).status, 400);
    assert.deepEqual(db.events, []);
  });
}

test('diagnosis update records history and returns repair ID', async t => {
  const db = database([
    lockedRepair,
    { sql: /^UPDATE repair_order SET diagnosis = \? WHERE repair_id = \?$/, params: ['Faulty speaker', 7], result: { affectedRows: 1 } },
    history('Diagnosis', 'Diagnosis updated'),
  ]);
  const api = await client(t, db);
  assert.deepEqual(await api.request('PATCH', '/repairs/7/diagnosis', { diagnosis: ' Faulty speaker ' }), {
    status: 200, body: { repair_id: 7, diagnosis: 'Faulty speaker' },
  });
  assert.deepEqual(db.events, committed);
  db.verify();
});

test('explicit null clears diagnosis and records a neutral history entry', async t => {
  const db = database([
    { ...lockedRepair, result: [{ repair_id: 7, diagnosis: 'Old diagnosis' }] },
    { sql: /^UPDATE repair_order/, params: [null, 7], result: { affectedRows: 1 } },
    history('Diagnosis', 'Diagnosis cleared'),
  ]);
  const api = await client(t, db);
  assert.deepEqual(await api.request('PATCH', '/repairs/7/diagnosis', { diagnosis: null }), {
    status: 200, body: { repair_id: 7, diagnosis: null },
  });
  db.verify();
});

test('identical diagnosis is a no-op without duplicate history', async t => {
  const db = database([lockedRepair]);
  const api = await client(t, db);
  assert.equal((await api.request('PATCH', '/repairs/7/diagnosis', { diagnosis: null })).status, 200);
  assert.deepEqual(db.events, committed);
  db.verify();
});

test('unknown diagnosis repair returns 404', async t => {
  const db = database([{ ...lockedRepair, result: [] }]);
  const api = await client(t, db);
  assert.equal((await api.request('PATCH', '/repairs/7/diagnosis', { diagnosis: 'x' })).status, 404);
  assert.deepEqual(db.events, rolledBack);
});

test('diagnosis history failure rolls back the diagnosis update', async t => {
  const db = database([
    lockedRepair, { sql: /^UPDATE repair_order/, result: { affectedRows: 1 } },
    { sql: /^INSERT INTO edit_history/, error: new Error('history unavailable') },
  ]);
  const api = await client(t, db);
  assert.equal((await api.request('PATCH', '/repairs/7/diagnosis', { diagnosis: 'x' })).status, 500);
  assert.deepEqual(db.events, rolledBack);
  db.verify();
});

for (const body of [{}, { diagnosis: '' }, { diagnosis: ' ' }, { diagnosis: false }, { diagnosis: 'x', status: 'Done' }, { diagnosis: '😀'.repeat(16384) }]) {
  test(`invalid diagnosis request: ${JSON.stringify(body).slice(0, 65)}`, async t => {
    const db = database();
    const api = await client(t, db);
    assert.equal((await api.request('PATCH', '/repairs/7/diagnosis', body)).status, 400);
    assert.deepEqual(db.events, []);
  });
}

test('read nullable diagnosis for a known repair', async t => {
  const db = database([{ sql: /^SELECT repair_id, diagnosis FROM repair_order WHERE repair_id = \?$/, params: [7], result: [{ repair_id: 7, diagnosis: null }] }]);
  const api = await client(t, db);
  assert.deepEqual(await api.request('GET', '/repairs/7/diagnosis'), { status: 200, body: { repair_id: 7, diagnosis: null } });
  db.verify();
});

test('unknown diagnosis read returns 404', async t => {
  const db = database([{ sql: /^SELECT repair_id, diagnosis FROM repair_order/, result: [] }]);
  const api = await client(t, db);
  assert.equal((await api.request('GET', '/repairs/7/diagnosis')).status, 404);
});

test('read query failures return generic JSON errors', async t => {
  const db = database([{ sql: /^SELECT repair_id, diagnosis/, error: new Error('private query details') }]);
  const api = await client(t, db);
  assert.deepEqual(await api.request('GET', '/repairs/7/diagnosis'), { status: 500, body: { error: 'Could not load diagnosis' } });
});

test('malformed JSON returns 400 without database access', async t => {
  const db = database();
  const api = await client(t, db);
  assert.deepEqual(await api.request('POST', '/repairs/7/notes', '{broken', true), { status: 400, body: { error: 'Invalid JSON' } });
  assert.deepEqual(db.events, []);
});

test('oversized JSON returns 413 without database access', async t => {
  const db = database();
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/notes', { body: 'x'.repeat(110000) })).status, 413);
  assert.deepEqual(db.events, []);
});
