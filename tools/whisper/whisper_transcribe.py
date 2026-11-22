#!/usr/bin/env python3
"""
whisper_transcribe.py - whisper-cli wrapper + a transcript-refinery whisper-figyelője

Kézi használat (visszafelé kompatibilis):
    whisper-transcribe audio.mp4 --lang hu
    whisper-transcribe audio.m4a --output srt,txt --output-dir ./ki
    whisper-transcribe audio.m4a            # nyelv: auto

Figyelő (launchd alatt fut a gazdagépen):
    whisper-transcribe watch --root <whisper-mappa> --out <sources-gyökér> [--logs L] [--interval 15] [--once]

A figyelő a <root>/inbox mappából dolgozik: <id>.<ext> + <id>.info.json (a refinery írja, .partial + átnevezéssel).
Siker: <out>/<refinery_target>/<id>.<nyelv>.srt (+ <id>.info.json), az inbox-beli bemenet törlődik.
Hiba: a bemenet a <root>/failed mappába kerül, mellé <id>.log. Minden tételhez JSONL futásnapló készül a refinery
formátumában, a heartbeat fájl pedig jelzi, hogy a figyelő él.

Python 3.9 (a gazdagép /usr/bin/python3-ja): csak standard könyvtár, nincs `match`, nincs `X | None`.
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from typing import Callable, Dict, List, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
MODEL_NAME = "ggml-large-v3-turbo.bin"
SUPPORTED_FORMATS = {".flac", ".mp3", ".ogg", ".wav"}
HEARTBEAT_SECONDS = 30
ADVANCE_SECONDS = 3
SEGMENT_MAX = 80
_PROGRESS_RE = re.compile(r"progress\s*=\s*(\d+)%")
_SEGMENT_RE = re.compile(r"^\[\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}\]\s*(.*)$")

FORMAT_FLAG = {
    "txt": "--output-txt",
    "vtt": "--output-vtt",
    "srt": "--output-srt",
    "lrc": "--output-lrc",
    "csv": "--output-csv",
    "json": "--output-json",
    "j": "--output-json",
    "jf": "--output-json-full",
    "json-full": "--output-json-full",
    "wts": "--output-words",
    "words": "--output-words",
}
ALIASES = {"j": "json", "jf": "json-full", "wts": "words"}
FORMAT_EXT = {"json-full": "json", "words": "wts"}


class TranscribeError(Exception):
    """Az átírás hibája; az üzenet utolsó sora a rövid ok."""


class Cancelled(Exception):
    """A felhasználó megszakította az átírást (`cancel/<id>` jelzőfájl)."""


# --------------------------------------------------------------------------- eszközök keresése


def _first_existing(paths: List[Optional[str]]) -> Optional[str]:
    for path in paths:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def find_whisper_cli() -> str:
    found = _first_existing([os.path.join(SCRIPT_DIR, "bin", "whisper-cli"), shutil.which("whisper-cli")])
    if found is None:
        raise TranscribeError("nincs whisper-cli")
    return found


def find_ffmpeg() -> str:
    found = _first_existing([shutil.which("ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"])
    if found is None:
        raise TranscribeError("nincs ffmpeg")
    return found


def find_model() -> str:
    candidates = [
        os.environ.get("WHISPER_MODEL"),
        os.path.join(SCRIPT_DIR, "models", MODEL_NAME),
        os.path.expanduser(os.path.join("~", ".local", "share", "whisper-transcribe", "models", MODEL_NAME)),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    raise TranscribeError("nincs modell (%s)" % MODEL_NAME)


# --------------------------------------------------------------------------- kimeneti formátumok


def expand_outputs(raw: List[str]) -> List[str]:
    """`srt,txt`, ismételt kapcsoló és `all` kibontása; ismeretlen formátumra ValueError."""
    tokens = []  # type: List[str]
    for chunk in raw:
        for tok in chunk.split(","):
            tok = tok.strip().lower()
            if not tok:
                continue
            tok = ALIASES.get(tok, tok)
            if tok == "all":
                tokens.extend(key for key in FORMAT_FLAG if key not in ALIASES)
            elif tok in FORMAT_FLAG:
                tokens.append(tok)
            else:
                raise ValueError("unknown output format '%s'. Valid: %s, all" % (tok, ", ".join(FORMAT_FLAG)))
    return list(dict.fromkeys(tokens))


def output_extension(token: str) -> str:
    token = ALIASES.get(token, token)
    return FORMAT_EXT.get(token, token)


def tail(text: str, count: int = 10) -> List[str]:
    lines = [line.rstrip() for line in (text or "").splitlines() if line.strip()]
    return lines[-count:]


# --------------------------------------------------------------------------- az átírás


def needs_conversion(path: str) -> bool:
    return os.path.splitext(path)[1].lower() not in SUPPORTED_FORMATS


def _fail(tool: str, stderr: str) -> TranscribeError:
    lines = tail(stderr)
    last = lines[-1] if lines else "ismeretlen hiba"
    return TranscribeError("\n".join(lines + ["%s: %s" % (tool, last)]))


def parse_progress(line: str) -> Optional[int]:
    """A whisper-cli `-pp` sorából a százalék (`progress =  42%`)."""
    found = _PROGRESS_RE.search(line)
    return int(found.group(1)) if found else None


def parse_segment(line: str) -> Optional[str]:
    """Egy felismert szegmens szövege egy sorban; 80 karakter fölött `…` + az utolsó 79 karakter."""
    found = _SEGMENT_RE.match(line.strip())
    if not found:
        return None
    text = " ".join(found.group(1).split())
    return "…" + text[-(SEGMENT_MAX - 1):] if len(text) > SEGMENT_MAX else text


def _run(
    cmd: List[str],
    cancelled: Callable[[], bool],
    on_line: Optional[Callable[[str, str], None]] = None,
) -> Tuple[int, str]:
    """Gyerekfolyamat; stdout/stderr soronként `on_line(stream, line)`-nak, másodpercenként megnézi a megszakítást.

    Megszakításnál terminate(), 5 mp után kill(), majd Cancelled. Visszatérés: (returncode, stderr szövege)."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, errors="replace")
    err_lines = []  # type: List[str]

    def pump(stream: object, name: str) -> None:
        for raw in iter(stream.readline, ""):
            line = raw.rstrip("\n")
            if name == "err":
                err_lines.append(line)
            if on_line is not None:
                try:
                    on_line(name, line)
                except Exception:  # a naplózás hibája nem állíthatja le az átírást
                    pass

    threads = [
        threading.Thread(target=pump, args=(proc.stdout, "out"), daemon=True),
        threading.Thread(target=pump, args=(proc.stderr, "err"), daemon=True),
    ]
    for thread in threads:
        thread.start()
    try:
        while True:
            try:
                proc.wait(timeout=1)
                break
            except subprocess.TimeoutExpired:
                if cancelled():
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                    raise Cancelled()
    finally:
        if proc.poll() is None:  # váratlan kivétel: ne maradjon árva gyerek
            proc.kill()
            proc.wait()
        for thread in threads:
            thread.join(timeout=5)
        for pipe in (proc.stdout, proc.stderr):
            if pipe is not None:
                pipe.close()
    return proc.returncode, "".join(line + "\n" for line in err_lines)


def transcribe(
    path: str,
    lang: str,
    out_dir: str,
    outputs: List[str],
    extra: Optional[List[str]] = None,
    on_phase: Optional[Callable[[str], None]] = None,
    cancelled: Optional[Callable[[], bool]] = None,
    on_progress: Optional[Callable[..., None]] = None,
    log_path: Optional[str] = None,
) -> str:
    """Átírja a hangot; a kimenet `<out_dir>/<alap>[.<nyelv>].<kiterjesztés>`, az első kért formátum útját adja vissza."""
    phase = on_phase or (lambda _name: None)
    stop = cancelled or (lambda: False)
    log_fh = None
    if log_path:
        os.makedirs(os.path.dirname(os.path.abspath(log_path)), exist_ok=True)
        log_fh = open(log_path, "w", encoding="utf-8")  # kísérletenként újra; siker után is megmarad
    write_lock = threading.Lock()
    state = {"percent": 0, "text": ""}  # type: Dict[str, object]

    def make_on_line(parse: bool) -> Callable[[str, str], None]:
        def on_line(_stream: str, line: str) -> None:
            with write_lock:
                if log_fh is not None:
                    log_fh.write(line + "\n")
                    log_fh.flush()
                if not (parse and on_progress is not None):
                    return
                percent = parse_progress(line)
                text = parse_segment(line)
                if percent is None and text is None:
                    return
                if percent is not None:
                    state["percent"] = percent
                if text is not None:
                    state["text"] = text
                on_progress(state["percent"], state["text"])

        return on_line

    cli = find_whisper_cli()
    ffmpeg = find_ffmpeg()
    model = find_model()
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(path))[0]
    stem = base if lang == "auto" else "%s.%s" % (base, lang)
    prefix = os.path.join(out_dir, stem)
    flags = list(dict.fromkeys(FORMAT_FLAG[token] for token in outputs))

    tmp_dir = None  # type: Optional[str]
    audio = path
    try:
        phase("konvertálás")
        if needs_conversion(path):
            tmp_dir = tempfile.mkdtemp(prefix="whisper_", dir=out_dir)
            audio = os.path.join(tmp_dir, "audio_converted.wav")
            code, stderr = _run([ffmpeg, "-y", "-i", path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", audio], stop, make_on_line(False))
            if code != 0:
                raise _fail("ffmpeg", stderr)
        phase("átírás")
        cmd = [cli, "--model", model, "--language", lang, "--print-progress", "--output-file", prefix] + flags + list(extra or []) + ["--file", audio]
        code, stderr = _run(cmd, stop, make_on_line(True))
        if code != 0:
            raise _fail("whisper-cli", stderr)
    finally:
        if log_fh is not None:
            log_fh.close()
        if tmp_dir and os.path.isdir(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)
    return "%s.%s" % (prefix, output_extension(outputs[0])) if outputs else prefix


# --------------------------------------------------------------------------- futásnapló


def run_id(now: datetime, logs: str) -> str:
    """A refinery szabálya (src/run/id.ts): UTC `%Y-%m-%dT%H-%M-%S`, ütközéskor `-2`, `-3`, ..."""
    base = now.strftime("%Y-%m-%dT%H-%M-%S")
    candidate = base
    n = 1
    while os.path.exists(os.path.join(logs, candidate + ".jsonl")):
        n += 1
        candidate = "%s-%d" % (base, n)
    return candidate


def _now_iso() -> str:
    now = datetime.utcnow()
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (now.microsecond // 1000)


class RunLog(object):
    """JSONL eseménynapló a refinery formátumában; a háttérszál az életjel (napló + heartbeat fájlideje)."""

    def __init__(self, logs: str, heartbeat: Optional[str] = None, interval: float = HEARTBEAT_SECONDS) -> None:
        os.makedirs(logs, exist_ok=True)
        self.run_id = run_id(datetime.utcnow(), logs)
        self.path = os.path.join(logs, self.run_id + ".jsonl")
        self._fd = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        self._heartbeat = heartbeat
        self._stop = threading.Event()
        self._interval = interval
        self._thread = threading.Thread(target=self._beat, daemon=True)
        self._thread.start()

    def _beat(self) -> None:
        while not self._stop.wait(self._interval):
            for path in (self.path, self._heartbeat):
                if not path:
                    continue
                try:
                    os.utime(path, None)
                except OSError:
                    pass

    def event(self, **fields: object) -> None:
        line = dict([("at", _now_iso())] + list(fields.items()))
        os.write(self._fd, (json.dumps(line, ensure_ascii=False) + "\n").encode("utf-8"))

    def close(self) -> None:
        self._stop.set()
        self._thread.join()
        try:
            os.close(self._fd)
        except OSError:
            pass


# --------------------------------------------------------------------------- az inbox feldolgozása


def next_item(inbox: str) -> Optional[Tuple[str, str]]:
    """A legrégebbi (mtime) felvehető tétel: `<id>.<ext>`, mellette `<id>.info.json`. (id, hang útja) vagy None."""
    try:
        names = os.listdir(inbox)
    except OSError:
        return None
    found = []  # type: List[Tuple[float, str, str]]
    for name in names:
        if name.startswith(".") or name.endswith(".partial") or name.endswith(".info.json"):
            continue
        id_, dot, _ext = name.rpartition(".")
        if not dot or not id_:
            continue
        if not os.path.isfile(os.path.join(inbox, id_ + ".info.json")):
            continue
        path = os.path.join(inbox, name)
        try:
            found.append((os.path.getmtime(path), id_, path))
        except OSError:
            continue
    if not found:
        return None
    found.sort()
    return found[0][1], found[0][2]


def _atomic_copy(src: str, dst: str) -> None:
    """Átmeneti `.partial` + `os.replace`: a refinery sosem lát félkész fájlt."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".partial"
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)


def _clean_work(work: str, id_: str) -> None:
    try:
        names = os.listdir(work)
    except OSError:
        return
    for name in names:
        if name.startswith(id_ + "."):
            path = os.path.join(work, name)
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                try:
                    os.remove(path)
                except OSError:
                    pass


def _move_to_failed(root: str, id_: str, audio: str, message: str) -> None:
    failed = os.path.join(root, "failed")
    os.makedirs(failed, exist_ok=True)
    info = os.path.join(root, "inbox", id_ + ".info.json")
    if os.path.exists(audio):
        os.replace(audio, os.path.join(failed, os.path.basename(audio)))
    if os.path.exists(info):
        os.replace(info, os.path.join(failed, id_ + ".info.json"))
    with open(os.path.join(failed, id_ + ".log"), "w") as fh:
        fh.write(message.rstrip("\n") + "\n")


def process(
    item: Tuple[str, str],
    root: str,
    out: str,
    logs: str,
    transcribe_fn: Callable[..., str] = transcribe,
) -> bool:
    """Egy tétel átírása a `work/` mappában, majd a kész .srt a helyére; hibánál a bemenet a `failed/`-be."""
    id_, audio = item
    work = os.path.join(root, "work")
    os.makedirs(work, exist_ok=True)
    info_path = os.path.join(root, "inbox", id_ + ".info.json")
    log = RunLog(logs, heartbeat=os.path.join(root, "heartbeat"))
    interrupted = True
    try:
        log.event(type="run:started", command="whisper %s" % id_, pid=os.getpid())
        log.event(type="scan:found", count=1)
        info = {}  # type: Dict[str, object]
        try:
            with open(info_path) as fh:
                info = json.load(fh)
        except (OSError, ValueError):
            pass
        title = info.get("title") if isinstance(info.get("title"), str) and info.get("title") else id_
        log.event(type="item:start", itemId=id_, title=title)
        log.event(type="item:step", itemId=id_, step="vár")
        marker = os.path.join(work, id_ + ".working")
        with open(marker, "w"):
            pass
        cancel_path = os.path.join(root, "cancel", id_)

        def cancelled() -> bool:
            return os.path.exists(cancel_path)

        last_emit = [0.0]
        latest = {"done": 0, "text": ""}  # type: Dict[str, object]

        def emit(done: int, text: str) -> None:
            """item:advance + a `.working` fájl tartalma (atomikusan), egyszerre."""
            payload = {"done": done, "total": 100, "unit": "percent", "text": text}
            fields = dict(payload)
            if not text:
                del fields["text"]
            log.event(type="item:advance", itemId=id_, **fields)
            tmp = marker + ".tmp"
            try:
                with open(tmp, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh, ensure_ascii=False)
                os.replace(tmp, marker)
            except OSError:
                pass

        def on_progress(percent: int, text: str) -> None:
            latest["done"] = percent
            latest["text"] = text
            now = time.monotonic()
            if now - last_emit[0] >= ADVANCE_SECONDS:
                last_emit[0] = now
                emit(percent, text)

        reason = None  # type: Optional[str]
        detail = ""
        published = None  # type: Optional[str]
        was_cancelled = False
        try:
            lang = info.get("refinery_lang")
            target = info.get("refinery_target")
            if not isinstance(lang, str) or not lang or not isinstance(target, str) or not target:
                raise TranscribeError("hibás info.json: hiányzik a refinery_lang vagy a refinery_target")
            target_dir = os.path.join(out, target)
            srt_name = "%s.%s.srt" % (id_, lang)
            final_srt = os.path.join(target_dir, srt_name)
            final_info = os.path.join(target_dir, id_ + ".info.json")
            if os.path.exists(final_srt) and os.path.exists(final_info):
                # Összeomlás a közzététel és a takarítás között: a pár kint van, csak az inbox maradt.
                published = "%s/%s" % (target.rstrip("/"), srt_name)
            elif os.path.exists(final_srt):
                raise TranscribeError("a cél .srt már létezik: %s" % os.path.join(target, srt_name))
            else:
                if cancelled():
                    raise Cancelled()

                def on_phase(name: str) -> None:
                    log.event(type="item:step", itemId=id_, step=name)

                made = transcribe_fn(
                    audio,
                    lang,
                    work,
                    ["srt"],
                    on_phase=on_phase,
                    cancelled=cancelled,
                    on_progress=on_progress,
                    log_path=os.path.join(logs, id_ + ".whisper.log"),
                )
                if cancelled():
                    raise Cancelled()
                if latest["done"] or latest["text"]:
                    emit(100, str(latest["text"]))
                if os.path.exists(final_srt):
                    raise TranscribeError("a cél .srt már létezik: %s" % os.path.join(target, srt_name))
                _atomic_copy(info_path, final_info)
                _atomic_copy(made, final_srt)
                published = "%s/%s" % (target.rstrip("/"), srt_name)
        except Cancelled:
            was_cancelled = True
        except TranscribeError as error:
            detail = str(error)
            lines = [line for line in detail.split("\n") if line.strip()]
            reason = lines[-1] if lines else "ismeretlen hiba"
        except Exception as error:  # a figyelő egy tétel miatt nem állhat le
            detail = "%s: %s" % (type(error).__name__, error)
            reason = detail

        if was_cancelled:
            for path in (audio, info_path, cancel_path):
                try:
                    os.remove(path)
                except OSError:
                    pass
            _clean_work(work, id_)
            _clean_work(os.path.join(root, "failed"), id_)
            log.event(type="item:skipped", itemId=id_, reason="megszakítva")
            log.event(type="run:done", succeeded=0, skipped=1, failed=0)
            return False  # interrupted marad True: a run:ended jelzi
        if reason is None:
            for path in (audio, info_path, cancel_path):
                try:
                    os.remove(path)
                except OSError:
                    pass
            _clean_work(work, id_)
            _clean_work(os.path.join(root, "failed"), id_)  # egy korábbi hibás kísérlet maradékai
            log.event(type="item:published", itemId=id_, path=published)
            log.event(type="run:done", succeeded=1, skipped=0, failed=0)
            ok = True
        else:
            _clean_work(work, id_)
            _move_to_failed(root, id_, audio, detail)
            log.event(type="item:failed", itemId=id_, source="whisper", kind="whisper", error=reason)
            log.event(type="run:done", succeeded=0, skipped=0, failed=1)
            ok = False
        interrupted = False
        return ok
    finally:
        log.event(type="run:ended", interrupted=interrupted)
        log.close()


def default_logs(root: str) -> str:
    return os.path.join(os.path.dirname(os.path.abspath(root)), "logs")


def _touch(path: str) -> None:
    try:
        with open(path, "a"):
            pass
        os.utime(path, None)
    except OSError:
        pass


def _sweep_cancels(root: str) -> None:
    """Törli azt a `cancel/<id>`-t, amelyhez nincs se inbox-hang, se `work/<id>.working` (árva jelzés)."""
    cancel = os.path.join(root, "cancel")
    inbox = os.path.join(root, "inbox")
    try:
        ids = os.listdir(cancel)
    except OSError:
        return
    if not ids:
        return
    try:
        queued = set()
        for name in os.listdir(inbox):
            if name.startswith(".") or name.endswith(".partial") or name.endswith(".info.json"):
                continue
            queued.add(name.rpartition(".")[0])
    except OSError:
        queued = set()
    for id_ in ids:
        if id_ in queued or os.path.exists(os.path.join(root, "work", id_ + ".working")):
            continue
        try:
            os.remove(os.path.join(cancel, id_))
        except OSError:
            pass


def watch(
    root: str,
    out: str,
    logs: Optional[str] = None,
    interval: float = 15,
    once: bool = False,
    transcribe_fn: Callable[..., str] = transcribe,
) -> None:
    logs = logs or default_logs(root)
    inbox = os.path.join(root, "inbox")
    work = os.path.join(root, "work")
    for name in ("inbox", "work", "failed", "cancel"):
        os.makedirs(os.path.join(root, name), exist_ok=True)
    # Újraindítás után a félkész munkafájlok eldobhatók: a tétel az inboxban van, újra sorra kerül.
    for name in os.listdir(work):
        path = os.path.join(work, name)
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                os.remove(path)
            except OSError:
                pass
    heartbeat = os.path.join(root, "heartbeat")
    while True:
        _touch(heartbeat)
        _sweep_cancels(root)
        item = next_item(inbox)
        if item is not None:
            process(item, root, out, logs, transcribe_fn=transcribe_fn)
            continue
        if once:
            return
        time.sleep(interval)


# --------------------------------------------------------------------------- parancssor


def _legacy_main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="whisper-transcribe",
        description="Transcribe audio with whisper-cli (large-v3-turbo model). A figyelő: `whisper-transcribe watch --help`.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("audio", nargs="+", help="Input audio file(s) or glob pattern(s) (any format ffmpeg can read)")
    parser.add_argument("--lang", default="auto", help="Spoken language code, e.g. hu, en, de (default: auto-detect)")
    parser.add_argument(
        "--output",
        metavar="FORMAT[,FORMAT...]",
        action="append",
        dest="outputs",
        help="Output format(s), comma-separated or repeated. Choices: %s. Use 'all' for every format." % ", ".join(FORMAT_FLAG),
    )
    parser.add_argument("--output-dir", default=None, help="Where to write the outputs (default: the current directory)")
    parser.add_argument("--no-timestamps", action="store_true", help="Omit timestamps from output")
    parser.add_argument("--translate", action="store_true", help="Translate to English")
    parser.add_argument("--threads", type=int, default=None, help="Number of CPU threads")
    args = parser.parse_args(argv)

    audio_files = []  # type: List[str]
    for pattern in args.audio:
        matches = sorted(glob.glob(pattern))
        if not matches:
            print("Error: no files matched: %s" % pattern, file=sys.stderr)
            return 1
        for path in matches:
            if not os.path.isfile(path):
                print("Error: not a file: %s" % path, file=sys.stderr)
                return 1
            audio_files.append(path)

    try:
        outputs = expand_outputs(args.outputs or [])
    except ValueError as error:
        print("Error: %s" % error, file=sys.stderr)
        return 1

    extra = []  # type: List[str]
    if args.no_timestamps:
        extra.append("--no-timestamps")
    if args.translate:
        extra.append("--translate")
    if args.threads is not None:
        extra += ["--threads", str(args.threads)]

    out_dir = args.output_dir or os.getcwd()
    print("Files to process (%d):" % len(audio_files))
    for path in audio_files:
        print("  %s" % path)
    print()
    for index, path in enumerate(audio_files, 1):
        if len(audio_files) > 1:
            print("[%d/%d] %s" % (index, len(audio_files), path))
        try:
            written = transcribe(path, args.lang, out_dir, outputs, extra, on_phase=lambda name: print("  %s..." % name))
        except TranscribeError as error:
            print("Error: %s" % error, file=sys.stderr)
            return 1
        print("Done: %s" % written)
    return 0


def _watch_main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="whisper-transcribe watch", description="A refinery whisper-figyelője.")
    parser.add_argument("--root", required=True, help="A whisper-mappa (inbox/, work/, failed/, heartbeat)")
    parser.add_argument("--out", required=True, help="A sources gyökér: ide kerül a <refinery_target>/<id>.<nyelv>.srt")
    parser.add_argument("--logs", default=None, help="A futásnaplók mappája (alapértéke: <root>/../logs)")
    parser.add_argument("--interval", type=float, default=15, help="Pollozás másodpercben (alapértelmezés: 15)")
    parser.add_argument("--once", action="store_true", help="Az inbox kiürítése után kilép")
    args = parser.parse_args(argv)
    watch(args.root, args.out, args.logs, interval=args.interval, once=args.once)
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == "watch":
        return _watch_main(args[1:])
    return _legacy_main(args)


if __name__ == "__main__":
    sys.exit(main())
