"""A whisper-figyelő tesztjei (standard unittest, Python 3.9)."""
import ast
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock
from datetime import datetime

import whisper_transcribe as wt

HERE = os.path.dirname(os.path.abspath(__file__))


def write(path, text="x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def fake_ok(path, lang, out_dir, outputs, extra=None, on_phase=None, **kwargs):
    if on_phase:
        on_phase("konvertálás")
        on_phase("átírás")
    base = os.path.splitext(os.path.basename(path))[0]
    dest = os.path.join(out_dir, "%s.%s.srt" % (base, lang))
    write(dest, "1\n00:00:00,000 --> 00:00:01,000\nszia\n")
    return dest


def fake_fail(path, lang, out_dir, outputs, extra=None, on_phase=None, **kwargs):
    raise wt.TranscribeError("ffmpeg: invalid data")


class Root(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="wt-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "whisper")
        self.out = os.path.join(self.tmp, "sources")
        self.logs = os.path.join(self.tmp, "logs")
        for name in ("inbox", "work", "failed", "cancel"):
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

    def cancel(self):
        return sorted(os.listdir(os.path.join(self.root, "cancel")))

    def request_cancel(self, id_="a"):
        write(os.path.join(self.root, "cancel", id_), "")

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

    def test_siker_utan_a_korabbi_failed_maradekok_torlodnek(self):
        for name in ("a.m4a", "a.info.json", "a.log", "b.m4a"):
            write(os.path.join(self.root, "failed", name), "régi")
        self.put_item()
        self.assertTrue(self.run_process())
        self.assertEqual(self.failed(), ["b.m4a"])

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

    def test_osszeomlas_utan_kesz_par_nem_megy_failed_be(self):
        # Az .srt és az info.json már kint van, de a bemenet az inboxban maradt (összeomlás a takarítás előtt).
        self.put_item()
        target = os.path.join(self.out, "whisper", "csat")
        write(os.path.join(target, "a.hu.srt"), "KÉSZ")
        write(os.path.join(target, "a.info.json"), "{}")
        calls = []

        def spy(*args, **kwargs):
            calls.append(args)
            return fake_ok(*args, **kwargs)

        self.assertTrue(self.run_process(spy))
        self.assertEqual(calls, [])
        self.assertEqual(self.inbox(), [])
        self.assertEqual(self.failed(), [])
        with open(os.path.join(target, "a.hu.srt")) as fh:
            self.assertEqual(fh.read(), "KÉSZ")

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

        def spy(path, lang, out_dir, outputs, extra=None, on_phase=None, **kwargs):
            seen["work"] = self.work()
            return fake_ok(path, lang, out_dir, outputs, extra, on_phase)

        self.run_process(spy)
        self.assertTrue(any(name.startswith("a.") for name in seen["work"]))

    def assert_megszakitva(self):
        for listing in (self.inbox(), self.work(), self.failed(), self.cancel()):
            self.assertEqual(listing, [])
        self.assertFalse(os.path.exists(os.path.join(self.out, "whisper")))
        _, lines = self.log_lines()
        self.assertEqual([line["type"] for line in lines][-3:], ["item:skipped", "run:done", "run:ended"])
        self.assertEqual(lines[-3]["reason"], "megszakítva")
        self.assertEqual((lines[-2]["succeeded"], lines[-2]["skipped"], lines[-2]["failed"]), (0, 1, 0))
        self.assertTrue(lines[-1]["interrupted"])

    def test_megszakitas_atiras_kozben(self):
        self.put_item()

        def fake_cancel(path, lang, out_dir, outputs, **kw):
            self.request_cancel()
            raise wt.Cancelled()

        self.run_process(fake_cancel)
        self.assert_megszakitva()

    def test_megszakitas_felvetelkor(self):
        self.put_item()
        self.request_cancel()

        def never(*args, **kwargs):
            raise AssertionError("nem futhat le")

        self.run_process(never)
        self.assert_megszakitva()

    def test_megszakitas_kozzetetel_elott(self):
        self.put_item()

        def fake_late(path, lang, out_dir, outputs, **kw):
            dest = fake_ok(path, lang, out_dir, outputs)
            self.request_cancel()
            return dest

        self.run_process(fake_late)
        self.assert_megszakitva()

    def test_megszakitas_utan_a_korabbi_failed_maradekok_torlodnek(self):
        for name in ("a.m4a", "a.log"):
            write(os.path.join(self.root, "failed", name), "régi")
        self.put_item()
        self.request_cancel()
        self.run_process(fake_ok)
        self.assertEqual(self.failed(), [])

    def test_kozzetett_par_mellett_a_cancel_hatastalan(self):
        self.put_item()
        target = os.path.join(self.out, "whisper", "csat")
        write(os.path.join(target, "a.hu.srt"), "KÉSZ")
        write(os.path.join(target, "a.info.json"), "{}")
        self.request_cancel()
        self.assertTrue(self.run_process(fake_ok))
        _, lines = self.log_lines()
        self.assertIn("item:published", [line["type"] for line in lines])
        self.assertEqual(sorted(os.listdir(target)), ["a.hu.srt", "a.info.json"])
        self.assertEqual(self.cancel(), [])
        self.assertEqual(self.inbox(), [])

    def run_progress(self, calls):
        seen = []

        def fake_progress(path, lang, out_dir, outputs, on_progress=None, **kw):
            for percent, text in calls:
                on_progress(percent, text)
            with open(os.path.join(self.root, "work", "a.working")) as fh:
                seen.append(fh.read())
            return fake_ok(path, lang, out_dir, outputs)

        self.put_item()
        self.run_process(fake_progress)
        _, lines = self.log_lines()
        return seen, [line for line in lines if line["type"] in ("item:advance", "item:published")]

    def test_haladas_a_naploba_es_a_working_fajlba(self):
        seen, lines = self.run_progress([(50, "fél")])
        self.assertEqual(json.loads(seen[0]), {"done": 50, "total": 100, "unit": "percent", "text": "fél"})
        advances = [line for line in lines if line["type"] == "item:advance"]
        self.assertEqual(advances[0]["done"], 50)
        self.assertEqual((advances[0]["total"], advances[0]["unit"], advances[0]["text"]), (100, "percent", "fél"))
        self.assertEqual(advances[-1]["done"], 100)
        self.assertEqual(lines[-1]["type"], "item:published")

    def test_haladas_ritkitva(self):
        _, lines = self.run_progress([(10, "a"), (11, "b"), (12, "c")])
        advances = [line for line in lines if line["type"] == "item:advance"]
        self.assertEqual([line["done"] for line in advances], [10, 100])


class Progress(unittest.TestCase):
    def test_parse_progress(self):
        self.assertEqual(wt.parse_progress("whisper_print_progress_callback: progress =  42%"), 42)
        self.assertIsNone(wt.parse_progress("valami"))

    def test_parse_segment(self):
        self.assertEqual(wt.parse_segment("[00:01:02.500 --> 00:01:05.250]   Szia világ"), "Szia világ")
        self.assertIsNone(wt.parse_segment("valami"))

    def test_hosszu_szegmens_vagva(self):
        line = "[00:00:00.000 --> 00:00:05.000] " + "x" * 100
        text = wt.parse_segment(line)
        self.assertEqual(len(text), 80)
        self.assertTrue(text.startswith("…"))


class WhisperLog(unittest.TestCase):
    def test_whisper_log_megmarad(self):
        tmp = tempfile.mkdtemp(prefix="wt-log-")
        self.addCleanup(shutil.rmtree, tmp, True)
        os.makedirs(os.path.join(tmp, "bin"))
        cli = os.path.join(tmp, "bin", "whisper-cli")
        write(
            cli,
            "#!/bin/sh\n"
            'while [ $# -gt 0 ]; do if [ "$1" = "--output-file" ]; then out="$2"; fi; shift; done\n'
            'echo "[00:00:00.000 --> 00:00:01.000]   Szia világ"\n'
            'echo "whisper_print_progress_callback: progress =  50%" >&2\n'
            'printf "1\\n" > "$out.srt"\n',
        )
        os.chmod(cli, 0o755)
        audio = os.path.join(tmp, "a.wav")
        write(audio, "hang")
        log_path = os.path.join(tmp, "logs", "a.whisper.log")
        calls = []
        with mock.patch.object(wt, "SCRIPT_DIR", tmp), mock.patch.object(wt, "find_model", return_value="m"), mock.patch.object(
            wt, "find_ffmpeg", return_value="ffmpeg"
        ):
            made = wt.transcribe(audio, "hu", os.path.join(tmp, "out"), ["srt"], on_progress=lambda p, t: calls.append((p, t)), log_path=log_path)
        self.assertTrue(os.path.exists(made))
        with open(log_path) as fh:
            self.assertIn("Szia világ", fh.read())
        self.assertEqual(calls[-1], (50, "Szia világ"))


class Run(unittest.TestCase):
    def test_run_megszakitja_a_gyereket(self):
        started = time.time()
        with self.assertRaises(wt.Cancelled):
            wt._run([sys.executable, "-c", "import time; time.sleep(30)"], cancelled=lambda: True)
        self.assertLess(time.time() - started, 7)

    def test_run_sorokat_ad(self):
        lines = []
        code = "print('a'); import sys; print('b', file=sys.stderr)"
        result = wt._run([sys.executable, "-c", code], lambda: False, on_line=lambda stream, line: lines.append((stream, line)))
        self.assertIn(("out", "a"), lines)
        self.assertIn(("err", "b"), lines)
        self.assertEqual(result, (0, "b\n"))


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

    def test_indulaskor_cancel_marad(self):
        self.put_item("b")
        self.request_cancel("b")
        wt.watch(self.root, self.out, self.logs, once=True, transcribe_fn=fake_ok)
        self.assertFalse(os.path.exists(os.path.join(self.out, "whisper")))
        self.assertEqual(self.cancel(), [])
        self.assertEqual(self.inbox(), [])

    def test_arva_cancel_torlodik(self):
        self.request_cancel("x")
        wt.watch(self.root, self.out, self.logs, once=True, transcribe_fn=fake_ok)
        self.assertEqual(self.cancel(), [])

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
