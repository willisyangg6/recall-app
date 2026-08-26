/**
 * Permission UX states for the alerts control. The mapping is where the
 * "never harass" rules live: denied-and-cannot-ask renders the settings
 * pointer, and nothing maps a fresh install to a prompt.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertStatus } from './alert-status';

test('fresh install: not enabled (the screen offers the explicit action)', () => {
  assert.equal(alertStatus({ granted: false, canAskAgain: true }, false), 'not_enabled');
});

test('granted and registered here: enabled', () => {
  assert.equal(alertStatus({ granted: true, canAskAgain: false }, true), 'enabled');
});

test('system-level denial that cannot be re-asked: denied (settings pointer)', () => {
  assert.equal(alertStatus({ granted: false, canAskAgain: false }, false), 'denied');
  assert.equal(alertStatus({ granted: false, canAskAgain: false }, true), 'denied');
});

test('permission granted but user turned alerts off in-app: not enabled', () => {
  assert.equal(alertStatus({ granted: true, canAskAgain: false }, false), 'not_enabled');
});
