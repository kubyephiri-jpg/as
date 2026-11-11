import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firestore } from '@/config/firebase';
import { normalizeWorkflow, isStoreWorkflow } from '@/utils/workflow';

const ACTIVE_STATUSES = new Set(['accepted', 'driver_assigned', 'arrived', 'started', 'at_store', 'picked_up', 'delivered']);

function timestampValue(value: any): number {
  if (typeof value === 'number') return value;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  return 0;
}

export function useDriverOrders(driverId: string | null) {
  const [activeOrder, setActiveOrder] = useState<any | null>(null);
  const [pendingEarnings, setPendingEarnings] = useState<any[]>([]);

  useEffect(() => {
    if (!driverId) {
      setActiveOrder(null);
      setPendingEarnings([]);
      return;
    }

    const ordersQuery = query(collection(firestore, 'orders'), where('driverId', '==', driverId));
    return onSnapshot(ordersQuery, (snapshot) => {
      const orders = snapshot.docs.map((item) => {
        const order = { id: item.id, orderId: item.id, ...item.data() } as any;
        return { ...order, workflowType: normalizeWorkflow(order.workflowType) };
      });
      const active = orders
        .filter((order) => ACTIVE_STATUSES.has(order.status))
        .sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt))[0] ?? null;
      if (active) {
        active.uiStatus = isStoreWorkflow(active.workflowType) && active.status === 'driver_assigned' ? 'accepted' : active.status;
      }
      setActiveOrder(active);
      setPendingEarnings(orders
        .filter((order) => order.status === 'completed' && order.driverEarningsStatus === 'pending')
        .sort((a, b) => {
          const aTime = timestampValue(a.completedAt);
          const bTime = timestampValue(b.completedAt);
          return (aTime || Number.MAX_SAFE_INTEGER) - (bTime || Number.MAX_SAFE_INTEGER);
        }));
    }, () => {
      setActiveOrder(null);
      setPendingEarnings([]);
    });
  }, [driverId]);

  return { activeOrder, pendingEarnings };
}
