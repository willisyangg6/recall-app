/**
 * The selection sheets' motion rule (2026-10-04): the opening waits for the
 * native modal's view, an interrupted close opens from where it is, closing
 * keeps the modal until the slide-out ends, and Reduce Motion is immediate
 * both ways.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openOnShow, sheetMotionAction, sheetShown } from './sheet-motion';

test('a fresh opening waits for onShow, then opens; the Modal is shown throughout', () => {
  const asked = { visible: true, closing: false, presented: false, motion: true };
  assert.deepEqual(sheetMotionAction(asked), { kind: 'wait' });
  assert.equal(sheetShown(asked), true, 'the Modal must be presented for onShow to fire');
  assert.equal(openOnShow(asked), true);
  // Once presented (a later render, or a reopening while still presented).
  assert.deepEqual(sheetMotionAction({ ...asked, presented: true }), { kind: 'open' });
});

test('closing animates out while the Modal stays presented, then rests at 0', () => {
  const closing = { visible: false, closing: true, presented: true, motion: true };
  assert.deepEqual(sheetMotionAction(closing), { kind: 'close' });
  assert.equal(sheetShown(closing), true);
  const gone = { ...closing, closing: false, presented: false };
  assert.deepEqual(sheetMotionAction(gone), { kind: 'set', to: 0 });
  assert.equal(sheetShown(gone), false);
});

test('an interrupted close reopens at once from the current value, without waiting for onShow', () => {
  // Still presented from the slide-out; the step wants it back.
  const reopened = { visible: true, closing: false, presented: true, motion: true };
  assert.deepEqual(sheetMotionAction(reopened), { kind: 'open' });
});

test('a stale onShow (closed again before the Modal presented) starts nothing', () => {
  assert.equal(openOnShow({ visible: false, motion: true }), false);
});

test('Reduce Motion, or an unknown setting, is immediate both ways and never waits', () => {
  assert.deepEqual(
    sheetMotionAction({ visible: true, closing: false, presented: false, motion: false }),
    { kind: 'set', to: 1 },
  );
  assert.deepEqual(
    sheetMotionAction({ visible: false, closing: false, presented: true, motion: false }),
    { kind: 'set', to: 0 },
  );
  assert.equal(openOnShow({ visible: true, motion: false }), false);
  // No slide-out is ever kept under Reduce Motion: `closing` is never set,
  // so the Modal goes with `visible`.
  assert.equal(sheetShown({ visible: false, closing: false }), false);
});
