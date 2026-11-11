'use client';

import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { arrayRemove, arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { auth, firestore } from '@/config/firebase';
import { useCall } from '@/context/CallContext';
import { disposeNativeCalls, initNativeCalls, isNative } from '@/utils/nativeCalls';

type NativeSession = { uid: string; tokens: Set<string> };

export default function NativeCallsBoot() {
  const { callId, callState, answerCall } = useCall();
  const callRef = useRef({ callId, callState, answerCall });
  callRef.current = { callId, callState, answerCall };

  useEffect(() => {
    if (!isNative()) return;

    let activeSession: NativeSession | null = null;
    let mounted = true;
    let authQueue = Promise.resolve();

    const removeSessionTokens = async (session: NativeSession) => {
      const tokens = [...session.tokens];
      if (tokens.length === 0) return;
      try {
        await updateDoc(doc(firestore, 'drivers', session.uid), {
          fcmToken: arrayRemove(...tokens),
          fcmTokens: arrayRemove(...tokens),
        });
      } catch (error) {
        console.warn('[calls] token cleanup failed', error);
      }
    };

    const handleAuthChange = async (user: typeof auth.currentUser) => {
      const previousSession = activeSession;
      if (previousSession && (!user || previousSession.uid !== user.uid)) {
        activeSession = null;
        await removeSessionTokens(previousSession);
      }

      if (!user || !mounted) {
        await disposeNativeCalls();
        return;
      }
      if (activeSession?.uid === user.uid) return;

      await disposeNativeCalls();
      const session: NativeSession = { uid: user.uid, tokens: new Set() };
      activeSession = session;

      await initNativeCalls({
        saveToken: async (token) => {
          if (activeSession !== session) return;
          session.tokens.add(token);
          try {
            await updateDoc(doc(firestore, 'drivers', session.uid), {
              fcmToken: token,
              fcmTokens: arrayUnion(token),
            });
          } catch (error) {
            console.warn('[calls] token save failed', error);
          }
        },
        onAnswer: (incomingCallId) => {
          void (async () => {
            const deadline = Date.now() + 10_000;
            while (mounted && Date.now() <= deadline) {
              const current = callRef.current;
              if (current.callId === incomingCallId && current.callState === 'ringing') {
                await current.answerCall();
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          })();
        },
      });

      if (!mounted || activeSession !== session) await disposeNativeCalls();
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      authQueue = authQueue
        .then(() => handleAuthChange(user))
        .catch((error) => console.warn('[calls] auth initialization failed', error));
    });

    return () => {
      mounted = false;
      unsubscribe();
      authQueue = authQueue.then(async () => {
        const session = activeSession;
        activeSession = null;
        if (session) await removeSessionTokens(session);
        await disposeNativeCalls();
      });
    };
  }, []);

  return null;
}
