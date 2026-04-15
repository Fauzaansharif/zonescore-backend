// routes/billing.js
const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/database");

router.get("/", (req, res) => {
  try {
    const row = getDb().prepare("SELECT * FROM billing ORDER BY id DESC LIMIT 1").get();
    res.json({ success: true, billing: row || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/upgrade", (req, res) => {
  try {
    const { plan } = req.body;
    const plans = { starter: 0, growth: 999, enterprise: 4999 };
    if (!plans.hasOwnProperty(plan))
      return res.status(400).json({ error: "plan must be: starter | growth | enterprise" });
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO billing (plan, amount, status, period_start, period_end, created_at) VALUES (?,?,?,?,?,?)"
    ).run(plan, plans[plan], "active",
          new Date().toISOString().slice(0,10),
          new Date(Date.now()+30*86400000).toISOString().slice(0,10), now);
    res.json({ success: true, message: `Upgraded to ${plan}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
