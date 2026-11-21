const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');

const PART_COLUMNS = 'part_id, repair_id, part_name, status, quantity';
const PHOTO_COLUMNS = 'photo_id, repair_id, image_url, date_added';
const PART_STATUSES = ['Needed', 'Ordered', 'Received', 'Installed'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_NAME = /^[a-f0-9]{48}\.webp$/;
const PHOTO_PREFIX = '/photos/files/';
const IMAGE_TYPES = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Reject invalid IDs before sending them to MySQL.
function parseId(value) {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id > 2147483647) {
    throw new RequestError(400, 'ID must be a positive integer within the MySQL INT range');
  }
  return id;
}

// New parts get defaults; updates only change the fields included in the request.
function partFields(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'A JSON object is required');
  }
  if (Object.keys(body).some(key => !['part_name', 'status', 'quantity'].includes(key))) {
    throw new RequestError(400, 'Request contains unsupported fields');
  }
  if (partial && !Object.keys(body).length) {
    throw new RequestError(400, 'Provide part_name, status, or quantity');
  }
  const fields = {};
  if (!partial || has(body, 'part_name')) {
    if (typeof body.part_name !== 'string' || !body.part_name.trim()) {
      throw new RequestError(400, 'part_name must be a nonblank string');
    }
    fields.part_name = body.part_name.trim();
    if ([...fields.part_name].length > 100) {
      throw new RequestError(400, 'part_name must not exceed 100 characters');
    }
  }
  if (has(body, 'status')) {
    if (!PART_STATUSES.includes(body.status)) {
      throw new RequestError(400, 'status must be Needed, Ordered, Received, or Installed');
    }
    fields.status = body.status;
  } else if (!partial) {
    fields.status = 'Needed';
  }
  if (has(body, 'quantity')) {
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 2147483647) {
      throw new RequestError(400, 'quantity must be a positive integer within the MySQL INT range');
    }
    fields.quantity = body.quantity;
  } else if (!partial) {
    fields.quantity = 1;
  }
  return fields;
}

// Only allow deletion of files that belong to our upload folder.
function storedFilename(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith(PHOTO_PREFIX)) {
    throw new RequestError(409, 'Photo is not in the managed upload folder');
  }
  const filename = imageUrl.slice(PHOTO_PREFIX.length);
  if (!PHOTO_NAME.test(filename)) {
    throw new RequestError(409, 'Photo is not in the managed upload folder');
  }
  return filename;
}

async function encodePhoto(file) {
  try {
    const image = sharp(file.buffer, { limitInputPixels: 20000000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== IMAGE_TYPES[file.mimetype] || (metadata.pages || 1) > 1) {
      throw new Error('Unsupported image content');
    }
    // Decode and rewrite the image instead of saving untrusted upload bytes.
    // This also removes metadata and keeps large camera images manageable.
    const buffer = await image.rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
    if (buffer.length > MAX_PHOTO_BYTES) {
      throw new RequestError(413, 'Processed photo exceeds the 5 MB limit');
    }
    return buffer;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(415, 'Upload a valid, nonanimated JPEG, PNG, or WebP image under 20 megapixels');
  }
}

module.exports = function createRepairResourcesRouter(db, options = {}) {
  const router = express.Router();
  const logger = options.logger || console;
  const files = options.files || fs;
  const uploadDir = path.resolve(options.uploadDir || path.join(__dirname, '..', 'uploads', 'repair-photos'));
  const uncertainCommits = new WeakSet();
  // Hold one small upload in memory so its image content can be checked before saving.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 1 },
    fileFilter(req, file, done) {
      done(IMAGE_TYPES[file.mimetype] ? null : new RequestError(415, 'Only JPEG, PNG, and WebP photos are accepted'), true);
    },
  }).single('photo');

  router.use(['/repairs/:id/parts', '/parts/:id'], express.json());

  // Return useful request errors without exposing database details to the browser.
  function endpoint(message, handler) {
    return async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (error) {
        if (res.headersSent) return next(error);
        if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
        if (error instanceof multer.MulterError) {
          const tooLarge = error.code === 'LIMIT_FILE_SIZE';
          return res.status(tooLarge ? 413 : 400).json({
            error: tooLarge ? 'Photo exceeds the 5 MB limit' : 'Send exactly one file in the photo field and no extra fields',
          });
        }
        logger.error(message, { code: error.code || 'RESOURCE_ERROR' });
        res.status(500).json({ error: message });
      }
    };
  }

  // Save each database change and its history entry together, or roll both back.
  async function transaction(work) {
    const conn = await db.getConnection();
    let started = false;
    let committing = false;
    let broken = false;
    try {
      await conn.beginTransaction();
      started = true;
      const result = await work(conn);
      committing = true;
      await conn.commit();
      return result;
    } catch (error) {
      if (committing) uncertainCommits.add(error);
      if (started) {
        try { await conn.rollback(); }
        catch (rollbackError) {
          broken = true;
          logger.error('Could not roll back repair resources', { code: rollbackError.code || 'DATABASE_ERROR' });
        }
      }
      throw error;
    } finally {
      // A connection with a failed rollback must not go back into the pool.
      if (broken) conn.destroy();
      else conn.release();
    }
  }

  // A write can lock the repair row until its transaction finishes.
  async function repairExists(connection, repairId, lock = false) {
    const [rows] = await connection.query(
      `SELECT repair_id FROM repair_order WHERE repair_id = ?${lock ? ' FOR UPDATE' : ''}`, [repairId]
    );
    if (!rows.length) throw new RequestError(404, 'Repair not found');
  }

  async function history(connection, repairId, type, details) {
    await connection.query('INSERT INTO edit_history (repair_id, change_type, details) VALUES (?, ?, ?)', [repairId, type, details]);
  }

  // These three list routes share the same repair check and return records in a stable order.
  // Table and column names come from this fixed list; request IDs are query parameters.
  const lists = [
    ['history', 'history_id, repair_id, change_type, details, changed_at', 'edit_history', 'changed_at ASC, history_id ASC'],
    ['parts', PART_COLUMNS, 'part', 'part_id ASC'],
    ['photos', PHOTO_COLUMNS, 'repair_photo', 'date_added ASC, photo_id ASC'],
  ];
  for (const [resource, columns, table, order] of lists) {
    router.get(`/repairs/:id/${resource}`, endpoint(`Could not load ${resource}`, async (req, res) => {
      const repairId = parseId(req.params.id);
      await repairExists(db, repairId);
      const [rows] = await db.query(`SELECT ${columns} FROM ${table} WHERE repair_id = ? ORDER BY ${order}`, [repairId]);
      res.json(rows);
    }));
  }

  router.post('/repairs/:id/parts', endpoint('Could not create part', async (req, res) => {
    const repairId = parseId(req.params.id);
    const fields = partFields(req.body);
    const part = await transaction(async conn => {
      await repairExists(conn, repairId, true);
      const [insert] = await conn.query('INSERT INTO part (repair_id, part_name, status, quantity) VALUES (?, ?, ?, ?)', [repairId, fields.part_name, fields.status, fields.quantity]);
      await history(conn, repairId, 'Part', `Part ${insert.insertId} added`);
      const [rows] = await conn.query(`SELECT ${PART_COLUMNS} FROM part WHERE part_id = ?`, [insert.insertId]);
      return rows[0];
    });
    res.status(201).json(part);
  }));

  router.patch('/parts/:id', endpoint('Could not update part', async (req, res) => {
    const partId = parseId(req.params.id);
    const fields = partFields(req.body, true);
    const part = await transaction(async conn => {
      const [rows] = await conn.query(`SELECT ${PART_COLUMNS} FROM part WHERE part_id = ? FOR UPDATE`, [partId]);
      if (!rows.length) throw new RequestError(404, 'Part not found');
      const current = rows[0];
      // Keep existing values for fields the caller left out.
      const next = { ...current, ...fields };
      // Saving the same values should not add another history entry.
      if (next.part_name === current.part_name && next.status === current.status && next.quantity === current.quantity) return current;
      await conn.query('UPDATE part SET part_name = ?, status = ?, quantity = ? WHERE part_id = ?', [next.part_name, next.status, next.quantity, partId]);
      await history(conn, current.repair_id, 'Part', `Part ${partId} updated`);
      return next;
    });
    res.json(part);
  }));

  router.delete('/parts/:id', endpoint('Could not delete part', async (req, res) => {
    const partId = parseId(req.params.id);
    await transaction(async conn => {
      const [rows] = await conn.query('SELECT part_id, repair_id FROM part WHERE part_id = ? FOR UPDATE', [partId]);
      if (!rows.length) throw new RequestError(404, 'Part not found');
      await conn.query('DELETE FROM part WHERE part_id = ?', [partId]);
      await history(conn, rows[0].repair_id, 'Part', `Part ${partId} deleted`);
    });
    res.status(204).end();
  }));

  router.post('/repairs/:id/photos', endpoint('Could not upload photo', async (req, res) => {
    const repairId = parseId(req.params.id);
    await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
    if (!req.file) throw new RequestError(400, 'Send one image file in the photo field');
    const buffer = await encodePhoto(req.file);
    // Generate our own filename instead of trusting the name sent by the browser.
    const filename = `${crypto.randomBytes(24).toString('hex')}.webp`;
    const imageUrl = PHOTO_PREFIX + filename;
    let fileWritten = false;
    try {
      const photo = await transaction(async conn => {
        await repairExists(conn, repairId, true);
        await files.mkdir(uploadDir, { recursive: true, mode: 0o700 });
        try {
          await files.writeFile(path.join(uploadDir, filename), buffer, { flag: 'wx', mode: 0o600 });
          fileWritten = true;
        } catch (writeError) {
          // A failed write may leave a partial file. Never remove an existing collision.
          if (writeError.code !== 'EEXIST') await removeFile(filename);
          throw writeError;
        }
        const [insert] = await conn.query('INSERT INTO repair_photo (repair_id, image_url) VALUES (?, ?)', [repairId, imageUrl]);
        await history(conn, repairId, 'Photo', `Photo ${insert.insertId} added`);
        const [rows] = await conn.query(`SELECT ${PHOTO_COLUMNS} FROM repair_photo WHERE photo_id = ?`, [insert.insertId]);
        return rows[0];
      });
      res.status(201).json(photo);
    } catch (error) {
      // A lost commit reply does not prove the commit failed. Keep the file in that
      // case so a saved database record cannot point at a file we just removed.
      if (fileWritten && !uncertainCommits.has(error)) await removeFile(filename);
      throw error;
    }
  }));

  async function removeFile(filename) {
    try {
      await files.unlink(path.join(uploadDir, filename));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      logger.error('Could not remove stored photo', { code: error.code || 'FILE_ERROR' });
      return false;
    }
  }

  router.get('/photos/files/:filename', endpoint('Could not load photo', async (req, res) => {
    const filename = req.params.filename;
    if (!PHOTO_NAME.test(filename)) throw new RequestError(404, 'Photo not found');
    // Only serve files that still have a photo record in the database.
    const [rows] = await db.query('SELECT photo_id FROM repair_photo WHERE image_url = ?', [PHOTO_PREFIX + filename]);
    if (!rows.length) throw new RequestError(404, 'Photo not found');
    await new Promise((resolve, reject) => {
      res.sendFile(filename, {
        root: uploadDir,
        headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
      }, error => {
        if (!error) return resolve();
        if (error.code === 'ENOENT' || error.status === 404) return reject(new RequestError(404, 'Photo file not found'));
        reject(error);
      });
    });
  }));

  router.delete('/photos/:id', endpoint('Could not delete photo', async (req, res) => {
    const photoId = parseId(req.params.id);
    const filename = await transaction(async conn => {
      const [rows] = await conn.query(`SELECT ${PHOTO_COLUMNS} FROM repair_photo WHERE photo_id = ? FOR UPDATE`, [photoId]);
      if (!rows.length) throw new RequestError(404, 'Photo not found');
      const stored = storedFilename(rows[0].image_url);
      await conn.query('DELETE FROM repair_photo WHERE photo_id = ?', [photoId]);
      await history(conn, rows[0].repair_id, 'Photo', `Photo ${photoId} deleted`);
      return stored;
    });
    // Keep the file until the database deletion commits. If disk cleanup fails,
    // the URL is already unavailable, and the response makes that failure visible.
    if (!await removeFile(filename)) {
      return res.json({ photo_id: photoId, deleted: true, file_cleanup_pending: true });
    }
    res.status(204).end();
  }));

  router.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(error.status).json({ error: error.type === 'entity.too.large' ? 'JSON body is too large' : 'Invalid JSON' });
    }
    next(error);
  });

  return router;
};
