const express = require('express');
const app = express();
const PORT = process.env.PORT || 4380;

app.get('/', (req, res) => {
  res.send('Repair CRM backend is running');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
