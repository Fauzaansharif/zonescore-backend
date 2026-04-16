// routes/riders.js  —  Rider management
const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/database");
const { haversineDistance } = require("../algorithms");

const now = () => new Date().toISOString();

// GET all riders (with optional status filter)
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const { status, warehouseId } = req.query;
    let sql = "SELECT * FROM riders WHERE 1=1";
    const params = [];
    if (status)      { sql += " AND status = ?";            params.push(status); }
    if (warehouseId) { sql += " AND home_warehouse_id = ?"; params.push(warehouseId); }
    sql += " ORDER BY id";
    const riders = db.prepare(sql).all(...params);
    res.json({ success: true, count: riders.length, riders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET single rider
router.get("/:id", (req, res) => {
  try {
    const rider = getDb().prepare("SELECT * FROM riders WHERE id = ?").get(req.params.id);
    if (!rider) return res.status(404).json({ error: "Rider not found" });
    res.json({ success: true, rider });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST add rider
router.post("/", (req, res) => {
  try {
    const { name, phone, home_warehouse_id, current_lat, current_lon, status } = req.body;
    if (!name || current_lat == null || current_lon == null)
      return res.status(400).json({ error: "name, current_lat, current_lon are required" });
    const db = getDb();
    const r  = db.prepare(`
      INSERT INTO riders (name, phone, home_warehouse_id, current_lat, current_lon, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(name, phone || null, home_warehouse_id || null,
           parseFloat(current_lat), parseFloat(current_lon),
           status || "available", now(), now());
    const rider = db.prepare("SELECT * FROM riders WHERE id = ?").get(r.lastInsertRowid);
    res.status(201).json({ success: true, rider });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH update rider location
router.patch("/:id/location", (req, res) => {
  try {
    const { current_lat, current_lon } = req.body;
    if (current_lat == null || current_lon == null)
      return res.status(400).json({ error: "current_lat and current_lon required" });
    getDb().prepare("UPDATE riders SET current_lat = ?, current_lon = ?, updated_at = ? WHERE id = ?")
      .run(parseFloat(current_lat), parseFloat(current_lon), now(), req.params.id);
    res.json({ success: true, message: "Location updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH update rider status
router.patch("/:id/status", (req, res) => {
  try {
    const { status } = req.body;
    const valid = ["available","on_delivery","offline"];
    if (!valid.includes(status))
      return res.status(400).json({ error: `status must be: ${valid.join(" | ")}` });
    getDb().prepare("UPDATE riders SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now(), req.params.id);
    res.json({ success: true, message: `Rider status → ${status}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE rider
router.delete("/:id", (req, res) => {
  try {
    getDb().prepare("DELETE FROM riders WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: "Rider deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/riders/nearby/:warehouseId — riders near a warehouse
router.get("/nearby/:warehouseId", (req, res) => {
  try {
    const db  = getDb();
    const wh  = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(req.params.warehouseId);
    if (!wh) return res.status(404).json({ error: "Warehouse not found" });
    const riders = db.prepare("SELECT * FROM riders WHERE status = 'available'").all();
    const nearby = riders
      .map(r => ({
        ...r,
        distanceKm: haversineDistance(r.current_lat, r.current_lon, wh.latitude, wh.longitude),
      }))
      .filter(r => r.distanceKm <= (parseFloat(req.query.radius) || 3))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    res.json({ success: true, warehouse: wh.name, nearbyRiders: nearby });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
