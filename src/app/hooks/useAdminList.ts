import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";

export interface AdminList<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  /** Resolves with the fresh list, or null when it could not be loaded. */
  reload: () => Promise<T[] | null>;
}

/**
 * Loads one admin list on mount and on `reload`. A failure is kept as `error` for the screen to show; a 401 or 403
 * is also handed to `onApiError` so an expired session signs out. Admin screens only: nothing is shared between
 * screens, so each section shows what the server says when it opens.
 */
export function useAdminList<T>(load: () => Promise<T[]>, onApiError?: (err: unknown) => void): AdminList<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Latest callbacks in refs, so the load effect runs once on mount even though parents recreate them each render.
  const loadRef = useRef(load);
  const onApiErrorRef = useRef(onApiError);
  useEffect(() => {
    loadRef.current = load;
    onApiErrorRef.current = onApiError;
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async (): Promise<T[] | null> => {
    setLoading(true);
    setError(null);
    try {
      const list = await loadRef.current();
      if (mounted.current) setData(list);
      return list;
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Something went wrong");
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onApiErrorRef.current?.(err);
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  return { data, loading, error, reload };
}
