import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';

import { watchShoppingSync } from '../lib/shopping-sync-lifecycle';

jest.mock('expo-network', () => ({ addNetworkStateListener: jest.fn(), getNetworkStateAsync: jest.fn() }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn() } }));
const checkNetwork = jest.mocked(getNetworkStateAsync);
const listenNetwork = jest.mocked(addNetworkStateListener);
const online = { isConnected: true, isInternetReachable: true };
const offline = { isConnected: false, isInternetReachable: false };

function setup(state: AppStateStatus = 'active') {
  let appEvent!: (state: AppStateStatus) => void;
  let networkEvent!: (state: NetworkState) => void;
  const removeApp = jest.fn();
  const removeNetwork = jest.fn();
  AppState.currentState = state;
  jest.mocked(AppState.addEventListener).mockImplementation((_, listener) => {
    appEvent = listener;
    return { remove: removeApp };
  });
  listenNetwork.mockImplementation(listener => {
    networkEvent = listener;
    return { remove: removeNetwork };
  });
  const requestSync = jest.fn();
  const stop = watchShoppingSync(requestSync);
  return { requestSync, stop, removeApp, removeNetwork, appEvent, networkEvent };
}

async function flushInitialState() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => jest.clearAllMocks());

it('requests one launch pass and only retries real foreground and connectivity transitions', async () => {
  checkNetwork.mockResolvedValueOnce(online);
  const { requestSync, appEvent, networkEvent, stop } = setup();
  await flushInitialState();
  expect(requestSync).toHaveBeenCalledTimes(1);
  networkEvent(online);
  appEvent('active');
  expect(requestSync).toHaveBeenCalledTimes(1);
  networkEvent(offline);
  networkEvent(online);
  expect(requestSync).toHaveBeenCalledTimes(2);
  appEvent('background');
  networkEvent(offline);
  networkEvent(online);
  expect(requestSync).toHaveBeenCalledTimes(2);
  appEvent('active');
  expect(requestSync).toHaveBeenCalledTimes(3);
  stop();
});

it('waits for validated internet access when the app is known to be offline', async () => {
  checkNetwork.mockResolvedValueOnce(offline);
  const { requestSync, appEvent, networkEvent, stop } = setup();
  await flushInitialState();
  appEvent('background');
  appEvent('active');
  networkEvent({ isConnected: true, isInternetReachable: false });
  expect(requestSync).not.toHaveBeenCalled();
  networkEvent(online);
  expect(requestSync).toHaveBeenCalledTimes(1);
  stop();
});

it('ignores late initial state and unsubscribes without waking a stopped runner', async () => {
  let initial!: (state: NetworkState) => void;
  checkNetwork.mockImplementationOnce(() => new Promise(resolve => { initial = resolve; }));
  const fixture = setup();
  fixture.networkEvent(online);
  initial(offline);
  await flushInitialState();
  fixture.appEvent('background');
  fixture.appEvent('active');
  expect(fixture.requestSync).toHaveBeenCalledTimes(2);
  fixture.stop();
  expect(fixture.removeApp).toHaveBeenCalledTimes(1);
  expect(fixture.removeNetwork).toHaveBeenCalledTimes(1);
  fixture.networkEvent(offline);
  fixture.networkEvent(online);
  expect(fixture.requestSync).toHaveBeenCalledTimes(2);
});
