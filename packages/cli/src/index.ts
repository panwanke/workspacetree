/**
 * @workspacetree/cli 入口。被 import 时不产生副作用（便于测试复用 runCli）。
 */
import { pathToFileURL } from 'node:url';
import { runCli } from './commands.js';

export * from './commands.js';

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runCli(process.argv.slice(2))
    .then((message) => {
      console.log(message);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
