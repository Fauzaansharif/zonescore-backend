// routes/dashboard.js
const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/database");

router.get("/stats", (req, res) => {
  try {
    const db         = getDb();
    const warehouses = db.prepare("SELECT * FROM warehouses").all();
    const orders     = db.prepare("SELECT * FROM orders").all();
    const riders     = db.prepare("SELECT * FROM riders").all();

    const active   = warehouses.filter(w => w.status === "active");
    const totalCap = active.reduce((s, w) => s + w.capacity, 0);
    const totalCur = active.reduce((s, w) => s + w.current_orders, 0);

    const statusBreakdown = { pending:0, rider_assigned:0, picked_up:0, delivered:0, cancelled:0 };
    const algoBreakdown   = {};
    const algoDistMap     = {};

    for (const o of orders) {
      if (statusBreakdown[o.status] !== undefined) statusBreakdown[o.status]++;
      const a = o.algorithm_used || "unknown";
      algoBreakdown[a] = (algoBreakdown[a] || 0) + 1;
      if (o.warehouse_distance_km) {
        if (!algoDistMap[a]) algoDistMap[a] = [];
        algoDistMap[a].push(o.warehouse_distance_km);
      }
    }

    const algoAvgDist = {};
    for (const [a, dists] of Object.entries(algoDistMap))
      algoAvgDist[a] = parseFloat((dists.reduce((x,y)=>x+y,0)/dists.length).toFixed(2));

    res.json({ success: true, stats: {
      totalWarehouses:         warehouses.length,
      activeWarehouses:        active.length,
      inactiveWarehouses:      warehouses.filter(w => w.status !== "active").length,
      totalOrders:             orders.length,
      totalCapacity:           totalCap,
      totalCurrentOrders:      totalCur,
      overallLoadPercent:      totalCap > 0 ? parseFloat(((totalCur/totalCap)*100).toFixed(1)) : 0,
      orderStatusBreakdown:    statusBreakdown,
      algorithmUsageBreakdown: algoBreakdown,
      algorithmAvgDistanceKm:  algoAvgDist,
      riderStats: {
        total:       riders.length,
        available:   riders.filter(r => r.status === "available").length,
        on_delivery: riders.filter(r => r.status === "on_delivery").length,
        offline:     riders.filter(r => r.status === "offline").length,
      },
    }});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/warehouse-load", (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare("SELECT * FROM warehouses ORDER BY zone, id").all();
    const warehouses = rows.map(w => {
      const pct             = w.capacity > 0 ? parseFloat(((w.current_orders/w.capacity)*100).toFixed(1)) : 0;
      const availableRiders = db.prepare(
        "SELECT COUNT(*) as c FROM riders WHERE home_warehouse_id = ? AND status = 'available'"
      ).get(w.id).c;
      return {
        ...w, loadPercent: pct,
        loadLevel: pct>=90?"critical":pct>=70?"high":pct>=40?"medium":"low",
        availableRiders,
      };
    });
    res.json({ success: true, warehouses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
