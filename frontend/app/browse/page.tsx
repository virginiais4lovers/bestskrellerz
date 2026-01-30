'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import BookCard from '@/components/BookCard';
import { BestSellerList, BookWithRanking } from '@/lib/db';

interface ListsResponse {
  lists: BestSellerList[];
  hasHistoricalData: boolean;
}

interface RankingsResponse {
  rankings: BookWithRanking[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  date: string | null;
  availableDates: string[];
}

function BrowseContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

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
    const fetchLists = async () => {
      try {
        const res = await fetch('/api/lists');
        if (!res.ok) throw new Error('Failed to fetch lists');
        const data: ListsResponse = await res.json();
        setLists(data.lists);
        setHasHistoricalData(data.hasHistoricalData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lists');
      } finally {
        setIsLoading(false);
      }
    };

    fetchLists();
  }, []);

  // Fetch rankings when list or date changes
  useEffect(() => {
    if (!selectedList) {
      setRankings([]);
      return;
    }

    const fetchRankings = async () => {
      setIsLoadingRankings(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          list: selectedList,
          date: selectedDate,
          page: page.toString(),
          pageSize: '15'
        });

        const res = await fetch(`/api/rankings?${params}`);
        if (!res.ok) throw new Error('Failed to fetch rankings');

        const data: RankingsResponse = await res.json();
        setRankings(data.rankings);
        setAvailableDates(data.availableDates);
        setCurrentDate(data.date);
        setPagination(data.pagination);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load rankings');
      } finally {
        setIsLoadingRankings(false);
      }
    };

    fetchRankings();
  }, [selectedList, selectedDate, page]);

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

  if (isLoading) {
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
