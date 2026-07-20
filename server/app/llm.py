"""Shared Claude API plumbing for the coaching passes.

explanations.py (per-move "why" texts) and summaries.py (post-game
takeaways) make the same call with different prompts — the model, token
budget, and request/response handling live here so the two can never drift
apart.
"""

MODEL = "claude-opus-4-8"
# The answers are a few sentences, but adaptive thinking spends from the same
# budget — leave it room rather than truncating mid-thought.
MAX_TOKENS = 8000


def request_text(system_prompt: str, prompt: str) -> str:
    """One Claude call, returning the response's text blocks. Credentials
    resolve from the environment (ANTHROPIC_API_KEY or an `ant auth login`
    profile). Callers wrap this in their own mockable seam so the automated
    suites never hit the real (paid) API."""
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    return "\n\n".join(
        block.text for block in response.content if block.type == "text"
    ).strip()
