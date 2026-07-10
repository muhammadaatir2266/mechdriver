export function distanceKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null)) return Number.POSITIVE_INFINITY;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateEtaMinutes(km, speedKmh = 35) {
  if (!Number.isFinite(km) || km <= 0) return 0;
  return Math.max(1, Math.ceil((km / speedKmh) * 60));
}

export function chatIdFor(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Map Prisma enum to Android-friendly display strings */
export const STATUS_LABEL = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  ON_THE_WAY: 'On the Way',
  ARRIVED: 'Arrived',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const ROLE_LABEL = {
  USER: 'User',
  MECHANIC: 'Mechanic',
  ADMIN: 'Admin',
};

export function serializeRequest(r) {
  if (!r) return null;
  return {
    id: r.id,
    driverId: r.driverId,
    mechanicId: r.mechanicId,
    driverName: r.driverName,
    mechanicName: r.mechanicName,
    status: STATUS_LABEL[r.status] || r.status,
    statusCode: r.status,
    issueType: r.issueType,
    notes: r.notes,
    location: { lat: r.userLat, lng: r.userLng },
    mechanicLocation:
      r.mechanicLat != null && r.mechanicLng != null
        ? { lat: r.mechanicLat, lng: r.mechanicLng }
        : null,
    distanceKm: r.distanceKm,
    etaMinutes: r.etaMinutes,
    acceptedAt: r.acceptedAt,
    completedAt: r.completedAt,
    timestamp: r.createdAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
