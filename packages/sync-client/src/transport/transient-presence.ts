import {
  CLIENT_EVENT_NAMES,
  MAX_BOARD_CONNECTIONS,
  MAX_DRAG_PREVIEW_POSITIONS,
  MAX_PRESENCE_SELECTED_IDS,
  MAX_PRESENCE_SELECTION_COUNT,
  PRESENCE_EXPIRY_MS,
  PRESENCE_UPDATES_PER_SECOND,
  presenceStateSchema,
  type PresenceState,
  type ServerPresenceMessage,
} from '@archboard/contracts';

const MILLISECONDS_PER_SECOND = 1_000;
const SEND_INTERVAL_MS = Math.ceil(MILLISECONDS_PER_SECOND / PRESENCE_UPDATES_PER_SECOND);
export type PeerPresence = ServerPresenceMessage['data'];

/** Connection-local state only: never touches persistence, graph, receipts, or history. */
export class TransientPresence {
  private readonly listeners = new Set<() => void>();
  private peers: readonly PeerPresence[] = [];
  private pending: PresenceState | null = null;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSentAt = 0;
  private connectionId: string | null = null;

  public constructor(private readonly send: (message: unknown) => boolean) {}

  public getSnapshot = (): readonly PeerPresence[] => this.peers;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public connect(connectionId: string): void {
    this.clear();
    this.connectionId = connectionId;
  }

  public publish(presence: PresenceState): void {
    if (this.connectionId === null) return;
    const ids = [...new Set(presence.selectedIds)];
    const selectedCount = Math.min(
      MAX_PRESENCE_SELECTION_COUNT,
      Math.max(ids.length, presence.selectedCount ?? 0),
    );
    const parsed = presenceStateSchema.safeParse({
      ...presence,
      selectedIds: selectedCount > MAX_PRESENCE_SELECTED_IDS ? [] : ids,
      selectedCount,
      dragPreview:
        presence.dragPreview === null
          ? null
          : {
              positions: presence.dragPreview.positions.slice(0, MAX_DRAG_PREVIEW_POSITIONS),
            },
    });
    if (!parsed.success) return;
    this.pending = parsed.data;
    if (this.sendTimer !== null) return;
    this.sendTimer = setTimeout(
      () => {
        this.sendTimer = null;
        const data = this.pending;
        this.pending = null;
        if (data !== null && this.send({ event: CLIENT_EVENT_NAMES.PRESENCE, data })) {
          this.lastSentAt = Date.now();
        }
      },
      Math.max(0, this.lastSentAt + SEND_INTERVAL_MS - Date.now()),
    );
  }

  public receive(peer: PeerPresence): void {
    if (this.connectionId === null || peer.connectionId === this.connectionId) return;
    const now = Date.now();
    const retained = this.peers.filter(
      (entry) => entry.connectionId !== peer.connectionId && Date.parse(entry.expiresAt) > now,
    );
    if (Date.parse(peer.expiresAt) > now && retained.length < MAX_BOARD_CONNECTIONS - 1) {
      // Bound even a valid but excessively distant server expiry.
      retained.push({
        ...peer,
        expiresAt: new Date(
          Math.min(Date.parse(peer.expiresAt), now + PRESENCE_EXPIRY_MS),
        ).toISOString(),
      });
    }
    this.peers = retained;
    this.changed();
  }

  public clear(): void {
    if (this.sendTimer !== null) clearTimeout(this.sendTimer);
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.sendTimer = null;
    this.expiryTimer = null;
    this.pending = null;
    this.connectionId = null;
    this.lastSentAt = 0;
    this.peers = [];
    for (const listener of this.listeners) listener();
  }

  private changed(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (this.peers.length > 0) {
      const expiry = Math.min(...this.peers.map((peer) => Date.parse(peer.expiresAt)));
      this.expiryTimer = setTimeout(
        () => {
          this.peers = this.peers.filter((peer) => Date.parse(peer.expiresAt) > Date.now());
          this.changed();
        },
        Math.max(0, expiry - Date.now()),
      );
    }
    for (const listener of this.listeners) listener();
  }
}
