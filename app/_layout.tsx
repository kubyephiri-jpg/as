import { useEffect, useState, useRef } from 'react';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import flashVideo from '@/assets/videos/flash.mp4';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { RegistrationProvider } from '@/context/RegistrationContext';
import { TripRequestProvider } from '@/context/IncomingRidesContext';
import GlobalTripRequestPanel from '@/components/GlobalTripRequestPanel';
import { CallProvider } from '@/context/CallContext';
import CallOverlay from '@/components/CallOverlay';
import NativeCallsBoot from '@/components/NativeCallsBoot';
import { auth, firestore } from '@/config/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const player = useVideoPlayer(flashVideo, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = true;
  });
  const [isReadyToPlay, setIsReadyToPlay] = useState(false);
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false);
  const onFinishRef = useRef(onFinish);
  const isReadyRef = useRef(false);
  const hasFinishedRef = useRef(false);
  const autoplayBlockedRef = useRef(false);
  const retryUsedRef = useRef(false);
  const userGestureSeenRef = useRef(false);
  const playbackAttemptRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const retryPlayback = () => {
    userGestureSeenRef.current = true;
    if (!autoplayBlockedRef.current || retryUsedRef.current || !isReadyRef.current) return;

    retryUsedRef.current = true;
    autoplayBlockedRef.current = false;
    setIsAutoplayBlocked(false);
    player.currentTime = 0;
    playbackAttemptRef.current();
  };

  useEffect(() => {
    let isDisposed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let finishTimer: ReturnType<typeof setTimeout> | null = null;

    const finishSplash = () => {
      if (isDisposed || hasFinishedRef.current) return;
      hasFinishedRef.current = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (finishTimer !== null) clearTimeout(finishTimer);
      onFinishRef.current();
    };

    let attemptPlayback: () => void = () => undefined;

    const handlePlaybackRejected = () => {
      if (isDisposed || retryUsedRef.current) return;

      autoplayBlockedRef.current = true;
      setIsAutoplayBlocked(true);

      if (userGestureSeenRef.current) {
        retryUsedRef.current = true;
        autoplayBlockedRef.current = false;
        setIsAutoplayBlocked(false);
        player.currentTime = 0;
        attemptPlayback();
      }
    };

    const handlePlayToEnd = () => {
      if (isDisposed || hasFinishedRef.current || finishTimer !== null) return;
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      finishTimer = setTimeout(finishSplash, 300);
    };

    attemptPlayback = () => {
      if (isDisposed || !isReadyRef.current) return;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(finishSplash, 8000);

      try {
        void Promise.resolve(player.play()).catch(handlePlaybackRejected);
      } catch {
        handlePlaybackRejected();
      }
    };
    playbackAttemptRef.current = attemptPlayback;

    const handleStatusChange = ({ status }: { status: string }) => {
      if (status !== 'readyToPlay' || isReadyRef.current) return;
      isReadyRef.current = true;
      setIsReadyToPlay(true);
      player.currentTime = 0;
      attemptPlayback();
    };

    const statusListener = player.addListener('statusChange', handleStatusChange);
    const playToEndListener = player.addListener('playToEnd', handlePlayToEnd);

    if (player.status === 'readyToPlay') {
      handleStatusChange({ status: player.status });
    }

    return () => {
      isDisposed = true;
      statusListener.remove();
      playToEndListener.remove();
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (finishTimer !== null) clearTimeout(finishTimer);
      playbackAttemptRef.current = () => undefined;
    };
  }, [player]);

  return (
    <Pressable
      style={splashStyles.container}
      onPress={retryPlayback}
      accessibilityRole="button"
      accessibilityLabel={isAutoplayBlocked ? 'Retry splash video' : 'Splash video'}
      accessibilityHint="Tap to retry playback if the intro video does not start."
    >
      <VideoView
        player={player}
        style={[splashStyles.video, !isReadyToPlay && splashStyles.hiddenVideo]}
        contentFit="cover"
        nativeControls={false}
      />
    </Pressable>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e1a',
  },
  video: {
    flex: 1,
  },
  hiddenVideo: {
    opacity: 0,
  },
});

export default function RootLayout() {
  useFrameworkReady();
  const [showSplash, setShowSplash] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const pathname = usePathname();
  
  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setVerificationStatus(null);
      return;
    }

    const driverRef = doc(firestore, 'drivers', currentUser.uid);
    const unsubscribe = onSnapshot(driverRef, (snapshot) => {
      setVerificationStatus(snapshot.exists() ? snapshot.data().verificationStatus ?? null : null);
    }, () => {
      setVerificationStatus(null);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);
  
  if (showSplash) {
    return <SplashScreen onFinish={() => {
      setShowSplash(false);
    }} />;
  }

  // Determine if driver is authenticated - MUST have UID
  const driverUid = currentUser?.uid;
  const isAuthenticated = isAuthReady && !!driverUid;

  // If NOT authenticated: render auth screens WITHOUT dispatch overlay
  if (!isAuthenticated) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <RegistrationProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="registration-terms" />
            <Stack.Screen name="personal-info" />
            <Stack.Screen name="personal-picture" />
            <Stack.Screen name="step2" />
            <Stack.Screen name="step3" />
            <Stack.Screen name="cyclist-step" />
            <Stack.Screen name="license-step" />
            <Stack.Screen name="driver-license-instructions" />
            <Stack.Screen name="selfie-with-license-instructions" />
            <Stack.Screen name="id-step" />
            <Stack.Screen name="ridesDelivery" />
            <Stack.Screen name="vehicle-information" />
            <Stack.Screen name="chooseLocation" />
            <Stack.Screen name="application-submitted" />
            <Stack.Screen name="forgot-password" />
            <Stack.Screen name="dashboard" options={{ gestureEnabled: false }} />
            <Stack.Screen name="+not-found" />
          </Stack>
          <StatusBar style="light" />
        </RegistrationProvider>
      </GestureHandlerRootView>
    );
  }

  // AUTHENTICATED: render with TripRequestProvider and GlobalTripRequestPanel
  // The dispatch popup will ONLY appear here when driver is signed in
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RegistrationProvider>
        <TripRequestProvider>
          <CallProvider>
          <NativeCallsBoot />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="registration-terms" />
            <Stack.Screen name="dashboard" options={{ gestureEnabled: false }} />
            <Stack.Screen name="personal-info" />
            <Stack.Screen name="personal-picture" />
            <Stack.Screen name="step2" />
            <Stack.Screen name="step3" />
            <Stack.Screen name="cyclist-step" />
            <Stack.Screen name="license-step" />
            <Stack.Screen name="driver-license-instructions" />
            <Stack.Screen name="selfie-with-license-instructions" />
            <Stack.Screen name="id-step" />
            <Stack.Screen name="ridesDelivery" />
            <Stack.Screen name="vehicle-information" />
            <Stack.Screen name="chooseLocation" />
            <Stack.Screen name="application-submitted" />
            <Stack.Screen name="forgot-password" />
            <Stack.Screen name="+not-found" />
          </Stack>
          {/* Keep the RTDB listener mounted for fast resume, but only expose its effects on the approved driver's dashboard. */}
          {isAuthenticated && verificationStatus === 'approved' && pathname === '/dashboard' && (
            <GlobalTripRequestPanel />
          )}
          <CallOverlay />
          <StatusBar style="light" />
          </CallProvider>
        </TripRequestProvider>
      </RegistrationProvider>
    </GestureHandlerRootView>
  );
}
