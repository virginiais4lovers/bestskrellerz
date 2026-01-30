"""Enrich book data with series information from Wikidata."""

import os
import time
import re
from dataclasses import dataclass
from typing import Optional

import duckdb
import requests


WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
REQUEST_DELAY = 1.0  # Be nice to Wikidata - 1 second between requests


@dataclass
class SeriesInfo:
    """Series information for a book."""
    title: str
    author: str
    series_name: str
    series_order: Optional[int]
    wikidata_book_id: str
    wikidata_series_id: str


def normalize_title(title: str) -> str:
    """Normalize a title for matching."""
    # Remove common subtitles and punctuation
    title = title.lower()
    title = re.sub(r'\s*:\s*a novel.*$', '', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(.*?\)\s*', ' ', title)
    title = re.sub(r'[^\w\s]', ' ', title)
    title = re.sub(r'\s+', ' ', title).strip()
    # Truncate very long titles to first 50 chars for faster queries
    if len(title) > 50:
        # Try to cut at a word boundary
        title = title[:50].rsplit(' ', 1)[0]
    return title


def search_wikidata_entities(title: str) -> list[str]:
    """
    Search Wikidata for entities matching the title.

    Args:
        title: Book title to search for

    Returns:
        List of Wikidata entity IDs (Q-numbers)
    """
    search_title = normalize_title(title)

    try:
        response = requests.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbsearchentities",
                "search": search_title,
                "language": "en",
                "format": "json",
                "limit": 5
            },
            headers={
                "User-Agent": "NYTBestsellersEnrichment/1.0"
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        results = data.get("search", [])
        return [r.get("id") for r in results if r.get("id")]

    except requests.RequestException:
        return []


def get_series_info_for_entity(entity_id: str) -> Optional[tuple[str, str, Optional[int], str]]:
    """
    Get series information for a Wikidata entity.

    Also checks if entity is an edition and traverses to the work.

    Args:
        entity_id: Wikidata entity ID (Q-number)

    Returns:
        Tuple of (series_name, series_id, ordinal, book_entity_id) if in a series, None otherwise
    """
    # Query that handles both direct series links and edition->work->series
    query = f"""
    SELECT ?item ?series ?seriesLabel ?ordinal WHERE {{
      {{
        # Direct series link
        BIND(wd:{entity_id} AS ?item)
        wd:{entity_id} wdt:P179 ?series .
        OPTIONAL {{
          wd:{entity_id} p:P179 ?stmt .
          ?stmt pq:P1545 ?ordinal
        }}
      }} UNION {{
        # Edition -> Work -> Series
        wd:{entity_id} wdt:P629 ?item .
        ?item wdt:P179 ?series .
        OPTIONAL {{
          ?item p:P179 ?stmt .
          ?stmt pq:P1545 ?ordinal
        }}
      }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
    }}
    LIMIT 1
    """

    try:
        response = requests.get(
            WIKIDATA_SPARQL_ENDPOINT,
            params={"query": query},
            headers={
                "Accept": "application/json",
                "User-Agent": "NYTBestsellersEnrichment/1.0"
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        bindings = data.get("results", {}).get("bindings", [])
        if not bindings:
            return None

        result = bindings[0]
        series_label = result.get("seriesLabel", {}).get("value", "")
        series_id = result.get("series", {}).get("value", "").split("/")[-1]
        ordinal = result.get("ordinal", {}).get("value")
        item_id = result.get("item", {}).get("value", "").split("/")[-1]

        # Skip if series label is just the Q-number (means no English label)
        if series_label.startswith("Q") and series_label[1:].isdigit():
            return None

        ordinal_int = None
        if ordinal:
            try:
                ordinal_int = int(float(ordinal))
            except ValueError:
                pass

        return (series_label, series_id, ordinal_int, item_id)

    except requests.RequestException:
        return None


def query_wikidata_for_series(title: str, author: str) -> Optional[SeriesInfo]:
    """
    Query Wikidata for series information about a book.

    Uses a two-step approach:
    1. Search for candidate entities by title
    2. Try each candidate until we find one with series information

    Args:
        title: Book title
        author: Book author

    Returns:
        SeriesInfo if found, None otherwise
    """
    # Step 1: Find candidate entities
    entity_ids = search_wikidata_entities(title)
    if not entity_ids:
        return None

    # Step 2: Try each entity until we find one with series info
    for entity_id in entity_ids:
        series_info = get_series_info_for_entity(entity_id)
        if series_info:
            series_name, series_id, ordinal, book_id = series_info
            return SeriesInfo(
                title=title,
                author=author,
                series_name=series_name,
                series_order=ordinal,
                wikidata_book_id=book_id,
                wikidata_series_id=series_id
            )

    return None


def get_unique_books(conn: duckdb.DuckDBPyConnection) -> list[tuple[str, str]]:
    """Get unique title/author pairs from the database."""
    result = conn.execute("""
        SELECT DISTINCT title, author
        FROM nyt_bestsellers.main.all_rankings
        WHERE title IS NOT NULL AND author IS NOT NULL
        ORDER BY title
    """).fetchall()
    return result


def create_series_table(conn: duckdb.DuckDBPyConnection) -> None:
    """Create the book_series table if it doesn't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS nyt_bestsellers.main.book_series (
            title VARCHAR NOT NULL,
            author VARCHAR NOT NULL,
            series_name VARCHAR NOT NULL,
            series_order INTEGER,
            wikidata_book_id VARCHAR,
            wikidata_series_id VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (title, author)
        )
    """)


def save_series_info(conn: duckdb.DuckDBPyConnection, info: SeriesInfo) -> None:
    """Save series information to the database."""
    conn.execute("""
        INSERT OR REPLACE INTO nyt_bestsellers.main.book_series
        (title, author, series_name, series_order, wikidata_book_id, wikidata_series_id)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [
        info.title,
        info.author,
        info.series_name,
        info.series_order,
        info.wikidata_book_id,
        info.wikidata_series_id
    ])


def enrich_books_with_series(
    token: Optional[str] = None,
    database: str = "nyt_bestsellers",
    limit: Optional[int] = None,
    skip_existing: bool = True
) -> dict:
    """
    Main function to enrich books with series information.

    Args:
        token: MotherDuck token (uses MOTHERDUCK_TOKEN env var if not provided)
        database: Database name
        limit: Maximum number of books to process (for testing)
        skip_existing: Skip books already in book_series table

    Returns:
        Dict with stats about the enrichment process
    """
    token = token or os.environ.get("MOTHERDUCK_TOKEN")
    if not token:
        raise ValueError("MOTHERDUCK_TOKEN environment variable is required")

    # Connect to MotherDuck
    conn = duckdb.connect(f"md:{database}?motherduck_token={token}")

    # Create series table
    create_series_table(conn)

    # Get unique books
    books = get_unique_books(conn)
    print(f"Found {len(books)} unique title/author combinations")

    if limit:
        books = books[:limit]
        print(f"Processing first {limit} books")

    # Get existing entries if skipping
    existing = set()
    if skip_existing:
        existing_result = conn.execute("""
            SELECT title, author FROM nyt_bestsellers.main.book_series
        """).fetchall()
        existing = {(row[0], row[1]) for row in existing_result}
        print(f"Skipping {len(existing)} already enriched books")

    stats = {
        "total": len(books),
        "processed": 0,
        "found_series": 0,
        "skipped": 0,
        "errors": 0
    }

    for i, (title, author) in enumerate(books):
        if (title, author) in existing:
            stats["skipped"] += 1
            continue

        print(f"[{i+1}/{len(books)}] Processing: {title[:50]}...")

        try:
            series_info = query_wikidata_for_series(title, author)

            if series_info:
                save_series_info(conn, series_info)
                order_str = f" (Book {series_info.series_order})" if series_info.series_order else ""
                print(f"  Found: {series_info.series_name}{order_str}")
                stats["found_series"] += 1
            else:
                print(f"  No series found")

            stats["processed"] += 1

        except Exception as e:
            print(f"  Error: {e}")
            stats["errors"] += 1

        # Rate limiting
        time.sleep(REQUEST_DELAY)

    conn.close()

    print(f"\nEnrichment complete:")
    print(f"  Total books: {stats['total']}")
    print(f"  Processed: {stats['processed']}")
    print(f"  Found series: {stats['found_series']}")
    print(f"  Skipped (existing): {stats['skipped']}")
    print(f"  Errors: {stats['errors']}")

    return stats


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Enrich book data with series information from Wikidata")
    parser.add_argument("--limit", type=int, help="Limit number of books to process")
    parser.add_argument("--no-skip", action="store_true", help="Don't skip existing entries")
    parser.add_argument("--database", default="nyt_bestsellers", help="Database name")

    args = parser.parse_args()

    enrich_books_with_series(
        database=args.database,
        limit=args.limit,
        skip_existing=not args.no_skip
    )
