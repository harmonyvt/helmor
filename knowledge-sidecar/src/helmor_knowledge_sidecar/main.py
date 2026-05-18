from __future__ import annotations

import json
import os
import pathlib
import sqlite3
import sys
import time
from dataclasses import dataclass
from typing import Any

try:
    import cocoindex as coco  # noqa: F401
    from cocoindex.ops.text import RecursiveSplitter

    COCOINDEX_AVAILABLE = True
except Exception:
    RecursiveSplitter = None  # type: ignore[assignment]
    COCOINDEX_AVAILABLE = False


SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".helmor",
    ".cocoindex_code",
    "node_modules",
    "target",
    "dist",
    "dist-web",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "__pycache__",
}

TEXT_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".css",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".java",
    ".js",
    ".jsx",
    ".json",
    ".kt",
    ".md",
    ".mdx",
    ".mjs",
    ".py",
    ".rs",
    ".sh",
    ".sql",
    ".svelte",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

MAX_FILE_BYTES = 512 * 1024
CHUNK_SIZE = 2000
CHUNK_OVERLAP = 300


@dataclass(frozen=True)
class Document:
    namespace: str
    repo_id: str | None
    goal_workspace_id: str | None
    source_type: str
    source_id: str
    title: str
    text: str
    metadata: dict[str, Any]


class KnowledgeStore:
    def __init__(self, data_dir: pathlib.Path) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "knowledge.sqlite3"
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        self.conn.executescript(
            """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL,
                repo_id TEXT,
                goal_workspace_id TEXT,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                title TEXT NOT NULL,
                text TEXT NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(namespace, repo_id, goal_workspace_id, source_type, source_id)
            );
            CREATE INDEX IF NOT EXISTS idx_documents_project
                ON documents(namespace, repo_id, source_type);
            CREATE INDEX IF NOT EXISTS idx_documents_goal
                ON documents(namespace, goal_workspace_id, source_type);
            CREATE TABLE IF NOT EXISTS index_runs (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                repo_id TEXT,
                goal_workspace_id TEXT,
                status TEXT NOT NULL,
                document_count INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT
            );
            """
        )
        self.conn.commit()

    def status(self) -> dict[str, Any]:
        document_count = self.conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        last_run = self.conn.execute(
            """
            SELECT scope, repo_id, goal_workspace_id, status, document_count, error, started_at, completed_at
            FROM index_runs
            ORDER BY started_at DESC
            LIMIT 1
            """
        ).fetchone()
        return {
            "state": "ready",
            "pid": os.getpid(),
            "dataDir": str(self.data_dir),
            "dbPath": str(self.db_path),
            "documentCount": document_count,
            "cocoIndexAvailable": COCOINDEX_AVAILABLE,
            "lastRun": dict(last_run) if last_run else None,
        }

    def replace_scope(self, docs: list[Document], *, namespace: str, repo_id: str | None, goal_workspace_id: str | None) -> int:
        with self.conn:
            self.conn.execute(
                """
                DELETE FROM documents
                WHERE namespace = ?
                  AND (? IS NULL OR repo_id = ?)
                  AND (? IS NULL OR goal_workspace_id = ?)
                """,
                (namespace, repo_id, repo_id, goal_workspace_id, goal_workspace_id),
            )
            for doc in docs:
                self.conn.execute(
                    """
                    INSERT INTO documents (
                        id, namespace, repo_id, goal_workspace_id, source_type,
                        source_id, title, text, metadata_json, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(namespace, repo_id, goal_workspace_id, source_type, source_id)
                    DO UPDATE SET
                        title = excluded.title,
                        text = excluded.text,
                        metadata_json = excluded.metadata_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        document_id(doc),
                        doc.namespace,
                        doc.repo_id,
                        doc.goal_workspace_id,
                        doc.source_type,
                        doc.source_id,
                        doc.title,
                        doc.text,
                        json.dumps(doc.metadata, sort_keys=True),
                    ),
                )
        return len(docs)

    def add_note(self, doc: Document) -> None:
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO documents (
                    id, namespace, repo_id, goal_workspace_id, source_type,
                    source_id, title, text, metadata_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(namespace, repo_id, goal_workspace_id, source_type, source_id)
                DO UPDATE SET
                    title = excluded.title,
                    text = excluded.text,
                    metadata_json = excluded.metadata_json,
                    updated_at = excluded.updated_at
                """,
                (
                    document_id(doc),
                    doc.namespace,
                    doc.repo_id,
                    doc.goal_workspace_id,
                    doc.source_type,
                    doc.source_id,
                    doc.title,
                    doc.text,
                    json.dumps(doc.metadata, sort_keys=True),
                ),
            )

    def record_run(
        self,
        *,
        run_id: str,
        scope: str,
        repo_id: str | None,
        goal_workspace_id: str | None,
        status: str,
        document_count: int,
        started_at: str,
        error: str | None = None,
    ) -> None:
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO index_runs (
                    id, scope, repo_id, goal_workspace_id, status, document_count,
                    error, started_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                """,
                (
                    run_id,
                    scope,
                    repo_id,
                    goal_workspace_id,
                    status,
                    document_count,
                    error,
                    started_at,
                ),
            )

    def query(
        self,
        *,
        query: str,
        repo_id: str | None,
        goal_workspace_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        tokens = [token.lower() for token in query.split() if len(token) > 1]
        rows = self.conn.execute(
            """
            SELECT namespace, repo_id, goal_workspace_id, source_type, source_id,
                   title, text, metadata_json, updated_at
            FROM documents
            WHERE (? IS NULL OR repo_id = ?)
              AND (? IS NULL OR goal_workspace_id = ? OR namespace = 'project')
            ORDER BY updated_at DESC
            LIMIT 2000
            """,
            (repo_id, repo_id, goal_workspace_id, goal_workspace_id),
        ).fetchall()
        scored: list[tuple[int, sqlite3.Row]] = []
        for row in rows:
            haystack = f"{row['title']}\n{row['text']}".lower()
            score = sum(haystack.count(token) for token in tokens) if tokens else 1
            if score > 0:
                scored.append((score, row))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [row_to_result(row, score) for score, row in scored[: max(1, min(limit, 20))]]


def document_id(doc: Document) -> str:
    return "|".join(
        [
            doc.namespace,
            doc.repo_id or "",
            doc.goal_workspace_id or "",
            doc.source_type,
            doc.source_id,
        ]
    )


def row_to_result(row: sqlite3.Row, score: int) -> dict[str, Any]:
    text = row["text"]
    return {
        "namespace": row["namespace"],
        "repoId": row["repo_id"],
        "goalWorkspaceId": row["goal_workspace_id"],
        "sourceType": row["source_type"],
        "sourceId": row["source_id"],
        "title": row["title"],
        "excerpt": text[:1200],
        "score": score,
        "metadata": json.loads(row["metadata_json"] or "{}"),
        "updatedAt": row["updated_at"],
    }


def project_docs(params: dict[str, Any]) -> list[Document]:
    repo_id = required_str(params, "repoId")
    root = pathlib.Path(required_str(params, "rootPath")).expanduser()
    if not root.is_dir():
        raise ValueError(f"repo root is not a directory: {root}")
    docs: list[Document] = []
    for path in root.rglob("*"):
        if should_skip(path, root):
            continue
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = path.relative_to(root).as_posix()
        if not text.strip():
            continue
        docs.extend(
            chunk_documents(
                namespace="project",
                repo_id=repo_id,
                goal_workspace_id=None,
                source_type="repo_file",
                source_id=rel,
                title=rel,
                text=text,
                metadata={
                    "repoName": params.get("repoName"),
                    "defaultBranch": params.get("defaultBranch"),
                    "path": rel,
                },
                language=language_for_path(rel),
            )
        )
    return docs


def should_skip(path: pathlib.Path, root: pathlib.Path) -> bool:
    try:
        rel_parts = path.relative_to(root).parts
    except ValueError:
        return True
    return any(part in SKIP_DIRS for part in rel_parts)


def goal_docs(params: dict[str, Any]) -> list[Document]:
    goal_workspace_id = required_str(params, "goalWorkspaceId")
    repo_id = optional_str(params.get("repoId"))
    docs: list[Document] = []
    title = optional_str(params.get("title")) or "Goal"
    description = optional_str(params.get("description")) or ""
    docs.extend(
        chunk_documents(
            namespace="goal",
            repo_id=repo_id,
            goal_workspace_id=goal_workspace_id,
            source_type="goal_brief",
            source_id=goal_workspace_id,
            title=title,
            text=f"{title}\n\n{description}".strip(),
            metadata={},
            language="markdown",
        )
    )
    for card in params.get("cards") or []:
        if not isinstance(card, dict):
            continue
        card_id = optional_str(card.get("workspaceId")) or optional_str(card.get("id"))
        if not card_id:
            continue
        card_title = optional_str(card.get("title")) or card_id
        card_description = optional_str(card.get("description")) or ""
        docs.extend(
            chunk_documents(
                namespace="goal",
                repo_id=repo_id,
                goal_workspace_id=goal_workspace_id,
                source_type="goal_card",
                source_id=card_id,
                title=card_title,
                text=f"{card_title}\n\n{card_description}".strip(),
                metadata={key: value for key, value in card.items() if key != "description"},
                language="markdown",
            )
        )
    for report in params.get("reports") or []:
        if not isinstance(report, dict):
            continue
        report_id = optional_str(report.get("id"))
        if not report_id:
            continue
        excerpt = optional_str(report.get("excerpt")) or ""
        docs.extend(
            chunk_documents(
                namespace="goal",
                repo_id=repo_id,
                goal_workspace_id=goal_workspace_id,
                source_type="assignee_report",
                source_id=report_id,
                title=optional_str(report.get("title")) or "Assignee report",
                text=excerpt,
                metadata={key: value for key, value in report.items() if key != "excerpt"},
                language="markdown",
            )
        )
    return docs


def chunk_documents(
    *,
    namespace: str,
    repo_id: str | None,
    goal_workspace_id: str | None,
    source_type: str,
    source_id: str,
    title: str,
    text: str,
    metadata: dict[str, Any],
    language: str | None,
) -> list[Document]:
    text = text.strip()
    if not text:
        return []
    if RecursiveSplitter is None:
        return [
            Document(
                namespace=namespace,
                repo_id=repo_id,
                goal_workspace_id=goal_workspace_id,
                source_type=source_type,
                source_id=source_id,
                title=title,
                text=text,
                metadata=metadata,
            )
        ]
    chunks = RecursiveSplitter().split(
        text,
        CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        language=language,
    )
    if not chunks:
        return []
    docs: list[Document] = []
    for index, chunk in enumerate(chunks):
        chunk_metadata = dict(metadata)
        chunk_metadata["chunkIndex"] = index
        chunk_metadata["startLine"] = chunk.start.line
        chunk_metadata["endLine"] = chunk.end.line
        docs.append(
            Document(
                namespace=namespace,
                repo_id=repo_id,
                goal_workspace_id=goal_workspace_id,
                source_type=source_type,
                source_id=source_id if len(chunks) == 1 else f"{source_id}#chunk-{index}",
                title=title if len(chunks) == 1 else f"{title} (chunk {index + 1})",
                text=chunk.text,
                metadata=chunk_metadata,
            )
        )
    return docs


def language_for_path(path: str) -> str | None:
    suffix = pathlib.Path(path).suffix.lower()
    return {
        ".md": "markdown",
        ".mdx": "markdown",
        ".py": "python",
        ".rs": "rust",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".go": "go",
        ".java": "java",
        ".kt": "kotlin",
        ".swift": "swift",
        ".c": "c",
        ".h": "c",
        ".cc": "cpp",
        ".cpp": "cpp",
        ".hpp": "cpp",
        ".cs": "csharp",
    }.get(suffix)


def required_str(params: dict[str, Any], key: str) -> str:
    value = optional_str(params.get(key))
    if not value:
        raise ValueError(f"{key} is required")
    return value


def optional_str(value: Any) -> str | None:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return None


def write_event(event: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def handle_request(store: KnowledgeStore, request: dict[str, Any]) -> dict[str, Any]:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") if isinstance(request.get("params"), dict) else {}
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        if method == "status":
            result = store.status()
        elif method == "indexProject":
            docs = project_docs(params)
            count = store.replace_scope(
                docs,
                namespace="project",
                repo_id=required_str(params, "repoId"),
                goal_workspace_id=None,
            )
            store.record_run(
                run_id=f"project:{params.get('repoId')}:{time.time_ns()}",
                scope="project",
                repo_id=required_str(params, "repoId"),
                goal_workspace_id=None,
                status="succeeded",
                document_count=count,
                started_at=started_at,
            )
            result = {"indexed": count}
        elif method == "indexGoal":
            docs = goal_docs(params)
            count = store.replace_scope(
                docs,
                namespace="goal",
                repo_id=optional_str(params.get("repoId")),
                goal_workspace_id=required_str(params, "goalWorkspaceId"),
            )
            store.record_run(
                run_id=f"goal:{params.get('goalWorkspaceId')}:{time.time_ns()}",
                scope="goal",
                repo_id=optional_str(params.get("repoId")),
                goal_workspace_id=required_str(params, "goalWorkspaceId"),
                status="succeeded",
                document_count=count,
                started_at=started_at,
            )
            result = {"indexed": count}
        elif method == "recordGoalKnowledgeNote":
            goal_workspace_id = required_str(params, "goalWorkspaceId")
            note_id = required_str(params, "noteId")
            doc = Document(
                namespace="goal",
                repo_id=optional_str(params.get("repoId")),
                goal_workspace_id=goal_workspace_id,
                source_type="pi_note",
                source_id=note_id,
                title=optional_str(params.get("title")) or "Pi note",
                text=required_str(params, "text"),
                metadata=params.get("metadata") if isinstance(params.get("metadata"), dict) else {},
            )
            store.add_note(doc)
            result = {"recorded": True, "noteId": note_id}
        elif method == "query":
            result = {
                "matches": store.query(
                    query=required_str(params, "query"),
                    repo_id=optional_str(params.get("repoId")),
                    goal_workspace_id=optional_str(params.get("goalWorkspaceId")),
                    limit=int(params.get("limit") or 8),
                )
            }
        elif method == "shutdown":
            result = {"ok": True}
            response = {"id": request_id, "type": "result", "result": result}
            write_event(response)
            sys.exit(0)
        else:
            raise ValueError(f"unknown method: {method}")
        return {"id": request_id, "type": "result", "result": result}
    except Exception as exc:
        return {"id": request_id, "type": "error", "message": str(exc)}


def main() -> None:
    data_dir = pathlib.Path(
        os.environ.get("HELMOR_KNOWLEDGE_DATA_DIR", ".helmor-knowledge")
    ).expanduser()
    store = KnowledgeStore(data_dir)
    write_event({"type": "ready", "cocoIndexAvailable": COCOINDEX_AVAILABLE})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = handle_request(store, request)
        except Exception as exc:
            response = {"type": "error", "message": str(exc)}
        write_event(response)


if __name__ == "__main__":
    main()
