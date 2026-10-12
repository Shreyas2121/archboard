# Local login for browser debugging

Run the API in development mode with PUBLIC_API_ORIGIN on localhost, 127.0.0.1 or
IPv6 loopback, and the exact local frontend origin in ALLOWED_WEB_ORIGINS. Open the
development frontend on localhost and choose **Continue as local test account**.
No GitHub authorization, password or shared session cookie is needed.

The endpoint is POST /api/auth/sign-in/local. It is a Better Auth plugin, registered
only for a loopback development API. The HTTP adapter requires a real loopback
socket peer and an exact allowed loopback Origin. Production and test mode do not
register the plugin. The button is absent from production frontend builds.

The endpoint always uses the reserved local-agent@archboard.invalid account. It
creates it once, then reuses it across sessions. Caller-supplied identities are
ignored. It issues Better Auth's normal HttpOnly session cookie and returns only
success; no token is returned in JSON. Normal sign-out, account transition handling,
board authorization, CSRF/origin protections and session expiry remain in effect.
The account can create its own boards and cannot access another user's private
boards without an ordinary invitation. It has no administrator privileges.

An agent can use an isolated browser context, open the local home page, click this
button, and create a test board using the normal UI. Keep the context isolated from
your personal GitHub session. No auth-schema migration is needed.

For AI reproduction, upload [the minimal synthetic context](examples/ai-debug.project-context.json)
on a test board, review it and generate. Provider requests still use the configured
provider and its billing. The login itself does not send an AI request.
