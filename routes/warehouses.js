// routes/warehouses.js
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
      ? db.prepare("SELECT * FROM warehouses WHERE status = ? ORDER BY id DESC").all(status)
      : db.prepare("SELECT * FROM warehouses ORDER BY id DESC").all();
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
router.post("/", (req, res) => {
  try {
    const { name, city, latitude, longitude, capacity, status } = req.body;
    if (!name || latitude == null || longitude == null || !capacity)
      return res.status(400).json({ error: "Required: name, latitude, longitude, capacity" });

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO warehouses (name, city, latitude, longitude, capacity, current_orders, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(name, city || "Unknown", parseFloat(latitude), parseFloat(longitude),
           parseInt(capacity), status || "active", now(), now());

    const warehouse = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ success: true, message: "Warehouse created", warehouse });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update warehouse
router.put("/:id", (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Warehouse not found" });

    const { name, city, latitude, longitude, capacity, status } = req.body;
    db.prepare(`
      UPDATE warehouses SET
        name = ?, city = ?, latitude = ?, longitude = ?, capacity = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name || existing.name, city || existing.city,
      latitude != null ? parseFloat(latitude) : existing.latitude,
      longitude != null ? parseFloat(longitude) : existing.longitude,
      capacity ? parseInt(capacity) : existing.capacity,
      status || existing.status, now(), req.params.id
    );
    res.json({ success: true, message: "Warehouse updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE warehouse
router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT id FROM warehouses WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Warehouse not found" });
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
