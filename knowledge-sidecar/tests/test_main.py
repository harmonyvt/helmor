from __future__ import annotations

from helmor_knowledge_sidecar.main import KnowledgeStore, handle_request


def test_goal_index_and_query(tmp_path):
    store = KnowledgeStore(tmp_path)
    response = handle_request(
        store,
        {
            "id": "1",
            "method": "indexGoal",
            "params": {
                "goalWorkspaceId": "goal-1",
                "repoId": "repo-1",
                "title": "Ship knowledge base",
                "description": "Make goal knowledge available to child workspaces.",
                "cards": [
                    {
                        "workspaceId": "child-1",
                        "title": "No-code research",
                        "description": "Compare options and report findings.",
                    }
                ],
                "reports": [
                    {
                        "id": "report-1",
                        "title": "Research report",
                        "excerpt": "CocoIndex should run in a separate sidecar.",
                    }
                ],
            },
        },
    )
    assert response["type"] == "result"
    assert response["result"]["indexed"] == 3

    query = handle_request(
        store,
        {
            "id": "2",
            "method": "query",
            "params": {
                "goalWorkspaceId": "goal-1",
                "repoId": "repo-1",
                "query": "separate sidecar",
            },
        },
    )
    assert query["type"] == "result"
    assert query["result"]["matches"][0]["sourceType"] == "assignee_report"
