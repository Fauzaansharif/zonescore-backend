// routes/orders.js  —  Core load balancing dispatch
const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/database");
const { assignWarehouse } = require("../algorithms");

const now = () => new Date().toISOString();

// POST place order — runs the load balancing algorithm
router.post("/", (req, res) => {
  try {
    const { customerName, customerLat, customerLon, items, algorithm = "nearest" } = req.body;
    if (customerLat == null || customerLon == null)
      return res.status(400).json({ error: "customerLat and customerLon are required" });

    const db = getDb();
    const warehouses = db.prepare("SELECT * FROM warehouses WHERE status = 'active'").all();
    if (!warehouses.length) return res.status(503).json({ error: "No active warehouses" });

    const assigned = assignWarehouse(warehouses, algorithm, parseFloat(customerLat), parseFloat(customerLon));
    if (!assigned) return res.status(503).json({ error: "All warehouses at full capacity" });

    // Insert order
    const result = db.prepare(`
      INSERT INTO orders
        (customer_name, customer_lat, customer_lon, items,
         assigned_warehouse_id, assigned_warehouse_name, assigned_warehouse_city,
         distance_km, algorithm_used, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      customerName || "Guest",
      parseFloat(customerLat), parseFloat(customerLon),
      JSON.stringify(items || []),
      assigned.id, assigned.name, assigned.city,
      assigned.distanceKm || null, algorithm, now(), now()
    );

    // Increment warehouse counter
    db.prepare("UPDATE warehouses SET current_orders = current_orders + 1, updated_at = ? WHERE id = ?")
      .run(now(), assigned.id);

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({
      success: true,
      message: `Order assigned to ${assigned.name}`,
      order,
      algorithmUsed: algorithm,
      warehouseSelected: {
        id: assigned.id, name: assigned.name,
        city: assigned.city, distanceKm: assigned.distanceKm,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET all orders
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const { status, warehouseId, limit = 50 } = req.query;
    let sql = "SELECT * FROM orders WHERE 1=1";
    const params = [];
    if (status)      { sql += " AND status = ?";                params.push(status); }
    if (warehouseId) { sql += " AND assigned_warehouse_id = ?"; params.push(warehouseId); }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(parseInt(limit));
    const rows = db.prepare(sql).all(...params);
    res.json({ success: true, count: rows.length, orders: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET single order
router.get("/:id", (req, res) => {
  try {
    const row = getDb().prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Order not found" });
    res.json({ success: true, order: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH update order status
router.patch("/:id/status", (req, res) => {
  try {
    const { status } = req.body;
    const valid = ["pending","processing","dispatched","delivered","cancelled"];
    if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(", ")}` });

    const db = getDb();
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), req.params.id);

    // Decrement counter on completion
    if ((status === "delivered" || status === "cancelled") && order.assigned_warehouse_id) {
      db.prepare(`UPDATE warehouses SET
        current_orders = MAX(0, current_orders - 1), updated_at = ?
        WHERE id = ?`).run(now(), order.assigned_warehouse_id);
    }
    res.json({ success: true, message: `Order status → ${status}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST simulate — compare all 4 algorithms (no DB writes — demo only)
router.post("/simulate", (req, res) => {
  try {
    const { customerLat, customerLon } = req.body;
    if (customerLat == null || customerLon == null)
      return res.status(400).json({ error: "customerLat and customerLon required" });

    const db = getDb();
    const warehouses = db.prepare("SELECT * FROM warehouses WHERE status = 'active'").all();
    const algos = ["nearest", "round-robin", "weighted-round-robin", "least-loaded"];
    const results = {};

    for (const algo of algos) {
      const w = assignWarehouse(warehouses, algo, parseFloat(customerLat), parseFloat(customerLon));
      results[algo] = w
        ? { id: w.id, name: w.name, city: w.city, distanceKm: w.distanceKm || null,
            currentOrders: w.current_orders, capacity: w.capacity,
            loadPercent: Math.round((w.current_orders / w.capacity) * 100) }
        : null;
    }
    res.json({ success: true, customerLat, customerLon, algorithmComparison: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
