import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { normalizeWorkflow } from '@/utils/workflow';
import { ref, onValue, off } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { usePathname } from 'expo-router';
import { database, auth, firestore } from '@/config/firebase';
import { useAudioPlayer } from 'expo-audio';
import requestSound from '@/assets/sounds/request.mp3';
import { installWebAudioUnlock, playAlertSound, prepareAlertAudio, stopAlertSound } from '@/utils/audioAlerts';
import { useDriverOrders } from '@/hooks/useDriverOrders';

// RTDB-based trip request structure
interface TripRequestData {
  pickupAddress: string;
  destinationAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
  total: number;
  fee: number;
  fare?: number;
  userName: string;
  userPhone: string;
  workflowType?: 'direct_trip' | 'store_delivery' | 'delivery';
  serviceType?: string;
  dispatchService?: string;
}

interface TripRequest {
  orderId: string;
  workflowType: 'direct_trip' | 'store_delivery' | 'delivery';
  requestType: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  data: TripRequestData;
}

interface TripRequestContextType {
  currentRequest: TripRequest | null;
  isVisible: boolean;
  isMinimized: boolean;
  setIsMinimized: (value: boolean) => void;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
  clearRequest: () => void;
  activeOrder: any | null;
  pendingEarnings: any[];
  dismissEarning: (orderId: string) => void;
}

const TripRequestContext = createContext<TripRequestContextType | undefined>(undefined);

export function TripRequestProvider({ children }: { children: ReactNode }) {
  const [currentRequest, setCurrentRequest] = useState<TripRequest | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [driverUid, setDriverUid] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const pathname = usePathname();
  const requestPlayer = useAudioPlayer(requestSound);
  const lastRequestSoundIdRef = useRef<string | null>(null);
  const { activeOrder, pendingEarnings: rawPendingEarnings } = useDriverOrders(driverUid);

  useEffect(() => {
    void prepareAlertAudio();
    return installWebAudioUnlock(requestPlayer);
  }, [requestPlayer]);
  const dismissedEarningIds = useRef(new Set<string>());
  const [, forceEarningsUpdate] = useState(0);
  const pendingEarnings = rawPendingEarnings.filter((order) => !dismissedEarningIds.current.has(order.orderId ?? order.id));
  const dismissEarning = (orderId: string) => {
    dismissedEarningIds.current.add(orderId);
    forceEarningsUpdate((value) => value + 1);
  };

  // Listen for auth state changes to get authenticated driver UID
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user?.uid) {
        setDriverUid(user.uid);
      } else {
        setDriverUid(null);
        // Clear all state when user logs out
        setCurrentRequest(null);
        setIsVisible(false);
        setIsMinimized(false);
        lastRequestSoundIdRef.current = null;
        stopAlertSound(requestPlayer);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!driverUid) {
      setVerificationStatus(null);
      return;
    }

    const driverRef = doc(firestore, 'drivers', driverUid);
    const unsubscribe = onSnapshot(driverRef, (snapshot) => {
      setVerificationStatus(
        snapshot.exists() ? snapshot.data().verificationStatus ?? null : null,
      );
    }, () => {
      setVerificationStatus(null);
    });

    return () => unsubscribe();
  }, [driverUid]);

  useEffect(() => {
    const offsetRef = ref(database, '.info/serverTimeOffset');
    return onValue(offsetRef, (snapshot) => setServerTimeOffset(Number(snapshot.val()) || 0));
  }, []);

  // RTDB listener - ONLY starts when driverUid is available
  useEffect(() => {
    // CRITICAL: Do NOT start listener if no authenticated driver UID
    if (!driverUid) {
      return;
    }

    // Listen ONLY to driver_trip_requests/{driverUid} in RTDB
    const tripRequestsRef = ref(database, `driver_trip_requests/${driverUid}`);
    
    const listener = onValue(tripRequestsRef, (snapshot) => {
      const data = snapshot.val();

      if (!data) {
        // No requests - hide panel only if status was terminal
        if (!currentRequest || 
            currentRequest.status === 'completed' || 
            currentRequest.status === 'rejected' || 
            currentRequest.status === 'expired' ||
            currentRequest.status === 'cancelled') {
          setCurrentRequest(null);
          setIsVisible(false);
        }
        return;
      }

      // Get all requests
      const requests = Object.entries(data).map(([orderId, requestData]: [string, any]) => ({
        orderId,
        ...requestData,
      })) as TripRequest[];

      if (requests.length === 0) {
        if (!currentRequest || ['completed', 'rejected', 'expired', 'cancelled'].includes(currentRequest.status)) {
          setCurrentRequest(null);
          setIsVisible(false);
        }
        return;
      }

      const now = Date.now() + serverTimeOffset;
      const activeRequest = requests.find(r =>
        !['completed', 'rejected', 'expired', 'cancelled'].includes(r.status) &&
        !(r.status === 'incoming_request' && r.expiresAt <= now)
      );

      if (activeRequest) {
        setCurrentRequest(activeRequest);

        // Show panel and play the alert only where the panel is rendered.
        const canExposeRequest = verificationStatus === 'approved' && pathname === '/dashboard';
        if (!isVisible && canExposeRequest) {
          setIsVisible(true);
          setIsMinimized(false);
        }

        if (
          canExposeRequest &&
          activeRequest.status === 'incoming_request' &&
          lastRequestSoundIdRef.current !== activeRequest.orderId
        ) {
          lastRequestSoundIdRef.current = activeRequest.orderId;
          void playAlertSound(requestPlayer).catch(() => undefined);
        }

        // Handle terminal statuses - hide after brief delay
        if (['completed', 'rejected', 'expired', 'cancelled'].includes(activeRequest.status)) {
          setTimeout(() => {
            setIsVisible(false);
            setCurrentRequest(null);
          }, 1000);
        }
      } else {
        // No active request found
        lastRequestSoundIdRef.current = null;
        setCurrentRequest(null);
        setIsVisible(false);
        stopAlertSound(requestPlayer);
      }
    });

    return () => off(tripRequestsRef, 'value', listener);
  }, [driverUid, currentRequest?.status, isVisible, verificationStatus, pathname, requestPlayer, serverTimeOffset]);

  const clearRequest = () => {
    setCurrentRequest(null);
    setIsVisible(false);
    setIsMinimized(false);
    lastRequestSoundIdRef.current = null;
    stopAlertSound(requestPlayer);
  };

  return (
    <TripRequestContext.Provider
      value={{
        currentRequest,
        isVisible,
        isMinimized,
        setIsMinimized,
        isLoading,
        setIsLoading,
        clearRequest,
        activeOrder,
        pendingEarnings,
        dismissEarning,
      }}
    >
      {children}
    </TripRequestContext.Provider>
  );
}

export function useTripRequest() {
  const context = useContext(TripRequestContext);
  if (context === undefined) {
    throw new Error('useTripRequest must be used within TripRequestProvider');
  }
  return context;
}

// Keep backward compatibility exports during migration
export const IncomingRidesProvider = TripRequestProvider;
export const useIncomingRides = useTripRequest;
