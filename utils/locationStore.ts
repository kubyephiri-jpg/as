export type LocationSnapshot = {
  lat: number;
  lng: number;
  heading: number;
  ts: number;
};

type Listener = (location: LocationSnapshot | null) => void;

let currentLocation: LocationSnapshot | null = null;
const listeners = new Set<Listener>();

export function set(lat: number, lng: number, heading: number, ts: number) {
  currentLocation = { lat, lng, heading, ts };
  listeners.forEach((listener) => listener(currentLocation));
}

export function get(): LocationSnapshot | null {
  return currentLocation;
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
