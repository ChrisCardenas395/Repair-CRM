require('dotenv').config();
const db = require('./db');
const express = require('express');

const app = express();
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
