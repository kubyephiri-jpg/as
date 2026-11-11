const toRadians = (degrees: number) => degrees * Math.PI / 180;

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export function bearingDegrees(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const fromLatRadians = toRadians(fromLat);
  const toLatRadians = toRadians(toLat);
  const dLng = toRadians(toLng - fromLng);
  const y = Math.sin(dLng) * Math.cos(toLatRadians);
  const x = Math.cos(fromLatRadians) * Math.sin(toLatRadians)
    - Math.sin(fromLatRadians) * Math.cos(toLatRadians) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
