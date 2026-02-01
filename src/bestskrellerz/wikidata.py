"""Fetch series information from Wikidata for books."""

import re
import time
from typing import Optional
import requests
from dataclasses import dataclass

WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
WIKIDATA_SEARCH_API = "https://www.wikidata.org/w/api.php"

# Common US/UK title substitutions
TITLE_VARIATIONS = [
    ("Sorcerer's Stone", "Philosopher's Stone"),
    ("Sorcerers Stone", "Philosopher's Stone"),
    ("Color", "Colour"),
    ("Favorite", "Favourite"),
    ("Honor", "Honour"),
    ("Traveling", "Travelling"),
    ("Canceled", "Cancelled"),
]

HEADERS = {
    "User-Agent": "BestSkrellerz/1.0 (https://github.com/virginiais4lovers/bestskrellerz)",
    "Accept": "application/sparql-results+json"
}


@dataclass
class SeriesInfo:
    """Series information for a book."""
    wikidata_id: str
    series_name: str
    series_position: Optional[int]


def normalize_title(title: str) -> str:
    """Normalize a book title for matching."""
    # Remove subtitle after colon
    title = title.split(":")[0].strip()
    # Remove common prefixes/suffixes
    title = re.sub(r'\s*\(.*?\)\s*$', '', title)  # Remove parentheticals at end
    title = re.sub(r'^(The|A|An)\s+', '', title, flags=re.IGNORECASE)  # Remove articles
    return title.strip()


def to_title_case(title: str) -> str:
    """Convert a title to proper title case for Wikidata matching."""
    words = title.lower().split()
    small_words = {'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'of', 'in', 'with', 'from', 'into', 'as'}
    result = []
    for i, word in enumerate(words):
        if i == 0 or word not in small_words:
            result.append(word.capitalize())
        else:
            result.append(word)
    return ' '.join(result)


def get_title_variations(title: str) -> list[str]:
    """Generate US/UK title variations."""
    variations = [title]
    title_lower = title.lower()

    for us_term, uk_term in TITLE_VARIATIONS:
        if us_term.lower() in title_lower:
            # Add UK variation
            variation = re.sub(re.escape(us_term), uk_term, title, flags=re.IGNORECASE)
            variations.append(variation)
        if uk_term.lower() in title_lower:
            # Add US variation
            variation = re.sub(re.escape(uk_term), us_term, title, flags=re.IGNORECASE)
            variations.append(variation)

    return variations


def query_wikidata_by_isbn(isbn: str) -> Optional[SeriesInfo]:
    """
    Query Wikidata for series information using ISBN.

    Args:
        isbn: ISBN-13 or ISBN-10

    Returns:
        SeriesInfo if found, None otherwise
    """
    if not isbn:
        return None

    # Clean ISBN (remove hyphens)
    clean_isbn = isbn.replace("-", "").strip()

    # Determine property based on ISBN length
    if len(clean_isbn) == 13:
        isbn_prop = "wdt:P212"  # ISBN-13
    elif len(clean_isbn) == 10:
        isbn_prop = "wdt:P957"  # ISBN-10
    else:
        return None

    query = f'''
    SELECT ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
      # Find book by ISBN
      ?item {isbn_prop} "{clean_isbn}" .

      # Get series info - try direct series link first
      OPTIONAL {{
        ?item wdt:P179 ?series .
        OPTIONAL {{
          ?item p:P179 ?stmt .
          ?stmt ps:P179 ?series ;
                pq:P1545 ?position .
        }}
      }}

      # Also try edition -> work -> series path
      OPTIONAL {{
        ?item wdt:P629 ?work .  # edition of work
        ?work wdt:P179 ?series .
        OPTIONAL {{
          ?work p:P179 ?stmt .
          ?stmt ps:P179 ?series ;
                pq:P1545 ?position .
        }}
      }}

      FILTER(BOUND(?series))
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    LIMIT 1
    '''

    try:
        response = requests.get(
            WIKIDATA_SPARQL_ENDPOINT,
            params={"query": query, "format": "json"},
            headers=HEADERS,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        if bindings:
            result = bindings[0]
            return _parse_series_result(result)

        return None

    except requests.exceptions.RequestException as e:
        print(f"ISBN lookup error for '{isbn}': {e}")
        return None
    except (KeyError, ValueError) as e:
        print(f"Parse error for ISBN '{isbn}': {e}")
        return None


def query_wikidata_by_title(title: str, author: Optional[str] = None) -> Optional[SeriesInfo]:
    """
    Query Wikidata for series information using title.
    Tries multiple matching strategies including title variations.

    Args:
        title: Book title
        author: Optional author name for disambiguation

    Returns:
        SeriesInfo if found, None otherwise
    """
    # Try all title variations (US/UK spellings)
    title_cased = to_title_case(title)
    variations = get_title_variations(title_cased)

    for variant in variations:
        result = _query_by_exact_title(variant)
        if result:
            return result

        # Also try with alternate labels
        result = _query_by_alt_label(variant)
        if result:
            return result

    # Fallback: try Wikidata search API
    result = _search_wikidata(title_cased, author)
    if result:
        return result

    return None


def _query_by_exact_title(title: str) -> Optional[SeriesInfo]:
    """Query using exact rdfs:label match."""
    clean_title = title.replace('"', '\\"').replace("'", "\\'")

    query = f'''
    SELECT ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
      ?item rdfs:label "{clean_title}"@en .
      {{ ?item wdt:P31/wdt:P279* wd:Q7725634 . }}
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q571 . }}
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q47461344 . }}
      ?item wdt:P179 ?series .
      OPTIONAL {{
        ?item p:P179 ?stmt .
        ?stmt ps:P179 ?series ;
              pq:P1545 ?position .
      }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    LIMIT 1
    '''

    try:
        response = requests.get(
            WIKIDATA_SPARQL_ENDPOINT,
            params={"query": query, "format": "json"},
            headers=HEADERS,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        if bindings:
            return _parse_series_result(bindings[0])
        return None

    except Exception:
        return None


def _query_by_alt_label(title: str) -> Optional[SeriesInfo]:
    """Query using skos:altLabel (alternate names)."""
    clean_title = title.replace('"', '\\"').replace("'", "\\'")

    query = f'''
    SELECT ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
      ?item skos:altLabel "{clean_title}"@en .
      {{ ?item wdt:P31/wdt:P279* wd:Q7725634 . }}
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q571 . }}
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q47461344 . }}
      ?item wdt:P179 ?series .
      OPTIONAL {{
        ?item p:P179 ?stmt .
        ?stmt ps:P179 ?series ;
              pq:P1545 ?position .
      }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    LIMIT 1
    '''

    try:
        response = requests.get(
            WIKIDATA_SPARQL_ENDPOINT,
            params={"query": query, "format": "json"},
            headers=HEADERS,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        if bindings:
            return _parse_series_result(bindings[0])
        return None

    except Exception:
        return None


def _search_wikidata(title: str, author: Optional[str] = None) -> Optional[SeriesInfo]:
    """Use Wikidata search API for fuzzy matching, then check for series."""
    search_query = title
    if author:
        # Add author to improve search accuracy
        search_query = f"{title} {author}"

    try:
        # Search for entities
        response = requests.get(
            WIKIDATA_SEARCH_API,
            params={
                "action": "wbsearchentities",
                "search": search_query,
                "language": "en",
                "type": "item",
                "limit": 5,
                "format": "json"
            },
            headers=HEADERS,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()
        results = data.get("search", [])

        # Check each result for series info
        for item in results:
            qid = item.get("id")
            if qid:
                series_info = _get_series_for_entity(qid)
                if series_info:
                    return series_info

        return None

    except Exception:
        return None


def _get_series_for_entity(qid: str) -> Optional[SeriesInfo]:
    """Get series information for a specific Wikidata entity."""
    query = f'''
    SELECT ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
      BIND(wd:{qid} AS ?item)

      # Check if it's a book/literary work
      {{ ?item wdt:P31/wdt:P279* wd:Q7725634 . }}
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q571 . }}
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q47461344 . }}

      # Get series info - direct or via work
      {{
        ?item wdt:P179 ?series .
        OPTIONAL {{
          ?item p:P179 ?stmt .
          ?stmt ps:P179 ?series ;
                pq:P1545 ?position .
        }}
      }}
      UNION
      {{
        ?item wdt:P629 ?work .
        ?work wdt:P179 ?series .
        OPTIONAL {{
          ?work p:P179 ?stmt .
          ?stmt ps:P179 ?series ;
                pq:P1545 ?position .
        }}
      }}

      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    LIMIT 1
    '''

    try:
        response = requests.get(
            WIKIDATA_SPARQL_ENDPOINT,
            params={"query": query, "format": "json"},
            headers=HEADERS,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        if bindings:
            return _parse_series_result(bindings[0])
        return None

    except Exception:
        return None


def _parse_series_result(result: dict) -> Optional[SeriesInfo]:
    """Parse a SPARQL result into SeriesInfo."""
    book_uri = result.get("item", {}).get("value", "")
    wikidata_id = book_uri.split("/")[-1] if book_uri else None
    series_name = result.get("seriesLabel", {}).get("value")
    position_str = result.get("position", {}).get("value")
    position = int(position_str) if position_str else None

    if series_name and not series_name.startswith("Q"):
        return SeriesInfo(
            wikidata_id=wikidata_id,
            series_name=series_name,
            series_position=position
        )
    return None


def query_wikidata_batch_by_isbn(isbn_list: list[tuple[str, str]]) -> dict[str, SeriesInfo]:
    """
    Query Wikidata for multiple books by ISBN efficiently.

    Args:
        isbn_list: List of (isbn, original_key) tuples

    Returns:
        Dict mapping original_key to SeriesInfo
    """
    if not isbn_list:
        return {}

    # Build VALUES clause for ISBNs
    isbn13_values = []
    isbn10_values = []
    isbn_to_key = {}

    for isbn, key in isbn_list:
        clean_isbn = isbn.replace("-", "").strip()
        isbn_to_key[clean_isbn] = key
        if len(clean_isbn) == 13:
            isbn13_values.append(f'"{clean_isbn}"')
        elif len(clean_isbn) == 10:
            isbn10_values.append(f'"{clean_isbn}"')

    results = {}

    # Query ISBN-13s
    if isbn13_values:
        values_clause = " ".join(isbn13_values)
        query = f'''
        SELECT ?isbn ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
          VALUES ?isbn {{ {values_clause} }}
          ?item wdt:P212 ?isbn .

          {{
            ?item wdt:P179 ?series .
            OPTIONAL {{
              ?item p:P179 ?stmt .
              ?stmt ps:P179 ?series ;
                    pq:P1545 ?position .
            }}
          }}
          UNION
          {{
            ?item wdt:P629 ?work .
            ?work wdt:P179 ?series .
            OPTIONAL {{
              ?work p:P179 ?stmt .
              ?stmt ps:P179 ?series ;
                    pq:P1545 ?position .
            }}
          }}

          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
        }}
        '''

        try:
            response = requests.get(
                WIKIDATA_SPARQL_ENDPOINT,
                params={"query": query, "format": "json"},
                headers=HEADERS,
                timeout=60
            )
            response.raise_for_status()

            data = response.json()
            for binding in data.get("results", {}).get("bindings", []):
                isbn = binding.get("isbn", {}).get("value", "")
                key = isbn_to_key.get(isbn)
                if key:
                    info = _parse_series_result(binding)
                    if info:
                        results[key] = info
        except Exception as e:
            print(f"Batch ISBN-13 query error: {e}")

    # Query ISBN-10s
    if isbn10_values:
        values_clause = " ".join(isbn10_values)
        query = f'''
        SELECT ?isbn ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
          VALUES ?isbn {{ {values_clause} }}
          ?item wdt:P957 ?isbn .

          {{
            ?item wdt:P179 ?series .
            OPTIONAL {{
              ?item p:P179 ?stmt .
              ?stmt ps:P179 ?series ;
                    pq:P1545 ?position .
            }}
          }}
          UNION
          {{
            ?item wdt:P629 ?work .
            ?work wdt:P179 ?series .
            OPTIONAL {{
              ?work p:P179 ?stmt .
              ?stmt ps:P179 ?series ;
                    pq:P1545 ?position .
            }}
          }}

          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
        }}
        '''

        try:
            response = requests.get(
                WIKIDATA_SPARQL_ENDPOINT,
                params={"query": query, "format": "json"},
                headers=HEADERS,
                timeout=60
            )
            response.raise_for_status()

            data = response.json()
            for binding in data.get("results", {}).get("bindings", []):
                isbn = binding.get("isbn", {}).get("value", "")
                key = isbn_to_key.get(isbn)
                if key:
                    info = _parse_series_result(binding)
                    if info:
                        results[key] = info
        except Exception as e:
            print(f"Batch ISBN-10 query error: {e}")

    return results


def query_wikidata_batch_by_title(titles: list[str]) -> dict[str, SeriesInfo]:
    """
    Query Wikidata for multiple titles efficiently.
    Now includes title variations for better matching.

    Args:
        titles: List of book titles

    Returns:
        Dict mapping title to SeriesInfo
    """
    if not titles:
        return {}

    # Build VALUES clause with title variations
    values_parts = []
    title_map = {}

    for title in titles:
        title_cased = to_title_case(title)
        variations = get_title_variations(title_cased)

        for variant in variations:
            clean = variant.replace('"', '\\"').replace("'", "\\'")
            values_parts.append(f'"{clean}"@en')
            title_map[variant.lower()] = title

    values_clause = " ".join([f"({v})" for v in values_parts])

    query = f'''
    SELECT ?title ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
      VALUES (?title) {{ {values_clause} }}

      # Match by label or alternate label
      {{ ?item rdfs:label ?title . }}
      UNION
      {{ ?item skos:altLabel ?title . }}

      # Filter to books/literary works
      {{ ?item wdt:P31/wdt:P279* wd:Q7725634 . }}
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q571 . }}
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q47461344 . }}

      ?item wdt:P179 ?series .
      OPTIONAL {{
        ?item p:P179 ?stmt .
        ?stmt ps:P179 ?series ;
              pq:P1545 ?position .
      }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    '''

    try:
        response = requests.get(
            WIKIDATA_SPARQL_ENDPOINT,
            params={"query": query, "format": "json"},
            headers=HEADERS,
            timeout=60
        )
        response.raise_for_status()

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        results = {}
        for result in bindings:
            title = result.get("title", {}).get("value", "")
            series_name = result.get("seriesLabel", {}).get("value")

            if title and series_name and not series_name.startswith("Q"):
                original_title = title_map.get(title.lower(), title)
                if original_title not in results:
                    info = _parse_series_result(result)
                    if info:
                        results[original_title] = info

        return results

    except requests.exceptions.RequestException as e:
        print(f"Batch request error: {e}")
        return {}
    except (KeyError, ValueError) as e:
        print(f"Batch parse error: {e}")
        return {}


if __name__ == "__main__":
    print("Testing ISBN lookup...")

    # Test Harry Potter ISBN
    test_isbns = [
        ("9780590353427", "Harry Potter and the Sorcerer's Stone"),
        ("9781335534637", "Heated Rivalry"),
    ]

    for isbn, title in test_isbns:
        result = query_wikidata_by_isbn(isbn)
        if result:
            print(f"  ISBN {isbn} ({title}): {result.series_name} #{result.series_position}")
        else:
            print(f"  ISBN {isbn} ({title}): NOT FOUND")
        time.sleep(0.5)

    print("\nTesting title lookup with variations...")

    test_books = [
        "Harry Potter and the Sorcerer's Stone",
        "A Dance with Dragons",
        "Fourth Wing",
        "Heated Rivalry",
    ]

    for title in test_books:
        result = query_wikidata_by_title(title)
        if result:
            print(f"  FOUND | {title:40} | {result.series_name} #{result.series_position}")
        else:
            print(f"  NOT FOUND | {title}")
        time.sleep(0.5)

    print("\nTesting batch query with variations...")
    results = query_wikidata_batch_by_title(test_books)
    print(f"  Found {len(results)} books with series info")
    for title, info in results.items():
        print(f"    {title}: {info.series_name} #{info.series_position}")
