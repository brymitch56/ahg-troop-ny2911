#!/usr/bin/env python3
"""Scrub the AHGfamily iCal feed for public display.

Removes location-identifying and personal information, keeps event
names and times, and adds a URL to the (login-gated) event page on
AHGfamily so troop families can see full details there.

Usage: scrub_calendar.py <input.ics> <output.ics>
"""
import re
import sys

# Properties removed entirely from every event (privacy)
STRIP_PROPS = ("LOCATION", "GEO", "DESCRIPTION", "X-ALT-DESC")

UID_RE = re.compile(r"^UID:AHGFAMILY-(ev[a-z0-9]+)-", re.IGNORECASE)
EVENT_URL = "https://www.ahgfamily.org/event/{}"


def unfold(lines):
    """Join folded iCal lines (continuations start with space/tab)."""
    out = []
    for line in lines:
        if line[:1] in (" ", "\t") and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out


def fold(line):
    """Fold long lines at 74 octets per RFC 5545."""
    out = []
    while len(line.encode("utf-8")) > 74:
        # cut at a safe character boundary
        cut = 74
        while len(line[:cut].encode("utf-8")) > 74:
            cut -= 1
        out.append(line[:cut])
        line = " " + line[cut:]
    out.append(line)
    return out


def scrub(text):
    lines = unfold(text.replace("\r\n", "\n").split("\n"))
    result = []
    in_event = False
    event_id = None

    for line in lines:
        name = line.split(":", 1)[0].split(";", 1)[0].upper()

        if line.upper().startswith("BEGIN:VEVENT"):
            in_event, event_id = True, None
            result.append(line)
            continue

        if line.upper().startswith("END:VEVENT"):
            if event_id:
                result.append("URL:" + EVENT_URL.format(event_id))
            result.append(line)
            in_event = False
            continue

        if in_event:
            if name in STRIP_PROPS:
                continue
            m = UID_RE.match(line)
            if m:
                event_id = m.group(1).lower()

        result.append(line)

    folded = []
    for line in result:
        if line:
            folded.extend(fold(line))
    return "\r\n".join(folded) + "\r\n"


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        text = f.read()
    if "BEGIN:VCALENDAR" not in text:
        sys.exit("Input does not look like an iCal file; aborting.")
    out = scrub(text)
    with open(dst, "w", encoding="utf-8", newline="") as f:
        f.write(out)
    n = out.count("BEGIN:VEVENT")
    print(f"Scrubbed {n} events -> {dst}")


if __name__ == "__main__":
    main()
