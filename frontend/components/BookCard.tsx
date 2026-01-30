'use client';

function getProxiedImageUrl(url: string | null): string | null {
  if (!url) return null;
  return `/api/image?url=${encodeURIComponent(url)}`;
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

interface BookCardProps {
  book: BookWithRanking;
  showList?: boolean;
}

export default function BookCard({ book, showList = false }: BookCardProps) {
  const rankChange = book.rank_last_week > 0
    ? book.rank_last_week - book.rank
    : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden flex">
      {/* Book Cover */}
      <div className="w-24 sm:w-32 flex-shrink-0 bg-gray-100 dark:bg-gray-700">
        {book.book_image ? (
          <img
            src={getProxiedImageUrl(book.book_image) || ''}
            alt={`Cover of ${book.title}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full min-h-[140px] flex items-center justify-center text-gray-400">
            <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
            </svg>
          </div>
        )}
      </div>

      {/* Book Info */}
      <div className="flex-1 p-3 sm:p-4 flex flex-col justify-between min-w-0">
        <div>
          {/* Rank Badge */}
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white font-bold text-sm">
              #{book.rank}
            </span>
            {rankChange !== null && (
              <span className={`text-xs font-medium ${
                rankChange > 0 ? 'text-green-600 dark:text-green-400' :
                rankChange < 0 ? 'text-red-600 dark:text-red-400' :
                'text-gray-500'
              }`}>
                {rankChange > 0 ? `+${rankChange}` : rankChange < 0 ? rankChange : '—'}
              </span>
            )}
            {book.weeks_on_list > 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {book.weeks_on_list} week{book.weeks_on_list !== 1 ? 's' : ''} on list
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base line-clamp-2">
            {book.title}
          </h3>

          {/* Author */}
          <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">
            by {book.author}
          </p>

          {/* List Name */}
          {showList && book.display_name && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {book.display_name}
            </p>
          )}

          {/* Description */}
          {book.description && (
            <p className="text-gray-500 dark:text-gray-400 text-xs mt-2 line-clamp-2">
              {book.description}
            </p>
          )}
        </div>

        {/* Amazon Link */}
        {book.amazon_product_url && (
          <a
            href={book.amazon_product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center text-xs text-blue-600 dark:text-blue-400 hover:underline touch-manipulation"
          >
            View on Amazon
            <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}
