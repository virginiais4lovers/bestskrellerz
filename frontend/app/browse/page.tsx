'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import BookCard from '@/components/BookCard';
import { useMotherDuck, escapeSQL } from '@/hooks/useMotherDuck';

interface BestSellerList {
  list_name_encoded: string;
  display_name: string;
}

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

function BrowseContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isReady, error: connectionError, query } = useMotherDuck();

  const [lists, setLists] = useState<BestSellerList[]>([]);
  const [hasHistoricalData, setHasHistoricalData] = useState(false);
  const [rankings, setRankings] = useState<BookWithRanking[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 15, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRankings, setIsLoadingRankings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedList = searchParams.get('list') || '';
  const selectedDate = searchParams.get('date') || 'latest';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Fetch lists on mount
  useEffect(() => {
    if (!isReady) return;

    const fetchLists = async () => {
      try {
        const listsData = await query<BestSellerList>(`
          SELECT list_name_encoded, display_name
          FROM nyt_bestsellers.main.bestseller_lists
          ORDER BY display_name
        `);
        setLists(listsData);

        // Check for historical data
        const historicalCheck = await query<{ cnt: number }>(`
          SELECT COUNT(*) as cnt FROM nyt_bestsellers.main.historical_rankings LIMIT 1
        `).catch(() => [{ cnt: 0 }]);
        setHasHistoricalData(historicalCheck[0]?.cnt > 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lists');
      } finally {
        setIsLoading(false);
      }
    };

    fetchLists();
  }, [isReady, query]);

  // Fetch rankings when list or date changes
  useEffect(() => {
    if (!isReady || !selectedList) {
      setRankings([]);
      return;
    }

    const fetchRankings = async () => {
      setIsLoadingRankings(true);
      setError(null);

      try {
        // Check if this is the historical list
        const isHistorical = selectedList === 'hardcover-fiction-historical';
        const pageSize = 15;
        const offset = (page - 1) * pageSize;

        if (isHistorical) {
          // Fetch historical data
          let dateToUse = selectedDate;

          if (selectedDate === 'latest') {
            const latestResult = await query<{ max_week: string }>(`
              SELECT MAX(week)::VARCHAR as max_week FROM nyt_bestsellers.main.historical_rankings
            `);
            dateToUse = latestResult[0]?.max_week || '';
          }

          // Get available dates (sample of years)
          const datesResult = await query<{ week: string }>(`
            SELECT DISTINCT week::VARCHAR as week
            FROM nyt_bestsellers.main.historical_rankings
            ORDER BY week DESC
            LIMIT 100
          `);
          setAvailableDates(datesResult.map(d => d.week));
          setCurrentDate(dateToUse);

          // Get rankings
          const countResult = await query<{ total: number }>(`
            SELECT COUNT(*) as total FROM nyt_bestsellers.main.historical_rankings
            WHERE week = '${escapeSQL(dateToUse)}'
          `);
          const total = countResult[0]?.total || 0;

          const rankingsData = await query<BookWithRanking>(`
            SELECT
              CAST(title_id AS VARCHAR) as primary_isbn13,
              NULL as primary_isbn10,
              title,
              author,
              '' as publisher,
              '' as description,
              NULL as book_image,
              NULL as amazon_product_url,
              rank,
              0 as rank_last_week,
              0 as weeks_on_list,
              week::VARCHAR as published_date,
              'hardcover-fiction-historical' as list_name_encoded,
              'Hardcover Fiction (Historical)' as display_name
            FROM nyt_bestsellers.main.historical_rankings
            WHERE week = '${escapeSQL(dateToUse)}'
            ORDER BY rank
            LIMIT ${pageSize} OFFSET ${offset}
          `);

          setRankings(rankingsData);
          setPagination({
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize)
          });
        } else {
          // Fetch current API data
          let dateToUse = selectedDate;

          if (selectedDate === 'latest') {
            const latestResult = await query<{ max_date: string }>(`
              SELECT MAX(published_date)::VARCHAR as max_date
              FROM nyt_bestsellers.main.rankings
              WHERE list_name_encoded = '${escapeSQL(selectedList)}'
            `);
            dateToUse = latestResult[0]?.max_date || '';
          }

          // Get available dates
          const datesResult = await query<{ published_date: string }>(`
            SELECT DISTINCT published_date::VARCHAR as published_date
            FROM nyt_bestsellers.main.rankings
            WHERE list_name_encoded = '${escapeSQL(selectedList)}'
            ORDER BY published_date DESC
            LIMIT 52
          `);
          setAvailableDates(datesResult.map(d => d.published_date));
          setCurrentDate(dateToUse);

          // Get total count
          const countResult = await query<{ total: number }>(`
            SELECT COUNT(*) as total FROM nyt_bestsellers.main.rankings
            WHERE list_name_encoded = '${escapeSQL(selectedList)}'
            AND published_date = '${escapeSQL(dateToUse)}'
          `);
          const total = countResult[0]?.total || 0;

          // Get rankings with book details
          const rankingsData = await query<BookWithRanking>(`
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
            LEFT JOIN nyt_bestsellers.main.bestseller_lists l ON r.list_name_encoded = l.list_name_encoded
            WHERE r.list_name_encoded = '${escapeSQL(selectedList)}'
            AND r.published_date = '${escapeSQL(dateToUse)}'
            ORDER BY r.rank
            LIMIT ${pageSize} OFFSET ${offset}
          `);

          setRankings(rankingsData);
          setPagination({
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize)
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load rankings');
      } finally {
        setIsLoadingRankings(false);
      }
    };

    fetchRankings();
  }, [isReady, query, selectedList, selectedDate, page]);

  const handleListChange = (list: string) => {
    const params = new URLSearchParams();
    if (list) params.set('list', list);
    router.push(`/browse?${params.toString()}`);
  };

  const handleDateChange = (date: string) => {
    const params = new URLSearchParams();
    params.set('list', selectedList);
    if (date !== 'latest') params.set('date', date);
    router.push(`/browse?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams();
    params.set('list', selectedList);
    if (selectedDate !== 'latest') params.set('date', selectedDate);
    if (newPage > 1) params.set('page', newPage.toString());
    router.push(`/browse?${params.toString()}`);
  };

  if (isLoading || !isReady) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
          Browse Bestsellers
        </h1>
      </header>

      {/* Connection Error */}
      {connectionError && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-sm">Connection error: {connectionError}</p>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-4 mb-6">
        {/* List Selector */}
        <div>
          <label htmlFor="list-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Select List
          </label>
          <select
            id="list-select"
            value={selectedList}
            onChange={(e) => handleListChange(e.target.value)}
            className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-900 dark:text-white touch-manipulation"
            style={{ minHeight: '44px' }}
          >
            <option value="">Choose a bestseller list...</option>
            {lists.map((list) => (
              <option key={list.list_name_encoded} value={list.list_name_encoded}>
                {list.display_name}
              </option>
            ))}
            {hasHistoricalData && (
              <option value="hardcover-fiction-historical">
                Hardcover Fiction (Historical 1931-2020)
              </option>
            )}
          </select>
        </div>

        {/* Date Selector */}
        {selectedList && availableDates.length > 0 && (
          <div>
            <label htmlFor="date-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Select Date
            </label>
            <select
              id="date-select"
              value={selectedDate === 'latest' ? availableDates[0] : selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-900 dark:text-white touch-manipulation"
              style={{ minHeight: '44px' }}
            >
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {new Date(date).toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Loading Rankings */}
      {isLoadingRankings && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500"></div>
        </div>
      )}

      {/* Rankings */}
      {!isLoadingRankings && rankings.length > 0 && (
        <div className="space-y-4">
          {/* Current Date Display */}
          {currentDate && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Showing rankings for {new Date(currentDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </p>
          )}

          {/* Book Cards */}
          <div className="space-y-4">
            {rankings.map((book) => (
              <BookCard key={`${book.primary_isbn13}-${book.rank}`} book={book} />
            ))}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between py-4">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                style={{ minHeight: '44px' }}
              >
                Previous
              </button>

              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {pagination.page} of {pagination.totalPages}
              </span>

              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                style={{ minHeight: '44px' }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!isLoadingRankings && selectedList && rankings.length === 0 && !error && (
        <div className="text-center py-12">
          <p className="text-gray-600 dark:text-gray-400">No rankings found for this selection.</p>
        </div>
      )}

      {/* Initial State */}
      {!selectedList && (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Select a bestseller list to view rankings
          </p>
        </div>
      )}
    </div>
  );
}

export default function BrowsePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500"></div>
      </div>
    }>
      <BrowseContent />
    </Suspense>
  );
}
