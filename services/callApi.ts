export const API_BASE = 'https://aletwend-render-backend.onrender.com';

export type CallCredentials = { appId: string; token: string; channel: string; uid: string | number };
export type CallApiResult = {
  success: boolean;
  callId?: string;
  channel?: string;
  appId?: string;
  token?: string;
  uid?: string | number;
  expiresAt?: number;
  startedAt?: number;
  error?: string;
};

export async function callApi(path: string, body: Record<string, unknown>, idToken: string): Promise<CallApiResult> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  let result: CallApiResult;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Call request failed (${response.status})`);
  }
  if (!response.ok || result.success === false) {
    const error = new Error(result.error || `Call request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return result;
}

export const startCallApi = (orderId: string, idToken: string, target?: 'store') =>
  callApi('/api/calls/start', { orderId, ...(target ? { target } : {}) }, idToken);
export const acceptCallApi = (callId: string, idToken: string) => callApi('/api/calls/accept', { callId }, idToken);
export const declineCallApi = (callId: string, idToken: string) => callApi('/api/calls/decline', { callId }, idToken);
export const endCallApi = (callId: string, idToken: string, reason?: string) =>
  callApi('/api/calls/end', { callId, ...(reason ? { reason } : {}) }, idToken);
