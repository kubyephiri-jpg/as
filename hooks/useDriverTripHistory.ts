import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firestore } from '@/config/firebase';
import { normalizeWorkflow, isStoreWorkflow } from '@/utils/workflow';

type Period = 'today' | 'week' | 'month';
export type DriverTrip = { id: string; pickup: string; destination: string; amount: number; createdAt: Date | null; workflowType: 'direct_trip' | 'store_delivery' | 'unknown' };

function asDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstString(...values: any[]) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || 'Address unavailable';
}

function firstNumber(...values: any[]) {
  const value = values.find((item) => typeof item === 'number' || (typeof item === 'string' && item.trim()));
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function useDriverTripHistory(driverId: string | null, period: Period) {
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [loading, setLoading] = useState(Boolean(driverId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!driverId) { setTrips([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const q = query(collection(firestore, 'orders'), where('driverId', '==', driverId));
  return onSnapshot(q, (snapshot) => {
    const next = snapshot.docs.flatMap((item) => {
      const data = item.data() as any;
      const status = String(data.status ?? '').toLowerCase();
      const driverStatus = String(data.driverStatus ?? '').toLowerCase();
      if (!['completed', 'delivered'].includes(status) && !['completed', 'delivered'].includes(driverStatus)) return [];
      const workflowType = normalizeWorkflow(String(data.workflowType).toLowerCase()) as 'direct_trip' | 'store_delivery' | null;
      return [{
        id: item.id,
        status: data.status,
        pickup: firstString(data.pickupAddress, data.pickup, data.restaurantName),
        destination: firstString(data.destinationAddress, data.destination, data.dropoffAddress),
        amount: isStoreWorkflow(workflowType)
          ? firstNumber(data.fee, data.driverEarnings)
          : firstNumber(data.total, data.fare, data.fee),
        createdAt: asDate(data.completedAt || data.deliveredAt || data.updatedAt || data.createdAt),
        workflowType: (workflowType === 'direct_trip' || workflowType === 'store_delivery' ? workflowType : 'unknown') as DriverTrip['workflowType'],
      }];
    });
    setTrips(next); setLoading(false);
  }, (error) => { setError(`Unable to load trip history (${error.code}): ${error.message}`); setLoading(false); });
  }, [driverId, period]);

  const filteredTrips = useMemo(() => {
    const now = new Date();
    return trips.filter((trip) => {
      if (!trip.createdAt) return false;
      if (period === 'today') return trip.createdAt.toDateString() === now.toDateString();
      const start = new Date(now);
      if (period === 'week') start.setDate(now.getDate() - 7);
      else start.setMonth(now.getMonth() - 1);
      return trip.createdAt >= start;
    });
  }, [trips, period]);

  return { trips: filteredTrips, loading, error, totalEarnings: filteredTrips.reduce((sum, trip) => sum + trip.amount, 0) };
}
export type { Period };
