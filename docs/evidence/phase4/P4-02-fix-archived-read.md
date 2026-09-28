# Fix — archived board room reads

Planned subject: `fix(collaboration): load archived boards for authorized reads`

Parent: `c3b323a5afe436ac518c900da7c0c270b6d040c8`. The P4-02 loader treated archive as a reason to reject room reconstruction, while the established board permission service permits authorized reads of archived boards. P4-03 exposed this conflict when preparing the gateway.

The loader now reconstructs committed state regardless of archive status. The gateway must check membership before calling it, and archived graph writes remain denied by the permission service. An isolated PostgreSQL integration case archives a board and confirms its committed graph and sequence still load. All five room-loader integration cases passed in 15.2 seconds. No database schema or wire contract changed.

P4-03 WebSocket dependency edits were already present as separate, unstaged preparation; this fix commit includes only the loader, its test, and this evidence.
