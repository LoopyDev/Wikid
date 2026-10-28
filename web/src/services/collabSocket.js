import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';

// One live-editing connection per server, shared by every open document (the page, its tables,
// the workspace's events...). Opening another page then only asks for that document, instead of
// setting up a new connection first, which on a real server took most of a page switch.
const sockets = new Map();

const socketFor = (url) => {
  let socket = sockets.get(url);
  if (!socket) {
    socket = new HocuspocusProviderWebsocket({ url });
    sockets.set(url, socket);
  }
  return socket;
};

/**
 * A provider for one document on the shared connection; `destroy()` leaves the document and keeps
 * the connection. Takes HocuspocusProvider's options, with `url` naming the server.
 */
export function createCollabProvider({ url, ...options }) {
  const socket = socketFor(url);
  // A session of its own, so the same document can be open twice (a page and its overlay, say)
  const provider = new HocuspocusProvider({ ...options, websocketProvider: socket, sessionAwareness: true });
  provider.attach();
  // A provider joining a connection that's already up hears no "connected" status, so pass on the
  // current one, once the caller has added its listeners
  queueMicrotask(() => {
    if (provider.isAttached) provider.emit('status', { status: socket.status });
  });
  return provider;
}

/** 'connecting', 'connected' or 'disconnected': the state of the provider's connection. */
export const providerStatus = (provider) => provider?.configuration?.websocketProvider?.status;
