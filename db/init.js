// ============================================================
//  db/init.js  —  Creates all tables and seeds sample data
//  Run once:  node db/init.js
//  Safe to re-run: uses CREATE TABLE IF NOT EXISTS
// ============================================================

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "zonescore.db");
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

console.log("📦 Initializing ZoneScore database...");

// ── Create Tables ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS warehouses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    city        TEXT    DEFAULT 'Unknown',
    latitude    REAL    NOT NULL,
    longitude   REAL    NOT NULL,
    capacity    INTEGER NOT NULL DEFAULT 100,
    current_orders INTEGER NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','inactive','maintenance')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name         TEXT    DEFAULT 'Guest',
    customer_lat          REAL    NOT NULL,
    customer_lon          REAL    NOT NULL,
    items                 TEXT    DEFAULT '[]',
    assigned_warehouse_id INTEGER REFERENCES warehouses(id),
    assigned_warehouse_name TEXT,
    assigned_warehouse_city TEXT,
    distance_km           REAL,
    algorithm_used        TEXT    DEFAULT 'nearest',
    status                TEXT    NOT NULL DEFAULT 'pending'
                                  CHECK(status IN ('pending','processing','dispatched','delivered','cancelled')),
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    trigger     TEXT    NOT NULL,
    action      TEXT    NOT NULL,
    warehouse_id INTEGER REFERENCES warehouses(id),
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS billing (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    plan        TEXT    NOT NULL DEFAULT 'starter',
    amount      REAL    NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','cancelled','past_due')),
    period_start TEXT,
    period_end   TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Seed sample warehouses (only if table is empty) ──────────
const count = db.prepare("SELECT COUNT(*) as c FROM warehouses").get().c;

if (count === 0) {
  console.log("🌱 Seeding sample warehouses...");

  const insert = db.prepare(`
    INSERT INTO warehouses (name, city, latitude, longitude, capacity, current_orders, status)
    VALUES (@name, @city, @latitude, @longitude, @capacity, @current_orders, @status)
  `);

  const warehouses = [
    { name: "Mumbai Central Dark Store",  city: "Mumbai",    latitude: 19.0760, longitude: 72.8777, capacity: 120, current_orders: 45, status: "active" },
    { name: "Andheri North Hub",          city: "Mumbai",    latitude: 19.1136, longitude: 72.8697, capacity: 80,  current_orders: 12, status: "active" },
    { name: "Pune West Fulfillment",      city: "Pune",      latitude: 18.5204, longitude: 73.8567, capacity: 100, current_orders: 73, status: "active" },
    { name: "Thane East Dark Store",      city: "Thane",     latitude: 19.2183, longitude: 72.9781, capacity: 60,  current_orders: 58, status: "active" },
    { name: "Navi Mumbai Hub",            city: "Navi Mumbai", latitude: 19.0330, longitude: 73.0297, capacity: 90, current_orders: 5, status: "active" },
    { name: "Delhi NCR Warehouse",        city: "Delhi",     latitude: 28.6139, longitude: 77.2090, capacity: 150, current_orders: 30, status: "active" },
    { name: "Bangalore Koramangala Store",city: "Bangalore", latitude: 12.9352, longitude: 77.6245, capacity: 100, current_orders: 0,  status: "inactive" },
  ];

  for (const w of warehouses) insert.run(w);

  // Seed sample orders
  const insertOrder = db.prepare(`
    INSERT INTO orders (customer_name, customer_lat, customer_lon, items, assigned_warehouse_id, assigned_warehouse_name, assigned_warehouse_city, distance_km, algorithm_used, status)
    VALUES (@customer_name, @customer_lat, @customer_lon, @items, @assigned_warehouse_id, @assigned_warehouse_name, @assigned_warehouse_city, @distance_km, @algorithm_used, @status)
  `);

  const orders = [
    { customer_name: "Rahul Sharma",  customer_lat: 19.09, customer_lon: 72.88, items: '["milk","bread"]',       assigned_warehouse_id: 1, assigned_warehouse_name: "Mumbai Central Dark Store", assigned_warehouse_city: "Mumbai", distance_km: 1.4, algorithm_used: "nearest",              status: "delivered"  },
    { customer_name: "Priya Menon",   customer_lat: 19.11, customer_lon: 72.86, items: '["eggs","butter"]',      assigned_warehouse_id: 2, assigned_warehouse_name: "Andheri North Hub",          assigned_warehouse_city: "Mumbai", distance_km: 0.3, algorithm_used: "round-robin",          status: "dispatched" },
    { customer_name: "Aditya Kumar",  customer_lat: 18.53, customer_lon: 73.85, items: '["rice","dal"]',         assigned_warehouse_id: 3, assigned_warehouse_name: "Pune West Fulfillment",       assigned_warehouse_city: "Pune",   distance_km: 1.1, algorithm_used: "least-loaded",         status: "processing" },
    { customer_name: "Sara Khan",     customer_lat: 19.22, customer_lon: 72.97, items: '["shampoo","soap"]',     assigned_warehouse_id: 4, assigned_warehouse_name: "Thane East Dark Store",        assigned_warehouse_city: "Thane",  distance_km: 0.5, algorithm_used: "weighted-round-robin", status: "pending"    },
    { customer_name: "Vikram Singh",  customer_lat: 19.04, customer_lon: 73.02, items: '["vegetables","fruits"]',assigned_warehouse_id: 5, assigned_warehouse_name: "Navi Mumbai Hub",              assigned_warehouse_city: "Navi Mumbai", distance_km: 0.8, algorithm_used: "nearest",         status: "delivered"  },
  ];

  for (const o of orders) insertOrder.run(o);

  // Seed a workflow
  db.prepare(`
    INSERT INTO workflows (name, trigger, action, warehouse_id, enabled)
    VALUES ('Auto-rebalance on 80% load', 'load_threshold_80', 'notify_admin', NULL, 1)
  `).run();

  // Seed billing
  db.prepare(`
    INSERT INTO billing (plan, amount, status, period_start, period_end)
    VALUES ('growth', 999, 'active', date('now', 'start of month'), date('now', 'start of month', '+1 month'))
  `).run();

  console.log("✅ Sample data seeded!");
}

db.close();
console.log(`\n✅ Database ready at: ${DB_PATH}`);
console.log("   Run: npm run dev\n");
