"""
Vault Indexer — reads all .md files from the Obsidian vault,
parses frontmatter + content, and indexes them into ChromaDB.
"""

import os
import re
import frontmatter
import chromadb
from pathlib import Path
from fastembed import TextEmbedding
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


CHROMA_COLLECTION = "vault_notes"
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


class VaultIndexer:
    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)
        self.embedder = TextEmbedding(EMBED_MODEL)
        self.client = chromadb.Client()
        self.collection = self.client.get_or_create_collection(
            name=CHROMA_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def index_all(self):
        """Index every .md file in the vault."""
        md_files = list(self.vault_path.rglob("*.md"))
        print(f"[Indexer] Found {len(md_files)} notes — indexing...")
        for path in md_files:
            self._index_file(path)
        print(f"[Indexer] Done. {self.collection.count()} chunks in store.")

    def index_file(self, path: str):
        """Index or re-index a single file."""
        self._index_file(Path(path))

    def delete_file(self, path: str):
        """Remove all chunks for a deleted/renamed file."""
        doc_id_prefix = self._path_to_id(Path(path))
        existing = self.collection.get(where={"source": path})
        if existing["ids"]:
            self.collection.delete(ids=existing["ids"])

    def search(self, query: str, n_results: int = 5) -> list[dict]:
        """Semantic search — returns top-n relevant note chunks."""
        embedding = list(self.embedder.embed([query]))[0].tolist()
        results = self.collection.query(
            query_embeddings=[embedding],
            n_results=min(n_results, self.collection.count() or 1),
            include=["documents", "metadatas", "distances"],
        )
        chunks = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            chunks.append(
                {
                    "content": doc,
                    "source": meta.get("source", ""),
                    "title": meta.get("title", ""),
                    "tags": meta.get("tags", ""),
                    "score": round(1 - dist, 4),  # cosine similarity
                }
            )
        return chunks

    def list_notes(self) -> list[dict]:
        """Return metadata for all indexed notes."""
        results = self.collection.get(include=["metadatas"])
        seen_titles = {}
        for meta in results["metadatas"]:
            title = meta.get("title", "")
            if title not in seen_titles:
                seen_titles[title] = {
                    "title": title,
                    "source": meta.get("source", ""),
                    "tags": meta.get("tags", ""),
                }
        return list(seen_titles.values())

    def get_graph(self) -> dict:
        """Return nodes and edges for the knowledge graph."""
        link_re = re.compile(r'\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]')
        md_files = list(self.vault_path.rglob("*.md"))
        all_titles = {p.stem for p in md_files}

        file_links: dict[str, list[str]] = {}
        file_tags: dict[str, list[str]] = {}

        for path in md_files:
            try:
                post = frontmatter.load(str(path))
                links = [l.strip() for l in link_re.findall(post.content) if l.strip() in all_titles]
                file_links[path.stem] = links
                tags = post.get("tags", [])
                if isinstance(tags, str):
                    tags = [tags]
                file_tags[path.stem] = tags if isinstance(tags, list) else []
            except Exception:
                file_links[path.stem] = []
                file_tags[path.stem] = []

        conn_count: dict[str, int] = {t: 0 for t in all_titles}
        seen_edges: set[tuple] = set()
        edges = []

        for src, links in file_links.items():
            for tgt in links:
                key = tuple(sorted([src, tgt]))
                if key not in seen_edges:
                    seen_edges.add(key)
                    edges.append({"source": src, "target": tgt})
                    conn_count[src] = conn_count.get(src, 0) + 1
                    conn_count[tgt] = conn_count.get(tgt, 0) + 1

        nodes = [
            {
                "id": p.stem,
                "title": p.stem,
                "tags": file_tags.get(p.stem, []),
                "connections": conn_count.get(p.stem, 0),
            }
            for p in md_files
        ]

        return {"nodes": nodes, "edges": edges}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _index_file(self, path: Path):
        """Parse, chunk, embed, and upsert a note."""
        try:
            post = frontmatter.load(str(path))
        except Exception as e:
            print(f"[Indexer] Could not parse {path}: {e}")
            return

        title = path.stem
        tags = ""
        if isinstance(post.get("tags"), list):
            tags = " ".join(post["tags"])
        elif isinstance(post.get("tags"), str):
            tags = post["tags"]

        body = post.content
        chunks = self._chunk_text(body, title)

        # Remove old chunks for this file before upserting
        old = self.collection.get(where={"source": str(path)})
        if old["ids"]:
            self.collection.delete(ids=old["ids"])

        if not chunks:
            return

        embeddings = [e.tolist() for e in self.embedder.embed(chunks)]
        ids = [f"{self._path_to_id(path)}_{i}" for i in range(len(chunks))]
        metadatas = [
            {"source": str(path), "title": title, "tags": tags}
            for _ in chunks
        ]

        self.collection.upsert(
            ids=ids,
            documents=chunks,
            embeddings=embeddings,
            metadatas=metadatas,
        )

    def _chunk_text(self, text: str, title: str, max_chars: int = 800) -> list[str]:
        """Split text into overlapping chunks by heading or paragraph."""
        # Split on headings or double newlines
        sections = re.split(r"\n#{1,3} |\n\n", text)
        chunks = []
        buffer = f"Note: {title}\n"
        for section in sections:
            section = section.strip()
            if not section:
                continue
            if len(buffer) + len(section) < max_chars:
                buffer += section + "\n"
            else:
                if buffer.strip():
                    chunks.append(buffer.strip())
                buffer = f"Note: {title}\n{section}\n"
        if buffer.strip():
            chunks.append(buffer.strip())
        return chunks

    def _path_to_id(self, path: Path) -> str:
        return path.stem.replace(" ", "_").lower()


# ------------------------------------------------------------------
# File watcher — auto re-index on vault changes
# ------------------------------------------------------------------

class VaultWatcher(FileSystemEventHandler):
    def __init__(self, indexer: VaultIndexer):
        self.indexer = indexer

    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith(".md"):
            print(f"[Watcher] Modified: {event.src_path}")
            self.indexer.index_file(event.src_path)

    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith(".md"):
            print(f"[Watcher] Created: {event.src_path}")
            self.indexer.index_file(event.src_path)

    def on_deleted(self, event):
        if not event.is_directory and event.src_path.endswith(".md"):
            print(f"[Watcher] Deleted: {event.src_path}")
            self.indexer.delete_file(event.src_path)


def start_watcher(indexer: VaultIndexer) -> Observer:
    observer = Observer()
    observer.schedule(VaultWatcher(indexer), str(indexer.vault_path), recursive=True)
    observer.start()
    return observer
