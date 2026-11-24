import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';

// One live-editing connection per server, shared by every open document (the page, its tables,
// the workspace's events...). Opening another page then only asks for that document, instead of
// setting up a new connection first, which on a real server took most of a page switch.
const sockets = new Map();

// Providers, and their awareness, are never made reactive (the flag markRaw sets, on their
// prototypes, as for Yjs's own objects: see utils/yjsNotReactive.js). y-tiptap checks the cursor it
// put in the awareness is still there by identity; through a reactive wrapper it never was, so it
// sent it again on every update, every other editor redrawing for each (a key pressed just then
// could be undone). And a provider kept in a ref wasn't the same one when handed over again.
const notReactive = (prototype) => {
  if (!Object.prototype.hasOwnProperty.call(prototype, '__v_skip')) {
    Object.defineProperty(prototype, '__v_skip', { value: true, configurable: true });
  }
};
notReactive(HocuspocusProvider.prototype);
notReactive(HocuspocusProviderWebsocket.prototype);

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
  // Hocuspocus marks a document synced whenever the server has confirmed all of its changes, even
  // before the server's copy has arrived. On a connection that's already open, a change made
  // straight away is confirmed first, and code waiting for the sync (seeding a page's title, say)
  // would then add to an empty copy and duplicate what the server has. Until the first real sync
  // (and again after a reconnect), count confirmations without calling the document synced.
  const decrementUnsyncedChanges = provider.decrementUnsyncedChanges.bind(provider);
  provider.decrementUnsyncedChanges = () => {
    if (provider.isSynced) return decrementUnsyncedChanges();
    if (provider.unsyncedChanges > 0) provider.unsyncedChanges -= 1;
    provider.emit('unsyncedChanges', { number: provider.unsyncedChanges });
  };
  if (provider.awareness) notReactive(Object.getPrototypeOf(provider.awareness));
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
