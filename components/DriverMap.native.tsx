import React, { useRef, useState, useEffect } from 'react';
import { StyleSheet, Platform, View } from 'react-native';
import { WebView } from 'react-native-webview';
import polyline from '@mapbox/polyline';
import { getMapHtml } from './DriverMapHtml';

// Johannesburg default center
const DEFAULT_LAT = -15.3875;
const DEFAULT_LNG = 28.3228;

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
  driverId?: string;
  markers?: MapMarker[];
  arrivalTime?: string | null;
  arrivalPosition?: { lat: number; lng: number } | null;
  // When true a trip is active: the map shows the whole route (FIT_BOUNDS) and
  // disables the 20s idle auto-recenter. When false the map centers on the
  // vehicle on load and auto-recenters after 20s of no interaction.
  hasActiveTrip?: boolean;
  onMapReady?: () => void;
}

export default function DriverMap({
  polyline: encodedPolyline,
  trimmedPolyline,
  vehiclePosition,
  vehicleType,
  vehicleColor,
  markers,
  arrivalTime,
  arrivalPosition,
  hasActiveTrip,
  onMapReady,
}: DriverMapProps) {
  const webViewRef = useRef<WebView>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [lastKnownPosition, setLastKnownPosition] = useState<{ lat: number; lng: number; heading: number } | null>(null);

  useEffect(() => {
    if (vehiclePosition) setLastKnownPosition(vehiclePosition);
  }, [vehiclePosition]);

  // Stable HTML so the WebView doesn't reload on every render
  const htmlRef = useRef<string>(getMapHtml(DEFAULT_LAT, DEFAULT_LNG));

  const sendCommand = (obj: object) => {
    const payload = JSON.stringify(obj);
    webViewRef.current?.injectJavaScript(
      `window.postMessage(${JSON.stringify(payload)}, '*'); true;`
    );
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setIsMapReady(true);
        onMapReady?.();
      }
    } catch (e) {
      // ignore malformed messages
    }
  };

  // Draw polyline + fit bounds when polyline changes
  useEffect(() => {
    if (!isMapReady) return;
    if (encodedPolyline) {
      sendCommand({ type: 'DRAW_POLYLINE', encodedPolyline, color: '#5B2EFF' });
      try {
        const decoded = polyline.decode(encodedPolyline); // [[lat, lng], ...]
        const coords = decoded.map((p) => [p[1], p[0]]); // -> [lng, lat]
        sendCommand({ type: 'FIT_BOUNDS', coords });
      } catch (e) {
        // ignore decode errors
      }
    } else {
      sendCommand({ type: 'CLEAR_POLYLINE' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedPolyline, isMapReady]);

  // Update vehicle position + trim polyline
  useEffect(() => {
    if (!isMapReady) return;
    const effectivePosition = vehiclePosition || lastKnownPosition || { lat: DEFAULT_LAT, lng: DEFAULT_LNG, heading: 0 };
    sendCommand({
      type: 'UPDATE_VEHICLE',
      lat: effectivePosition.lat,
      lng: effectivePosition.lng,
      heading: effectivePosition.heading,
      vehicleType: vehicleType || 'economy',
      color: vehicleColor || 'b',
    });
    sendCommand({
      type: 'TRIM_POLYLINE',
      driverLat: effectivePosition.lat,
      driverLng: effectivePosition.lng,
    });
    // Camera is handled inside the WebView: it centers on the vehicle once on
    // load and auto-recenters after 20s idle (when no active trip). We no longer
    // snap the camera on every position update, so the driver can freely zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiclePosition, vehicleType, vehicleColor, isMapReady]);

  // Tell the map whether a trip is active so it knows when the route overview
  // (FIT_BOUNDS) owns the camera vs. the idle auto-recenter behavior.
  useEffect(() => {
    if (!isMapReady) return;
    sendCommand({ type: 'SET_TRIP_MODE', active: !!hasActiveTrip });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveTrip, isMapReady]);

  // Update markers
  useEffect(() => {
    if (!isMapReady) return;
    sendCommand({ type: 'SET_MARKERS', markers: markers || [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, isMapReady]);

  // Update arrival card
  useEffect(() => {
    if (!isMapReady) return;
    sendCommand({
      type: 'SET_ARRIVAL_CARD',
      arrivalTime: arrivalTime ?? null,
      lat: arrivalPosition?.lat,
      lng: arrivalPosition?.lng,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalTime, arrivalPosition?.lat, arrivalPosition?.lng, isMapReady]);

  // On web, react-native-webview renders an iframe; html source works the same.
  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlRef.current }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        onMessage={handleMessage}
        // Allow remote tile/image loads
        mixedContentMode="always"
        {...(Platform.OS === 'android' ? { androidLayerType: 'hardware' as const } : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  webview: {
    flex: 1,
    backgroundColor: '#E8E8E8',
  },
});
