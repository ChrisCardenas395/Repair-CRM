const express = require('express');

const NOTE_COLUMNS = 'note_id, repair_id, body, is_public, created_at, updated_at';
const MAX_TEXT_BYTES = 65535; // MySQL limits TEXT columns by bytes, not characters.
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseId(value) {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id > 2147483647) {
    throw new RequestError(400, 'ID must be a positive integer within the MySQL INT range');
  }
  return id;
}

function checkFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'A JSON object is required');
  }
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new RequestError(400, 'Request contains unsupported fields');
  }
}

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RequestError(400, `${field} must be a nonblank string`);
  }
  const trimmed = value.trim();
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_TEXT_BYTES) {
    throw new RequestError(400, `${field} exceeds the 65535-byte text limit`);
  }
  return trimmed;
}

function publicFlag(value) {
  if (typeof value !== 'boolean') {
    throw new RequestError(400, 'is_public must be a JSON boolean');
  }
  return value;
}

function noteJson(row) {
  return { ...row, is_public: Boolean(row.is_public) };
}

module.exports = function createRepairInformationRouter(db, logger = console) {
  const router = express.Router();
  router.use(['/repairs/:id/notes', '/notes/:id', '/repairs/:id/diagnosis'], express.json());

  // Keep database details and private note text out of error responses.
  function endpoint(message, handler) {
    return async (req, res) => {
      try {
        await handler(req, res);
      } catch (error) {
        if (error instanceof RequestError) {
          return res.status(error.status).json({ error: error.message });
        }
        logger.error(message, { code: error.code || 'DATABASE_ERROR' });
        return res.status(500).json({ error: message });
      }
    };
  }

  // Save the change and its history together. If either fails, undo both.
  async function transaction(work) {
    const conn = await db.getConnection();
    let started = false;
    try {
      await conn.beginTransaction();
      started = true;
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) {
      if (started) {
        try {
          await conn.rollback();
        } catch (rollbackError) {
          logger.error('Could not roll back repair information', {
            code: rollbackError.code || 'DATABASE_ERROR',
          });
        }
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  // Hold this repair row until the transaction finishes so another update has to wait.
  async function lockRepair(conn, repairId) {
    const [rows] = await conn.query(
      'SELECT repair_id, diagnosis FROM repair_order WHERE repair_id = ? FOR UPDATE',
      [repairId]
    );
    if (!rows.length) throw new RequestError(404, 'Repair not found');
    return rows[0];
  }

  async function recordHistory(conn, repairId, changeType, details) {
    await conn.query(
      'INSERT INTO edit_history (repair_id, change_type, details) VALUES (?, ?, ?)',
      [repairId, changeType, details]
    );
  }

  router.get('/repairs/:id/notes', endpoint('Could not load notes', async (req, res) => {
    const repairId = parseId(req.params.id);
    const [repairs] = await db.query('SELECT repair_id FROM repair_order WHERE repair_id = ?', [repairId]);
    if (!repairs.length) throw new RequestError(404, 'Repair not found');
    const [notes] = await db.query(
      `SELECT ${NOTE_COLUMNS} FROM note WHERE repair_id = ? ORDER BY created_at ASC, note_id ASC`,
      [repairId]
    );
    res.json(notes.map(noteJson));
  }));

  router.post('/repairs/:id/notes', endpoint('Could not create note', async (req, res) => {
    const repairId = parseId(req.params.id);
    checkFields(req.body, ['body', 'is_public']);
    const body = text(req.body.body, 'body');
    // Notes are public by default in the current schema. Send false for an internal note.
    const isPublic = has(req.body, 'is_public') ? publicFlag(req.body.is_public) : true;
    const note = await transaction(async conn => {
      await lockRepair(conn, repairId);
      const [insert] = await conn.query(
        'INSERT INTO note (repair_id, body, is_public) VALUES (?, ?, ?)',
        [repairId, body, isPublic]
      );
      // Record that a note was added without copying its text into history.
      await recordHistory(conn, repairId, 'Note', `Note ${insert.insertId} added`);
      const [rows] = await conn.query(`SELECT ${NOTE_COLUMNS} FROM note WHERE note_id = ?`, [insert.insertId]);
      return noteJson(rows[0]);
    });
    res.status(201).json(note);
  }));

  router.patch('/notes/:id', endpoint('Could not update note', async (req, res) => {
    const noteId = parseId(req.params.id);
    checkFields(req.body, ['body', 'is_public']);
    if (!Object.keys(req.body).length) throw new RequestError(400, 'Provide body or is_public');
    const body = has(req.body, 'body') ? text(req.body.body, 'body') : undefined;
    const isPublic = has(req.body, 'is_public') ? publicFlag(req.body.is_public) : undefined;
    const note = await transaction(async conn => {
      const [existing] = await conn.query(
        `SELECT ${NOTE_COLUMNS} FROM note WHERE note_id = ? FOR UPDATE`, [noteId]
      );
      if (!existing.length) throw new RequestError(404, 'Note not found');
      const current = existing[0];
      const nextBody = body === undefined ? current.body : body;
      const nextPublic = isPublic === undefined ? Boolean(current.is_public) : isPublic;
      // Nothing changed, so leave the timestamp and history alone.
      if (nextBody === current.body && nextPublic === Boolean(current.is_public)) {
        return noteJson(current);
      }
      await conn.query('UPDATE note SET body = ?, is_public = ? WHERE note_id = ?', [nextBody, nextPublic, noteId]);
      await recordHistory(conn, current.repair_id, 'Note', `Note ${noteId} updated`);
      const [rows] = await conn.query(`SELECT ${NOTE_COLUMNS} FROM note WHERE note_id = ?`, [noteId]);
      return noteJson(rows[0]);
    });
    res.json(note);
  }));

  router.get('/repairs/:id/diagnosis', endpoint('Could not load diagnosis', async (req, res) => {
    const repairId = parseId(req.params.id);
    const [rows] = await db.query('SELECT repair_id, diagnosis FROM repair_order WHERE repair_id = ?', [repairId]);
    if (!rows.length) throw new RequestError(404, 'Repair not found');
    res.json(rows[0]);
  }));

  router.patch('/repairs/:id/diagnosis', endpoint('Could not update diagnosis', async (req, res) => {
    const repairId = parseId(req.params.id);
    checkFields(req.body, ['diagnosis']);
    if (!has(req.body, 'diagnosis')) throw new RequestError(400, 'diagnosis is required');
    // Send null to clear a diagnosis. Blank text is rejected to avoid clearing it by mistake.
    const diagnosis = req.body.diagnosis === null ? null : text(req.body.diagnosis, 'diagnosis');
    const repair = await transaction(async conn => {
      const current = await lockRepair(conn, repairId);
      if (current.diagnosis !== diagnosis) {
        await conn.query('UPDATE repair_order SET diagnosis = ? WHERE repair_id = ?', [diagnosis, repairId]);
        await recordHistory(conn, repairId, 'Diagnosis', diagnosis === null ? 'Diagnosis cleared' : 'Diagnosis updated');
      }
      return { repair_id: repairId, diagnosis };
    });
    res.json(repair);
  }));

  // Send a JSON error if the request body is broken or too large.
  router.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(error.status).json({ error: error.type === 'entity.too.large' ? 'JSON body is too large' : 'Invalid JSON' });
    }
    next(error);
  });

  return router;
};
