import { ZONES } from './campaign-data.js';

const hub = ZONES.find(zone => zone.id === 'refuge') || ZONES[0];
const pantry = ZONES.find(zone => zone.id === 'pantry');
export const PANTRY_PLATFORM = Object.freeze({ height: 1.5, halfWidth: 8.2, back: -9.2, front: -3.5, rampEnd: .8, doorHalfWidth: 2.5, rampHalfWidth: 5.5 });

export function pantryFloorAt(x, z) {
  const p = PANTRY_PLATFORM;
  if (Math.abs(x) <= p.halfWidth && z >= p.back && z <= p.front) return p.height;
  if (z < p.front || z > p.rampEnd) return 0;
  return Math.max(0, Math.min(p.height * (p.rampEnd - z) / (p.rampEnd - p.front), p.height * (p.rampHalfWidth - Math.abs(x)) / (p.rampHalfWidth - p.doorHalfWidth)));
}
const districts = ZONES.filter(zone => zone.id !== hub.id).sort((a, b) => {
  const bearing = zone => (Math.atan2(zone.x - hub.x, hub.z - zone.z) + Math.PI * 2) % (Math.PI * 2);
  return bearing(a) - bearing(b);
});

export const ROUTES = [
  ...districts.map(zone => ({ id: 'spoke_' + zone.id, a: hub, b: zone, width: 4.8, halfWidth: 2.4, flag: null })),
  ...districts.map((zone, index) => ({ id: 'shortcut_' + zone.id, a: zone, b: districts[(index + 1) % districts.length], width: 4.8, halfWidth: 2.4, flag: 'shortcut_' + zone.id })),
];

// Rail centers sit inside the existing 4.8m deck; the body stays 0.25m inside them.
export const BRIDGE_RAIL_OFFSET = 2.15;
const BODY_RADIUS = .25;

export function slideBridgeMove(from, desired, flags = []) {
  const result = { x: desired.x, z: desired.z, normal: null };
  // Islands and bridge mouths remain open, including ordinary island-edge falls.
  if (ZONES.some(zone => Math.hypot(desired.x - zone.x, desired.z - zone.z) <= zone.radius)) return result;
  const known = flags instanceof Set ? flags : new Set(flags);
  for (const route of ROUTES) {
    if (route.flag && !known.has(route.flag)) continue;
    const dx = route.b.x - route.a.x, dz = route.b.z - route.a.z, length = Math.hypot(dx, dz);
    const ux = dx / length, uz = dz / length, nx = uz, nz = -ux;
    const fromAlong = (from.x - route.a.x) * ux + (from.z - route.a.z) * uz;
    const fromSide = (from.x - route.a.x) * nx + (from.z - route.a.z) * nz;
    const along = (desired.x - route.a.x) * ux + (desired.z - route.a.z) * uz;
    const side = (desired.x - route.a.x) * nx + (desired.z - route.a.z) * nz;
    if (fromAlong < 0 || fromAlong > length || Math.abs(fromSide) > route.halfWidth + 1e-9) continue;
    const start = Math.sqrt(route.a.radius ** 2 - BRIDGE_RAIL_OFFSET ** 2);
    const end = length - Math.sqrt(route.b.radius ** 2 - BRIDGE_RAIL_OFFSET ** 2);
    if (along < start || along > end) continue;
    const limit = BRIDGE_RAIL_OFFSET - BODY_RADIUS;
    // An older save may already overlap a new rail. Let it move inward without snapping it.
    const outer = route.halfWidth - 1e-8;
    const bounded = Math.max(-outer, Math.min(outer, Math.max(Math.min(-limit, fromSide), Math.min(Math.max(limit, fromSide), side))));
    if (Math.abs(bounded - side) < 1e-9) continue;
    const direction = Math.sign(side - bounded);
    return { x: desired.x + nx * (bounded - side), z: desired.z + nz * (bounded - side), normal: { x: nx * direction, z: nz * direction } };
  }
  return result;
}

export function heightAt(x, z, flags = []) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  for (const zone of ZONES) if (Math.hypot(x - zone.x, z - zone.z) <= zone.radius) return zone.id === pantry.id ? pantryFloorAt(x - pantry.x, z - pantry.z) : 0;
  const known = flags instanceof Set ? flags : new Set(flags);
  for (const route of ROUTES) {
    if (route.flag && !known.has(route.flag)) continue;
    const dx = route.b.x - route.a.x, dz = route.b.z - route.a.z;
    const t = Math.max(0, Math.min(1, ((x - route.a.x) * dx + (z - route.a.z) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(x - route.a.x - dx * t, z - route.a.z - dz * t) <= route.halfWidth) return 0;
  }
  return null;
}
