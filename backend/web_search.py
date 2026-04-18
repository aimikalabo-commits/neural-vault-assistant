"""
Web Search — Bing Search API integration.
Called when the user's query needs fresh web information.
"""

import os
import requests
from typing import Optional, List, Dict

BING_ENDPOINT = "https://api.bing.microsoft.com/v7.0/search"


class WebSearch:
    def __init__(self):
        self.api_key = os.environ.get("BING_API_KEY")
        self.enabled = bool(self.api_key)

    def search(self, query: str, n_results: int = 5) -> List[Dict]:
        """Search the web and return top results."""
        if not self.enabled:
            return []
        try:
            headers = {"Ocp-Apim-Subscription-Key": self.api_key}
            params = {"q": query, "count": n_results, "textDecorations": False, "textFormat": "Raw"}
            response = requests.get(BING_ENDPOINT, headers=headers, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            results = []
            for item in data.get("webPages", {}).get("value", []):
                results.append({
                    "title": item.get("name", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("snippet", ""),
                })
            return results
        except Exception as e:
            print(f"[WebSearch] Error: {e}")
            return []

    def format_for_context(self, results: List[Dict]) -> str:
        if not results:
            return ""
        lines = ["## Web Search Results\n"]
        for r in results:
            lines.append(f"### {r['title']}\n{r['snippet']}\nSource: {r['url']}\n")
        return "\n".join(lines)
