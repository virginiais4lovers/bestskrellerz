'use client';

// Disable static generation - WASM SDK requires browser environment
export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import SearchBar from '@/components/SearchBar';
import BookCard from '@/components/BookCard';
import { useMotherDuck, escapeSQL } from '@/hooks/useMotherDuck';

interface SearchResult {
  title: string;
  author: string;
  appearance_count: number;
  first_appearance: string;
  last_appearance: string;
  primary_isbn13: string | null;
  publisher: string | null;
  description: string | null;
  book_image: string | null;
  amazon_product_url: string | null;
}

interface AppearanceDate {
  published_date: string;
  rank: number;
  list_name: string;
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

type SearchType = 'all' | 'title' | 'author';

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isReady, error: connectionError, query } = useMotherDuck();

  const searchQuery = searchParams.get('q') || '';
  const searchType = (searchParams.get('type') as SearchType) || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [appearanceDates, setAppearanceDates] = useState<Record<string, AppearanceDate[]>>({});
  const [loadingDates, setLoadingDates] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (!isReady || !searchQuery || searchQuery.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    const search = async () => {
      setIsLoading(true);
      setError(null);
      setHasSearched(true);
      setExpandedResult(null);
      setAppearanceDates({});

      try {
        const pageSize = 20;
        const offset = (page - 1) * pageSize;
        const escapedQuery = escapeSQL(searchQuery).toLowerCase();

        // Build WHERE clause based on search type
        let whereClause = '';
        if (searchType === 'title') {
          whereClause = `LOWER(ar.title) LIKE '%${escapedQuery}%'`;
        } else if (searchType === 'author') {
          whereClause = `LOWER(ar.author) LIKE '%${escapedQuery}%'`;
        } else {
          whereClause = `(LOWER(ar.title) LIKE '%${escapedQuery}%' OR LOWER(ar.author) LIKE '%${escapedQuery}%')`;
        }

        // Search using all_rankings view for unified results (API + historical)
        const countResult = await query<{ total: number }>(`
          SELECT COUNT(*) as total FROM (
            SELECT DISTINCT ar.title, ar.author
            FROM nyt_bestsellers.main.all_rankings ar
            WHERE ${whereClause}
          )
        `);
        const total = countResult[0]?.total || 0;

        // Get aggregated results
        const searchResults = await query<SearchResult>(`
          SELECT
            ar.title,
            ar.author,
            COUNT(*) as appearance_count,
            MIN(ar.published_date)::VARCHAR as first_appearance,
            MAX(ar.published_date)::VARCHAR as last_appearance,
            MAX(b.primary_isbn13) as primary_isbn13,
            MAX(b.publisher) as publisher,
            MAX(b.description) as description,
            MAX(b.book_image) as book_image,
            MAX(b.amazon_product_url) as amazon_product_url
          FROM nyt_bestsellers.main.all_rankings ar
          LEFT JOIN nyt_bestsellers.main.books b ON ar.isbn = b.primary_isbn13
          WHERE ${whereClause}
          GROUP BY ar.title, ar.author
          ORDER BY appearance_count DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `);

        setResults(searchResults);
        setPagination({
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setIsLoading(false);
      }
    };

    search();
  }, [isReady, query, searchQuery, searchType, page]);

  const fetchAppearanceDates = async (title: string, author: string) => {
    const key = `${title}-${author}`;

    if (appearanceDates[key]) {
      // Already loaded, just toggle expansion
      setExpandedResult(expandedResult === key ? null : key);
      return;
    }

    setLoadingDates(key);
    setExpandedResult(key);

    try {
      const escapedTitle = escapeSQL(title);
      const escapedAuthor = escapeSQL(author);

      const dates = await query<AppearanceDate>(`
        SELECT
          published_date::VARCHAR as published_date,
          rank,
          list_name
        FROM nyt_bestsellers.main.all_rankings
        WHERE title = '${escapedTitle}' AND author = '${escapedAuthor}'
        ORDER BY published_date DESC
      `);

      setAppearanceDates(prev => ({ ...prev, [key]: dates }));
    } catch (err) {
      console.error('Failed to fetch appearance dates:', err);
    } finally {
      setLoadingDates(null);
    }
  };

  const handleSearchTypeChange = (type: SearchType) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (type !== 'all') params.set('type', type);
    router.push(`/search?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams();
    params.set('q', searchQuery);
    if (searchType !== 'all') params.set('type', searchType);
    if (newPage > 1) params.set('page', newPage.toString());
    router.push(`/search?${params.toString()}`);
  };

  // Convert SearchResult to BookWithRanking for BookCard
  const toBookWithRanking = (result: SearchResult): BookWithRanking => ({
    primary_isbn13: result.primary_isbn13 || '',
    primary_isbn10: null,
    title: result.title,
    author: result.author,
    publisher: result.publisher || '',
    description: result.description || '',
    book_image: result.book_image,
    amazon_product_url: result.amazon_product_url,
    rank: 0,
    rank_last_week: 0,
    weeks_on_list: result.appearance_count,
    published_date: '',
    list_name_encoded: '',
    display_name: undefined
  });

  // Group dates by year for better display
  const groupDatesByYear = (dates: AppearanceDate[]): Record<number, AppearanceDate[]> => {
    const grouped: Record<number, AppearanceDate[]> = {};
    dates.forEach(date => {
      const year = new Date(date.published_date).getFullYear();
      if (!grouped[year]) grouped[year] = [];
      grouped[year].push(date);
    });
    return grouped;
  };

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-4">
          Search
        </h1>
        <SearchBar initialQuery={searchQuery} autoFocus={!searchQuery} />

        {/* Search Type Filter */}
        <div className="flex gap-2 mt-4">
          {(['all', 'title', 'author'] as SearchType[]).map((type) => (
            <button
              key={type}
              onClick={() => handleSearchTypeChange(type)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchType === type
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {type === 'all' ? 'All' : type === 'title' ? 'Title' : 'Author'}
            </button>
          ))}
        </div>
      </header>

      {/* Connection Error */}
      {connectionError && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-sm">Connection error: {connectionError}</p>
        </div>
      )}

      {/* Connecting */}
      {!isReady && !connectionError && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <p className="text-amber-600 dark:text-amber-400 text-sm">Connecting to database...</p>
        </div>
      )}

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
              ? `No results found for "${searchQuery}"${searchType !== 'all' ? ` in ${searchType}` : ''}`
              : `Found ${pagination.total} result${pagination.total !== 1 ? 's' : ''} for "${searchQuery}"${searchType !== 'all' ? ` in ${searchType}` : ''}`
            }
          </p>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-4">
              {results.map((result, idx) => {
                const key = `${result.title}-${result.author}`;
                const isExpanded = expandedResult === key;
                const dates = appearanceDates[key];
                const isLoadingThisDates = loadingDates === key;

                return (
                  <div key={`${key}-${idx}`} className="space-y-2">
                    <BookCard book={toBookWithRanking(result)} showList={false} />
                    <div className="ml-28 sm:ml-36">
                      <button
                        onClick={() => fetchAppearanceDates(result.title, result.author)}
                        className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 flex items-center gap-1"
                      >
                        <span>
                          {result.appearance_count} week{result.appearance_count !== 1 ? 's' : ''} on list
                          {result.first_appearance && result.last_appearance && (
                            <span className="text-gray-500 dark:text-gray-400 ml-1">
                              ({new Date(result.first_appearance).getFullYear()} - {new Date(result.last_appearance).getFullYear()})
                            </span>
                          )}
                        </span>
                        <svg
                          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Expanded Dates */}
                      {isExpanded && (
                        <div className="mt-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                          {isLoadingThisDates ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-amber-500"></div>
                              Loading dates...
                            </div>
                          ) : dates ? (
                            <div className="space-y-3">
                              {Object.entries(groupDatesByYear(dates))
                                .sort(([a], [b]) => Number(b) - Number(a))
                                .map(([year, yearDates]) => (
                                  <div key={year}>
                                    <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                      {year} ({yearDates.length} week{yearDates.length !== 1 ? 's' : ''})
                                    </h4>
                                    <div className="flex flex-wrap gap-1">
                                      {yearDates.map((d, i) => (
                                        <span
                                          key={i}
                                          className="inline-flex items-center text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-0.5"
                                          title={`#${d.rank} on ${d.list_name}`}
                                        >
                                          {new Date(d.published_date).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric'
                                          })}
                                          <span className="ml-1 text-amber-600 dark:text-amber-400">#{d.rank}</span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
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
            Includes data from 1931 to present
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
