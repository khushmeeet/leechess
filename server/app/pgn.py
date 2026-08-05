"""Writing PGN header values that cannot break out of the header.

python-chess does not escape what it puts between the quotes of a tag pair —
`headers["White"] = 'x"]\\n[Result "1-0'` serializes verbatim and produces an
extra, forged `[Result]` line. Everything that reaches a header here is a
display name, and in a friend game one of those names belongs to someone with
no account who typed it into a join form. That is an untrusted party writing
structural bytes into another account's stored game.

The PGN spec's own answer is backslash escaping for `"` and `\\`, and it says
a tag value is a single line. So: escape the two characters the format
defines an escape for, and drop the ones it has no representation of at all.
"""

# A header value is a string token, and the format has no line continuation.
_UNREPRESENTABLE = str.maketrans({"\n": " ", "\r": " ", "\t": " ", "\x00": None})

# Long enough for any real name, short enough that a header stays a header.
MAX_HEADER_VALUE = 64


def header_value(value: str | None, *, fallback: str = "?") -> str:
    """One PGN tag value, safe to place between quotes.

    Falls back rather than returning an empty string: `[White ""]` parses, but
    every reader shows it as a nameless player, and "?" is what PGN already
    means by unknown.
    """
    if not value:
        return fallback
    # Truncate before escaping, never after: cutting the string once the
    # backslashes are in could leave a trailing lone `\`, which escapes the
    # closing quote and breaks the header open again — the exact thing this
    # function exists to prevent.
    cleaned = value.translate(_UNREPRESENTABLE).strip()[:MAX_HEADER_VALUE]
    if not cleaned:  # nothing but characters that were just removed
        return fallback
    return cleaned.replace("\\", "\\\\").replace('"', '\\"')
