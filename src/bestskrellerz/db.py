"""Database operations for MotherDuck/DuckDB."""

import os
from typing import Optional

import duckdb

from .models import BestSellerList, Book, Ranking


def get_connection(database: Optional[str] = None) -> duckdb.DuckDBPyConnection:
    """
    Get a connection to MotherDuck.

    Args:
        database: Database name. If not provided, uses MOTHERDUCK_DATABASE env var.

    Returns:
        DuckDB connection to MotherDuck.
    """
    token = os.environ.get("MOTHERDUCK_TOKEN")
    if not token:
        raise ValueError("MOTHERDUCK_TOKEN environment variable is required")

    db_name = database or os.environ.get("MOTHERDUCK_DATABASE", "nyt_bestsellers")
    connection_string = f"md:{db_name}?motherduck_token={token}"

    return duckdb.connect(connection_string)


def init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """
    Initialize the database schema.

    Creates the lists, books, and rankings tables if they don't exist.
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lists (
            list_name_encoded VARCHAR PRIMARY KEY,
            display_name VARCHAR,
            oldest_published_date DATE,
            newest_published_date DATE,
            updated VARCHAR
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS books (
            primary_isbn13 VARCHAR PRIMARY KEY,
            primary_isbn10 VARCHAR,
            title VARCHAR,
            author VARCHAR,
            publisher VARCHAR,
            description VARCHAR,
            book_image VARCHAR,
            amazon_product_url VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS rankings (
            id VARCHAR PRIMARY KEY,
            list_name_encoded VARCHAR,
            published_date DATE,
            rank INTEGER,
            rank_last_week INTEGER,
            weeks_on_list INTEGER,
            primary_isbn13 VARCHAR,
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


def upsert_list(conn: duckdb.DuckDBPyConnection, lst: BestSellerList) -> None:
    """Insert or update a Best Seller list."""
    conn.execute(
        """
        INSERT OR REPLACE INTO lists (
            list_name_encoded, display_name, oldest_published_date,
            newest_published_date, updated
        ) VALUES (?, ?, ?, ?, ?)
        """,
        [
            lst.list_name_encoded,
            lst.display_name,
            lst.oldest_published_date,
            lst.newest_published_date,
            lst.updated,
        ],
    )


def upsert_book(conn: duckdb.DuckDBPyConnection, book: Book) -> None:
    """Insert or update a book."""
    conn.execute(
        """
        INSERT OR REPLACE INTO books (
            primary_isbn13, primary_isbn10, title, author, publisher,
            description, book_image, amazon_product_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            book.primary_isbn13,
            book.primary_isbn10,
            book.title,
            book.author,
            book.publisher,
            book.description,
            book.book_image,
            book.amazon_product_url,
        ],
    )


def upsert_ranking(conn: duckdb.DuckDBPyConnection, ranking: Ranking) -> None:
    """Insert or update a ranking entry."""
    conn.execute(
        """
        INSERT OR REPLACE INTO rankings (
            id, list_name_encoded, published_date, rank, rank_last_week,
            weeks_on_list, primary_isbn13
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ranking.id,
            ranking.list_name_encoded,
            ranking.published_date,
            ranking.rank,
            ranking.rank_last_week,
            ranking.weeks_on_list,
            ranking.primary_isbn13,
        ],
    )


def upsert_books_batch(conn: duckdb.DuckDBPyConnection, books: list[Book]) -> None:
    """Insert or update multiple books in a batch."""
    if not books:
        return

    conn.executemany(
        """
        INSERT OR REPLACE INTO books (
            primary_isbn13, primary_isbn10, title, author, publisher,
            description, book_image, amazon_product_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                book.primary_isbn13,
                book.primary_isbn10,
                book.title,
                book.author,
                book.publisher,
                book.description,
                book.book_image,
                book.amazon_product_url,
            )
            for book in books
        ],
    )


def upsert_rankings_batch(conn: duckdb.DuckDBPyConnection, rankings: list[Ranking]) -> None:
    """Insert or update multiple rankings in a batch."""
    if not rankings:
        return

    conn.executemany(
        """
        INSERT OR REPLACE INTO rankings (
            id, list_name_encoded, published_date, rank, rank_last_week,
            weeks_on_list, primary_isbn13
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                ranking.id,
                ranking.list_name_encoded,
                ranking.published_date,
                ranking.rank,
                ranking.rank_last_week,
                ranking.weeks_on_list,
                ranking.primary_isbn13,
            )
            for ranking in rankings
        ],
    )


def get_stats(conn: duckdb.DuckDBPyConnection) -> dict:
    """Get statistics about the stored data."""
    lists_count = conn.execute("SELECT COUNT(*) FROM lists").fetchone()[0]
    books_count = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
    rankings_count = conn.execute("SELECT COUNT(*) FROM rankings").fetchone()[0]

    # Get date range of rankings
    date_range = conn.execute(
        """
        SELECT MIN(published_date), MAX(published_date)
        FROM rankings
        """
    ).fetchone()

    return {
        "lists_count": lists_count,
        "books_count": books_count,
        "rankings_count": rankings_count,
        "oldest_ranking_date": date_range[0] if date_range else None,
        "newest_ranking_date": date_range[1] if date_range else None,
    }


def get_all_list_names(conn: duckdb.DuckDBPyConnection) -> list[str]:
    """Get all stored list names."""
    result = conn.execute("SELECT list_name_encoded FROM lists").fetchall()
    return [row[0] for row in result]


def init_historical_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """
    Create the historical_rankings table for CSV import data.

    This table stores historical NYT bestseller data from CSV files,
    which has a different structure than the live API data.
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS historical_rankings (
            title_id INTEGER,
            week DATE,
            year INTEGER,
            rank INTEGER,
            title VARCHAR,
            author VARCHAR,
            author_authorized_heading VARCHAR,
            author_lccn VARCHAR,
            author_viaf VARCHAR,
            author_wikidata VARCHAR,
            oclc_isbn VARCHAR,
            oclc_owi DOUBLE,
            oclc_holdings DOUBLE,
            oclc_eholdings DOUBLE,
            PRIMARY KEY (title_id, week)
        )
    """)


def import_historical_csv(conn: duckdb.DuckDBPyConnection, csv_path: str) -> dict:
    """
    Import historical bestseller data from a CSV file, skipping duplicates.

    Args:
        conn: DuckDB connection
        csv_path: Path to the CSV file

    Returns:
        Dictionary with import statistics
    """
    # First, ensure the table exists
    init_historical_schema(conn)

    # Count existing records
    before_count = conn.execute("SELECT COUNT(*) FROM historical_rankings").fetchone()[0]

    # Use INSERT OR IGNORE to skip duplicates (based on primary key: title_id, week)
    conn.execute(f"""
        INSERT OR IGNORE INTO historical_rankings (
            title_id, week, year, rank, title, author,
            author_authorized_heading, author_lccn, author_viaf, author_wikidata,
            oclc_isbn, oclc_owi, oclc_holdings, oclc_eholdings
        )
        SELECT
            title_id,
            week::DATE,
            year,
            rank,
            title,
            author,
            author_authorized_heading,
            author_lccn,
            author_viaf,
            author_wikidata,
            oclc_isbn,
            oclc_owi,
            oclc_holdings,
            oclc_eholdings
        FROM read_csv('{csv_path}', header=true, auto_detect=true)
    """)

    # Count after insert
    after_count = conn.execute("SELECT COUNT(*) FROM historical_rankings").fetchone()[0]
    new_records = after_count - before_count

    # Get date range
    date_range = conn.execute("""
        SELECT MIN(week), MAX(week) FROM historical_rankings
    """).fetchone()

    return {
        "records_before": before_count,
        "records_after": after_count,
        "new_records": new_records,
        "oldest_date": date_range[0],
        "newest_date": date_range[1],
    }
