import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PresenterFollowModel,
  resolveFollowedStep,
} from '../apps/web/src/features/editor/presentation/presenter-follow-model.ts';
import { allEntityGraphFixture } from '../packages/fixtures/dist/index.js';

const scope = 'synthetic-account-board';
const observer = randomUUID();
const holder = randomUUID();
const first = randomUUID();
const second = randomUUID();
const lease = (stepId = first, connectionId = holder, expiresAt = 30_000) => ({
  connectionId,
  stepId,
  expiresAt: new Date(expiresAt).toISOString(),
});
const setup = () => {
  const model = new PresenterFollowModel(scope);
  model.bind(observer, true);
  model.receive(scope, observer, lease(), 0);
  return model;
};

describe('explicit presenter follow authority', () => {
  it('does not follow on receipt, local mode entry or repeated frames', () => {
    const model = setup();
    assert.equal(model.getSnapshot().following, false);
    model.receive(scope, observer, lease(second), 1);
    assert.equal(model.getSnapshot().following, false);
    assert.equal(model.follow(1), true);
    model.receive(scope, observer, lease(first, holder, 45_000), 15_000);
    assert.equal(model.getSnapshot().following, true);
  });
  it('local control revokes following before another step frame', () => {
    const model = setup();
    model.follow(0);
    const moves = [];
    const unsubscribe = model.subscribe(() => {
      const state = model.getSnapshot();
      if (state.following) moves.push(state.lease.stepId);
    });
    model.unfollow();
    model.receive(scope, observer, lease(second), 1);
    assert.deepEqual(moves, []);
    unsubscribe();
  });
  it('requires new opt-in after another holder, clearing, and the same holder after expiry', () => {
    const model = setup();
    model.follow(0);
    model.receive(scope, observer, lease(second, randomUUID()), 1);
    assert.equal(model.getSnapshot().following, false);
    model.follow(1);
    model.receive(scope, observer, { connectionId: null, stepId: null, expiresAt: null }, 2);
    assert.equal(model.getSnapshot().following, false);
    model.receive(scope, observer, lease(), 3);
    model.follow(3);
    model.receive(scope, observer, lease(second, holder, 60_000), 30_000);
    assert.equal(model.getSnapshot().following, false);
  });
  it('expires independently at the deadline without a clear frame', () => {
    const model = setup();
    model.follow(0);
    model.expire(29_999);
    assert.equal(model.getSnapshot().following, true);
    model.expire(30_000);
    assert.equal(model.getSnapshot().following, false);
    assert.equal(model.getSnapshot().lease.connectionId, null);
    assert.equal(model.follow(30_000), false);
  });
  it('drops opt-in on reconnect and ignores old-connection/old-namespace frames', () => {
    const model = setup();
    model.follow(0);
    model.bind(null, false);
    const nextObserver = randomUUID();
    model.bind(nextObserver, true);
    const before = model.getSnapshot();
    model.receive(scope, observer, lease(second), 1);
    model.receive('another-account-board', nextObserver, lease(second), 1);
    assert.equal(model.getSnapshot(), before);
    model.receive(scope, nextObserver, lease(second), 1);
    assert.equal(model.getSnapshot().following, false);
  });
  it('clears offline/archive/access state and cannot follow its own lease', () => {
    const model = setup();
    model.follow(0);
    model.bind(observer, false);
    model.receive(scope, observer, lease(second), 1);
    assert.equal(model.getSnapshot().lease.connectionId, null);
    assert.equal(model.follow(1), false);
    model.bind(observer, true);
    model.receive(scope, observer, lease(first, observer), 1);
    assert.equal(model.follow(1), false);
  });
  it('keeps unavailable step IDs as observations without choosing a substitute', () => {
    const model = setup();
    model.follow(0);
    model.receive(scope, observer, lease(null), 1);
    assert.equal(model.getSnapshot().following, true);
    assert.equal(model.getSnapshot().lease.stepId, null);
    model.receive(scope, observer, lease(second), 2);
    assert.equal(model.getSnapshot().lease.stepId, second);
    model.receive(scope, observer, { ...lease(), userId: 'spoofed' }, 3);
    assert.equal(model.getSnapshot().lease.stepId, second);
  });
  it('resolves only the followed live projected step and stops camera targets after local pan', () => {
    const model = setup();
    const steps = [
      { ...allEntityGraphFixture.steps[0], id: first },
      { ...allEntityGraphFixture.steps[0], id: second },
    ];
    assert.equal(resolveFollowedStep(model.getSnapshot(), steps, 0), null);
    model.follow(0);
    assert.equal(resolveFollowedStep(model.getSnapshot(), [], 0), null);
    assert.equal(resolveFollowedStep(model.getSnapshot(), steps, 0), steps[0]);
    model.receive(scope, observer, lease(second), 1);
    assert.equal(resolveFollowedStep(model.getSnapshot(), steps, 1), steps[1]);
    model.unfollow();
    model.receive(scope, observer, lease(first), 2);
    assert.equal(resolveFollowedStep(model.getSnapshot(), steps, 2), null);
    model.follow(2);
    assert.equal(resolveFollowedStep(model.getSnapshot(), steps, 30_000), null);
  });
  it('cleans subscribers without storing preferences or graph state', () => {
    const model = setup();
    let notifications = 0;
    const unsubscribe = model.subscribe(() => notifications++);
    model.follow(0);
    unsubscribe();
    model.unfollow();
    assert.equal(notifications, 1);
    assert.deepEqual(Object.keys(model.getSnapshot()).sort(), [
      'connectionId',
      'following',
      'lease',
      'live',
    ]);
  });
});
