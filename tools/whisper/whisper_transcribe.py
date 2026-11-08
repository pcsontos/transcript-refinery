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


def transcribe(
    path: str,
    lang: str,
    out_dir: str,
    outputs: List[str],
    extra: Optional[List[str]] = None,
    on_phase: Optional[Callable[[str], None]] = None,
) -> str:
    """Átírja a hangot; a kimenet `<out_dir>/<alap>[.<nyelv>].<kiterjesztés>`, az első kért formátum útját adja vissza."""
    phase = on_phase or (lambda _name: None)
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
            result = subprocess.run(
                [ffmpeg, "-y", "-i", path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", audio],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                raise _fail("ffmpeg", result.stderr)
        phase("átírás")
        cmd = [cli, "--model", model, "--language", lang, "--output-file", prefix] + flags + list(extra or []) + ["--file", audio]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise _fail("whisper-cli", result.stderr)
    finally:
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
        reason = None  # type: Optional[str]
        detail = ""
        published = None  # type: Optional[str]
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
                def on_phase(name: str) -> None:
                    log.event(type="item:step", itemId=id_, step=name)

                made = transcribe_fn(audio, lang, work, ["srt"], on_phase=on_phase)
                if os.path.exists(final_srt):
                    raise TranscribeError("a cél .srt már létezik: %s" % os.path.join(target, srt_name))
                _atomic_copy(info_path, final_info)
                _atomic_copy(made, final_srt)
                published = "%s/%s" % (target.rstrip("/"), srt_name)
        except TranscribeError as error:
            detail = str(error)
            lines = [line for line in detail.split("\n") if line.strip()]
            reason = lines[-1] if lines else "ismeretlen hiba"
        except Exception as error:  # a figyelő egy tétel miatt nem állhat le
            detail = "%s: %s" % (type(error).__name__, error)
            reason = detail

        if reason is None:
            for path in (audio, info_path):
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
    for name in ("inbox", "work", "failed"):
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
