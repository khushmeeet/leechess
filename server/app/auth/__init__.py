"""Accounts for leechess: username + password, no email, no third party.

The app is a personal coaching tool, so an account exists to re-attach a
browser to its own games — not to protect anything valuable. That shapes the
whole package: no mail sender, no password reset, and a guest is a real user
row rather than a separate anonymous code path (see models.User.is_guest).
"""
