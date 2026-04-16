// ============================================================
//  db/init.js  —  Database initialisation
//  All data is Mumbai-based. Warehouses spread across
//  South, North, West and East Mumbai zones.
//  Riders are located near their home warehouse.
//  Run: node db/init.js  (auto-runs on first server start)
// ============================================================

const Database = require("better-sqlite3");
const path     = require("path");

const DB_PATH = path.join(__dirname, "zonescore.db");
const db      = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

console.log("📦 Initialising ZoneScore database (Mumbai)…");

// ── Tables ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS warehouses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    zone           TEXT    NOT NULL DEFAULT 'Central',
    area           TEXT    NOT NULL DEFAULT 'Mumbai',
    latitude       REAL    NOT NULL,
    longitude      REAL    NOT NULL,
    capacity       INTEGER NOT NULL DEFAULT 100,
    current_orders INTEGER NOT NULL DEFAULT 0,
    status         TEXT    NOT NULL DEFAULT 'active'
                           CHECK(status IN ('active','inactive','maintenance')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS riders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    phone           TEXT,
    home_warehouse_id INTEGER REFERENCES warehouses(id),
    current_lat     REAL    NOT NULL,
    current_lon     REAL    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'available'
                            CHECK(status IN ('available','on_delivery','offline')),
    active_order_id INTEGER,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name           TEXT    DEFAULT 'Guest',
    customer_lat            REAL    NOT NULL,
    customer_lon            REAL    NOT NULL,
    customer_area           TEXT,
    items                   TEXT    DEFAULT '[]',
    assigned_warehouse_id   INTEGER REFERENCES warehouses(id),
    assigned_warehouse_name TEXT,
    assigned_warehouse_zone TEXT,
    assigned_rider_id       INTEGER REFERENCES riders(id),
    assigned_rider_name     TEXT,
    warehouse_distance_km   REAL,
    rider_distance_km       REAL,
    algorithm_used          TEXT    DEFAULT 'smart-nearest',
    routing_reason          TEXT,
    status                  TEXT    NOT NULL DEFAULT 'pending'
                                    CHECK(status IN ('pending','rider_assigned','picked_up','delivered','cancelled')),
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    trigger      TEXT    NOT NULL,
    action       TEXT    NOT NULL,
    warehouse_id INTEGER REFERENCES warehouses(id),
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS billing (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan         TEXT    NOT NULL DEFAULT 'starter',
    amount       REAL    NOT NULL DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT 'active'
                         CHECK(status IN ('active','cancelled','past_due')),
    period_start TEXT,
    period_end   TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Seed only if empty ────────────────────────────────────────
const warehouseCount = db.prepare("SELECT COUNT(*) as c FROM warehouses").get().c;
if (warehouseCount > 0) {
  console.log("✅ Database already seeded. Skipping.");
  db.close();
  return;
}

console.log("🌱 Seeding Mumbai warehouse network…");

// ── Warehouses  ──────────────────────────────────────────────
// 10 dark stores spread across South / North / West / East Mumbai
// Real neighbourhood coordinates

const insertWH = db.prepare(`
  INSERT INTO warehouses (name, zone, area, latitude, longitude, capacity, current_orders, status)
  VALUES (@name, @zone, @area, @latitude, @longitude, @capacity, @current_orders, @status)
`);

const warehouses = [
  // ── South Mumbai (2) ──────────────────────────────────────
  {
    name: "Colaba Dark Store",
    zone: "South", area: "Colaba",
    latitude: 18.9067, longitude: 72.8147,
    capacity: 80, current_orders: 62, status: "active",
  },
  {
    name: "Fort Fulfillment Hub",
    zone: "South", area: "Fort",
    latitude: 18.9340, longitude: 72.8350,
    capacity: 90, current_orders: 20, status: "active",
  },
  {
    name: "Dadar Central Store",
    zone: "South", area: "Dadar",
    latitude: 19.0178, longitude: 72.8478,
    capacity: 100, current_orders: 55, status: "active",
  },

  // ── North Mumbai (3) ──────────────────────────────────────
  {
    name: "Andheri East Hub",
    zone: "North", area: "Andheri East",
    latitude: 19.1136, longitude: 72.8697,
    capacity: 120, current_orders: 30, status: "active",
  },
  {
    name: "Borivali North Store",
    zone: "North", area: "Borivali",
    latitude: 19.2307, longitude: 72.8567,
    capacity: 100, current_orders: 88, status: "active",
  },
  {
    name: "Malad Fulfillment Centre",
    zone: "North", area: "Malad",
    latitude: 19.1868, longitude: 72.8487,
    capacity: 90, current_orders: 15, status: "active",
  },

  // ── West Mumbai (2) ───────────────────────────────────────
  {
    name: "Bandra West Dark Store",
    zone: "West", area: "Bandra West",
    latitude: 19.0596, longitude: 72.8295,
    capacity: 110, current_orders: 40, status: "active",
  },
  {
    name: "Juhu Quick Commerce Hub",
    zone: "West", area: "Juhu",
    latitude: 19.0948, longitude: 72.8258,
    capacity: 80, current_orders: 70, status: "active",
  },

  // ── East Mumbai (2) ───────────────────────────────────────
  {
    name: "Kurla East Warehouse",
    zone: "East", area: "Kurla",
    latitude: 19.0726, longitude: 72.8853,
    capacity: 100, current_orders: 10, status: "active",
  },
  {
    name: "Powai Tech Park Store",
    zone: "East", area: "Powai",
    latitude: 19.1197, longitude: 72.9058,
    capacity: 90, current_orders: 45, status: "maintenance",
  },
];

const whIds = {};
for (const w of warehouses) {
  const result = insertWH.run(w);
  whIds[w.area] = result.lastInsertRowid;
}
console.log(`  → ${warehouses.length} warehouses inserted`);

// ── Riders ────────────────────────────────────────────────────
// 2-3 riders per warehouse, located nearby (slight lat/lon offset)

const insertRider = db.prepare(`
  INSERT INTO riders (name, phone, home_warehouse_id, current_lat, current_lon, status)
  VALUES (@name, @phone, @home_warehouse_id, @current_lat, @current_lon, @status)
`);

function near(lat, lon, offsetLat = 0, offsetLon = 0) {
  return { lat: lat + offsetLat, lon: lon + offsetLon };
}

const riderSeed = [
  // Colaba
  { name: "Ravi Patil",      phone: "9820001001", wh: "Colaba",        dlat:  0.003, dlon:  0.002, status: "available"    },
  { name: "Suresh Kadam",    phone: "9820001002", wh: "Colaba",        dlat: -0.002, dlon:  0.003, status: "on_delivery"  },

  // Fort
  { name: "Anil Shinde",     phone: "9820002001", wh: "Fort",          dlat:  0.002, dlon: -0.002, status: "available"    },
  { name: "Deepak More",     phone: "9820002002", wh: "Fort",          dlat: -0.003, dlon:  0.001, status: "available"    },

  // Dadar
  { name: "Vikram Jadhav",   phone: "9820003001", wh: "Dadar",         dlat:  0.002, dlon:  0.002, status: "available"    },
  { name: "Rahul Gaikwad",   phone: "9820003002", wh: "Dadar",         dlat: -0.001, dlon: -0.003, status: "on_delivery"  },
  { name: "Nitin Sawant",    phone: "9820003003", wh: "Dadar",         dlat:  0.004, dlon:  0.001, status: "available"    },

  // Andheri East
  { name: "Sachin Rane",     phone: "9820004001", wh: "Andheri East",  dlat:  0.003, dlon:  0.002, status: "available"    },
  { name: "Prashant Naik",   phone: "9820004002", wh: "Andheri East",  dlat: -0.002, dlon:  0.004, status: "available"    },
  { name: "Amol Desai",      phone: "9820004003", wh: "Andheri East",  dlat:  0.001, dlon: -0.003, status: "on_delivery"  },

  // Borivali
  { name: "Ganesh Pawar",    phone: "9820005001", wh: "Borivali",      dlat:  0.002, dlon:  0.003, status: "available"    },
  { name: "Kiran Salvi",     phone: "9820005002", wh: "Borivali",      dlat: -0.003, dlon: -0.002, status: "on_delivery"  },

  // Malad
  { name: "Sanjay Mestry",   phone: "9820006001", wh: "Malad",         dlat:  0.003, dlon:  0.001, status: "available"    },
  { name: "Tushar Bhosle",   phone: "9820006002", wh: "Malad",         dlat: -0.001, dlon:  0.003, status: "available"    },
  { name: "Rohan Wagh",      phone: "9820006003", wh: "Malad",         dlat:  0.002, dlon: -0.002, status: "available"    },

  // Bandra West
  { name: "Farhan Shaikh",   phone: "9820007001", wh: "Bandra West",   dlat:  0.002, dlon:  0.002, status: "available"    },
  { name: "Irfan Khan",      phone: "9820007002", wh: "Bandra West",   dlat: -0.003, dlon:  0.001, status: "on_delivery"  },

  // Juhu
  { name: "Pratik Joshi",    phone: "9820008001", wh: "Juhu",          dlat:  0.002, dlon:  0.001, status: "available"    },
  { name: "Mangesh Dalvi",   phone: "9820008002", wh: "Juhu",          dlat: -0.002, dlon:  0.003, status: "offline"      },

  // Kurla East
  { name: "Santosh Mane",    phone: "9820009001", wh: "Kurla",         dlat:  0.001, dlon:  0.002, status: "available"    },
  { name: "Ajay Tupe",       phone: "9820009002", wh: "Kurla",         dlat: -0.002, dlon: -0.001, status: "available"    },
  { name: "Dnyanesh Pol",    phone: "9820009003", wh: "Kurla",         dlat:  0.003, dlon:  0.002, status: "on_delivery"  },

  // Powai (maintenance warehouse — riders are still registered)
  { name: "Hitesh Surve",    phone: "9820010001", wh: "Powai",         dlat:  0.002, dlon:  0.001, status: "offline"      },
  { name: "Kedar Kulkarni",  phone: "9820010002", wh: "Powai",         dlat: -0.001, dlon:  0.003, status: "offline"      },
];

const riderIds = {};
for (const r of riderSeed) {
  const wh     = warehouses.find(w => w.area === r.wh);
  const whId   = whIds[r.wh];
  const result = insertRider.run({
    name:               r.name,
    phone:              r.phone,
    home_warehouse_id:  whId,
    current_lat:        wh.latitude  + r.dlat,
    current_lon:        wh.longitude + r.dlon,
    status:             r.status,
  });
  riderIds[r.name] = result.lastInsertRowid;
}
console.log(`  → ${riderSeed.length} riders inserted`);

// ── Sample orders ─────────────────────────────────────────────
const insertOrder = db.prepare(`
  INSERT INTO orders
    (customer_name, customer_lat, customer_lon, customer_area, items,
     assigned_warehouse_id, assigned_warehouse_name, assigned_warehouse_zone,
     assigned_rider_id, assigned_rider_name,
     warehouse_distance_km, rider_distance_km,
     algorithm_used, routing_reason, status)
  VALUES
    (@customer_name, @customer_lat, @customer_lon, @customer_area, @items,
     @assigned_warehouse_id, @assigned_warehouse_name, @assigned_warehouse_zone,
     @assigned_rider_id, @assigned_rider_name,
     @warehouse_distance_km, @rider_distance_km,
     @algorithm_used, @routing_reason, @status)
`);

const orders = [
  {
    customer_name: "Ananya Mehta", customer_lat: 18.9120, customer_lon: 72.8200,
    customer_area: "Colaba",
    items: JSON.stringify(["milk","bread","eggs"]),
    assigned_warehouse_id: whIds["Colaba"], assigned_warehouse_name: "Colaba Dark Store", assigned_warehouse_zone: "South",
    assigned_rider_id: riderIds["Ravi Patil"], assigned_rider_name: "Ravi Patil",
    warehouse_distance_km: 0.6, rider_distance_km: 0.4,
    algorithm_used: "smart-nearest",
    routing_reason: "Nearest warehouse (Colaba) at 36% load — rider Ravi Patil 0.4km away",
    status: "delivered",
  },
  {
    customer_name: "Rohan Shetty", customer_lat: 19.0620, customer_lon: 72.8330,
    customer_area: "Bandra",
    items: JSON.stringify(["butter","cheese","yogurt"]),
    assigned_warehouse_id: whIds["Bandra West"], assigned_warehouse_name: "Bandra West Dark Store", assigned_warehouse_zone: "West",
    assigned_rider_id: riderIds["Farhan Shaikh"], assigned_rider_name: "Farhan Shaikh",
    warehouse_distance_km: 0.4, rider_distance_km: 0.3,
    algorithm_used: "smart-nearest",
    routing_reason: "Nearest warehouse (Bandra West) at 36% load — rider Farhan Shaikh 0.3km away",
    status: "delivered",
  },
  {
    customer_name: "Priya Kulkarni", customer_lat: 19.1200, customer_lon: 72.8710,
    customer_area: "Andheri",
    items: JSON.stringify(["rice","dal","atta"]),
    assigned_warehouse_id: whIds["Andheri East"], assigned_warehouse_name: "Andheri East Hub", assigned_warehouse_zone: "North",
    assigned_rider_id: riderIds["Sachin Rane"], assigned_rider_name: "Sachin Rane",
    warehouse_distance_km: 0.7, rider_distance_km: 0.5,
    algorithm_used: "smart-nearest",
    routing_reason: "Nearest warehouse (Andheri East) at 25% load — rider Sachin Rane 0.5km away",
    status: "rider_assigned",
  },
  {
    customer_name: "Farida Irani", customer_lat: 18.9100, customer_lon: 72.8160,
    customer_area: "Colaba",
    items: JSON.stringify(["vegetables","fruits"]),
    // Colaba is at 78% load — routed to Fort instead
    assigned_warehouse_id: whIds["Fort"], assigned_warehouse_name: "Fort Fulfillment Hub", assigned_warehouse_zone: "South",
    assigned_rider_id: riderIds["Anil Shinde"], assigned_rider_name: "Anil Shinde",
    warehouse_distance_km: 3.1, rider_distance_km: 0.6,
    algorithm_used: "smart-nearest",
    routing_reason: "Colaba at 78% load — rerouted to Fort (22% load). Rider Anil Shinde 0.6km from Fort.",
    status: "picked_up",
  },
  {
    customer_name: "Sameer Joshi", customer_lat: 19.0740, customer_lon: 72.8880,
    customer_area: "Kurla",
    items: JSON.stringify(["shampoo","soap","toothpaste"]),
    assigned_warehouse_id: whIds["Kurla"], assigned_warehouse_name: "Kurla East Warehouse", assigned_warehouse_zone: "East",
    assigned_rider_id: riderIds["Santosh Mane"], assigned_rider_name: "Santosh Mane",
    warehouse_distance_km: 0.2, rider_distance_km: 0.3,
    algorithm_used: "smart-nearest",
    routing_reason: "Nearest warehouse (Kurla) at 10% load — rider Santosh Mane 0.3km away",
    status: "pending",
  },
];

for (const o of orders) insertOrder.run(o);
console.log(`  → ${orders.length} sample orders inserted`);

// ── Workflows ─────────────────────────────────────────────────
db.prepare(`
  INSERT INTO workflows (name, trigger, action, enabled)
  VALUES
    ('Alert when warehouse >80% load', 'load_threshold_80', 'notify_admin', 1),
    ('Auto-skip on 90% load',          'load_threshold_90', 'auto_rebalance', 1),
    ('Notify on no riders available',  'no_riders_available','notify_admin', 1)
`).run();

// ── Billing ───────────────────────────────────────────────────
db.prepare(`
  INSERT INTO billing (plan, amount, status, period_start, period_end)
  VALUES ('growth', 999, 'active', date('now','start of month'), date('now','start of month','+1 month'))
`).run();

db.close();
console.log("\n✅ Mumbai dark store network ready!\n");
