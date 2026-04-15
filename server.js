// ============================================================
//  server.js  —  ZoneScore Backend Entry Point
//  Node.js + Express + SQLite (better-sqlite3)
// ============================================================

const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const morgan  = require("morgan");
const path    = require("path");
const fs      = require("fs");

// Auto-init DB if it doesn't exist yet
const DB_PATH = path.join(__dirname, "db", "zonescore.db");
if (!fs.existsSync(DB_PATH)) {
  console.log("🔧 First run — initializing database...");
  require("./db/init");
}

const warehouseRoutes  = require("./routes/warehouses");
const orderRoutes      = require("./routes/orders");
const dashboardRoutes  = require("./routes/dashboard");
const workflowRoutes   = require("./routes/workflows");
const billingRoutes    = require("./routes/billing");

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: [
    "https://darkstoreloadbalancer.vercel.app",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5500",
  ],
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));
app.use(express.json());
app.use(morgan("dev"));

// ── Routes ───────────────────────────────────────────────────
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/orders",     orderRoutes);
app.use("/api/dashboard",  dashboardRoutes);
app.use("/api/workflows",  workflowRoutes);
app.use("/api/billing",    billingRoutes);

// ── Health ───────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", project: "ZoneScore", timestamp: new Date().toISOString() });
});

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// ── Error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🚀 ZoneScore backend → http://localhost:${PORT}`);
  console.log(`   Health → http://localhost:${PORT}/api/health\n`);
});
