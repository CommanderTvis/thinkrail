import type {AppConfigUpdate} from '../../../packages/contracts/src';
import {useCallback, useRef, useState} from 'react';
import {hostClient} from './HostClient';

export function useAnalyticsConsent() {
  const busy = useRef(false);
  const queued = useRef<AppConfigUpdate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const persist: (config: AppConfigUpdate) => Promise<void> = useCallback(async config => {
    if (busy.current) {
      queued.current = config;
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      if (!await hostClient.updateConfig(config)) setError("Couldn't save your choice. Please try again.");
    } finally {
      busy.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) persist(next);
      else setPending(false);
    }
  }, []);
  const save = useCallback((analyticsEnabled: boolean) => persist({analyticsEnabled, analyticsConsentConfirmed: true}), [persist]);
  const prime = useCallback(() => persist({analyticsEnabled: true}), [persist]);
  return {pending, error, save, prime};
}
