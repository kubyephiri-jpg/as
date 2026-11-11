// Self-contained MapLibre GL JS HTML page rendered inside a react-native-webview.
// Communicates with the React Native side via window.postMessage / ReactNativeWebView.postMessage.

import {
  abicyclebDataUri, abicycleblDataUri, abicyclerDataUri,
  amotorbikebDataUri, amotorbikeblDataUri, amotorbikerDataUri,
  abusbDataUri, abusblDataUri, abusgDataUri, abuswDataUri,
  acarbDataUri, acarblDataUri, acargDataUri, acarrDataUri, acarwDataUri,
  aclosedbDataUri, aclosedblDataUri, aclosedgDataUri, aclosedrDataUri, aclosedwDataUri,
  aopenbDataUri, aopenblDataUri, aopengDataUri, aopenrDataUri, aopenwDataUri,
  atruckbDataUri, atruckblDataUri, atruckgDataUri, atruckrDataUri, atruckwDataUri,
} from './vehicleIconsBase64';

// Vehicle type -> image source. The WebView loads inline HTML and cannot resolve
// bundled asset paths, so the icons are inlined as base64 data URIs. This
// guarantees the icon always loads regardless of network state.
const VEHICLE_IMAGE_MAP: Record<string, Record<string, string>> = {
 bicycle:{b:abicyclebDataUri,bl:abicycleblDataUri,r:abicyclerDataUri}, motorbike:{b:amotorbikebDataUri,bl:amotorbikeblDataUri,r:amotorbikerDataUri},
 bus:{b:abusbDataUri,bl:abusblDataUri,g:abusgDataUri,w:abuswDataUri}, xxl:{b:abusbDataUri,bl:abusblDataUri,g:abusgDataUri,w:abuswDataUri},
 economy:{b:acarbDataUri,bl:acarblDataUri,g:acargDataUri,r:acarrDataUri,w:acarwDataUri}, car:{b:acarbDataUri,bl:acarblDataUri,g:acargDataUri,r:acarrDataUri,w:acarwDataUri},
 truck:{b:aclosedbDataUri,bl:aclosedblDataUri,g:aclosedgDataUri,r:aclosedrDataUri,w:aclosedwDataUri}, closed_truck:{b:aclosedbDataUri,bl:aclosedblDataUri,g:aclosedgDataUri,r:aclosedrDataUri,w:aclosedwDataUri},
 open_truck:{b:aopenbDataUri,bl:aopenblDataUri,g:aopengDataUri,r:aopenrDataUri,w:aopenwDataUri}, refrigerated_truck:{b:atruckbDataUri,bl:atruckblDataUri,g:atruckgDataUri,r:atruckrDataUri,w:atruckwDataUri}
};
const DEFAULT_VEHICLE = VEHICLE_IMAGE_MAP.economy.b;
// Per-icon artwork correction in degrees. Use this to test artwork that faces
// east (90) or south (180); it corrects the icon itself without changing heading data.
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

export function getMapHtml(initialLat: number, initialLng: number): string {
  const vehicleMapJson = JSON.stringify(VEHICLE_IMAGE_MAP);
  const vehicleRotationJson = JSON.stringify(VEHICLE_ROTATION_OFFSET);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"></script>
  <script src="https://unpkg.com/@mapbox/polyline@1.1.1/src/polyline.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    #map { position: absolute; top: 0; bottom: 0; left: 0; right: 0; }

    /* Vehicle marker */
    .vehicle-marker { width: 44px; height: 44px; }
    .vehicle-marker img { width: 44px; height: 44px; object-fit: contain; transition: transform 0.5s linear; }

    /* Map markers */
    .map-marker { display: flex; align-items: center; justify-content: center; }
    .marker-pickup {
      width: 22px; height: 22px; border-radius: 50%;
      background: #5B2EFF; border: 3px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .marker-store {
      width: 22px; height: 22px; border-radius: 50%;
      background: #F59E0B; border: 3px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .marker-dropoff {
      width: 26px; height: 26px;
      background: #5B2EFF; border: 3px solid #fff;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .marker-stop {
      width: 24px; height: 24px; border-radius: 50%;
      background: #5B2EFF; border: 3px solid #fff;
      color: #fff; font-size: 12px; font-weight: 700;
      font-family: -apple-system, system-ui, sans-serif;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }

    /* Arrival card (pill + pointer) */
    .arrival-card-wrapper {
      width: fit-content;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
    }
    .arrival-card-pill {
      background: #5B2EFF;
      color: #fff;
      font-family: -apple-system, system-ui, sans-serif;
      font-size: 14px;
      font-weight: 700;
      padding: 8px 14px;
      border-radius: 9999px;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    }
    .arrival-card-pointer {
      width: 0; height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 7px solid #5B2EFF;
      margin-top: -1px;
    }

    @keyframes bounceIn {
      0% { transform: scale(0) translateY(-20px); opacity: 0; }
      60% { transform: scale(1.2) translateY(0); opacity: 1; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
    .bounce-in { animation: bounceIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
    /* dropoff is rotated, animate without overriding the rotation transform */
    @keyframes bounceInDrop {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    .marker-dropoff.bounce-in { animation: bounceInDrop 0.5s ease; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var VEHICLE_IMAGE_MAP = ${vehicleMapJson};
    var VEHICLE_ROTATION_OFFSET = ${vehicleRotationJson};
    var DEFAULT_VEHICLE = VEHICLE_IMAGE_MAP.economy.b;

    var map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm-layer', type: 'raster', source: 'osm' }]
      },
      center: [${initialLng}, ${initialLat}],
      zoom: 14,
      attributionControl: false
    });

    // ---- State ----
    var vehicleMarker = null;
    var vehicleEl = null;
    var vehicleImg = null;
    var vehicleAnimFrame = null;
    var fullCoords = [];      // immutable decoded route
    var currentCoords = [];   // current rendered route
    var markersMap = {};      // id -> maplibregl.Marker
    var arrivalCardMarker = null; // arrival "Arrive by ..." pill marker

    // ---- Camera / interaction state ----
    var lastVehicleLatLng = null;   // {lat, lng} latest known vehicle position
    var lastVehicleHeading = 0;     // latest heading in degrees
    var lastVehicleType = null;
    var currentRotation = null;     // unwrapped CSS rotation, avoids 359 -> 0 spins
    var smoothedHeading = null;     // low-pass filtered compass heading
    var didInitialCenter = false;   // have we centered on the vehicle once on load?
    var hasActiveTrip = false;      // when true, we never auto-recenter (route view wins)
    var lastUserInteraction = 0;    // ms timestamp of the last user gesture
    var IDLE_RECENTER_MS = 20000;   // auto-recenter after 20s of no interaction
    var DEFAULT_FOLLOW_ZOOM = 16;   // zoom used for initial + idle recenter

    function postToRN(obj) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    }

    // ---- Vehicle marker (create + smooth animate) ----
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    // Apply the shortest possible turn to an unwrapped rotation. Filtering the
    // heading first prevents noisy GPS updates from making the icon twitch.
    function applyVehicleRotation(heading, vehicleType) {
      if (!vehicleImg || typeof heading !== 'number' || !isFinite(heading)) return;
      var offset = (vehicleType && typeof VEHICLE_ROTATION_OFFSET[vehicleType] === 'number')
        ? VEHICLE_ROTATION_OFFSET[vehicleType] : 0;
      function norm(a) { return ((a % 360) + 360) % 360; }
      var target = norm(heading + offset - map.getBearing());
      if (smoothedHeading === null) smoothedHeading = target;
      var filterDelta = ((target - norm(smoothedHeading) + 540) % 360) - 180;
      if (Math.abs(filterDelta) < 3) return;
      smoothedHeading += 0.35 * filterDelta;
      smoothedHeading = ((smoothedHeading % 360) + 360) % 360;
      if (currentRotation === null) {
        currentRotation = smoothedHeading;
      } else {
        var delta = ((norm(smoothedHeading) - norm(currentRotation) + 540) % 360) - 180;
        currentRotation += delta;
      }
      vehicleImg.style.transform = 'rotate(' + currentRotation + 'deg)';
    }

    function updateVehicle(lat, lng, heading, vehicleType, color) {
      var group = VEHICLE_IMAGE_MAP[vehicleType] || VEHICLE_IMAGE_MAP.economy;
      var imgUrl = group[color] || group.b || DEFAULT_VEHICLE;

      // Track latest position/heading for the camera logic.
      lastVehicleLatLng = { lat: lat, lng: lng };
      if (typeof heading === 'number') lastVehicleHeading = heading;
      lastVehicleType = vehicleType;

      if (!vehicleMarker) {
        vehicleEl = document.createElement('div');
        vehicleEl.className = 'vehicle-marker';
        vehicleImg = document.createElement('img');
        vehicleImg.src = imgUrl;
        vehicleEl.appendChild(vehicleImg);
        vehicleMarker = new maplibregl.Marker({ element: vehicleEl })
          .setLngLat([lng, lat])
          .addTo(map);
        applyVehicleRotation(heading, vehicleType);
        // First time we know where the vehicle is: center on it once.
        maybeInitialCenter();
        return;
      }

      // keep image in sync if vehicle type changed
      if (vehicleImg && vehicleImg.src !== imgUrl) {
        vehicleImg.src = imgUrl;
      }

      // Rotate to face the direction of travel on every update.
      applyVehicleRotation(heading, vehicleType);

      // Center once if the marker existed before a position was known.
      maybeInitialCenter();

      var start = vehicleMarker.getLngLat();
      var startLng = start.lng;
      var startLat = start.lat;
      var endLng = lng;
      var endLat = lat;
      var duration = 1000;
      var startTime = null;

      if (vehicleAnimFrame) cancelAnimationFrame(vehicleAnimFrame);

      function step(ts) {
        if (startTime === null) startTime = ts;
        var elapsed = ts - startTime;
        var t = Math.min(elapsed / duration, 1);
        var e = easeOutCubic(t);
        var curLng = startLng + (endLng - startLng) * e;
        var curLat = startLat + (endLat - startLat) * e;
        vehicleMarker.setLngLat([curLng, curLat]);
        if (t < 1) {
          vehicleAnimFrame = requestAnimationFrame(step);
        }
      }
      vehicleAnimFrame = requestAnimationFrame(step);
    }

    // ---- Polyline ----
    function drawPolyline(encoded, color) {
      var decoded = polyline.decode(encoded); // [[lat, lng], ...]
      fullCoords = decoded.map(function (p) { return [p[1], p[0]]; }); // -> [lng, lat]
      currentCoords = fullCoords.slice();

      if (map.getLayer('route-layer')) map.removeLayer('route-layer');
      if (map.getSource('route-source')) map.removeSource('route-source');

      map.addSource('route-source', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: currentCoords }
        }
      });
      map.addLayer({
        id: 'route-layer',
        type: 'line',
        source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color || '#5B2EFF', 'line-width': 5 }
      });
    }

    function trimPolyline(driverLat, driverLng) {
      if (!fullCoords || fullCoords.length === 0) return;
      var closestIdx = 0;
      var closestDist = Infinity;
      for (var i = 0; i < fullCoords.length; i++) {
        var dLng = fullCoords[i][0] - driverLng;
        var dLat = fullCoords[i][1] - driverLat;
        var dist = dLng * dLng + dLat * dLat;
        if (dist < closestDist) { closestDist = dist; closestIdx = i; }
      }
      var closestDistanceMeters = Math.sqrt(closestDist) * 111320;
      currentCoords = closestDistanceMeters <= 60 ? fullCoords.slice(closestIdx) : fullCoords.slice();
      var src = map.getSource('route-source');
      if (src) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: currentCoords }
        });
      }
    }

    function clearPolyline() {
      if (map.getLayer('route-layer')) map.removeLayer('route-layer');
      if (map.getSource('route-source')) map.removeSource('route-source');
      currentCoords = [];
    }

    // ---- Markers ----
    function clearMarkers() {
      Object.keys(markersMap).forEach(function (id) {
        markersMap[id].remove();
      });
      markersMap = {};
    }

    function setMarkers(markers) {
      clearMarkers();
      if (!markers) return;
      markers.forEach(function (m) {
        var el = document.createElement('div');
        el.className = 'map-marker';
        var inner = document.createElement('div');
        if (m.type === 'pickup') {
          inner.className = 'marker-pickup bounce-in';
        } else if (m.type === 'store') {
          inner.className = 'marker-store bounce-in';
        } else if (m.type === 'dropoff') {
          inner.className = 'marker-dropoff bounce-in';
        } else if (m.type === 'stop') {
          inner.className = 'marker-stop bounce-in';
          var num = (m.id || '').toString().replace('stop-', '');
          inner.textContent = num || '';
        } else {
          inner.className = 'marker-pickup bounce-in';
        }
        el.appendChild(inner);
        var marker = new maplibregl.Marker({ element: el })
          .setLngLat([m.lng, m.lat])
          .addTo(map);
        markersMap[m.id] = marker;
      });
    }

    // ---- Arrival card ----
    function setArrivalCard(arrivalTime, lat, lng) {
      // Remove existing card first
      if (arrivalCardMarker) {
        arrivalCardMarker.remove();
        arrivalCardMarker = null;
      }
      if (!arrivalTime || typeof lat !== 'number' || typeof lng !== 'number') return;

      var wrapper = document.createElement('div');
      wrapper.className = 'arrival-card-wrapper';
      var pill = document.createElement('div');
      pill.className = 'arrival-card-pill';
      pill.textContent = 'Arrive by ' + arrivalTime;
      var pointer = document.createElement('div');
      pointer.className = 'arrival-card-pointer';
      wrapper.appendChild(pill);
      wrapper.appendChild(pointer);

      arrivalCardMarker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
    }

    // ---- Camera ----
    function fitBounds(coords) {
      if (!coords || coords.length === 0) return;
      var bounds = new maplibregl.LngLatBounds();
      coords.forEach(function (c) { bounds.extend(c); });
      map.fitBounds(bounds, {
        padding: { top: 100, bottom: 320, left: 60, right: 60 },
        maxZoom: 15
      });
    }

    function centerOn(lat, lng, zoom) {
      map.flyTo({ center: [lng, lat], zoom: zoom || 15 });
    }

    // Center on the vehicle exactly once when the dashboard first loads / the
    // vehicle position first becomes known. After this the user is free to pan
    // and zoom; we never fight their gestures.
    function maybeInitialCenter() {
      if (didInitialCenter || !lastVehicleLatLng) return;
      didInitialCenter = true;
      lastUserInteraction = Date.now();
      map.easeTo({
        center: [lastVehicleLatLng.lng, lastVehicleLatLng.lat],
        zoom: DEFAULT_FOLLOW_ZOOM,
        duration: 700,
      });
    }

    // Gentle recenter used by the 20s idle timer (only when there is no active
    // trip). Keeps the driver's current location in view without locking zoom.
    function recenterOnVehicle() {
      if (!lastVehicleLatLng) return;
      lastUserInteraction = Date.now();
      map.easeTo({
        center: [lastVehicleLatLng.lng, lastVehicleLatLng.lat],
        zoom: DEFAULT_FOLLOW_ZOOM,
        duration: 800,
      });
    }

    // Treat any user-driven map movement as an interaction so the idle timer
    // backs off and lets the driver zoom/pan freely. MapLibre sets
    // e.originalEvent on gesture-driven moves; programmatic camera moves don't.
    function markInteraction(e) {
      if (e && e.originalEvent) {
        lastUserInteraction = Date.now();
      }
    }
    map.on('movestart', markInteraction);
    map.on('zoomstart', markInteraction);
    map.on('rotatestart', markInteraction);
    map.on('rotate', function () { applyVehicleRotation(lastVehicleHeading, lastVehicleType); });
    map.on('dragstart', markInteraction);

    // Idle auto-recenter: when there is NO active trip and the user hasn't
    // touched the map for 20s, ease back to the vehicle's current location.
    setInterval(function () {
      if (hasActiveTrip) return;
      if (!didInitialCenter || !lastVehicleLatLng) return;
      if (Date.now() - lastUserInteraction >= IDLE_RECENTER_MS) {
        recenterOnVehicle();
      }
    }, 1000);

    // ---- Message bridge ----
    function handleMessage(raw) {
      var msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'UPDATE_VEHICLE':
          updateVehicle(msg.lat, msg.lng, msg.heading || 0, msg.vehicleType, msg.color);
          break;
        case 'DRAW_POLYLINE':
          drawPolyline(msg.encodedPolyline, msg.color);
          break;
        case 'TRIM_POLYLINE':
          trimPolyline(msg.driverLat, msg.driverLng);
          break;
        case 'CLEAR_POLYLINE':
          clearPolyline();
          break;
        case 'SET_MARKERS':
          setMarkers(msg.markers);
          break;
        case 'CLEAR_MARKERS':
          clearMarkers();
          break;
        case 'SET_ARRIVAL_CARD':
          setArrivalCard(msg.arrivalTime, msg.lat, msg.lng);
          break;
        case 'FIT_BOUNDS':
          fitBounds(msg.coords);
          break;
        case 'CENTER':
          centerOn(msg.lat, msg.lng, msg.zoom);
          break;
        case 'SET_TRIP_MODE':
          // RN tells us whether a trip is active. During a trip the route
          // FIT_BOUNDS view owns the camera and idle-recenter is disabled.
          hasActiveTrip = !!msg.active;
          if (hasActiveTrip) {
            // Reset the idle clock so we don't recenter right after a trip ends.
            lastUserInteraction = Date.now();
          }
          break;
        case 'RECENTER_VEHICLE':
          recenterOnVehicle();
          break;
      }
    }

    // React Native WebView (Android/iOS) delivers via document/window 'message'
    window.addEventListener('message', function (e) { handleMessage(e.data); });
    document.addEventListener('message', function (e) { handleMessage(e.data); });

    map.on('load', function () {
      postToRN({ type: 'MAP_READY' });
    });
  </script>
</body>
</html>`;
}
