// Test-only IPC hook. This file is neither copied to nor exposed by the runtime image.
import { DurableUpdateFailpointController } from '../dist/modules/collaboration/application/durable-update.js';

if (process.env.NODE_ENV !== 'test' || !process.send) process.exit(1);
const point = process.env.P8_FAULT_POINT;
const original = DurableUpdateFailpointController.prototype.reach;
let used = false;
DurableUpdateFailpointController.prototype.reach = async function (current) {
  if (!used && current === point) {
    used = true;
    process.send({ event: 'fault-held' });
    await new Promise((resolve) => {
      const resume = (message) => {
        if (message?.event !== 'resume') return;
        process.off('message', resume);
        resolve();
      };
      process.on('message', resume);
    });
  }
  return original.call(this, current);
};
await import('../dist/main.js');
