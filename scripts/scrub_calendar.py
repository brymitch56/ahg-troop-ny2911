#!/usr/bin/env python3
"""Scrub the AHGfamily iCal feed for public display.

Removes location-identifying and personal information, keeps event
names and times, and adds a URL to the (login-gated) event page on
AHGfamily so troop families can see full details there.

Usage: scrub_calendar.py <input.ics> <output.ics>
"""
import re
import sys

# Properties removed entirely from every event (privacy).
# URL is deliberately kept: the private feed carries each event's real
# AHGfamily link, which is login-gated and safe to publish.
STRIP_PROPS = ("LOCATION", "GEO", "DESCRIPTION", "X-ALT-DESC")


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

    for line in lines:
        name = line.split(":", 1)[0].split(";", 1)[0].upper()

        if line.upper().startswith("BEGIN:VEVENT"):
            in_event = True
        elif line.upper().startswith("END:VEVENT"):
            in_event = False
        elif in_event and name in STRIP_PROPS:
            continue

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
