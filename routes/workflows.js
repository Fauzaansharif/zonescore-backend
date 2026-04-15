// routes/workflows.js
const express = require("express");
const router  = express.Router();
const { getDb } = require("../db/database");
const now = () => new Date().toISOString();

router.get("/", (req, res) => {
  try {
    const rows = getDb().prepare("SELECT * FROM workflows ORDER BY id DESC").all();
    res.json({ success: true, workflows: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/", (req, res) => {
  try {
    const { name, trigger, action, warehouse_id, enabled = 1 } = req.body;
    if (!name || !trigger || !action)
      return res.status(400).json({ error: "name, trigger, and action are required" });
    const db = getDb();
    const result = db.prepare(
      "INSERT INTO workflows (name, trigger, action, warehouse_id, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(name, trigger, action, warehouse_id || null, enabled ? 1 : 0, now(), now());
    const wf = db.prepare("SELECT * FROM workflows WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ success: true, workflow: wf });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/:id/toggle", (req, res) => {
  try {
    const db = getDb();
    const wf = db.prepare("SELECT * FROM workflows WHERE id = ?").get(req.params.id);
    if (!wf) return res.status(404).json({ error: "Workflow not found" });
    const newVal = wf.enabled ? 0 : 1;
    db.prepare("UPDATE workflows SET enabled = ?, updated_at = ? WHERE id = ?").run(newVal, now(), req.params.id);
    res.json({ success: true, enabled: !!newVal });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/:id", (req, res) => {
  try {
    getDb().prepare("DELETE FROM workflows WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: "Workflow deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
