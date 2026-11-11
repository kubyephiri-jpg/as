import { setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

type AlertAudioPlayer = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  volume: number;
  loop: boolean;
};

let audioModePromise: Promise<void> | null = null;
const webUnlockedPlayers = new WeakSet<object>();
const pendingWebAlerts = new WeakSet<object>();

export function prepareAlertAudio(): Promise<void> {
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }

  return audioModePromise;
}

export async function playAlertSound(player: AlertAudioPlayer): Promise<void> {
  await prepareAlertAudio();
  await player.seekTo(0);

  if (Platform.OS === 'web' && !webUnlockedPlayers.has(player)) {
    pendingWebAlerts.add(player);
    return;
  }

  player.play();
}

export function stopAlertSound(player: AlertAudioPlayer): void {
  pendingWebAlerts.delete(player);
  try {
    player.pause();
  } catch {}

  void player.seekTo(0).catch(() => undefined);
}

export function installWebAudioUnlock(player: AlertAudioPlayer): () => void {
  if (Platform.OS !== 'web') return () => undefined;

  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  let originalVolume = player.volume;
  let mutedForUnlock = false;

  const unlock = () => {
    webUnlockedPlayers.add(player);

    if (pendingWebAlerts.has(player)) {
      pendingWebAlerts.delete(player);
      try {
        player.play();
      } catch {}
      return;
    }

    if (player.loop) {
      try {
        player.play();
      } catch {}
      return;
    }

    originalVolume = player.volume;

    try {
      player.volume = 0;
      player.play();
      mutedForUnlock = true;
    } catch {
      player.volume = originalVolume;
      return;
    }

    restoreTimer = setTimeout(() => {
      player.pause();
      void player.seekTo(0).catch(() => undefined).finally(() => {
        player.volume = originalVolume;
        mutedForUnlock = false;
      });
    }, 100);
  };

  window.addEventListener('pointerdown', unlock, { once: true });

  return () => {
    window.removeEventListener('pointerdown', unlock);
    if (restoreTimer !== null) {
      clearTimeout(restoreTimer);
      if (mutedForUnlock) {
        player.pause();
        player.volume = originalVolume;
      }
    }
  };
}
