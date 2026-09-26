import {
  ERROR_CODES,
  MAX_ACTIVE_ROOMS,
  MAX_BOARD_CONNECTIONS,
  ROOM_IDLE_EVICTION_MS,
  type ErrorCode,
  type ServerSequence,
} from '@archboard/contracts';
import type * as Y from 'yjs';

export interface BufferedRoomUpdate {
  readonly seq: ServerSequence;
  readonly updateBase64: string;
}

interface RoomSubscriber {
  readonly deliver: (update: BufferedRoomUpdate) => void;
  readonly pending: BufferedRoomUpdate[];
  active: boolean;
}

export interface LoadedRoom {
  readonly document: Y.Doc;
  readonly latestSeq: ServerSequence;
}

export interface RoomLoader {
  load(boardId: string): Promise<LoadedRoom>;
}

export class RoomAdmissionError extends Error {
  public constructor(public readonly code: ErrorCode) {
    super(code === ERROR_CODES.ROOM_FULL ? 'The board room is full.' : 'Collaboration is busy.');
    this.name = 'RoomAdmissionError';
  }
}

export class CollaborationRoom {
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private connections = 0;
  private durable = true;
  private lastActivityAt: number;
  private readonly subscribers = new Set<RoomSubscriber>();
  private currentDocument: Y.Doc;
  private currentSequence: ServerSequence;

  public constructor(
    public readonly boardId: string,
    document: Y.Doc,
    latestSeq: ServerSequence,
    private readonly now: () => number,
  ) {
    this.currentDocument = document;
    this.currentSequence = latestSeq;
    this.lastActivityAt = now();
  }

  public get document(): Y.Doc {
    return this.currentDocument;
  }

  public get latestSeq(): ServerSequence {
    return this.currentSequence;
  }

  /** Called under the room queue only after the corresponding transaction commits. */
  public installCommittedCandidate(candidate: Y.Doc, sequence: ServerSequence): void {
    const previous = this.currentDocument;
    this.currentDocument = candidate;
    this.currentSequence = sequence;
    this.lastActivityAt = this.now();
    previous.destroy();
  }

  public get connectionCount(): number {
    return this.connections;
  }

  public run<T>(work: () => Promise<T>): Promise<T> {
    this.queued += 1;
    const operation = this.tail.then(work);
    this.tail = operation.then(
      () => {
        this.queued -= 1;
        this.lastActivityAt = this.now();
      },
      () => {
        this.queued -= 1;
        this.lastActivityAt = this.now();
      },
    );
    return operation;
  }

  public reserve(now: number): void {
    if (this.connections >= MAX_BOARD_CONNECTIONS)
      throw new RoomAdmissionError(ERROR_CODES.ROOM_FULL);
    this.connections += 1;
    this.lastActivityAt = now;
  }

  public release(now: number): void {
    if (this.connections === 0) throw new Error('Room connection reservation underflow.');
    this.connections -= 1;
    this.lastActivityAt = now;
  }

  public setDurable(durable: boolean): void {
    this.durable = durable;
  }

  /** Register before sending ready; activate only after ready is handed to the socket. */
  public subscribe(deliver: (update: BufferedRoomUpdate) => void): {
    activate(): void;
    unsubscribe(): void;
  } {
    const subscriber: RoomSubscriber = { deliver, pending: [], active: false };
    this.subscribers.add(subscriber);
    return {
      activate: () => {
        if (!this.subscribers.has(subscriber)) return;
        subscriber.active = true;
        for (const update of subscriber.pending.splice(0)) subscriber.deliver(update);
      },
      unsubscribe: () => {
        subscriber.pending.length = 0;
        this.subscribers.delete(subscriber);
      },
    };
  }

  /** Called under the board queue only after a later durable update commits. */
  public publishCommittedUpdate(
    update: BufferedRoomUpdate,
    except?: (update: BufferedRoomUpdate) => void,
  ): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.deliver === except) continue;
      if (subscriber.active) subscriber.deliver(update);
      else subscriber.pending.push(update);
    }
  }

  public isIdle(now: number): boolean {
    return (
      this.connections === 0 &&
      this.queued === 0 &&
      this.durable &&
      now - this.lastActivityAt >= ROOM_IDLE_EVICTION_MS
    );
  }
}

export interface RoomReservation {
  readonly room: CollaborationRoom;
  release(): void;
}

export class CollaborationRoomRegistry {
  private readonly rooms = new Map<string, CollaborationRoom>();
  private readonly opening = new Map<string, Promise<CollaborationRoom>>();

  public constructor(
    private readonly loader: RoomLoader,
    private readonly now: () => number = Date.now,
  ) {}

  public get activeRoomCount(): number {
    return this.rooms.size;
  }

  public connectionCount(boardId: string): number {
    return this.rooms.get(boardId)?.connectionCount ?? 0;
  }

  public async reserve(boardId: string): Promise<RoomReservation> {
    let room = this.rooms.get(boardId);
    if (room === undefined) {
      let pending = this.opening.get(boardId);
      if (pending === undefined) {
        if (this.rooms.size + this.opening.size >= MAX_ACTIVE_ROOMS) {
          throw new RoomAdmissionError(ERROR_CODES.SERVER_BUSY);
        }
        pending = this.loader
          .load(boardId)
          .then(({ document, latestSeq }) => {
            const opened = new CollaborationRoom(boardId, document, latestSeq, this.now);
            this.rooms.set(boardId, opened);
            return opened;
          })
          .finally(() => {
            this.opening.delete(boardId);
          });
        this.opening.set(boardId, pending);
      }
      room = await pending;
    }
    room.reserve(this.now());
    let released = false;
    return {
      room,
      release: () => {
        if (released) return;
        released = true;
        room.release(this.now());
      },
    };
  }

  public evictIdle(): number {
    const now = this.now();
    let evicted = 0;
    for (const [boardId, room] of this.rooms) {
      if (!room.isIdle(now)) continue;
      this.rooms.delete(boardId);
      evicted += 1;
    }
    return evicted;
  }
}
