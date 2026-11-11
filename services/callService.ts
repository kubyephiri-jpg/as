import type { CallCredentials } from './callApi';
export * from './callApi';

export async function joinChannel(
  _credentials: CallCredentials,
  _onRemoteAudio?: (user: unknown) => void,
): Promise<{ leave: () => Promise<void>; setMuted: (muted: boolean) => Promise<void> }> {
  throw new Error('Voice calls are only supported on web for now');
}
