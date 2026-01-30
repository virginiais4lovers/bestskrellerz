const MOTHERDUCK_API_URL = 'https://api.motherduck.com/api/v0';

interface QueryResponse {
  columns: string[];
  rows: unknown[][];
}

// Escape SQL string to prevent injection
export function escapeSQL(value: string): string {
  return value.replace(/'/g, "''");
}

export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const token = process.env.MOTHERDUCK_TOKEN;
  const database = process.env.MOTHERDUCK_DATABASE || 'nyt_bestsellers';

  if (!token) {
    throw new Error('MOTHERDUCK_TOKEN environment variable is required');
  }

  const response = await fetch(`${MOTHERDUCK_API_URL}/sql`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: sql,
      database: database,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MotherDuck query failed: ${response.status} ${errorText}`);
  }

  const data: QueryResponse = await response.json();

  // Convert rows to objects using column names
  const results: T[] = data.rows.map(row => {
    const obj: Record<string, unknown> = {};
    data.columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj as T;
  });

  return results;
}

export interface BestSellerList {
  list_name_encoded: string;
  display_name: string;
  oldest_published_date: string;
  newest_published_date: string;
  updated: string;
}

export interface Book {
  primary_isbn13: string;
  primary_isbn10: string | null;
  title: string;
  author: string;
  publisher: string;
  description: string;
  book_image: string | null;
  amazon_product_url: string | null;
}

export interface Ranking {
  id: string;
  list_name_encoded: string;
  published_date: string;
  rank: number;
  rank_last_week: number;
  weeks_on_list: number;
  primary_isbn13: string;
}

export interface BookWithRanking extends Book {
  rank: number;
  rank_last_week: number;
  weeks_on_list: number;
  published_date: string;
  list_name_encoded: string;
  display_name?: string;
}

export interface HistoricalRanking {
  title: string;
  author: string;
  rank: number;
  week: string;
  year: number;
  title_id: number;
}

export interface SearchResult extends Book {
  appearance_count: number;
  lists: string[];
}
