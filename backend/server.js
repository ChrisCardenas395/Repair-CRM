require('dotenv').config();
const crypto = require('crypto');
const db = require('./db');
const express = require('express');
const createRepairInformationRouter = require('./routes/repair-information');
const path = require('path');

const app = express();
app.use(createRepairInformationRouter(db));
app.use(express.json());
const PORT = process.env.PORT || 4380;

const BOARD_STATUSES =  ['Received', 'Under Review', 'Waiting for Parts', 'In Progress', 'Done', 'Shipped'];
app.use(express.static(path.join(__dirname, '..', 'KEVIN_ui_final')));

app.get('/repairs', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.repair_id, c.name AS customer, d.model, r.status, r.date_created
      FROM repair_order r
      JOIN customer c ON r.customer_id = c.customer_id
      JOIN device d   ON r.device_id   = d.device_id
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load repairs' });
  }
});

app.post('/repairs', async (req, res) => {
  const { customer, device, customer_comments } = req.body;

  if (!customer || !customer.name || !customer.email || !device || !device.type) {
    return res.status(400).json({ error: 'Customer name, email, and device type are required' });
  }

    const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Customer: reuse them if this email is already saved, otherwise add them
    const [existing] = await conn.query(
      'SELECT customer_id FROM customer WHERE email = ?',
      [customer.email]
    );

    let customerId;
    if (existing.length > 0) {
      customerId = existing[0].customer_id;
    } else {
      const [newCustomer] = await conn.query(
        `INSERT INTO customer (name, email, phone, ship_address1, ship_address2,
         ship_city, ship_state, ship_zip, ship_country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [customer.name, customer.email, customer.phone, customer.ship_address1,
         customer.ship_address2, customer.ship_city, customer.ship_state,
         customer.ship_zip, customer.ship_country]
      );
      customerId = newCustomer.insertId;
    }

        // 2. Device
    const [newDevice] = await conn.query(
      `INSERT INTO device (type, brand, model, model_number, serial_number, region, color_edition, accessories_in, \`condition\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [device.type, device.brand, device.model, device.model_number, device.serial_number, device.region, device.color_edition, device.accessories_in, device.condition]
    );
    const deviceId = newDevice.insertId;

    // 3. Repair order, with a random code for the customer's link
    const linkToken = crypto.randomBytes(32).toString('hex');
    const [newRepair] = await conn.query(
      `INSERT INTO repair_order (customer_id, device_id, technician_id, customer_comments, link_token)
       VALUES (?, ?, 1, ?, ?)`,
      [customerId, deviceId, customer_comments, linkToken]
    );
    const repairId = newRepair.insertId;

    // 4. Edit history
    await conn.query(
      `INSERT INTO edit_history (repair_id, change_type, details)
       VALUES (?, 'Status', 'Created as Received')`,
      [repairId]
    );

    await conn.commit();
      
    res.status(201).json({
      repair_id: repairId,
      link_token: linkToken,
      link: `${process.env.BASE_URL}/track/${linkToken}`
    });
  
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Could not create repair' });
  } finally {
    conn.release();
  }
});

app.get('/repairs/:id', async (req, res) => {
  const repairId = req.params.id;

  try {
    const [repairs] = await db.query(
      `SELECT r.repair_id, r.status, r.diagnosis, r.customer_comments, r.shopify_order_id,
              r.link_token, r.date_created, r.expected_done,
              c.customer_id, c.name AS customer_name, c.email, c.phone,
              c.ship_address1, c.ship_address2, c.ship_city, c.ship_state, c.ship_zip, c.ship_country,
              d.device_id, d.type, d.brand, d.model, d.model_number, d.serial_number,
              d.region, d.color_edition, d.accessories_in, d.\`condition\`
       FROM repair_order r
       JOIN customer c ON r.customer_id = c.customer_id
       JOIN device d   ON r.device_id   = d.device_id
       WHERE r.repair_id = ?`,
      [repairId]
    );

    if (repairs.length === 0) {
      return res.status(404).json({ error: 'Repair not found' });
    }
    
    const [notes] = await db.query(
      'SELECT note_id, body, is_public, created_at FROM note WHERE repair_id = ? ORDER BY created_at',
      [repairId]
    );
    const [photos] = await db.query(
      'SELECT photo_id, image_url, date_added FROM repair_photo WHERE repair_id = ? ORDER BY date_added',
      [repairId]
    );
    const [parts] = await db.query(
      'SELECT part_id, part_name, status, quantity FROM part WHERE repair_id = ?',
      [repairId]
    );

    res.json({ ...repairs[0], notes, photos, parts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load repair' });
  }
});

app.patch('/repairs/:id/status', async (req, res) => {
  const repairId = req.params.id;
  const { status } = req.body;

  if (!BOARD_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Status must be one of: ' + BOARD_STATUSES.join(', ')});
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT status FROM repair_order WHERE repair_id = ?',
      [repairId]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Repair not found' });
    }

    const oldStatus = rows[0].status;

    await conn.query(
      'UPDATE repair_order SET status = ? WHERE repair_id = ?',
      [status, repairId]
    );

    await conn.query(
      `INSERT INTO edit_history (repair_id, change_type, details)
       VALUES (?, 'Status', ?)`,
      [repairId, `${oldStatus} -> ${status}`]
    );

    await conn.commit();
    res.json({ repair_id: Number(repairId), old_status: oldStatus, status: status });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Could not update status' });
  } finally {
    conn.release();
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
