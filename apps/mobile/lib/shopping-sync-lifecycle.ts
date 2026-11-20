import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import { AppState } from 'react-native';

export function watchShoppingSync(requestSync: () => void) {
  let active = AppState.currentState === 'active';
  let reachable: boolean | undefined;
  let receivedNetworkEvent = false;
  let started = false;
  let stopped = false;

  function requestIfPossible() {
    if (!stopped && active && reachable !== false) requestSync();
  }

  function updateReachability(state: NetworkState) {
    reachable = state.isConnected === false ? false : state.isInternetReachable;
  }

  function start() {
    if (started) return;
    started = true;
    requestIfPossible();
  }

  const app = AppState.addEventListener('change', state => {
    const enteringForeground = !active && state === 'active';
    active = state === 'active';
    if (enteringForeground) {
      if (started) requestIfPossible();
      else start();
    }
  });
  const network = addNetworkStateListener(state => {
    receivedNetworkEvent = true;
    const previouslyReachable = reachable;
    updateReachability(state);
    if (!started) start();
    else if (reachable === true && previouslyReachable !== true) requestIfPossible();
  });

  void getNetworkStateAsync().then(
    state => { if (!receivedNetworkEvent) updateReachability(state); },
    () => { /* An unavailable connection check is treated as unknown. */ },
  ).then(start);

  return () => {
    stopped = true;
    app.remove();
    network.remove();
  };
}
