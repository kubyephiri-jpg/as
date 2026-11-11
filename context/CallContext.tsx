'use client';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { cancelCallNotification, callServiceStart, callServiceStop } from '@/utils/nativeCalls';
import { auth, database } from '@/config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import ringtone from '@/assets/sounds/call.mp3';
import { useAudioPlayer } from 'expo-audio';
import { installWebAudioUnlock, playAlertSound, prepareAlertAudio, stopAlertSound } from '@/utils/audioAlerts';
import type { CallCredentials } from '@/services/callApi';

const service = Platform.OS === 'web' ? require('@/services/callService.web') : require('@/services/callService');
type State = 'idle' | 'calling' | 'ringing' | 'in-call' | 'ended';
type Snapshot = { callId?: string; orderId?: string; channel?: string; direction?: 'incoming' | 'outgoing'; peerName?: string; status?: string; endReason?: string; expiresAt?: number; startedAt?: number; endedAt?: number; durationSeconds?: number; appId?: string; token?: string; uid?: string | number };
type Connection = { leave: () => Promise<void>; setMuted: (muted: boolean) => Promise<void>; micAvailable?: boolean; micError?: string | null; enableMicrophone?: () => Promise<boolean> };
type ContextValue = { callState: State; callId: string | null; peerName: string; elapsedSeconds: number; formattedTime: string; isMuted: boolean; micAvailable: boolean; micError: string | null; endedMessage: string; startCall: (orderId: string, target?: 'store', peerName?: string) => Promise<void>; answerCall: () => Promise<void>; declineCall: () => Promise<void>; endCall: () => Promise<void>; toggleMute: () => Promise<void>; enableMicrophone: () => Promise<boolean> };
const CallContext = createContext<ContextValue | null>(null);
const terminal = new Set(['ended', 'declined', 'missed', 'expired']);
const formatTime = (seconds: number) => seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export function CallProvider({ children }: { children: React.ReactNode }) {
  const player = useAudioPlayer(ringtone);
  const [callState, setCallState] = useState<State>('idle'); const [callId, setCallId] = useState<string | null>(null); const [peerName, setPeerName] = useState(''); const [elapsedSeconds, setElapsedSeconds] = useState(0); const [isMuted, setIsMuted] = useState(false); const [micAvailable, setMicAvailable] = useState(true); const [micError, setMicError] = useState<string | null>(null); const [endedMessage, setEndedMessage] = useState('');
  const callStateRef = useRef(callState); const elapsedRef = useRef(elapsedSeconds); const currentRef = useRef<Snapshot | null>(null); const endCallRef = useRef<(reason?: string) => Promise<void>>(async () => undefined); const sessionCall = useRef<string | null>(null); const connectionRef = useRef<Connection | null>(null); const offsetRef = useRef(0); const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); const timerRef = useRef<ReturnType<typeof setInterval> | null>(null); const sawCall = useRef(false); const ringStateRef = useRef(false); const ringingCallRef = useRef<string | null>(null); const endingRef = useRef(false);
  callStateRef.current = callState; elapsedRef.current = elapsedSeconds;
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
  const clearRingTimeout = () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); timeoutRef.current = null; };
  const stopRingtone = () => { ringStateRef.current = false; try { player.loop = false; } catch {} stopAlertSound(player); clearRingTimeout(); };
  const cancelRingingNotification = (callIdToCancel?: string) => { const tag = callIdToCancel ?? ringingCallRef.current; if (!tag) return; cancelCallNotification(tag); if (ringingCallRef.current === tag) ringingCallRef.current = null; };
  const playRingtone = () => playAlertSound(player);
  const startRingtone = () => { try { player.loop = true; } catch {} ringStateRef.current = true; void playRingtone().catch(() => undefined); };
  const leaveConnection = async () => { const active = connectionRef.current; connectionRef.current = null; if (active) await active.leave().catch(() => undefined); };
  const token = async () => { const user = auth.currentUser; if (!user) throw new Error('You must be signed in'); return user.getIdToken(); };
  const showEnded = (message: string) => { setEndedMessage(message); setCallState('ended'); setTimeout(() => { setCallState('idle'); setCallId(null); setEndedMessage(''); sessionCall.current = null; currentRef.current = null; sawCall.current = false; }, 2500); };
  const join = async (data: Snapshot) => { const connection = await service.joinChannel({ appId: data.appId, token: data.token, channel: data.channel, uid: data.uid } as CallCredentials) as Connection; connectionRef.current = connection; setMicAvailable(connection.micAvailable ?? true); setMicError(connection.micError ?? null); };
  const terminalMessage = (data: Snapshot) => { if (data.status === 'declined') return 'Call declined'; if (data.status === 'missed' || data.status === 'expired' || data.endReason === 'no_answer') return 'No answer'; if (data.endReason === 'trip_ended') return 'Trip ended'; if (data.endReason === 'cancelled' && !data.startedAt) return data.direction === 'incoming' ? 'Missed call' : 'Call cancelled'; const duration = data.durationSeconds ?? (data.startedAt && data.endedAt ? Math.max(0, Math.floor((data.endedAt - data.startedAt) / 1000)) : 0); return duration > 0 || data.startedAt ? `Call ended · ${formatTime(duration)}` : 'Call ended'; };
  const finish = async (message: string) => { cancelRingingNotification(currentRef.current?.callId); stopRingtone(); stopTimer(); setElapsedSeconds(0); await leaveConnection(); setIsMuted(false); setMicAvailable(true); setMicError(null); showEnded(message); };
  const endCall = async (reason?: string) => { if (endingRef.current) return; endingRef.current = true; const snapshot = currentRef.current; const wasInCall = callStateRef.current === 'in-call' || !!snapshot?.startedAt; const duration = elapsedRef.current; const callId = snapshot?.callId; if (callId) cancelRingingNotification(callId); try { if (callId) { try { await service.endCallApi(callId, await token(), reason); } catch {} } await finish(reason === 'no_answer' ? 'No answer' : wasInCall ? `Call ended · ${formatTime(duration)}` : 'Call cancelled'); } finally { endingRef.current = false; } };
  endCallRef.current = endCall;

  useEffect(() => { if (callState === 'in-call') void callServiceStart('Call in progress'); else if (callState === 'ended' || callState === 'idle') void callServiceStop(); }, [callState]);
  useEffect(() => () => { void callServiceStop(); }, []);
  useEffect(() => {
    void prepareAlertAudio();
    return installWebAudioUnlock(player);
  }, [player]);
  useEffect(() => {
    let unsubscribeCall: (() => void) | undefined; let unsubscribeOffset: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => { unsubscribeCall?.(); unsubscribeOffset?.(); if (!user) { cancelRingingNotification(); currentRef.current = null; setCallId(null); sessionCall.current = null; sawCall.current = false; stopRingtone(); stopTimer(); void leaveConnection(); return; }
      unsubscribeOffset = onValue(ref(database, '.info/serverTimeOffset'), (snapshot) => { offsetRef.current = snapshot.val() || 0; });
      unsubscribeCall = onValue(ref(database, `user_calls/${user.uid}`), (snapshot) => {
        const data = snapshot.val() as Snapshot | null; if (!data?.callId) return; const now = Date.now() + offsetRef.current;
        if (!sessionCall.current && (terminal.has(data.status || '') || (data.expiresAt !== undefined && data.expiresAt <= now))) { cancelCallNotification(data.callId); return; }
        if (data.direction === 'incoming' && (callStateRef.current === 'calling' || callStateRef.current === 'in-call') && data.callId !== sessionCall.current) return;
        const isNew = data.callId !== sessionCall.current; if (isNew) { sessionCall.current = data.callId; sawCall.current = true; stopTimer(); setElapsedSeconds(0); } currentRef.current = data; setCallId(data.callId); if (data.status !== 'ringing' && ringingCallRef.current === data.callId) cancelRingingNotification(data.callId); setPeerName(data.peerName || 'Rider');
        if (data.status === 'ringing') { if (ringingCallRef.current && ringingCallRef.current !== data.callId) cancelRingingNotification(); ringingCallRef.current = data.callId; if (data.expiresAt !== undefined && data.expiresAt <= now) { cancelRingingNotification(data.callId); if (callStateRef.current === 'calling' || callStateRef.current === 'ringing') void endCallRef.current('no_answer'); return; } if (data.direction === 'incoming') { if (callStateRef.current !== 'ringing') setCallState('ringing'); if (!ringStateRef.current) startRingtone(); } else setCallState('calling'); if (data.expiresAt) { clearRingTimeout(); timeoutRef.current = setTimeout(() => { if (currentRef.current?.status === 'ringing' && callStateRef.current === 'calling') void endCallRef.current('no_answer'); }, Math.max(0, data.expiresAt - now)); } }
        else if (data.status === 'active') { clearRingTimeout(); stopRingtone(); setCallState('in-call'); stopTimer(); if (data.startedAt) { const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() + offsetRef.current - data.startedAt!) / 1000))); tick(); timerRef.current = setInterval(tick, 1000); } }
        else if (terminal.has(data.status || '') && sawCall.current && data.callId === sessionCall.current) { clearRingTimeout(); void finish(terminalMessage(data)); }
      });
    });
    return () => { unsubscribeAuth(); unsubscribeCall?.(); unsubscribeOffset?.(); clearRingTimeout(); stopTimer(); stopRingtone(); void leaveConnection(); };
  }, [player]);
  const startCall = async (orderId: string, target?: 'store', peerName?: string) => { endingRef.current = false; clearRingTimeout(); stopTimer(); setElapsedSeconds(0); setIsMuted(false); setMicAvailable(true); setMicError(null); setCallId(null); currentRef.current = null; sessionCall.current = null; sawCall.current = false; setPeerName(peerName ?? (target === 'store' ? 'Store' : 'Rider')); setCallState('calling'); let callId: string | undefined;
    try { const result = await service.startCallApi(orderId, await token(), target); callId = result.callId; sessionCall.current = callId || null; sawCall.current = true; currentRef.current = { ...result, callId, orderId, direction: 'outgoing', status: 'ringing' }; setCallId(callId || null); await join(result); }
    catch (error: any) { if (callId) { try { await service.endCallApi(callId, await token()); } catch {} } if (error?.status === 409 || error?.status === 403) { setCallState('idle'); setPeerName(''); throw error; } await finish(error?.name === 'NotAllowedError' || /microphone|permission/i.test(error?.message || '') ? 'Microphone access is blocked. Allow it in the browser and try again.' : (error?.message || 'Unable to start call')); }
  };
  const answerCall = async () => { const callId = currentRef.current?.callId; if (!callId) return; cancelRingingNotification(callId); try { const result = await service.acceptCallApi(callId, await token()); stopRingtone(); await join({ ...currentRef.current, ...result }); setCallState('in-call'); } catch (error: any) { try { await service.declineCallApi(callId, await token()); } catch {} await finish(error?.message || 'Unable to answer call'); } };
  const declineCall = async () => { const callId = currentRef.current?.callId; if (callId) { cancelRingingNotification(callId); try { await service.declineCallApi(callId, await token()); } catch {} } await finish('Call declined'); };
  const toggleMute = async () => { const next = !isMuted; await connectionRef.current?.setMuted(next); setIsMuted(next); const connection = connectionRef.current; setMicAvailable(connection?.micAvailable ?? true); if (connection?.micAvailable === false) setMicError(connection.micError ?? 'Microphone unavailable'); };
  const enableMicrophone = async () => { try { const enabled = await connectionRef.current?.enableMicrophone?.(); const available = enabled ?? false; setMicAvailable(available); setMicError(available ? null : connectionRef.current?.micError ?? 'Microphone unavailable'); if (available) setIsMuted(false); return available; } catch (error) { setMicAvailable(false); setMicError(error instanceof Error ? error.message : 'Microphone unavailable'); return false; } };
  const value = useMemo(() => ({ callState, callId, peerName, elapsedSeconds, formattedTime: formatTime(elapsedSeconds), isMuted, micAvailable, micError, endedMessage, startCall, answerCall, declineCall, endCall: () => endCall(), toggleMute, enableMicrophone }), [callState, callId, peerName, elapsedSeconds, isMuted, micAvailable, micError, endedMessage]);
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
export function useCall() { const value = useContext(CallContext); if (!value) throw new Error('useCall must be used within CallProvider'); return value; }
