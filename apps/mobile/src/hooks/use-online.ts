import { useNetworkState } from 'expo-network';

export function useOnline(): boolean {
  const state = useNetworkState();
  return state.isConnected !== false && state.isInternetReachable !== false;
}
