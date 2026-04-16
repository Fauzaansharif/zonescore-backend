// ============================================================
//  algorithms.js  —  ZoneScore Load Balancing Algorithms
//
//  NEW: Smart Nearest (primary algorithm for dark stores)
//  Considers BOTH warehouse load AND rider proximity.
//
//  All 5 algorithms:
//   1. Smart Nearest  — geo-nearest + load-aware + rider-aware
//   2. Nearest Warehouse — pure geo distance (no load check)
//   3. Round Robin    — cyclic fair distribution
//   4. Weighted Round Robin — capacity-proportional
//   5. Least Loaded   — most free capacity
// ============================================================

// ── Haversine distance (km) ───────────────────────────────────
// Accounts for Earth's curvature. Far more accurate than
// straight-line Euclidean distance for GPS coordinates.
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

// ── Load percentage helper ────────────────────────────────────
function loadPct(wh) {
  return wh.capacity > 0
    ? Math.round((wh.current_orders / wh.capacity) * 100)
    : 100;
}

// ──────────────────────────────────────────────────────────────
//  ALGORITHM 1: Smart Nearest  (the main algorithm)
//
//  Logic:
//   a) Sort all active warehouses by distance to customer.
//   b) Try the nearest warehouse first.
//      - If its load < LOAD_THRESHOLD  → use it.
//      - If its load >= LOAD_THRESHOLD → try the next nearest.
//   c) From the selected warehouse, find the nearest
//      AVAILABLE rider (status = 'available').
//      - If a rider is within RIDER_RADIUS_KM → assign them.
//      - Otherwise → assign nearest available rider overall.
//   d) Returns the warehouse, chosen rider, distances,
//      and a human-readable routing_reason string.
//
//  LOAD_THRESHOLD: 80%  (configurable below)
//  RIDER_RADIUS_KM: 3 km preferred rider search radius
// ──────────────────────────────────────────────────────────────
const LOAD_THRESHOLD   = 80;   // % — skip warehouse if above this
const RIDER_RADIUS_KM  = 3;    // km — preferred rider proximity

function smartNearest(warehouses, riders, customerLat, customerLon) {
  // Only active warehouses that aren't full
  const active = warehouses
    .filter(w => w.status === "active" && w.current_orders < w.capacity)
    .map(w => ({
      ...w,
      distKm:  haversineDistance(customerLat, customerLon, w.latitude, w.longitude),
      loadPct: loadPct(w),
    }))
    .sort((a, b) => a.distKm - b.distKm);   // nearest first

  if (!active.length) return { error: "No active warehouses available" };

  // Available riders pool
  const availableRiders = (riders || [])
    .filter(r => r.status === "available");

  let chosenWarehouse = null;
  let routingReason   = "";
  const skipped       = [];

  for (const wh of active) {
    if (wh.loadPct < LOAD_THRESHOLD) {
      chosenWarehouse = wh;
      if (skipped.length === 0) {
        routingReason = `Nearest warehouse (${wh.name}) selected at ${wh.loadPct}% load`;
      } else {
        routingReason =
          `${skipped.map(s => `${s.name} overloaded (${s.pct}%)`).join(", ")} — ` +
          `rerouted to ${wh.name} (${wh.loadPct}% load, ${wh.distKm} km)`;
      }
      break;
    } else {
      skipped.push({ name: wh.name, pct: wh.loadPct, dist: wh.distKm });
    }
  }

  // If all warehouses are overloaded, use the least loaded active one
  if (!chosenWarehouse) {
    chosenWarehouse = active.reduce((best, wh) =>
      wh.loadPct < best.loadPct ? wh : best
    );
    routingReason =
      `All warehouses above ${LOAD_THRESHOLD}% load — ` +
      `assigned to least loaded: ${chosenWarehouse.name} (${chosenWarehouse.loadPct}%)`;
  }

  // ── Find best available rider ─────────────────────────────
  let chosenRider     = null;
  let riderDistKm     = null;
  let riderReason     = "";

  if (availableRiders.length > 0) {
    // Riders from the chosen warehouse first
    const homeRiders = availableRiders
      .filter(r => r.home_warehouse_id === chosenWarehouse.id)
      .map(r => ({
        ...r,
        distToWarehouseKm: haversineDistance(
          r.current_lat, r.current_lon,
          chosenWarehouse.latitude, chosenWarehouse.longitude
        ),
      }))
      .sort((a, b) => a.distToWarehouseKm - b.distToWarehouseKm);

    // Any rider within RIDER_RADIUS_KM of the warehouse
    const nearbyRiders = availableRiders
      .map(r => ({
        ...r,
        distToWarehouseKm: haversineDistance(
          r.current_lat, r.current_lon,
          chosenWarehouse.latitude, chosenWarehouse.longitude
        ),
      }))
      .filter(r => r.distToWarehouseKm <= RIDER_RADIUS_KM)
      .sort((a, b) => a.distToWarehouseKm - b.distToWarehouseKm);

    if (nearbyRiders.length > 0) {
      chosenRider = nearbyRiders[0];
      riderDistKm = chosenRider.distToWarehouseKm;
      riderReason = `Rider ${chosenRider.name} assigned (${riderDistKm} km from warehouse)`;
    } else if (homeRiders.length > 0) {
      // Fall back to nearest home-warehouse rider even if > radius
      chosenRider = homeRiders[0];
      riderDistKm = chosenRider.distToWarehouseKm;
      riderReason = `No rider within ${RIDER_RADIUS_KM} km — nearest home-rider ${chosenRider.name} assigned (${riderDistKm} km)`;
    } else {
      // Absolute fallback: any available rider
      const anyRider = availableRiders
        .map(r => ({
          ...r,
          distToWarehouseKm: haversineDistance(
            r.current_lat, r.current_lon,
            chosenWarehouse.latitude, chosenWarehouse.longitude
          ),
        }))
        .sort((a, b) => a.distToWarehouseKm - b.distToWarehouseKm)[0];
      if (anyRider) {
        chosenRider = anyRider;
        riderDistKm = anyRider.distToWarehouseKm;
        riderReason = `No nearby riders — dispatching ${anyRider.name} from ${riderDistKm} km away`;
      } else {
        riderReason = "No available riders — order queued at warehouse";
      }
    }
  } else {
    riderReason = "No available riders — order queued at warehouse";
  }

  return {
    warehouse:      chosenWarehouse,
    rider:          chosenRider,
    warehouseDistKm: chosenWarehouse.distKm,
    riderDistKm,
    routingReason:  `${routingReason}. ${riderReason}.`,
  };
}

// ──────────────────────────────────────────────────────────────
//  ALGORITHM 2: Pure Nearest Warehouse
//  Ignores load — always picks the closest active warehouse.
//  Academic comparison only.
// ──────────────────────────────────────────────────────────────
function nearestWarehouse(warehouses, customerLat, customerLon) {
  let best = null;
  let minDist = Infinity;
  for (const w of warehouses) {
    if (w.status !== "active" || w.current_orders >= w.capacity) continue;
    const d = haversineDistance(customerLat, customerLon, w.latitude, w.longitude);
    if (d < minDist) { minDist = d; best = { ...w, distKm: d }; }
  }
  return best;
}

// ── Round Robin state ─────────────────────────────────────────
let rrIndex = 0;

// ──────────────────────────────────────────────────────────────
//  ALGORITHM 3: Round Robin
//  Cycles through active warehouses in order.
// ──────────────────────────────────────────────────────────────
function roundRobin(warehouses) {
  const active = warehouses.filter(
    w => w.status === "active" && w.current_orders < w.capacity
  );
  if (!active.length) return null;
  rrIndex = rrIndex % active.length;
  const sel = active[rrIndex];
  rrIndex   = (rrIndex + 1) % active.length;
  return sel;
}

// ──────────────────────────────────────────────────────────────
//  ALGORITHM 4: Weighted Round Robin
//  Higher-capacity warehouses get proportionally more orders.
// ──────────────────────────────────────────────────────────────
let wrrPointer = 0;
let wrrWeight  = 0;

function weightedRoundRobin(warehouses) {
  const active = warehouses.filter(
    w => w.status === "active" && w.current_orders < w.capacity
  );
  if (!active.length) return null;
  const maxCap = Math.max(...active.map(w => w.capacity));
  const gcd    = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g      = active.reduce((acc, w) => gcd(acc, w.capacity), active[0].capacity);

  let iters = 0;
  while (iters < active.length * maxCap) {
    wrrPointer = wrrPointer % active.length;
    if (wrrWeight === 0) wrrWeight = maxCap;
    if (active[wrrPointer].capacity >= wrrWeight) {
      const sel  = active[wrrPointer];
      wrrPointer = (wrrPointer + 1) % active.length;
      if (wrrPointer === 0) { wrrWeight -= g; if (wrrWeight <= 0) wrrWeight = 0; }
      return sel;
    }
    wrrPointer = (wrrPointer + 1) % active.length;
    iters++;
  }
  return leastLoaded(warehouses);
}

// ──────────────────────────────────────────────────────────────
//  ALGORITHM 5: Least Loaded
//  Picks warehouse with the most remaining free capacity.
// ──────────────────────────────────────────────────────────────
function leastLoaded(warehouses) {
  const active = warehouses.filter(
    w => w.status === "active" && w.current_orders < w.capacity
  );
  if (!active.length) return null;
  return active.reduce((best, w) =>
    w.capacity - w.current_orders > best.capacity - best.current_orders ? w : best
  );
}

// ── Master dispatcher ─────────────────────────────────────────
function assignWarehouse(warehouses, riders, algorithm, customerLat, customerLon) {
  switch (algorithm) {
    case "smart-nearest":         return smartNearest(warehouses, riders, customerLat, customerLon);
    case "nearest":               return { warehouse: nearestWarehouse(warehouses, customerLat, customerLon) };
    case "round-robin":           return { warehouse: roundRobin(warehouses) };
    case "weighted-round-robin":  return { warehouse: weightedRoundRobin(warehouses) };
    case "least-loaded":          return { warehouse: leastLoaded(warehouses) };
    default:                      return smartNearest(warehouses, riders, customerLat, customerLon);
  }
}

module.exports = {
  assignWarehouse,
  smartNearest,
  nearestWarehouse,
  roundRobin,
  weightedRoundRobin,
  leastLoaded,
  haversineDistance,
  LOAD_THRESHOLD,
  RIDER_RADIUS_KM,
};
