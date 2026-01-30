'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// Dynamically import MotherDuck only on client side
type MDConnectionType = import('@motherduck/wasm-client').MDConnection;

let globalConnection: MDConnectionType | null = null;
let initPromise: Promise<MDConnectionType> | null = null;

async function getConnection(): Promise<MDConnectionType> {
  // Only run in browser
  if (typeof window === 'undefined') {
    throw new Error('MotherDuck SDK requires browser environment');
  }

  if (globalConnection) {
    return globalConnection;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const token = process.env.NEXT_PUBLIC_MOTHERDUCK_TOKEN;

    if (!token) {
      throw new Error('NEXT_PUBLIC_MOTHERDUCK_TOKEN is required');
    }

    // Dynamic import to avoid SSR issues
    const { MDConnection } = await import('@motherduck/wasm-client');

    const conn = MDConnection.create({ mdToken: token });
    await conn.isInitialized();
    globalConnection = conn;
    return conn;
  })();

  return initPromise;
}

export function useMotherDuck() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    // Only initialize in browser
    if (typeof window === 'undefined') return;

    getConnection()
      .then(() => {
        if (mounted.current) setIsReady(true);
      })
      .catch((err) => {
        if (mounted.current) setError(err.message);
      });

    return () => {
      mounted.current = false;
    };
  }, []);

  const query = useCallback(async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    const conn = await getConnection();

    // evaluateQuery throws on error
    const result = await conn.evaluateQuery(sql);

    // Use toRows() to get data as plain objects
    const rows = result.data.toRows();

    // Convert DuckDBRow to plain objects and handle BigInt
    return rows.map(row => {
      const obj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        // Convert BigInt to number for JSON compatibility
        obj[key] = typeof value === 'bigint' ? Number(value) : value;
      }
      return obj as T;
    });
  }, []);

  return { isReady, error, query };
}

// Escape SQL string to prevent injection
export function escapeSQL(value: string): string {
  return value.replace(/'/g, "''");
}
