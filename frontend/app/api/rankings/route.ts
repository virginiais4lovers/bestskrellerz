import { NextRequest, NextResponse } from 'next/server';
import { query, escapeSQL, BookWithRanking } from '@/lib/db';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const list = searchParams.get('list');
  const date = searchParams.get('date');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '15', 10);

  if (!list) {
    return NextResponse.json(
      { error: 'list parameter is required' },
      { status: 400 }
    );
  }

  // Validate list name format (alphanumeric and hyphens only)
  if (!/^[a-z0-9-]+$/i.test(list)) {
    return NextResponse.json(
      { error: 'Invalid list name' },
      { status: 400 }
    );
  }

  try {
    // Check if this is a request for historical data
    if (list === 'hardcover-fiction-historical') {
      return await getHistoricalRankings(date, page, pageSize);
    }

    const escapedList = escapeSQL(list);

    // First, get the date we'll be querying (latest if not specified)
    let actualDate = date;
    if (!date || date === 'latest') {
      const latestResult = await query<{ max_date: string }>(`
        SELECT MAX(published_date)::VARCHAR as max_date
        FROM rankings
        WHERE list_name_encoded = '${escapedList}'
      `);
      actualDate = latestResult[0]?.max_date;
    }

    if (!actualDate) {
      return NextResponse.json({
        rankings: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 },
        date: null
      });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(actualDate)) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    const escapedDate = escapeSQL(actualDate);

    // Get total count
    const countResult = await query<{ total: number }>(`
      SELECT COUNT(*) as total
      FROM rankings r
      JOIN books b ON r.primary_isbn13 = b.primary_isbn13
      WHERE r.list_name_encoded = '${escapedList}'
      AND r.published_date = '${escapedDate}'
    `);

    const total = countResult[0]?.total || 0;
    const offset = (page - 1) * pageSize;

    // Get rankings with book details
    const rankings = await query<BookWithRanking>(`
      SELECT
        b.primary_isbn13,
        b.primary_isbn10,
        b.title,
        b.author,
        b.publisher,
        b.description,
        b.book_image,
        b.amazon_product_url,
        r.rank,
        r.rank_last_week,
        r.weeks_on_list,
        r.published_date::VARCHAR as published_date,
        r.list_name_encoded,
        l.display_name
      FROM rankings r
      JOIN books b ON r.primary_isbn13 = b.primary_isbn13
      LEFT JOIN bestseller_lists l ON r.list_name_encoded = l.list_name_encoded
      WHERE r.list_name_encoded = '${escapedList}'
      AND r.published_date = '${escapedDate}'
      ORDER BY r.rank ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    // Get available dates for this list
    const dates = await query<{ published_date: string }>(`
      SELECT DISTINCT published_date::VARCHAR as published_date
      FROM rankings
      WHERE list_name_encoded = '${escapedList}'
      ORDER BY published_date DESC
      LIMIT 52
    `);

    return NextResponse.json({
      rankings,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      },
      date: actualDate,
      availableDates: dates.map(d => d.published_date)
    });
  } catch (error) {
    console.error('Error fetching rankings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rankings' },
      { status: 500 }
    );
  }
}

async function getHistoricalRankings(date: string | null, page: number, pageSize: number) {
  try {
    // Get actual date to query
    let actualDate = date;
    if (!date || date === 'latest') {
      const latestResult = await query<{ max_week: string }>(`
        SELECT MAX(week)::VARCHAR as max_week
        FROM historical_rankings
      `);
      actualDate = latestResult[0]?.max_week;
    }

    if (!actualDate) {
      return NextResponse.json({
        rankings: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 },
        date: null
      });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(actualDate)) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    const escapedDate = escapeSQL(actualDate);

    // Get total count
    const countResult = await query<{ total: number }>(`
      SELECT COUNT(*) as total
      FROM historical_rankings
      WHERE week = '${escapedDate}'
    `);

    const total = countResult[0]?.total || 0;
    const offset = (page - 1) * pageSize;

    // Get historical rankings
    const rankings = await query<{
      title: string;
      author: string;
      rank: number;
      week: string;
      year: number;
      title_id: number;
    }>(`
      SELECT
        title,
        author,
        rank,
        week::VARCHAR as week,
        year,
        title_id
      FROM historical_rankings
      WHERE week = '${escapedDate}'
      ORDER BY rank ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    // Convert to BookWithRanking format
    const formattedRankings = rankings.map(r => ({
      primary_isbn13: `historical-${r.title_id}`,
      primary_isbn10: null,
      title: r.title,
      author: r.author,
      publisher: '',
      description: '',
      book_image: null,
      amazon_product_url: null,
      rank: r.rank,
      rank_last_week: 0,
      weeks_on_list: 0,
      published_date: r.week,
      list_name_encoded: 'hardcover-fiction-historical',
      display_name: 'Hardcover Fiction (Historical)'
    }));

    // Get available dates
    const dates = await query<{ week: string }>(`
      SELECT DISTINCT week::VARCHAR as week
      FROM historical_rankings
      ORDER BY week DESC
      LIMIT 100
    `);

    return NextResponse.json({
      rankings: formattedRankings,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      },
      date: actualDate,
      availableDates: dates.map(d => d.week)
    });
  } catch (error) {
    console.error('Error fetching historical rankings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch historical rankings' },
      { status: 500 }
    );
  }
}
