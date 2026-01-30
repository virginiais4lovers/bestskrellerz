"""CLI entry point for the NYTimes Best Seller Tracker."""

import sys
from datetime import date, datetime, timedelta
from typing import Optional

import click
from dotenv import load_dotenv

from . import db
from .api import NYTimesClient, NYTimesAPIError, RateLimitError


@click.group()
@click.version_option()
def cli():
    """NYTimes Best Seller Tracker - Fetch and store Best Seller data in MotherDuck."""
    load_dotenv()


@cli.command()
def init():
    """Initialize the database schema in MotherDuck."""
    click.echo("Connecting to MotherDuck...")
    try:
        conn = db.get_connection()
        click.echo("Creating tables...")
        db.init_schema(conn)
        click.echo("Database schema initialized successfully.")
        conn.close()
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("sync-lists")
def sync_lists():
    """Fetch and store all Best Seller list metadata."""
    click.echo("Fetching list metadata from NYTimes API...")
    try:
        client = NYTimesClient()
        lists = client.get_list_names()
        click.echo(f"Found {len(lists)} lists.")

        click.echo("Saving to MotherDuck...")
        conn = db.get_connection()
        for lst in lists:
            db.upsert_list(conn, lst)
        conn.close()

        click.echo(f"Successfully synced {len(lists)} lists.")
    except NYTimesAPIError as e:
        click.echo(f"API Error: {e}", err=True)
        sys.exit(1)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("sync-current")
def sync_current():
    """Fetch current week's Best Seller data for all lists."""
    click.echo("Fetching current Best Seller data...")
    try:
        client = NYTimesClient()
        books, rankings = client.get_overview()

        click.echo(f"Found {len(books)} books and {len(rankings)} rankings.")

        click.echo("Saving to MotherDuck...")
        conn = db.get_connection()
        db.upsert_books_batch(conn, books)
        db.upsert_rankings_batch(conn, rankings)
        conn.close()

        click.echo(f"Successfully synced {len(rankings)} rankings for {len(books)} books.")
    except RateLimitError:
        click.echo("Rate limit exceeded. Please wait before making more requests.", err=True)
        sys.exit(1)
    except NYTimesAPIError as e:
        click.echo(f"API Error: {e}", err=True)
        sys.exit(1)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.option(
    "--list",
    "list_name",
    help="Specific list to backfill (encoded name). If not specified, backfills all lists.",
)
@click.option(
    "--start-date",
    type=click.DateTime(formats=["%Y-%m-%d"]),
    help="Start date for backfill (YYYY-MM-DD). Defaults to 4 weeks ago.",
)
@click.option(
    "--end-date",
    type=click.DateTime(formats=["%Y-%m-%d"]),
    help="End date for backfill (YYYY-MM-DD). Defaults to today.",
)
@click.option(
    "--max-requests",
    default=50,
    help="Maximum API requests to make (to stay within rate limits). Default: 50",
)
def backfill(
    list_name: Optional[str],
    start_date: Optional[datetime],
    end_date: Optional[datetime],
    max_requests: int,
):
    """Backfill historical Best Seller data."""
    # Set defaults
    end = end_date.date() if end_date else date.today()
    start = start_date.date() if start_date else end - timedelta(weeks=4)

    click.echo(f"Backfilling data from {start} to {end}")
    if list_name:
        click.echo(f"List: {list_name}")
    else:
        click.echo("Lists: all")
    click.echo(f"Max requests: {max_requests}")

    try:
        client = NYTimesClient()
        conn = db.get_connection()

        # Get lists to process
        if list_name:
            list_names = [list_name]
        else:
            list_names = db.get_all_list_names(conn)
            if not list_names:
                click.echo("No lists found. Run 'sync-lists' first.", err=True)
                conn.close()
                sys.exit(1)

        request_count = 0
        total_books = 0
        total_rankings = 0

        # Generate weekly dates (NYTimes publishes weekly)
        current_date = start
        dates_to_fetch = []
        while current_date <= end:
            dates_to_fetch.append(current_date)
            current_date += timedelta(weeks=1)

        click.echo(f"Processing {len(dates_to_fetch)} weeks for {len(list_names)} lists...")

        for fetch_date in dates_to_fetch:
            if request_count >= max_requests:
                click.echo(f"Reached max requests limit ({max_requests}). Stopping.")
                break

            for ln in list_names:
                if request_count >= max_requests:
                    break

                try:
                    click.echo(f"Fetching {ln} for {fetch_date}...")
                    books, rankings = client.get_list(ln, fetch_date)
                    request_count += 1

                    db.upsert_books_batch(conn, books)
                    db.upsert_rankings_batch(conn, rankings)

                    total_books += len(books)
                    total_rankings += len(rankings)

                except RateLimitError:
                    click.echo("Rate limit hit. Stopping backfill.", err=True)
                    break
                except NYTimesAPIError as e:
                    click.echo(f"API error for {ln} on {fetch_date}: {e}", err=True)
                    continue

        conn.close()
        click.echo(f"Backfill complete. Made {request_count} requests.")
        click.echo(f"Added/updated {total_books} books and {total_rankings} rankings.")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("fetch-history")
@click.option(
    "--start-date",
    type=click.DateTime(formats=["%Y-%m-%d"]),
    help="Start date to fetch from (YYYY-MM-DD). Defaults to today. Fetches backwards from this date.",
)
@click.option(
    "--weeks",
    default=52,
    help="Number of weeks of history to fetch. Default: 52 (1 year)",
)
@click.option(
    "--max-requests",
    default=100,
    help="Maximum API requests to make. Default: 100",
)
def fetch_history(start_date: Optional[datetime], weeks: int, max_requests: int):
    """Fetch as much historical data as possible using the overview endpoint.

    This is the most efficient way to get historical data because each request
    returns ALL lists for a given week. With 100 requests, you can fetch ~2 years
    of complete data.

    Examples:

        # Fetch 1 year back from today
        bestskrellerz fetch-history

        # Fetch 52 weeks starting from 1983
        bestskrellerz fetch-history --start-date 1983-12-31 --weeks 52
    """
    start = start_date.date() if start_date else date.today()

    click.echo(f"Fetching up to {weeks} weeks of historical data...")
    click.echo(f"Starting from: {start}")
    click.echo(f"Max requests: {max_requests}")
    click.echo("(Each request fetches ALL lists for one week)")
    click.echo()

    try:
        client = NYTimesClient()
        conn = db.get_connection()

        request_count = 0
        total_books = 0
        total_rankings = 0
        weeks_fetched = 0

        for week_num in range(weeks):
            if request_count >= max_requests:
                click.echo(f"\nReached max requests limit ({max_requests}).")
                break

            fetch_date = start - timedelta(weeks=week_num)

            try:
                click.echo(f"[{request_count + 1}/{max_requests}] Fetching week of {fetch_date}...", nl=False)
                books, rankings, lists = client.get_overview_full(fetch_date)
                request_count += 1
                weeks_fetched += 1

                # Save list metadata
                for lst in lists:
                    db.upsert_list(conn, lst)

                db.upsert_books_batch(conn, books)
                db.upsert_rankings_batch(conn, rankings)

                total_books += len(books)
                total_rankings += len(rankings)

                click.echo(f" {len(books)} books, {len(rankings)} rankings")

            except RateLimitError:
                click.echo("\nRate limit hit. Waiting 60 seconds...")
                import time
                time.sleep(60)
                # Retry this week
                week_num -= 1
                continue
            except NYTimesAPIError as e:
                click.echo(f"\nAPI error for {fetch_date}: {e}")
                continue

        conn.close()

        click.echo()
        click.echo("=== Fetch Complete ===")
        click.echo(f"Requests made: {request_count}")
        click.echo(f"Weeks fetched: {weeks_fetched}")
        click.echo(f"Books added/updated: {total_books}")
        click.echo(f"Rankings added/updated: {total_rankings}")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("create-unified-view")
def create_unified_view():
    """Create a unified view combining rankings and historical data.

    Creates the 'all_rankings' view which unions the rankings table (from API)
    with historical_rankings (from CSV), avoiding duplicates by excluding
    historical data that overlaps with API data.
    """
    click.echo("Creating unified view...")
    try:
        conn = db.get_connection()
        db.init_unified_view(conn)
        conn.close()
        click.echo("Created 'all_rankings' view successfully.")
        click.echo("Query it with: SELECT * FROM all_rankings WHERE list_name = 'hardcover-fiction' LIMIT 10")
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("import-csv")
@click.argument("csv_path", type=click.Path(exists=True))
def import_csv(csv_path: str):
    """Import historical bestseller data from a CSV file.

    This imports data into the historical_rankings table, skipping any
    duplicate entries (based on title_id + week).

    Example:

        bestskrellerz import-csv nyt_hardcover_fiction_bestsellers-lists.csv
    """
    import os

    # Convert to absolute path for DuckDB
    abs_path = os.path.abspath(csv_path)

    click.echo(f"Importing data from: {abs_path}")

    try:
        conn = db.get_connection()
        click.echo("Connected to MotherDuck...")

        result = db.import_historical_csv(conn, abs_path)
        conn.close()

        click.echo()
        click.echo("=== Import Complete ===")
        click.echo(f"Records before: {result['records_before']}")
        click.echo(f"Records after: {result['records_after']}")
        click.echo(f"New records added: {result['new_records']}")
        click.echo(f"Date range: {result['oldest_date']} to {result['newest_date']}")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("fetch-series")
@click.option(
    "--batch-size",
    default=50,
    help="Number of titles to query per Wikidata request. Default: 50",
)
@click.option(
    "--max-books",
    default=0,
    help="Maximum books to process (0 for all). Default: 0",
)
@click.option(
    "--delay",
    default=1.0,
    help="Delay between Wikidata requests in seconds. Default: 1.0",
)
def fetch_series(batch_size: int, max_books: int, delay: float):
    """Fetch series information from Wikidata for fiction books.

    Queries Wikidata by book title to find series membership and position.
    Only processes books from fiction bestseller lists.

    Examples:

        # Fetch series for all fiction books
        bestskrellerz fetch-series

        # Test with first 100 books
        bestskrellerz fetch-series --max-books 100
    """
    import time
    from .wikidata import query_wikidata_batch_by_title

    click.echo("Fetching series information from Wikidata...")
    click.echo(f"Batch size: {batch_size}")
    click.echo(f"Delay between requests: {delay}s")
    click.echo()

    try:
        conn = db.get_connection()

        # Get fiction books that don't have series info yet
        fiction_lists = [
            'hardcover-fiction', 'trade-fiction-paperback', 'e-book-fiction',
            'combined-print-and-e-book-fiction', 'combined-print-fiction',
            'mass-market-paperback', 'audio-fiction'
        ]
        lists_clause = ", ".join([f"'{l}'" for l in fiction_lists])

        # Get unique titles from fiction lists without series info
        query = f"""
            SELECT DISTINCT b.primary_isbn13, b.title
            FROM books b
            JOIN rankings r ON b.primary_isbn13 = r.primary_isbn13
            WHERE r.list_name_encoded IN ({lists_clause})
            AND b.series_name IS NULL
            ORDER BY b.title
        """
        if max_books > 0:
            query += f" LIMIT {max_books}"

        result = conn.execute(query).fetchall()
        books_to_process = [(row[0], row[1]) for row in result]

        click.echo(f"Found {len(books_to_process)} fiction books without series info")
        click.echo()

        if not books_to_process:
            click.echo("No books to process.")
            conn.close()
            return

        # Process in batches
        total_found = 0
        total_processed = 0

        for i in range(0, len(books_to_process), batch_size):
            batch = books_to_process[i:i + batch_size]
            titles = [title for _, title in batch]
            isbn_map = {title: isbn for isbn, title in batch}

            click.echo(f"[{i + 1}-{min(i + batch_size, len(books_to_process))}/{len(books_to_process)}] Querying Wikidata...", nl=False)

            try:
                results = query_wikidata_batch_by_title(titles)
                total_processed += len(batch)

                if results:
                    total_found += len(results)
                    click.echo(f" found {len(results)} series")

                    # Update database
                    for title, info in results.items():
                        isbn = isbn_map.get(title)
                        if isbn:
                            conn.execute("""
                                UPDATE books
                                SET series_name = ?,
                                    series_position = ?,
                                    wikidata_id = ?
                                WHERE primary_isbn13 = ?
                            """, [info.series_name, info.series_position, info.wikidata_id, isbn])
                else:
                    click.echo(" no series found")

            except Exception as e:
                click.echo(f" error: {e}")

            # Rate limiting
            if i + batch_size < len(books_to_process):
                time.sleep(delay)

        conn.close()

        click.echo()
        click.echo("=== Fetch Complete ===")
        click.echo(f"Books processed: {total_processed}")
        click.echo(f"Series found: {total_found}")
        click.echo(f"Hit rate: {total_found / total_processed * 100:.1f}%" if total_processed > 0 else "N/A")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
def status():
    """Show sync status and statistics."""
    try:
        conn = db.get_connection()
        stats = db.get_stats(conn)
        conn.close()

        click.echo("=== NYTimes Best Seller Tracker Status ===")
        click.echo(f"Lists tracked: {stats['lists_count']}")
        click.echo(f"Unique books: {stats['books_count']}")
        click.echo(f"Total rankings: {stats['rankings_count']}")

        if stats["oldest_ranking_date"] and stats["newest_ranking_date"]:
            click.echo(f"Date range: {stats['oldest_ranking_date']} to {stats['newest_ranking_date']}")
        else:
            click.echo("Date range: No data yet")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    cli()
