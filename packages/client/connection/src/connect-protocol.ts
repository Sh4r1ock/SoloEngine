/** API connection inputs shared by the Host and its clients. */

/** Whether a Peer participates in forwarded human interactions. */
export type ConnectionInteractions = 'answer' | 'none'

/** Launch-token exchange route for API clients. */
export const CONNECT_PATH = '/connect'

/**
 * WebSocket mux the connect exchange redirects API clients to. Connection claims
 * one socket per API Peer here; the API gateway owns the protocol on it.
 */
export const API_MUX_PATH = '/api/remote.mux'
