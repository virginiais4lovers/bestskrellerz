import { NextResponse } from 'next/server';
import { query, BookWithRanking } from '@/lib/db';

export async function GET() {
  try {
    // Get a random book from current bestsellers
    // First, find the latest date across all lists
    const latestDateResult = await query<{ max_date: string }>(`
      SELECT MAX(published_date)::VARCHAR as max_date
      FROM rankings
    `);

    const latestDate = latestDateResult[0]?.max_date;

    if (!latestDate) {
      return NextResponse.json(
        { error: 'No bestseller data available' },
        { status: 404 }
      );
    }

    // Get a random book from the latest rankings
    const randomBook = await query<BookWithRanking>(`
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
      WHERE r.published_date = '${latestDate}'
      ORDER BY RANDOM()
      LIMIT 1
    `);

    if (randomBook.length === 0) {
      return NextResponse.json(
        { error: 'No books found' },
        { status: 404 }
      );
    }

    const book = randomBook[0];
    const isbn = book.primary_isbn13.replace(/'/g, "''");

    // Get all list appearances for this book
    const appearances = await query<{
      list_name_encoded: string;
      display_name: string;
      rank: number;
      published_date: string;
    }>(`
      SELECT
        r.list_name_encoded,
        l.display_name,
        r.rank,
        r.published_date::VARCHAR as published_date
      FROM rankings r
      LEFT JOIN bestseller_lists l ON r.list_name_encoded = l.list_name_encoded
      WHERE r.primary_isbn13 = '${isbn}'
      ORDER BY r.published_date DESC
      LIMIT 10
    `);

    return NextResponse.json({
      book: randomBook[0],
      appearances
    });
  } catch (error) {
    console.error('Error getting random book:', error);
    return NextResponse.json(
      { error: 'Failed to get random book' },
      { status: 500 }
    );
  }
}
