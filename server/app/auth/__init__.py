"""Accounts for leechess: username + password, no email, no third party.

The app is a personal coaching tool, so an account exists to re-attach a
browser to its own games — not to protect anything valuable. That shapes the
whole package: no mail sender, no password reset, and only one kind of
account. Playing without one is a browser-side mode (the SPA's anonymous
session) that writes nothing here and reaches none of the data routes, so
there is no half-account for this package to carry.
"""
