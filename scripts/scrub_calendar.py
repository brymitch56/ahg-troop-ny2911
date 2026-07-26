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

# Events whose title matches this are dropped from the public calendar.
# Catches: canceled, cancelled, CANCELED:, cancelation, cancellation,
# and common misspellings like cancled/cancelld, plus postponed and the
# CXL abbreviation. Requires an 'l' after 'canc' so words like "Cancun"
# don't match.
CANCELED_RE = re.compile(r"\b(canc\w*l\w*|cxl\w*|postponed?)\b", re.IGNORECASE)


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


def is_canceled(event_lines):
    """True if the event looks canceled (title text or STATUS property)."""
    for line in event_lines:
        name = line.split(":", 1)[0].split(";", 1)[0].upper()
        value = line.split(":", 1)[1] if ":" in line else ""
        if name == "SUMMARY" and CANCELED_RE.search(value):
            return True
        if name == "STATUS" and "CANCEL" in value.upper():
            return True
    return False


def scrub(text):
    lines = unfold(text.replace("\r\n", "\n").split("\n"))
    result = []
    event = None  # buffer for the current VEVENT's lines
    dropped = 0

    for line in lines:
        if line.upper().startswith("BEGIN:VEVENT"):
            event = [line]
            continue

        if event is not None:
            event.append(line)
            if line.upper().startswith("END:VEVENT"):
                if is_canceled(event):
                    dropped += 1
                else:
                    for ev_line in event:
                        name = ev_line.split(":", 1)[0].split(";", 1)[0].upper()
                        if name not in STRIP_PROPS:
                            result.append(ev_line)
                event = None
            continue

        result.append(line)

    if dropped:
        print(f"Dropped {dropped} canceled/postponed event(s)")
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
