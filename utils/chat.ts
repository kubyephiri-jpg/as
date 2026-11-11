// Ride messaging now lives in FIRESTORE (queryable, ordered, paginated, proper
// offline persistence) instead of RTDB. Structure:
//   messages/{rideId}                         -> parent doc (holds "seen" state)
//   messages/{rideId}/thread/{messageId}      -> individual messages
//   driver_conversations/{driverId}/threads/{rideId}            -> archive meta
//   driver_conversations/{driverId}/threads/{rideId}/messages/* -> archived msgs
//
// Function signatures are unchanged (they still accept the RTDB `database`
// instance as the first arg) so existing callers don't need edits. The RTDB
// instance is now only used by watchRideStatusForCleanup to watch ride status —
// the live trip-status source of truth — which then archives + batch-deletes the
// Firestore message thread. All message reads/writes go through Firestore.

import { ref, onValue, off } from 'firebase/database';
import { Database } from 'firebase/database';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '@/config/firebase';

// Firestore serverTimestamp() resolves to a Timestamp; normalize any stored
// timestamp shape to milliseconds so the UI (which expects a number) is unchanged.
function toMillis(value: any): number {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  return Date.now();
}

// Path helpers
function threadCol(rideId: string) {
  return collection(firestore, 'messages', rideId, 'thread');
}
function seenDoc(rideId: string) {
  return doc(firestore, 'messages', rideId);
}
function archiveMetaDoc(driverId: string, rideId: string) {
  return doc(firestore, 'driver_conversations', driverId, 'threads', rideId);
}
function archiveMsgCol(driverId: string, rideId: string) {
  return collection(firestore, 'driver_conversations', driverId, 'threads', rideId, 'messages');
}

export async function sendDriverMessage(
  database: Database,
  rideId: string,
  driverId: string,
  driverName: string,
  text: string
): Promise<string> {
  const messageRef = await addDoc(threadCol(rideId), {
    sender: 'driver',
    senderId: driverId,
    senderName: driverName,
    text,
    timestamp: serverTimestamp(),
  });
  console.log('[chat] driver message written', { rideId, driverId, messageId: messageRef.id });
  return messageRef.id;
}

export function listenForClientMessages(
  database: Database,
  rideId: string,
  driverId: string,
  onNewMessage: (message: any, messageId: string) => void
): () => void {
  const q = query(threadCol(rideId), orderBy('timestamp', 'asc'));
  const processedMessages = new Set<string>();
  let hasLoadedExistingMessages = false;

  const unsubscribe = onSnapshot(q, (snapshot) => {
    console.log('[chat] client message subscription update', { rideId, driverId, changes: snapshot.docChanges().length });

    // Firestore replays every existing document as `added` when a listener is
    // created. Mark that initial history as processed so old messages never
    // trigger a new-message popup after the chat UI is reopened.
    if (!hasLoadedExistingMessages) {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') processedMessages.add(change.doc.id);
      });
      hasLoadedExistingMessages = true;
      return;
    }

    snapshot.docChanges().forEach((change) => {
      if (change.type !== 'added') return;
      const key = change.doc.id;
      if (processedMessages.has(key)) return;
      processedMessages.add(key);

      const raw = change.doc.data() as any;
      if (raw && raw.sender === 'client') {
        onNewMessage({ ...raw, timestamp: toMillis(raw.timestamp) }, key);
      }
    });
  });

  return unsubscribe;
}

export function autoDeleteReadMessages(
  database: Database,
  rideId: string,
  clientId: string,
  driverId: string
): () => void {
  return () => {};
}

export interface ConversationMeta {
  clientName?: string;
  pickupAddress?: string;
  destinationAddress?: string;
}

// Copy a ride's messages into a per-driver archive so the driver can read past
// conversations from the Inbox after a ride completes. Additive only: it reads
// the live Firestore thread and writes a separate archive doc + subcollection.
export async function archiveConversation(
  database: Database,
  driverId: string,
  rideId: string,
  meta: ConversationMeta = {}
): Promise<void> {
  if (!driverId || !rideId) return;
  try {
    const threadSnap = await getDocs(query(threadCol(rideId), orderBy('timestamp', 'asc')));

    // Don't archive empty conversations.
    if (threadSnap.empty) return;

    let lastMessageText = '';
    let lastTimestamp = 0;
    threadSnap.forEach((d) => {
      const m = d.data() as any;
      const ts = toMillis(m?.timestamp);
      if (ts >= lastTimestamp) {
        lastTimestamp = ts;
        lastMessageText = m?.text || '';
      }
    });

    await setDoc(archiveMetaDoc(driverId, rideId), {
      rideId,
      clientName: meta.clientName || 'Client',
      pickupAddress: meta.pickupAddress || '',
      destinationAddress: meta.destinationAddress || '',
      lastMessage: lastMessageText,
      lastTimestamp: lastTimestamp || Date.now(),
    });

    // Copy each message into the archive subcollection (batched).
    const batch = writeBatch(firestore);
    threadSnap.forEach((d) => {
      const m = d.data() as any;
      batch.set(doc(archiveMsgCol(driverId, rideId), d.id), {
        ...m,
        timestamp: toMillis(m?.timestamp),
      });
    });
    await batch.commit();
  } catch (e) {
    // Archiving is best-effort; never let it interrupt ride completion.
  }
}

// Firestore subcollections can't be deleted in one call, so batch-delete each
// document in messages/{rideId}/thread when the ride completes.
async function deleteThread(rideId: string): Promise<void> {
  try {
    const threadSnap = await getDocs(threadCol(rideId));
    if (threadSnap.empty) return;
    const batch = writeBatch(firestore);
    threadSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (e) {
    // Best-effort cleanup.
  }
}

export function watchRideStatusForCleanup(
  database: Database,
  rideId: string,
  driverId?: string,
  meta?: ConversationMeta
): () => void {
  // Ride status is still the RTDB source of truth, so we watch it here. When the
  // ride completes we archive the Firestore thread, then batch-delete it.
  const rideRef = ref(database, `rides/${rideId}`);

  let lastCleanedStatus: string | null = null;
  const callback = async (snap: any) => {
    const ride = snap.val();
    const status = ride?.status;
    if (!['accepted', 'completed'].includes(status) || lastCleanedStatus === status) return;
    lastCleanedStatus = status;

    // A new accepted trip starts a fresh live thread. Preserve the previous
    // conversation in the driver's inbox before clearing the live messages.
    if (driverId) {
      await archiveConversation(database, driverId, rideId, meta);
    }
    await deleteThread(rideId);
  };

  onValue(rideRef, callback);

  return () => {
    off(rideRef, 'value', callback);
  };
}

// Live list of the driver's archived past conversations (most recent first).
export function getDriverConversations(
  database: Database,
  driverId: string,
  callback: (
    conversations: Array<{
      rideId: string;
      clientName: string;
      pickupAddress: string;
      destinationAddress: string;
      lastMessage: string;
      lastTimestamp: number;
    }>
  ) => void
): () => void {
  const colRef = collection(firestore, 'driver_conversations', driverId, 'threads');

  const unsubscribe = onSnapshot(colRef, (snapshot) => {
    const list: Array<any> = [];
    snapshot.forEach((child) => {
      const data = (child.data() as any) || {};
      list.push({
        rideId: data.rideId || child.id || '',
        clientName: data.clientName || 'Client',
        pickupAddress: data.pickupAddress || '',
        destinationAddress: data.destinationAddress || '',
        lastMessage: data.lastMessage || '',
        lastTimestamp: toMillis(data.lastTimestamp),
      });
    });
    list.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    callback(list);
  });

  return unsubscribe;
}

// Read the archived messages for a single past conversation.
export function getArchivedMessages(
  database: Database,
  driverId: string,
  rideId: string,
  callback: (messages: Array<{ id: string; data: any }>) => void
): () => void {
  const q = query(archiveMsgCol(driverId, rideId), orderBy('timestamp', 'asc'));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const messages: Array<{ id: string; data: any }> = [];
    snapshot.forEach((child) => {
      const raw = child.data() as any;
      messages.push({ id: child.id || '', data: { ...raw, timestamp: toMillis(raw?.timestamp) } });
    });
    callback(messages);
  });

  return unsubscribe;
}

export function getAllMessages(
  database: Database,
  rideId: string,
  callback: (messages: Array<{ id: string; data: any }>) => void
): () => void {
  const q = query(threadCol(rideId), orderBy('timestamp', 'asc'));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const messages: Array<{ id: string; data: any }> = [];
    snapshot.forEach((child) => {
      const raw = child.data() as any;
      messages.push({ id: child.id || '', data: { ...raw, timestamp: toMillis(raw?.timestamp) } });
    });
    callback(messages);
  });

  return unsubscribe;
}

export function markMessagesAsSeen(database: Database, rideId: string): void {
  setDoc(
    seenDoc(rideId),
    {
      driverSeen: true,
      lastSeenAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function getUnreadCount(
  database: Database,
  rideId: string,
  driverId: string,
  callback: (count: number) => void
): () => void {
  let lastSeenTimestamp = 0;
  let threadDocs: Array<any> | null = null;

  const calculateUnreadCount = () => {
    if (!threadDocs) {
      callback(0);
      return;
    }
    let unreadCount = 0;
    threadDocs.forEach((m: any) => {
      if (m?.sender === 'client' && toMillis(m?.timestamp) > lastSeenTimestamp) {
        unreadCount++;
      }
    });
    callback(unreadCount);
  };

  const unsubscribeSeen = onSnapshot(seenDoc(rideId), (snap) => {
    const data = (snap.data() as any) || {};
    if (data.driverSeen) {
      lastSeenTimestamp = toMillis(data.lastSeenAt);
    }
    calculateUnreadCount();
  });

  const unsubscribeMessages = onSnapshot(threadCol(rideId), (snapshot) => {
    threadDocs = [];
    snapshot.forEach((child) => threadDocs!.push(child.data()));
    calculateUnreadCount();
  });

  return () => {
    unsubscribeSeen();
    unsubscribeMessages();
  };
}
