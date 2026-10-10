/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Shared mutable state for the Maestro Web GUI server.
 * Kept tiny so both lib/runner.js and lib/excel.js can see the same flags
 * without requiring each other.
 */

let busy = false;
let currentChild = null;
let stopRequested = false;

module.exports = {
  get busy() { return busy; },
  set busy(v) { busy = !!v; },
  get currentChild() { return currentChild; },
  set currentChild(c) { currentChild = c; },
  get stopRequested() { return stopRequested; },
  set stopRequested(v) { stopRequested = !!v; },
  reset() {
    busy = false;
    currentChild = null;
    stopRequested = false;
  }
};