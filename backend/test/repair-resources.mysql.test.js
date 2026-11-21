const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const mysql = require('mysql2/promise');
const sharp = require('sharp');
const createInformationRouter = require('../routes/repair-information');
const createResourcesRouter = require('../routes/repair-resources');

// Run only when a separate, socket-only test database is explicitly configured.
// These tests never load .env or connect through a host/port or the school tunnel.
test('history, parts, and photos with isolated MySQL', { skip: process.env.MYSQL_TEST_ALLOW_WRITES !== '1' }, async t => {
  const database = process.env.MYSQL_TEST_DATABASE;
  const socketPath = process.env.MYSQL_TEST_SOCKET;
  assert.match(database || '', /^repair_crm_[a-z_]*test$/);
  assert.ok(path.isAbsolute(socketPath || ''), 'An absolute local socket path is required');
  assert.ok(process.env.MYSQL_TEST_PASSWORD, 'Local test password is required');
  assert.ok(process.env.MYSQL_TEST_ADMIN_PASSWORD, 'Local admin password is required for failure triggers');
  const config = { socketPath, database, user: process.env.MYSQL_TEST_USER, password: process.env.MYSQL_TEST_PASSWORD, connectionLimit: 3 };
  let pool = mysql.createPool(config);
  const admin = await mysql.createConnection({ socketPath, database, user: 'root', password: process.env.MYSQL_TEST_ADMIN_PASSWORD });
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'repair-mysql-photos-'));
  const logs = [];
  let server;
  let isolated = false;
  let repairId;
  let otherId;
  let customerId;
  let deviceId;
  let technicianId;
  const suffix = crypto.randomBytes(8).toString('hex');
  const trigger = `reject_resources_${suffix}`;
  const png = await sharp({ create: { width: 5, height: 4, channels: 3, background: '#428855' } }).png().toBuffer();

  async function closeApp() {
    if (!server) return;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    server = null;
  }
  // Use a temporary HTTP port and upload folder so the normal app can keep running.
  async function startApp(extra = {}) {
    const app = express();
    const logger = { error: (...args) => logs.push(args) };
    app.use(createInformationRouter(pool, logger));
    app.use(createResourcesRouter(pool, { uploadDir: folder, logger, ...extra }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  async function request(method, url, body, multipart = false) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { Connection: 'close', ...(multipart || body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, type: response.headers.get('content-type'), body: bytes.length ? (response.headers.get('content-type') || '').includes('application/json') ? JSON.parse(bytes.toString()) : bytes : null };
  }
  function upload(buffer = png, type = 'image/png') {
    const body = new FormData();
    body.append('photo', new Blob([buffer], { type }), '../../camera.png');
    return request('POST', `/repairs/${repairId}/photos`, body, true);
  }
  async function countHistory() {
    const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM edit_history WHERE repair_id = ?', [repairId]);
    return row.count;
  }
  async function check(name, fn) { await t.test(name, fn); }

  t.after(async () => {
    await closeApp();
    try {
      if (!isolated) return;
      await admin.query(`DROP TRIGGER IF EXISTS ${trigger}`);
      // Remove only this run's dummy fixtures, leaving other local tests alone.
      const ids = [repairId, otherId].filter(Boolean);
      if (ids.length) await pool.query(`DELETE FROM repair_order WHERE repair_id IN (${ids.map(() => '?').join(', ')})`, ids);
      if (deviceId) await pool.query('DELETE FROM device WHERE device_id = ?', [deviceId]);
      if (customerId) await pool.query('DELETE FROM customer WHERE customer_id = ?', [customerId]);
      if (technicianId) await pool.query('DELETE FROM technician WHERE technician_id = ?', [technicianId]);
    } finally {
      await pool.end();
      await admin.end();
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  // Confirm this is the isolated local test database before making any changes.
  const [[identity]] = await pool.query('SELECT DATABASE() AS db, @@skip_networking AS isolated');
  assert.equal(identity.db, database);
  assert.equal(identity.isolated, 1, 'Refusing to write to a network-accessible database');
  isolated = true;
  const schema = await fs.readFile(path.join(__dirname, '../database/setup.sql'), 'utf8');
  // Read only table definitions; skip setup commands that drop or seed data.
  const creates = [...schema.matchAll(/CREATE TABLE ([a-z_]+) \([\s\S]*?\n\);/g)];
  assert.equal(creates.length, 8);
  for (const [statement] of creates) await pool.query(statement.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
  const [engines] = await pool.query('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  assert.ok(engines.every(row => row.ENGINE === 'InnoDB'));
  const [tech] = await pool.query('INSERT INTO technician (name, email, password_hash) VALUES (?, ?, ?)', ['Dummy Technician', `tech-${suffix}@example.invalid`, 'LOCAL_TEST_ONLY']);
  technicianId = tech.insertId;
  const [customer] = await pool.query('INSERT INTO customer (name, email, ship_address1, ship_city, ship_state, ship_zip, ship_country) VALUES (?, ?, ?, ?, ?, ?, ?)', ['Dummy Customer', `customer-${suffix}@example.invalid`, '1 Test St', 'Test City', 'NY', '00000', 'US']);
  customerId = customer.insertId;
  const [device] = await pool.query('INSERT INTO device (type, model) VALUES (?, ?)', ['Handheld', 'Dummy Device']);
  deviceId = device.insertId;
  async function newRepair() {
    const [row] = await pool.query('INSERT INTO repair_order (customer_id, device_id, technician_id, link_token) VALUES (?, ?, ?, ?)', [customerId, deviceId, technicianId, crypto.randomBytes(32).toString('hex')]);
    return row.insertId;
  }
  repairId = await newRepair();
  otherId = await newRepair();
  await startApp();
  let partId;
  let photo;

  await check('empty history for an existing repair is an empty array', async () => {
    assert.deepEqual(await request('GET', `/repairs/${repairId}/history`), { status: 200, type: 'application/json; charset=utf-8', body: [] });
  });
  await check('create part with defaults and one real Part history row', async () => {
    const response = await request('POST', `/repairs/${repairId}/parts`, { part_name: ' Speaker ' });
    assert.equal(response.status, 201);
    partId = response.body.part_id;
    assert.equal(response.body.part_name, 'Speaker');
    assert.equal(response.body.status, 'Needed');
    assert.equal(response.body.quantity, 1);
    assert.equal(await countHistory(), 1);
  });
  await check('read and update the saved part with a partial PATCH', async () => {
    const update = await request('PATCH', `/parts/${partId}`, { status: 'Ordered', quantity: 2 });
    assert.equal(update.status, 200);
    assert.equal(update.body.part_name, 'Speaker');
    const loaded = await request('GET', `/repairs/${repairId}/parts`);
    assert.equal(loaded.status, 200);
    assert.deepEqual(loaded.body[0], update.body);
    const [[row]] = await pool.query('SELECT status, quantity FROM part WHERE part_id = ?', [partId]);
    assert.equal(row.status, 'Ordered');
    assert.equal(row.quantity, 2);
  });
  await check('unchanged part update does not duplicate history', async () => {
    const before = await countHistory();
    assert.equal((await request('PATCH', `/parts/${partId}`, { status: 'Ordered' })).status, 200);
    assert.equal(await countHistory(), before);
  });
  await check('invalid part values do not change saved data', async () => {
    const before = await countHistory();
    for (const body of [{ part_name: '' }, { quantity: 0 }, { status: 'Done' }, { quantity: '2' }, {}]) {
      assert.equal((await request('PATCH', `/parts/${partId}`, body)).status, 400);
    }
    assert.equal(await countHistory(), before);
  });
  await check('part names use SQL parameters rather than executable SQL', async () => {
    const value = "'; DROP TABLE part; --";
    const response = await request('POST', `/repairs/${repairId}/parts`, { part_name: value });
    assert.equal(response.status, 201);
    const [[saved]] = await pool.query('SELECT part_name FROM part WHERE part_id = ?', [response.body.part_id]);
    assert.equal(saved.part_name, value);
    assert.equal((await request('DELETE', `/parts/${response.body.part_id}`)).status, 204);
  });
  await check('valid image creates metadata, history, and a rewritten WebP file', async () => {
    const response = await upload();
    assert.equal(response.status, 201);
    photo = response.body;
    assert.match(photo.image_url, /^\/photos\/files\/[a-f0-9]{48}\.webp$/);
    const [[row]] = await pool.query('SELECT * FROM repair_photo WHERE photo_id = ?', [photo.photo_id]);
    assert.equal(row.repair_id, repairId);
    const stored = path.join(folder, photo.image_url.split('/').pop());
    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 5);
    assert.equal(metadata.height, 4);
  });
  await check('saved photo URL returns the actual file', async () => {
    const response = await request('GET', photo.image_url);
    assert.equal(response.status, 200);
    assert.match(response.type, /^image\/webp/);
    assert.equal((await sharp(response.body).metadata()).format, 'webp');
  });
  await check('photo list returns saved metadata in the API contract', async () => {
    const response = await request('GET', `/repairs/${repairId}/photos`);
    assert.equal(response.status, 200);
    assert.equal(response.body[0].photo_id, photo.photo_id);
    assert.equal(response.body[0].image_url, photo.image_url);
  });
  await check('fake and oversized photos do not create metadata or files', async () => {
    const before = await fs.readdir(folder);
    const history = await countHistory();
    assert.equal((await upload(Buffer.from('not an image'))).status, 415);
    assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
    assert.deepEqual(await fs.readdir(folder), before);
    assert.equal(await countHistory(), history);
  });
  await check('resources are isolated to their own repair', async () => {
    assert.deepEqual((await request('GET', `/repairs/${otherId}/parts`)).body, []);
    assert.deepEqual((await request('GET', `/repairs/${otherId}/photos`)).body, []);
    assert.deepEqual((await request('GET', `/repairs/${otherId}/history`)).body, []);
  });
  await check('unknown resource IDs return 404', async () => {
    for (const [method, url, body] of [
      ['GET', '/repairs/2147483647/history'], ['GET', '/repairs/2147483647/parts'], ['GET', '/repairs/2147483647/photos'],
      ['POST', '/repairs/2147483647/parts', { part_name: 'Speaker' }],
      ['PATCH', '/parts/2147483647', { quantity: 2 }], ['DELETE', '/parts/2147483647'], ['DELETE', '/photos/2147483647'],
    ]) assert.equal((await request(method, url, body)).status, 404);
  });

  // Reject only this run's history inserts so MySQL itself proves rollback works.
  await admin.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON edit_history FOR EACH ROW BEGIN IF NEW.repair_id = ${repairId} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Intentional local resource test failure'; END IF; END`);
  try {
    await check('part creation rolls back when history fails', async () => {
      const [[before]] = await pool.query('SELECT COUNT(*) AS count FROM part WHERE repair_id = ?', [repairId]);
      assert.equal((await request('POST', `/repairs/${repairId}/parts`, { part_name: 'Must not persist' })).status, 500);
      const [[after]] = await pool.query('SELECT COUNT(*) AS count FROM part WHERE repair_id = ?', [repairId]);
      assert.equal(after.count, before.count);
    });
    await check('part updates roll back when history fails', async () => {
      assert.equal((await request('PATCH', `/parts/${partId}`, { quantity: 99 })).status, 500);
      const [[row]] = await pool.query('SELECT quantity FROM part WHERE part_id = ?', [partId]);
      assert.equal(row.quantity, 2);
    });
    await check('part deletion rolls back when history fails', async () => {
      assert.equal((await request('DELETE', `/parts/${partId}`)).status, 500);
      const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM part WHERE part_id = ?', [partId]);
      assert.equal(row.count, 1);
    });
    await check('photo upload failure rolls back metadata and removes the new file', async () => {
      const before = await fs.readdir(folder);
      const [[count]] = await pool.query('SELECT COUNT(*) AS count FROM repair_photo WHERE repair_id = ?', [repairId]);
      assert.equal((await upload()).status, 500);
      assert.deepEqual(await fs.readdir(folder), before);
      const [[after]] = await pool.query('SELECT COUNT(*) AS count FROM repair_photo WHERE repair_id = ?', [repairId]);
      assert.equal(after.count, count.count);
    });
    await check('photo deletion failure leaves the metadata and file intact', async () => {
      assert.equal((await request('DELETE', `/photos/${photo.photo_id}`)).status, 500);
      const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM repair_photo WHERE photo_id = ?', [photo.photo_id]);
      assert.equal(row.count, 1);
      assert.equal((await request('GET', photo.image_url)).status, 200);
    });
  } finally { await admin.query(`DROP TRIGGER ${trigger}`); }

  await check('photo deletion removes file and metadata and keeps its history entry', async () => {
    const before = await countHistory();
    assert.equal((await request('DELETE', `/photos/${photo.photo_id}`)).status, 204);
    assert.equal((await request('GET', photo.image_url)).status, 404);
    await assert.rejects(fs.stat(path.join(folder, photo.image_url.split('/').pop())), { code: 'ENOENT' });
    assert.equal(await countHistory(), before + 1);
  });
  await check('a missing file can still have its stale metadata deleted', async () => {
    const response = await upload();
    assert.equal(response.status, 201);
    const saved = response.body;
    await fs.unlink(path.join(folder, saved.image_url.split('/').pop()));
    assert.equal((await request('DELETE', `/photos/${saved.photo_id}`)).status, 204);
  });
  await check('unsafe legacy paths cannot remove files outside managed storage', async () => {
    const [row] = await pool.query('INSERT INTO repair_photo (repair_id, image_url) VALUES (?, ?)', [repairId, '../outside.txt']);
    assert.equal((await request('DELETE', `/photos/${row.insertId}`)).status, 409);
    const [[saved]] = await pool.query('SELECT COUNT(*) AS count FROM repair_photo WHERE photo_id = ?', [row.insertId]);
    assert.equal(saved.count, 1);
  });
  await check('disk write failure leaves no metadata or history', async () => {
    const before = await countHistory();
    const [[count]] = await pool.query('SELECT COUNT(*) AS count FROM repair_photo WHERE repair_id = ?', [repairId]);
    await closeApp();
    await startApp({ files: { ...fs, async writeFile() { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } } });
    assert.equal((await upload()).status, 500);
    assert.equal(await countHistory(), before);
    const [[after]] = await pool.query('SELECT COUNT(*) AS count FROM repair_photo WHERE repair_id = ?', [repairId]);
    assert.equal(after.count, count.count);
    await closeApp();
    await startApp();
  });
  await check('committed deletion reports a cleanup failure and stops serving the old URL', async () => {
    const saved = (await upload()).body;
    await closeApp();
    await startApp({ files: { ...fs, async unlink() { throw Object.assign(new Error('file busy'), { code: 'EACCES' }); } } });
    const response = await request('DELETE', `/photos/${saved.photo_id}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.file_cleanup_pending, true);
    assert.equal((await request('GET', saved.image_url)).status, 404);
    await closeApp();
    await startApp();
  });
  await check('existing notes and diagnosis routes still work alongside the resource router', async () => {
    assert.equal((await request('POST', `/repairs/${repairId}/notes`, { body: 'Local regression note', is_public: false })).status, 201);
    assert.equal((await request('PATCH', `/repairs/${repairId}/diagnosis`, { diagnosis: 'Local regression diagnosis' })).status, 200);
    assert.equal((await request('GET', `/repairs/${repairId}/notes`)).body[0].body, 'Local regression note');
  });
  await check('history includes every resource type in deterministic chronological order', async () => {
    const response = await request('GET', `/repairs/${repairId}/history`);
    assert.equal(response.status, 200);
    for (const type of ['Part', 'Photo', 'Note', 'Diagnosis']) assert.ok(response.body.some(row => row.change_type === type));
    for (let i = 1; i < response.body.length; i++) {
      const previous = response.body[i - 1];
      const current = response.body[i];
      assert.ok(current.changed_at > previous.changed_at || (current.changed_at === previous.changed_at && current.history_id > previous.history_id));
    }
  });
  await check('part and photo data survives restarting the API and its database pool', async () => {
    const saved = (await upload()).body;
    await closeApp();
    await pool.end();
    pool = mysql.createPool(config);
    await startApp();
    assert.ok((await request('GET', `/repairs/${repairId}/parts`)).body.some(row => row.part_id === partId));
    assert.equal((await request('GET', saved.image_url)).status, 200);
  });
  await check('successful part deletion removes it and adds exactly one history row', async () => {
    const before = await countHistory();
    assert.equal((await request('DELETE', `/parts/${partId}`)).status, 204);
    const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM part WHERE part_id = ?', [partId]);
    assert.equal(row.count, 0);
    assert.equal(await countHistory(), before + 1);
  });
});
