#!/usr/bin/env python3
"""Read-only native ID → admission → pi input → terminal → delivery audit.

Usage: python3 audit-native.py HOME NATIVE_MESSAGE_ID
Prints identifiers and states only; never message text or credentials.
"""
import json
import sqlite3
import sys
from pathlib import Path


def audit(home, native_id):
    database = Path(home).resolve() / ".yonder/state.db"
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
        events = []
        for row in db.execute("SELECT id, ts, type, parent, conv, data, routes FROM y_events ORDER BY ts, id"):
            event_id, timestamp, kind, parent, conv, raw, routes = row
            events.append(dict(id=event_id, ts=timestamp, type=kind, parent=parent, conv=conv,
                               data=json.loads(raw), routes=json.loads(routes) if routes else []))
        admissions = [e for e in events if e["type"] == "message.in" and
                      (e["data"].get("msgId") == native_id or any(
                          o.get("messageId", o.get("msgId")) == native_id
                          for o in e["data"].get("originals", [])))]
        result = []
        for event in admissions:
            event_id = event["id"]
            entries = []
            for route in event["routes"]:
                if not route.get("session"):
                    continue
                for (raw,) in db.execute("SELECT record FROM pi_entries WHERE conversation_id = ?", (route["session"],)):
                    entry = json.loads(raw)
                    if entry.get("data", {}).get("event") == event_id:
                        entries.append(dict(id=entry["id"], kind=entry["kind"], session=route["session"],
                                            target=entry.get("data", {}).get("target")))
            terminals = [dict(id=e["id"], run=e["data"].get("runId"), status=e["data"].get("status"),
                              inputs=e["data"].get("inputs")) for e in events
                         if e["type"] == "run.end" and event_id in e["data"].get("inputs", [])]
            deliveries = [dict(id=e["id"], delivery=e["data"].get("delivery")) for e in events
                          if e["type"] == "message.out" and e["parent"] == event_id]
            result.append(dict(event=event_id, acceptedAt=event["ts"], originalAt=event["data"].get("createdAt"),
                               conv=event["conv"], routes=event["routes"], entries=entries,
                               terminals=terminals, deliveries=deliveries))
        return dict(nativeId=native_id, admissionCount=len(admissions), admissions=result)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    print(json.dumps(audit(sys.argv[1], sys.argv[2]), ensure_ascii=False, indent=2))
