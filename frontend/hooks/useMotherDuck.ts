'use client';

import { useState, useEffect, useCallback } from 'react';
import { MDConnection } from '@motherduck/wasm-client';

let globalConnection: MDConnection | null = null;
let initPromise: Promise<MDConnection> | null = null;

async function getConnection(): Promise<MDConnection> {
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

  useEffect(() => {
    getConnection()
      .then(() => setIsReady(true))
      .catch((err) => setError(err.message));
  }, []);

  const query = useCallback(async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    const conn = await getConnection();

    // evaluateQuery throws on error, so we use try/catch
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
