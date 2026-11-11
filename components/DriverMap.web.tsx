import React, { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polyline from '@mapbox/polyline';

import {
  abicyclebDataUri, abicycleblDataUri, abicyclerDataUri,
  amotorbikebDataUri, amotorbikeblDataUri, amotorbikerDataUri,
  abusbDataUri, abusblDataUri, abusgDataUri, abuswDataUri,
  acarbDataUri, acarblDataUri, acargDataUri, acarrDataUri, acarwDataUri,
  aclosedbDataUri, aclosedblDataUri, aclosedgDataUri, aclosedrDataUri, aclosedwDataUri,
  aopenbDataUri, aopenblDataUri, aopengDataUri, aopenrDataUri, aopenwDataUri,
  atruckbDataUri, atruckblDataUri, atruckgDataUri, atruckrDataUri, atruckwDataUri,
} from './vehicleIconsBase64';

// Johannesburg default center
const DEFAULT_LAT = -15.3875;
const DEFAULT_LNG = 28.3228;

const VEHICLE_IMAGE_MAP: Record<string, Record<string, string>> = {
  bicycle: { b: abicyclebDataUri, bl: abicycleblDataUri, r: abicyclerDataUri },
  motorbike: { b: amotorbikebDataUri, bl: amotorbikeblDataUri, r: amotorbikerDataUri },
  bus: { b: abusbDataUri, bl: abusblDataUri, g: abusgDataUri, w: abuswDataUri },
  xxl: { b: abusbDataUri, bl: abusblDataUri, g: abusgDataUri, w: abuswDataUri },
  economy: { b: acarbDataUri, bl: acarblDataUri, g: acargDataUri, r: acarrDataUri, w: acarwDataUri },
  car: { b: acarbDataUri, bl: acarblDataUri, g: acargDataUri, r: acarrDataUri, w: acarwDataUri },
  truck: { b: aclosedbDataUri, bl: aclosedblDataUri, g: aclosedgDataUri, r: aclosedrDataUri, w: aclosedwDataUri },
  closed_truck: { b: aclosedbDataUri, bl: aclosedblDataUri, g: aclosedgDataUri, r: aclosedrDataUri, w: aclosedwDataUri },
  open_truck: { b: aopenbDataUri, bl: aopenblDataUri, g: aopengDataUri, r: aopenrDataUri, w: aopenwDataUri },
  refrigerated_truck: { b: atruckbDataUri, bl: atruckblDataUri, g: atruckgDataUri, r: atruckrDataUri, w: atruckwDataUri },
};
const DEFAULT_VEHICLE = VEHICLE_IMAGE_MAP.economy.b;

export interface MapMarker {
  id: string;
  type: string; // pickup | dropoff | stop | store
  lat: number;
  lng: number;
}

interface DriverMapProps {
  polyline?: string;
  trimmedPolyline?: string;
  vehiclePosition?: { lat: number; lng: number; heading: number };
  vehicleType?: string;
  vehicleColor?: string;
  markers?: MapMarker[];
  arrivalTime?: string | null;
  arrivalPosition?: { lat: number; lng: number } | null;
  // When true a trip is active: the map shows the route (fitBounds) and disables
  // the 20s idle auto-recenter. When false it centers on the vehicle on load and
  // auto-recenters after 20s idle. The user can always zoom/pan freely.
  hasActiveTrip?: boolean;
  onMapReady?: () => void;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

// Per-vehicle-type rotation offset (deg). Icons are authored north-up, so 0
// means heading 0 renders correctly. Mirror of DriverMapHtml.ts.
const VEHICLE_ROTATION_OFFSET: Record<string, number> = {
  bicycle: 0,
  motorbike: 0,
  economy: 0,
  car: 0,
  truck: 0,
  closed_truck: 0,
  open_truck: 0,
  refrigerated_truck: 0,
  bus: 0,
  xxl: 0,
};

const IDLE_RECENTER_MS = 20000;
const DEFAULT_FOLLOW_ZOOM = 16;

export default function DriverMap({
  polyline: encodedPolyline,
  vehiclePosition,
  vehicleType,
  vehicleColor,
  markers,
  arrivalTime,
  arrivalPosition,
  hasActiveTrip,
  onMapReady,
}: DriverMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isReadyRef = useRef(false);

  // Keep the decoded route immutable; derive each trimmed view from it.
  const fullCoordsRef = useRef<[number, number][]>([]);
  const currentCoordsRef = useRef<[number, number][]>([]);

  // Vehicle marker state
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const vehicleImgRef = useRef<HTMLImageElement | null>(null);
  const vehicleAnimRef = useRef<number | null>(null);
  const currentRotationRef = useRef<number | null>(null);
  const smoothedHeadingRef = useRef<number | null>(null);
  const lastVehicleHeadingRef = useRef(0);
  const lastVehicleTypeRef = useRef<string | undefined>(undefined);

  // Map of active markers keyed by id
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});

  // Arrival "Arrive by ..." card marker
  const arrivalCardRef = useRef<maplibregl.Marker | null>(null);

  // ---- Camera / interaction state ----
  const lastVehicleLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const didInitialCenterRef = useRef(false);
  const lastUserInteractionRef = useRef(0);
  const hasActiveTripRef = useRef(false);

  // Keep the trip-active flag in a ref the idle timer can read. Reset the idle
  // clock on entering a trip so we don't recenter the instant it ends.
  useEffect(() => {
    hasActiveTripRef.current = !!hasActiveTrip;
    if (hasActiveTrip) lastUserInteractionRef.current = Date.now();
  }, [hasActiveTrip]);

  const applyVehicleRotation = (heading?: number, type?: string) => {
    const img = vehicleImgRef.current;
    const map = mapRef.current;
    if (!img || !map || typeof heading !== 'number' || !Number.isFinite(heading)) return;
    const norm = (angle: number) => ((angle % 360) + 360) % 360;
    const offset = type && typeof VEHICLE_ROTATION_OFFSET[type] === 'number' ? VEHICLE_ROTATION_OFFSET[type] : 0;
    const target = norm(heading + offset - map.getBearing());
    if (smoothedHeadingRef.current === null) smoothedHeadingRef.current = target;
    const filterDelta = ((target - norm(smoothedHeadingRef.current) + 540) % 360) - 180;
    if (Math.abs(filterDelta) < 3) return;
    smoothedHeadingRef.current = norm(smoothedHeadingRef.current + 0.35 * filterDelta);
    if (currentRotationRef.current === null) currentRotationRef.current = smoothedHeadingRef.current;
    else currentRotationRef.current += ((norm(smoothedHeadingRef.current) - norm(currentRotationRef.current) + 540) % 360) - 180;
    img.style.transform = `rotate(${currentRotationRef.current}deg)`;
  };

  // Create / update / remove the arrival card pill marker
  const createArrivalCard = (time: string) => {
    const wrapper = document.createElement('div');
    wrapper.style.width = 'fit-content';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';
    wrapper.style.pointerEvents = 'none';

    const pill = document.createElement('div');
    pill.style.background = '#5B2EFF';
    pill.style.color = '#fff';
    pill.style.fontFamily = '-apple-system, system-ui, sans-serif';
    pill.style.fontSize = '14px';
    pill.style.fontWeight = '700';
    pill.style.padding = '8px 14px';
    pill.style.borderRadius = '9999px';
    pill.style.whiteSpace = 'nowrap';
    pill.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
    pill.textContent = `Arrive by ${time}`;

    const pointer = document.createElement('div');
    pointer.style.width = '0';
    pointer.style.height = '0';
    pointer.style.borderLeft = '6px solid transparent';
    pointer.style.borderRight = '6px solid transparent';
    pointer.style.borderTop = '7px solid #5B2EFF';
    pointer.style.marginTop = '-1px';

    wrapper.appendChild(pill);
    wrapper.appendChild(pointer);
    return wrapper;
  };

  // ---- Init map once ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm-layer', type: 'raster', source: 'osm' }],
      },
      center: [DEFAULT_LNG, DEFAULT_LAT],
      zoom: 14,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('load', () => {
      isReadyRef.current = true;
      onMapReady?.();
    });

    // Treat gesture-driven moves as interactions (e.originalEvent is set only on
    // user gestures, not programmatic camera moves) so idle-recenter backs off.
    const markInteraction = (e: any) => {
      if (e && e.originalEvent) lastUserInteractionRef.current = Date.now();
    };
    map.on('movestart', markInteraction);
    map.on('zoomstart', markInteraction);
    map.on('rotatestart', markInteraction);
    map.on('rotate', () => applyVehicleRotation(lastVehicleHeadingRef.current, lastVehicleTypeRef.current));
    map.on('dragstart', markInteraction);

    // Idle auto-recenter: no active trip + 20s without interaction -> ease back.
    const idleTimer = setInterval(() => {
      if (hasActiveTripRef.current) return;
      if (!didInitialCenterRef.current || !lastVehicleLatLngRef.current) return;
      if (Date.now() - lastUserInteractionRef.current >= IDLE_RECENTER_MS) {
        lastUserInteractionRef.current = Date.now();
        map.easeTo({
          center: [lastVehicleLatLngRef.current.lng, lastVehicleLatLngRef.current.lat],
          zoom: DEFAULT_FOLLOW_ZOOM,
          duration: 800,
        });
      }
    }, 1000);

    return () => {
      if (vehicleAnimRef.current) cancelAnimationFrame(vehicleAnimRef.current);
      clearInterval(idleTimer);
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
      isReadyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Draw / clear polyline + fit bounds ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (encodedPolyline) {
        const decoded = polyline.decode(encodedPolyline); // [[lat, lng], ...]
        const coords = decoded.map((p) => [p[1], p[0]]) as [number, number][];
        fullCoordsRef.current = coords;
        currentCoordsRef.current = coords;

        const data: GeoJSON.Feature = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        };

        const src = map.getSource('route-source') as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(data);
        } else {
          map.addSource('route-source', { type: 'geojson', data });
          map.addLayer({
            id: 'route-layer',
            type: 'line',
            source: 'route-source',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#5B2EFF', 'line-width': 5 },
          });
        }

        const bounds = new maplibregl.LngLatBounds();
        coords.forEach((c) => bounds.extend(c as [number, number]));
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: { top: 100, bottom: 320, left: 60, right: 60 },
            maxZoom: 15,
          });
        }
      } else {
        if (map.getLayer('route-layer')) map.removeLayer('route-layer');
        if (map.getSource('route-source')) map.removeSource('route-source');
        currentCoordsRef.current = [];
      }
    };

    if (isReadyRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedPolyline]);

  // ---- Update vehicle position (animated) + trim route ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !vehiclePosition) return;

    const run = () => {
      const { lat, lng, heading } = vehiclePosition;
      lastVehicleHeadingRef.current = heading;
      lastVehicleTypeRef.current = vehicleType;
      const typeMap = VEHICLE_IMAGE_MAP[vehicleType || 'economy'] || VEHICLE_IMAGE_MAP.economy;
    const imgUrl = typeMap[vehicleColor || 'b'] || typeMap.b || DEFAULT_VEHICLE;

      // Track latest position for the camera logic.
      lastVehicleLatLngRef.current = { lat, lng };

      // Center once on the vehicle when its position first becomes known.
      const centerOnce = () => {
        if (didInitialCenterRef.current || !lastVehicleLatLngRef.current) return;
        didInitialCenterRef.current = true;
        lastUserInteractionRef.current = Date.now();
        map.easeTo({
          center: [lastVehicleLatLngRef.current.lng, lastVehicleLatLngRef.current.lat],
          zoom: DEFAULT_FOLLOW_ZOOM,
          duration: 700,
        });
      };

      // Create marker on first update
      if (!vehicleMarkerRef.current) {
        const el = document.createElement('div');
        el.style.width = '44px';
        el.style.height = '44px';
        const img = document.createElement('img');
        img.src = imgUrl;
        img.style.width = '44px';
        img.style.height = '44px';
        img.style.objectFit = 'contain';
        img.style.transition = 'transform 0.2s ease';
        el.appendChild(img);
        vehicleImgRef.current = img;
        vehicleMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
        applyVehicleRotation(heading, vehicleType);
        centerOnce();
      } else {
        // keep image in sync if vehicle type changed
        if (vehicleImgRef.current && vehicleImgRef.current.src !== imgUrl) {
          vehicleImgRef.current.src = imgUrl;
        }

        // Rotate to face the direction of travel.
        applyVehicleRotation(heading, vehicleType);
        centerOnce();

        // Animate from current to new position over 1000ms ease-out-cubic
        const start = vehicleMarkerRef.current.getLngLat();
        const startLng = start.lng;
        const startLat = start.lat;
        const duration = 1000;
        let startTime: number | null = null;

        if (vehicleAnimRef.current) cancelAnimationFrame(vehicleAnimRef.current);

        const step = (ts: number) => {
          if (startTime === null) startTime = ts;
          const elapsed = ts - startTime;
          const t = Math.min(elapsed / duration, 1);
          const e = easeOutCubic(t);
          const curLng = startLng + (lng - startLng) * e;
          const curLat = startLat + (lat - startLat) * e;
          vehicleMarkerRef.current?.setLngLat([curLng, curLat]);
          if (t < 1) {
            vehicleAnimRef.current = requestAnimationFrame(step);
          }
        };
        vehicleAnimRef.current = requestAnimationFrame(step);
      }

      // Trim from the full route only when the vehicle is within 60m.
      const coords = fullCoordsRef.current;
      if (coords.length > 0) {
        let closestIdx = 0;
        let closestDist = Infinity;
        for (let i = 0; i < coords.length; i++) {
          const dLng = coords[i][0] - lng;
          const dLat = coords[i][1] - lat;
          const dist = dLng * dLng + dLat * dLat;
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = i;
          }
        }
        const closestDistanceMeters = Math.sqrt(closestDist) * 111320;
        const trimmed = closestDistanceMeters <= 60 ? coords.slice(closestIdx) : coords;
        currentCoordsRef.current = trimmed;
        const src = map.getSource('route-source') as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: trimmed },
          });
        }
      }

      // Camera is handled by the initial center + idle auto-recenter timer. We
      // no longer snap on every update, so the user can freely pan and zoom.
    };

    if (isReadyRef.current) {
      run();
    } else {
      map.once('load', run);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiclePosition, vehicleType, vehicleColor]);

  // ---- Diff + render markers ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const next = markers || [];
      const nextIds = new Set(next.map((m) => m.id));

      // Remove stale markers
      Object.keys(markersRef.current).forEach((id) => {
        if (!nextIds.has(id)) {
          markersRef.current[id].remove();
          delete markersRef.current[id];
        }
      });

      // Add new markers
      next.forEach((m) => {
        if (markersRef.current[m.id]) return; // already present

        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';

        const inner = document.createElement('div');
        inner.style.border = '3px solid #fff';
        inner.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';

        if (m.type === 'dropoff') {
          inner.style.width = '26px';
          inner.style.height = '26px';
          inner.style.background = '#5B2EFF';
          inner.style.borderRadius = '50% 50% 50% 0';
          inner.style.transform = 'rotate(-45deg)';
        } else if (m.type === 'store') {
          inner.style.width = '22px';
          inner.style.height = '22px';
          inner.style.background = '#F59E0B';
          inner.style.borderRadius = '50%';
        } else if (m.type === 'stop') {
          inner.style.width = '24px';
          inner.style.height = '24px';
          inner.style.background = '#5B2EFF';
          inner.style.borderRadius = '50%';
          inner.style.color = '#fff';
          inner.style.fontSize = '12px';
          inner.style.fontWeight = '700';
          inner.style.fontFamily = '-apple-system, system-ui, sans-serif';
          inner.style.display = 'flex';
          inner.style.alignItems = 'center';
          inner.style.justifyContent = 'center';
          inner.textContent = (m.id || '').toString().replace('stop-', '') || '';
        } else {
          // pickup (default)
          inner.style.width = '22px';
          inner.style.height = '22px';
          inner.style.background = '#5B2EFF';
          inner.style.borderRadius = '50%';
        }

        el.appendChild(inner);
        markersRef.current[m.id] = new maplibregl.Marker({ element: el })
          .setLngLat([m.lng, m.lat])
          .addTo(map);
      });
    };

    if (isReadyRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  // ---- Arrival card: create / update / remove ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // Remove existing card first
      if (arrivalCardRef.current) {
        arrivalCardRef.current.remove();
        arrivalCardRef.current = null;
      }
      if (!arrivalTime || !arrivalPosition) return;

      const el = createArrivalCard(arrivalTime);
      arrivalCardRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([arrivalPosition.lng, arrivalPosition.lat])
        .addTo(map);
    };

    if (isReadyRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalTime, arrivalPosition?.lat, arrivalPosition?.lng]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
