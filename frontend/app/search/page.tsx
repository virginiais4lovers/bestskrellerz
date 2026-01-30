'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import SearchBar from '@/components/SearchBar';
import BookCard from '@/components/BookCard';
import { BookWithRanking } from '@/lib/db';

interface SearchResult {
  primary_isbn13: string;
  primary_isbn10: string | null;
  title: string;
  author: string;
  publisher: string;
  description: string;
  book_image: string | null;
  amazon_product_url: string | null;
  appearance_count: number;
  lists: string[];
}

interface HistoricalResult {
  title: string;
  author: string;
  appearance_count: number;
}

interface SearchResponse {
  results: SearchResult[];
  historicalResults: HistoricalResult[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  query: string;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const query = searchParams.get('q') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [historicalResults, setHistoricalResults] = useState<HistoricalResult[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      setHistoricalResults([]);
      setHasSearched(false);
      return;
    }

    const search = async () => {
      setIsLoading(true);
      setError(null);
      setHasSearched(true);

      try {
        const params = new URLSearchParams({
          q: query,
          page: page.toString(),
          pageSize: '20'
        });

        const res = await fetch(`/api/search?${params}`);
        if (!res.ok) throw new Error('Search failed');

        const data: SearchResponse = await res.json();
        setResults(data.results);
        setHistoricalResults(data.historicalResults);
        setPagination(data.pagination);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setIsLoading(false);
      }
    };

    search();
  }, [query, page]);

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams();
    params.set('q', query);
    if (newPage > 1) params.set('page', newPage.toString());
    router.push(`/search?${params.toString()}`);
  };

  // Convert SearchResult to BookWithRanking for BookCard
  const toBookWithRanking = (result: SearchResult): BookWithRanking => ({
    ...result,
    rank: 0,
    rank_last_week: 0,
    weeks_on_list: result.appearance_count,
    published_date: '',
    list_name_encoded: '',
    display_name: result.lists.length > 0 ? result.lists[0] : undefined
  });

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-4">
          Search
        </h1>
        <SearchBar initialQuery={query} autoFocus={!query} />
      </header>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500"></div>
        </div>
      )}

      {/* Results */}
      {!isLoading && hasSearched && (
        <div className="space-y-6">
          {/* Results count */}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {pagination.total === 0
              ? `No results found for "${query}"`
              : `Found ${pagination.total} result${pagination.total !== 1 ? 's' : ''} for "${query}"`
            }
          </p>

          {/* API Data Results */}
          {results.length > 0 && (
            <div className="space-y-4">
              {results.map((result) => (
                <div key={result.primary_isbn13} className="space-y-2">
                  <BookCard book={toBookWithRanking(result)} showList={true} />
                  {result.lists.length > 0 && (
                    <div className="ml-28 sm:ml-36">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Appeared on {result.appearance_count} list{result.appearance_count !== 1 ? 's' : ''}:
                        {' '}{result.lists.slice(0, 3).join(', ')}
                        {result.lists.length > 3 && ` +${result.lists.length - 3} more`}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Historical Results */}
          {historicalResults.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Historical Matches (1931-2020)
              </h2>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {historicalResults.map((result, idx) => (
                    <li key={idx} className="p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-medium text-gray-900 dark:text-white">
                            {result.title}
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            by {result.author}
                          </p>
                        </div>
                        <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                          {result.appearance_count} week{result.appearance_count !== 1 ? 's' : ''} on list
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

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

      {/* Initial State */}
      {!isLoading && !hasSearched && (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Search for books by title or author
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
            Enter at least 2 characters to search
          </p>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500"></div>
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}
