// routes/orders.js  —  Rider-aware order dispatch
const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/database");
const { assignWarehouse, haversineDistance, LOAD_THRESHOLD, RIDER_RADIUS_KM } = require("../algorithms");

const now = () => new Date().toISOString();

// ── POST /api/orders ──────────────────────────────────────────
// Place a new order. Runs the selected algorithm.
// Body: { customerName, customerLat, customerLon, customerArea,
//         items, algorithm }
// algorithm: "smart-nearest" | "nearest" | "round-robin" |
//            "weighted-round-robin" | "least-loaded"
router.post("/", (req, res) => {
  try {
    const {
      customerName,
      customerLat,
      customerLon,
      customerArea,
      items,
      algorithm = "smart-nearest",
    } = req.body;

    if (customerLat == null || customerLon == null)
      return res.status(400).json({ error: "customerLat and customerLon are required" });

    const db         = getDb();
    const warehouses = db.prepare("SELECT * FROM warehouses WHERE status = 'active'").all();
    const riders     = db.prepare("SELECT * FROM riders").all();

    if (!warehouses.length)
      return res.status(503).json({ error: "No active warehouses" });

    const lat = parseFloat(customerLat);
    const lon = parseFloat(customerLon);

    const result = assignWarehouse(warehouses, riders, algorithm, lat, lon);

    if (result.error || !result.warehouse)
      return res.status(503).json({ error: result.error || "No warehouse available" });

    const wh    = result.warehouse;
    const rider = result.rider || null;

    // Insert order
    const insertResult = db.prepare(`
      INSERT INTO orders
        (customer_name, customer_lat, customer_lon, customer_area, items,
         assigned_warehouse_id, assigned_warehouse_name, assigned_warehouse_zone,
         assigned_rider_id, assigned_rider_name,
         warehouse_distance_km, rider_distance_km,
         algorithm_used, routing_reason, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)
    `).run(
      customerName || "Guest", lat, lon, customerArea || "Unknown",
      JSON.stringify(items || []),
      wh.id, wh.name, wh.zone || wh.area || "—",
      rider ? rider.id   : null,
      rider ? rider.name : null,
      result.warehouseDistKm || null,
      result.riderDistKm     || null,
      algorithm,
      result.routingReason   || null,
      now(), now()
    );

    // Increment warehouse order counter
    db.prepare("UPDATE warehouses SET current_orders = current_orders + 1, updated_at = ? WHERE id = ?")
      .run(now(), wh.id);

    // Mark rider as on_delivery
    if (rider) {
      db.prepare("UPDATE riders SET status = 'on_delivery', active_order_id = ?, updated_at = ? WHERE id = ?")
        .run(insertResult.lastInsertRowid, now(), rider.id);
    }

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(insertResult.lastInsertRowid);

    res.status(201).json({
      success: true,
      message: `Order #${order.id} assigned to ${wh.name}`,
      order,
      algorithmUsed:    algorithm,
      warehouseSelected: { id: wh.id, name: wh.name, zone: wh.zone, distanceKm: result.warehouseDistKm, loadPct: Math.round((wh.current_orders / wh.capacity) * 100) },
      riderAssigned:     rider ? { id: rider.id, name: rider.name, distanceKm: result.riderDistKm } : null,
      routingReason:     result.routingReason,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/orders ───────────────────────────────────────────
router.get("/", (req, res) => {
  try {
    const { status, warehouseId, limit = 50 } = req.query;
    const db = getDb();
    let sql = "SELECT * FROM orders WHERE 1=1";
    const params = [];
    if (status)      { sql += " AND status = ?";                params.push(status); }
    if (warehouseId) { sql += " AND assigned_warehouse_id = ?"; params.push(warehouseId); }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(parseInt(limit));
    const orders = db.prepare(sql).all(...params);
    res.json({ success: true, count: orders.length, orders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/orders/:id ───────────────────────────────────────
router.get("/:id", (req, res) => {
  try {
    const order = getDb().prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ success: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/orders/:id/status ─────────────────────────────
router.patch("/:id/status", (req, res) => {
  try {
    const { status } = req.body;
    const valid = ["pending","rider_assigned","picked_up","delivered","cancelled"];
    if (!valid.includes(status))
      return res.status(400).json({ error: `status must be one of: ${valid.join(", ")}` });

    const db    = getDb();
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now(), req.params.id);

    // On completion, decrement warehouse counter and free rider
    if (status === "delivered" || status === "cancelled") {
      if (order.assigned_warehouse_id) {
        db.prepare("UPDATE warehouses SET current_orders = MAX(0, current_orders - 1), updated_at = ? WHERE id = ?")
          .run(now(), order.assigned_warehouse_id);
      }
      if (order.assigned_rider_id) {
        db.prepare("UPDATE riders SET status = 'available', active_order_id = NULL, updated_at = ? WHERE id = ?")
          .run(now(), order.assigned_rider_id);
      }
    }

    res.json({ success: true, message: `Order status → ${status}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/orders/simulate ─────────────────────────────────
// Compare all algorithms for same customer — NO DB writes
router.post("/simulate", (req, res) => {
  try {
    const { customerLat, customerLon } = req.body;
    if (customerLat == null || customerLon == null)
      return res.status(400).json({ error: "customerLat and customerLon required" });

    const db         = getDb();
    const warehouses = db.prepare("SELECT * FROM warehouses WHERE status = 'active'").all();
    const riders     = db.prepare("SELECT * FROM riders").all();
    const lat = parseFloat(customerLat);
    const lon = parseFloat(customerLon);

    const algorithms = [
      "smart-nearest", "nearest", "round-robin",
      "weighted-round-robin", "least-loaded",
    ];
    const results = {};

    for (const algo of algorithms) {
      const r = assignWarehouse(warehouses, riders, algo, lat, lon);
      const w = r.warehouse || null;
      results[algo] = w
        ? {
            warehouseId:    w.id,
            name:           w.name,
            zone:           w.zone || w.area,
            distanceKm:     r.warehouseDistKm || haversineDistance(lat, lon, w.latitude, w.longitude),
            currentOrders:  w.current_orders,
            capacity:       w.capacity,
            loadPct:        Math.round((w.current_orders / w.capacity) * 100),
            rider:          r.rider ? { id: r.rider.id, name: r.rider.name, distKm: r.riderDistKm } : null,
            routingReason:  r.routingReason || null,
          }
        : { error: r.error || "No warehouse available" };
    }

    res.json({
      success: true,
      customerLat: lat, customerLon: lon,
      loadThresholdPct: LOAD_THRESHOLD,
      riderRadiusKm:    RIDER_RADIUS_KM,
      algorithmComparison: results,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
