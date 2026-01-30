'use client';

// Disable static generation - WASM SDK requires browser environment
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SearchBar from '@/components/SearchBar';
import BookCard from '@/components/BookCard';
import { useMotherDuck, escapeSQL } from '@/hooks/useMotherDuck';

interface BookWithRanking {
  primary_isbn13: string;
  primary_isbn10: string | null;
  title: string;
  author: string;
  publisher: string;
  description: string;
  book_image: string | null;
  amazon_product_url: string | null;
  rank: number;
  rank_last_week: number;
  weeks_on_list: number;
  published_date: string;
  list_name_encoded: string;
  display_name?: string;
}

interface Appearance {
  list_name_encoded: string;
  display_name: string;
  rank: number;
  published_date: string;
}

export default function Home() {
  const router = useRouter();
  const { isReady, error: connectionError, query } = useMotherDuck();
  const [randomBook, setRandomBook] = useState<{ book: BookWithRanking; appearances: Appearance[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRandomBook = async () => {
    if (!isReady) return;

    setIsLoading(true);
    setError(null);

    try {
      // Get latest date
      const latestResult = await query<{ max_date: string }>(`
        SELECT MAX(published_date)::VARCHAR as max_date
        FROM nyt_bestsellers.main.rankings
      `);

      const latestDate = latestResult[0]?.max_date;
      if (!latestDate) {
        throw new Error('No data available');
      }

      // Get random book
      const books = await query<BookWithRanking>(`
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
        FROM nyt_bestsellers.main.rankings r
        JOIN nyt_bestsellers.main.books b ON r.primary_isbn13 = b.primary_isbn13
        LEFT JOIN nyt_bestsellers.main.lists l ON r.list_name_encoded = l.list_name_encoded
        WHERE r.published_date = '${escapeSQL(latestDate)}'
        ORDER BY RANDOM()
        LIMIT 1
      `);

      if (books.length === 0) {
        throw new Error('No books found');
      }

      const book = books[0];

      // Get appearances
      const appearances = await query<Appearance>(`
        SELECT
          r.list_name_encoded,
          l.display_name,
          r.rank,
          r.published_date::VARCHAR as published_date
        FROM nyt_bestsellers.main.rankings r
        LEFT JOIN nyt_bestsellers.main.lists l ON r.list_name_encoded = l.list_name_encoded
        WHERE r.primary_isbn13 = '${escapeSQL(book.primary_isbn13)}'
        ORDER BY r.published_date DESC
        LIMIT 10
      `);

      setRandomBook({ book, appearances });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      {/* Header */}
      <header className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
          NYT Bestsellers
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          Explore New York Times bestseller lists
        </p>
      </header>

      {/* Connection Status */}
      {connectionError && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-sm">Connection error: {connectionError}</p>
        </div>
      )}

      {!isReady && !connectionError && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <p className="text-amber-600 dark:text-amber-400 text-sm">Connecting to database...</p>
        </div>
      )}

      {/* Search */}
      <div className="mb-8">
        <SearchBar placeholder="Search books by title or author..." />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <button
          onClick={() => router.push('/browse')}
          className="flex flex-col items-center justify-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow touch-manipulation"
          style={{ minHeight: '100px' }}
        >
          <svg className="w-8 h-8 text-amber-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Browse Lists</span>
        </button>

        <button
          onClick={fetchRandomBook}
          disabled={isLoading || !isReady}
          className="flex flex-col items-center justify-center p-6 bg-amber-500 hover:bg-amber-600 rounded-lg shadow-md hover:shadow-lg transition-all touch-manipulation disabled:opacity-50"
          style={{ minHeight: '100px' }}
        >
          {isLoading ? (
            <svg className="animate-spin w-8 h-8 text-white mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="w-8 h-8 text-white mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span className="text-sm font-medium text-white">I'm Feeling Lucky</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Random Book Result */}
      {randomBook && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Your Lucky Pick
            </h2>
            <button
              onClick={fetchRandomBook}
              disabled={isLoading}
              className="text-amber-500 hover:text-amber-600 text-sm font-medium touch-manipulation"
            >
              Try Again
            </button>
          </div>

          <BookCard book={randomBook.book} showList={true} />

          {/* Appearances */}
          {randomBook.appearances.length > 1 && (
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Recent List Appearances
              </h3>
              <ul className="space-y-1">
                {randomBook.appearances.slice(0, 5).map((app, idx) => (
                  <li key={idx} className="text-xs text-gray-600 dark:text-gray-400 flex justify-between">
                    <span>{app.display_name || app.list_name_encoded}</span>
                    <span>#{app.rank} - {app.published_date}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Welcome Message (when no random book) */}
      {!randomBook && !error && (
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Discover Bestsellers
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm max-w-xs mx-auto">
            Browse bestseller lists, search for your favorite books, or let us surprise you with a random pick!
          </p>
        </div>
      )}
    </div>
  );
}
