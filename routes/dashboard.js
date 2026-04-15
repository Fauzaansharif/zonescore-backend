// routes/dashboard.js
const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/database");

router.get("/stats", (req, res) => {
  try {
    const db = getDb();
    const warehouses = db.prepare("SELECT * FROM warehouses").all();
    const orders     = db.prepare("SELECT * FROM orders").all();
    const active     = warehouses.filter(w => w.status === "active");
    const totalCap   = active.reduce((s, w) => s + w.capacity, 0);
    const totalCur   = active.reduce((s, w) => s + w.current_orders, 0);

    const statusBreakdown = { pending:0, processing:0, dispatched:0, delivered:0, cancelled:0 };
    const algoBreakdown   = {};
    const algoDistMap     = {};

    for (const o of orders) {
      if (statusBreakdown[o.status] !== undefined) statusBreakdown[o.status]++;
      const a = o.algorithm_used || "unknown";
      algoBreakdown[a] = (algoBreakdown[a] || 0) + 1;
      if (o.distance_km) {
        if (!algoDistMap[a]) algoDistMap[a] = [];
        algoDistMap[a].push(o.distance_km);
      }
    }

    const algoAvgDist = {};
    for (const [a, dists] of Object.entries(algoDistMap))
      algoAvgDist[a] = parseFloat((dists.reduce((x,y)=>x+y,0)/dists.length).toFixed(2));

    res.json({ success: true, stats: {
      totalWarehouses: warehouses.length, activeWarehouses: active.length,
      inactiveWarehouses: warehouses.filter(w=>w.status!=="active").length,
      totalOrders: orders.length, totalCapacity: totalCap, totalCurrentOrders: totalCur,
      overallLoadPercent: totalCap > 0 ? parseFloat(((totalCur/totalCap)*100).toFixed(1)) : 0,
      orderStatusBreakdown: statusBreakdown, algorithmUsageBreakdown: algoBreakdown,
      algorithmAvgDistanceKm: algoAvgDist,
    }});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/warehouse-load", (req, res) => {
  try {
    const rows = getDb().prepare("SELECT * FROM warehouses ORDER BY id").all();
    const warehouses = rows.map(w => {
      const pct = w.capacity > 0 ? parseFloat(((w.current_orders/w.capacity)*100).toFixed(1)) : 0;
      return { ...w, loadPercent: pct,
        loadLevel: pct>=90?"critical":pct>=70?"high":pct>=40?"medium":"low" };
    });
    res.json({ success: true, warehouses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
