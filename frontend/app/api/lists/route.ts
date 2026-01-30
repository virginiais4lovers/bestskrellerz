import { NextResponse } from 'next/server';
import { query, BestSellerList } from '@/lib/db';

export async function GET() {
  try {
    // Get lists from the API data (bestseller_lists table)
    const lists = await query<BestSellerList>(`
      SELECT
        list_name_encoded,
        display_name,
        oldest_published_date::VARCHAR as oldest_published_date,
        newest_published_date::VARCHAR as newest_published_date,
        updated
      FROM bestseller_lists
      ORDER BY display_name
    `);

    // Also check if historical data exists
    let hasHistoricalData = false;
    try {
      const historicalExists = await query<{ cnt: number }>(`
        SELECT COUNT(*) as cnt FROM information_schema.tables
        WHERE table_name = 'historical_rankings'
      `);
      hasHistoricalData = (historicalExists[0]?.cnt || 0) > 0;
    } catch {
      // Table doesn't exist
    }

    const response = {
      lists,
      hasHistoricalData
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching lists:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lists' },
      { status: 500 }
    );
  }
}
