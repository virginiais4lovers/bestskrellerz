import { NextRequest, NextResponse } from 'next/server';
import { query, escapeSQL } from '@/lib/db';

interface SearchResultRow {
  primary_isbn13: string;
  primary_isbn10: string | null;
  title: string;
  author: string;
  publisher: string;
  description: string;
  book_image: string | null;
  amazon_product_url: string | null;
  appearance_count: number;
  lists: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get('q');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);

  if (!q || q.trim().length < 2) {
    return NextResponse.json(
      { error: 'Query must be at least 2 characters' },
      { status: 400 }
    );
  }

  // Escape and prepare search term
  const searchTerm = `%${escapeSQL(q.toLowerCase())}%`;

  try {
    // Search in books table (API data)
    const countResult = await query<{ total: number }>(`
      SELECT COUNT(DISTINCT b.primary_isbn13) as total
      FROM books b
      WHERE LOWER(b.title) LIKE '${searchTerm}' OR LOWER(b.author) LIKE '${searchTerm}'
    `);

    const total = Number(countResult[0]?.total) || 0;
    const offset = (page - 1) * pageSize;

    const results = await query<SearchResultRow>(`
      SELECT
        b.primary_isbn13,
        b.primary_isbn10,
        b.title,
        b.author,
        b.publisher,
        b.description,
        b.book_image,
        b.amazon_product_url,
        COUNT(DISTINCT r.id) as appearance_count,
        STRING_AGG(DISTINCT l.display_name, ', ') as lists
      FROM books b
      LEFT JOIN rankings r ON b.primary_isbn13 = r.primary_isbn13
      LEFT JOIN bestseller_lists l ON r.list_name_encoded = l.list_name_encoded
      WHERE LOWER(b.title) LIKE '${searchTerm}' OR LOWER(b.author) LIKE '${searchTerm}'
      GROUP BY
        b.primary_isbn13,
        b.primary_isbn10,
        b.title,
        b.author,
        b.publisher,
        b.description,
        b.book_image,
        b.amazon_product_url
      ORDER BY appearance_count DESC, b.title ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    // Also search historical data if available
    let historicalResults: { title: string; author: string; appearance_count: number }[] = [];
    try {
      historicalResults = await query<{ title: string; author: string; appearance_count: number }>(`
        SELECT
          title,
          author,
          COUNT(*) as appearance_count
        FROM historical_rankings
        WHERE LOWER(title) LIKE '${searchTerm}' OR LOWER(author) LIKE '${searchTerm}'
        GROUP BY title, author
        ORDER BY appearance_count DESC
        LIMIT 10
      `);
    } catch {
      // Historical table might not exist, that's fine
    }

    return NextResponse.json({
      results: results.map(r => ({
        ...r,
        appearance_count: Number(r.appearance_count),
        lists: r.lists ? r.lists.split(', ') : []
      })),
      historicalResults: historicalResults.map(r => ({
        ...r,
        appearance_count: Number(r.appearance_count)
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      },
      query: q
    });
  } catch (error) {
    console.error('Error searching:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
