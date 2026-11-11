require('dotenv').config();
const crypto = require('crypto');
const db = require('./db');
const express = require('express');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4380;

app.get('/', (req, res) => {
  res.send('Repair CRM backend is running');
});

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
    res.status(201).json({ repair_id: repairId, link_token: linkToken });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Could not create repair' });
  } finally {
    conn.release();
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
