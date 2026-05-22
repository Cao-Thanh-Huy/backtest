"""WebSocket endpoint for real-time Celery task progress streaming."""
import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from celery.result import AsyncResult

from workers.celery_app import celery_app

router = APIRouter()

# Polling interval in seconds
_POLL_INTERVAL = 0.8


@router.get("/task/{task_id}")
async def get_task_status(task_id: str):
    """Query the current progress of a Celery task via HTTP."""
    result = celery_app.AsyncResult(task_id)
    state = result.state

    payload = {
        "task_id": task_id,
        "status": state,
        "progress": 0,
        "message": ""
    }

    if state == "PENDING":
        payload["message"] = "Task queued, waiting for worker..."
    elif state == "PROGRESS":
        meta = result.info or {}
        payload["progress"] = meta.get("progress", 0)
        payload["message"] = meta.get("message", "")
    elif state == "SUCCESS":
        payload["progress"] = 100
        payload["message"] = "Completed"
        payload["result"] = result.result
    elif state == "FAILURE":
        payload["progress"] = 0
        payload["error"] = str(result.result)
    else:
        payload["message"] = state

    return payload


@router.websocket("/task/{task_id}")
async def task_progress(websocket: WebSocket, task_id: str):
    """
    Connect to receive live progress for a Celery task.
    Sends JSON messages: { task_id, status, progress, message, result, error }
    """
    await websocket.accept()
    sent_progress = False

    await websocket.send_text(
        json.dumps(
            {
                "task_id": task_id,
                "status": "PENDING",
                "progress": 0,
                "message": "Task queued, waiting for worker...",
            }
        )
    )

    try:
        while True:
            result: AsyncResult = celery_app.AsyncResult(task_id)
            state = result.state

            payload: dict = {"task_id": task_id, "status": state, "progress": 0}

            if state == "PENDING":
                payload["message"] = "Task queued, waiting for worker..."
                payload["progress"] = 0

            elif state == "PROGRESS":
                meta = result.info or {}
                payload["progress"] = meta.get("progress", 0)
                payload["message"] = meta.get("message", "")
                sent_progress = True

            elif state == "SUCCESS":
                if not sent_progress:
                    await websocket.send_text(
                        json.dumps(
                            {
                                "task_id": task_id,
                                "status": "PROGRESS",
                                "progress": 99,
                                "message": "Finalizing...",
                            }
                        )
                    )
                payload["progress"] = 100
                payload["message"] = "Completed"
                payload["result"] = result.result
                await websocket.send_text(json.dumps(payload))
                break

            elif state == "FAILURE":
                payload["progress"] = 0
                payload["error"] = str(result.result)
                await websocket.send_text(json.dumps(payload))
                break

            else:
                payload["message"] = state

            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(_POLL_INTERVAL)

    except WebSocketDisconnect:
        pass
