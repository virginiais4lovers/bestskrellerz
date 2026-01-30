"""Fetch series information from Wikidata for books."""

import os
import time
import re
from typing import Optional
import requests
from dataclasses import dataclass

WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"

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
    # Convert to title case
    words = title.lower().split()
    # Articles/prepositions that should be lowercase (unless first word)
    small_words = {'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'of', 'in', 'with', 'from', 'into', 'as'}
    result = []
    for i, word in enumerate(words):
        if i == 0 or word not in small_words:
            result.append(word.capitalize())
        else:
            result.append(word)
    return ' '.join(result)


def query_wikidata_by_title(title: str, author: Optional[str] = None) -> Optional[SeriesInfo]:
    """
    Query Wikidata for series information using title.

    Args:
        title: Book title
        author: Optional author name for disambiguation

    Returns:
        SeriesInfo if found, None otherwise
    """
    # Convert to title case for Wikidata matching
    title_cased = to_title_case(title)
    # Escape special characters for SPARQL
    clean_title = title_cased.replace('"', '\\"').replace("'", "\\'")

    # Try exact match first - filter to books/literary works only
    query = f'''
    SELECT ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
      ?item rdfs:label "{clean_title}"@en .
      # Filter to books/literary works
      {{ ?item wdt:P31/wdt:P279* wd:Q7725634 . }}  # literary work
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q571 . }}  # book
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q47461344 . }}  # written work
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

    headers = {
        "User-Agent": "BestSkrellerz/1.0 (https://github.com/virginiais4lovers/bestskrellerz)",
        "Accept": "application/sparql-results+json"
    }

    try:
        response = requests.get(
            WIKIDATA_SPARQL_ENDPOINT,
            params={"query": query, "format": "json"},
            headers=headers,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        if bindings:
            result = bindings[0]
            book_uri = result.get("item", {}).get("value", "")
            wikidata_id = book_uri.split("/")[-1] if book_uri else None
            series_name = result.get("seriesLabel", {}).get("value")
            position_str = result.get("position", {}).get("value")
            position = int(position_str) if position_str else None

            if series_name and not series_name.startswith("Q"):  # Skip unresolved QIDs
                return SeriesInfo(
                    wikidata_id=wikidata_id,
                    series_name=series_name,
                    series_position=position
                )

        return None

    except requests.exceptions.RequestException as e:
        print(f"Request error for title '{title}': {e}")
        return None
    except (KeyError, ValueError) as e:
        print(f"Parse error for title '{title}': {e}")
        return None


def query_wikidata_batch_by_title(titles: list[str]) -> dict[str, SeriesInfo]:
    """
    Query Wikidata for multiple titles efficiently.

    Args:
        titles: List of book titles

    Returns:
        Dict mapping title to SeriesInfo
    """
    if not titles:
        return {}

    # Build VALUES clause - escape titles for SPARQL
    values_parts = []
    title_map = {}  # Map title-cased version to original
    for title in titles:
        title_cased = to_title_case(title)
        clean = title_cased.replace('"', '\\"').replace("'", "\\'")
        values_parts.append(f'"{clean}"@en')
        title_map[title_cased.lower()] = title

    values_clause = " ".join([f"({v})" for v in values_parts])

    query = f'''
    SELECT ?title ?item ?itemLabel ?series ?seriesLabel ?position WHERE {{
      VALUES (?title) {{ {values_clause} }}
      ?item rdfs:label ?title .
      # Filter to books/literary works
      {{ ?item wdt:P31/wdt:P279* wd:Q7725634 . }}  # literary work
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q571 . }}  # book
      UNION
      {{ ?item wdt:P31/wdt:P279* wd:Q47461344 . }}  # written work
      ?item wdt:P179 ?series .
      OPTIONAL {{
        ?item p:P179 ?stmt .
        ?stmt ps:P179 ?series ;
              pq:P1545 ?position .
      }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }}
    '''

    headers = {
        "User-Agent": "BestSkrellerz/1.0 (https://github.com/virginiais4lovers/bestskrellerz)",
        "Accept": "application/sparql-results+json"
    }

    try:
        response = requests.get(
            WIKIDATA_SPARQL_ENDPOINT,
            params={"query": query, "format": "json"},
            headers=headers,
            timeout=60
        )
        response.raise_for_status()

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        results = {}
        for result in bindings:
            title = result.get("title", {}).get("value", "")
            book_uri = result.get("item", {}).get("value", "")
            wikidata_id = book_uri.split("/")[-1] if book_uri else None
            series_name = result.get("seriesLabel", {}).get("value")
            position_str = result.get("position", {}).get("value")
            position = int(position_str) if position_str else None

            # Skip unresolved QIDs
            if title and series_name and not series_name.startswith("Q"):
                # Map back to original title
                original_title = title_map.get(title.lower(), title)
                results[original_title] = SeriesInfo(
                    wikidata_id=wikidata_id,
                    series_name=series_name,
                    series_position=position
                )

        return results

    except requests.exceptions.RequestException as e:
        print(f"Batch request error: {e}")
        return {}
    except (KeyError, ValueError) as e:
        print(f"Batch parse error: {e}")
        return {}


if __name__ == "__main__":
    # Test single queries
    print("Testing single query by title...")

    test_books = [
        "A Dance with Dragons",
        "Iron Flame",
        "Fourth Wing",
        "The Girl on the Train",
        "Gone Girl",
    ]

    for title in test_books:
        result = query_wikidata_by_title(title)
        if result:
            print(f"  FOUND | {title:30} | {result.series_name} #{result.series_position}")
        else:
            print(f"  NOT FOUND | {title}")
        time.sleep(0.3)

    print("\nTesting batch query...")
    results = query_wikidata_batch_by_title(test_books)
    print(f"  Found {len(results)} books with series info")
    for title, info in results.items():
        print(f"    {title}: {info.series_name} #{info.series_position}")
