import { useEffect, useState } from 'react';
import { useNetworkState } from 'expo-network';

export function useOnline(): boolean {
  const state = useNetworkState();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (state.isConnected === false) setOnline(false);
    else if (state.isInternetReachable === false) setOnline(false);
    else setOnline(true);
  }, [state.isConnected, state.isInternetReachable]);

  return online;
}
