// routes/warehouses.js  —  Fixed: uses zone + area columns (no city)
const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/database");

const now = () => new Date().toISOString();

// GET all warehouses
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const { status } = req.query;
    const rows = status
      ? db.prepare("SELECT * FROM warehouses WHERE status = ? ORDER BY zone, id").all(status)
      : db.prepare("SELECT * FROM warehouses ORDER BY zone, id").all();
    res.json({ success: true, count: rows.length, warehouses: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET single warehouse
router.get("/:id", (req, res) => {
  try {
    const row = getDb().prepare("SELECT * FROM warehouses WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Warehouse not found" });
    res.json({ success: true, warehouse: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create warehouse
// Body: { name, zone, area, latitude, longitude, capacity, status }
router.post("/", (req, res) => {
  try {
    const { name, zone, area, latitude, longitude, capacity, status } = req.body;

    if (!name || latitude == null || longitude == null || !capacity)
      return res.status(400).json({ error: "Required fields: name, latitude, longitude, capacity" });

    const db     = getDb();
    const result = db.prepare(`
      INSERT INTO warehouses
        (name, zone, area, latitude, longitude, capacity, current_orders, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      name,
      zone   || "Central",
      area   || "Mumbai",
      parseFloat(latitude),
      parseFloat(longitude),
      parseInt(capacity),
      status || "active",
      now(), now()
    );

    const warehouse = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ success: true, message: "Warehouse created", warehouse });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update warehouse
router.put("/:id", (req, res) => {
  try {
    const db       = getDb();
    const existing = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Warehouse not found" });

    const { name, zone, area, latitude, longitude, capacity, status } = req.body;

    db.prepare(`
      UPDATE warehouses
      SET name = ?, zone = ?, area = ?, latitude = ?, longitude = ?,
          capacity = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name     || existing.name,
      zone     || existing.zone,
      area     || existing.area,
      latitude  != null ? parseFloat(latitude)  : existing.latitude,
      longitude != null ? parseFloat(longitude) : existing.longitude,
      capacity  ? parseInt(capacity)            : existing.capacity,
      status   || existing.status,
      now(),
      req.params.id
    );

    res.json({ success: true, message: "Warehouse updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE warehouse
// Also nullifies FK references in orders and riders to avoid constraint failure
router.delete("/:id", (req, res) => {
  try {
    const db       = getDb();
    const existing = db.prepare("SELECT id FROM warehouses WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Warehouse not found" });

    // Nullify foreign key refs before deleting to avoid constraint error
    db.prepare("UPDATE orders SET assigned_warehouse_id = NULL WHERE assigned_warehouse_id = ?")
      .run(req.params.id);
    db.prepare("UPDATE riders SET home_warehouse_id = NULL WHERE home_warehouse_id = ?")
      .run(req.params.id);
    db.prepare("UPDATE workflows SET warehouse_id = NULL WHERE warehouse_id = ?")
      .run(req.params.id);

    db.prepare("DELETE FROM warehouses WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: "Warehouse deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH status only
router.patch("/:id/status", (req, res) => {
  try {
    const { status } = req.body;
    if (!["active","inactive","maintenance"].includes(status))
      return res.status(400).json({ error: "status must be: active | inactive | maintenance" });
    getDb().prepare("UPDATE warehouses SET status = ?, updated_at = ? WHERE id = ?")
           .run(status, now(), req.params.id);
    res.json({ success: true, message: `Status set to ${status}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
