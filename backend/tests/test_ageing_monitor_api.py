"""Backend API regression tests for the Ageing Monitor app.

Covers:
- /api/ root health
- /api/researchers CRUD + idempotency + Solomon seed
- /api/experiments CRUD + validation
- /api/experiments/{id}/remove
- /api/experiments/export/csv
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

if not BASE_URL:
    # Fall back to reading the frontend env file (live preview URL)
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def created_ids():
    return {"experiments": [], "researchers": []}


# ---------- Health ----------
class TestHealth:
    def test_root_health(self, client):
        r = client.get(f"{API}/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "ok"
        assert "Ageing" in data.get("message", "")


# ---------- Researchers ----------
class TestResearchers:
    def test_list_has_solomon(self, client):
        r = client.get(f"{API}/researchers")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 1
        names = [x["name"] for x in items]
        assert "Solomon" in names

    def test_create_researcher(self, client, created_ids):
        name = f"TEST_Researcher_{int(time.time()*1000)}"
        r = client.post(f"{API}/researchers", json={"name": name})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == name
        assert "id" in body
        created_ids["researchers"].append(body["id"])

        # verify persistence via GET
        r2 = client.get(f"{API}/researchers")
        assert any(x["id"] == body["id"] for x in r2.json())

    def test_create_idempotent_by_name(self, client):
        # Solomon should already exist; recreating should return existing record
        r1 = client.post(f"{API}/researchers", json={"name": "Solomon"})
        r2 = client.post(f"{API}/researchers", json={"name": "Solomon"})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"]

    def test_create_empty_name_rejected(self, client):
        r = client.post(f"{API}/researchers", json={"name": "   "})
        assert r.status_code == 400

    def test_delete_researcher(self, client, created_ids):
        if not created_ids["researchers"]:
            pytest.skip("no researcher to delete")
        rid = created_ids["researchers"].pop(0)
        r = client.delete(f"{API}/researchers/{rid}")
        assert r.status_code == 200
        # 404 thereafter
        r2 = client.delete(f"{API}/researchers/{rid}")
        assert r2.status_code == 404


# ---------- Experiments ----------
class TestExperiments:
    def test_create_experiment(self, client, created_ids):
        payload = {
            "batch": "TEST_BATCH_001",
            "researcher": "Solomon",
            "condition": "80C in 1M KOH",
            "hours": 1.0,
        }
        r = client.post(f"{API}/experiments", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        for k, v in payload.items():
            assert body[k] == v
        assert body["end_time"] - body["start_time"] == int(1 * 60 * 60 * 1000)
        assert body["removed_at"] is None
        # NEW: email_notified_at must be exposed and initially null
        assert "email_notified_at" in body, "Experiment response must include email_notified_at"
        assert body["email_notified_at"] is None
        created_ids["experiments"].append(body["id"])

    def test_email_notified_at_field_present_on_get(self, client, created_ids):
        eid = created_ids["experiments"][0]
        r = client.get(f"{API}/experiments/{eid}")
        assert r.status_code == 200
        body = r.json()
        assert "email_notified_at" in body
        # may still be null because watcher hasn't run or creds empty
        assert body["email_notified_at"] is None or isinstance(body["email_notified_at"], int)

    def test_watcher_skips_gracefully_without_credentials(self, client, created_ids):
        """Create a near-instant experiment (~3.6s) and wait through one watcher
        tick (60s + buffer). With GMAIL creds empty, experiment must remain
        retrievable, email_notified_at must remain null, and no crash occurs.
        """
        r = client.post(f"{API}/experiments", json={
            "batch": "TEST_BATCH_EMAILSKIP",
            "researcher": "Solomon",
            "condition": "watcher skip path",
            "hours": 0.001,  # ~3.6s
        })
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        created_ids["experiments"].append(eid)

        # Wait > 60s for the watcher to tick at least once after end_time passes
        time.sleep(70)

        g = client.get(f"{API}/experiments/{eid}")
        assert g.status_code == 200, "experiment must remain retrievable; backend didn't crash"
        body = g.json()
        assert body["email_notified_at"] is None, (
            "Without Gmail creds the watcher must NOT stamp email_notified_at"
        )

    def test_create_invalid_hours(self, client):
        r = client.post(f"{API}/experiments", json={
            "batch": "X", "researcher": "Solomon", "condition": "Y", "hours": 0
        })
        assert r.status_code == 400

    def test_create_missing_batch(self, client):
        r = client.post(f"{API}/experiments", json={
            "batch": "", "researcher": "Solomon", "condition": "Y", "hours": 5
        })
        assert r.status_code == 400

    def test_list_experiments(self, client, created_ids):
        r = client.get(f"{API}/experiments")
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        for eid in created_ids["experiments"]:
            assert eid in ids

    def test_get_experiment_by_id(self, client, created_ids):
        eid = created_ids["experiments"][0]
        r = client.get(f"{API}/experiments/{eid}")
        assert r.status_code == 200
        assert r.json()["id"] == eid

    def test_get_unknown_returns_404(self, client):
        r = client.get(f"{API}/experiments/nonexistent-id-xyz")
        assert r.status_code == 404

    def test_patch_notes_and_photo(self, client, created_ids):
        eid = created_ids["experiments"][0]
        r = client.patch(f"{API}/experiments/{eid}", json={
            "notes": "TEST notes value",
            "photo_base64": "data:image/png;base64,AAA",
        })
        assert r.status_code == 200, r.text
        # verify via GET
        g = client.get(f"{API}/experiments/{eid}").json()
        assert g["notes"] == "TEST notes value"
        assert g["photo_base64"] == "data:image/png;base64,AAA"

    def test_mark_sample_removed(self, client, created_ids):
        # Create a new experiment to remove (don't touch the patched one)
        r = client.post(f"{API}/experiments", json={
            "batch": "TEST_BATCH_REMOVE",
            "researcher": "Solomon",
            "condition": "RT",
            "hours": 2,
        })
        eid = r.json()["id"]
        created_ids["experiments"].append(eid)

        rr = client.post(f"{API}/experiments/{eid}/remove")
        assert rr.status_code == 200
        body = rr.json()
        assert body["removed_at"] is not None
        now_ms = int(time.time() * 1000)
        assert abs(body["removed_at"] - now_ms) < 15_000  # within 15s

    def test_export_csv(self, client, created_ids):
        r = client.get(f"{API}/experiments/export/csv")
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "text/csv" in ct, f"unexpected content-type: {ct}"
        text = r.text
        first_line = text.splitlines()[0]
        assert first_line.startswith("Sample ID,Researcher,Condition"), first_line
        # our test batch should appear in the body
        assert "TEST_BATCH_001" in text

    def test_delete_experiment(self, client, created_ids):
        # delete each created experiment and verify 404 after
        for eid in list(created_ids["experiments"]):
            r = client.delete(f"{API}/experiments/{eid}")
            assert r.status_code == 200
            g = client.get(f"{API}/experiments/{eid}")
            assert g.status_code == 404
            created_ids["experiments"].remove(eid)
