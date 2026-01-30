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
    const result = await conn.evaluateQuery(sql);

    if (result.status === 'error') {
      throw new Error(`Query failed: ${result.err}`);
    }

    // Convert Arrow table to plain objects
    const rows: T[] = [];
    const table = result.data;

    for (let i = 0; i < table.numRows; i++) {
      const row: Record<string, unknown> = {};
      for (const field of table.schema.fields) {
        const column = table.getChild(field.name);
        const value = column?.get(i);
        // Convert BigInt to number for JSON compatibility
        row[field.name] = typeof value === 'bigint' ? Number(value) : value;
      }
      rows.push(row as T);
    }

    return rows;
  }, []);

  return { isReady, error, query };
}

// Escape SQL string to prevent injection
export function escapeSQL(value: string): string {
  return value.replace(/'/g, "''");
}
