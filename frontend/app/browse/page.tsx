'use client';

// Disable static generation - WASM SDK requires browser environment
export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, Suspense } from 'react';
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
  source?: string;
  series_name?: string | null;
}

function BrowseContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isReady, error: connectionError, query } = useMotherDuck();

  const [lists, setLists] = useState<BestSellerList[]>([]);
  const [rankings, setRankings] = useState<BookWithRanking[]>([]);
  const [allDates, setAllDates] = useState<string[]>([]);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 15, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRankings, setIsLoadingRankings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedList = searchParams.get('list') || 'hardcover-fiction';
  const selectedDate = searchParams.get('date') || '';  // Empty = show all weeks aggregated
  const fromYear = searchParams.get('fromYear') || '';
  const toYear = searchParams.get('toYear') || '';
  const excludeSeries = searchParams.get('excludeSeries') === 'true';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Extract unique years from all dates
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    allDates.forEach(date => {
      const year = new Date(date).getFullYear();
      if (!isNaN(year)) years.add(year);
    });
    return Array.from(years).sort((a, b) => b - a); // Sort descending
  }, [allDates]);

  // Filter dates by year range
  const filteredDates = useMemo(() => {
    let dates = allDates;

    if (fromYear || toYear) {
      const fromNum = fromYear ? parseInt(fromYear, 10) : 0;
      const toNum = toYear ? parseInt(toYear, 10) : 9999;

      dates = allDates.filter(date => {
        const year = new Date(date).getFullYear();
        return year >= fromNum && year <= toNum;
      });
    }

    // Limit to 52 weeks if showing all
    return dates.slice(0, 104);
  }, [allDates, fromYear, toYear]);

  // Fetch lists on mount
  useEffect(() => {
    if (!isReady) return;

    const fetchLists = async () => {
      try {
        const listsData = await query<BestSellerList>(`
          SELECT list_name_encoded, display_name
          FROM nyt_bestsellers.main.lists
          ORDER BY display_name
        `);
        setLists(listsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lists');
      } finally {
        setIsLoading(false);
      }
    };

    fetchLists();
  }, [isReady, query]);

  // Fetch all available dates when list changes
  useEffect(() => {
    if (!isReady || !selectedList) {
      setAllDates([]);
      return;
    }

    const fetchDates = async () => {
      try {
        const datesResult = await query<{ published_date: string }>(`
          SELECT DISTINCT published_date::VARCHAR as published_date
          FROM nyt_bestsellers.main.all_rankings
          WHERE list_name = '${escapeSQL(selectedList)}'
          ORDER BY published_date DESC
        `);
        setAllDates(datesResult.map(d => d.published_date));
      } catch (err) {
        console.error('Failed to fetch dates:', err);
      }
    };

    fetchDates();
  }, [isReady, query, selectedList]);

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
        const pageSize = 15;
        const offset = (page - 1) * pageSize;

        // Build WHERE clause for series exclusion
        const seriesFilter = excludeSeries
          ? "AND (b.series_name IS NULL OR b.series_name = '')"
          : '';

        // Build date range filter
        let dateFilter = '';
        if (fromYear) {
          dateFilter += ` AND ar.published_date >= '${escapeSQL(fromYear)}-01-01'`;
        }
        if (toYear) {
          dateFilter += ` AND ar.published_date <= '${escapeSQL(toYear)}-12-31'`;
        }

        if (selectedDate) {
          // Specific week selected - show that week's rankings
          setCurrentDate(selectedDate);

          // Get total count
          const countResult = await query<{ total: number }>(`
            SELECT COUNT(*) as total
            FROM nyt_bestsellers.main.all_rankings ar
            LEFT JOIN nyt_bestsellers.main.books b ON ar.isbn = b.primary_isbn13
            WHERE ar.list_name = '${escapeSQL(selectedList)}'
            AND ar.published_date = '${escapeSQL(selectedDate)}'
            ${seriesFilter}
          `);
          const total = countResult[0]?.total || 0;

          // Get rankings for specific week
          const rankingsData = await query<BookWithRanking>(`
            SELECT
              COALESCE(b.primary_isbn13, ar.isbn, '') as primary_isbn13,
              b.primary_isbn10,
              ar.title,
              ar.author,
              COALESCE(b.publisher, '') as publisher,
              COALESCE(b.description, '') as description,
              b.book_image,
              b.amazon_product_url,
              ar.rank,
              COALESCE(ar.rank_last_week, 0) as rank_last_week,
              COALESCE(ar.weeks_on_list, 0) as weeks_on_list,
              ar.published_date::VARCHAR as published_date,
              ar.list_name as list_name_encoded,
              l.display_name,
              ar.source,
              b.series_name
            FROM nyt_bestsellers.main.all_rankings ar
            LEFT JOIN nyt_bestsellers.main.books b ON ar.isbn = b.primary_isbn13
            LEFT JOIN nyt_bestsellers.main.lists l ON ar.list_name = l.list_name_encoded
            WHERE ar.list_name = '${escapeSQL(selectedList)}'
            AND ar.published_date = '${escapeSQL(selectedDate)}'
            ${seriesFilter}
            ORDER BY ar.rank
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
          // No specific week - show aggregated results ordered by weeks on list
          setCurrentDate(null);

          // Get total count of unique books in range
          const countResult = await query<{ total: number }>(`
            SELECT COUNT(*) as total FROM (
              SELECT DISTINCT ar.title, ar.author
              FROM nyt_bestsellers.main.all_rankings ar
              LEFT JOIN nyt_bestsellers.main.books b ON ar.isbn = b.primary_isbn13
              WHERE ar.list_name = '${escapeSQL(selectedList)}'
              ${dateFilter}
              ${seriesFilter}
            )
          `);
          const total = countResult[0]?.total || 0;

          // Get aggregated rankings - unique books ordered by total weeks on list
          const rankingsData = await query<BookWithRanking>(`
            SELECT
              MAX(COALESCE(b.primary_isbn13, ar.isbn, '')) as primary_isbn13,
              MAX(b.primary_isbn10) as primary_isbn10,
              ar.title,
              ar.author,
              MAX(COALESCE(b.publisher, '')) as publisher,
              MAX(COALESCE(b.description, '')) as description,
              MAX(b.book_image) as book_image,
              MAX(b.amazon_product_url) as amazon_product_url,
              0 as rank,
              0 as rank_last_week,
              COUNT(*) as weeks_on_list,
              MAX(ar.published_date)::VARCHAR as published_date,
              ar.list_name as list_name_encoded,
              MAX(l.display_name) as display_name,
              MAX(ar.source) as source,
              MAX(b.series_name) as series_name
            FROM nyt_bestsellers.main.all_rankings ar
            LEFT JOIN nyt_bestsellers.main.books b ON ar.isbn = b.primary_isbn13
            LEFT JOIN nyt_bestsellers.main.lists l ON ar.list_name = l.list_name_encoded
            WHERE ar.list_name = '${escapeSQL(selectedList)}'
            ${dateFilter}
            ${seriesFilter}
            GROUP BY ar.title, ar.author, ar.list_name
            ORDER BY weeks_on_list DESC, ar.title
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
  }, [isReady, query, selectedList, selectedDate, fromYear, toYear, excludeSeries, filteredDates, allDates, page]);

  const buildUrl = (overrides: Record<string, string | boolean | undefined>) => {
    const params = new URLSearchParams();

    const list = overrides.list !== undefined ? overrides.list : selectedList;
    const from = overrides.fromYear !== undefined ? overrides.fromYear : fromYear;
    const to = overrides.toYear !== undefined ? overrides.toYear : toYear;
    const date = overrides.date !== undefined ? overrides.date : selectedDate;
    const exclude = overrides.excludeSeries !== undefined ? overrides.excludeSeries : excludeSeries;
    const pg = overrides.page !== undefined ? overrides.page : page;

    if (list) params.set('list', list as string);
    if (from) params.set('fromYear', from as string);
    if (to) params.set('toYear', to as string);
    if (date && date !== 'latest') params.set('date', date as string);
    if (exclude) params.set('excludeSeries', 'true');
    if (pg && Number(pg) > 1) params.set('page', String(pg));

    return `/browse?${params.toString()}`;
  };

  const handleListChange = (list: string) => {
    router.push(buildUrl({ list, fromYear: '', toYear: '', date: '', page: '1' }));
  };

  const handleFromYearChange = (year: string) => {
    // If fromYear > toYear, also update toYear
    let newToYear = toYear;
    if (year && toYear && parseInt(year, 10) > parseInt(toYear, 10)) {
      newToYear = year;
    }
    router.push(buildUrl({ fromYear: year, toYear: newToYear, date: '', page: '1' }));
  };

  const handleToYearChange = (year: string) => {
    // If toYear < fromYear, also update fromYear
    let newFromYear = fromYear;
    if (year && fromYear && parseInt(year, 10) < parseInt(fromYear, 10)) {
      newFromYear = year;
    }
    router.push(buildUrl({ fromYear: newFromYear, toYear: year, date: '', page: '1' }));
  };

  const handleExcludeSeriesChange = (exclude: boolean) => {
    router.push(buildUrl({ excludeSeries: exclude, page: '1' }));
  };

  const handleDateChange = (date: string) => {
    router.push(buildUrl({ date, page: '1' }));
  };

  const handlePageChange = (newPage: number) => {
    router.push(buildUrl({ page: String(newPage) }));
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
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Data from 1931 to present
        </p>
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
                {list.list_name_encoded === 'hardcover-fiction' ? ' (1931-present)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Year Range Selectors */}
        {selectedList && availableYears.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-4">
              {/* From Year */}
              <div>
                <label htmlFor="from-year-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  From Year
                </label>
                <select
                  id="from-year-select"
                  value={fromYear}
                  onChange={(e) => handleFromYearChange(e.target.value)}
                  className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-900 dark:text-white touch-manipulation"
                  style={{ minHeight: '44px' }}
                >
                  <option value="">All years</option>
                  {availableYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              {/* To Year */}
              <div>
                <label htmlFor="to-year-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  To Year
                </label>
                <select
                  id="to-year-select"
                  value={toYear}
                  onChange={(e) => handleToYearChange(e.target.value)}
                  className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-900 dark:text-white touch-manipulation"
                  style={{ minHeight: '44px' }}
                >
                  <option value="">All years</option>
                  {availableYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Week Selector */}
            <div>
              <label htmlFor="date-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Week ({filteredDates.length} available{fromYear || toYear ? ` in ${fromYear || '...'}-${toYear || '...'}` : ''})
              </label>
              <select
                id="date-select"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-900 dark:text-white touch-manipulation"
                style={{ minHeight: '44px' }}
              >
                <option value="">All weeks (by total weeks on list)</option>
                {filteredDates.map((date) => (
                  <option key={date} value={date}>
                    {new Date(date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </option>
                ))}
              </select>
            </div>

            {/* Exclude Series Toggle */}
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeSeries}
                  onChange={(e) => handleExcludeSeriesChange(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-500 dark:peer-focus:ring-amber-500 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-amber-500"></div>
              </label>
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Exclude books in a series
              </span>
            </div>
          </>
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
          {/* Current View Display */}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {currentDate ? (
              <>
                Showing rankings for {new Date(currentDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
                {rankings[0]?.source === 'historical_csv' && (
                  <span className="ml-2 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded">
                    Historical Data
                  </span>
                )}
              </>
            ) : (
              <>
                Top bestsellers by weeks on list
                {fromYear && toYear ? ` (${fromYear}-${toYear})` : fromYear ? ` (${fromYear}+)` : toYear ? ` (through ${toYear})` : ''}
              </>
            )}
            {excludeSeries && (
              <span className="ml-2 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded">
                Standalones Only
              </span>
            )}
          </p>

          {/* Book Cards */}
          <div className="space-y-4">
            {rankings.map((book) => (
              <BookCard key={`${book.primary_isbn13 || book.title}-${book.rank}`} book={book} />
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
          <p className="text-gray-600 dark:text-gray-400">
            No rankings found for this selection.
            {excludeSeries && ' Try disabling "Exclude books in a series".'}
          </p>
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
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Hardcover Fiction has data back to 1931
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
