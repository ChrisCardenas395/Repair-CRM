-- Repair Project CRM database setup
use csc380_f26_ccarden3;

DROP TABLE IF EXISTS part, repair_photo, note, edit_history, repair_order, device, customer, technician;
-- Create tables for the Repair Project CRM

CREATE TABLE technician (
    technician_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE customer (
    customer_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20),
    ship_address1 VARCHAR(255) NOT NULL,
    ship_address2 VARCHAR(255),
    ship_city VARCHAR(255) NOT NULL,
    ship_state VARCHAR(255) NOT NULL,
    ship_zip VARCHAR(20) NOT NULL,
    ship_country VARCHAR(255) NOT NULL
);

-- Retro consoles / handhelds (Game Boy, SNES, N64, Genesis, PS1...)
-- No IMEI: consoles don't have one, so addIMEI() from the UML is dropped
CREATE TABLE device (
  device_id       INT AUTO_INCREMENT PRIMARY KEY,
  type            ENUM('Handheld','Home Console','Controller','Accessory','Other') NOT NULL,
  brand           VARCHAR(50),                   
  model           VARCHAR(100),                  -- e.g. Game Boy Color
  model_number    VARCHAR(50),                   -- e.g. CGB-001 (on the label)
  serial_number   VARCHAR(100),                  -- often worn off; can be blank
  region          ENUM('NTSC-U','NTSC-J','PAL','Other'),
  color_edition   VARCHAR(100),                  -- e.g. Atomic Purple, Pokemon edition
  accessories_in  TEXT,                          -- what arrived with it: battery cover, cables, games...
  `condition`     TEXT                           -- initial state: corrosion, scratches, missing screws...
);
 
CREATE TABLE repair_order (
  repair_id         INT AUTO_INCREMENT PRIMARY KEY,
  customer_id       INT NOT NULL,
  device_id         INT NOT NULL,
  technician_id     INT,
  status            ENUM('Received','Assessment Complete','Waiting on Parts',
                         'In Repair','Testing','Ready to Ship','Shipped','Cancelled')
                    NOT NULL DEFAULT 'Received',
  diagnosis         TEXT,
  customer_comments TEXT,
  shopify_order_id  VARCHAR(50),                 -- links the repair to the Shopify order
  link_token        CHAR(64) NOT NULL UNIQUE,    -- for the customer's personalized link
  date_created      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_done     DATE,
  FOREIGN KEY (customer_id)   REFERENCES customer(customer_id),
  FOREIGN KEY (device_id)     REFERENCES device(device_id),
  FOREIGN KEY (technician_id) REFERENCES technician(technician_id)
);
 
-- editDates from the UML / R_order.js: one row every time anything on a repair changes
CREATE TABLE edit_history (
  history_id      INT AUTO_INCREMENT PRIMARY KEY,
  repair_id       INT NOT NULL,
  change_type     ENUM('Status','Note','Diagnosis','Photo','Part','Device') NOT NULL,
  details         VARCHAR(255),                  -- e.g. 'Received -> Assessment Complete'
  changed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repair_order(repair_id) ON DELETE CASCADE
);
 
CREATE TABLE note (
  note_id         INT AUTO_INCREMENT PRIMARY KEY,
  repair_id       INT NOT NULL,
  body            TEXT NOT NULL,
  is_public       BOOLEAN NOT NULL DEFAULT TRUE, -- FALSE = technician-only note
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repair_order(repair_id) ON DELETE CASCADE
);
 
CREATE TABLE repair_photo (
  photo_id        INT AUTO_INCREMENT PRIMARY KEY,
  repair_id       INT NOT NULL,
  image_url       VARCHAR(500) NOT NULL,         -- file lives on the server, path saved here
  date_added      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (repair_id) REFERENCES repair_order(repair_id) ON DELETE CASCADE
);
 
CREATE TABLE part (
  part_id         INT AUTO_INCREMENT PRIMARY KEY,
  repair_id       INT NOT NULL,
  part_name       VARCHAR(100) NOT NULL,         -- e.g. IPS screen kit, shell, capacitors, cart slot
  status          ENUM('Needed','Ordered','Received','Installed') NOT NULL DEFAULT 'Needed',
  quantity        INT NOT NULL DEFAULT 1,
  FOREIGN KEY (repair_id) REFERENCES repair_order(repair_id) ON DELETE CASCADE
);
 
-- ---------- Test data ----------
INSERT INTO technician (name, email, password_hash)
VALUES ('Test Technician', 'tech@example.com', 'NOT_A_REAL_HASH_YET');
 
INSERT INTO customer (name, email, phone, ship_address1, ship_city, ship_state, ship_zip, ship_country)
VALUES ('Sample Customer', 'customer@example.com', '315-555-0100', '123 Main St', 'Oswego', 'NY', '13126', 'USA');
 
INSERT INTO device (type, brand, model, model_number, serial_number, region, color_edition, accessories_in, `condition`)
VALUES ('Handheld', 'Nintendo', 'Game Boy Color', 'CGB-001', 'C12345678', 'NTSC-U', 'Atomic Purple',
        'Battery cover', 'Battery corrosion, scratched screen lens');
 
INSERT INTO repair_order (customer_id, device_id, technician_id, status, customer_comments, link_token, expected_done)
VALUES (1, 1, 1, 'Received', 'Turns on but no sound', SHA2(UUID(), 256), '2026-11-15');
 
INSERT INTO edit_history (repair_id, change_type, details) VALUES (1, 'Status', 'Created as Received');
INSERT INTO note (repair_id, body) VALUES (1, 'Unit received, starting assessment');
INSERT INTO part (repair_id, part_name, status, quantity) VALUES (1, 'Speaker', 'Needed', 1);
 
-- ---------- Check ----------
SHOW TABLES;
SELECT repair_id, status, customer_comments FROM repair_order;