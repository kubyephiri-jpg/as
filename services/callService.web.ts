import AgoraRTC, { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import type { CallCredentials } from './callApi';
export * from './callApi';

export async function joinChannel(credentials: CallCredentials, onRemoteAudio?: (user: unknown) => void) {
  const client: IAgoraRTCClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  let microphone: IMicrophoneAudioTrack | null = null;
  let microphonePublished = false;
  let micAvailable = false;
  let micError: string | null = null;
  const describeMicError = (error: unknown) => {
    const value = error as { name?: string; message?: string };
    const name = value?.name || 'Error';
    const message = value?.message || String(error);
    console.warn('[calls] microphone unavailable:', name, message);
    return `${name}: ${message}`;
  };
  const createMicrophone = async () => {
    try {
      microphone = await AgoraRTC.createMicrophoneAudioTrack();
      micError = null;
      return true;
    } catch (error) {
      micError = describeMicError(error);
      return false;
    }
  };
  const closeMicrophone = () => {
    const track = microphone as IMicrophoneAudioTrack | null;
    try { track?.close(); } catch {}
    microphone = null;
  };

  try {
    client.on('user-published', async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === 'audio') {
        try {
          Promise.resolve(user.audioTrack?.play()).catch(() => undefined);
        } catch {
          // The remote track may be removed while a call is ending.
        }
        onRemoteAudio?.(user);
      }
    });

    let microphoneCreated = await createMicrophone();
    if (!microphoneCreated) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      microphoneCreated = await createMicrophone();
    }

    await client.join(credentials.appId, credentials.channel, credentials.token || null, credentials.uid);
    if (microphoneCreated) {
      const track = microphone as IMicrophoneAudioTrack | null;
      if (track) {
        try {
          await client.publish([track]);
          microphonePublished = true;
          micAvailable = true;
        } catch (error) {
          micError = describeMicError(error);
          closeMicrophone();
        }
      }
    }

    return {
      get micAvailable() { return micAvailable; },
      get micError() { return micError; },
      leave: async () => {
        closeMicrophone();
        await client.leave();
      },
      setMuted: async (muted: boolean) => {
        try {
          await microphone?.setEnabled(!muted);
        } catch (error) {
          micError = describeMicError(error);
          micAvailable = false;
        }
      },
      enableMicrophone: async () => {
        try {
          if (!microphone) microphone = await AgoraRTC.createMicrophoneAudioTrack();
          await microphone.setEnabled(true);
          if (!microphonePublished) {
            await client.publish([microphone]);
            microphonePublished = true;
          }
          micAvailable = true;
          micError = null;
          return true;
        } catch (error) {
          micError = describeMicError(error);
          closeMicrophone();
          microphonePublished = false;
          micAvailable = false;
          return false;
        }
      },
    };
  } catch (error) {
    closeMicrophone();
    await client.leave().catch(() => undefined);
    throw error;
  }
}
