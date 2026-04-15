// ============================================================
//  algorithms.js  —  The 4 Load Balancing Algorithms
//  This is the academic core of the ZoneScore project.
// ============================================================

// ── Haversine Distance ────────────────────────────────────────
// Calculates real-world distance (km) between two GPS points.
// Accounts for Earth's curvature — more accurate than Euclidean.
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Algorithm 1: Nearest Warehouse ───────────────────────────
// Picks the warehouse closest (by Haversine) to the customer.
// Skips full or inactive warehouses.
// Time complexity: O(n)
function nearestWarehouse(warehouses, customerLat, customerLon) {
  let nearest = null;
  let minDist = Infinity;
  for (const wh of warehouses) {
    if (wh.status !== "active") continue;
    if (wh.current_orders >= wh.capacity) continue;
    const dist = haversineDistance(customerLat, customerLon, wh.latitude, wh.longitude);
    if (dist < minDist) {
      minDist = dist;
      nearest = { ...wh, distanceKm: parseFloat(dist.toFixed(2)) };
    }
  }
  return nearest;
}

// ── Algorithm 2: Round Robin ──────────────────────────────────
// Cycles through warehouses in order — each gets a fair turn.
// State stored in module-level variable (resets on server restart).
let rrIndex = 0;
function roundRobin(warehouses) {
  const active = warehouses.filter(
    (w) => w.status === "active" && w.current_orders < w.capacity
  );
  if (!active.length) return null;
  rrIndex = rrIndex % active.length;
  const selected = active[rrIndex];
  rrIndex = (rrIndex + 1) % active.length;
  return selected;
}

// ── Algorithm 3: Weighted Round Robin ────────────────────────
// Warehouses with larger capacity receive proportionally more orders.
// A warehouse with capacity 200 gets 2x orders vs one with capacity 100.
let wrrPointer = 0;
let wrrCurrentWeight = 0;
function weightedRoundRobin(warehouses) {
  const active = warehouses.filter(
    (w) => w.status === "active" && w.current_orders < w.capacity
  );
  if (!active.length) return null;
  const maxCap = Math.max(...active.map((w) => w.capacity));
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = active.reduce((acc, w) => gcd(acc, w.capacity), active[0].capacity);

  let iters = 0;
  while (iters < active.length * maxCap) {
    wrrPointer = wrrPointer % active.length;
    if (wrrCurrentWeight === 0) wrrCurrentWeight = maxCap;
    if (active[wrrPointer].capacity >= wrrCurrentWeight) {
      const sel = active[wrrPointer];
      wrrPointer = (wrrPointer + 1) % active.length;
      if (wrrPointer === 0) {
        wrrCurrentWeight -= g;
        if (wrrCurrentWeight <= 0) wrrCurrentWeight = 0;
      }
      return sel;
    }
    wrrPointer = (wrrPointer + 1) % active.length;
    iters++;
  }
  return leastLoaded(warehouses);
}

// ── Algorithm 4: Least Loaded ─────────────────────────────────
// Assigns to the warehouse with the most remaining free slots.
// Prevents any single warehouse from becoming a bottleneck.
// Time complexity: O(n)
function leastLoaded(warehouses) {
  const active = warehouses.filter(
    (w) => w.status === "active" && w.current_orders < w.capacity
  );
  if (!active.length) return null;
  return active.reduce((best, w) =>
    w.capacity - w.current_orders > best.capacity - best.current_orders ? w : best
  );
}

// ── Master Dispatcher ─────────────────────────────────────────
function assignWarehouse(warehouses, algorithm, customerLat, customerLon) {
  switch (algorithm) {
    case "nearest":              return nearestWarehouse(warehouses, customerLat, customerLon);
    case "round-robin":          return roundRobin(warehouses);
    case "weighted-round-robin": return weightedRoundRobin(warehouses);
    case "least-loaded":         return leastLoaded(warehouses);
    default:                     return nearestWarehouse(warehouses, customerLat, customerLon);
  }
}

module.exports = { assignWarehouse, haversineDistance, nearestWarehouse, roundRobin, weightedRoundRobin, leastLoaded };
