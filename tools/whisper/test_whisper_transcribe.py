"""A whisper-figyelő tesztjei (standard unittest, Python 3.9)."""
import ast
import json
import os
import re
import shutil
import tempfile
import time
import unittest
from datetime import datetime

import whisper_transcribe as wt

HERE = os.path.dirname(os.path.abspath(__file__))


def write(path, text="x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def fake_ok(path, lang, out_dir, outputs, extra=None, on_phase=None):
    if on_phase:
        on_phase("konvertálás")
        on_phase("átírás")
    base = os.path.splitext(os.path.basename(path))[0]
    dest = os.path.join(out_dir, "%s.%s.srt" % (base, lang))
    write(dest, "1\n00:00:00,000 --> 00:00:01,000\nszia\n")
    return dest


def fake_fail(path, lang, out_dir, outputs, extra=None, on_phase=None):
    raise wt.TranscribeError("ffmpeg: invalid data")


class Root(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wt-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "whisper")
        self.out = os.path.join(self.tmp, "sources")
        self.logs = os.path.join(self.tmp, "logs")
        for name in ("inbox", "work", "failed"):
            os.makedirs(os.path.join(self.root, name))

    def put_item(self, id_="a", ext="m4a", info=None):
        write(os.path.join(self.root, "inbox", "%s.%s" % (id_, ext)), "hang")
        meta = {"id": id_, "title": "Cím", "refinery_lang": "hu", "refinery_target": "whisper/csat"}
        meta.update(info or {})
        write(os.path.join(self.root, "inbox", "%s.info.json" % id_), json.dumps(meta))

    def inbox(self):
        return sorted(os.listdir(os.path.join(self.root, "inbox")))

    def work(self):
        return sorted(os.listdir(os.path.join(self.root, "work")))

    def failed(self):
        return sorted(os.listdir(os.path.join(self.root, "failed")))

    def run_process(self, fn=fake_ok, id_="a"):
        item = wt.next_item(os.path.join(self.root, "inbox"))
        self.assertEqual(item[0], id_)
        return wt.process(item, self.root, self.out, self.logs, transcribe_fn=fn)

    def log_lines(self):
        files = sorted(os.listdir(self.logs))
        self.assertEqual(len(files), 1)
        with open(os.path.join(self.logs, files[0])) as fh:
            return files[0], [json.loads(line) for line in fh if line.strip()]


class NextItem(Root):
    def test_info_json_nelkul_nem_veszi_fel(self):
        inbox = os.path.join(self.root, "inbox")
        write(os.path.join(inbox, "a.m4a"))
        self.assertIsNone(wt.next_item(inbox))
        write(os.path.join(inbox, "a.info.json"), "{}")
        item = wt.next_item(inbox)
        self.assertEqual(item[0], "a")
        self.assertEqual(item[1], os.path.join(inbox, "a.m4a"))

    def test_partial_es_pontos_kimarad(self):
        inbox = os.path.join(self.root, "inbox")
        for name in ("a.m4a.partial", ".x.m4a", "a.info.json", ".x.info.json"):
            write(os.path.join(inbox, name))
        self.assertIsNone(wt.next_item(inbox))

    def test_a_legregebbi_elobb(self):
        inbox = os.path.join(self.root, "inbox")
        for id_, age in (("new", 10), ("old", 100)):
            write(os.path.join(inbox, id_ + ".m4a"))
            write(os.path.join(inbox, id_ + ".info.json"), "{}")
            stamp = time.time() - age
            os.utime(os.path.join(inbox, id_ + ".m4a"), (stamp, stamp))
        self.assertEqual(wt.next_item(inbox)[0], "old")

    def test_ures_inbox(self):
        self.assertIsNone(wt.next_item(os.path.join(self.root, "inbox")))
        self.assertIsNone(wt.next_item(os.path.join(self.root, "nincs")))


class Process(Root):
    def test_siker_utan_torles_es_cel(self):
        self.put_item()
        self.assertTrue(self.run_process())
        target = os.path.join(self.out, "whisper", "csat")
        self.assertEqual(sorted(os.listdir(target)), ["a.hu.srt", "a.info.json"])
        self.assertEqual(self.inbox(), [])
        self.assertEqual(self.work(), [])
        self.assertEqual(self.failed(), [])

    def test_hiba_failed_be_loggal(self):
        self.put_item()
        self.assertFalse(self.run_process(fake_fail))
        self.assertEqual(self.failed(), ["a.info.json", "a.log", "a.m4a"])
        self.assertEqual(self.inbox(), [])
        self.assertEqual(self.work(), [])
        with open(os.path.join(self.root, "failed", "a.log")) as fh:
            lines = [line for line in fh.read().split("\n") if line.strip()]
        self.assertEqual(lines[-1], "ffmpeg: invalid data")
        self.assertFalse(os.path.exists(os.path.join(self.out, "whisper")))

    def test_letezo_cel_srt_hiba(self):
        self.put_item()
        existing = os.path.join(self.out, "whisper", "csat", "a.hu.srt")
        write(existing, "RÉGI")
        self.assertFalse(self.run_process())
        with open(existing) as fh:
            self.assertEqual(fh.read(), "RÉGI")
        self.assertIn("a.m4a", self.failed())
        with open(os.path.join(self.root, "failed", "a.log")) as fh:
            self.assertIn("létezik", fh.read())

    def test_hianyzo_nyelv_vagy_cel_hiba(self):
        self.put_item(info={"refinery_lang": ""})
        self.assertFalse(self.run_process())
        self.assertIn("a.log", self.failed())

    def test_naplo_formatum(self):
        self.put_item()
        self.run_process()
        name, lines = self.log_lines()
        self.assertRegex(name, r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?\.jsonl$")
        self.assertEqual(
            [line["type"] for line in lines],
            ["run:started", "scan:found", "item:start"] + ["item:step"] * 3 + ["item:published", "run:done", "run:ended"],
        )
        for line in lines:
            self.assertRegex(line["at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
        self.assertEqual(lines[0]["command"], "whisper a")
        self.assertEqual(lines[0]["pid"], os.getpid())
        self.assertEqual(lines[1]["count"], 1)
        self.assertEqual([line["step"] for line in lines if line["type"] == "item:step"], ["vár", "konvertálás", "átírás"])
        self.assertEqual(lines[2]["itemId"], "a")
        self.assertEqual(lines[2]["title"], "Cím")
        published = [line for line in lines if line["type"] == "item:published"][0]
        self.assertEqual(published["path"], "whisper/csat/a.hu.srt")
        self.assertEqual(lines[-2], {"at": lines[-2]["at"], "type": "run:done", "succeeded": 1, "skipped": 0, "failed": 0})
        self.assertEqual(lines[-1]["interrupted"], False)

    def test_hibas_tetel_naploja(self):
        self.put_item()
        self.run_process(fake_fail)
        _, lines = self.log_lines()
        failed = [line for line in lines if line["type"] == "item:failed"][0]
        self.assertEqual(failed["source"], "whisper")
        self.assertEqual(failed["kind"], "whisper")
        self.assertEqual(failed["error"], "ffmpeg: invalid data")
        done = [line for line in lines if line["type"] == "run:done"][0]
        self.assertEqual(done["failed"], 1)

    def test_munka_kozben_van_work_jelolo(self):
        self.put_item()
        seen = {}

        def spy(path, lang, out_dir, outputs, extra=None, on_phase=None):
            seen["work"] = self.work()
            return fake_ok(path, lang, out_dir, outputs, extra, on_phase)

        self.run_process(spy)
        self.assertTrue(any(name.startswith("a.") for name in seen["work"]))


class RunIdAndLog(Root):
    def test_run_id_utkozes(self):
        now = datetime(2026, 11, 7, 12, 30, 5)
        self.assertEqual(wt.run_id(now, self.logs), "2026-11-07T12-30-05")
        write(os.path.join(self.logs, "2026-11-07T12-30-05.jsonl"))
        self.assertEqual(wt.run_id(now, self.logs), "2026-11-07T12-30-05-2")
        write(os.path.join(self.logs, "2026-11-07T12-30-05-2.jsonl"))
        self.assertEqual(wt.run_id(now, self.logs), "2026-11-07T12-30-05-3")

    def test_heartbeat_szal_frissiti_a_naplot_es_a_heartbeatet(self):
        beat = os.path.join(self.root, "heartbeat")
        log = wt.RunLog(self.logs, heartbeat=beat, interval=0.05)
        try:
            old = time.time() - 1000
            os.utime(log.path, (old, old))
            write(beat)
            os.utime(beat, (old, old))
            deadline = time.time() + 3
            while time.time() < deadline and (os.path.getmtime(log.path) < old + 500 or os.path.getmtime(beat) < old + 500):
                time.sleep(0.02)
            self.assertGreater(os.path.getmtime(log.path), old + 500)
            self.assertGreater(os.path.getmtime(beat), old + 500)
        finally:
            log.close()


class Watch(Root):
    def test_indulaskor_work_urul(self):
        write(os.path.join(self.root, "work", "a.wav"))
        os.makedirs(os.path.join(self.root, "work", "whisper_x"))
        wt.watch(self.root, self.out, self.logs, once=True, transcribe_fn=fake_ok)
        self.assertEqual(self.work(), [])

    def test_once_az_osszes_teteleket_feldolgozza_es_eletjelet_ir(self):
        self.put_item("a")
        self.put_item("b")
        wt.watch(self.root, self.out, self.logs, once=True, transcribe_fn=fake_ok)
        self.assertEqual(self.inbox(), [])
        self.assertTrue(os.path.exists(os.path.join(self.root, "heartbeat")))
        target = os.path.join(self.out, "whisper", "csat")
        self.assertEqual(sorted(os.listdir(target)), ["a.hu.srt", "a.info.json", "b.hu.srt", "b.info.json"])
        self.assertEqual(len(os.listdir(self.logs)), 2)

    def test_napló_alapertelmezett_helye_a_gyoker_mellett(self):
        self.assertEqual(wt.default_logs(self.root), os.path.join(self.tmp, "logs"))


class Misc(unittest.TestCase):
    def test_python39_szintaxis(self):
        with open(os.path.join(HERE, "whisper_transcribe.py")) as fh:
            ast.parse(fh.read(), feature_version=(3, 9))

    def test_kimenet_alias_kibontas(self):
        self.assertEqual(wt.expand_outputs(["srt,txt", "j"]), ["srt", "txt", "json"])
        self.assertIn("vtt", wt.expand_outputs(["all"]))
        with self.assertRaises(ValueError):
            wt.expand_outputs(["xyz"])

    def test_fo_kimenet_kiterjesztese(self):
        self.assertEqual(wt.output_extension("srt"), "srt")
        self.assertEqual(wt.output_extension("jf"), "json")
        self.assertEqual(wt.output_extension("words"), "wts")

    def test_tail_utolso_sorok(self):
        text = "\n".join("sor%d" % i for i in range(30))
        self.assertEqual(wt.tail(text, 3), ["sor27", "sor28", "sor29"])


if __name__ == "__main__":
    unittest.main()
