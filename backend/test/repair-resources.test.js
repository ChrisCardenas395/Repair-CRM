const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const sharp = require('sharp');
const createRouter = require('../routes/repair-resources');

const part = { part_id: 9, repair_id: 7, part_name: 'Speaker', status: 'Needed', quantity: 1 };
const filename = 'a'.repeat(48) + '.webp';
const photo = { photo_id: 9, repair_id: 7, image_url: '/photos/files/' + filename, date_added: '2026-11-18T12:00:00.000Z' };
const parent = { sql: /^SELECT repair_id FROM repair_order WHERE repair_id = \? FOR UPDATE$/, params: [7], result: [{ repair_id: 7 }] };
const history = (type, action) => ({ sql: /^INSERT INTO edit_history/, params: [7, type, `${type} 9 ${action}`], result: { affectedRows: 1 } });

// Keep database failures predictable while sending real HTTP requests through Express.
function database(steps = [], failure = {}) {
  const events = [];
  const calls = [];
  const conn = {
    async beginTransaction() { events.push('begin'); if (failure.begin) throw failure.begin; },
    async query(sql, params) {
      calls.push({ sql, params });
      const step = steps.shift();
      assert.ok(step, `Unexpected query: ${sql}`);
      assert.match(sql, step.sql);
      if (step.params) assert.deepEqual(params, step.params);
      if (step.check) step.check(sql, params);
      if (step.error) throw step.error;
      return [typeof step.result === 'function' ? step.result() : step.result];
    },
    async commit() { events.push('commit'); if (failure.commit) throw failure.commit; },
    async rollback() { events.push('rollback'); if (failure.rollback) throw failure.rollback; },
    release() { events.push('release'); },
    destroy() { events.push('destroy'); },
  };
  return {
    events, calls, query: conn.query,
    async getConnection() { events.push('acquire'); if (failure.acquire) throw failure.acquire; return conn; },
    verify() { assert.equal(steps.length, 0, 'Some expected queries were not executed'); },
  };
}
// Give each test its own upload folder and HTTP server, then clean both up.
async function client(t, db, options = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'repair-photo-test-'));
  const logs = [];
  const app = express();
  app.use(createRouter(db, { uploadDir: folder, logger: { error: (...args) => logs.push(args) }, ...options }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(folder, { recursive: true, force: true });
  });
  async function send(method, url, body, multipart = false) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { Connection: 'close', ...(multipart || body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: multipart || typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const data = await response.arrayBuffer();
    return { status: response.status, headers: response.headers, body: data.byteLength ? (response.headers.get('content-type') || '').includes('application/json') ? JSON.parse(Buffer.from(data).toString()) : Buffer.from(data) : null };
  }
  return { folder, logs, request: send, upload: (body, id = 7) => send('POST', `/repairs/${id}/photos`, body, true) };
}
// Build a small real image so uploads exercise the image decoder too.
async function image(format = 'png') {
  return sharp({ create: { width: 3, height: 2, channels: 3, background: '#225588' } }).toFormat(format).toBuffer();
}
// Include an unsafe filename to check that storage uses a generated name.
function form(buffer, type = 'image/png', field = 'photo', name = '../../untrusted.png') {
  const body = new FormData();
  body.append(field, new Blob([buffer], { type }), name);
  return body;
}
const committed = ['acquire', 'begin', 'commit', 'release'];
const rolledBack = ['acquire', 'begin', 'rollback', 'release'];

for (const [resource, table, order] of [['history', 'edit_history', 'changed_at ASC, history_id ASC'], ['parts', 'part', 'part_id ASC'], ['photos', 'repair_photo', 'date_added ASC, photo_id ASC']]) {
  test(`read ${resource} for one repair in stable order`, async t => {
    const db = database([
      { sql: /^SELECT repair_id FROM repair_order WHERE repair_id = \?$/, params: [7], result: [{ repair_id: 7 }] },
      { sql: new RegExp(`FROM ${table} WHERE repair_id = \\? ORDER BY ${order}$`), params: [7], result: [] },
    ]);
    const api = await client(t, db);
    const response = await api.request('GET', `/repairs/7/${resource}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
    db.verify();
  });
  test(`unknown repair returns 404 for ${resource}`, async t => {
    const db = database([{ sql: /^SELECT repair_id FROM repair_order/, result: [] }]);
    const api = await client(t, db);
    assert.equal((await api.request('GET', `/repairs/7/${resource}`)).status, 404);
    db.verify();
  });
}

test('create part with database-compatible defaults and matching history', async t => {
  const db = database([
    parent, { sql: /^INSERT INTO part/, params: [7, 'Speaker', 'Needed', 1], result: { insertId: 9 } },
    history('Part', 'added'), { sql: /^SELECT .* FROM part WHERE part_id = \?$/, params: [9], result: [part] },
  ]);
  const api = await client(t, db);
  const response = await api.request('POST', '/repairs/7/parts', { part_name: ' Speaker ' });
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, part);
  assert.deepEqual(db.events, committed);
  db.verify();
});

test('create part with an explicit status and quantity', async t => {
  const db = database([
    parent, { sql: /^INSERT INTO part/, params: [7, 'Screen', 'Ordered', 2], result: { insertId: 9 } },
    history('Part', 'added'), { sql: /^SELECT .* FROM part/, result: [{ ...part, part_name: 'Screen', status: 'Ordered', quantity: 2 }] },
  ]);
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/parts', { part_name: 'Screen', status: 'Ordered', quantity: 2 })).status, 201);
  db.verify();
});

for (const [label, body] of [
  ['missing name', {}], ['blank name', { part_name: ' ' }], ['numeric name', { part_name: 3 }],
  ['long name', { part_name: 'x'.repeat(101) }], ['unknown status', { part_name: 'x', status: 'Done' }],
  ['zero quantity', { part_name: 'x', quantity: 0 }], ['negative quantity', { part_name: 'x', quantity: -1 }],
  ['fractional quantity', { part_name: 'x', quantity: 1.5 }], ['string quantity', { part_name: 'x', quantity: '1' }],
  ['large quantity', { part_name: 'x', quantity: 2147483648 }], ['unknown field', { part_name: 'x', repair_id: 5 }],
  ['array body', []],
]) {
  test(`invalid part: ${label}`, async t => {
    const db = database();
    const api = await client(t, db);
    assert.equal((await api.request('POST', '/repairs/7/parts', body)).status, 400);
    assert.deepEqual(db.calls, []);
    assert.deepEqual(db.events, []);
  });
}

test('partial part update preserves omitted fields', async t => {
  const db = database([
    { sql: /^SELECT .* FROM part .* FOR UPDATE$/, params: [9], result: [part] },
    { sql: /^UPDATE part/, params: ['Speaker', 'Installed', 1, 9], result: { affectedRows: 1 } }, history('Part', 'updated'),
  ]);
  const api = await client(t, db);
  assert.deepEqual((await api.request('PATCH', '/parts/9', { status: 'Installed' })).body, { ...part, status: 'Installed' });
  assert.deepEqual(db.events, committed);
  db.verify();
});

test('unchanged part does not add history', async t => {
  const db = database([{ sql: /^SELECT .* FROM part .* FOR UPDATE$/, result: [part] }]);
  const api = await client(t, db);
  assert.equal((await api.request('PATCH', '/parts/9', { status: 'Needed' })).status, 200);
  db.verify();
});

test('empty part patch is rejected before database access', async t => {
  const db = database();
  const api = await client(t, db);
  assert.equal((await api.request('PATCH', '/parts/9', {})).status, 400);
  assert.deepEqual(db.events, []);
});

test('delete part and record history in the same transaction', async t => {
  const db = database([
    { sql: /^SELECT part_id, repair_id FROM part .* FOR UPDATE$/, params: [9], result: [part] },
    { sql: /^DELETE FROM part WHERE part_id = \?$/, params: [9], result: { affectedRows: 1 } }, history('Part', 'deleted'),
  ]);
  const api = await client(t, db);
  const response = await api.request('DELETE', '/parts/9');
  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assert.deepEqual(db.events, committed);
  db.verify();
});

for (const method of ['PATCH', 'DELETE']) {
  test(`${method} unknown part returns 404 and rolls back`, async t => {
    const db = database([{ sql: /FROM part .* FOR UPDATE$/, result: [] }]);
    const api = await client(t, db);
    assert.equal((await api.request(method, '/parts/9', method === 'PATCH' ? { quantity: 2 } : undefined)).status, 404);
    assert.deepEqual(db.events, rolledBack);
  });
}

test('part history failure causes rollback', async t => {
  const db = database([parent, { sql: /^INSERT INTO part/, result: { insertId: 9 } }, { sql: /^INSERT INTO edit_history/, error: new Error('history failed') }]);
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/parts', { part_name: 'Speaker' })).status, 500);
  assert.deepEqual(db.events, rolledBack);
  db.verify();
});

test('part connection failure is handled', async t => {
  const db = database([], { acquire: new Error('offline') });
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/parts', { part_name: 'Speaker' })).status, 500);
  assert.deepEqual(db.events, ['acquire']);
});

test('failed rollback destroys the connection instead of returning it to the pool', async t => {
  const db = database([{ ...parent, error: new Error('query failed') }], { rollback: new Error('rollback failed') });
  const api = await client(t, db);
  assert.equal((await api.request('POST', '/repairs/7/parts', { part_name: 'Speaker' })).status, 500);
  assert.deepEqual(db.events, ['acquire', 'begin', 'rollback', 'destroy']);
});

test('malformed part JSON returns a readable 400 error', async t => {
  const db = database();
  const api = await client(t, db);
  const response = await api.request('POST', '/repairs/7/parts', '{broken');
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid JSON' });
  assert.deepEqual(db.calls, []);
});

test('database errors return generic JSON without SQL details', async t => {
  const db = database([{ sql: /^SELECT repair_id/, error: new Error('private SQL details') }]);
  const api = await client(t, db);
  assert.deepEqual((await api.request('GET', '/repairs/7/history')).body, { error: 'Could not load history' });
  assert.ok(!JSON.stringify(api.logs).includes('private SQL'));
});

for (const format of ['png', 'jpeg', 'webp']) {
  test(`upload a real ${format} image, rewrite it, and ignore its original filename`, async t => {
    let imageUrl;
    const db = database([
      parent,
      { sql: /^INSERT INTO repair_photo/, check(sql, params) { assert.equal(params[0], 7); imageUrl = params[1]; assert.match(imageUrl, /^\/photos\/files\/[a-f0-9]{48}\.webp$/); }, result: { insertId: 9 } },
      history('Photo', 'added'), { sql: /^SELECT .* FROM repair_photo WHERE photo_id = \?$/, params: [9], result: () => [{ ...photo, image_url: imageUrl }] },
    ]);
    const api = await client(t, db);
    const response = await api.upload(form(await image(format), format === 'jpeg' ? 'image/jpeg' : `image/${format}`));
    assert.equal(response.status, 201);
    assert.equal(response.body.image_url, imageUrl);
    const names = await fs.readdir(api.folder);
    assert.equal(names.length, 1);
    assert.equal(names[0], imageUrl.split('/').pop());
    const metadata = await sharp(path.join(api.folder, names[0])).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 3);
    assert.deepEqual(db.events, committed);
    db.verify();
  });
}

for (const [label, buffer, type] of [
  ['fake PNG', Buffer.from('not an image'), 'image/png'],
  ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'],
  ['HTML', Buffer.from('<html>test</html>'), 'text/html'],
]) {
  test(`reject ${label} without storing a file`, async t => {
    const db = database();
    const api = await client(t, db);
    assert.equal((await api.upload(form(buffer, type))).status, 415);
    assert.deepEqual(await fs.readdir(api.folder), []);
    assert.deepEqual(db.calls, []);
  });
}

test('reject image with a mismatched declared MIME type', async t => {
  const db = database();
  const api = await client(t, db);
  assert.equal((await api.upload(form(await image('png'), 'image/jpeg'))).status, 415);
  assert.deepEqual(db.events, []);
});

test('reject photos larger than 5 MB before processing or database access', async t => {
  const db = database();
  const api = await client(t, db);
  assert.equal((await api.upload(form(Buffer.alloc(5 * 1024 * 1024 + 1)))).status, 413);
  assert.deepEqual(db.events, []);
});

test('reject highly compressed images above the pixel limit', async t => {
  const db = database();
  const api = await client(t, db);
  const buffer = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#225588' } }).png().toBuffer();
  assert.ok(buffer.length < 5 * 1024 * 1024);
  assert.equal((await api.upload(form(buffer))).status, 415);
  assert.deepEqual(db.calls, []);
  assert.deepEqual(await fs.readdir(api.folder), []);
});

test('reject missing upload and unexpected file fields', async t => {
  const db = database();
  const api = await client(t, db);
  assert.equal((await api.upload(new FormData())).status, 400);
  assert.equal((await api.upload(form(await image(), 'image/png', 'attachment'))).status, 400);
  assert.deepEqual(db.calls, []);
});

test('reject extra multipart text fields and multiple files', async t => {
  const db = database();
  const api = await client(t, db);
  const extra = form(await image());
  extra.append('repair_id', '8');
  assert.equal((await api.upload(extra)).status, 400);
  const two = form(await image());
  two.append('photo', new Blob([await image()], { type: 'image/png' }), 'second.png');
  assert.equal((await api.upload(two)).status, 400);
  assert.deepEqual(await fs.readdir(api.folder), []);
});

test('unknown repair photo upload stores no file', async t => {
  const db = database([{ ...parent, result: [] }]);
  const api = await client(t, db);
  assert.equal((await api.upload(form(await image()))).status, 404);
  assert.deepEqual(await fs.readdir(api.folder), []);
  assert.deepEqual(db.events, rolledBack);
});

test('photo history failure removes the new file and rolls back metadata', async t => {
  const db = database([parent, { sql: /^INSERT INTO repair_photo/, result: { insertId: 9 } }, { sql: /^INSERT INTO edit_history/, error: new Error('history failed') }]);
  const api = await client(t, db);
  assert.equal((await api.upload(form(await image()))).status, 500);
  assert.deepEqual(await fs.readdir(api.folder), []);
  assert.deepEqual(db.events, rolledBack);
  db.verify();
});

test('file storage failure rolls back without attempting a metadata insert', async t => {
  const db = database([parent]);
  const api = await client(t, db, { files: { ...fs, async writeFile() { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } } });
  assert.equal((await api.upload(form(await image()))).status, 500);
  assert.deepEqual(db.events, rolledBack);
  assert.deepEqual(await fs.readdir(api.folder), []);
  db.verify();
});

test('a lost commit reply keeps the file in case its metadata was committed', async t => {
  let url;
  const db = database([
    parent, { sql: /^INSERT INTO repair_photo/, check(sql, params) { url = params[1]; }, result: { insertId: 9 } },
    history('Photo', 'added'), { sql: /^SELECT .* FROM repair_photo/, result: () => [{ ...photo, image_url: url }] },
  ], { commit: new Error('reply lost') });
  const api = await client(t, db);
  assert.equal((await api.upload(form(await image()))).status, 500);
  assert.equal((await fs.readdir(api.folder)).length, 1);
  assert.deepEqual(db.events, ['acquire', 'begin', 'commit', 'rollback', 'release']);
});

test('serve a registered photo with an image response and private caching', async t => {
  const db = database([{ sql: /^SELECT photo_id FROM repair_photo WHERE image_url = \?$/, params: [photo.image_url], result: [{ photo_id: 9 }] }]);
  const api = await client(t, db);
  const buffer = await image('webp');
  await fs.writeFile(path.join(api.folder, filename), buffer);
  const response = await api.request('GET', photo.image_url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^image\/webp/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(response.body, buffer);
  db.verify();
});

test('unregistered and missing photo files return 404', async t => {
  const db = database([
    { sql: /^SELECT photo_id FROM repair_photo/, result: [] },
    { sql: /^SELECT photo_id FROM repair_photo/, result: [{ photo_id: 9 }] },
  ]);
  const api = await client(t, db);
  assert.equal((await api.request('GET', photo.image_url)).status, 404);
  assert.equal((await api.request('GET', photo.image_url)).status, 404);
  db.verify();
});

for (const name of ['not-a-photo.png', '..%2Fsecret.webp', 'a'.repeat(47) + '.webp']) {
  test(`unsafe photo filename is rejected: ${name}`, async t => {
    const db = database();
    const api = await client(t, db);
    assert.equal((await api.request('GET', '/photos/files/' + name)).status, 404);
    assert.deepEqual(db.calls, []);
  });
}

test('delete photo metadata and history before removing the file', async t => {
  const db = database([
    { sql: /^SELECT .* FROM repair_photo .* FOR UPDATE$/, params: [9], result: [photo] },
    { sql: /^DELETE FROM repair_photo WHERE photo_id = \?$/, params: [9], result: { affectedRows: 1 } }, history('Photo', 'deleted'),
  ]);
  const api = await client(t, db);
  await fs.writeFile(path.join(api.folder, filename), await image('webp'));
  assert.equal((await api.request('DELETE', '/photos/9')).status, 204);
  assert.deepEqual(await fs.readdir(api.folder), []);
  assert.deepEqual(db.events, committed);
  db.verify();
});

test('delete photo metadata even when its file is already missing', async t => {
  const db = database([
    { sql: /^SELECT .* FROM repair_photo .* FOR UPDATE$/, result: [photo] },
    { sql: /^DELETE FROM repair_photo/, result: { affectedRows: 1 } }, history('Photo', 'deleted'),
  ]);
  const api = await client(t, db);
  assert.equal((await api.request('DELETE', '/photos/9')).status, 204);
  db.verify();
});

test('failed delete history leaves the photo file intact', async t => {
  const db = database([
    { sql: /^SELECT .* FROM repair_photo .* FOR UPDATE$/, result: [photo] },
    { sql: /^DELETE FROM repair_photo/, result: { affectedRows: 1 } },
    { sql: /^INSERT INTO edit_history/, error: new Error('history failed') },
  ]);
  const api = await client(t, db);
  await fs.writeFile(path.join(api.folder, filename), await image('webp'));
  assert.equal((await api.request('DELETE', '/photos/9')).status, 500);
  assert.equal((await fs.readdir(api.folder)).length, 1);
  assert.deepEqual(db.events, rolledBack);
});

test('disk cleanup failure is reported after a committed photo deletion', async t => {
  const db = database([
    { sql: /^SELECT .* FROM repair_photo .* FOR UPDATE$/, result: [photo] },
    { sql: /^DELETE FROM repair_photo/, result: { affectedRows: 1 } }, history('Photo', 'deleted'),
  ]);
  const api = await client(t, db, { files: { ...fs, async unlink() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } } });
  const response = await api.request('DELETE', '/photos/9');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { photo_id: 9, deleted: true, file_cleanup_pending: true });
  assert.deepEqual(db.events, committed);
});

test('unknown photo returns 404 without touching the filesystem', async t => {
  const db = database([{ sql: /^SELECT .* FROM repair_photo .* FOR UPDATE$/, result: [] }]);
  const api = await client(t, db);
  assert.equal((await api.request('DELETE', '/photos/9')).status, 404);
  assert.deepEqual(db.events, rolledBack);
});

test('legacy or unsafe stored photo paths cannot delete arbitrary files', async t => {
  const db = database([{ sql: /^SELECT .* FROM repair_photo .* FOR UPDATE$/, result: [{ ...photo, image_url: '/etc/passwd' }] }]);
  const api = await client(t, db);
  assert.equal((await api.request('DELETE', '/photos/9')).status, 409);
  assert.deepEqual(db.events, rolledBack);
  db.verify();
});

for (const [method, url, body] of [
  ['GET', '/repairs/0/history'], ['GET', '/repairs/1abc/parts'], ['GET', '/repairs/2147483648/photos'],
  ['POST', '/repairs/-1/parts', { part_name: 'x' }], ['PATCH', '/parts/0', { quantity: 2 }], ['DELETE', '/photos/0'],
]) {
  test(`invalid resource ID: ${method} ${url}`, async t => {
    const db = database();
    const api = await client(t, db);
    assert.equal((await api.request(method, url, body)).status, 400);
    assert.deepEqual(db.calls, []);
  });
}
