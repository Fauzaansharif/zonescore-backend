// server.js  —  ZoneScore Backend Entry Point
const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const morgan  = require("morgan");
const path    = require("path");
const fs      = require("fs");

// Auto-init DB on first run
const DB_PATH = path.join(__dirname, "db", "zonescore.db");
if (!fs.existsSync(DB_PATH)) {
  console.log("🔧 First run — initialising database…");
  require("./db/init");
}

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: [
    "https://darkstoreloadbalancer.vercel.app",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:5501",
  ],
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));
app.use(express.json());
app.use(morgan("dev"));

app.use("/api/warehouses", require("./routes/warehouses"));
app.use("/api/orders",     require("./routes/orders"));
app.use("/api/riders",     require("./routes/riders"));
app.use("/api/dashboard",  require("./routes/dashboard"));
app.use("/api/workflows",  require("./routes/workflows"));
app.use("/api/billing",    require("./routes/billing"));

app.get("/api/health", (req, res) =>
  res.json({ status: "ok", project: "ZoneScore", timestamp: new Date().toISOString() })
);

// Algorithm info — useful for viva documentation
app.get("/api/algorithms", (req, res) => {
  const { LOAD_THRESHOLD, RIDER_RADIUS_KM } = require("./algorithms");
  res.json({
    algorithms: [
      {
        id: "smart-nearest",
        name: "Smart Nearest (Primary)",
        description: "Geo-nearest warehouse first. Skips warehouses above LOAD_THRESHOLD. Assigns nearest available rider within RIDER_RADIUS_KM.",
        complexity: "O(n log n)",
        considers: ["customer distance", "warehouse load", "rider proximity"],
      },
      {
        id: "nearest",
        name: "Pure Nearest Warehouse",
        description: "Always assigns closest warehouse by Haversine distance. Ignores load.",
        complexity: "O(n)",
        considers: ["customer distance"],
      },
      {
        id: "round-robin",
        name: "Round Robin",
        description: "Cycles through active warehouses in sequence. Each gets a fair turn.",
        complexity: "O(1)",
        considers: ["fairness"],
      },
      {
        id: "weighted-round-robin",
        name: "Weighted Round Robin",
        description: "Proportional to capacity — larger warehouses get more orders.",
        complexity: "O(n)",
        considers: ["capacity weight"],
      },
      {
        id: "least-loaded",
        name: "Least Loaded",
        description: "Assigns to warehouse with most remaining free capacity.",
        complexity: "O(n)",
        considers: ["free capacity"],
      },
    ],
    config: { LOAD_THRESHOLD_PCT: LOAD_THRESHOLD, RIDER_RADIUS_KM },
  });
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🚀 ZoneScore → http://localhost:${PORT}`);
  console.log(`   Health    → http://localhost:${PORT}/api/health`);
  console.log(`   Algorithms→ http://localhost:${PORT}/api/algorithms\n`);
});
