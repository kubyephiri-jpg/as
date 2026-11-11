import { database } from '@/config/firebase';
import { ref, remove, set } from 'firebase/database';

export async function clearDriverPresence(uid: string) {
  await Promise.all([
    set(ref(database, `drivers_online/${uid}`), {
      isOnline: false,
      isBusy: false,
      lastUpdated: Date.now(),
    }),
    remove(ref(database, `drivers_online/${uid}`)),
    remove(ref(database, `driver_locations/${uid}`)),
  ]);
}
